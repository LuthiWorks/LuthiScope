"""The workspace-lens READER: a frozen twin of the stand-in, read with the J-lens.

Optional component. Needs ``pip install -e ".[lens]"`` (torch, transformers,
huggingface_hub, jlens). The LuthiScope server and window never import this
module; they only read the JSONL it writes.

What it does, and what it never does:

- Loads the stand-in's weights (default ``Qwen/Qwen3.5-4B``) into its OWN
  process -- a twin. The running stand-in is served by llama-server from a
  GGUF file; the reader never contacts it.
- Freezes every parameter (``requires_grad_(False)``, ``eval()``) and runs only
  forward passes under ``torch.inference_mode()``. Forward hooks copy the
  residual stream out at the read positions; they return nothing, so they
  cannot alter a layer's output. Nothing is written to, or steers, any model.
- Writes only to LuthiScope's own home (``<home>/lens/<session>/``). A moments
  log it follows is opened read-only, exactly like every other producer file.

The readout per moment (see ``luthiscope.lens.records``): for each read layer,
``J_l @ h`` is decoded through the model's own unembedding, restricted to
word-like tokens and softmaxed; concept strength is that probability averaged
over the read layers and positions. Mid layers are where the paper finds the
workspace, so the default layer set skips the first quarter of the stack.
"""

from __future__ import annotations

import gzip
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from luthiscope.lens import LENS_FILENAME, SESSION_META
from luthiscope.lens.records import merge_concepts, tail_text

DEFAULT_MODEL = "Qwen/Qwen3.5-4B"

#: Ready-made lenses (Neuronpedia's Hub repo; Apache-2.0 for the Qwen folders).
#: model -> (repo, file inside the repo, revision). Qwen3.5-4B's entry is the
#: one jacobian-lens's own walkthrough loads. Any other model: pass --lens-file.
KNOWN_LENSES: dict[str, tuple[str, str, Optional[str]]] = {
    "Qwen/Qwen3.5-4B": (
        "neuronpedia/jacobian-lens",
        "qwen3.5-4b/jlens/Salesforce-wikitext/Qwen3.5-4B_jacobian_lens_n1000.pt",
        "qwen-n1000",
    ),
    "Qwen/Qwen3-4B": (
        "neuronpedia/jacobian-lens",
        "qwen3-4b/jlens/Salesforce-wikitext/Qwen3-4B_jacobian_lens.pt",
        None,
    ),
}

_GLOSS_PATH = Path(__file__).resolve().parent / "data" / "qwen_gloss.json.gz"


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


@dataclass
class ReaderConfig:
    """Everything that decides what the twin is and how it is read.

    Every field has a LUTHISCOPE_LENS_* environment override (see .env.example)
    so nothing machine-specific lives in source.
    """

    model: str = field(default_factory=lambda: _env("LUTHISCOPE_LENS_MODEL", DEFAULT_MODEL))
    lens_repo: Optional[str] = field(default_factory=lambda: _env("LUTHISCOPE_LENS_REPO"))
    lens_file: Optional[str] = field(default_factory=lambda: _env("LUTHISCOPE_LENS_FILE"))
    lens_revision: Optional[str] = field(default_factory=lambda: _env("LUTHISCOPE_LENS_REVISION"))
    device: str = field(default_factory=lambda: _env("LUTHISCOPE_LENS_DEVICE", "auto"))
    dtype: str = field(default_factory=lambda: _env("LUTHISCOPE_LENS_DTYPE", "bfloat16"))
    layers: Optional[list[int]] = None      # None -> every 2nd fitted layer, from n/4
    last_positions: int = 16                # read the final N token positions
    top_concepts: int = 12
    max_tokens: int = 8192                  # longer moments lose their START, never their end
    thinking: bool = False                  # Qwen chat template's enable_thinking

    def resolved_lens(self) -> tuple[str, str, Optional[str]]:
        """(repo-or-path, filename, revision), filling gaps from KNOWN_LENSES."""
        known = KNOWN_LENSES.get(self.model)
        if self.lens_file is None and known is None:
            raise SystemExit(
                f"No ready-made lens is known for {self.model!r}. Pass --lens-file "
                f"(and --lens-repo/--lens-revision if it is on the Hub). Known: "
                + ", ".join(KNOWN_LENSES)
            )
        repo = self.lens_repo or (known[0] if known else "")
        filename = self.lens_file or known[1]
        revision = self.lens_revision if self.lens_revision is not None else (
            known[2] if known and self.lens_file is None else None)
        return repo, filename, revision


def _load_gloss(model_name: str) -> dict[int, str]:
    """English gloss for Qwen3.5's CJK vocabulary entries (machine-generated,
    best-effort; from jacobian-lens/assets, Apache-2.0 -- see data/NOTICE).
    Keyed by token id, so it is only valid for the Qwen3.5/3.6 tokenizer."""
    name = model_name.lower()
    if not ("qwen3.5" in name or "qwen3.6" in name) or not _GLOSS_PATH.is_file():
        return {}
    try:
        with gzip.open(_GLOSS_PATH, "rt", encoding="utf-8") as f:
            return {int(k): v for k, v in json.load(f).items()}
    except (OSError, ValueError):
        return {}


def word_like_mask(tokenizer, vocab_size: int):
    """True for vocabulary entries that decode to a word (letters/digits,
    inner apostrophes or hyphens). The lens reads single-word concepts; this
    keeps punctuation and template tokens from crowding them out of the
    ranking. Same rule as jacobian-lens's display mask."""
    import torch

    mask = torch.zeros(vocab_size, dtype=torch.bool)
    n = min(vocab_size, len(tokenizer))
    texts = tokenizer.batch_decode([[i] for i in range(n)],
                                   clean_up_tokenization_spaces=False)
    for i, decoded in enumerate(texts):
        s = decoded.strip()
        if not s or "<|" in s or (s.startswith("<") and s.endswith(">")):
            continue
        if all(ch.isalnum() or (0 < p < len(s) - 1 and ch in "'-’")
               for p, ch in enumerate(s)):
            mask[i] = True
    return mask


class WorkspaceReader:
    """Holds the frozen twin and the lens; ``read(text)`` returns one record body."""

    def __init__(self, cfg: ReaderConfig, *, hf_model=None, tokenizer=None,
                 lens=None, log=print):
        import torch
        import jlens

        self.cfg = cfg
        self._log = log
        if hf_model is None or tokenizer is None:
            hf_model, tokenizer = self._load_model()
        if lens is None:
            repo, filename, revision = cfg.resolved_lens()
            log(f"lens: {repo} :: {filename} @ {revision or 'main'}")
            lens = jlens.JacobianLens.from_pretrained(repo, filename=filename,
                                                      revision=revision)
        self.tokenizer = tokenizer
        # from_hf puts the model in eval() and freezes every parameter.
        self.model = jlens.from_hf(hf_model, tokenizer, force_bos=False)
        assert not any(p.requires_grad for p in hf_model.parameters())
        self.lens = lens
        if lens.d_model != self.model.d_model:
            raise SystemExit(
                f"lens is for d_model={lens.d_model} but {cfg.model} has "
                f"d_model={self.model.d_model}: wrong lens for this model")

        n = self.model.n_layers
        fitted = set(lens.source_layers)
        if cfg.layers:
            bad = [l for l in cfg.layers if l not in fitted]
            if bad:
                raise SystemExit(f"layers {bad} have no fitted lens; fitted: "
                                 f"{lens.source_layers[0]}..{lens.source_layers[-1]}")
            self.layers = sorted(set(cfg.layers))
        else:
            self.layers = [l for l in range(n // 4, n - 1, 2) if l in fitted]
        self.final_layer = n - 1

        vocab = self.model._lm_head.weight.shape[0]
        log(f"building word mask over {vocab} vocabulary entries ...")
        self.word_mask = word_like_mask(tokenizer, vocab).to(self.model._lm_head.weight.device)
        self.gloss = _load_gloss(cfg.model)
        self._torch = torch

    # -- loading ----------------------------------------------------------------

    def _device(self) -> str:
        import torch

        if self.cfg.device != "auto":
            return self.cfg.device
        # ROCm builds of PyTorch report AMD GPUs through the cuda API.
        return "cuda" if torch.cuda.is_available() else "cpu"

    def _load_model(self):
        import torch
        import transformers

        device = self._device()
        dtype = getattr(torch, self.cfg.dtype)
        self._log(f"loading twin {self.cfg.model} ({self.cfg.dtype}) on {device} ...")
        hf = transformers.AutoModelForCausalLM.from_pretrained(self.cfg.model, dtype=dtype)
        hf = hf.to(device)
        tok = transformers.AutoTokenizer.from_pretrained(self.cfg.model)
        self.device_used = device
        return hf, tok

    # -- reading ----------------------------------------------------------------

    def render(self, messages: list[dict]) -> str:
        """The moment exactly as the stand-in's chat template lays it out,
        ending where the stand-in begins to answer."""
        try:
            return self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
                enable_thinking=self.cfg.thinking)
        except TypeError:
            return self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True)

    def read(self, text: str) -> dict[str, Any]:
        torch = self._torch
        with torch.inference_mode():
            return self._read(text)

    def _read(self, text: str) -> dict[str, Any]:
        torch = self._torch
        ids = self.tokenizer(text, return_tensors="pt", add_special_tokens=False).input_ids
        n_tokens = int(ids.shape[1])
        truncated = max(0, n_tokens - self.cfg.max_tokens)
        if truncated:
            ids = ids[:, truncated:]           # keep the END: that is where it is now
        ids = ids.to(self.model.input_device)
        P = min(self.cfg.last_positions, ids.shape[1])

        captured: dict[int, Any] = {}

        def make_hook(idx):
            def hook(module, inputs, output):
                h = output if torch.is_tensor(output) else output[0]
                captured[idx] = h[0, -P:, :].detach().clone()
                return None                    # observe only: the output is untouched
            return hook

        handles = [self.model.layers[i].register_forward_hook(make_hook(i))
                   for i in sorted(set(self.layers) | {self.final_layer})]
        try:
            self.model.forward(ids)
        finally:
            for h in handles:
                h.remove()

        neg = torch.finfo(torch.float32).min
        per_layer = []                          # [L, V] mean prob over read positions
        grid: dict[str, list] = {}
        for layer in self.layers:
            r = self.lens.transport(captured[layer].float(), layer)
            logits = self.model.unembed(r).float()
            logits = logits.masked_fill(~self.word_mask, neg)
            probs = torch.softmax(logits, dim=-1)          # [P, V]
            top = probs[-1].topk(5)
            grid[str(layer)] = [[self._tok(i), round(float(p), 5)]
                                for p, i in zip(top.values.tolist(), top.indices.tolist())]
            per_layer.append(probs.mean(0))
        stack = torch.stack(per_layer)                     # [L, V]
        total = stack.mean(0)
        k = min(self.cfg.top_concepts * 4, total.numel())
        cand = total.topk(k)
        peaks = stack[:, cand.indices].argmax(0).tolist()
        candidates = [
            (self._tok(i), float(s), self.layers[pk], self.gloss.get(i))
            for s, i, pk in zip(cand.values.tolist(), cand.indices.tolist(), peaks)
        ]

        final = self.model.unembed(captured[self.final_layer][-1:].float()).float()
        fp = torch.softmax(final[0], dim=-1).topk(5)

        return {
            "n_tokens": n_tokens,
            "truncated": truncated,
            "read_tokens": [self._tok(int(t)) for t in ids[0, -P:].tolist()],
            "tail": tail_text(text),
            "concepts": merge_concepts(candidates, self.cfg.top_concepts),
            "layers": grid,
            "about_to_say": [[self._tok(i), round(float(p), 5)]
                             for p, i in zip(fp.values.tolist(), fp.indices.tolist())],
        }

    def _tok(self, i: int) -> str:
        return self.tokenizer.decode([i], clean_up_tokenization_spaces=False)

    def session_meta(self, source: str) -> dict:
        repo, filename, revision = self.cfg.resolved_lens()
        return {
            "model": self.cfg.model,
            "lens": {"repo": repo, "file": filename, "revision": revision},
            "device": getattr(self, "device_used", str(self.model.input_device)),
            "dtype": self.cfg.dtype,
            "layers": self.layers,
            "n_layers": self.model.n_layers,
            "last_positions": self.cfg.last_positions,
            "source": source,
            "twin": True,
            "started_at": time.time(),
            "config": {k: v for k, v in asdict(self.cfg).items()
                       if k in ("max_tokens", "thinking", "top_concepts")},
        }


class SessionWriter:
    """Append-only writer for one lens session under LuthiScope's own home."""

    def __init__(self, session_dir: Path):
        self.dir = session_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / LENS_FILENAME

    def write_meta(self, meta: dict) -> None:
        (self.dir / SESSION_META).write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def append(self, record: dict) -> None:
        line = json.dumps(record, ensure_ascii=False, allow_nan=False)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
