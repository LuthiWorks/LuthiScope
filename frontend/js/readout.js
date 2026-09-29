import { state } from './state.js';
import { INIT_PROXIMAL_FIRINGS, RANK_DEPENDENT, bandVerdict, refsFor } from './refs.js';
import { $, EXCURSION_MIN, gint, num, seriesStats } from './utils.js';

// Readout line: momentum/health coloring for each series. Split from app.js 2026-09-29.


// polarity-aware health/momentum: blue(opt) green(good) yellow(warn) orange(near) red(bad)
//
// `refs` are the reference lines in force for this series (see REF machinery
// below). Two things now outrank the percent, because both are true about the
// data rather than about a pair of endpoints:
//   1. sitting on a definitional floor (rank 1 = one direction) is collapse,
//      whatever the trend says;
//   2. a large excursion means the endpoints hid something, so the series is
//      never reported as quietly healthy on endpoint evidence alone.
export function momentumClass(st, good, refs){
  if (!st) return "neutral";
  for (const r of (refs || [])) {
    if (r.kind === "floor" && st.end <= r.value * (r.tol || 1.05)) return "bad";
    if (r.kind === "ceiling" && st.end >= r.value * (r.tol || 0.95)) return "bad";
    if (r.kind === "limit" && st.end > r.value) return "bad";
  }
  // The path left the endpoints' envelope: something happened. Flag it as worth
  // a look even when the run came back — recovery is a finding, not a reason to
  // go quiet.
  if (st.excursion >= EXCURSION_MIN) return "near";
  if (st.dpct == null || good == null) return "neutral";
  const improving = good === "up" ? st.end > st.start : st.end < st.start;
  const m = Math.abs(st.dpct);
  if (improving) return m >= 10 ? "opt" : "good";
  if (m < 5) return "warn";
  if (m < 15) return "near";
  return "bad";
}

export function renderReadout(el, spec, seriesData, xs) {
  let html = "";
  spec.series.forEach((s, i) => {
    if (s.cmp) return;   // shadow series: visible on the chart, not in the readout
    const st = seriesStats(seriesData[i], xs);
    if (!st) {
      html += `<div class="ro-row"><span class="ro-dot" style="background:${s.color}"></span>` +
              `<span class="ro-label">${s.label}</span><span class="ro-prog">no data</span>` +
              `<span></span><span></span></div>`;
      return;
    }
    const refs = refsFor(s.label);
    const arrow = st.end > st.start ? "▲" : (st.end < st.start ? "▼" : "–");
    const cls = momentumClass(st, s.good, refs);
    // The percent must say what it is anchored to, in place — and when the
    // anchor is a run's first deep firing, it must say that the anchor is the
    // init state rather than a healthy reading.
    const initN = INIT_PROXIMAL_FIRINGS[s.label];
    const anchored = initN && st.n > initN ? "vs first firing · init-proximal" : "vs first";
    const dtxt = st.dpct == null ? arrow
      : `${arrow} ${st.dpct >= 0 ? "+" : ""}${st.dpct.toFixed(1)}%`;
    // Show the path when the endpoints hide it, so a V cannot read as a drift.
    const prog = st.excursion >= EXCURSION_MIN && st.detour
      ? `<b>${g(st.start)}</b> → <b class="ro-detour">${g(st.detour.v)}</b>` +
        `<span class="ro-at">@${gint(st.detour.at)}</span> → <b>${g(st.end)}</b>`
      : `<b>${g(st.start)}</b> → <b>${g(st.end)}</b>`;
    const band = bandVerdict(s.label, st, xs);
    html +=
      `<div class="ro-row">` +
        `<span class="ro-dot" style="background:${s.color}"></span>` +
        `<span class="ro-label">${s.label}</span>` +
        `<span class="ro-prog">${prog}</span>` +
        `<span class="ro-delta ${cls}" title="${anchored}">${dtxt}` +
          `<span class="ro-anchor">${anchored}</span></span>` +
        `<span class="ro-spread">min ${g(st.min)}<span class="ro-at">@${gint(st.minAt)}</span>` +
          ` · max ${g(st.max)}<span class="ro-at">@${gint(st.maxAt)}</span>` +
          ` · σ ${g(st.std)}${band ? ` · <span class="ro-band">${band}</span>` : ""}</span>` +
      `</div>`;
  });
  // Say what the band is, in place. A shaded region whose provenance lives in a
  // settings dialog is a claim the reader has to take on trust.
  const banded = spec.series.filter((s) => !s.cmp && state.refBands[s.label]);
  if (banded.length) {
    const b = state.refBands[banded[0].label];
    const names = state.refBandRuns.map((id) => id.split("/")[0]).join(", ");
    const short = names.length > 64 ? `${state.refBandRuns.length} designated runs` : names;
    const truncated = b.endsAt < b.gridEnd
      ? ` · band ends @${gint(b.endsAt)} (shortest reference run)` : "";
    html += `<div class="ro-note">band: ${b.n} reference run(s) · ${short} · ` +
            `step-matched, recomputed from their logs${truncated}</div>`;
  }
  // Metrics that are not interpretable while the representation is degenerate
  // say so, rather than being read as vitals (your §4: err_acc elevated BY the
  // failure it is supposed to be reporting).
  if (state.rankFloored) {
    for (const s of spec.series) {
      const why = !s.cmp && RANK_DEPENDENT[s.label];
      if (why) html += `<div class="ro-note warnnote">rank on the floor — ` +
                       `${s.label} is not meaningful here: ${why}</div>`;
    }
  }
  el.innerHTML = html;
}

export const HEALTH_ORDER = { neutral: 0, opt: 1, good: 1, warn: 2, near: 3, bad: 4 };

// recompute the per-group health tiles, group dots, and "needs attention" bar
export function updateOverview(xs) {
  const flagged = [];
  const allX = xs || state.records.map((r) => num(r.step));
  for (const title in state.groupSeries) {
    let worst = "neutral", worstRank = 0, headline = null, headlineSet = false;
    for (const s of state.groupSeries[title]) {
      const st = seriesStats(state.records.map(s.get), allX);
      if (!headlineSet && st) { headline = st.end; headlineSet = true; }
      const cls = momentumClass(st, s.good, refsFor(s.label));
      if (HEALTH_ORDER[cls] > worstRank) { worstRank = HEALTH_ORDER[cls]; worst = cls; }
      if (cls === "warn" || cls === "near" || cls === "bad") flagged.push({ group: title, label: s.label, cls, st });
    }
    const dot = document.querySelector(`[data-dot="${title}"]`);
    if (dot) dot.className = "group-dot " + worst;
    const vval = document.querySelector(`[data-vval="${title}"]`);
    if (vval) { vval.textContent = headlineSet ? g(headline) : "--"; vval.className = "v " + worst; }
  }
  renderAttention(flagged);
}

export function renderAttention(flagged) {
  const el = $("attention");
  if (!el) return;
  if (!flagged.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "";
  const rank = { warn: 1, near: 2, bad: 3 };
  flagged.sort((a, b) => rank[b.cls] - rank[a.cls]);
  el.innerHTML = `<span class="att-head">⚠ NEEDS ATTENTION</span>` +
    flagged.map((f) => {
      const st = f.st;
      // Report the excursion when the endpoints hide it. "eff_rank -16.2%" was
      // a true sentence about a run that had been to 4.3 and back; "fell to 4.3
      // @500, now 181" is the same run described.
      let detail = "";
      if (st && st.excursion >= EXCURSION_MIN && st.detour) {
        const dir = st.detour.v < Math.min(st.start, st.end) ? "fell to" : "rose to";
        detail = ` ${dir} ${g(st.detour.v)} @${gint(st.detour.at)}, now ${g(st.end)}`;
      } else if (st && st.dpct != null) {
        detail = ` ${st.dpct >= 0 ? "+" : ""}${st.dpct.toFixed(1)}% vs first`;
      }
      return `<span class="att-item ${f.cls}">${f.group} · ${f.label}${detail}</span>`;
    }).join("");
}
