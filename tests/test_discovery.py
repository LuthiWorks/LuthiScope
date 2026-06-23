"""Discovery + the trainer↔LuthiScope registry handshake.

The registry is how an actively-running trainer tells LuthiScope where its run
dir is, so a run logging *anywhere* on disk is found with no RUNS_DIR config.
LuthiScope only ever reads the registry; the read must be tolerant of a missing,
empty, malformed, or stale file (a run dir that has since been deleted).
"""

import json
from pathlib import Path

from luthiscope.server.discovery import (
    discover_all,
    discover_streams,
    registry_streams,
)


def _make_run(dir_: Path, *, training=True, cognition=False) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    if training:
        (dir_ / "training_log.jsonl").write_text('{"step": 1}\n', encoding="utf-8")
    if cognition:
        (dir_ / "m9_action_log.jsonl").write_text('{"t": 1}\n', encoding="utf-8")
    return dir_


def test_folder_scan_finds_both_kinds(tmp_path):
    runs = tmp_path / "runs"
    _make_run(runs / "run_a", training=True, cognition=True)
    ids = {s.stream_id for s in discover_streams(runs)}
    assert ids == {"run_a/training", "run_a/cognition"}


def test_registry_missing_file_is_empty(tmp_path):
    assert registry_streams(tmp_path / "nope.json") == []


def test_registry_malformed_is_empty(tmp_path):
    bad = tmp_path / "runs.json"
    bad.write_text("{not json", encoding="utf-8")
    assert registry_streams(bad) == []
    bad.write_text("[1, 2, 3]", encoding="utf-8")  # valid JSON, wrong shape
    assert registry_streams(bad) == []


def test_registry_lists_announced_run(tmp_path):
    run = _make_run(tmp_path / "anywhere" / "m8_live", training=True)
    reg = tmp_path / "runs.json"
    reg.write_text(json.dumps({str(run): {"pid": 123, "started_at": 1.0}}), "utf-8")
    streams = registry_streams(reg)
    assert [s.stream_id for s in streams] == ["m8_live/training"]
    assert streams[0].path == run / "training_log.jsonl"


def test_registry_skips_vanished_dir(tmp_path):
    reg = tmp_path / "runs.json"
    reg.write_text(json.dumps({str(tmp_path / "gone"): {"pid": 1}}), "utf-8")
    assert registry_streams(reg) == []


def test_discover_all_merges_and_dedupes(tmp_path):
    # A run that is both under runs_dir AND announced in the registry appears once.
    runs = tmp_path / "runs"
    shared = _make_run(runs / "shared", training=True)
    only_registry = _make_run(
        tmp_path / "elsewhere" / "remote", training=False, cognition=True
    )
    reg = tmp_path / "runs.json"
    reg.write_text(
        json.dumps({str(shared): {}, str(only_registry): {}}), encoding="utf-8"
    )
    ids = sorted(s.stream_id for s in discover_all(runs, reg))
    assert ids == ["remote/cognition", "shared/training"]
