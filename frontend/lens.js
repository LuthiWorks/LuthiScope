// LuthiScope — Workspace window (2026-11-11).
//
// Shows what the Jacobian lens reads in the stand-in's workspace: which
// single-word concepts are active, moment by moment. Read-only like the rest
// of the console: this page only GETs readings the lens reader already wrote,
// and listens for new ones. It has no way to reach any model.
"use strict";

const $ = (id) => document.getElementById(id);
const FOLLOW_KEY = "luthiscope.lens.follow";
const SESSION_KEY = "luthiscope.lens.session";

let overview = null;      // /api/lens
let sessionId = null;
let meta = {};
let moments = [];         // records, ascending by moment
let selected = null;      // moment number
let pinned = null;        // concept key followed across moments
let ws = null;
let trackPlot = null;

const pathId = (id) => encodeURIComponent(id).replace(/%2F/g, "/");
const key = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const pct = (v) => (v == null ? "—" : (100 * v < 0.1 ? "<0.1" : (100 * v).toFixed(1)) + "%");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function ago(t) {
  if (!t) return "";
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return new Date(t * 1000).toLocaleString();
}

function setConn(state) {
  const c = $("conn");
  c.className = "conn " + state;
  c.textContent = state === "live" ? "● LIVE" : state === "online" ? "● ONLINE" : "● OFFLINE";
}

// ---- data -----------------------------------------------------------------

async function loadOverview() {
  try {
    const r = await fetch("/api/lens");
    overview = await r.json();
    setConn("online");
  } catch (e) {
    setConn("offline");
    return;
  }
  const sel = $("lens-session");
  const prev = sessionId || (() => { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } })();
  sel.innerHTML = "";
  for (const s of overview.sessions) {
    const o = el("option", null, `${s.id}${s.live ? "  ●" : ""}  (${s.n_moments})`);
    o.value = s.id;
    sel.appendChild(o);
  }
  if (!overview.sessions.length) { showEmpty(); return; }
  const pick = overview.sessions.some((s) => s.id === prev) ? prev : overview.sessions[0].id;
  sel.value = pick;
  if (pick !== sessionId) await openSession(pick);
}

async function openSession(id) {
  sessionId = id;
  try { localStorage.setItem(SESSION_KEY, id); } catch (e) {}
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  const r = await fetch(`/api/lens/sessions/${pathId(id)}/records`);
  if (!r.ok) { showEmpty(); return; }
  const body = await r.json();
  meta = body.meta || {};
  moments = (body.records || []).filter((m) => typeof m.moment === "number");
  moments.sort((a, b) => a.moment - b.moment);
  selected = moments.length ? moments[moments.length - 1].moment : null;
  renderNote();
  renderAll();
  connectLive();
}

function connectLive() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/lens/${pathId(sessionId)}`);
  const mine = ws;
  ws.onopen = () => { if (ws === mine) setConn(isLive() ? "live" : "online"); };
  ws.onclose = () => { if (ws === mine) setConn("offline"); };
  ws.onmessage = (ev) => {
    if (ws !== mine) return;
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    let added = false;
    for (const r of msg.records || []) {
      if (typeof r.moment !== "number") continue;
      const i = moments.findIndex((m) => m.moment === r.moment);
      if (i >= 0) moments[i] = r; else moments.push(r);
      added = true;
    }
    if (!added) return;
    moments.sort((a, b) => a.moment - b.moment);
    setConn("live");
    if ($("lens-follow").checked) selected = moments[moments.length - 1].moment;
    renderAll();
  };
}

function isLive() {
  const s = overview && overview.sessions.find((x) => x.id === sessionId);
  return !!(s && s.live);
}

// ---- rendering --------------------------------------------------------------

function renderNote() {
  const n = $("lens-note");
  if (!meta || !meta.model) { n.textContent = ""; return; }
  const lens = meta.lens || {};
  const lensName = (lens.file || "").split("/").pop() || "lens";
  n.textContent =
    `Reading a frozen twin of ${meta.model} (${meta.dtype || "?"} on ${meta.device || "?"}), ` +
    `lens ${lensName}${lens.revision ? " @ " + lens.revision : ""}. ` +
    `The twin is fed the same moments; it never touches the running stand-in. ` +
    `Single-word concepts only; on a 4B model the signal is fainter than in the paper.`;
}

function showEmpty() {
  $("lens-view").style.display = "none";
  const box = $("lens-empty");
  box.style.display = "";
  box.innerHTML = "";
  box.appendChild(el("h3", null, "No lens readings yet"));
  box.appendChild(el("p", null,
    "This window shows what the Jacobian lens reads in the stand-in's workspace. " +
    "The readings come from the lens reader, a separate program that runs a frozen twin of the model."));
  if (overview && !overview.reader_installed) {
    box.appendChild(el("p", null, "The reader's packages aren't installed on this machine yet. In the LuthiScope folder, run:"));
    box.appendChild(el("pre", null, 'pip install -e ".[lens]"'));
  }
  box.appendChild(el("p", null, "Then try one reading:"));
  box.appendChild(el("pre", null, 'python -m luthiscope.lens --prompt "The creeper hissed behind me, so I"'));
  box.appendChild(el("p", null, "Or follow the stand-in's moments as Sanctuary logs them:"));
  box.appendChild(el("pre", null, "python -m luthiscope.lens --moments <path to stand_in_moments.jsonl> --every 5"));
  if (overview) box.appendChild(el("p", "dim", "Readings are kept in " + overview.lens_dir));
  $("moment-list").innerHTML = "";
}

function current() { return moments.find((m) => m.moment === selected) || null; }

function renderAll() {
  if (!moments.length) { showEmpty(); return; }
  $("lens-empty").style.display = "none";
  $("lens-view").style.display = "";
  renderList();
  const m = current();
  if (!m) return;
  renderHead(m);
  renderConcepts(m);
  renderDepth(m);
  renderWhere(m);
  renderTrack();
}

function renderList() {
  const ul = $("moment-list");
  ul.innerHTML = "";
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    const li = el("li", "moment" + (m.moment === selected ? " sel" : ""));
    const top = el("div", "moment-top");
    top.appendChild(el("b", null, "#" + m.moment));
    top.appendChild(el("span", "dim", ago(m.read_at)));
    li.appendChild(top);
    const words = el("div", "moment-words");
    for (const c of (m.concepts || []).slice(0, 4)) {
      const chip = el("span", "chip" + (pinned && key(c.concept) === pinned ? " pinned" : ""), c.concept);
      words.appendChild(chip);
    }
    li.appendChild(words);
    li.onclick = () => { selected = m.moment; $("lens-follow").checked = false; saveFollow(); renderAll(); };
    ul.appendChild(li);
  }
}

function renderHead(m) {
  const h = $("moment-head");
  h.innerHTML = "";
  h.appendChild(el("span", "mh-num", "Moment " + m.moment));
  h.appendChild(el("span", "dim", ago(m.read_at)));
  if (m.source) h.appendChild(el("span", "dim", m.source === "prompt" ? "from a prompt" : "from the stand-in's moments"));
  if (m.n_tokens) h.appendChild(el("span", "dim", m.n_tokens + " tokens" + (m.truncated ? `, first ${m.truncated} not fed` : "")));
}

function renderConcepts(m) {
  const box = $("concepts");
  box.innerHTML = "";
  const cs = m.concepts || [];
  if (!cs.length) { box.appendChild(el("div", "dim", "nothing word-like read at this moment")); return; }
  const max = Math.max(...cs.map((c) => c.score || 0)) || 1;
  for (const c of cs) {
    const row = el("div", "concept" + (pinned === key(c.concept) ? " pinned" : ""));
    row.title = `strength ${pct(c.score)}, strongest at layer ${c.peak_layer}`;
    const label = el("div", "c-label");
    label.appendChild(el("span", "c-word", c.concept));
    if (c.alt) label.appendChild(el("span", "c-alt", "(" + c.alt + ")"));
    row.appendChild(label);
    const bar = el("div", "c-bar");
    const fill = el("div", "c-fill");
    fill.style.width = (100 * (c.score || 0) / max).toFixed(1) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el("span", "c-val", pct(c.score)));
    row.appendChild(el("span", "c-layer", "L" + c.peak_layer));
    row.onclick = () => { pinned = pinned === key(c.concept) ? null : key(c.concept); renderAll(); };
    box.appendChild(row);
  }
}

function renderDepth(m) {
  const box = $("depth");
  box.innerHTML = "";
  const layers = Object.keys(m.layers || {}).map(Number).sort((a, b) => a - b);
  const table = el("table", "depth");
  const addRow = (label, cells, cls) => {
    const tr = el("tr", cls);
    tr.appendChild(el("th", null, label));
    const td = el("td");
    for (const [w, p] of cells) {
      const chip = el("span", "chip" + (pinned && key(w) === pinned ? " pinned" : ""), w.trim() || "␠");
      chip.style.opacity = String(0.35 + 0.65 * Math.min(1, Math.sqrt(p || 0)));
      chip.title = pct(p);
      td.appendChild(chip);
    }
    tr.appendChild(td);
    table.appendChild(tr);
  };
  for (const l of layers) addRow("L" + l, m.layers[String(l)] || []);
  if (m.about_to_say) addRow("says", m.about_to_say, "says");
  box.appendChild(table);
  box.appendChild(el("div", "hm-foot",
    `${layers.length} layers read of ${meta.n_layers || "?"}. "says" is the model's own next word, for comparison.`));
}

function renderWhere(m) {
  const box = $("where");
  box.innerHTML = "";
  box.appendChild(el("div", "where-tail", m.tail || ""));
  if (m.read_tokens && m.read_tokens.length) {
    const rt = el("div", "where-read");
    for (const t of m.read_tokens) rt.appendChild(el("span", "tok", t.replace(/\n/g, "⏎")));
    box.appendChild(rt);
  }
}

function renderTrack() {
  const box = $("track");
  const latest = moments[moments.length - 1];
  const k = pinned || key(((latest.concepts || [])[0] || {}).concept);
  $("track-title").textContent = k ? `"${k}" over moments` : "Over moments";
  $("track-desc").textContent = pinned
    ? "How strongly this concept was read at each moment (blank = not among that moment's top concepts)."
    : "The latest moment's strongest concept, across all moments. Click a concept to follow another.";
  const xs = [], ys = [];
  for (const m of moments) {
    xs.push(m.moment);
    const c = (m.concepts || []).find((c) => key(c.concept) === k);
    ys.push(c ? 100 * c.score : null);
  }
  if (trackPlot) { trackPlot.destroy(); trackPlot = null; }
  box.innerHTML = "";
  if (!k || typeof uPlot === "undefined") return;
  const w = Math.max(240, box.clientWidth - 8);
  trackPlot = new uPlot({
    width: w, height: 170,
    legend: { show: false },
    cursor: { points: { size: 6 } },
    scales: { x: { time: false } },
    axes: [
      { stroke: "#8492a8", grid: { stroke: "rgba(255,255,255,0.05)" }, label: "moment" },
      { stroke: "#8492a8", grid: { stroke: "rgba(255,255,255,0.05)" }, values: (u, v) => v.map((x) => x + "%") },
    ],
    series: [{}, { stroke: "#3b82f6", width: 1.6, spanGaps: false, points: { show: true, size: 4, fill: "#3b82f6" } }],
  }, [xs, ys], box);
}

function saveFollow() { try { localStorage.setItem(FOLLOW_KEY, $("lens-follow").checked ? "1" : "0"); } catch (e) {} }

// ---- wiring -----------------------------------------------------------------

$("lens-session").onchange = (e) => openSession(e.target.value);
$("lens-follow").onchange = () => {
  saveFollow();
  if ($("lens-follow").checked && moments.length) { selected = moments[moments.length - 1].moment; renderAll(); }
};
try { if (localStorage.getItem(FOLLOW_KEY) === "0") $("lens-follow").checked = false; } catch (e) {}
window.addEventListener("resize", () => { if (moments.length) renderTrack(); });
document.addEventListener("keydown", (e) => {
  if (!moments.length || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  const i = moments.findIndex((m) => m.moment === selected);
  const j = e.key === "ArrowUp" ? Math.min(moments.length - 1, i + 1) : Math.max(0, i - 1);
  if (j !== i) { selected = moments[j].moment; $("lens-follow").checked = false; saveFollow(); renderAll(); e.preventDefault(); }
});

loadOverview();
// New sessions (a fresh reader run) appear without reopening the window.
setInterval(() => {
  const before = overview ? overview.sessions.map((s) => s.id).join("|") : "";
  fetch("/api/lens").then((r) => r.json()).then((o) => {
    const after = o.sessions.map((s) => s.id).join("|");
    overview = o;
    if (after !== before) loadOverview();
    else if (ws && ws.readyState === 1) setConn(isLive() ? "live" : "online");
  }).catch(() => setConn("offline"));
}, 5000);
