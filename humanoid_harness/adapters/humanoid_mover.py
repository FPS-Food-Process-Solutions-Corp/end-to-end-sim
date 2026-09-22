"""Named sparse upper-body pose seam; lift is a different adapter."""

from ..models import Execution, Result
from ..stubs import StubDevice


class StubHumanoidMover:
    def __init__(self, device: StubDevice):
        self.device = device

    def move_to_pose(self, execution: Execution) -> Result[Execution]:
        return self.device.submit_pose(execution)

    def submit_pose(self, execution: Execution) -> Result[Execution]:
        return self.move_to_pose(execution)

    def get_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.get_execution(execution_id)

    def cancel_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.cancel_execution(execution_id)
