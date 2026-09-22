"""Pick-job seam that wraps policy chunks, servoing and verification."""

from ..models import Execution, Result
from ..stubs import StubDevice


class StubVla:
    def __init__(self, device: StubDevice):
        self.device = device

    def pick(self, execution: Execution) -> Result[Execution]:
        return self.device.submit_pick(execution)

    def submit_pick(self, execution: Execution) -> Result[Execution]:
        return self.pick(execution)

    def get_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.get_execution(execution_id)

    def cancel_execution(self, execution_id: str) -> Result[Execution]:
        return self.device.cancel_execution(execution_id)
