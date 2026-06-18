"""Typed views of the metric contract (docs/METRICS_CONTRACT.md).

These models are lenient: every field is optional and unknown fields are
preserved (``extra="allow"``), because the contract (§0) requires treating every
field as possibly-absent and tolerating producer-side additions. They are for
convenient typed access to *known* fields — the canonical record is always the
raw JSON stored verbatim by the derived store.
"""

from luthiscope.contract.cognition import CognitionRecord
from luthiscope.contract.training import (
    DeepMetrics,
    LightMetrics,
    SubstrateMetrics,
    TrainingRecord,
)

__all__ = [
    "TrainingRecord",
    "LightMetrics",
    "SubstrateMetrics",
    "DeepMetrics",
    "CognitionRecord",
]
