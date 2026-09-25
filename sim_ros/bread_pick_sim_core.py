"""Pure lifecycle state for the bounded fake bread-pick ROS provider."""

from dataclasses import dataclass
from enum import IntEnum
from math import isfinite
from time import monotonic
from typing import Callable, Dict, Optional, Tuple


PROTOCOL_VERSION = 1
MAX_COMPLETION_DELAY_SECONDS = 60.0


class StartCode(IntEnum):
    """StartBreadPick response codes."""

    ACCEPTED = 0
    BUSY = 1
    INVALID = 2
    CONFLICTING_REPLAY = 3
    FAULT_LATCHED = 4


class PickState(IntEnum):
    """GetBreadPickStatus lifecycle states."""

    UNKNOWN = 0
    RUNNING = 1
    SUCCESS = 2
    FAILED = 3


class TerminalOutcome(IntEnum):
    """Deterministic terminal choices assigned only to newly accepted picks."""

    SUCCESS = 0
    FAILED = 1
    FAULT = 2


class FailureCode(IntEnum):
    """GetBreadPickStatus failure codes used by the bounded provider."""

    NONE = 0
    NO_DETECTION = 1
    MOTION = 4


@dataclass(frozen=True)
class StartRequest:
    """The protocol fields needed to accept and fingerprint one pick."""

    execution_id: str
    rack_id: int
    level_id: int
    slot_id: int
    label: str
    place_slot: int


@dataclass(frozen=True)
class StartReply:
    """Protocol-neutral equivalent of StartBreadPick.Response."""

    accepted: bool
    message: str
    execution_id: str
    code: StartCode
    robot_ready: bool


@dataclass(frozen=True)
class StatusReply:
    """Protocol-neutral equivalent of GetBreadPickStatus.Response."""

    protocol_version: int
    execution_id: str
    known: bool
    state: PickState
    failure_code: FailureCode
    message: str
    robot_ready: bool


@dataclass(frozen=True)
class LifecycleEvent:
    """An observable correlation event emitted by the simulation lifecycle."""

    event: str
    execution_id: str
    state: PickState
    failure_code: FailureCode
    message: str
    robot_ready: bool


@dataclass
class _ExecutionRecord:
    request: StartRequest
    started_at: float
    complete_at: float
    state: PickState
    terminal_outcome: TerminalOutcome


class BreadPickSimulation:
    """A single-worker deterministic lifecycle using a monotonic clock."""

    def __init__(self, completion_delay_seconds: float = 2.0, terminal_outcomes: Tuple[TerminalOutcome, ...] = (TerminalOutcome.SUCCESS,), clock: Callable[[], float] = monotonic, lose_status_once: bool = False) -> None:
        if type(completion_delay_seconds) not in (int, float) or not isfinite(completion_delay_seconds):
            raise ValueError('completion_delay_seconds must be a finite number')
        if completion_delay_seconds <= 0.0 or completion_delay_seconds > MAX_COMPLETION_DELAY_SECONDS:
            raise ValueError('completion_delay_seconds must be greater than 0 and no more than %.1f seconds' % MAX_COMPLETION_DELAY_SECONDS)
        if not isinstance(terminal_outcomes, tuple) or not terminal_outcomes:
            raise ValueError('terminal_outcomes must be a non-empty tuple')
        if any(not isinstance(outcome, TerminalOutcome) for outcome in terminal_outcomes):
            raise ValueError('terminal_outcomes must contain TerminalOutcome values')
        if type(lose_status_once) is not bool:
            raise ValueError('lose_status_once must be a boolean')
        self._completion_delay_seconds = float(completion_delay_seconds)
        self._terminal_outcomes = terminal_outcomes
        self._clock = clock
        self._records: Dict[str, _ExecutionRecord] = {}
        self._active_execution_id: Optional[str] = None
        self._events: list[LifecycleEvent] = []
        self._new_execution_count = 0
        self._fault_latched = False
        self._lose_status_once = lose_status_once
        self._lost_status_execution_id: Optional[str] = None

    def start(self, request: StartRequest, now: Optional[float] = None) -> StartReply:
        """Accept, replay, or refuse one request without ever starting a duplicate."""
        current_time = self._now(now)
        self.advance(current_time)
        existing = self._records.get(request.execution_id) if isinstance(request.execution_id, str) else None
        if existing is not None:
            if self._same_fingerprint(existing.request, request):
                reply = StartReply(True, 'Identical replay accepted', request.execution_id, StartCode.ACCEPTED, self.robot_ready)
                failure_code = FailureCode.NONE if existing.state is PickState.RUNNING else self._terminal_fields(existing)[1]
                self._events.append(LifecycleEvent('replay', request.execution_id, existing.state, failure_code, reply.message, reply.robot_ready))
                return reply
            return StartReply(False, 'Execution ID was already used with different request data', request.execution_id, StartCode.CONFLICTING_REPLAY, self.robot_ready)
        invalid_reason = self._validation_error(request)
        if invalid_reason is not None:
            return StartReply(False, invalid_reason, self._response_execution_id(request), StartCode.INVALID, self.robot_ready)
        if self._active_execution_id is not None:
            return StartReply(False, 'A pick is already running', request.execution_id, StartCode.BUSY, False)
        if self._fault_latched:
            return StartReply(False, 'Controller fault is latched', request.execution_id, StartCode.FAULT_LATCHED, False)
        record = _ExecutionRecord(request, current_time, current_time + self._completion_delay_seconds, PickState.RUNNING, self._next_terminal_outcome())
        self._records[request.execution_id] = record
        self._active_execution_id = request.execution_id
        if self._lose_status_once:
            self._lost_status_execution_id = request.execution_id
        reply = StartReply(True, 'Pick accepted', request.execution_id, StartCode.ACCEPTED, False)
        self._events.append(LifecycleEvent('start', request.execution_id, record.state, FailureCode.NONE, reply.message, False))
        self.advance(current_time)
        return reply

    def status(self, execution_id: str, now: Optional[float] = None) -> StatusReply:
        """Return readiness, a correlated lifecycle state, or an unknown result."""
        self.advance(self._now(now))
        ready = self.robot_ready
        if execution_id == '':
            message = 'Controller idle and ready' if ready else 'Pick in progress'
            return StatusReply(PROTOCOL_VERSION, execution_id, False, PickState.UNKNOWN, FailureCode.NONE, message, ready)
        record = self._records.get(execution_id)
        if record is None:
            return StatusReply(PROTOCOL_VERSION, execution_id, False, PickState.UNKNOWN, FailureCode.NONE, 'Unknown execution ID', ready)
        if self._lost_status_execution_id == execution_id:
            self._lost_status_execution_id = None
            return StatusReply(PROTOCOL_VERSION, execution_id, False, PickState.UNKNOWN, FailureCode.NONE, 'Injected correlated status loss', False)
        if record.state == PickState.RUNNING:
            return StatusReply(PROTOCOL_VERSION, execution_id, True, PickState.RUNNING, FailureCode.NONE, 'Pick in progress', False)
        state, failure_code, message = self._terminal_fields(record)
        return StatusReply(PROTOCOL_VERSION, execution_id, True, state, failure_code, message, ready)

    def advance(self, now: Optional[float] = None) -> Tuple[LifecycleEvent, ...]:
        """Complete the current pick once its deterministic monotonic deadline passes."""
        current_time = self._now(now)
        emitted = []
        active_id = self._active_execution_id
        if active_id is not None:
            record = self._records[active_id]
            if current_time >= record.complete_at:
                record.state, failure_code, message = self._terminal_fields(record)
                self._active_execution_id = None
                if record.terminal_outcome is TerminalOutcome.FAULT:
                    self._fault_latched = True
                event = LifecycleEvent('terminal', active_id, record.state, failure_code, message, self.robot_ready)
                self._events.append(event)
                emitted.append(event)
        return tuple(emitted)

    def drain_events(self) -> Tuple[LifecycleEvent, ...]:
        """Return each pending correlation event once, in lifecycle order."""
        events = tuple(self._events)
        self._events.clear()
        return events

    @property
    def robot_ready(self) -> bool:
        """The simulation is ready precisely when no pick is running."""
        return self._active_execution_id is None and not self._fault_latched

    @property
    def fault_latched(self) -> bool:
        """Expose the test fixture fault state without adding a ROS reset API."""
        return self._fault_latched

    def clear_simulated_fault(self) -> None:
        """Clear only the test fixture's post-dispatch fault latch."""
        self._fault_latched = False

    def _now(self, requested_time: Optional[float]) -> float:
        current_time = self._clock() if requested_time is None else requested_time
        if type(current_time) not in (int, float) or not isfinite(current_time):
            raise ValueError('monotonic time must be a finite number')
        return float(current_time)

    def _next_terminal_outcome(self) -> TerminalOutcome:
        index = min(self._new_execution_count, len(self._terminal_outcomes) - 1)
        self._new_execution_count += 1
        return self._terminal_outcomes[index]

    @staticmethod
    def _terminal_fields(record: _ExecutionRecord) -> Tuple[PickState, FailureCode, str]:
        if record.terminal_outcome is TerminalOutcome.SUCCESS:
            return PickState.SUCCESS, FailureCode.NONE, 'Pick succeeded'
        if record.terminal_outcome is TerminalOutcome.FAULT:
            return PickState.FAILED, FailureCode.MOTION, 'Simulated controller fault latched'
        return PickState.FAILED, FailureCode.NO_DETECTION, 'Simulated no-detection failure'

    @staticmethod
    def _response_execution_id(request: StartRequest) -> str:
        return request.execution_id if isinstance(request.execution_id, str) else ''

    @staticmethod
    def _same_fingerprint(first: StartRequest, second: StartRequest) -> bool:
        first_fields = (first.execution_id, first.rack_id, first.level_id, first.slot_id, first.label, first.place_slot)
        second_fields = (second.execution_id, second.rack_id, second.level_id, second.slot_id, second.label, second.place_slot)
        return all(type(left) is type(right) and left == right for left, right in zip(first_fields, second_fields))

    @staticmethod
    def _validation_error(request: StartRequest) -> Optional[str]:
        if not isinstance(request.execution_id, str) or not request.execution_id.strip():
            return 'execution_id must be a non-empty string'
        if type(request.rack_id) is not int or request.rack_id != 1:
            return 'rack_id must be 1 for RackA'
        if type(request.level_id) is not int or not 1 <= request.level_id <= 3:
            return 'level_id must be an integer from 1 through 3'
        if type(request.slot_id) is not int or not 1 <= request.slot_id <= 3:
            return 'slot_id must be an integer from 1 through 3'
        if not isinstance(request.label, str):
            return 'label must be a string'
        if type(request.place_slot) is not int or not 1 <= request.place_slot <= 3:
            return 'place_slot must be an integer from 1 through 3'
        return None
