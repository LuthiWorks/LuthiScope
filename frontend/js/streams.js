import { state, forgotten, hiddenIds, saveForgot, saveHidden, selectedIds } from './state.js';
import { deriveEvents } from './events.js';
import { loadLedger } from './ledger.js';
import { buildPanels, refreshData } from './panels.js';
import { loadRefBands } from './refs.js';
import { $, ago, gint, setConn } from './utils.js';

// Stream discovery list, run metadata, live WebSocket tail. Split from app.js 2026-09-29.

export function updateClearSelected() {
  const btn = $("clear-selected");
  if (btn) {
    btn.disabled = selectedIds.size === 0;
    btn.title = selectedIds.size ? `Hide ${selectedIds.size} selected stream(s)` : "Hide selected streams";
  }
  const ref = $("ref-selected");
  if (ref) {
    ref.disabled = selectedIds.size === 0;
    ref.classList.toggle("on", state.refRuns.length > 0);
    ref.title = selectedIds.size
      ? `Use ${selectedIds.size} selected stream(s) as the healthy reference band`
      : (state.refRuns.length
          ? `Reference band: ${state.refRuns.length} run(s). Select streams to change it.`
          : "Select healthy runs, then designate them as the reference band");
  }
}

export async function loadStreams() {
  const list = $("stream-list");
  list.innerHTML = "<li class='s-meta'>scanning…</li>";
  try {
    state.allStreams = await (await fetch("/api/streams")).json();
  } catch (e) {
    state.allStreams = [];
    list.innerHTML = "<li class='s-meta'>backend unreachable</li>";
    return;
  }
  renderStreamList();
}

// Quiet background refresh of the stream list (2026-08-14). The list used to
// be a snapshot from the last manual rescan: record counts froze, the "ago"
// labels aged in place, and the live light stayed whatever the scan caught —
// a vitals display that silently freezes while looking calm, the exact
// failure the WS auto-reconnect note above describes. Poll the same endpoint
// and re-render in place; the rescan button stays for immediacy. Skipped
// while the pointer is over the list so rows don't rebuild mid-click.
export const STREAMS_POLL_MS = 10000;

export function renderStreamList() {
  // reconcile permanently-deleted streams: stay gone unless the run changed
  let forgotChanged = false;
  const suppressed = new Set();
  for (const s of state.allStreams) {
    if (s.id in forgotten) {
      if (s.n_records === forgotten[s.id]) suppressed.add(s.id);
      else { delete forgotten[s.id]; forgotChanged = true; }
    }
  }
  if (forgotChanged) saveForgot();
  const list = $("stream-list");
  list.innerHTML = "";
  const visible = state.allStreams.filter((s) => !hiddenIds.has(s.id) && !suppressed.has(s.id));
  const hiddenStreams = state.allStreams.filter((s) => hiddenIds.has(s.id) && !suppressed.has(s.id));
  if (!state.allStreams.length) {
    list.innerHTML = "<li class='s-meta'>no streams found in runs dir</li>";
  } else if (!visible.length) {
    list.innerHTML = "<li class='s-meta'>all streams hidden</li>";
  }
  // drop selections for streams that are no longer in the visible list
  const visibleIds = new Set(visible.map((s) => s.id));
  for (const id of [...selectedIds]) if (!visibleIds.has(id)) selectedIds.delete(id);
  for (const s of visible) {
    const li = document.createElement("li");
    // The list re-renders on the background poll now, so the selected row's
    // highlight must be restored from state or the poll erases it.
    if (state.current && state.current.id === s.id) li.classList.add("active");
    const check = document.createElement("input");
    check.type = "checkbox"; check.className = "s-check";
    check.title = "Select for batch hide";
    check.checked = selectedIds.has(s.id);
    check.onclick = (e) => e.stopPropagation();   // don't also select the stream
    check.onchange = () => {
      if (check.checked) selectedIds.add(s.id); else selectedIds.delete(s.id);
      updateClearSelected();
    };
    const main = document.createElement("div");
    main.className = "s-main";
    const liveDot = s.live
      ? `<span class="live-dot" title="actively logging — last write ` +
        `${s.last_write_age != null ? gint(Math.round(s.last_write_age)) + "s ago" : "age unknown"}` +
        `${s.live_window ? `; reads as stopped after ${gint(Math.round(s.live_window))}s without one` : ""}">●</span>`
      : "";
    const isRef = state.refRuns.includes(s.id);
    main.innerHTML =
      `<div class="s-name">${liveDot}${s.run_dir}<span class="kind-tag kind-${s.kind}">${s.kind}</span>` +
        (isRef ? `<span class="ref-tag" title="Designated reference run: contributes to the healthy band">ref</span>` : "") +
      `</div>` +
      `<div class="s-meta">${s.n_records} records · ${ago(s.mtime)}</div>`;
    main.onclick = () => selectStream(s.id, s.kind, li);
    const cmpBtn = document.createElement("button");
    cmpBtn.className = "s-cmpbtn" + (state.compare && state.compare.id === s.id ? " on" : "");
    cmpBtn.title = state.compare && state.compare.id === s.id
      ? "Stop comparing against this stream"
      : "Compare: overlay this stream (dashed) on every line panel";
    cmpBtn.textContent = "vs";
    cmpBtn.onclick = async (e) => {
      e.stopPropagation();
      if (state.compare && state.compare.id === s.id) { state.compare = null; }
      else {
        try {
          const resp = await (await fetch(`/api/streams/${s.id}/records`)).json();
          state.compare = { id: s.id, run_dir: s.run_dir, kind: s.kind, records: resp.records || [] };
        } catch (err) { state.compare = null; }
      }
      renderStreamList();
      if (state.current) { buildPanels(state.current.kind); refreshData(); }
    };
    const trash = document.createElement("button");
    trash.className = "s-trash"; trash.title = "Hide this stream"; trash.textContent = "🗑";
    trash.onclick = (e) => { e.stopPropagation(); hiddenIds.add(s.id); saveHidden(); renderStreamList(); };
    li.appendChild(check); li.appendChild(main); li.appendChild(cmpBtn); li.appendChild(trash);
    list.appendChild(li);
  }
  const clearBtn = $("clear-all");
  if (clearBtn) clearBtn.style.display = visible.length ? "" : "none";
  updateClearSelected();
  renderHidden(hiddenStreams);
}

export function renderHidden(hiddenStreams) {
  const wrap = $("hidden-wrap");
  if (!wrap) return;
  if (!hiddenStreams.length) { wrap.innerHTML = ""; return; }
  // survive the background poll's re-render without snapping shut
  const wasOpen = !!(wrap.querySelector(".hidden-dd") || {}).open;
  wrap.innerHTML =
    `<details class="hidden-dd"><summary>Hidden (${hiddenStreams.length})</summary>` +
    `<ul class="hidden-list"></ul><button class="restore-all">restore all</button></details>`;
  const hl = wrap.querySelector(".hidden-list");
  for (const s of hiddenStreams) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "s-hidden-name";
    name.textContent = `${s.run_dir} · ${s.kind}`;
    const restore = document.createElement("button");
    restore.className = "s-restore"; restore.title = "Restore"; restore.textContent = "↩";
    restore.onclick = () => { hiddenIds.delete(s.id); saveHidden(); renderStreamList(); };
    const del = document.createElement("button");
    del.className = "s-delete"; del.title = "Delete from list (returns only if the run changes)"; del.textContent = "✕";
    del.onclick = () => { forgotten[s.id] = s.n_records; saveForgot(); hiddenIds.delete(s.id); saveHidden(); renderStreamList(); };
    li.appendChild(name); li.appendChild(restore); li.appendChild(del);
    hl.appendChild(li);
  }
  wrap.querySelector(".restore-all").onclick = () => {
    for (const s of hiddenStreams) hiddenIds.delete(s.id);
    saveHidden(); renderStreamList();
  };
  if (wasOpen) wrap.querySelector(".hidden-dd").open = true;
}

// Short plot labels for the lines a run declares. Kept explicit rather than
// derived from the key, so a new declared threshold has to be named by a person
// before it can appear on a chart claiming authority.
export const DECLARED_LABEL = {
  cosine_collapse_threshold: (v) => `kill · cosine ${g(v)}`,
  divergence_nmse_max: (v) => `kill · nmse ${g(v)}`,
};

export function applyRunMeta(meta) {
  state.runRefs = {}; state.runWithheld = {};
  if (!meta || !meta.thresholds) return;
  const lines = meta.thresholds.lines || {};
  for (const key in lines) {
    const spec = lines[key];
    if (!spec || !spec.series || typeof spec.value !== "number") continue;
    const mk = DECLARED_LABEL[key];
    if (!mk) continue;
    (state.runRefs[spec.series] = state.runRefs[spec.series] || []).push({
      value: spec.value,
      kind: key === "cosine_collapse_threshold" ? "ceiling" : "limit",
      label: mk(spec.value),
      note: spec.note,
      source: "declared by this run",
    });
  }
  state.runWithheld = meta.thresholds.withheld || {};
}

// The run's own account of itself, in the header. Record count and step range
// are different facts and both are stated, because the day they stopped agreeing
// nothing said so: a cadence change from 1000 to 100 turned 31 records into
// 3000 steps and the reader, correctly applying the spacing that had held for
// every run before it, read 31k.
export function renderRunFacts(meta) {
  if (!meta) return "";
  const a = meta.axis || {}, c = meta.cadence || {};
  const bits = [];
  if (a.first != null && a.last != null) {
    bits.push(`${a.axis}s ${gint(a.first)}–${gint(a.last)}`);
  }
  if (a.n_records != null) {
    const missing = a.n_records - (a.n_with_axis || 0);
    bits.push(`${a.n_records} records` +
              (missing > 0 ? ` <span class="nl-warn">(${missing} without a ${a.axis})</span>` : ""));
  }
  if (c.deep_interval_batches) bits.push(`deep every ${c.deep_interval_batches}`);
  if (c.light_interval_batches) bits.push(`light every ${c.light_interval_batches}`);
  if (!c.deep_interval_batches && !c.light_interval_batches) {
    bits.push(`<span class="nl-warn">cadence not declared</span>`);
  }
  const withheldKeys = Object.keys(state.runWithheld);
  if (withheldKeys.length) {
    const why = withheldKeys.map((k) => `${k}: ${state.runWithheld[k]}`).join("\n");
    bits.push(`<span class="nl-withheld" title="${why.replace(/"/g, "&quot;")}">` +
              `${withheldKeys.length} declared threshold(s) not drawn</span>`);
  }
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}

export async function selectStream(id, kind, li) {
  document.querySelectorAll("#stream-list li").forEach((el) => el.classList.remove("active"));
  if (li) li.classList.add("active");
  state.current = { id, kind };
  if (state.ws) { state.ws._deliberate = true; state.ws.close(); state.ws = null; }

  $("now-line").innerHTML = `loading <b>${id}</b> …`;
  const resp = await (await fetch(`/api/streams/${id}/records`)).json();
  state.records = resp.records || [];
  try {
    const ev = await (await fetch(`/api/streams/${id}/events`)).json();
    state.streamEvents = ev.events || [];
  } catch (e) { state.streamEvents = []; }
  // What this run says about itself: cadence, true axis range, and the lines it
  // declares. Loaded BEFORE the panels are built so the reference layer exists
  // on first paint rather than appearing a beat later.
  let meta = null;
  try { meta = await (await fetch(`/api/streams/${encodeURI(id)}/runmeta`)).json(); } catch (e) { meta = null; }
  state.currentMeta = meta;
  applyRunMeta(meta);
  await loadRefBands();
  state.derivedEvents = deriveEvents(state.records, state.streamEvents.filter((e) => e.kind === "canary"));
  state.evlockIndex = null;
  if (state.ledgerMode) { loadLedger(); }
  buildPanels(kind);
  refreshData();
  $("now-line").innerHTML = `<b>${id}</b> · ${kind}${renderRunFacts(meta)}`;
  setConn("online", "LOADED");
  openLive(id);
}

export function scheduleReconnect(id, kind) {
  if (state.reconnectTimer) return;
  setConn("offline", `RECONNECTING in ${Math.round(state.reconnectDelay / 1000)}s`);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (!state.current || state.current.id !== id) return;  // user moved on
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 30000);
    await selectStream(id, kind, document.querySelector("#stream-list li.active"));
  }, state.reconnectDelay);
}

export function openLive(id) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${proto}://${location.host}/ws/streams/${id}`);
  state.ws.onopen = () => { state.reconnectDelay = 2000; setConn("live", "LIVE"); };
  state.ws.onclose = (ev) => {
    if (ev.target._deliberate) return;
    if (state.current && state.current.id === id) scheduleReconnect(id, state.current.kind);
    else setConn("offline", "OFFLINE");
  };
  state.ws.onerror = () => setConn("offline", "OFFLINE");
  state.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.records && msg.records.length) {
      state.records = state.records.concat(msg.records);
      refreshData();
      $("now-line").innerHTML = `<b>${id}</b> · ${state.records.length} records · ${state.current.kind} · live`;
    }
  };
}
