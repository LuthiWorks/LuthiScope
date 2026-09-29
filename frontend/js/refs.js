import { state } from './state.js';
import { $, gint, nearestVal, num } from './utils.js';

// Reference lines: absolute, run-declared, and peer-band machinery. Split from app.js 2026-09-29.


// ---- reference lines ----
//
// Three sources, kept separate because they carry different authority, and the
// panel says which one it is drawing. The rule that decides membership: a line
// belongs here only if it is true independently of THIS model family. We will
// not be running 512d/4x/d4/v5 forever — anything measured off that family
// would go stale silently, which is the failure this whole correction is about.
//
// 1. ABSOLUTE_REFS — properties of the metric's definition. Arithmetic or a
//    published target. These never go stale.
// 2. run-declared — read from the run's own run_config.json at load time, and
//    ONLY the ones the guard compares against directly. The baselined ones are
//    withheld with a reason (see discovery.run_thresholds).
// 3. peer band — computed live from runs you designate. Never stored, so it
//    cannot go stale; when the family changes you designate the new family.
//
// `kind`: "floor"/"ceiling" = crossing it is degenerate; "limit" = a declared
// kill line; "target" = a level to aim at, no health claim on its own.
export const ABSOLUTE_REFS = {
  // nmse = l_pred / target_var (luthi/v2/eval_heldout.py). 1.0 is exactly the
  // error of predicting the target's mean, so below 1 the model beats a
  // constant and at/above 1 it does not. True for any width, depth or version.
  heldout_nmse: [{ value: 1.0, kind: "limit", label: "NMSE 1.0",
                   note: "parity with predicting the mean", source: "arithmetic" }],
  // effective/stable rank are bounded below by 1 by construction: rank 1 is one
  // direction. Collapse is a fact about the quantity, not about the family.
  eff_rank:    [{ value: 1.0, kind: "floor", label: "rank 1",
                  note: "one direction — degenerate", source: "definition" }],
  stable_rank: [{ value: 1.0, kind: "floor", label: "rank 1",
                  note: "one direction — degenerate", source: "definition" }],
  // VICReg's variance hinge requires per-dim std to exceed 1.0. That is the
  // published target the project's own collapse/warning bands are struck from
  // (m8-brief-v0.5 §155); the 0.1 and 0.5 bands are OUR fractions of it, so the
  // target is drawn and the fractions are not.
  std_p5: [{ value: 1.0, kind: "target", label: "VICReg variance target",
             note: "per-dim std hinged above 1.0", source: "arXiv:2105.04906" }],
  // cosine is bounded [-1,1]; 1.0 is the predictor having learned to copy.
  triv_cos: [{ value: 1.0, kind: "ceiling", label: "cosine 1.0",
               note: "trivial copy", source: "definition" }],
};

// Deep-cadence rank is init-proximal for its first firings: measured at ~2.4-2.6
// stable_rank at step 100 at both full and 1/10th LR, i.e. it is the init state
// and not a health reading. Anchoring a percent to it under-reports collapse
// when the start is already broken AND under-reports recovery when the run dips
// and returns. We cannot stop it being the first sample, so we label it.
export const INIT_PROXIMAL_FIRINGS = { eff_rank: 3, stable_rank: 3 };

// Metrics whose interpretation is VOID while the representation is degenerate.
// These do not fail by going quiet — they fail by producing confident numbers
// that point the wrong way, which is why they get an explicit annotation
// instead of being left to the reader to discount.
export const RANK_DEPENDENT = {
  err_acc: "it rises because l_pred is thrashing on a degenerate target — elevated BY the failure",
  pred_frob: "predictive structure measured against a collapsed target",
  heldout_nmse: "nmse = l_pred / target_var, and target_var collapses with the representation",
};
// At most two effective directions. Stated against the definitional floor (rank
// 1) rather than a measured collapse value, so it stays true at any width: no
// model of interest is doing its job inside a 2-dimensional subspace.
export const RANK_FLOOR_AT = 2.0;

export function computeRankFloored(recs) {
  let last = null;
  for (const r of recs) {
    const sr = num(r.deep?.stable_rank);
    if (sr != null) last = sr;
  }
  return last != null && last <= RANK_FLOOR_AT;
}

export function refsFor(label) {
  return (ABSOLUTE_REFS[label] || []).concat(state.runRefs[label] || []);
}

// Only quantities whose LEVEL is family-dependent earn a band. A definitional
// floor needs no peers, and a raw loss has no cross-run meaning to band at all.
export const BANDABLE = ["eff_rank", "stable_rank"];
export const BAND_GET = {
  eff_rank: (r) => num(r.deep?.effective_rank),
  stable_rank: (r) => num(r.deep?.stable_rank),
};
// Reference runs may log at a different cadence than the run being read (the d4
// family fires deep every 1000; the d8 probes every 100), so a contributor is
// sampled at the nearest firing within this many steps of a grid point.
export const BAND_TOL = 600;

export async function loadRefBands() {
  state.refBands = {}; state.refBandRuns = [];
  if (!state.refRuns.length) return;
  const runs = [];
  for (const id of state.refRuns) {
    try {
      const resp = await (await fetch(`/api/streams/${encodeURI(id)}/records`)).json();
      if (resp.records && resp.records.length) runs.push({ id, records: resp.records });
    } catch (e) { /* a designated run that has vanished stops contributing, silently to the fetch but visibly in the count shown on the panel */ }
  }
  if (!runs.length) return;
  state.refBandRuns = runs.map((r) => r.id);
  for (const label of BANDABLE) {
    const get = BAND_GET[label];
    const contributing = runs
      .map((r) => r.records.map((rec) => [num(rec.step), get(rec)])
                           .filter((p) => p[0] != null && p[1] != null))
      .filter((p) => p.length);
    if (!contributing.length) continue;
    // Grid = the union of every contributor's steps, so no run's cadence is
    // privileged and a denser reference is not silently downsampled.
    const grid = [...new Set(contributing.flatMap((p) => p.map((q) => q[0])))].sort((a, b) => a - b);
    const xs = [], lo = [], hi = [];
    for (const x of grid) {
      const vals = contributing.map((p) => nearestVal(p, x, BAND_TOL)).filter((v) => v != null);
      // Band only where EVERY contributor has a sample. Past the shortest run
      // the band would quietly narrow to whoever is left, which reads as the
      // family agreeing more, not as fewer runs reporting.
      if (vals.length < contributing.length) continue;
      xs.push(x); lo.push(Math.min(...vals)); hi.push(Math.max(...vals));
    }
    if (xs.length) {
      state.refBands[label] = { xs, lo, hi, n: contributing.length,
                          endsAt: xs[xs.length - 1], gridEnd: grid[grid.length - 1] };
    }
  }
}

// Where this run's final value sits against the band, at the step it actually
// reached — not against a band pooled over a whole training run. Comparing a
// step-3000 value to a 72k-step envelope is its own framing error.
export function bandVerdict(label, st) {
  const b = state.refBands[label];
  if (!b || st.endAt == null) return "";
  let bi = -1, bd = Infinity;
  for (let i = 0; i < b.xs.length; i++) {
    const d = Math.abs(b.xs[i] - st.endAt);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0 || bd > BAND_TOL) return `no band at step ${gint(st.endAt)}`;
  const lo = b.lo[bi], hi = b.hi[bi], at = gint(b.xs[bi]);
  if (st.end < lo) {
    const ratio = st.end > 0 ? lo / st.end : null;
    return `${ratio ? `${ratio.toFixed(1)}× ` : ""}below band ${g(lo)}–${g(hi)} @${at}`;
  }
  if (st.end > hi) return `above band ${g(lo)}–${g(hi)} @${at}`;
  return `in band ${g(lo)}–${g(hi)} @${at}`;
}
