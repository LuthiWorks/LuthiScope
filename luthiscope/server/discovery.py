"""Discover monitorable streams under the runs directory.

A "stream" is one metric file in one run directory — a single patient. A run dir
may hold both a training and a cognition stream; each is listed separately. The
scan is cheap and re-run on demand so new runs appear without a restart.
"""

import json
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


def _streams_in_dir(d: Path) -> list[Stream]:
    out: list[Stream] = []
    for filename, kind in STREAM_FILES.items():
        f = d / filename
        if f.is_file():
            out.append(Stream(f"{d.name}/{kind}", d.name, kind, f, filename))
    return out


def discover_streams(runs_dir: Path) -> list[Stream]:
    """Scan the immediate subdirs of runs_dir for stream files."""
    streams: list[Stream] = []
    if not runs_dir.exists():
        return streams
    for d in sorted(p for p in runs_dir.iterdir() if p.is_dir()):
        streams += _streams_in_dir(d)
    return streams


def registry_streams(registry_path: Path) -> list[Stream]:
    """Streams from run dirs the trainer announced in the handshake registry.

    The registry is a JSON object keyed by absolute run-dir path (the trainer
    writes its run dir there on start; see docs/RUN_REGISTRY.md). Read-only: we
    only read it. Lets LuthiScope find an active run anywhere, with no RUNS_DIR
    configured. Entries whose dir no longer exists are skipped.
    """
    streams: list[Stream] = []
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return streams
    if not isinstance(data, dict):
        return streams
    for run_dir_str in data:
        d = Path(run_dir_str)
        if d.is_dir():
            streams += _streams_in_dir(d)
    return streams


def discover_all(runs_dir: Path, registry_path: Path) -> list[Stream]:
    """Folder scan + registry handshake, deduped by stream_id (folder wins)."""
    by_id: dict[str, Stream] = {}
    for s in discover_streams(runs_dir):
        by_id[s.stream_id] = s
    for s in registry_streams(registry_path):
        by_id.setdefault(s.stream_id, s)
    return list(by_id.values())
