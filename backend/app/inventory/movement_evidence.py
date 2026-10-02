"""旧客户端未分配流水的逐笔补证；正式库存流水保持原样。"""

from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access.security import require
from app.core.models import (Material, PhysicalLot, PhysicalLotAllocation, PhysicalLotMovementCheckpoint,
                             PhysicalLotMovementEvidence, StockMovement, Warehouse)
from app.core.orm import add_model, orm_session
from app.inventory.lot_inputs import PhysicalLotPartInput
from app.inventory.physical_lots import lot_balance, unassigned_stock_quantity


router = APIRouter(prefix='/api/v1/inventory/physical-lots')


class MovementEvidenceInput(PhysicalLotPartInput):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    lot_id: int | None = Field(default=None, gt=0, strict=True)
    evidence: str = Field(min_length=10, max_length=500)

    @field_validator('quantity', mode='before')
    @classmethod
    def exact_quantity_text(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError('补证数量须使用精确十进制文本')
        return value


class ReverseMovementEvidenceInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    reason: str = Field(min_length=10, max_length=500)


def _checkpoint(db: Session) -> PhysicalLotMovementCheckpoint:
    checkpoint = db.get(PhysicalLotMovementCheckpoint, 1)
    if checkpoint is None:
        raise HTTPException(503, '实物批次升级检查点缺失，请先完成数据库迁移')
    return checkpoint


def _assigned_to_movement(db: Session, movement_id: int) -> Decimal:
    allocations = db.scalars(select(PhysicalLotAllocation.quantity).where(
        PhysicalLotAllocation.movement_id == movement_id))
    evidence = db.scalars(select(PhysicalLotMovementEvidence.quantity).where(
        PhysicalLotMovementEvidence.movement_id == movement_id))
    return sum((Decimal(value) for value in (*allocations, *evidence)), Decimal(0))


def _result(db: Session, record: PhysicalLotMovementEvidence, username: str) -> dict:
    movement = db.get(StockMovement, record.movement_id)
    lot = db.get(PhysicalLot, record.lot_id)
    return {'id': record.id, 'movement_id': record.movement_id, 'lot_id': record.lot_id,
            'lot_code': lot.code, 'warehouse_id': movement.warehouse_id,
            'material_id': movement.material_id, 'quantity': record.quantity,
            'evidence': record.evidence, 'original_evidence_id': record.original_evidence_id,
            'created_by_name': username, 'created_at': record.created_at}


@router.get('/unallocated-movements')
def unallocated_movements(warehouse_id: int | None = Query(default=None, gt=0),
                          material_id: int | None = Query(default=None, gt=0),
                          _: dict = Depends(require('inventory.view'))) -> dict:
    with orm_session() as db:
        if warehouse_id is not None and db.get(Warehouse, warehouse_id) is None:
            raise HTTPException(404, '仓库不存在')
        if material_id is not None and db.get(Material, material_id) is None:
            raise HTTPException(404, '物料不存在')
        checkpoint = _checkpoint(db)
        conditions = [StockMovement.id > checkpoint.movement_id]
        if warehouse_id is not None:
            conditions.append(StockMovement.warehouse_id == warehouse_id)
        if material_id is not None:
            conditions.append(StockMovement.material_id == material_id)
        assigned: dict[int, Decimal] = {}
        for model in (PhysicalLotAllocation, PhysicalLotMovementEvidence):
            parts = select(model.movement_id, model.quantity).join(
                StockMovement, StockMovement.id == model.movement_id).where(*conditions)
            for movement_key, quantity in db.execute(parts):
                assigned[movement_key] = assigned.get(movement_key, Decimal(0)) + Decimal(quantity)
        rows = []
        for movement in db.scalars(select(StockMovement).where(*conditions).order_by(StockMovement.id.desc())):
            remaining = Decimal(movement.quantity) - assigned.get(movement.id, Decimal(0))
            if remaining == 0:
                continue
            rows.append({'movement_id': movement.id, 'warehouse_id': movement.warehouse_id,
                         'material_id': movement.material_id, 'quantity': movement.quantity,
                         'unallocated_quantity': format(remaining, 'f'),
                         'source_type': movement.source_type, 'source_id': movement.source_id,
                         'source_line_id': movement.source_line_id, 'created_at': movement.created_at})
            if len(rows) > 100:
                break
        return {'checkpoint_movement_id': checkpoint.movement_id,
                'checkpoint_basis': checkpoint.basis,
                'warehouse_id': warehouse_id, 'material_id': material_id,
                'rows': rows[:100], 'has_more': len(rows) > 100}


@router.post('/movements/{movement_id}/evidence', status_code=201)
def add_movement_evidence(data: MovementEvidenceInput, movement_id: int = Path(gt=0),
                          user: dict = Depends(require('physical_lot.movement_evidence'))) -> dict:
    with orm_session(write=True) as db:
        movement = db.get(StockMovement, movement_id)
        if movement is None:
            raise HTTPException(404, '库存流水不存在')
        if movement.id <= _checkpoint(db).movement_id:
            raise HTTPException(422, '该流水已纳入历史未识别期初，不能重复分配')
        remaining = Decimal(movement.quantity) - _assigned_to_movement(db, movement.id)
        if remaining != 0 and ((remaining > 0) != (Decimal(movement.quantity) > 0)
                               or abs(remaining) > abs(Decimal(movement.quantity))):
            raise HTTPException(409, '原流水批次分配已超量，请先核对历史记录')
        quantity = data.quantity if remaining > 0 else -data.quantity
        if remaining == 0 or abs(quantity) > abs(remaining) or (quantity > 0) != (remaining > 0):
            raise HTTPException(409, '流水未分配数量不足，请重新读取')
        difference = unassigned_stock_quantity(db, movement.warehouse_id, movement.material_id)
        if (quantity > 0 and difference < quantity) or (quantity < 0 and difference > quantity):
            raise HTTPException(409, '本仓正式库存与批次差额不足，请先核对其他流水')
        if data.lot_id is None:
            if quantity < 0:
                raise HTTPException(422, '出库补证须选择现有实物批次')
            lot = add_model(db, PhysicalLot(
                material_id=movement.material_id, code=f'EVIDENCE-{uuid4().hex.upper()}',
                source_kind='movement_evidence', supplier_lot=data.supplier_lot,
                manufactured_on=data.manufactured_on.isoformat() if data.manufactured_on else None,
                expires_on=data.expires_on.isoformat() if data.expires_on else None,
                origin_movement_id=movement.id, created_by=user['id']))
        else:
            lot = db.get(PhysicalLot, data.lot_id)
            if lot is None or lot.material_id != movement.material_id:
                raise HTTPException(422, '所选批次与流水物料不一致')
            if data.supplier_lot or data.manufactured_on or data.expires_on:
                raise HTTPException(422, '已有批次的来源属性不能在逐笔补证时修改')
        if quantity < 0 and lot_balance(db, movement.warehouse_id, lot.id) < -quantity:
            raise HTTPException(409, '所选批次现存量不足')
        record = add_model(db, PhysicalLotMovementEvidence(
            movement_id=movement.id, lot_id=lot.id, quantity=format(quantity, 'f'),
            evidence=data.evidence, created_by=user['id']))
        return _result(db, record, user['username'])


@router.post('/movement-evidence/{record_id}/reverse', status_code=201)
def reverse_movement_evidence(data: ReverseMovementEvidenceInput, record_id: int = Path(gt=0),
                              user: dict = Depends(require('physical_lot.movement_evidence'))) -> dict:
    with orm_session(write=True) as db:
        original = db.get(PhysicalLotMovementEvidence, record_id)
        if original is None:
            raise HTTPException(404, '逐笔补证记录不存在')
        if original.original_evidence_id is not None:
            raise HTTPException(422, '只能冲销原始逐笔补证')
        if db.scalar(select(PhysicalLotMovementEvidence.id).where(
                PhysicalLotMovementEvidence.original_evidence_id == record_id)) is not None:
            raise HTTPException(409, '逐笔补证已冲销')
        movement = db.get(StockMovement, original.movement_id)
        quantity = Decimal(original.quantity)
        if quantity > 0 and lot_balance(db, movement.warehouse_id, original.lot_id) < quantity:
            raise HTTPException(409, '补证批次已被后续单据使用，不能冲销')
        reversal = add_model(db, PhysicalLotMovementEvidence(
            movement_id=original.movement_id, lot_id=original.lot_id,
            quantity=format(-quantity, 'f'), evidence=data.reason,
            original_evidence_id=original.id, created_by=user['id']))
        return _result(db, reversal, user['username'])
