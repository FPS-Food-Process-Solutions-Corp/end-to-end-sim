"""ROS-overlay integration tests for the fake bread-pick provider arguments."""

import os
import sys
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from sim_ros.bread_pick_sim_core import TerminalOutcome
from sim_ros.fake_bread_pick_service import main, parse_arguments, require_isolated_domain


class FakeBreadPickServiceArgumentsTest(unittest.TestCase):
    """Ensure provider options coexist with the ordinary ROS command syntax."""

    def test_ros_arguments_are_removed_before_provider_parse(self) -> None:
        arguments = parse_arguments(['provider', '--completion-delay-seconds', '2.5', '--ros-args', '-p', 'use_sim_time:=true'])
        self.assertEqual(arguments.completion_delay_seconds, 2.5)

    def test_zero_delay_is_rejected_at_argument_parse_time(self) -> None:
        with self.assertRaises(SystemExit):
            parse_arguments(['provider', '--completion-delay-seconds', '0'])

    def test_outcomes_are_parsed_in_distinct_execution_order(self) -> None:
        arguments = parse_arguments(['provider', '--outcomes', 'success,failed,failed'])
        self.assertEqual(arguments.outcomes, (TerminalOutcome.SUCCESS, TerminalOutcome.FAILED, TerminalOutcome.FAILED))

    def test_fault_controls_are_explicitly_opt_in(self) -> None:
        arguments = parse_arguments(['provider', '--outcomes', 'fault', '--lose-status-once', '--fault-clear-after-seconds', '2'])
        self.assertEqual(arguments.outcomes, (TerminalOutcome.FAULT,))
        self.assertTrue(arguments.lose_status_once)
        self.assertEqual(arguments.fault_clear_after_seconds, 2.0)

    def test_invalid_outcome_is_rejected_at_argument_parse_time(self) -> None:
        with self.assertRaises(SystemExit):
            parse_arguments(['provider', '--outcomes', 'success,unknown'])


class FakeBreadPickServiceIsolationTest(unittest.TestCase):
    """Prevent a fake production-named provider from entering an unsafe DDS scope."""

    def test_existing_simulation_domains_are_accepted(self) -> None:
        for domain in ('67', '68', '69', '71'):
            with self.subTest(domain=domain), patch.dict(os.environ, {'ROS_DOMAIN_ID': domain, 'ROS_LOCALHOST_ONLY': '1'}, clear=True):
                require_isolated_domain()

    def test_missing_or_invalid_domain_fails_before_ros_initialization(self) -> None:
        for domain in (None, '', '0', '-1', '+67', '67.0', ' 67 ', '0232', '233', '999', 'abc'):
            with self.subTest(domain=domain):
                environment = {'ROS_LOCALHOST_ONLY': '1'}
                if domain is not None:
                    environment['ROS_DOMAIN_ID'] = domain
                with patch.dict(os.environ, environment, clear=True), patch.object(sys, 'argv', ['provider']), patch('sim_ros.fake_bread_pick_service.rclpy.init') as initialize, patch('sim_ros.fake_bread_pick_service.FakeBreadPickService') as provider:
                    with self.assertRaisesRegex(RuntimeError, 'ROS_DOMAIN_ID'):
                        main()
                    initialize.assert_not_called()
                    provider.assert_not_called()

    def test_nonlocal_discovery_fails_before_ros_initialization(self) -> None:
        for localhost_only in (None, '', '0', 'true', '2'):
            with self.subTest(localhost_only=localhost_only):
                environment = {'ROS_DOMAIN_ID': '67'}
                if localhost_only is not None:
                    environment['ROS_LOCALHOST_ONLY'] = localhost_only
                with patch.dict(os.environ, environment, clear=True), patch.object(sys, 'argv', ['provider']), patch('sim_ros.fake_bread_pick_service.rclpy.init') as initialize, patch('sim_ros.fake_bread_pick_service.FakeBreadPickService') as provider:
                    with self.assertRaisesRegex(RuntimeError, 'ROS_LOCALHOST_ONLY=1'):
                        main()
                    initialize.assert_not_called()
                    provider.assert_not_called()

    def test_isolated_environment_allows_provider_initialization(self) -> None:
        with patch.dict(os.environ, {'ROS_DOMAIN_ID': '68', 'ROS_LOCALHOST_ONLY': '1'}, clear=True), patch.object(sys, 'argv', ['provider']), patch('sim_ros.fake_bread_pick_service.rclpy.init') as initialize, patch('sim_ros.fake_bread_pick_service.FakeBreadPickService') as provider, patch('sim_ros.fake_bread_pick_service.rclpy.spin') as spin, patch('sim_ros.fake_bread_pick_service.rclpy.shutdown') as shutdown:
            main()
            initialize.assert_called_once_with()
            provider.assert_called_once()
            spin.assert_called_once_with(provider.return_value)
            provider.return_value.destroy_node.assert_called_once_with()
            shutdown.assert_called_once_with()

    def test_help_remains_available_without_ros_environment(self) -> None:
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, 'argv', ['provider', '--help']), patch('sim_ros.fake_bread_pick_service.rclpy.init') as initialize, redirect_stdout(StringIO()) as output:
            with self.assertRaises(SystemExit) as exited:
                main()
            self.assertEqual(exited.exception.code, 0)
            self.assertIn('--completion-delay-seconds', output.getvalue())
            initialize.assert_not_called()


if __name__ == '__main__':
    unittest.main()
