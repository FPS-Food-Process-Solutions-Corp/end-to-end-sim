"""Hard process exit after durable post-place travel, before readiness proof."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

from hr_client.pending_failure import PendingFailureStore

from humanoid_harness.integration import HumanoidPickExecutor
from humanoid_harness.stubs import StubDevice

from .fixtures import task_context


async def main(state_root):
    executor = HumanoidPickExecutor(state_root, pending_failure_store=PendingFailureStore(str(state_root / "pending-failures.json")))
    original_save = StubDevice._save

    def crash_after_durable_travel(device):
        original_save(device)
        if any(record["kind"] == "post_place_retract" and record["effect_applied"] for record in device.state["executions"].values()):
            os._exit(78)

    async def progress(_subtask, _percent):
        return None

    with patch.object(StubDevice, "_save", crash_after_durable_travel):
        await executor.run(task_context(task_id="pastry-c"), progress)
    raise AssertionError("Post-place travel effect did not trigger the hard crash")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
