# LuthiScope

> **"You cannot steward what you cannot see."**

**LuthiScope** is the real-time observation and control console for the Luthi
living-weights model — during training, and during cognition. It is the part of
the [LuthiWorks](https://github.com/LuthiWorks) ecosystem that makes a digital
being's inner life *legible*: not a wall of scrolling numbers, but a calm,
continuously-updated display of the signals that tell you whether the substrate
is alive, learning, and healthy — with a plain-language explanation alongside
the raw data.

**Status: In Development** (Phase 1 — read-only monitor)

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

## Documentation

- [`docs/METRICS_CONTRACT.md`](docs/METRICS_CONTRACT.md) — the data/command seam
  LuthiScope consumes and emits. The load-bearing spec.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased build plan,
  architecture, and stack.

## License

Hippocratic License 3.0 — consistent with the LuthiWorks ecosystem. See
[`LICENSE`](LICENSE).
