# Explanation Layer — Ideas (tentative, nothing committed)

This is a scratchpad of ideas for letting LuthiScope *explain what the results
mean*, not just show them. Nothing here is decided. It exists so the thinking
isn't lost. Treat every line as "one option we discussed," not a plan of record.

## The core principle we keep coming back to

The raw data is always primary. Any explanation sits *alongside* it, is grounded
in the actual numbers, and never replaces or obscures the traces. An explanation
that sounds authoritative while being wrong is worse than no explanation.

## The realization that shapes everything

We already own the ground truth of "healthy vs not": the trainer's kill
thresholds, each metric's healthy direction, the pilot baselines, and the trends.
So a large amount of *correct* result-explanation can be produced with **no model
at all** — computed directly from the data plus the trainer's own rules. That
deterministic layer can't hallucinate, because it's arithmetic over known facts.

Example of what the deterministic layer can say truthfully:
> "online_std_p5 is 0.31 — 18% below its pilot baseline of 0.38, trending down 3
> readings running, approaching the kill-1 collapse floor."

## Layered idea (most-to-least certain)

1. **Deterministic interpreter (backbone).** Plain-language findings derived from
   values + thresholds + trends. Correct by construction. Powers "needs
   attention," per-metric verdicts, and the health colors.
2. **Language model for synthesis (optional, on top).** Feed it the *structured
   findings from layer 1* — not raw numbers to free-associate over — and have it
   write a readable narrative and suggest what to check. Grounded in pre-verified
   facts, so fabrication risk is low, and it should cite the exact numbers so the
   user can verify.
3. **Verification discipline.** The narrative references real values; the numbers
   sit next to it; prose never stands alone.

## Backend options for the layer-2 narrator (all open)

- **Capable external API (e.g. Claude).** Most correct reasoning, least effort.
  Cost per call; sends metrics off-box (low-sensitivity loss numbers, but it *is*
  the entity's data leaving — a philosophical consideration, not just technical).
- **Small off-the-shelf local model.** Keeps data in-house. Risk: small models
  tend to recite metric *definitions* and fabricate *interpretations*; weak at
  applying general knowledge to specific novel numbers. Helped a lot by feeding it
  layer-1 findings rather than raw data.
- **Train/fine-tune our own.** Note of caution: training a small model on an
  ML+neuroscience corpus buys fluency and vocabulary, *not* correct reasoning over
  our specific numbers — it can fabricate more authoritatively, which is the exact
  failure we want to avoid, and it's a second training project competing with
  Luthi. The *safer* version of this instinct, if pursued later: **distill** a
  small model on `(layer-1 finding -> explanation)` pairs so it learns to
  *verbalize already-correct findings* (a narrow, safe task), not to reason from
  scratch. A v3 idea at most.

## Rough sequencing idea

Layer 1 (deterministic) is no-regret and depends on nothing external — build it
with the interface. The layer-2 narrator is pluggable behind one interface, so the
backend choice can be deferred and swapped without touching the rest. In-house
(distilled) is the eventual home if keeping data on-box matters; the capable API
is the easiest starting point if/when we want narration.

## Open questions (unanswered on purpose)

- Do we even want layer-2 narration, or is the deterministic layer enough?
- Per-metric verdicts vs. a single run-level summary vs. both?
- On-demand ("explain this") vs. always-on?
- If/when local: distill from what teacher, on what finding set?
