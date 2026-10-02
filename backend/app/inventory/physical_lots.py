"""实物批次结存快照；未分配的库存必须显式显示为差额。"""

from dataclasses import dataclass
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access.security import require
from app.core.models import Material, PhysicalLot, PhysicalLotAllocation, PhysicalLotOpening, StockMovement, Warehouse
from app.core.orm import orm_session


router = APIRouter(prefix='/api/v1/inventory/physical-lots')


@dataclass(frozen=True)
class LotPart:
    lot_id: int
    quantity: Decimal
    original_allocation_id: int | None = None


def lot_balance(db: Session, warehouse_id: int, lot_id: int) -> Decimal:
    """在同一写事务中按原始文本累计数量，避免 SQLite 对小数的浮点求和。"""
    opening = db.scalars(select(PhysicalLotOpening.quantity).where(
        PhysicalLotOpening.warehouse_id == warehouse_id,
        PhysicalLotOpening.lot_id == lot_id))
    movement = db.scalars(select(PhysicalLotAllocation.quantity).join(
        StockMovement, StockMovement.id == PhysicalLotAllocation.movement_id).where(
            StockMovement.warehouse_id == warehouse_id,
            PhysicalLotAllocation.lot_id == lot_id))
    return sum((Decimal(value) for value in (*opening, *movement)), Decimal(0))


def post_lot_movement(db: Session, movement: StockMovement, parts: list[LotPart]) -> StockMovement:
    """将库存流水与完整的实物批次分配一起写入当前 ORM 事务。"""
    quantity = Decimal(movement.quantity)
    if not quantity.is_finite() or quantity == 0 or quantity.as_tuple().exponent < -3:
        raise HTTPException(422, '库存流水数量无效')
    if not parts or len({part.lot_id for part in parts}) != len(parts):
        raise HTTPException(422, '须为库存流水指定不重复的实物批次')
    checked: list[tuple[LotPart, Decimal]] = []
    for part in parts:
        value = part.quantity
        if (not value.is_finite() or value == 0 or value.as_tuple().exponent < -3
                or (value > 0) != (quantity > 0)):
            raise HTTPException(422, '批次分配数量方向或精度无效')
        lot = db.get(PhysicalLot, part.lot_id)
        if lot is None or lot.material_id != movement.material_id:
            raise HTTPException(422, f'物料 #{movement.material_id} 的实物批次无效')
        if value < 0 and lot_balance(db, movement.warehouse_id, part.lot_id) < -value:
            raise HTTPException(409, f'实物批次 {lot.code} 在仓库 #{movement.warehouse_id} 的数量不足')
        if part.original_allocation_id is not None:
            original = db.get(PhysicalLotAllocation, part.original_allocation_id)
            if original is None or original.lot_id != part.lot_id or Decimal(original.quantity) != -value:
                raise HTTPException(422, '冲销批次分配与原流水不一致')
            if db.scalar(select(PhysicalLotAllocation.id).where(
                    PhysicalLotAllocation.original_allocation_id == part.original_allocation_id)) is not None:
                raise HTTPException(409, '原批次分配已经冲销')
        checked.append((part, value))
    if sum((value for _, value in checked), Decimal(0)) != quantity:
        raise HTTPException(422, '批次分配数量之和与库存流水不一致')
    db.add(movement)
    db.flush()
    db.add_all(PhysicalLotAllocation(
        lot_id=part.lot_id, movement_id=movement.id, quantity=str(value),
        original_allocation_id=part.original_allocation_id)
        for part, value in checked)
    db.flush()
    return movement


def _add(balances: dict[tuple[int, int], Decimal], key: tuple[int, int], quantity: str) -> None:
    balances[key] = balances.get(key, Decimal(0)) + Decimal(quantity)


@router.get('/overview')
def overview(warehouse_id: int | None = Query(default=None, gt=0),
             material_id: int | None = Query(default=None, gt=0),
             _: dict = Depends(require('inventory.view'))) -> dict:
    with orm_session() as db:
        warehouses = {row.id: row for row in db.scalars(select(Warehouse))}
        materials = {row.id: row for row in db.scalars(select(Material))}
        lots = {row.id: row for row in db.scalars(select(PhysicalLot))}
        stock: dict[tuple[int, int], Decimal] = {}
        lot_balances: dict[tuple[int, int], Decimal] = {}

        movement_query = select(StockMovement.warehouse_id, StockMovement.material_id, StockMovement.quantity)
        if warehouse_id is not None:
            movement_query = movement_query.where(StockMovement.warehouse_id == warehouse_id)
        if material_id is not None:
            movement_query = movement_query.where(StockMovement.material_id == material_id)
        for warehouse, material, quantity in db.execute(movement_query):
            _add(stock, (warehouse, material), quantity)

        opening_query = select(PhysicalLotOpening.warehouse_id, PhysicalLotOpening.lot_id,
                               PhysicalLotOpening.quantity).join(
                                   PhysicalLot, PhysicalLot.id == PhysicalLotOpening.lot_id)
        if warehouse_id is not None:
            opening_query = opening_query.where(PhysicalLotOpening.warehouse_id == warehouse_id)
        if material_id is not None:
            opening_query = opening_query.where(PhysicalLot.material_id == material_id)
        for warehouse, lot, quantity in db.execute(opening_query):
            _add(lot_balances, (warehouse, lot), quantity)

        allocation_query = select(StockMovement.warehouse_id, PhysicalLotAllocation.lot_id,
                                  PhysicalLotAllocation.quantity).join(
                                      StockMovement, StockMovement.id == PhysicalLotAllocation.movement_id).join(
                                          PhysicalLot, PhysicalLot.id == PhysicalLotAllocation.lot_id)
        if warehouse_id is not None:
            allocation_query = allocation_query.where(StockMovement.warehouse_id == warehouse_id)
        if material_id is not None:
            allocation_query = allocation_query.where(PhysicalLot.material_id == material_id)
        for warehouse, lot, quantity in db.execute(allocation_query):
            _add(lot_balances, (warehouse, lot), quantity)

        assigned: dict[tuple[int, int], Decimal] = {}
        rows = []
        for (warehouse, lot_id), quantity in sorted(lot_balances.items()):
            lot = lots[lot_id]
            material = materials[lot.material_id]
            key = (warehouse, lot.material_id)
            assigned[key] = assigned.get(key, Decimal(0)) + quantity
            rows.append({
                'warehouse_id': warehouse, 'warehouse_name': warehouses[warehouse].name,
                'material_id': lot.material_id, 'sku': material.sku,
                'material_name': material.name, 'unit': material.unit,
                'lot_id': lot_id, 'lot_code': lot.code, 'source_kind': lot.source_kind,
                'supplier_lot': lot.supplier_lot, 'manufactured_on': lot.manufactured_on,
                'expires_on': lot.expires_on, 'quantity': format(quantity, 'f')})

        differences = []
        for key in sorted(stock.keys() | assigned.keys()):
            expected = stock.get(key, Decimal(0))
            actual = assigned.get(key, Decimal(0))
            if expected == actual:
                continue
            warehouse, material_id = key
            differences.append({
                'warehouse_id': warehouse, 'warehouse_name': warehouses[warehouse].name,
                'material_id': material_id, 'sku': materials[material_id].sku,
                'stock_quantity': format(expected, 'f'), 'lot_quantity': format(actual, 'f'),
                'difference': format(expected - actual, 'f')})
        return {'rows': rows, 'differences': differences, 'fully_allocated': not differences}
