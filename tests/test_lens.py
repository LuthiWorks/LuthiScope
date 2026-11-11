"""Workspace lens (2026-11-11): record format, the server's read-only lens
endpoints, and -- when torch/jlens are installed -- the reader itself on a tiny
random model, including the promise that reading never alters the model."""

import json

import pytest
from fastapi.testclient import TestClient

from luthiscope.config import Settings
from luthiscope.lens import LENS_FILENAME, SESSION_META
from luthiscope.lens.records import (
    last_moment,
    merge_concepts,
    moment_messages,
    moment_number,
    tail_text,
)
from luthiscope.server.app import create_app

# ---- records ------------------------------------------------------------------


def test_merge_concepts_folds_variants_of_one_word():
    out = merge_concepts(
        [(" creeper", 0.3, 14, None), ("Creeper", 0.1, 18, None),
         (" sword", 0.2, 12, None), ("  ", 0.9, 10, None)],
        top_n=5,
    )
    assert [c["concept"] for c in out] == ["creeper", "sword"]
    assert out[0]["score"] == pytest.approx(0.4)
    assert out[0]["peak_layer"] == 14          # from the strongest variant


def test_merge_concepts_respects_top_n():
    cands = [(f"w{i}", 1.0 / (i + 1), 10, None) for i in range(30)]
    assert len(merge_concepts(cands, top_n=7)) == 7


def test_moment_messages_accepts_both_shapes_and_rejects_neither():
    assert moment_messages({"messages": [{"role": "system", "content": "a"},
                                         {"role": "user", "content": "b"}]})[1]["content"] == "b"
    assert moment_messages({"system": "s", "user": "u"}) == [
        {"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    assert moment_messages({"system": "only a system message"}) is None
    assert moment_messages({"cycle": 3}) is None


def test_moment_number_prefers_cycle_and_ignores_bools():
    assert moment_number({"cycle": 7, "step": 2}, 99) == 7
    assert moment_number({"moment": True}, 5) == 5


def test_tail_text_keeps_the_end():
    assert tail_text("x" * 500 + "END", 10).endswith("END")


def test_last_moment_for_resume(tmp_path):
    p = tmp_path / LENS_FILENAME
    assert last_moment(p) is None
    p.write_text('{"moment": 3}\n{"moment": 9}\n{"moment": 5}\n{"partial', encoding="utf-8")
    assert last_moment(p) == 9


# ---- server -------------------------------------------------------------------


def _settings(tmp_path, runs_dir):
    return Settings(runs_dir=runs_dir, home=tmp_path / "home", host="127.0.0.1",
                    port=0, registry=tmp_path / "no-registry.json")


def _record(m, words):
    return {"moment": m, "read_at": 1.0, "source": "prompt", "n_tokens": 10,
            "concepts": [{"concept": w, "score": 0.1, "peak_layer": 12, "alt": None}
                         for w in words],
            "layers": {"12": [[words[0], 0.2]]}, "about_to_say": [["I", 0.5]]}


def _session(root, name, records, meta=None):
    d = root / name
    d.mkdir(parents=True)
    (d / LENS_FILENAME).write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    if meta is not None:
        (d / SESSION_META).write_text(json.dumps(meta), encoding="utf-8")
    return d


def test_lens_overview_lists_sessions_and_reports_reader(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    s = _settings(tmp_path, runs)
    _session(s.lens_root, "prompt_1", [_record(1, ["rome"]), _record(2, ["paris"])],
             meta={"model": "Qwen/Qwen3.5-4B"})
    body = TestClient(create_app(s)).get("/api/lens").json()
    assert body["lens_dir"] == str(tmp_path / "home" / "lens")
    assert isinstance(body["reader_installed"], bool)
    [entry] = body["sessions"]
    assert entry["id"] == "prompt_1"
    assert entry["n_moments"] == 2
    assert entry["meta"]["model"] == "Qwen/Qwen3.5-4B"


def test_lens_records_and_unknown_session(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    s = _settings(tmp_path, runs)
    _session(s.lens_root, "sess", [_record(1, ["creeper"])])
    client = TestClient(create_app(s))
    body = client.get("/api/lens/sessions/sess/records").json()
    assert body["records"][0]["concepts"][0]["concept"] == "creeper"
    assert client.get("/api/lens/sessions/nope/records").status_code == 404
    # ids are looked up, never turned into paths
    assert client.get("/api/lens/sessions/../home/records").status_code == 404


def test_lens_session_inside_a_run_dir_is_found(tmp_path):
    runs = tmp_path / "runs"
    s = _settings(tmp_path, runs)
    _session(runs, "standin_run", [_record(4, ["tree"])])
    client = TestClient(create_app(s))
    ids = [e["id"] for e in client.get("/api/lens").json()["sessions"]]
    assert ids == ["run:standin_run"]
    assert client.get("/api/lens/sessions/run:standin_run/records").json()["records"][0]["moment"] == 4


def test_lens_endpoints_never_write(tmp_path):
    runs = tmp_path / "runs"
    s = _settings(tmp_path, runs)
    d = _session(runs, "standin_run", [_record(1, ["tree"])])
    before = {p.name: p.read_bytes() for p in d.iterdir()}
    client = TestClient(create_app(s))
    client.get("/api/lens")
    client.get("/api/lens/sessions/run:standin_run/records")
    assert {p.name: p.read_bytes() for p in d.iterdir()} == before


def test_lens_window_page_is_served(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    client = TestClient(create_app(_settings(tmp_path, runs)))
    r = client.get("/lens")
    assert r.status_code == 200 and "lens.js" in r.text
    assert client.get("/lens.js").status_code == 200


def test_lens_dir_env_override(tmp_path):
    from luthiscope.config import load_settings

    s = load_settings({"LUTHISCOPE_HOME": str(tmp_path / "h"),
                       "LUTHISCOPE_LENS_DIR": str(tmp_path / "elsewhere")})
    assert s.lens_root == tmp_path / "elsewhere"
    assert load_settings({"LUTHISCOPE_HOME": str(tmp_path / "h")}).lens_root == tmp_path / "h" / "lens"


# ---- reader on a tiny random model (only where the reader's packages exist) ----

torch = pytest.importorskip("torch")
transformers = pytest.importorskip("transformers")
jlens = pytest.importorskip("jlens")

WORDS = ["rome", "paris", "creeper", "sword", "tree", "night", "home", "I", "the",
         "boot", "currency", "is", "a", "hissed", "behind", "me", "so"]


def _tiny_model_and_tokenizer():
    from tokenizers import Tokenizer, models, pre_tokenizers

    vocab = {"<unk>": 0, "<|im_start|>": 1, "<|im_end|>": 2, ",": 3, ".": 4}
    for w in WORDS:
        vocab.setdefault(w, len(vocab))
    tk = Tokenizer(models.WordLevel(vocab=vocab, unk_token="<unk>"))
    tk.pre_tokenizer = pre_tokenizers.Whitespace()
    tok = transformers.PreTrainedTokenizerFast(
        tokenizer_object=tk, unk_token="<unk>", eos_token="<|im_end|>")
    tok.chat_template = (
        "{% for m in messages %}<|im_start|> {{ m.role }} {{ m.content }} <|im_end|> "
        "{% endfor %}{% if add_generation_prompt %}<|im_start|> assistant {% endif %}")
    cfg = transformers.Qwen2Config(
        vocab_size=len(vocab), hidden_size=32, intermediate_size=64,
        num_hidden_layers=8, num_attention_heads=4, num_key_value_heads=2,
        max_position_embeddings=128, tie_word_embeddings=False)
    torch.manual_seed(0)
    model = transformers.Qwen2ForCausalLM(cfg).eval()
    return model, tok


def _identity_lens(d_model, n_layers):
    return jlens.JacobianLens(
        {l: torch.eye(d_model) for l in range(n_layers - 1)}, n_prompts=1, d_model=d_model)


def _reader(model, tok, **cfg_kw):
    from luthiscope.lens.reader import ReaderConfig, WorkspaceReader

    cfg = ReaderConfig(model="tiny/test", lens_file="unused.pt", device="cpu",
                       dtype="float32", last_positions=4, top_concepts=5, **cfg_kw)
    return WorkspaceReader(cfg, hf_model=model, tokenizer=tok,
                           lens=_identity_lens(32, 8), log=lambda *_: None)


def test_reader_produces_a_well_formed_record():
    model, tok = _tiny_model_and_tokenizer()
    reader = _reader(model, tok)
    assert reader.layers == [2, 4, 6]          # every 2nd fitted layer from n/4, below the last
    rec = reader.read("the creeper hissed behind me , so I")
    assert rec["n_tokens"] == 8 and rec["truncated"] == 0
    assert len(rec["read_tokens"]) == 4
    assert 1 <= len(rec["concepts"]) <= 5
    for c in rec["concepts"]:
        assert c["concept"].strip() and c["concept"] not in (",", ".", "<unk>")
        assert c["peak_layer"] in reader.layers
    assert set(rec["layers"]) == {"2", "4", "6"}
    assert len(rec["about_to_say"]) == 5
    json.dumps(rec, allow_nan=False)           # writable as strict JSON


def test_reading_never_alters_the_model():
    model, tok = _tiny_model_and_tokenizer()
    before = {k: v.clone() for k, v in model.state_dict().items()}
    ids = tok("the boot currency is", return_tensors="pt").input_ids
    with torch.no_grad():
        logits_before = model(ids).logits.clone()
    reader = _reader(model, tok)
    reader.read("the boot currency is")
    reader.read(reader.render([{"role": "user", "content": "the creeper is behind me"}]))
    after = model.state_dict()
    assert all(torch.equal(before[k], after[k]) for k in before)
    assert not any(p.requires_grad for p in model.parameters())
    assert all(not layer._forward_hooks for layer in model.model.layers)   # hooks removed
    with torch.no_grad():
        assert torch.equal(model(ids).logits, logits_before)


def test_long_moment_keeps_its_end():
    model, tok = _tiny_model_and_tokenizer()
    reader = _reader(model, tok, max_tokens=5)
    rec = reader.read("rome paris creeper sword tree night home I")
    assert rec["truncated"] == 3
    assert rec["read_tokens"][-1].strip() == "I"


def test_cli_prompt_mode_writes_a_session(tmp_path, monkeypatch):
    """End to end through `python -m luthiscope.lens --prompt`, with the model
    loading swapped for the tiny one (Hugging Face isn't reachable in tests)."""
    from luthiscope.lens import __main__ as cli
    from luthiscope.lens import reader as reader_mod

    model, tok = _tiny_model_and_tokenizer()
    real_init = reader_mod.WorkspaceReader.__init__

    def fake_init(self, cfg, **kw):
        cfg.dtype = "float32"
        real_init(self, cfg, hf_model=model, tokenizer=tok,
                  lens=_identity_lens(32, 8), log=lambda *_: None)

    monkeypatch.setattr(reader_mod.WorkspaceReader, "__init__", fake_init)
    monkeypatch.setenv("LUTHISCOPE_HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)
    assert cli.main(["--prompt", "the creeper hissed", "--session", "t1"]) == 0
    sess = tmp_path / "home" / "lens" / "t1"
    meta = json.loads((sess / SESSION_META).read_text(encoding="utf-8"))
    assert meta["model"] == "Qwen/Qwen3.5-4B" and meta["twin"] is True
    assert meta["lens"]["revision"] == "qwen-n1000"
    recs = [json.loads(l) for l in (sess / LENS_FILENAME).read_text(encoding="utf-8").splitlines()]
    assert recs[0]["moment"] == 1 and recs[0]["source"] == "prompt"


def test_cli_follows_a_moments_log_read_only(tmp_path, monkeypatch):
    from luthiscope.lens import __main__ as cli
    from luthiscope.lens import reader as reader_mod

    model, tok = _tiny_model_and_tokenizer()
    real_init = reader_mod.WorkspaceReader.__init__

    def fake_init(self, cfg, **kw):
        cfg.dtype = "float32"
        real_init(self, cfg, hf_model=model, tokenizer=tok,
                  lens=_identity_lens(32, 8), log=lambda *_: None)

    monkeypatch.setattr(reader_mod.WorkspaceReader, "__init__", fake_init)
    monkeypatch.setenv("LUTHISCOPE_HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)
    run = tmp_path / "sanctuary_run"
    run.mkdir()
    log = run / "stand_in_moments.jsonl"
    lines = [{"cycle": c, "system": "you live in sanctuary",
              "user": "a creeper is behind me"} for c in (1, 2, 3, 4)]
    log.write_text("".join(json.dumps(l) + "\n" for l in lines), encoding="utf-8")
    original = log.read_bytes()

    assert cli.main(["--moments", str(log), "--once", "--every", "2"]) == 0
    out = tmp_path / "home" / "lens" / "sanctuary_run" / LENS_FILENAME
    assert [json.loads(l)["moment"] for l in out.read_text().splitlines()] == [2, 4]
    assert log.read_bytes() == original              # the producer's file is untouched
    # Rerun resumes after the last moment read instead of reading it again.
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"cycle": 6, "user": "night falls"}) + "\n")
    assert cli.main(["--moments", str(log), "--once", "--every", "2"]) == 0
    assert [json.loads(l)["moment"] for l in out.read_text().splitlines()] == [2, 4, 6]
