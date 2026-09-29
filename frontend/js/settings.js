import { state, EVLOCK_KEY, EVMARKS_KEY, SHOW_EMPTY_KEY, disabledMetrics, saveDisabledMetrics } from './state.js';
import { PANEL_DESCS, attachDesc } from './descriptions.js';
import { buildPanels, fitCharts, metricEnabled, metricId, refreshData } from './panels.js';
import { GROUPS } from './panels-config.js';
import { loadStreams } from './streams.js';
import { updateMetricDots } from './uncharted.js';
import { $ } from './utils.js';

// Settings panel, metric toggles, sidebar. Split from app.js 2026-09-29.


// ---- settings panel ----
export const SETTINGS_SCHEMA = [
  { cat: "Background Simulation" },
  { type: "checkbox", key: "enabled", label: "Enabled" },
  { type: "select", key: "quality", label: "Quality", parse: Number,
    options: [["64", "Low"], ["96", "Medium"], ["128", "High"]] },
  { type: "select", key: "palette", label: "Palette",
    options: [["aurora", "Aurora"], ["ember", "Ember"], ["ice", "Ice"], ["spectrum", "Spectrum"], ["mono", "Mono"]] },
  { type: "range", key: "intensity", label: "Intensity", min: 0.3, max: 2, step: 0.1 },
  { type: "range", key: "trail", label: "Trail length", min: 0.95, max: 0.996, step: 0.002 },
  { type: "range", key: "clickCount", label: "Objects per click", min: 0, max: 5, step: 1, parse: Number, note: "0 = off" },
  { type: "range", key: "clickMax", label: "Max click objects", min: 0, max: 5, step: 1, parse: Number, note: "concurrent cap" },
  { type: "range", key: "autoObjects", label: "Continuous objects", min: 0, max: 5, step: 1, parse: Number, note: "0 = off" },
  { type: "range", key: "edgeEmit", label: "Edge emitters", min: 0, max: 4, step: 1, parse: Number, note: "0 = off" },
  { type: "checkbox", key: "cursorEmit", label: "Cursor emits fluid" },
  { cat: "Liquid Behavior" },
  { type: "range", key: "vorticity", label: "Swirl (vorticity)", min: 0, max: 20, step: 0.5, note: "0 = laminar" },
  { type: "range", key: "simSpeed", label: "Flow speed", min: 0.5, max: 2, step: 0.05 },
  { type: "range", key: "plumeSize", label: "Plume size", min: 1, max: 4, step: 1, parse: Number },
  { type: "range", key: "stirStrength", label: "Stir strength", min: 0.05, max: 0.5, step: 0.01, note: "objects push the fluid" },
  { type: "range", key: "objSpeed", label: "Launch speed", min: 0.5, max: 2, step: 0.05 },
  { type: "range", key: "objDrag", label: "Object drag", min: 0.01, max: 0.1, step: 0.005, note: "higher = shorter-lived" },
];

// Settings rework (2026-07-19, Brian): the gear now opens a general
// SETTINGS menu -- Data Source (runs-folder picker, native dialog in the
// desktop app) plus an entry that opens the Background Simulation panel
// as its own sub-page.
export async function buildSettings() {
  const panel = $("settings-panel");
  if (!panel) return;
  let cfgNow = { runs_dir: "(unavailable)" };
  try { cfgNow = await (await fetch("/api/config")).json(); } catch (e) {}
  const inDesktop = !!(window.pywebview && window.pywebview.api);
  let html = `<div class="settings-head">SETTINGS<button id="settings-close">✕</button></div>`;
  html += `<div class="settings-cat">Data Source</div>`;
  html += `<div class="set-row col"><div class="set-rowtop"><span>Training runs folder</span></div>` +
          `<input type="text" id="runs-dir-input" value="${cfgNow.runs_dir.replace(/"/g, "&quot;")}" spellcheck="false" style="width:100%">` +
          `<div class="set-rowtop" style="margin-top:6px">` +
          (inDesktop ? `<button id="runs-dir-browse">Browse…</button>` : `<span style="opacity:.6;font-size:11px">type a path (Browse needs the desktop app)</span>`) +
          `<button id="runs-dir-apply">Apply</button></div>` +
          `<div id="runs-dir-status" style="font-size:11px;opacity:.75;margin-top:4px"></div></div>`;
  html += `<div class="settings-cat">Display</div>`;
  html += `<div class="set-row"><span>Metric panels</span><button id="open-metric-settings">Open ›</button></div>`;
  html += `<label class="set-row"><span>Event marks <em style="opacity:.6;font-style:normal;font-size:10px">derived from the log + any events.jsonl; hover to name</em></span>` +
          `<input type="checkbox" id="evmarks-toggle" ${state.showEventMarks ? "checked" : ""}></label>`;
  html += `<label class="set-row"><span>Event-locked view <em style="opacity:.6;font-style:normal;font-size:10px">avg around marks — needs Event marks</em></span>` +
          `<input type="checkbox" id="evlock-toggle" ${state.eventLocked ? "checked" : ""} ${state.showEventMarks ? "" : "disabled"}></label>`;
  html += `<div class="settings-cat">Appearance</div>`;
  html += `<div class="set-row"><span>Background simulation</span><button id="open-bg-settings">Open ›</button></div>`;
  panel.innerHTML = html;
  $("settings-close").onclick = () => panel.classList.remove("open");
  $("open-metric-settings").onclick = () => buildMetricSettings();
  $("evmarks-toggle").addEventListener("change", (e) => {
    state.showEventMarks = e.target.checked;
    try { localStorage.setItem(EVMARKS_KEY, state.showEventMarks ? "1" : "0"); } catch (err) {}
    if (!state.showEventMarks && state.eventLocked) {   // locked view is meaningless without marks
      state.eventLocked = false;
      try { localStorage.setItem(EVLOCK_KEY, "0"); } catch (err) {}
    }
    buildSettings();
    if (state.current) { buildPanels(state.current.kind); refreshData(); }
  });
  $("evlock-toggle").addEventListener("change", (e) => {
    state.eventLocked = e.target.checked;
    try { localStorage.setItem(EVLOCK_KEY, state.eventLocked ? "1" : "0"); } catch (err) {}
    if (state.current) { buildPanels(state.current.kind); refreshData(); }
  });
  $("runs-dir-apply").onclick = async () => {
    const val = $("runs-dir-input").value.trim();
    const st = $("runs-dir-status");
    st.textContent = "applying…";
    try {
      const resp = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs_dir: val }),
      });
      const data = await resp.json();
      if (!resp.ok) { st.textContent = "✗ " + (data.detail || "invalid folder"); return; }
      st.textContent = `✓ ${data.streams_found} stream(s) found` + (data.persisted ? " · saved" : "");
      loadStreams();
    } catch (e) { st.textContent = "✗ " + e; }
  };
  const browse = $("runs-dir-browse");
  if (browse) browse.onclick = async () => {
    try {
      const picked = await window.pywebview.api.pick_folder();
      if (picked) { $("runs-dir-input").value = picked; $("runs-dir-apply").click(); }
    } catch (e) { $("runs-dir-status").textContent = "✗ " + e; }
  };
  $("open-bg-settings").onclick = () => buildBgSettings();
}

// Metric selection sub-page: every category/panel/metric in GROUPS, with a
// master checkbox per category. Deselecting hides a metric even when its data
// exists; panels with no data auto-hide regardless (so most of the universal
// catalog is invisible until a run actually emits those keys).
export function buildMetricSettings() {
  const panel = $("settings-panel");
  if (!panel) return;
  const KIND_LABEL = { training: "Training", cognition: "Cognition" };
  // Tracked-dots per metric: rendered as empty placeholders here and filled by
  // updateMetricDots(), which re-runs on every data refresh. They used to be
  // baked into this HTML at open time — a snapshot of whichever stream
  // happened to be loaded, never updated, and never saying which stream it
  // described. Metrics then read as "tracked" that the run being watched
  // doesn't emit, and vice versa (Brian's report, 2026-08-14).
  let html = `<div class="settings-head"><button id="settings-back" title="back">‹</button>METRIC PANELS<button id="settings-close">✕</button></div>`;
  html += `<div class="set-note">Unchecked metrics stay hidden even when present in the stream. Panels whose data is absent from the current stream auto-hide — turn on the switch below to render them anyway as empty shells. Dots describe the loaded stream (<b id="dot-stream">none</b>): a pulsing green dot = data in its recent records (actively tracked now); a dim dot = present earlier in its history but not recently.</div>`;
  html += `<label class="set-row"><span>Show panels without data</span><input type="checkbox" id="show-empty-panels" ${state.showEmptyPanels ? "checked" : ""}></label>`;
  html += `<div id="uncat-keys"></div>`;
  for (const kind in GROUPS) {
    html += `<div class="settings-cat">${KIND_LABEL[kind] || kind} metrics</div>`;
    for (const grp of GROUPS[kind].groups) {
      const ids = grp.panels.flatMap((p) => p.type === "heatmap"
        ? [metricId(kind, grp.title, p.title, "*")]
        : p.series.map((s) => metricId(kind, grp.title, p.title, s.label)));
      const on = ids.filter(metricEnabled).length;
      html += `<div class="set-group"><label class="set-group-head">` +
        `<input type="checkbox" class="cat-master" data-kind="${kind}" data-group="${grp.title}"` +
        ` ${on === ids.length ? "checked" : ""} ${on > 0 && on < ids.length ? "data-mixed=1" : ""}>` +
        `<b>${grp.title}</b></label></div>`;
      for (const p of grp.panels) {
        if (p.type === "heatmap") {
          const id = metricId(kind, grp.title, p.title, "*");
          const esc = id.replace(/"/g, "&quot;");
          html += `<label class="set-metric"><input type="checkbox" data-mid="${esc}"` +
            ` ${metricEnabled(id) ? "checked" : ""}><span><span class="m-dot" data-dot="${esc}"></span>${p.title}</span><em>heatmap</em></label>`;
        } else {
          for (const s of p.series) {
            const id = metricId(kind, grp.title, p.title, s.label);
            const esc = id.replace(/"/g, "&quot;");
            html += `<label class="set-metric"><input type="checkbox" data-mid="${esc}"` +
              ` ${metricEnabled(id) ? "checked" : ""}><span><span class="m-dot" data-dot="${esc}"></span>${s.label}</span><em>${p.title}</em></label>`;
          }
        }
      }
    }
  }
  panel.innerHTML = html;
  panel.querySelectorAll(".cat-master[data-mixed]").forEach((el) => { el.indeterminate = true; });
  // same explanations as the dashboard panels, on the metric rows here
  panel.querySelectorAll(".set-metric").forEach((row) => {
    const box = row.querySelector("[data-mid]");
    if (!box) return;
    const [, group, panelTitle] = box.dataset.mid.split("|");
    const desc = PANEL_DESCS[`${group}|${panelTitle}`];
    if (desc) attachDesc(row, desc);
  });
  const rebuild = () => { if (state.current) { buildPanels(state.current.kind); refreshData(); } };
  $("show-empty-panels").addEventListener("change", (e) => {
    state.showEmptyPanels = e.target.checked;
    try { localStorage.setItem(SHOW_EMPTY_KEY, state.showEmptyPanels ? "1" : "0"); } catch (err) {}
    rebuild();
  });
  panel.querySelectorAll("[data-mid]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.mid;
      if (el.checked) disabledMetrics.delete(id); else disabledMetrics.add(id);
      saveDisabledMetrics(); rebuild();
      // keep the category master's state honest without a full re-render
      const [kind, group] = id.split("|");
      const master = panel.querySelector(`.cat-master[data-kind="${kind}"][data-group="${group}"]`);
      if (master) {
        const boxes = [...panel.querySelectorAll("[data-mid]")].filter((b) => b.dataset.mid.startsWith(`${kind}|${group}|`));
        const on = boxes.filter((b) => b.checked).length;
        master.checked = on === boxes.length;
        master.indeterminate = on > 0 && on < boxes.length;
      }
    });
  });
  panel.querySelectorAll(".cat-master").forEach((el) => {
    el.addEventListener("change", () => {
      const { kind, group } = el.dataset;
      el.indeterminate = false;
      panel.querySelectorAll("[data-mid]").forEach((b) => {
        if (!b.dataset.mid.startsWith(`${kind}|${group}|`)) return;
        b.checked = el.checked;
        if (el.checked) disabledMetrics.delete(b.dataset.mid); else disabledMetrics.add(b.dataset.mid);
      });
      saveDisabledMetrics(); rebuild();
    });
  });
  $("settings-back").onclick = () => buildSettings();
  $("settings-close").onclick = () => panel.classList.remove("open");
  updateMetricDots();
}

export function buildBgSettings() {
  const panel = $("settings-panel");
  if (!panel || !window.LuthiBG) return;
  const cfg = window.LuthiBG.cfg;
  let html = `<div class="settings-head"><button id="settings-back" title="back">‹</button>BACKGROUND<button id="settings-close">✕</button></div>`;
  for (const it of SETTINGS_SCHEMA) {
    if (it.cat) { html += `<div class="settings-cat">${it.cat}</div>`; continue; }
    const val = cfg[it.key];
    if (it.type === "checkbox") {
      html += `<label class="set-row"><span>${it.label}</span><input type="checkbox" data-key="${it.key}" ${val ? "checked" : ""}></label>`;
    } else if (it.type === "select") {
      const opts = it.options.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${l}</option>`).join("");
      html += `<label class="set-row"><span>${it.label}</span><select data-key="${it.key}">${opts}</select></label>`;
    } else if (it.type === "range") {
      html += `<div class="set-row col"><div class="set-rowtop"><span>${it.label}${it.note ? ` <em>${it.note}</em>` : ""}</span><b data-val="${it.key}">${val}</b></div>` +
              `<input type="range" data-key="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}" value="${val}"></div>`;
    }
  }
  panel.innerHTML = html;
  $("settings-back").onclick = () => buildSettings();
  panel.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.dataset.key;
    const meta = SETTINGS_SCHEMA.find((s) => s.key === key);
    const apply = () => {
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (el.type === "range") v = meta.parse ? meta.parse(el.value) : parseFloat(el.value);
      else v = meta.parse ? meta.parse(el.value) : el.value;
      window.LuthiBG.set(key, v);
      const disp = panel.querySelector(`[data-val="${key}"]`);
      if (disp) disp.textContent = v;
    };
    el.addEventListener(el.type === "range" ? "input" : "change", apply);
  });
  $("settings-close").onclick = () => panel.classList.remove("open");
}

// collapsible streams rail (Brian, 2026-07-25): slides into the window edge —
// not an overlay like settings — with the LuthiWorks logo staying in the corner.
export const SIDEBAR_KEY = "luthiscope.sidebarCollapsed";
export const sideEl = $("sidebar"), sideBtn = $("sidebar-toggle");
export function applySidebar(collapsed) {
  sideEl.classList.toggle("collapsed", collapsed);
  if (sideBtn) {
    sideBtn.textContent = collapsed ? "⟩" : "⟨";
    sideBtn.title = collapsed ? "Expand streams panel" : "Collapse streams panel";
  }
  setTimeout(fitCharts, 240);   // charts take over the freed width after the slide
}
if (sideBtn && sideEl) {
  sideBtn.onclick = () => {
    const c = !sideEl.classList.contains("collapsed");
    try { localStorage.setItem(SIDEBAR_KEY, c ? "1" : "0"); } catch (e) {}
    applySidebar(c);
  };
  try { if (localStorage.getItem(SIDEBAR_KEY) === "1") applySidebar(true); } catch (e) {}
}
