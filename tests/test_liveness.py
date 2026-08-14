"""Adaptive liveness (2026-08-14).

The old rule — "live = file written within 30s" — imported a cadence
assumption. A healthy run logging every ~60s (light_interval 100 at ~0.6
s/step) read as dead for the back half of every write gap, so the sidebar's
live light flickered off while training continued. Liveness is now judged
against the run's OWN write rhythm: the window is the larger of the 30s floor
and LIVE_GAP_MULT x the worst gap between the run's recent elapsed_seconds
values. A run only reads as stopped once it has missed multiple of its own
cadences.
"""

import json
import os
import time

from fastapi.testclient import TestClient

from luthiscope.config import Settings
from luthiscope.server.app import LIVE_GAP_MULT, LIVE_STALE_SECONDS, create_app


def _settings(tmp_path, runs_dir):
    return Settings(
        runs_dir=runs_dir,
        home=tmp_path / "home",
        host="127.0.0.1",
        port=0,
        registry=tmp_path / "no-registry.json",
    )


def _mk_run(root, name, gaps, mtime_age):
    """A run whose records are spaced by ``gaps`` seconds of run-time, with the
    log file's mtime set ``mtime_age`` seconds in the past."""
    d = root / name
    d.mkdir(parents=True)
    lines, elapsed = [], 0.0
    for i, gap in enumerate([0.0] + list(gaps)):
        elapsed += gap
        lines.append(json.dumps(
            {"step": (i + 1) * 100, "loss": 1.0, "elapsed_seconds": elapsed}))
    f = d / "training_log.jsonl"
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    past = time.time() - mtime_age
    os.utime(f, (past, past))
    return d


def _stream(client, name):
    return next(s for s in client.get("/api/streams").json()
                if s["run_dir"] == name)


def test_slow_cadence_run_stays_live_between_writes(tmp_path):
    # Writes ~62s apart; last write 45s ago. Under the old fixed 30s window
    # this read as dead mid-gap. It must read live: the run's own rhythm says
    # nothing is wrong yet.
    runs = tmp_path / "runs"
    _mk_run(runs, "slow", gaps=[62, 0.4, 61, 0.4, 63], mtime_age=45)
    client = TestClient(create_app(_settings(tmp_path, runs)))
    s = _stream(client, "slow")
    assert s["live"] is True
    assert s["live_window"] >= LIVE_GAP_MULT * 63
    assert s["last_write_age"] is not None and s["last_write_age"] >= 45


def test_slow_cadence_run_reads_stopped_after_missed_cadences(tmp_path):
    # Same rhythm, but the last write was several cadences ago: dead.
    runs = tmp_path / "runs"
    _mk_run(runs, "stalled", gaps=[62, 0.4, 61, 0.4, 63],
            mtime_age=LIVE_GAP_MULT * 63 + 60)
    client = TestClient(create_app(_settings(tmp_path, runs)))
    assert _stream(client, "stalled")["live"] is False


def test_fast_cadence_run_keeps_the_floor_window(tmp_path):
    # Writes every ~1s; 45s of silence is many missed cadences — dead. The
    # adaptive window must not shrink below the floor, but it must not grow
    # past it for a fast writer either.
    runs = tmp_path / "runs"
    _mk_run(runs, "fast", gaps=[1, 1, 1, 1, 1], mtime_age=45)
    client = TestClient(create_app(_settings(tmp_path, runs)))
    s = _stream(client, "fast")
    assert s["live"] is False
    assert s["live_window"] == LIVE_STALE_SECONDS


def test_run_without_elapsed_falls_back_to_floor(tmp_path):
    # No elapsed_seconds in the records: nothing to learn a rhythm from, so
    # the fixed floor applies (and a fresh file is live under it).
    runs = tmp_path / "runs"
    d = runs / "bare"
    d.mkdir(parents=True)
    (d / "training_log.jsonl").write_text(
        json.dumps({"step": 100, "loss": 1.0}) + "\n", encoding="utf-8")
    client = TestClient(create_app(_settings(tmp_path, runs)))
    s = _stream(client, "bare")
    assert s["live"] is True
    assert s["live_window"] == LIVE_STALE_SECONDS
