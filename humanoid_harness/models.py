"""Typed boundaries for replaceable robot and platform adapters."""

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class Result(Generic[T]):
    is_ok: bool
    data: T | None = None
    message: str = ""

    @property
    def is_err(self) -> bool:
        return not self.is_ok

    @classmethod
    def ok(cls, data: T) -> "Result[T]":
        return cls(True, data)

    @classmethod
    def err_msg(cls, message: str) -> "Result[T]":
        return cls(False, None, message)


@dataclass(frozen=True)
class Execution:
    execution_id: str
    task_id: str
    kind: str
    target: str
    generation: int
    status: str
    reason: str = ""
    safe_to_retry: bool = False


@dataclass(frozen=True)
class Observation:
    task_id: str
    held_task_id: str | None
    rack_has_bun: bool
    lift_pose_ok: bool
    location: str
    posture: str
    loss_confirmed: bool = False


@dataclass(frozen=True)
class CompletionReport:
    task_id: str
    order_id: str
    session_id: str
    execution_id: str
    status: str


class AmrAdapter(Protocol):
    def submit_navigation(self, execution: Execution) -> Result[Execution]: ...
    def get_execution(self, execution_id: str) -> Result[Execution]: ...
    def cancel_execution(self, execution_id: str) -> Result[Execution]: ...


class HumanoidMoverAdapter(Protocol):
    def submit_pose(self, execution: Execution) -> Result[Execution]: ...
    def get_execution(self, execution_id: str) -> Result[Execution]: ...
    def cancel_execution(self, execution_id: str) -> Result[Execution]: ...


class LiftAdapter(Protocol):
    def submit_lift_route(self, execution: Execution) -> Result[Execution]: ...
    def get_execution(self, execution_id: str) -> Result[Execution]: ...
    def cancel_execution(self, execution_id: str) -> Result[Execution]: ...


class VlaPickAdapter(Protocol):
    def submit_pick(self, execution: Execution) -> Result[Execution]: ...
    def get_execution(self, execution_id: str) -> Result[Execution]: ...
    def cancel_execution(self, execution_id: str) -> Result[Execution]: ...


class PerceptionAdapter(Protocol):
    def observe(self, task_id: str, phase: str, cycle: int) -> Result[Observation]: ...
    def verify_placement(self, task_id: str, counter: int) -> Result[bool]: ...


class PlatformAdapter(Protocol):
    def report_completion(self, task_id: str, order_id: str, session_id: str, execution_id: str) -> Result[str]: ...
    def get_report(self, task_id: str) -> Result[CompletionReport]: ...
