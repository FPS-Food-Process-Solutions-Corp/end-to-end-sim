"""No-service operator recovery over genuine saved simulator evidence."""

import asyncio
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import uuid

import pytest

from hr_client.pending_completion import (CompletionIdentity, CompletionState,
                                          PendingCompletionStore, Reconciliation,
                                          ReconciliationKind)
from humanoid_harness.integration.executor import (HumanoidPickExecutor,
                                                    assignment_identity, default_config,
                                                    unit_digest)
from humanoid_harness.operator_recovery import (PINNED, RecoveryInterrupted,
                                                inspect_state, reconcile_report,
                                                release_hold)
from humanoid_harness.storage import StateError, StateLock, read_json, write_json
from tests.humanoid_integration.fixtures import task_context


async def _noop_progress(_subtask, _percent):
    return None


def _manifest(root, source):
    files = {}
    for name in PINNED:
        path = source / "hr_client" / name
        raw = path.read_bytes()
        files[name] = {"path": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
                       "normalized_sha256": hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()}
    write_json(root / "integration-manifest.json", {
        "schema": 2, "client_source": str(source), "device_id": "humanoid_robot",
        "simulator": "humanoid_harness.StubDevice/1", "pinned_sources": files,
        "loaded_sources": {"hr_client." + name[:-3]: value for name, value in files.items()},
        "readback_url": "http://127.0.0.1:18002", "socket_url": "http://127.0.0.1:18001",
        "settings_source": str(source / "hr_client" / "config" / "hr_settings.json")})


def _fixture(tmp_path, fault_kind="post_place_ready_check", fault_outcome="motion_busy"):
    from hr_client import client as client_module
    source = Path(client_module.__file__).resolve().parent.parent
    root = tmp_path / "state"
    ctx = task_context()
    def config_factory(task):
        value = default_config(task)
        value["faults"] = [{"task_id": task.task_id, "kind": fault_kind,
                            "occurrence": 1, "outcome": fault_outcome}]
        return value
    async def perform():
        executor = HumanoidPickExecutor(root, config_factory=config_factory)
        try:
            return await executor.run(ctx, _noop_progress)
        finally:
            await executor.drain()
    outcome = asyncio.run(perform())
    assert outcome.status.value == "COMPLETED"
    owner = read_json(root / "device-owner.json")
    assert owner["status"] == "hold"
    identity = assignment_identity(ctx)
    unit = root / "units" / unit_digest(identity)
    proof = read_json(unit / "controller.json")["physical_proof"]
    _manifest(root, source)
    view = inspect_state(root, source)
    args = {"action_id": str(uuid.uuid4()), "operator": "operator-a",
            "reason": "verified recovery observation", "identity": identity,
            "hold_id": owner["recovery_hold"]["hold_id"],
            "place_execution_id": proof["place_execution_id"],
            "expected_inspection_sha256": view["inspection_sha256"]}
    return root, source, unit, proof, args


def _order(identity):
    return {"id": identity["order_id"], "fulfillmentProgress": {
        "pickSession": {"sessionId": identity["session_id"], "tasks": [
            {"taskId": identity["task_id"], "status": "COMPLETED"}]}}}


def _confirm(root, proof, identity):
    key = CompletionIdentity(identity["session_id"], identity["task_id"],
                             identity["order_id"], proof["place_execution_id"])
    store = PendingCompletionStore(str(root / "pending-completions.json"))
    saved = store.queue(key, {"pickSessionId": identity["session_id"],
                              "pickTaskId": identity["task_id"]}, proof)
    store.update(saved, state=CompletionState.CONFIRMED, platform_evidence=_order(identity))
    return key


def _refresh(root, source, args):
    return {**args, "action_id": str(uuid.uuid4()),
            "expected_inspection_sha256": inspect_state(root, source)["inspection_sha256"]}


def test_inspection_is_offline_and_does_not_create_business_state(tmp_path):
    root, source, _, _, args = _fixture(tmp_path)
    before = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in root.rglob("*") if path.is_file()}
    view = inspect_state(root, source)
    after = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in root.rglob("*") if path.is_file()}
    assert before == after
    assert view["offline_saved_snapshot"] is True
    assert view["physical"]["hold_id"] == args["hold_id"]
    assert view["report"]["state"] is None
    assert view["readiness"]["status"] == "unknown"
    assert view["allowed_actions"]["release_hold"]["allowed"] is False
    with pytest.raises(StateError):
        inspect_state(tmp_path / "absent", source)


def test_missing_pending_completion_is_sent_once_through_report_only_client(tmp_path, monkeypatch):
    root, source, unit, proof, args = _fixture(tmp_path)
    assert not (root / "pending-completions.json").exists()
    before = read_json(unit / "device.json")
    calls = []
    async def readback(_url, _key):
        return Reconciliation(ReconciliationKind.RETRYABLE)
    async def send(saved_root, _manifest_doc, completion, terminal, hold_id, _url,
                   socket_url=None):
        calls.append((completion, terminal, hold_id))
        store = PendingCompletionStore(str(saved_root / "pending-completions.json"))
        current = store.get(completion)
        store.update(current, state=CompletionState.CONFIRMED,
                     platform_evidence=_order(args["identity"]), attempts=1)
    monkeypatch.setattr("humanoid_harness.operator_recovery.read_order_completion", readback)
    monkeypatch.setattr("humanoid_harness.operator_recovery._send_saved_completion", send)
    result = reconcile_report(root, source, api_url="http://127.0.0.1:18002", **args)
    assert result["status"] == "complete"
    assert len(calls) == 1 and calls[0][1] == proof and calls[0][2] == args["hold_id"]
    assert read_json(unit / "device.json") == before
    assert read_json(root / "device-owner.json")["status"] == "hold"
    assert read_json(root / "device-readiness.json")["status"] == "unknown"
    assert PendingCompletionStore(str(root / "pending-completions.json")).records()[0].attempts == 1
    prior = (root / "operator-recovery.json").read_bytes()
    replay = reconcile_report(root, source, api_url="http://127.0.0.1:18002", **args)
    assert replay["historical_replay"] is True and replay["current_state_not_rechecked"] is True
    assert (root / "operator-recovery.json").read_bytes() == prior and len(calls) == 1


def test_unknown_retract_refuses_release_with_original_effects_unchanged(tmp_path):
    root, source, unit, proof, args = _fixture(tmp_path, "post_place_retract", "unknown")
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    before = read_json(unit / "device.json")
    result = release_hold(root, source, **args)
    assert result["status"] == "refused"
    assert read_json(unit / "device.json") == before
    assert read_json(root / "device-owner.json")["status"] == "hold"


@pytest.mark.parametrize("boundary", ["intent", "probe-start", "probe", "readiness", "owner"])
def test_release_crash_repairs_same_action_without_motion(tmp_path, boundary):
    root, source, unit, proof, args = _fixture(tmp_path)
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    before_device = read_json(unit / "device.json")
    with pytest.raises(RecoveryInterrupted):
        release_hold(root, source, crash_after=boundary, **args)
    interrupted_version = read_json(unit / "device.json")["observations"].get(
        args["identity"]["task_id"] + ":post_place_ready_check")
    with pytest.raises(StateError, match="Incomplete operator recovery"):
        HumanoidPickExecutor(root)
    result = release_hold(root, source, **args)
    assert result["status"] == "complete"
    assert read_json(root / "device-owner.json")["status"] == "idle"
    ready = read_json(root / "device-readiness.json")
    assert ready["status"] == "ready" and ready["observation_version"] > 1
    after_device = read_json(unit / "device.json")
    if boundary not in ("intent", "probe-start"):
        assert after_device["observations"][args["identity"]["task_id"] + ":post_place_ready_check"] == interrupted_version
    assert after_device["world"] == before_device["world"]
    assert after_device["executions"] == before_device["executions"]
    assert len(read_json(root / "operator-recovery.json")["actions"]) == 1
    async def restart():
        executor = HumanoidPickExecutor(root)
        try:
            assert executor._current_release_valid()
        finally:
            await executor.drain()
    asyncio.run(restart())


def test_stale_selection_and_busy_locks_never_probe(tmp_path):
    root, source, unit, proof, args = _fixture(tmp_path)
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    assert release_hold(root, source, **{**args, "place_execution_id": "wrong"})["status"] == "refused"
    assert read_json(root / "device-owner.json")["status"] == "hold"
    locked = StateLock(root / ".device.lock")
    locked.acquire()
    try:
        with pytest.raises(StateError):
            release_hold(root, source, **_refresh(root, source, args))
    finally:
        locked.release()
    locked = StateLock(unit / ".harness.lock")
    locked.acquire()
    try:
        with pytest.raises(StateError):
            release_hold(root, source, **_refresh(root, source, args))
    finally:
        locked.release()


def test_report_readback_confirmed_without_new_socket_send(tmp_path, monkeypatch):
    root, source, unit, proof, args = _fixture(tmp_path)
    calls = []
    async def readback(_url, _key):
        return Reconciliation(ReconciliationKind.CONFIRMED, evidence=_order(args["identity"]))
    async def send(*_arguments):
        calls.append("send")
    monkeypatch.setattr("humanoid_harness.operator_recovery.read_order_completion", readback)
    monkeypatch.setattr("humanoid_harness.operator_recovery._send_saved_completion", send)
    result = reconcile_report(root, source, api_url="http://127.0.0.1:18002", **args)
    assert result["status"] == "complete" and calls == []
    records = PendingCompletionStore(str(root / "pending-completions.json")).records()
    assert len(records) == 1 and records[0].attempts == 0
    assert read_json(root / "device-owner.json")["status"] == "hold"


def test_pending_terminal_conflict_refuses_without_report(tmp_path, monkeypatch):
    root, source, unit, proof, args = _fixture(tmp_path)
    key = CompletionIdentity(args["identity"]["session_id"], args["identity"]["task_id"],
                             args["identity"]["order_id"], proof["place_execution_id"])
    PendingCompletionStore(str(root / "pending-completions.json")).queue(
        key, {"pickSessionId": key.session_id, "pickTaskId": key.task_id}, {"wrong": True})
    args = _refresh(root, source, args)
    async def forbidden(*_arguments):
        raise AssertionError("No API call or report is allowed for terminal conflict")
    monkeypatch.setattr("humanoid_harness.operator_recovery.read_order_completion", forbidden)
    monkeypatch.setattr("humanoid_harness.operator_recovery._send_saved_completion", forbidden)
    assert reconcile_report(root, source, api_url="http://127.0.0.1:18002", **args)["status"] == "refused"
    assert read_json(root / "device-owner.json")["status"] == "hold"


def test_stale_snapshot_identity_token_and_source_are_fail_closed(tmp_path):
    root, source, unit, proof, args = _fixture(tmp_path)
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    stale = {**args, "action_id": str(uuid.uuid4()), "expected_inspection_sha256": "0" * 64}
    assert release_hold(root, source, **stale)["status"] == "refused"
    wrong = _refresh(root, source, args)
    wrong["identity"] = {**wrong["identity"], "task_id": "another-task"}
    assert release_hold(root, source, **wrong)["status"] == "refused"
    wrong = _refresh(root, source, args)
    wrong["hold_id"] = "sim-placement/" + "0" * 64
    assert release_hold(root, source, **wrong)["status"] == "refused"
    saved = read_json(root / "integration-manifest.json")
    saved["loaded_sources"]["hr_client.client"]["sha256"] = "0" * 64
    write_json(root / "integration-manifest.json", saved)
    with pytest.raises(StateError):
        inspect_state(root, source)
    with pytest.raises(StateError):
        release_hold(root, source, **_refresh(root, source, args))
    assert read_json(root / "device-owner.json")["status"] == "hold"
    async def ordinary_restart():
        executor = HumanoidPickExecutor(root)
        await executor.drain()
    asyncio.run(ordinary_restart())


def test_replayed_action_id_conflict_cannot_change_actor_or_identity(tmp_path):
    root, source, unit, proof, args = _fixture(tmp_path, "post_place_retract", "unknown")
    first = release_hold(root, source, **args)
    assert first["status"] == "refused"
    before = (root / "operator-recovery.json").read_bytes()
    with pytest.raises(StateError):
        release_hold(root, source, **{**args, "operator": "different-actor"})
    with pytest.raises(StateError):
        reconcile_report(root, source, api_url="http://127.0.0.1:18002", **args)
    assert (root / "operator-recovery.json").read_bytes() == before


def test_cli_json_inspection_exposes_copyable_exact_fields(tmp_path, capsys):
    from humanoid_harness.recovery import main
    root, source, unit, proof, args = _fixture(tmp_path)
    capsys.readouterr()
    code = main(["inspect", "--state-root", str(root), "--client-source", str(source),
                 "--format", "json"])
    assert code == 0
    view = json.loads(capsys.readouterr().out)
    assert view["physical"]["hold_id"] == args["hold_id"]
    assert view["physical"]["place_execution_id"] == args["place_execution_id"]
    assert view["inspection_sha256"] == args["expected_inspection_sha256"]
    code = main(["inspect", "--state-root", str(root), "--client-source", str(source)])
    assert code == 0
    human = capsys.readouterr().out
    assert "Saved offline inspection" in human
    assert "--expected-inspection-sha256" in human


def test_optional_report_proxy_must_match_saved_loopback_endpoint(tmp_path, monkeypatch):
    root, source, unit, proof, args = _fixture(tmp_path)
    calls = []
    async def readback(_url, _key):
        return Reconciliation(ReconciliationKind.RETRYABLE)
    async def send(saved_root, _manifest_doc, completion, terminal, hold_id, _url,
                   socket_url=None):
        calls.append(socket_url)
        store = PendingCompletionStore(str(saved_root / "pending-completions.json"))
        saved = store.get(completion)
        store.update(saved, state=CompletionState.CONFIRMED,
                     platform_evidence=_order(args["identity"]), attempts=1)
    monkeypatch.setattr("humanoid_harness.operator_recovery.read_order_completion", readback)
    monkeypatch.setattr("humanoid_harness.operator_recovery._send_saved_completion", send)
    with pytest.raises(StateError):
        reconcile_report(root, source, api_url="http://127.0.0.1:18002",
                         socket_url="http://127.0.0.1:19001", **args)
    assert not (root / "operator-recovery.json").exists()
    result = reconcile_report(root, source, api_url="http://127.0.0.1:18002",
                              socket_url="http://127.0.0.1:18001", **args)
    assert result["status"] == "complete" and calls == ["http://127.0.0.1:18001"]


@pytest.mark.parametrize("boundary", [None, "probe-start", "probe"])
def test_new_release_action_reobserves_after_preexisting_valid_proof(tmp_path, boundary):
    from humanoid_harness.controller import Harness
    root, source, unit, proof, args = _fixture(tmp_path)
    state = read_json(unit / "controller.json")
    harness = Harness(unit, state["config"], resume=True, assigned=True)
    try:
        prior = harness.operator_probe_post_place_release()
    finally:
        harness.close()
    assert prior["readiness_observation"]["observation_version"] == 2
    assert prior["operator_action_id"] is None
    before_device = read_json(unit / "device.json")
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    if boundary is not None:
        with pytest.raises(RecoveryInterrupted):
            release_hold(root, source, crash_after=boundary, **args)
        interrupted = read_json(unit / "device.json")["observations"][
            args["identity"]["task_id"] + ":post_place_ready_check"]
        assert interrupted == (2 if boundary == "probe-start" else 3)
        assert read_json(root / "device-owner.json")["status"] == "hold"
    result = release_hold(root, source, **args)
    assert result["status"] == "complete"
    current = read_json(unit / "controller.json")["post_place_readiness_proof"]
    assert current["operator_action_id"] == args["action_id"]
    assert current["readiness_observation"]["observation_version"] == 3
    after_device = read_json(unit / "device.json")
    assert after_device["world"] == before_device["world"]
    assert after_device["executions"] == before_device["executions"]
    assert read_json(root / "device-readiness.json")["observation_version"] == 3
    events = (unit / "events.jsonl").read_text(encoding="ascii")
    assert '"observation_version": 2' in events
    assert '"observation_version": 3' in events


def _release_cli_args(root, source, args):
    return ["release-hold", "--state-root", str(root), "--client-source", str(source),
            "--format", "json", "--action-id", args["action_id"],
            "--operator", args["operator"], "--reason", args["reason"],
            "--order-id", args["identity"]["order_id"],
            "--session-id", args["identity"]["session_id"],
            "--task-id", args["identity"]["task_id"],
            "--counter", str(args["identity"]["counter"]),
            "--place-execution-id", args["place_execution_id"],
            "--hold-id", args["hold_id"],
            "--expected-inspection-sha256", args["expected_inspection_sha256"]]


def test_successful_release_cli_keeps_json_stdout_single_and_progress_stderr(tmp_path, capsys):
    from humanoid_harness.recovery import main
    root, source, unit, proof, args = _fixture(tmp_path)
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    capsys.readouterr()
    assert main(_release_cli_args(root, source, args)) == 0
    output = capsys.readouterr()
    result = json.loads(output.out)
    assert result["status"] == "complete"
    assert result["action_id"] == args["action_id"]
    assert output.out.count("\n") == 1
    assert "operator_post_place_readiness_verified" in output.err
    assert "phase" in output.err
    assert read_json(root / "device-owner.json")["status"] == "idle"


def test_refused_release_cli_remains_one_json_result(tmp_path, capsys):
    from humanoid_harness.recovery import main
    root, source, unit, proof, args = _fixture(tmp_path, "post_place_retract", "unknown")
    _confirm(root, proof, args["identity"])
    args = _refresh(root, source, args)
    capsys.readouterr()
    assert main(_release_cli_args(root, source, args)) == 2
    output = capsys.readouterr()
    result = json.loads(output.out)
    assert result["status"] == "refused"
    assert output.out.count("\n") == 1
    assert read_json(root / "device-owner.json")["status"] == "hold"
