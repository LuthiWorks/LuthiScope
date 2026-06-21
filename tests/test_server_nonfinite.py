"""F1 regression (4.7 review 2026-06-21): non-finite floats must not break the API.

EMIT_BATCH_1 legitimately emits NaN (no-signal grad_norm, empty-aliveness means,
non-finite steps). The REST path used allow_nan=False (→ 500) and the WebSocket
emitted literal NaN (→ browser JSON.parse rejects → silent dead channel). Both are
fixed by scrubbing non-finite floats to null at the API boundary.
"""

import math
from pathlib import Path

import pytest

from luthiscope.server.app import _scrub_nonfinite
from luthiscope.store.db import TRAINING, Store


def test_scrub_nonfinite_unit():
    assert _scrub_nonfinite(float("nan")) is None
    assert _scrub_nonfinite(float("inf")) is None
    assert _scrub_nonfinite(float("-inf")) is None
    assert _scrub_nonfinite(1.5) == 1.5
    assert _scrub_nonfinite({"a": float("nan"), "b": 2}) == {"a": None, "b": 2}
    assert _scrub_nonfinite([1.0, float("nan"), {"x": float("-inf")}]) == [1.0, None, {"x": None}]
    assert _scrub_nonfinite("s") == "s"
    assert _scrub_nonfinite(True) is True   # bool preserved (not a float)
    assert _scrub_nonfinite(None) is None


def test_stored_nan_is_scrubbed(tmp_path):
    # The store faithfully preserves NaN from the JSONL (that's the bug source);
    # the scrubber at the boundary turns it into null.
    p = tmp_path / "training_log.jsonl"
    p.write_text('{"step": 1, "loss": 1.0, "grad_norm": NaN, "substrate": {"pred_frob": NaN}}\n',
                 encoding="utf-8")
    with Store(":memory:") as st:
        st.ingest_file("r/training", TRAINING, p)
        recs = st.training_raw("r/training")
    assert math.isnan(recs[0]["grad_norm"])          # stored as NaN
    scrubbed = _scrub_nonfinite(recs)
    assert scrubbed[0]["grad_norm"] is None
    assert scrubbed[0]["substrate"]["pred_frob"] is None
    assert scrubbed[0]["loss"] == 1.0


def test_records_endpoint_survives_nan(tmp_path):
    """End-to-end: a NaN record must yield 200 + parseable JSON with null."""
    pytest.importorskip("httpx")  # fastapi TestClient needs httpx
    from fastapi.testclient import TestClient

    from luthiscope.config import Settings
    from luthiscope.server.app import create_app

    run = tmp_path / "runs" / "r1"
    run.mkdir(parents=True)
    (run / "training_log.jsonl").write_text(
        '{"step": 1, "loss": 1.0, "grad_norm": NaN}\n', encoding="utf-8")
    settings = Settings(runs_dir=tmp_path / "runs", home=tmp_path / "home",
                        host="127.0.0.1", port=8800)
    client = TestClient(create_app(settings))
    resp = client.get("/api/streams/r1/training/records")
    assert resp.status_code == 200          # was 500 before the fix
    rec = resp.json()["records"][0]          # .json() proves it parsed (no literal NaN)
    assert rec["grad_norm"] is None
    assert rec["loss"] == 1.0
