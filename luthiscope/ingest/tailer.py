"""Incremental JSONL reader — the core of live tailing, stdlib only.

``JsonlFollower`` returns records from complete lines appended since the last
call, leaving a partially-written trailing line (one without a terminating
newline) buffered for the next read (contract §0 rule 1). Phase 1 wraps this with
a filesystem watcher to push updates over WebSocket; keeping the incremental-read
logic here means it can be unit-tested without any watching.
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

from luthiscope.ingest.parser import parse_line


class JsonlFollower:
    def __init__(self, path: Union[str, Path]):
        self.path = Path(path)
        self._offset = 0

    @property
    def offset(self) -> int:
        return self._offset

    def reset(self) -> None:
        self._offset = 0

    def seek_to_end(self) -> None:
        """Advance the offset to the current end of file, so a subsequent
        read_new() returns only lines appended *after* this call. Used by the
        live WebSocket so it streams new records rather than re-sending history.
        """
        try:
            self._offset = self.path.stat().st_size
        except FileNotFoundError:
            self._offset = 0

    def read_new(self) -> list[dict]:
        """Records from lines completed since the last read.

        A trailing line without a newline is treated as still being written: it
        is not consumed and the offset is not advanced past it, so the next call
        picks it up once it has been terminated.
        """
        try:
            with open(self.path, "rb") as f:
                f.seek(self._offset)
                data = f.read()
        except FileNotFoundError:
            return []
        if not data:
            return []
        last_nl = data.rfind(b"\n")
        if last_nl == -1:
            return []  # only a partial line present so far
        complete = data[: last_nl + 1]
        self._offset += len(complete)
        out: list[dict] = []
        for raw in complete.split(b"\n"):
            if not raw.strip():
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
            rec = parse_line(text)
            if rec is not None:
                out.append(rec)
        return out

    def read_all(self) -> list[dict]:
        """Re-read the whole file from the start."""
        self.reset()
        return self.read_new()
