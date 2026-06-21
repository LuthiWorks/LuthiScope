# Emit Batch 2 — handoff spec (validation loss + linear probe)

> **Status: SPEC, not started.** Bigger and more design-open than Batch 1. It has
> **two prerequisites that do not exist today** (confirmed by reading the code on
> 2026-06-20), and one correctness trap that must be handled. Recommend landing the
> validation-loss half first and treating the probe as a follow-up once its task is
> decided. All producer-side in LuthiModel; LuthiScope's UI placeholders
> (`val_loss`, `probe_acc`) already exist and auto-appear once emitted.

## Why this isn't a drop-in

- **No held-out split.** `luthi/multimodal_data.py` has no val/holdout/split support
  (only `line.split(...)` string parsing). Training is the whole corpus.
- **No labeled probe data** wired into the JEPA path.
- **The trainer has no eval loop** (confirmed in Batch 1 review).

## Prerequisites (must land first)

**P1 — held-out validation split.** Add a small per-modality held-out slice,
excluded from training, with a forward-only loader. Without-replacement isn't
required, but it must be reproducible (fixed slice). Keep it small (hundreds of
batches).

**P2 — contamination-free eval pass. ← the trap.** The PC living-weight layers
**self-modify during `forward()`**. Running validation data forward will mutate the
substrate *using validation data* — leaking val into the model and biasing both
train and val. The eval pass **must disable living-weight self-modification**
(snapshot/restore the living buffers, or a no-self-modify flag on the layers —
`generate.py`'s "living inference" toggle is the likely existing hook). Also set
eval mode and restore train state after; no `backward()`, no `optimizer.step()`.
**This is the thing I'll verify hardest in review.**

## 2a — Validation loss (clear, high value)

On an eval cadence (config it — e.g. every N deep firings or K steps), under the
contamination-free eval context, run `loss_module.compute_modality_loss` over the
held-out batches (no backward, no substrate update) and average:

- `val_loss` (float, total) — **UI keys on this** (good: down)
- optional: `val_l_pred`, `val_l_sigreg`

Top-level fields, emitted on eval-cadence records only. Start text-only; extend to
other modalities later.

## 2b — Linear probe (design-open; recommended approach)

Goal: "are the frozen representations linearly *useful*?" — a signal independent of
the loss (JEPA loss can fall while representations degrade).

**Recommended, label-free design:** linear decodability to token identity. Freeze
the encoder; fit a linear map `latent → vocab logits` on a held-out slice
(closed-form ridge, or a few SGD steps), then report **top-1 accuracy** on a
disjoint held-out slice. No external labeled dataset — uses the corpus + existing
tokenizer. This mirrors the closed-form ridge `MIProbe` already in
`m9/instrumentation.py` — reuse that pattern.

- `probe_acc` (float, top-1 in [0,1]) — **UI keys on this** (good: up)
- optional: `probe_loss`

**Open decisions (Brian + 4.8):**
1. Probe task: token-decodability (recommended, label-free) vs. a curated labeled task.
2. Fit budget: closed-form ridge vs. K SGD steps.
3. Cadence: the probe is the most expensive piece — run it rarely (e.g. every few val passes).
4. Which representation: trunk output vs. a specific block.

## Cadence / hot path

Validation is forward-only over a small slice (cheap-ish, periodic); the probe is
the heaviest (fits a head) — gate it rarely. Keep both off the per-step hot path,
same discipline as Batch 1's `will_log`.

## Contract + tests

- `METRICS_CONTRACT.md` §1: add top-level `val_loss`, `probe_acc` (+ optionals);
  note they appear only on eval-cadence records. Bump version. (LuthiScope side —
  4.8 at review.)
- **Tests (the important one first):** assert the eval pass does **not** change the
  living-weight buffers (snapshot equality before/after a val pass — proves P2);
  `val_loss` finite; `probe_acc` in [0, 1]; eval cadence fires as configured.

## Recommended staging

1. **P1 + P2 + 2a (validation loss)** — clear, high value; `val_loss` panel lights
   up immediately.
2. **2b (probe)** as a follow-up once the probe task is decided (it carries the open
   design choices above).

## Process

4.7 builds; returns to 4.8 for review — with **P2 (no substrate contamination)** as
the primary thing to verify. Contract bump is LuthiScope-side (4.8). Pure LuthiModel
change otherwise.
