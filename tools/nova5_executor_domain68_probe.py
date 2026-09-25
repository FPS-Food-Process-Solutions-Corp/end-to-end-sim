"""Run bounded canonical-executor recovery probes against disposable ROS services."""

import asyncio
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

import rclpy
from rclpy.executors import MultiThreadedExecutor

from hr_client.client import PickExecutionStatus
from hr_client.models import RackArea, TaskContext
from platform_bridge.executor import NovaPickExecutor
from platform_bridge.journal import ExecutionJournal
from platform_bridge.recovery import recover
from platform_bridge.ros_node import _RosVisionLink


DOMAIN_ID = '68'
DEADLINE_SECONDS = 8.0


def task(session_id: str, task_id: str) -> TaskContext:
    """Build one Rack A task using the real executor mapping contract."""
    return TaskContext(session_id, task_id, 'croissant', 'Croissant', retry_count=0, rack_area=RackArea('rack_a_level_1_slot_1', 'rack_a', 1, 1, ''), counter_area=1)


async def progress(*_args) -> None:
    """The probe verifies terminal safety, not progress rendering."""


def require_domain() -> None:
    """Refuse accidental use of the demo ROS domain."""
    if os.environ.get('ROS_DOMAIN_ID') != DOMAIN_ID or os.environ.get('ROS_LOCALHOST_ONLY') != '1':
        raise RuntimeError('set ROS_DOMAIN_ID=68 and ROS_LOCALHOST_ONLY=1')


def start_provider(arguments: list[str]) -> subprocess.Popen:
    """Start one disposable local provider inherited from the isolated environment."""
    return subprocess.Popen([sys.executable, '-m', 'sim_ros.fake_bread_pick_service', '--completion-delay-seconds', '0.2'] + arguments, env=dict(os.environ), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


async def run_late_success(link: _RosVisionLink, journal: ExecutionJournal) -> dict:
    """Prove that unknown status cannot become a late synthetic completion."""
    outbound_start_calls = 0
    start_pick = link.start_pick

    async def counted_start(request):
        nonlocal outbound_start_calls
        outbound_start_calls += 1
        return await start_pick(request)

    link.start_pick = counted_start
    executor = NovaPickExecutor(link, journal, {'croissant': 'croissant'}, {1: 1}, poll_interval_s=0.02, overall_timeout_s=2.0, rpc_timeout_s=1.0, readiness_wait_s=0.5)
    first = await asyncio.wait_for(executor.run(task('late-session', 'late-task'), progress), timeout=DEADLINE_SECONDS)
    if first.status is not PickExecutionStatus.UNRESOLVED:
        raise RuntimeError('lost correlated status did not hold: %s' % first)
    blockers = journal.blocking_entries()
    if len(blockers) != 1:
        raise RuntimeError('lost correlated status did not leave exactly one journal hold')
    entry = blockers[0]
    await asyncio.sleep(0.35)
    exact = await asyncio.wait_for(link.get_status(entry.execution_id), timeout=DEADLINE_SECONDS)
    readiness = await asyncio.wait_for(link.get_status(''), timeout=DEADLINE_SECONDS)
    if not exact.known or exact.state.name != 'SUCCEEDED' or not exact.robot_ready or not readiness.robot_ready:
        raise RuntimeError('controller did not later report known success and readiness: %s %s' % (exact, readiness))
    try:
        recover(journal, entry.execution_id, 'domain68-probe', 'late success after unknown poll', lambda execution_id: exact if execution_id else readiness)
    except ValueError as exc:
        recovery_error = str(exc)
    else:
        raise RuntimeError('unsupported late-success recovery unexpectedly cleared the journal')
    second = await asyncio.wait_for(executor.run(task('late-session-2', 'late-task-2'), progress), timeout=DEADLINE_SECONDS)
    if second.status is not PickExecutionStatus.UNRESOLVED or len(journal.blocking_entries()) != 1:
        raise RuntimeError('late-success unresolved execution did not continue to block dispatch')
    if outbound_start_calls != 1:
        raise RuntimeError('blocked later task sent an unexpected additional start RPC')
    return {'execution_id': entry.execution_id, 'recovery_error': recovery_error, 'outbound_start_calls': outbound_start_calls, 'second_status': second.status.name}


async def run_failed_then_success(link: _RosVisionLink, journal: ExecutionJournal) -> dict:
    """Positive control: a known ready failure settles and later work starts."""
    executor = NovaPickExecutor(link, journal, {'croissant': 'croissant'}, {1: 1}, poll_interval_s=0.02, overall_timeout_s=2.0, rpc_timeout_s=1.0, readiness_wait_s=0.5)
    failed = await asyncio.wait_for(executor.run(task('failure-session', 'failure-task'), progress), timeout=DEADLINE_SECONDS)
    succeeded = await asyncio.wait_for(executor.run(task('success-session', 'success-task'), progress), timeout=DEADLINE_SECONDS)
    if failed.status is not PickExecutionStatus.FAILED or not failed.ready_for_next:
        raise RuntimeError('known failed outcome did not settle ready for later work: %s' % failed)
    if succeeded.status is not PickExecutionStatus.COMPLETED or not succeeded.ready_for_next:
        raise RuntimeError('later distinct task did not complete after known failure: %s' % succeeded)
    return {'failed_status': failed.status.name, 'success_status': succeeded.status.name, 'blocking_entries': len(journal.blocking_entries())}


def run_case(name: str, provider_arguments: list[str], scenario) -> dict:
    """Bind one canonical executor to one disposable actual ROS provider."""
    provider = start_provider(provider_arguments)
    node = None
    ros_executor = None
    loop = None
    try:
        rclpy.init(args=[])
        node = rclpy.create_node('nova5_executor_domain68_' + name)
        ros_executor = MultiThreadedExecutor(num_threads=2)
        ros_executor.add_node(node)
        thread = threading.Thread(target=ros_executor.spin, daemon=True)
        thread.start()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        link = _RosVisionLink(node, loop, 1.0, 1.0)
        if not link._client.wait_for_service(timeout_sec=DEADLINE_SECONDS) or not link._status_client.wait_for_service(timeout_sec=DEADLINE_SECONDS):
            raise RuntimeError('%s services did not appear' % name)
        with tempfile.TemporaryDirectory() as directory:
            journal = ExecutionJournal(str(Path(directory) / 'journal.json'))
            result = loop.run_until_complete(scenario(link, journal))
            print(name + '=' + repr(result))
            return result
    finally:
        if loop is not None:
            loop.close()
        if ros_executor is not None:
            ros_executor.shutdown()
        if node is not None:
            node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        provider.terminate()
        try:
            provider.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            provider.kill()
            provider.wait(timeout=2.0)


def main() -> int:
    require_domain()
    run_case('late_success_hold', ['--outcomes', 'success', '--lose-status-once'], run_late_success)
    run_case('failed_then_success', ['--outcomes', 'failed,success'], run_failed_then_success)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
