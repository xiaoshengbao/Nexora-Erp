"""系统服务安装配置的边界与失败回滚。"""

import json
import io
import plistlib
import subprocess
import sys

import pytest

from app.service import host_service
from launcher import configure_console_output


def test_windows_console_output_accepts_chinese_diagnostics(monkeypatch):
    output_bytes = io.BytesIO()
    error_bytes = io.BytesIO()
    output = io.TextIOWrapper(output_bytes, encoding="cp1252")
    errors = io.TextIOWrapper(error_bytes, encoding="cp1252")
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service.sys, "stdout", output)
    monkeypatch.setattr(host_service.sys, "stderr", errors)

    configure_console_output()
    output.write("升级完成")
    errors.write("服务错误")
    output.flush()
    errors.flush()

    assert output_bytes.getvalue().decode("utf-8") == "升级完成"
    assert error_bytes.getvalue().decode("utf-8") == "服务错误"


def test_system_command_failure_keeps_service_diagnostic(monkeypatch):
    # Windows 服务控制器的错误文本比退出码更能说明启动失败的原因。
    monkeypatch.setattr(host_service.subprocess, "run", lambda *_args, **_kwargs: subprocess.CompletedProcess(
        args=["sc.exe"], returncode=5, stdout="[SC] StartService FAILED 5: Access is denied.", stderr=""))
    with pytest.raises(RuntimeError, match="Access is denied"):
        host_service._run("sc.exe", "start", host_service.SERVICE_NAME)


def test_service_startup_failure_writes_restricted_host_log(monkeypatch, tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    monkeypatch.setattr(host_service, "system_root", lambda: tmp_path)

    try:
        raise RuntimeError("服务启动失败样例")
    except RuntimeError:
        host_service.record_service_failure()

    # 服务日志固定写为 UTF-8；Windows 默认代码页不能用于读取中文诊断。
    assert "服务启动失败样例" in (logs / "host.err.log").read_text(encoding="utf-8")


def test_windows_service_output_works_without_console(monkeypatch, tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    monkeypatch.setattr(host_service, "system_root", lambda: tmp_path)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    with host_service.service_output():
        # 模拟服务管理器无控制台的环境，验证日志初始化依赖的 isatty 接口可用。
        assert sys.stdout.isatty() is False
        assert sys.stderr.isatty() is False
        print("服务运行日志")
        print("服务错误日志", file=sys.stderr)

    assert "服务运行日志" in (logs / "host.out.log").read_text(encoding="utf-8")
    assert "服务错误日志" in (logs / "host.err.log").read_text(encoding="utf-8")


def test_host_config_rejects_invalid_paths_and_ports(tmp_path):
    value = {"name": "  固定主机  ", "data_dir": str(tmp_path / "erp-data"), "port": 8123}
    parsed = host_service.HostConfig.parse(value)
    assert parsed.name == "固定主机"
    assert parsed.data_dir == tmp_path / "erp-data"
    for invalid in ("relative", str(tmp_path.anchor)):
        with pytest.raises(ValueError):
            host_service.HostConfig.parse({**value, "data_dir": invalid})
    for invalid in (True, 0, 65536, "8000"):
        with pytest.raises(ValueError):
            host_service.HostConfig.parse({**value, "port": invalid})


def test_mac_install_starts_boot_service_without_changing_instance_data(monkeypatch, tmp_path):
    root = tmp_path / "system"
    plist = tmp_path / "launch-daemon.plist"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server").write_text("service-binary")
    data_dir = tmp_path / "existing-instance"
    data_dir.mkdir()
    (data_dir / "nexora.db").write_bytes(b"existing")
    commands = []
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "MAC_PLIST", plist)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "service_running", lambda: True)
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)

    config = host_service.HostConfig("主机", data_dir, 8123)
    host_service.install_service(config, source)
    assert json.loads((root / "host.json").read_text())["data_dir"] == str(data_dir)
    assert (data_dir / "nexora.db").read_bytes() == b"existing"
    settings = plistlib.loads(plist.read_bytes())
    assert settings["RunAtLoad"] is True
    assert settings["KeepAlive"] is True
    assert settings["ProgramArguments"][:2] == [str(root / "service" / "nexora-server"), "serve-config"]
    assert commands == [("launchctl", "bootstrap", "system", str(plist))]


def test_mac_install_unloads_job_when_registered_service_exits(monkeypatch, tmp_path):
    root = tmp_path / "system"
    plist = tmp_path / "launch-daemon.plist"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server").write_text("service-binary")
    commands = []
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "MAC_PLIST", plist)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "_wait_mac_unloaded", lambda: None)
    monkeypatch.setattr(host_service, "service_running", lambda: False)
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)

    # 注册成功但程序随即退出时，不应留下会在下次开机反复重启的损坏作业。
    with pytest.raises(RuntimeError, match="macOS 服务启动后退出"):
        host_service.install_service(host_service.HostConfig("主机", tmp_path / "data", 8123), source)
    assert commands == [("launchctl", "bootstrap", "system", str(plist)),
                        ("launchctl", "bootout", f"system/{host_service.MAC_LABEL}")]
    assert not (root / "host.json").exists()
    assert not (root / "service").exists()
    assert not plist.exists()


def test_mac_startup_check_waits_for_stable_running_process(monkeypatch):
    states = iter((False, True, False, True, True))
    monkeypatch.setattr(host_service, "service_running", lambda: next(states))
    delays = []
    monkeypatch.setattr(host_service.time, "sleep", delays.append)

    # 启动过程可短暂未运行；只接受连续两次运行，避免把崩溃重启当成成功。
    host_service._wait_mac_running()
    assert delays == [0.25, 1, 0.25, 1]


def test_mac_bootout_waits_until_job_is_unregistered(monkeypatch):
    calls = []
    results = iter((0, 0, 113))
    monkeypatch.setattr(host_service, "_run", lambda *args: calls.append(args))
    monkeypatch.setattr(host_service.subprocess, "run", lambda *args, **_kwargs:
                        subprocess.CompletedProcess(args, next(results), "", ""))
    monkeypatch.setattr(host_service.time, "sleep", lambda seconds: calls.append(("sleep", seconds)))

    # launchctl 已接受卸载请求不代表同名作业已消失，重启前需观察到注销。
    host_service._bootout_mac()
    assert calls == [("launchctl", "bootout", f"system/{host_service.MAC_LABEL}"),
                     ("sleep", 0.25), ("sleep", 0.25)]


def test_mac_bootout_timeout_does_not_claim_service_stopped(monkeypatch):
    monkeypatch.setattr(host_service, "_run", lambda *_args: None)
    monkeypatch.setattr(host_service.subprocess, "run", lambda *args, **_kwargs:
                        subprocess.CompletedProcess(args, 0, "state = running", ""))
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)

    with pytest.raises(TimeoutError, match="卸载超时"):
        host_service._bootout_mac()


def test_windows_install_grants_system_access_to_selected_instance(monkeypatch, tmp_path):
    root = tmp_path / "system"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server.exe").write_text("service-binary")
    data_dir = tmp_path / "private-instance"
    commands = []
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "service_running", lambda: True)
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)

    host_service.install_service(host_service.HostConfig("主机", data_dir, 8123), source)

    # SCM 启动前必须能访问数据库和证书；用户原有 ACL 不应被整体替换。
    assert data_dir.is_dir()
    program_acl = [command for command in commands if command[:2] == ("icacls.exe", str(root))]
    assert program_acl[0][2] == "/grant:r"
    assert program_acl[1] == ("icacls.exe", str(root), "/inheritance:r")
    assert not any("/T" in command for command in program_acl)
    assert ("icacls.exe", str(data_dir), "/grant", "*S-1-5-18:(OI)(CI)F", "/T") in commands
    # 故障恢复须在首次启动前配置，CI 才能验证进程异常退出后的自动重启。
    recovery = ("sc.exe", "failure", host_service.SERVICE_NAME, "reset=", "86400",
                "actions=", "restart/60000/restart/60000/restart/60000")
    assert recovery in commands
    assert commands.index(recovery) < commands.index(("sc.exe", "start", host_service.SERVICE_NAME))
    assert commands[-2] == ("sc.exe", "start", host_service.SERVICE_NAME)
    assert commands[-1] == ("sc.exe", "config", host_service.SERVICE_NAME, "start=", "auto")


def test_windows_install_rolls_back_if_recovery_policy_cannot_be_configured(monkeypatch, tmp_path):
    root = tmp_path / "system"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server.exe").write_text("service-binary")
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)

    def control(*args):
        if args[:2] == ("sc.exe", "failure"):
            raise RuntimeError("故障恢复策略无法设置")

    monkeypatch.setattr(host_service, "_run", control)
    monkeypatch.setattr(host_service.subprocess, "run", lambda *args, **_kwargs:
                        subprocess.CompletedProcess(args, 0, "", ""))

    # 策略缺失时拒绝留下看似安装完成、崩溃后却不会恢复的服务。
    with pytest.raises(RuntimeError, match="故障恢复策略无法设置"):
        host_service.install_service(host_service.HostConfig("主机", tmp_path / "data", 8123), source)
    assert not (root / "host.json").exists()
    assert not (root / "service").exists()


def test_windows_install_rolls_back_when_service_exits_immediately(monkeypatch, tmp_path):
    root = tmp_path / "system"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server.exe").write_text("service-binary")
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *_args: None)
    monkeypatch.setattr(host_service, "service_running", lambda: False)
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(host_service.subprocess, "run", lambda *args, **_kwargs: subprocess.CompletedProcess(
        args=args, returncode=0, stdout="diagnostic", stderr=""))

    with pytest.raises(RuntimeError, match="启动后退出"):
        host_service.install_service(host_service.HostConfig("主机", tmp_path / "instance", 8123), source)

    assert not (root / "host.json").exists()
    assert not (root / "service").exists()


def test_failed_mac_registration_removes_partial_install(monkeypatch, tmp_path):
    root = tmp_path / "system"
    plist = tmp_path / "launch-daemon.plist"
    source = tmp_path / "packaged"
    source.mkdir()
    (source / "nexora-server").write_text("service-binary")
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "MAC_PLIST", plist)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)

    def fail(*_):
        raise RuntimeError("launchctl failed")

    monkeypatch.setattr(host_service, "_run", fail)
    with pytest.raises(RuntimeError, match="launchctl failed"):
        host_service.install_service(host_service.HostConfig("主机", tmp_path / "data", 8123), source)
    assert not (root / "host.json").exists()
    assert not (root / "service").exists()
    assert not plist.exists()


def test_upgrade_backs_up_and_replaces_service_without_touching_instance(monkeypatch, tmp_path):
    root = tmp_path / "system"
    current = root / "service"
    current.mkdir(parents=True)
    (current / "nexora-server").write_text("old")
    source = tmp_path / "release"
    source.mkdir()
    (source / "nexora-server").write_text("new")
    data = tmp_path / "instance"
    data.mkdir()
    (data / "nexora.db").write_text("unchanged")
    (root / "host.json").write_text(json.dumps({"name": "主机", "data_dir": str(data), "port": 8123}))
    commands = []
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "service_running", lambda: True)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "_wait_mac_unloaded", lambda: None)
    monkeypatch.setattr(host_service, "create_backup", lambda _data, output: output.write_text("backup"))
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)
    backup = host_service.upgrade_service(source)
    assert backup.read_text() == "backup"
    assert (current / "nexora-server").read_text() == "new"
    assert (data / "nexora.db").read_text() == "unchanged"
    assert commands[0] == ("launchctl", "bootout", f"system/{host_service.MAC_LABEL}")
    assert commands[-1][0:2] == ("launchctl", "bootstrap")


def test_mac_upgrade_unloads_failed_new_job_and_restores_old_program(monkeypatch, tmp_path):
    root = tmp_path / "system"
    current = root / "service"
    current.mkdir(parents=True)
    (current / "nexora-server").write_text("old")
    source = tmp_path / "release"
    source.mkdir()
    (source / "nexora-server").write_text("new")
    data = tmp_path / "instance"
    data.mkdir()
    (root / "host.json").write_text(json.dumps({
        "name": "主机", "data_dir": str(data), "port": 8123}))
    commands = []
    running = {"value": True}
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "service_running", lambda: running["value"])
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(host_service, "create_backup", lambda _data, output: output.write_text("backup"))

    def control(*args):
        commands.append(args)
        if args[1] == "bootout":
            running["value"] = False
        elif args[1] == "bootstrap":
            running["value"] = (current / "nexora-server").read_text() == "old"

    monkeypatch.setattr(host_service, "_run", control)
    monkeypatch.setattr(host_service, "_wait_mac_unloaded", lambda: None)
    with pytest.raises(RuntimeError, match="macOS 服务启动后退出"):
        host_service.upgrade_service(source)
    assert (current / "nexora-server").read_text() == "old"
    assert running["value"] is True
    assert [item[1] for item in commands] == ["bootout", "bootstrap", "bootout", "bootstrap"]
    assert len(list((root / "backups").glob("upgrade-*.nexora-backup"))) == 1


def test_windows_upgrade_limits_backup_directory_to_system_and_admin(monkeypatch, tmp_path):
    root = tmp_path / "system"
    current = root / "service"
    current.mkdir(parents=True)
    (current / "nexora-server.exe").write_text("old")
    source = tmp_path / "release"
    source.mkdir()
    (source / "nexora-server.exe").write_text("new")
    data = tmp_path / "instance"
    data.mkdir()
    (root / "host.json").write_text(json.dumps({"name": "主机", "data_dir": str(data), "port": 8123}))
    commands = []
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "service_running", lambda: False)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "create_backup", lambda _data, output: output.write_text("backup"))

    backup = host_service.upgrade_service(source)

    assert backup.read_text() == "backup"
    assert (current / "nexora-server.exe").read_text() == "new"
    backup_acl = [command for command in commands if command[:2] == ("icacls.exe", str(root / "backups"))]
    assert backup_acl[0][2] == "/grant:r"
    assert backup_acl[1] == ("icacls.exe", str(root / "backups"), "/inheritance:r")


def test_windows_upgrade_restores_old_program_when_new_service_exits(monkeypatch, tmp_path):
    root = tmp_path / "system"
    current = root / "service"
    current.mkdir(parents=True)
    (current / "nexora-server.exe").write_text("old")
    source = tmp_path / "release"
    source.mkdir()
    (source / "nexora-server.exe").write_text("new")
    data = tmp_path / "instance"
    data.mkdir()
    (root / "host.json").write_text(json.dumps({"name": "主机", "data_dir": str(data), "port": 8123}))
    commands = []
    states = iter((True, False, False))
    monkeypatch.setattr(host_service.sys, "platform", "win32")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "service_running", lambda: next(states))
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "_run", lambda *args: commands.append(args))
    monkeypatch.setattr(host_service, "_wait_stopped", lambda: None)
    monkeypatch.setattr(host_service.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(host_service, "create_backup", lambda _data, output: output.write_text("backup"))

    # 新版进程已退出时，旧版程序和启动命令都必须恢复。
    with pytest.raises(RuntimeError, match="已恢复旧版程序"):
        host_service.upgrade_service(source)
    assert (current / "nexora-server.exe").read_text() == "old"
    assert commands.count(("sc.exe", "start", host_service.SERVICE_NAME)) == 2


def test_upgrade_restores_old_program_when_restart_fails(monkeypatch, tmp_path):
    root = tmp_path / "system"
    current = root / "service"
    current.mkdir(parents=True)
    (current / "nexora-server").write_text("old")
    source = tmp_path / "release"
    source.mkdir()
    (source / "nexora-server").write_text("new")
    data = tmp_path / "instance"
    data.mkdir()
    (root / "host.json").write_text(json.dumps({"name": "主机", "data_dir": str(data), "port": 8123}))
    calls = []
    monkeypatch.setattr(host_service.sys, "platform", "darwin")
    monkeypatch.setattr(host_service, "system_root", lambda: root)
    monkeypatch.setattr(host_service, "service_running", lambda: False)
    monkeypatch.setattr(host_service, "_require_admin", lambda: None)
    monkeypatch.setattr(host_service, "create_backup", lambda _data, output: output.write_text("backup"))

    def fail_once(*args):
        calls.append(args)
        if len(calls) == 2:
            raise RuntimeError("new service failed")

    monkeypatch.setattr(host_service, "_run", fail_once)
    monkeypatch.setattr(host_service, "_wait_mac_unloaded", lambda: None)
    # 测试只让首个 bootstrap 失败；先模拟运行状态以进入启动路径。
    states = iter((True, False))
    monkeypatch.setattr(host_service, "service_running", lambda: next(states))
    with pytest.raises(RuntimeError, match="new service failed"):
        host_service.upgrade_service(source)
    assert (current / "nexora-server").read_text() == "old"


@pytest.mark.parametrize('winerror', [5, 32, 33])
@pytest.mark.parametrize('persistent', [False, True])
def test_windows_upgrade_waits_for_directory_release_without_losing_old_program(monkeypatch, tmp_path, winerror, persistent):
    root = tmp_path / 'system'
    current = root / 'service'
    current.mkdir(parents=True)
    (current / 'nexora-server.exe').write_text('old')
    source = tmp_path / 'release'
    source.mkdir()
    (source / 'nexora-server.exe').write_text('new')
    data = tmp_path / 'instance'
    data.mkdir()
    (data / 'nexora.db').write_text('unchanged')
    (root / 'host.json').write_text(json.dumps({'name': '主机', 'data_dir': str(data), 'port': 8123}))
    commands, waits = [], []
    running = {'value': True}
    clock = {'now': 0.0, 'attempts': 0}
    monkeypatch.setattr(host_service.sys, 'platform', 'win32')
    monkeypatch.setattr(host_service, 'system_root', lambda: root)
    monkeypatch.setattr(host_service, '_require_admin', lambda: None)
    monkeypatch.setattr(host_service, '_wait_stopped', lambda: None)
    monkeypatch.setattr(host_service, 'service_running', lambda: running['value'])
    monkeypatch.setattr(host_service, 'create_backup', lambda _data, output: output.write_text('backup'))
    monkeypatch.setattr(host_service.time, 'monotonic', lambda: clock['now'])

    def run(*args):
        commands.append(args)
        if args[:2] == ('sc.exe', 'stop'):
            running['value'] = False
        elif args[:2] == ('sc.exe', 'start'):
            running['value'] = True

    def sleep(seconds):
        waits.append(seconds)
        clock['now'] += seconds

    original_replace = host_service.os.replace
    error = PermissionError('模拟停止后服务目录仍被占用')
    error.winerror = winerror

    def replace(old, new):
        if old == current:
            clock['attempts'] += 1
            # SCM 已停止且升级备份存在，目录释放前不能丢失旧程序或替换数据库。
            assert not running['value']
            assert (current / 'nexora-server.exe').read_text() == 'old'
            assert len(list((root / 'backups').glob('upgrade-*.nexora-backup'))) == 1
            if persistent or clock['attempts'] <= 2:
                raise error
        return original_replace(old, new)

    monkeypatch.setattr(host_service, '_run', run)
    monkeypatch.setattr(host_service.time, 'sleep', sleep)
    monkeypatch.setattr(host_service.os, 'replace', replace)
    if persistent:
        with pytest.raises(PermissionError) as caught:
            host_service.upgrade_service(source)
        assert caught.value is error
        assert clock['now'] == pytest.approx(10)
        assert (current / 'nexora-server.exe').read_text() == 'old'
    else:
        assert host_service.upgrade_service(source).read_text() == 'backup'
        assert waits[:2] == [0.1, 0.1]
        assert clock['attempts'] == 3
        assert (current / 'nexora-server.exe').read_text() == 'new'
    assert running['value']
    assert commands.count(('sc.exe', 'start', host_service.SERVICE_NAME)) == 1
    assert (data / 'nexora.db').read_text() == 'unchanged'
    assert (source / 'nexora-server.exe').read_text() == 'new'
    assert not list(root.glob('nexora-upgrade-*'))


@pytest.mark.parametrize('platform,winerror', [('darwin', 5), ('win32', 2)])
def test_service_directory_replace_does_not_retry_unrelated_errors(monkeypatch, tmp_path, platform, winerror):
    error = PermissionError('其他平台或错误不得隐藏')
    error.winerror = winerror
    attempts = []

    def fail(source, target):
        attempts.append((source, target))
        raise error

    monkeypatch.setattr(host_service.sys, 'platform', platform)
    monkeypatch.setattr(host_service.os, 'replace', fail)
    monkeypatch.setattr(host_service.time, 'sleep', lambda _: pytest.fail('不应等待'))
    with pytest.raises(PermissionError) as caught:
        host_service._replace_service_directory(tmp_path / 'old', tmp_path / 'new')
    assert caught.value is error
    assert len(attempts) == 1
