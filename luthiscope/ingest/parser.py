"""Tolerant JSON Lines parsing (contract §0).

The producer's metric files are append-only JSONL and a consumer tails them, so a
partially-written or malformed final line is normal and MUST NOT raise.
``parse_line`` returns ``None`` for anything it can't turn into a JSON object so
the caller can skip it and retry on the next read.
"""

from __future__ import annotations

import json
from typing import Iterator, Optional


def parse_line(line: str) -> Optional[dict]:
    """Parse one line to a dict, or return None (blank/partial/malformed/non-object)."""
    s = line.strip()
    if not s:
        return None
    try:
        obj = json.loads(s)
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def parse_text(text: str) -> Iterator[dict]:
    """Yield every parseable record object from a blob of JSONL text."""
    for line in text.splitlines():
        rec = parse_line(line)
        if rec is not None:
            yield rec
