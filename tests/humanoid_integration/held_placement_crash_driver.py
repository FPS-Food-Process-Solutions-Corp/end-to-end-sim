"""Hard exit after verified placement has durably entered device HOLD."""

import asyncio
import sys
from pathlib import Path

from hr_client.client import PickExecutionStatus

from humanoid_harness.integration import HumanoidPickExecutor

from .fixtures import faulty_config, task_context


async def main(state_root, marker_preexisting=False):
    if marker_preexisting:
        state_root.mkdir(parents=True, exist_ok=True)
        (state_root / "crash-after-held-placement.used.json").write_text('{"existing":true}', encoding="ascii")
    executor = HumanoidPickExecutor(state_root, config_factory=lambda ctx: faulty_config(ctx, "post_place_retract", "unknown"), crash_after_held_placement_once=True)

    async def progress(_subtask, _percent):
        return None

    outcome = await executor.run(task_context(), progress)
    if marker_preexisting:
        assert outcome.status is PickExecutionStatus.COMPLETED
        assert not outcome.ready_for_next
        await executor.drain()
        return
    raise AssertionError("Held-placement boundary did not trigger the hard crash")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1]), marker_preexisting="--marker-preexisting" in sys.argv[2:]))
