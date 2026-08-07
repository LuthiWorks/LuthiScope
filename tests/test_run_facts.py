"""Recency ordering, declared cadence, and which thresholds may be drawn.

All three come from the same defect class: the display let the reader supply
from memory something the data already carried. Alphabetical order read as
recency; a record count read as a step count after the cadence changed 10x in
silence; and a config value read as "the line the guard uses" when the guard had
derived a different one from the run's own trajectory.
"""

import json
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from luthiscope.config import Settings
from luthiscope.server.app import create_app
from luthiscope.server.discovery import (
    discover_streams,
    run_cadence,
    run_thresholds,
)
from luthiscope.store.db import TRAINING, Store


def _settings(tmp_path, runs_dir) -> Settings:
    return Settings(
        runs_dir=runs_dir,
        home=tmp_path / "home",
        host="127.0.0.1",
        port=0,
        registry=tmp_path / "no-registry.json",
    )


def _run(dir_: Path, *, steps=(100, 200), config=None, mtime=None) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    log = dir_ / "training_log.jsonl"
    log.write_text(
        "".join(json.dumps({"step": s, "loss": 1.0}) + "\n" for s in steps),
        encoding="utf-8",
    )
    if config is not None:
        (dir_ / "run_config.json").write_text(json.dumps(config), encoding="utf-8")
    if mtime is not None:
        os.utime(log, (mtime, mtime))
    return dir_


# -- ordering (§2) --

def test_newest_run_is_first_even_when_it_sorts_earlier_alphabetically(tmp_path):
    """The exact 2026-08-06 collision: by ASCII the digit in `warmup15` sorts
    before the underscore in `warmup_`, so alphabetical order put the NEWER run
    above the older one and the list's last row was not the last run."""
    runs = tmp_path / "runs"
    now = time.time()
    _run(runs / "probe_warmup_512d", mtime=now - 3600)   # older, sorts LAST by name
    _run(runs / "probe_warmup15_512d", mtime=now)        # newer, sorts FIRST by name
    order = [s.run_dir for s in discover_streams(runs)]
    assert order == ["probe_warmup15_512d", "probe_warmup_512d"]


def test_recency_order_is_stable_for_equal_mtimes(tmp_path):
    runs = tmp_path / "runs"
    t = time.time()
    _run(runs / "b_run", mtime=t)
    _run(runs / "a_run", mtime=t)
    assert [s.run_dir for s in discover_streams(runs)] == ["a_run", "b_run"]


def test_streams_endpoint_reports_mtime(tmp_path):
    runs = tmp_path / "runs"
    t = time.time() - 500
    _run(runs / "r1", mtime=t)
    app = create_app(_settings(tmp_path, runs))
    rows = TestClient(app).get("/api/streams").json()
    assert rows[0]["mtime"] == float(int(t)) or abs(rows[0]["mtime"] - t) < 2


# -- cadence and true step range (§3) --

def test_cadence_read_from_the_runs_own_config(tmp_path):
    d = _run(tmp_path / "r", config={"logging": {"deep_interval_batches": 100,
                                                 "light_interval_batches": 100}})
    assert run_cadence(d) == {"deep_interval_batches": 100,
                              "light_interval_batches": 100}


def test_missing_or_malformed_config_declares_no_cadence(tmp_path):
    assert run_cadence(_run(tmp_path / "none")) == {}
    bad = _run(tmp_path / "bad")
    (bad / "run_config.json").write_text("{not json", encoding="utf-8")
    assert run_cadence(bad) == {}
    empty = _run(tmp_path / "empty", config={"logging": "nope"})
    assert run_cadence(empty) == {}


def test_two_runs_at_different_cadence_report_differently(tmp_path):
    """The acceptance case: one cadence-1000 run and one cadence-100 run must
    carry different, correct labels."""
    slow = _run(tmp_path / "slow", config={"logging": {"deep_interval_batches": 1000}})
    fast = _run(tmp_path / "fast", config={"logging": {"deep_interval_batches": 100}})
    assert run_cadence(slow)["deep_interval_batches"] == 1000
    assert run_cadence(fast)["deep_interval_batches"] == 100


def test_axis_range_separates_step_span_from_record_count(tmp_path):
    """31 records is not 31k steps. The pair must be reportable separately, and
    records with no step must not be folded into the count that has one."""
    store = Store(tmp_path / "db.sqlite")
    store.ingest_training("r/training", [
        {"step": 100}, {"step": 3000}, {"loss": 1.0},   # third carries no step
    ])
    rng = store.axis_range("r/training", TRAINING)
    assert rng == {"axis": "step", "first": 100, "last": 3000,
                   "n_with_axis": 2, "n_records": 3}
    store.close()


def test_runmeta_endpoint_states_cadence_and_range(tmp_path):
    runs = tmp_path / "runs"
    _run(runs / "probe", steps=(100, 3000),
         config={"logging": {"deep_interval_batches": 100}})
    app = create_app(_settings(tmp_path, runs))
    meta = TestClient(app).get("/api/streams/probe/training/runmeta").json()
    assert meta["cadence"]["deep_interval_batches"] == 100
    assert meta["axis"]["first"] == 100 and meta["axis"]["last"] == 3000
    assert meta["axis"]["n_records"] == 2


# -- which thresholds may be drawn (§1) --

FULL_KILL_CRITERIA = {
    "kill_criteria": {
        "std_collapse_threshold": 0.1,
        "correlation_collapse_threshold": 0.95,
        "cosine_collapse_threshold": 0.99,
        "dimensional_collapse_threshold_pct": 0.5,
    },
    "divergence_nmse_max": 2.0,
}


def test_only_genuinely_absolute_thresholds_are_offered_as_lines(tmp_path):
    """std/correlation are fallbacks the guard replaces with a pilot-set baseline,
    and the dimensional one is a percent of a moving anchor. Drawing any of them
    as "the kill line" would be false in the normal case."""
    d = _run(tmp_path / "r", config=FULL_KILL_CRITERIA)
    got = run_thresholds(d)
    assert set(got["lines"]) == {"cosine_collapse_threshold", "divergence_nmse_max"}
    assert got["lines"]["cosine_collapse_threshold"]["value"] == 0.99
    assert got["lines"]["divergence_nmse_max"]["series"] == "heldout_nmse"


def test_withheld_thresholds_are_reported_with_a_reason(tmp_path):
    """Silently dropping them would read as "the run declared nothing"."""
    d = _run(tmp_path / "r", config=FULL_KILL_CRITERIA)
    withheld = run_thresholds(d)["withheld"]
    assert set(withheld) == {"std_collapse_threshold",
                             "correlation_collapse_threshold",
                             "dimensional_collapse_threshold_pct"}
    assert all(withheld.values()), "every withheld threshold must say why"


def test_no_config_declares_no_lines(tmp_path):
    got = run_thresholds(_run(tmp_path / "r"))
    assert got == {"lines": {}, "withheld": {}}
