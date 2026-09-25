"""ROS 2 adapter for the bounded fake bread-pick lifecycle."""

import argparse
import json
import os
from math import isfinite
from pathlib import Path
import re
import sys
from time import monotonic
from typing import Optional

import rclpy
from bread_interfaces.srv import GetBreadPickStatus, StartBreadPick
from rclpy.node import Node
from rclpy.utilities import remove_ros_args
from std_msgs.msg import String

from sim_ros.bread_pick_sim_core import MAX_COMPLETION_DELAY_SECONDS, BreadPickSimulation, LifecycleEvent, StartRequest, TerminalOutcome


CORRELATION_TOPIC = '/bread_pick/correlation'
START_SERVICE = '/bread_pick/start'
STATUS_SERVICE = '/bread_pick/status'


class FakeBreadPickService(Node):
    """Expose the bounded simulation through the production service names."""

    def __init__(self, completion_delay_seconds: float = 2.0, terminal_outcomes: tuple[TerminalOutcome, ...] = (TerminalOutcome.SUCCESS,), lose_status_once: bool = False, fault_clear_after_seconds: Optional[float] = None, status_control_path: Optional[Path] = None) -> None:
        super().__init__('fake_bread_pick_service')
        self._engine = BreadPickSimulation(completion_delay_seconds, terminal_outcomes, lose_status_once=lose_status_once)
        self._fault_clear_after_seconds = fault_clear_after_seconds
        self._fault_clear_deadline: Optional[float] = None
        self._status_control_path = status_control_path
        self._correlation_publisher = self.create_publisher(String, CORRELATION_TOPIC, 10)
        self._start_service = self.create_service(StartBreadPick, START_SERVICE, self._handle_start)
        self._status_service = self.create_service(GetBreadPickStatus, STATUS_SERVICE, self._handle_status)
        self._advance_timer = self.create_timer(0.05, self._advance)
        self._emit_line({'event': 'ready', 'protocol_version': 1, 'robot_ready': True, 'completion_delay_seconds': completion_delay_seconds, 'terminal_outcomes': [outcome.name.lower() for outcome in terminal_outcomes], 'lose_status_once': lose_status_once, 'fault_clear_after_seconds': fault_clear_after_seconds})

    def _handle_start(self, request: StartBreadPick.Request, response: StartBreadPick.Response) -> StartBreadPick.Response:
        reply = self._engine.start(StartRequest(request.execution_id, request.rack_id, request.level_id, request.slot_id, request.label, request.place_slot))
        response.accepted = reply.accepted
        response.message = reply.message
        response.execution_id = reply.execution_id
        response.code = int(reply.code)
        response.robot_ready = reply.robot_ready
        self._emit_events(self._engine.drain_events())
        if not reply.accepted:
            self._emit_line({'event': 'start_refused', 'execution_id': reply.execution_id, 'code': int(reply.code), 'message': reply.message, 'robot_ready': reply.robot_ready})
        return response

    def _handle_status(self, request: GetBreadPickStatus.Request, response: GetBreadPickStatus.Response) -> GetBreadPickStatus.Response:
        reply = self._engine.status(request.execution_id)
        response.protocol_version = reply.protocol_version
        response.execution_id = reply.execution_id
        response.known = reply.known
        response.state = int(reply.state)
        response.failure_code = int(reply.failure_code)
        response.message = reply.message
        response.robot_ready = reply.robot_ready
        if self._status_control_path is not None and self._status_control_path.is_file():
            control = json.loads(self._status_control_path.read_text(encoding='ascii'))
            mode = control.get('mode') if isinstance(control, dict) else None
            if mode == 'readiness-false' and request.execution_id == '':
                response.robot_ready = False
                self._emit_line({'event': 'status_fault', 'mode': mode, 'execution_id': request.execution_id})
            elif mode == 'identity-mismatch' and request.execution_id != '':
                response.execution_id = 'fixture-mismatch-' + request.execution_id
                self._emit_line({'event': 'status_fault', 'mode': mode, 'execution_id': request.execution_id, 'returned_execution_id': response.execution_id})
            elif mode not in (None, 'pass', 'readiness-false', 'identity-mismatch'):
                raise ValueError('unknown fake-provider status control mode')
        self._emit_events(self._engine.drain_events())
        return response

    def _advance(self) -> None:
        self._engine.advance()
        self._emit_events(self._engine.drain_events())
        if self._fault_clear_deadline is not None and monotonic() >= self._fault_clear_deadline:
            self._engine.clear_simulated_fault()
            self._fault_clear_deadline = None
            self._emit_line({'event': 'fault_cleared', 'robot_ready': self._engine.robot_ready, 'message': 'Test fixture cleared simulated controller fault'})

    def _emit_events(self, events: tuple[LifecycleEvent, ...]) -> None:
        for event in events:
            self._emit_line({'event': event.event, 'execution_id': event.execution_id, 'state': int(event.state), 'failure_code': int(event.failure_code), 'message': event.message, 'robot_ready': event.robot_ready})
            if event.event == 'terminal' and self._engine.fault_latched and self._fault_clear_after_seconds is not None:
                self._fault_clear_deadline = monotonic() + self._fault_clear_after_seconds

    def _emit_line(self, payload: dict[str, object]) -> None:
        line = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        message = String()
        message.data = line
        self._correlation_publisher.publish(message)
        self.get_logger().info(line)


def completion_delay_argument(value: str) -> float:
    """Reject unbounded or synchronous completion delays before ROS starts."""
    try:
        delay = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError('completion delay must be a number') from exc
    if not isfinite(delay) or delay <= 0.0 or delay > MAX_COMPLETION_DELAY_SECONDS:
        raise argparse.ArgumentTypeError('completion delay must be greater than 0 and no more than %.1f seconds' % MAX_COMPLETION_DELAY_SECONDS)
    return delay


def terminal_outcomes_argument(value: str) -> tuple[TerminalOutcome, ...]:
    """Parse a bounded sequence applied only to distinct accepted executions."""
    names = {'success': TerminalOutcome.SUCCESS, 'failed': TerminalOutcome.FAILED, 'fault': TerminalOutcome.FAULT}
    tokens = [token.strip().lower() for token in value.split(',')]
    if not tokens or any(not token or token not in names for token in tokens):
        raise argparse.ArgumentTypeError('outcomes must be a comma-separated sequence of success, failed, or fault')
    return tuple(names[token] for token in tokens)


def parse_arguments(argv: Optional[list[str]] = None) -> argparse.Namespace:
    """Read provider arguments after removing ROS arguments retained for rclpy."""
    parser = argparse.ArgumentParser(description='Run the bounded fake bread-pick ROS service provider.')
    parser.add_argument('--completion-delay-seconds', type=completion_delay_argument, default=2.0, help='Deterministic terminal delay greater than 0 through 60 seconds.')
    parser.add_argument('--outcomes', type=terminal_outcomes_argument, default=(TerminalOutcome.SUCCESS,), help='Comma-separated terminal outcomes for distinct accepted executions; the last outcome repeats after the sequence is exhausted.')
    parser.add_argument('--lose-status-once', action='store_true', help='Test fixture only: return one unknown status for each accepted execution before exposing its recorded state.')
    parser.add_argument('--fault-clear-after-seconds', type=completion_delay_argument, help='Test fixture only: clear a latched fault after this delay; no ROS reset service is added.')
    parser.add_argument('--status-control-path', type=Path, help='Test-only response control file for negative recovery cases.')
    source_arguments = sys.argv if argv is None else argv
    return parser.parse_args(remove_ros_args(args=source_arguments)[1:])


def require_isolated_domain() -> None:
    """Keep the fake production-named services on an explicit local ROS domain."""
    domain = os.environ.get('ROS_DOMAIN_ID')
    if domain is None or re.fullmatch(r'[1-9][0-9]*', domain) is None or int(domain) > 232:
        raise RuntimeError('fake bread-pick provider requires ROS_DOMAIN_ID from 1 through 232')
    if os.environ.get('ROS_LOCALHOST_ONLY') != '1':
        raise RuntimeError('fake bread-pick provider requires ROS_LOCALHOST_ONLY=1')


def main() -> None:
    """Run the provider until ROS shuts it down."""
    arguments = parse_arguments()
    require_isolated_domain()
    rclpy.init()
    node = FakeBreadPickService(arguments.completion_delay_seconds, arguments.outcomes, arguments.lose_status_once, arguments.fault_clear_after_seconds, arguments.status_control_path)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
