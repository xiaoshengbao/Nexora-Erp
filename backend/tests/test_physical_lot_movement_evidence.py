"""逐笔补证只归属旧客户端遗漏的批次，不重写正式库存流水。"""

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import connection, migrate
from app.core.models import (Material, PhysicalLot, PhysicalLotMovementCheckpoint,
                             PhysicalLotMovementEvidence, StockMovement)
from app.core.orm import add_model, orm_session
from app.main import app


def test_unallocated_movement_evidence_and_reversal(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'movement-evidence.db'))
    with TestClient(app, client=('127.0.0.1', 12345)) as client:
        assert client.post('/api/v1/setup/admin', json={
            'username': 'admin', 'password': 'secure-pass-123'}).status_code == 201
        token = client.post('/api/v1/auth/login', json={
            'username': 'admin', 'password': 'secure-pass-123'}).json()['token']
        auth = {'Authorization': f'Bearer {token}'}
        assert client.post('/api/v1/users', headers=auth, json={
            'username': 'observer', 'password': 'observer-pass-123',
            'roles': ['viewer']}).status_code == 201
        viewer = client.post('/api/v1/auth/login', json={
            'username': 'observer', 'password': 'observer-pass-123'}).json()['token']
        viewer_auth = {'Authorization': f'Bearer {viewer}'}
        material_id = client.post('/api/v1/materials', headers=auth, json={
            'sku': 'EVIDENCE-1', 'name': '旧客户端补证物料', 'unit': '件'}).json()['id']
        with orm_session(write=True) as db:
            inbound = add_model(db, StockMovement(warehouse_id=1, material_id=material_id,
                quantity='3.125', source_type='legacy_test', source_id=1, source_line_id=1, created_by=1))
            inbound_id = inbound.id

        base = '/api/v1/inventory/physical-lots'
        query = {'warehouse_id': 1, 'material_id': material_id}
        unallocated = client.get(f'{base}/unallocated-movements', headers=auth, params=query)
        assert unallocated.status_code == 200
        assert unallocated.json()['checkpoint_movement_id'] == 0
        assert unallocated.json()['rows'][0]['unallocated_quantity'] == '3.125'
        assert client.get(f'{base}/unallocated-movements', params=query).status_code == 401
        create = f'{base}/movements/{inbound_id}/evidence'
        body = {'quantity': '2.125', 'evidence': '现场入库标签与签收记录逐件核对',
                'supplier_lot': 'LOT-01'}
        assert client.post(create, headers=viewer_auth, json=body).status_code == 403
        created = client.post(create, headers=auth, json=body)
        assert created.status_code == 201, created.text
        result = created.json()
        assert result['quantity'] == '2.125'
        assert result['lot_code'].startswith('EVIDENCE-')
        assert result['created_by_name'] == 'admin'
        assert client.post(create, headers=auth, json={**body, 'quantity': '1.001'}).status_code == 409
        assert client.post(create, headers=auth, json={**body, 'quantity': 0.125}).status_code == 422
        assert client.post(create, headers=auth, json={**body, 'evidence': '短'}).status_code == 422
        assert client.post(create, headers=auth, json={**body, 'lot_id': result['lot_id'],
            'quantity': '1.000'}).status_code == 422
        remaining = client.get(f'{base}/unallocated-movements', headers=auth, params=query).json()
        assert remaining['rows'][0]['unallocated_quantity'] == '1.000'
        overview = client.get(f'{base}/overview', headers=auth, params=query).json()
        assert overview['differences'][0]['difference'] == '1.000'
        history = client.get(f"{base}/{result['lot_id']}/history", headers=auth).json()
        assert history['movement_evidence'][0]['evidence'] == body['evidence']
        assert history['balances'][0]['quantity'] == '2.125'
        with orm_session() as db:
            assert db.get(StockMovement, inbound_id).quantity == '3.125'
            assert db.get(PhysicalLot, result['lot_id']).origin_movement_id == inbound_id

        completed = client.post(create, headers=auth, json={
            'lot_id': result['lot_id'], 'quantity': '1.000',
            'evidence': '余下一件与同一箱码及签收单核对'})
        assert completed.status_code == 201, completed.text
        assert client.get(f'{base}/unallocated-movements', headers=auth, params=query).json()['rows'] == []

        outgoing_id = None
        with orm_session(write=True) as db:
            outgoing = add_model(db, StockMovement(warehouse_id=1, material_id=material_id,
                quantity='-1.125', source_type='legacy_test', source_id=2, source_line_id=2, created_by=1))
            outgoing_id = outgoing.id
        outbound = f'{base}/movements/{outgoing_id}/evidence'
        bad_out = {'quantity': '1.125', 'evidence': '出库箱码与仓库交接单核对'}
        assert client.post(outbound, headers=auth, json=bad_out).status_code == 422
        assert client.post(outbound, headers=auth,
            json={**bad_out, 'lot_id': result['lot_id'], 'quantity': '2.000'}).status_code == 409
        removed = client.post(outbound, headers=auth, json={**bad_out, 'lot_id': result['lot_id']})
        assert removed.status_code == 201, removed.text
        assert removed.json()['quantity'] == '-1.125'
        assert client.get(f'{base}/unallocated-movements', headers=auth, params=query).json()['rows'] == []
        reverse_in = f"{base}/movement-evidence/{result['id']}/reverse"
        assert client.post(reverse_in, headers=auth,
            json={'reason': '已有出库消耗本批次，必须先撤回出库证据'}).status_code == 409
        reverse_out = f"{base}/movement-evidence/{removed.json()['id']}/reverse"
        assert client.post(reverse_out, headers=auth, json={'reason': '复核发现出库箱码录错，保留更正轨迹'}).status_code == 201
        assert client.post(reverse_out, headers=auth, json={'reason': '重复冲销必须返回冲突'}).status_code == 409
        assert client.post(reverse_in, headers=auth,
            json={'reason': '现场入库签收记录误认，撤回本次补证'}).status_code == 201
        assert client.post(reverse_in, headers=auth,
            json={'reason': '重复冲销必须返回冲突'}).status_code == 409
        assert client.post(f"{base}/movement-evidence/{completed.json()['id']}/reverse", headers=auth,
            json={'reason': '复核发现余下一件也属于另一入库来源'}).status_code == 201
        after = client.get(f'{base}/overview', headers=auth, params=query).json()
        assert after['differences'][0]['difference'] == '2.000'
        with orm_session() as db:
            assert len(list(db.scalars(select(StockMovement.id)))) == 2
            assert len(list(db.scalars(select(PhysicalLotMovementEvidence.id)))) == 6
            assert sum((Decimal(row.quantity) for row in db.scalars(select(StockMovement))), Decimal(0)) == Decimal('2.000')


def test_checkpoint_excludes_preupgrade_movement(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'movement-checkpoint.db'))
    with TestClient(app, client=('127.0.0.1', 12345)) as client:
        client.post('/api/v1/setup/admin', json={'username': 'admin', 'password': 'secure-pass-123'})
        token = client.post('/api/v1/auth/login', json={
            'username': 'admin', 'password': 'secure-pass-123'}).json()['token']
        auth = {'Authorization': f'Bearer {token}'}
        material_id = client.post('/api/v1/materials', headers=auth, json={
            'sku': 'EVIDENCE-2', 'name': '检查点试件', 'unit': '件'}).json()['id']
        with orm_session(write=True) as db:
            movement = add_model(db, StockMovement(warehouse_id=1, material_id=material_id,
                quantity='1.000', source_type='legacy_test', source_id=1, source_line_id=1, created_by=1))
            checkpoint = db.get(PhysicalLotMovementCheckpoint, 1)
            checkpoint.movement_id = movement.id
            movement_id = movement.id
        path = f'/api/v1/inventory/physical-lots/movements/{movement_id}/evidence'
        assert client.post(path, headers=auth, json={'quantity': '1.000',
            'evidence': '检查点之前流水只属于历史未识别期初'}).status_code == 422
        listing = client.get('/api/v1/inventory/physical-lots/unallocated-movements',
            headers=auth).json()
        assert listing['rows'] == []


def test_v57_without_opening_uses_conservative_checkpoint(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'empty-opening-upgrade.db'))
    migrate()
    with orm_session(write=True) as db:
        material = add_model(db, Material(sku='EVIDENCE-3', name='无期初迁移试件', unit='件'))
        old = add_model(db, StockMovement(warehouse_id=1, material_id=material.id,
            quantity='1.000', source_type='legacy_test', source_id=1, source_line_id=1))
        old_id = old.id
    with connection() as db:
        db.execute('DROP TABLE physical_lot_movement_evidence')
        db.execute('DROP TABLE physical_lot_movement_checkpoints')
        db.execute("DELETE FROM role_permissions WHERE permission_code='physical_lot.movement_evidence'")
        db.execute("DELETE FROM permissions WHERE code='physical_lot.movement_evidence'")
        db.execute('PRAGMA user_version = 57')
    migrate()
    migrate()
    with orm_session() as db:
        checkpoint = db.get(PhysicalLotMovementCheckpoint, 1)
        assert checkpoint.movement_id == old_id
        assert checkpoint.basis == 'v58_conservative'


def test_offsetting_unallocated_movements_need_atomic_group_reconciliation(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'offsetting-movements.db'))
    with TestClient(app, client=('127.0.0.1', 12345)) as client:
        client.post('/api/v1/setup/admin', json={'username': 'admin', 'password': 'secure-pass-123'})
        token = client.post('/api/v1/auth/login', json={
            'username': 'admin', 'password': 'secure-pass-123'}).json()['token']
        auth = {'Authorization': f'Bearer {token}'}
        material_id = client.post('/api/v1/materials', headers=auth, json={
            'sku': 'EVIDENCE-4', 'name': '相抵流水试件', 'unit': '件'}).json()['id']
        with orm_session(write=True) as db:
            inbound = add_model(db, StockMovement(warehouse_id=1, material_id=material_id,
                quantity='1.000', source_type='legacy_test', source_id=1, source_line_id=1))
            db.add(StockMovement(warehouse_id=1, material_id=material_id,
                quantity='-1.000', source_type='legacy_test', source_id=2, source_line_id=2))
            inbound_id = inbound.id
        listing = client.get('/api/v1/inventory/physical-lots/unallocated-movements',
            headers=auth).json()
        assert len(listing['rows']) == 2
        response = client.post(f'/api/v1/inventory/physical-lots/movements/{inbound_id}/evidence',
            headers=auth, json={'quantity': '1.000', 'evidence': '原始交接记录需要成组逐笔核对'})
        assert response.status_code == 409
        with orm_session() as db:
            assert db.scalar(select(PhysicalLotMovementEvidence.id)) is None
