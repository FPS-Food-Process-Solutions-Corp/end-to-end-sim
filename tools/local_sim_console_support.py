"""Read-only filesystem adapters for the local simulation console."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping, Sequence, Tuple


DEFAULT_LOG_NAMES: Tuple[Tuple[str, str, str], ...] = (
    ("platform API", "api", "api.log"),
    ("customer web", "web", "web.log"),
    ("platform bridge", "bridge", "bridge.log"),
    ("fake ROS provider", "ros", "ros.log"),
)


@dataclass(frozen=True)
class LogSource:
    """A labeled file whose recent lines the console displays."""

    label: str
    path: Path
    service: str = ""


@dataclass(frozen=True)
class FileView:
    """The result of a read-only file snapshot."""

    path: Path
    lines: Tuple[str, ...]
    error: str = ""


@dataclass(frozen=True)
class JournalEntry:
    """A concise, display-safe bridge or simulator journal record."""

    key: str
    execution_id: str
    terminal_state: str
    robot_ready: bool
    blocks_dispatch: bool
    message: str


@dataclass(frozen=True)
class JournalView:
    """Parsed journal state, including a readable failure instead of a crash."""

    path: Path
    entries: Tuple[JournalEntry, ...]
    error: str = ""


@dataclass(frozen=True)
class ProcessState:
    """A runtime process state proven by PID plus Linux start-time identity."""

    name: str
    status: str
    detail: str


def default_log_sources(runtime_dir: Path) -> Tuple[LogSource, ...]:
    """Return the harness' conventional log names under one runtime directory."""
    return tuple(LogSource(label, runtime_dir / filename, service)
                 for label, service, filename in DEFAULT_LOG_NAMES)


def parse_log_source(specification: str) -> LogSource:
    """Parse ``LABEL=PATH`` without accepting an ambiguous empty component."""
    label, separator, path = specification.partition("=")
    if not separator or not label.strip() or not path.strip():
        raise ValueError("--log must have the form LABEL=PATH")
    return LogSource(label.strip(), Path(path.strip()))


def manifest_log_sources(runtime_dir: Path, manifest_path: Path,
                         fallback_sources: Sequence[LogSource]) -> Tuple[LogSource, ...]:
    """Use manifest log paths only when they remain inside the declared runtime tree."""
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return tuple(fallback_sources)
    if not isinstance(raw, Mapping):
        return tuple(fallback_sources)
    return tuple(_manifest_log_source(runtime_dir, raw, source)
                 for source in fallback_sources)


def manifest_process_names(manifest_path: Path,
                           fallback_names: Sequence[str]) -> Tuple[str, ...]:
    """Display the manifest's actual services, or bridge-mode expectations before startup."""
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return tuple(fallback_names)
    if not isinstance(raw, Mapping):
        return tuple(fallback_names)
    declared = tuple(name for name, record in raw.items()
                     if isinstance(name, str) and isinstance(record, Mapping))
    return declared or tuple(fallback_names)


def default_journal_path(runtime_dir: Path, manifest_path: Path) -> Path:
    """Choose the conventional journal for the active launcher mode."""
    names = manifest_process_names(manifest_path, ())
    if "live-sim" in names and "bridge" not in names:
        return runtime_dir / "live-sim" / "journal.jsonl"
    return runtime_dir / "ros" / "platform_bridge_journal.json"


def _manifest_log_source(runtime_dir: Path, manifest: Mapping[str, Any],
                         source: LogSource) -> LogSource:
    if not source.service:
        return source
    record = manifest.get(source.service)
    if not isinstance(record, Mapping):
        return source
    configured = record.get("log_path")
    if not isinstance(configured, str) or not configured.strip():
        return source
    candidate = Path(configured.strip())
    path = candidate if candidate.is_absolute() else runtime_dir / candidate
    try:
        resolved = path.resolve()
        resolved.relative_to(runtime_dir.resolve())
    except (OSError, ValueError):
        return source
    return LogSource(source.label, resolved, source.service)


def tail_file(path: Path, line_limit: int, byte_limit: int = 131072) -> FileView:
    """Read a bounded recent text tail, never creating or modifying the file."""
    try:
        with path.open("rb") as source:
            source.seek(0, 2)
            size = source.tell()
            source.seek(max(0, size - byte_limit))
            raw = source.read()
    except OSError as exc:
        return FileView(path, (), "unavailable: %s" % exc)
    text = raw.decode("utf-8", errors="replace")
    lines = text.splitlines()
    if size > byte_limit and lines:
        lines[0] = "[older output omitted] " + lines[0]
    return FileView(path, tuple(lines[-max(1, line_limit):]))


def load_journal(path: Path) -> JournalView:
    """Read bridge JSON or simulator JSONL; journal data is never locked or written."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return JournalView(path, (), "unavailable: %s" % exc)
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        return _load_json_lines(path, text)
    if not isinstance(raw, Mapping):
        return JournalView(path, (), "journal JSON must be an object")
    if "execution_id" in raw:
        return JournalView(path, (_entry_from_mapping("line-1", raw),))
    entries = tuple(_entry_from_mapping(str(key), value)
                    for key, value in raw.items())
    return JournalView(path, entries)


def _load_json_lines(path: Path, text: str) -> JournalView:
    entries: List[JournalEntry] = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            return JournalView(path, tuple(entries), "invalid JSONL line %d: %s" %
                               (number, exc.msg))
        entries.append(_entry_from_mapping("line-%d" % number, value))
    return JournalView(path, tuple(entries))


def _entry_from_mapping(key: str, value: Any) -> JournalEntry:
    if not isinstance(value, Mapping):
        return JournalEntry(key, "", "", False, True, "entry is not an object")
    execution_id = _string(value.get("execution_id"))
    terminal_state = _string(value.get("terminal_state"))
    robot_ready = value.get("robot_ready") is True
    recovery = value.get("recovery")
    recovered = isinstance(recovery, Mapping) and bool(recovery)
    blocks_dispatch = not (bool(terminal_state) and (robot_ready or recovered))
    message = _string(value.get("terminal_message") or value.get("failure_reason") or
                      value.get("message"))
    return JournalEntry(key, execution_id, terminal_state, robot_ready,
                        blocks_dispatch, message)


def process_states(manifest_path: Path, names: Sequence[str],
                   proc_root: Path = Path("/proc")) -> Tuple[ProcessState, ...]:
    """Validate manifest PID identities against ``/proc`` without signalling them."""
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except OSError as exc:
        return tuple(ProcessState(name, "unavailable", "manifest unavailable: %s" % exc)
                     for name in names)
    except json.JSONDecodeError as exc:
        return tuple(ProcessState(name, "unavailable", "invalid manifest: %s" % exc.msg)
                     for name in names)
    if not isinstance(raw, Mapping):
        return tuple(ProcessState(name, "unavailable", "manifest must be a JSON object")
                     for name in names)
    return tuple(_process_state(name, raw.get(name), proc_root) for name in names)


def _process_state(name: str, value: Any, proc_root: Path) -> ProcessState:
    if not isinstance(value, Mapping):
        return ProcessState(name, "unavailable", "no manifest record")
    pid = value.get("pid")
    start_time = value.get("start_time_ticks")
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return ProcessState(name, "unavailable", "invalid manifest PID")
    if isinstance(start_time, bool) or not isinstance(start_time, int) or start_time < 0:
        return ProcessState(name, "unavailable", "invalid manifest start_time_ticks")
    actual = process_start_time(proc_root / str(pid) / "stat")
    if actual is None:
        return ProcessState(name, "stopped", "PID %d is not present" % pid)
    if actual != start_time:
        return ProcessState(name, "stale", "PID %d start time differs from manifest" % pid)
    return ProcessState(name, "running", "PID %d start time verified" % pid)


def process_start_time(stat_path: Path) -> int | None:
    """Return Linux ``/proc/PID/stat`` field 22, or ``None`` if it cannot be read."""
    try:
        text = stat_path.read_text(encoding="utf-8")
    except OSError:
        return None
    closing = text.rfind(")")
    if closing < 0:
        return None
    fields = text[closing + 1:].split()
    if len(fields) <= 19:
        return None
    try:
        return int(fields[19])
    except ValueError:
        return None


def journal_lines(view: JournalView, line_limit: int) -> Tuple[str, ...]:
    """Format the most recent journal records for a plain Textual log pane."""
    if view.error:
        return ("journal %s" % view.error,)
    if not view.entries:
        return ("no journal entries yet",)
    lines = []
    for entry in view.entries[-max(1, line_limit):]:
        status = entry.terminal_state or "PENDING"
        ready = "ready" if entry.robot_ready else "not-ready"
        block = "BLOCKING" if entry.blocks_dispatch else "clear"
        identity = entry.execution_id or entry.key
        detail = ("  %s" % entry.message) if entry.message else ""
        lines.append("%s  %s  %s  %s%s" % (identity, status, ready, block, detail))
    return tuple(lines)


def _string(value: Any) -> str:
    return value if isinstance(value, str) else "" if value is None else str(value)
