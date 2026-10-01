"""分录辅助信息的边界核验与快照；不依赖路由，避免凭证循环导入。"""

import json
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import (AuxiliaryAssignment, AuxiliaryItem, AuxiliaryPolicy,
    Customer, Supplier, JournalLine, OpeningBalanceLine)
from app.core.orm import model_data

Kind = Literal['customer', 'supplier', 'department', 'project']
LABELS = {'customer': '客户', 'supplier': '供应商', 'department': '部门', 'project': '项目'}


class AuxiliaryReference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Kind
    id: int = Field(gt=0, strict=True)


def combination(values: list) -> tuple:
    return tuple(sorted((value.kind, value.id) if isinstance(value, AuxiliaryReference)
        else (value['kind'], value['id']) for value in values))


def policy_data(record: AuxiliaryPolicy | None, account_id: int) -> dict:
    if record is None:
        return dict(account_id=account_id, start_date='', required_kinds=[], version=0)
    return dict(account_id=record.account_id, start_date=record.start_date,
        required_kinds=json.loads(record.required_kinds_json), version=record.version,
        changed_by=record.changed_by, created_at=record.created_at)


def resolve(db: Session, reference: AuxiliaryReference, *, active: bool = True) -> dict:
    if reference.kind in ('customer', 'supplier'):
        record = db.get(Customer if reference.kind == 'customer' else Supplier, reference.id)
        if record is None:
            raise HTTPException(409, f'{LABELS[reference.kind]}档案不存在')
        code = f'{reference.kind}:{record.id}'
    else:
        record = db.get(AuxiliaryItem, reference.id)
        if record is None or record.kind != reference.kind or (active and not record.is_active):
            raise HTTPException(409, f'{LABELS[reference.kind]}档案不存在、类型不符或已停用')
        code = record.code
    return dict(kind=reference.kind, id=record.id, code=code, name=record.name)


def validate_references(db: Session, account_id: int, date: str, references: list[AuxiliaryReference]) -> list[dict]:
    if len({item.kind for item in references}) != len(references):
        raise HTTPException(409, '同一分录每类辅助信息最多选择一个')
    policy = db.scalar(select(AuxiliaryPolicy).where(AuxiliaryPolicy.account_id == account_id))
    if policy and date >= policy.start_date:
        missing = set(json.loads(policy.required_kinds_json)) - {item.kind for item in references}
        if missing:
            raise HTTPException(409, '科目须填写辅助信息：' + '、'.join(LABELS[kind] for kind in sorted(missing)))
    return [resolve(db, item) for item in sorted(references, key=lambda item: item.kind)]


def assignments(db: Session, line: JournalLine | OpeningBalanceLine) -> list[AuxiliaryAssignment]:
    column = AuxiliaryAssignment.journal_line_id if isinstance(line, JournalLine) else AuxiliaryAssignment.opening_line_id
    return list(db.scalars(select(AuxiliaryAssignment).where(column == line.id).order_by(AuxiliaryAssignment.kind)))


def snapshot_values(db: Session, line: JournalLine | OpeningBalanceLine) -> list[dict]:
    return [dict(kind=item.kind, id=item.customer_id or item.supplier_id or item.item_id,
        code=item.code_snapshot, name=item.name_snapshot) for item in assignments(db, line)]


def line_data(db: Session, line: JournalLine | OpeningBalanceLine) -> dict:
    return {**model_data(line), 'auxiliary': snapshot_values(db, line)}


def save_snapshots(db: Session, line: JournalLine | OpeningBalanceLine, values: list[dict]) -> None:
    db.flush()
    owner = dict(journal_line_id=line.id) if isinstance(line, JournalLine) else dict(opening_line_id=line.id)
    for value in values:
        field = 'customer_id' if value['kind'] == 'customer' else 'supplier_id' if value['kind'] == 'supplier' else 'item_id'
        db.add(AuxiliaryAssignment(**owner, kind=value['kind'], **{field: value['id']},
            code_snapshot=value['code'], name_snapshot=value['name']))
    db.flush()


def validate_line(db: Session, line: JournalLine | OpeningBalanceLine, date: str) -> None:
    records = assignments(db, line)
    references = [AuxiliaryReference(kind=item.kind, id=item.customer_id or item.supplier_id or item.item_id)
        for item in records]
    current = {item['kind']: item for item in validate_references(db, line.account_id, date, references)}
    for record in records:
        record.code_snapshot, record.name_snapshot = current[record.kind]['code'], current[record.kind]['name']


def selection_options(db: Session, *, include_inactive: bool = False) -> dict:
    items = [dict(kind=kind, id=item.id, code=f'{kind}:{item.id}', name=item.name, is_active=True)
        for kind, model in (('customer', Customer), ('supplier', Supplier))
        for item in db.scalars(select(model).order_by(model.id))]
    statement = select(AuxiliaryItem).order_by(AuxiliaryItem.kind, AuxiliaryItem.code)
    if not include_inactive:
        statement = statement.where(AuxiliaryItem.is_active == 1)
    items.extend({**model_data(item), 'is_active': bool(item.is_active)} for item in db.scalars(statement))
    return dict(auxiliary_items=items,
        auxiliary_policies=[policy_data(item, item.account_id) for item in db.scalars(select(AuxiliaryPolicy).order_by(AuxiliaryPolicy.account_id))])
