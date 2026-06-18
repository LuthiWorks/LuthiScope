"""LuthiScope — observation & control console for the Luthi living-weights model.

Phase 0 (this layer): read-only ingest of the producer's JSONL metric streams into
a rebuildable derived store. The JSONL on disk is canonical; this package never
writes to a producer's files. See docs/METRICS_CONTRACT.md.
"""

__version__ = "0.1.0"
