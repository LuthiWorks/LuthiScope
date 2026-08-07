"""Discover monitorable streams under the runs directory.

A "stream" is one metric file in one run directory — a single patient. A run dir
may hold both a training and a cognition stream; each is listed separately. The
scan is cheap and re-run on demand so new runs appear without a restart.

Ordering is by RECENCY, newest first (2026-08-06). It used to be alphabetical,
which reads as recency to anyone at the bedside and isn't: by ASCII,
``probe_v5_d8_warmup15_…`` (digit) sorts before ``probe_v5_d8_warmup_…``
(underscore), so the newest run sat above an older one and the list's last entry
was a different run than the reader believed. That inverted a live reading of the
depth-8 probes — the run that sorted last had recovered, the one that sorted
first had collapsed. The list must order the way a human assumes it does.
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
    mtime: float     # source-file mtime; the recency the list orders by


def _streams_in_dir(d: Path) -> list[Stream]:
    out: list[Stream] = []
    for filename, kind in STREAM_FILES.items():
        f = d / filename
        if f.is_file():
            try:
                mtime = f.stat().st_mtime
            except OSError:
                # The is_file() above just passed, so this is a race (rotation,
                # deletion mid-scan). Sort it last rather than let an unknown
                # age masquerade as "just written".
                mtime = 0.0
            out.append(Stream(f"{d.name}/{kind}", d.name, kind, f, filename, mtime))
    return out


def by_recency(streams: list[Stream]) -> list[Stream]:
    """Newest-written first; ties broken by name so the order is stable."""
    return sorted(streams, key=lambda s: (-s.mtime, s.stream_id))


def discover_streams(runs_dir: Path) -> list[Stream]:
    """Scan the immediate subdirs of runs_dir for stream files, newest first."""
    streams: list[Stream] = []
    if not runs_dir.exists():
        return streams
    for d in (p for p in runs_dir.iterdir() if p.is_dir()):
        streams += _streams_in_dir(d)
    return by_recency(streams)


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
    """Folder scan + registry handshake, deduped by stream_id (folder wins),
    newest-written first."""
    by_id: dict[str, Stream] = {}
    for s in discover_streams(runs_dir):
        by_id[s.stream_id] = s
    for s in registry_streams(registry_path):
        by_id.setdefault(s.stream_id, s)
    return by_recency(list(by_id.values()))


# Cadence keys we surface, in the order the header reads them.
_CADENCE_KEYS = ("deep_interval_batches", "light_interval_batches")


def run_cadence(run_dir: Path) -> dict:
    """Logging cadence declared in a run's own ``run_config.json``.

    The record count is NOT the step count, and the ratio between them changed
    under a reader on 2026-08-05 when the depth-8 probe arms dropped
    ``deep_interval_batches`` from 1000 to 100 and nothing in the UI said so. He
    decoded 31 records against the spacing that had been true for every run he
    had ever watched and got "~31k steps" for a run that ended at 3000. The
    interface changed meaning silently; the fix is to state the cadence in place,
    per run, from the run's own file.

    Missing or malformed file = empty dict, never an error: a run that declares
    nothing gets no cadence label rather than a fabricated one.
    """
    try:
        data = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    logging_cfg = data.get("logging")
    if not isinstance(logging_cfg, dict):
        return {}
    out = {}
    for key in _CADENCE_KEYS:
        v = logging_cfg.get(key)
        if isinstance(v, int) and v > 0:
            out[key] = v
    return out


# Thresholds a run declares that are ACTUALLY ABSOLUTE — the value the guard
# compares against directly, with no baselining, so a line drawn at it is the
# line the trainer would kill on.
#
# The rest of kill_criteria is deliberately NOT here, and the reason is the whole
# point of this brief. std_collapse_threshold (0.1) and correlation_collapse_
# threshold (0.95) are FALLBACKS: jepa_runner prefers a pilot-set baseline
# derived from the run's own early trajectory and only falls back to the config
# number when that baseline hasn't latched. dimensional_collapse_threshold_pct
# (0.5) is not a level at all — kill-2 fires at running_max * (1 - 0.5), a moving
# anchor. Drawing any of the three as "the kill line" would be false in the
# normal case, which is exactly the class of instrument lie this display is
# being corrected for. They are reported as withheld, with the reason, rather
# than silently dropped: a reader must not conclude the run declared nothing.
_ABSOLUTE_THRESHOLDS = {
    "cosine_collapse_threshold": {
        "series": "triv_cos",
        "note": "absolute — near-identical encoders is collapse regardless of "
                "training history (jepa_runner kill-5)",
    },
    "divergence_nmse_max": {
        "series": "heldout_nmse",
        "note": "absolute — compared directly against nmse_mean "
                "(jepa_runner divergence check)",
    },
}

_BASELINED_THRESHOLDS = {
    "std_collapse_threshold":
        "fallback only — kill-1 prefers a pilot-set baseline from the run's own "
        "early trajectory",
    "correlation_collapse_threshold":
        "fallback only — kill-3 prefers baseline-plus-margin",
    "dimensional_collapse_threshold_pct":
        "not a level — kill-2 fires at running_max x (1 - pct), a moving anchor",
}


def run_thresholds(run_dir: Path) -> dict:
    """Reference lines a run declares that can be honestly drawn, plus the ones
    that cannot and why. Missing/malformed config = nothing declared."""
    try:
        data = json.loads((run_dir / "run_config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"lines": {}, "withheld": {}}
    kc = data.get("kill_criteria")
    kc = kc if isinstance(kc, dict) else {}
    lines = {}
    for key, spec in _ABSOLUTE_THRESHOLDS.items():
        v = kc.get(key, data.get(key))
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            lines[key] = {"value": float(v), **spec}
    withheld = {
        key: reason for key, reason in _BASELINED_THRESHOLDS.items()
        if isinstance(kc.get(key, data.get(key)), (int, float))
    }
    return {"lines": lines, "withheld": withheld}
