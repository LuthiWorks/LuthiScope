import { state, disabledMetrics } from './state.js';
import { makeChart, makeHeatmap } from './charts.js';
import { PANEL_DESCS, attachDesc } from './descriptions.js';
import { EVLOCK_GRID, EVLOCK_POST, EVLOCK_PRE, EVLOCK_TOL, activeEvents } from './events.js';
import { GROUPS } from './panels-config.js';
import { renderReadout, updateOverview } from './readout.js';
import { computeRankFloored } from './refs.js';
import { updateMetricDots } from './uncharted.js';
import { $, gint, nearestVal } from './utils.js';

// Panel lifecycle: build, filter by prefs/data, maximize, refresh. Split from app.js 2026-09-29.

export const metricId = (kind, group, panel, label) => `${kind}|${group}|${panel}|${label}`;
export const metricEnabled = (id) => !disabledMetrics.has(id);

// Reduce a panel spec to its enabled series (shallow copy so the declarative
// catalog stays untouched); null when the whole panel is deselected.
export function filterPanelByPrefs(kind, group, spec) {
  if (spec.type === "heatmap") return metricEnabled(metricId(kind, group, spec.title, "*")) ? spec : null;
  const series = spec.series.filter((s) => metricEnabled(metricId(kind, group, spec.title, s.label)));
  return series.length ? Object.assign({}, spec, { series }) : null;
}

export function panelHasData(spec) {
  if (spec.type === "heatmap") return state.records.some(spec.has);
  return spec.series.some((s) => state.records.some((r) => s.get(r) != null));
}

export function buildPanels(kind) {
  if (state.maximized) { state.maximized.panel.remove(); if (state.maximized.placeholder) state.maximized.placeholder.remove(); const b = $("panel-backdrop"); if (b) b.classList.remove("show"); state.maximized = null; }
  const cfg = GROUPS[kind];
  const host = $("panels");
  host.innerHTML = "";
  state.charts.forEach((c) => (c.hm ? c.hm.destroy() : c.u.destroy()));
  state.charts = [];
  state.groupSeries = {};
  const width = panelWidth();
  const visibleTitles = [];
  for (const grp of cfg.groups) {
    let panels = grp.panels
      .map((p) => filterPanelByPrefs(kind, grp.title, p))
      .filter((p) => p && (state.showEmptyPanels || panelHasData(p)));
    // comparison overlay (one extra stream, line panels only — heatmaps
    // excluded per Brian): each series gains a dashed shadow twin
    if (state.compare && state.compare.kind === kind) {
      panels = panels.map((p) => p.type === "heatmap" ? p : Object.assign({}, p, {
        series: p.series.concat(p.series.map((s) => ({
          label: s.label, color: s.color, good: null, get: s.get, cmp: true,
        }))),
      }));
    }
    if (!panels.length) continue;            // hide empty/deselected groups
    visibleTitles.push(grp.title);
    state.groupSeries[grp.title] = panels.flatMap((p) => (p.series || []).filter((s) => !s.cmp));

    const section = document.createElement("section");
    section.className = "group";
    section.dataset.group = grp.title;
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span class="group-dot neutral" data-dot="${grp.title}"></span>` +
      `<span class="group-title">${grp.title}</span><span class="group-chev">▾</span>`;
    head.onclick = () => { section.classList.toggle("collapsed"); requestAnimationFrame(fitCharts); };
    section.appendChild(head);

    const body = document.createElement("div");
    body.className = "group-body panels-grid";
    for (const spec of panels) {
      const panel = document.createElement("div"); panel.className = "panel";
      const title = document.createElement("div"); title.className = "panel-title";
      const desc = PANEL_DESCS[`${grp.title}|${spec.title}`];
      if (desc) attachDesc(title, desc);
      const titleText = document.createElement("span"); titleText.textContent = spec.title;
      const expandBtn = document.createElement("button");
      expandBtn.className = "panel-expand"; expandBtn.title = "Enlarge"; expandBtn.textContent = "⤢";
      title.appendChild(titleText); title.appendChild(expandBtn);
      panel.appendChild(title);
      const chartHost = document.createElement("div"); panel.appendChild(chartHost);
      body.appendChild(panel);
      let rec;
      const xl = (state.eventLocked && state.showEventMarks && kind === "training"
                  && state.streamEvents.some((e) => e.kind === "canary"))
        ? "Δ steps from serving" : cfg.xlabel;
      if (spec.type === "heatmap") {
        const hm = makeHeatmap(chartHost, spec, cfg.xlabel);
        rec = { hm, spec, group: grp.title, el: chartHost };
      } else {
        const readoutEl = document.createElement("div"); readoutEl.className = "panel-readout"; panel.appendChild(readoutEl);
        const u = makeChart(chartHost, spec, xl, width);
        rec = { u, spec, readoutEl, group: grp.title, el: chartHost };
      }
      state.charts.push(rec);
      expandBtn.onclick = () => toggleMaximize(panel, rec);
    }
    section.appendChild(body);
    host.appendChild(section);
  }
  buildVitals(visibleTitles);
  requestAnimationFrame(fitCharts);
}

// Size each chart to its actual container width (the grid lays out after build, so
// a fixed estimate left panels half-filled). uPlot charts get setSize; heatmaps
// self-measure on resize().
export function fitCharts() {
  for (const c of state.charts) {
    if (c.hm) { c.hm.resize(); continue; }
    const w = (c.el && c.el.clientWidth) || panelWidth();
    if (w > 0) c.u.setSize({ width: w, height: 200 });
  }
}

// ---- enlarge a panel to the foreground (translucent overlay, not draggable) ----
export function ensureBackdrop() {
  let b = $("panel-backdrop");
  if (!b) { b = document.createElement("div"); b.id = "panel-backdrop"; b.onclick = restoreMaximized; document.body.appendChild(b); }
  return b;
}
export function sizeMaximized(rec) {
  if (rec.hm) { rec.hm.resize(); return; }
  const w = (rec.el && rec.el.clientWidth) || 600;
  const h = Math.max(240, Math.round(window.innerHeight * 0.82) - 120);
  rec.u.setSize({ width: w, height: h });
}
export function toggleMaximize(panel, rec) {
  if (state.maximized && state.maximized.panel === panel) { restoreMaximized(); return; }
  if (state.maximized) restoreMaximized();
  // Leave a same-height placeholder so the grid doesn't reflow, then move the panel
  // into the root stacking context (above the backdrop, so it gets mouse/wheel events).
  const ph = document.createElement("div");
  ph.className = "panel-placeholder";
  ph.style.height = panel.getBoundingClientRect().height + "px";
  panel.parentNode.insertBefore(ph, panel);
  ensureBackdrop().classList.add("show");
  document.body.appendChild(panel);
  panel.classList.add("maximized");
  const btn = panel.querySelector(".panel-expand"); if (btn) { btn.textContent = "⤡"; btn.title = "Reduce"; }
  state.maximized = { panel, rec, placeholder: ph };
  requestAnimationFrame(() => sizeMaximized(rec));
}
export function restoreMaximized() {
  if (!state.maximized) return;
  const { panel, placeholder } = state.maximized;
  panel.classList.remove("maximized");
  const btn = panel.querySelector(".panel-expand"); if (btn) { btn.textContent = "⤢"; btn.title = "Enlarge"; }
  const b = $("panel-backdrop"); if (b) b.classList.remove("show");
  if (placeholder && placeholder.parentNode) {   // drop the panel back into its exact slot
    placeholder.parentNode.insertBefore(panel, placeholder);
    placeholder.remove();
  }
  state.maximized = null;
  requestAnimationFrame(() => {
    fitCharts();
    // Ledger charts live outside `charts`, so fitCharts never reached them:
    // a restored uPlot kept its 84vh maximized canvas and hung behind the
    // grid as a ghost (Brian's report, 2026-07-26). Resize both kinds.
    for (const c of state.ledgerCharts) {
      if (c.hm) c.hm.resize();
      else if (c.u) c.u.setSize({ width: (c.el && c.el.clientWidth) || 500, height: 200 });
    }
  });
}

export function buildVitals(groupTitles) {
  const strip = $("statstrip");
  strip.innerHTML = "";
  for (const title of groupTitles) {
    const tile = document.createElement("div");
    tile.className = "vtile";
    tile.innerHTML = `<div class="k">${title}</div><div class="v neutral" data-vval="${title}">--</div>`;
    tile.onclick = () => {
      const sec = document.querySelector(`section.group[data-group="${title}"]`);
      if (sec) { sec.classList.remove("collapsed"); sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
    strip.appendChild(tile);
  }
}

export function panelWidth() {
  const host = $("panels");
  const w = host.clientWidth;
  const cols = Math.max(1, Math.floor(w / 480));
  return Math.floor(w / cols) - 26;
}

export function refreshData() {
  const cfg = GROUPS[state.current.kind];
  // Resume-safe normalization (2026-08-12). A mid-run resume re-appends
  // steps already in the file, so raw file order is NON-MONOTONE — and
  // uPlot's contract is strictly ascending x, so every uPlot panel went
  // blank on the first resumed run (the custom heatmap, with its own
  // renderer, was the only survivor — which is what gave the bug away).
  // Merge rows sharing a step (later rows supersede: a resumed row
  // replaces its pre-crash ghost; a quick-heldout row merges into its
  // diagnostics sibling), then sort ascending.
  const byX = new Map();
  for (const r of state.records) {
    const x = cfg.x(r);
    if (x == null) continue;
    const prev = byX.get(x);
    byX.set(x, prev ? Object.assign({}, prev, r) : r);
  }
  const pts = [...byX.values()].sort((a, b) => cfg.x(a) - cfg.x(b));
  const xs = pts.map(cfg.x);
  state.rankFloored = state.current.kind === "training" && computeRankFloored(state.records);
  // Event-locked view centres on EXPOSURES when a canary is declared (the
  // "what does the mind do when X arrives?" question, answerable even when
  // nothing remarkable happens), else on the derived events.
  const exposures = (state.showEventMarks && state.current.kind === "training")
    ? state.streamEvents.filter((e) => e.kind === "canary") : [];
  const evList = exposures.length ? exposures : activeEvents();
  const canary = evList.map((e) => e.step);
  const locked = state.eventLocked && canary.length > 0;
  // one event, or all of them averaged
  const lockSteps = (locked && state.evlockIndex != null && canary[state.evlockIndex] != null)
    ? [canary[state.evlockIndex]] : canary;
  // event-locked x grid: steps relative to the event(s)
  const relXs = [];
  if (locked) for (let d = -EVLOCK_PRE; d <= EVLOCK_POST; d += EVLOCK_GRID) relXs.push(d);
  renderEvlockBar(evList, locked);
  // compare-stream points, aligned later per series by nearest step
  const cmpPts = (state.compare && state.compare.kind === state.current.kind)
    ? state.compare.records.filter((r) => cfg.x(r) != null) : null;

  for (const c of state.charts) {
    // Heatmaps get the same normalized rows: without it a resumed run
    // draws its overlap region twice in file order.
    if (c.hm) { c.hm.setData(pts); continue; }
    let seriesData;
    if (locked) {
      // average each (non-compare) series across a window around every serving
      seriesData = c.spec.series.map((s) => {
        if (s.cmp) return relXs.map(() => null);
        const pairs = pts.map((r) => [cfg.x(r), s.get(r)]).filter((p) => p[1] != null);
        return relXs.map((d) => {
          let sum = 0, n = 0;
          for (const ev of lockSteps) {
            const v = nearestVal(pairs, ev + d, EVLOCK_TOL);
            if (v != null) { sum += v; n++; }
          }
          return n ? sum / n : null;
        });
      });
      c.u.setData([relXs].concat(seriesData));
    } else {
      seriesData = c.spec.series.map((s) => {
        if (!s.cmp) return pts.map(s.get);
        if (!cmpPts) return xs.map(() => null);
        const pairs = cmpPts.map((r) => [cfg.x(r), s.get(r)]).filter((p) => p[1] != null);
        return xs.map((x) => nearestVal(pairs, x, 250));
      });
      c.u.setData([xs].concat(seriesData));
    }
    renderReadout(c.readoutEl, c.spec, seriesData, locked ? relXs : xs);
  }
  updateOverview(xs);
  updateMetricDots();   // keep the settings-menu tracked-dots honest as data arrives
}

// Event navigation for the locked view (Brian, 2026-07-26): step through
// events one at a time, or average all of them.
export function renderEvlockBar(evList, locked) {
  let bar = $("evlock-bar");
  // Show the bar whenever the locked view is switched on — including when it
  // has nothing to lock onto, so the reason is visible instead of the whole
  // control silently vanishing (Brian: "the nav bar is not present").
  const wanted = state.eventLocked && state.current && state.current.kind === "training";
  if (!wanted) { if (bar) bar.style.display = "none"; return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "evlock-bar"; bar.className = "evlock-bar";
    const main = $("main");
    main.insertBefore(bar, $("panels"));
  }
  bar.style.display = "";
  if (!locked || !evList.length) {
    bar.innerHTML = `<span class="ev-label">event-locked view is on, but this stream has no events ` +
      (state.showEventMarks ? "to lock onto" : "— enable “Event marks” in Settings › Display") + `</span>`;
    return;
  }
  const n = evList.length;
  const cur = state.evlockIndex == null ? null : evList[state.evlockIndex];
  const label = cur
    ? `event ${state.evlockIndex + 1}/${n} · step ${gint(cur.step)} · ${cur.label}`
    : `averaging all ${n} events`;
  bar.innerHTML =
    `<button class="ev-nav" data-ev="prev" title="Previous event">‹</button>` +
    `<button class="ev-nav${state.evlockIndex == null ? " on" : ""}" data-ev="avg" title="Average all events">avg</button>` +
    `<button class="ev-nav" data-ev="next" title="Next event">›</button>` +
    `<span class="ev-label">${label}</span>`;
  bar.querySelectorAll(".ev-nav").forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.ev;
      if (mode === "avg") state.evlockIndex = null;
      else if (mode === "prev") state.evlockIndex = state.evlockIndex == null ? n - 1 : Math.max(0, state.evlockIndex - 1);
      else state.evlockIndex = state.evlockIndex == null ? 0 : Math.min(n - 1, state.evlockIndex + 1);
      refreshData();
    };
  });
}
