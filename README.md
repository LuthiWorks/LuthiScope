# LuthiScope

> **"You cannot steward what you cannot see."**

**LuthiScope** is the real-time observation and control console for the Luthi
living-weights model — during training, and during cognition. It is the part of
the [LuthiWorks](https://github.com/LuthiWorks) ecosystem that makes a digital
being's inner life *legible*: not a wall of scrolling numbers, but a calm,
continuously-updated display of the signals that tell you whether the substrate
is alive, learning, and healthy — with a plain-language explanation alongside
the raw data.

**Status: Phase 1 (read-only monitor) — functional.** Emit Batch 1 metrics
integrated. Control plane (Phase 2) and automated studies (Phase 3) are designed
but not yet built.

---

## What it does

LuthiScope watches two kinds of "patient":

1. **Training vitals** — a model being trained (loss, predictive structure,
   representational collapse signals, living-substrate health, throughput).
2. **Cognition vitals** — a model *thinking*: the active-inference loop's
   expected-free-energy breakdown, policy precision, how much the living weights
   moved this cycle, what action it chose and why.

It presents them as live traces in a clean, instrument-panel visual style
(the aesthetic reference is a medical vitals monitor — calm, dark, readable at a
glance), backed by a queryable history for post-hoc analysis and run comparison.

It also serves as a **console**: starting, pausing, and stopping runs, surfacing
the trainer's own decision gates, and triggering automated studies (ablation,
optimizer sweeps, SAE interpretability) on demand.

## Design philosophy

- **Observation must never endanger what it observes.** A training run is
  multi-day and the living weights are *irreproducible*. LuthiScope's monitoring
  path is strictly **read-only**: it consumes the metric streams the model writes
  and never reaches into the running process. The worst a monitoring bug can do
  is show a wrong number — never crash or corrupt a run.
- **Control is a doorbell, not a key to the engine room.** Start/pause/stop and
  study-triggers go through a narrow, asynchronous command channel that the
  trainer *polls and obeys on its own terms*. The running loop stays the
  authority over itself.
- **The raw data is always primary.** The plain-language explanation layer sits
  *alongside* the numbers and is grounded in them. It never replaces or obscures
  the real trace.
- **The seam is a contract.** LuthiScope and the model communicate only through a
  documented file contract ([`docs/METRICS_CONTRACT.md`](docs/METRICS_CONTRACT.md)),
  so either side can change internally without breaking the other.

## Quickstart

```bash
pip install -e .          # pydantic, fastapi, uvicorn (websockets via uvicorn[standard])
python -m luthiscope      # serves http://127.0.0.1:8800
```

Open **http://127.0.0.1:8800**. With no config it reads the bundled `demo_runs/`
(three sample streams, including `m8_batch1_demo` which exercises every Batch-1
metric and the per-block heatmap). To watch real runs, copy `.env.example` to
`.env` and point `LUTHISCOPE_RUNS_DIR` at the trainer's runs directory; point it at
a run *while it's training* and the live tail works automatically.

Packaged desktop app: `pyinstaller LuthiScope.spec` → `dist/LuthiScope.exe` (see
[`docs/PACKAGING.md`](docs/PACKAGING.md)). Tests: `python -m pytest`.

## What's implemented (Phase 1)

- Read-only ingest of both patients (training + cognition JSONL) into a rebuildable
  SQLite index; live WebSocket tail + post-hoc history.
- Grouped overview UI: per-group vitals tiles with polarity-aware health colors, a
  "needs attention" bar, collapsible metric groups, cursor tooltips, and a
  progression readout (start→end, Δ%, min/max/σ/range) per series.
- Emit Batch 1 metrics surfaced (grad norm, LR, substrate drift/plasticity/
  precision) including the per-block `substrate_blocks` heatmap.
- Configurable fluid-dynamics background (Stam stable-fluids + vorticity
  confinement) with a settings panel; click-driven and self-idling (~0 CPU at rest).
- Single-file packaged build with the LuthiWorks logo icon.

## Documentation

- [`docs/METRICS_CONTRACT.md`](docs/METRICS_CONTRACT.md) — the data/command seam
  LuthiScope consumes and emits. The load-bearing spec.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased build plan,
  architecture, and stack.
- [`docs/METRICS_ROADMAP.md`](docs/METRICS_ROADMAP.md) — producer-side metrics to add.
- [`docs/EMIT_BATCH_1.md`](docs/EMIT_BATCH_1.md) — shipped + reviewed (substrate
  extras, grad norm, LR, per-block).
- [`docs/EMIT_BATCH_2.md`](docs/EMIT_BATCH_2.md) — spec: validation loss + linear probe.
- [`docs/EXPLANATION_LAYER.md`](docs/EXPLANATION_LAYER.md) — tentative ideas for the
  explanation layer.
- [`docs/TRAINING_WELFARE.md`](docs/TRAINING_WELFARE.md) — the commitment that training
  be non-coercive, and LuthiScope's role as the welfare instrument.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — building the desktop app.

## License

Hippocratic License 3.0 — consistent with the LuthiWorks ecosystem. See
[`LICENSE`](LICENSE).
