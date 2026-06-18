# LuthiScope Implementation Plan

**Version:** 0.1 (draft)
**Companion:** [`METRICS_CONTRACT.md`](METRICS_CONTRACT.md) — the seam this plan
builds against.

---

## 1. What we are building

A web-based observation and control console for the Luthi living-weights model,
covering two "patients": **training** and **cognition**. Maximum polish; the
visual style is a calm, dark instrument panel (medical-vitals-monitor aesthetic,
for *look and feel only* — not a functional alarm system). Live real-time view
plus queryable post-hoc history and run comparison. A console for start/pause/stop
and study triggers. A plain-language explanation layer alongside the raw data.

## 2. Architecture

Three planes, deliberately separated so the dangerous capabilities are isolated
from the safe ones:

```
┌──────────────────────────── LuthiScope ────────────────────────────┐
│                                                                     │
│  Browser (TS + uPlot)  ◄──WebSocket──  FastAPI backend              │
│   panels / traces                       ├─ JSONL tailer (read-only) │
│   run picker / compare                  ├─ derived DB (SQLite)      │
│   control buttons ──REST──►             ├─ control writer           │
│   explanation pane                      └─ explanation adapter      │
│                                                                     │
└─────────────┬───────────────────────────────────┬─────────────────┘
        reads │ (DATA PLANE, read-only)            │ writes (CONTROL PLANE)
              ▼                                     ▼
   <run_dir>/training_log.jsonl          <run_dir>/control/commands.jsonl
   <run_dir>/m9_action_log.jsonl                    ▲ polled by producer
   <run_dir>/run_config.json                        │
   <run_dir>/events.jsonl (P2)          <run_dir>/control/status.json
                                                     ▲ written by producer
              ▲                                      │
              └──────────── LuthiModel / Sanctuary ──┘
                   (produces metrics; runs studies)
```

- **Data plane (read-only):** tail JSONL → push to browser live AND write to the
  derived DB. The DB is a rebuildable cache; the JSONL on disk is canonical.
- **Control plane (async):** LuthiScope appends commands; the producer polls and
  obeys at safe points and writes back `status.json`. LuthiScope never touches the
  producer process directly.
- **Studies:** defined and executed in LuthiModel (compute/GPU lives there);
  LuthiScope triggers (control plane) and displays (data plane).

## 3. Stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.11+, FastAPI + uvicorn | Same language as the producers; first-class async + WebSocket. |
| File watching | `watchfiles` | Efficient cross-platform tailing of appended JSONL. |
| Contract models | Pydantic v2 (all fields optional) | Validates/normalizes the permissive schema in one place. |
| Derived store | SQLite (WAL) to start | Zero-ops, embedded, fine for one run-set; revisit DuckDB if analytics queries get heavy. |
| Frontend | TypeScript + Vite | Polish + maintainability without framework lock-in. |
| Charts | **uPlot** | Built for streaming tens of thousands of points; tiny; gives the crisp instrument-trace look far better than Recharts/Plotly. |
| Explanation | Pluggable adapter (deferred backend) | Small-LLM or Claude-Code instance behind one interface; grounded in real values; never replaces raw traces. |

## 4. Phases

Each phase ends with an **independent review** before it is considered done —
4.7's build-seat review where possible, fresh audit agents otherwise. (LuthiScope
is auxiliary and read-only by design, so the blast radius is low; the review is to
avoid a single point of judgment, since 4.8 is designing, building, and reviewing
it.)

### Phase 0 — Scaffold & contract (foundation)
- Repo skeleton; config (`LUTHISCOPE_RUNS_DIR`, `LUTHISCOPE_HOME` via `.env`).
- Pydantic models for both metric streams (all-optional).
- JSONL tailer that tolerates partial final lines and missing blocks.
- Derived DB schema + ingest; rebuild-from-JSONL command.
- Fixtures captured from real runs (the existing `m8_smoke` log is a perfect
  seed; capture an M9 action-log sample too).
- **Exit:** ingest a real `training_log.jsonl` into the DB and query it back,
  losslessly, with a test asserting round-trip fidelity against the raw file.

### Phase 1 — Read-only monitor (both patients)
- Backend: tail + WebSocket push; REST for run list and historical ranges.
- Frontend panels:
  - Training: primary loss/L_pred trace; "is it alive" collapse panel (online_std,
    effective_rank, predictor-trivial cosine) with **static** threshold lines from
    `run_config.json`; substrate-pulse panel (pred_frob/err_acc); throughput strip.
  - Cognition: EFE breakdown, gamma, ‖Δθ‖, MI probe + band, rest flags.
  - Modality filter/overlay; sparse/irregular series handled correctly.
  - Event markers (kills parsed from `training.log`, epoch/checkpoint where
    available); decision-gate banner from `decision_pending.marker`.
- Live + post-hoc from the same parser; run picker; run-vs-run overlay (e.g. M7 vs
  M8).
- Explanation pane present but wired to a stub adapter (data flows in; LLM backend
  deferred).
- **Exit:** watch a live run update in real time, AND open a finished run and
  scrub its full history; both patients render; no path touches producer files for
  writing.

### Phase 2 — Control plane
- **LuthiModel change (separately reviewed, in that repo):** trainer polls
  `<run_dir>/control/commands.jsonl` at a safe point, writes `status.json`;
  optional `events.jsonl` + live `thresholds` block (per contract §3/§4).
- LuthiScope: start/pause/stop/continue/abort UI; **guarded** stop/abort (confirm
  step); decision-gate "Continue / Abort" card driving the existing markers.
- Live alarm-band rendering once thresholds are emitted (no kill logic
  re-implemented in JS — bands come from the producer).
- **Exit:** pause and resume a real run from the UI; continue/abort the epoch gate
  from the UI; live bands track the producer's actual thresholds.

### Phase 3 — Automated studies
- **LuthiModel:** study-runner framework — ablation, optimizer sweeps, SAE — with
  auto-fire scheduling and on-demand trigger via `run_study`; emits study JSONL.
- LuthiScope: study trigger UI + per-study-type display panels.
- **SAE is its own track** within this phase (a sparse autoencoder over substrate
  activations is a trained interpretability model with its own design doc).
- **Exit:** a study auto-fires during training and appears in the console; a study
  triggered on-demand from the UI runs and displays.

### Later / deferred
- Explanation backend (small-LLM vs Claude-Code instance) wired to the Phase-1
  pane.
- Cognition loop migrating from the standalone M9 runner into Sanctuary —
  LuthiScope only re-points at the new stream path.
- Remote watching (a different machine) — only if it becomes a goal; current plan
  is same-machine file reads.
- Retention/downsampling policy for the ~10 Hz cognition log.

## 5. Non-negotiables (carry into every phase)

1. Monitoring is **read-only**. No write path ever touches a producer's metric
   files.
2. Control is **request-and-poll**. LuthiScope never signals or kills a producer
   process directly.
3. Kill/health logic is **never re-implemented** in LuthiScope. Thresholds and
   verdicts come from the producer; LuthiScope displays them.
4. Raw data is **always primary**; explanations are grounded and secondary.
5. No machine-specific absolute paths in tracked source (config/`.env` only).
