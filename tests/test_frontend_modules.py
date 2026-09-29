"""ES module split (2026-09-29).

The frontend entry is now ``/js/main.js`` loaded as a module script; the old
monolithic ``/app.js`` bundle route is gone.
"""

from fastapi.testclient import TestClient

from luthiscope.config import Settings
from luthiscope.server.app import create_app


def _client(tmp_path):
    settings = Settings(
        runs_dir=tmp_path / "runs",
        home=tmp_path / "home",
        host="127.0.0.1",
        port=0,
        registry=tmp_path / "no-registry.json",
    )
    return TestClient(create_app(settings))


def test_index_boots_from_module_entry(tmp_path):
    r = _client(tmp_path).get("/")
    assert r.status_code == 200
    assert 'type="module"' in r.text
    assert 'src="/js/main.js"' in r.text
    assert "/app.js" not in r.text


def test_js_modules_served(tmp_path):
    c = _client(tmp_path)
    r = c.get("/js/main.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert "./state.js" in r.text  # main.js imports the shared state module
    for mod in ["utils", "state", "panels-config", "descriptions", "refs",
                "events", "charts", "readout", "panels", "streams",
                "settings", "ledger", "uncharted"]:
        r = c.get(f"/js/{mod}.js")
        assert r.status_code == 200, mod
        assert "javascript" in r.headers["content-type"]


def test_old_monolith_bundle_gone(tmp_path):
    assert _client(tmp_path).get("/app.js").status_code == 404
