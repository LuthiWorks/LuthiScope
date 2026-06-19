"""Desktop launcher used by the packaged app (LuthiScope.exe).

Starts the server in a background thread, then opens the UI. If pywebview is
installed it opens a native window (logo icon, "LuthiScope" title); otherwise it
opens the default browser. Either way the server is local and read-only.
"""

from __future__ import annotations

import sys
import threading
import time
import webbrowser
from pathlib import Path


def _icon_path() -> str | None:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    for cand in (
        base / "packaging" / "luthiscope.ico",
        Path(__file__).resolve().parents[1] / "packaging" / "luthiscope.ico",
    ):
        if cand.is_file():
            return str(cand)
    return None


def _serve(settings) -> None:
    import uvicorn

    from luthiscope.server.app import create_app

    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="warning",
    )


def _wait_until_up(url: str, tries: int = 60) -> None:
    import urllib.request

    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return
        except Exception:
            time.sleep(0.25)


def run_app() -> None:
    import os

    from luthiscope.config import load_settings

    settings = load_settings()
    url = f"http://{settings.host}:{settings.port}"

    # Headless mode: serve only, no window/browser (service use; also used to
    # verify the packaged bundle).
    if os.environ.get("LUTHISCOPE_SERVE_ONLY") == "1":
        print(f"LuthiScope serving (headless) at {url}")
        _serve(settings)
        return

    threading.Thread(target=_serve, args=(settings,), daemon=True).start()
    _wait_until_up(url)

    # Prefer a native window if pywebview is available; otherwise the browser.
    try:
        import webview  # type: ignore

        webview.create_window("LuthiScope", url, width=1400, height=900)
        try:
            webview.start(icon=_icon_path())
        except TypeError:
            webview.start()  # older pywebview without the icon kwarg
        return
    except Exception:
        webbrowser.open(url)
        print(f"LuthiScope running at {url} — close this window to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    run_app()
