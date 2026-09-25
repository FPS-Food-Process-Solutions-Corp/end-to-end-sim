"""Run bounded real-transport recovery cases against an isolated staged API."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
from time import monotonic, sleep, time
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROS_PYTHON = Path("/home/user/.venvs/end-to-end-sim-ros/bin/python")
DEFAULT_ROS_SETUP = Path("/opt/ros/humble/setup.bash")
DEFAULT_OVERLAY_SETUP = Path("/home/user/e2e-stage/ros_ws/install/setup.bash")
DEFAULT_DOMAIN_ID = "71"
DEVICE_ID = "nova5_arm"
PINNED_CLIENT_HASHES = {"client.py": "481163dc187fff8e62fdd9d2af6c919f3ed9f1ccae43d4f463acd900111a3f9d", "pending_completion.py": "3f2d33d94dd838af21b5e49c64cab1cf5c0a5bd34bb759fa63062e50af5bf228", "pending_failure.py": "8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a", "settings.py": "01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584"}
CURRENT_CLIENT_HASHES = {"client.py": "481163dc187fff8e62fdd9d2af6c919f3ed9f1ccae43d4f463acd900111a3f9d", "pending_completion.py": "006e47f6c1510bfcda9c019aef5f7741e73187ce14b64a3f6b11fc358520b402", "pending_failure.py": "8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a", "settings.py": "d88bcb104f1b851b95963a61904b8401e19b0ee9e1ae3a15a259b38dc76f8bb6"}
CURRENT_CLIENT_COMMIT = "adf51339db90f75ee078d51bc8fba36148414d89"
CURRENT_NOVA_COMMIT = "4055912c72a90e841b79cbc93852fe9cc807927a"


class HarnessError(RuntimeError):
    """Stop a case with evidence preserved and no automatic cleanup mutation."""


class ManagedProcess:
    """A scoped child process with saved PID/start-tick ownership evidence."""

    def __init__(self, name: str, command: list[str], cwd: Path, log_path: Path, env: dict[str, str]) -> None:
        self.name, self.command, self.cwd, self.log_path, self.env = name, command, cwd, log_path, env
        self.process: Optional[subprocess.Popen] = None
        self.start_time_ticks: Optional[int] = None
        self.owner_manifest: Optional[Path] = None

    @staticmethod
    def ticks(pid: int) -> Optional[int]:
        try:
            return int((Path("/proc") / str(pid) / "stat").read_text(encoding="ascii").rsplit(") ", 1)[1].split()[19])
        except (OSError, ValueError, IndexError):
            return None

    def start(self) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.log_path.open("ab", buffering=0)
        try:
            self.process = subprocess.Popen(self.command, cwd=self.cwd, env=self.env, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            self.start_time_ticks = self.ticks(self.process.pid)
            self.owner_manifest = self.log_path.parent / (self.name + "-owner-" + str(self.process.pid) + ".json")
            write_json(self.owner_manifest, {"name": self.name, "pid": self.process.pid, "start_time_ticks": self.start_time_ticks, "argv": self.command, "cwd": str(self.cwd), "started_at_epoch": time()})
            if self.start_time_ticks is None:
                if self.process.poll() is None:
                    self.process.terminate()
                    self.process.wait(timeout=5.0)
                raise HarnessError("could not capture owned process start ticks: " + self.name)
        finally:
            stream.close()

    def _owned_running(self) -> bool:
        if self.process is None or self.process.poll() is not None:
            return False
        actual = self.ticks(self.process.pid)
        if actual != self.start_time_ticks:
            if self.owner_manifest is not None:
                write_json(self.owner_manifest, {"name": self.name, "pid": self.process.pid, "start_time_ticks": self.start_time_ticks, "observed_ticks": actual, "ownership_mismatch": True})
            return False
        return True

    def _record_stop(self) -> None:
        if self.owner_manifest is not None and self.owner_manifest.is_file():
            record = json.loads(self.owner_manifest.read_text(encoding="ascii"))
            record["stopped_at_epoch"] = time()
            record["returncode"] = None if self.process is None else self.process.poll()
            write_json(self.owner_manifest, record)

    def stop(self) -> None:
        if not self._owned_running():
            self._record_stop()
            return
        os.killpg(self.process.pid, signal.SIGTERM)
        try:
            self.process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            if self._owned_running():
                os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=5.0)
        self._record_stop()

    def kill(self) -> None:
        if not self._owned_running():
            self._record_stop()
            return
        os.killpg(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=5.0)
        self._record_stop()


def parse_arguments() -> argparse.Namespace:
    """Require an explicit mutation switch and all isolated runtime paths."""
    parser = argparse.ArgumentParser(description="Exercise one real staged-platform bridge recovery case through a transparent local transport proxy; an enabled follow-up check creates a second labelled order.")
    parser.add_argument("--execute", action="store_true", help="Allow one labelled order in the already-isolated API database.")
    parser.add_argument("--source-profile", choices=("historical-frozen", "current-canonical"), required=True)
    parser.add_argument("--case", choices=["connected-control", "disconnect-after-start", "lost-terminal-ack", "lost-terminal-ack-queued", "bridge-restart", "abrupt-queued-report-restart", "cancel-late-success", "late-success-recovery", "terminal-before-client-queue", "confirmed-before-callback", "readiness-false", "readiness-unavailable", "identity-mismatch", "identity-missing"], required=True)
    parser.add_argument("--label", required=True, help="Unique evidence label included in created order names.")
    parser.add_argument("--api-url", default="http://127.0.0.1:3121")
    parser.add_argument("--proxy-port", type=int, default=3123)
    parser.add_argument("--completion-readback-url", help="Read-back API base URL; defaults to --api-url and does not use the Socket.IO proxy.")
    parser.add_argument("--ros-domain-id", default=DEFAULT_DOMAIN_ID)
    parser.add_argument("--database-name", required=True, help="Fresh task-specific database name prepared before starting the isolated API.")
    parser.add_argument("--api-manifest", type=Path, required=True, help="Owned API PID/start-tick manifest, copied before its stop helper removes it.")
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--bridge-config-template", type=Path, default=PROJECT_ROOT / "config/platform_bridge.sim.json")
    parser.add_argument("--bridge-source", type=Path, required=True)
    parser.add_argument("--nova-source-manifest", type=Path, help="Frozen Nova source manifest; defaults to the selected bridge source verification manifest.")
    parser.add_argument("--platform-client-source", type=Path, required=True)
    parser.add_argument("--operator", default="combined-recovery-operator")
    parser.add_argument("--reason", default="Reviewed exact controller outcome and physical readiness")
    parser.add_argument("--ros-python", type=Path, default=DEFAULT_ROS_PYTHON)
    parser.add_argument("--ros-setup", type=Path, default=DEFAULT_ROS_SETUP)
    parser.add_argument("--overlay-setup", type=Path, default=DEFAULT_OVERLAY_SETUP)
    parser.add_argument("--deadline-seconds", type=float, default=25.0)
    parser.add_argument("--completion-delay-seconds", type=float, default=5.0)
    parser.add_argument("--check-next-order", action="store_true", help="Create one labelled follow-up order after first-case evidence and measure whether another provider start occurs.")
    arguments = parser.parse_args()
    if not arguments.execute:
        parser.error("--execute is required because this harness creates labelled orders")
    if not arguments.label.strip():
        parser.error("--label must not be blank")
    if not arguments.check_next_order and arguments.case not in {"readiness-false", "readiness-unavailable", "identity-mismatch", "identity-missing"}:
        parser.error("--check-next-order is required for combined acceptance cases")
    if arguments.deadline_seconds <= 0.0 or arguments.completion_delay_seconds <= 0.0:
        parser.error("deadline and completion delay must be greater than zero")
    if not 1 <= arguments.proxy_port <= 65535:
        parser.error("--proxy-port must be from 1 through 65535")
    if not arguments.ros_domain_id.isdigit() or not 0 <= int(arguments.ros_domain_id) <= 232:
        parser.error("--ros-domain-id must be an integer from 0 through 232")
    if not re.fullmatch(r"taska_20[0-9]{6}_[a-z0-9_]+", arguments.database_name):
        parser.error("--database-name must match taska_YYYYMMDD_<case>_<unique>")
    parsed = urlparse(arguments.api_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port is None:
        parser.error("--api-url must use an explicit loopback HTTP port")
    if arguments.completion_readback_url is None:
        arguments.completion_readback_url = arguments.api_url
    if arguments.source_profile == "historical-frozen" and arguments.nova_source_manifest is None:
        arguments.nova_source_manifest = arguments.bridge_source / "verification/recovery-migration/source-manifest.json"
    if arguments.source_profile == "current-canonical" and arguments.nova_source_manifest is not None:
        parser.error("--nova-source-manifest is historical-only")
    readback = urlparse(arguments.completion_readback_url)
    if readback.scheme != "http" or readback.hostname not in {"127.0.0.1", "localhost"} or readback.port is None:
        parser.error("--completion-readback-url must use an explicit loopback HTTP port")
    return arguments


def request_json(method: str, url: str, payload: Optional[dict[str, Any]] = None) -> Any:
    """Make one JSON API request without substituting a mock server or client."""
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(url, method=method, data=body)
    request.add_header("Accept", "application/json")
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urlopen(request, timeout=10.0) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HarnessError("HTTP %s %s failed: %s" % (method, url, detail)) from exc
    except URLError as exc:
        raise HarnessError("HTTP %s %s unavailable: %s" % (method, url, exc.reason)) from exc


def write_json(path: Path, value: Any) -> None:
    """Atomically write ASCII evidence or explicit proxy control input."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="ascii")
    temporary.replace(path)


def append_event(path: Path, event: str, **fields: Any) -> None:
    """Append small local-harness observations with no credentials."""
    entry = {"timestamp": round(time(), 6), "event": event}
    entry.update(fields)
    with path.open("a", encoding="ascii") as stream:
        stream.write(json.dumps(entry, sort_keys=True, separators=(",", ":")) + "\n")


def hash_file(path: Path) -> str:
    """Return a source identity hash rather than assuming staged parity."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_manifest(path: Path) -> dict[str, str]:
    """Record every loaded Python source file from an explicit worktree."""
    files = sorted(candidate for candidate in path.rglob("*.py") if "__pycache__" not in candidate.parts)
    if not files:
        raise HarnessError("source worktree has no Python files: %s" % path)
    return {str(candidate.relative_to(path)): hash_file(candidate) for candidate in files}


def require_loaded_source_identity(event: dict[str, Any], arguments: argparse.Namespace) -> None:
    """Reject a run unless imported modules match the requested source trees."""
    modules = event.get("modules")
    if not isinstance(modules, dict):
        raise HarnessError("bridge did not record loaded module identity")
    expected = {
        "hr_client.client": arguments.platform_client_source / "hr_client/client.py",
        "hr_client.pending_completion": arguments.platform_client_source / "hr_client/pending_completion.py",
        "hr_client.pending_failure": arguments.platform_client_source / "hr_client/pending_failure.py",
        "hr_client.settings": arguments.platform_client_source / "hr_client/settings.py",
        "platform_bridge.executor": arguments.bridge_source / "platform_bridge/executor.py",
        "platform_bridge.journal": arguments.bridge_source / "platform_bridge/journal.py",
        "platform_bridge.ros_node": arguments.bridge_source / "platform_bridge/ros_node.py",
        "platform_bridge.recovery": arguments.bridge_source / "platform_bridge/recovery.py",
        "platform_bridge.settings": arguments.bridge_source / "platform_bridge/settings.py",
        "platform_bridge.completion_recovery": arguments.bridge_source / "platform_bridge/completion_recovery.py",
        "platform_bridge.recover_execution": arguments.bridge_source / "platform_bridge/recover_execution.py",
        "platform_bridge.journal_lock": arguments.bridge_source / "platform_bridge/journal_lock.py",
    }
    for name, source_path in expected.items():
        actual = modules.get(name)
        if not isinstance(actual, dict) or actual.get("path") != str(source_path.resolve()) or actual.get("sha256") != hash_file(source_path):
            raise HarnessError("loaded %s does not match requested source path and hash" % name)


def require_current_sources(arguments: argparse.Namespace) -> None:
    """Validate current merged source and all actual imported-file candidates."""
    for path, expected, label in ((arguments.platform_client_source, CURRENT_CLIENT_COMMIT, "client"),
                                  (arguments.bridge_source, CURRENT_NOVA_COMMIT, "Nova")):
        safe_root = path if label == "client" else path.parents[1]
        head = subprocess.run(["git", "-c", "safe.directory=" + str(safe_root), "-C", str(safe_root), "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
        if head.returncode or head.stdout.strip() != expected:
            raise HarnessError("selected %s source is not reviewed merged commit" % label)
        for extra in ([], ["--cached"]):
            scope = ["src/platform_bridge"] if label == "Nova" else ["hr_client", "platform_common"]
            clean = subprocess.run(["git", "-c", "safe.directory=" + str(safe_root), "-c", "core.autocrlf=true", "-C", str(safe_root), "diff", "--quiet", *extra, "--", *scope], capture_output=True, check=False)
            if clean.returncode:
                raise HarnessError("selected %s source has tracked edits" % label)
    for name, expected in CURRENT_CLIENT_HASHES.items():
        path = arguments.platform_client_source / "hr_client" / name
        if not path.is_file() or hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest() != expected:
            raise HarnessError("selected current client source differs from reviewed content: %s" % name)
    for name in ("ros_node.py", "executor.py", "journal.py", "recovery.py", "settings.py",
                 "completion_recovery.py", "recover_execution.py", "journal_lock.py"):
        if not (arguments.bridge_source / "platform_bridge" / name).is_file():
            raise HarnessError("selected current Nova source is incomplete: %s" % name)
    for path in (arguments.bridge_config_template, arguments.ros_python, arguments.ros_setup, arguments.overlay_setup):
        if not path.is_file():
            raise HarnessError("selected current runtime path is missing: %s" % path)
    source_manifest(arguments.bridge_source)
    source_manifest(arguments.platform_client_source)


def require_paths(arguments: argparse.Namespace) -> None:
    if arguments.source_profile == "current-canonical":
        require_current_sources(arguments)
        return
    if arguments.source_profile != "historical-frozen":
        raise HarnessError("source profile must be explicit")
    """Fail before mutation if the explicitly selected source is incomplete."""
    paths = [arguments.bridge_config_template, arguments.nova_source_manifest, arguments.platform_client_source / "hr_client/client.py", arguments.platform_client_source / "hr_client/pending_completion.py", arguments.platform_client_source / "hr_client/pending_failure.py", arguments.platform_client_source / "hr_client/settings.py", arguments.ros_python, arguments.ros_setup, arguments.overlay_setup]
    paths.extend(arguments.bridge_source / "platform_bridge" / name for name in ("ros_node.py", "executor.py", "journal.py", "recovery.py", "settings.py", "completion_recovery.py", "recover_execution.py", "journal_lock.py"))
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        raise HarnessError("missing selected source or runtime path: %s" % ", ".join(missing))
    source_manifest(arguments.bridge_source)
    pinned = json.loads(arguments.nova_source_manifest.read_text(encoding="ascii"))
    listed = pinned.get("files") if isinstance(pinned, dict) else None
    if not isinstance(listed, list) or not listed:
        raise HarnessError("Nova source manifest has no frozen file list")
    for record in listed:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str) or not isinstance(record.get("sha256"), str):
            raise HarnessError("Nova source manifest contains an invalid file entry")
        relative = Path(record["path"])
        if relative.is_absolute() or ".." in relative.parts or hash_file(arguments.bridge_source / relative) != record["sha256"]:
            raise HarnessError("selected Nova source differs from frozen manifest: %s" % relative)
    if pinned.get("clientCommit") != "16d04079727681f047282c5116298a828000c2a9":
        raise HarnessError("frozen Nova manifest was validated against another client revision")
    if hash_file(arguments.nova_source_manifest) != "b340b9084dea234dcb2ec4ea688b098c025053d70c1009b3620fd6a69eeecfd8":
        raise HarnessError("Nova source manifest differs from independently reviewed freeze")
    for name, expected in PINNED_CLIENT_HASHES.items():
        if hash_file(arguments.platform_client_source / "hr_client" / name) != expected:
            raise HarnessError("selected client source differs from independently validated revision: %s" % name)
    if hash_file(arguments.bridge_source / "platform_bridge/journal_lock.py") != "2fbaaec98cc414ea2220d359f0b3dbaea615ecb129f18b793d02fe9eae72b121":
        raise HarnessError("selected Nova journal lock differs from inspected CLI dependency")
    source_manifest(arguments.platform_client_source)


def queue_is_clean(queue: Any) -> bool:
    """Require no queued/preparing work that could make a task claim ambiguous."""
    return isinstance(queue, dict) and isinstance(queue.get("queued"), list) and isinstance(queue.get("preparing"), list) and not queue["queued"] and not queue["preparing"]


def task_statuses(order: Any) -> list[str]:
    """Extract terminal/task state without assuming a selected inventory slot."""
    progress = order.get("fulfillmentProgress") if isinstance(order, dict) else None
    session = progress.get("pickSession") if isinstance(progress, dict) else None
    tasks = session.get("tasks") if isinstance(session, dict) else None
    if not isinstance(tasks, list):
        return []
    return [task.get("status") for task in tasks if isinstance(task, dict) and isinstance(task.get("status"), str)]


def completed_snapshot_or_none(order: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Return an order only after the real API shows at least one completed pick task."""
    return order if "COMPLETED" in task_statuses(order) else None


def wait_for(predicate: Callable[[], Optional[Any]], deadline: float, description: str) -> Any:
    """Poll a bounded external condition and preserve a visible timeout reason."""
    while monotonic() < deadline:
        value = predicate()
        if value is not None:
            return value
        sleep(0.05)
    raise HarnessError("deadline exceeded while waiting for %s" % description)


def wait_for_with_processes(predicate: Callable[[], Optional[Any]], deadline: float, description: str, processes: list[ManagedProcess]) -> Any:
    """Fail fast when an owned child exits instead of consuming a case deadline."""
    while monotonic() < deadline:
        for process in processes:
            if process.process is not None and process.process.poll() is not None:
                raise HarnessError("%s exited with code %s while waiting for %s; inspect %s" % (process.name, process.process.returncode, description, process.log_path))
        value = predicate()
        if value is not None:
            return value
        sleep(0.05)
    raise HarnessError("deadline exceeded while waiting for %s" % description)


def json_log_events(path: Path) -> list[dict[str, Any]]:
    """Read structured provider evidence from ROS logger lines without credentials."""
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        start = line.find("{")
        if start < 0:
            continue
        try:
            payload = json.loads(line[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("event"), str):
            events.append(payload)
    return events


def event_log_entries(path: Path) -> list[dict[str, Any]]:
    """Read the proxy's compact JSONL records."""
    if not path.exists():
        return []
    entries = []
    for line in path.read_text(encoding="ascii").splitlines():
        if line:
            entries.append(json.loads(line))
    return entries


def create_order(api_url: str, label: str) -> dict[str, Any]:
    """Create exactly one one-unit Rack-A order through the real staged API."""
    order = request_json("POST", api_url + "/api/orders", {"customerName": "Nova recovery " + label, "source": "customer_ui", "paymentMethod": "alipay", "items": [{"itemId": "croissant", "quantity": 1, "selectedOptions": {}}]})
    if not isinstance(order, dict) or not isinstance(order.get("id"), str) or not order["id"]:
        raise HarnessError("order creation did not return an order id")
    return order


def make_bridge_config(arguments: argparse.Namespace, path: Path, journal_path: Path, pending_completions_path: Path) -> None:
    """Create one throwaway config pointing the real bridge at the local proxy."""
    payload = json.loads(arguments.bridge_config_template.read_text(encoding="utf-8"))
    server = payload.get("server")
    paths = payload.get("paths")
    if not isinstance(server, dict) or not isinstance(paths, dict):
        raise HarnessError("bridge config template omitted server or paths")
    server["url"] = "http://127.0.0.1:%d" % arguments.proxy_port
    server["completion_readback_url"] = arguments.completion_readback_url
    paths["journal"] = str(journal_path)
    paths["pending_completions"] = str(pending_completions_path)
    write_json(path, payload)


def shell_command(arguments: argparse.Namespace, body: str) -> list[str]:
    """Source only the approved ROS overlays for disposable localhost children."""
    command = "source %s; source %s; export ROS_DOMAIN_ID=%s; export ROS_LOCALHOST_ONLY=1; %s" % (shlex.quote(str(arguments.ros_setup)), shlex.quote(str(arguments.overlay_setup)), shlex.quote(arguments.ros_domain_id), body)
    return ["bash", "-lc", command]


def provider_process(arguments: argparse.Namespace, log_path: Path, status_control_path: Path) -> ManagedProcess:
    """Build the actual fake-ROS provider command with a deliberately delayed success."""
    command = "exec %s -m sim_ros.fake_bread_pick_service --completion-delay-seconds %s --outcomes success --status-control-path %s" % (shlex.quote(str(arguments.ros_python)), shlex.quote(str(arguments.completion_delay_seconds)), shlex.quote(str(status_control_path)))
    return ManagedProcess("provider", shell_command(arguments, command), PROJECT_ROOT, log_path, dict(os.environ))


def bridge_process(arguments: argparse.Namespace, config_path: Path, log_path: Path, boundary: str = "", marker: Optional[Path] = None) -> ManagedProcess:
    """Build the real staged bridge with its disposable WebSocket-only transport wrapper."""
    python_path = ":".join([str(arguments.bridge_source), str(arguments.platform_client_source), str(PROJECT_ROOT), os.environ.get("PYTHONPATH", "")])
    entrypoint = PROJECT_ROOT / "tools/bridge_websocket_transport_entrypoint.py"
    command = "export PYTHONPATH=%s:$PYTHONPATH; exec %s %s --ros-args -p settings_path:=%s" % (shlex.quote(python_path), shlex.quote(str(arguments.ros_python)), shlex.quote(str(entrypoint)), shlex.quote(str(config_path)))
    env = dict(os.environ)
    if boundary:
        env["COMBINED_RECOVERY_BOUNDARY"] = boundary
        env["COMBINED_RECOVERY_BOUNDARY_MARKER"] = str(marker)
    return ManagedProcess("bridge", shell_command(arguments, command), PROJECT_ROOT, log_path, env)


def run_recovery_cli(arguments: argparse.Namespace, config_path: Path, execution_id: str, log_path: Path, resolve_platform: bool = False, expect_success: bool = True) -> dict[str, Any]:
    """Invoke the selected Nova CLI against the stopped bridge and retain raw output."""
    python_path = ":".join([str(arguments.bridge_source), str(arguments.platform_client_source), str(PROJECT_ROOT), os.environ.get("PYTHONPATH", "")])
    options = ["--settings-path", str(config_path), "--execution-id", execution_id, "--operator", arguments.operator, "--reason", arguments.reason, "--confirm-robot-recovered"]
    if resolve_platform:
        options.append("--resolve-platform-for-operator")
    body = "export PYTHONPATH=%s:$PYTHONPATH; exec %s -m platform_bridge.recover_execution %s" % (shlex.quote(python_path), shlex.quote(str(arguments.ros_python)), " ".join(shlex.quote(value) for value in options))
    completed = subprocess.run(shell_command(arguments, body), cwd=PROJECT_ROOT, env=dict(os.environ), capture_output=True, text=True, timeout=20.0, check=False)
    raw = {"argv": options, "returncode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr}
    write_json(log_path, raw)
    if (completed.returncode == 0) != expect_success:
        raise HarnessError("Nova recovery CLI returned unexpected status; inspect %s" % log_path)
    return raw


def journal_entry(path: Path, execution_id: str) -> Optional[dict[str, Any]]:
    """Read the actual production journal by its original execution identity."""
    if not path.is_file():
        return None
    document = json.loads(path.read_text(encoding="ascii"))
    if not isinstance(document, dict):
        raise HarnessError("Nova journal is not an object")
    matches = [item for item in document.values() if isinstance(item, dict) and item.get("execution_id") == execution_id]
    if len(matches) > 1:
        raise HarnessError("Nova journal has duplicate execution identity")
    return matches[0] if matches else None


def durable_snapshot(runtime: Path, journal_path: Path, pending_path: Path, name: str) -> dict[str, Any]:
    """Copy journal, completion, and derived failure stores without modifying them."""
    result = {}
    for label, path in (("journal", journal_path), ("pending_completions", pending_path), ("pending_failures", pending_path.with_name(pending_path.stem + "-failures" + pending_path.suffix))):
        if path.is_file():
            target = runtime / (name + "-" + path.name)
            target.write_bytes(path.read_bytes())
            result[label] = {"path": str(target), "sha256": hash_file(target)}
        else:
            result[label] = None
    write_json(runtime / (name + "-snapshot.json"), result)
    return result


def same_durable_contents(before: dict[str, Any], after: dict[str, Any]) -> bool:
    """Compare stored bytes, not the distinct evidence-copy paths."""
    return all((before.get(name) or {}).get("sha256") == (after.get(name) or {}).get("sha256") for name in ("journal", "pending_completions", "pending_failures"))


def proxy_process(arguments: argparse.Namespace, control_path: Path, events_path: Path, log_path: Path) -> ManagedProcess:
    """Build a separate transparent proxy process, never a replacement API server."""
    parsed = urlparse(arguments.api_url)
    command = [sys.executable, str(PROJECT_ROOT / "tools/socketio_fault_proxy.py"), "--listen-port", str(arguments.proxy_port), "--upstream-port", str(parsed.port), "--control-path", str(control_path), "--events-path", str(events_path)]
    return ManagedProcess("proxy", command, PROJECT_ROOT, log_path, dict(os.environ))


def observe_ros_status(arguments: argparse.Namespace, execution_id: str, log_path: Path) -> dict[str, Any]:
    """Use a separate read-only ROS client to inspect provider state after restart."""
    observer = PROJECT_ROOT / "tools/ros_bread_pick_status_observer.py"
    command = shell_command(arguments, "exec %s %s --execution-id %s --timeout-seconds 5" % (shlex.quote(str(arguments.ros_python)), shlex.quote(str(observer)), shlex.quote(execution_id)))
    completed = subprocess.run(command, cwd=PROJECT_ROOT, env=dict(os.environ), capture_output=True, text=True, timeout=10.0, check=False)
    log_path.write_text(completed.stdout + completed.stderr, encoding="utf-8")
    if completed.returncode != 0:
        raise HarnessError("read-only ROS observer failed: %s" % completed.stderr.strip())
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise HarnessError("read-only ROS observer did not emit exactly one JSON line")
    payload = json.loads(lines[0])
    if not isinstance(payload, dict):
        raise HarnessError("read-only ROS observer response was not an object")
    return payload


def first_start(events_path: Path) -> Optional[dict[str, Any]]:
    """Return the first accepted fake-provider start correlation event."""
    for event in json_log_events(events_path):
        if event.get("event") == "start" and isinstance(event.get("execution_id"), str):
            return event
    return None


def count_starts(events_path: Path) -> int:
    """Count only new accepted executions, excluding replay and refusal requests."""
    return len(provider_start_metrics(events_path)["accepted_execution_ids"])


def provider_start_metrics(events_path: Path) -> dict[str, Any]:
    """Separate all provider start RPC observations from distinct accepted identities."""
    events = json_log_events(events_path)
    accepted = []
    start_requests = 0
    for event in events:
        if event.get("event") in {"start", "replay", "start_refused"}:
            start_requests += 1
        execution_id = event.get("execution_id")
        if event.get("event") == "start" and isinstance(execution_id, str) and execution_id not in accepted:
            accepted.append(execution_id)
    return {"start_request_count": start_requests, "accepted_execution_ids": accepted, "accepted_new_execution_count": len(accepted)}


def croissant_slot_one(inventory: Any) -> Optional[dict[str, Any]]:
    """Extract Rack-A level-1 slot-1 quantities when the API includes that row."""
    if isinstance(inventory, dict):
        rack_area = inventory.get("rackArea")
        if isinstance(rack_area, dict) and rack_area.get("areaId") == "rack_a_level_1_slot_1" and "databaseQuantity" in inventory and "availableQuantity" in inventory:
            return {"areaId": rack_area.get("areaId"), "databaseQuantity": inventory.get("databaseQuantity"), "availableQuantity": inventory.get("availableQuantity")}
        for value in inventory.values():
            found = croissant_slot_one(value)
            if found is not None:
                return found
    if isinstance(inventory, list):
        for value in inventory:
            found = croissant_slot_one(value)
            if found is not None:
                return found
    return None


def require_inventory_deduction(baseline: Any, final: Any, expected: int) -> None:
    """Require the exact platform stock effect for distinct completed orders."""
    before = croissant_slot_one(baseline)
    after = croissant_slot_one(final)
    if before is None or after is None:
        raise HarnessError("Rack-A croissant inventory row is unavailable for deduction check")
    before_quantity = before.get("databaseQuantity")
    after_quantity = after.get("databaseQuantity")
    if not isinstance(before_quantity, int) or not isinstance(after_quantity, int) or before_quantity - after_quantity != expected:
        raise HarnessError("expected inventory deduction %d, observed before=%s after=%s" % (expected, before, after))


def wait_proxy_event(events_path: Path, expected: str, deadline: float) -> dict[str, Any]:
    """Wait for an explicit proxy boundary observation."""
    def lookup() -> Optional[dict[str, Any]]:
        for event in event_log_entries(events_path):
            if event.get("event") == expected:
                return event
        return None
    return wait_for(lookup, deadline, expected)


def full_live_completion_retry_boundary(bridge_log: Path, proxy_events: Path, pending_path: Path, journal_path: Path, execution_id: str) -> Optional[dict[str, Any]]:
    """Require five completed exact-task wire timeouts before a live queued report."""
    entry = journal_entry(journal_path, execution_id)
    if entry is None:
        return None
    outbox = entry.get("completion_outbox") or {}
    identity = outbox.get("identity")
    if not isinstance(identity, dict) or identity.get("execution_id") != execution_id or outbox.get("state") != "pending":
        return None
    session_id, task_id = identity.get("session_id"), identity.get("task_id")
    if not isinstance(session_id, str) or not isinstance(task_id, str):
        return None
    events = json_log_events(bridge_log)
    def matches(row: dict[str, Any]) -> bool:
        payload = row.get("payload")
        return (row.get("component") == "hr_client" and row.get("event_name") == "hr.pick_task_completed"
                and isinstance(payload, dict) and payload.get("pickSessionId") == session_id and payload.get("pickTaskId") == task_id)
    timeouts = [(index, row) for index, row in enumerate(events) if row.get("event") == "socket_call_timeout" and matches(row)]
    exhausted = [(index, row) for index, row in enumerate(events) if row.get("event") == "socket_call_exhausted" and matches(row)
                 and row.get("session_id") == session_id and row.get("task_id") == task_id]
    queued = [(index, row) for index, row in enumerate(events) if row.get("event") == "completion_queued"
              and row.get("component") == "hr_client" and row.get("session_id") == session_id and row.get("task_id") == task_id]
    if not exhausted or not queued:
        return None
    if len(timeouts) != 5 or len(exhausted) != 1 or len(queued) != 1:
        raise HarnessError("live completion retry trace did not contain exactly five full timeouts, one exhaustion and one queue")
    call_ids = [row.get("call_id") for _, row in timeouts]
    if (any(not isinstance(value, str) or not value for value in call_ids) or len(set(call_ids)) != 5
            or any(not isinstance(row.get("duration_ms"), (int, float)) or row["duration_ms"] < 9000 for _, row in timeouts)
            or not (timeouts[-1][0] < exhausted[0][0] < queued[0][0])
            or exhausted[0][1].get("attempts") != 5 or exhausted[0][1].get("failure") != "CallFailure.TIMEOUT"
            or queued[0][1].get("failure") != "CallFailure.TIMEOUT"):
        raise HarnessError("live completion queue was not caused by five distinct full timeout calls")
    forwarded = terminal_report_count(proxy_events)
    if forwarded != 5:
        raise HarnessError("live completion retry boundary did not have exactly five proxy forwards")
    record = completion_record_on_disk(pending_path, execution_id, "pending")
    if record is None or record.get("identity") != identity or record.get("platform_evidence") is not None:
        raise HarnessError("exact client completion was not durably pending after exhausted calls")
    return {"identity": identity, "call_ids": call_ids, "timeout_durations_ms": [row["duration_ms"] for _, row in timeouts],
            "timeout_ts": [row.get("ts") for _, row in timeouts], "exhausted": exhausted[0][1], "queued": queued[0][1],
            "proxy_forwarded": forwarded, "pending_record": record}


def terminal_report_count(events_path: Path) -> int:
    """Count actual bridge-to-server terminal Socket.IO reports seen by the proxy."""
    return sum(entry.get("event") == "terminal_report_forwarded" for entry in event_log_entries(events_path))


def pending_completion_on_disk(path: Path, execution_id: str) -> bool:
    """Require a durable pending report for the exact execution before a crash test."""
    return completion_record_on_disk(path, execution_id, "pending") is not None


def completion_record_on_disk(path: Path, execution_id: str, state: str) -> Optional[dict[str, Any]]:
    """Read a production client record with exact execution and state."""
    if not path.exists():
        return None
    try:
        document = json.loads(path.read_text(encoding="ascii"))
    except (OSError, json.JSONDecodeError):
        return None
    records = document.get("records") if isinstance(document, dict) else None
    if not isinstance(records, list):
        return None
    return next((record for record in records if isinstance(record, dict) and record.get("state") == state and isinstance(record.get("identity"), dict) and record["identity"].get("execution_id") == execution_id), None)


def any_completion_record_on_disk(path: Path, execution_id: str) -> Optional[dict[str, Any]]:
    if not path.is_file():
        return None
    document = json.loads(path.read_text(encoding="ascii"))
    records = document.get("records") if isinstance(document, dict) else None
    if not isinstance(records, list):
        raise HarnessError("client completion store lacks records")
    return next((record for record in records if isinstance(record, dict) and isinstance(record.get("identity"), dict) and record["identity"].get("execution_id") == execution_id), None)


def order_snapshot(api_url: str, order_id: str) -> dict[str, Any]:
    """Fetch one actual platform order for evidence and status assertions."""
    result = request_json("GET", api_url + "/api/orders/" + order_id)
    if not isinstance(result, dict) or result.get("id") != order_id:
        raise HarnessError("order read did not return the created order")
    return result


def require_exact_completion(order: dict[str, Any], entry: dict[str, Any], record: dict[str, Any], execution_id: str) -> None:
    """Bind API read-back, Nova outbox and client callback to one original task."""
    context = entry.get("platform_context")
    outbox = entry.get("completion_outbox")
    identity = outbox.get("identity") if isinstance(outbox, dict) else None
    if not isinstance(context, dict) or not isinstance(identity, dict):
        raise HarnessError("original Nova platform identity is incomplete")
    expected = {"session_id": context.get("session_id"), "task_id": context.get("task_id"), "order_id": order.get("id"), "execution_id": execution_id}
    if any(not isinstance(value, str) or not value for value in expected.values()) or identity != expected or record.get("identity") != expected or entry.get("execution_id") != execution_id or entry.get("order_id") != order.get("id"):
        raise HarnessError("Nova/client original completion identities disagree")
    if entry.get("retry_count") != context.get("retry_count") or entry.get("task_id") != expected["task_id"] or entry.get("session_id") != expected["session_id"]:
        raise HarnessError("Nova retry or task identity differs from original context")
    progress = order.get("fulfillmentProgress")
    session = progress.get("pickSession") if isinstance(progress, dict) else None
    tasks = session.get("tasks") if isinstance(session, dict) else None
    if not isinstance(session, dict) or session.get("sessionId") != expected["session_id"] or not isinstance(tasks, list):
        raise HarnessError("API read-back does not show original session")
    matches = [task for task in tasks if isinstance(task, dict) and task.get("taskId") == expected["task_id"] and task.get("status") == "COMPLETED"]
    if len(matches) != 1:
        raise HarnessError("API read-back does not show exactly one completed original task")
    if record.get("terminal_evidence") != entry.get("terminal_evidence"):
        raise HarnessError("Nova and client controller terminal evidence disagree")
    if record.get("payload") != {"pickSessionId": expected["session_id"], "pickTaskId": expected["task_id"]}:
        raise HarnessError("client completion payload names a different task")
    evidence = record.get("platform_evidence")
    if not isinstance(evidence, dict):
        raise HarnessError("client confirmation lacks platform evidence")
    if evidence.get("eventType") == "platform.pick_session_completed":
        if evidence.get("orderId") != order.get("id") or evidence.get("pickSessionId") != expected["session_id"] or evidence.get("completedPickTasks") != 1 or evidence.get("failedPickTasks") != 0:
            raise HarnessError("platform acknowledgment names a different order or session")
        return
    if evidence.get("id") != order.get("id"):
        raise HarnessError("client read-back names a different order")
    evidence_progress = evidence.get("fulfillmentProgress")
    evidence_session = evidence_progress.get("pickSession") if isinstance(evidence_progress, dict) else None
    evidence_tasks = evidence_session.get("tasks") if isinstance(evidence_session, dict) else None
    if not isinstance(evidence_session, dict) or evidence_session.get("sessionId") != expected["session_id"] or not isinstance(evidence_tasks, list) or not any(isinstance(task, dict) and task.get("taskId") == expected["task_id"] and task.get("status") == "COMPLETED" for task in evidence_tasks):
        raise HarnessError("client confirmation read-back names a different task")


def require_exact_committed_task(order: dict[str, Any], entry: dict[str, Any], execution_id: str) -> None:
    context = entry.get("platform_context")
    outbox = entry.get("completion_outbox")
    identity = outbox.get("identity") if isinstance(outbox, dict) else None
    if not isinstance(context, dict) or not isinstance(identity, dict) or entry.get("execution_id") != execution_id or identity.get("execution_id") != execution_id or identity.get("order_id") != order.get("id") or identity.get("session_id") != context.get("session_id") or identity.get("task_id") != context.get("task_id"):
        raise HarnessError("committed task does not match Nova original identity")
    session = order.get("fulfillmentProgress", {}).get("pickSession")
    tasks = session.get("tasks") if isinstance(session, dict) else None
    if not isinstance(session, dict) or session.get("sessionId") != identity["session_id"] or not isinstance(tasks, list) or not any(isinstance(task, dict) and task.get("taskId") == identity["task_id"] and task.get("status") == "COMPLETED" for task in tasks):
        raise HarnessError("pre-close Platform commit names a different task")


def nova_device(payload: Any) -> Optional[dict[str, Any]]:
    """Locate the Nova device entry in an admin response without changing it."""
    if isinstance(payload, dict):
        if payload.get("deviceId") == DEVICE_ID:
            return payload
        for value in payload.values():
            device = nova_device(value)
            if device is not None:
                return device
    if isinstance(payload, list):
        for value in payload:
            device = nova_device(value)
            if device is not None:
                return device
    return None


def paused_nova_device(api_url: str) -> Optional[dict[str, Any]]:
    """Fetch the actual admin device snapshot before checking the PAUSED hold."""
    device = nova_device(request_json("GET", api_url + "/api/admin/devices"))
    return device if isinstance(device, dict) and device.get("state") == "PAUSED" else None


def free_devices_snapshot(api_url: str) -> Optional[Any]:
    response = request_json("GET", api_url + "/api/admin/devices")
    device = nova_device(response)
    return response if isinstance(device, dict) and device.get("state") == "FREE" else None


def require_exact_start_count(events_path: Path, expected: int, description: str) -> None:
    """Reject repeated RPC starts even when a provider deduplicates execution IDs."""
    metrics = provider_start_metrics(events_path)
    actual = metrics["accepted_new_execution_count"]
    if actual != expected or metrics["start_request_count"] != expected:
        raise HarnessError("%s expected exactly %d total starts and distinct IDs, observed %s" % (description, expected, metrics))


def run_case(arguments: argparse.Namespace) -> Path:
    """Run one fault boundary, retaining all evidence and never auto-cancelling errors."""
    require_paths(arguments)
    runtime = arguments.runtime_dir.resolve()
    if runtime.exists() and any(runtime.iterdir()):
        raise HarnessError("runtime directory must be new and empty: %s" % runtime)
    runtime.mkdir(parents=True)
    api_manifest = json.loads(arguments.api_manifest.read_text(encoding="ascii"))
    if api_manifest.get("database_name") != arguments.database_name or api_manifest.get("port") != urlparse(arguments.api_url).port or not isinstance(api_manifest.get("pid"), int) or not isinstance(api_manifest.get("start_time_ticks"), int):
        raise HarnessError("API manifest does not bind requested database, port, PID and start ticks")
    stat_path = Path("/proc") / str(api_manifest["pid"]) / "stat"
    if not stat_path.is_file() or int(stat_path.read_text(encoding="ascii").split()[21]) != api_manifest["start_time_ticks"]:
        raise HarnessError("owned API process PID/start tick changed")
    write_json(runtime / "api-manifest.json", api_manifest)
    if arguments.source_profile == "current-canonical":
        write_json(runtime / "nova-source-manifest.json", {"profile": "current-canonical", "source": str(arguments.bridge_source.resolve()), "commit": CURRENT_NOVA_COMMIT, "files": source_manifest(arguments.bridge_source)})
    else:
        write_json(runtime / "nova-source-manifest.json", json.loads(arguments.nova_source_manifest.read_text(encoding="ascii")))
    evidence_path = runtime / "harness-events.jsonl"
    proxy_events = runtime / "proxy-events.jsonl"
    control_path = runtime / "proxy-control.json"
    status_control_path = runtime / "provider-status-control.json"
    write_json(status_control_path, {"mode": "pass"})
    provider_log = runtime / "provider.log"
    bridge_log = runtime / "bridge.log"
    proxy_log = runtime / "proxy.log"
    journal_path = runtime / "bridge-journal.json"
    pending_completions_path = runtime / "pending-completions.json"
    pending_failures_path = pending_completions_path.with_name(pending_completions_path.stem + "-failures" + pending_completions_path.suffix)
    if pending_failures_path.exists():
        raise HarnessError("fresh case failure store already exists")
    write_json(runtime / "client-store-paths.json", {"pending_completions": str(pending_completions_path), "pending_failures_derived": str(pending_failures_path), "derivation": "HrClient from explicit PendingCompletionStore when HrSettings pending_failures omitted"})
    config_path = runtime / "platform_bridge.recovery.json"
    sequence = 1
    write_json(control_path, {"sequence": sequence, "mode": "hold_after_terminal" if arguments.case in {"lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart"} else "pass"})
    make_bridge_config(arguments, config_path, journal_path, pending_completions_path)
    baseline_queue = request_json("GET", arguments.api_url + "/api/admin/order-queue")
    if not queue_is_clean(baseline_queue):
        raise HarnessError("dedicated API queue must be clean before creating a recovery order")
    baseline_inventory = request_json("GET", arguments.api_url + "/api/inventory")
    append_event(evidence_path, "baseline", queue=baseline_queue, inventory=baseline_inventory, croissant_slot_one=croissant_slot_one(baseline_inventory), selected_bridge_source=str(arguments.bridge_source.resolve()), selected_bridge_source_sha256=source_manifest(arguments.bridge_source), platform_client_source=str(arguments.platform_client_source.resolve()), platform_client_source_sha256=source_manifest(arguments.platform_client_source), fixture_source_sha256={name: hash_file(PROJECT_ROOT / name) for name in ("tools/nova5_socket_recovery_harness.py", "tools/bridge_websocket_transport_entrypoint.py", "tools/socketio_fault_proxy.py", "sim_ros/fake_bread_pick_service.py", "config/platform_bridge.sim.json")}, generated_config_sha256=hash_file(config_path), database_name=arguments.database_name, ros_domain_id=arguments.ros_domain_id, case=arguments.case, label=arguments.label)
    provider = provider_process(arguments, provider_log, status_control_path)
    proxy = proxy_process(arguments, control_path, proxy_events, proxy_log)
    boundary = arguments.case if arguments.case in {"terminal-before-client-queue", "confirmed-before-callback"} else ""
    marker = runtime / "test-boundary.json"
    bridge = bridge_process(arguments, config_path, bridge_log, boundary, marker)
    processes = [provider, proxy, bridge]
    order: Optional[dict[str, Any]] = None
    follow_up: Optional[dict[str, Any]] = None
    try:
        provider.start()
        wait_for_with_processes(lambda: next((item for item in json_log_events(provider_log) if item.get("event") == "ready"), None), monotonic() + arguments.deadline_seconds, "fake ROS provider readiness", [provider])
        proxy.start()
        wait_for_with_processes(lambda: next((item for item in event_log_entries(proxy_events) if item.get("event") == "listening"), None), monotonic() + arguments.deadline_seconds, "proxy listening", [provider, proxy])
        bridge.start()
        loaded_identity = wait_for(lambda: next((event for event in json_log_events(bridge_log) if event.get("event") == "test_source_identity"), None), monotonic() + arguments.deadline_seconds, "bridge loaded source identity")
        require_loaded_source_identity(loaded_identity, arguments)
        write_json(runtime / "loaded-source-identity.json", loaded_identity)
        append_event(evidence_path, "loaded_source_identity", modules=loaded_identity["modules"])
        wait_for_with_processes(lambda: next((item for item in event_log_entries(proxy_events) if item.get("event") == "upgrade_complete"), None), monotonic() + arguments.deadline_seconds, "bridge Socket.IO upgrade", [provider, proxy, bridge])
        order = create_order(arguments.api_url, arguments.label + " first")
        append_event(evidence_path, "first_order_created", order_id=order["id"])
        start = wait_for(lambda: first_start(provider_log), monotonic() + arguments.deadline_seconds, "accepted fake-provider start")
        execution_id = start["execution_id"]
        append_event(evidence_path, "provider_start", execution_id=execution_id, provider_start_metrics=provider_start_metrics(provider_log))
        deadline = monotonic() + max(arguments.deadline_seconds, 85.0 if arguments.case in {"lost-terminal-ack-queued", "abrupt-queued-report-restart"} else arguments.deadline_seconds)
        if arguments.case == "disconnect-after-start":
            sequence += 1
            write_json(control_path, {"sequence": sequence, "mode": "pass", "action": "close_active_connection"})
            wait_proxy_event(proxy_events, "connection_closed", deadline)
        elif arguments.case in {"bridge-restart", "late-success-recovery", "readiness-false", "readiness-unavailable", "identity-mismatch", "identity-missing"}:
            bridge.stop()
            append_event(evidence_path, "bridge_stopped_after_start", execution_id=execution_id)
            wait_for(lambda: next((item for item in json_log_events(provider_log) if item.get("event") == "terminal" and item.get("execution_id") == execution_id), None), deadline, "provider terminal result while bridge is stopped")
            observed = observe_ros_status(arguments, execution_id, runtime / "ros-status-observer.log")
            if observed.get("execution_id") != execution_id or observed.get("state") != 2 or observed.get("robot_ready") is not True:
                raise HarnessError("independent ROS observer did not confirm terminal success after bridge restart boundary: %s" % observed)
            append_event(evidence_path, "provider_status_after_bridge_stop", status=observed)
            if arguments.case in {"readiness-false", "readiness-unavailable", "identity-mismatch", "identity-missing"}:
                if arguments.case == "readiness-false":
                    run_recovery_cli(arguments, config_path, execution_id, runtime / "initial-recovery-cli.json")
                before_negative = durable_snapshot(runtime, journal_path, pending_completions_path, "before-negative-recovery")
                if arguments.case in {"readiness-false", "identity-mismatch"}:
                    write_json(status_control_path, {"mode": arguments.case})
                elif arguments.case == "readiness-unavailable":
                    provider.stop()
                requested_id = "missing-" + execution_id if arguments.case == "identity-missing" else execution_id
                refusal = run_recovery_cli(arguments, config_path, requested_id, runtime / "negative-recovery-cli.json", expect_success=False)
                refusal_text = refusal["stdout"] + refusal["stderr"]
                expected_reason = {"readiness-false": "not ready", "readiness-unavailable": "unavailable", "identity-mismatch": "mismatched", "identity-missing": "absent from the journal"}[arguments.case]
                if expected_reason not in refusal_text:
                    raise HarnessError("negative CLI refused for a different reason: %s" % refusal_text)
                after_negative = durable_snapshot(runtime, journal_path, pending_completions_path, "after-negative-recovery")
                if not same_durable_contents(before_negative, after_negative):
                    raise HarnessError("refused negative recovery changed durable evidence")
                require_exact_start_count(provider_log, 1, "negative recovery")
                follow_up = create_order(arguments.api_url, arguments.label + " held follow-up")
                bridge = bridge_process(arguments, config_path, bridge_log)
                processes[-1] = bridge
                bridge.start()
                wait_for_with_processes(lambda: True if len([item for item in event_log_entries(proxy_events) if item.get("event") == "upgrade_complete"]) >= 2 else None, monotonic() + max(arguments.deadline_seconds, 15.0), "negative bridge reconnect", [bridge, proxy])
                sleep(min(3.0, arguments.deadline_seconds))
                held_order = order_snapshot(arguments.api_url, follow_up["id"])
                original_order = order_snapshot(arguments.api_url, order["id"])
                held_device = paused_nova_device(arguments.api_url)
                if held_order.get("status") != "QUEUED" or held_device is None or original_order.get("status") == "FAILED":
                    raise HarnessError("negative recovery did not preserve an actionable hold")
                if original_order.get("status") == "READY":
                    confirmed_entry = journal_entry(journal_path, execution_id)
                    confirmed_record = completion_record_on_disk(pending_completions_path, execution_id, "confirmed")
                    if confirmed_entry is None or confirmed_entry.get("platform_confirmation") is None or confirmed_record is None or confirmed_record.get("callback_acknowledged") is not True:
                        raise HarnessError("reported original success lacks durable exact confirmation")
                    require_exact_completion(original_order, confirmed_entry, confirmed_record, execution_id)
                require_exact_start_count(provider_log, 1, "negative recovery after bridge restart")
                result = {"case": arguments.case, "status": "expected_refusal", "execution_id": execution_id, "cli": refusal, "before": before_negative, "after": after_negative, "held_stores": durable_snapshot(runtime, journal_path, pending_completions_path, "final-negative-hold"), "original_order": original_order, "held_follow_up": held_order, "held_device": held_device, "provider_start_metrics": provider_start_metrics(provider_log)}
                write_json(runtime / "result.json", result)
                append_event(evidence_path, "negative_case_complete", **result)
                return runtime / "result.json"
            before_recovery = durable_snapshot(runtime, journal_path, pending_completions_path, "before-recovery-cli")
            recovery = run_recovery_cli(arguments, config_path, execution_id, runtime / "recovery-cli.json")
            after_recovery = durable_snapshot(runtime, journal_path, pending_completions_path, "after-recovery-cli")
            recovered = journal_entry(journal_path, execution_id)
            if recovered is None or recovered.get("terminal_state") != "COMPLETED" or recovered.get("completion_outbox", {}).get("state") != "pending" or recovered.get("recovery") is None:
                raise HarnessError("Nova recovery did not durably preserve exact success and pending outbox")
            append_event(evidence_path, "recovery_cli_completed", before=before_recovery, after=after_recovery, cli=recovery, journal_entry=recovered)
            bridge = bridge_process(arguments, config_path, bridge_log)
            processes[-1] = bridge
            bridge.start()
            wait_for(lambda: len([entry for entry in event_log_entries(proxy_events) if entry.get("event") == "upgrade_complete"]) >= 2, deadline, "bridge reconnect after process restart")
            journal_text = journal_path.read_text(encoding="utf-8") if journal_path.exists() else ""
            if execution_id not in journal_text:
                raise HarnessError("restart case journal did not retain the dispatched execution id")
            wait_for(lambda: entry if (entry := journal_entry(journal_path, execution_id)) is not None and entry.get("platform_confirmation") is not None else None, deadline, "durable callback after recovered bridge startup")
            append_event(evidence_path, "restart_completion_confirmed", journal_entry=journal_entry(journal_path, execution_id), device=nova_device(request_json("GET", arguments.api_url + "/api/admin/devices")))
        elif arguments.case == "cancel-late-success":
            cancellation = request_json("PATCH", arguments.api_url + "/api/orders/" + order["id"] + "/status", {"status": "CANCELLED"})
            append_event(evidence_path, "order_cancelled_after_dispatch", cancellation=cancellation)
        elif arguments.case in {"terminal-before-client-queue", "confirmed-before-callback"}:
            wait_for_with_processes(lambda: json.loads(marker.read_text(encoding="ascii")) if marker.is_file() else None, deadline, "test-only durable boundary", [provider, proxy, bridge])
            before = durable_snapshot(runtime, journal_path, pending_completions_path, "before-crash")
            recorded = journal_entry(journal_path, execution_id)
            if recorded is None or recorded.get("terminal_state") != "COMPLETED" or recorded.get("completion_outbox", {}).get("state") != "pending":
                raise HarnessError("boundary lacks genuine Nova terminal and pending outbox")
            pending_before = pending_completion_on_disk(pending_completions_path, execution_id)
            if arguments.case == "terminal-before-client-queue" and any_completion_record_on_disk(pending_completions_path, execution_id) is not None:
                raise HarnessError("client report already existed at terminal-before-queue boundary")
            if arguments.case == "confirmed-before-callback":
                confirmed_before = completion_record_on_disk(pending_completions_path, execution_id, "confirmed")
                if confirmed_before is None or confirmed_before.get("callback_acknowledged") is not False:
                    raise HarnessError("client confirmation was not durable with callback unacknowledged before boundary")
                if recorded.get("platform_confirmation") is not None:
                    raise HarnessError("Nova callback was already recorded before callback boundary")
            append_event(evidence_path, "test_boundary_observed", boundary=arguments.case, marker=json.loads(marker.read_text(encoding="ascii")), before=before, journal_entry=recorded)
            bridge.kill()
            append_event(evidence_path, "bridge_killed_at_test_boundary", execution_id=execution_id)
            bridge = bridge_process(arguments, config_path, bridge_log)
            processes[-1] = bridge
            bridge.start()
            wait_for(lambda: len([entry for entry in event_log_entries(proxy_events) if entry.get("event") == "upgrade_complete"]) >= 2, deadline, "bridge reconnect after test boundary")
            wait_for(lambda: entry if (entry := journal_entry(journal_path, execution_id)) is not None and entry.get("platform_confirmation") is not None else None, deadline, "Nova callback replay after test boundary")
            append_event(evidence_path, "test_boundary_replayed", after=durable_snapshot(runtime, journal_path, pending_completions_path, "after-replay"), journal_entry=journal_entry(journal_path, execution_id))
        if arguments.case in {"lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart"}:
            wait_proxy_event(proxy_events, "terminal_report_forwarded", deadline)
            wait_proxy_event(proxy_events, "terminal_response_withheld", deadline)
            committed = wait_for(lambda: completed_snapshot_or_none(order_snapshot(arguments.api_url, order["id"])), deadline, "server committed terminal task before acknowledgement drop")
            committed_entry = journal_entry(journal_path, execution_id)
            if committed_entry is None:
                raise HarnessError("Nova terminal outbox is absent at Platform commit boundary")
            require_exact_committed_task(committed, committed_entry, execution_id)
            append_event(evidence_path, "server_commit_observed_before_ack_drop", order=committed)
            if arguments.case in {"lost-terminal-ack-queued", "abrupt-queued-report-restart"}:
                retry_boundary = wait_for(lambda: full_live_completion_retry_boundary(bridge_log, proxy_events, pending_completions_path, journal_path, execution_id), deadline, "five exact full timeouts, live completion_queued, and durable pending client report")
                append_event(evidence_path, "completion_queued_before_ack_drop", retry_boundary=retry_boundary, durable=durable_snapshot(runtime, journal_path, pending_completions_path, "five-timeout-queued"), policy="Socket.IO application responses withheld while Engine.IO heartbeat/control frames continued")
            if arguments.case == "abrupt-queued-report-restart":
                wait_for(lambda: True if pending_completion_on_disk(pending_completions_path, execution_id) else None, deadline, "durable pending completion before abrupt restart")
                append_event(evidence_path, "durable_pending_completion_observed", pending_completions_path=str(pending_completions_path), execution_id=execution_id)
                bridge.kill()
                append_event(evidence_path, "bridge_killed_after_queued_completion", execution_id=execution_id)
                sequence += 1
                write_json(control_path, {"sequence": sequence, "mode": "pass"})
                bridge = bridge_process(arguments, config_path, bridge_log)
                processes[-1] = bridge
                bridge.start()
                wait_for(lambda: len([entry for entry in event_log_entries(proxy_events) if entry.get("event") == "upgrade_complete"]) >= 2, deadline, "bridge reconnect after abrupt queued-report restart")
                append_event(evidence_path, "bridge_restarted_after_queued_completion", execution_id=execution_id)
            else:
                sequence += 1
                write_json(control_path, {"sequence": sequence, "mode": "pass", "action": "close_active_connection"})
                wait_proxy_event(proxy_events, "connection_closed", deadline)
            if arguments.case == "lost-terminal-ack-queued":
                wait_for(lambda: "completion_replay" if "completion_replay" in bridge_log.read_text(encoding="utf-8", errors="replace") else None, deadline, "queued completion replay after reconnect")
                wait_for(lambda: terminal_report_count(proxy_events) if terminal_report_count(proxy_events) == 6 else None, deadline, "one actual completion replay report after reconnect")
                replay_response = wait_proxy_event(proxy_events, "terminal_response_forwarded", deadline)
                append_event(evidence_path, "completion_replay_observed_after_reconnect", terminal_report_count=terminal_report_count(proxy_events), server_response=replay_response, response_interpretation="captured without assuming a particular terminal-state error code")
        if arguments.case == "cancel-late-success":
            wait_for(lambda: next((item for item in json_log_events(provider_log) if item.get("event") == "terminal" and item.get("execution_id") == execution_id), None), deadline, "late provider terminal after cancellation")
        if arguments.case in {"connected-control", "disconnect-after-start", "lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart", "late-success-recovery", "bridge-restart", "terminal-before-client-queue", "confirmed-before-callback"}:
            first_snapshot = wait_for(lambda: completed_snapshot_or_none(order_snapshot(arguments.api_url, order["id"])), deadline, "first terminal platform state")
        else:
            first_snapshot = order_snapshot(arguments.api_url, order["id"])
        append_event(evidence_path, "first_order_snapshot", order=first_snapshot, provider_start_metrics=provider_start_metrics(provider_log))
        require_exact_start_count(provider_log, 1, "first recovery boundary")
        if arguments.case == "cancel-late-success":
            progress = first_snapshot.get("fulfillmentProgress") if isinstance(first_snapshot, dict) else None
            if first_snapshot.get("status") != "CANCELLED" or (isinstance(progress, dict) and progress.get("pickSession") is not None):
                raise HarnessError("cancellation did not leave a cancelled order without a fulfillment session: %s" % first_snapshot)
            late_rejection = wait_for(lambda: "PICK_SESSION_NOT_FOUND" if "PICK_SESSION_NOT_FOUND" in bridge_log.read_text(encoding="utf-8", errors="replace") else None, deadline, "bridge late completion rejection after cancellation")
            append_event(evidence_path, "late_completion_rejected_after_cancellation", rejection=late_rejection)
        if arguments.check_next_order:
            follow_up = create_order(arguments.api_url, arguments.label + " follow-up")
            append_event(evidence_path, "follow_up_order_created", order_id=follow_up["id"], prior_provider_start_metrics=provider_start_metrics(provider_log))
            follow_up_deadline = monotonic() + arguments.deadline_seconds
            if arguments.case == "cancel-late-success":
                sleep(min(3.0, arguments.deadline_seconds))
                held = order_snapshot(arguments.api_url, follow_up["id"])
                held_inventory = request_json("GET", arguments.api_url + "/api/inventory")
                held_device = paused_nova_device(arguments.api_url)
                held_record = completion_record_on_disk(pending_completions_path, execution_id, "operator_hold")
                held_entry = journal_entry(journal_path, execution_id)
                if held.get("status") != "QUEUED" or held_device is None or held_record is None or held_entry is None or held_entry.get("platform_confirmation") is not None:
                    raise HarnessError("cancellation did not produce the original operator reporting hold")
                require_inventory_deduction(baseline_inventory, held_inventory, 0)
                append_event(evidence_path, "follow_up_hold_observed", order=held, inventory=held_inventory, device=held_device, client_record=held_record, journal_entry=held_entry, before=durable_snapshot(runtime, journal_path, pending_completions_path, "before-operator-resolution"))
                require_exact_start_count(provider_log, 1, "cancellation hold")
                bridge.stop()
                resolution = run_recovery_cli(arguments, config_path, execution_id, runtime / "operator-resolution-cli.json", True)
                resolved = journal_entry(journal_path, execution_id)
                if resolved is None or resolved.get("platform_confirmation") is not None or resolved.get("operator_resolution", {}).get("actor") != arguments.operator or resolved.get("operator_resolution", {}).get("reason") != arguments.reason:
                    raise HarnessError("operator resolution did not preserve audit without fabricating platform confirmation")
                append_event(evidence_path, "operator_resolution_recorded", cli=resolution, journal_entry=resolved, after=durable_snapshot(runtime, journal_path, pending_completions_path, "after-operator-resolution"))
                repeated = run_recovery_cli(arguments, config_path, execution_id, runtime / "operator-resolution-repeat-cli.json", True)
                if journal_entry(journal_path, execution_id).get("operator_resolution") != resolved["operator_resolution"]:
                    raise HarnessError("repeat recovery changed immutable first operator audit")
                append_event(evidence_path, "operator_resolution_repeat_preserved_audit", cli=repeated)
                bridge = bridge_process(arguments, config_path, bridge_log)
                processes[-1] = bridge
                bridge.start()
                wait_for(lambda: len([entry for entry in event_log_entries(proxy_events) if entry.get("event") == "upgrade_complete"]) >= 2, follow_up_deadline, "bridge reconnect after operator resolution")
            if arguments.case in {"connected-control", "disconnect-after-start", "lost-terminal-ack", "lost-terminal-ack-queued", "abrupt-queued-report-restart", "late-success-recovery", "bridge-restart", "terminal-before-client-queue", "confirmed-before-callback", "cancel-late-success"}:
                expected_starts = 2
                wait_for(lambda: count_starts(provider_log) if count_starts(provider_log) == expected_starts else None, follow_up_deadline, "exactly one distinct follow-up provider start")
                require_exact_start_count(provider_log, expected_starts, "follow-up recovery boundary")
                follow_up_snapshot = wait_for(lambda: completed_snapshot_or_none(order_snapshot(arguments.api_url, follow_up["id"])), follow_up_deadline, "follow-up terminal platform state")
                append_event(evidence_path, "follow_up_terminal_observed", order=follow_up_snapshot, provider_start_metrics=provider_start_metrics(provider_log))
        final_inventory = request_json("GET", arguments.api_url + "/api/inventory")
        if arguments.check_next_order:
            require_inventory_deduction(baseline_inventory, final_inventory, 1 if arguments.case == "cancel-late-success" else 2)
        final_entry = journal_entry(journal_path, execution_id)
        if final_entry is None or final_entry.get("completion_outbox", {}).get("state") != ("operator_resolved" if arguments.case == "cancel-late-success" else "confirmed"):
            raise HarnessError("Nova journal callback did not settle to the required state")
        if arguments.case != "cancel-late-success" and final_entry.get("platform_confirmation") is None:
            raise HarnessError("Nova journal lacks durable platform confirmation")
        if arguments.case == "cancel-late-success" and final_entry.get("platform_confirmation") is not None:
            raise HarnessError("operator resolution fabricated platform confirmation")
        pending_state = "operator_resolved" if arguments.case == "cancel-late-success" else "confirmed"
        final_record = completion_record_on_disk(pending_completions_path, execution_id, pending_state)
        if final_record is None or final_record.get("callback_acknowledged") is not True:
            raise HarnessError("client completion callback is not durably acknowledged")
        if arguments.case != "cancel-late-success":
            require_exact_completion(order_snapshot(arguments.api_url, order["id"]), final_entry, final_record, execution_id)
        final_queue = request_json("GET", arguments.api_url + "/api/admin/order-queue")
        final_devices = wait_for(lambda: free_devices_snapshot(arguments.api_url), monotonic() + arguments.deadline_seconds, "Nova FREE device after callback settlement")
        if follow_up is not None:
            starts = provider_start_metrics(provider_log)["accepted_execution_ids"]
            if len(starts) != 2 or starts[0] != execution_id or starts[1] == execution_id:
                raise HarnessError("follow-up did not have a distinct second provider execution")
            follow_entry = wait_for(lambda: item if (item := journal_entry(journal_path, starts[1])) is not None and item.get("completion_outbox", {}).get("state") == "confirmed" and item.get("platform_confirmation") is not None else None, monotonic() + arguments.deadline_seconds, "follow-up Nova callback confirmation")
            follow_record = wait_for(lambda: item if (item := completion_record_on_disk(pending_completions_path, starts[1], "confirmed")) is not None and item.get("callback_acknowledged") is True else None, monotonic() + arguments.deadline_seconds, "follow-up client callback acknowledgment")
            follow_up_snapshot = order_snapshot(arguments.api_url, follow_up["id"])
            require_exact_completion(follow_up_snapshot, follow_entry, follow_record, starts[1])
            if follow_up_snapshot.get("status") != "READY":
                raise HarnessError("follow-up order did not settle READY")
        expected_original_status = "CANCELLED" if arguments.case == "cancel-late-success" else "READY"
        final_first_order = wait_for(lambda: snapshot if (snapshot := order_snapshot(arguments.api_url, order["id"])).get("status") == expected_original_status else None, monotonic() + arguments.deadline_seconds, "final original order status " + expected_original_status)
        device = nova_device(final_devices)
        if not isinstance(device, dict) or device.get("state") != "FREE":
            raise HarnessError("Nova device did not settle FREE without a reporting hold")
        final_stores = durable_snapshot(runtime, journal_path, pending_completions_path, "final")
        write_json(runtime / "final-api-snapshot.json", {"first_order": final_first_order, "follow_up_order": follow_up_snapshot if follow_up else None, "inventory": final_inventory, "queue": final_queue, "devices": final_devices})
        ack_drop_mode = "queued_after_retry_exhaustion" if arguments.case == "lost-terminal-ack-queued" else "immediate_after_commit" if arguments.case == "lost-terminal-ack" else None
        summary = {"case": arguments.case, "ack_drop_mode": ack_drop_mode, "first_order_id": order["id"], "follow_up_order_id": follow_up["id"] if follow_up else None, "provider_start_metrics": provider_start_metrics(provider_log), "baseline_croissant_slot_one": croissant_slot_one(baseline_inventory), "final_croissant_slot_one": croissant_slot_one(final_inventory), "selected_bridge_source": str(arguments.bridge_source.resolve()), "selected_bridge_source_sha256": source_manifest(arguments.bridge_source), "platform_client_source": str(arguments.platform_client_source.resolve()), "platform_client_source_sha256": source_manifest(arguments.platform_client_source), "database_name": arguments.database_name, "ros_domain_id": arguments.ros_domain_id, "journal_path": str(journal_path), "pending_completions_path": str(pending_completions_path), "final_stores": final_stores, "proxy_events_path": str(proxy_events), "bridge_log_path": str(bridge_log), "provider_log_path": str(provider_log)}
        write_json(runtime / "result.json", summary)
        append_event(evidence_path, "case_complete", **summary)
        return runtime / "result.json"
    except BaseException as exc:
        failure = {"status": "failed", "case": arguments.case, "first_order_id": order.get("id") if order else None, "follow_up_order_id": follow_up.get("id") if follow_up else None, "provider_start_metrics": provider_start_metrics(provider_log), "error_type": type(exc).__name__, "message": str(exc), "journal_path": str(journal_path), "proxy_events_path": str(proxy_events), "bridge_log_path": str(bridge_log), "provider_log_path": str(provider_log)}
        write_json(runtime / "result.json", failure)
        append_event(evidence_path, "case_failed", **failure)
        raise
    finally:
        for process in reversed(processes):
            process.stop()
        for process in processes:
            if process.owner_manifest is not None and process.owner_manifest.is_file() and json.loads(process.owner_manifest.read_text(encoding="ascii")).get("ownership_mismatch"):
                raise HarnessError("owned process PID/start-tick mismatch during cleanup: " + process.name)


def main() -> int:
    """Run one requested fault case and print only its isolated result path."""
    arguments = parse_arguments()
    result_path = run_case(arguments)
    print(str(result_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
