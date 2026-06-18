"""SQLite derived store (contract §0 rule 4).

The JSONL files on disk are canonical; this database is a rebuildable index. Every
record is stored with its full original JSON (``raw_json``) so a query can return
the exact object that was logged, plus a few extracted columns for fast filtering
and plotting. Losslessness is guaranteed by ``raw_json`` regardless of which
fields the indexed columns happen to cover.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable, Optional, Union

from luthiscope.ingest.tailer import JsonlFollower

TRAINING = "training"
COGNITION = "cognition"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    source_path TEXT
);
CREATE TABLE IF NOT EXISTS training_records (
    run_id          TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    step            INTEGER,
    modality        TEXT,
    loss            REAL,
    l_pred          REAL,
    l_sigreg        REAL,
    elapsed_seconds REAL,
    has_light       INTEGER NOT NULL DEFAULT 0,
    has_substrate   INTEGER NOT NULL DEFAULT 0,
    has_deep        INTEGER NOT NULL DEFAULT 0,
    raw_json        TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_training_run_step ON training_records (run_id, step);
CREATE TABLE IF NOT EXISTS cognition_records (
    run_id           TEXT NOT NULL,
    seq              INTEGER NOT NULL,
    cycle            INTEGER,
    modality         TEXT,
    gamma            REAL,
    v_s              REAL,
    delta_theta_norm REAL,
    raw_json         TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_cognition_run_cycle ON cognition_records (run_id, cycle);
"""


def _num(v) -> Optional[float]:
    if isinstance(v, bool):
        return None
    return v if isinstance(v, (int, float)) else None


def _int(v) -> Optional[int]:
    if isinstance(v, bool):
        return None
    return int(v) if isinstance(v, (int, float)) else None


class Store:
    def __init__(self, path: Union[str, Path]):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL;")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- run registry --

    def register_run(self, run_id: str, kind: str, source_path=None) -> None:
        self.conn.execute(
            "INSERT INTO runs (run_id, kind, source_path) VALUES (?, ?, ?) "
            "ON CONFLICT(run_id) DO UPDATE SET "
            "kind=excluded.kind, source_path=excluded.source_path",
            (run_id, kind, str(source_path) if source_path else None),
        )
        self.conn.commit()

    def clear_run(self, run_id: str) -> None:
        self.conn.execute("DELETE FROM training_records WHERE run_id=?", (run_id,))
        self.conn.execute("DELETE FROM cognition_records WHERE run_id=?", (run_id,))
        self.conn.commit()

    def _next_seq(self, table: str, run_id: str) -> int:
        cur = self.conn.execute(
            f"SELECT COALESCE(MAX(seq) + 1, 0) FROM {table} WHERE run_id=?", (run_id,)
        )
        return int(cur.fetchone()[0])

    # -- ingest --

    def ingest_training(self, run_id: str, records: Iterable[dict], source_path=None) -> int:
        self.register_run(run_id, TRAINING, source_path)
        start = self._next_seq("training_records", run_id)
        rows = []
        for i, rec in enumerate(records):
            rows.append((
                run_id, start + i,
                _int(rec.get("step")), rec.get("modality"),
                _num(rec.get("loss")), _num(rec.get("l_pred")), _num(rec.get("l_sigreg")),
                _num(rec.get("elapsed_seconds")),
                1 if isinstance(rec.get("light"), dict) else 0,
                1 if isinstance(rec.get("substrate"), dict) else 0,
                1 if isinstance(rec.get("deep"), dict) else 0,
                json.dumps(rec),
            ))
        self.conn.executemany(
            "INSERT INTO training_records "
            "(run_id, seq, step, modality, loss, l_pred, l_sigreg, elapsed_seconds, "
            "has_light, has_substrate, has_deep, raw_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def ingest_cognition(self, run_id: str, records: Iterable[dict], source_path=None) -> int:
        self.register_run(run_id, COGNITION, source_path)
        start = self._next_seq("cognition_records", run_id)
        rows = []
        for i, rec in enumerate(records):
            rows.append((
                run_id, start + i,
                _int(rec.get("cycle")), rec.get("modality"),
                _num(rec.get("gamma")), _num(rec.get("v_s")), _num(rec.get("delta_theta_norm")),
                json.dumps(rec),
            ))
        self.conn.executemany(
            "INSERT INTO cognition_records "
            "(run_id, seq, cycle, modality, gamma, v_s, delta_theta_norm, raw_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def ingest_file(self, run_id: str, kind: str, path: Union[str, Path]) -> int:
        path = Path(path)
        records = JsonlFollower(path).read_all()
        if kind == TRAINING:
            return self.ingest_training(run_id, records, source_path=path)
        if kind == COGNITION:
            return self.ingest_cognition(run_id, records, source_path=path)
        raise ValueError(f"unknown kind: {kind!r}")

    def rebuild_run(self, run_id: str, kind: str, path: Union[str, Path]) -> int:
        """Drop a run's indexed records and re-ingest from the canonical file."""
        self.clear_run(run_id)
        return self.ingest_file(run_id, kind, path)

    # -- query --

    def training_raw(self, run_id: str) -> list[dict]:
        cur = self.conn.execute(
            "SELECT raw_json FROM training_records WHERE run_id=? ORDER BY seq", (run_id,)
        )
        return [json.loads(r[0]) for r in cur.fetchall()]

    def cognition_raw(self, run_id: str) -> list[dict]:
        cur = self.conn.execute(
            "SELECT raw_json FROM cognition_records WHERE run_id=? ORDER BY seq", (run_id,)
        )
        return [json.loads(r[0]) for r in cur.fetchall()]

    def list_runs(self) -> list[dict]:
        cur = self.conn.execute("SELECT run_id, kind, source_path FROM runs ORDER BY run_id")
        return [dict(r) for r in cur.fetchall()]
