"""固定主机的系统服务配置与本机管理命令。"""

import argparse
import ctypes
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path

from app.service.backup import create_backup
from app.service.discovery import lan_addresses
from app.server import create_server


SERVICE_NAME = "NexoraERPHost"
MAC_LABEL = "com.nexora.erp.host"
MAC_PLIST = Path("/Library/LaunchDaemons") / f"{MAC_LABEL}.plist"


@dataclass(frozen=True)
class HostConfig:
    name: str
    data_dir: Path
    port: int

    @classmethod
    def parse(cls, value: object) -> "HostConfig":
        if not isinstance(value, dict):
            raise ValueError("主机配置格式无效")
        name = value.get("name")
        raw_dir = value.get("data_dir")
        port = value.get("port")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError("实例名称须为 1 到 80 个字符")
        if not isinstance(raw_dir, str) or not Path(raw_dir).is_absolute():
            raise ValueError("数据目录必须是绝对路径")
        data_dir = Path(raw_dir).resolve()
        if data_dir == Path(data_dir.anchor):
            raise ValueError("不能把磁盘根目录用作数据目录")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("服务端口须在 1 到 65535 之间")
        return cls(name.strip(), data_dir, port)

    def as_dict(self) -> dict:
        return {"name": self.name, "data_dir": str(self.data_dir), "port": self.port}


def system_root() -> Path:
    if sys.platform == "win32":
        return Path(os.environ["PROGRAMDATA"]) / "Nexora ERP"
    if sys.platform == "darwin":
        return Path("/Library/Application Support/Nexora ERP")
    raise RuntimeError("系统服务目前仅支持 Windows 和 macOS")


def config_path(root: Path | None = None) -> Path:
    return (root or system_root()) / "host.json"


def read_config(path: Path | None = None) -> HostConfig:
    return HostConfig.parse(json.loads((path or config_path()).read_text(encoding="utf-8")))


def service_binary(root: Path | None = None) -> Path:
    return (root or system_root()) / "service" / ("nexora-server.exe" if sys.platform == "win32" else "nexora-server")


def mac_plist(binary: Path, config: Path, log_dir: Path) -> bytes:
    """系统级 LaunchDaemon 不依赖用户登录或 Electron 窗口。"""
    return plistlib.dumps({
        "Label": MAC_LABEL,
        "ProgramArguments": [str(binary), "serve-config", "--config", str(config)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardOutPath": str(log_dir / "host.out.log"),
        "StandardErrorPath": str(log_dir / "host.err.log"),
    })


def _require_admin() -> None:
    if sys.platform == "win32":
        if not ctypes.windll.shell32.IsUserAnAdmin():
            raise PermissionError("安装或控制系统服务需要管理员权限")
    elif os.geteuid() != 0:
        raise PermissionError("安装或控制系统服务需要管理员权限")


def _run(*args: str) -> None:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        # 系统管理命令的退出码往往不足以定位权限或服务启动问题，保留其原始诊断。
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"系统服务命令失败（{args[0]}，退出码 {result.returncode}）：{detail}")


def record_service_failure() -> None:
    """把无控制台服务的当前异常写入受限的系统日志。"""
    try:
        log_path = system_root() / "logs" / "host.err.log"
        with log_path.open("a", encoding="utf-8") as log:
            traceback.print_exc(file=log)
    except OSError:
        # 日志写入不能掩盖原始启动错误，SCM 仍会记录进程退出。
        pass


@contextmanager
def service_output():
    """为没有控制台的 Windows 服务提供持久日志流。"""
    logs = system_root() / "logs"
    # Uvicorn 初始化日志时会查询标准错误输出；SCM 进程中的该流可能为 None。
    # 两个文件继承安装时限定的日志目录权限，并在服务退出时一同关闭。
    with (logs / "host.out.log").open("a", encoding="utf-8", buffering=1) as stdout_log:
        with (logs / "host.err.log").open("a", encoding="utf-8", buffering=1) as stderr_log:
            with redirect_stdout(stdout_log), redirect_stderr(stderr_log):
                yield


def _wait_stopped() -> None:
    if sys.platform != "win32":
        return
    import win32service
    import win32serviceutil
    for _ in range(100):
        if win32serviceutil.QueryServiceStatus(SERVICE_NAME)[1] == win32service.SERVICE_STOPPED:
            return
        time.sleep(0.1)
    raise TimeoutError("等待 Windows 服务停止超时")


def _wait_mac_running() -> None:
    # launchctl bootstrap 只表示作业已注册；短暂核验进程仍在运行，避免误报安装或升级成功。
    for _ in range(40):
        if service_running():
            time.sleep(1)
            if service_running():
                return
        time.sleep(0.25)
    raise RuntimeError("macOS 服务启动后退出，请检查 host.err.log")


def _wait_mac_unloaded() -> None:
    """确认 launchd 已移除作业，再替换程序或重新注册同名作业。"""
    for _ in range(40):
        result = subprocess.run(["launchctl", "print", f"system/{MAC_LABEL}"],
                                capture_output=True, text=True)
        if result.returncode != 0:
            return
        time.sleep(0.25)
    raise TimeoutError("等待 macOS 服务卸载超时")


def _bootout_mac() -> None:
    # bootout 返回时同名作业可能仍在卸载；等待完成以免下一次 bootstrap 冲突。
    _run("launchctl", "bootout", f"system/{MAC_LABEL}")
    _wait_mac_unloaded()


def _write_config(config: HostConfig, path: Path) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix="host-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.chmod(temporary, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(config.as_dict(), target, ensure_ascii=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def install_service(config: HostConfig, source_dir: Path) -> None:
    """安装独立服务程序；原实例数据目录只被引用，不复制或覆盖。"""
    _require_admin()
    root = system_root()
    if config_path(root).exists():
        raise FileExistsError("本机已有系统服务配置，请使用升级流程")
    source_dir = source_dir.resolve()
    if not (source_dir / service_binary(root).name).is_file():
        raise ValueError("找不到打包后的服务程序")
    root.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        os.chmod(root, 0o755)
    target = root / "service"
    if target.exists():
        raise FileExistsError("服务程序目录已存在，请检查上次安装状态")
    if sys.platform == "win32":
        # 先给系统目录显式授权，再只关闭根目录的继承；随后创建的文件会继承这些授权。
        # 对文件递归执行 /inheritance:r 会清空其 DACL，使 SCM 无法读取服务程序。
        _run("icacls.exe", str(root), "/grant:r",
             "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F",
             "*S-1-5-32-545:(OI)(CI)R")
        _run("icacls.exe", str(root), "/inheritance:r")
    logs = root / "logs"
    logs.mkdir(exist_ok=True)
    if sys.platform == "darwin":
        os.chmod(logs, 0o700)
    elif sys.platform == "win32":
        # 运行日志仅系统账户和管理员可读，避免把请求与错误记录开放给其他本机用户。
        _run("icacls.exe", str(logs), "/grant:r",
             "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
        _run("icacls.exe", str(logs), "/inheritance:r")
    with tempfile.TemporaryDirectory(prefix="nexora-install-", dir=root) as temporary:
        staged = Path(temporary) / "service"
        shutil.copytree(source_dir, staged)
        os.replace(staged, target)
    mac_bootstrapped = False
    try:
        _write_config(config, config_path(root))
        if sys.platform == "darwin":
            descriptor, plist_name = tempfile.mkstemp(prefix="nexora-host-", dir=MAC_PLIST.parent)
            with os.fdopen(descriptor, "wb") as target_plist:
                target_plist.write(mac_plist(service_binary(root), config_path(root), logs))
            os.chmod(plist_name, 0o644)
            os.replace(plist_name, MAC_PLIST)
            _run("launchctl", "bootstrap", "system", str(MAC_PLIST))
            mac_bootstrapped = True
            _wait_mac_running()
        elif sys.platform == "win32":
            binary = service_binary(root)
            # 服务以 LocalSystem 运行；用户选择的目录可能位于个人资料或 CI 临时目录。
            # 只补授 SYSTEM 对该实例目录及现有文件的权限，保留用户原有 ACL。
            config.data_dir.mkdir(parents=True, exist_ok=True)
            _run("icacls.exe", str(config.data_dir), "/grant",
                 "*S-1-5-18:(OI)(CI)F", "/T")
            _run("sc.exe", "create", SERVICE_NAME, "binPath=", f'"{binary}" service',
                 "start=", "demand", "DisplayName=", "Nexora ERP Host")
            _run("sc.exe", "description", SERVICE_NAME, "Nexora ERP 局域网服务端")
            _run("sc.exe", "failure", SERVICE_NAME, "reset=", "86400",
                 "actions=", "restart/60000/restart/60000/restart/60000")
            _run("sc.exe", "start", SERVICE_NAME)
            # SCM 接受启动请求后服务仍可能立刻退出，短暂观察再启用开机自启。
            time.sleep(1)
            if not service_running():
                raise RuntimeError("Windows 服务启动后退出，请检查 host.err.log")
            # 只有首次启动通过后才设为开机自启，避免失败的程序反复开机重试。
            _run("sc.exe", "config", SERVICE_NAME, "start=", "auto")
    except Exception:
        if sys.platform == "darwin" and mac_bootstrapped:
            # 已注册但立即退出的作业需先从 launchd 卸载，才能安全移除程序与配置。
            _bootout_mac()
        if sys.platform == "win32":
            # 清理注册信息前保留 SCM 配置与退出码，便于定位启动权限和路径错误。
            for diagnostic in (("sc.exe", "qc", SERVICE_NAME),
                               ("sc.exe", "queryex", SERVICE_NAME),
                               ("sc.exe", "sdshow", SERVICE_NAME),
                               ("icacls.exe", str(service_binary(root)))):
                result = subprocess.run(diagnostic, capture_output=True, text=True)
                print(f"{diagnostic[0]} {diagnostic[1]}: {result.stdout!r} {result.stderr!r}",
                      file=sys.stderr)
        # 安装失败不得留下看似可用、下次启动却无法工作的配置。
        if sys.platform == "win32":
            subprocess.run(["sc.exe", "delete", SERVICE_NAME], capture_output=True)
        config_path(root).unlink(missing_ok=True)
        if sys.platform == "darwin":
            MAC_PLIST.unlink(missing_ok=True)
        shutil.rmtree(target, ignore_errors=True)
        raise


def _replace_service_directory(source: Path, target: Path) -> None:
    # SCM 已报告停止时，退出中的进程或扫描程序仍可能短暂持有服务目录。
    # 只等待 Windows 的占用/访问错误；不删除目录、不改 ACL，持续失败仍交回回退流程。
    deadline = time.monotonic() + 10
    while True:
        try:
            os.replace(source, target)
            return
        except PermissionError as error:
            if (sys.platform != "win32" or getattr(error, "winerror", None) not in (5, 32, 33)
                    or time.monotonic() >= deadline):
                raise
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))


def upgrade_service(source_dir: Path) -> Path:
    """先保全实例，再替换独立服务程序；失败时恢复上一份程序。"""
    _require_admin()
    root = system_root()
    config = read_config()
    source_dir = source_dir.resolve()
    binary_name = service_binary(root).name
    if not (source_dir / binary_name).is_file():
        raise ValueError("找不到打包后的服务程序")
    target = root / "service"
    if not (target / binary_name).is_file():
        raise FileNotFoundError("已安装服务程序缺失")
    was_running = service_running()
    with tempfile.TemporaryDirectory(prefix="nexora-upgrade-", dir=root) as temporary:
        staged = Path(temporary) / "service"
        old = Path(temporary) / "previous-service"
        shutil.copytree(source_dir, staged)
        if was_running:
            if sys.platform == "darwin":
                _bootout_mac()
            else:
                _run("sc.exe", "stop", SERVICE_NAME)
                _wait_stopped()
        try:
            # 停止后再备份，保证升级前的数据库与证书属于同一时点。
            backups = root / "backups"
            backups.mkdir(exist_ok=True)
            if sys.platform == "darwin":
                os.chmod(backups, 0o700)
            else:
                # 备份含私钥；先保留管理员可操作权限，再移除普通用户继承访问。
                _run("icacls.exe", str(backups), "/grant:r",
                     "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
                _run("icacls.exe", str(backups), "/inheritance:r")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = backups / f"upgrade-{stamp}.nexora-backup"
            create_backup(config.data_dir, backup)
            _replace_service_directory(target, old)
            new_mac_bootstrapped = False
            try:
                _replace_service_directory(staged, target)
                if was_running:
                    if sys.platform == "darwin":
                        _run("launchctl", "bootstrap", "system", str(MAC_PLIST))
                        new_mac_bootstrapped = True
                        _wait_mac_running()
                    else:
                        _run("sc.exe", "start", SERVICE_NAME)
                        # 升级也要检查新进程是否真正保持运行，否则回滚程序并重启旧版。
                        time.sleep(1)
                        if not service_running():
                            raise RuntimeError("新版 Windows 服务启动后退出，已恢复旧版程序")
                return backup
            except Exception:
                if new_mac_bootstrapped:
                    # 新版作业虽已注册却不可用，先卸载它再回滚程序，否则旧版无法重新注册。
                    _bootout_mac()
                if target.exists():
                    shutil.rmtree(target)
                _replace_service_directory(old, target)
                raise
        except Exception:
            if was_running and not service_running():
                if sys.platform == "darwin":
                    _run("launchctl", "bootstrap", "system", str(MAC_PLIST))
                else:
                    _run("sc.exe", "start", SERVICE_NAME)
            raise


def service_running() -> bool:
    if sys.platform == "darwin":
        result = subprocess.run(["launchctl", "print", f"system/{MAC_LABEL}"],
                                capture_output=True, text=True)
        return result.returncode == 0 and "state = running" in result.stdout
    if sys.platform == "win32":
        import win32service
        import win32serviceutil
        try:
            return win32serviceutil.QueryServiceStatus(SERVICE_NAME)[1] == win32service.SERVICE_RUNNING
        except Exception:
            return False
    return False


def start_service() -> None:
    _require_admin()
    read_config()
    if sys.platform == "darwin":
        _run("launchctl", "enable", f"system/{MAC_LABEL}")
        _run("launchctl", "bootstrap", "system", str(MAC_PLIST))
    else:
        _run("sc.exe", "start", SERVICE_NAME)


def stop_service() -> None:
    _require_admin()
    if sys.platform == "darwin":
        _run("launchctl", "disable", f"system/{MAC_LABEL}")
        _bootout_mac()
    else:
        _run("sc.exe", "stop", SERVICE_NAME)
        _wait_stopped()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Nexora ERP 固定主机管理")
    commands = parser.add_subparsers(dest="command", required=True)
    install = commands.add_parser("install")
    install.add_argument("--request", required=True, type=Path)
    install.add_argument("--source", required=True, type=Path)
    upgrade = commands.add_parser("upgrade")
    upgrade.add_argument("--source", required=True, type=Path)
    serve = commands.add_parser("serve-config")
    serve.add_argument("--config", required=True, type=Path)
    commands.add_parser("status")
    commands.add_parser("start")
    commands.add_parser("stop")
    args = parser.parse_args(argv)
    if args.command == "install":
        install_service(read_config(args.request), args.source)
    elif args.command == "upgrade":
        print(f"升级完成；升级前备份：{upgrade_service(args.source)}")
    elif args.command == "serve-config":
        config = read_config(args.config)
        create_server(config.data_dir, config.name, config.port).run()
    elif args.command == "status":
        configured = config_path().is_file()
        value = read_config().as_dict() if configured else {}
        print(json.dumps({"configured": configured, "running": service_running(),
                          "lan_addresses": lan_addresses(), **value}))
    elif args.command == "start":
        start_service()
    else:
        stop_service()


if __name__ == "__main__":
    main()
