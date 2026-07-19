"""Runtime configuration, sourced from the environment.

All paths are configurable; nothing machine-specific is baked into source
(LuthiWorks path-hygiene). See ``.env.example`` for the keys.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    runs_dir: Path  # read-only root of producer run directories (folder scan)
    home: Path      # LuthiScope's own derived store / exports
    host: str
    port: int
    registry: Path  # fixed handshake file the trainer writes its active run dirs to

    @property
    def db_path(self) -> Path:
        return self.home / "luthiscope.sqlite"


def _config_json_path(home: Path) -> Path:
    return home / "config.json"


def load_runs_dir_override(home: Path) -> Path | None:
    """The user's in-app folder choice (Settings -> Data Source), persisted
    at <home>/config.json. It OUTRANKS the environment: an explicit choice
    made inside the running app should survive restarts without anyone
    editing .env (2026-07-19, the desktop-app rework)."""
    import json

    p = _config_json_path(home)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        rd = data.get("runs_dir")
        return Path(rd).expanduser() if rd else None
    except (OSError, ValueError):
        return None


def save_runs_dir_override(home: Path, runs_dir: Path) -> None:
    """Persist the in-app folder choice (merge-write; touches only our key)."""
    import json

    p = _config_json_path(home)
    data: dict = {}
    try:
        loaded = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
    except (OSError, ValueError):
        pass
    data["runs_dir"] = str(runs_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build Settings from a mapping (defaults to ``os.environ``).

    runs_dir precedence: in-app saved choice (<home>/config.json) >
    LUTHISCOPE_RUNS_DIR > ./runs.
    """
    e = os.environ if env is None else env
    default_registry = str(Path.home() / ".luthiscope" / "runs.json")
    home = Path(e.get("LUTHISCOPE_HOME", "./.luthiscope")).expanduser()
    runs_dir = Path(e.get("LUTHISCOPE_RUNS_DIR", "./runs")).expanduser()
    override = load_runs_dir_override(home)
    if override is not None:
        runs_dir = override
    return Settings(
        runs_dir=runs_dir,
        home=home,
        host=e.get("LUTHISCOPE_HOST", "127.0.0.1"),
        port=int(e.get("LUTHISCOPE_PORT", "8800")),
        registry=Path(e.get("LUTHISCOPE_REGISTRY", default_registry)).expanduser(),
    )
