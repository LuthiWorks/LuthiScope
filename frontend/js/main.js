import { state, hiddenIds, saveHidden, saveRefRuns, selectedIds } from './state.js';
import { setLedgerMode } from './ledger.js';
import { buildPanels, fitCharts, refreshData, restoreMaximized } from './panels.js';
import { loadRefBands } from './refs.js';
import { buildSettings } from './settings.js';
import { STREAMS_POLL_MS, loadStreams, renderStreamList } from './streams.js';
import { $ } from './utils.js';

// Boot: polling, global listeners, control wiring. Split from app.js 2026-09-29.

setInterval(async () => {
  const list = $("stream-list");
  if (!list || list.matches(":hover")) return;
  try {
    state.allStreams = await (await fetch("/api/streams")).json();
    renderStreamList();
  } catch (e) {
    // Backend unreachable: keep the last known list rather than blanking it.
    // The conn indicator reports connectivity; this poll only reports staleness.
  }
}, STREAMS_POLL_MS);
window.addEventListener("resize", () => {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(fitCharts, 120);
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") restoreMaximized(); });
const ledgerBtn = $("ledger-btn");
if (ledgerBtn) ledgerBtn.onclick = () => setLedgerMode(!state.ledgerMode);

$("refresh").onclick = loadStreams;
const clearSelBtn = $("clear-selected");
if (clearSelBtn) clearSelBtn.onclick = () => {
  if (!selectedIds.size) return;
  for (const id of selectedIds) hiddenIds.add(id);
  selectedIds.clear();
  saveHidden(); renderStreamList();
};
const clearAllBtn = $("clear-all");
if (clearAllBtn) clearAllBtn.onclick = () => {
  for (const s of state.allStreams) if (!hiddenIds.has(s.id)) hiddenIds.add(s.id);
  saveHidden(); renderStreamList();
};
// Designate the checked streams as the healthy reference band, or clear it if
// they are already the reference. Nothing is measured or stored — the band is
// recomputed from these runs' own logs every time a stream is opened, so it
// cannot go stale, and moving to a new architecture is a matter of designating
// that architecture's healthy runs.
const refSelBtn = $("ref-selected");
if (refSelBtn) refSelBtn.onclick = async () => {
  if (!selectedIds.size) return;
  const picked = [...selectedIds].filter((id) => id.endsWith("/training"));
  const same = picked.length === state.refRuns.length && picked.every((id) => state.refRuns.includes(id));
  state.refRuns = same ? [] : picked;
  saveRefRuns();
  selectedIds.clear();
  await loadRefBands();
  renderStreamList();
  if (state.current) { buildPanels(state.current.kind); refreshData(); }
};
const sBtn = $("settings-btn");
if (sBtn) sBtn.onclick = () => {
  const panel = $("settings-panel");
  if (!panel.classList.contains("open")) buildSettings();
  panel.classList.toggle("open");
};
loadStreams();
