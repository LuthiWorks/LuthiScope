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
    runs_dir: Path  # read-only root of producer run directories
    home: Path      # LuthiScope's own derived store / exports
    host: str
    port: int

    @property
    def db_path(self) -> Path:
        return self.home / "luthiscope.sqlite"


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build Settings from a mapping (defaults to ``os.environ``)."""
    e = os.environ if env is None else env
    return Settings(
        runs_dir=Path(e.get("LUTHISCOPE_RUNS_DIR", "./runs")).expanduser(),
        home=Path(e.get("LUTHISCOPE_HOME", "./.luthiscope")).expanduser(),
        host=e.get("LUTHISCOPE_HOST", "127.0.0.1"),
        port=int(e.get("LUTHISCOPE_PORT", "8800")),
    )
