"""批次分配在写事务内保持精确守恒，失败时整笔流水回滚。"""

from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.models import Material, PhysicalLot, PhysicalLotAllocation, StockMovement
from app.core.orm import add_model, orm_session
from app.inventory.physical_lots import LotPart, lot_balance, post_lot_movement
from app.main import app


def _movement(material_id: int, warehouse_id: int, quantity: str, source_id: int) -> StockMovement:
    return StockMovement(
        warehouse_id=warehouse_id, material_id=material_id, quantity=quantity,
        source_type='lot_test', source_id=source_id, source_line_id=source_id, created_by=1)


def test_lot_posting_conserves_multi_lot_stock_and_reversal_lineage(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'lot-transactions.db'))
    with TestClient(app, client=('127.0.0.1', 12345)) as client:
        assert client.post('/api/v1/setup/admin', json={
            'username': 'admin', 'password': 'secure-pass-123'}).status_code == 201
        token = client.post('/api/v1/auth/login', json={
            'username': 'admin', 'password': 'secure-pass-123'}).json()['token']
        auth = {'Authorization': f'Bearer {token}'}
        material_id = client.post('/api/v1/materials', headers=auth, json={
            'sku': 'LOT-TXN', 'name': '批次事务物料', 'unit': '件'}).json()['id']
        other_material_id = client.post('/api/v1/materials', headers=auth, json={
            'sku': 'LOT-OTHER', 'name': '其他物料', 'unit': '件'}).json()['id']

    with orm_session(write=True) as db:
        first = add_model(db, PhysicalLot(material_id=material_id, code='A',
                                          source_kind='lot_test', created_by=1))
        second = add_model(db, PhysicalLot(material_id=material_id, code='B',
                                           source_kind='lot_test', created_by=1))
        inbound_a = post_lot_movement(db, _movement(material_id, 1, '2.000', 1), [
            LotPart(first.id, Decimal('2.000'))])
        inbound_b = post_lot_movement(db, _movement(material_id, 1, '3.000', 2), [
            LotPart(second.id, Decimal('3.000'))])
        first.origin_movement_id = inbound_a.id
        second.origin_movement_id = inbound_b.id
        first_id, second_id = first.id, second.id

    with pytest.raises(HTTPException) as shortage:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(material_id, 1, '-3.000', 3), [
                LotPart(first_id, Decimal('-2.001')),
                LotPart(second_id, Decimal('-0.999'))])
    assert shortage.value.status_code == 409

    with pytest.raises(HTTPException) as mismatch:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(material_id, 1, '-3.000', 4), [
                LotPart(first_id, Decimal('-1.000'))])
    assert mismatch.value.status_code == 422

    with pytest.raises(HTTPException) as wrong_material:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(other_material_id, 1, '1.000', 5), [
                LotPart(first_id, Decimal('1.000'))])
    assert wrong_material.value.status_code == 422

    with pytest.raises(HTTPException) as wrong_warehouse:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(material_id, 2, '-1.000', 6), [
                LotPart(first_id, Decimal('-1.000'))])
    assert wrong_warehouse.value.status_code == 409

    with orm_session(write=True) as db:
        outbound = post_lot_movement(db, _movement(material_id, 1, '-3.000', 7), [
            LotPart(first_id, Decimal('-1.125')),
            LotPart(second_id, Decimal('-1.875'))])
        outbound_id = outbound.id

    with pytest.raises(HTTPException) as consumed:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(material_id, 1, '-2.000', 8), [
                LotPart(first_id, Decimal('-2.000'))])
    assert consumed.value.status_code == 409

    with orm_session(write=True) as db:
        allocations = list(db.scalars(select(PhysicalLotAllocation).where(
            PhysicalLotAllocation.movement_id == outbound_id).order_by(PhysicalLotAllocation.lot_id)))
        assert [Decimal(row.quantity) for row in allocations] == [Decimal('-1.125'), Decimal('-1.875')]
        post_lot_movement(db, _movement(material_id, 1, '3.000', 9), [
            LotPart(first_id, Decimal('1.125'), allocations[0].id),
            LotPart(second_id, Decimal('1.875'), allocations[1].id)])
        assert lot_balance(db, 1, first_id) == Decimal('2.000')
        assert lot_balance(db, 1, second_id) == Decimal('3.000')

    with pytest.raises(HTTPException) as duplicate_reversal:
        with orm_session(write=True) as db:
            post_lot_movement(db, _movement(material_id, 1, '1.125', 10), [
                LotPart(first_id, Decimal('1.125'), allocations[0].id)])
    assert duplicate_reversal.value.status_code == 409

    with orm_session() as db:
        assert len(list(db.scalars(select(StockMovement.id)))) == 4
        assert len(list(db.scalars(select(PhysicalLotAllocation.id)))) == 6
        assert db.get(Material, material_id).sku == 'LOT-TXN'
