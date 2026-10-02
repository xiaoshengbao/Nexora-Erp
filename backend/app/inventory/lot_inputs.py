"""实物批次入库明细共用的数量与来源字段校验。"""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class PhysicalLotPartInput(BaseModel):
    quantity: Decimal
    supplier_lot: str | None = Field(default=None, max_length=100)
    manufactured_on: date | None = None
    expires_on: date | None = None

    @field_validator('quantity')
    @classmethod
    def valid_quantity(cls, value: Decimal) -> Decimal:
        if not value.is_finite() or value <= 0 or value > 1_000_000 or value.as_tuple().exponent < -3:
            raise ValueError('批次数量须大于零、最多三位小数且不超过一百万')
        return value

    @field_validator('supplier_lot')
    @classmethod
    def trim_supplier_lot(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator('expires_on')
    @classmethod
    def valid_expiry(cls, value: date | None, info) -> date | None:
        manufactured = info.data.get('manufactured_on')
        if value is not None and manufactured is not None and value < manufactured:
            raise ValueError('失效日期早于生产日期')
        return value
