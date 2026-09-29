import { state } from './state.js';
import { SCOPE_SERIES, activeEvents } from './events.js';
import { refsFor } from './refs.js';
import { $, gint, hexToRgba, num } from './utils.js';

// uPlot chart construction + the per-block heatmap renderer. Split from app.js 2026-09-29.


export function axisStyle() {
  return {
    stroke: "#8492a8",
    grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
    ticks: { stroke: "rgba(255,255,255,0.10)", width: 1 },
    font: "11px monospace",
  };
}

export function tooltipPlugin(xlabel) {
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
        if (idx == null || left == null || left < 0 || top == null) { tip.style.display = "none"; return; }
        // show only the series whose point is nearest the cursor (vertically) at this x
        let best = -1, bestDist = Infinity;
        for (let si = 1; si < u.series.length; si++) {
          const v = u.data[si][idx];
          if (v == null) continue;
          const py = u.valToPos(v, u.series[si].scale || "y");
          const d = Math.abs(py - top);
          if (d < bestDist) { bestDist = d; best = si; }
        }
        if (best < 0) { tip.style.display = "none"; return; }
        const s = u.series[best], v = u.data[best][idx], xv = u.data[0][idx];
        tip.innerHTML =
          `<div class="u-tip-x">${xlabel} ${gint(xv)}</div>` +
          `<div class="u-tip-row"><span class="u-tip-dot" style="background:${s.stroke}"></span>` +
          `${s.label}: <b>${g(v)}</b></div>`;
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

// mouse-wheel zoom on the x (time) axis, centered on the cursor; double-click resets
export function wheelZoomPlugin(factor = 0.85) {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        over.addEventListener("wheel", (e) => {
          if (!e.deltaY) return;
          e.preventDefault();
          const xData = u.data[0];
          if (!xData || xData.length < 2) return;
          const dataMin = xData[0], dataMax = xData[xData.length - 1];
          const left = e.clientX - over.getBoundingClientRect().left;
          const xVal = u.posToVal(left, "x");
          const oRange = u.scales.x.max - u.scales.x.min;
          const nRange = e.deltaY < 0 ? oRange * factor : oRange / factor;  // up = zoom in
          if (nRange >= dataMax - dataMin) { u.setScale("x", { min: dataMin, max: dataMax }); return; }
          const leftPct = left / over.clientWidth;
          let nMin = xVal - leftPct * nRange, nMax = nMin + nRange;
          if (nMin < dataMin) { nMax += dataMin - nMin; nMin = dataMin; }
          if (nMax > dataMax) { nMin -= nMax - dataMax; nMax = dataMax; }
          u.setScale("x", { min: nMin, max: nMax });
        }, { passive: false });
        over.addEventListener("dblclick", () => {
          const xData = u.data[0];
          if (xData && xData.length) u.setScale("x", { min: xData[0], max: xData[xData.length - 1] });
        });
      },
    },
  };
}

// true when the x window is narrower than the data (i.e., the user zoomed in)
export function xIsZoomed(u) {
  const xData = u.data[0];
  if (!xData || xData.length < 2) return false;
  const full = xData[xData.length - 1] - xData[0];
  return full > 0 && (u.scales.x.max - u.scales.x.min) < full * 0.999;
}

// drag-to-pan once zoomed: plain drag slides the visible x-window (clamped to
// the data). Only active when zoomed — at full view there is nothing to pan, so
// plain drag keeps uPlot's built-in select-zoom. Shift+drag select-zooms even
// while zoomed (the escape hatch back to box-zoom). uPlot's own mousedown is
// suppressed for pan drags via cursor.bind in makeChart, not here — two
// listeners on the same element can't reliably pre-empt each other.
export function dragPanPlugin() {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        let dragging = false;
        over.addEventListener("mousemove", (e) => {
          if (!dragging) over.style.cursor = xIsZoomed(u) && !e.shiftKey ? "grab" : "";
        });
        over.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || e.shiftKey || !xIsZoomed(u)) return;
          e.preventDefault();
          dragging = true;
          over.style.cursor = "grabbing";
          const xData = u.data[0];
          const dataMin = xData[0], dataMax = xData[xData.length - 1];
          const startX = e.clientX, startY = e.clientY;
          const startMin = u.scales.x.min, range = u.scales.x.max - u.scales.x.min;
          const pxToVal = range / over.clientWidth;
          // Free-floating pan (Brian, 2026-07-26): the ZOOM is frozen — the
          // window's x-span and y-span stay fixed — but the window itself
          // moves wherever the drag takes it, both axes. Without the explicit
          // y set, uPlot re-fits y to visible data on every x change and the
          // viewport rescales itself to local variance mid-drag.
          const yMax0 = u.scales.y.max, ySpan = u.scales.y.max - u.scales.y.min;
          const pxToValY = ySpan / over.clientHeight;
          const move = (ev) => {
            let nMin = startMin - (ev.clientX - startX) * pxToVal;
            if (nMin < dataMin) nMin = dataMin;
            if (nMin + range > dataMax) nMin = dataMax - range;
            const nYMax = yMax0 + (ev.clientY - startY) * pxToValY;
            u.batch(() => {
              u.setScale("x", { min: nMin, max: nMin + range });
              u.setScale("y", { min: nYMax - ySpan, max: nYMax });
            });
          };
          const up = () => {
            dragging = false;
            over.style.cursor = xIsZoomed(u) ? "grab" : "";
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        });
      },
    },
  };
}

export function panelMarks(spec) {
  const all = activeEvents();
  if (!all.length || spec.marks === false) return [];
  const labels = new Set((spec.series || []).map((s) => s.label));
  return all.filter((e) => {
    const scoped = SCOPE_SERIES[e.scope || "epoch"] || [];
    return scoped.some((l) => labels.has(l));
  });
}

export function eventMarkersPlugin(spec) {
  const COLORS = { canary: "rgba(251,146,60,0.55)", epoch: "rgba(148,163,184,0.45)",
                   derived: "rgba(34,211,238,0.45)" };
  let tip = null;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "u-tip"; tip.style.display = "none";
        u.over.appendChild(tip);
        u.over.addEventListener("mousemove", (e) => {
          // name-on-hover in ANY panel size: an unexplained line is worse
          // than no line (Brian, 2026-07-26)
          const eligible = panelMarks(spec);
          const marks = (state.eventLocked && eligible.length) ? [{ step: 0, label: "serving (Δ0)" }] : eligible;
          if (!marks.length) { tip.style.display = "none"; return; }
          const rect = u.over.getBoundingClientRect();
          const px = e.clientX - rect.left;
          let best = null, bestD = 6;
          for (const ev of marks) {
            if (ev.step < u.scales.x.min || ev.step > u.scales.x.max) continue;
            const d = Math.abs(u.valToPos(ev.step, "x") - px);
            if (d < bestD) { bestD = d; best = ev; }
          }
          if (!best) { tip.style.display = "none"; return; }
          tip.textContent = best.label;
          tip.style.display = "block";
          // Clamp to BOTH edges. Derived-event labels run long ("consolidation
          // fire (+3, total 128) — at Greek page"), and centring on the mark
          // without a right-hand clamp pushed the tail past the plot edge where
          // it was clipped — the value tooltip already clamped, this one didn't.
          const tw = tip.offsetWidth, avail = u.over.clientWidth;
          tip.style.left = Math.max(0, Math.min(px - tw / 2, avail - tw)) + "px";
          tip.style.top = "4px";
        });
        u.over.addEventListener("mouseleave", () => { if (tip) tip.style.display = "none"; });
      },
      draw: (u) => {
        const eligible = panelMarks(spec);
        const marks = (state.eventLocked && eligible.length) ? [{ step: 0, kind: "canary" }] : eligible;
        if (!marks.length) return;
        const ctx = u.ctx;
        ctx.save();
        for (const ev of marks) {
          if (ev.step < u.scales.x.min || ev.step > u.scales.x.max) continue;
          const x = u.valToPos(ev.step, "x", true);
          ctx.strokeStyle = COLORS[ev.kind] || COLORS.epoch;
          ctx.lineWidth = 1;
          if (ev.kind === "epoch") ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

// Draws the reference layer: the peer band behind the series, the definitional
// and run-declared lines over it. Every line is labeled on the plot — a line
// whose meaning lives in someone's memory is the thing we are correcting.
export function referencePlugin(spec) {
  const labels = spec.series.filter((s) => !s.cmp).map((s) => s.label);
  const uniq = [...new Set(labels)];
  return {
    hooks: {
      // behind the data
      drawClear: (u) => {
        const ctx = u.ctx;
        for (const label of uniq) {
          const b = state.refBands[label];
          if (!b) continue;
          ctx.save();
          ctx.beginPath();
          ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
          ctx.clip();
          ctx.beginPath();
          for (let i = 0; i < b.xs.length; i++) {
            const x = u.valToPos(b.xs[i], "x", true), y = u.valToPos(b.hi[i], "y", true);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          for (let i = b.xs.length - 1; i >= 0; i--) {
            ctx.lineTo(u.valToPos(b.xs[i], "x", true), u.valToPos(b.lo[i], "y", true));
          }
          ctx.closePath();
          ctx.fillStyle = "rgba(34,197,94,0.10)";
          ctx.fill();
          ctx.restore();
        }
      },
      // over the data
      draw: (u) => {
        const ctx = u.ctx;
        const seen = new Set();
        ctx.save();
        ctx.beginPath();
        ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        ctx.clip();
        ctx.font = "10px monospace";
        ctx.textBaseline = "bottom";
        for (const label of uniq) {
          for (const r of refsFor(label)) {
            const key = `${r.value}|${r.label}`;
            if (seen.has(key)) continue;    // one line per value, not one per series
            seen.add(key);
            if (r.value < u.scales.y.min || r.value > u.scales.y.max) continue;
            const y = u.valToPos(r.value, "y", true);
            ctx.strokeStyle = r.kind === "target"
              ? "rgba(148,163,184,0.55)" : "rgba(248,113,113,0.55)";
            ctx.setLineDash(r.kind === "target" ? [2, 4] : [6, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#8492a8";
            const txt = r.label;
            ctx.fillText(txt, u.bbox.left + u.bbox.width - ctx.measureText(txt).width - 4, y - 2);
          }
        }
        ctx.restore();
      },
    },
  };
}

// A band or a declared limit is useless off-screen: if the healthy family sits
// at 300 and this run sits at 4, the y-range must contain both or "7x below"
// stays a number in the readout instead of a picture. Definitional FLOORS are
// deliberately not forced into range — a floor at rank 1 would squash a healthy
// 260-370 view for no gain, and it draws itself whenever it is relevant.
export function refAwareRange(spec) {
  return (u, dataMin, dataMax) => {
    if (dataMin == null || dataMax == null) return uPlot.rangeNum(dataMin, dataMax, 0.1, true);
    let lo = dataMin, hi = dataMax;
    for (const s of spec.series) {
      if (s.cmp) continue;
      const b = state.refBands[s.label];
      if (b) { lo = Math.min(lo, ...b.lo); hi = Math.max(hi, ...b.hi); }
      for (const r of refsFor(s.label)) {
        if (r.kind === "limit" || r.kind === "target") {
          lo = Math.min(lo, r.value); hi = Math.max(hi, r.value);
        }
      }
    }
    return uPlot.rangeNum(lo, hi, 0.1, true);
  };
}

export function makeChart(mountEl, spec, xlabel, widthPx) {
  const series = [{}].concat(
    spec.series.map((s) => (s.cmp ? {
      // comparison-stream shadow: same hue, dashed and faded
      label: s.label,
      stroke: hexToRgba(s.color, 0.45),
      width: 1,
      dash: [5, 5],
      spanGaps: true,
      points: { show: false },
    } : {
      label: s.label,
      stroke: s.color,
      width: 1.8,
      // spanGaps: sparse series are mostly nulls (epoch-boundary
      // records); without it uPlot breaks the line at every gap and
      // nothing visible gets drawn between the handful of points.
      spanGaps: !!spec.sparse,
      points: { show: !!spec.sparse, size: 6, stroke: s.color, fill: s.color },
    }))
  );
  const opts = {
    width: widthPx,
    height: 200,
    scales: { x: { time: false }, y: { range: refAwareRange(spec) } },
    axes: [Object.assign(axisStyle(), { label: xlabel }), axisStyle()],
    series,
    legend: { show: false },
    cursor: {
      points: { size: 7 },
      // hand plain-drag-while-zoomed to dragPanPlugin; everything else
      // (full-view drag, shift+drag) keeps uPlot's built-in select-zoom
      bind: {
        mousedown: (u, targ, handler) => (e) => {
          if (e.button === 0 && !e.shiftKey && xIsZoomed(u)) return null;
          return handler(e);
        },
      },
    },
    plugins: [tooltipPlugin(xlabel), wheelZoomPlugin(), dragPanPlugin(),
              referencePlugin(spec), eventMarkersPlugin(spec)],
  };
  return new uPlot(opts, [[]].concat(spec.series.map(() => [])), mountEl);
}

// sequential colormap (low -> high): deep-blue, blue, green, yellow, red
export function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[15, 23, 42], [37, 99, 235], [34, 197, 94], [234, 179, 8], [239, 68, 68]];
  const seg = t * (stops.length - 1), i = Math.floor(seg), f = seg - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// blocks x time raster of a per-block substrate metric (substrate_blocks, deep cadence)
export function makeHeatmap(mountEl, spec, xlabel) {
  const sel = document.createElement("select");
  sel.className = "hm-select";
  spec.metrics.forEach((m, i) => {
    const o = document.createElement("option"); o.value = m; o.textContent = m;
    if (i === 0) o.selected = true; sel.appendChild(o);
  });
  // per-block normalization: each row scaled to its own min→max, so a block
  // whose absolute range is dwarfed by a neighbor's still shows its shape
  // (the seed42 precision fan-out made block 0 look flat next to block 2)
  const NORM_KEY = "luthiscope.hmRowNorm";
  let rowNorm = false;
  try { rowNorm = localStorage.getItem(NORM_KEY) === "1"; } catch (e) {}
  const normWrap = document.createElement("label"); normWrap.className = "hm-norm";
  const normBox = document.createElement("input"); normBox.type = "checkbox"; normBox.className = "s-check";
  normBox.checked = rowNorm;
  normWrap.appendChild(normBox); normWrap.appendChild(document.createTextNode("normalize per block"));
  const canvas = document.createElement("canvas"); canvas.className = "hm-canvas";
  const foot = document.createElement("div"); foot.className = "hm-foot";
  const legend = document.createElement("span"); legend.className = "hm-legend";
  foot.appendChild(legend);
  const tip = document.createElement("div"); tip.className = "u-tip"; tip.style.display = "none";
  mountEl.appendChild(sel); mountEl.appendChild(normWrap); mountEl.appendChild(canvas); mountEl.appendChild(foot); mountEl.appendChild(tip);
  mountEl.style.position = "relative";
  const ctx = canvas.getContext("2d");
  const LABEL_W = 26;   // left gutter for block-index labels
  let recs = [], metric = spec.metrics[0], frames = [], nBlocks = 0, vmin = 0, vmax = 1;
  let rowLo = [], rowHi = [];

  function compute() {
    frames = recs.filter(spec.has);
    nBlocks = frames.reduce((m, f) => Math.max(m, f.substrate_blocks.length), 0);
    let lo = Infinity, hi = -Infinity;
    rowLo = new Array(nBlocks).fill(Infinity); rowHi = new Array(nBlocks).fill(-Infinity);
    for (const f of frames) for (let bi = 0; bi < f.substrate_blocks.length; bi++) {
      const b = f.substrate_blocks[bi];
      const v = num(b && b[metric]); if (v == null) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
      if (v < rowLo[bi]) rowLo[bi] = v; if (v > rowHi[bi]) rowHi[bi] = v;
    }
    vmin = lo === Infinity ? 0 : lo; vmax = hi === -Infinity ? 1 : hi;
  }
  function draw() {
    const w = Math.max(120, mountEl.clientWidth - 4);
    const rowH = nBlocks ? Math.max(8, Math.min(20, Math.floor(220 / nBlocks))) : 12;
    canvas.width = w; canvas.height = Math.max(40, nBlocks * rowH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!frames.length || !nBlocks) {
      ctx.fillStyle = "#5d6a80"; ctx.font = "11px monospace";
      ctx.fillText("no per-block data yet (emitted at deep cadence)", 6, 16);
      legend.textContent = ""; return;
    }
    const plotW = w - LABEL_W, cw = plotW / frames.length, span = (vmax - vmin) || 1;
    for (let fi = 0; fi < frames.length; fi++) {
      const blocks = frames[fi].substrate_blocks;
      for (let bi = 0; bi < nBlocks; bi++) {
        const v = num(blocks[bi] && blocks[bi][metric]); if (v == null) continue;
        const t = rowNorm
          ? (v - rowLo[bi]) / ((rowHi[bi] - rowLo[bi]) || 1)
          : (v - vmin) / span;
        const c = heatColor(t);
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.fillRect(LABEL_W + fi * cw, bi * rowH, Math.ceil(cw), rowH);
      }
    }
    // block-index labels down the left gutter (0-based, matching the model)
    ctx.fillStyle = "#8492a8"; ctx.font = "9px monospace"; ctx.textBaseline = "middle";
    const lblStep = rowH >= 12 ? 1 : Math.ceil(nBlocks / 16);
    for (let bi = 0; bi < nBlocks; bi += lblStep) {
      ctx.fillText(String(bi), 3, bi * rowH + rowH / 2 + 0.5);
    }
    legend.textContent = rowNorm
      ? `${metric}: each block scaled to its own min…max · ${nBlocks} blocks × ${frames.length} firings`
      : `${metric}: ${g(vmin)} … ${g(vmax)} · ${nBlocks} blocks × ${frames.length} firings`;
  }
  canvas.addEventListener("mousemove", (e) => {
    if (!frames.length || !nBlocks) { tip.style.display = "none"; return; }
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) - LABEL_W;
    if (px < 0) { tip.style.display = "none"; return; }
    const fi = Math.min(frames.length - 1, Math.max(0, Math.floor(px / ((r.width - LABEL_W) / frames.length))));
    const bi = Math.min(nBlocks - 1, Math.max(0, Math.floor((e.clientY - r.top) / (r.height / nBlocks))));
    const f = frames[fi], v = num(f.substrate_blocks[bi] && f.substrate_blocks[bi][metric]);
    const c = v == null ? null : heatColor((v - vmin) / ((vmax - vmin) || 1));
    const sw = c ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : "#5d6a80";
    tip.innerHTML =
      `<div class="u-tip-x">${xlabel} ${gint(f.step != null ? f.step : f.cycle)}</div>` +
      `<div class="u-tip-row"><span class="u-tip-dot" style="background:${sw}"></span>` +
      `block ${bi} · ${metric}: <b>${v == null ? "--" : g(v)}</b></div>`;
    tip.style.display = "block";
    const mr = mountEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = e.clientX - mr.left + 14, ty = e.clientY - mr.top + 14;
    if (lx + tw > mountEl.clientWidth) lx = e.clientX - mr.left - tw - 14;
    if (ty + th > mountEl.clientHeight) ty = e.clientY - mr.top - th - 14;
    tip.style.left = Math.max(0, lx) + "px"; tip.style.top = Math.max(0, ty) + "px";
  });
  canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  sel.addEventListener("change", () => { metric = sel.value; compute(); draw(); });
  normBox.addEventListener("change", () => {
    rowNorm = normBox.checked;
    try { localStorage.setItem(NORM_KEY, rowNorm ? "1" : "0"); } catch (e) {}
    draw();
  });

  return {
    hm: true,
    setData(records) { recs = records; compute(); draw(); },
    resize() { draw(); },
    destroy() { mountEl.innerHTML = ""; },
  };
}
