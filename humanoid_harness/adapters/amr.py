"""AMR tag navigation seam; a submit ACK is not arrival."""

from ..models import Execution, Result
from ..stubs import StubDevice


class StubAmr:
    def __init__(self, device: StubDevice):
        self.device = device

    def move_to_tag(self, execution: Execution) -> Result[Execution]:
        return self.device.submit_navigation(execution)

    def submit_navigation(self, execution: Execution) -> Result[Execution]:
        return self.move_to_tag(execution)

    def get_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.get_execution(execution_id)

    def cancel_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.cancel_execution(execution_id)
