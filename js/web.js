/* The Webbsite — background web geometry, load sequence, proximity glow. */
(() => {
  'use strict';

  // ---- Tunables ------------------------------------------------
  const SEED = 19970101;          // fixed seed: stable geometry per session
  const DESKTOP = { spokes: 12, rings: 6 };
  const MOBILE  = { spokes: 8,  rings: 4 };
  const ANGLE_JITTER = 6 * Math.PI / 180;  // ±6° spoke irregularity
  const RADIUS_JITTER = 0.06;              // ±6% ring radius per intersection
  const SAG = 0.07;                        // ring-segment slack (fraction of chord)
  const PROX_RADIUS = 120;                 // px, pointer-proximity glow
  const STATUS_MSG = '● CONNECTING TO WEAVINGTHEWEBB.COM …';
  const SHIMMER_NODES = 4;

  const svg = document.getElementById('web');
  const statusText = document.getElementById('status-text');
  const counterEl = document.getElementById('counter');
  const NS = 'http://www.w3.org/2000/svg';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => innerWidth <= 640;
  const SPEED = isMobile() ? 0.45 : 1;     // mobile sequence ≈ 1.2s

  // mulberry32 — tiny seeded PRNG
  function prng(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const state = { done: false, timers: [], typer: null };
  let proxNodes = [], proxSegs = [], proxSpokes = [];

  function el(name, attrs, cls) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    return e;
  }

  // ---- Geometry ------------------------------------------------
  function buildWeb() {
    const rand = prng(SEED);
    const w = innerWidth, h = innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.textContent = '';
    proxNodes = []; proxSegs = []; proxSpokes = [];

    const cfg = isMobile() ? MOBILE : DESKTOP;
    const hub = { x: w / 2, y: h * 0.42 };
    const maxR = Math.max(
      Math.hypot(hub.x, hub.y), Math.hypot(w - hub.x, hub.y),
      Math.hypot(hub.x, h - hub.y), Math.hypot(w - hub.x, h - hub.y)
    ) * 1.02;

    // Spoke angles with jitter
    const angles = [];
    for (let s = 0; s < cfg.spokes; s++) {
      angles.push((s / cfg.spokes) * 2 * Math.PI + (rand() * 2 - 1) * ANGLE_JITTER);
    }

    // Intersection points: rings spaced wider toward the edge
    const pts = []; // pts[ring][spoke]
    for (let r = 0; r < cfg.rings; r++) {
      const frac = 0.15 + 0.85 * Math.pow((r + 1) / cfg.rings, 1.3);
      pts.push(angles.map(a => {
        const rad = maxR * frac * (1 + (rand() * 2 - 1) * RADIUS_JITTER);
        return { x: hub.x + Math.cos(a) * rad, y: hub.y + Math.sin(a) * rad };
      }));
    }

    const spokesG = el('g', {}), ringsG = el('g', {}), nodesG = el('g', {});
    svg.append(spokesG, ringsG, nodesG);

    // Spokes: hub → past the viewport edge
    angles.forEach(a => {
      const x2 = hub.x + Math.cos(a) * maxR, y2 = hub.y + Math.sin(a) * maxR;
      const line = el('line', { x1: hub.x, y1: hub.y, x2, y2 }, 'spoke');
      spokesG.appendChild(line);
      proxSpokes.push({ el: line, x1: hub.x, y1: hub.y, x2, y2 });
    });

    // Rings: slack quadratic segments between adjacent spokes
    for (let r = 0; r < cfg.rings; r++) {
      for (let s = 0; s < cfg.spokes; s++) {
        const p1 = pts[r][s], p2 = pts[r][(s + 1) % cfg.spokes];
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const toHub = Math.hypot(hub.x - mx, hub.y - my) || 1;
        const cx = mx + ((hub.x - mx) / toHub) * chord * SAG;
        const cy = my + ((hub.y - my) / toHub) * chord * SAG;
        const path = el('path', { d: `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}` }, 'ring-seg');
        path.dataset.ring = r;
        ringsG.appendChild(path);
        proxSegs.push({ el: path, x: mx, y: my });
      }
    }

    // Nodes at every spoke×ring intersection
    pts.forEach(ring => ring.forEach(p => {
      if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) return;
      const c = el('circle', { cx: p.x, cy: p.y, r: 2.5 }, 'web-node');
      nodesG.appendChild(c);
      proxNodes.push({ el: c, x: p.x, y: p.y });
    }));

    return { spokes: [...spokesG.children], rings: [...ringsG.children], nodes: [...nodesG.children], cfg };
  }

  // ---- Load sequence ("dial-up handshake") ----------------------
  const later = (fn, ms) => state.timers.push(setTimeout(fn, ms * SPEED));

  function typeStatus(msg, done) {
    let i = 0;
    state.typer = setInterval(() => {
      statusText.textContent = msg.slice(0, ++i);
      if (i >= msg.length) { clearInterval(state.typer); done && done(); }
    }, 22 * SPEED);
  }

  function animateIn() {
    const parts = buildWeb();

    // Prime: strands undrawn, nodes scale 0
    [...parts.spokes, ...parts.rings].forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
    });
    parts.nodes.forEach(n => { n.style.transform = 'scale(0)'; });
    svg.getBoundingClientRect(); // flush styles before transitions

    typeStatus(STATUS_MSG);

    later(() => parts.spokes.forEach((p, i) => {
      p.style.transition = `stroke-dashoffset ${400 * SPEED}ms ease-out ${i * 20 * SPEED}ms`;
      p.style.strokeDashoffset = 0;
    }), 350);

    later(() => parts.rings.forEach((p, i) => {
      const delay = (+p.dataset.ring * 80 + (i % parts.cfg.spokes) * 6) * SPEED;
      p.style.transition = `stroke-dashoffset ${320 * SPEED}ms ease ${delay}ms`;
      p.style.strokeDashoffset = 0;
    }), 800);

    later(() => parts.nodes.forEach((n, i) => {
      n.style.transition = `transform ${240 * SPEED}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 6 * SPEED}ms`;
      n.style.transform = 'scale(1)';
    }), 1400);

    later(() => { statusText.textContent = STATUS_MSG + ' OK'; }, 1800);
    later(finish, 1850);
  }

  function finish() {
    if (state.done) return;
    state.done = true;
    state.timers.forEach(clearTimeout);
    clearInterval(state.typer);
    if (svg.childElementCount) {
      // Web already built (animation ran): snap in-flight styles to final state
      const els = svg.querySelectorAll('.spoke, .ring-seg, .web-node');
      els.forEach(p => {
        p.style.transition = 'none';
        p.style.strokeDasharray = '';
        p.style.strokeDashoffset = '';
        p.style.transform = '';
      });
      svg.getBoundingClientRect(); // commit the snap before re-enabling transitions
      els.forEach(p => { p.style.transition = ''; });
      if (!reducedMotion) startShimmer();
    } else {
      rebuildFinal(); // reduced-motion path: nothing built yet
    }
    statusText.textContent = reducedMotion ? 'CONNECTED' : STATUS_MSG + ' OK';
    document.body.classList.add('loaded');
    removeEventListener('pointerdown', finish);
    removeEventListener('keydown', finish);
  }

  function rebuildFinal() {
    buildWeb();
    if (!reducedMotion) startShimmer();
  }

  function startShimmer() {
    const rand = prng(SEED + 7);
    const nodes = [...svg.querySelectorAll('.web-node')];
    for (let i = 0; i < SHIMMER_NODES && nodes.length; i++) {
      const n = nodes.splice(Math.floor(rand() * nodes.length), 1)[0];
      n.classList.add('shimmer');
      n.style.animationDelay = `${rand() * 4}s`;
    }
  }

  // ---- Pointer proximity (desktop, fine pointer only) -----------
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function initProximity() {
    if (reducedMotion || isMobile() || !matchMedia('(pointer: fine)').matches) return;
    let mx = -1e4, my = -1e4, ticking = false;

    const update = () => {
      ticking = false;
      proxNodes.forEach(n =>
        n.el.classList.toggle('prox', Math.hypot(mx - n.x, my - n.y) < PROX_RADIUS));
      proxSegs.forEach(s =>
        s.el.classList.toggle('prox', Math.hypot(mx - s.x, my - s.y) < PROX_RADIUS));
      proxSpokes.forEach(s =>
        s.el.classList.toggle('prox', distToSeg(mx, my, s.x1, s.y1, s.x2, s.y2) < PROX_RADIUS / 2));
    };
    const queue = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };

    addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; queue(); }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { mx = my = -1e4; queue(); });
  }

  // ---- Visitor counter (fake but fun) ---------------------------
  function initCounter() {
    const day = Math.floor(Date.now() / 864e5);
    let visits = 4371 + ((day * 37) % 31337);
    const show = () => { counterEl.textContent = String(visits).padStart(7, '0'); };
    show();
    if (!reducedMotion) setTimeout(() => { visits++; show(); }, 4000);
  }

  // ---- Boot ------------------------------------------------------
  function boot() {
    initCounter();
    if (reducedMotion) {
      finish();
    } else {
      addEventListener('pointerdown', finish);
      addEventListener('keydown', finish);
      animateIn();
    }
    initProximity();
  }

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.done) rebuildFinal(); else finish(); }, 150);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
