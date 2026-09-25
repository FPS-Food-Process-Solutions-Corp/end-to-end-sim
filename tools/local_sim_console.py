"""Read-only Textual observer for the staged local robotics simulation."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple

from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Footer, Header, Static, TabbedContent, TabPane

from local_sim_console_support import (FileView, JournalView, LogSource, default_log_sources,
                                       default_journal_path, journal_lines, load_journal, parse_log_source,
                                       manifest_log_sources, manifest_process_names,
                                       process_states, tail_file)


DEFAULT_RUNTIME_DIR = Path("/home/user/e2e-stage/runtime")
PROCESS_NAMES: Tuple[str, ...] = ("api", "web", "bridge", "ros")


class LocalSimConsole(App):
    """Display runtime evidence only; this app never starts, stops, or signals processes."""

    TITLE = "Local Simulation Observer"
    BINDINGS = [
        ("f", "refresh", "refresh"),
        ("q", "quit", "quit"),
    ]

    CSS = """
    Screen { layout: vertical; }
    #status { height: auto; min-height: 2; padding: 0 1; }
    TabbedContent { height: 1fr; min-height: 3; }
    TabPane { padding: 0; }
    VerticalScroll { height: 1fr; min-height: 3; }
    VerticalScroll > Static { width: 100%; height: auto; }
    """

    def __init__(self, sources: Sequence[LogSource], journal_path: Path,
                 manifest_path: Path, lines: int, refresh_s: float) -> None:
        super().__init__()
        self._sources = tuple(sources)
        self._journal_path = journal_path
        self._manifest_path = manifest_path
        self._lines = lines
        self._refresh_s = refresh_s
        self._status: Optional[Static] = None
        self._log_widgets: Dict[str, Static] = {}
        self._journal_widget: Optional[Static] = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        self._status = Static("reading runtime evidence", id="status")
        yield self._status
        with TabbedContent():
            for index, source in enumerate(self._sources):
                widget_id = "log-%d" % index
                with TabPane(source.label, id="tab-%d" % index):
                    with VerticalScroll():
                        widget = Static("waiting for first refresh", id=widget_id)
                        self._log_widgets[source.label] = widget
                        yield widget
            with TabPane("journal", id="journal"):
                with VerticalScroll():
                    self._journal_widget = Static("waiting for first refresh",
                                                  id="journal-text")
                    yield self._journal_widget
        yield Footer()

    def on_mount(self) -> None:
        self._refresh()
        self.set_interval(self._refresh_s, self._refresh)

    def action_refresh(self) -> None:
        self._refresh()
        self.notify("runtime evidence refreshed")

    def _refresh(self) -> None:
        names = manifest_process_names(self._manifest_path, PROCESS_NAMES)
        states = process_states(self._manifest_path, names)
        if self._status is not None:
            self._status.update(self._status_text(states))
        sources = manifest_log_sources(self._manifest_path.parent, self._manifest_path,
                                       self._sources)
        for source in sources:
            self._refresh_log(source, tail_file(source.path, self._lines))
        if self._journal_widget is not None:
            journal = load_journal(self._journal_path)
            self._journal_widget.update(self._journal_text(journal))

    def _refresh_log(self, source: LogSource, view: FileView) -> None:
        widget = self._log_widgets[source.label]
        prefix = "%s\n" % source.path
        if view.error:
            widget.update(prefix + view.error)
            return
        widget.update(prefix + ("\n".join(view.lines) if view.lines else "no lines yet"))

    def _status_text(self, states) -> str:
        rows = ["READ-ONLY: this console cannot start, stop, restart, or signal any process.",
                "runtime: %s" % self._manifest_path.parent,
                "process manifest: %s" % self._manifest_path]
        rows.extend("%-9s %-11s %s" % (state.name, state.status, state.detail)
                    for state in states)
        return "\n".join(rows)

    def _journal_text(self, view: JournalView) -> str:
        return "%s\n%s" % (view.path, "\n".join(journal_lines(view, self._lines)))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read-only local simulation terminal observer")
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR,
                        help="directory containing staged logs and processes.json")
    parser.add_argument("--journal", type=Path, default=None,
                        help="bridge JSON or simulator JSONL journal to display")
    parser.add_argument("--process-manifest", type=Path, default=None,
                        help="JSON mapping service names to PID and start_time_ticks")
    parser.add_argument("--log", action="append", default=[], metavar="LABEL=PATH",
                        help="custom labeled log source; repeatable, replaces default sources")
    parser.add_argument("--lines", type=int, default=120,
                        help="maximum recent lines displayed per source")
    parser.add_argument("--refresh-seconds", type=float, default=1.0,
                        help="file refresh interval in seconds")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.lines <= 0:
        parser.error("--lines must be positive")
    if args.refresh_seconds <= 0:
        parser.error("--refresh-seconds must be positive")
    try:
        sources = tuple(parse_log_source(item) for item in args.log)
    except ValueError as exc:
        parser.error(str(exc))
    labels = [source.label for source in sources]
    if len(set(labels)) != len(labels):
        parser.error("--log labels must be unique")
    runtime_dir = args.runtime_dir
    if not sources:
        sources = default_log_sources(runtime_dir)
    manifest_path = args.process_manifest or runtime_dir / "processes.json"
    journal_path = args.journal or default_journal_path(runtime_dir, manifest_path)
    LocalSimConsole(sources, journal_path, manifest_path, args.lines,
                    args.refresh_seconds).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
