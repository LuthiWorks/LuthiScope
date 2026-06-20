# Training Metrics Roadmap (producer-side, LuthiModel)

Metrics worth adding to the training stream, found by reading the M8 trainer
(`luthi/v2/jepa_runner.py`) and PC model (`luthi/v2/living_layer_pc.py`) on
2026-06-20. **All of these are emit-side changes in LuthiModel** — LuthiScope only
displays them. The grouped UI already has auto-hiding placeholder panels keyed to
the field names below, so they light up the moment the producer emits them.

## 1. Free wins — already computed, just not logged

`JEPATrainer`'s `substrate{}` block calls `model.aliveness_report()` (→ per-block
`living_layer_pc.aliveness()`) every light firing but only surfaces 2 of the 12
values. The rest are computed and discarded. Surface them (ideally **per-block**,
not just mean) under `substrate{}`:

| field (from aliveness()) | meaning | UI panel |
|---|---|---|
| `set_point_drift` | weight drift from set point — the core "is it still itself" signal | DRIFT & PLASTICITY |
| `update_ema_mean` | plasticity / update rate | DRIFT & PLASTICITY (`update_rate`) |
| `precision_mean` (+ min/max) | predictive-coding precision | PRECISION |
| `momentum_magnitude`, `weight_std`, `error_acc_max`, `episodes_stored` | extra substrate health | (future) |

## 2. Standard training-health signals — absent entirely

Confirmed not logged anywhere in the runner:

- **`grad_norm`** (global; ideally per-block) + **NaN/Inf guard** — top priority; no gradient signal exists today. (UI: GRADIENT NORM)
- **`lr`** — effective learning rate per step. (UI: LEARNING RATE)
- **`val_loss`** — held-out validation on an eval cadence (only training loss today). (UI: VALIDATION / PROBE)
- **`probe_acc`** — downstream linear-probe quality; the truest "is it learning anything useful," independent of loss. (UI: VALIDATION / PROBE)
- throughput rates (tokens/sec, step time) and GPU util/mem/temp.

## 3. Architecture-specific (higher effort, high value for Luthi)

- **Spiking activity / dead-neuron fraction** — it's a spiking substrate; firing-rate
  distribution + silent/dead fraction are core SNN health (hooks seen in the spiking
  layers; not traced fully).
- **Cross-modal representation alignment** — for a multimodal world model, how aligned
  text/audio/vision latents are in the shared space directly measures the IWMT
  integration thesis. New computation.

## Recommended first batch

1. Surface `aliveness()` extras (set_point_drift, update_ema_mean, precision), per-block — nearly free.
2. `grad_norm` + NaN/Inf guard.
3. `lr`.
4. `val_loss` + `probe_acc` on an eval cadence.

When these are added to `training_log.jsonl`, also bump `METRICS_CONTRACT.md` §1.
