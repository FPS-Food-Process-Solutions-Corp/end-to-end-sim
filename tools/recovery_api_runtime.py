"""Run one isolated staged Platform API for recovery characterization.

This helper owns only processes recorded in its case-specific manifest.  It
never prints, serializes, or otherwise exposes the staged API's credentials.
"""

import argparse
import re
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Mapping, Optional
from urllib.parse import urlsplit, urlunsplit


STAGE_ROOT = Path("/home/user/e2e-stage/coffee-platform")
STAGE_API_ROOT = STAGE_ROOT / "services/api"
STAGE_ENV_PATH = STAGE_API_ROOT / ".env"
STAGE_ROOT_ENV_PATH = STAGE_ROOT / ".env"
STAGE_LOCAL_ENV_PATH = STAGE_API_ROOT / ".env.local"
NODE = "/home/user/.local/opt/node-v22.23.2-linux-x64/bin/node"
API_MAIN = STAGE_API_ROOT / "dist/main.js"
RUNTIME_ROOT = Path("/mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/recovery-20260922")
PORT = 3101
CASES = {
    "ack": "coffee_platform_recovery_20260922_ack",
    "disconnect": "coffee_platform_recovery_20260922_disconnect",
    "restart": "coffee_platform_recovery_20260922_restart",
    "cancel": "coffee_platform_recovery_20260922_cancel",
}


def process_start_ticks(pid: int) -> Optional[int]:
    """Read Linux start ticks so a reused PID cannot be controlled."""
    try:
        fields = (Path("/proc") / str(pid) / "stat").read_text(encoding="ascii").split()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    if len(fields) < 22:
        return None
    try:
        return int(fields[21])
    except ValueError:
        return None


def manifest_path(case: str, runtime_root: Path) -> Path:
    return runtime_root / ("api-" + case + ".json")


def log_path(case: str, runtime_root: Path) -> Path:
    return runtime_root / ("api-" + case + ".log")


def read_staged_env(path: Path, local_path: Path) -> Dict[str, str]:
    """Read private staged env files without recording their values anywhere."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise RuntimeError("Staged API .env is unavailable") from exc
    except UnicodeDecodeError as exc:
        raise RuntimeError("Staged API .env is not valid UTF-8") from exc
    try:
        local_lines = local_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        local_lines = []
    except UnicodeDecodeError as exc:
        raise RuntimeError("Staged API .env.local is not valid UTF-8") from exc
    except OSError as exc:
        raise RuntimeError("Staged API .env.local could not be read") from exc
    result: Dict[str, str] = {}
    for line in lines + local_lines:
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        if text.startswith("export "):
            text = text[7:].lstrip()
        key, separator, value = text.partition("=")
        key = key.strip()
        if not separator or not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        result[key] = value
    if not result.get("DATABASE_URL"):
        raise RuntimeError("Staged API .env does not define DATABASE_URL")
    return result


def database_url_for_case(database_url: str, database_name: str) -> str:
    """Keep private connection details while replacing only the database path."""
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.netloc:
        raise RuntimeError("Staged DATABASE_URL is not a PostgreSQL URL")
    return urlunsplit((parsed.scheme, parsed.netloc, "/" + database_name, parsed.query, parsed.fragment))


def api_environment(database_name: str, port: int) -> Dict[str, str]:
    env_path = STAGE_ENV_PATH if STAGE_ENV_PATH.exists() else STAGE_ROOT_ENV_PATH
    staged = read_staged_env(env_path, STAGE_LOCAL_ENV_PATH)
    env = dict(os.environ)
    env["DATABASE_URL"] = database_url_for_case(staged["DATABASE_URL"], database_name)
    env["PORT"] = str(port)
    return env


def expected_command() -> List[str]:
    wrapper = "const http=require('http');const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...a){if(typeof a[0]==='number'&&(a.length===1||typeof a[1]==='function'))return listen.call(this,a[0],'127.0.0.1',...a.slice(1));return listen.apply(this,a);};require(process.argv[1]);"
    return [NODE, "-e", wrapper, str(API_MAIN)]


def command_line(pid: int) -> Optional[List[str]]:
    try:
        raw = (Path("/proc") / str(pid) / "cmdline").read_bytes()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    if not raw:
        return None
    try:
        return [part.decode("utf-8") for part in raw.split(b"\0") if part]
    except UnicodeDecodeError:
        return None


def load_manifest(case: str, runtime_root: Path) -> Optional[Dict[str, object]]:
    try:
        raw = json.loads(manifest_path(case, runtime_root).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None
    except OSError:
        return None
    if not isinstance(raw, dict):
        return None
    pid = raw.get("pid")
    ticks = raw.get("start_time_ticks")
    command = raw.get("command")
    if not isinstance(pid, int) or not isinstance(ticks, int) or not isinstance(command, list):
        return None
    if any(not isinstance(part, str) for part in command):
        return None
    return raw


def is_owned_live(entry: Mapping[str, object]) -> bool:
    pid = entry.get("pid")
    ticks = entry.get("start_time_ticks")
    command = entry.get("command")
    if not isinstance(pid, int) or not isinstance(ticks, int) or not isinstance(command, list):
        return False
    if any(not isinstance(part, str) for part in command):
        return False
    return command == expected_command() and process_start_ticks(pid) == ticks and command_line(pid) == command


def ensure_port_available(port: int) -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # Match a normal server's restart behavior: permit a local probe after
        # a recently closed connection, while bind still rejects a listener.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", port))
    except OSError as exc:
        raise RuntimeError("Local port %d is unavailable" % port) from exc
    finally:
        probe.close()


def write_manifest(case: str, runtime_root: Path, entry: Mapping[str, object]) -> None:
    runtime_root.mkdir(parents=True, exist_ok=True)
    path = manifest_path(case, runtime_root)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(entry, indent=2, sort_keys=True) + "\n", encoding="ascii")
    temporary.replace(path)


def reap_new_api_process(process: subprocess.Popen) -> None:
    """Stop and reap only the child returned by this start attempt."""
    if process.poll() is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        if process.poll() is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        process.wait(timeout=5.0)


def start(case: str, database_name: str, port: int, runtime_root: Path) -> int:
    existing = load_manifest(case, runtime_root)
    if existing is not None and is_owned_live(existing):
        print("api: already running for case %s pid=%s" % (case, existing["pid"]))
        return 0
    missing = [str(path) for path in (STAGE_API_ROOT, Path(NODE), API_MAIN) if not path.exists()]
    if not STAGE_ENV_PATH.exists() and not STAGE_ROOT_ENV_PATH.exists():
        missing.append(str(STAGE_ENV_PATH) + " or " + str(STAGE_ROOT_ENV_PATH))
    if missing:
        print("Missing staged prerequisite: " + ", ".join(missing), file=sys.stderr)
        return 2
    try:
        env = api_environment(database_name, port)
        ensure_port_available(port)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    runtime_root.mkdir(parents=True, exist_ok=True)
    with log_path(case, runtime_root).open("ab", buffering=0) as output:
        process = subprocess.Popen(expected_command(), cwd=STAGE_API_ROOT, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    ownership_recorded = False
    try:
        ticks = process_start_ticks(process.pid)
        if ticks is None:
            print("api: started process could not be identified", file=sys.stderr)
            return 1
        write_manifest(case, runtime_root, {"case": case, "database_name": database_name, "port": port, "pid": process.pid, "start_time_ticks": ticks, "command": expected_command(), "log_path": str(log_path(case, runtime_root))})
        print("api: started case=%s pid=%d log=%s" % (case, process.pid, log_path(case, runtime_root)))
        ownership_recorded = True
        return 0
    finally:
        if not ownership_recorded:
            reap_new_api_process(process)


def stop(case: str, runtime_root: Path) -> int:
    entry = load_manifest(case, runtime_root)
    if entry is None:
        print("api: no owned process recorded for case " + case)
        return 0
    if not is_owned_live(entry):
        print("api: recorded process is not live or no longer matches; manifest retained", file=sys.stderr)
        return 1
    pid = entry["pid"]
    if not isinstance(pid, int):
        print("api: invalid owned process record", file=sys.stderr)
        return 1
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        print("api: already stopped")
        return 0
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if not is_owned_live(entry):
            try:
                manifest_path(case, runtime_root).unlink()
            except FileNotFoundError:
                pass
            print("api: stopped case=%s pid=%d" % (case, pid))
            return 0
        time.sleep(0.1)
    print("api: still running; manifest retained", file=sys.stderr)
    return 1


def status(case: str, runtime_root: Path) -> int:
    entry = load_manifest(case, runtime_root)
    if entry is not None and is_owned_live(entry):
        print("api: running case=%s pid=%s log=%s" % (case, entry["pid"], log_path(case, runtime_root)))
    else:
        print("api: stopped case=%s log=%s" % (case, log_path(case, runtime_root)))
    return 0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Control one isolated staged Platform API recovery case.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("start", "stop", "status"):
        subparser = subparsers.add_parser(name)
        subparser.add_argument("case", choices=sorted(CASES))
        subparser.add_argument("--database-name", help="Explicit isolated database name; defaults only to the historical case mapping.")
        subparser.add_argument("--port", type=int, default=PORT, help="Loopback API port for this owned process.")
        subparser.add_argument("--runtime-root", type=Path, default=RUNTIME_ROOT, help="Case-specific manifest and log directory.")
        if name != "status":
            subparser.add_argument("--execute", action="store_true", help="Allow this process mutation")
    arguments = parser.parse_args()
    if not 1 <= arguments.port <= 65535:
        parser.error("--port must be from 1 through 65535")
    if arguments.database_name is None:
        arguments.database_name = CASES[arguments.case]
    if re.fullmatch(r"taska_20[0-9]{6}_[a-z0-9_]+", arguments.database_name) is None and arguments.database_name not in CASES.values():
        parser.error("--database-name must use a taska_YYYYMMDD_ prefix or an existing historical mapping")
    return arguments


def main() -> int:
    args = parse_arguments()
    if args.command == "status":
        return status(args.case, args.runtime_root)
    if not args.execute:
        print("%s requires --execute" % args.command, file=sys.stderr)
        return 2
    if args.command == "start":
        return start(args.case, args.database_name, args.port, args.runtime_root)
    return stop(args.case, args.runtime_root)


if __name__ == "__main__":
    raise SystemExit(main())
