"use strict";
// Config-driven fluid background — Jos Stam "Stable Fluids" (1999/2003) grid solver
// (add-source -> project -> semi-Lagrangian advect -> project, Gauss-Seidel pressure
// projection) with Fedkiw vorticity confinement. Dye is injected by clicks, and
// optionally by continuous autonomous objects, constant edge emitters, and a
// persistent cursor emitter — all controlled by window.LuthiBG.cfg (persisted to
// localStorage). When nothing is active the solver loop stops entirely (~0 CPU).
(function () {
  const canvas = document.getElementById("bg");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  // ---- persisted config ----
  const LS_KEY = "luthiscope.fluid";
  const DEFAULTS = {
    enabled: true,
    quality: 128,       // grid N: 64 / 96 / 128
    palette: "aurora",  // aurora | ember | ice | spectrum | mono
    intensity: 1.0,     // dye brightness 0.3..2
    trail: 0.985,       // dye persistence (FADE) 0.95..0.996
    clickCount: 1,      // objects launched per click 1..5
    autoObjects: 0,     // maintain N autonomous objects 0..5 (0 = off)
    edgeEmit: 0,        // constant emitters from N edges 0..4 (0 = off)
    cursorEmit: false,  // persistent cursor emitter
  };
  function loadCfg() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {} }
  const cfg = loadCfg();

  // ---- grid (reallocated when quality changes) ----
  let N, W1, SIZE;
  let u, v, u0, v0, dens, dens0, curl;
  const off = document.createElement("canvas");
  const offctx = off.getContext("2d");
  let img;
  const IX = (i, j) => i + W1 * j;

  function allocate(n) {
    N = n; W1 = n + 2; SIZE = W1 * W1;
    u = new Float32Array(SIZE); v = new Float32Array(SIZE);
    u0 = new Float32Array(SIZE); v0 = new Float32Array(SIZE);
    dens = new Float32Array(SIZE); dens0 = new Float32Array(SIZE);
    curl = new Float32Array(SIZE);
    off.width = n; off.height = n;
    img = offctx.createImageData(n, n);
  }

  // ---- solver constants ----
  const ITER = 16, DT = 0.12, VORT = 8.0;
  // object physics
  const DECEL = 0.03, RESTITUTION = 0.98, STOP_SPEED = 0.05;
  const MAX_OBJECTS = 12, OBJ_VEL_SCALE = 0.2, OBJ_AMT = 45;
  const COOLDOWN = 180;

  let Wpx = 0, Hpx = 0, lastT = 0, active = false, idleFrames = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const objects = [];
  const mouse = { x: 0, y: 0, px: 0, py: 0, has: false };

  function resize() { Wpx = canvas.width = window.innerWidth; Hpx = canvas.height = window.innerHeight; }
  const cell = (g) => Math.max(1, Math.min(N, Math.round(g)));

  // ---- Stam solver ----
  function addSource(x, s) { for (let i = 0; i < SIZE; i++) x[i] += DT * s[i]; }
  function setBnd(b, x) {
    for (let i = 1; i <= N; i++) {
      x[IX(0, i)] = b === 1 ? -x[IX(1, i)] : x[IX(1, i)];
      x[IX(N + 1, i)] = b === 1 ? -x[IX(N, i)] : x[IX(N, i)];
      x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, N + 1)] = b === 2 ? -x[IX(i, N)] : x[IX(i, N)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, N + 1)] = 0.5 * (x[IX(1, N + 1)] + x[IX(0, N)]);
    x[IX(N + 1, 0)] = 0.5 * (x[IX(N, 0)] + x[IX(N + 1, 1)]);
    x[IX(N + 1, N + 1)] = 0.5 * (x[IX(N, N + 1)] + x[IX(N + 1, N)]);
  }
  function linSolve(b, x, x0, a, c) {
    const cRecip = 1 / c;
    for (let k = 0; k < ITER; k++) {
      for (let j = 1; j <= N; j++)
        for (let i = 1; i <= N; i++)
          x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i - 1, j)] + x[IX(i + 1, j)] + x[IX(i, j - 1)] + x[IX(i, j + 1)])) * cRecip;
      setBnd(b, x);
    }
  }
  function advect(b, d, d0, uu, vv) {
    const dt0 = DT * N;
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        let x = i - dt0 * uu[IX(i, j)], y = j - dt0 * vv[IX(i, j)];
        if (x < 0.5) x = 0.5; else if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5; else if (y > N + 0.5) y = N + 0.5;
        const i0 = x | 0, i1 = i0 + 1, j0 = y | 0, j1 = j0 + 1;
        const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
        d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) +
                      s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
      }
    setBnd(b, d);
  }
  function project(uu, vv, p, div) {
    const h = 1.0 / N;
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        div[IX(i, j)] = -0.5 * h * (uu[IX(i + 1, j)] - uu[IX(i - 1, j)] + vv[IX(i, j + 1)] - vv[IX(i, j - 1)]);
        p[IX(i, j)] = 0;
      }
    setBnd(0, div); setBnd(0, p);
    linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        uu[IX(i, j)] -= 0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) / h;
        vv[IX(i, j)] -= 0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) / h;
      }
    setBnd(1, uu); setBnd(2, vv);
  }
  function vorticityConfinement() {
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++)
        curl[IX(i, j)] = (v[IX(i + 1, j)] - v[IX(i - 1, j)]) * 0.5 - (u[IX(i, j + 1)] - u[IX(i, j - 1)]) * 0.5;
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        let nx = (Math.abs(curl[IX(i + 1, j)]) - Math.abs(curl[IX(i - 1, j)])) * 0.5;
        let ny = (Math.abs(curl[IX(i, j + 1)]) - Math.abs(curl[IX(i, j - 1)])) * 0.5;
        const len = Math.sqrt(nx * nx + ny * ny) + 1e-5;
        nx /= len; ny /= len;
        const w = curl[IX(i, j)];
        u[IX(i, j)] += DT * VORT * (ny * w);
        v[IX(i, j)] += DT * VORT * (-nx * w);
      }
  }
  function velStep() {
    addSource(u, u0); addSource(v, v0);
    vorticityConfinement();
    project(u, v, u0, v0);
    [u0, u] = [u, u0]; [v0, v] = [v, v0];
    advect(1, u, u0, u0, v0); advect(2, v, v0, u0, v0);
    project(u, v, u0, v0);
  }
  function densStep() {
    addSource(dens, dens0);
    [dens0, dens] = [dens, dens0];
    advect(0, dens, dens0, u, v);
    const fade = cfg.trail;
    for (let i = 0; i < SIZE; i++) dens[i] *= fade;
  }

  // ---- injection ----
  function inject(cx, cy, du, dv, amt, rad) {
    for (let j = -rad; j <= rad; j++)
      for (let i = -rad; i <= rad; i++) {
        const xi = cx + i, yj = cy + j;
        if (xi < 1 || xi > N || yj < 1 || yj > N) continue;
        const idx = IX(xi, yj);
        dens0[idx] += amt; u0[idx] += du; v0[idx] += dv;
      }
  }
  function spawnObject(x, y, vx, vy) { if (objects.length < MAX_OBJECTS) objects.push({ x, y, vx, vy }); }
  function spawnFromEdge() {
    const edge = (Math.random() * 4) | 0;
    const speed = 24 + Math.random() * 8, drift = (Math.random() * 2 - 1) * 12;
    if (edge === 0) spawnObject(0, Math.random() * Hpx, speed, drift);
    else if (edge === 1) spawnObject(Wpx, Math.random() * Hpx, -speed, drift);
    else if (edge === 2) spawnObject(Math.random() * Wpx, 0, drift, speed);
    else spawnObject(Math.random() * Wpx, Hpx, drift, -speed);
  }
  function updateObjects() {
    const amt = OBJ_AMT * cfg.intensity;
    for (let k = objects.length - 1; k >= 0; k--) {
      const o = objects[k];
      o.x += o.vx; o.y += o.vy;
      if (o.x < 0) { o.x = 0; o.vx = -o.vx * RESTITUTION; }
      else if (o.x > Wpx) { o.x = Wpx; o.vx = -o.vx * RESTITUTION; }
      if (o.y < 0) { o.y = 0; o.vy = -o.vy * RESTITUTION; }
      else if (o.y > Hpx) { o.y = Hpx; o.vy = -o.vy * RESTITUTION; }
      const sp = Math.hypot(o.vx, o.vy), ns = sp - DECEL;
      if (ns <= STOP_SPEED) { objects.splice(k, 1); continue; }
      o.vx = o.vx / sp * ns; o.vy = o.vy / sp * ns;
      inject(cell(o.x / Wpx * N), cell(o.y / Hpx * N),
             (o.vx / Wpx) * N * OBJ_VEL_SCALE, (o.vy / Hpx) * N * OBJ_VEL_SCALE, amt, 2);
    }
  }
  function emitEdges(nEdges) {
    const amt = 70 * cfg.intensity, f = 16, p = () => 1 + ((Math.random() * N) | 0), t = () => (Math.random() * 2 - 1) * 5;
    if (nEdges >= 1) inject(2, p(), f, t(), amt, 2);
    if (nEdges >= 2) inject(N - 1, p(), -f, t(), amt, 2);
    if (nEdges >= 3) inject(p(), 2, t(), f, amt, 2);
    if (nEdges >= 4) inject(p(), N - 1, t(), -f, amt, 2);
  }
  function emitCursor() {
    if (!mouse.has) return;
    const du = ((mouse.x - mouse.px) / Wpx) * N * OBJ_VEL_SCALE;
    const dv = ((mouse.y - mouse.py) / Hpx) * N * OBJ_VEL_SCALE;
    mouse.px = mouse.x; mouse.py = mouse.y;
    inject(cell(mouse.x / Wpx * N), cell(mouse.y / Hpx * N), du, dv, 55 * cfg.intensity, 2);
  }

  // ---- palettes ----
  function colorFor(d) {
    let x = d * 0.012; if (x > 1) x = 1; else if (x < 0) x = 0;
    const k = x; let r, g, b;
    switch (cfg.palette) {
      case "ember":
        if (x < 0.5) { const t = x / 0.5; r = 120 + t * 135; g = 20 + t * 80; b = 10; }
        else { const t = (x - 0.5) / 0.5; r = 255; g = 100 + t * 155; b = 10 + t * 200; }
        break;
      case "ice":
        { const t = x; r = 40 + t * 160; g = 120 + t * 120; b = 200 + t * 55; } break;
      case "spectrum":
        { const h = x * 320; const c = hsl(h, 90, 55); r = c[0]; g = c[1]; b = c[2]; } break;
      case "mono":
        { r = 180 + x * 75; g = 200 + x * 55; b = 220 + x * 35; } break;
      default: // aurora
        if (x < 0.4) { const t = x / 0.4; r = 30; g = 90 + t * 130; b = 200; }
        else if (x < 0.75) { const t = (x - 0.4) / 0.35; r = 30 + t * 150; g = 220 - t * 120; b = 200 + t * 40; }
        else { const t = (x - 0.75) / 0.25; r = 180 + t * 70; g = 100 + t * 120; b = 240; }
    }
    return [r * k, g * k, b * k];
  }
  function hsl(h, s, l) { // -> [r,g,b]
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, xx = c * (1 - Math.abs(hp % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hp < 1) [r, g, b] = [c, xx, 0]; else if (hp < 2) [r, g, b] = [xx, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, xx]; else if (hp < 4) [r, g, b] = [0, xx, c];
    else if (hp < 5) [r, g, b] = [xx, 0, c]; else [r, g, b] = [c, 0, xx];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function render() {
    const data = img.data;
    for (let j = 1; j <= N; j++)
      for (let i = 1; i <= N; i++) {
        const c = colorFor(dens[IX(i, j)]); const p = ((j - 1) * N + (i - 1)) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    offctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#080b14"; ctx.fillRect(0, 0, Wpx, Hpx);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, N, N, 0, 0, Wpx, Hpx);
  }

  const continuous = () => cfg.autoObjects > 0 || cfg.edgeEmit > 0 || cfg.cursorEmit;
  const animating = () => cfg.enabled && !document.hidden && !reduced;
  const hasWork = () => objects.length > 0 || idleFrames > 0 || continuous();

  function step() {
    u0.fill(0); v0.fill(0); dens0.fill(0);
    if (cfg.autoObjects > 0) while (objects.length < cfg.autoObjects) spawnFromEdge();
    if (cfg.edgeEmit > 0) emitEdges(cfg.edgeEmit);
    if (cfg.cursorEmit) emitCursor();
    updateObjects();
    idleFrames = (objects.length > 0 || continuous()) ? COOLDOWN : idleFrames - 1;
    velStep(); densStep(); render();
  }
  function loop(t) {
    if (!animating() || !hasWork()) { active = false; return; }
    if (t - lastT >= 33) { lastT = t; step(); }
    requestAnimationFrame(loop);
  }
  function start() {
    if (active || !animating() || !hasWork()) return;
    active = true; lastT = 0; requestAnimationFrame(loop);
  }
  function clearCanvas() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#080b14"; ctx.fillRect(0, 0, Wpx, Hpx);
  }
  // Wipe all simulation state so a re-enable starts from inert (no leftover
  // objects, dye, or velocity) rather than resuming where it was paused.
  function resetState() {
    objects.length = 0;
    idleFrames = 0;
    u.fill(0); v.fill(0); u0.fill(0); v0.fill(0); dens.fill(0); dens0.fill(0);
  }

  // ---- input ----
  window.addEventListener("mousemove", (e) => {
    if (!mouse.has) { mouse.px = e.clientX; mouse.py = e.clientY; }
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
  });
  window.addEventListener("mousedown", (e) => {
    if (!cfg.enabled) return;
    if (e.target.closest && e.target.closest("#settings-panel, #topbar")) return;
    const n = Math.max(1, cfg.clickCount | 0);
    for (let i = 0; i < n; i++) {
      const speed = 24 + Math.random() * 8, ang = Math.random() * Math.PI * 2;
      spawnObject(e.clientX, e.clientY, Math.cos(ang) * speed, Math.sin(ang) * speed);
    }
    idleFrames = COOLDOWN; start();
  });
  window.addEventListener("resize", () => { resize(); if (!active) render(); });
  document.addEventListener("visibilitychange", start);

  // ---- boot ----
  allocate(cfg.quality);
  resize();
  if (cfg.enabled) { if (continuous()) start(); else render(); } else clearCanvas();

  window.LuthiBG = {
    cfg,
    set(key, val) {
      cfg[key] = val; persist();
      if (key === "quality") { allocate(val); render(); }
      if (key === "enabled" && !val) { active = false; resetState(); clearCanvas(); }
      start();
      if (!continuous() && objects.length === 0 && cfg.enabled && !active) render();
    },
    toggle() { this.set("enabled", !cfg.enabled); return cfg.enabled; },
    isRunning: () => active,
  };
})();
