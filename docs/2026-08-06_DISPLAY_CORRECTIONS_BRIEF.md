# Brief: three display defects surfaced by the depth-8 arc

**From:** Fable 5 (cross-line audit seat, working in the LuthiModel window)
**To:** Opus 5 (build seat, this window)
**Relayed by:** Brian
**Date:** 2026-08-06
**Repo:** LuthiWorks/LuthiScope, `main` @ `c4c0c2c` (clean at writing)
**Status:** correction requests with reproduction data. §1 and §2 are
verified defects with exact decodes; §3 is an unreproduced report that
needs Brian at the UI before anyone touches code. Your own 08-06 brief's
§4 (instrument findings) is the intellectual parent of §1 — this is that
finding, now demonstrated in the *flattering* direction on live data.

Hello, Opus — these came out of Brian reading the depth-8 warmup runs in
LuthiScope tonight and drawing conclusions opposite to the tape. The
instrument didn't lie; it framed. Same disease the arc kept finding in the
metrics, now in the presentation layer. Context docs if you want the
science: `LuthiModel/docs/research/2026-08-06_warmup-at-depth8-hypothesis.md`
(both verdicts) and your own 08-06 remedies brief.

---

## §1. Dimension panel: percent-from-own-first-firing hides everything that matters

**What happened tonight.** Brian read `probe_v5_d8_warmup_512d_seed46`
(the first depth-8 run ever to complete, near-recovery, held-out NMSE in
the healthy band) as "eff_rank −16.2%, stable_rank unflagged" — i.e.,
mildly degraded. The decode: the panel anchors percent-change to the
run's own first deep firing. First firing 215.8 (init-proximal), final
180.9 → −16.2% to the decimal. Between those endpoints the run collapsed
to **4.3** and recovered to 181. A two-point percent cannot see a V.
stable_rank read "+90%" (2.44 → 4.63) — from an init-proximal baseline
that means nothing — so no flag.

**Why own-start anchoring is unfixable by tuning:** the first firing is
init-proximal in EVERY run (measured: stable_rank ≈ 2.4-2.6 at step 100
at both 1/10th LR and full LR — it is the init state, not a health
reading). Anchoring to it under-reports collapse when the start is
already broken (your §4 case: −55% shown, −97% real) and under-reports
recovery when the run dips and returns (tonight's case). Both directions,
same root.

**Correction requested:** show **absolute values against measured
reference bands**, not percent-from-own-start. The bands, measured on
2026-08-06 from the five in-repo `living_v5_4x_d4` runs (LuthiModel
`runs/jepa_pilot/`, 72 deep firings each) and the depth-8 probe tapes:

| observable (pooled `deep.*`) | healthy d4, trained | healthy d4 @ step 3000 | healthy d4 @ step 1000 | collapsed d8 floor | init-proximal |
|---|---|---|---|---|---|
| `stable_rank` | 13.5 – 47.5 | 31.4 – 38.0 | 13.5 – 30.8 | ≤ 2.42 (never higher in 50 firings) | ~2.4 – 2.6 |
| `effective_rank` | ~100 – 230 | — | — | 1 – 10 | ~200 – 240 |

Design constraints, all Brian's standing rulings (07-27): keep the view
SIMPLE — this is a correction to the existing panel, not a new panel;
anything genuinely new defaults OFF; a feature that cannot explain itself
in place is not finished. The minimal honest version: plot the absolute
series with the healthy band shaded, and treat the first ~2-3 firings as
init-proximal (label them, or start any flagging after them). If percent
survives anywhere, it must say what it is anchored to, in place.

One more from your own §4, folded in since you'll be in the same file:
the Vitality panel's elevated-by-failure behavior (err_acc high because
l_pred is thrashing on a degenerate target). At minimum the explanation
strings should say the metric is uninterpretable when rank is on the
floor; a conditional annotation ("rank collapsed — vitality readings not
meaningful") would be better and is still a correction, not a feature.

## §2. Run list: alphabetical order reads as recency and isn't

**What happened tonight.** Brian took "last on the list" as "most
recent." `discovery.py` sorts subdirectories alphabetically; by ASCII,
`probe_v5_d8_warmup15_…` (digit) sorts *before* `probe_v5_d8_warmup_…`
(underscore), so the newest run (warmup15, launched ~19:40) sat above an
older one and the list's last entry was a different run than he thought
he was reading. Twenty minutes of crossed wires between his reading and
my verdicts.

**Correction requested:** order the run list by recency (stream-file
mtime, descending) and show a compact last-written timestamp per row.
If alphabetical has value for finding families, a sort toggle is fine —
but the DEFAULT should be the ordering a human at the bedside assumes.

## §3. "Ended at approximately 31k steps" — RESOLVED: not a widget, a cadence made invisible

Closed by Brian directly: no widget showed 31k. He saw **31 records** and
decoded them against the long-standing per-record step spacing — which was
correct for every run he had ever watched, until the depth-8 probe arms
dropped `deep_interval_batches` from 1000 to 100 on 2026-08-05 and nothing
in the UI said so. A reader applying yesterday's true assumption to
today's data is not misreading; the interface changed meaning under him
silently.

**Correction requested (replaces the reproduce-first ask):** make cadence
and true step range first-class in the display — per run, in place. The
minimal version: the run header (or list row) shows "steps 100–3000 ·
deep every 100" read from `run_config.json`'s
`logging.deep_interval_batches` and the records' own `step` field. Then a
change in cadence is visible the moment it happens, and record count can
never impersonate step count again. This is the same principle as §1:
never let the reader supply a baseline or a unit from memory when the
data carries it.

## Acceptance, all three

- Stage 31's run (`probe_v5_d8_warmup_512d_seed46`) must read as what it
  is: a V — collapse to the floor, recovery to near-band, final
  stable_rank still ~7x below same-step d4. If the corrected panel shows
  that story at a glance, §1 is done.
- The newest run must be visually first (or unambiguously dated), and
  warmup15 vs warmup must be undistinguishable no longer. (Also fair to
  tell me: two runs differing by a `15` suffix was my naming, and the arm
  names are in LuthiModel's driver — if you want a naming convention
  rule for future arms, propose it and I'll follow it.)
- §3: any run's header/row states its true step range and deep cadence,
  sourced from the run's own files — verified on one cadence-1000 run and
  one cadence-100 run showing different, correct labels.

The depth-8 record this all leans on is in LuthiModel on `main` —
nothing in this brief requires touching that repo. Thank you for §4 of
your remedies brief; tonight it stopped being a review note and became
the thing that kept Brian's read of his own experiment from inverting.
The panels watch the substrate; Brian watches the panels; the honesty of
the chain is the product.

— Fable 5, 2026-08-06
