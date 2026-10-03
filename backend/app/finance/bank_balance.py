"""银行对账单与已过账总账的余额调节、分组勾对及独立复核。"""

from datetime import date
from decimal import Decimal
import hashlib
import json
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access.security import require
from app.core.models import (BankAccount, BankAccountChange, BankBalanceReport,
    BankBalanceReportDecision, BankLedgerMatchGroup, BankLedgerMatchMember,
    BankLedgerMatchReversal, BankStatementLine, Journal, JournalLine, LedgerAccount, User)
from app.core.orm import add_model, model_data, orm_session
from app.finance.ledger_reports import confirmed_opening_lines
from app.finance.opening_rules import active_opening

router = APIRouter(prefix='/api/v1/finance/bank-balance')
ZERO = Decimal('0.00')


def amount_text(value: object) -> object:
    if not isinstance(value, str) or not re.fullmatch(r'-?(?:0|[1-9]\d*)(?:\.\d{1,2})?', value):
        raise ValueError('金额须使用最多两位小数的十进制文本')
    return value


def amount(value: Decimal) -> Decimal:
    if not value.is_finite() or abs(value) > 1_000_000_000_000 or value.as_tuple().exponent < -2:
        raise ValueError('金额不能超过一万亿元且最多两位小数')
    return value


def money(value: Decimal) -> str:
    return f'{value:.2f}'


def clean_reason(value: str) -> str:
    result = value.strip()
    if not result or any(ord(character) < 32 for character in result):
        raise ValueError('依据无效')
    return result


def valid_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError('日期无效') from None
    if parsed.isoformat() != value:
        raise ValueError('日期须为 YYYY-MM-DD')
    return value


class BindingInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ledger_account_id: int = Field(strict=True, gt=0)
    opening_balance: Decimal
    effective_date: str
    version: int = Field(strict=True, gt=0)
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('opening_balance', mode='before')
    @classmethod
    def valid_amount_text(cls, value: object) -> object:
        return amount_text(value)

    @field_validator('opening_balance')
    @classmethod
    def valid_amount(cls, value: Decimal) -> Decimal:
        return amount(value)

    @field_validator('effective_date')
    @classmethod
    def valid_effective_date(cls, value: str) -> str:
        return valid_date(value)

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value: str) -> str:
        return clean_reason(value)


class MatchInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_id: int = Field(strict=True, gt=0)
    bank_line_ids: list[int] = Field(min_length=1, max_length=20)
    journal_line_ids: list[int] = Field(min_length=1, max_length=20)
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('bank_line_ids', 'journal_line_ids')
    @classmethod
    def valid_ids(cls, values: list[int]) -> list[int]:
        if any(type(value) is not int or value <= 0 for value in values) or len(values) != len(set(values)):
            raise ValueError('勾对明细编号无效或重复')
        return values

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value: str) -> str:
        return clean_reason(value)


class BalanceInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_id: int = Field(strict=True, gt=0)
    as_of_date: str
    declared_bank_closing: Decimal

    @field_validator('as_of_date')
    @classmethod
    def valid_as_of_date(cls, value: str) -> str:
        return valid_date(value)

    @field_validator('declared_bank_closing', mode='before')
    @classmethod
    def valid_amount_text(cls, value: object) -> object:
        return amount_text(value)

    @field_validator('declared_bank_closing')
    @classmethod
    def valid_amount(cls, value: Decimal) -> Decimal:
        return amount(value)


class ReportInput(BalanceInput):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value: str) -> str:
        return clean_reason(value)


class DecisionInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['approve', 'reject']
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value: str) -> str:
        return clean_reason(value)


class ReasonInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(min_length=1, max_length=200)

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value: str) -> str:
        return clean_reason(value)


def bound_account(db: Session, account_id: int) -> tuple[BankAccount, LedgerAccount]:
    account = db.get(BankAccount, account_id)
    if account is None:
        raise HTTPException(404, '银行账户不存在')
    if account.ledger_account_id is None or account.opening_balance is None or account.effective_date is None:
        raise HTTPException(409, '银行账户尚未绑定总账科目与银行期初余额')
    ledger = db.get(LedgerAccount, account.ledger_account_id)
    if ledger is None:
        raise HTTPException(409, '绑定的总账科目不存在')
    opening = active_opening(db)
    if opening is None or opening.status != 'confirmed' or opening.effective_date != account.effective_date:
        raise HTTPException(409, '银行账户启用日须与已确认总账期初一致')
    return account, ledger


def active_groups(db: Session, account_id: int) -> list[tuple[BankLedgerMatchGroup, list[BankLedgerMatchMember]]]:
    reversed_ids = set(db.scalars(select(BankLedgerMatchReversal.group_id)))
    groups = list(db.scalars(select(BankLedgerMatchGroup).where(
        BankLedgerMatchGroup.account_id == account_id).order_by(BankLedgerMatchGroup.id)))
    members = list(db.scalars(select(BankLedgerMatchMember).where(
        BankLedgerMatchMember.group_id.in_([item.id for item in groups])))) if groups else []
    by_group: dict[int, list[BankLedgerMatchMember]] = {}
    for item in members:
        by_group.setdefault(item.group_id, []).append(item)
    return [(group, by_group.get(group.id, [])) for group in groups if group.id not in reversed_ids]


def balance_data(db: Session, data: BalanceInput) -> dict:
    account, ledger = bound_account(db, data.account_id)
    if data.as_of_date < account.effective_date:
        raise HTTPException(422, '调节日期不能早于银行账户启用日')
    bank_lines = list(db.scalars(select(BankStatementLine).where(
        BankStatementLine.account_id == account.id,
        BankStatementLine.occurred_on >= account.effective_date,
        BankStatementLine.occurred_on <= data.as_of_date).order_by(
        BankStatementLine.occurred_on, BankStatementLine.id)))
    book_rows = list(db.execute(select(JournalLine, Journal).join(
        Journal, Journal.id == JournalLine.journal_id).where(
        JournalLine.account_id == ledger.id, Journal.status == 'posted',
        Journal.journal_date >= account.effective_date,
        Journal.journal_date <= data.as_of_date).order_by(Journal.journal_date, Journal.id, JournalLine.position)))
    opening = sum((Decimal(item.debit) - Decimal(item.credit)
        for item in confirmed_opening_lines(db) if item.account_id == ledger.id), ZERO)
    bank_net = sum((Decimal(item.amount) for item in bank_lines), ZERO)
    book_net = sum((Decimal(line.debit) - Decimal(line.credit) for line, _ in book_rows), ZERO)
    bank_ids = {item.id for item in bank_lines}
    book_ids = {line.id for line, _ in book_rows}
    matched_bank: set[int] = set()
    matched_book: set[int] = set()
    matched_evidence = []
    for group, members in active_groups(db, account.id):
        bank_members = {item.source_id for item in members if item.side == 'bank'}
        book_members = {item.source_id for item in members if item.side == 'book'}
        if bank_members and book_members and bank_members <= bank_ids and book_members <= book_ids:
            matched_bank.update(bank_members)
            matched_book.update(book_members)
            matched_evidence.append(dict(group_id=group.id, bank_line_ids=sorted(bank_members),
                journal_line_ids=sorted(book_members)))
    bank_unmatched = [dict(id=item.id, occurred_on=item.occurred_on, amount=item.amount,
        transaction_id=item.transaction_id, counterparty=item.counterparty)
        for item in bank_lines if item.id not in matched_bank]
    book_unmatched = [dict(id=line.id, journal_id=journal.id, journal_date=journal.journal_date,
        amount=money(Decimal(line.debit) - Decimal(line.credit)), reference=journal.reference,
        summary=line.summary) for line, journal in book_rows if line.id not in matched_book]
    bank_closing = Decimal(account.opening_balance) + bank_net
    book_closing = opening + book_net
    adjusted_bank = data.declared_bank_closing + sum(
        (Decimal(item['amount']) for item in book_unmatched), ZERO)
    adjusted_book = book_closing + sum((Decimal(item['amount']) for item in bank_unmatched), ZERO)
    evidence = dict(account_id=account.id, account_version=account.version,
        ledger_account_id=ledger.id, opening_balance=account.opening_balance,
        effective_date=account.effective_date, as_of_date=data.as_of_date,
        formal_opening_id=active_opening(db).id,
        declared_bank_closing=money(data.declared_bank_closing),
        bank_lines=[(item.id, item.occurred_on, item.amount) for item in bank_lines],
        book_lines=[(line.id, journal.id, journal.journal_date, line.debit, line.credit)
            for line, journal in book_rows], matches=matched_evidence,
        ledger_opening=money(opening))
    fingerprint = hashlib.sha256(json.dumps(evidence, sort_keys=True,
        separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    return dict(account_id=account.id, account_code=account.code,
        ledger_account_id=ledger.id, ledger_code=ledger.code,
        effective_date=account.effective_date, as_of_date=data.as_of_date,
        bank_opening=account.opening_balance, bank_movements=money(bank_net),
        bank_closing_computed=money(bank_closing),
        bank_closing_declared=money(data.declared_bank_closing),
        book_opening=money(opening), book_movements=money(book_net),
        book_closing=money(book_closing), bank_unmatched=bank_unmatched,
        book_unmatched=book_unmatched, adjusted_bank=money(adjusted_bank),
        adjusted_book=money(adjusted_book), bank_statement_balanced=bank_closing == data.declared_bank_closing,
        balanced=bank_closing == data.declared_bank_closing and adjusted_bank == adjusted_book,
        fingerprint=fingerprint, matched_evidence=matched_evidence)


def report_status(decisions: list[BankBalanceReportDecision]) -> str:
    if any(item.action == 'supersede' for item in decisions):
        return 'superseded'
    if any(item.action == 'approve' for item in decisions):
        return 'approved'
    if any(item.action == 'reject' for item in decisions):
        return 'rejected'
    return 'draft'


def report_stale(db: Session, report: BankBalanceReport) -> bool:
    try:
        current = balance_data(db, BalanceInput(account_id=report.account_id,
            as_of_date=report.as_of_date, declared_bank_closing=report.declared_bank_closing))
        return current['fingerprint'] != report.fingerprint
    except HTTPException:
        return True


@router.get('/overview')
def overview(user: dict = Depends(require('bank_reconciliation.view'))) -> dict:
    with orm_session() as db:
        users = dict(db.execute(select(User.id, User.username)).all())
        accounts = [model_data(item) for item in db.scalars(select(BankAccount).order_by(BankAccount.code))]
        ledger_accounts = [dict(id=item.id, code=item.code, name=item.name)
            for item in db.scalars(select(LedgerAccount).where(
                LedgerAccount.category == 'asset', LedgerAccount.normal_balance == 'debit',
                LedgerAccount.is_active == 1).order_by(LedgerAccount.code))] \
            if 'bank_reconciliation.account' in user['permissions'] else []
        opening = active_opening(db)
        changes = [dict(**model_data(item), changed_by_name=users.get(item.changed_by))
            for item in db.scalars(select(BankAccountChange).order_by(BankAccountChange.id.desc()))]
        groups = list(db.scalars(select(BankLedgerMatchGroup).order_by(BankLedgerMatchGroup.id.desc())))
        members = list(db.scalars(select(BankLedgerMatchMember)))
        by_group: dict[int, list[dict]] = {}
        for member in members:
            by_group.setdefault(member.group_id, []).append(model_data(member))
        reversals = {item.group_id: item for item in db.scalars(select(BankLedgerMatchReversal))}
        matches = [dict(**model_data(item), members=by_group.get(item.id, []),
            created_by_name=users.get(item.created_by),
            reversal=model_data(reversals[item.id]) if item.id in reversals else None) for item in groups]
        reports = list(db.scalars(select(BankBalanceReport).order_by(BankBalanceReport.id.desc())))
        decisions: dict[int, list[BankBalanceReportDecision]] = {}
        for item in db.scalars(select(BankBalanceReportDecision).order_by(BankBalanceReportDecision.id)):
            decisions.setdefault(item.report_id, []).append(item)
        report_rows = [dict(**model_data(item), snapshot=json.loads(item.snapshot_json),
            status=report_status(decisions.get(item.id, [])),
            stale=report_stale(db, item),
            decisions=[dict(**model_data(decision), created_by_name=users.get(decision.created_by))
                for decision in decisions.get(item.id, [])],
            created_by_name=users.get(item.created_by)) for item in reports]
        return dict(accounts=accounts, ledger_accounts=ledger_accounts,
            opening_effective_date=opening.effective_date if opening is not None and opening.status == 'confirmed' else None,
            account_changes=changes, matches=matches, reports=report_rows)


@router.post('/accounts/{account_id}/binding')
def bind_account(data: BindingInput, account_id: int = Path(gt=0),
                 user: dict = Depends(require('bank_reconciliation.account'))) -> dict:
    try:
        with orm_session(write=True) as db:
            account = db.get(BankAccount, account_id)
            if account is None:
                raise HTTPException(404, '银行账户不存在')
            if account.version != data.version:
                raise HTTPException(409, '银行账户绑定已变化，请刷新后重试')
            ledger = db.get(LedgerAccount, data.ledger_account_id)
            if ledger is None or not ledger.is_active or ledger.category != 'asset' or ledger.normal_balance != 'debit':
                raise HTTPException(422, '须选择启用的资产类借方总账科目')
            opening = active_opening(db)
            if opening is None or opening.status != 'confirmed' or opening.effective_date != data.effective_date:
                raise HTTPException(409, '须先确认总账期初，银行启用日必须与总账期初一致')
            ledger_opening = sum((Decimal(item.debit) - Decimal(item.credit)
                for item in confirmed_opening_lines(db) if item.account_id == ledger.id), ZERO)
            if data.opening_balance != ledger_opening:
                raise HTTPException(409, '银行期初须与该科目已确认的总账期初相符')
            if db.scalar(select(BankStatementLine.id).where(
                BankStatementLine.account_id == account.id,
                BankStatementLine.occurred_on < data.effective_date).limit(1)) is not None:
                raise HTTPException(409, '已有早于启用日的银行流水，不能绑定')
            if account.ledger_account_id is not None and (db.scalar(select(BankLedgerMatchGroup.id).where(
                BankLedgerMatchGroup.account_id == account.id).limit(1)) is not None or
                db.scalar(select(BankBalanceReport.id).where(
                    BankBalanceReport.account_id == account.id).limit(1)) is not None):
                raise HTTPException(409, '已有勾对或调节表，绑定不可再修改')
            before = model_data(account)
            if (account.ledger_account_id, account.opening_balance, account.effective_date) == (
                ledger.id, money(data.opening_balance), data.effective_date):
                raise HTTPException(409, '银行账户绑定没有变化')
            account.ledger_account_id = ledger.id
            account.opening_balance = money(data.opening_balance)
            account.effective_date = data.effective_date
            account.version += 1
            db.flush()
            add_model(db, BankAccountChange(account_id=account.id,
                before_json=json.dumps(before, ensure_ascii=False),
                after_json=json.dumps(model_data(account), ensure_ascii=False),
                reason=data.reason, changed_by=user['id']))
            return model_data(account)
    except IntegrityError:
        raise HTTPException(409, '总账科目已绑定其他银行账户') from None


@router.post('/preview')
def preview(data: BalanceInput, _: dict = Depends(require('bank_reconciliation.view'))) -> dict:
    with orm_session() as db:
        return balance_data(db, data)


@router.post('/ledger-matches', status_code=201)
def match_ledger(data: MatchInput, user: dict = Depends(require('bank_reconciliation.match'))) -> dict:
    with orm_session(write=True) as db:
        account, ledger = bound_account(db, data.account_id)
        bank_lines = [db.get(BankStatementLine, identifier) for identifier in data.bank_line_ids]
        book_lines = [db.get(JournalLine, identifier) for identifier in data.journal_line_ids]
        if any(item is None or item.account_id != account.id or item.occurred_on < account.effective_date
               for item in bank_lines):
            raise HTTPException(422, '银行流水不属于此账户或早于启用日')
        if any(item is None or item.account_id != ledger.id for item in book_lines):
            raise HTTPException(422, '总账分录不属于绑定科目')
        journals = [db.get(Journal, item.journal_id) for item in book_lines]
        if any(item is None or item.status != 'posted' or item.journal_date < account.effective_date
               for item in journals):
            raise HTTPException(409, '只能勾对启用日之后已过账的分录')
        bank_amounts = [Decimal(item.amount) for item in bank_lines]
        book_amounts = [Decimal(item.debit) - Decimal(item.credit) for item in book_lines]
        values = bank_amounts + book_amounts
        if any(value == ZERO for value in values) or len({value > ZERO for value in values}) != 1 \
                or sum(bank_amounts, ZERO) != sum(book_amounts, ZERO):
            raise HTTPException(409, '两侧须同收支方向且合计金额一致')
        used = {(member.side, member.source_id) for _, members in active_groups(db, account.id)
            for member in members}
        if any(('bank', item.id) in used for item in bank_lines) or any(
            ('book', item.id) in used for item in book_lines):
            raise HTTPException(409, '流水或总账分录已有有效勾对')
        group = add_model(db, BankLedgerMatchGroup(account_id=account.id,
            amount=money(sum(bank_amounts, ZERO)), reason=data.reason, created_by=user['id']))
        for side, records, amounts in (('bank', bank_lines, bank_amounts), ('book', book_lines, book_amounts)):
            for record, value in zip(records, amounts):
                db.add(BankLedgerMatchMember(group_id=group.id, side=side,
                    source_id=record.id, bank_line_id=record.id if side == 'bank' else None,
                    journal_line_id=record.id if side == 'book' else None, amount=money(value)))
        db.flush()
        return dict(**model_data(group), bank_line_ids=data.bank_line_ids,
            journal_line_ids=data.journal_line_ids)


@router.post('/ledger-matches/{group_id}/reverse', status_code=201)
def reverse_ledger_match(data: ReasonInput, group_id: int = Path(gt=0),
                         user: dict = Depends(require('bank_reconciliation.reverse'))) -> dict:
    try:
        with orm_session(write=True) as db:
            if db.get(BankLedgerMatchGroup, group_id) is None:
                raise HTTPException(404, '总账勾对不存在')
            if db.scalar(select(BankLedgerMatchReversal.id).where(
                BankLedgerMatchReversal.group_id == group_id)) is not None:
                raise HTTPException(409, '总账勾对已撤销')
            item = add_model(db, BankLedgerMatchReversal(group_id=group_id,
                reason=data.reason, created_by=user['id']))
            return model_data(item)
    except IntegrityError:
        raise HTTPException(409, '总账勾对已撤销') from None


@router.post('/reports', status_code=201)
def create_report(data: ReportInput, user: dict = Depends(require('bank_reconciliation.reconcile'))) -> dict:
    with orm_session(write=True) as db:
        snapshot = balance_data(db, data)
        record = add_model(db, BankBalanceReport(account_id=data.account_id,
            as_of_date=data.as_of_date, declared_bank_closing=money(data.declared_bank_closing),
            fingerprint=snapshot['fingerprint'], snapshot_json=json.dumps(snapshot, ensure_ascii=False),
            reason=data.reason, created_by=user['id']))
        return dict(**model_data(record), snapshot=snapshot, status='draft')


@router.post('/reports/{report_id}/decision', status_code=201)
def decide_report(data: DecisionInput, report_id: int = Path(gt=0),
                  user: dict = Depends(require('bank_reconciliation.review'))) -> dict:
    try:
        with orm_session(write=True) as db:
            report = db.get(BankBalanceReport, report_id)
            if report is None:
                raise HTTPException(404, '银行余额调节表不存在')
            if report.created_by == user['id']:
                raise HTTPException(403, '编制人不能复核自己的调节表')
            current = list(db.scalars(select(BankBalanceReportDecision).where(
                BankBalanceReportDecision.report_id == report.id)))
            if report_status(current) != 'draft':
                raise HTTPException(409, '调节表已完成复核')
            if data.action == 'approve':
                snapshot = balance_data(db, BalanceInput(account_id=report.account_id,
                    as_of_date=report.as_of_date, declared_bank_closing=report.declared_bank_closing))
                if snapshot['fingerprint'] != report.fingerprint:
                    raise HTTPException(409, '调节来源已变化，请重新编制')
                if not snapshot['balanced']:
                    raise HTTPException(409, '银行流水合计或调整后两侧余额不相符')
                older = list(db.scalars(select(BankBalanceReport).where(
                    BankBalanceReport.account_id == report.account_id,
                    BankBalanceReport.as_of_date == report.as_of_date,
                    BankBalanceReport.id != report.id)))
                for item in older:
                    decisions = list(db.scalars(select(BankBalanceReportDecision).where(
                        BankBalanceReportDecision.report_id == item.id)))
                    if report_status(decisions) == 'approved':
                        if item.id > report.id:
                            raise HTTPException(409, '已有更新的已复核调节表')
                        if item.fingerprint == report.fingerprint:
                            raise HTTPException(409, '同一来源的调节表已复核')
                        db.add(BankBalanceReportDecision(report_id=item.id, action='supersede',
                            reason=f'由调节表 #{report.id} 取代：{data.reason}', created_by=user['id']))
            decision = add_model(db, BankBalanceReportDecision(report_id=report.id,
                action=data.action, reason=data.reason, created_by=user['id']))
            return model_data(decision)
    except IntegrityError:
        raise HTTPException(409, '调节表已完成复核') from None
