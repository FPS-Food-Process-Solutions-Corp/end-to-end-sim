"""Focused validation tests for socket-recovery evidence exporter paths."""

import unittest

from tools.export_socket_recovery_evidence import DESTINATION_ROOT, validated_name


class EvidenceNameTest(unittest.TestCase):
    """Reject traversal or ambiguous destinations before any copy occurs."""

    def test_accepts_simple_case_name(self) -> None:
        self.assertEqual(validated_name("ack-immediate"), "ack-immediate")

    def test_rejects_path_like_name(self) -> None:
        with self.assertRaises(ValueError):
            validated_name("../ack")

    def test_combined_export_has_separate_root(self) -> None:
        self.assertEqual(DESTINATION_ROOT.name, "2026-09-22-combined-nova-client-recovery")


if __name__ == "__main__":
    unittest.main()
