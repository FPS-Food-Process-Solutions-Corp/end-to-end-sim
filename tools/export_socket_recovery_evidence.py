"""Copy selected isolated recovery evidence into the repository without secrets."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_RUNTIME_ROOT = PROJECT_ROOT / ".local"
DESTINATION_ROOT = PROJECT_ROOT / "docs/verification/2026-09-22-combined-nova-client-recovery"
SAFE_FILENAMES = ("result.json", "driver-events.jsonl", "fixture-source-manifest.json", "harness-events.jsonl", "proxy-events.jsonl", "proxy.log", "api.log", "api-cleanup.json", "bridge.log", "provider.log", "bridge-journal.json", "pending-completions.json", "loaded-source-identity.json", "ros-status-observer.log", "api-manifest.json", "nova-source-manifest.json", "platform_bridge.recovery.json", "initial-recovery-cli.json", "recovery-cli.json", "negative-recovery-cli.json", "operator-resolution-cli.json", "operator-resolution-repeat-cli.json", "test-boundary.json", "provider-status-control.json", "final-api-snapshot.json")
SNAPSHOT_SUFFIXES = ("-snapshot.json", "-bridge-journal.json", "-pending-completions.json")
FIXTURE_FILENAMES = ("nova5_socket_recovery_harness.py", "bridge_websocket_transport_entrypoint.py", "export_socket_recovery_evidence.py", "fake_bread_pick_service.py", "test_nova5_socket_recovery_harness.py", "test_export_socket_recovery_evidence.py", "combined_case_driver.py")


def parse_arguments() -> argparse.Namespace:
    """Require one isolated case runtime and a new portable evidence name."""
    parser = argparse.ArgumentParser(description="Export selected socket-recovery evidence without environment or configuration files.")
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--name", required=True, help="Lowercase evidence directory name using letters, digits, and hyphens.")
    return parser.parse_args()


def validated_name(value: str) -> str:
    """Keep the destination a simple new child directory."""
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
        raise ValueError("evidence name must use lowercase letters, digits, and single hyphens")
    return value


def ensure_local_runtime(path: Path) -> Path:
    """Refuse paths outside the disposable local recovery runtime root."""
    resolved = path.resolve()
    try:
        resolved.relative_to(LOCAL_RUNTIME_ROOT.resolve())
    except ValueError as exc:
        raise ValueError("source runtime must be below %s" % LOCAL_RUNTIME_ROOT) from exc
    if not resolved.is_dir():
        raise ValueError("source runtime does not exist: %s" % resolved)
    return resolved


def sha256(path: Path) -> str:
    """Record an integrity hash for each exported artifact."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(source: Path, name: str) -> Path:
    """Copy only selected public evidence files and create a portable index."""
    source = ensure_local_runtime(source)
    name = validated_name(name)
    result = source / "result.json"
    if not result.is_file():
        raise ValueError("source runtime has no result.json")
    destination = DESTINATION_ROOT / name
    if destination.exists():
        raise ValueError("destination already exists: %s" % destination)
    destination.mkdir(parents=True)
    artifacts = []
    selected = [source / filename for filename in SAFE_FILENAMES]
    selected.extend(candidate for candidate in sorted(source.iterdir()) if candidate.is_file() and candidate.name.startswith(("before-", "after-", "final-")) and candidate.name.endswith(SNAPSHOT_SUFFIXES))
    selected.extend(source / "fixture-source" / filename for filename in FIXTURE_FILENAMES)
    for candidate in selected:
        if not candidate.is_file():
            continue
        filename = candidate.name
        copied = destination / filename
        shutil.copy2(candidate, copied)
        artifacts.append({"sourceFilename": str(candidate.relative_to(source)), "portableFilename": filename, "sha256": sha256(copied), "bytes": copied.stat().st_size})
    (destination / "index.json").write_text(json.dumps({"sourceRuntimeName": source.name, "sourceRuntimePath": str(source), "portableDirectory": str(destination.relative_to(PROJECT_ROOT)), "excluded": ["proxy-control.json", "*.env", "process environment"], "artifacts": artifacts}, indent=2, sort_keys=True) + "\n", encoding="ascii")
    return destination


def main() -> int:
    """Export one evidence directory and print its repository path."""
    arguments = parse_arguments()
    print(export(arguments.source_runtime, arguments.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
