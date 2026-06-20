"use strict";

// identity palette for distinguishing series (bright on white)
const C = {
  blue: "#3b82f6", teal: "#22d3ee", green: "#22c55e",
  purple: "#a78bfa", orange: "#fb923c", red: "#f87171", gray: "#94a3b8",
};

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// each series declares which direction is "healthy" so momentum can be colored
// (good: "up" | "down" | null). null = no health claim (ambiguous metric).
// Grouped metric config. Panels whose series have no data are auto-hidden, so the
// "(when emitted)" panels below appear automatically once the producer starts
// emitting those fields (see the shortlist in the metrics discussion).
const GROUPS = {
  training: {
    x: (r) => num(r.step),
    xlabel: "step",
    groups: [
      { title: "Learning", panels: [
        { title: "LOSS", series: [
          { label: "loss", color: C.blue, good: "down", get: (r) => num(r.loss) },
          { label: "l_pred", color: C.teal, good: "down", get: (r) => num(r.l_pred) },
          { label: "l_sigreg", color: C.purple, good: "down", get: (r) => num(r.l_sigreg) },
        ]},
        { title: "VALIDATION / PROBE (when emitted)", series: [
          { label: "val_loss", color: C.blue, good: "down", get: (r) => num(r.val_loss) },
          { label: "probe_acc", color: C.green, good: "up", get: (r) => num(r.probe_acc) },
        ]},
      ]},
      { title: "Optimization", panels: [
        { title: "GRADIENT NORM (when emitted)", series: [
          { label: "grad_norm", color: C.orange, good: null, get: (r) => num(r.grad_norm) },
        ]},
        { title: "LEARNING RATE (when emitted)", series: [
          { label: "lr", color: C.teal, good: null, get: (r) => num(r.lr) },
        ]},
      ]},
      { title: "Substrate vitality", panels: [
        { title: "SUBSTRATE PULSE", series: [
          { label: "pred_frob", color: C.green, good: "up", get: (r) => num(r.substrate?.pred_frob) },
          { label: "err_acc", color: C.orange, good: "down", get: (r) => num(r.substrate?.err_acc) },
        ]},
        { title: "DRIFT & PLASTICITY (when emitted)", series: [
          { label: "set_point_drift", color: C.purple, good: null, get: (r) => num(r.substrate?.set_point_drift) },
          { label: "update_rate", color: C.teal, good: null, get: (r) => num(r.substrate?.update_ema_mean) },
        ]},
        { title: "PRECISION (when emitted)", series: [
          { label: "precision", color: C.blue, good: null, get: (r) => num(r.substrate?.precision_mean) },
        ]},
      ]},
      { title: "Representation", panels: [
        { title: "VITALITY · ENCODER STD / PREDICTOR-TRIVIAL COSINE", series: [
          { label: "std_p5", color: C.green, good: "up", get: (r) => num(r.light?.online_std_p5) },
          { label: "std_p50", color: C.teal, good: "up", get: (r) => num(r.light?.online_std_p50) },
          { label: "std_p95", color: C.gray, good: "up", get: (r) => num(r.light?.online_std_p95) },
          { label: "triv_cos", color: C.red, good: "down", get: (r) => num(r.light?.predictor_trivial_cosine_mean) },
        ]},
        { title: "DIMENSION · RANK (deep cadence — sparse)", sparse: true, series: [
          { label: "eff_rank", color: C.blue, good: "up", get: (r) => num(r.deep?.effective_rank) },
          { label: "stable_rank", color: C.purple, good: "up", get: (r) => num(r.deep?.stable_rank) },
        ]},
      ]},
      { title: "Throughput", panels: [
        { title: "TOKENS CONSUMED", series: [
          { label: "tokens", color: C.green, good: "up", get: (r) => {
            const t = r.tokens_consumed; if (!t) return null;
            let s = 0; for (const k in t) { if (typeof t[k] === "number") s += t[k]; } return s;
          } },
        ]},
        { title: "ELAPSED (hours)", series: [
          { label: "elapsed_h", color: C.gray, good: null, get: (r) => num(r.elapsed_seconds) == null ? null : r.elapsed_seconds / 3600 },
        ]},
      ]},
    ],
  },
  cognition: {
    x: (r) => num(r.cycle),
    xlabel: "cycle",
    groups: [
      { title: "Internal state", panels: [
        { title: "PRECISION & VALUE (active-inference correlates)", series: [
          { label: "v_s", color: C.green, good: "up", get: (r) => num(r.v_s) },
          { label: "gamma", color: C.purple, good: null, get: (r) => num(r.gamma) },
        ]},
        { title: "EXPECTED FREE ENERGY · affect-adjacent (lower = better)", series: [
          { label: "total", color: C.blue, good: "down", get: (r) => num(r.efe_breakdown?.total) },
          { label: "engagement", color: C.teal, good: "down", get: (r) => num(r.efe_breakdown?.engagement_cost) },
          { label: "coherence", color: C.purple, good: "down", get: (r) => num(r.efe_breakdown?.coherence_cost) },
          { label: "connection", color: C.orange, good: "down", get: (r) => num(r.efe_breakdown?.connection_cost) },
          { label: "truthfulness", color: C.green, good: "down", get: (r) => num(r.efe_breakdown?.truthfulness_cost) },
        ]},
      ]},
      { title: "Dynamics", panels: [
        { title: "PLASTICITY PULSE · ||Δθ||", series: [
          { label: "delta_theta", color: C.teal, good: null, get: (r) => num(r.delta_theta_norm) },
        ]},
        { title: "MUTUAL INFORMATION + BAND", series: [
          { label: "mi", color: C.green, good: "up", get: (r) => num(r.mi_probe?.mi_latest) },
          { label: "band_lo", color: C.gray, good: null, get: (r) => num(r.mi_probe?.mi_band_lower) },
          { label: "band_hi", color: C.gray, good: null, get: (r) => num(r.mi_probe?.mi_band_upper) },
        ]},
        { title: "BEST-ACTION VALUE · r_best", series: [
          { label: "r_best", color: C.blue, good: "up", get: (r) => num(r.r_best) },
        ]},
      ]},
    ],
  },
};

function f2(v){ return v==null?"--":Number(v).toFixed(2); }
function f3(v){ return v==null?"--":Number(v).toFixed(3); }
function f4(v){ return v==null?"--":Number(v).toFixed(4); }

function g(v){
  if (v==null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(+v.toPrecision(4));
}
function gint(v){ return v==null?"--":(Number.isInteger(v)?String(v):String(+v.toPrecision(6))); }

function seriesStats(ys){
  const v = ys.filter((y) => y != null && isFinite(y));
  if (!v.length) return null;
  let min = v[0], max = v[0], sum = 0;
  for (const y of v) { if (y < min) min = y; if (y > max) max = y; sum += y; }
  const mean = sum / v.length;
  let varr = 0; for (const y of v) varr += (y - mean) ** 2;
  const start = v[0], end = v[v.length - 1];
  const dpct = start !== 0 ? ((end - start) / Math.abs(start)) * 100 : null;
  return { start, end, min, max, range: max - min, std: Math.sqrt(varr / v.length), dpct, n: v.length };
}

// polarity-aware health/momentum: blue(opt) green(good) yellow(warn) orange(near) red(bad)
function momentumClass(st, good){
  if (!st || st.dpct == null || good == null) return "neutral";
  const improving = good === "up" ? st.end > st.start : st.end < st.start;
  const m = Math.abs(st.dpct);
  if (improving) return m >= 10 ? "opt" : "good";
  if (m < 5) return "warn";
  if (m < 15) return "near";
  return "bad";
}

// ---- app state ----
let records = [];
let charts = [];
let current = null;
let ws = null;
let groupSeries = {};   // group title -> flat list of its visible series

const $ = (id) => document.getElementById(id);

function setConn(state, text) {
  const el = $("conn");
  el.className = "conn " + state;
  el.textContent = "● " + text;
}

function axisStyle() {
  return {
    stroke: "#8492a8",
    grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
    ticks: { stroke: "rgba(255,255,255,0.10)", width: 1 },
    font: "11px monospace",
  };
}

function tooltipPlugin(xlabel) {
  let tip;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "u-tip";
        tip.style.display = "none";
        u.over.appendChild(tip);
        u.over.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      },
      setCursor: (u) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0) { tip.style.display = "none"; return; }
        const xv = u.data[0][idx];
        let html = `<div class="u-tip-x">${xlabel} ${gint(xv)}</div>`;
        for (let si = 1; si < u.series.length; si++) {
          const s = u.series[si];
          const v = u.data[si][idx];
          html += `<div class="u-tip-row"><span class="u-tip-dot" style="background:${s.stroke}"></span>` +
                  `${s.label}: <b>${v == null ? "--" : g(v)}</b></div>`;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let lx = left + 14, ty = top + 14;
        if (lx + tw > u.over.clientWidth) lx = left - tw - 14;
        if (ty + th > u.over.clientHeight) ty = top - th - 14;
        tip.style.left = Math.max(0, lx) + "px";
        tip.style.top = Math.max(0, ty) + "px";
      },
    },
  };
}

function makeChart(mountEl, spec, xlabel, widthPx) {
  const series = [{}].concat(
    spec.series.map((s) => ({
      label: s.label,
      stroke: s.color,
      width: 1.8,
      points: { show: !!spec.sparse, size: 6, stroke: s.color, fill: s.color },
    }))
  );
  const opts = {
    width: widthPx,
    height: 200,
    scales: { x: { time: false } },
    axes: [Object.assign(axisStyle(), { label: xlabel }), axisStyle()],
    series,
    legend: { show: false },
    cursor: { points: { size: 7 } },
    plugins: [tooltipPlugin(xlabel)],
  };
  return new uPlot(opts, [[]].concat(spec.series.map(() => [])), mountEl);
}

function panelHasData(spec) {
  return spec.series.some((s) => records.some((r) => s.get(r) != null));
}

function buildPanels(kind) {
  const cfg = GROUPS[kind];
  const host = $("panels");
  host.innerHTML = "";
  charts.forEach((c) => c.u.destroy());
  charts = [];
  groupSeries = {};
  const width = panelWidth();
  const visibleTitles = [];
  for (const grp of cfg.groups) {
    const panels = grp.panels.filter(panelHasData);
    if (!panels.length) continue;            // hide empty groups (no data yet)
    visibleTitles.push(grp.title);
    groupSeries[grp.title] = panels.flatMap((p) => p.series);

    const section = document.createElement("section");
    section.className = "group";
    section.dataset.group = grp.title;
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span class="group-dot neutral" data-dot="${grp.title}"></span>` +
      `<span class="group-title">${grp.title}</span><span class="group-chev">▾</span>`;
    head.onclick = () => section.classList.toggle("collapsed");
    section.appendChild(head);

    const body = document.createElement("div");
    body.className = "group-body panels-grid";
    for (const spec of panels) {
      const panel = document.createElement("div"); panel.className = "panel";
      const title = document.createElement("div"); title.className = "panel-title"; title.textContent = spec.title;
      panel.appendChild(title);
      const chartHost = document.createElement("div"); panel.appendChild(chartHost);
      const readoutEl = document.createElement("div"); readoutEl.className = "panel-readout"; panel.appendChild(readoutEl);
      body.appendChild(panel);
      const u = makeChart(chartHost, spec, cfg.xlabel, width);
      charts.push({ u, spec, readoutEl, group: grp.title });
    }
    section.appendChild(body);
    host.appendChild(section);
  }
  buildVitals(visibleTitles);
}

function buildVitals(groupTitles) {
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

function panelWidth() {
  const host = $("panels");
  const w = host.clientWidth;
  const cols = Math.max(1, Math.floor(w / 480));
  return Math.floor(w / cols) - 26;
}

function refreshData() {
  const cfg = GROUPS[current.kind];
  const pts = records.filter((r) => cfg.x(r) != null);
  const xs = pts.map(cfg.x);
  for (const { u, spec, readoutEl } of charts) {
    const seriesData = spec.series.map((s) => pts.map(s.get));
    u.setData([xs].concat(seriesData));
    renderReadout(readoutEl, spec, seriesData);
  }
  updateOverview();
}

function renderReadout(el, spec, seriesData) {
  let html = "";
  spec.series.forEach((s, i) => {
    const st = seriesStats(seriesData[i]);
    if (!st) {
      html += `<div class="ro-row"><span class="ro-dot" style="background:${s.color}"></span>` +
              `<span class="ro-label">${s.label}</span><span class="ro-prog">no data</span>` +
              `<span></span><span></span></div>`;
      return;
    }
    const arrow = st.end > st.start ? "▲" : (st.end < st.start ? "▼" : "–");
    const cls = momentumClass(st, s.good);
    const dtxt = st.dpct == null ? arrow
      : `${arrow} ${st.dpct >= 0 ? "+" : ""}${st.dpct.toFixed(1)}%`;
    html +=
      `<div class="ro-row">` +
        `<span class="ro-dot" style="background:${s.color}"></span>` +
        `<span class="ro-label">${s.label}</span>` +
        `<span class="ro-prog"><b>${g(st.start)}</b> → <b>${g(st.end)}</b></span>` +
        `<span class="ro-delta ${cls}">${dtxt}</span>` +
        `<span class="ro-spread">min ${g(st.min)} · max ${g(st.max)} · σ ${g(st.std)} · rng ${g(st.range)}</span>` +
      `</div>`;
  });
  el.innerHTML = html;
}

const HEALTH_ORDER = { neutral: 0, opt: 1, good: 1, warn: 2, near: 3, bad: 4 };

// recompute the per-group health tiles, group dots, and "needs attention" bar
function updateOverview() {
  const flagged = [];
  for (const title in groupSeries) {
    let worst = "neutral", worstRank = 0, headline = null, headlineSet = false;
    for (const s of groupSeries[title]) {
      const st = seriesStats(records.map(s.get));
      if (!headlineSet && st) { headline = st.end; headlineSet = true; }
      const cls = momentumClass(st, s.good);
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

function renderAttention(flagged) {
  const el = $("attention");
  if (!el) return;
  if (!flagged.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "";
  const rank = { warn: 1, near: 2, bad: 3 };
  flagged.sort((a, b) => rank[b.cls] - rank[a.cls]);
  el.innerHTML = `<span class="att-head">⚠ NEEDS ATTENTION</span>` +
    flagged.map((f) => `<span class="att-item ${f.cls}">${f.group} · ${f.label}` +
      (f.st && f.st.dpct != null ? ` ${f.st.dpct >= 0 ? "+" : ""}${f.st.dpct.toFixed(1)}%` : "") + `</span>`).join("");
}

async function loadStreams() {
  const list = $("stream-list");
  list.innerHTML = "<li class='s-meta'>scanning…</li>";
  let streams = [];
  try {
    streams = await (await fetch("/api/streams")).json();
  } catch (e) {
    list.innerHTML = "<li class='s-meta'>backend unreachable</li>";
    return;
  }
  list.innerHTML = "";
  if (!streams.length) {
    list.innerHTML = "<li class='s-meta'>no streams found in runs dir</li>";
    return;
  }
  for (const s of streams) {
    const li = document.createElement("li");
    li.innerHTML =
      `<div class="s-name">${s.run_dir}<span class="kind-tag kind-${s.kind}">${s.kind}</span></div>` +
      `<div class="s-meta">${s.n_records} records</div>`;
    li.onclick = () => selectStream(s.id, s.kind, li);
    list.appendChild(li);
  }
}

async function selectStream(id, kind, li) {
  document.querySelectorAll("#stream-list li").forEach((el) => el.classList.remove("active"));
  if (li) li.classList.add("active");
  current = { id, kind };
  if (ws) { ws.close(); ws = null; }

  $("now-line").innerHTML = `loading <b>${id}</b> …`;
  const resp = await (await fetch(`/api/streams/${id}/records`)).json();
  records = resp.records || [];
  buildPanels(kind);
  refreshData();
  $("now-line").innerHTML = `<b>${id}</b> · ${records.length} records · ${kind}`;
  setConn("online", "LOADED");
  openLive(id);
}

function openLive(id) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/streams/${id}`);
  ws.onopen = () => setConn("live", "LIVE");
  ws.onclose = () => setConn("offline", "OFFLINE");
  ws.onerror = () => setConn("offline", "OFFLINE");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.records && msg.records.length) {
      records = records.concat(msg.records);
      refreshData();
      $("now-line").innerHTML = `<b>${id}</b> · ${records.length} records · ${current.kind} · live`;
    }
  };
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = panelWidth();
    charts.forEach((c) => c.u.setSize({ width: w, height: 200 }));
  }, 120);
});

// ---- settings panel ----
const SETTINGS_SCHEMA = [
  { cat: "Background Simulation" },
  { type: "checkbox", key: "enabled", label: "Enabled" },
  { type: "select", key: "quality", label: "Quality", parse: Number,
    options: [["64", "Low"], ["96", "Medium"], ["128", "High"]] },
  { type: "select", key: "palette", label: "Palette",
    options: [["aurora", "Aurora"], ["ember", "Ember"], ["ice", "Ice"], ["spectrum", "Spectrum"], ["mono", "Mono"]] },
  { type: "range", key: "intensity", label: "Intensity", min: 0.3, max: 2, step: 0.1 },
  { type: "range", key: "trail", label: "Trail length", min: 0.95, max: 0.996, step: 0.002 },
  { type: "range", key: "clickCount", label: "Objects per click", min: 1, max: 5, step: 1, parse: Number },
  { type: "range", key: "autoObjects", label: "Continuous objects", min: 0, max: 5, step: 1, parse: Number, note: "0 = off" },
  { type: "range", key: "edgeEmit", label: "Edge emitters", min: 0, max: 4, step: 1, parse: Number, note: "0 = off" },
  { type: "checkbox", key: "cursorEmit", label: "Cursor emits fluid" },
];

function buildSettings() {
  const panel = $("settings-panel");
  if (!panel || !window.LuthiBG) return;
  const cfg = window.LuthiBG.cfg;
  let html = `<div class="settings-head">SETTINGS<button id="settings-close">✕</button></div>`;
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

$("refresh").onclick = loadStreams;
const bgBtn = $("bg-toggle");
if (bgBtn) bgBtn.onclick = () => {
  const on = window.LuthiBG ? window.LuthiBG.toggle() : false;
  bgBtn.style.color = on ? "" : "var(--ink-faint)";
};
const sBtn = $("settings-btn");
if (sBtn) sBtn.onclick = () => {
  const panel = $("settings-panel");
  if (!panel.classList.contains("open")) buildSettings();
  panel.classList.toggle("open");
};
loadStreams();
