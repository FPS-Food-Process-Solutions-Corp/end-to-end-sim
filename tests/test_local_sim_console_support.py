"""Focused tests for the local simulation observer's read-only adapters."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from local_sim_console_support import (default_journal_path, default_log_sources, journal_lines, load_journal,
                                       manifest_log_sources, manifest_process_names,
                                       parse_log_source, process_states, tail_file)


class LocalSimConsoleSupportTests(unittest.TestCase):
    def test_log_spec_requires_a_nonempty_label_and_path(self) -> None:
        source = parse_log_source("api=/runtime/api.log")
        self.assertEqual("api", source.label)
        self.assertEqual(Path("/runtime/api.log"), source.path)
        with self.assertRaises(ValueError):
            parse_log_source("api")

    def test_tail_file_is_bounded_to_recent_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "api.log"
            path.write_text("one\ntwo\nthree\n", encoding="utf-8")
            view = tail_file(path, 2)
        self.assertEqual(("two", "three"), view.lines)
        self.assertEqual("", view.error)

    def test_bridge_journal_exposes_a_blocking_entry(self) -> None:
        payload = {
            "s-1:t-1:0": {
                "execution_id": "exec-1",
                "terminal_state": None,
                "robot_ready": False,
                "failure_reason": "awaiting arm response",
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            view = load_journal(path)
        self.assertEqual(1, len(view.entries))
        self.assertTrue(view.entries[0].blocks_dispatch)
        self.assertIn("BLOCKING", journal_lines(view, 10)[0])

    def test_jsonl_journal_is_supported_for_simulator_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.jsonl"
            path.write_text('{"execution_id":"exec-2","terminal_state":"COMPLETED","robot_ready":true}\n', encoding="utf-8")
            view = load_journal(path)
        self.assertEqual("exec-2", view.entries[0].execution_id)
        self.assertFalse(view.entries[0].blocks_dispatch)

    def test_manifest_rejects_a_reused_pid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "processes.json"
            manifest.write_text(json.dumps({"api": {"pid": 42, "start_time_ticks": 100}}), encoding="utf-8")
            stat_path = root / "proc" / "42" / "stat"
            stat_path.parent.mkdir(parents=True)
            stat_path.write_text("42 (api) S " + " ".join(["0"] * 18 + ["200"]), encoding="utf-8")
            state = process_states(manifest, ("api",), root / "proc")[0]
        self.assertEqual("stale", state.status)

    def test_manifest_log_path_must_stay_under_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime"
            runtime.mkdir()
            manifest = runtime / "processes.json"
            manifest.write_text(json.dumps({"bridge": {"log_path": "/tmp/outside.log"},
                                            "ros": {"log_path": "provider.log"}}),
                                encoding="utf-8")
            sources = manifest_log_sources(runtime, manifest, default_log_sources(runtime))
        by_service = {source.service: source.path for source in sources}
        self.assertEqual(runtime / "bridge.log", by_service["bridge"])
        self.assertEqual(runtime / "provider.log", by_service["ros"])

    def test_manifest_process_names_follow_the_active_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "processes.json"
            manifest.write_text(json.dumps({"api": {}, "web": {}, "live-sim": {}}),
                                encoding="utf-8")
            names = manifest_process_names(manifest, ("api", "web", "bridge", "ros"))
        self.assertEqual(("api", "web", "live-sim"), names)

    def test_default_journal_follows_the_active_launcher_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime"
            runtime.mkdir()
            manifest = runtime / "processes.json"
            manifest.write_text(json.dumps({"api": {}, "web": {}, "bridge": {}, "ros": {}}),
                                encoding="utf-8")
            self.assertEqual(runtime / "ros" / "platform_bridge_journal.json",
                             default_journal_path(runtime, manifest))
            manifest.write_text(json.dumps({"api": {}, "web": {}, "live-sim": {}}),
                                encoding="utf-8")
            self.assertEqual(runtime / "live-sim" / "journal.jsonl",
                             default_journal_path(runtime, manifest))


if __name__ == "__main__":
    unittest.main()
