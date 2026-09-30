"""旧库夹具只回退待验证版本之后的结构，不让新版表混入旧库。"""

import pytest


@pytest.fixture
def remove_closing_schema():
    def remove(db):
        db.execute('DROP TABLE IF EXISTS period_closings')
        for operation in ('closing_view', 'close', 'reopen'):
            code = 'accounting_period.' + operation
            db.execute('DELETE FROM role_permissions WHERE permission_code=?', (code,))
            db.execute('DELETE FROM permissions WHERE code=?', (code,))
    return remove


@pytest.fixture
def remove_journal_schema(remove_closing_schema):
    def remove(db):
        remove_closing_schema(db)
        for table in ('opening_balance_changes','opening_balance_lines','opening_balances'):
            db.execute(f'DROP TABLE IF EXISTS {table}')
        for operation in ('view','create','submit','review','confirm','cancel','reverse'):
            code='opening_balance.'+operation
            db.execute('DELETE FROM role_permissions WHERE permission_code=?',(code,))
            db.execute('DELETE FROM permissions WHERE code=?',(code,))
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='permission_groups'").fetchone():
            db.execute("DELETE FROM permission_groups WHERE code='finance.opening_balances'")
        for table in ('journal_changes', 'journal_lines', 'journals'):
            db.execute(f'DROP TABLE IF EXISTS {table}')
        for operation in ('view','create','submit','review','post','cancel','reverse'):
            code = 'journal.' + operation
            db.execute('DELETE FROM role_permissions WHERE permission_code = ?', (code,))
            db.execute('DELETE FROM permissions WHERE code = ?', (code,))
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='permission_groups'").fetchone():
            db.execute("DELETE FROM permission_groups WHERE code = 'finance.journals'")
    return remove


@pytest.fixture
def remove_v39_schema(remove_journal_schema):
    def remove(db):
        remove_journal_schema(db)
        for table in ('ledger_account_changes', 'accounting_period_changes',
                      'ledger_accounts', 'accounting_periods'):
            db.execute(f'DROP TABLE IF EXISTS {table}')
        for code in ('ledger_account.view', 'ledger_account.manage',
                     'accounting_period.view', 'accounting_period.manage'):
            db.execute('DELETE FROM role_permissions WHERE permission_code = ?', (code,))
            db.execute('DELETE FROM permissions WHERE code = ?', (code,))
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='permission_groups'").fetchone():
            db.execute("DELETE FROM permission_groups WHERE code IN ('finance.ledger_accounts','finance.accounting_periods')")
        for table in ('production_settlement_charges', 'production_settlement_dependencies',
                      'production_settlement_sources', 'production_cost_allocations',
                      'production_settlement_reversals', 'production_cost_settlements'):
            db.execute(f'DROP TABLE IF EXISTS {table}')
        for code in ('production_cost.settle', 'production_cost.reopen'):
            db.execute('DELETE FROM role_permissions WHERE permission_code = ?', (code,))
            db.execute('DELETE FROM permissions WHERE code = ?', (code,))
    return remove
