"""Focused tests for selecting and protecting fake-provider outcomes."""

import argparse
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import local_sim_runtime


class LocalSimulationRuntimeTest(unittest.TestCase):
    """Cover only scenario parsing and the live-provider configuration guard."""

    def test_provider_outcomes_are_normalized_and_invalid_values_rejected(self) -> None:
        self.assertEqual(local_sim_runtime.provider_outcomes_argument(' success, failed '), 'success,failed')
        with self.assertRaises(argparse.ArgumentTypeError):
            local_sim_runtime.provider_outcomes_argument('success,unknown')

    def test_start_refuses_to_change_a_live_provider_outcome_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / 'python'
            overlay = root / 'setup.bash'
            executable.touch()
            overlay.touch()
            manifest = root / 'processes.json'
            manifest.write_text(json.dumps({'ros': {'pid': os.getpid(), 'start_time_ticks': local_sim_runtime.process_start_ticks(os.getpid()), 'provider_outcomes': 'success'}}), encoding='ascii')
            with patch.object(local_sim_runtime, 'STAGE_ROOT', root), patch.object(local_sim_runtime, 'PROJECT_ROOT', root), patch.object(local_sim_runtime, 'ROS_PYTHON', str(executable)), patch.object(local_sim_runtime, 'OVERLAY_SETUP', str(overlay)), patch.object(local_sim_runtime, 'MANIFEST_PATH', manifest):
                self.assertEqual(local_sim_runtime.start('bridge', 'failed'), 2)


if __name__ == '__main__':
    unittest.main()
