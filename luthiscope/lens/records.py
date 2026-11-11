"""Workspace-lens record format and aggregation. Pure Python, no torch.

One line of ``workspace_lens.jsonl`` is one *moment* the lens read::

    {
      "moment": 12,                 # the stand-in's cycle number (or a sequence no.)
      "read_at": 1762880000.0,      # unix seconds, when the twin read it
      "source": "moments" | "prompt",
      "n_tokens": 1834,             # tokens the twin was fed
      "truncated": 0,               # tokens dropped from the START to fit max_tokens
      "read_tokens": ["...", ...],  # the tokens at the positions that were read
      "tail": "...",                # the last few hundred characters of the moment
      "concepts": [                 # what's on its mind, strongest first
        {"concept": "creeper", "score": 0.081, "peak_layer": 18, "alt": null}
      ],
      "layers": {"8": [["creeper", 0.21], ...], ...},  # top words per layer,
                                                        # at the last read position
      "about_to_say": [["I", 0.4], ...]                 # the model's own next-token
    }

``score`` is a word's probability under the lens, restricted to word-like
tokens, averaged over the read layers and positions. It is a relative strength
for comparing concepts within one moment, not a calibrated probability. All
fields are optional to a consumer (contract §0 rule 2).

``session.json`` beside the JSONL says which model, which lens and which
device produced the readings, so the window can state it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable, Optional

from luthiscope.ingest.parser import parse_line

_SPACE = re.compile(r"\s+")


def concept_key(token: str) -> str:
    """Variants of one word share a key: ' Rome', 'Rome', 'rome' -> 'rome'."""
    return _SPACE.sub(" ", token).strip().lower()


def display_form(token: str) -> str:
    return _SPACE.sub(" ", token).strip()


def merge_concepts(
    candidates: Iterable[tuple[str, float, int, Optional[str]]],
    top_n: int,
) -> list[dict]:
    """Fold token variants of the same word into one concept.

    ``candidates`` are ``(token_text, score, peak_layer, alt)``. Scores of
    variants are summed (they are disjoint vocabulary entries carrying the same
    word); the display form, peak layer and gloss come from the strongest
    variant. Returns the ``top_n`` strongest, strongest first.
    """
    merged: dict[str, dict] = {}
    for token, score, peak, alt in candidates:
        key = concept_key(token)
        if not key:
            continue
        cur = merged.get(key)
        if cur is None:
            merged[key] = {
                "concept": display_form(token), "score": float(score),
                "peak_layer": int(peak), "alt": alt, "_best": float(score),
            }
        else:
            cur["score"] += float(score)
            if score > cur["_best"]:
                cur.update(concept=display_form(token), peak_layer=int(peak),
                           alt=alt, _best=float(score))
    out = sorted(merged.values(), key=lambda c: -c["score"])[:top_n]
    for c in out:
        c.pop("_best", None)
        c["score"] = round(c["score"], 6)
    return out


def tail_text(text: str, n_chars: int = 280) -> str:
    t = text.strip()
    return t if len(t) <= n_chars else "…" + t[-n_chars:]


def last_moment(path: Path) -> Optional[int]:
    """The highest moment number already read into ``path`` (for resuming)."""
    best: Optional[int] = None
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                rec = parse_line(line)
                if rec and isinstance(rec.get("moment"), int):
                    m = rec["moment"]
                    best = m if best is None else max(best, m)
    except OSError:
        return None
    return best


def read_session_meta(session_dir: Path) -> dict:
    from luthiscope.lens import SESSION_META

    try:
        d = json.loads((session_dir / SESSION_META).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def moment_messages(rec: dict) -> Optional[list[dict]]:
    """The chat messages of one stand-in moment, from a moments-log line.

    Accepts ``{"messages": [{"role", "content"}, ...]}`` (the request exactly as
    sent) or ``{"system": ..., "user": ...}``. Returns None for a line that
    carries neither, so the reader skips it rather than guessing.
    """
    msgs = rec.get("messages")
    if isinstance(msgs, list) and msgs:
        clean = [
            {"role": str(m.get("role")), "content": m.get("content")}
            for m in msgs
            if isinstance(m, dict) and isinstance(m.get("content"), str)
        ]
        return clean or None
    out = []
    if isinstance(rec.get("system"), str):
        out.append({"role": "system", "content": rec["system"]})
    if isinstance(rec.get("user"), str):
        out.append({"role": "user", "content": rec["user"]})
    return out if any(m["role"] == "user" for m in out) else None


def moment_number(rec: dict, fallback: int) -> int:
    for k in ("cycle", "moment", "step"):
        v = rec.get(k)
        if isinstance(v, int) and not isinstance(v, bool):
            return v
    return fallback
