"""Child process for the durable after-place/before-return crash boundary."""

import asyncio
import sys
from pathlib import Path

from humanoid_harness.integration import HumanoidPickExecutor

from .fixtures import task_context


async def main(state_root):
    executor = HumanoidPickExecutor(state_root, crash_after_place_once=True)

    async def progress(_subtask, _percent):
        return None

    await executor.run(task_context(), progress)
    await executor.drain()


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
