"""ORM 迁移后的并发约束和审计失败回滚，不依赖查询写法。"""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.models import User, UserRole, UserProfileChange, MenuIconChange, AuthSession
from app.core.orm import orm_session
from app.access.security import token_hash
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('NEXORA_DB_PATH', str(tmp_path / 'orm-access.db'))
    with TestClient(app, client=('127.0.0.1', 12000), raise_server_exceptions=False) as client:
        yield client


def setup(client):
    response = client.post('/api/v1/setup/admin', json={'username': 'admin', 'password': 'secure-pass-123'})
    assert response.status_code == 201, response.text
    token = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'secure-pass-123'}).json()['token']
    return {'Authorization': f'Bearer {token}'}


def test_concurrent_first_admin_and_last_admin_protection(client):
    payload = {'username': 'admin', 'password': 'secure-pass-123'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _: client.post('/api/v1/setup/admin', json=payload).status_code, range(2)))
    assert sorted(codes) == [201, 409]
    token = client.post('/api/v1/auth/login', json=payload).json()['token']
    admin = {'Authorization': f'Bearer {token}'}
    second = client.post('/api/v1/users', headers=admin, json={
        'username': 'backup', 'password': 'secure-pass-123', 'roles': ['admin']}).json()
    assert client.post('/api/v1/roles', headers=admin, json={
        'code': 'manager', 'label': '账号管理员', 'permissions': ['users.manage']}).status_code == 201
    assert client.post('/api/v1/users', headers=admin, json={
        'username': 'manager', 'password': 'secure-pass-123', 'roles': ['manager']}).status_code == 201
    manager = client.post('/api/v1/auth/login', json={
        'username': 'manager', 'password': 'secure-pass-123'}).json()['token']
    headers = {'Authorization': f'Bearer {manager}'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda uid: client.put(f'/api/v1/users/{uid}/status', headers=headers,
            json={'is_active': False}).status_code, (1, second['id'])))
    assert sorted(codes) == [200, 409]
    with orm_session() as db:
        assert len(list(db.scalars(select(User.id).join(UserRole, UserRole.user_id == User.id)
            .where(User.is_active == 1, UserRole.role_code == 'admin')))) == 1


def test_profile_and_roles_roll_back_if_audit_insert_fails(client):
    headers = setup(client)
    response = client.post('/api/v1/users', headers=headers, json={
        'username': 'worker', 'password': 'secure-pass-123', 'full_name': '原资料', 'roles': ['viewer']})
    assert response.status_code == 201
    uid = response.json()['id']

    def fail_audit(db, *_):
        if any(isinstance(row, UserProfileChange) for row in db.new):
            raise RuntimeError('模拟审计保存失败')

    event.listen(Session, 'before_flush', fail_audit)
    try:
        assert client.put(f'/api/v1/users/{uid}', headers=headers,
            json={'full_name': '不能保留', 'roles': ['buyer']}).status_code == 500
    finally:
        event.remove(Session, 'before_flush', fail_audit)
    with orm_session() as db:
        assert db.get(User, uid).full_name == '原资料'
        assert list(db.scalars(select(UserRole.role_code).where(UserRole.user_id == uid))) == ['viewer']
        assert list(db.scalars(select(UserProfileChange))) == []
    # 异常后写锁须释放，完整重试仍可成功。
    assert client.put(f'/api/v1/users/{uid}', headers=headers,
        json={'full_name': '新资料', 'roles': ['buyer']}).status_code == 200


def test_concurrent_menu_versions_and_supplier_links(client):
    headers = setup(client)
    payload = {'key': 'route:home', 'icon': 'chart', 'version': 0}
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _: client.put('/api/v1/menu-icons', headers=headers, json=payload).status_code, range(2)))
    assert sorted(codes) == [200, 409]
    with orm_session() as db:
        assert len(list(db.scalars(select(MenuIconChange)))) == 1
    supplier = client.post('/api/v1/suppliers', headers=headers, json={'name': '供应商'}).json()['id']
    material = client.post('/api/v1/materials', headers=headers,
        json={'sku': 'RAW', 'name': '原料', 'unit': '件'}).json()['id']
    path = f'/api/v1/suppliers/{supplier}/materials/{material}'
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _: client.put(path, headers=headers).status_code, range(2)))
    assert codes == [204, 204]
    assert client.get('/api/v1/supplier-materials', headers=headers).json() == [
        {'supplier_id': supplier, 'material_id': material}]


def test_session_expiry_and_logout_only_revoke_selected_token(client):
    first = setup(client)
    second_login = client.post('/api/v1/auth/login', json={
        'username': 'admin', 'password': 'secure-pass-123'}).json()
    assert not {'password_hash', 'token_hash', 'expires_at'} & second_login['user'].keys()
    second = {'Authorization': f"Bearer {second_login['token']}"}
    with orm_session() as db:
        stored = list(db.scalars(select(AuthSession.token_hash)))
        assert second_login['token'] not in stored and token_hash(second_login['token']) in stored
    assert client.post('/api/v1/auth/logout', headers=first).status_code == 204
    assert client.get('/api/v1/auth/me', headers=first).status_code == 401
    assert client.get('/api/v1/auth/me', headers=second).status_code == 200
    with orm_session(write=True) as db:
        db.get(AuthSession, token_hash(second_login['token'])).expires_at = 0
    assert client.get('/api/v1/auth/me', headers=second).status_code == 401
