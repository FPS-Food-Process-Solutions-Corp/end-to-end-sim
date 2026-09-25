"""Headless Textual smoke coverage for the local simulation observer."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from textual.widgets import Static, TabPane

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from local_sim_console import LocalSimConsole
from local_sim_console_support import default_log_sources


class LocalSimConsoleTextualTests(unittest.IsolatedAsyncioTestCase):
    """Render a console against only temporary read-only inputs."""

    async def test_mounts_and_refreshes_log_and_journal_panels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime"
            runtime.mkdir()
            (runtime / "api.log").write_text("api ready\n", encoding="utf-8")
            (runtime / "web.log").write_text("web ready\n", encoding="utf-8")
            (runtime / "live-sim.log").write_text("sim ready\n", encoding="utf-8")
            (runtime / "ros.log").write_text("ros ready\n", encoding="utf-8")
            journal = runtime / "live-sim" / "journal.jsonl"
            journal.parent.mkdir()
            journal.write_text(json.dumps({"execution_id": "pick-1",
                                            "terminal_state": "COMPLETED",
                                            "robot_ready": True}) + "\n",
                               encoding="utf-8")
            app = LocalSimConsole(default_log_sources(runtime), journal,
                                  runtime / "processes.json", 20, 60.0)
            async with app.run_test(size=(100, 30)) as pilot:
                await pilot.pause()
                status = app.query_one("#status", Static)
                api_log = app.query_one("#log-0", Static)
                journal_text = app.query_one("#journal-text", Static)
                self.assertIn("READ-ONLY", str(status.render()))
                self.assertIn("api ready", str(api_log.render()))
                self.assertIn("pick-1", str(journal_text.render()))
                self.assertEqual(5, len(list(app.query(TabPane))))


if __name__ == "__main__":
    unittest.main()
