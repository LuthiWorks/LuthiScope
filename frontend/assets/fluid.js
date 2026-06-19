"use strict";
// Real-time fluid background — Jos Stam "Stable Fluids" (SIGGRAPH 1999) /
// "Real-Time Fluid Dynamics for Games" (2003): a grid of velocity (u,v) and dye
// (density) fields, integrated each step by add-source -> project -> advect ->
// project (semi-Lagrangian advection + Gauss-Seidel pressure projection for
// incompressibility). Dye + velocity are injected both by autonomous jets from
// random screen edges and by the cursor. Diffusion is omitted (visc=diff=0) for
// crisp ink, as Stam notes is fine when advection dominates.
//
// Rendered as additive inky light on a dark base, behind frosted-glass panels.
// Pointer-safe (CSS pointer-events:none; the cursor is read via a window
// listener so it never blocks clicks), ~30fps capped, pauses when hidden or on
// prefers-reduced-motion, and toggleable via window.LuthiBG.
(function () {
  const canvas = document.getElementById("bg");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");

  // --- grid ---
  const N = 128;                       // interior cells per side
  const W1 = N + 2;                     // incl. boundary
  const SIZE = W1 * W1;
  const ITER = 16;                     // pressure (Gauss-Seidel) iterations
  const DT = 0.12;
  const FADE = 0.985;                  // dye decay per frame
  const VORT = 8.0;                    // vorticity-confinement strength (epsilon)
  const IX = (i, j) => i + W1 * j;

  let u = new Float32Array(SIZE), v = new Float32Array(SIZE);
  let u0 = new Float32Array(SIZE), v0 = new Float32Array(SIZE);
  let dens = new Float32Array(SIZE), dens0 = new Float32Array(SIZE);
  const curl = new Float32Array(SIZE);  // scratch for vorticity confinement

  // --- offscreen for the NxN dye image, upscaled to the viewport ---
  const off = document.createElement("canvas");
  off.width = N; off.height = N;
  const offctx = off.getContext("2d");
  const img = offctx.createImageData(N, N);

  let Wpx = 0, Hpx = 0, userPaused = false, lastT = 0, frame = 0, nextEdge = 30;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // traveling dye "objects": spawn at an edge (or on click), travel with momentum,
  // bounce off the walls, lose speed to friction, deposit dye + velocity along the
  // path, and disappear once they slow to a stop (the dye then fades on its own).
  const objects = [];
  // Linear deceleration (constant momentum loss/frame) gives an even spread of
  // bumps. Lifetime ~= v0/DECEL frames; distance ~= v0*lifetime/2. At ~30fps,
  // v0~27 and DECEL~0.03 => ~30s coast, ~6-7 edge-to-edge traversals.
  const DECEL = 0.03;          // px/frame^2 deceleration
  const RESTITUTION = 0.98;    // nearly elastic so the 6-7 bounces don't sap momentum
  const STOP_SPEED = 0.05;     // px/frame; below this the object is done
  const MAX_OBJECTS = 10;
  const OBJ_VEL_SCALE = 0.2;   // wake speed as a fraction of the object's speed (~1/3)
  const OBJ_AMT = 45;          // dye deposited per frame along the path

  function resize() {
    Wpx = canvas.width = window.innerWidth;
    Hpx = canvas.height = window.innerHeight;
  }

  // --- Stam solver ---
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
      for (let j = 1; j <= N; j++) {
        for (let i = 1; i <= N; i++) {
          x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i - 1, j)] + x[IX(i + 1, j)] + x[IX(i, j - 1)] + x[IX(i, j + 1)])) * cRecip;
        }
      }
      setBnd(b, x);
    }
  }

  function advect(b, d, d0, uu, vv) {
    const dt0 = DT * N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        let x = i - dt0 * uu[IX(i, j)];
        let y = j - dt0 * vv[IX(i, j)];
        if (x < 0.5) x = 0.5; else if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5; else if (y > N + 0.5) y = N + 0.5;
        const i0 = x | 0, i1 = i0 + 1, j0 = y | 0, j1 = j0 + 1;
        const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
        d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) +
                      s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
      }
    }
    setBnd(b, d);
  }

  function project(uu, vv, p, div) {
    const h = 1.0 / N;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        div[IX(i, j)] = -0.5 * h * (uu[IX(i + 1, j)] - uu[IX(i - 1, j)] + vv[IX(i, j + 1)] - vv[IX(i, j - 1)]);
        p[IX(i, j)] = 0;
      }
    }
    setBnd(0, div); setBnd(0, p);
    linSolve(0, p, div, 1, 4);
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        uu[IX(i, j)] -= 0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) / h;
        vv[IX(i, j)] -= 0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) / h;
      }
    }
    setBnd(1, uu); setBnd(2, vv);
  }

  // Vorticity confinement (Fedkiw, Stam & Jensen 2001): re-inject the small-scale
  // swirl that semi-Lagrangian advection numerically dissipates. Compute the curl
  // omega = dv/dx - du/dy, then push velocity along the gradient of |omega| toward
  // vorticity concentrations:  F = eps * (N x omega),  N = grad|omega| / |grad|omega||.
  function vorticityConfinement() {
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const duDy = (u[IX(i, j + 1)] - u[IX(i, j - 1)]) * 0.5;
        const dvDx = (v[IX(i + 1, j)] - v[IX(i - 1, j)]) * 0.5;
        curl[IX(i, j)] = dvDx - duDy;
      }
    }
    for (let j = 1; j <= N; j++) {
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
    for (let i = 0; i < SIZE; i++) dens[i] *= FADE;
  }

  // --- injection ---
  function inject(cx, cy, du, dv, amt, rad) {
    for (let j = -rad; j <= rad; j++) {
      for (let i = -rad; i <= rad; i++) {
        const xi = cx + i, yj = cy + j;
        if (xi < 1 || xi > N || yj < 1 || yj > N) continue;
        const idx = IX(xi, yj);
        dens0[idx] += amt;
        u0[idx] += du; v0[idx] += dv;
      }
    }
  }

  function spawnObject(x, y, vx, vy) {
    if (objects.length >= MAX_OBJECTS) return;
    objects.push({ x, y, vx, vy });
  }

  function spawnFromEdge() {
    const edge = (Math.random() * 4) | 0;
    const speed = 24 + Math.random() * 8;                // px/frame initial momentum
    const drift = (Math.random() * 2 - 1) * speed * 0.5; // angle off the normal
    if (edge === 0) spawnObject(0, Math.random() * Hpx, speed, drift);        // left
    else if (edge === 1) spawnObject(Wpx, Math.random() * Hpx, -speed, drift); // right
    else if (edge === 2) spawnObject(Math.random() * Wpx, 0, drift, speed);    // top
    else spawnObject(Math.random() * Wpx, Hpx, drift, -speed);                 // bottom
  }

  function updateObjects() {
    for (let k = objects.length - 1; k >= 0; k--) {
      const o = objects[k];
      o.x += o.vx; o.y += o.vy;
      if (o.x < 0) { o.x = 0; o.vx = -o.vx * RESTITUTION; }
      else if (o.x > Wpx) { o.x = Wpx; o.vx = -o.vx * RESTITUTION; }
      if (o.y < 0) { o.y = 0; o.vy = -o.vy * RESTITUTION; }
      else if (o.y > Hpx) { o.y = Hpx; o.vy = -o.vy * RESTITUTION; }
      const sp = Math.hypot(o.vx, o.vy);
      const ns = sp - DECEL;                 // constant deceleration
      if (ns <= STOP_SPEED) { objects.splice(k, 1); continue; }
      o.vx = o.vx / sp * ns; o.vy = o.vy / sp * ns;
      const gx = Math.max(1, Math.min(N, Math.round((o.x / Wpx) * N)));
      const gy = Math.max(1, Math.min(N, Math.round((o.y / Hpx) * N)));
      const du = (o.vx / Wpx) * N * OBJ_VEL_SCALE;
      const dv = (o.vy / Hpx) * N * OBJ_VEL_SCALE;
      inject(gx, gy, du, dv, OBJ_AMT, 2);
    }
  }

  // --- render ---
  function colorFor(d) {
    let x = d * 0.012; if (x > 1) x = 1; else if (x < 0) x = 0;
    let r, g, b;
    if (x < 0.4) { const t = x / 0.4; r = 30; g = 90 + t * 130; b = 200; }            // blue -> cyan
    else if (x < 0.75) { const t = (x - 0.4) / 0.35; r = 30 + t * 150; g = 220 - t * 120; b = 200 + t * 40; } // cyan -> violet
    else { const t = (x - 0.75) / 0.25; r = 180 + t * 70; g = 100 + t * 120; b = 240; } // violet -> warm white
    const k = x;
    return [r * k, g * k, b * k];
  }

  function render() {
    const data = img.data;
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const c = colorFor(dens[IX(i, j)]);
        const p = ((j - 1) * N + (i - 1)) * 4;
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
      }
    }
    offctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#080b14";
    ctx.fillRect(0, 0, Wpx, Hpx);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, N, N, 0, 0, Wpx, Hpx);
  }

  function step() {
    u0.fill(0); v0.fill(0); dens0.fill(0);
    if (--nextEdge <= 0) { spawnFromEdge(); nextEdge = 240 + ((Math.random() * 360) | 0); } // ~8-20s
    updateObjects();
    frame++;
    velStep();
    densStep();
    render();
  }

  const animating = () => !userPaused && !document.hidden && !reduced;

  function loop(t) {
    if (!animating()) return;
    if (t - lastT >= 33) { lastT = t; step(); }
    requestAnimationFrame(loop);
  }
  function kick() { if (animating()) requestAnimationFrame(loop); }

  window.addEventListener("resize", resize);
  // click anywhere: launch an object in a random direction from the cursor
  window.addEventListener("mousedown", (e) => {
    const speed = 24 + Math.random() * 8;
    const ang = Math.random() * Math.PI * 2;
    spawnObject(e.clientX, e.clientY, Math.cos(ang) * speed, Math.sin(ang) * speed);
  });
  document.addEventListener("visibilitychange", kick);

  resize();
  spawnFromEdge();   // one object to start
  step();
  if (!reduced) requestAnimationFrame(loop);

  window.LuthiBG = {
    toggle() { userPaused = !userPaused; if (!userPaused) { lastT = 0; kick(); } return !userPaused; },
    isRunning: () => animating(),
  };
})();
