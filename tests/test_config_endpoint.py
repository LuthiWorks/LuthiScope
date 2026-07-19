"""Runtime runs-dir configuration (Settings -> Data Source, 2026-07-19)."""

import json

from fastapi.testclient import TestClient

from luthiscope.config import Settings, load_settings
from luthiscope.server.app import create_app


def _settings(tmp_path, runs_dir):
    return Settings(
        runs_dir=runs_dir,
        home=tmp_path / "home",
        host="127.0.0.1",
        port=0,
        registry=tmp_path / "no-registry.json",
    )


def _mk_run(root, name):
    d = root / name
    d.mkdir(parents=True)
    (d / "training_log.jsonl").write_text(
        json.dumps({"step": 1, "loss": 1.0}) + "\n", encoding="utf-8",
    )
    return d


def test_get_config_reports_current_dir(tmp_path):
    runs = tmp_path / "runs_a"
    runs.mkdir()
    client = TestClient(create_app(_settings(tmp_path, runs)))
    assert client.get("/api/config").json()["runs_dir"] == str(runs)


def test_post_config_switches_discovery_immediately(tmp_path):
    runs_a = tmp_path / "runs_a"
    runs_a.mkdir()
    runs_b = tmp_path / "runs_b"
    _mk_run(runs_b, "some_run")

    client = TestClient(create_app(_settings(tmp_path, runs_a)))
    assert client.get("/api/streams").json() == []  # empty dir -> no streams

    resp = client.post("/api/config", json={"runs_dir": str(runs_b)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["runs_dir"] == str(runs_b)
    assert body["streams_found"] == 1
    ids = [s["id"] for s in client.get("/api/streams").json()]
    assert any("some_run" in i for i in ids)


def test_post_config_rejects_nondirectory(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    client = TestClient(create_app(_settings(tmp_path, runs)))
    resp = client.post("/api/config", json={"runs_dir": str(tmp_path / "nope")})
    assert resp.status_code == 400
    # And the working dir is unchanged.
    assert client.get("/api/config").json()["runs_dir"] == str(runs)


def test_choice_persists_and_outranks_env(tmp_path):
    runs_a = tmp_path / "runs_a"
    runs_a.mkdir()
    runs_b = tmp_path / "runs_b"
    runs_b.mkdir()
    home = tmp_path / "home"

    settings = Settings(runs_dir=runs_a, home=home, host="127.0.0.1",
                        port=0, registry=tmp_path / "r.json")
    client = TestClient(create_app(settings))
    assert client.post("/api/config",
                       json={"runs_dir": str(runs_b)}).status_code == 200

    # A fresh load with the env pointing at runs_a must yield runs_b:
    # the in-app choice outranks the environment.
    fresh = load_settings({
        "LUTHISCOPE_RUNS_DIR": str(runs_a),
        "LUTHISCOPE_HOME": str(home),
    })
    assert fresh.runs_dir == runs_b
