"""Start and inspect the isolated first-order simulation processes in WSL."""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List


STAGE_ROOT = Path("/home/user/e2e-stage/coffee-platform")
RUNTIME_ROOT = Path("/home/user/e2e-stage/runtime")
PROJECT_ROOT = Path("/mnt/d/Work/FPS/Robotics/end-to-end-sim")
NODE_BIN = "/home/user/.local/opt/node-v22.23.2-linux-x64/bin"
SIMULATOR_PYTHON = "/home/user/.venvs/coffee-platform-live-sim/bin/python"
ROS_PYTHON = "/home/user/.venvs/end-to-end-sim-ros/bin/python"
ROS_SETUP = "/opt/ros/humble/setup.bash"
OVERLAY_SETUP = "/home/user/e2e-stage/ros_ws/install/setup.bash"
MANIFEST_PATH = RUNTIME_ROOT / "processes.json"


@dataclass(frozen=True)
class ProcessSpec:
    name: str
    command: List[str]
    cwd: Path
    log_path: Path
    env: Dict[str, str]


def base_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = NODE_BIN + ":" + env.get("PATH", "")
    return env


def provider_outcomes_argument(value: str) -> str:
    """Normalize the bounded fake-provider terminal sequence before launch."""
    tokens = [token.strip().lower() for token in value.split(",")]
    if not tokens or any(token not in {"success", "failed"} for token in tokens):
        raise argparse.ArgumentTypeError("provider outcomes must be a comma-separated sequence of success or failed")
    return ",".join(tokens)


def process_specs(mode: str, provider_outcomes: str = "success") -> List[ProcessSpec]:
    env = base_env()
    simulator_env = dict(env)
    simulator_env.update(
        {
            "PYTHONPATH": str(STAGE_ROOT / "simulators/live-simulator/src"),
            "SOCKET_IO_URL": "http://127.0.0.1:3001",
            "SOCKET_IO_NAMESPACE": "/socket-bridge",
            "SIMULATOR_HOST": "127.0.0.1",
            "SIMULATOR_PORT": "8770",
            "TASK_DELAY_SECONDS": "2",
        }
    )
    specs = [
        ProcessSpec(
            "api",
            [NODE_BIN + "/node", str(STAGE_ROOT / "services/api/dist/main.js")],
            STAGE_ROOT / "services/api",
            RUNTIME_ROOT / "api.log",
            env,
        ),
        ProcessSpec(
            "web",
            [str(STAGE_ROOT / "node_modules/.bin/next"), "dev", "--hostname", "127.0.0.1"],
            STAGE_ROOT / "apps/web",
            RUNTIME_ROOT / "web.log",
            env,
        ),
    ]
    if mode == "direct":
        specs.append(ProcessSpec(
            "live-sim",
            [SIMULATOR_PYTHON, "-m", "live_simulator.web"],
            STAGE_ROOT / "simulators/live-simulator",
            RUNTIME_ROOT / "live-sim.log",
            simulator_env,
        ))
        return specs
    ros_env = dict(env)
    ros_env.update({"ROS_LOCALHOST_ONLY": "1", "ROS_DOMAIN_ID": "67"})
    source_prefix = "source %s; source %s; " % (ROS_SETUP, OVERLAY_SETUP)
    provider_command = source_prefix + "exec %s -m sim_ros.fake_bread_pick_service --completion-delay-seconds 2 --outcomes %s" % (ROS_PYTHON, provider_outcomes)
    bridge_command = source_prefix + "exec %s -c 'from platform_bridge.ros_node import main; main()' --ros-args -p settings_path:=%s" % (ROS_PYTHON, PROJECT_ROOT / "config/platform_bridge.sim.json")
    specs.extend([
        ProcessSpec("ros", ["bash", "-lc", provider_command], PROJECT_ROOT, RUNTIME_ROOT / "ros.log", ros_env),
        ProcessSpec("bridge", ["bash", "-lc", bridge_command], PROJECT_ROOT, RUNTIME_ROOT / "bridge.log", ros_env),
    ])
    return specs


def process_start_ticks(pid: int) -> int | None:
    stat_path = Path("/proc") / str(pid) / "stat"
    try:
        fields = stat_path.read_text(encoding="ascii").split()
    except FileNotFoundError:
        return None
    if len(fields) < 22:
        return None
    try:
        return int(fields[21])
    except ValueError:
        return None


def load_manifest() -> Dict[str, Dict[str, object]]:
    try:
        raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(raw, dict):
        return {}
    result: Dict[str, Dict[str, object]] = {}
    for name, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        pid = entry.get("pid")
        ticks = entry.get("start_time_ticks")
        if isinstance(name, str) and isinstance(pid, int) and isinstance(ticks, int):
            restored = {"pid": pid, "start_time_ticks": ticks}
            log_path = entry.get("log_path")
            if isinstance(log_path, str):
                restored["log_path"] = log_path
            provider_outcomes = entry.get("provider_outcomes")
            if isinstance(provider_outcomes, str):
                restored["provider_outcomes"] = provider_outcomes
            result[name] = restored
    return result


def write_manifest(entries: Dict[str, Dict[str, object]]) -> None:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    temp_path = MANIFEST_PATH.with_suffix(".tmp")
    temp_path.write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n", encoding="ascii")
    temp_path.replace(MANIFEST_PATH)


def is_live(entry: Dict[str, object]) -> bool:
    pid = entry.get("pid")
    ticks = entry.get("start_time_ticks")
    return isinstance(pid, int) and isinstance(ticks, int) and process_start_ticks(pid) == ticks


def start(mode: str, provider_outcomes: str) -> int:
    required_paths = [STAGE_ROOT, Path(SIMULATOR_PYTHON)] if mode == "direct" else [STAGE_ROOT, PROJECT_ROOT, Path(ROS_PYTHON), Path(OVERLAY_SETUP)]
    missing = [str(path) for path in required_paths if not path.exists()]
    if missing:
        print("Missing staged prerequisite: " + ", ".join(missing), file=sys.stderr)
        return 2
    entries = load_manifest()
    conflicting_names = {"direct": {"bridge", "ros"}, "bridge": {"live-sim"}}[mode]
    conflicts = [name for name in conflicting_names if name in entries and is_live(entries[name])]
    if conflicts:
        print("Stop the mutually exclusive mode before starting %s: %s" % (mode, ", ".join(sorted(conflicts))), file=sys.stderr)
        return 2
    live_provider = entries.get("ros")
    if mode == "bridge" and live_provider and is_live(live_provider):
        active_outcomes = live_provider.get("provider_outcomes", "success")
        if active_outcomes != provider_outcomes:
            print("Stop the managed bridge mode before changing provider outcomes from %s to %s" % (active_outcomes, provider_outcomes), file=sys.stderr)
            return 2
    for spec in process_specs(mode, provider_outcomes):
        entry = entries.get(spec.name)
        if entry and is_live(entry):
            print(f"{spec.name}: already running pid={entry['pid']}")
            continue
        spec.log_path.parent.mkdir(parents=True, exist_ok=True)
        with spec.log_path.open("ab", buffering=0) as log_file:
            process = subprocess.Popen(
                spec.command,
                cwd=spec.cwd,
                env=spec.env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        ticks = process_start_ticks(process.pid)
        if ticks is None:
            print(f"{spec.name}: could not read start time for pid={process.pid}", file=sys.stderr)
            return 1
        entry = {"pid": process.pid, "start_time_ticks": ticks, "log_path": str(spec.log_path)}
        if spec.name == "ros":
            entry["provider_outcomes"] = provider_outcomes
        entries[spec.name] = entry
        print(f"{spec.name}: started pid={process.pid} log={spec.log_path}")
    write_manifest(entries)
    return 0


def stop() -> int:
    entries = load_manifest()
    requested = []
    for name, entry in entries.items():
        if not is_live(entry):
            print(f"{name}: not running")
            continue
        try:
            os.killpg(entry["pid"], signal.SIGTERM)
        except ProcessLookupError:
            print(f"{name}: already stopped")
            continue
        print(f"{name}: stop requested pid={entry['pid']}")
        requested.append((name, entry))
    deadline = time.monotonic() + 10.0
    remaining = list(requested)
    while remaining and time.monotonic() < deadline:
        remaining = [(name, entry) for name, entry in remaining if is_live(entry)]
        if remaining:
            time.sleep(0.1)
    if remaining:
        for name, entry in remaining:
            print(f"{name}: still running pid={entry['pid']}; manifest retained", file=sys.stderr)
        return 1
    write_manifest({})
    return 0


def status(mode: str) -> int:
    entries = load_manifest()
    for spec in process_specs(mode):
        entry = entries.get(spec.name)
        state = "running" if entry and is_live(entry) else "stopped"
        pid = str(entry["pid"]) if entry else "-"
        print(f"{spec.name}: {state} pid={pid} log={spec.log_path}")
    return 0


def logs(name: str, lines: int) -> int:
    matches = {spec.name: spec for mode in ("direct", "bridge") for spec in process_specs(mode)}
    spec = matches.get(name)
    if spec is None:
        print("Unknown process: " + name, file=sys.stderr)
        return 2
    try:
        content = spec.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        print("Log is not available: " + str(spec.log_path), file=sys.stderr)
        return 1
    print("\n".join(content[-lines:]))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Control the local first-order simulation stage.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    start_parser = subparsers.add_parser("start")
    start_parser.add_argument("--mode", choices=["direct", "bridge"], default="direct")
    start_parser.add_argument("--provider-outcomes", type=provider_outcomes_argument, default="success", help="Bridge-only comma-separated success or failed sequence for distinct accepted executions; the final outcome repeats after the sequence is exhausted.")
    subparsers.add_parser("stop")
    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--mode", choices=["direct", "bridge"], default="bridge")
    logs_parser = subparsers.add_parser("logs")
    logs_parser.add_argument("name", choices=["api", "web", "live-sim", "bridge", "ros"])
    logs_parser.add_argument("--lines", type=int, default=120)
    args = parser.parse_args()
    if args.command == "start":
        return start(args.mode, args.provider_outcomes)
    if args.command == "stop":
        return stop()
    if args.command == "status":
        return status(args.mode)
    return logs(args.name, args.lines)


if __name__ == "__main__":
    raise SystemExit(main())
