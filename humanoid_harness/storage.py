"""Small durable JSON store; each truth has its own atomic file."""

import json
import os
from pathlib import Path
import sys
import time

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl


class StateError(ValueError):
    pass


class StateLock:
    def __init__(self, path: Path):
        self.path = path
        self.stream = None

    def acquire(self) -> None:
        try:
            self.stream = self.path.open("a+b")
            self.stream.seek(0)
            if self.stream.read(1) == b"":
                self.stream.seek(0)
                self.stream.write(b"0")
                self.stream.flush()
            self.stream.seek(0)
            if sys.platform == "win32":
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if self.stream is not None:
                self.stream.close()
                self.stream = None
            raise StateError(f"State directory has an active writer or cannot be locked: {exc}") from exc

    def release(self) -> None:
        if self.stream is None:
            return
        self.stream.seek(0)
        if sys.platform == "win32":
            msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
        self.stream.close()
        self.stream = None


def read_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="ascii") as stream:
            value = json.load(stream)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise StateError(f"Cannot read valid state at {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise StateError(f"State at {path} must be a JSON object")
    return value


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    try:
        with temporary.open("w", encoding="ascii", newline="\n") as stream:
            json.dump(value, stream, indent=2, sort_keys=True, ensure_ascii=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        for attempt in range(5):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.02 * (attempt + 1))
    except OSError as exc:
        raise StateError(f"Cannot persist {path}: {exc}") from exc


def append_event(path: Path, value: dict) -> None:
    try:
        with path.open("a", encoding="ascii", newline="\n") as stream:
            stream.write(json.dumps(value, sort_keys=True, ensure_ascii=True) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as exc:
        raise StateError(f"Cannot append event at {path}: {exc}") from exc
