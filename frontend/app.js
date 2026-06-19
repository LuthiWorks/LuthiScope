"use strict";

// ---- palette (mirrors styles.css) ----
const C = {
  green: "#39ff9e", cyan: "#2ee6d6", amber: "#ffb000",
  violet: "#b08cff", red: "#ff5a6a", dim: "#4a7d72",
};

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// ---- per-patient panel + stat configuration ----
const PANELS = {
  training: {
    x: (r) => num(r.step),
    xlabel: "step",
    stats: [
      { k: "STEP", get: (r) => r.step, fmt: (v) => v, glow: true },
      { k: "LOSS", get: (r) => r.loss, fmt: f3 },
      { k: "STD p5", get: (r) => r.light?.online_std_p5, fmt: f3 },
      { k: "PRED_FROB", get: (r) => r.substrate?.pred_frob, fmt: f3 },
      { k: "EFF_RANK", get: (r) => r.deep?.effective_rank, fmt: f2 },
      { k: "ELAPSED h", get: (r) => (r.elapsed_seconds ?? null), fmt: (v) => v == null ? "--" : (v / 3600).toFixed(2), dim: true },
    ],
    panels: [
      { title: "LOSS", series: [
        { label: "loss", color: C.green, get: (r) => num(r.loss) },
        { label: "l_pred", color: C.cyan, get: (r) => num(r.l_pred) },
        { label: "l_sigreg", color: C.amber, get: (r) => num(r.l_sigreg) },
      ]},
      { title: "VITALITY · ENCODER STD / PREDICTOR-TRIVIAL COSINE", series: [
        { label: "std_p5", color: C.green, get: (r) => num(r.light?.online_std_p5) },
        { label: "std_p50", color: C.cyan, get: (r) => num(r.light?.online_std_p50) },
        { label: "std_p95", color: C.dim, get: (r) => num(r.light?.online_std_p95) },
        { label: "triv_cos", color: C.red, get: (r) => num(r.light?.predictor_trivial_cosine_mean) },
      ]},
      { title: "SUBSTRATE PULSE", series: [
        { label: "pred_frob", color: C.green, get: (r) => num(r.substrate?.pred_frob) },
        { label: "err_acc", color: C.amber, get: (r) => num(r.substrate?.err_acc) },
      ]},
      { title: "DIMENSION · RANK (deep cadence — sparse)", sparse: true, series: [
        { label: "eff_rank", color: C.cyan, get: (r) => num(r.deep?.effective_rank) },
        { label: "stable_rank", color: C.violet, get: (r) => num(r.deep?.stable_rank) },
      ]},
    ],
  },
  cognition: {
    x: (r) => num(r.cycle),
    xlabel: "cycle",
    stats: [
      { k: "CYCLE", get: (r) => r.cycle, fmt: (v) => v, glow: true },
      { k: "GAMMA", get: (r) => r.gamma, fmt: f3 },
      { k: "V(s)", get: (r) => r.v_s, fmt: f3 },
      { k: "||Δθ||", get: (r) => r.delta_theta_norm, fmt: f4 },
      { k: "MI", get: (r) => r.mi_probe?.mi_latest, fmt: f3 },
      { k: "REST", get: (r) => r.rest_selected, fmt: (v) => (v ? "YES" : "no"), dim: true },
    ],
    panels: [
      { title: "VALUE / PRECISION", series: [
        { label: "v_s", color: C.green, get: (r) => num(r.v_s) },
        { label: "gamma", color: C.amber, get: (r) => num(r.gamma) },
      ]},
      { title: "PLASTICITY PULSE · ||Δθ||", series: [
        { label: "delta_theta", color: C.cyan, get: (r) => num(r.delta_theta_norm) },
      ]},
      { title: "MUTUAL INFORMATION + BAND", series: [
        { label: "mi", color: C.green, get: (r) => num(r.mi_probe?.mi_latest) },
        { label: "band_lo", color: C.dim, get: (r) => num(r.mi_probe?.mi_band_lower) },
        { label: "band_hi", color: C.dim, get: (r) => num(r.mi_probe?.mi_band_upper) },
      ]},
      { title: "BEST-ACTION VALUE · r_best", series: [
        { label: "r_best", color: C.violet, get: (r) => num(r.r_best) },
      ]},
    ],
  },
};

function f2(v){ return v==null?"--":Number(v).toFixed(2); }
function f3(v){ return v==null?"--":Number(v).toFixed(3); }
function f4(v){ return v==null?"--":Number(v).toFixed(4); }

// compact number for tooltip + readout
function g(v){
  if (v==null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(+v.toPrecision(4));
}
function gint(v){ return v==null?"--":(Number.isInteger(v)?String(v):String(+v.toPrecision(6))); }

// summary statistics for a series (nulls ignored)
function seriesStats(ys){
  const v = ys.filter((y) => y != null && isFinite(y));
  if (!v.length) return null;
  let min = v[0], max = v[0], sum = 0;
  for (const y of v) { if (y < min) min = y; if (y > max) max = y; sum += y; }
  const mean = sum / v.length;
  let varr = 0; for (const y of v) varr += (y - mean) ** 2;
  const std = Math.sqrt(varr / v.length);
  const start = v[0], end = v[v.length - 1];
  const dpct = start !== 0 ? ((end - start) / Math.abs(start)) * 100 : null;
  return { start, end, min, max, range: max - min, std, dpct, n: v.length };
}

// ---- app state ----
let records = [];
let charts = [];        // {u, spec}
let current = null;     // {id, kind}
let ws = null;

const $ = (id) => document.getElementById(id);

function setConn(state, text) {
  const el = $("conn");
  el.className = "conn " + state;
  el.textContent = "● " + text;
}

// ---- charts ----
function axisStyle() {
  return {
    stroke: C.dim,
    grid: { stroke: "#11201f", width: 1 },
    ticks: { stroke: "#11201f", width: 1 },
    font: "11px monospace",
  };
}

// tooltip that follows the cursor, showing each series value at the hovered x
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
      width: 1.6,
      points: { show: !!spec.sparse, size: 5, stroke: s.color, fill: s.color },
    }))
  );
  const opts = {
    width: widthPx,
    height: 200,
    scales: { x: { time: false } },
    axes: [
      Object.assign(axisStyle(), { label: xlabel }),
      axisStyle(),
    ],
    series,
    legend: { show: false },   // replaced by cursor tooltip + progression readout
    cursor: { points: { size: 7 } },
    plugins: [tooltipPlugin(xlabel)],
  };
  return new uPlot(opts, [[]].concat(spec.series.map(() => [])), mountEl);
}

function buildPanels(kind) {
  const cfg = PANELS[kind];
  const host = $("panels");
  host.innerHTML = "";
  charts.forEach((c) => c.u.destroy());
  charts = [];
  const width = panelWidth();
  for (const spec of cfg.panels) {
    const panel = document.createElement("div");
    panel.className = "panel";
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = spec.title;
    panel.appendChild(title);
    const chartHost = document.createElement("div");
    panel.appendChild(chartHost);
    const readoutEl = document.createElement("div");
    readoutEl.className = "panel-readout";
    panel.appendChild(readoutEl);
    host.appendChild(panel);
    const u = makeChart(chartHost, spec, cfg.xlabel, width);
    charts.push({ u, spec, readoutEl });
  }
}

function panelWidth() {
  // panels grid columns are minmax(440, 1fr); approximate the column width.
  const host = $("panels");
  const w = host.clientWidth;
  const cols = Math.max(1, Math.floor(w / 460));
  return Math.floor(w / cols) - 24;
}

function refreshData() {
  const cfg = PANELS[current.kind];
  // only records with a finite x participate (x must be sorted numeric for uPlot)
  const pts = records.filter((r) => cfg.x(r) != null);
  const xs = pts.map(cfg.x);
  for (const { u, spec, readoutEl } of charts) {
    const seriesData = spec.series.map((s) => pts.map(s.get));
    u.setData([xs].concat(seriesData));
    renderReadout(readoutEl, spec, seriesData);
  }
  renderStats(cfg);
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
    const dir = st.end > st.start ? "up" : (st.end < st.start ? "down" : "flat");
    const arrow = dir === "up" ? "▲" : (dir === "down" ? "▼" : "–");
    const dtxt = st.dpct == null ? arrow
      : `${arrow} ${st.dpct >= 0 ? "+" : ""}${st.dpct.toFixed(1)}%`;
    html +=
      `<div class="ro-row">` +
        `<span class="ro-dot" style="background:${s.color}"></span>` +
        `<span class="ro-label">${s.label}</span>` +
        `<span class="ro-prog"><b>${g(st.start)}</b> → <b>${g(st.end)}</b></span>` +
        `<span class="ro-delta ${dir}">${dtxt}</span>` +
        `<span class="ro-spread">min ${g(st.min)} · max ${g(st.max)} · σ ${g(st.std)} · rng ${g(st.range)}</span>` +
      `</div>`;
  });
  el.innerHTML = html;
}

function renderStats(cfg) {
  const strip = $("statstrip");
  strip.innerHTML = "";
  const last = records.length ? records[records.length - 1] : null;
  for (const st of cfg.stats) {
    const raw = last ? st.get(last) : null;
    const cell = document.createElement("div");
    cell.className = "stat";
    const cls = st.dim ? "v dim" : "v";
    cell.innerHTML = `<div class="k">${st.k}</div><div class="${cls}">${last ? st.fmt(raw) : "--"}</div>`;
    strip.appendChild(cell);
  }
}

// ---- streams ----
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
    li.dataset.id = s.id;
    li.dataset.kind = s.kind;
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

// ---- resize ----
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = panelWidth();
    charts.forEach((c) => c.u.setSize({ width: w, height: 200 }));
  }, 120);
});

// ---- boot ----
$("refresh").onclick = loadStreams;
loadStreams();
