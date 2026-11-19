/* =========================================================
   STAGE · Formationen
   Zielgeometrien für die Partikel: Karte, Data Lake,
   Tesserakt (4D), Knowledge Graph, Lenkgetriebe, Reihen-
   sechszylinder. Alle Werte schematisch.
   ========================================================= */
(function (S) {
  'use strict';
  const { TAU, rng } = S;

  /* ---------- Karte ---------- */
  const MAP_SCALE = 1.7, MAP_R = 15;
  const CITIES = [
    ['Hamburg', 53.551, 9.994], ['Berlin', 52.52, 13.405], ['Hanover', 52.375, 9.732],
    ['Bremen', 53.079, 8.802], ['Magdeburg', 52.121, 11.628], ['Cologne', 50.938, 6.96],
    ['Frankfurt', 50.11, 8.682], ['Leipzig', 51.34, 12.375], ['Dresden', 51.05, 13.738],
    ['Nuremberg', 49.452, 11.077], ['Stuttgart', 48.776, 9.183], ['Munich', 48.137, 11.576],
    ['Zurich', 47.377, 8.541], ['Salzburg', 47.809, 13.055], ['Innsbruck', 47.269, 11.404],
    ['Linz', 48.306, 14.286], ['Vienna', 48.208, 16.373], ['Graz', 47.071, 15.439],
    ['Prague', 50.075, 14.438], ['Amsterdam', 52.368, 4.904], ['Copenhagen', 55.676, 12.568],
    ['Passau', 48.574, 13.461], ['Kassel', 51.312, 9.48], ['Düsseldorf', 51.227, 6.773],
  ];

  function mapProject(lat0, lon0) {
    const k = Math.cos((lat0 * Math.PI) / 180);
    return (lat, lon) => [(lon - lon0) * k * MAP_SCALE, (lat - lat0) * MAP_SCALE, 0];
  }

  /** Kreisscheibe aus exakt n Rasterpunkten um den Standort. */
  function mapDots(n) {
    const step = Math.sqrt((Math.PI * MAP_R * MAP_R) / n);
    const m = Math.ceil(MAP_R / step) + 2, pts = [];
    for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) pts.push([i * step, j * step, Math.hypot(i, j) * step]);
    pts.sort((a, b) => a[2] - b[2]);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) out.set([pts[i][0], pts[i][1], 0], i * 3);
    return out;
  }

  /** Längen-/Breitengrade (innerhalb der Scheibe) + Randkreis als Linienpaare. */
  function graticule(lat0, lon0) {
    const P = mapProject(lat0, lon0), out = [];
    const run = (f, a0, a1) => {
      let prev = null;
      for (let a = a0; a <= a1 + 1e-6; a += 0.2) {
        const p = f(a), inside = Math.hypot(p[0], p[1]) < MAP_R;
        if (prev && inside && prev.inside) out.push(...prev.p, ...p);
        prev = { p, inside };
      }
    };
    for (let la = Math.ceil(lat0 - 10); la <= lat0 + 10; la++) run((lo) => P(la, lo), lon0 - 16, lon0 + 16);
    for (let lo = Math.ceil(lon0 - 16); lo <= lon0 + 16; lo++) run((la) => P(la, lo), lat0 - 10, lat0 + 10);
    for (let k = 0; k < 160; k++) {
      const a = (k / 160) * TAU, b = ((k + 1) / 160) * TAU;
      out.push(MAP_R * Math.cos(a), MAP_R * Math.sin(a), 0, MAP_R * Math.cos(b), MAP_R * Math.sin(b), 0);
    }
    return new Float32Array(out);
  }

  /* ---------- Data Lake: Fibonacci-Scheibe mit Wellen ---------- */
  function lake(n) {
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 6.4 * Math.sqrt((i + 0.5) / n), a = i * 2.39996323;
      out.set([r * Math.cos(a), r * Math.sin(a), r], i * 3);
    }
    return out;
  }
  const lakeZ = (x, y, r, t) => 0.2 * Math.sin(x * 1.1 + t * 0.9) * Math.cos(y * 0.9 - t * 0.6) + 0.1 * Math.sin(r * 2.4 - t * 1.6);

  /* ---------- Tesserakt (Curse of Dimensionality) ---------- */
  const TV = [], TE = [];
  for (let i = 0; i < 16; i++) TV.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (i < j) TE.push([i, j]); }

  /** 4D-Punkte: 62 % auf den 32 Kanten, Rest als Gauß-Wolke im Hyperraum. */
  function tess4(n, rand) {
    const out = new Float32Array(n * 4);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-6)) * Math.cos(TAU * rand()) * 0.42;
    for (let i = 0; i < n; i++) {
      let p;
      if (rand() < 0.62) {
        const [a, b] = TE[i % TE.length], t = rand();
        p = TV[a].map((v, k) => v + (TV[b][k] - v) * t + (rand() - 0.5) * 0.03);
      } else {
        p = [gauss(), gauss(), gauss(), gauss()];
      }
      out.set(p, i * 4);
    }
    return out;
  }

  /** Rotation in XW-, YZ- und ZW-Ebene, perspektivische Projektion 4D → 3D. */
  function tessProject(x, y, z, w, a, b, C, s, out, o) {
    let c = Math.cos(a), sn = Math.sin(a);
    const x1 = x * c - w * sn, w1 = x * sn + w * c;
    c = Math.cos(b); sn = Math.sin(b);
    const y1 = y * c - z * sn, z1 = y * sn + z * c;
    c = Math.cos(a * 0.62); sn = Math.sin(a * 0.62);
    const z2 = z1 * c - w1 * sn, w2 = z1 * sn + w1 * c;
    const f = s / (2.8 - w2);
    out[o] = C[0] + x1 * f; out[o + 1] = C[1] + y1 * f; out[o + 2] = C[2] + z2 * f;
  }

  /* ---------- Knowledge Graph ---------- */
  const KG = {
    nodes: [
      { id: 'm', label: 'Δ Geometry', type: 'Modification', tone: 'accent', p: [0, 0.2, 2.1] },
      { id: 'c', label: 'Longitudinal rail', type: 'Component', tone: 'blue', p: [-2.9, 0.9, 1.0] },
      { id: 'e', label: 'Firewall intrusion', type: 'Effect', tone: 'warn', p: [2.9, -0.7, 1.3] },
      { id: 'l', label: 'Frontal crash', type: 'Load case', tone: 'amber', p: [0.5, 2.6, -0.3] },
      { id: 'v', label: 'Model variant B', type: 'Variant', tone: 'violet', p: [-2.4, -1.9, -0.9] },
      { id: 's', label: 'Simulation #[n]', type: 'Simulation', tone: 'slate', p: [0.6, -2.8, -1.3] },
      { id: 'd', label: 'Design decision', type: 'Decision', tone: 'ink', p: [2.8, 1.8, -1.5] },
    ],
    edges: [['m', 'c'], ['m', 'e'], ['e', 'l'], ['v', 'm'], ['s', 'v'], ['s', 'e'], ['d', 'v'], ['c', 'l']],
    path: ['e', 'l', 'c', 'm', 'v', 's'],
  };

  /** Partikel um Knoten (Fibonacci-Kugeln), entlang Kanten und als Hintergrund-Graph. */
  function graph(n, C, rand) {
    const at = (p) => [C[0] + p[0], C[1] + p[1], C[2] + p[2]];
    const nodes = KG.nodes.map((nd) => at(nd.p));
    const idx = Object.fromEntries(KG.nodes.map((nd, i) => [nd.id, i]));
    const bg = [];
    for (let i = 0; i < 64; i++) {
      const u = rand() * 2 - 1, a = rand() * TAU, r = 4.6 + rand() * 2.8, q = Math.sqrt(1 - u * u);
      bg.push(at([r * q * Math.cos(a), r * q * Math.sin(a), r * u * 0.65]));
    }
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    const bgEdges = [];
    bg.forEach((p, i) => {
      bg.map((q, j) => [j, d2(p, q)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2)
        .forEach(([j]) => { if (i < j) bgEdges.push(p, bg[j]); });
    });
    nodes.forEach((p) => { const j = bg.map((q, k) => [k, d2(p, q)]).sort((a, b) => a[1] - b[1])[0][0]; bgEdges.push(p, bg[j]); });

    const pos = new Float32Array(n * 3), tone = new Int8Array(n);
    const nMain = Math.floor(n * 0.3), nEdge = Math.floor(n * 0.14), per = Math.ceil(nMain / nodes.length);
    for (let i = 0; i < n; i++) {
      let p;
      if (i < nMain) {
        const k = i % nodes.length, j = Math.floor(i / nodes.length);
        const y = 1 - (2 * (j + 0.5)) / per, r = Math.sqrt(Math.max(0, 1 - y * y)), a = j * 2.39996323;
        const rad = 0.34 * (0.7 + 0.3 * rand());
        p = [nodes[k][0] + rad * r * Math.cos(a), nodes[k][1] + rad * r * Math.sin(a), nodes[k][2] + rad * y];
        tone[i] = k;
      } else if (i < nMain + nEdge) {
        const [a, b] = KG.edges[i % KG.edges.length], A = nodes[idx[a]], B = nodes[idx[b]], t = rand();
        p = [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * t + (rand() - 0.5) * 0.05);
        tone[i] = -2;
      } else {
        const q = bg[i % bg.length], u = rand() * 2 - 1, a = rand() * TAU, r = 0.17 * Math.cbrt(rand()), s = Math.sqrt(1 - u * u);
        p = [q[0] + r * s * Math.cos(a), q[1] + r * s * Math.sin(a), q[2] + r * u];
        tone[i] = -1;
      }
      pos.set(p, i * 3);
    }
    return { pos, tone, nodes, idx, bgEdges: new Float32Array(bgEdges.flat()) };
  }

  /* ---------- Bauteile für Master- und Bachelorarbeit ---------- */
  function Builder(n, rand) {
    const pts = new Float32Array(n * 3), lines = [];
    let k = 0;
    return {
      rand,
      fill(share, f) { const m = Math.min(n - k, Math.round(n * share)); for (let i = 0; i < m; i++, k++) pts.set(f(), k * 3); },
      line(a, b) { lines.push(...a, ...b); },
      ring(c, axis, r, seg = 28) {
        for (let i = 0; i < seg; i++) {
          const p = (t) => {
            const a = (t / seg) * TAU, u = r * Math.cos(a), v = r * Math.sin(a);
            return axis === 'y' ? [c[0] + u, c[1], c[2] + v] : axis === 'x' ? [c[0], c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2]];
          };
          lines.push(...p(i), ...p(i + 1));
        }
      },
      done() { while (k < n) { pts.set(pts.subarray(((k * 7) % Math.max(k, 1)) * 3, ((k * 7) % Math.max(k, 1)) * 3 + 3), k * 3); k++; } return { pts, lines: new Float32Array(lines) }; },
    };
  }

  /** Zahnstangen-Lenkgetriebe mit Faltenbälgen, Spurstangen, Ritzel und Servo-Spirale. */
  function steering(n, rand) {
    const B = Builder(n, rand), Z = 1.0, R = () => rand() * TAU;
    const tube = (y, r) => { const a = R(); return [r * Math.cos(a), y, Z + r * Math.sin(a)]; };
    const bellow = (ay) => 0.19 + 0.07 * Math.abs(Math.sin(((ay - 1.5) / 0.65) * Math.PI * 6));
    B.fill(0.36, () => tube(-1.5 + 3 * rand(), 0.17));
    B.fill(0.24, () => { const s = rand() < 0.5 ? -1 : 1, ay = 1.5 + 0.65 * rand(); return tube(s * ay, bellow(ay)); });
    B.fill(0.08, () => { const s = rand() < 0.5 ? -1 : 1; return tube(s * (2.15 + 0.65 * rand()), 0.045); });
    B.fill(0.05, () => { const s = rand() < 0.5 ? -1 : 1, u = rand() * 2 - 1, a = R(), q = Math.sqrt(1 - u * u); return [0.09 * q * Math.cos(a), s * 2.88 + 0.09 * q * Math.sin(a), Z + 0.09 * u]; });
    const D = [-0.36, 0, 0.93], base = [0, 0.95, Z];
    B.fill(0.14, () => { const t = 0.85 * rand(), a = R(), r = 0.12; return [base[0] + D[0] * t + r * Math.cos(a) * 0.93, base[1] + r * Math.sin(a), base[2] + D[2] * t + r * Math.cos(a) * 0.36]; });
    B.fill(0.13, () => { const y = -1.0 + 0.8 * rand(), th = (y + 1) * 40, r = 0.21 + (rand() - 0.5) * 0.02; return [r * Math.cos(th), y, Z + r * Math.sin(th)]; });
    for (let y = -1.5; y <= 1.5 + 1e-6; y += 0.25) B.ring([0, y, Z], 'y', 0.17);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; B.line([0.17 * Math.cos(a), -1.5, Z + 0.17 * Math.sin(a)], [0.17 * Math.cos(a), 1.5, Z + 0.17 * Math.sin(a)]); }
    for (const s of [-1, 1]) {
      for (let f = 0; f <= 12; f++) { const ay = 1.5 + (0.65 * f) / 12; B.ring([0, s * ay, Z], 'y', bellow(ay)); }
      B.line([0, s * 2.15, Z], [0, s * 2.8, Z]);
      B.ring([0, s * 2.88, Z], 'y', 0.09, 16);
    }
    for (let t = 0; t <= 0.85; t += 0.17) B.ring([base[0] + D[0] * t, base[1], base[2] + D[2] * t], 'z', 0.12, 20);
    let prev = null;
    for (let y = -1.0; y <= -0.2; y += 0.01) { const th = (y + 1) * 40, p = [0.21 * Math.cos(th), y, Z + 0.21 * Math.sin(th)]; if (prev) B.line(prev, p); prev = p; }
    return B.done();
  }

  /** Reihensechszylinder: Laufbuchsen, Kolben, Kurbelwelle, Pleuel, Block. */
  function engine(n, rand) {
    const B = Builder(n, rand), R = () => rand() * TAU;
    const X = [0, 1, 2, 3, 4, 5].map((i) => -2.5 + i);
    const PH = [0, 240, 120, 120, 240, 0].map((d) => (d * Math.PI) / 180);
    const ZC = 0.45, CR = 0.28;
    const pin = (i) => [X[i], CR * Math.sin(PH[i]), ZC + CR * Math.cos(PH[i])];
    const piston = (i) => 1.45 + 0.28 * Math.cos(PH[i]);
    B.fill(0.48, () => { const i = Math.floor(rand() * 6), a = R(); return [X[i] + 0.4 * Math.cos(a), 0.4 * Math.sin(a), 1.0 + 1.1 * rand()]; });
    B.fill(0.1, () => { const i = Math.floor(rand() * 6), a = R(), r = 0.38 * Math.sqrt(rand()); return [X[i] + r * Math.cos(a), r * Math.sin(a), piston(i)]; });
    B.fill(0.12, () => { const x = -3 + 6 * rand(), a = R(); return [x, 0.12 * Math.cos(a), ZC + 0.12 * Math.sin(a)]; });
    B.fill(0.1, () => { const i = Math.floor(rand() * 6), p = pin(i), a = R(); return [p[0] + 0.25 * (rand() - 0.5), p[1] + 0.1 * Math.cos(a), p[2] + 0.1 * Math.sin(a)]; });
    B.fill(0.08, () => { const i = Math.floor(rand() * 6), p = pin(i), t = rand(); return [p[0], p[1] * (1 - t), p[2] + (piston(i) - 0.15 - p[2]) * t]; });
    B.fill(0.12, () => {
      const f = Math.floor(rand() * 6);
      const x = -3.1 + 6.2 * rand(), y = -0.62 + 1.24 * rand(), z = 0.15 + 2.15 * rand();
      return f < 2 ? [x, f ? 0.62 : -0.62, z] : f < 4 ? [x, y, f === 2 ? 0.15 : 2.3] : [f === 4 ? -3.1 : 3.1, y, z];
    });
    const bx = [-3.1, 3.1], by = [-0.62, 0.62], bz = [0.15, 2.3];
    for (const y of by) for (const z of bz) B.line([bx[0], y, z], [bx[1], y, z]);
    for (const x of bx) for (const z of bz) B.line([x, by[0], z], [x, by[1], z]);
    for (const x of bx) for (const y of by) B.line([x, y, bz[0]], [x, y, bz[1]]);
    X.forEach((x, i) => {
      B.ring([x, 0, 1.0], 'z', 0.4); B.ring([x, 0, 2.1], 'z', 0.4); B.ring([x, 0, piston(i)], 'z', 0.38, 24);
      B.line(pin(i), [x, 0, piston(i) - 0.15]);
      B.line([x - 0.5, 0, ZC], [x - 0.12, 0, ZC]); B.line([x - 0.12, 0, ZC], pin(i)); B.line(pin(i), [x + 0.12, 0, ZC]);
      B.ring(pin(i), 'x', 0.1, 14);
    });
    B.line([2.62, 0, ZC], [3.1, 0, ZC]);
    return B.done();
  }

  /* ---------- Stationen im Lebenslauf (chronologisch) ---------- */
  const STATIONS = [
    // align: Lage des Labels zur Station (r = rechts, l = links, t = oben, b = unten)
    { name: 'Vienna', lat: 48.2082, lon: 16.3738, note: 'School', align: 'r' },
    { name: 'Leoben', lat: 47.3765, lon: 15.0914, note: 'Study location', align: 'b' },
    { name: 'Steyr', lat: 48.039, lon: 14.4214, note: "Bachelor's thesis", align: 't' },
    { name: 'Schwäbisch Gmünd', lat: 48.7999, lon: 9.7976, note: "Master's thesis", align: 'l' },
    { name: 'Wolfsburg', lat: 52.4227, lon: 10.7865, note: 'PhD thesis', align: 'l' },
  ];

  /** Je Station eine Punkt-„Galaxie“: Fibonacci-Scheibe mit dichtem Kern und leichter Kuppel */
  function stationCloud(n, project, rand) {
    const pos = new Float32Array(n * 3), st = new Int8Array(n), K = STATIONS.length, per = Math.floor(n / K);
    for (let k = 0, i = 0; k < K; k++) {
      const c = project(STATIONS[k].lat, STATIONS[k].lon), cnt = k === K - 1 ? n - i : per;
      for (let j = 0; j < cnt; j++, i++) {
        const u = (j + 0.5) / cnt, r = 1.05 * Math.pow(u, 0.75), a = j * 2.39996323 + k;
        pos.set([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), 0.35 * Math.pow(1 - u, 1.6) + (rand() - 0.5) * 0.03], i * 3);
        st[i] = k;
      }
    }
    return { pos, st };
  }

  /* ---------- Lauf-Raum für die Anomalieerkennung ----------
     Jeder Punkt = ein Simulationslauf (schematisch). Drei Cluster = typische
     Deformationsmodi; abseits liegende Läufe = Anomalien. */
  const RUNS = {
    modes: [
      { name: 'Mode A · progressive folding', tone: 'accent', m: [-1.5, 0.5, 0.3], s: [0.6, 0.3, 0.32], rot: 0.5, share: 0.46 },
      { name: 'Mode B · global buckling', tone: 'blue', m: [1.35, -0.55, -0.1], s: [0.36, 0.6, 0.3], rot: -0.4, share: 0.32 },
      { name: 'Mode C · mixed mode', tone: 'violet', m: [0.1, 1.45, -0.75], s: [0.34, 0.28, 0.5], rot: 0.9, share: 0.2 },
    ],
    anomalies: [
      { name: 'Significant increase in intrusion', p: [2.7, 1.6, 1.25] },
      { name: 'Unexpected buckling mode', p: [-2.9, -1.5, -0.7] },
      { name: 'Structural integrity', p: [1.0, -2.5, -1.4] },
      { p: [-0.5, 3.0, 1.0] }, { p: [3.0, -2.2, -1.2] }, { p: [-2.6, 2.3, -1.3] },
    ],
  };

  function runs(n, rand) {
    const pos = new Float32Array(n * 3), kind = new Int8Array(n);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-6)) * Math.cos(TAU * rand());
    const nA = RUNS.anomalies.length * 26, nModes = n - nA - 60;
    let k = 0;
    RUNS.modes.forEach((md, mi) => {
      const cnt = mi === RUNS.modes.length - 1 ? nModes - k : Math.round(nModes * md.share);
      const c = Math.cos(md.rot), s = Math.sin(md.rot);
      for (let i = 0; i < cnt; i++, k++) {
        const x = gauss() * md.s[0], y = gauss() * md.s[1], z = gauss() * md.s[2];
        pos.set([md.m[0] + x * c - y * s, md.m[1] + x * s + y * c, md.m[2] + z], k * 3);
        kind[k] = mi;
      }
    });
    RUNS.anomalies.forEach((a, ai) => {
      for (let i = 0; i < 26; i++, k++) {
        const r = 0.07 * Math.cbrt(rand()), u = rand() * 2 - 1, t = rand() * TAU, q = Math.sqrt(1 - u * u);
        pos.set([a.p[0] + r * q * Math.cos(t), a.p[1] + r * q * Math.sin(t), a.p[2] + r * u], k * 3);
        kind[k] = 10 + ai;
      }
    });
    for (; k < n; k++) { // milde Ausreißer
      const u = rand() * 2 - 1, t = rand() * TAU, q = Math.sqrt(1 - u * u), r = 2.2 + rand() * 1.2;
      pos.set([r * q * Math.cos(t), r * q * Math.sin(t), r * u * 0.7], k * 3);
      kind[k] = 9;
    }
    return { pos, kind };
  }

  S.Forms = { CITIES, MAP_R, mapProject, mapDots, graticule, STATIONS, stationCloud, lake, lakeZ, TV, TE, tess4, tessProject, KG, graph, steering, engine, RUNS, runs, rng };
})(window.STAGE = window.STAGE || {});
