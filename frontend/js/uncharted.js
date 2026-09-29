import { state, chartedCache } from './state.js';
import { GROUPS } from './panels-config.js';
import { $ } from './utils.js';

// Tracked-metric dots + uncharted-key disclosure. Split from app.js 2026-09-29.


// ---- tracked-metric dots + uncharted-key disclosure (2026-08-14) ----
//
// "Tracked" is a claim about the stream being watched RIGHT NOW, so the dots
// are recomputed from the loaded stream on every data refresh instead of being
// baked into the menu's HTML at open time, and the menu names the stream they
// describe. Two honest states instead of one:
//   pulsing green — the metric appears in the stream's RECENT records
//                   (within ~2 logging cadences of the newest step);
//   dim          — it appears earlier in this stream's history but not
//                   recently (a resumed or reconfigured run: "was tracked"
//                   must not read as "is tracked").

// Records within ~2 declared logging cadences of the newest step — "recent"
// judged against the run's own rhythm, not a fixed row count, so a sparse
// deep-cadence metric isn't misread as historic between firings.
export function recentRecords() {
  if (!state.current || !state.records.length) return [];
  const cfg = GROUPS[state.current.kind];
  const xs = state.records.map(cfg.x).filter((v) => v != null);
  if (!xs.length) return state.records.slice(-24);
  const c = (state.currentMeta && state.currentMeta.cadence) || {};
  const interval = Math.max(c.deep_interval_batches || 0, c.light_interval_batches || 0);
  if (!interval) return state.records.slice(-24);   // no declared cadence: fall back to a tail
  const cutoff = Math.max(...xs) - 2 * interval;
  return state.records.filter((r) => { const x = cfg.x(r); return x != null && x >= cutoff; });
}

export function updateMetricDots() {
  const panel = $("settings-panel");
  if (!panel || !panel.querySelector("[data-dot]")) return;   // metric page not open
  const streamLabel = $("dot-stream");
  if (streamLabel) streamLabel.textContent = state.current ? state.current.id : "none";
  const recent = recentRecords();
  for (const el of panel.querySelectorAll("[data-dot]")) {
    const [kind, group, panelTitle, label] = el.dataset.dot.split("|");
    const grp = GROUPS[kind] && GROUPS[kind].groups.find((g) => g.title === group);
    const p = grp && grp.panels.find((pp) => pp.title === panelTitle);
    let test = null;
    if (p) {
      if (p.type === "heatmap") test = (r) => !!p.has(r);
      else {
        const s = p.series.find((ss) => ss.label === label);
        if (s) test = (r) => s.get(r) != null;
      }
    }
    let cls = "m-dot", title = "";
    if (test && state.current && state.current.kind === kind && state.records.length) {
      if (recent.some(test)) {
        cls = "m-dot live";
        title = "actively tracked: data in the stream's recent records";
      } else if (state.records.some(test)) {
        cls = "m-dot hist";
        title = "in this stream's history, but absent from its recent records";
      }
    }
    el.className = cls;
    el.title = title;
    el.textContent = cls === "m-dot" ? "" : "●";
  }
  renderUncharted();
}

// Keys that are structure/bookkeeping, not metrics — deliberately chartless.
export const STRUCTURAL_KEYS = new Set(["step", "cycle", "modality", "nonfinite",
  "heldout.text.n_batches", "heldout.text.quick"]);
export function pathCharted(kind, path, value) {
  const ck = `${kind}|${path}`;
  if (chartedCache.has(ck)) return chartedCache.get(ck);
  const parts = path.split(".");
  const rec = {};
  let o = rec;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = {};
  o[parts[parts.length - 1]] = value;
  const cfg = GROUPS[kind];
  let hit = cfg.x(rec) != null;   // the x axis itself counts as read
  if (!hit) outer: for (const grp of cfg.groups) {
    for (const p of grp.panels) {
      try {
        if (p.type === "heatmap") { if (p.has(rec)) { hit = true; break outer; } }
        else for (const s of p.series) { if (s.get(rec) != null) { hit = true; break outer; } }
      } catch (e) { /* an accessor throwing on a partial record is a non-hit */ }
    }
  }
  chartedCache.set(ck, hit);
  return hit;
}

// Every leaf path in the loaded stream that carries actual data (non-null at
// least once). Objects are descended; arrays are leaves.
export function streamKeyPaths() {
  const seen = new Map();
  const walk = (o, prefix) => {
    for (const k in o) {
      const v = o[k];
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, path);
      else if (v != null && !seen.has(path)) seen.set(path, v);
    }
  };
  for (const r of state.records) walk(r, "");
  return seen;
}

// The producer tracks more than the catalog charts (the VISReg-era
// diagnostics — offset dominance, trunk norm gain, centered cosine — arrived
// before their panels did). A menu that lists only what it charts reads as
// "this is everything the run tracks", which is a silent cap. Name the rest.
export function renderUncharted() {
  const host = $("uncat-keys");
  if (!host) return;
  if (!state.current || !state.records.length) { host.innerHTML = ""; return; }
  const paths = [];
  for (const [path, v] of streamKeyPaths()) {
    if (STRUCTURAL_KEYS.has(path)) continue;
    if (!pathCharted(state.current.kind, path, v)) paths.push(path);
  }
  if (!paths.length) { host.innerHTML = ""; return; }
  paths.sort();
  host.innerHTML =
    `<div class="settings-cat">Uncharted keys in this stream</div>` +
    `<div class="set-note">The loaded stream carries ${paths.length} key(s) no panel reads — ` +
    `tracked by the producer, invisible in this UI. Listed so "not shown" cannot read as "not tracked".</div>` +
    `<div class="uncat-list">${paths.map((p) => `<code>${p}</code>`).join("")}</div>`;
}
