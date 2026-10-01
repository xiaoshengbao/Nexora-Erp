"""首次总账启用的跨模块约束；所有调用均处于调用方的 ORM 事务内。"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.models import OpeningBalance, Journal
from app.finance.subledger_rules import check_subledger


def active_opening(db: Session) -> OpeningBalance | None:
    return db.scalar(select(OpeningBalance).where(OpeningBalance.active_key == 1))


def ensure_no_posted_journals(db: Session) -> None:
    if (
        db.scalar(select(Journal.id).where(Journal.status == "posted").limit(1))
        is not None
    ):
        raise HTTPException(409, "已有凭证过账，不能重设期初；请用更正凭证处理")


def check_journal_opening(db: Session, journal_date: str) -> None:
    check_subledger(db, journal_date)
    opening = active_opening(db)
    if (
        opening is None
        and db.scalar(
            select(OpeningBalance.id)
            .where(OpeningBalance.status == "reversed")
            .limit(1)
        )
        is not None
    ):
        raise HTTPException(409, "原期初已撤销，请建立并确认替代期初后再过账")
    if opening is not None:
        if opening.status != "confirmed":
            raise HTTPException(
                409, "期初余额尚未确认，请完成期初审核确认或取消草稿后再过账"
            )
        if journal_date < opening.effective_date:
            raise HTTPException(409, "凭证日期不能早于总账启用日")


def check_period_opening(db: Session, start_date: str) -> None:
    opening = active_opening(db)
    if opening is not None and start_date < opening.effective_date:
        raise HTTPException(409, "期初方案已建立，不能新增启用日前的会计期间")
