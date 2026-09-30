"""目录迁移后，功能路由和固定命令入口仍须可用。"""

import os
import subprocess
import sys

from fastapi.routing import APIRoute

from app.access.routes import router as access_router
from app.catalog.routes import router as catalog_router
from app.finance.routes import router as finance_router
from app.finance.ledger import router as finance_ledger_router
from app.finance.journals import router as journals_router
from app.finance.ledger_reports import router as ledger_reports_router
from app.finance.opening_balances import router as opening_balances_router
from app.finance.period_closing import router as period_closing_router
from app.inventory.stock import router as stock_router
from app.inventory.stocktake import router as stocktake_router
from app.inventory.warehouse import router as warehouse_router
from app.main import app
from app.production.boms import router as boms_router
from app.production.completions import router as completions_router
from app.production.costs import router as costs_router
from app.production.material_issues import router as issues_router
from app.production.material_returns import router as material_returns_router
from app.production.work_orders import router as work_orders_router
from app.purchase.orders import router as purchase_orders_router
from app.purchase.receipts import router as receipts_router
from app.purchase.returns import router as purchase_returns_router
from app.sales.orders import router as sales_orders_router
from app.sales.returns import router as sales_returns_router
from app.service.routes import router as service_router


def test_every_feature_router_is_registered() -> None:
    schema_paths = app.openapi()["paths"]
    routers = (
        service_router, access_router, catalog_router, warehouse_router,
        stock_router, stocktake_router, purchase_orders_router, receipts_router,
        purchase_returns_router, sales_orders_router, sales_returns_router,
        boms_router, work_orders_router, issues_router, material_returns_router,
        completions_router, costs_router, finance_router, finance_ledger_router, journals_router, ledger_reports_router, opening_balances_router, period_closing_router,
    )
    for router in routers:
        routes = [route for route in router.routes if isinstance(route, APIRoute)]
        assert routes, f"功能路由为空：{router!r}"
        for route in routes:
            # 拆文件后漏装配路由会使客户端收到 404；逐项核对公开接口仍存在。
            assert route.path in schema_paths
            for method in route.methods:
                assert method.lower() in schema_paths[route.path]


def test_existing_command_modules_still_start() -> None:
    for module in ("app.server", "app.backup"):
        # Windows CI 默认代码页可能无法打印中文帮助文案；这里只核对模块入口能否正常导入。
        result = subprocess.run(
            [sys.executable, "-m", module, "--help"],
            capture_output=True, text=True, encoding="utf-8", check=False,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        # 桌面端和运维脚本仍调用这两个旧模块路径，导入失败会阻断启动。
        assert result.returncode == 0, f"{module}: {result.stderr}"
        assert "usage:" in result.stdout
