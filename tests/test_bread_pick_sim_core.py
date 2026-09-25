"""Unit tests for the ROS-independent bounded bread-pick lifecycle."""

import unittest

from sim_ros.bread_pick_sim_core import BreadPickSimulation, FailureCode, PickState, StartCode, StartRequest, TerminalOutcome


def valid_request(execution_id: str = 'pick-1', **changes: object) -> StartRequest:
    """Build one valid request while allowing a focused test variation."""
    fields: dict[str, object] = {
        'execution_id': execution_id,
        'rack_id': 1,
        'level_id': 1,
        'slot_id': 1,
        'label': 'butter-croissant',
        'place_slot': 1,
    }
    fields.update(changes)
    return StartRequest(**fields)


class BreadPickSimulationTest(unittest.TestCase):
    """Exercise protocol behavior without ROS or generated custom interfaces."""

    def setUp(self) -> None:
        self.simulation = BreadPickSimulation(completion_delay_seconds=5.0, clock=lambda: 0.0)

    def test_empty_status_reports_protocol_readiness(self) -> None:
        reply = self.simulation.status('', now=0.0)
        self.assertEqual(reply.protocol_version, 1)
        self.assertFalse(reply.known)
        self.assertEqual(reply.state, PickState.UNKNOWN)
        self.assertEqual(reply.failure_code, FailureCode.NONE)
        self.assertTrue(reply.robot_ready)

    def test_valid_start_runs_then_succeeds_after_delay(self) -> None:
        accepted = self.simulation.start(valid_request(), now=10.0)
        self.assertTrue(accepted.accepted)
        self.assertEqual(accepted.code, StartCode.ACCEPTED)
        self.assertFalse(accepted.robot_ready)
        self.assertEqual(self.simulation.status('pick-1', now=14.99).state, PickState.RUNNING)
        completed = self.simulation.status('pick-1', now=15.0)
        self.assertTrue(completed.known)
        self.assertEqual(completed.state, PickState.SUCCESS)
        self.assertEqual(completed.failure_code, FailureCode.NONE)
        self.assertTrue(completed.robot_ready)

    def test_identical_replay_is_accepted_without_second_run(self) -> None:
        request = valid_request()
        self.simulation.start(request, now=0.0)
        replay = self.simulation.start(request, now=1.0)
        self.assertTrue(replay.accepted)
        self.assertEqual(replay.code, StartCode.ACCEPTED)
        self.assertFalse(replay.robot_ready)
        self.assertEqual(self.simulation.status('pick-1', now=5.0).state, PickState.SUCCESS)
        events = self.simulation.drain_events()
        self.assertEqual([event.event for event in events], ['start', 'replay', 'terminal'])

    def test_terminal_event_is_emitted_once(self) -> None:
        self.simulation.start(valid_request(), now=0.0)
        self.assertEqual([event.event for event in self.simulation.drain_events()], ['start'])
        self.simulation.advance(now=5.0)
        terminal_events = self.simulation.drain_events()
        self.assertEqual([event.event for event in terminal_events], ['terminal'])
        self.simulation.status('pick-1', now=6.0)
        self.assertEqual(self.simulation.drain_events(), ())

    def test_failed_outcome_returns_a_protocol_valid_terminal_failure(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.FAILED,), clock=lambda: 0.0)
        simulation.start(valid_request(), now=0.0)
        terminal = simulation.status('pick-1', now=5.0)
        self.assertTrue(terminal.known)
        self.assertEqual(terminal.state, PickState.FAILED)
        self.assertEqual(terminal.failure_code, FailureCode.NO_DETECTION)
        self.assertTrue(terminal.robot_ready)
        self.assertEqual(simulation.drain_events()[-1].state, PickState.FAILED)

    def test_new_executions_consume_outcomes_then_repeat_the_terminal_tail(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.SUCCESS, TerminalOutcome.FAILED), clock=lambda: 0.0)
        simulation.start(valid_request('pick-1'), now=0.0)
        self.assertEqual(simulation.status('pick-1', now=5.0).state, PickState.SUCCESS)
        simulation.start(valid_request('pick-2'), now=5.0)
        self.assertEqual(simulation.status('pick-2', now=10.0).state, PickState.FAILED)
        simulation.start(valid_request('pick-3'), now=10.0)
        self.assertEqual(simulation.status('pick-3', now=15.0).state, PickState.FAILED)

    def test_identical_replay_does_not_consume_the_next_outcome(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.FAILED, TerminalOutcome.SUCCESS), clock=lambda: 0.0)
        request = valid_request('pick-1')
        simulation.start(request, now=0.0)
        simulation.start(request, now=1.0)
        self.assertEqual(simulation.status('pick-1', now=5.0).state, PickState.FAILED)
        simulation.start(valid_request('pick-2'), now=5.0)
        self.assertEqual(simulation.status('pick-2', now=10.0).state, PickState.SUCCESS)

    def test_terminal_failed_replay_preserves_its_failure_code_in_correlation(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.FAILED,), clock=lambda: 0.0)
        request = valid_request()
        simulation.start(request, now=0.0)
        simulation.drain_events()
        self.assertEqual(simulation.status('pick-1', now=5.0).failure_code, FailureCode.NO_DETECTION)
        simulation.drain_events()
        simulation.start(request, now=6.0)
        replay = simulation.drain_events()
        self.assertEqual(len(replay), 1)
        self.assertEqual(replay[0].event, 'replay')
        self.assertEqual(replay[0].state, PickState.FAILED)
        self.assertEqual(replay[0].failure_code, FailureCode.NO_DETECTION)

    def test_conflicting_replay_is_rejected(self) -> None:
        self.simulation.start(valid_request(), now=0.0)
        reply = self.simulation.start(valid_request(place_slot=2), now=1.0)
        self.assertFalse(reply.accepted)
        self.assertEqual(reply.code, StartCode.CONFLICTING_REPLAY)
        self.assertFalse(reply.robot_ready)

    def test_different_execution_id_is_busy_only_while_active(self) -> None:
        self.simulation.start(valid_request(), now=0.0)
        busy = self.simulation.start(valid_request('pick-2'), now=1.0)
        self.assertFalse(busy.accepted)
        self.assertEqual(busy.code, StartCode.BUSY)
        accepted = self.simulation.start(valid_request('pick-2'), now=5.0)
        self.assertTrue(accepted.accepted)
        self.assertEqual(accepted.code, StartCode.ACCEPTED)

    def test_unknown_status_never_fabricates_success(self) -> None:
        reply = self.simulation.status('never-started', now=0.0)
        self.assertFalse(reply.known)
        self.assertEqual(reply.state, PickState.UNKNOWN)
        self.assertNotEqual(reply.state, PickState.SUCCESS)
        self.assertEqual(reply.failure_code, FailureCode.NONE)

    def test_validation_enforces_real_rack_and_taught_ranges(self) -> None:
        cases = (
            valid_request(execution_id=''),
            valid_request(rack_id=2),
            valid_request(level_id=4),
            valid_request(slot_id=0),
            valid_request(place_slot=4),
        )
        for request in cases:
            with self.subTest(request=request):
                reply = self.simulation.start(request, now=0.0)
                self.assertFalse(reply.accepted)
                self.assertEqual(reply.code, StartCode.INVALID)
                self.assertTrue(reply.robot_ready)

    def test_zero_completion_delay_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, 'greater than 0'):
            BreadPickSimulation(completion_delay_seconds=0.0)

    def test_empty_terminal_outcome_sequence_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, 'non-empty'):
            BreadPickSimulation(terminal_outcomes=())

    def test_fault_latched_code_is_reserved_and_not_used_by_success_simulation(self) -> None:
        reply = self.simulation.start(valid_request(), now=0.0)
        self.assertNotEqual(reply.code, StartCode.FAULT_LATCHED)

    def test_fault_latches_until_the_test_fixture_clears_it(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.FAULT,), clock=lambda: 0.0)
        simulation.start(valid_request(), now=0.0)
        fault = simulation.status('pick-1', now=5.0)
        self.assertEqual(fault.state, PickState.FAILED)
        self.assertEqual(fault.failure_code, FailureCode.MOTION)
        self.assertFalse(fault.robot_ready)
        blocked = simulation.start(valid_request('pick-2'), now=5.0)
        self.assertEqual(blocked.code, StartCode.FAULT_LATCHED)
        simulation.clear_simulated_fault()
        self.assertTrue(simulation.status('', now=5.0).robot_ready)
        self.assertTrue(simulation.start(valid_request('pick-2'), now=5.0).accepted)

    def test_one_injected_status_loss_does_not_change_the_recorded_terminal_outcome(self) -> None:
        simulation = BreadPickSimulation(completion_delay_seconds=5.0, terminal_outcomes=(TerminalOutcome.FAILED,), clock=lambda: 0.0, lose_status_once=True)
        simulation.start(valid_request(), now=0.0)
        lost = simulation.status('pick-1', now=1.0)
        self.assertFalse(lost.known)
        self.assertEqual(lost.state, PickState.UNKNOWN)
        terminal = simulation.status('pick-1', now=5.0)
        self.assertTrue(terminal.known)
        self.assertEqual(terminal.state, PickState.FAILED)
        self.assertEqual(terminal.failure_code, FailureCode.NO_DETECTION)


if __name__ == '__main__':
    unittest.main()
