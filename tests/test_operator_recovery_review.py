"""Independent no-service review of operator recovery transaction integrity."""

import asyncio
from pathlib import Path
import sys
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_operator_recovery as primary

from humanoid_harness.controller import Harness
from humanoid_harness.integration.executor import (
    HumanoidPickExecutor, assignment_identity, default_config, unit_digest)
from humanoid_harness.operator_recovery import (
    inspect_state, release_hold, RecoveryInterrupted)
from humanoid_harness.storage import StateError, read_json, write_json
from tests.humanoid_integration.fixtures import task_context


def released(tmp_path):
    root, source, unit, proof, args = primary._fixture(tmp_path)
    primary._confirm(root, proof, args["identity"])
    args = primary._refresh(root, source, args)
    result = release_hold(root, source, **args)
    assert result["status"] == "complete"
    return root, source, unit, args, result


def test_completed_uuid_cannot_be_reused_with_changed_intent(tmp_path):
    root, source, unit, args, result = released(tmp_path)
    files = [root / name for name in ("operator-recovery.json",
                                      "device-owner.json", "device-readiness.json")]
    before = [path.read_bytes() for path in files]
    with pytest.raises(StateError, match="conflicts with immutable operator request"):
        release_hold(root, source, **{**args, "reason": "a different operator intent"})
    assert [path.read_bytes() for path in files] == before
    replay = release_hold(root, source, **args)
    assert replay["historical_replay"] is True
    assert replay["current_state_not_rechecked"] is True
    assert replay["action_id"] == result["action_id"]
    assert [path.read_bytes() for path in files] == before


def test_partial_release_refuses_newer_owner_context(tmp_path):
    root, source, unit, proof, args = primary._fixture(tmp_path)
    primary._confirm(root, proof, args["identity"])
    args = primary._refresh(root, source, args)
    with pytest.raises(RecoveryInterrupted):
        release_hold(root, source, crash_after="readiness", **args)
    owner_path = root / "device-owner.json"
    owner = read_json(owner_path)
    owner["reason"] = "newer independent owner context"
    write_json(owner_path, owner)
    before = owner_path.read_bytes()
    with pytest.raises(StateError):
        release_hold(root, source, **args)
    assert owner_path.read_bytes() == before
    assert read_json(owner_path)["status"] == "hold"


def test_ordinary_executor_recognizes_offline_release_without_motion(tmp_path):
    root, source, unit, args, result = released(tmp_path)
    device_before = (unit / "device.json").read_bytes()
    controller_before = (unit / "controller.json").read_bytes()
    executor = HumanoidPickExecutor(root)
    try:
        executor.reconcile_active()
        assert executor._owner["status"] == "idle"
        assert executor.recovery_hold_spec() is None
        assert executor._current_release_valid() is True
        assert inspect_state(root, source)["readiness"]["status"] == "ready"
    finally:
        asyncio.run(executor.drain())
    assert (unit / "device.json").read_bytes() == device_before
    assert (unit / "controller.json").read_bytes() == controller_before


def test_incomplete_owner_commit_blocks_launcher_until_audited_retry(tmp_path):
    root, source, unit, proof, args = primary._fixture(tmp_path)
    primary._confirm(root, proof, args["identity"])
    args = primary._refresh(root, source, args)
    with pytest.raises(RecoveryInterrupted):
        release_hold(root, source, crash_after="owner", **args)
    assert read_json(root / "device-owner.json")["status"] == "idle"
    assert read_json(root / "device-readiness.json")["status"] == "ready"
    with pytest.raises(StateError, match="operator"):
        executor = HumanoidPickExecutor(root)
        try:
            executor.reconcile_active()
        finally:
            asyncio.run(executor.drain())
    completed = release_hold(root, source, **args)
    assert completed["status"] == "complete"
    executor = HumanoidPickExecutor(root)
    try:
        executor.reconcile_active()
        assert executor._current_release_valid() is True
    finally:
        asyncio.run(executor.drain())


def test_different_action_cannot_overtake_incomplete_release(tmp_path):
    root, source, unit, proof, args = primary._fixture(tmp_path)
    primary._confirm(root, proof, args["identity"])
    args = primary._refresh(root, source, args)
    with pytest.raises(RecoveryInterrupted):
        release_hold(root, source, crash_after="intent", **args)
    journal_path = root / "operator-recovery.json"
    before = journal_path.read_bytes()
    competing = primary._refresh(root, source, args)
    with pytest.raises(StateError, match="resume"):
        release_hold(root, source, **competing)
    assert journal_path.read_bytes() == before
    assert read_json(root / "device-owner.json")["status"] == "hold"
    assert release_hold(root, source, **args)["status"] == "complete"


def test_new_action_uses_fresh_unsafe_probe_instead_of_prior_safe_proof(tmp_path):
    root = tmp_path / "state"
    ctx = task_context()
    def config_factory(task):
        config = default_config(task)
        config["faults"] = [
            {"task_id": task.task_id, "kind": "post_place_ready_check",
             "occurrence": 1, "outcome": "motion_busy"},
            {"task_id": task.task_id, "kind": "post_place_ready_check",
             "occurrence": 3, "outcome": "motion_busy"},
        ]
        return config
    async def perform():
        executor = HumanoidPickExecutor(root, config_factory=config_factory)
        try:
            return await executor.run(ctx, primary._noop_progress)
        finally:
            await executor.drain()
    assert asyncio.run(perform()).status.value == "COMPLETED"
    identity = assignment_identity(ctx)
    unit = root / "units" / unit_digest(identity)
    controller = read_json(unit / "controller.json")
    harness = Harness(unit, controller["config"], resume=True, assigned=True)
    try:
        earlier = harness.operator_probe_post_place_release("earlier-independent-action")
    finally:
        harness.close()
    assert earlier["readiness_observation"]["observation_version"] == 2
    device_before = read_json(unit / "device.json")
    from hr_client import client as client_module
    source = Path(client_module.__file__).resolve().parent.parent
    primary._manifest(root, source)
    primary._confirm(root, controller["physical_proof"], identity)
    owner = read_json(root / "device-owner.json")
    view = inspect_state(root, source)
    args = {"action_id": str(uuid4()), "operator": "operator-b",
            "reason": "fresh third observation required", "identity": identity,
            "hold_id": owner["recovery_hold"]["hold_id"],
            "place_execution_id": controller["physical_proof"]["place_execution_id"],
            "expected_inspection_sha256": view["inspection_sha256"]}
    with pytest.raises(RecoveryInterrupted):
        release_hold(root, source, crash_after="probe-start", **args)
    assert read_json(root / "operator-recovery.json")["actions"][args["action_id"]]["stage"] == "probing"
    assert identity["task_id"] + ":3" not in read_json(unit / "device.json")["release_readiness_observations"]
    result = release_hold(root, source, **args)
    assert result["status"] == "refused"
    assert read_json(root / "device-owner.json") == owner
    assert read_json(root / "device-readiness.json")["status"] == "unknown"
    device_after = read_json(unit / "device.json")
    assert device_after["world"] == device_before["world"]
    assert device_after["executions"] == device_before["executions"]
    observation = device_after["release_readiness_observations"][identity["task_id"] + ":3"]
    assert observation["observation_version"] == 3
    assert observation["motion_quiescent"] is False
