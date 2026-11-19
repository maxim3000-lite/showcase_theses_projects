/* =========================================================
   STAGE · Bühne
   Scroll-gesteuerte 3D-Szene hinter den Inhalten:
   Partikel-Formationen, CAD-Linien, FE-Netze (Außenhaut,
   Räder, Crashstruktur) mit Crash, Lastpfade, Anomalie-
   erkennung, Tesserakt, Knowledge Graph, Labels, FE-HUD.
   ========================================================= */
(function (S) {
  'use strict';
  const root = document.documentElement;
  const canvas = document.getElementById('stage');
  const plan = S.TIMELINES && S.TIMELINES[root.dataset.stage];
  if (!canvas || !plan || !root.classList.contains('has-stage')) return;
  const R = S.createRenderer(canvas);
  if (!R) { root.classList.remove('has-stage'); return; }

  const { TAU, clamp, lerp, smooth, ease, rng, V, M4, cssColor, mix3, turbo, Car, Crash, Forms, Structure, MeshSet } = S;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 900px)').matches;
  const N = small ? 5200 : 8400;
  const T0 = performance.now();
  const loc = document.querySelector('.locator');
  const lat0 = parseFloat(loc && loc.dataset.lat) || 52.42;
  const lon0 = parseFloat(loc && loc.dataset.lon) || 10.79;
  const isCar = plan.forms.includes('car');
  // Unterseiten: detailliertes Objekt als FE-Netz (objects.js), z. B. Lenkgetriebe oder Pleuel
  const OBJ = plan.mesh && S.Objects && S.Objects[plan.mesh] ? S.Objects[plan.mesh](small) : null;
  const OBJSETS = OBJ ? OBJ.sets.map((s) => Object.assign({}, s, { ms: new MeshSet(s.grids) })) : [];
  const toMap = Forms.mapProject(lat0, lon0);

  /* ---------- Farben aus den CSS-Tokens ---------- */
  let C = {};
  function readTheme() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    C = { dark };
    ['ink', 'muted', 'accent', 'blue', 'violet', 'warn', 'amber', 'slate', 'line-strong'].forEach((k) => { C[k] = cssColor('--' + k); });
    C.line = C['line-strong'];
    C.skin = dark ? [0.3, 0.37, 0.41] : [0.83, 0.86, 0.88];
    C.steel = dark ? [0.52, 0.58, 0.62] : [0.74, 0.77, 0.8];
    C.engine = dark ? [0.45, 0.5, 0.36] : [0.7, 0.74, 0.55];
    C.tire = dark ? [0.2, 0.23, 0.25] : [0.3, 0.32, 0.34];
    C.rim = dark ? [0.55, 0.6, 0.63] : [0.68, 0.71, 0.74];
    C.edge = dark ? [0.02, 0.03, 0.03] : [0.05, 0.06, 0.07];
  }
  readTheme();

  const rand = rng(11);
  const R1 = new Float32Array(N), R2 = new Float32Array(N);
  for (let i = 0; i < N; i++) { R1[i] = rand(); R2[i] = rand(); }
  const order = (n, key) => Array.from({ length: n }, (_, i) => i).sort((a, b) => key(a) - key(b));
  const permute = (src, stride, ord) => {
    const out = new Float32Array(src.length);
    ord.forEach((s, i) => out.set(src.subarray(s * stride, s * stride + stride), i * stride));
    return out;
  };
  const setCol = (arr, i, c, a) => { arr[i * 4] = c[0]; arr[i * 4 + 1] = c[1]; arr[i * 4 + 2] = c[2]; arr[i * 4 + 3] = a; };

  /* ---------- Fahrzeug: Pose (Crash-Kinematik) und Vertex-Transformation ---------- */
  let vb = 0, vbTarget = 0, poseDrive = NaN, pose = null;
  const tmp = [0, 0, 0];
  const poseFor = (drive) => { if (drive !== poseDrive) { poseDrive = drive; pose = Crash.pose(drive, S.XW); } return pose; };
  function carVertex(src, o, Q, out, oo) {
    let x = src[o], y = src[o + 1], z = src[o + 2];
    const part = src[o + 5];
    if (part === 1) { // Rad: rollen
      const w = src[o], th = src[o + 1] - Q.roll, rho = src[o + 2];
      x = Car.AXLES[w >> 1] + rho * Math.cos(th);
      y = (w & 1 ? -1 : 1) * (Car.WY + src[o + 3]);
      z = Car.WR + rho * Math.sin(th);
    }
    const e = Crash.deform(x, y, z, src[o + 3], src[o + 4], part, Q, vb, tmp);
    Crash.place(tmp, Q);
    out[oo] = tmp[0]; out[oo + 1] = tmp[1]; out[oo + 2] = tmp[2];
    return e;
  }

  /* ---------- Formationen (je N Partikel, nach x sortiert → kohärente Übergänge) ---------- */
  /* Stationen im Lebenslauf: je Station eine Punkt-„Galaxie“. Chronologisch gruppiert und innerhalb nach x
     sortiert → Station k baut den k-ten Abschnitt des Objekts; der Abflug erfolgt chronologisch gestaffelt. */
  const STATS = Forms.STATIONS.map((s, k) => ({ ...s, k, p: toMap(s.lat, s.lon) }));
  { // Start-Ansicht: Kamera zielt auf die Mitte aller Stationen (statt auf den aktuellen Standort)
    const xs = STATS.map((s) => s.p[0]), ys = STATS.map((s) => s.p[1]);
    const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0];
    S.BASE.tgt = c;
    S.BASE.eye = [c[0], c[1] - 3.8, 36.5];
  }
  const tau = (k) => 0.5 + k * 0.45; // Erscheinen im Intro (s)
  const stationColor = (k) => mix3(C.violet, C.accent, k / (STATS.length - 1));
  function makeMap() {
    const sc = Forms.stationCloud(N, toMap, rng(17)), ord = order(N, (i) => sc.st[i] * 1000 + sc.pos[i * 3]);
    const f = { pos: permute(sc.pos, 3, ord), st: Int8Array.from(ord, (s) => sc.st[s]), col: new Float32Array(N * 4), size: new Float32Array(N).fill(0.055), delay: new Float32Array(N), shown: false };
    for (let i = 0; i < N; i++) f.delay[i] = (f.st[i] / (STATS.length - 1)) * 0.55 + R1[i] * 0.15;
    f.paint = () => { for (let i = 0; i < N; i++) setCol(f.col, i, stationColor(f.st[i]), C.dark ? 0.8 : 0.9); };
    f.update = (st, t) => { // Stationen erscheinen nacheinander
      if (f.shown) return;
      const T = reduce ? 99 : t, r = STATS.map((s, k) => smooth(tau(k), tau(k) + 0.5, T));
      for (let i = 0; i < N; i++) f.size[i] = 0.055 * r[f.st[i]];
      f.shown = T > tau(STATS.length - 1) + 0.6;
    };
    return f;
  }

  function makeCar() {
    const raw = Car.samplePoints(N, rng(5));
    const src = permute(raw, 6, order(N, (i) => Car.restX(raw, i * 6)));
    const f = { src, pos: new Float32Array(N * 3), col: new Float32Array(N * 4), base: new Float32Array(N * 4), size: new Float32Array(N), size0: new Float32Array(N), key: '' };
    for (let i = 0; i < N; i++) f.size0[i] = (src[i * 6 + 5] === 1 ? 0.02 : 0.025) * (0.7 + 0.6 * R2[i]);
    f.paint = () => {
      for (let i = 0; i < N; i++) {
        const o = i * 6;
        if (src[o + 5] === 1) { setCol(f.base, i, C.dark ? C.muted : C.ink, 0.55); continue; }
        const s = clamp(src[o] / Car.L + 0.5);
        setCol(f.base, i, mix3(mix3(C.accent, C.blue, s), C.violet, clamp(0.5 - src[o + 4] * 0.5) * 0.7), C.dark ? 0.75 : 0.88);
      }
      f.key = '';
    };
    // Crash-Pose, Dehnungsfarben (cloudFringe) und „nur das Relevante“ (focus)
    f.update = (st) => {
      const Q = poseFor(st.drive);
      const key = `${st.drive.toFixed(4)}|${vb.toFixed(3)}|${st.cloudFringe.toFixed(2)}|${st.focus.toFixed(2)}`;
      if (key === f.key) return;
      f.key = key;
      const m = st.cloudFringe, fo = st.focus;
      for (let i = 0; i < N; i++) {
        const e = carVertex(src, i * 6, Q, f.pos, i * 3), b = i * 4;
        if (m > 0.01) {
          const t = turbo(0.06 + e * 0.94);
          f.col[b] = lerp(f.base[b], t[0], m); f.col[b + 1] = lerp(f.base[b + 1], t[1], m); f.col[b + 2] = lerp(f.base[b + 2], t[2], m);
        } else {
          f.col[b] = f.base[b]; f.col[b + 1] = f.base[b + 1]; f.col[b + 2] = f.base[b + 2];
        }
        f.col[b + 3] = f.base[b + 3] * (1 - fo * (1 - smooth(0.12, 0.45, e)));
        f.size[i] = f.size0[i] * (1 + fo * e * 0.9);
      }
    };
    return f;
  }

  function makeLake() {
    const raw = Forms.lake(N), base = permute(raw, 3, order(N, (i) => raw[i * 3]));
    const f = { pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N).fill(0.05) };
    f.paint = () => { for (let i = 0; i < N; i++) { const r = base[i * 3 + 2] / 6.4; setCol(f.col, i, mix3(C.blue, C.accent, r), 0.85 - 0.45 * r); } };
    f.update = (st, t) => {
      for (let i = 0; i < N; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        f.pos[i * 3] = S.XW + x; f.pos[i * 3 + 1] = y; f.pos[i * 3 + 2] = 0.25 + Forms.lakeZ(x, y, base[i * 3 + 2], t);
      }
    };
    return f;
  }

  const TESS_C = [S.XW, 0, 2.4];
  const tessAngles = (t) => [0.4 + t * 0.32, 0.25 + t * 0.19];
  function makeTess() {
    const raw = Forms.tess4(N, rng(9)), p4 = permute(raw, 4, order(N, (i) => raw[i * 4]));
    const f = { pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N).fill(0.034) };
    f.paint = () => { for (let i = 0; i < N; i++) setCol(f.col, i, mix3(C.violet, C.accent, (p4[i * 4 + 3] + 1) / 2), 0.85); };
    f.update = (st, t) => {
      const [a, b] = tessAngles(t);
      for (let i = 0; i < N; i++) Forms.tessProject(p4[i * 4], p4[i * 4 + 1], p4[i * 4 + 2], p4[i * 4 + 3], a, b, TESS_C, 1.5, f.pos, i * 3);
    };
    return f;
  }

  const RUN_C = [S.XW, 0, 2.4];
  const runAngle = (t) => (reduce ? 0.3 : 0.3 + t * 0.06);
  function makeRuns() {
    const r = Forms.runs(N, rng(31)), ord = order(N, (i) => r.pos[i * 3]);
    const base = permute(r.pos, 3, ord), kind = Int8Array.from(ord, (s) => r.kind[s]);
    const f = { pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N), key: '' };
    for (let i = 0; i < N; i++) f.size[i] = kind[i] >= 10 ? 0.05 : kind[i] === 9 ? 0.038 : 0.026;
    f.paint = () => { f.key = ''; };
    f.update = (st, t) => {
      const a = runAngle(t), ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < N; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        f.pos[i * 3] = RUN_C[0] + x * ca - y * sa; f.pos[i * 3 + 1] = RUN_C[1] + x * sa + y * ca; f.pos[i * 3 + 2] = RUN_C[2] + base[i * 3 + 2];
      }
      const key = `${st.anom.toFixed(2)}|${C.dark}`;
      if (key === f.key) return;
      f.key = key;
      const tones = Forms.RUNS.modes.map((m) => C[m.tone]);
      for (let i = 0; i < N; i++) { // Klassifikation wird mit „anom“ eingefärbt
        const k = kind[i];
        setCol(f.col, i, mix3(C.line, k >= 10 ? C.warn : k === 9 ? C.amber : tones[k], st.anom), k >= 10 ? 0.95 : k === 9 ? 0.8 : 0.75);
      }
    };
    return f;
  }

  function makeGraph() {
    const g = Forms.graph(N, [S.XW, 0, 2.6], rng(21)), ord = order(N, (i) => g.pos[i * 3]);
    const tone = Int8Array.from(ord, (s) => g.tone[s]);
    const f = { g, pos: permute(g.pos, 3, ord), col: new Float32Array(N * 4), size: new Float32Array(N) };
    for (let i = 0; i < N; i++) f.size[i] = tone[i] >= 0 ? 0.042 : tone[i] === -2 ? 0.03 : 0.028;
    f.paint = () => {
      const tones = Forms.KG.nodes.map((n) => C[n.tone] || C.ink);
      for (let i = 0; i < N; i++) {
        const t = tone[i];
        setCol(f.col, i, t >= 0 ? tones[t] : t === -2 ? C.accent : C.line, t >= 0 ? 0.9 : t === -2 ? 0.6 : 0.55);
      }
    };
    return f;
  }

  /** Partikel flächengewichtet auf den Netzen des Objekts verteilen (Ruhelage), entlang der Längsachse sortiert */
  function makeMeshObj() {
    const list = [], cum = [];
    let total = 0;
    OBJSETS.filter((s) => s.sample).forEach((s) => {
      const src = s.ms.src, Q = s.ms.quads;
      for (let q = 0; q < s.ms.nq; q++) {
        const a = Q[q * 4] * 6, b = Q[q * 4 + 1] * 6, d = Q[q * 4 + 3] * 6;
        const ux = src[b] - src[a], uy = src[b + 1] - src[a + 1], uz = src[b + 2] - src[a + 2];
        const vx = src[d] - src[a], vy = src[d + 1] - src[a + 1], vz = src[d + 2] - src[a + 2];
        total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) + 1e-9;
        cum.push(total);
        list.push([s.ms, q]);
      }
    });
    const rand = rng(13), raw = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rand() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
      const [ms, q] = list[lo], s = rand(), t = rand();
      const c = [0, 1, 2, 3].map((k) => ms.quads[q * 4 + k] * 6);
      for (let d = 0; d < 3; d++) {
        raw[i * 3 + d] = (1 - s) * (1 - t) * ms.src[c[0] + d] + s * (1 - t) * ms.src[c[1] + d] + s * t * ms.src[c[2] + d] + (1 - s) * t * ms.src[c[3] + d];
      }
    }
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < N; i++) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], raw[i * 3 + d]); hi[d] = Math.max(hi[d], raw[i * 3 + d]); }
    const ax = [0, 1, 2].reduce((m, d) => (hi[d] - lo[d] > hi[m] - lo[m] ? d : m), 0);
    const f = { pos: permute(raw, 3, order(N, (i) => raw[i * 3 + ax])), col: new Float32Array(N * 4), size: new Float32Array(N).fill(0.022) };
    f.paint = () => {
      for (let i = 0; i < N; i++) {
        const s = clamp((f.pos[i * 3 + ax] - lo[ax]) / (hi[ax] - lo[ax] || 1));
        setCol(f.col, i, mix3(mix3(C.accent, C.blue, s), C.violet, clamp((f.pos[i * 3 + 2] - lo[2]) / (hi[2] - lo[2] || 1)) * 0.45), C.dark ? 0.8 : 0.9);
      }
    };
    return f;
  }

  function makeObj(kind) {
    if (OBJ) return makeMeshObj();
    const o = Forms[kind](N, rng(13));
    const f = { pos: permute(o.pts, 3, order(N, (i) => o.pts[i * 3])), col: new Float32Array(N * 4), size: new Float32Array(N).fill(0.024) };
    f.lines = { pos: o.lines, n: o.lines.length / 3, col: new Float32Array((o.lines.length / 3) * 4) };
    f.paint = () => {
      for (let i = 0; i < N; i++) {
        const s = clamp((f.pos[i * 3] + f.pos[i * 3 + 1]) / 6 + 0.5);
        setCol(f.col, i, mix3(mix3(C.accent, C.blue, s), C.violet, clamp(f.pos[i * 3 + 2] / 2.4) * 0.5), C.dark ? 0.75 : 0.85);
      }
      for (let i = 0; i < f.lines.n; i++) setCol(f.lines.col, i, C.dark ? C.accent : C.ink, 0.55);
    };
    return f;
  }

  const makers = { map: makeMap, car: makeCar, lake: makeLake, tess: makeTess, runs: makeRuns, graph: makeGraph, obj: () => makeObj(plan.obj) };
  const cache = {};
  const FORMS = plan.forms.map((k) => cache[k] || (cache[k] = makers[k]()));

  /* ---------- Statische Linien ---------- */
  const lineSet = (pos, n = pos.length / 3) => ({ pos, n, col: new Float32Array(n * 4) });
  const GRID = (() => {
    const v = [], major = [];
    for (let x = -24; x <= 36; x++) { v.push(x, -16, 0, x, 16, 0); major.push(x % 5 === 0, x % 5 === 0); }
    for (let y = -16; y <= 16; y++) { v.push(-24, y, 0, 36, y, 0); major.push(y % 5 === 0, y % 5 === 0); }
    const L = lineSet(new Float32Array(v));
    L.major = major;
    return L;
  })();
  const GRAT = lineSet(Forms.graticule(lat0, lon0));
  const cities = Forms.CITIES.map(([name, la, lo]) => ({ name, p: toMap(la, lo) }))
    .filter((c) => Math.hypot(c.p[0], c.p[1]) < Forms.MAP_R * 0.93 && STATS.every((s) => Math.hypot(c.p[0] - s.p[0], c.p[1] - s.p[1]) > 2.0));
  const MAPDOTS = (() => { const n = small ? 3600 : 5600; return { n, pos: Forms.mapDots(n), col: new Float32Array(n * 4), size: new Float32Array(n).fill(0.06) }; })();
  const CITY = { pos: new Float32Array(cities.flatMap((c) => c.p)), col: new Float32Array(cities.length * 4), size: new Float32Array(cities.length).fill(0.16), n: cities.length };
  const WALL = (() => {
    const X = S.XW, v = [], seg = (a, b) => v.push(...a, ...b);
    for (let k = 0; k <= 8; k++) { const z = (2.6 * k) / 8; seg([X, -2.6, z], [X, 2.6, z]); }
    for (let k = 0; k <= 8; k++) { const y = -2.6 + (5.2 * k) / 8; seg([X, y, 0], [X, y, 2.6]); }
    return lineSet(new Float32Array(v));
  })();
  const WT = {
    pos: new Float32Array([S.XW, -2.6, 0, S.XW, 2.6, 0, S.XW, 2.6, 2.6, S.XW, -2.6, 0, S.XW, 2.6, 2.6, S.XW, -2.6, 2.6]),
    nrm: new Float32Array(18).map((_, i) => (i % 3 === 0 ? -1 : 0)),
    col: new Float32Array(24),
  };
  const BGE = cache.graph ? lineSet(cache.graph.g.bgEdges) : null;

  /* ---------- Fahrzeug: CAD-Linien, FE-Netze, Lastpfade ---------- */
  const layer = (src) => { const n = src.length / 6; return { src, n, pos: new Float32Array(n * 3), col: new Float32Array(n * 4), key: '' }; };
  let dims = null, LW = null, LR = null, LD = null, SKIN = null, WHEELS = null, STRUCT = null, LPATHS = [];
  if (isCar) {
    dims = Car.buildDims();
    LW = layer(Car.buildWire());
    LR = layer(Car.buildWheelLines());
    LD = layer(dims.lines);
    const skin = Car.skinGrid(small ? 0.075 : 0.05);
    SKIN = new MeshSet([skin, Car.capGrid(skin, true), Car.capGrid(skin, false)]);
    WHEELS = new MeshSet(Car.wheelGrids(small ? 36 : 56));
    STRUCT = new MeshSet(Structure.buildStructure(small ? 0.06 : 0.04));
    LPATHS = Structure.loadPaths();
  }
  function deformLayer(L, Q, key) {
    if (L.key === key) return;
    L.key = key;
    for (let i = 0; i < L.n; i++) carVertex(L.src, i * 6, Q, L.pos, i * 3);
  }

  // Netzfarben: Grundfarbe → Konturfarbe der plastischen Dehnung (fringe)
  let curFringe = 0, curLink = 0;
  function tint(col, i, base, e) {
    const b = i * 4;
    if (curFringe > 0.01) {
      const t = turbo(0.06 + e * 0.94);
      col[b] = lerp(base[0], t[0], curFringe); col[b + 1] = lerp(base[1], t[1], curFringe); col[b + 2] = lerp(base[2], t[2], curFringe);
    } else {
      col[b] = base[0]; col[b + 1] = base[1]; col[b + 2] = base[2];
    }
    col[b + 3] = 1;
  }
  const PT = Car.PART;
  const skinColor = (i, part, e, col) => tint(col, i, C.skin, e);
  const wheelColor = (i, part, e, col, src) => tint(col, i, src[i * 6 + 2] < 0.21 ? C.rim : C.tire, e);
  function structColor(i, part, e, col) {
    let base = part === PT.ENGINE ? C.engine : part === PT.BOOSTER ? C.slate : C.steel;
    if (curLink > 0.01 && (part === PT.RAIL || part === PT.FIREWALL)) base = mix3(base, part === PT.RAIL ? C.blue : C.warn, curLink);
    tint(col, i, base, e);
  }

  /* ---------- Dynamische Linien & Leuchtpunkte (pro Frame) ---------- */
  // overlay = ohne Tiefentest (Lastpfade, Brennpunkte, Zusammenhang – liegen sonst in den Bauteilen)
  function Dyn(key, cap, overlay) {
    const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4);
    let n = 0;
    const v = (p, c, a) => { if (n < cap) { pos[n * 3] = p[0]; pos[n * 3 + 1] = p[1]; pos[n * 3 + 2] = p[2]; setCol(col, n, c, a); n++; } };
    return { reset() { n = 0; }, seg(a, b, c, al0, al1 = al0) { v(a, c, al0); v(b, c, al1); }, draw() { R.lines(key, pos, col, n, 1, null, false, null, overlay); } };
  }
  const dyn = Dyn('dyn', 9000, false), over = Dyn('over', 6000, true);
  const spark = (() => {
    const cap = 160, pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), size = new Float32Array(cap);
    let n = 0;
    return {
      reset() { n = 0; },
      add(p, c, a, s) { if (n < cap && a > 0.01) { pos[n * 3] = p[0]; pos[n * 3 + 1] = p[1]; pos[n * 3 + 2] = p[2]; setCol(col, n, c, a); size[n] = s; n++; } },
      draw() { R.points('spark', pos, col, size, n, 1, null, true); },
    };
  })();
  function ring(c, r, col, a, mode, cam, D = dyn) {
    if (a < 0.01) return;
    let prev = null;
    for (let k = 0; k <= 40; k++) {
      const ang = (k / 40) * TAU, u = Math.cos(ang) * r, w = Math.sin(ang) * r;
      const p = mode === 'z'
        ? [c[0] + u, c[1] + w, c[2]]
        : [c[0] + cam.right[0] * u + cam.up[0] * w, c[1] + cam.right[1] * u + cam.up[1] * w, c[2] + cam.right[2] * u + cam.up[2] * w];
      if (prev) D.seg(prev, p, col, a);
      prev = p;
    }
  }
  /** fließende, dicke Linie entlang einer Punktfolge (Overlay) */
  function flow(pts, col, a, t, phase, speed = 6) {
    for (let k = 1; k < pts.length; k++) {
      const u = k / (pts.length - 1), pulse = reduce ? 0.6 : Math.pow(0.5 + 0.5 * Math.sin(u * 16 - t * speed + phase), 4);
      for (const dz of [-0.008, 0, 0.008]) over.seg([pts[k - 1][0], pts[k - 1][1], pts[k - 1][2] + dz], [pts[k][0], pts[k][1], pts[k][2] + dz], col, a * (0.45 + 0.55 * pulse));
    }
  }

  /* ---------- Labels (HTML über dem Canvas) ---------- */
  const labelLayer = document.querySelector('.stage-labels');
  /** auto = Label-Seite automatisch: in der rechten Bildhälfte zeigt es nach links (zum Motiv, weg vom Terminal) */
  function addLabel(cls, html, tone, auto) {
    const el = document.createElement('div');
    el.className = `slabel ${cls}`;
    el.innerHTML = html;
    if (tone) el.style.setProperty('--c', `var(--${tone})`);
    if (labelLayer) labelLayer.appendChild(el);
    return { el, on: false, auto };
  }
  function place(L, p, a, cam) {
    if (a > 0.02 && p) {
      const q = M4.project(cam.vp, p);
      if (q[2] > 0.05 && Math.abs(q[0]) < 1.1 && Math.abs(q[1]) < 1.1) {
        const sx = (q[0] * 0.5 + 0.5) * cam.W, sy = (0.5 - q[1] * 0.5) * cam.H;
        if (L.auto) { // links vom Punkt, sofern dort genug Platz ist (sonst rechts)
          if (!L.w) L.w = L.el.offsetWidth;
          L.el.classList.toggle('is-left', sx > cam.W * 0.3 && sx - L.w - 40 > 4);
        }
        L.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
        if (L.keep) keepInside(L, sx, sy, cam);
        L.el.style.opacity = Math.min(1, a).toFixed(3);
        L.on = true;
        return;
      }
    }
    if (L.on) { L.el.style.opacity = '0'; L.on = false; }
  }
  /** Label waagrecht in den sichtbaren Bereich schieben: nicht über den Rand, nicht unter das Textfenster */
  let deckEl = null, deckRect = null;
  function keepInside(L, sx, sy, cam) {
    const r = L.el.getBoundingClientRect();
    let right = cam.W - 8;
    if (deckRect && r.bottom > deckRect.top && r.top < deckRect.bottom) right = Math.min(right, deckRect.left - 10);
    const dx = r.left < 8 ? 8 - r.left : r.right > right ? right - r.right : 0;
    if (dx) L.el.style.transform = `translate3d(${(sx + dx).toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
  }
  const cityLabels = cities.map((c) => addLabel('slabel--city', c.name));
  const stationLabels = STATS.map((s) => Object.assign(addLabel(`slabel--station al-${s.align || 't'}`,
    `<b>${String(s.k + 1).padStart(2, '0')}</b>${s.name}${s.note ? `<small>${s.note}</small>` : ''}`), { keep: true }));
  const dimLabels = isCar ? dims.labels.map((d) => addLabel('slabel--dim', d.text)) : [];
  // Bauteil-Labels zeigen vom Terminal weg (Seite automatisch nach Bildposition)
  const poiLabels = isCar ? Car.POIS.map((p, k) => addLabel('slabel--poi', `<b>${k + 1}</b><span>${p.name}</span>`, null, true)) : [];
  const linkLabels = isCar ? [addLabel('slabel--link', 'X · Δ rail geometry', 'blue'), addLabel('slabel--link', 'Z · Δ firewall intrusion', 'warn')].map((L) => Object.assign(L, { keep: true })) : [];
  const nodeLabels = cache.graph ? Forms.KG.nodes.map((n) => addLabel('slabel--node', `<small>${n.type}</small>${n.label}`, n.tone)) : [];
  const objLabels = OBJ ? OBJ.labels.map((L) => Object.assign(addLabel(`slabel--part${L.cls ? ` ${L.cls}` : ''}`, L.text), { keep: true })) : [];
  const modeLabels = cache.runs ? Forms.RUNS.modes.map((m) => addLabel('slabel--node', `<small>Cluster</small>${m.name}`, m.tone)) : [];
  const anomLabels = cache.runs ? Forms.RUNS.anomalies.filter((a) => a.name).map((a) => addLabel('slabel--poi is-anom', `<b>!</b><span>${a.name}</span>`, null, true)) : [];

  /* ---------- Farben (abhängig vom Farbschema) ---------- */
  function paintAll() {
    Object.values(cache).forEach((f) => f.paint());
    for (let i = 0; i < MAPDOTS.n; i++) {
      const r = Math.hypot(MAPDOTS.pos[i * 3], MAPDOTS.pos[i * 3 + 1]) / Forms.MAP_R;
      setCol(MAPDOTS.col, i, mix3(C.accent, C.line, clamp(r * 1.5)), (C.dark ? 0.45 : 0.6) * Math.pow(1 - r, 0.6) + 0.05);
    }
    for (let i = 0; i < GRID.n; i++) setCol(GRID.col, i, C.line, GRID.major[i] ? 0.55 : 0.24);
    for (let i = 0; i < GRAT.n; i++) setCol(GRAT.col, i, C.line, 0.5);
    for (let i = 0; i < CITY.n; i++) setCol(CITY.col, i, C.dark ? C.muted : C.ink, 0.9);
    for (let i = 0; i < WALL.n; i++) setCol(WALL.col, i, C.dark ? C.muted : C.ink, 0.6);
    for (let i = 0; i < 6; i++) setCol(WT.col, i, C.line, 0.55);
    if (BGE) for (let i = 0; i < BGE.n; i++) setCol(BGE.col, i, C.line, 0.4);
    if (isCar) {
      for (let i = 0; i < LW.n; i++) setCol(LW.col, i, C.dark ? C.accent : C.ink, C.dark ? 0.42 : 0.5);
      for (let i = 0; i < LR.n; i++) setCol(LR.col, i, C.dark ? [0.78, 0.84, 0.86] : C.ink, 0.65);
      for (let i = 0; i < LD.n; i++) setCol(LD.col, i, C.dark ? C.accent : C.blue, 0.9);
      [SKIN, WHEELS, STRUCT].forEach((m) => { m.setEdgeColor(C.edge, C.dark ? 0.6 : 0.5); m.key = ''; });
    }
    OBJSETS.forEach((s) => { s.ms.setEdgeColor(C.edge, C.dark ? 0.55 : 0.45); s.ms.key = ''; });
  }
  paintAll();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); paintAll(); });

  /* ---------- Scroll → Szenenkoordinate σ → Zustand ---------- */
  const scenes = Array.from(document.querySelectorAll('[data-scene]'));
  const sceneIndex = new Map();
  scenes.forEach((el, i) => { if (!sceneIndex.has(el.dataset.scene)) sceneIndex.set(el.dataset.scene, i); });
  const KEYS = (() => {
    let cur = { ...S.BASE };
    const out = [];
    plan.keys.forEach(([scene, at, st]) => {
      if (!sceneIndex.has(scene)) return;
      cur = { ...cur, ...st };
      out.push({ s: sceneIndex.get(scene) + at, st: cur });
    });
    return out.sort((a, b) => a.s - b.s);
  })();

  function sigma() {
    const ref = window.innerHeight * 0.5;
    for (let i = 0; i < scenes.length; i++) {
      const r = scenes[i].getBoundingClientRect();
      if (r.top > ref) return i;
      if (r.bottom >= ref) return i + clamp((ref - r.top) / (r.height || 1));
    }
    return scenes.length;
  }
  function stateAt(s) {
    if (s <= KEYS[0].s) return KEYS[0].st;
    for (let i = 1; i < KEYS.length; i++) {
      if (s <= KEYS[i].s) {
        const a = KEYS[i - 1].st, b = KEYS[i].st, t = ease((s - KEYS[i - 1].s) / (KEYS[i].s - KEYS[i - 1].s || 1));
        const o = {};
        for (const k in a) o[k] = Array.isArray(a[k]) ? V.lerp(a[k], b[k], t) : lerp(a[k], b[k], t);
        return o;
      }
    }
    return KEYS[KEYS.length - 1].st;
  }

  /* ---------- Kamera ---------- */
  function camera(st, now) {
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1, aspect = W / H;
    let eye = st.eye;
    const tgt = st.tgt;
    if (!reduce) {
      const k = ease(clamp((now - T0) / 2600)); // Intro-Zoom auf den Standort
      if (k < 1) eye = V.add(tgt, V.scale(V.sub(eye, tgt), lerp(3.4, 1, k)));
      // sanfter Orbit um das Ziel (dreht die Draufsicht nicht)
      const a = now / 1000, yaw = Math.sin(a * 0.21) * 0.035, rel = V.sub(eye, tgt);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), d = V.len(rel);
      eye = [tgt[0] + rel[0] * cy - rel[1] * sy, tgt[1] + rel[0] * sy + rel[1] * cy, tgt[2] + rel[2] + Math.sin(a * 0.13) * d * 0.01];
    }
    const portrait = aspect < 1.1;
    const fit = Math.pow(Math.max(1, 1.5 / aspect), 0.62); // Hochformat: zurückfahren statt verzerren
    if (fit > 1) eye = V.add(tgt, V.scale(V.sub(eye, tgt), fit));
    const fov = (st.fov * Math.PI) / 180;
    const view = M4.lookAt(eye, tgt);
    const proj = M4.perspective(fov, aspect, 0.05, 400, portrait ? 0 : st.shift, (portrait ? 0.24 : 0) + st.lift);
    return {
      eye, W, H, vp: M4.mul(proj, view),
      focal: canvas.height / 2 / Math.tan(fov / 2),
      right: [view[0], view[4], view[8]], up: [view[1], view[5], view[9]],
    };
  }

  /* ---------- Ebenen ---------- */
  const PP = new Float32Array(N * 3), PC = new Float32Array(N * 4), PS = new Float32Array(N);
  function drawParticles(st, t, alpha) {
    if (alpha < 0.01) return;
    const phi = clamp(st.phi, 0, FORMS.length - 1);
    let k = Math.floor(phi), f = phi - k;
    if (k >= FORMS.length - 1) { k = FORMS.length - 1; f = 0; }
    const A = FORMS[k], B = f > 0 ? FORMS[k + 1] : A, dl = A.delay || B.delay;
    if (A.update) A.update(st, t);
    if (B !== A && B.update) B.update(st, t);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, i4 = i * 4;
      let e = 0;
      if (f > 0) { e = clamp(f * 1.7 - (dl ? dl[i] : R1[i] * 0.7)); e = e * e * (3 - 2 * e); }
      const lift = Math.sin(Math.PI * e) * (0.4 + 1.8 * R2[i]) + (reduce ? 0 : 0.006 * Math.sin(t * 1.7 + R1[i] * 40));
      PP[i3] = lerp(A.pos[i3], B.pos[i3], e);
      PP[i3 + 1] = lerp(A.pos[i3 + 1], B.pos[i3 + 1], e);
      PP[i3 + 2] = lerp(A.pos[i3 + 2], B.pos[i3 + 2], e) + lift;
      PC[i4] = lerp(A.col[i4], B.col[i4], e); PC[i4 + 1] = lerp(A.col[i4 + 1], B.col[i4 + 1], e);
      PC[i4 + 2] = lerp(A.col[i4 + 2], B.col[i4 + 2], e); PC[i4 + 3] = lerp(A.col[i4 + 3], B.col[i4 + 3], e);
      PS[i] = lerp(A.size[i], B.size[i], e);
    }
    R.points('pts', PP, PC, PS, N, alpha);
  }

  function drawMap(st, t, A, cam) {
    const a = st.map * A, T = reduce ? 99 : t;
    cityLabels.forEach((L, k) => place(L, cities[k].p, a * 0.8, cam));
    STATS.forEach((s, k) => place(stationLabels[k], [s.p[0], s.p[1], 0.75], a * smooth(tau(k), tau(k) + 0.4, T), cam));
    if (a < 0.01) return;
    R.points('mapdots', MAPDOTS.pos, MAPDOTS.col, MAPDOTS.size, MAPDOTS.n, a);
    R.lines('grat', GRAT.pos, GRAT.col, GRAT.n, a);
    R.points('cities', CITY.pos, CITY.col, CITY.size, CITY.n, a);
    // Route durch die Stationen (chronologisch, als Bögen über der Karte, im Intro gezeichnet)
    for (let k = 0; k < STATS.length - 1; k++) {
      const pr = clamp((T - tau(k)) / 0.45);
      if (pr <= 0) break;
      const p0 = STATS[k].p, p1 = STATS[k + 1].p, h = 0.25 + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.18;
      const c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, h];
      const bez = (u) => [0, 1, 2].map((d) => (1 - u) * (1 - u) * p0[d] + 2 * u * (1 - u) * c[d] + u * u * p1[d]);
      let prev = bez(0);
      for (let j = 1; j <= 40; j++) {
        const u = (j / 40) * pr, q = bez(u);
        const pulse = reduce ? 0.8 : 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin((k + u) * 6 - t * 3), 3);
        dyn.seg(prev, q, mix3(stationColor(k), stationColor(k + 1), u), a * pulse);
        prev = q;
      }
      if (pr < 1) spark.add(prev, stationColor(k + 1), a, 0.25);
    }
    STATS.forEach((s, k) => ring([s.p[0], s.p[1], 0.02], 1.2, stationColor(k), a * 0.45 * smooth(tau(k), tau(k) + 0.4, T), 'z', cam));
    const fixed = reduce || !loc || loc.classList.contains('is-fixed');
    if (!fixed) return;
    dyn.seg([0, 0, 0], [0, 0, 2.6], C.accent, a, 0);
    for (let k = 0; k < 3; k++) { const ph = (t * 0.45 + k / 3) % 1; ring([0, 0, 0.03], 0.25 + ph * 3.4, C.accent, a * (1 - ph) * 0.9, 'z', cam); }
    ring([0, 0, 0.03], 0.2, C.accent, a, 'z', cam);
    spark.add([0, 0, 0.05], C.accent, a, 0.45);
  }

  const pp = new Float32Array(3);
  const at = (v, Q) => { carVertex(v, 0, Q, pp, 0); return [pp[0], pp[1], pp[2]]; };
  function drawCar(st, t, A, cam) {
    const Q = poseFor(st.drive);
    const pk = `${st.drive.toFixed(4)}|${vb.toFixed(3)}`, fk = `${st.fringe.toFixed(2)}|${C.dark}`;
    const def = (src, o, out, oo) => carVertex(src, o, Q, out, oo);
    const fog = [cam.eye[0], cam.eye[1], cam.eye[2], 11]; // Netzkanten blenden mit Abstand aus
    curFringe = st.fringe;
    curLink = st.link;
    if (st.wall > 0.01) {
      R.tris('wallT', WT.pos, WT.nrm, WT.col, 6, st.wall * A * 0.45);
      R.lines('wall', WALL.pos, WALL.col, WALL.n, st.wall * A);
    }
    if (st.mesh > 0.01) { SKIN.update(`${pk}|${fk}`, def, skinColor, Q.c); SKIN.draw(R, 'skin', st.mesh * A, st.mesh * A * 0.85, fog); }
    const wa = Math.max(st.mesh, st.xray * 0.3) * A; // im Röntgenblick durchscheinend
    if (wa > 0.01) { WHEELS.update(`${pk}|${fk}`, def, wheelColor, 0); WHEELS.draw(R, 'wheels', wa, wa * 0.8, fog); }
    if (st.xray > 0.01) { STRUCT.update(`${pk}|${fk}|${st.link.toFixed(2)}`, def, structColor, Q.c); STRUCT.draw(R, 'struct', st.xray * A, st.xray * A * 0.9, fog); }
    if (st.wire > 0.01) {
      deformLayer(LW, Q, pk); R.lines('wire', LW.pos, LW.col, LW.n, st.wire * A);
      deformLayer(LR, Q, pk); R.lines('wheelL', LR.pos, LR.col, LR.n, st.wire * A);
    }
    if (st.dims > 0.01) { deformLayer(LD, Q, pk); R.lines('dims', LD.pos, LD.col, LD.n, st.dims * A); }
    dims.labels.forEach((d, k) => place(dimLabels[k], [d.p[0] + Q.x, d.p[1], d.p[2]], st.dims * A, cam));

    // Lastpfade beim Aufprall
    const la = st.loads * A;
    if (la > 0.01) {
      LPATHS.forEach((lp, li) => {
        const col = lp.tone === 'ink' ? (C.dark ? C.muted : C.ink) : C[lp.tone], pts = lp.v.map((v) => at(v, Q));
        flow(pts, col, la, t, li * 0.7);
        for (let s = 0; s < 3; s++) { const u = ((reduce ? 0 : t * 0.25) + s / 3 + li * 0.13) % 1; spark.add(pts[Math.floor(u * (pts.length - 1))], col, la, 0.06); }
      });
    }

    // Riss an der Fügestelle: die Ufer ziehen auseinander – Pfeile entlang des Profils wie in der Detailgrafik
    const ca = st.xray * st.poi2 * A * smooth(0.45, 0.7, Q.c);
    if (ca > 0.02) {
      // liegen flach auf der Oberseite des Profils (z 0.44), Spitzen nach außen
      const R0 = (dx, dy = 0) => at([Car.CRACK.x + dx, 0.78 + dy, 0.44, 0, 0, PT.RIGID], Q);
      for (const dir of [-1, 1]) {
        const a0 = R0(dir * 0.07), a1 = R0(dir * 0.28);
        for (const o of [-0.006, -0.003, 0, 0.003, 0.006]) over.seg([a0[0], a0[1] + o, a0[2]], [a1[0], a1[1] + o, a1[2]], C.warn, ca);
        for (const s of [-1, 1]) {
          const h = R0(dir * 0.21, s * 0.04);
          for (const o of [-0.003, 0, 0.003]) over.seg([a1[0], a1[1], a1[2] + o], [h[0], h[1], h[2] + o], C.warn, ca);
        }
      }
    }

    // Brennpunkte der Nichtlinearitäten
    Car.POIS.forEach((poi, k) => {
      const w = Math.max(st['poi' + k], st.poiAll) * A;
      if (w < 0.01) { place(poiLabels[k], null, 0, cam); return; }
      const p = at(poi.v, Q), dist = V.len(V.sub(cam.eye, p));
      const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 3 + k);
      ring(p, dist * (0.02 + 0.01 * pulse), C.warn, w, 'bb', cam, over);
      ring(p, dist * 0.034, C.warn, w * 0.35, 'bb', cam, over);
      spark.add(p, C.warn, w, dist * 0.012);
      poiLabels[k].el.classList.toggle('is-compact', st['poi' + k] < 0.5); // Überblick: nur Nummer (Legende in der Karte)
      place(poiLabels[k], p, w, cam);
    });

    // Zusammenhang Längsträger (X) → Stirnwand (Z)
    const lk = st.link * A;
    if (lk > 0.01) {
      const p0 = at(Car.LINK.from, Q), p1 = at(Car.LINK.to, Q), m = V.lerp(p0, p1, 0.5), c = [m[0], m[1] + 0.25, m[2] + 0.8];
      const bez = (u) => V.add(V.add(V.scale(p0, (1 - u) * (1 - u)), V.scale(c, 2 * u * (1 - u))), V.scale(p1, u * u));
      const pts = Array.from({ length: 49 }, (_, k) => bez(k / 48));
      for (let k = 1; k < pts.length; k++) {
        const u = k / 48, pulse = reduce ? 0.6 : Math.pow(0.5 + 0.5 * Math.sin(u * 14 - t * 5), 4);
        for (const dz of [-0.008, 0, 0.008]) over.seg([pts[k - 1][0], pts[k - 1][1], pts[k - 1][2] + dz], [pts[k][0], pts[k][1], pts[k][2] + dz], mix3(C.blue, C.warn, u), lk * (0.45 + 0.55 * pulse));
      }
      for (let k = 0; k < 3; k++) { const u = ((reduce ? 0 : t * 0.35) + k / 3) % 1; spark.add(bez(u), mix3(C.blue, C.warn, u), lk, 0.05); }
      spark.add(p0, C.blue, lk, 0.07);
      spark.add(p1, C.warn, lk, 0.07);
    }
    place(linkLabels[0], at(Car.LINK.from, Q), lk, cam);
    place(linkLabels[1], at(Car.LINK.to, Q), lk, cam);
  }

  /** Anomalieerkennung: Cluster-Grenzen (2,4 σ), markierte Ausreißer */
  function drawRuns(st, t, A, cam) {
    if (!cache.runs) return;
    const a = st.anom * A, rot = runAngle(t), cr = Math.cos(rot), sr = Math.sin(rot);
    const W = (p) => [RUN_C[0] + p[0] * cr - p[1] * sr, RUN_C[1] + p[0] * sr + p[1] * cr, RUN_C[2] + p[2]];
    Forms.RUNS.modes.forEach((m, k) => {
      place(modeLabels[k], W([m.m[0], m.m[1], m.m[2] + m.s[2] * 2.6 + 0.3]), a * 0.9, cam);
      if (a < 0.01) return;
      const c = Math.cos(m.rot), s = Math.sin(m.rot), K = 2.4;
      const P3 = (x, y, z) => W([m.m[0] + x * c - y * s, m.m[1] + x * s + y * c, m.m[2] + z]);
      for (let plane = 0; plane < 3; plane++) {
        let prev = null;
        for (let j = 0; j <= 64; j++) {
          const ca = Math.cos((j / 64) * TAU) * K, sa = Math.sin((j / 64) * TAU) * K;
          const p = plane === 0 ? P3(ca * m.s[0], sa * m.s[1], 0) : plane === 1 ? P3(ca * m.s[0], 0, sa * m.s[2]) : P3(0, ca * m.s[1], sa * m.s[2]);
          if (prev) dyn.seg(prev, p, C[m.tone], a * 0.42);
          prev = p;
        }
      }
    });
    let named = 0;
    Forms.RUNS.anomalies.forEach((an, k) => {
      const p = W(an.p);
      if (an.name) place(anomLabels[named++], p, a, cam);
      if (a < 0.01) return;
      const dist = V.len(V.sub(cam.eye, p)), pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 3 + k);
      ring(p, dist * (0.018 + 0.008 * pulse), C.warn, a, 'bb', cam);
      if (an.name) ring(p, dist * 0.032, C.warn, a * 0.35, 'bb', cam);
    });
  }

  /** Objekt der Unterseite als FE-Netz: Pose (Animation/Crack), Farben (Härte/Riss), Bauteil-Beschriftungen */
  function drawObj(st, t, A, cam) {
    const Q = OBJ.pose(st, reduce ? 0 : t);
    const key = `${OBJ.key(Q)}|${st.fringe.toFixed(2)}|${C.dark}`;
    const fog = [cam.eye[0], cam.eye[1], cam.eye[2], 14];
    const deform = (src, o, out, oo) => OBJ.vertex(src, o, Q, out, oo);
    const paint = (i, part, e, col) => {
      const c = OBJ.color(part, e, st, C);
      col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = 1;
    };
    // undurchsichtige Sätze zuerst, durchscheinende danach (sie schreiben keine Tiefe)
    const vis = OBJSETS.map((s) => [s, st.mesh * A * s.alpha(st)]).filter(([, a]) => a >= 0.01);
    [...vis.filter(([, a]) => a > 0.55), ...vis.filter(([, a]) => a <= 0.55)].forEach(([s, a]) => {
      s.ms.update(key, deform, paint, 0);
      s.ms.draw(R, s.key, a, a * s.edge, fog);
    });
    if (OBJ.overlay) OBJ.overlay(Q, st, cam, (p, q, tone, a) => over.seg(p, q, C[tone], a * st.mesh * A));
    OBJ.labels.forEach((L, k) => {
      const on = typeof L.on === 'function' ? L.on(st) : st[L.on] || 0;
      place(objLabels[k], OBJ.labelPos(L, Q, cam), clamp(on) * st.mesh * A, cam);
    });
  }

  const TP = new Float32Array(16 * 3);
  function drawTess(st, t, A) {
    const a = st.tess * A;
    if (a < 0.01 || !cache.tess) return;
    const [aa, bb] = tessAngles(t);
    Forms.TV.forEach((v, i) => Forms.tessProject(v[0], v[1], v[2], v[3], aa, bb, TESS_C, 1.5, TP, i * 3));
    const vtx = (i) => TP.subarray(i * 3, i * 3 + 3);
    Forms.TE.forEach(([i, j]) => dyn.seg(vtx(i), vtx(j), C.violet, a * 0.8));
    Forms.TV.forEach((v, i) => spark.add(vtx(i), C.accent, a, 0.09));
  }

  function drawGraph(st, t, A, cam) {
    const G = cache.graph;
    if (!G) return;
    const a = st.edges * A, g = G.g, node = (id) => g.nodes[g.idx[id]];
    const path = Forms.KG.path, segs = path.length - 1, prog = st.path * segs;
    nodeLabels.forEach((L, k) => {
      place(L, [g.nodes[k][0], g.nodes[k][1], g.nodes[k][2] + 0.62], a, cam);
      const hit = path.indexOf(Forms.KG.nodes[k].id);
      L.el.classList.toggle('is-hit', st.path > 0.01 && hit >= 0 && hit <= prog + 0.02);
    });
    if (a < 0.01) return;
    R.lines('bgE', BGE.pos, BGE.col, BGE.n, a);
    Forms.KG.edges.forEach(([u, w]) => dyn.seg(node(u), node(w), C.dark ? C.muted : C.ink, a * 0.55));
    for (let k = 0; k < segs; k++) {
      const pr = clamp(prog - k);
      if (pr <= 0) break;
      const p0 = node(path[k]), end = V.lerp(p0, node(path[k + 1]), pr);
      for (const dz of [-0.02, 0, 0.02]) dyn.seg([p0[0], p0[1], p0[2] + dz], [end[0], end[1], end[2] + dz], C.accent, a);
      spark.add(end, C.accent, a, pr < 1 ? 0.32 : 0.18);
    }
    if (st.path > 0.01) spark.add(node(path[0]), C.warn, a, 0.3);
  }

  /* ---------- FE-HUD ---------- */
  const hud = document.querySelector('.fe-hud');
  const hudEls = hud ? Object.fromEntries(Array.from(hud.querySelectorAll('[data-hud]')).map((el) => [el.dataset.hud, el])) : {};
  const hudText = (k, v) => { const el = hudEls[k]; if (el && el.textContent !== v) el.textContent = v; };
  if (isCar) {
    hudText('nodes', (SKIN.n + WHEELS.n + STRUCT.n).toLocaleString('en-US'));
    hudText('elems', (SKIN.nq + WHEELS.nq + STRUCT.nq).toLocaleString('en-US'));
  }
  function hudUpdate(st, A) {
    if (!hud) return;
    hud.style.opacity = (isCar ? Math.max(st.mesh, st.fringe) * A : 0).toFixed(3);
    hud.classList.toggle('is-crash', st.fringe > 0.05);
    if (isCar) hudText('step', `${Math.round(poseFor(st.drive).p * 40)} / 40`);
  }

  /* ---------- Hauptschleife ---------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  let sCur = null;
  function frame(now) {
    requestAnimationFrame(frame);
    resize();
    const sT = sigma();
    sCur = sCur === null || reduce ? sT : sCur + (sT - sCur) * 0.14; // Glättung: höher = folgt dem Scrollen schneller
    if (Math.abs(sT - sCur) < 1e-4) sCur = sT;
    const st = stateAt(sCur);
    const t = reduce ? 0 : (now - T0) / 1000;
    vb += (vbTarget - vb) * (reduce ? 1 : 0.07);
    if (Math.abs(vbTarget - vb) < 0.002) vb = vbTarget;

    const cam = camera(st, now);
    const A = 1 - 0.65 * st.dim;
    if (!deckEl) deckEl = document.querySelector('.deck'); // das Textfenster erzeugt main.js
    deckRect = deckEl ? deckEl.getBoundingClientRect() : null;
    R.begin(cam.vp, cam.eye, cam.focal, C.dark);
    dyn.reset();
    over.reset();
    spark.reset();
    R.lines('grid', GRID.pos, GRID.col, GRID.n, st.grid * A, [st.tgt[0], st.tgt[1], 0, 13]);
    drawMap(st, t, A, cam);
    if (isCar) drawCar(st, t, A, cam);
    if (cache.obj && cache.obj.lines) R.lines('obj', cache.obj.lines.pos, cache.obj.lines.col, cache.obj.lines.n, st.wire * A);
    if (OBJ) drawObj(st, t, A, cam);
    drawTess(st, t, A);
    drawRuns(st, t, A, cam);
    drawGraph(st, t, A, cam);
    drawParticles(st, t, st.pts * A);
    dyn.draw();
    over.draw();
    spark.draw();
    hudUpdate(st, A);
  }

  S.setVariant = (v) => { vbTarget = v === 'B' ? 1 : 0; };
  requestAnimationFrame(frame);
})(window.STAGE = window.STAGE || {});
