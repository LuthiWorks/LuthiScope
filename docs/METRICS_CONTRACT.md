# LuthiScope Metrics & Control Contract

**Version:** 0.1.2 (draft)
**Status:** Authoritative for Phase 1 (read paths). Control + event paths are
*proposed* and require a matching change in the producer (LuthiModel) before they
exist.
**Changelog:** 0.1.2 (2026-06-20) — §1 Emit Batch 1 (shipped in LuthiModel,
reviewed): added top-level `grad_norm` / `lr` / `nonfinite`; `substrate{}` extras
`set_point_drift` / `update_ema_mean` / `precision_mean`; new deep-cadence
`substrate_blocks` per-block array. 0.1.1 (2026-06-17) — §2 corrected after
independent code verification: documented the *actual* `_m9_head_step` record vs.
the aspirational `CANONICAL_FIELDS`; §1 cadence note clarified for co-fire lines.
0.1 — initial.

This document defines the **seam** between LuthiScope and the systems it
observes and controls. LuthiScope is a read-only consumer of metric streams plus
a writer of narrow control commands. It never imports producer code and never
mutates a producer's metric files. Everything below is the file-level interface;
either side may change internally as long as this contract holds.

The producers today:
- **LuthiModel** training runner (`luthi/v2/jepa_runner.py`) — training vitals.
- **LuthiModel** M9 cognition runner (`luthi/v2/m9/runner.py`) — cognition vitals.
- **Sanctuary** (future) — will host the same cognition loop and emit the same
  cognition stream once the M9 loop migrates behind `sanctuary_interface.py`.
  LuthiScope does not distinguish the host; it reads the stream wherever it lands.

---

## 0. General rules for all streams

1. **Format: JSON Lines (`.jsonl`).** One complete JSON object per line,
   append-only. A consumer tails the file; a partially-written final line is
   normal and must be tolerated (skip and retry on the next read).
2. **All nested blocks and fields are OPTIONAL.** Producers emit different blocks
   on different cadences (see below) and may add fields over time. A consumer
   MUST treat every field as possibly-absent and never assume a fixed schema per
   line. Missing block ≠ error.
3. **Records are NOT uniformly spaced.** Training records are per-modality and
   fire on each modality's *own* step cadence; rare modalities (e.g. audio at
   ~1% of steps) are sparse and irregular. Never assume a constant step delta or
   even monotonic wall-clock between consecutive lines of different modalities.
4. **The files on disk are the source of truth.** LuthiScope's database is a
   derived index, rebuildable by re-reading the JSONL. Nothing LuthiScope does
   may modify these files.
5. **Numbers may be non-finite.** `NaN`/`Infinity` can appear (e.g. a metric with
   too few samples). Consumers must parse and render them gracefully.

---

## 1. Training vitals — `training_log.jsonl`

Written by `JEPATrainer._compute_and_log_diagnostics`. One line per *diagnostic
firing*, NOT per training step — a line is written only when a light-cadence or
deep-cadence diagnostic fires for the step's modality. Cadences are set in
`run_config.json` under `logging` (`light_interval_batches`, `deep_interval_batches`),
counted in *per-modality* steps.

### Always present (top level)

| Field | Type | Meaning |
|---|---|---|
| `step` | int | Global training step at this firing. |
| `modality` | str | `"text"` \| `"audio"` \| `"vision"` — which modality this record describes. |
| `loss` | float | Total loss for this step. |
| `l_pred` | float | Predictive loss component. |
| `l_sigreg` | float | SIGReg (anti-collapse regularizer) loss component. |
| `tokens_consumed` | object | `{text:int, audio:int, vision:int}` cumulative tokens per modality. |
| `elapsed_seconds` | float | Wall-clock since run start (monotonic; adjusted on resume so it does not roll backward). |
| `grad_norm` | float | Global L2 norm of gradients over the optimizer's (backprop-trained) params, at this logging step. Computed only on logging steps; distinct from substrate plasticity. NaN sentinel if a firing somehow precedes a `will_log` step. |
| `lr` | float | Effective learning rate (`optimizer.param_groups[0]["lr"]`). |
| `nonfinite` | bool | True if the loss or any gradient was non-finite at this step (fail-loud flag; logged-only for now, no kill yet). |

### `light` block — present on light-cadence firings

Cheap per-step collapse diagnostics. Rising `sigreg`, falling `online_std`, and
rising `predictor_trivial_cosine_mean` are the primary collapse signals.

| Field | Type | Meaning |
|---|---|---|
| `online_std_p5` / `_p50` / `_p95` | float | Per-dimension std of the online encoder's context output, 5th/50th/95th percentile. The headline "is it alive" signal. |
| `online_std_below_0.1` | int | Count of dims with std < 0.1 (hard-collapse counter). |
| `online_std_below_0.5` | int | Count of dims with std < 0.5 (soft-collapse counter). |
| `mean_abs_off_diag_correlation` | float | Mean absolute off-diagonal correlation of latents (dimensional-collapse signal; rises toward 1 on collapse). |
| `sigreg` | float | SIGReg statistic — distance from the isotropic-Gaussian target; rises as the encoder drifts off-distribution. |
| `predictor_trivial_cosine_mean` / `_std` | float | Cosine between predicted and target blocks. Approaching 1.0 = predictor collapsed to copy/identity. |
| `predictor_output_std_p50` | float | Median per-dim std of predictor output (independent collapse signal). |

### `substrate` block — present on light-cadence firings

The living-substrate "pulse," aggregated from `model.aliveness_report()`.

| Field | Type | Meaning |
|---|---|---|
| `pred_frob` | float | Mean prediction norm across PC blocks. Healthy trajectory **rises** (substrate building predictive structure). |
| `err_acc` | float | Mean accumulated prediction error across blocks. Healthy trajectory **falls** (substrate learning to predict its input). |
| `set_point_drift` | float | Mean weight drift from the homeostatic set point across blocks. Climbs as the substrate learns; drops under consolidation. |
| `update_ema_mean` | float | Mean magnitude of recent PC self-modify updates — the plasticity "is changing" signal (distinct from `grad_norm`). |
| `precision_mean` | float | Mean PC-layer precision (confidence weighting on its own predictions); climbs as predictions sharpen. |

### `deep` block — present only on deep-cadence firings (much rarer)

Representation-spectrum diagnostics from an SVD of the latent covariance.

| Field | Type | Meaning |
|---|---|---|
| `effective_rank` | float | exp(spectral entropy). Healthy trajectory rises as more dimensions are used; a sustained drop = dimensional collapse. |
| `stable_rank` | float | ‖C‖_F² / ‖C‖_2². |
| `sv_index_at_90pct` / `_at_99pct` | int | Number of singular values to reach 90% / 99% of variance. |
| `log_sv_max` / `_min` / `_range` | float | Log-spectrum head/tail summary. |

### `substrate_blocks` — present only on deep-cadence firings

Top-level array, one object **per PC block** (so a single drifting block surfaces
even when the cross-block `substrate{}` mean looks healthy — intended for a
blocks×time heatmap). Each entry: `set_point_drift`, `update_ema_mean`,
`precision_mean`, `prediction_norm`, `error_acc_mean` (floats; a value may be
`null` if that block's `aliveness()` omitted the key). Emitted at deep cadence only
to bound payload size.

> **Consumer note:** A typical line has top-level + `light` + `substrate`. `deep`
> appears on the deep cadence only. On a step that is a multiple of *both* cadence
> intervals, a single line carries top-level + `light` + `substrate` + `deep`
> together — `deep`-bearing lines are not separate from `light`-bearing ones.
> Render each panel from whichever lines carry its block; do not interpolate across
> absent blocks.

### Companion files (same run directory)

| File | Content |
|---|---|
| `run_config.json` | All hyperparameters as nested objects (`sampler`, `checkpoint`, `logging`, `kill_criteria`, `epoch`, `loss`), plus `sampler_probabilities`. **This is where the static thresholds live** (see §3). |
| `training.log` | Human one-line-per-firing log. Also where kill events are currently announced (`KILL CRITERION TRIGGERED: ...`). |
| `checkpoints/ckpt_*.pt` | Rolling checkpoints (binary; not consumed by LuthiScope). |

---

## 2. Cognition vitals — `m9_action_log.jsonl`

Written by `ActionLog` (`luthi/v2/m9/instrumentation.py`), line-buffered, JSONL.
Currently written by `M9Trainer._m9_head_step` (`luthi/v2/m9/runner.py`), one
record per training step — so the rate is governed by training throughput, **not a
wall clock**. (The "~10 Hz cognitive cycle" is the *future* cadence once this loop
runs live inside Sanctuary; do not assume 10 Hz today.) Filename is configurable
(`action_log_filename`, default `m9_action_log.jsonl`), written into the run dir.
The schema is **permissive** (the writer passes through whatever keys the caller
provides), so treat every field as possibly-absent per §0.

> **Important — verified against `runner.py:764-798` (2026-06-17 contract review).**
> `ActionLog` defines a `CANONICAL_FIELDS` *aspirational* list, but the **record the
> runner actually writes today differs from it** and is the schema below. Do NOT
> build panels against `CANONICAL_FIELDS` — several of its fields are never written
> (see "Not currently written"), and two are renamed in the real record.

### Actual record fields (as written by `_m9_head_step`)

| Field | Type | Meaning |
|---|---|---|
| `cycle` | int | Global step counter (`self.global_step`). |
| `modality` | str | Modality for this step. |
| `sim_counter` | int | MCTS simulation counter. |
| `theta_version` | int | Living-weights version (staleness tracker). |
| `delta_theta_norm` | float | ‖Δθ‖ — how much the living weights moved this cycle. The cognition-side "pulse." |
| `s_t_summary` | object | `{mean, norm}` of the state vector. *(shape verified)* |
| `best_action_summary` | object \| null | `{norm, dist_to_a_rest}` of the chosen action, or null. *(shape verified)* |
| `gamma` | float | Policy precision. |
| `v_s` | float | V(state) value estimate. |
| `r_best` | float | Score of the best action. |
| `tree_stats` | object | MCTS tree stats (`self.mcts.tree_stats()`). Sub-shape not yet verified. |
| `mi_probe` | object | `{mi_latest, mi_median, mi_band_lower, mi_band_upper, mi_n_samples}`. *(shape verified)* |
| `rest_selected` | bool | Rest action chosen over alternatives. |
| `rest_defaulted` | bool | Planner found nothing better than rest. |
| `external_silent_frac` | float | Fraction of the external channel silent. |
| `internal_silent_frac` | float | Fraction of the internal channel silent. |
| `k_m9_5_armed` | bool | Whether kill K-M9-5 is armed (`activity_bands.k_m9_5_armed()`). |
| `staleness` | object | `self.staleness.snapshot()`. Sub-shape not yet verified. |
| `activity_bands` | object | `self.activity_bands.snapshot()`. Sub-shape not yet verified. |
| `delta_s_band` | object | `self.delta_s_band.snapshot()`. Sub-shape not yet verified. |
| `kill_states` | object | `{kill_name → state}` current kill-criterion states. Sub-shape not yet verified. |

> **"Sub-shape not yet verified"** fields come from `*.snapshot()` / `tree_stats()`
> methods that were not read field-by-field in the 2026-06-17 review. The *top-level
> record above is verified*; verify each nested shape against its producing method
> before building a cognition panel that reads its internals.

### Not currently written (in `CANONICAL_FIELDS` but absent from live records)

`candidate_actions_top_k`, `chosen_action_summary` (real analogue: `best_action_summary`),
`efe_breakdown`, `sigreg_value`, `staleness_snapshot` (real analogue: `staleness`),
`preference_weight_snapshot`, `mask_summary`. A consumer keyed off any of these finds
nothing today. Also: where an EFE breakdown *is* produced (the `select_action` return
path), its keys are `{total, engagement_cost, coherence_cost, connection_cost,
truthfulness_cost}` — not the `{c_eng, c_coh, c_con, c_truth, total}` the class
comment suggests — and it is not written to this log.

---

## 3. Health thresholds & lifecycle events

This section documents **current reality** and a **proposed enhancement**, because
it is the one place the existing files fall short of what a live console wants.

### Current reality

- **Thresholds are not in the metric stream.** The trainer's kill criteria use
  *pilot-set baselines* and *running-best anchors* derived at runtime; these live
  only in trainer memory and inside checkpoints — they are **not** written to
  `training_log.jsonl`. The static fallback thresholds (e.g.
  `std_collapse_threshold`, `correlation_collapse_threshold`,
  `cosine_collapse_threshold`, `*_pct`) **are** available, in
  `run_config.json → kill_criteria`.
- **Kill events are not in the metric stream.** A fired kill is announced via the
  logger to `training.log` (`KILL CRITERION TRIGGERED: <reason>`), reflected in
  the run's return value (`"killed:<reason>"`), and recorded as the `reason` field
  inside the final checkpoint. There is no machine-clean kill-event JSONL.
- **Decision gate uses marker files.** At the end of epoch 1 the trainer writes
  `decision_pending.marker` and waits for `abort.marker` or `continue.marker` in
  the run directory.

### What Phase 1 can do with current reality

- Draw **static threshold lines** from `run_config.json → kill_criteria`.
- Detect **kill events** by tailing `training.log` for `KILL CRITERION TRIGGERED`.
- Detect the **decision gate** by watching for `decision_pending.marker`.

### Proposed producer enhancement (Phase 2, implemented in LuthiModel)

A small, separately-reviewed change to the trainer to emit machine-readable
state, so LuthiScope can draw *live* alarm bands and an event timeline without
re-implementing kill logic (which it must never do):

1. **`events.jsonl`** in the run dir — one record per lifecycle event:
   ```json
   {"event": "kill", "reason": "kill-1 (complete collapse) on text: ...", "step": 8830, "elapsed_seconds": 12345.6}
   ```
   Event types: `epoch_start`, `epoch_end`, `checkpoint`, `decision_pending`,
   `kill`, `study_fired`, `study_complete`, `aborted`, `completed`.
2. **Live thresholds in `training_log.jsonl`** — optional `thresholds` block on
   each record carrying the *current* per-modality pilot baseline / running-best
   anchor for each judged metric, so the band shown is the band actually in
   effect. (Cheap: the trainer already holds these in memory.)

Until (1)/(2) ship, the live-band UI uses static config values and the log-parsed
kill detection above.

---

## 4. Control channel (proposed — Phase 2)

LuthiScope's control plane. **Does not exist until the producer learns to poll
it.** Design goal: the running loop remains the authority; LuthiScope leaves
requests, the producer consumes them at a safe point between steps.

### Layout (per run directory)

```
<run_dir>/control/
  commands.jsonl   # append-only queue, written by LuthiScope
  status.json      # current state, written by the producer
```

### Command record (LuthiScope → producer)

```json
{"id": "uuid", "action": "pause", "params": {}, "issued_at": 1718700000.0}
```

`action` ∈ `pause` | `resume` | `stop` | `continue` | `abort` | `run_study`.
`run_study` carries `params` (study type + config). `continue`/`abort` map onto
the existing `continue.marker` / `abort.marker` mechanism so the decision gate
keeps working unchanged.

### Status record (producer → LuthiScope)

```json
{"last_cmd_id": "uuid", "state": "running", "since_step": 8830, "updated_at": 1718700001.0}
```

`state` ∈ `running` | `paused` | `stopping` | `stopped` | `decision_pending` |
`killed` | `completed` | `aborted`.

The producer processes commands in order, idempotently (re-seeing a handled `id`
is a no-op), and acknowledges via `status.json`. LuthiScope confirms destructive
actions (`stop`/`abort`) in the UI before writing the command.

---

## 5. Study streams (proposed — Phase 3)

Automated studies (ablation, optimizer sweeps, SAE interpretability) run **inside
LuthiModel** (they need the model, data, and GPU), triggered on a schedule or via
a `run_study` control command. Each study writes its own JSONL under the run dir,
e.g. `studies/ablation_<id>.jsonl`, `studies/sae_<id>.jsonl`. Schemas are defined
per study type when those are designed; they obey §0's general rules. SAE is its
own track (a sparse autoencoder is itself a trained interpretability model, not a
single metric).

---

## 6. Storage layout

Paths are **configurable**, not hardcoded. LuthiScope reads from a configured runs
directory and keeps its own derived store in a configured home directory:

| Config key | Purpose |
|---|---|
| `LUTHISCOPE_RUNS_DIR` | Root under which run directories (each with the files above) live. Read-only to LuthiScope. |
| `LUTHISCOPE_HOME` | LuthiScope's own derived DB, exports, and triggered-study outputs. |

**Local deployment (current dev machine):** `LUTHISCOPE_RUNS_DIR` → the external
data drive's `runs/` folder; `LUTHISCOPE_HOME` → a dedicated `LuthiScope/` folder
on the same drive. Concrete absolute paths are kept in the local (uncommitted)
`.env`, never in tracked source — consistent with LuthiWorks path-hygiene.

---

## 7. Versioning

This contract is versioned at the top of the file. Additive changes (new optional
fields/blocks) do not bump the major version. Any change that removes or renames a
field, or changes a cadence semantics, bumps the major and is called out in the
producer's changelog. LuthiScope pins the contract version it was built against
and degrades gracefully (renders what it recognizes) on unknown fields.
