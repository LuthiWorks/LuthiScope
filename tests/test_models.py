"""Typed-model tests. Skipped if pydantic isn't installed (the core ingest/store
round-trip in test_roundtrip.py is stdlib-only and is the real Phase-0 gate)."""

from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from luthiscope.contract.cognition import CognitionRecord
from luthiscope.contract.training import TrainingRecord

FIX = Path(__file__).parent / "fixtures"


def _line(path: Path, idx: int) -> str:
    return [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()][idx]


def test_training_model_parses_known_fields_and_blocks():
    # 4th record (step 20) carries light + substrate + deep.
    line = _line(FIX / "training_log.sample.jsonl", 3)
    rec = TrainingRecord.model_validate_json(line)
    assert rec.step == 20
    assert rec.modality == "text"
    assert rec.light is not None
    assert rec.substrate is not None and rec.substrate.pred_frob is not None
    assert rec.deep is not None and rec.deep.effective_rank is not None
    # dotted JSON key reachable via the aliased python-safe name
    assert rec.light.online_std_below_pt1 == 0


def test_training_model_preserves_unknown_fields():
    rec = TrainingRecord.model_validate({"step": 1, "future_field": 42})
    dumped = rec.model_dump()
    assert dumped.get("future_field") == 42


def test_cognition_model_matches_actual_schema():
    line = _line(FIX / "cognition_action_log.sample.jsonl", 0)
    rec = CognitionRecord.model_validate_json(line)
    assert rec.cycle == 1
    assert rec.delta_theta_norm is not None
    assert rec.best_action_summary is not None
    assert rec.mi_probe is not None and rec.mi_probe.mi_band_lower is not None
    # null best_action_summary (3rd record) is tolerated
    line3 = _line(FIX / "cognition_action_log.sample.jsonl", 2)
    rec3 = CognitionRecord.model_validate_json(line3)
    assert rec3.best_action_summary is None
    assert rec3.rest_selected is True
