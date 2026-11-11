"""Workspace lens: what is on the stand-in mind's mind.

Uses Anthropic's Jacobian lens (github.com/anthropics/jacobian-lens, Apache-2.0)
to read which single-word concepts are active in the residual stream of the
stand-in model (Qwen3.5-4B in Sanctuary, Brian's choice 2026-11-01).

Two halves, kept apart on purpose:

- ``luthiscope.lens.reader`` (optional, needs torch/transformers/jlens): the
  READER. It loads a *twin* of the stand-in -- the same weights, in its own
  process -- feeds it the stand-in's moments, and writes what the lens reads to
  ``<LuthiScope home>/lens/<session>/workspace_lens.jsonl``. It never talks to
  the running stand-in (llama-server serves a GGUF build whose internals cannot
  be reached, and reaching into a running mind would break LuthiScope's first
  rule anyway). Every pass is forward-only, under ``torch.inference_mode``,
  with every parameter frozen: nothing is written to, or steers, any model.
- ``luthiscope.lens.records`` (pure Python): the record format and the
  aggregation that turns per-layer readouts into "what's on its mind". The
  server and the window only ever read these JSONL files.

See docs/WORKSPACE_LENS.md.
"""

LENS_FILENAME = "workspace_lens.jsonl"
SESSION_META = "session.json"
