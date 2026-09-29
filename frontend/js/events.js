import { state } from './state.js';
import { $, gint, num } from './utils.js';

// Training-event marks and the event-lock (evlock) comparison view. Split from app.js 2026-09-29.

export const EVLOCK_PRE = 2000, EVLOCK_POST = 5000, EVLOCK_GRID = 100, EVLOCK_TOL = 60;

// vertical event marks (canary/epoch) from the stream's events.jsonl. In
// event-locked mode a single mark sits at Δ0. Hovering a mark while the
// panel is ENLARGED shows its name (Brian's spec: name only, enlarged only).
// Which event marks belong on THIS panel (Brian, 2026-07-26: marks only where
// the data they reflect is relevant). Two rules:
//   - events.jsonl steps are TRAINING steps; cognition panels are indexed by
//     cycle, so marks there would be plain wrong, not merely noisy.
//   - a panel declares `marks: false` (schedules, odometers, host telemetry —
//     nothing the model does can react to a serving) or `marks: "epoch"`
//     (epoch-boundary data only). Default: all marks.
// Events LuthiScope derives from the records alone — no external file, no
// declared rule, no model: things the data itself states plainly (Brian's
// question, 2026-07-26). Input-property events (e.g. "a Greek page arrived")
// are NOT derivable here — no metric carries what text was served — so those
// come from events.jsonl, written by the producer or by a deterministic
// canary-replay script. Declaration or arithmetic, never interpretation.
// Which series a given event scope concerns — a mark only belongs on a panel
// whose data could actually show the thing (Brian, 2026-07-26).
export const SCOPE_SERIES = {
  grad: ["grad_norm"],
  loss: ["loss", "l_pred", "l_sigreg", "ce_loss", "recon"],
  substrate: ["pred_frob", "err_acc", "set_point_drift", "update_rate",
              "consol_fires", "precision", "precision_spread"],
  trust: ["precision", "precision_spread"],
  epoch: ["heldout_l_pred", "heldout_nmse", "val_loss", "val_acc"],
};

// A MARK MEANS SOMETHING REMARKABLE HAPPENED. Exposures (a canary document
// being served) are NOT events: the v5 family met the Greek page 36 times
// with no reaction, so 36 identical marks would assert 36 events that never
// occurred. An exposure earns a mark only when a derived event coincides
// with it — and then the mark is the EVENT, annotated with the coincidence.
export const COINCIDE_STEPS = 300;

export function deriveEvents(recs, exposures) {
  const out = [];
  const grads = recs.map((r) => num(r.grad_norm)).filter((v) => v != null).sort((a, b) => a - b);
  const gmed = grads.length ? grads[grads.length >> 1] : null;
  let prevFires = null, prevEpoch = null;
  const add = (step, scope, label) => out.push({ step, kind: "derived", scope, label });
  for (const r of recs) {
    const step = num(r.step);
    if (step == null) continue;
    const fires = num(r.substrate?.consolidation_fires);
    if (fires != null && prevFires != null && fires > prevFires) {
      add(step, "substrate", `consolidation fire (+${g(fires - prevFires)}, total ${g(fires)})`);
    }
    if (fires != null) prevFires = fires;
    const ep = num(r.epoch);
    if (ep != null && prevEpoch != null && ep !== prevEpoch) {
      out.push({ step, kind: "epoch", scope: "epoch", label: `epoch ${gint(ep)} begins` });
    }
    if (ep != null) prevEpoch = ep;
    if (r.nonfinite === true) add(step, "loss", "non-finite loss/gradient flagged");
    const gn = num(r.grad_norm);
    if (gn != null && gmed && gn > 5 * gmed) {
      add(step, "grad", `gradient shock (${g(gn)}, ${g(gn / gmed)}× median)`);
    }
  }
  // annotate any event that coincides with a declared exposure
  for (const e of out) {
    const near = exposures.find((x) => Math.abs(x.step - e.step) <= COINCIDE_STEPS);
    if (near) e.label += ` — at ${near.label}`;
  }
  return out;
}

// Events in play: derived remarkable occurrences, plus declared lifecycle
// marks from events.jsonl. Declared EXPOSURES (kind "canary") are context for
// labeling, never marks of their own.
export function activeEvents() {
  if (!state.showEventMarks || !state.current || state.current.kind !== "training") return [];
  const declaredNonExposure = state.streamEvents.filter((e) => e.kind !== "canary");
  return state.derivedEvents.concat(declaredNonExposure).sort((a, b) => a.step - b.step);
}
