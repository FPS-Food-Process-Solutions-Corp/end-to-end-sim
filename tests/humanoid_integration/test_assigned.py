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

    def _events(self, directory):
        return [json.loads(line) for line in (directory / "events.jsonl").read_text(encoding="ascii").splitlines()]
