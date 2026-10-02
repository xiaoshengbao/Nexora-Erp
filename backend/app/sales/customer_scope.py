"""客户归属的服务端访问边界；业务查询均由 ORM 构造。"""

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.models import Customer, SalesOrder, Shipment, SalesReturn, AfterSalesCase, ShipmentLine


def can_view_all_customers(user: dict) -> bool:
    permissions = user['permissions']
    return any(code in permissions for code in ('customer.view_all', 'customer.assign', 'crm_quote.review'))


def visible_customers(query: Select, user: dict) -> Select:
    if can_view_all_customers(user):
        return query
    return query.where(Customer.owner_id == user['id'])


def require_visible_customer(db: Session, customer_id: int, user: dict) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None or (not can_view_all_customers(user) and customer.owner_id != user['id']):
        raise HTTPException(404, '客户不存在')
    return customer


def require_visible_record(db: Session, record, user: dict):
    require_visible_customer(db, record.customer_id, user)
    return record


def visible_customer_ids(user: dict) -> Select:
    return visible_customers(select(Customer.id), user)


def require_visible_order(db: Session, order_id: int, user: dict) -> SalesOrder:
    order = db.get(SalesOrder, order_id)
    if order is None:
        raise HTTPException(404, '销售订单不存在')
    require_visible_customer(db, order.customer_id, user)
    return order


def require_visible_shipment(db: Session, shipment_id: int, user: dict) -> Shipment:
    shipment = db.get(Shipment, shipment_id)
    if shipment is None:
        raise HTTPException(404, '出库单不存在')
    require_visible_order(db, shipment.sales_order_id, user)
    return shipment


def require_visible_shipment_line(db: Session, line_id: int, user: dict) -> ShipmentLine:
    line = db.get(ShipmentLine, line_id)
    if line is None:
        raise HTTPException(404, '出库明细不存在')
    require_visible_shipment(db, line.shipment_id, user)
    return line


def require_visible_return(db: Session, return_id: int, user: dict) -> SalesReturn:
    sales_return = db.get(SalesReturn, return_id)
    if sales_return is None:
        raise HTTPException(404, '销售退货单不存在')
    require_visible_shipment(db, sales_return.shipment_id, user)
    return sales_return


def require_visible_after_sales(db: Session, case: AfterSalesCase, user: dict) -> AfterSalesCase:
    shipment_id = db.scalar(select(ShipmentLine.shipment_id).where(ShipmentLine.id == case.shipment_line_id))
    if shipment_id is None:
        raise HTTPException(404, '售后单不存在')
    require_visible_shipment(db, shipment_id, user)
    return case
