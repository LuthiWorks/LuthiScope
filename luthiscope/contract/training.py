"""Training-vitals record models (contract §1, training_log.jsonl)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class LightMetrics(_Lenient):
    online_std_p5: Optional[float] = None
    online_std_p50: Optional[float] = None
    online_std_p95: Optional[float] = None
    # JSON keys contain dots; expose Python-safe names via alias.
    online_std_below_pt1: Optional[int] = Field(default=None, alias="online_std_below_0.1")
    online_std_below_pt5: Optional[int] = Field(default=None, alias="online_std_below_0.5")
    mean_abs_off_diag_correlation: Optional[float] = None
    sigreg: Optional[float] = None
    predictor_trivial_cosine_mean: Optional[float] = None
    predictor_trivial_cosine_std: Optional[float] = None
    predictor_output_std_p50: Optional[float] = None


class SubstrateMetrics(_Lenient):
    pred_frob: Optional[float] = None
    err_acc: Optional[float] = None


class DeepMetrics(_Lenient):
    effective_rank: Optional[float] = None
    stable_rank: Optional[float] = None
    sv_index_at_90pct: Optional[int] = None
    sv_index_at_99pct: Optional[int] = None
    log_sv_max: Optional[float] = None
    log_sv_min: Optional[float] = None
    log_sv_range: Optional[float] = None


class TrainingRecord(_Lenient):
    step: Optional[int] = None
    modality: Optional[str] = None
    loss: Optional[float] = None
    l_pred: Optional[float] = None
    l_sigreg: Optional[float] = None
    tokens_consumed: Optional[dict[str, int]] = None
    elapsed_seconds: Optional[float] = None
    light: Optional[LightMetrics] = None
    substrate: Optional[SubstrateMetrics] = None
    deep: Optional[DeepMetrics] = None
