"""Regenerate the area-grouped SVG and robot reference library."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("build_area_plan.py")), run_name="__main__")
