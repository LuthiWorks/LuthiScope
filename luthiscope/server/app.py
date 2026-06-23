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
from luthiscope.server.discovery import discover_all
from luthiscope.store.db import COGNITION, TRAINING, Store

if getattr(sys, "frozen", False):  # running inside a PyInstaller bundle
    FRONTEND_DIR = Path(sys._MEIPASS) / "frontend"  # type: ignore[attr-defined]
else:
    FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
LIVE_POLL_SECONDS = 0.5
LIVE_STALE_SECONDS = 30.0  # a stream whose file changed more recently than this is "live"


def _is_live(path: Path) -> bool:
    """True if the source file was written within LIVE_STALE_SECONDS.

    A cheap, read-only liveness signal: an actively-training run appends to its
    log continuously, so a recent mtime means the producer is alive. We never
    touch the producer process — only stat its file."""
    try:
        return (time.time() - path.stat().st_mtime) < LIVE_STALE_SECONDS
    except OSError:
        return False


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
        return {s.stream_id: s for s in discover_all(settings.runs_dir, settings.registry)}

    @app.get("/api/streams")
    def list_streams():
        out = []
        for s in discover_all(settings.runs_dir, settings.registry):
            ensure_ingested(s)
            with lock:
                n = store.count(s.stream_id, s.kind)
            out.append(
                {
                    "id": s.stream_id,
                    "run_dir": s.run_dir,
                    "kind": s.kind,
                    "n_records": n,
                    "live": _is_live(s.path),
                }
            )
        return out

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
