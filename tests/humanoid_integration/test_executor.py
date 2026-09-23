"""Public client executor contract and durable physical ownership tests."""

import asyncio
import io
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from argparse import Namespace
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hr_client.client import HumanoidRobotClient, PickExecutionOutcome, PickExecutionStatus
from hr_client import locations as locations_module
from hr_client.locations import AmrTarget, CounterLocation, LocationTable
from hr_client.models import PickSubtask
from hr_client.pending_completion import CompletionIdentity, CompletionState, PendingCompletionStore
from hr_client.robot_claim import RobotClaim
from hr_client.settings import HrSettings
from platform_common.pose_library import PoseLibrary

from humanoid_harness.integration import HumanoidPickExecutor
from humanoid_harness.integration import __main__ as launcher_module
from humanoid_harness.integration.__main__ import ensure_startup_ready, simulation_locations
from humanoid_harness.integration import executor as executor_module
from humanoid_harness.integration.executor import assignment_identity, default_config, unit_digest
from humanoid_harness.storage import StateError

from tests.humanoid_integration.fixtures import faulty_config, task_context
from tests.humanoid_integration.failure_crash_driver import config_factory as failure_crash_config


class PublicCompletionClient:
    def __init__(self):
        self.calls = []

    async def queue_recovered_completion(self, identity, proof):
        self.calls.append((identity, proof))


def unit_state(root, ctx):
    directory = root / "units" / unit_digest(assignment_identity(ctx))
    return directory, {
        name: json.loads((directory / (name + ".json")).read_text(encoding="ascii"))
        for name in ("controller", "device")
    }


class HumanoidExecutorTests(unittest.TestCase):
    def test_current_release_pointer_posture_or_source_tamper_blocks_restart(self):
        for changed in (
            {"proof_action_id": "unrelated/retract"},
            {"posture": "SIM_POSE_PRE_PICK"},
            {"source": {"item_id": "different", "rack_id": "B", "level": 1, "slot": 1}},
        ):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                ctx = task_context()

                async def first_run():
                    executor = HumanoidPickExecutor(root)

                    async def progress(_subtask, _percent):
                        return None

                    result = await executor.run(ctx, progress)
                    await executor.drain()
                    return result

                with redirect_stdout(io.StringIO()):
                    completed = asyncio.run(first_run())
                self.assertEqual(completed.status, PickExecutionStatus.COMPLETED)
                release_path = root / "device-readiness.json"
                release = json.loads(release_path.read_text(encoding="ascii"))
                self.assertEqual(release["status"], "ready")
                release.update(changed)
                release_path.write_text(json.dumps(release), encoding="ascii")
                with self.assertRaises(StateError):
                    HumanoidPickExecutor(root)
                _, state = unit_state(root, ctx)
                self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in state["device"]["executions"].values()), 1)

    def test_active_place_effect_crash_reconciles_all_post_place_phases_before_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.place_effect_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 79, child.stderr)
            ctx = task_context()
            _, before = unit_state(root, ctx)
            self.assertEqual(before["controller"]["phase"], "place")
            self.assertIsNone(before["controller"]["physical_proof"])
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "active")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")

            async def recover():
                executor = HumanoidPickExecutor(root)
                client = PublicCompletionClient()
                try:
                    completed = await executor.recover_completed(client)
                    ensure_startup_ready(executor)

                    async def progress(_subtask, _percent):
                        return None

                    replay = await executor.run(task_context(retry_count=1), progress)
                    return completed, client.calls, replay
                finally:
                    await executor.drain()

            with redirect_stdout(io.StringIO()):
                completed, calls, replay = asyncio.run(recover())
            self.assertEqual(len(completed), 1)
            self.assertEqual(len(calls), 1)
            self.assertEqual(replay.status, PickExecutionStatus.COMPLETED)
            self.assertTrue(replay.ready_for_next)
            self.assertEqual(calls[0][1], replay.terminal_evidence)
            _, after = unit_state(root, ctx)
            self.assertEqual(after["controller"]["phase"], "done")
            self.assertIsInstance(after["controller"]["physical_proof"], dict)
            self.assertIsInstance(after["controller"]["post_place_readiness_proof"], dict)
            records = list(after["device"]["executions"].values())
            self.assertEqual(sum(record["kind"] == "pick" for record in records), 1)
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in records), 1)
            self.assertEqual(sum(record["kind"] == "post_place_retract" and record["effect_applied"] for record in records), 1)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "idle")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "ready")

    def test_held_placement_crash_queues_completion_but_preserves_device_hold(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.held_placement_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 78, child.stderr)
            ctx = task_context()
            _, before = unit_state(root, ctx)
            proof = before["controller"]["physical_proof"]
            self.assertIsInstance(proof, dict)
            self.assertEqual(before["controller"]["phase"], "hold")
            self.assertIsNone(before["controller"]["post_place_readiness_proof"])
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")
            marker = json.loads((root / "crash-after-held-placement.used.json").read_text(encoding="ascii"))
            self.assertEqual(marker["identity"], assignment_identity(ctx))
            self.assertEqual(marker["place_execution_id"], proof["place_execution_id"])
            self.assertFalse((root / "pending-completions.json").exists())
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in before["device"]["executions"].values()), 1)

            async def recover():
                executor = HumanoidPickExecutor(root)
                client = PublicCompletionClient()

                async def progress(_subtask, _percent):
                    return None

                try:
                    queued = await executor.recover_completed(client)
                    with self.assertRaises(ValueError):
                        ensure_startup_ready(executor)
                    redelivered = await executor.run(task_context(retry_count=1), progress)
                    return queued, client.calls, redelivered
                finally:
                    await executor.drain()

            with redirect_stdout(io.StringIO()):
                queued, calls, redelivered = asyncio.run(recover())
            self.assertEqual(len(queued), 1)
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], queued[0])
            self.assertEqual(calls[0][1], proof)
            self.assertEqual(redelivered.status, PickExecutionStatus.UNRESOLVED)
            _, after = unit_state(root, ctx)
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in after["device"]["executions"].values()), 1)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")

    def test_preexisting_held_placement_crash_marker_skips_exit_in_fresh_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.held_placement_crash_driver", str(root), "--marker-preexisting"], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual((root / "crash-after-held-placement.used.json").read_text(encoding="ascii"), '{"existing":true}')
            self.assertFalse((root / "pending-completions.json").exists())
            _, state = unit_state(root, task_context())
            self.assertIsInstance(state["controller"]["physical_proof"], dict)
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in state["device"]["executions"].values()), 1)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")

    def test_held_placement_crash_hook_requires_valid_place_proof_and_is_opt_in(self):
        for hook, kind, expected_status in ((True, "pick", PickExecutionStatus.UNRESOLVED), (False, "post_place_retract", PickExecutionStatus.COMPLETED)):
            with self.subTest(hook=hook, kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                executor = HumanoidPickExecutor(root, config_factory=lambda ctx: faulty_config(ctx, kind, "unknown"), crash_after_held_placement_once=hook)

                async def progress(_subtask, _percent):
                    return None

                async def run_once():
                    try:
                        return await executor.run(task_context(), progress)
                    finally:
                        await executor.drain()

                with redirect_stdout(io.StringIO()):
                    outcome = asyncio.run(run_once())
                self.assertEqual(outcome.status, expected_status)
                self.assertFalse((root / "crash-after-held-placement.used.json").exists())
                _, state = unit_state(root, task_context())
                self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in state["device"]["executions"].values()), 0 if hook else 1)

    def test_local_three_unit_sequence_advances_after_verified_safe_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first_ctx = task_context(task_id="pastry-a")
            failed_ctx = task_context(task_id="pastry-b")
            third_ctx = task_context(task_id="pastry-c")

            def config_factory(ctx):
                if ctx.task_id == failed_ctx.task_id:
                    return faulty_config(ctx, "pick", "fail", (1, 2, 3))
                return default_config(ctx)

            async def scenario():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)

                async def progress(_subtask, _percent):
                    return None

                first = await executor.run(first_ctx, progress)
                failed = await executor.run(failed_ctx, progress)
                third = await executor.run(third_ctx, progress)
                release_before_retry = json.loads((root / "device-readiness.json").read_text(encoding="ascii"))
                retried = await executor.run(task_context(task_id="pastry-b", retry_count=1), progress)
                release_after_retry = json.loads((root / "device-readiness.json").read_text(encoding="ascii"))
                await executor.drain()
                return first, failed, third, retried, release_before_retry, release_after_retry

            with redirect_stdout(io.StringIO()):
                first, failed, third, retried, release_before_retry, release_after_retry = asyncio.run(scenario())
            self.assertEqual(first.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(failed.status, PickExecutionStatus.FAILED)
            self.assertTrue(failed.ready_for_next)
            self.assertEqual(third.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(retried.status, PickExecutionStatus.FAILED)
            self.assertTrue(retried.ready_for_next)
            self.assertEqual(release_before_retry, release_after_retry)
            self.assertEqual(release_after_retry["status"], "ready")
            self.assertEqual(release_after_retry["identity"], assignment_identity(third_ctx))
            self.assertEqual(release_after_retry["proof_kind"], "post_place_retract")
            for ctx in (first_ctx, third_ctx):
                _, state = unit_state(root, ctx)
                self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in state["device"]["executions"].values()), 1)
            _, failed_state = unit_state(root, failed_ctx)
            failed_records = list(failed_state["device"]["executions"].values())
            self.assertEqual(sum(record["kind"] == "pick" for record in failed_records), 3)
            self.assertEqual(sum(record["kind"] == "failure_retract" for record in failed_records), 1)
            self.assertFalse(any(record["kind"] == "place" for record in failed_records))
            self.assertIsInstance(failed_state["controller"]["failure_readiness_proof"], dict)
            third_dir, _ = unit_state(root, third_ctx)
            first_event = json.loads((third_dir / "events.jsonl").read_text(encoding="ascii").splitlines()[0])
            self.assertEqual(first_event["world"]["posture"], "SIM_POSE_TRAVEL")
            self.assertIsNone(first_event["world"]["held_task_id"])
            self.assertEqual(first_event["world"]["location"], failed_state["controller"]["failure_readiness_proof"]["readiness_observation"]["location"])
            registry = json.loads((root / "task-identities.json").read_text(encoding="ascii"))
            self.assertEqual(registry["tasks"][failed_ctx.task_id]["retry_counts"], [0, 1])

    def test_other_units_unsafe_post_place_hold_blocks_saved_failure_retry(self):
        for outcome in ("unknown", "collision", "cancel_unknown", "fail"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                failed_ctx = task_context(task_id="pastry-b")
                later_ctx = task_context(task_id="pastry-c")

                def config_factory(ctx):
                    if ctx.task_id == failed_ctx.task_id:
                        return faulty_config(ctx, "pick", "fail", (1, 2, 3))
                    return faulty_config(ctx, "post_place_retract", outcome, (1, 2) if outcome == "fail" else (1,))

                async def scenario():
                    executor = HumanoidPickExecutor(root, config_factory=config_factory)

                    async def progress(_subtask, _percent):
                        return None

                    failed = await executor.run(failed_ctx, progress)
                    later = await executor.run(later_ctx, progress)
                    retried = await executor.run(task_context(task_id="pastry-b", retry_count=1), progress)
                    same_held = await executor.run(task_context(task_id="pastry-c", retry_count=1), progress)
                    await executor.drain()
                    return failed, later, retried, same_held

                with redirect_stdout(io.StringIO()):
                    failed, later, retried, same_held = asyncio.run(scenario())
                self.assertEqual(failed.status, PickExecutionStatus.FAILED)
                self.assertTrue(failed.ready_for_next)
                self.assertEqual(later.status, PickExecutionStatus.COMPLETED)
                self.assertFalse(later.ready_for_next)
                self.assertEqual(retried.status, PickExecutionStatus.UNRESOLVED)
                self.assertEqual(same_held.status, PickExecutionStatus.UNRESOLVED)
                self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")
                self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")
                _, failed_state = unit_state(root, failed_ctx)
                self.assertEqual(sum(record["kind"] == "pick" for record in failed_state["device"]["executions"].values()), 3)
                _, later_state = unit_state(root, later_ctx)
                self.assertIsInstance(later_state["controller"]["physical_proof"], dict)
                self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in later_state["device"]["executions"].values()), 1)

    def test_active_post_place_crash_blocks_prior_failed_retry_until_exact_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            failed_ctx = task_context(task_id="pastry-b")
            later_ctx = task_context(task_id="pastry-c")

            def config_factory(ctx):
                if ctx.task_id == failed_ctx.task_id:
                    return faulty_config(ctx, "pick", "fail", (1, 2, 3))
                return default_config(ctx)

            async def fail_first():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)

                async def progress(_subtask, _percent):
                    return None

                result = await executor.run(failed_ctx, progress)
                await executor.drain()
                return result

            with redirect_stdout(io.StringIO()):
                failed = asyncio.run(fail_first())
            self.assertEqual(failed.status, PickExecutionStatus.FAILED)
            self.assertTrue(failed.ready_for_next)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.postplace_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 78, child.stderr)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "active")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")
            _, before = unit_state(root, later_ctx)
            self.assertIsInstance(before["controller"]["physical_proof"], dict)
            self.assertIsNone(before["controller"]["post_place_readiness_proof"])

            async def recover():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)
                client = PublicCompletionClient()

                async def progress(_subtask, _percent):
                    return None

                blocked = await executor.run(task_context(task_id="pastry-b", retry_count=1), progress)
                recovered = await executor.recover_completed(client)
                released = await executor.run(task_context(task_id="pastry-b", retry_count=1), progress)
                await executor.drain()
                return blocked, recovered, client.calls, released

            with redirect_stdout(io.StringIO()):
                blocked, recovered, calls, released = asyncio.run(recover())
            self.assertEqual(blocked.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(len(recovered), 1)
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0].task_id, later_ctx.task_id)
            self.assertEqual(released.status, PickExecutionStatus.FAILED)
            self.assertTrue(released.ready_for_next)
            _, after = unit_state(root, later_ctx)
            records = list(after["device"]["executions"].values())
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in records), 1)
            self.assertEqual(sum(record["kind"] == "post_place_retract" and record["effect_applied"] for record in records), 1)
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "ready")

    def test_launcher_stops_idle_client_without_network_and_records_pinned_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_dir = Path(locations_module.__file__).resolve().parent / "config"
            client_source = config_dir.parent.parent
            events = []

            class InertClient:
                def __init__(self, settings, hardware, claim, locations, pick_executor):
                    self.sio = SimpleNamespace(connect=self.connect)
                    self.executor = pick_executor

                async def connect(self, _url, **_kwargs):
                    raise AssertionError("Local launcher lifecycle test must not connect")

                async def run(self):
                    events.append("run")
                    await asyncio.Future()

                async def stop(self):
                    events.append("stop")

            args = Namespace(
                client_source=client_source,
                settings=config_dir / "hr_settings.json",
                state_root=root,
                url="http://127.0.0.1:18001",
                readback_url="http://127.0.0.1:18002",
                device_id="humanoid_robot",
                faults_json=None,
                stop_after_seconds=0.05,
                crash_after_place_once=False,
                crash_after_held_placement_once=False,
            )
            with patch.object(launcher_module, "HumanoidRobotClient", InertClient), redirect_stdout(io.StringIO()):
                code = asyncio.run(launcher_module.run(args))
            self.assertEqual(code, 0)
            self.assertEqual(events, ["run", "stop"])
            manifest = json.loads((root / "integration-manifest.json").read_text(encoding="ascii"))
            self.assertEqual(manifest["loaded_client_sha256"], launcher_module.EXPECTED_CLIENT_SHA256)
            self.assertEqual(Path(manifest["simulation_locations"]), root / "simulation-locations.json")

    def test_real_client_location_table_accepts_symbolic_counter_four_overlay(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_dir = Path(locations_module.__file__).resolve().parent / "config"
            source_path = config_dir / "locations.json"
            source_before = source_path.read_bytes()
            poses = PoseLibrary.load(str(config_dir / "poses.json"))
            self.assertTrue(poses.is_ok, poses.message)
            overlay = simulation_locations(source_path, root)
            table = LocationTable.load(str(overlay), poses.data)
            self.assertTrue(table.is_ok, table.message)
            self.assertEqual(table.data.counter_areas, (1, 2, 3, 4))
            self.assertEqual(table.data.counter_location(4).amr.tag, "SIM_COUNTER_4")
            self.assertEqual(source_path.read_bytes(), source_before)
            self.assertEqual(simulation_locations(source_path, root), overlay)
            self.assertEqual(len(json.loads(overlay.read_text(encoding="ascii"))["counters"]), 4)

    def test_real_client_types_awaited_progress_counter_four_and_retry_redelivery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            async def scenario():
                executor = HumanoidPickExecutor(root)
                progress = []

                async def callback(subtask, percent):
                    await asyncio.sleep(0)
                    self.assertIsInstance(subtask, PickSubtask)
                    progress.append((subtask, percent))

                first = await executor.run(ctx, callback)
                second = await executor.run(task_context(retry_count=3), callback)
                await executor.drain()
                return first, second, progress

            with redirect_stdout(io.StringIO()):
                first, second, progress = asyncio.run(scenario())
            self.assertIsInstance(first, PickExecutionOutcome)
            self.assertEqual(first.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(second.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(second.execution_id, first.execution_id)
            self.assertEqual(second.terminal_evidence, first.terminal_evidence)
            self.assertTrue(progress)
            self.assertEqual([percent for _, percent in progress[:len(progress) // 2]], sorted(percent for _, percent in progress[:len(progress) // 2]))
            proof = first.terminal_evidence
            self.assertEqual(proof["assignment"], {"order_id": "order-200", "session_id": "session-200", "task_id": "pastry-004", "counter": 4})
            self.assertEqual(proof["target"], "SIM_COUNTER_4")
            self.assertTrue(proof["placement_verified"])
            self.assertTrue(proof["empty_hand_verified"])
            self.assertEqual(proof["provenance"], "humanoid_harness.StubDevice/1")
            _, state = unit_state(root, ctx)
            records = list(state["device"]["executions"].values())
            self.assertEqual(sum(record["kind"] == "pick" for record in records), 1)
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in records), 1)
            self.assertEqual(state["device"]["world"]["counters"]["4"], ["pastry-004"])
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "idle")
            registry = json.loads((root / "task-identities.json").read_text(encoding="ascii"))
            self.assertEqual(registry["tasks"][ctx.task_id]["identity"], assignment_identity(ctx))
            self.assertEqual(registry["tasks"][ctx.task_id]["source"], {"item_id": "item-bun", "rack_id": "rack_b", "level": 2, "slot": 2})
            self.assertEqual(registry["tasks"][ctx.task_id]["retry_counts"], [0, 3])
            manifest = json.loads((root / "assignments" / (unit_digest(assignment_identity(ctx)) + ".json")).read_text(encoding="ascii"))
            self.assertEqual(manifest["retry_counts"], [0, 3])

    def test_unknown_holds_device_across_restart_and_excludes_other_task_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first_ctx = task_context()
            second_ctx = task_context(task_id="pastry-other")

            async def scenario():
                first = HumanoidPickExecutor(root, config_factory=lambda ctx: faulty_config(ctx, "pick", "unknown"))

                async def progress(_subtask, _percent):
                    return None

                outcome = await first.run(first_ctx, progress)
                await first.drain()
                restarted = HumanoidPickExecutor(root)
                excluded = await restarted.run(second_ctx, progress)
                await restarted.drain()
                return outcome, excluded

            with redirect_stdout(io.StringIO()):
                outcome, excluded = asyncio.run(scenario())
            self.assertEqual(outcome.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(excluded.status, PickExecutionStatus.UNRESOLVED)
            self.assertFalse((root / "units" / unit_digest(assignment_identity(second_ctx))).exists())
            owner = json.loads((root / "device-owner.json").read_text(encoding="ascii"))
            self.assertEqual(owner["status"], "hold")
            self.assertEqual(owner["identity"], assignment_identity(first_ctx))

    def test_unresolved_owner_prevents_public_client_startup_claim(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            async def scenario():
                initial = HumanoidPickExecutor(root, config_factory=lambda task: faulty_config(task, "pick", "unknown"))

                async def progress(_subtask, _percent):
                    return None

                outcome = await initial.run(ctx, progress)
                await initial.drain()
                restarted = HumanoidPickExecutor(root)
                client = PublicCompletionClient()
                try:
                    recovered = await restarted.recover_completed(client)
                    with self.assertRaises(ValueError):
                        ensure_startup_ready(restarted)
                    return outcome, recovered, client.calls
                finally:
                    await restarted.drain()

            with redirect_stdout(io.StringIO()):
                outcome, recovered, calls = asyncio.run(scenario())
            self.assertEqual(outcome.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(recovered, [])
            self.assertEqual(calls, [])

    def test_completed_task_id_cannot_be_reassigned_to_changed_counter_order_or_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            async def scenario():
                executor = HumanoidPickExecutor(root)

                async def progress(_subtask, _percent):
                    return None

                first = await executor.run(ctx, progress)
                counter = replace(ctx, counter_area=1, counter_location=CounterLocation(1, ctx.counter_location.amr, ()))
                changed_slot = replace(ctx, rack_area=replace(ctx.rack_area, area_id="rack_b_level_2_slot_1", slot=1), slot_location=replace(ctx.slot_location, slot=1, amr=AmrTarget(0.0, tag="SIM_TAG_B_2_1")))
                changes = (counter, replace(ctx, order_id="different-order"), replace(ctx, session_id="different-session"), replace(ctx, item_id="different-item"), changed_slot)
                outcomes = [await executor.run(changed, progress) for changed in changes]
                await executor.drain()
                return first, changes, outcomes

            with redirect_stdout(io.StringIO()):
                first, changes, outcomes = asyncio.run(scenario())
            self.assertEqual(first.status, PickExecutionStatus.COMPLETED)
            self.assertTrue(all(outcome.status is PickExecutionStatus.UNRESOLVED for outcome in outcomes))
            for changed in changes[:3]:
                self.assertFalse((root / "units" / unit_digest(assignment_identity(changed))).exists())
            _, state = unit_state(root, ctx)
            self.assertEqual(sum(record["kind"] == "pick" for record in state["device"]["executions"].values()), 1)

    def test_counter_location_mismatch_rejects_before_any_motion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()
            mismatch = replace(ctx, counter_location=CounterLocation(1, ctx.counter_location.amr, ()))

            async def scenario():
                executor = HumanoidPickExecutor(root)

                async def progress(_subtask, _percent):
                    return None

                result = await executor.run(mismatch, progress)
                await executor.drain()
                return result

            result = asyncio.run(scenario())
            self.assertEqual(result.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(list((root / "units").iterdir()), [])

    def test_invalid_preflight_cannot_bypass_existing_device_hold(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            held_ctx = task_context()
            other = task_context(task_id="pastry-other")
            invalid = replace(other, counter_location=CounterLocation(1, other.counter_location.amr, ()))

            async def scenario():
                executor = HumanoidPickExecutor(root, config_factory=lambda task: faulty_config(task, "pick", "unknown") if task.task_id == held_ctx.task_id else default_config(task))

                async def progress(_subtask, _percent):
                    return None

                held = await executor.run(held_ctx, progress)
                rejected = await executor.run(invalid, progress)
                await executor.drain()
                return held, rejected

            with redirect_stdout(io.StringIO()):
                held, rejected = asyncio.run(scenario())
            self.assertEqual(held.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(rejected.status, PickExecutionStatus.UNRESOLVED)
            self.assertFalse((root / "units" / unit_digest(assignment_identity(other))).exists())

    def test_cancel_timeout_retains_worker_lock_and_late_placement_hold(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()
            entered = threading.Event()
            release = threading.Event()
            base_harness = executor_module.Harness

            class GatedHarness(base_harness):
                def __init__(self, *args, phase_callback=None, **kwargs):
                    def gated_phase(phase):
                        if phase == "report":
                            entered.set()
                            if not release.wait(timeout=5):
                                raise AssertionError("Test gate was not released")
                        if phase_callback is not None:
                            phase_callback(phase)

                    super().__init__(*args, phase_callback=gated_phase, **kwargs)

            async def scenario():
                executor = HumanoidPickExecutor(root)

                async def progress(_subtask, _percent):
                    return None

                running = asyncio.create_task(executor.run(ctx, progress))
                self.assertTrue(await asyncio.to_thread(entered.wait, 3))
                running.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await running
                same = await executor.run(task_context(retry_count=1), progress)
                other = await executor.run(task_context(task_id="pastry-other"), progress)
                draining = asyncio.create_task(executor.drain())
                await asyncio.sleep(0.05)
                self.assertFalse(draining.done())
                self.assertFalse(executor._worker.done())
                with self.assertRaises(StateError):
                    HumanoidPickExecutor(root)
                release.set()
                await asyncio.wait_for(draining, timeout=5)
                return same, other

            with patch.object(executor_module, "Harness", GatedHarness), patch.object(executor_module, "CANCEL_CLEANUP_TIMEOUT_S", 0.01), redirect_stdout(io.StringIO()):
                same, other = asyncio.run(scenario())
            self.assertEqual(same.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(other.status, PickExecutionStatus.UNRESOLVED)
            owner = json.loads((root / "device-owner.json").read_text(encoding="ascii"))
            self.assertEqual(owner["status"], "hold")
            _, state = unit_state(root, ctx)
            self.assertEqual(state["device"]["world"]["counters"]["4"], ["pastry-004"])
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in state["device"]["executions"].values()), 1)
            self.assertFalse(any(record["kind"] == "navigate_idle" for record in state["device"]["executions"].values()))

    def test_safe_navigation_failure_releases_only_after_retract_proof_and_reuses_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            async def scenario(factory):
                executor = HumanoidPickExecutor(root, config_factory=factory)

                async def progress(_subtask, _percent):
                    return None

                outcome = await executor.run(ctx, progress)
                retry = await executor.run(task_context(retry_count=9), progress)
                await executor.drain()
                return outcome, retry

            with redirect_stdout(io.StringIO()):
                failed, retry = asyncio.run(scenario(lambda task: faulty_config(task, "navigate_pick", "fail", (1, 2))))
            self.assertEqual(failed.status, PickExecutionStatus.FAILED)
            self.assertTrue(failed.ready_for_next)
            self.assertEqual(retry.status, PickExecutionStatus.FAILED)
            self.assertTrue(retry.ready_for_next)
            _, state = unit_state(root, ctx)
            self.assertEqual(sum(record["kind"] == "navigate_pick" for record in state["device"]["executions"].values()), 2)
            self.assertEqual(sum(record["kind"] == "failure_retract" and record["effect_applied"] for record in state["device"]["executions"].values()), 1)
            self.assertIsInstance(state["controller"]["failure_readiness_proof"], dict)
            self.assertFalse(any(record["kind"] == "pick" for record in state["device"]["executions"].values()))
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "idle")

    def test_crash_after_place_recovers_through_public_client_queue_with_exactly_one_effect(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 76, child.stderr)
            ctx = task_context()
            _, state = unit_state(root, ctx)
            self.assertEqual(state["controller"]["phase"], "post_place_ready_check")
            self.assertIsInstance(state["controller"]["physical_proof"], dict)
            self.assertIsNone(state["controller"]["post_place_readiness_proof"])
            self.assertEqual(state["device"]["world"]["counters"]["4"], ["pastry-004"])
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "active")

            async def scenario():
                executor = HumanoidPickExecutor(root)
                client = PublicCompletionClient()
                recovered = await executor.recover_completed(client)

                async def progress(_subtask, _percent):
                    return None

                redelivered = await executor.run(task_context(retry_count=5), progress)
                await executor.drain()
                return recovered, client.calls, redelivered

            with redirect_stdout(io.StringIO()):
                recovered, calls, redelivered = asyncio.run(scenario())
            self.assertEqual(len(recovered), 1)
            self.assertEqual(len(calls), 1)
            identity, proof = calls[0]
            self.assertIsInstance(identity, CompletionIdentity)
            self.assertEqual(identity, recovered[0])
            self.assertEqual(identity.execution_id, proof["place_execution_id"])
            self.assertEqual(identity.task_id, "pastry-004")
            self.assertEqual(identity.session_id, "session-200")
            self.assertEqual(identity.order_id, "order-200")
            self.assertEqual(redelivered.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(redelivered.terminal_evidence, proof)
            _, state = unit_state(root, ctx)
            self.assertEqual(state["controller"]["phase"], "done")
            records = list(state["device"]["executions"].values())
            self.assertEqual(sum(record["kind"] == "pick" for record in records), 1)
            self.assertEqual(sum(record["kind"] == "place" and record["effect_applied"] for record in records), 1)
            self.assertEqual(sum(record["kind"] == "post_place_retract" and record["effect_applied"] for record in records), 1)
            self.assertEqual(state["device"]["world"]["counter_bun_ids"]["4"], ["pastry-004/bun-c0"])

    def test_crash_after_failure_retract_effect_recovers_one_action_before_failed_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.failure_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 77, child.stderr)
            ctx = task_context()
            _, before = unit_state(root, ctx)
            self.assertIsNone(before["controller"]["failure_readiness_proof"])
            recovery_before = [record for record in before["device"]["executions"].values() if record["kind"] == "failure_retract"]
            self.assertEqual(len(recovery_before), 1)
            self.assertTrue(recovery_before[0]["effect_applied"])
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "active")

            async def scenario():
                executor = HumanoidPickExecutor(root, config_factory=failure_crash_config)
                client = PublicCompletionClient()
                recovered = await executor.recover_completed(client)
                ensure_startup_ready(executor)

                async def progress(_subtask, _percent):
                    return None

                retry = await executor.run(task_context(retry_count=1), progress)
                await executor.drain()
                return recovered, client.calls, retry

            with redirect_stdout(io.StringIO()):
                recovered, calls, retry = asyncio.run(scenario())
            self.assertEqual(recovered, [])
            self.assertEqual(calls, [])
            self.assertEqual(retry.status, PickExecutionStatus.FAILED)
            self.assertTrue(retry.ready_for_next)
            _, after = unit_state(root, ctx)
            proof = after["controller"]["failure_readiness_proof"]
            self.assertIsInstance(proof, dict)
            recovery_after = [record for record in after["device"]["executions"].values() if record["kind"] == "failure_retract"]
            self.assertEqual(len(recovery_after), 1)
            self.assertEqual(recovery_after[0]["execution_id"], recovery_before[0]["execution_id"])
            self.assertEqual(sum(record["effect_applied"] for record in recovery_after), 1)
            self.assertEqual(sum(record["kind"] == "pick" for record in after["device"]["executions"].values()), 3)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "idle")

    def test_explicit_failure_retract_hold_does_not_auto_clear_on_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            def config_factory(task):
                config = failure_crash_config(task)
                config["faults"].append({"task_id": task.task_id, "kind": "failure_retract", "occurrence": 1, "outcome": "crash_after_effect"})
                return config

            async def first_run():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)

                async def progress(_subtask, _percent):
                    return None

                result = await executor.run(ctx, progress)
                await executor.drain()
                return result

            with redirect_stdout(io.StringIO()):
                first = asyncio.run(first_run())
            self.assertEqual(first.status, PickExecutionStatus.UNRESOLVED)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")

            async def after_restart():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)
                client = PublicCompletionClient()

                async def progress(_subtask, _percent):
                    return None

                try:
                    recovered = await executor.recover_completed(client)
                    with self.assertRaises(ValueError):
                        ensure_startup_ready(executor)
                    repeat = await executor.run(task_context(retry_count=1), progress)
                    return recovered, client.calls, repeat
                finally:
                    await executor.drain()

            with redirect_stdout(io.StringIO()):
                recovered, calls, repeat = asyncio.run(after_restart())
            self.assertEqual(recovered, [])
            self.assertEqual(calls, [])
            self.assertEqual(repeat.status, PickExecutionStatus.UNRESOLVED)
            _, state = unit_state(root, ctx)
            self.assertEqual(sum(record["kind"] == "failure_retract" for record in state["device"]["executions"].values()), 1)

    def test_corrupt_saved_failure_readiness_never_releases_a_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            def config_factory(task):
                return faulty_config(task, "pick", "fail", (1, 2, 3))

            async def first_run():
                executor = HumanoidPickExecutor(root, config_factory=config_factory)

                async def progress(_subtask, _percent):
                    return None

                result = await executor.run(ctx, progress)
                await executor.drain()
                return result

            with redirect_stdout(io.StringIO()):
                first = asyncio.run(first_run())
            self.assertEqual(first.status, PickExecutionStatus.FAILED)
            self.assertTrue(first.ready_for_next)
            directory, saved = unit_state(root, ctx)
            saved["controller"]["failure_readiness_proof"]["readiness_observation"]["observation_version"] = 0
            (directory / "controller.json").write_text(json.dumps(saved["controller"]), encoding="ascii")

            with self.assertRaises(StateError):
                HumanoidPickExecutor(root, config_factory=config_factory)
            _, after = unit_state(root, ctx)
            self.assertEqual(len(after["device"]["executions"]), len(saved["device"]["executions"]))

    def test_corrupt_proof_is_never_queued_for_public_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()

            async def complete():
                executor = HumanoidPickExecutor(root)

                async def progress(_subtask, _percent):
                    return None

                result = await executor.run(ctx, progress)
                await executor.drain()
                return result

            with redirect_stdout(io.StringIO()):
                self.assertEqual(asyncio.run(complete()).status, PickExecutionStatus.COMPLETED)
            directory, state = unit_state(root, ctx)
            state["controller"]["physical_proof"]["assignment"]["task_id"] = "different"
            (directory / "controller.json").write_text(json.dumps(state["controller"]), encoding="ascii")

            with self.assertRaises(StateError):
                HumanoidPickExecutor(root)

    def test_public_real_client_queue_persists_recovered_identity_and_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ctx = task_context()
            pending_path = root / "pending-completions.json"

            async def scenario():
                executor = HumanoidPickExecutor(root)

                async def progress(_subtask, _percent):
                    return None

                completed = await executor.run(ctx, progress)
                store = PendingCompletionStore(str(pending_path))
                client = HumanoidRobotClient(HrSettings(), object(), RobotClaim(), None, pick_executor=executor, pending_store=store)
                recovered = await executor.recover_completed(client)
                await executor.drain()
                return completed, recovered

            with redirect_stdout(io.StringIO()):
                completed, recovered = asyncio.run(scenario())
            self.assertEqual(completed.status, PickExecutionStatus.COMPLETED)
            self.assertEqual(len(recovered), 1)
            record = PendingCompletionStore(str(pending_path)).get(recovered[0])
            self.assertIsNotNone(record)
            self.assertEqual(record.state, CompletionState.PENDING)
            self.assertEqual(record.identity.execution_id, completed.execution_id)
            self.assertEqual(record.terminal_evidence, completed.terminal_evidence)
