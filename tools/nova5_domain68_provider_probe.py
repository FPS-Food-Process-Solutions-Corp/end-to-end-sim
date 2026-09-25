"""Bounded ROS-domain-68 wire probe for test-only fake-provider faults."""

import os
import subprocess
import sys
import time
from typing import Callable

import rclpy
from bread_interfaces.srv import GetBreadPickStatus, StartBreadPick


DOMAIN_ID = '68'
START_SERVICE = '/bread_pick/start'
STATUS_SERVICE = '/bread_pick/status'
DEADLINE_SECONDS = 12.0


def require_isolated_domain() -> None:
    """Refuse to share the demo's ROS domain or an externally routable DDS scope."""
    if os.environ.get('ROS_DOMAIN_ID') != DOMAIN_ID:
        raise RuntimeError('set ROS_DOMAIN_ID=68 before running this isolated probe')
    if os.environ.get('ROS_LOCALHOST_ONLY') != '1':
        raise RuntimeError('set ROS_LOCALHOST_ONLY=1 before running this isolated probe')


def await_result(node, future, label: str):
    """Bound every ROS future so unavailable services fail the probe rather than hang it."""
    deadline = time.monotonic() + DEADLINE_SECONDS
    while not future.done() and time.monotonic() < deadline:
        rclpy.spin_once(node, timeout_sec=0.05)
    if not future.done():
        raise RuntimeError('%s exceeded %.1f seconds' % (label, DEADLINE_SECONDS))
    return future.result()


def await_condition(node, condition: Callable[[], bool], label: str) -> None:
    """Spin until one expected controller state arrives within the scenario deadline."""
    deadline = time.monotonic() + DEADLINE_SECONDS
    while time.monotonic() < deadline:
        if condition():
            return
        rclpy.spin_once(node, timeout_sec=0.05)
        time.sleep(0.02)
    raise RuntimeError('%s exceeded %.1f seconds' % (label, DEADLINE_SECONDS))


def start_request(execution_id: str) -> StartBreadPick.Request:
    request = StartBreadPick.Request()
    request.execution_id = execution_id
    request.rack_id = 1
    request.level_id = 1
    request.slot_id = 1
    request.label = 'domain68-probe'
    request.place_slot = 1
    return request


def status_request(execution_id: str) -> GetBreadPickStatus.Request:
    request = GetBreadPickStatus.Request()
    request.execution_id = execution_id
    return request


def run_provider_case(name: str, provider_arguments: list[str], check: Callable) -> None:
    """Launch one disposable provider process and execute one exact wire contract case."""
    environment = dict(os.environ)
    environment['ROS_DOMAIN_ID'] = DOMAIN_ID
    environment['ROS_LOCALHOST_ONLY'] = '1'
    command = [sys.executable, '-m', 'sim_ros.fake_bread_pick_service', '--completion-delay-seconds', '0.2'] + provider_arguments
    process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    rclpy.init(args=[])
    node = rclpy.create_node('nova5_domain68_probe_' + name)
    try:
        start = node.create_client(StartBreadPick, START_SERVICE)
        status = node.create_client(GetBreadPickStatus, STATUS_SERVICE)
        if not start.wait_for_service(timeout_sec=DEADLINE_SECONDS) or not status.wait_for_service(timeout_sec=DEADLINE_SECONDS):
            raise RuntimeError('%s provider services did not appear' % name)
        check(node, start, status)
        print('%s=passed' % name)
    finally:
        node.destroy_node()
        rclpy.shutdown()
        process.terminate()
        try:
            process.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2.0)


def check_fault_clear(node, start, status) -> None:
    """Verify a terminal fault holds starts until the fixture clears readiness."""
    first = await_result(node, start.call_async(start_request('fault-1')), 'fault start')
    if not first.accepted:
        raise RuntimeError('fault scenario start was refused: %s' % first.message)
    response = None
    def fault_seen() -> bool:
        nonlocal response
        response = await_result(node, status.call_async(status_request('fault-1')), 'fault status')
        return response.known and response.state == 3 and response.failure_code == 4 and not response.robot_ready
    await_condition(node, fault_seen, 'fault terminal')
    blocked = await_result(node, start.call_async(start_request('fault-2')), 'fault-latched start')
    if blocked.accepted or blocked.code != 4:
        raise RuntimeError('fault latch did not refuse later start')
    def cleared() -> bool:
        nonlocal response
        response = await_result(node, status.call_async(status_request('fault-1')), 'fault-clear status')
        return response.known and response.state == 3 and response.failure_code == 4 and response.robot_ready
    await_condition(node, cleared, 'fixture fault clear')
    resumed = await_result(node, start.call_async(start_request('fault-2')), 'resumed start')
    if not resumed.accepted:
        raise RuntimeError('fixture fault clear did not permit later distinct start: %s' % resumed.message)


def check_lost_status(node, start, status) -> None:
    """Verify unknown is reported once and never converted to synthetic success."""
    accepted = await_result(node, start.call_async(start_request('lost-1')), 'lost-status start')
    if not accepted.accepted:
        raise RuntimeError('lost-status scenario start was refused: %s' % accepted.message)
    unknown = await_result(node, status.call_async(status_request('lost-1')), 'injected unknown status')
    if unknown.known or unknown.state != 0 or unknown.failure_code != 0:
        raise RuntimeError('injected loss did not return the UNKNOWN wire contract')
    response = None
    def failed_seen() -> bool:
        nonlocal response
        response = await_result(node, status.call_async(status_request('lost-1')), 'recovered known status')
        return response.known and response.state == 3 and response.failure_code == 1 and response.robot_ready
    await_condition(node, failed_seen, 'recorded terminal after status loss')


def main() -> int:
    require_isolated_domain()
    run_provider_case('fault_clear', ['--outcomes', 'fault', '--fault-clear-after-seconds', '0.3'], check_fault_clear)
    run_provider_case('lost_status', ['--outcomes', 'failed', '--lose-status-once'], check_lost_status)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
