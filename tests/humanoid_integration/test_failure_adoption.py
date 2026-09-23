"""Exact failure-attempt audit against the reviewed public client store."""

import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from hr_client.client import HumanoidRobotClient
from hr_client.models import PickFailureReason, RobotState
from hr_client.pending_completion import CompletionState, PendingCompletionStore
from hr_client.pending_failure import FailureIdentity, FailureState, PendingFailureStore
from hr_client.robot_claim import RobotClaim
from hr_client.settings import HrSettings

from humanoid_harness.integration.failure_attempts import FailureAttemptLedger
from humanoid_harness.integration import HumanoidPickExecutor
from humanoid_harness.storage import StateError

from tests.humanoid_integration.fixtures import task_context


ASSIGNMENT = {"order_id": "order-200", "session_id": "session-200", "task_id": "pastry-b", "counter": 4}
SOURCE = {"item_id": "item-bun", "rack_id": "rack_b", "level": 2, "slot": 2}
MESSAGE = "Verified physical pick failure"
PROOF = {"assignment": ASSIGNMENT, "source": SOURCE, "recovery_execution_id": "pastry-b/c0/failure_retract", "recovery_generation": 1, "readiness_observation": {"observation_version": 2}, "failure_reason": MESSAGE}


def failure_identity(retry_count):
    return FailureIdentity(ASSIGNMENT["session_id"], ASSIGNMENT["task_id"], ASSIGNMENT["order_id"], retry_count, PROOF["recovery_execution_id"])


def failed_ack(retry_count):
    return {"eventType": "platform.pick_task_failed", "orderId": ASSIGNMENT["order_id"], "pickSessionId": ASSIGNMENT["session_id"], "pickTaskId": ASSIGNMENT["task_id"], "status": "FAILED", "retryCount": retry_count, "maxRetries": 1, "willRetry": retry_count < 1, "message": MESSAGE}


def queue_public_attempt(store, attempt, retry_count):
    identity = failure_identity(retry_count)
    payload = {"pickSessionId": identity.session_id, "pickTaskId": identity.task_id, "message": MESSAGE}
    return store.queue(identity, PickFailureReason.UNKNOWN.value, payload, attempt["terminal_evidence"])


class FailureAttemptLedgerTests(unittest.TestCase):
    def test_confirmed_zero_callback_audit_permits_one_over_same_physical_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ledger = FailureAttemptLedger(root / "failure-attempts.json")
            public_store = PendingFailureStore(str(root / "pending-failures.json"))
            zero = ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            self.assertEqual(zero["state"], "pending")
            self.assertEqual(zero["identity"]["retry_count"], 0)
            self.assertEqual(zero["terminal_evidence"]["physical_execution_id"], PROOF["recovery_execution_id"])
            self.assertEqual(ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE), zero)
            self.assertEqual(FailureAttemptLedger(root / "failure-attempts.json").get(failure_identity(0)), zero)
            pending = queue_public_attempt(public_store, zero, 0)
            with self.assertRaises(StateError):
                ledger.audit(pending, public_store)
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 1, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            confirmed = public_store.update(pending, state=FailureState.CONFIRMED, platform_evidence={"source": "ack", "response": failed_ack(0)})
            ledger.audit(confirmed, public_store)
            audited = FailureAttemptLedger(root / "failure-attempts.json").get(failure_identity(0))
            self.assertEqual(audited["state"], "confirmed")
            self.assertEqual(audited["platform_evidence"], confirmed.platform_evidence)
            for changed_assignment, changed_source, changed_proof in (
                ({**ASSIGNMENT, "counter": 1}, SOURCE, PROOF),
                (ASSIGNMENT, {**SOURCE, "slot": 1}, PROOF),
                (ASSIGNMENT, SOURCE, {**PROOF, "recovery_generation": 2}),
            ):
                with self.subTest(context=(changed_assignment, changed_source, changed_proof)), self.assertRaises(StateError):
                    ledger.ensure_intent(changed_assignment, changed_source, 1, changed_proof, PickFailureReason.UNKNOWN, MESSAGE)
            one = ledger.ensure_intent(ASSIGNMENT, SOURCE, 1, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            self.assertEqual(one["identity"]["retry_count"], 1)
            self.assertEqual(one["identity"]["execution_id"], zero["identity"]["execution_id"])
            self.assertEqual(one["terminal_evidence"]["physical_proof_sha256"], zero["terminal_evidence"]["physical_proof_sha256"])
            self.assertEqual(one["terminal_evidence"]["failure_readiness_proof"], PROOF)
            self.assertEqual(len(FailureAttemptLedger(root / "failure-attempts.json").records()), 2)

    def test_ambiguous_older_attempt_and_changed_context_cannot_create_new_generation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ledger = FailureAttemptLedger(root / "failure-attempts.json")
            zero = ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            for invalid_retry in (True, -1, None, 1):
                with self.subTest(retry=invalid_retry), self.assertRaises(StateError):
                    ledger.ensure_intent(ASSIGNMENT, SOURCE, invalid_retry, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, {**SOURCE, "slot": 1}, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, {**PROOF, "recovery_execution_id": "different"}, PickFailureReason.UNKNOWN, MESSAGE)
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, "changed wire message")
            self.assertEqual(FailureAttemptLedger(root / "failure-attempts.json").records(), [zero])

    def test_callback_record_must_match_durable_public_store_before_bridge_audit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ledger = FailureAttemptLedger(root / "failure-attempts.json")
            public_store = PendingFailureStore(str(root / "pending-failures.json"))
            zero = ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            pending = queue_public_attempt(public_store, zero, 0)
            confirmed = public_store.update(pending, state=FailureState.CONFIRMED, platform_evidence={"source": "ack", "response": failed_ack(0)})
            with self.assertRaises(StateError):
                ledger.audit(replace(confirmed, callback_acknowledged=True), public_store)
            self.assertEqual(ledger.get(failure_identity(0))["state"], "pending")
            ledger.audit(confirmed, public_store)
            ledger.audit(confirmed, public_store)
            self.assertEqual(ledger.get(failure_identity(0))["state"], "confirmed")

    def test_failed_intent_write_never_opens_retry_gate_or_masks_missing_disk_record(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ledger = FailureAttemptLedger(root / "failure-attempts.json")
            with patch("humanoid_harness.integration.failure_attempts.write_json", side_effect=OSError("simulated disk failure")):
                with self.assertRaises(OSError):
                    ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            self.assertEqual(ledger.records(), [])
            self.assertEqual(FailureAttemptLedger(root / "failure-attempts.json").records(), [])
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 1, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            zero = ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            self.assertEqual(ledger.records(), [zero])

    def test_failed_callback_audit_write_keeps_confirmed_public_attempt_bridge_pending(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ledger = FailureAttemptLedger(root / "failure-attempts.json")
            public_store = PendingFailureStore(str(root / "pending-failures.json"))
            zero = ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            pending = queue_public_attempt(public_store, zero, 0)
            confirmed = public_store.update(pending, state=FailureState.CONFIRMED, platform_evidence={"source": "ack", "response": failed_ack(0)})
            with patch("humanoid_harness.integration.failure_attempts.write_json", side_effect=OSError("simulated audit disk failure")):
                with self.assertRaises(OSError):
                    ledger.audit(confirmed, public_store)
            self.assertEqual(ledger.get(failure_identity(0))["state"], "pending")
            self.assertEqual(FailureAttemptLedger(root / "failure-attempts.json").get(failure_identity(0))["state"], "pending")
            with self.assertRaises(StateError):
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 1, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
            ledger.audit(confirmed, public_store)
            self.assertEqual(ledger.get(failure_identity(0))["state"], "confirmed")

    def test_corrupt_individual_attempt_records_fail_closed_on_restart(self):
        for corrupt in ("missing-proof", "false-confirmation"):
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                path = root / "failure-attempts.json"
                ledger = FailureAttemptLedger(path)
                ledger.ensure_intent(ASSIGNMENT, SOURCE, 0, PROOF, PickFailureReason.UNKNOWN, MESSAGE)
                raw = json.loads(path.read_text(encoding="ascii"))
                record = next(iter(raw["attempts"].values()))
                if corrupt == "missing-proof":
                    del record["terminal_evidence"]
                else:
                    record["state"] = "confirmed"
                path.write_text(json.dumps(raw), encoding="ascii")
                with self.assertRaises(StateError):
                    FailureAttemptLedger(path)


class PhysicalRecoveryHoldTests(unittest.TestCase):
    def test_real_public_client_receives_exact_hold_before_completion_queue_and_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.held_placement_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(child.returncode, 78, child.stderr)
            completion_path = root / "pending-completions.json"
            failure_path = root / "pending-failures.json"
            self.assertFalse(completion_path.exists())

            async def recover_once():
                failure_store = PendingFailureStore(str(failure_path))
                completion_store = PendingCompletionStore(str(completion_path))
                executor = HumanoidPickExecutor(root, pending_failure_store=failure_store)
                client = HumanoidRobotClient(HrSettings(), object(), RobotClaim(), None, pick_executor=executor, pending_store=completion_store, pending_failure_store=failure_store)
                try:
                    executor.reconcile_active()
                    spec = executor.recovery_hold_spec()
                    self.assertEqual(spec["task_id"], task_context().task_id)
                    with self.assertRaises(StateError):
                        await executor.recover_completed(client)
                    self.assertEqual(executor.install_recovery_hold(client), spec)
                    self.assertIs(client.state, RobotState.PAUSED)
                    client.hold_execution_for_recovery(spec["hold_id"], spec["message"], task_id=spec["task_id"])
                    with self.assertRaises(ValueError):
                        client.hold_execution_for_recovery("wrong-token", spec["message"], task_id=spec["task_id"])
                    queued = await executor.recover_completed(client)
                    self.assertEqual(len(queued), 1)
                    self.assertIs(client.state, RobotState.PAUSED)
                    return spec, queued[0]
                finally:
                    await executor.drain()

            first_spec, first_identity = asyncio.run(recover_once())
            pending = PendingCompletionStore(str(completion_path)).get(first_identity)
            self.assertIsNotNone(pending)
            self.assertIs(pending.state, CompletionState.PENDING)
            second_spec, second_identity = asyncio.run(recover_once())
            self.assertEqual(first_spec, second_spec)
            self.assertEqual(first_identity, second_identity)
            self.assertEqual(len(tuple(PendingCompletionStore(str(completion_path)).records())), 1)
            self.assertEqual(json.loads((root / "device-owner.json").read_text(encoding="ascii"))["status"], "hold")
            self.assertEqual(json.loads((root / "device-readiness.json").read_text(encoding="ascii"))["status"], "unknown")

    def test_wrong_saved_hold_token_version_or_source_blocks_public_installation(self):
        for field in ("hold_id", "version", "source"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                child = subprocess.run([sys.executable, "-m", "tests.humanoid_integration.held_placement_crash_driver", str(root)], capture_output=True, text=True, timeout=30, check=False)
                self.assertEqual(child.returncode, 78, child.stderr)
                owner_path = root / "device-owner.json"
                owner = json.loads(owner_path.read_text(encoding="ascii"))
                hold = owner["recovery_hold"]
                self.assertIsInstance(hold, dict)
                if field == "hold_id":
                    hold["hold_id"] = "wrong-token"
                elif field == "version":
                    hold["version"] += 1
                else:
                    hold["source"]["slot"] += 1
                owner_path.write_text(json.dumps(owner), encoding="ascii")
                executor = HumanoidPickExecutor(root)
                try:
                    with self.assertRaises(StateError):
                        executor.recovery_hold_spec()
                    self.assertFalse((root / "pending-completions.json").exists())
                finally:
                    asyncio.run(executor.drain())
