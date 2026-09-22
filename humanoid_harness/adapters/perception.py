"""Measured pose and world-derived bun possession seam."""

from ..models import FailureReadiness, Observation, ReleaseReadiness, Result
from ..stubs import StubDevice


class StubPerception:
    def __init__(self, device: StubDevice):
        self.device = device

    def check_bun_in_hand(self, task_id: str, phase: str, cycle: int) -> Result[Observation]:
        return self.device.observe(task_id, phase, cycle)

    def observe(self, task_id: str, phase: str, cycle: int) -> Result[Observation]:
        return self.check_bun_in_hand(task_id, phase, cycle)

    def read_failure_source_observation(self, task_id: str, observation_version: int) -> Result[Observation]:
        return self.device.read_failure_source_observation(task_id, observation_version)

    def read_placement_observation(self, task_id: str, observation_version: int) -> Result[Observation]:
        return self.device.read_placement_observation(task_id, observation_version)

    def verify_placement(self, task_id: str, counter: int) -> Result[bool]:
        return self.device.verify_placement(task_id, counter)

    def verify_failure_readiness(self, task_id: str, cycle: int, recovery_execution_id: str, expected_posture: str) -> Result[FailureReadiness]:
        return self.device.verify_failure_readiness(task_id, cycle, recovery_execution_id, expected_posture)

    def read_failure_readiness(self, task_id: str, cycle: int, recovery_execution_id: str, expected_posture: str, observation_version: int) -> Result[FailureReadiness]:
        return self.device.read_failure_readiness(task_id, cycle, recovery_execution_id, expected_posture, observation_version)

    def verify_release_readiness(self, task_id: str, cycle: int, counter: int, recovery_execution_id: str, expected_posture: str) -> Result[ReleaseReadiness]:
        return self.device.verify_release_readiness(task_id, cycle, counter, recovery_execution_id, expected_posture)

    def read_release_readiness(self, task_id: str, cycle: int, counter: int, recovery_execution_id: str, expected_posture: str, observation_version: int) -> Result[ReleaseReadiness]:
        return self.device.read_release_readiness(task_id, cycle, counter, recovery_execution_id, expected_posture, observation_version)
