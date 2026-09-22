"""Measured pose and world-derived bun possession seam."""

from ..models import Observation, Result
from ..stubs import StubDevice


class StubPerception:
    def __init__(self, device: StubDevice):
        self.device = device

    def check_bun_in_hand(self, task_id: str, phase: str, cycle: int) -> Result[Observation]:
        return self.device.observe(task_id, phase, cycle)

    def observe(self, task_id: str, phase: str, cycle: int) -> Result[Observation]:
        return self.check_bun_in_hand(task_id, phase, cycle)

    def verify_placement(self, task_id: str, counter: int) -> Result[bool]:
        return self.device.verify_placement(task_id, counter)
