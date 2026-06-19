"""Launch the LuthiScope server:  python -m luthiscope

Reads configuration from the environment / .env (see .env.example). Loads .env
from the current directory if present, then starts uvicorn.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal .env loader (no dependency). KEY=VALUE lines; # comments; existing
    environment values win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> None:
    import sys

    _load_dotenv()

    # `--app` launches the desktop experience (native window if pywebview is
    # installed, else the browser). Plain invocation runs the server only.
    if "--app" in sys.argv:
        from luthiscope.desktop import run_app

        run_app()
        return

    import uvicorn

    from luthiscope.config import load_settings
    from luthiscope.server.app import create_app

    settings = load_settings()
    app = create_app(settings)
    print(f"LuthiScope: reading runs from {settings.runs_dir}")
    print(f"LuthiScope: open http://{settings.host}:{settings.port}")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
