"""生产领料单与库存流水；确认时核对工单剩余需料和源仓库存。"""

from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from sqlalchemy.engine import RowMapping
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.core.orm import orm_session, add_model
from app.core.models import (
    Material,
    MaterialIssue,
    MaterialIssueLine,
    PhysicalLot,
    PhysicalLotAllocation,
    StockMovement,
    User,
    Warehouse,
    WorkOrder,
    WorkOrderLine,
)
from app.inventory.warehouse import balance, require_warehouse
from app.inventory.physical_lots import LotPart, lot_balance, post_lot_movement
from app.access.security import require
from app.production.material_returns import returned_quantity
from app.production.work_orders import issued_quantity

router = APIRouter(prefix="/api/v1")


class MaterialIssueLineInput(BaseModel):
    work_order_line_id: int = Field(gt=0)
    quantity: Decimal

    @field_validator("quantity")
    @classmethod
    def valid_quantity(cls, value: Decimal) -> Decimal:
        if not value.is_finite() or value <= 0 or value > 1_000_000 or value.as_tuple().exponent < -3:
            raise ValueError("领料数量须大于零、最多三位小数且不超过一百万")
        return value


class MaterialIssueInput(BaseModel):
    work_order_id: int = Field(gt=0)
    warehouse_id: int = Field(gt=0)
    reference: str = Field(default="", max_length=100)
    lines: list[MaterialIssueLineInput] = Field(min_length=1, max_length=100)


class MaterialIssueLotPartInput(BaseModel):
    lot_id: int = Field(gt=0)
    quantity: Decimal

    @field_validator('quantity')
    @classmethod
    def valid_quantity(cls, value: Decimal) -> Decimal:
        return MaterialIssueLineInput.valid_quantity(value)


class MaterialIssueLotLineInput(BaseModel):
    material_issue_line_id: int = Field(gt=0)
    lots: list[MaterialIssueLotPartInput] = Field(min_length=1, max_length=20)


class MaterialIssuePostInput(BaseModel):
    lines: list[MaterialIssueLotLineInput] = Field(min_length=1, max_length=100)


def material_issue_data(db: Session, issue_id: int) -> dict:
    row = (
        db.execute(
            select(
                MaterialIssue.id,
                MaterialIssue.work_order_id,
                MaterialIssue.warehouse_id,
                MaterialIssue.reference,
                MaterialIssue.status,
                MaterialIssue.created_by,
                MaterialIssue.posted_by,
                MaterialIssue.cancelled_by,
                MaterialIssue.created_at,
                MaterialIssue.posted_at,
                MaterialIssue.cancelled_at,
                Warehouse.name.label("warehouse_name"),
                User.username.label("created_by_name"),
            )
            .select_from(MaterialIssue)
            .join(Warehouse, (Warehouse.id == MaterialIssue.warehouse_id))
            .join(User, (User.id == MaterialIssue.created_by))
            .where((MaterialIssue.id == issue_id))
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "生产领料单不存在")
    lines = (
        db.execute(
            select(
                MaterialIssueLine.id,
                MaterialIssueLine.work_order_line_id,
                WorkOrderLine.component_material_id,
                Material.sku,
                Material.name.label("material_name"),
                Material.unit,
                MaterialIssueLine.quantity,
            )
            .select_from(MaterialIssueLine)
            .join(WorkOrderLine, (WorkOrderLine.id == MaterialIssueLine.work_order_line_id))
            .join(Material, (Material.id == WorkOrderLine.component_material_id))
            .where((MaterialIssueLine.material_issue_id == issue_id))
            .order_by(MaterialIssueLine.id)
        )
        .mappings()
        .all()
    )
    lots_by_line: dict[int, list[dict]] = {}
    for line_id, lot, allocation in db.execute(
        select(StockMovement.source_line_id, PhysicalLot, PhysicalLotAllocation)
        .join(PhysicalLotAllocation, PhysicalLotAllocation.movement_id == StockMovement.id)
        .join(PhysicalLot, PhysicalLot.id == PhysicalLotAllocation.lot_id)
        .where(StockMovement.source_type == 'material_issue', StockMovement.source_id == issue_id)
        .order_by(StockMovement.source_line_id, PhysicalLotAllocation.id)
    ):
        lots_by_line.setdefault(line_id, []).append({
            'id': lot.id, 'code': lot.code, 'quantity': format(-Decimal(allocation.quantity), 'f'),
            'source_kind': lot.source_kind, 'supplier_lot': lot.supplier_lot,
            'manufactured_on': lot.manufactured_on, 'expires_on': lot.expires_on,
        })
    details = []
    for line in lines:
        returned = returned_quantity(db, line["id"])
        details.append(
            {
                **dict(line),
                "returned_quantity": str(returned),
                "returnable_quantity": str(Decimal(line["quantity"]) - returned),
                "physical_lots": lots_by_line.get(line['id'], []),
            }
        )
    return {**dict(row), "lines": details}


def checked_lines(db: Session, order_id: int, lines: list[tuple[int, Decimal]]) -> list[RowMapping]:
    known = {
        row["id"]: row
        for row in db.execute(
            select(WorkOrderLine.id, WorkOrderLine.component_material_id, WorkOrderLine.required_quantity)
            .select_from(WorkOrderLine)
            .where((WorkOrderLine.work_order_id == order_id))
        ).mappings()
    }
    result = []
    for line_id, quantity in lines:
        row = known.get(line_id)
        if not row:
            raise HTTPException(422, "领料明细不属于此生产工单")
        if quantity > Decimal(row["required_quantity"]) - issued_quantity(db, line_id):
            raise HTTPException(409, f"组件 #{row['component_material_id']} 超出工单剩余需料")
        result.append(row)
    return result


@router.get("/material-issues")
def list_material_issues(_: dict = Depends(require("production.view"))) -> list[dict]:
    with orm_session() as db:
        ids = [
            row
            for row in db.scalars(
                select(MaterialIssue.id).select_from(MaterialIssue).order_by(MaterialIssue.id.desc())
            )
        ]
        return [material_issue_data(db, issue_id) for issue_id in ids]


@router.post("/material-issues", status_code=201)
def create_material_issue(
    payload: MaterialIssueInput, user: dict = Depends(require("material_issue.create"))
) -> dict:
    line_ids = [line.work_order_line_id for line in payload.lines]
    if len(set(line_ids)) != len(line_ids):
        raise HTTPException(422, "一张领料单不能重复选择同一组件")
    with orm_session(write=True) as db:
        order = (
            db.execute(
                select(WorkOrder.status).select_from(WorkOrder).where((WorkOrder.id == payload.work_order_id))
            )
            .mappings()
            .first()
        )
        if not order:
            raise HTTPException(422, "生产工单不存在")
        if order["status"] not in ("released", "in_progress"):
            raise HTTPException(409, "只有已下达或生产中的工单可以领料")
        require_warehouse(db, payload.warehouse_id)
        checked_lines(
            db, payload.work_order_id, [(line.work_order_line_id, line.quantity) for line in payload.lines]
        )
        cursor = add_model(
            db,
            MaterialIssue(
                work_order_id=payload.work_order_id,
                warehouse_id=payload.warehouse_id,
                reference=payload.reference.strip(),
                created_by=user["id"],
            ),
        )
        db.add_all(
            [
                MaterialIssueLine(
                    material_issue_id=cursor.id,
                    work_order_line_id=line.work_order_line_id,
                    quantity=str(line.quantity),
                )
                for line in payload.lines
            ]
        )
        return material_issue_data(db, cursor.id)


@router.get('/material-issues/{issue_id}/available-lots')
def available_material_issue_lots(issue_id: int,
                                  _: dict = Depends(require('material_issue.post'))) -> dict:
    with orm_session() as db:
        issue = db.get(MaterialIssue, issue_id)
        if issue is None:
            raise HTTPException(404, '生产领料单不存在')
        if issue.status != 'draft':
            raise HTTPException(409, '只能查询生产领料草稿的可用批次')
        lines = list(db.execute(
            select(MaterialIssueLine.id, MaterialIssueLine.quantity,
                   WorkOrderLine.component_material_id)
            .join(WorkOrderLine, WorkOrderLine.id == MaterialIssueLine.work_order_line_id)
            .where(MaterialIssueLine.material_issue_id == issue_id)
            .order_by(MaterialIssueLine.id)).mappings())
        materials = {line['component_material_id'] for line in lines}
        lots = list(db.scalars(select(PhysicalLot).where(
            PhysicalLot.material_id.in_(materials)).order_by(PhysicalLot.id)))
        available = {material_id: [] for material_id in materials}
        for lot in lots:
            quantity = lot_balance(db, issue.warehouse_id, lot.id)
            if quantity > 0:
                available[lot.material_id].append({
                    'lot_id': lot.id, 'code': lot.code, 'source_kind': lot.source_kind,
                    'quantity': format(quantity, 'f'), 'supplier_lot': lot.supplier_lot,
                    'manufactured_on': lot.manufactured_on, 'expires_on': lot.expires_on,
                })
        return {'material_issue_id': issue_id, 'warehouse_id': issue.warehouse_id,
                'lines': [{'material_issue_line_id': line['id'],
                           'material_id': line['component_material_id'],
                           'quantity': line['quantity'],
                           'lots': available[line['component_material_id']]}
                          for line in lines]}


@router.post("/material-issues/{issue_id}/post")
def post_material_issue(issue_id: int, payload: MaterialIssuePostInput | None = None,
                        user: dict = Depends(require("material_issue.post"))) -> dict:
    with orm_session(write=True) as db:
        # 同一写锁保护剩余需料、库存余额、负向流水和工单状态。
        issue = (
            db.execute(
                select(
                    MaterialIssue.id,
                    MaterialIssue.work_order_id,
                    MaterialIssue.warehouse_id,
                    MaterialIssue.reference,
                    MaterialIssue.status,
                    MaterialIssue.created_by,
                    MaterialIssue.posted_by,
                    MaterialIssue.cancelled_by,
                    MaterialIssue.created_at,
                    MaterialIssue.posted_at,
                    MaterialIssue.cancelled_at,
                )
                .select_from(MaterialIssue)
                .where((MaterialIssue.id == issue_id))
            )
            .mappings()
            .first()
        )
        if not issue:
            raise HTTPException(404, "生产领料单不存在")
        if issue["status"] != "draft":
            raise HTTPException(409, "此生产领料单已处理")
        order = (
            db.execute(
                select(WorkOrder.status)
                .select_from(WorkOrder)
                .where((WorkOrder.id == issue["work_order_id"]))
            )
            .mappings()
            .first()
        )
        if order["status"] not in ("released", "in_progress"):
            raise HTTPException(409, "生产工单当前不可领料")
        lines = (
            db.execute(
                select(MaterialIssueLine.id, MaterialIssueLine.work_order_line_id, MaterialIssueLine.quantity)
                .select_from(MaterialIssueLine)
                .where((MaterialIssueLine.material_issue_id == issue_id))
            )
            .mappings()
            .all()
        )
        checked = checked_lines(
            db,
            issue["work_order_id"],
            [(line["work_order_line_id"], Decimal(line["quantity"])) for line in lines],
        )
        lot_lines = {line.material_issue_line_id: line for line in payload.lines} if payload else None
        if lot_lines is not None and (len(lot_lines) != len(payload.lines)
                                      or set(lot_lines) != {line['id'] for line in lines}):
            raise HTTPException(422, '领料批次明细须与单据明细一致且不重复')
        for line, order_line in zip(lines, checked):
            if balance(db, issue["warehouse_id"], order_line["component_material_id"]) < Decimal(
                line["quantity"]
            ):
                raise HTTPException(409, f"组件 #{order_line['component_material_id']} 在源仓库的库存不足")
        for line, order_line in zip(lines, checked):
            movement = StockMovement(
                    warehouse_id=issue["warehouse_id"],
                    material_id=order_line["component_material_id"],
                    quantity=str(-Decimal(line["quantity"])),
                    source_type="material_issue",
                    source_id=issue_id,
                    source_line_id=line["id"],
                    created_by=user["id"],
                )
            if lot_lines is None:
                db.add(movement)
                continue
            parts = lot_lines[line['id']].lots
            if len({part.lot_id for part in parts}) != len(parts):
                raise HTTPException(422, '一行领料不能重复选择同一实物批次')
            if sum((part.quantity for part in parts), Decimal(0)) != Decimal(line['quantity']):
                raise HTTPException(422, f'领料明细 #{line["id"]} 的批次数量之和不匹配')
            post_lot_movement(db, movement, [LotPart(part.lot_id, -part.quantity) for part in parts])
        db.execute(
            update(MaterialIssue)
            .where((MaterialIssue.id == issue_id))
            .values(status="posted", posted_by=user["id"], posted_at=func.current_timestamp())
        )
        db.execute(
            update(WorkOrder)
            .where(WorkOrder.id == issue["work_order_id"], WorkOrder.status == "released")
            .values(status="in_progress")
        )
        return material_issue_data(db, issue_id)


@router.post("/material-issues/{issue_id}/cancel")
def cancel_material_issue(issue_id: int, user: dict = Depends(require("material_issue.cancel"))) -> dict:
    with orm_session(write=True) as db:
        row = (
            db.execute(
                select(MaterialIssue.status).select_from(MaterialIssue).where((MaterialIssue.id == issue_id))
            )
            .mappings()
            .first()
        )
        if not row:
            raise HTTPException(404, "生产领料单不存在")
        if row["status"] != "draft":
            raise HTTPException(409, "已确认领料不可取消，须另行办理退料更正")
        db.execute(
            update(MaterialIssue)
            .where((MaterialIssue.id == issue_id))
            .values(status="cancelled", cancelled_by=user["id"], cancelled_at=func.current_timestamp())
        )
        return material_issue_data(db, issue_id)
