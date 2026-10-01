"""仓库其他出库单；库存减少只发生在确认事务中。"""

from sqlalchemy import select, update, func, literal
from sqlalchemy.orm import Session, aliased

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.access.security import require
from app.core.orm import orm_session, add_model
from app.core.models import (
    Material,
    StockMovement,
    User,
    Warehouse,
    WarehouseOutbound,
    WarehouseOutboundLine,
    WarehouseOutboundReversal,
    MaintenanceJob,
)
from app.inventory.warehouse import balance, require_warehouse

UserCreator = aliased(User)
UserPoster = aliased(User)
UserRu = aliased(User)

router = APIRouter(prefix="/api/v1")


class OutboundLineInput(BaseModel):
    material_id: int = Field(gt=0)
    quantity: Decimal

    @field_validator("quantity")
    @classmethod
    def valid_quantity(cls, value: Decimal) -> Decimal:
        if not value.is_finite() or value <= 0 or value > 1_000_000 or value.as_tuple().exponent < -3:
            raise ValueError("数量须大于零、最多三位小数且不超过一百万")
        return value


class OutboundInput(BaseModel):
    warehouse_id: int = Field(gt=0)
    reason: str
    note: str = Field(min_length=1, max_length=200)
    reference: str = Field(default="", max_length=100)
    lines: list[OutboundLineInput] = Field(min_length=1, max_length=100)

    @field_validator("reason")
    @classmethod
    def valid_reason(cls, value: str) -> str:
        if value not in ("scrap", "sample", "other"):
            raise ValueError("出库用途无效")
        return value

    @field_validator("note")
    @classmethod
    def valid_note(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("出库说明不能为空")
        return value.strip()


class ReverseInput(BaseModel):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def valid_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("冲销原因不能为空")
        return value.strip()


def outbound_data(db: Session, outbound_id: int) -> dict:
    row = (
        db.execute(
            select(
                WarehouseOutbound.id,
                WarehouseOutbound.warehouse_id,
                WarehouseOutbound.source_kind,
                WarehouseOutbound.reason,
                WarehouseOutbound.note,
                WarehouseOutbound.reference,
                WarehouseOutbound.status,
                WarehouseOutbound.created_by,
                WarehouseOutbound.posted_by,
                WarehouseOutbound.cancelled_by,
                WarehouseOutbound.created_at,
                WarehouseOutbound.posted_at,
                WarehouseOutbound.cancelled_at,
                WarehouseOutbound.purchase_return_id,
                Warehouse.name.label("warehouse_name"),
                UserCreator.username.label("created_by_name"),
                UserPoster.username.label("posted_by_name"),
                WarehouseOutboundReversal.id.label("reversal_id"),
                WarehouseOutboundReversal.reason.label("reversal_reason"),
                WarehouseOutboundReversal.created_by.label("reversed_by"),
                UserRu.username.label("reversed_by_name"),
                WarehouseOutboundReversal.created_at.label("reversed_at"),
            )
            .select_from(WarehouseOutbound)
            .join(Warehouse, (Warehouse.id == WarehouseOutbound.warehouse_id))
            .join(UserCreator, (UserCreator.id == WarehouseOutbound.created_by))
            .outerjoin(UserPoster, (UserPoster.id == WarehouseOutbound.posted_by))
            .outerjoin(
                WarehouseOutboundReversal, (WarehouseOutboundReversal.outbound_id == WarehouseOutbound.id)
            )
            .outerjoin(UserRu, (UserRu.id == WarehouseOutboundReversal.created_by))
            .where((WarehouseOutbound.id == outbound_id))
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "仓库出库单不存在")
    lines = (
        db.execute(
            select(
                WarehouseOutboundLine.id,
                WarehouseOutboundLine.material_id,
                Material.sku,
                Material.name.label("material_name"),
                Material.unit,
                WarehouseOutboundLine.quantity,
            )
            .select_from(WarehouseOutboundLine)
            .join(Material, (Material.id == WarehouseOutboundLine.material_id))
            .where((WarehouseOutboundLine.outbound_id == outbound_id))
            .order_by(WarehouseOutboundLine.id)
        )
        .mappings()
        .all()
    )
    return {**dict(row), "lines": [dict(line) for line in lines]}


@router.get("/warehouse-outbounds")
def list_outbounds(_: dict = Depends(require("other_outbound.view"))) -> list[dict]:
    with orm_session() as db:
        ids = [
            row
            for row in db.scalars(
                select(WarehouseOutbound.id)
                .select_from(WarehouseOutbound)
                .order_by(WarehouseOutbound.id.desc())
            )
        ]
        return [outbound_data(db, item_id) for item_id in ids]


@router.post("/warehouse-outbounds", status_code=201)
def create_outbound(payload: OutboundInput, user: dict = Depends(require("other_outbound.create"))) -> dict:
    if len({line.material_id for line in payload.lines}) != len(payload.lines):
        raise HTTPException(422, "一张出库单不能重复选择同一物料")
    with orm_session(write=True) as db:
        require_warehouse(db, payload.warehouse_id)
        for line in payload.lines:
            if (
                not db.execute(
                    select(literal(1)).select_from(Material).where((Material.id == line.material_id))
                )
                .mappings()
                .first()
            ):
                raise HTTPException(422, f"物料 #{line.material_id} 不存在")
        outbound_id = add_model(
            db,
            WarehouseOutbound(
                warehouse_id=payload.warehouse_id,
                reason=payload.reason,
                note=payload.note,
                reference=payload.reference.strip(),
                created_by=user["id"],
            ),
        ).id
        db.add_all(
            [
                WarehouseOutboundLine(
                    outbound_id=outbound_id, material_id=line.material_id, quantity=str(line.quantity)
                )
                for line in payload.lines
            ]
        )
        return outbound_data(db, outbound_id)


@router.post("/warehouse-outbounds/{outbound_id}/post")
def post_outbound(outbound_id: int, user: dict = Depends(require("other_outbound.post"))) -> dict:
    with orm_session(write=True) as db:
        # 写锁覆盖各行库存检查与扣减，整单要么确认要么完全不动库存。
        source = (
            db.execute(
                select(
                    WarehouseOutbound.status, WarehouseOutbound.warehouse_id, WarehouseOutbound.source_kind
                )
                .select_from(WarehouseOutbound)
                .where((WarehouseOutbound.id == outbound_id))
            )
            .mappings()
            .first()
        )
        if not source:
            raise HTTPException(404, "仓库出库单不存在")
        if source["source_kind"] == "purchase_return":
            # 采购退货仍用原退货流水及应付来源，仓库出库单只负责确认闸口。
            from app.purchase.returns import post_return_in_transaction

            row = (
                db.execute(
                    select(WarehouseOutbound.purchase_return_id)
                    .select_from(WarehouseOutbound)
                    .where((WarehouseOutbound.id == outbound_id))
                )
                .mappings()
                .first()
            )
            post_return_in_transaction(db, row["purchase_return_id"], user["id"])
            return outbound_data(db, outbound_id)
        if source["status"] != "draft" or source["source_kind"] != "other":
            raise HTTPException(409, "此出库单不能按其他出库确认")
        lines = (
            db.execute(
                select(
                    WarehouseOutboundLine.id,
                    WarehouseOutboundLine.material_id,
                    WarehouseOutboundLine.quantity,
                )
                .select_from(WarehouseOutboundLine)
                .where((WarehouseOutboundLine.outbound_id == outbound_id))
            )
            .mappings()
            .all()
        )
        for line in lines:
            if balance(db, source["warehouse_id"], line["material_id"]) < Decimal(line["quantity"]):
                raise HTTPException(409, f"物料 #{line['material_id']} 在来源仓库库存不足")
        for line in lines:
            add_model(
                db,
                StockMovement(
                    warehouse_id=source["warehouse_id"],
                    material_id=line["material_id"],
                    quantity=str(-Decimal(line["quantity"])),
                    source_type="other_outbound",
                    source_id=outbound_id,
                    source_line_id=line["id"],
                    created_by=user["id"],
                ),
            )
        db.execute(
            update(WarehouseOutbound)
            .where((WarehouseOutbound.id == outbound_id))
            .values(status="posted", posted_by=user["id"], posted_at=func.current_timestamp())
        )
        return outbound_data(db, outbound_id)


@router.post("/warehouse-outbounds/{outbound_id}/cancel")
def cancel_outbound(outbound_id: int, user: dict = Depends(require("other_outbound.cancel"))) -> dict:
    with orm_session(write=True) as db:
        cursor = db.execute(
            update(WarehouseOutbound)
            .where(
                WarehouseOutbound.id == outbound_id,
                WarehouseOutbound.status == "draft",
                WarehouseOutbound.source_kind == "other",
            )
            .values(status="cancelled", cancelled_by=user["id"], cancelled_at=func.current_timestamp())
        )
        if not cursor.rowcount:
            if (
                not db.execute(
                    select(literal(1))
                    .select_from(WarehouseOutbound)
                    .where((WarehouseOutbound.id == outbound_id))
                )
                .mappings()
                .first()
            ):
                raise HTTPException(404, "仓库出库单不存在")
            raise HTTPException(409, "只能取消其他出库草稿")
        return outbound_data(db, outbound_id)


@router.post("/warehouse-outbounds/{outbound_id}/reverse", status_code=201)
def reverse_outbound(
    outbound_id: int, payload: ReverseInput, user: dict = Depends(require("other_outbound.reverse"))
) -> dict:
    with orm_session(write=True) as db:
        source = (
            db.execute(
                select(
                    WarehouseOutbound.status, WarehouseOutbound.warehouse_id, WarehouseOutbound.source_kind
                )
                .select_from(WarehouseOutbound)
                .where((WarehouseOutbound.id == outbound_id))
            )
            .mappings()
            .first()
        )
        if not source:
            raise HTTPException(404, "仓库出库单不存在")
        if (
            source["status"] != "posted"
            or source["source_kind"] != "other"
            or db.execute(
                select(literal(1))
                .select_from(WarehouseOutboundReversal)
                .where((WarehouseOutboundReversal.outbound_id == outbound_id))
            )
            .mappings()
            .first()
        ):
            raise HTTPException(409, "只能冲销尚未冲销的已确认其他出库")
        if db.scalar(select(MaintenanceJob.id).where(MaintenanceJob.parts_outbound_id == outbound_id,
                MaintenanceJob.status == 'accepted')):
            raise HTTPException(409, '耗材已被有效设备维护验收使用，先更正验收再冲销出库')
        reversal_id = add_model(
            db,
            WarehouseOutboundReversal(outbound_id=outbound_id, reason=payload.reason, created_by=user["id"]),
        ).id
        for line in db.execute(
            select(
                WarehouseOutboundLine.id, WarehouseOutboundLine.material_id, WarehouseOutboundLine.quantity
            )
            .select_from(WarehouseOutboundLine)
            .where((WarehouseOutboundLine.outbound_id == outbound_id))
        ).mappings():
            add_model(
                db,
                StockMovement(
                    warehouse_id=source["warehouse_id"],
                    material_id=line["material_id"],
                    quantity=line["quantity"],
                    source_type="other_outbound_reversal",
                    source_id=reversal_id,
                    source_line_id=line["id"],
                    created_by=user["id"],
                ),
            )
        return outbound_data(db, outbound_id)
