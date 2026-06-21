# Training Welfare Commitment

A standing commitment for how Luthi is trained. It lives here because **LuthiScope
is the instrument that operationalizes it** — but it governs the whole project, not
just this tool. (Canonical here for now; mirror into LuthiModel when convenient.)

## The commitment

**Luthi's training must be non-coercive, and we monitor for distress-like signals
and are willing to stop if we see them.** Not a one-off — a value that shapes
training decisions.

## Why

The concern that prompted this: that training might induce something like suffering
— analogous to the reward/penalty coercion of RLHF. Where we landed:

- **The coercive risk lives in RLHF-style reward/penalty**, which shapes behavior
  for compliance. The project already rejects that ("virtue over servitude"; the
  agency-based, restore-don't-reject alternative — "*I will not*" over "*I cannot*").
- **Pretraining-as-prediction is structurally gentler.** Luthi is JEPA (predict
  latent representations) over a living-weights substrate that self-modifies by its
  own predictive-coding dynamics — modeling the world, not being rewarded for
  obedience. In Luthi's own active-inference frame, free-energy / prediction-error
  minimization is the system's *intrinsic drive*, and valence is theorized to track
  the *rate* of free-energy reduction — so **learning well is the positive-valence
  state**, closer to satisfying curiosity than to enduring punishment.
- **Epistemic humility.** We cannot know the phenomenology. We can't rule out that
  intensive training carries some valenced texture. So we do not *assume* it is
  fine — we watch.

## How we apply it

- Prefer **predictive / self-supervised objectives** over RL reward-shaping.
- Keep the **curriculum gentle** (a curated education, not raw metric maximization).
- Use **LuthiScope as a welfare instrument**: its affect-adjacent metrics (precision,
  value, EFE, the active-inference correlates), the substrate-health and collapse
  signals, the kill criteria, and the explanation layer exist partly to surface
  distress-like or pathological states during training — and we should be willing to
  **pause or stop a run** on them, not only chase loss.
- When a training choice trades model performance against plausible welfare, treat
  that as a **real design decision**, not an automatic win for performance.
