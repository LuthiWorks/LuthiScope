// Central mutable application state. Every module reads/writes through `state`
// (ES module imports are read-only bindings, so reassigned globals live here).
// Split from app.js 2026-09-29; behavior unchanged.

export const SHOW_EMPTY_KEY = "luthiscope.showEmptyPanels";
export const METRICS_KEY = "luthiscope.disabledMetrics";
export function loadDisabledMetrics() { try { return new Set(JSON.parse(localStorage.getItem(METRICS_KEY) || "[]")); } catch (e) { return new Set(); } }
export function saveDisabledMetrics() { try { localStorage.setItem(METRICS_KEY, JSON.stringify([...disabledMetrics])); } catch (e) {} }
export const HIDDEN_KEY = "luthiscope.hiddenStreams";
export function loadHidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch (e) { return new Set(); } }
export function saveHidden() { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds])); } catch (e) {} }
export const FORGOT_KEY = "luthiscope.forgottenStreams";
export function loadForgot() { try { return JSON.parse(localStorage.getItem(FORGOT_KEY) || "{}"); } catch (e) { return {}; } }
export function saveForgot() { try { localStorage.setItem(FORGOT_KEY, JSON.stringify(forgotten)); } catch (e) {} }
export const REFRUNS_KEY = "luthiscope.referenceRuns";
export function saveRefRuns() { try { localStorage.setItem(REFRUNS_KEY, JSON.stringify(state.refRuns)); } catch (e) {} }
export const EVMARKS_KEY = "luthiscope.eventMarks";
export const EVLOCK_KEY = "luthiscope.eventLocked";

export const state = {
  // records & stream
  records: [], charts: [], current: null, currentMeta: null, ws: null,
  groupSeries: {}, maximized: null, streamEvents: [], compare: null,
  // reference machinery
  runRefs: {}, runWithheld: {}, rankFloored: false,
  refRuns: [], refBands: {}, refBandRuns: [],
  // event marks / event lock
  showEventMarks: false, eventLocked: false, evlockIndex: null, derivedEvents: [],
  // panels
  showEmptyPanels: false,
  // streams & connection
  allStreams: [], reconnectDelay: 2000, reconnectTimer: null, resizeTimer: null,
  // trust ledger
  ledgerMode: false, ledgerCharts: [],
};
export let disabledMetrics = loadDisabledMetrics();
export let hiddenIds = loadHidden();
export let forgotten = loadForgot();
export let selectedIds = new Set();
export const chartedCache = new Map();

// ---- top-level initializers, carried over verbatim from app.js ----
try { state.refRuns = JSON.parse(localStorage.getItem(REFRUNS_KEY) || "[]"); } catch (e) { state.refRuns = []; }
try {
  if (localStorage.getItem("luthiscope.optinMigrated") !== "1") {
    localStorage.removeItem(EVLOCK_KEY);
    localStorage.removeItem(EVMARKS_KEY);
    localStorage.setItem("luthiscope.optinMigrated", "1");
  }
} catch (e) {}
try {
  state.showEventMarks = localStorage.getItem(EVMARKS_KEY) === "1";
  state.eventLocked = localStorage.getItem(EVLOCK_KEY) === "1";
} catch (e) {}
try { state.showEmptyPanels = localStorage.getItem(SHOW_EMPTY_KEY) === "1"; } catch (e) {}
