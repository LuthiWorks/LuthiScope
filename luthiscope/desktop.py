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


def _log(settings, msg: str) -> None:
    """Launcher diagnostics -> <home>/desktop.log. The windowed exe has no
    console, so this file is the only witness when something fails
    (added 2026-07-19 debugging the refused-to-connect / Edge-fallback
    report)."""
    try:
        settings.home.mkdir(parents=True, exist_ok=True)
        with open(settings.home / "desktop.log", "a", encoding="utf-8") as f:
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(stamp + " " + msg + "\n")
    except OSError:
        pass


def _serve(settings) -> None:
    try:
        import uvicorn

        from luthiscope.server.app import create_app

        _log(settings, f"server thread: starting on {settings.host}:{settings.port}")
        uvicorn.run(
            create_app(settings),
            host=settings.host,
            port=settings.port,
            log_level="warning",
            # Skip uvicorn's dictConfig entirely: its default formatter
            # probes sys.stdout.isatty(), which cannot be trusted to
            # exist in a windowed app (see run_app's substitution --
            # this is the second belt on the same trousers).
            log_config=None,
        )
        _log(settings, "server thread: uvicorn returned (unexpected)")
    except Exception as e:  # noqa: BLE001 -- the log IS the handler
        import traceback

        _log(settings, "server thread CRASHED: " + str(e) + " :: "
             + traceback.format_exc().replace("\n", " | "))


def _wait_until_up(url: str, tries: int = 120) -> bool:
    import urllib.request

    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def run_app() -> None:
    import os

    # Windowed (console=False) PyInstaller apps run with sys.stdout and
    # sys.stderr as None -- and uvicorn's log formatter calls
    # sys.stdout.isatty() at configuration time, which killed the server
    # thread on every double-click launch (the 2026-07-19
    # refused-to-connect report; full traceback in desktop.log).
    # Substitute safe sinks before anything touches them.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    from luthiscope.config import load_settings

    settings = load_settings()
    url = f"http://{settings.host}:{settings.port}"

    # Headless mode: serve only, no window/browser (service use; also used to
    # verify the packaged bundle).
    if os.environ.get("LUTHISCOPE_SERVE_ONLY") == "1":
        print(f"LuthiScope serving (headless) at {url}")
        _serve(settings)
        return

    _log(settings, f"launch: frozen={hasattr(sys, '_MEIPASS')} url={url} "
                   f"runs_dir={settings.runs_dir}")
    threading.Thread(target=_serve, args=(settings,), daemon=True).start()
    up = _wait_until_up(url)
    _log(settings, f"server up: {up}")

    # Prefer a native window if pywebview is available; otherwise the browser.
    try:
        import webview  # type: ignore

        _log(settings, "webview imported OK -- native window path")

        class _Api:
            """JS bridge: window.pywebview.api.pick_folder() -> native
            folder dialog (Settings -> Data Source, 2026-07-19)."""

            def pick_folder(self):
                try:
                    win = webview.windows[0]
                    result = win.create_file_dialog(webview.FOLDER_DIALOG)
                    if result:
                        return str(result[0])
                except Exception:
                    pass
                return None

        webview.create_window(
            "LuthiScope", url, width=1400, height=900, js_api=_Api(),
        )
        try:
            webview.start(icon=_icon_path())
        except TypeError:
            webview.start()  # older pywebview without the icon kwarg
        return
    except Exception as e:
        import traceback

        _log(settings, "webview path FAILED -> browser fallback: " + str(e)
             + " :: " + traceback.format_exc().replace("\n", " | "))
        webbrowser.open(url)
        print(f"LuthiScope running at {url} — close this window to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    run_app()
