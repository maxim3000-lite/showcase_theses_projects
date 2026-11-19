/* =========================================================
   STAGE · Fahrzeug (prozedural, schematisch, modern)
   Fastback-Limousine als Loft aus Profilkurven mit Super-
   ellipsen-Spanten. Liefert ein gleichmäßiges FE-Netz
   (Bogenlängen-Parametrisierung), vernetzte Räder, CAD-
   Linien, Bemaßung und die Punktewolke.
   Koordinaten: x längs (Front +), y quer, z hoch – Meter.
   Vertexdaten: [x, y, z, ny, nz, part]; Räder in Polarform
   [rad, θ, ρ, yOffset, 0, 1] (werden gerollt).
   ========================================================= */
(function (S) {
  'use strict';
  const { TAU, clamp, smooth } = S;

  const L = 4.75, XF = L / 2, DMAX = 0.75;
  const AXLES = [-1.385, 1.495], WR = 0.355, WY = 0.8, RA = 0.44;
  const PART = { SKIN: 0, WHEEL: 1, RAIL: 2, BUMPER: 3, FIREWALL: 4, BOOSTER: 5, ENGINE: 6, CRASHBOX: 7, UPPER: 8, RIGID: 9, CABIN: 10, SILL: 11, SUBFRAME: 12, TOWER: 13, JOINT: 14 };

  /** Kubische Hermite-Interpolation durch Stützpunkte [s, wert]. */
  function spline(pts) {
    const n = pts.length - 1;
    return (s) => {
      if (s <= pts[0][0]) return pts[0][1];
      if (s >= pts[n][0]) return pts[n][1];
      let i = 1;
      while (s > pts[i][0]) i++;
      const p0 = pts[Math.max(i - 2, 0)], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(i + 1, n)];
      const h = p2[0] - p1[0], t = (s - p1[0]) / h;
      const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * h;
      const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
    };
  }

  // Profil über s ∈ [0,1] (Heck → Front): kurzes Heck mit Abrisskante, Fastback, flache Scheibe, kurze Haube
  const TOP = spline([[0, 0.7], [0.02, 0.97], [0.05, 1.03], [0.12, 1.1], [0.22, 1.24], [0.33, 1.38], [0.45, 1.45], [0.55, 1.45], [0.62, 1.38], [0.7, 1.18], [0.775, 1.0], [0.86, 0.93], [0.94, 0.86], [0.985, 0.74], [1, 0.58]]);
  const BOT = spline([[0, 0.34], [0.04, 0.24], [0.12, 0.16], [0.5, 0.14], [0.88, 0.16], [0.96, 0.24], [1, 0.32]]);
  const WID = spline([[0, 0.74], [0.04, 0.88], [0.12, 0.93], [0.5, 0.94], [0.85, 0.93], [0.95, 0.88], [1, 0.72]]);
  const BELT = spline([[0, 0.86], [0.1, 1.0], [0.5, 1.02], [0.775, 1.0], [1, 0.86]]);

  const EXP = 2 / 4.5;
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

  /** Karosseriepunkt: s längs, v um den Spant → [x, y, z, ny, nz] */
  function body(s, v) {
    const cy = sp(Math.cos(v), EXP), cz = sp(Math.sin(v), EXP);
    const top = TOP(s), bot = BOT(s);
    const z = bot + (top - bot) * (cz * 0.5 + 0.5);
    const belt = BELT(s);
    const t = top > belt + 0.04 ? smooth(belt, top + 0.02, z) : 0; // Greenhouse mit Tumblehome
    const w = WID(s) * (1 - 0.27 * t);
    const n = Math.hypot(cy, cz) || 1;
    return [(s - 0.5) * L, cy * w, z, cy / n, cz / n];
  }

  /** Punkt auf der Fahrzeugseite (+y) in Höhe z, um inset entlang der Flächennormalen nach innen versetzt */
  function sideAt(s, z, inset = 0) {
    const top = TOP(s), bot = BOT(s);
    const cz = clamp(((z - bot) / (top - bot)) * 2 - 1, -0.995, 0.995);
    const b = body(s, Math.asin(Math.sign(cz) * Math.pow(Math.abs(cz), 1 / EXP)));
    return [b[0], b[1] - b[3] * inset, b[2] - b[4] * inset];
  }
  /** Linie des Dachrahmens (A-Säule → Dach → C-Säule) knapp unter der Außenhaut – folgt der Silhouette */
  const roofLine = (x) => { const s = x / L + 0.5; return sideAt(s, TOP(s) - 0.075, 0.055); };
  /** Fügestelle Längsträger ↔ Schweller (Riss, Elementversagen) */
  const CRACK = { x: 0.62 };

  /** Radausschnitt: Halbkreis über der Achse, senkrechte Kanten darunter */
  function inArch(x, z, ny) {
    if (Math.abs(ny) < 0.55 || z > WR + RA) return false;
    for (const ax of AXLES) {
      const dx = x - ax;
      if (Math.abs(dx) < RA && (z < WR || dx * dx + (z - WR) ** 2 < RA * RA)) return true;
    }
    return false;
  }
  const archAxle = (x) => (Math.abs(x - AXLES[0]) < Math.abs(x - AXLES[1]) ? AXLES[0] : AXLES[1]);

  /** Bruchteil-Index t in einer monoton steigenden Tabelle arr[0..n] finden. */
  function invert(arr, n, t) {
    let k = 0;
    while (k < n - 1 && arr[k + 1] < t) k++;
    return k + clamp((t - arr[k]) / ((arr[k + 1] - arr[k]) || 1));
  }

  /* ---------- Gleichmäßiges Außenhaut-Netz (Elementkante ≈ h) ---------- */
  function skinGrid(h) {
    const M = 600, VS = 12, cum = new Float64Array(M + 1), prev = [];
    for (let k = 0; k <= M; k++) {
      let acc = 0;
      for (let m = 0; m < VS; m++) {
        const p = body(k / M, (m / VS) * TAU);
        if (k) acc += Math.hypot(p[0] - prev[m][0], p[1] - prev[m][1], p[2] - prev[m][2]);
        prev[m] = p;
      }
      cum[k] = (k ? cum[k - 1] : 0) + acc / VS;
    }
    const nu = Math.max(10, Math.round(cum[M] / h)) + 1;
    const RES = 720;
    const secs = Array.from({ length: nu }, (_, i) => {
      const s = invert(cum, M, (cum[M] * i) / (nu - 1)) / M;
      const c = new Float64Array(RES + 1);
      let p0 = body(s, 0);
      for (let j = 1; j <= RES; j++) {
        const p = body(s, (j / RES) * TAU);
        c[j] = c[j - 1] + Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]);
        p0 = p;
      }
      return { s, c };
    });
    const nv = Math.max(12, Math.round(Math.max(...secs.map((q) => q.c[RES])) / h));
    const src = new Float32Array(nu * nv * 6), flags = new Uint8Array(nu * nv);
    secs.forEach(({ s, c }, i) => {
      for (let j = 0; j < nv; j++) {
        const b = body(s, (invert(c, RES, (c[RES] * j) / nv) / RES) * TAU), k = i * nv + j;
        if (inArch(b[0], b[2], b[3])) { // auf die Radhauskontur ziehen → glatter Ausschnitt
          const ax = archAxle(b[0]), dx = b[0] - ax, dz = b[2] - WR;
          if (dz >= 0) { const r = Math.hypot(dx, dz) || 1; b[0] = ax + (dx / r) * RA; b[2] = WR + (dz / r) * RA; } else { b[0] = ax + Math.sign(dx || 1) * RA; }
          flags[k] = 1;
        }
        src.set([b[0], b[1], b[2], b[3], b[4], 0], k * 6);
      }
    });
    return { nu, nv, wrapU: false, wrapV: true, src, flags };
  }

  /** Stirnfläche (Front oder Heck) als Ringnetz zur Mitte (jeder 3. Randknoten → kein Kantenstern) */
  function capGrid(skin, front) {
    const step = 3, nv = Math.floor(skin.nv / step), i0 = front ? skin.nu - 1 : 0, rings = 6, src = new Float32Array(rings * nv * 6);
    const at = (j) => (i0 * skin.nv + j * step) * 6;
    let cx = 0, cz = 0;
    for (let j = 0; j < nv; j++) { cx += skin.src[at(j)] / nv; cz += skin.src[at(j) + 2] / nv; }
    for (let r = 0; r < rings; r++) {
      const f = 1 - (r / (rings - 1)) * 0.94;
      for (let j = 0; j < nv; j++) {
        const o = at(j);
        src.set([cx + (skin.src[o] - cx) * f, skin.src[o + 1] * f, cz + (skin.src[o + 2] - cz) * f, 0, 0, 0], (r * nv + j) * 6);
      }
    }
    return { nu: rings, nv, wrapU: false, wrapV: true, src };
  }

  /* ---------- Räder: Reifen-Torus + Fünfspeichen-Felge ---------- */
  const R0 = WR - 0.08, TA = 0.08, TB = 0.115;
  function wheelGrids(nt) {
    const out = [];
    for (let w = 0; w < 4; w++) {
      const nphi = 14, tire = new Float32Array(nt * nphi * 6);
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < nphi; j++) {
          const ph = (j / nphi) * TAU;
          tire.set([w, (i / nt) * TAU, R0 + TA * sp(Math.cos(ph), 0.6), TB * sp(Math.sin(ph), 0.6), 0, 1], (i * nphi + j) * 6);
        }
      }
      out.push({ nu: nt, nv: nphi, wrapU: true, wrapV: true, src: tire });
      const nr = 6, rim = new Float32Array(nt * nr * 6), rMax = R0 - TA * 0.85;
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < nr; j++) rim.set([w, (i / nt) * TAU, 0.045 + (rMax - 0.045) * (j / (nr - 1)), 0.075 - 0.02 * (j / (nr - 1)), 0, 1], (i * nr + j) * 6);
      }
      out.push({
        nu: nt, nv: nr, wrapU: true, wrapV: false, src: rim,
        skip: (i, j) => { const a = ((i + 0.5) / nt) * 5; return j >= 1 && j <= nr - 3 && Math.abs(a - Math.round(a)) > 0.2; },
      });
    }
    return out;
  }

  /* ---------- CAD-Linien ---------- */
  function Lines() {
    const v = [];
    return {
      seg(a, b) { v.push(...a, ...b); },
      poly(p, closed) {
        for (let i = 0; i < p.length - 1; i++) this.seg(p[i], p[i + 1]);
        if (closed) this.seg(p[p.length - 1], p[0]);
      },
      done: () => new Float32Array(v),
    };
  }

  /** Straklinien: Spanten, Längslinien, Radausschnitte */
  function buildWire() {
    const ls = Lines();
    const curve = (n, f) => {
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const b = f(k / n), vt = [b[0], b[1], b[2], b[3], b[4], 0], cut = inArch(b[0], b[2], b[3]);
        if (prev && !cut && !prev.cut) ls.seg(prev.vt, vt);
        prev = { vt, cut };
      }
    };
    for (let k = 1; k < 28; k++) curve(96, (t) => body(k / 28, t * TAU));
    for (let m = 0; m < 26; m++) curve(160, (t) => body(t, (m / 26) * TAU + 0.06));
    for (const ax of AXLES) {
      for (const sd of [-1, 1]) {
        const y = sd * WID(ax / L + 0.5), P = (x, z) => [x, y, z, sd, 0, 0], arc = [];
        for (let k = 0; k <= 28; k++) { const a = (k / 28) * Math.PI; arc.push(P(ax + RA * Math.cos(a), WR + RA * Math.sin(a))); }
        ls.poly(arc, false);
        ls.seg(P(ax + RA, WR), P(ax + RA, 0.18)); ls.seg(P(ax - RA, WR), P(ax - RA, 0.18));
      }
    }
    return ls.done();
  }

  /** Räder für die CAD-Ansicht (rollbar) */
  function buildWheelLines() {
    const ls = Lines();
    for (let w = 0; w < 4; w++) {
      const ring = (rho, yo, n = 44) => { const r = []; for (let k = 0; k < n; k++) r.push([w, (k / n) * TAU, rho, yo, 0, 1]); ls.poly(r, true); };
      ring(WR, TB); ring(WR, -TB); ring(R0 - TA * 0.85, 0.075, 36); ring(0.045, 0.075, 16);
      for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; ls.seg([w, a, WR, TB, 0, 1], [w, a, WR, -TB, 0, 1]); }
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        ls.seg([w, a - 0.06, 0.045, 0.075, 0, 1], [w, a - 0.13, R0 - TA * 0.85, 0.06, 0, 1]);
        ls.seg([w, a + 0.06, 0.045, 0.075, 0, 1], [w, a + 0.13, R0 - TA * 0.85, 0.06, 0, 1]);
      }
    }
    return ls.done();
  }

  /** CAD-Bemaßung (Seitenansicht) */
  function buildDims() {
    const ls = Lines(), yd = -1.4, P = (x, z) => [x, yd, z, 0, 0, 9];
    const dim = (x0, z0, x1, z1) => {
      ls.seg(P(x0, z0), P(x1, z1));
      ls.seg(P(x0 - 0.05, z0 - 0.05), P(x0 + 0.05, z0 + 0.05));
      ls.seg(P(x1 - 0.05, z1 - 0.05), P(x1 + 0.05, z1 + 0.05));
    };
    dim(-XF, 0.02, XF, 0.02);
    ls.seg(P(-XF, 0.02), P(-XF, 0.5)); ls.seg(P(XF, 0.02), P(XF, 0.5));
    dim(AXLES[0], 0.2, AXLES[1], 0.2);
    ls.seg(P(AXLES[0], 0.2), P(AXLES[0], WR)); ls.seg(P(AXLES[1], 0.2), P(AXLES[1], WR));
    dim(XF + 0.35, 0, XF + 0.35, 1.45);
    ls.seg(P(-0.25, 1.45), P(XF + 0.45, 1.45));
    return {
      lines: ls.done(),
      labels: [
        { text: '4 750', p: [0, yd, -0.12] },
        { text: '2 880', p: [(AXLES[0] + AXLES[1]) / 2, yd, 0.08] },
        { text: '1 450', p: [XF + 0.5, yd, 0.72] },
      ],
    };
  }

  /** Punktewolke: flächengewichtet auf der Karosserie, Stirnflächen, Reifen-Tori */
  function samplePoints(n, rand) {
    const NS = 150, NV = 96, cum = new Float64Array(NS * NV);
    let total = 0;
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NV; j++) {
        const s = (i + 0.5) / NS, v = ((j + 0.5) / NV) * TAU;
        const p = body(s, v), q = body(s + 1 / NS, v), r = body(s, v + TAU / NV);
        const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2], bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
        total += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
        cum[i * NV + j] = total;
      }
    }
    const out = new Float32Array(n * 6);
    const nWheel = Math.floor(n * 0.12), nCap = Math.floor(n * 0.05), nBody = n - nWheel - nCap;
    let k = 0;
    while (k < nBody) {
      const u = rand() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
      const b = body((Math.floor(lo / NV) + rand()) / NS, (((lo % NV) + rand()) / NV) * TAU);
      if (inArch(b[0], b[2], b[3])) continue;
      out.set([b[0], b[1], b[2], b[3], b[4], 0], k * 6);
      k++;
    }
    for (let c = 0; c < nCap; c++, k++) {
      const s = c % 2 ? 0.004 : 0.996, b = body(s, rand() * TAU), f = Math.sqrt(rand()), zc = (TOP(s) + BOT(s)) / 2;
      out.set([b[0], b[1] * f, zc + (b[2] - zc) * f, 0, 0, 0], k * 6);
    }
    for (let w = 0; k < n; k++, w++) {
      const ph = rand() * TAU;
      out.set([w % 4, rand() * TAU, R0 + TA * Math.cos(ph), TB * Math.sin(ph), 0, 1], k * 6);
    }
    return out;
  }

  /** x-Koordinate in Ruhelage (zum Sortieren der Partikel) */
  const restX = (src, o) => (src[o + 5] === 1 ? AXLES[src[o] >> 1] + src[o + 2] * Math.cos(src[o + 1]) : src[o]);

  // Brennpunkte der vier Nichtlinearitäten + Zusammenhang Längsträger → Stirnwand
  const POIS = [
    { v: [1.0, 0.61, 0.42, 0, 1, PART.RAIL], name: 'Elastic-plastic material' },
    { v: [1.47, 0.52, 0.47, 0, 1, PART.RAIL], name: 'Buckling (plastic hinge)' },
    { v: [CRACK.x, 0.78, 0.42, 0, 1, PART.SILL], name: 'Joint failure rail ↔ rocker' },
    { v: [0.84, 0.14, 0.72, 0, 0, PART.BOOSTER], name: 'Engine tilts → booster tilts → firewall' },
  ];
  const LINK = { from: [1.4, 0.52, 0.47, 0, 1, PART.RAIL], to: [0.8, 0.14, 0.7, 0, 0, PART.FIREWALL] };

  S.Car = {
    L, XF, DMAX, AXLES, WR, WY, RA, PART, TOP, BOT, WID,
    body, sideAt, roofLine, CRACK, inArch, skinGrid, capGrid, wheelGrids, buildWire, buildWheelLines, buildDims, samplePoints, restX, POIS, LINK, Lines,
  };
})(window.STAGE = window.STAGE || {});
