"""Discover monitorable streams under the runs directory.

A "stream" is one metric file in one run directory — a single patient. A run dir
may hold both a training and a cognition stream; each is listed separately. The
scan is cheap and re-run on demand so new runs appear without a restart.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# filename -> kind (matches contract §1 / §2)
STREAM_FILES = {
    "training_log.jsonl": "training",
    "m9_action_log.jsonl": "cognition",
}


@dataclass(frozen=True)
class Stream:
    stream_id: str   # "<run_dir>/<kind>"
    run_dir: str     # the run directory name
    kind: str        # "training" | "cognition"
    path: Path       # absolute path to the JSONL file
    filename: str


def discover_streams(runs_dir: Path) -> list[Stream]:
    streams: list[Stream] = []
    if not runs_dir.exists():
        return streams
    for d in sorted(p for p in runs_dir.iterdir() if p.is_dir()):
        for filename, kind in STREAM_FILES.items():
            f = d / filename
            if f.is_file():
                streams.append(
                    Stream(
                        stream_id=f"{d.name}/{kind}",
                        run_dir=d.name,
                        kind=kind,
                        path=f,
                        filename=filename,
                    )
                )
    return streams


def streams_map(runs_dir: Path) -> dict[str, Stream]:
    return {s.stream_id: s for s in discover_streams(runs_dir)}
