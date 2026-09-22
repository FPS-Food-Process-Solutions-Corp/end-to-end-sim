"""Separate saved-route lift seam with measured convergence requirement."""

from ..models import Execution, Result
from ..stubs import StubDevice


class StubLift:
    def __init__(self, device: StubDevice):
        self.device = device

    def execute_lift_route(self, execution: Execution) -> Result[Execution]:
        return self.device.submit_lift_route(execution)

    def submit_lift_route(self, execution: Execution) -> Result[Execution]:
        return self.execute_lift_route(execution)

    def get_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.get_execution(execution_id)

    def cancel_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.cancel_execution(execution_id)
