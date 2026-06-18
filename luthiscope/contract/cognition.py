"""Cognition-vitals record models (contract §2, m9_action_log.jsonl).

Mirrors the *actual* record written by ``M9Trainer._m9_head_step``
(runner.py:764-798), verified 2026-06-17 — NOT the aspirational
``ActionLog.CANONICAL_FIELDS``. Nested objects produced by ``*.snapshot()`` /
``tree_stats()`` are kept as open dicts because their internal shapes were not
field-verified; do not over-specify them here until they are.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="allow")


class StateSummary(_Lenient):
    mean: Optional[float] = None
    norm: Optional[float] = None


class BestActionSummary(_Lenient):
    norm: Optional[float] = None
    dist_to_a_rest: Optional[float] = None


class MIProbe(_Lenient):
    mi_latest: Optional[float] = None
    mi_median: Optional[float] = None
    mi_band_lower: Optional[float] = None
    mi_band_upper: Optional[float] = None
    mi_n_samples: Optional[int] = None


class CognitionRecord(_Lenient):
    cycle: Optional[int] = None
    modality: Optional[str] = None
    sim_counter: Optional[int] = None
    theta_version: Optional[int] = None
    delta_theta_norm: Optional[float] = None
    s_t_summary: Optional[StateSummary] = None
    best_action_summary: Optional[BestActionSummary] = None
    gamma: Optional[float] = None
    v_s: Optional[float] = None
    r_best: Optional[float] = None
    tree_stats: Optional[dict[str, Any]] = None  # sub-shape not yet verified
    mi_probe: Optional[MIProbe] = None
    rest_selected: Optional[bool] = None
    rest_defaulted: Optional[bool] = None
    external_silent_frac: Optional[float] = None
    internal_silent_frac: Optional[float] = None
    k_m9_5_armed: Optional[bool] = None
    staleness: Optional[dict[str, Any]] = None       # sub-shape not yet verified
    activity_bands: Optional[dict[str, Any]] = None  # sub-shape not yet verified
    delta_s_band: Optional[dict[str, Any]] = None    # sub-shape not yet verified
    kill_states: Optional[dict[str, Any]] = None     # sub-shape not yet verified
