"""Black-box acceptance tests for the simulated humanoid pick loop."""

import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path

from humanoid_harness.config import scenario_config
from humanoid_harness.controller import Harness
from humanoid_harness.models import Execution, Result
from humanoid_harness.storage import StateError, write_json
from humanoid_harness.stubs import InjectedCrash, StubDevice, StubPlatform


ROOT = Path(__file__).resolve().parents[2]


class AdapterFacade:
    """Only exposes documented adapter methods, with no ledger state attribute."""

    def __init__(self, delegate):
        self.delegate = delegate
        self.get_calls = 0
        self.cancel_calls = 0

    def submit_navigation(self, execution):
        return self.delegate.submit_navigation(execution)

    def submit_lift_route(self, execution):
        return self.delegate.submit_lift_route(execution)

    def submit_pose(self, execution):
        return self.delegate.submit_pose(execution)

    def submit_pick(self, execution):
        return self.delegate.submit_pick(execution)

    def get_execution(self, execution_id):
        self.get_calls += 1
        return self.delegate.get_execution(execution_id)

    def cancel_execution(self, execution_id):
        self.cancel_calls += 1
        return self.delegate.cancel_execution(execution_id)

    def observe(self, task_id, phase, cycle):
        return self.delegate.observe(task_id, phase, cycle)

    def verify_placement(self, task_id, counter):
        return self.delegate.verify_placement(task_id, counter)

    def report_completion(self, task_id, order_id, session_id, execution_id):
        return self.delegate.report_completion(task_id, order_id, session_id, execution_id)

    def get_report(self, task_id):
        return self.delegate.get_report(task_id)


class IdentityFaultVla(AdapterFacade):
    def __init__(self, delegate, fault_at):
        super().__init__(delegate)
        self.fault_at = fault_at

    def _stale(self, result):
        if result.is_err or result.data is None:
            return result
        return Result.ok(replace(result.data, generation=result.data.generation + 1))

    def submit_pick(self, execution):
        result = super().submit_pick(execution)
        return self._stale(result) if self.fault_at == "submit" else result

    def get_execution(self, execution_id):
        result = super().get_execution(execution_id)
        return self._stale(result) if self.fault_at == "poll" else result

    def cancel_execution(self, execution_id):
        result = super().cancel_execution(execution_id)
        return self._stale(result) if self.fault_at == "cancel" else result


class HarnessAcceptanceTests(unittest.TestCase):
    def run_cli(self, state_dir, scenario, resume=False, config_path=None):
        command = [
            sys.executable,
            "-m",
            "humanoid_harness",
            "--scenario",
            scenario,
            "--state-dir",
            str(state_dir),
        ]
        if resume:
            command.append("--resume")
        if config_path is not None:
            command.extend(("--config", str(config_path)))
        return subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def load_state(self, state_dir):
        return {
            Path(name).stem: json.loads((state_dir / name).read_text(encoding="utf-8"))
            for name in (
                "controller.json",
                "device.json",
                "platform.json",
                "summary.json",
            )
        }

    def load_events(self, state_dir):
        return [
            json.loads(line)
            for line in (state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
            if line
        ]

    def load_visual_frames(self, state_dir):
        html = (state_dir / "world.html").read_text(encoding="ascii")
        match = re.search(r'<script id="frames-data" type="application/json">(.*?)</script>', html, re.DOTALL)
        self.assertIsNotNone(match)
        for control in ('id="prev"', 'id="next"', 'id="play"', 'id="frame"'):
            self.assertIn(control, html)
        return json.loads(match.group(1))

    def assert_world_conservation(self, state):
        config = state["controller"]["config"]
        world = state["device"]["world"]
        initial_count = sum(task["rack"] == "B" for task in config["tasks"]) + sum(config["replacement_stock"].values())
        physical_ids = [bun_id for bun_id in world["rack_bun_ids"].values() if bun_id is not None]
        if world["held_bun_id"] is not None:
            physical_ids.append(world["held_bun_id"])
        physical_ids.extend(bun_id for buns in world["counter_bun_ids"].values() for bun_id in buns)
        physical_ids.extend(world["lost"])
        self.assertEqual(len(physical_ids), len(set(physical_ids)))
        self.assertEqual(len(physical_ids) + sum(world["replacement_stock"].values()), initial_count)
        self.assertFalse(set(world["lost"]) & {bun_id for buns in world["counter_bun_ids"].values() for bun_id in buns})

    def test_device_ledger_prevents_repeat_effect_after_process_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            config = scenario_config("crash-after-place")
            write_json(path, StubDevice.initial(config))
            device = StubDevice(path, config)
            pick = Execution("pick-pastry-001-cycle-1", "pastry-001", "pick", "SIM_PICK", 1, "PENDING")
            place = Execution("place-pastry-001-cycle-1", "pastry-001", "place", "SIM_COUNTER_1", 1, "PENDING")
            self.assertEqual(device.submit_pick(pick).data.status, "COMPLETED")
            with self.assertRaises(InjectedCrash):
                device.submit_pose(place)
            device = StubDevice(path, config)
            self.assertEqual(device.get_execution(place.execution_id).data.status, "COMPLETED")
            self.assertEqual(device.submit_pose(place).data.status, "COMPLETED")
            self.assertEqual(device.state["world"]["counters"]["1"], ["pastry-001"])
            self.assertEqual(device.state["world"]["held_task_id"], None)
            self.assertEqual(len(device.state["executions"]), 2)
            conflicting = Execution(place.execution_id, "pastry-001", "place", "SIM_COUNTER_4", 1, "PENDING")
            self.assertTrue(device.submit_pose(conflicting).is_err)
            self.assertEqual(device.state["world"]["counters"]["4"], [])

    def test_platform_ack_loss_does_not_create_second_completion(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "platform.json"
            config = scenario_config("ack-loss")
            write_json(path, StubPlatform.initial())
            platform = StubPlatform(path, config)
            self.assertTrue(platform.report_completion("pastry-001", "order-100", "session-100", "place-001").is_err)
            platform = StubPlatform(path, config)
            self.assertEqual(platform.get_report("pastry-001").data.status, "ACCEPTED")
            self.assertEqual(platform.report_completion("pastry-001", "order-100", "session-100", "place-001").data, "ACCEPTED")
            self.assertEqual(len(platform.state["reports"]), 1)
            self.assertTrue(platform.report_completion("pastry-001", "order-100", "session-100", "other-place").is_err)

    def test_uncertain_cancellation_never_creates_a_pick_effect(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            config = scenario_config("cancellation-hold")
            write_json(path, StubDevice.initial(config))
            device = StubDevice(path, config)
            pick = Execution("pick-pastry-001-cycle-1", "pastry-001", "pick", "SIM_PICK", 1, "PENDING")
            self.assertEqual(device.submit_pick(pick).data.status, "RUNNING")
            self.assertEqual(device.cancel_execution(pick.execution_id).data.status, "UNKNOWN")
            device = StubDevice(path, config)
            self.assertEqual(device.get_execution(pick.execution_id).data.status, "UNKNOWN")
            self.assertIsNone(device.state["world"]["held_task_id"])
            self.assertTrue(device.state["world"]["rack_buns"]["pastry-001"])

    def test_fresh_run_refuses_unrelated_state_and_resume_binds_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            state_dir.mkdir()
            marker = state_dir / "existing.txt"
            marker.write_text("keep", encoding="ascii")
            with self.assertRaises(StateError):
                Harness(state_dir, scenario_config("happy"))
            self.assertEqual(marker.read_text(encoding="ascii"), "keep")
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            harness = Harness(state_dir, scenario_config("happy"))
            harness.close()
            with self.assertRaises(StateError):
                Harness(state_dir, scenario_config("retries"), resume=True)

    def test_resume_refuses_corrupt_controller_device_or_platform_ledger(self):
        for filename in ("controller.json", "device.json", "platform.json"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                state_dir = Path(temporary) / "run"
                config = scenario_config("happy")
                harness = Harness(state_dir, config)
                harness.close()
                (state_dir / filename).write_text("{broken", encoding="ascii")
                with self.assertRaises(StateError):
                    Harness(state_dir, config, resume=True)

    def test_second_controller_cannot_write_same_state_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            config = scenario_config("happy")
            first = Harness(state_dir, config)
            try:
                with self.assertRaises(StateError):
                    Harness(state_dir, config, resume=True)
            finally:
                first.close()
            resumed = Harness(state_dir, config, resume=True)
            resumed.close()

    def test_resume_distinguishes_unsubmitted_intent_from_missing_dispatched_record(self):
        for dispatch_started, expected_returncode in ((False, 0), (True, 2)):
            with self.subTest(dispatch_started=dispatch_started), tempfile.TemporaryDirectory() as temporary:
                state_dir = Path(temporary) / "run"
                harness = Harness(state_dir, scenario_config("happy"))
                with redirect_stdout(io.StringIO()):
                    harness.step()
                    intent = harness._intent_for("navigate_pick")
                harness.state["intent"]["dispatch_started"] = dispatch_started
                harness._save()
                harness.close()
                result = self.run_cli(state_dir, "happy", resume=True)
                self.assertEqual(result.returncode, expected_returncode, result.stderr)
                state = self.load_state(state_dir)
                count = sum(item["execution_id"] == intent.execution_id for item in state["device"]["executions"].values())
                self.assertEqual(count, 0 if dispatch_started else 1)
                if dispatch_started:
                    self.assertEqual(state["summary"]["phase"], "hold")
                    self.assertEqual(state["summary"]["report_count"], 0)

    def test_replaceable_adapters_expose_only_public_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            harness = Harness(state_dir, scenario_config("happy"))
            harness.amr = AdapterFacade(harness.amr)
            harness.mover = AdapterFacade(harness.mover)
            harness.lift = AdapterFacade(harness.lift)
            harness.vla = AdapterFacade(harness.vla)
            harness.perception = AdapterFacade(harness.perception)
            harness.platform = AdapterFacade(harness.platform)
            self.assertFalse(hasattr(harness.platform, "state"))
            self.assertFalse(hasattr(harness.vla, "state"))
            with redirect_stdout(io.StringIO()):
                summary = harness.run()
            self.assertEqual(summary["phase"], "done")
            self.assertEqual(summary["report_count"], 4)
            self.assertGreater(harness.vla.get_calls, 0)
            self.assertGreater(harness.amr.get_calls, 0)

    def test_stale_submit_poll_or_cancel_identity_holds_without_replay(self):
        for fault_at in ("submit", "poll", "cancel"):
            with self.subTest(fault_at=fault_at), tempfile.TemporaryDirectory() as temporary:
                state_dir = Path(temporary) / "run"
                config = scenario_config("happy")
                if fault_at == "poll":
                    config["faults"] = [{"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "delay", "delay_polls": 2}]
                elif fault_at == "cancel":
                    config["faults"] = [{"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "cancel_unknown"}]
                harness = Harness(state_dir, config)
                harness.vla = IdentityFaultVla(harness.vla, fault_at)
                with redirect_stdout(io.StringIO()):
                    summary = harness.run()
                state = self.load_state(state_dir)
                self.assertEqual(summary["phase"], "hold")
                self.assertEqual(summary["report_count"], 0)
                self.assertEqual(sum(item["task_id"] == "pastry-001" and item["kind"] == "pick" for item in state["device"]["executions"].values()), 1)
                self.assertFalse(any(item["kind"] == "place" for item in state["device"]["executions"].values()))
                self.assertEqual(state["device"]["world"]["counters"]["1"], [])

    def test_false_report_checkpoint_cannot_report_without_physical_place(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            harness = Harness(state_dir, scenario_config("happy"))
            harness.state["phase"] = "report"
            harness.state["active_task_id"] = "pastry-001"
            harness.state["units"]["pastry-001"]["status"] = "active"
            harness._save()
            harness.close()
            result = self.run_cli(state_dir, "happy", resume=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            state = self.load_state(state_dir)
            self.assertEqual(state["summary"]["phase"], "hold")
            self.assertEqual(state["summary"]["report_count"], 0)
            self.assertEqual(state["platform"]["reports"], {})

    def test_happy_loop_reports_each_rack_b_unit_to_its_own_counter(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "happy")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            events = self.load_events(state_dir)
            summary = state["summary"]
            world = state["device"]["world"]
            self.assert_world_conservation(state)
            self.assertEqual(summary["phase"], "done")
            self.assertEqual(summary["report_count"], 4)
            self.assertEqual(set(state["platform"]["reports"]), {f"pastry-{n:03d}" for n in range(1, 5)})
            for number in range(1, 5):
                self.assertEqual(world["counters"][str(number)], [f"pastry-{number:03d}"])
            self.assertEqual(world["location"], "SIM_TAG_FRONT_COUNTER")
            self.assertIsNone(world["held_task_id"])
            self.assertEqual(summary["units"]["pastry-rack-a"], "pending")
            self.assertNotIn("pastry-rack-a", world["rack_buns"])
            self.assertFalse(any(item["task_id"] == "pastry-rack-a" for item in state["device"]["executions"].values()))
            self.assertEqual([item["task_id"] for item in events if item["event"] == "unit_accepted"], [f"pastry-{n:03d}" for n in range(1, 5)])
            html = (state_dir / "world.html").read_text(encoding="utf-8")
            for label in ("SIM_TAG_FRONT_COUNTER", "Counter 4", "pastry-004"):
                self.assertIn(label, html)

    def test_retry_budgets_are_separate_and_do_not_duplicate_placement(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "retries")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            records = list(state["device"]["executions"].values())
            first = [item for item in records if item["task_id"] == "pastry-001"]
            count = lambda kind: sum(item["kind"] == kind for item in first)
            self.assertEqual(count("navigate_pick"), 2)
            self.assertEqual(count("pick"), 3)
            self.assertEqual(count("jolt"), 1)
            self.assertEqual(count("pick_reset"), 1)
            self.assertEqual(count("place"), 1)
            self.assertEqual(state["device"]["world"]["counters"]["1"], ["pastry-001"])
            self.assertEqual(state["summary"]["report_count"], 4)

    def test_partial_fulfillment_excludes_failed_unit_and_rack_a(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "partial")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            summary = state["summary"]
            self.assertEqual(summary["units"]["pastry-002"], "failed")
            self.assertEqual(summary["units"]["pastry-rack-a"], "pending")
            self.assertEqual(summary["orders"]["order-100"]["fulfilled"], 2)
            self.assertEqual(summary["orders"]["order-100"]["failed"], 1)
            self.assertEqual(summary["orders"]["order-300"]["pending_outside_scope"], 1)
            self.assertEqual(set(state["platform"]["reports"]), {"pastry-001", "pastry-003", "pastry-004"})
            self.assertEqual(state["device"]["world"]["counters"]["2"], [])
            self.assertEqual(state["device"]["world"]["counters"]["4"], ["pastry-004"])
            self.assertEqual(sum(item["task_id"] == "pastry-002" and item["kind"] == "pick" for item in state["device"]["executions"].values()), 3)

    def test_configured_counter_target_routes_to_assigned_counter(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_dir = root / "run"
            config_path = root / "config.json"
            config = scenario_config("happy")
            config["placement_targets"]["4"] = "CUSTOM_CELL_4"
            config_path.write_text(json.dumps(config), encoding="ascii")
            result = self.run_cli(state_dir, "happy", config_path=config_path)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            placements = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-004" and item["kind"] == "place"]
            self.assertEqual(len(placements), 1)
            self.assertEqual(placements[0]["target"], "CUSTOM_CELL_4")
            self.assertEqual(state["device"]["world"]["counter_bun_ids"]["4"], ["pastry-004/bun-c0"])
            self.assertEqual(state["summary"]["report_count"], 4)

    def test_confirmed_loss_restarts_rack_path_once_before_placement(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "loss")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            first = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-003"]
            self.assertEqual(sum(item["kind"] == "navigate_pick" for item in first), 2)
            self.assertEqual(sum(item["kind"] == "pick" for item in first), 2)
            self.assertEqual(sum(item["kind"] == "place" for item in first), 1)
            self.assertEqual(state["device"]["world"]["counters"]["3"], ["pastry-003"])
            self.assertEqual(state["device"]["world"]["lost"], ["pastry-003/bun-c0"])
            self.assertEqual(state["device"]["world"]["counter_bun_ids"]["3"], ["pastry-003/bun-c1"])
            self.assertEqual(state["summary"]["units"]["pastry-003"], "complete")
            self.assertEqual(sum(item["event"] == "confirmed_loss" for item in self.load_events(state_dir)), 1)

    def test_replay_frames_match_persisted_world_at_pick_place_and_loss(self):
        for scenario in ("happy", "loss"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as temporary:
                state_dir = Path(temporary) / "run"
                result = self.run_cli(state_dir, scenario)
                self.assertEqual(result.returncode, 0, result.stderr)
                events = self.load_events(state_dir)
                frames = self.load_visual_frames(state_dir)
                self.assertEqual(frames[:len(events)], events)
                pick = next(item for item in events if item["event"] == "pick_verified" and item["task_id"] == "pastry-001")
                self.assertEqual(pick["world"]["held_bun_id"], "pastry-001/bun-c0")
                self.assertEqual(pick["world"]["location"], "SIM_TAG_B_1_1")
                placed = next(item for item in events if item["event"] == "execution_terminal" and "/place/" in item["execution_id"] and item["task_id"] == "pastry-001")
                self.assertEqual(placed["world"]["counter_bun_ids"]["1"], ["pastry-001/bun-c0"])
                self.assertIsNone(placed["world"]["held_bun_id"])
                if scenario == "loss":
                    lost = next(item for item in events if item["event"] == "confirmed_loss" and item["task_id"] == "pastry-003")
                    self.assertEqual(lost["world"]["lost"], ["pastry-003/bun-c0"])
                    self.assertEqual(lost["world"]["rack_bun_ids"]["pastry-003"], "pastry-003/bun-c1")
                    self.assertIsNone(lost["world"]["held_bun_id"])

    def test_crash_after_physical_place_resumes_without_repeating_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            first = self.run_cli(state_dir, "crash-after-place")
            self.assertEqual(first.returncode, 75, first.stderr)
            device_before = json.loads((state_dir / "device.json").read_text(encoding="utf-8"))
            self.assertEqual(device_before["world"]["counters"]["1"], ["pastry-001"])
            second = self.run_cli(state_dir, "crash-after-place", resume=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            first_task = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-001"]
            self.assertEqual(sum(item["kind"] == "place" for item in first_task), 1)
            self.assertEqual(state["device"]["world"]["counters"]["1"], ["pastry-001"])
            self.assertEqual(len(state["platform"]["reports"]), 4)
            self.assertTrue(any(item["event"] == "execution_reconciled" and "/place/" in item["execution_id"] for item in self.load_events(state_dir)))

    def test_device_and_platform_ack_loss_reconcile_distinct_truths(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "ack-loss")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            events = self.load_events(state_dir)
            first = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-001"]
            self.assertEqual(sum(item["kind"] == "place" for item in first), 1)
            self.assertEqual(state["device"]["world"]["counters"]["1"], ["pastry-001"])
            self.assertEqual(len(state["platform"]["reports"]), 4)
            self.assertTrue(any(item["event"] == "ack_unavailable" and "/place/" in item["execution_id"] for item in events))
            self.assertTrue(any(item["event"] == "report_ack_unavailable" and item["task_id"] == "pastry-001" for item in events))

    def test_ambiguous_cancellation_holds_without_place_or_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "cancellation-hold")
            self.assertEqual(result.returncode, 2, result.stderr)
            state = self.load_state(state_dir)
            self.assert_world_conservation(state)
            self.assertEqual(state["summary"]["phase"], "hold")
            self.assertEqual(state["summary"]["units"]["pastry-001"], "held")
            self.assertEqual(state["summary"]["report_count"], 0)
            self.assertEqual(state["device"]["world"]["counters"]["1"], [])
            self.assertIsNone(state["device"]["world"]["held_task_id"])
            self.assertFalse(any(item["kind"] == "place" for item in state["device"]["executions"].values()))
            self.assertTrue(any(item["event"] == "operator_hold" for item in self.load_events(state_dir)))
            before = state["device"]["executions"]
            resumed = self.run_cli(state_dir, "cancellation-hold", resume=True)
            self.assertEqual(resumed.returncode, 2, resumed.stderr)
            after = self.load_state(state_dir)
            self.assertEqual(after["summary"]["phase"], "hold")
            self.assertEqual(after["device"]["executions"], before)
            self.assertEqual(after["platform"]["reports"], {})

    def test_collision_holds_without_retry_or_fulfillment(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "run"
            result = self.run_cli(state_dir, "collision-hold")
            self.assertEqual(result.returncode, 2, result.stderr)
            state = self.load_state(state_dir)
            first = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-001"]
            self.assertEqual(sum(item["kind"] == "pick" for item in first), 1)
            self.assertEqual(sum(item["kind"] == "place" for item in first), 0)
            self.assertEqual(state["summary"]["phase"], "hold")
            self.assertEqual(state["summary"]["report_count"], 0)

    def test_confirmed_cancel_race_retains_pick_effect_then_holds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state_dir = root / "run"
            config_path = root / "config.json"
            config = scenario_config("happy")
            config["faults"] = [{"task_id": "pastry-001", "kind": "pick", "occurrence": 1, "outcome": "cancel_race"}]
            config_path.write_text(json.dumps(config), encoding="ascii")
            result = self.run_cli(state_dir, "happy", config_path=config_path)
            self.assertEqual(result.returncode, 2, result.stderr)
            state = self.load_state(state_dir)
            first = [item for item in state["device"]["executions"].values() if item["task_id"] == "pastry-001"]
            self.assertEqual(sum(item["kind"] == "pick" for item in first), 1)
            self.assertEqual(sum(item["kind"] == "place" for item in first), 0)
            self.assertEqual(state["device"]["world"]["held_task_id"], "pastry-001")
            self.assertEqual(state["device"]["world"]["held_bun_id"], "pastry-001/bun-c0")
            self.assertEqual(state["device"]["world"]["counters"]["1"], [])
            self.assertEqual(state["summary"]["phase"], "hold")
            self.assertEqual(state["summary"]["report_count"], 0)
            self.assertTrue(any(item["event"] == "cancel_race_completed" for item in self.load_events(state_dir)))


if __name__ == "__main__":
    unittest.main()
