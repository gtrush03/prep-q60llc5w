/* AdaViz — soft luminous orb for the Ada voice coach.
   Global: window.AdaViz = { mount, setState, attachInput, attachOutput, setLevel, destroy }
   States: idle | connecting | listening | thinking | speaking | ended
   Canvas 2D only, no deps. */
(function () {
  'use strict';

  var PAL = {
    blue:  [11, 26, 46],
    slate: [61, 68, 104],
    peach: [232, 179, 154],
    rose:  [217, 160, 168],
    cream: [244, 226, 214]
  };
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ---- per-state targets (all values are ratios of the base radius) ----
  var TARGETS = {
    idle:       { core: 0.62, spread: 0.30, drift: 0.22, deform: 0.045, glow: 0.62, ring: 0.00, arc: 0, alpha: 1.00, spin: 0.10, shimmer: 0.0 },
    connecting: { core: 0.52, spread: 0.24, drift: 0.16, deform: 0.03, glow: 0.48, ring: 0.00, arc: 1, alpha: 0.95, spin: 0.10, shimmer: 0.0 },
    listening:  { core: 0.56, spread: 0.22, drift: 0.16, deform: 0.04, glow: 0.70, ring: 1.00, arc: 0, alpha: 1.00, spin: 0.14, shimmer: 0.0 },
    thinking:   { core: 0.58, spread: 0.30, drift: 0.48, deform: 0.07, glow: 0.66, ring: 0.00, arc: 0, alpha: 1.00, spin: 0.55, shimmer: 1.0 },
    speaking:   { core: 0.64, spread: 0.34, drift: 0.26, deform: 0.075, glow: 0.82, ring: 0.00, arc: 0, alpha: 1.00, spin: 0.22, shimmer: 0.2 },
    ended:      { core: 0.30, spread: 0.10, drift: 0.06, deform: 0.015, glow: 0.16, ring: 0.00, arc: 0, alpha: 0.42, spin: 0.04, shimmer: 0.0 }
  };

  var S = {
    canvas: null, ctx: null, container: null, ro: null,
    w: 0, h: 0, dpr: 1, raf: 0, t0: 0, last: 0,
    state: 'idle', from: null, to: null, tStart: 0, cur: null,
    inLevel: 0, outLevel: 0, inRaw: 0, outRaw: 0, manual: null,
    ac: null, inAn: null, outAn: null, inSrc: null, outSrc: null, inBuf: null, outBuf: null,
    reduced: false, angle: 0, ringPulse: 0, ringPhase: 0, prev: null
  };

  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  function mount(el, opts) {
    destroy();
    opts = opts || {};
    S.container = el;
    var c = document.createElement('canvas');
    c.style.cssText = 'display:block;width:100%;height:100%;';
    el.appendChild(c);
    S.canvas = c;
    S.ctx = c.getContext('2d');
    try { S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { S.reduced = false; }
    S.cur = copy(TARGETS.idle); S.from = copy(S.cur); S.to = copy(S.cur); S.state = 'idle';
    resize(opts.size);
    if (window.ResizeObserver) { S.ro = new ResizeObserver(function () { resize(opts.size); }); S.ro.observe(el); }
    else window.addEventListener('resize', onWinResize);
    S.t0 = performance.now(); S.last = S.t0;
    S.raf = requestAnimationFrame(frame);
  }
  function onWinResize() { resize(); }

  function resize(size) {
    if (!S.canvas) return;
    var rect = S.container.getBoundingClientRect();
    var w = size || rect.width || 200, h = size || rect.height || w;
    S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.w = w; S.h = h;
    S.canvas.width = Math.round(w * S.dpr);
    S.canvas.height = Math.round(h * S.dpr);
    if (size) { S.canvas.style.width = size + 'px'; S.canvas.style.height = size + 'px'; }
  }

  function setState(s) {
    if (!TARGETS[s] || s === S.state) return;
    S.from = copy(S.cur);
    S.to = copy(TARGETS[s]);
    S.tStart = performance.now();
    S.state = s;
  }

  // ---- audio ----
  function ac() {
    if (!S.ac) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; S.ac = new AC(); }
    if (S.ac.state === 'suspended') { try { S.ac.resume(); } catch (e) {} }
    return S.ac;
  }
  function mkAnalyser(ctx) { var a = ctx.createAnalyser(); a.fftSize = 512; a.smoothingTimeConstant = 0.6; return a; }
  function attachInput(stream) {
    var ctx = ac(); if (!ctx || !stream) return;
    try { if (S.inSrc) S.inSrc.disconnect(); } catch (e) {}
    S.inAn = mkAnalyser(ctx); S.inBuf = new Uint8Array(S.inAn.fftSize);
    S.inSrc = ctx.createMediaStreamSource(stream); S.inSrc.connect(S.inAn); // analyser only, never destination
  }
  function attachOutput(stream) {
    var ctx = ac(); if (!ctx || !stream) return;
    try { if (S.outSrc) S.outSrc.disconnect(); } catch (e) {}
    S.outAn = mkAnalyser(ctx); S.outBuf = new Uint8Array(S.outAn.fftSize);
    S.outSrc = ctx.createMediaStreamSource(stream); S.outSrc.connect(S.outAn); // analyser only
  }
  function rms(an, buf) {
    if (!an) return 0;
    an.getByteTimeDomainData(buf);
    var sum = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
    var r = Math.sqrt(sum / buf.length);
    return clamp((r - 0.01) * 4.2, 0, 1); // gate the noise floor, scale speech to ~1
  }
  function setLevel(i, o) { S.manual = { i: clamp(i || 0, 0, 1), o: clamp(o || 0, 0, 1) }; }

  // attack fast, release slow → breathing, not VU meter
  function smooth(cur, target, dt, att, rel) {
    var k = target > cur ? att : rel;
    return lerp(cur, target, 1 - Math.exp(-dt / k));
  }

  // ---- drawing ----
  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - S.last) / 1000); S.last = now;
    var t = (now - S.t0) / 1000;

    // levels
    var iRaw = S.manual ? S.manual.i : rms(S.inAn, S.inBuf);
    var oRaw = S.manual ? S.manual.o : rms(S.outAn, S.outBuf);
    S.inLevel = smooth(S.inLevel, iRaw, dt, 0.06, 0.28);
    S.outLevel = smooth(S.outLevel, oRaw, dt, 0.05, 0.22);

    // state interpolation (420ms ease)
    var p = clamp((now - S.tStart) / 420, 0, 1), e = easeInOut(p);
    for (var k in S.to) S.cur[k] = lerp(S.from[k], S.to[k], e);
    var C = S.cur;
    var amp = S.reduced ? 0.45 : 1;

    var ctx = S.ctx, W = S.canvas.width, H = S.canvas.height;
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.5;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = C.alpha;

    // synthetic breath when nothing attached
    var breath = 0.5 + 0.5 * Math.sin(t * 1.15);
    var live = (S.state === 'speaking') ? S.outLevel : (S.state === 'listening' ? S.inLevel : 0);
    var energy = live * amp;
    if (S.state === 'speaking' && !S.outAn && !S.manual) energy = (0.35 + 0.4 * breath) * amp;
    if (S.state === 'listening' && !S.inAn && !S.manual) energy = 0.12 * breath * amp;

    S.angle += dt * (0.35 + C.spin * 1.6) * amp;

    var core = R * (C.core + energy * 0.13);
    var deform = C.deform * amp * (0.6 + energy * 0.8);

    // 1) outer halo
    var halo = ctx.createRadialGradient(cx, cy, core * 0.4, cx, cy, R * 0.98);
    halo.addColorStop(0, rgba(PAL.slate, 0.22 * C.glow));
    halo.addColorStop(0.55, rgba(PAL.blue, 0.10 * C.glow));
    halo.addColorStop(1, rgba(PAL.blue, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // 2) body: a deformed disc, dusk gradient (blue bottom → peach top-left)
    var g = ctx.createLinearGradient(cx - core, cy - core, cx + core * 0.6, cy + core);
    g.addColorStop(0, rgba(PAL.cream, 0.95));
    g.addColorStop(0.28, rgba(PAL.peach, 0.92));
    g.addColorStop(0.62, rgba(PAL.slate, 0.95));
    g.addColorStop(1, rgba(PAL.blue, 1));
    ctx.fillStyle = g;
    var feather = [[1.12, 0.035], [1.10, 0.05], [1.08, 0.07], [1.06, 0.10], [1.045, 0.15], [1.03, 0.24], [1.015, 0.42], [1.0, 1.0]];
    for (var fi = 0; fi < feather.length; fi++) {
      ctx.globalAlpha = C.alpha * feather[fi][1];
      blobPath(ctx, cx, cy, core * feather[fi][0], t, deform, S.angle);
      ctx.fill();
    }
    ctx.globalAlpha = C.alpha;

    // 3) drifting colour blobs, additive, clipped to the body
    ctx.save();
    blobPath(ctx, cx, cy, core * 1.06, t, deform, S.angle); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    var drift = C.drift * amp * core;
    var blobs = [
      { c: PAL.peach, a: 0.55, r: 0.75, ph: 0.0, sp: 0.6 },
      { c: PAL.rose,  a: 0.50, r: 0.62, ph: 2.1, sp: 0.8 },
      { c: PAL.slate, a: 0.50, r: 0.85, ph: 4.2, sp: 0.5 },
      { c: PAL.cream, a: 0.28, r: 0.42, ph: 1.3, sp: 1.1 }
    ];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var a1 = S.angle * b.sp + b.ph, a2 = t * 0.37 * b.sp + b.ph * 1.7;
      var bx = cx + Math.cos(a1) * drift * 0.55 + Math.sin(a2) * drift * 0.35;
      var by = cy + Math.sin(a1 * 0.9) * drift * 0.55 + Math.cos(a2 * 1.3) * drift * 0.3;
      var br = core * b.r * (0.9 + 0.1 * Math.sin(t * 0.9 + b.ph)) * (1 + energy * 0.15);
      var bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      var al = b.a * (0.7 + 0.3 * C.glow) * (1 + C.shimmer * 0.25 * Math.sin(t * 2.4 + b.ph));
      bg.addColorStop(0, rgba(b.c, al));
      bg.addColorStop(0.6, rgba(b.c, al * 0.35));
      bg.addColorStop(1, rgba(b.c, 0));
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
    // top-left specular, gives it a glassy sphere read
    var sx = cx - core * 0.32, sy = cy - core * 0.38;
    var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, core * 0.75);
    sg.addColorStop(0, 'rgba(255,255,255,' + (0.20 + 0.05 * energy) + ')');
    sg.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, core * 0.75, 0, Math.PI * 2); ctx.fill();
    // bottom shade for depth (multiply-ish via dark overlay)
    ctx.globalCompositeOperation = 'source-over';
    var dg = ctx.createRadialGradient(cx + core * 0.25, cy + core * 0.55, core * 0.1, cx, cy, core * 1.05);
    dg.addColorStop(0, rgba(PAL.blue, 0.55));
    dg.addColorStop(0.5, rgba(PAL.blue, 0.12));
    dg.addColorStop(1, rgba(PAL.blue, 0));
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, core * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 4) soft edge glow around the body
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var eg = ctx.createRadialGradient(cx, cy, core * 0.92, cx, cy, core * (1.22 + energy * 0.18));
    eg.addColorStop(0, rgba(PAL.peach, 0.18 * C.glow));
    eg.addColorStop(0.5, rgba(PAL.rose, 0.07 * C.glow));
    eg.addColorStop(1, rgba(PAL.rose, 0));
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(cx, cy, core * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 5) listening ring: thin, expands with input level, breathes
    if (C.ring > 0.01) {
      S.ringPulse = smooth(S.ringPulse, S.inLevel, dt, 0.05, 0.35);
      var rr = core * (1.15 + 0.16 * S.ringPulse * amp + 0.012 * Math.sin(t * 2.0));
      ctx.save();
      ctx.globalAlpha = C.alpha * C.ring * (0.16 + 0.5 * S.ringPulse);
      ctx.lineWidth = Math.max(1, 0.9 * S.dpr);
      ctx.strokeStyle = rgba(PAL.cream, 0.85);
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = C.alpha * C.ring * 0.10 * S.ringPulse;
      ctx.lineWidth = Math.max(1, 5 * S.dpr);
      ctx.strokeStyle = rgba(PAL.peach, 0.8);
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 6) connecting arc: slow rotating short arc
    if (C.arc > 0.01) {
      var ar = core * 1.16, a0 = t * 1.4, sweep = Math.PI * 0.5;
      ctx.save();
      ctx.globalAlpha = C.alpha * C.arc;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, 1.0 * S.dpr);
      var ag = ctx.createLinearGradient(cx + Math.cos(a0) * ar, cy + Math.sin(a0) * ar, cx + Math.cos(a0 + sweep) * ar, cy + Math.sin(a0 + sweep) * ar);
      ag.addColorStop(0, rgba(PAL.cream, 0));
      ag.addColorStop(1, rgba(PAL.cream, 0.9));
      ctx.strokeStyle = ag;
      ctx.beginPath(); ctx.arc(cx, cy, ar, a0, a0 + sweep); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // organic outline: superposition of low-frequency sine waves around a circle
  function blobPath(ctx, cx, cy, r, t, deform, angle) {
    var n = 72; ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      var d = 1
        + deform * 0.55 * Math.sin(3 * a + t * 1.3 + angle)
        + deform * 0.35 * Math.sin(5 * a - t * 1.7)
        + deform * 0.25 * Math.sin(2 * a + t * 0.8 - angle * 0.5);
      var x = cx + Math.cos(a) * r * d, y = cy + Math.sin(a) * r * d;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function destroy() {
    if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0;
    if (S.ro) { try { S.ro.disconnect(); } catch (e) {} S.ro = null; }
    window.removeEventListener('resize', onWinResize);
    try { if (S.inSrc) S.inSrc.disconnect(); } catch (e) {}
    try { if (S.outSrc) S.outSrc.disconnect(); } catch (e) {}
    S.inSrc = S.outSrc = S.inAn = S.outAn = null;
    if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
    S.canvas = S.ctx = S.container = null; S.manual = null;
    S.inLevel = S.outLevel = S.ringPulse = 0;
  }

  window.AdaViz = { mount: mount, setState: setState, attachInput: attachInput, attachOutput: attachOutput, setLevel: setLevel, destroy: destroy };
})();
