"""FastAPI server: read-only history + live tail over WebSocket, static frontend."""

from luthiscope.server.app import create_app

__all__ = ["create_app"]
