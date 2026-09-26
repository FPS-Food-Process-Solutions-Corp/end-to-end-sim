"""No-service safety checks for the operator recovery acceptance fixture."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import e2e_operator_recovery_case as operator


IDENTITY = {"order_id": "order", "session_id": "session", "task_id": "task", "counter": 2}
HOLD = {"place_execution_id": "place", "hold_id": "sim-placement/token"}


def test_fault_profiles_are_distinct_and_task_bound():
    unknown = operator.faults("task", "operator-unknown-retract")
    ready = operator.faults("task", "operator-motion-busy-release")
    assert unknown == {"task": [{"task_id": "task", "kind": "post_place_retract",
                                  "occurrence": 1, "outcome": "unknown"}]}
    assert ready["task"][0]["outcome"] == "success"
    assert ready["task"][1] == {"task_id": "task", "kind": "post_place_ready_check",
                                 "occurrence": 1, "outcome": "motion_busy"}
    with pytest.raises(ValueError):
        operator.faults("task", "unsupported")


def test_retract_gate_distinguishes_unknown_from_completed_motion_busy(tmp_path):
    state = tmp_path / "state"
    unit = state / "units" / "unit"
    unit.mkdir(parents=True)
    from e2e_held_placement_case import write
    execution = {"execution_id": "retract", "task_id": "task",
                 "kind": "post_place_retract", "occurrence": 1,
                 "status": "UNKNOWN", "effect_applied": False}
    write(unit / "device.json", {"executions": {"retract": execution},
                                 "world": {}, "release_readiness_observations": {}})
    assert operator.retract_evidence(state, "task", "operator-unknown-retract") == execution
    with pytest.raises(RuntimeError):
        operator.retract_evidence(state, "task", "operator-motion-busy-release")
    execution["status"] = "COMPLETED"
    execution["effect_applied"] = True
    first = {"motion_quiescent": False, "observation_version": 1,
             "recovery_execution_id": "retract"}
    write(unit / "device.json", {"executions": {"retract": execution},
                                 "world": {}, "release_readiness_observations": {"task:1": first}})
    assert operator.retract_evidence(state, "task", "operator-motion-busy-release") == execution
    with pytest.raises(RuntimeError):
        operator.retract_evidence(state, "task", "operator-unknown-retract")


def test_fresh_probe_gate_rejects_reused_motion_busy_observation(tmp_path):
    from e2e_held_placement_case import write
    before = tmp_path / "before" / "units" / "unit"
    after = tmp_path / "after" / "units" / "unit"
    before.mkdir(parents=True)
    after.mkdir(parents=True)
    first = {"motion_quiescent": False, "observation_version": 1}
    write(before / "device.json", {"release_readiness_observations": {"task:1": first}})
    write(after / "device.json", {"release_readiness_observations": {"task:1": first}})
    with pytest.raises(RuntimeError):
        operator.ready_observation(before.parents[1], after.parents[1], "task")
    second = {"motion_quiescent": True, "navigation_safe": True,
              "placement_verified": True, "observation_version": 2}
    write(after / "device.json", {"release_readiness_observations": {"task:1": first, "task:2": second}})
    assert operator.ready_observation(before.parents[1], after.parents[1], "task") == 2


def test_action_selection_carries_exact_identity_and_inspection():
    args = operator.action_args(IDENTITY, HOLD, "a" * 64, "uuid")
    assert args == ("--action-id", "uuid", "--operator", operator.ACTOR,
                    "--reason", operator.REASON, "--order-id", "order",
                    "--session-id", "session", "--task-id", "task",
                    "--counter", "2", "--place-execution-id", "place",
                    "--hold-id", "sim-placement/token",
                    "--expected-inspection-sha256", "a" * 64)
