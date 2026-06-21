"""Phase 0 exit criterion: ingest real JSONL and query it back losslessly,
plus the tolerant-parse / partial-line / rebuild guarantees the contract requires.

Fidelity is checked semantically (parsed-object equality), not byte equality —
the contract is JSON *objects*, so whitespace/key-order are not part of it.
"""

import json
from pathlib import Path

from luthiscope.ingest.parser import parse_line
from luthiscope.ingest.tailer import JsonlFollower
from luthiscope.store.db import COGNITION, TRAINING, Store

FIX = Path(__file__).parent / "fixtures"
TRAIN_FIX = FIX / "training_log.sample.jsonl"      # real m8_smoke data
COG_FIX = FIX / "cognition_action_log.sample.jsonl"  # synthetic, per corrected §2


def _raw_objs(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_parser_is_tolerant():
    assert parse_line("") is None
    assert parse_line("   ") is None
    assert parse_line("{not json") is None
    assert parse_line("[1, 2, 3]") is None  # valid JSON but not an object
    assert parse_line('{"a": 1}') == {"a": 1}


def test_follower_incremental_and_partial(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text('{"step": 1}\n{"step": 2}\n', encoding="utf-8")
    f = JsonlFollower(p)
    assert [r["step"] for r in f.read_new()] == [1, 2]
    assert f.read_new() == []  # nothing new

    # a partial line (no terminating newline) must NOT be returned yet
    with open(p, "a", encoding="utf-8") as fh:
        fh.write('{"step": 3}')
    assert f.read_new() == []

    # once terminated, it is delivered exactly once
    with open(p, "a", encoding="utf-8") as fh:
        fh.write("\n")
    assert [r["step"] for r in f.read_new()] == [3]
    assert f.read_new() == []


def test_follower_recovers_from_truncation(tmp_path):
    # If the file is truncated/rotated to something shorter than the read offset,
    # the follower must reset and re-read rather than going silently dead.
    p = tmp_path / "log.jsonl"
    p.write_text('{"a": 1}\n{"a": 2}\n', encoding="utf-8")
    f = JsonlFollower(p)
    assert [r["a"] for r in f.read_new()] == [1, 2]
    p.write_text('{"a": 9}\n', encoding="utf-8")  # smaller than the prior offset
    assert [r["a"] for r in f.read_new()] == [9]


def test_training_roundtrip_lossless():
    originals = _raw_objs(TRAIN_FIX)
    assert originals, "fixture should not be empty"
    with Store(":memory:") as store:
        n = store.ingest_file("m8_smoke", TRAINING, TRAIN_FIX)
        assert n == len(originals)
        assert store.training_raw("m8_smoke") == originals


def test_cognition_roundtrip_lossless():
    originals = _raw_objs(COG_FIX)
    assert originals
    with Store(":memory:") as store:
        n = store.ingest_file("m9_sample", COGNITION, COG_FIX)
        assert n == len(originals)
        assert store.cognition_raw("m9_sample") == originals


def test_training_indexed_columns():
    with Store(":memory:") as store:
        store.ingest_file("m8_smoke", TRAINING, TRAIN_FIX)
        row = store.conn.execute(
            "SELECT step, modality, loss, has_light, has_substrate, has_deep "
            "FROM training_records ORDER BY seq LIMIT 1"
        ).fetchone()
        assert row["step"] == 5
        assert row["modality"] == "text"
        assert isinstance(row["loss"], float)
        assert row["has_light"] == 1
        assert row["has_substrate"] == 1
        assert row["has_deep"] == 0  # first record carries no deep block

        # a deep-bearing record exists in the fixture (step 20)
        deep_count = store.conn.execute(
            "SELECT COUNT(*) FROM training_records WHERE has_deep=1"
        ).fetchone()[0]
        assert deep_count >= 1


def test_rebuild_is_idempotent():
    originals = _raw_objs(TRAIN_FIX)
    with Store(":memory:") as store:
        store.ingest_file("m8_smoke", TRAINING, TRAIN_FIX)
        n2 = store.rebuild_run("m8_smoke", TRAINING, TRAIN_FIX)
        assert n2 == len(originals)
        # rebuild clears first, so records are not doubled
        assert store.training_raw("m8_smoke") == originals
