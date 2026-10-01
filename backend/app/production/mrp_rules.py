"""物料计划来源保护；不依赖路由，复用外层写事务。"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.models import MrpConversion


def protect_request(db: Session, request_id: int) -> None:
    if db.scalar(select(MrpConversion.id).where(MrpConversion.purchase_request_id == request_id)) is not None:
        raise HTTPException(409, 'MRP 转入的采购申请明细已固定，请取消该申请并重算物料计划后更正')
