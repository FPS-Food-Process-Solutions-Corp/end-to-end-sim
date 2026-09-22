"""Assigned physical-unit tests against durable simulated adapters."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path

from humanoid_harness.adapters import StubHumanoidMover
from humanoid_harness.config import scenario_config
from humanoid_harness.controller import Harness
from humanoid_harness.models import Result


def assigned_config(counter=4, faults=None):
    config = scenario_config("happy")
    task = next(task for task in config["tasks"] if task["counter"] == counter)
    config["scenario"] = "assigned-test"
    config["tasks"] = [task]
    config["replacement_stock"] = {task["task_id"]: 1}
    config["faults"] = list(faults or [])
    return config


def read_state(directory):
    return {
        name: json.loads((directory / (name + ".json")).read_text(encoding="ascii"))
        for name in ("controller", "device", "summary")
    }


class StalePlaceReadback:
    def __init__(self, delegate):
        self.delegate = delegate

    def submit_pose(self, execution):
        return self.delegate.submit_pose(execution)

    def get_execution(self, execution_id):
        result = self.delegate.get_execution(execution_id)
        if "/place/" in execution_id and result.is_ok:
            return Result.ok(replace(result.data, generation=result.data.generation + 1))
        return result

    def cancel_execution(self, execution_id):
        return self.delegate.cancel_execution(execution_id)


class StaleFailureRetractReadback(StalePlaceReadback):
    def get_execution(self, execution_id):
        result = self.delegate.get_execution(execution_id)
        if "/failure_retract/" in execution_id and result.is_ok:
            return Result.ok(replace(result.data, generation=result.data.generation + 1))
        return result


class FaultyFailureReadiness:
    def __init__(self, delegate, fault):
        self.delegate = delegate
        self.fault = fault

    def observe(self, task_id, phase, cycle):
        return self.delegate.observe(task_id, phase, cycle)

    def verify_placement(self, task_id, counter):
        return self.delegate.verify_placement(task_id, counter)

    def verify_failure_readiness(self, task_id, cycle, recovery_execution_id, expected_posture):
        result = self.delegate.verify_failure_readiness(task_id, cycle, recovery_execution_id, expected_posture)
        if result.is_err:
            return result
        changes = {
            "stale_version": {"observation_version": 0},
            "wrong_action": {"recovery_execution_id": "unrelated/retract"},
            "wrong_task": {"task_id": "different-task"},
            "wrong_cycle": {"cycle": cycle + 1},
            "held_bun": {"held_task_id": task_id},
            "rack_missing": {"rack_has_bun": False},
            "wrong_posture": {"posture": "SIM_POSE_PRE_PICK"},
            "moving": {"motion_quiescent": False},
            "unsafe_location": {"navigation_safe": False},
        }
        return Result.ok(replace(result.data, **changes[self.fault]))

    def read_failure_source_observation(self, task_id, observation_version):
        return self.delegate.read_failure_source_observation(task_id, observation_version)


class AssignedHarnessTests(unittest.TestCase):
    def test_assigned_unit_ends_at_verified_counter_four_without_local_platform_flow(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "task"
            config = assigned_config()
            with redirect_stdout(io.StringIO()):
                summary = Harness(directory, config, assigned=True).run()
            state = read_state(directory)
            task_id = config["tasks"][0]["task_id"]
            executions = list(state["device"]["executions"].values())
            self.assertEqual(summary["phase"], "done")
            self.assertEqual(summary["units"][task_id], "complete")
            self.assertEqual(state["device"]["world"]["counters"]["4"], [task_id])
            self.assertEqual(state["device"]["world"]["counter_bun_ids"]["4"], [task_id + "/bun-c0"])
            self.assertIsNone(state["device"]["world"]["held_task_id"])
            self.assertEqual(sum(item["kind"] == "place" and item["effect_applied"] for item in executions), 1)
            self.assertFalse(any(item["kind"] == "navigate_idle" for item in executions))
            self.assertFalse((directory / "platform.json").exists())
            self.assertFalse(any(item["event"] == "unit_reported" for item in self._events(directory)))

    def test_unknown_pick_holds_without_place_or_local_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "task"
            config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "pick", "occurrence": 1, "outcome": "unknown"}])
            with redirect_stdout(io.StringIO()):
                summary = Harness(directory, config, assigned=True).run()
            state = read_state(directory)
            self.assertEqual(summary["phase"], "hold")
            self.assertEqual(summary["units"]["pastry-004"], "held")
            self.assertFalse(any(item["kind"] == "place" for item in state["device"]["executions"].values()))
            self.assertEqual(state["device"]["world"]["counters"]["4"], [])
            self.assertFalse((directory / "platform.json").exists())

    def test_safe_no_effect_failure_is_terminal_without_place(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "task"
            config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "navigate_pick", "occurrence": occurrence, "outcome": "fail"} for occurrence in (1, 2)])
            with redirect_stdout(io.StringIO()):
                summary = Harness(directory, config, assigned=True).run()
            state = read_state(directory)
            self.assertEqual(summary["phase"], "done")
            self.assertEqual(summary["units"]["pastry-004"], "failed")
            self.assertEqual(state["device"]["world"]["counters"]["4"], [])
            self.assertFalse(any(item["kind"] == "pick" for item in state["device"]["executions"].values()))
            self.assertFalse((directory / "platform.json").exists())

    def test_stale_place_status_cannot_become_completion_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "task"
            config = assigned_config()
            harness = Harness(directory, config, assigned=True)
            harness.mover = StalePlaceReadback(StubHumanoidMover(harness.device))
            with redirect_stdout(io.StringIO()):
                summary = harness.run()
            state = read_state(directory)
            self.assertEqual(summary["phase"], "hold")
            self.assertIsNone(state["controller"]["physical_proof"])
            self.assertEqual(state["device"]["world"]["counters"]["4"], ["pastry-004"])
            self.assertFalse((directory / "platform.json").exists())

    def test_failure_readiness_rejects_stale_mismatched_or_unsafe_observation(self):
        for fault in ("stale_version", "wrong_action", "wrong_task", "wrong_cycle", "held_bun", "rack_missing", "wrong_posture", "moving", "unsafe_location"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / "task"
                config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "pick", "occurrence": occurrence, "outcome": "fail"} for occurrence in (1, 2, 3)])
                harness = Harness(directory, config, assigned=True)
                harness.perception = FaultyFailureReadiness(harness.perception, fault)
                with redirect_stdout(io.StringIO()):
                    summary = harness.run()
                state = read_state(directory)
                self.assertEqual(summary["phase"], "hold")
                self.assertIsNone(state["controller"]["failure_readiness_proof"])
                self.assertEqual(summary["units"]["pastry-004"], "held")
                self.assertFalse((directory / "platform.json").exists())

    def test_stale_failure_retract_status_never_proves_safe_readiness(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "task"
            config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "pick", "occurrence": occurrence, "outcome": "fail"} for occurrence in (1, 2, 3)])
            harness = Harness(directory, config, assigned=True)
            harness.mover = StaleFailureRetractReadback(StubHumanoidMover(harness.device))
            with redirect_stdout(io.StringIO()):
                summary = harness.run()
            state = read_state(directory)
            self.assertEqual(summary["phase"], "hold")
            self.assertIsNone(state["controller"]["failure_readiness_proof"])
            self.assertEqual(state["device"]["world"]["posture"], "SIM_POSE_TRAVEL")
            self.assertFalse((directory / "platform.json").exists())

    def test_unknown_pick_faults_never_start_failure_retract(self):
        for outcome in ("unknown", "collision", "cancel_unknown"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / "task"
                config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "pick", "occurrence": 1, "outcome": outcome}])
                with redirect_stdout(io.StringIO()):
                    summary = Harness(directory, config, assigned=True).run()
                state = read_state(directory)
                self.assertEqual(summary["phase"], "hold")
                self.assertIsNone(state["controller"]["failure_readiness_proof"])
                self.assertFalse(any(item["kind"] == "failure_retract" for item in state["device"]["executions"].values()))

    def test_failure_retract_ack_loss_uses_saved_action_and_safe_retry_is_bounded(self):
        for recovery_outcome, expected_count in (("drop_ack", 1), ("fail", 2)):
            with self.subTest(recovery_outcome=recovery_outcome), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / "task"
                config = assigned_config(faults=[{"task_id": "pastry-004", "kind": "pick", "occurrence": occurrence, "outcome": "fail"} for occurrence in (1, 2, 3)] + [{"task_id": "pastry-004", "kind": "failure_retract", "occurrence": 1, "outcome": recovery_outcome}])
                with redirect_stdout(io.StringIO()):
                    summary = Harness(directory, config, assigned=True).run()
                state = read_state(directory)
                records = list(state["device"]["executions"].values())
                self.assertEqual(summary["units"]["pastry-004"], "failed")
                self.assertEqual(sum(item["kind"] == "failure_retract" for item in records), expected_count)
                self.assertEqual(sum(item["kind"] == "failure_retract" and item["effect_applied"] for item in records), 1)
                self.assertIsInstance(state["controller"]["failure_readiness_proof"], dict)

    def _events(self, directory):
        return [json.loads(line) for line in (directory / "events.jsonl").read_text(encoding="ascii").splitlines()]
