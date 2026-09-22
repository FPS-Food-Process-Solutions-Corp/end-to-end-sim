"""Command line runner for the deterministic humanoid harness."""

import argparse
import json
from pathlib import Path

from .config import SCENARIOS, scenario_config
from .controller import Harness
from .storage import StateError, read_json, write_json
from .stubs import InjectedCrash
from .visual import write_visual


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulate one pastry per Rack B platform task")
    parser.add_argument("--scenario", choices=SCENARIOS, default="happy")
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--config", type=Path, help="JSON config; pass the same file on resume")
    parser.add_argument("--write-default-config", type=Path, metavar="FILE", help="write selected scenario config and exit")
    args = parser.parse_args()
    try:
        config = read_json(args.config) if args.config is not None else scenario_config(args.scenario)
        if args.write_default_config is not None:
            if args.write_default_config.exists():
                raise StateError("Refusing to overwrite existing config file")
            write_json(args.write_default_config, config)
            print(f"Wrote simulation config: {args.write_default_config}")
            return 0
        if args.state_dir is None:
            parser.error("--state-dir is required unless --write-default-config is used")
        harness = Harness(args.state_dir, config, resume=args.resume)
        try:
            summary = harness.run()
        except InjectedCrash as exc:
            summary = harness.summary()
            summary["phase"] = "crash_after_effect"
            write_json(harness.summary_path, summary)
            write_visual(harness.visual_path, config, harness.device.state, harness.state, harness.events_path)
            print(f"Recoverable injected stop: {exc}")
            print(f"Resume with --scenario {config['scenario']} --state-dir {args.state_dir} --resume")
            return 75
        print(json.dumps({"phase": summary["phase"], "orders": summary["orders"], "state_dir": str(args.state_dir)}, sort_keys=True))
        return 2 if summary["phase"] == "hold" else 0
    except (StateError, ValueError, OSError) as exc:
        print(f"Harness error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
