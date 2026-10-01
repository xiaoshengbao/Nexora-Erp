"""阻止业务代码绕过模型；底层例外按操作约束，不能扩大为文件级豁免。"""

import ast
from pathlib import Path

import pytest


RAW_EXPRESSIONS = {'sqlalchemy.text', 'sqlalchemy.sql.text', 'sqlalchemy.sql.expression.text',
                   'sqlalchemy.literal_column', 'sqlalchemy.sql.literal_column',
                   'sqlalchemy.sql.expression.literal_column'}
RAW_DRIVERS = {'sqlite3', 'pymysql', 'psycopg', 'psycopg2', 'mysql', 'MySQLdb'}


def orm_violations(source: str, relative: str) -> list[str]:
    # 历史结构及初始化数据迁移是独立例外，不能从业务模块调用旧连接。
    if relative == 'core/database.py':
        return []
    tree = ast.parse(source)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    imports: dict[str, str] = {}
    assignments: dict[str, list[ast.expr]] = {}
    violations: list[str] = []

    def report(node: ast.AST, reason: str) -> None:
        violations.append(f'{relative}:{node.lineno}: {reason}')

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for name in node.names:
                imports[name.asname or name.name.split('.')[0]] = name.name if name.asname else name.name.split('.')[0]
                driver = name.name.split('.')[0]
                if driver in RAW_DRIVERS and not (relative == 'service/backup.py' and driver == 'sqlite3'):
                    report(node, '业务模块不得导入数据库底层驱动')
        elif isinstance(node, ast.ImportFrom):
            for name in node.names:
                qualified = f'{node.module}.{name.name}'
                imports[name.asname or name.name] = qualified
                driver = (node.module or '').split('.')[0]
                if driver in RAW_DRIVERS and not (relative == 'service/backup.py' and driver == 'sqlite3'):
                    report(node, '业务模块不得导入数据库底层驱动')
                if qualified == 'app.core.database.connection':
                    report(node, '不得导入旧业务 SQL 连接')
                if qualified in RAW_EXPRESSIONS and relative != 'core/models.py':
                    report(node, '业务模块不得导入 SQL 文本构造器')
                if name.name == '*' and node.module and node.module.startswith(('sqlalchemy', 'app.core.database')):
                    report(node, '星号导入隐藏数据访问边界')
        elif isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    assignments.setdefault(target.id, []).append(node.value)

    def qualified(node: ast.expr, seen: frozenset[str] = frozenset()) -> str:
        if isinstance(node, ast.Name):
            if node.id in imports:
                return imports[node.id]
            if node.id not in seen and len(assignments.get(node.id, [])) == 1:
                return qualified(assignments[node.id][0], seen | {node.id})
            return node.id
        if isinstance(node, ast.Attribute):
            return f'{qualified(node.value, seen)}.{node.attr}'
        return ''

    def raw_argument(node: ast.expr, seen: frozenset[str] = frozenset()) -> bool:
        if isinstance(node, (ast.Constant, ast.JoinedStr)):
            return True
        if isinstance(node, ast.Name) and node.id not in seen:
            return any(raw_argument(value, seen | {node.id}) for value in assignments.get(node.id, []))
        if isinstance(node, ast.BinOp):
            return raw_argument(node.left, seen) or raw_argument(node.right, seen)
        if isinstance(node, ast.Call):
            if qualified(node.func) in RAW_EXPRESSIONS:
                return True
            if isinstance(node.func, ast.Attribute) and node.func.attr in ('format', 'join'):
                return raw_argument(node.func.value, seen)
        return False

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = qualified(node.func)
        operation = name.rsplit('.', 1)[-1]
        if name in RAW_EXPRESSIONS:
            parent = parents.get(node)
            # 模型声明的服务端默认值保留 SQLAlchemy 文本表达式，不允许查询借用此例外。
            allowed = (relative == 'core/models.py' and name.endswith('.text')
                       and isinstance(parent, ast.keyword) and parent.arg == 'server_default'
                       and isinstance(parents.get(parent), ast.Call)
                       and qualified(parents[parent].func) == 'sqlalchemy.orm.mapped_column')
            if not allowed:
                report(node, '业务查询不得使用 SQL 文本表达式')
        if name in ('app.core.database.connection', 'sqlalchemy.create_engine',
                    'sqlalchemy.engine.create_engine', 'sqlalchemy.engine.create.create_engine'):
            if relative not in ('core/orm.py', 'service/backup.py'):
                report(node, '业务模块须使用统一 ORM 会话')
        statement = node.args[0] if node.args else next(
            (keyword.value for keyword in node.keywords if keyword.arg == 'statement'), None)
        if operation in ('execute', 'scalar', 'scalars') and statement is not None and raw_argument(statement):
            allowed = (relative == 'core/orm.py' and operation == 'execute'
                       and len(node.args) == 1 and not node.keywords
                       and isinstance(statement, ast.Constant)
                       and statement.value in ('PRAGMA foreign_keys = ON', 'PRAGMA busy_timeout = 10000'))
            if not allowed:
                report(node, '执行接口不得接收 SQL 字符串或变量')
        if operation in ('executemany', 'executescript', 'from_statement', 'cursor'):
            report(node, '业务模块不得使用底层 SQL 执行入口')
        if operation == 'exec_driver_sql':
            diagnostic = (relative == 'service/backup.py' and len(node.args) == 1
                          and isinstance(node.args[0], ast.Constant)
                          and node.args[0].value == 'PRAGMA integrity_check' and not node.keywords)
            transaction = (relative == 'core/orm.py' and len(node.args) == 1
                           and isinstance(node.args[0], ast.IfExp)
                           and isinstance(node.args[0].body, ast.Constant)
                           and node.args[0].body.value == 'BEGIN IMMEDIATE'
                           and isinstance(node.args[0].orelse, ast.Constant)
                           and node.args[0].orelse.value == 'BEGIN' and not node.keywords)
            if not (diagnostic or transaction):
                report(node, '底层 SQL 仅允许固定事务配置或备份完整性诊断')
    return violations


def test_migrated_modules_do_not_reintroduce_sql_connections():
    root = Path(__file__).resolve().parents[1] / 'app'
    violations = [message for path in sorted(root.rglob('*.py'))
                  for message in orm_violations(path.read_text('utf-8'), path.relative_to(root).as_posix())]
    assert not violations, '\n'.join(violations)


@pytest.mark.parametrize('source', [
    'db.execute("SELECT * FROM materials")',
    'sql = "DELETE FROM materials"; db.execute(sql)',
    'sql: str = "DELETE FROM materials"; query = sql; db.execute(query)',
    'db.execute(f"SELECT * FROM {table}")',
    'sql = "SELECT * FROM " + table; db.execute(sql)',
    'sql = "SELECT * FROM {}".format(table); db.execute(sql)',
    'from sqlalchemy import text as query; db.execute(query("SELECT 1"))',
    'import sqlalchemy as sa; query = sa.text; db.execute(query("SELECT 1"))',
    'from sqlalchemy.sql.expression import literal_column as column; db.scalar(column("1"))',
    'execute = db.execute; execute("SELECT 1")',
    'sql = "SELECT 1"; db.scalars(statement=sql)',
    'sql = "SELECT 1"; db.scalar(sql)',
    'sql = "SELECT 1"; db.execute(statement=sql)',
    'from app.core.database import connection as database; database()',
    'import app.core.database as database; database.connection()',
    'from sqlalchemy import create_engine as engine; engine("sqlite://")',
    'from sqlalchemy.engine import create_engine as engine; engine("sqlite://")',
    'import sqlite3 as driver; driver.connect("nexora.db")',
    'from sqlite3 import connect as open_database; open_database("nexora.db")',
    'db.executescript(script)',
    'db.executemany(statement, values)',
    'db.query(Material).from_statement(statement)',
    'db.cursor()',
    'from sqlalchemy import *',
])
def test_guard_rejects_business_sql_regressions(source):
    assert orm_violations(source, 'catalog/future_module.py')


@pytest.mark.parametrize('source', [
    'from sqlalchemy import select; db.execute(select(Material).where(Material.name == "SQL"))',
    'from sqlalchemy import select; statement = select(Material); db.scalars(statement)',
    'from sqlalchemy import delete; db.execute(delete(Material).where(Material.id == identifier))',
    'from app.core.orm import orm_session; orm_session(write=True)',
])
def test_guard_accepts_model_queries_and_orm_writes(source):
    assert not orm_violations(source, 'catalog/future_module.py')


def test_model_defaults_are_not_a_query_exception():
    declarations = 'from sqlalchemy import text\nfrom sqlalchemy.orm import mapped_column\n'
    assert not orm_violations(declarations + 'created_at = mapped_column(server_default=text("CURRENT_TIMESTAMP"))',
                              'core/models.py')
    assert orm_violations(declarations + 'db.execute(text("SELECT 1"))', 'core/models.py')


def test_backup_exception_cannot_be_used_for_business_queries():
    assert not orm_violations('import sqlite3', 'service/backup.py')
    assert not orm_violations('session.connection().exec_driver_sql("PRAGMA integrity_check")', 'service/backup.py')
    for source in ('session.connection().exec_driver_sql("SELECT * FROM server_identity")',
                   'statement = "SELECT * FROM server_identity"; db.execute(statement)',
                   'from sqlalchemy import text; db.scalar(text("SELECT 1"))',
                   'import pymysql', 'from psycopg import connect'):
        assert orm_violations(source, 'service/backup.py')


def test_transaction_exception_cannot_be_used_for_business_queries():
    assert not orm_violations('db.execute("PRAGMA foreign_keys = ON")', 'core/orm.py')
    assert orm_violations('db.execute("SELECT * FROM materials")', 'core/orm.py')
    assert orm_violations('db.exec_driver_sql("SELECT * FROM materials")', 'core/orm.py')
