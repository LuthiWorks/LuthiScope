"""LuthiScope FastAPI application.

Read-only by construction: the server reads producer JSONL files and serves them.
It never writes to a producer's files. (Control-plane writes are Phase 2 and live
behind a separate, explicit API that does not exist yet.)

- REST  GET /api/streams                      -> discovered streams + record counts
- REST  GET /api/streams/{id}/records         -> full history (raw records, ordered)
- WS    /ws/streams/{id}                       -> live: records appended after connect
- GET   /                                      -> the frontend; /vendor, /static mounts
"""

from __future__ import annotations

import asyncio
import math
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from luthiscope.config import Settings, load_settings
from luthiscope.ingest.tailer import JsonlFollower
from luthiscope.server.discovery import discover_all, run_cadence, run_thresholds
from luthiscope.store.db import COGNITION, TRAINING, Store

if getattr(sys, "frozen", False):  # running inside a PyInstaller bundle
    FRONTEND_DIR = Path(sys._MEIPASS) / "frontend"  # type: ignore[attr-defined]
else:
    FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
LIVE_POLL_SECONDS = 0.5
LIVE_STALE_SECONDS = 30.0   # liveness floor: files younger than this are always "live"
LIVE_GAP_MULT = 2.5         # tolerate up to this many × the run's own worst recent write gap


def _file_age(path: Path) -> float | None:
    """Seconds since the source file was last written; None if unstat-able."""
    try:
        return time.time() - path.stat().st_mtime
    except OSError:
        return None


def _scrub_nonfinite(obj):
    """Replace non-finite floats (NaN/Infinity) with None, recursively.

    JSON has no NaN. Starlette's JSONResponse renders with allow_nan=False (→ 500),
    and a literal NaN sent over the WebSocket is rejected by the browser's
    JSON.parse (→ silent dead channel). EMIT_BATCH_1 legitimately emits NaN
    sentinels (no-signal grad_norm, empty-aliveness means, non-finite steps), so we
    scrub at the API boundary. The frontend's num() maps null → "no data" for that
    point, which is the correct semantic.
    """
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _scrub_nonfinite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub_nonfinite(v) for v in obj]
    return obj


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title="LuthiScope", version="0.1.0")

    # Mutable data-source root (Settings itself stays frozen): the in-app
    # folder picker (Settings -> Data Source, 2026-07-19) updates this at
    # runtime and persists the choice via config.save_runs_dir_override.
    runs_dir_state = {"path": settings.runs_dir}

    store = Store(settings.db_path, check_same_thread=False)
    lock = threading.Lock()
    ingest_mtime: dict[str, float] = {}  # stream_id -> source mtime at last ingest

    def ensure_ingested(stream) -> None:
        """Rebuild a stream's derived index from its canonical file, but only when
        the file changed since the last ingest (mtime-gated). Rebuild (not
        incremental) keeps the index trivially correct; the mtime gate avoids a full
        re-ingest on every request, and a changed mtime also covers log rotation."""
        try:
            mtime = stream.path.stat().st_mtime
        except OSError:
            mtime = None
        with lock:
            if mtime is not None and ingest_mtime.get(stream.stream_id) == mtime:
                return
            store.rebuild_run(stream.stream_id, stream.kind, stream.path)
            ingest_mtime[stream.stream_id] = mtime

    def current_streams_map():
        return {s.stream_id: s for s in discover_all(runs_dir_state["path"], settings.registry)}

    @app.get("/api/config")
    def get_config():
        return {"runs_dir": str(runs_dir_state["path"])}

    @app.post("/api/config")
    def set_config(body: dict):
        """Change the runs directory at runtime (Settings -> Data Source).
        Validates, applies immediately (discovery is per-request), and
        persists so the choice survives restarts. Read-only principle
        intact: we only ever change where we LOOK."""
        from pathlib import Path as _P

        from luthiscope.config import save_runs_dir_override

        raw = (body or {}).get("runs_dir", "")
        candidate = _P(str(raw)).expanduser()
        if not candidate.is_dir():
            raise HTTPException(status_code=400,
                                detail=f"not a directory: {candidate}")
        runs_dir_state["path"] = candidate
        try:
            save_runs_dir_override(settings.home, candidate)
            persisted = True
        except OSError:
            persisted = False
        n = len(discover_all(candidate, settings.registry))
        return {"runs_dir": str(candidate), "streams_found": n,
                "persisted": persisted}

    def live_info(s) -> dict:
        """Liveness judged against the run's OWN write rhythm.

        The old rule — "live = written within 30s" — imported a cadence
        assumption: a healthy run logging every ~60s (light_interval 100 at
        ~0.6 s/step) read as dead for the back half of every gap, so the
        indicator flickered off while training continued (Brian's report,
        2026-08-14). The window is now the larger of the floor and
        LIVE_GAP_MULT × the worst gap between the run's recent writes
        (elapsed_seconds deltas — run-time between records equals wall-time
        between appends while the producer is alive). A run is only "not
        live" once it has missed multiple of its own cadences. The window and
        age are returned so the frontend can say WHY, not just show a dot."""
        age = _file_age(s.path)
        window = LIVE_STALE_SECONDS
        if s.kind == TRAINING:
            with lock:
                es = store.recent_elapsed(s.stream_id)
            gaps = [a - b for a, b in zip(es, es[1:]) if a - b > 0]  # es is newest-first
            if gaps:
                window = max(window, LIVE_GAP_MULT * max(gaps))
        return {
            "live": age is not None and age < window,
            "last_write_age": age,
            "live_window": window,
        }

    @app.get("/api/streams")
    def list_streams():
        out = []
        for s in discover_all(runs_dir_state["path"], settings.registry):
            ensure_ingested(s)
            with lock:
                n = store.count(s.stream_id, s.kind)
            entry = {
                "id": s.stream_id,
                "run_dir": s.run_dir,
                "kind": s.kind,
                "n_records": n,
                # Recency, so the list can order and label by it. discover_all
                # already returns newest-first; the client preserves that order.
                "mtime": s.mtime or None,
            }
            entry.update(live_info(s))
            out.append(entry)
        return out

    @app.get("/api/streams/{stream_id:path}/runmeta")
    def get_runmeta(stream_id: str):
        """What the run says about itself: logging cadence, true axis range, and
        the reference lines it declares that can honestly be drawn.

        This is the fix for a record count impersonating a step count. The reader
        supplied the cadence from memory because the display never stated it, and
        the cadence had changed 10x under him. Everything here is sourced from the
        run's own files — run_config.json and the records — so a change in cadence
        is visible the moment it happens."""
        s = current_streams_map().get(stream_id)
        if s is None:
            raise HTTPException(status_code=404, detail=f"unknown stream: {stream_id}")
        ensure_ingested(s)
        with lock:
            axis = store.axis_range(s.stream_id, s.kind)
        run_dir = s.path.parent
        return {
            "id": s.stream_id,
            "cadence": run_cadence(run_dir),
            "axis": axis,
            "thresholds": run_thresholds(run_dir),
        }

    @app.get("/api/streams/{stream_id:path}/records")
    def get_records(stream_id: str):
        s = current_streams_map().get(stream_id)
        if s is None:
            raise HTTPException(status_code=404, detail=f"unknown stream: {stream_id}")
        ensure_ingested(s)
        with lock:
            recs = (
                store.training_raw(s.stream_id)
                if s.kind == TRAINING
                else store.cognition_raw(s.stream_id)
            )
        return {"id": s.stream_id, "kind": s.kind, "records": _scrub_nonfinite(recs)}

    @app.get("/api/streams/{stream_id:path}/events")
    def get_events(stream_id: str):
        """Researcher-authored event marks for a run: read-only pass-through of
        <run_dir>/events.jsonl (one {step, label, event?} object per line).
        LuthiScope never writes this file; producers or researchers do. Missing
        file = no events, never an error."""
        s = current_streams_map().get(stream_id)
        if s is None:
            raise HTTPException(status_code=404, detail=f"unknown stream: {stream_id}")
        path = s.path.parent / "events.jsonl"
        events = []
        try:
            import json as _json
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    e = _json.loads(line)
                except ValueError:
                    continue
                if isinstance(e, dict) and isinstance(e.get("step"), (int, float)):
                    events.append({
                        "step": e["step"],
                        "label": str(e.get("label", e.get("event", "event"))),
                        "kind": str(e.get("event", "event")),
                    })
        except OSError:
            pass
        events.sort(key=lambda e: e["step"])
        return {"id": s.stream_id, "events": events}

    @app.get("/api/streams/{stream_id:path}/ledger")
    def get_ledger(stream_id: str):
        """Harvested trust-ledger snapshots for a run (dimension-level precision
        buffers extracted from rolling checkpoints by the external harvester).
        Looks for a sibling ledger_harvest_* directory containing per-snapshot
        JSON files {step, ledgers: {name: [floats]}}. Read-only."""
        s = current_streams_map().get(stream_id)
        if s is None:
            raise HTTPException(status_code=404, detail=f"unknown stream: {stream_id}")
        run_dir = s.path.parent
        base = run_dir.parent
        legacy = {"living_v5_4x_d4_512d_seed43": "ledger_harvest_seed43",
                  "living_v5_4x_d4_512d_seed44": "ledger_harvest_seed44"}
        candidates = [base / legacy.get(run_dir.name, ""),
                      base / f"ledger_harvest_{run_dir.name}"]
        harvest = next((c for c in candidates if c.name and c.is_dir()), None)
        if harvest is None:
            return {"id": s.stream_id, "steps": [], "blocks": {}}
        import json as _json
        snaps = []
        for p in sorted(harvest.glob("ledger_step_*.json")):
            try:
                d = _json.loads(p.read_text(encoding="utf-8"))
                if isinstance(d.get("step"), (int, float)) and isinstance(d.get("ledgers"), dict):
                    snaps.append(d)
            except (OSError, ValueError):
                continue
        snaps.sort(key=lambda d: d["step"])
        steps = [int(d["step"]) for d in snaps]
        blocks: dict[str, list] = {}
        for d in snaps:
            for k, v in d["ledgers"].items():
                blocks.setdefault(k, []).append(v)
        return {"id": s.stream_id, "steps": steps,
                "blocks": _scrub_nonfinite(blocks)}

    @app.websocket("/ws/streams/{stream_id:path}")
    async def live(websocket: WebSocket, stream_id: str):
        await websocket.accept()
        s = current_streams_map().get(stream_id)
        if s is None:
            await websocket.close(code=1008)
            return
        follower = JsonlFollower(s.path)
        follower.seek_to_end()  # stream only what's appended after the client connects
        try:
            while True:
                new = follower.read_new()
                if new:
                    await websocket.send_json({"records": _scrub_nonfinite(new)})
                await asyncio.sleep(LIVE_POLL_SECONDS)
        except WebSocketDisconnect:
            return
        except Exception:
            await websocket.close(code=1011)

    # -- frontend --
    if (FRONTEND_DIR / "vendor").is_dir():
        app.mount("/vendor", StaticFiles(directory=FRONTEND_DIR / "vendor"), name="vendor")
    if (FRONTEND_DIR / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/app.js")
    def app_js():
        return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")

    @app.get("/styles.css")
    def styles():
        return FileResponse(FRONTEND_DIR / "styles.css", media_type="text/css")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")

    app.state.settings = settings
    return app
