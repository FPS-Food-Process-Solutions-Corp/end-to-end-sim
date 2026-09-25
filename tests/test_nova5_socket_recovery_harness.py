"""Focused tests for recovery-harness API state predicates."""

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from tools.nova5_socket_recovery_harness import HarnessError, completed_snapshot_or_none, journal_entry, pending_completion_on_disk, require_exact_completion, require_exact_start_count, require_inventory_deduction, require_loaded_source_identity, same_durable_contents, shell_command, source_manifest


class CompletedSnapshotPredicateTest(unittest.TestCase):
    """Ensure API polling fetches a snapshot before evaluating its task states."""

    def test_returns_none_without_completed_task(self) -> None:
        order = {"fulfillmentProgress": {"pickSession": {"tasks": [{"status": "IN_PROGRESS"}]}}}
        self.assertIsNone(completed_snapshot_or_none(order))

    def test_returns_the_fetched_completed_order(self) -> None:
        order = {"id": "order-1", "fulfillmentProgress": {"pickSession": {"tasks": [{"status": "COMPLETED"}]}}}
        self.assertIs(completed_snapshot_or_none(order), order)

    def test_source_manifest_records_relative_python_hashes(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "pkg"
            source.mkdir()
            (source / "client.py").write_text("value = 1\n", encoding="ascii")
            (source / "ignore.txt").write_text("not source\n", encoding="ascii")
            manifest = source_manifest(root)
        self.assertEqual(list(manifest), ["pkg/client.py"])
        self.assertEqual(len(manifest["pkg/client.py"]), 64)

    def test_shell_command_uses_requested_ros_domain(self) -> None:
        arguments = SimpleNamespace(ros_setup=Path("/opt/ros/humble/setup.bash"), overlay_setup=Path("/tmp/overlay/setup.bash"), ros_domain_id="69")
        command = shell_command(arguments, "echo ready")
        self.assertEqual(command[0:2], ["bash", "-lc"])
        self.assertIn("ROS_DOMAIN_ID=69", command[2])

    def test_pending_completion_requires_exact_execution_on_disk(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "pending.json"
            path.write_text(json.dumps({"version": 1, "records": [{"state": "pending", "identity": {"execution_id": "exec-1"}}]}), encoding="ascii")
            self.assertTrue(pending_completion_on_disk(path, "exec-1"))
            self.assertFalse(pending_completion_on_disk(path, "exec-2"))

    def test_durable_boundary_compares_bytes_across_distinct_evidence_paths(self) -> None:
        before = {"journal": {"path": "before-journal.json", "sha256": "same"}, "pending_completions": None}
        after = {"journal": {"path": "after-journal.json", "sha256": "same"}, "pending_completions": None}
        self.assertTrue(same_durable_contents(before, after))
        after["journal"]["sha256"] = "different"
        self.assertFalse(same_durable_contents(before, after))

    def test_inventory_deduction_requires_exact_distinct_order_effect(self) -> None:
        baseline = {"rackArea": {"areaId": "rack_a_level_1_slot_1"}, "databaseQuantity": 6, "availableQuantity": 6}
        final = {"rackArea": {"areaId": "rack_a_level_1_slot_1"}, "databaseQuantity": 4, "availableQuantity": 4}
        require_inventory_deduction(baseline, final, 2)
        with self.assertRaises(HarnessError):
            require_inventory_deduction(baseline, final, 1)

    def test_loaded_source_identity_rejects_wrong_hash(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / "client"
            bridge = root / "bridge"
            for path in (client / "hr_client", bridge / "platform_bridge"):
                path.mkdir(parents=True)
            expected = {"hr_client.client": client / "hr_client/client.py", "hr_client.pending_completion": client / "hr_client/pending_completion.py", "hr_client.pending_failure": client / "hr_client/pending_failure.py", "hr_client.settings": client / "hr_client/settings.py", "platform_bridge.executor": bridge / "platform_bridge/executor.py", "platform_bridge.journal": bridge / "platform_bridge/journal.py", "platform_bridge.ros_node": bridge / "platform_bridge/ros_node.py", "platform_bridge.recovery": bridge / "platform_bridge/recovery.py", "platform_bridge.settings": bridge / "platform_bridge/settings.py", "platform_bridge.completion_recovery": bridge / "platform_bridge/completion_recovery.py", "platform_bridge.recover_execution": bridge / "platform_bridge/recover_execution.py", "platform_bridge.journal_lock": bridge / "platform_bridge/journal_lock.py"}
            for path in expected.values(): path.write_text("value = 1\n", encoding="ascii")
            modules = {name: {"path": str(path.resolve()), "sha256": source_manifest(path.parent.parent if "hr_client" in name else path.parent.parent)[str(path.relative_to(path.parent.parent))]} for name, path in expected.items()}
            arguments = SimpleNamespace(platform_client_source=client, bridge_source=bridge)
            require_loaded_source_identity({"modules": modules}, arguments)
            modules["hr_client.client"]["sha256"] = "0" * 64
            with self.assertRaises(HarnessError): require_loaded_source_identity({"modules": modules}, arguments)

    def test_journal_entry_preserves_exact_original_outbox(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            original = {"execution_id": "exec-1", "terminal_state": "COMPLETED", "completion_outbox": {"state": "pending", "identity": {"execution_id": "exec-1"}}}
            path.write_text(json.dumps({"key": original}), encoding="ascii")
            self.assertEqual(journal_entry(path, "exec-1"), original)
            self.assertIsNone(journal_entry(path, "exec-2"))

    def test_duplicate_start_rpc_fails_even_with_one_execution_id(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "provider.log"
            path.write_text('\n'.join(json.dumps(event) for event in ({"event": "start", "execution_id": "exec-1"}, {"event": "replay", "execution_id": "exec-1"})), encoding="ascii")
            with self.assertRaises(HarnessError):
                require_exact_start_count(path, 1, "duplicate replay")

    def test_exact_completion_rejects_wrong_readback_task(self) -> None:
        identity = {"session_id": "session-1", "task_id": "task-1", "order_id": "order-1", "execution_id": "exec-1"}
        context = dict(identity, retry_count=0)
        entry = dict(context, platform_context=context, completion_outbox={"identity": identity}, terminal_evidence={"state": "SUCCEEDED"})
        order = {"id": "order-1", "fulfillmentProgress": {"pickSession": {"sessionId": "session-1", "tasks": [{"taskId": "task-1", "status": "COMPLETED"}]}}}
        record = {"identity": identity, "payload": {"pickSessionId": "session-1", "pickTaskId": "task-1"}, "terminal_evidence": {"state": "SUCCEEDED"}, "platform_evidence": order}
        require_exact_completion(order, entry, record, "exec-1")
        record["platform_evidence"] = {"id": "order-1", "fulfillmentProgress": {"pickSession": {"sessionId": "session-1", "tasks": [{"taskId": "other", "status": "COMPLETED"}]}}}
        with self.assertRaises(HarnessError):
            require_exact_completion(order, entry, record, "exec-1")

    def test_exact_completion_accepts_correlated_direct_ack(self) -> None:
        identity = {"session_id": "session-1", "task_id": "task-1", "order_id": "order-1", "execution_id": "exec-1"}
        context = dict(identity, retry_count=0)
        entry = dict(context, platform_context=context, completion_outbox={"identity": identity}, terminal_evidence={"state": "SUCCEEDED"})
        order = {"id": "order-1", "fulfillmentProgress": {"pickSession": {"sessionId": "session-1", "tasks": [{"taskId": "task-1", "status": "COMPLETED"}]}}}
        record = {"identity": identity, "payload": {"pickSessionId": "session-1", "pickTaskId": "task-1"}, "terminal_evidence": {"state": "SUCCEEDED"}, "platform_evidence": {"eventType": "platform.pick_session_completed", "orderId": "order-1", "pickSessionId": "session-1", "completedPickTasks": 1, "failedPickTasks": 0}}
        require_exact_completion(order, entry, record, "exec-1")
        record["platform_evidence"]["orderId"] = "order-2"
        with self.assertRaises(HarnessError):
            require_exact_completion(order, entry, record, "exec-1")


if __name__ == "__main__":
    unittest.main()
