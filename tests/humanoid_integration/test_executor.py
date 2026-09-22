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
from humanoid_harness.integration.executor import assignment_identity, unit_digest
from humanoid_harness.storage import StateError

from tests.humanoid_integration.fixtures import faulty_config, task_context


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
            self.assertEqual(result.status, PickExecutionStatus.FAILED)
            self.assertEqual(list((root / "units").iterdir()), [])

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

    def test_safe_no_effect_failure_uses_failed_outcome_and_unknown_uses_unresolved(self):
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
            self.assertFalse(failed.ready_for_next)
            self.assertEqual(retry.status, PickExecutionStatus.FAILED)
            _, state = unit_state(root, ctx)
            self.assertEqual(sum(record["kind"] == "navigate_pick" for record in state["device"]["executions"].values()), 2)
            self.assertFalse(any(record["kind"] == "pick" for record in state["device"]["executions"].values()))
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "idle")

    def test_crash_after_place_recovers_through_public_client_queue_with_exactly_one_effect(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 76, child.stderr)
            ctx = task_context()
            _, state = unit_state(root, ctx)
            self.assertEqual(state["controller"]["phase"], "report")
            self.assertIsNone(state["controller"]["physical_proof"])
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
            self.assertEqual(state["device"]["world"]["counter_bun_ids"]["4"], ["pastry-004/bun-c0"])

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

            async def recover():
                executor = HumanoidPickExecutor(root)
                client = PublicCompletionClient()
                try:
                    with self.assertRaises(StateError):
                        await executor.recover_completed(client)
                    return client.calls
                finally:
                    await executor.drain()

            self.assertEqual(asyncio.run(recover()), [])

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
