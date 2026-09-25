"""No-service regression tests for owned API startup cleanup."""

import json
import subprocess
import sys

import pytest

from tools import recovery_api_runtime as runtime


class FakeProcess:
    def __init__(self):
        self.pid = 4242
        self.running = True
        self.terminated = False
        self.killed = False
        self.wait_calls = 0
        self.timeout_once = False

    def poll(self):
        return None if self.running else 0

    def terminate(self):
        self.terminated = True
        self.running = False

    def kill(self):
        self.killed = True
        self.running = False

    def wait(self, timeout):
        self.wait_calls += 1
        if self.timeout_once and self.wait_calls == 1:
            self.running = True
            raise subprocess.TimeoutExpired("fake-node", timeout)
        return 0


@pytest.fixture
def isolated_start(monkeypatch, tmp_path):
    stage = tmp_path / "stage"
    stage.mkdir()
    node = tmp_path / "node"
    node.write_text("", encoding="ascii")
    main = stage / "main.js"
    main.write_text("", encoding="ascii")
    env_file = stage / ".env"
    env_file.write_text("", encoding="ascii")
    monkeypatch.setattr(runtime, "STAGE_API_ROOT", stage)
    monkeypatch.setattr(runtime, "NODE", str(node))
    monkeypatch.setattr(runtime, "API_MAIN", main)
    monkeypatch.setattr(runtime, "STAGE_ENV_PATH", env_file)
    monkeypatch.setattr(runtime, "STAGE_ROOT_ENV_PATH", tmp_path / "missing-env")
    monkeypatch.setattr(runtime, "api_environment", lambda _name, _port: {})
    monkeypatch.setattr(runtime, "ensure_port_available", lambda _port: None)
    monkeypatch.setattr(runtime, "load_manifest", lambda _case, _root: None)
    process = FakeProcess()
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *args, **kwargs: process)
    return process, tmp_path / "run"


def test_missing_start_ticks_stops_and_reaps_only_new_child(isolated_start, monkeypatch, capsys):
    process, root = isolated_start
    monkeypatch.setattr(runtime, "process_start_ticks", lambda _pid: None)
    assert runtime.start("ack", "taska_20260925_test", 3121, root) == 1
    assert process.terminated and process.wait_calls == 1 and not process.killed
    assert not runtime.manifest_path("ack", root).exists()
    assert "could not be identified" in capsys.readouterr().err


def test_manifest_write_failure_stops_new_child_and_preserves_error(isolated_start, monkeypatch):
    process, root = isolated_start
    monkeypatch.setattr(runtime, "process_start_ticks", lambda _pid: 1234)

    def fail_manifest(*_args):
        raise OSError("manifest write failed")

    monkeypatch.setattr(runtime, "write_manifest", fail_manifest)
    with pytest.raises(OSError, match="manifest write failed"):
        runtime.start("ack", "taska_20260925_test", 3121, root)
    assert process.terminated and process.wait_calls == 1
    assert (root / "api-ack.log").is_file()


def test_stop_escalates_only_new_child_after_timeout(isolated_start, monkeypatch):
    process, root = isolated_start
    process.timeout_once = True
    monkeypatch.setattr(runtime, "process_start_ticks", lambda _pid: None)
    assert runtime.start("ack", "taska_20260925_test", 3121, root) == 1
    assert process.terminated and process.killed and process.wait_calls == 2


def test_success_keeps_owned_child_and_records_manifest(isolated_start, monkeypatch):
    process, root = isolated_start
    monkeypatch.setattr(runtime, "process_start_ticks", lambda _pid: 1234)
    assert runtime.start("ack", "taska_20260925_test", 3121, root) == 0
    manifest = json.loads(runtime.manifest_path("ack", root).read_text(encoding="ascii"))
    assert manifest["pid"] == process.pid
    assert manifest["start_time_ticks"] == 1234
    assert manifest["database_name"] == "taska_20260925_test"
    assert not process.terminated and not process.killed and process.wait_calls == 0


def test_existing_owned_process_is_not_restarted_or_stopped(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "load_manifest", lambda _case, _root: {"pid": 9000})
    monkeypatch.setattr(runtime, "is_owned_live", lambda _entry: True)
    monkeypatch.setattr(runtime.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("must not spawn"))
    assert runtime.start("ack", "taska_20260925_test", 3121, tmp_path) == 0


def test_current_date_database_name_remains_valid(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["api", "status", "ack", "--database-name", "taska_20260925_test"])
    assert runtime.parse_arguments().database_name == "taska_20260925_test"
