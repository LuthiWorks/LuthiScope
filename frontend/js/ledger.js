import { state } from './state.js';
import { axisStyle, dragPanPlugin, heatColor, tooltipPlugin, wheelZoomPlugin } from './charts.js';
import { attachDesc } from './descriptions.js';
import { fitCharts, toggleMaximize } from './panels.js';
import { updateOverview } from './readout.js';
import { $, C, gint, num } from './utils.js';

// Trust-ledger window (dimension-level trust history). Split from app.js 2026-09-29.


// ---- trust-ledger window (Brian, 2026-07-26): a separate full view that
// replaces the monitor — dimension-level trust history from harvested
// checkpoint snapshots, investigable without the other panels' distraction.
export function rankCorr(a, b) {
  const n = a.length;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    idx.forEach((p, i) => { r[p[1]] = i; });
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const m = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - m, y = rb[i] - m;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function ledgerPanel(host, title, desc, expandable = true) {
  const panel = document.createElement("div"); panel.className = "panel";
  const t = document.createElement("div"); t.className = "panel-title";
  if (desc) attachDesc(t, desc);
  const span = document.createElement("span"); span.textContent = title;
  t.appendChild(span);
  let expand = null;
  if (expandable) {   // tables have nothing to enlarge
    expand = document.createElement("button");
    expand.className = "panel-expand"; expand.title = "Enlarge"; expand.textContent = "⤢";
    t.appendChild(expand);
  }
  panel.appendChild(t);
  const body = document.createElement("div"); panel.appendChild(body);
  host.appendChild(panel);
  return { panel, body, expand };
}

export function drawLedgerHeatmap(mount, steps, rows) {
  // rows: array per snapshot of [nDims] trust values; color = log10(v / snapshot median)
  const canvas = document.createElement("canvas"); canvas.className = "lg-canvas";
  const tip = document.createElement("div"); tip.className = "u-tip"; tip.style.display = "none";
  const foot = document.createElement("div"); foot.className = "hm-foot";
  foot.textContent = "color: log-ratio to snapshot median — dark/blue = distrusted, red = highly trusted";
  mount.appendChild(canvas); mount.appendChild(foot); mount.appendChild(tip);
  mount.style.position = "relative";
  const ctx = canvas.getContext("2d");
  const nSnap = rows.length, nDims = nSnap ? rows[0].length : 0;
  const medians = rows.map((r) => {
    const s = [...r].sort((a, b) => a - b);
    return s[s.length >> 1] || 1;
  });
  function draw() {
    const w = Math.max(160, mount.clientWidth - 4);
    canvas.width = w; canvas.height = nDims || 40;
    ctx.clearRect(0, 0, w, canvas.height);
    if (!nSnap) {
      ctx.fillStyle = "#5d6a80"; ctx.font = "11px monospace";
      ctx.fillText("no harvested ledger snapshots for this run", 6, 16);
      return;
    }
    const cw = w / nSnap;
    for (let j = 0; j < nSnap; j++) {
      const med = medians[j];
      for (let d = 0; d < nDims; d++) {
        const t = Math.max(-1, Math.min(1, Math.log10((rows[j][d] || 1e-12) / med)));
        const c = heatColor((t + 1) / 2);
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.fillRect(j * cw, d, Math.ceil(cw), 1);
      }
    }
  }
  canvas.addEventListener("mousemove", (e) => {
    if (!nSnap) return;
    const r = canvas.getBoundingClientRect();
    const j = Math.min(nSnap - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / nSnap))));
    const d = Math.min(nDims - 1, Math.max(0, Math.floor((e.clientY - r.top) / (r.height / nDims))));
    const v = rows[j][d];
    tip.innerHTML = `<div class="u-tip-x">dim ${d} · step ${gint(steps[j])}</div>` +
      `<div class="u-tip-row">trust <b>${g(v)}</b> (${g(v / medians[j])}× median)</div>`;
    tip.style.display = "block";
    const mr = mount.getBoundingClientRect();
    let lx = e.clientX - mr.left + 14, ty = e.clientY - mr.top + 14;
    if (lx + tip.offsetWidth > mount.clientWidth) lx = e.clientX - mr.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(0, lx) + "px"; tip.style.top = Math.max(0, ty) + "px";
  });
  canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  draw();
  return { hm: { resize: draw, destroy() { mount.innerHTML = ""; } } };
}

export function setLedgerMode(on) {
  state.ledgerMode = on;
  $("statstrip").style.display = on ? "none" : "";
  $("panels").style.display = on ? "none" : "";
  $("ledger-panels").style.display = on ? "" : "none";
  if (on) $("attention").style.display = "none";
  const btn = $("ledger-btn");
  if (btn) btn.classList.toggle("on", on);
  if (on) loadLedger();
  else {
    destroyLedger();
    if (state.current) { updateOverview(); requestAnimationFrame(fitCharts); }
  }
}
export function destroyLedger() {
  state.ledgerCharts.forEach((c) => { if (c.hm) c.hm.destroy(); else if (c.u) c.u.destroy(); });
  state.ledgerCharts = [];
  $("ledger-panels").innerHTML = "";
}
// Ledger block names carry their index as TEXT ("blocks.10.living_ffn.precision"),
// so a plain .sort() is ASCII order: blocks.10 and blocks.11 land between
// blocks.1 and blocks.2, and every heatmap below is then titled with a block
// number that isn't the block it is showing. Harmless at depth 4 or 8 — single
// digits sort the same either way — and wrong the first time depth crosses 9.
// Same defect as the run list sorting alphabetically and reading as recency
// (2026-08-06), found while checking whether anything else ordered that way.
// Fixed before it could fire rather than after.
//
// Non-numeric names fall back to string order rather than being dropped or
// silently grouped: an unrecognized naming scheme should look odd, not vanish.
export function byBlockIndex(a, b) {
  const ia = Number(String(a).split(".")[1]), ib = Number(String(b).split(".")[1]);
  const okA = Number.isFinite(ia), okB = Number.isFinite(ib);
  if (okA && okB && ia !== ib) return ia - ib;
  if (okA !== okB) return okA ? -1 : 1;
  return a < b ? -1 : (a > b ? 1 : 0);
}

export async function loadLedger() {
  const host = $("ledger-panels");
  destroyLedger();
  if (!state.current) { host.innerHTML = `<div class="s-meta" style="padding:20px">select a stream first</div>`; return; }
  host.innerHTML = `<div class="s-meta" style="padding:20px">loading ledger…</div>`;
  let data;
  try { data = await (await fetch(`/api/streams/${state.current.id}/ledger`)).json(); }
  catch (e) { host.innerHTML = `<div class="s-meta" style="padding:20px">ledger fetch failed</div>`; return; }
  host.innerHTML = "";
  const steps = data.steps || [], blocks = data.blocks || {};
  const names = Object.keys(blocks).sort(byBlockIndex);
  if (!steps.length || !names.length) {
    host.innerHTML = `<div class="s-meta" style="padding:20px">no harvested ledger snapshots for this run — ` +
      `the checkpoint harvester creates them (ledger_harvest_* next to the run dir)</div>`;
    return;
  }
  const section = document.createElement("section"); section.className = "group";
  const head = document.createElement("div"); head.className = "group-head";
  head.innerHTML = `<span class="group-dot neutral"></span><span class="group-title">Trust ledger · ` +
    `${steps.length} snapshots · steps ${gint(steps[0])}–${gint(steps[steps.length - 1])}</span>`;
  section.appendChild(head);
  const body = document.createElement("div"); body.className = "group-body panels-grid";
  section.appendChild(body); host.appendChild(section);

  // per-block dims×time heatmaps
  for (const name of names) {
    const blk = name.split(".")[1];
    const { body: mount, expand, panel } = ledgerPanel(body,
      `LEDGER · BLOCK ${blk} · dims × time`,
      "Every row is one input dimension's trust level over the run (from harvested checkpoints). A dark horizontal streak = a dimension the block persistently distrusts — a scar candidate. Color is relative to each snapshot's median, so drift doesn't wash out the picture.");
    const rec = Object.assign(drawLedgerHeatmap(mount, steps, blocks[name]), { el: mount });
    state.ledgerCharts.push(rec);
    expand.onclick = () => toggleMaximize(panel, rec);
  }

  // churn panel: rank correlation between consecutive snapshots
  if (steps.length > 1) {
    const { body: mount, expand, panel } = ledgerPanel(body,
      "TRUST-ORDER CHURN · rank corr, consecutive snapshots",
      "How much the trust ORDERING reshuffles between snapshots (1.0 = frozen order, lower = more reshuffling). The background against which any persistence claim must be judged: a scar only counts if it outlives this churn.");
    const xs = steps.slice(1);
    const palette = [C.blue, C.teal, C.green, C.purple, C.orange];
    const seriesDefs = names.map((name, i) => ({
      label: `blk${name.split(".")[1]}`, stroke: palette[i % palette.length], width: 1.8,
    }));
    const ys = names.map((name) => {
      const rows = blocks[name];
      return rows.slice(1).map((r, i) => rankCorr(rows[i], r));
    });
    const u = new uPlot({
      width: Math.max(300, mount.clientWidth || 500), height: 200,
      scales: { x: { time: false } },
      axes: [Object.assign(axisStyle(), { label: "step" }), axisStyle()],
      series: [{}].concat(seriesDefs),
      legend: { show: false },
      cursor: { points: { size: 7 } },
      plugins: [tooltipPlugin("step"), wheelZoomPlugin(), dragPanPlugin()],
    }, [xs].concat(ys), mount);
    const rec = { u, el: mount };
    state.ledgerCharts.push(rec);
    expand.onclick = () => toggleMaximize(panel, rec);
  }

  // bottom-k tracker: least-trusted dims now, with streaks
  {
    const { body: mount } = ledgerPanel(body, "LEAST-TRUSTED DIMENSIONS · now, with streaks",
      "The five least-trusted dimensions per block at the latest snapshot, with how many consecutive snapshots each has spent in the bottom five. Long streaks are durable distrust — the scar candidates worth naming.",
      false);
    const K = 5;
    let html = `<table class="lg-table"><tr><th>block</th><th>dim</th><th>trust ×median</th><th>bottom-${K} streak</th></tr>`;
    for (const name of names) {
      const rows = blocks[name];
      const botSets = rows.map((r) => {
        const idx = r.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, K).map((p) => p[1]);
        return new Set(idx);
      });
      const last = rows[rows.length - 1];
      const med = [...last].sort((a, b) => a - b)[last.length >> 1] || 1;
      const bottom = last.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, K);
      for (const [v, d] of bottom) {
        let streak = 0;
        for (let j = botSets.length - 1; j >= 0 && botSets[j].has(d); j--) streak++;
        html += `<tr><td>${name.split(".")[1]}</td><td>${d}</td>` +
          `<td>${g(v / med)}</td><td>${streak}/${rows.length}</td></tr>`;
      }
    }
    mount.innerHTML = html + "</table>";
  }
}
