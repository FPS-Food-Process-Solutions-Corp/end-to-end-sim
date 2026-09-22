"""Hard process exit after durable place effect, before placement proof."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

from humanoid_harness.integration import HumanoidPickExecutor
from humanoid_harness.stubs import StubDevice

from .fixtures import task_context


async def main(state_root):
    executor = HumanoidPickExecutor(state_root)
    original_save = StubDevice._save

    def crash_after_durable_place(device):
        original_save(device)
        if any(record["kind"] == "place" and record["effect_applied"] for record in device.state["executions"].values()):
            os._exit(79)

    async def progress(_subtask, _percent):
        return None

    with patch.object(StubDevice, "_save", crash_after_durable_place):
        await executor.run(task_context(), progress)
    raise AssertionError("Place effect did not trigger the hard crash")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
