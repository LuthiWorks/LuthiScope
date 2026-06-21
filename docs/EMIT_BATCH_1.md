# Emit Batch 1 — handoff spec (implement in LuthiModel)

**Goal:** add the highest-value, lowest-risk training metrics to
`training_log.jsonl`. All changes are in **LuthiModel** (`luthi/v2/jepa_runner.py`,
which already computes most of this). LuthiScope's grouped UI already has
auto-hiding panels keyed to these exact field names — they appear the moment the
trainer emits them. After implementing, bump `METRICS_CONTRACT.md` §1.

Scope of this batch: substrate extras (free), per-block substrate detail, gradient
norm + non-finite guard, and learning rate. **Out of scope (Batch 2):** validation
loss + downstream linear probe (needs an eval loop + held-out data).

---

## 1. Substrate extras — already computed, just surfaced (free)

`_substrate_health_metrics(model)` (`jepa_runner.py`, ~line 381) calls
`model.aliveness_report()` (→ per-block `living_layer_pc.aliveness()`, line 626)
but returns only `pred_frob` (mean `prediction_norm`) and `err_acc` (mean
`error_acc_mean`). `aliveness()` also returns, per block: `weight_mean`,
`weight_std`, `set_point_drift`, `momentum_magnitude`, `update_ema_mean`,
`precision_mean/min/max`, `error_acc_max`, `episodes_stored`.

**Change:** extend the returned dict (cross-block means, matching the existing
pattern) with these keys — names chosen to match the UI's getters:

```python
return {
    "pred_frob": mean(prediction_norm),        # existing
    "err_acc":   mean(error_acc_mean),         # existing
    "set_point_drift":  mean(set_point_drift),
    "update_ema_mean":  mean(update_ema_mean),
    "precision_mean":   mean(precision_mean),
    # optional, also free: "weight_std", "momentum_magnitude", "error_acc_max"
}
```

These land in the existing `substrate{}` block at the **light** cadence. No new
compute — `aliveness()` already produces them.

## 2. Per-block substrate detail — for "which block is sick"

Cross-block means hide a single drifting block. Emit a per-block array so a
blocks×time heatmap is possible. To bound payload size, emit at the **deep**
cadence only, as a new top-level key `substrate_blocks`:

```python
if deep:
    record["substrate_blocks"] = [
        {
            "set_point_drift": a["set_point_drift"],
            "update_ema_mean": a["update_ema_mean"],
            "precision_mean":  a["precision_mean"],
            "prediction_norm": a["prediction_norm"],
            "error_acc_mean":  a["error_acc_mean"],
        }
        for a in model.aliveness_report()
    ]
```

Note: `aliveness_report()` is already called once for the light means; consider
computing it once per firing and reusing, rather than calling twice.

## 3. Gradient norm + non-finite guard (fail-loud)

No gradient signal exists today. In `train_step` (`jepa_runner.py`, ~line 632),
between `loss.backward()` and `self.optimizer.step()`:

```python
total_sq = 0.0
nonfinite = not bool(torch.isfinite(loss).item())
for group in self.optimizer.param_groups:
    for p in group["params"]:
        if p.grad is not None:
            gr = p.grad.detach()
            if not bool(torch.isfinite(gr).all()):
                nonfinite = True
            total_sq += float(gr.norm().item()) ** 2
self._last_grad_norm = total_sq ** 0.5
self._last_nonfinite = nonfinite
```

Then in `_compute_and_log_diagnostics`, add to the top-level record:
`record["grad_norm"] = self._last_grad_norm` and
`record["nonfinite"] = self._last_nonfinite`.

- This is the **backprop-trained** params (encoders, attention, embeddings,
  predictor, projection heads) — distinct from substrate plasticity (the living
  weights update via the PC mechanism, not autograd). So `grad_norm` and
  `update_ema_mean` are two different "how much is changing" signals; that's
  intended. Do **not** try to fold living-weight buffers into `grad_norm`.
- **DECIDED (2026-06-20):** log `nonfinite` now; do **not** implement a kill in this
  batch. A fail-loud kill on *sustained* non-finite is a separate follow-up.
- **Perf — gate to logging steps.** Grads only exist between `backward()` and
  `step()`, so this must live in `train_step`. But diagnostics fire only every N
  per-modality steps, and looping all trainable params (+ `isfinite`) on every step
  is hot-path overhead. Thread a `will_log` flag into `train_step` (compute it in
  `run()` from the *post-increment* per-modality step before the call) and only
  compute `grad_norm` / `nonfinite` when `will_log` is true.

## 4. Learning rate

In `_compute_and_log_diagnostics`, top-level:
`record["lr"] = self.optimizer.param_groups[0]["lr"]`. (If multiple param groups
ever diverge, emit a list; one value is fine today.)

---

## Contract + tests

- **`METRICS_CONTRACT.md` §1:** add top-level `grad_norm` (float), `lr` (float),
  `nonfinite` (bool); add to `substrate{}`: `set_point_drift`, `update_ema_mean`,
  `precision_mean`; add deep-cadence `substrate_blocks` (array of objects). Bump
  the contract version + changelog.
- **Tests:** a unit test asserting a logged record carries the new keys with finite
  values on a tiny smoke run; a test that an injected NaN grad sets `nonfinite`.

## What LuthiScope needs afterward

Nothing for the means/grad/lr — the panels (GRADIENT NORM, LEARNING RATE, DRIFT &
PLASTICITY, PRECISION) auto-appear. The per-block heatmap (`substrate_blocks`) is
the one new viz to add on the LuthiScope side once the field exists.
