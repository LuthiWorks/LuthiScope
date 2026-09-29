// Shared formatting, color, and DOM helpers. Split from app.js 2026-09-29.


// identity palette for distinguishing series (bright on white)
export const C = {
  blue: "#3b82f6", teal: "#22d3ee", green: "#22c55e",
  purple: "#a78bfa", orange: "#fb923c", red: "#f87171", gray: "#94a3b8",
};

export const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

export function f2(v){ return v==null?"--":Number(v).toFixed(2); }
export function f3(v){ return v==null?"--":Number(v).toFixed(3); }
export function f4(v){ return v==null?"--":Number(v).toFixed(4); }

export function g(v){
  if (v==null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(+v.toPrecision(4));
}
export function gint(v){ return v==null?"--":(Number.isInteger(v)?String(v):String(+v.toPrecision(6))); }

// A two-point percent cannot see a V. On 2026-08-06 a depth-8 run that fell
// from eff_rank 215.8 to 4.3 and climbed back to 180.9 read as "-16.2%" —
// arithmetically exact, and the collapse it lived through was invisible in the
// headline. So the stats now carry WHERE the path went, not just where it
// started and stopped, and every consumer of `dpct` has to say what it anchored
// to.
export function seriesStats(ys, xs){
  const v = [], vx = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (y != null && isFinite(y)) { v.push(y); vx.push(xs ? xs[i] : i); }
  }
  if (!v.length) return null;
  let min = v[0], max = v[0], minAt = vx[0], maxAt = vx[0], sum = 0;
  for (let i = 0; i < v.length; i++) {
    const y = v[i];
    if (y < min) { min = y; minAt = vx[i]; }
    if (y > max) { max = y; maxAt = vx[i]; }
    sum += y;
  }
  const mean = sum / v.length;
  let varr = 0; for (const y of v) varr += (y - mean) ** 2;
  const start = v[0], end = v[v.length - 1];
  const startAt = vx[0], endAt = vx[vx.length - 1];
  // A delta needs two samples: with one point start===end and the badge
  // would claim "+0.0%" about a trend that doesn't exist yet (the seed45
  // single-heldout-record confusion, 2026-07-19).
  const dpct = v.length >= 2 && start !== 0 ? ((end - start) / Math.abs(start)) * 100 : null;
  // How much of the journey happens OUTSIDE the start->end envelope, as a
  // fraction of the full range. ~0 = the endpoints tell the story; ->1 = the
  // endpoints hide it. The 08-06 warmup run scores 0.84.
  const lo = Math.min(start, end), hi = Math.max(start, end);
  const outside = Math.max(lo - min, max - hi, 0);
  const excursion = (max - min) > 0 ? outside / (max - min) : 0;
  // Which extremum the endpoints are hiding, so the readout can show the path.
  const detour = excursion > 0
    ? ((lo - min) >= (max - hi) ? { v: min, at: minAt } : { v: max, at: maxAt })
    : null;
  return { start, end, startAt, endAt, min, max, minAt, maxAt, range: max - min,
           std: Math.sqrt(varr / v.length), dpct, n: v.length, excursion, detour };
}

// Above this, the start->end delta is not a description of the series and the
// readout shows the path instead.
export const EXCURSION_MIN = 0.2;

export function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// nearest-record lookup on a sorted [x, value] array (for compare alignment
// and event-locked sampling); null when nothing within tol
export function nearestVal(pairs, x, tol) {
  let lo = 0, hi = pairs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid][0] < x) lo = mid + 1; else hi = mid;
  }
  let best = null, bestD = tol + 1;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= pairs.length) continue;
    const d = Math.abs(pairs[i][0] - x);
    if (d < bestD) { bestD = d; best = pairs[i][1]; }
  }
  return bestD <= tol ? best : null;
}

export const $ = (id) => document.getElementById(id);

export function setConn(state, text) {
  const el = $("conn");
  el.className = "conn " + state;
  el.textContent = "● " + text;
}

// Compact "how long since this run last wrote". The list is ordered by this,
// newest first — alphabetical order reads as recency and isn't (by ASCII,
// `..._warmup15_...` sorts before `..._warmup_...`, so on 2026-08-06 the newest
// run sat above an older one and the last row was not the last run).
export function ago(mtime) {
  if (!mtime) return "no timestamp";
  const secs = Date.now() / 1000 - mtime;
  if (secs < 0) return "just now";
  if (secs < 90) return `${Math.round(secs)}s ago`;
  if (secs < 5400) return `${Math.round(secs / 60)}m ago`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
