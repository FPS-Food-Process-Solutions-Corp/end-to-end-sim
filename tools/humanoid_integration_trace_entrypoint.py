"""Enable the public cell trace handler before the frozen integration launcher runs."""

import sys

from platform_common.diagnostics import configure_logging, trace

configure_logging()

if sys.argv[1:] == ["--trace-smoke"]:
    trace("fixture", "info_trace_smoke")
    raise SystemExit(0)

from humanoid_harness.integration.__main__ import main


if __name__ == "__main__":
    raise SystemExit(main())
