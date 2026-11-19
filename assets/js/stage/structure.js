/* =========================================================
   STAGE · Crashstruktur (schematisch, angelehnt an moderne
   Rohkarossen): Biegequerträger, Crashboxen mit Sicken,
   Längsträger → Schweller und Obergurt → A-Säule → Dach-
   rahmen jeweils als durchgehendes Profil, Scharnier- und
   B-Säule, Fahrschemel, Stirnwand mit Windlauf, Quermotor
   mit Getriebe, Bremskraftverstärker (BKV) und Haupt-
   bremszylinder. Alles als strukturierte Netze.
   ========================================================= */
(function (S) {
  'use strict';
  const { TAU, clamp, V, Car } = S;
  const P = Car.PART;

  /** Catmull-Rom-Glättung eines Kontrollpolygons → dichte Polylinie */
  function smoothPath(ctrl, per = 16) {
    if (ctrl.length < 3) return ctrl;
    const out = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(i - 1, 0)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(i + 2, ctrl.length - 1)];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0, 1, 2].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
  }

  /** Polylinie nach Bogenlänge in n Punkte (gleiche Abstände) teilen */
  function resample(poly, n) {
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + V.len(V.sub(poly[i], poly[i - 1])));
    const total = cum[cum.length - 1], out = [];
    for (let k = 0, i = 0; k < n; k++) {
      const t = (total * k) / (n - 1);
      while (i < poly.length - 2 && cum[i + 1] < t) i++;
      out.push(V.lerp(poly[i], poly[i + 1], clamp((t - cum[i]) / ((cum[i + 1] - cum[i]) || 1))));
    }
    return { pts: out, total };
  }

  /** Querschnitt (Superellipse) mit m Punkten gleicher Bogenlänge → [[x, z, nx, nz], …] */
  function section(w, h, m, round) {
    const e = round ? 1 : 0.3, RES = 240, raw = [], c = [0];
    for (let k = 0; k <= RES; k++) {
      const t = (k / RES) * TAU, cx = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), e), cz = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), e);
      raw.push([cx * w / 2, cz * h / 2, cx, cz]);
      if (k) c.push(c[k - 1] + Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1]));
    }
    const out = [];
    for (let j = 0, k = 0; j < m; j++) {
      const t = (c[RES] * j) / m;
      while (k < RES - 1 && c[k + 1] < t) k++;
      const f = clamp((t - c[k]) / ((c[k + 1] - c[k]) || 1)), a = raw[k], b = raw[k + 1];
      const n = Math.hypot(a[2], a[3]) || 1;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] / n, a[3] / n]);
    }
    return out;
  }

  /** Rohr entlang eines Pfads (Kontrollpunkte von vorn nach hinten); opt.scale(u) formt Sicken,
      opt.round = Kreisquerschnitt, opt.partAt(p) = Bauteil je Ring,
      opt.crack = { x, reach, part }: Zickzack-Riss um das Profil (wie in der Detailgrafik) */
  function tube(ctrl, w, h, part, H, opt = {}) {
    const path = smoothPath(ctrl), total = resample(path, 2).total;
    const dense = resample(path, Math.max(2, Math.round(total / H) + 1)).pts;
    const m = Math.max(8, Math.round((2 * (w + h)) / H / 4) * 4);
    const sec = section(w, h, m, opt.round), nu = dense.length, src = new Float32Array(nu * m * 6);
    for (let i = 0; i < nu; i++) {
      const T = V.norm(V.sub(dense[Math.min(i + 1, nu - 1)], dense[Math.max(i - 1, 0)]));
      let N1 = V.cross([0, 0, 1], T);
      if (V.len(N1) < 0.2) N1 = V.cross([0, 1, 0], T);
      N1 = V.norm(N1);
      const N2 = V.cross(T, N1), sc = opt.scale ? opt.scale(i / (nu - 1)) : 1;
      sec.forEach(([x, z, nx, nz], j) => {
        const p = V.add(dense[i], V.add(V.scale(N1, x * sc), V.scale(N2, z * sc)));
        const n = V.add(V.scale(N1, nx), V.scale(N2, nz));
        src.set([p[0], p[1], p[2], n[1], n[2], opt.partAt ? opt.partAt(dense[i]) : part], (i * m + j) * 6);
      });
    }
    let fail = opt.fail;
    if (opt.crack) {
      // Risslinie je Spalte j (Ring-Index): zickzackförmig um das Profil. Knoten davor (kleinerer Index = weiter vorn)
      // werden zum Rissufer (eigenes Bauteil → öffnet sich); gelöscht werden alle Elemente, die beide Ufer verbinden.
      const cr = opt.crack;
      let i0 = 0;
      dense.forEach((p, i) => { if (Math.abs(p[0] - cr.x) < Math.abs(dense[i0][0] - cr.x)) i0 = i; });
      const cj = (j) => i0 + Math.round(1.1 * Math.sin(j * 0.8) + 0.6 * Math.sin(j * 2.1 + 1.3));
      const down = sec.map((q) => Math.acos(clamp(q[3], -1, 1)) / Math.PI); // 0 = oben (Zugseite) … 1 = unten
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < m; j++) if (i <= cj(j) && dense[i][0] - cr.x < cr.reach) src[(i * m + j) * 6 + 5] = cr.part;
      }
      fail = (cx, cy, cz, i, j) => {
        const a = cj(j), b = cj((j + 1) % m);
        return i >= Math.min(a, b) && i <= Math.max(a, b) ? 0.48 + 0.21 * (down[j] + down[(j + 1) % m]) : 2;
      };
    }
    return { nu, nv: m, wrapU: false, wrapV: true, src, fail };
  }

  /** Blech über (u, v) ∈ [0,1]²; fail(cx,cy,cz) → Crash-Level, ab dem ein Element gelöscht wird */
  function plate(fn, nu, nv, part, fail) {
    const src = new Float32Array(nu * nv * 6);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) src.set([...fn(i / (nu - 1), j / (nv - 1)), 0, 0, part], (i * nv + j) * 6);
    return { nu, nv, wrapU: false, wrapV: false, src, fail };
  }

  /** Quader aus sechs Blechen */
  function box(a, b, part, H) {
    const n = (l) => Math.max(2, Math.round(l / H) + 1);
    const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = (u, v, w) => [a[0] + u * dx, a[1] + v * dy, a[2] + w * dz];
    return [
      plate((u, v) => L(0, u, v), n(dy), n(dz), part), plate((u, v) => L(1, u, v), n(dy), n(dz), part),
      plate((u, v) => L(u, 0, v), n(dx), n(dz), part), plate((u, v) => L(u, 1, v), n(dx), n(dz), part),
      plate((u, v) => L(u, v, 0), n(dx), n(dy), part), plate((u, v) => L(u, v, 1), n(dx), n(dy), part),
    ];
  }

  /** Zylinder (Achse a → b) mit Deckeln */
  function cyl(a, b, r, part, H) {
    const ax = V.norm(V.sub(b, a));
    let u = V.cross([0, 0, 1], ax);
    if (V.len(u) < 0.2) u = V.cross([0, 1, 0], ax);
    u = V.norm(u);
    const w = V.cross(ax, u), m = Math.max(12, Math.round((TAU * r) / H));
    const disc = (c) => plate((s, t) => {
      const ang = s * TAU, rr = t * r;
      return V.add(c, V.add(V.scale(u, Math.cos(ang) * rr), V.scale(w, Math.sin(ang) * rr)));
    }, m + 1, 4, part);
    return [tube([a, b], 2 * r, 2 * r, part, H, { round: true }), disc(a), disc(b)];
  }

  const bead = (u, c) => Math.exp(-(((u - c) / 0.06) ** 2));

  /* Profilverläufe (Kontrollpunkte von vorn nach hinten, sd = Seite ±1).
     Dachrahmen und B-Säule werden aus der Karosseriefläche abgeleitet → liegen immer innerhalb der Silhouette. */
  const mirror = (pts, sd) => pts.map(([x, y, z]) => [x, sd * y, z]);
  const roofPt = (x, sd) => { const p = Car.roofLine(x); return [p[0], sd * p[1], p[2]]; };
  const sidePt = (x, z, inset, sd) => { const p = Car.sideAt(x / Car.L + 0.5, z, inset); return [p[0], sd * p[1], p[2]]; };
  // Stirnwand-Ebene: x = 0.8 + 0.08·(z − 0.6); die Scharniersäule steht parallel dazu an ihrer Seitenkante
  const hingeX = (z) => 0.81 + 0.08 * (z - 0.6);
  const KNOT_Z = 0.96, KNOT_X = hingeX(KNOT_Z); // Knoten Obergurt / A-Säule / Scharniersäule
  const knot = (sd) => [KNOT_X, sd * 0.785, KNOT_Z];
  // Längsträger → Knick unter der Stirnwand → Schweller, bis vor das Hinterrad: ein durchgehendes Profil
  const railCtrl = (sd) => mirror([[1.96, 0.52, 0.47], [1.5, 0.52, 0.47], [1.15, 0.53, 0.46], [1.02, 0.6, 0.43], [0.92, 0.715, 0.38], [0.82, 0.785, 0.35], [0.62, 0.785, 0.34], [0.4, 0.785, 0.34], [-0.92, 0.785, 0.34]], sd);
  // Obergurt (Kotflügelbank) bis über die Scharniersäule → A-Säule → Dachrahmen: ein durchgehendes Profil unter der Außenhaut
  function upperCtrl(sd) {
    const pts = mirror([[2.02, 0.68, 0.7], [1.75, 0.73, 0.79], [1.45, 0.77, 0.87], [1.15, 0.785, 0.93]], sd);
    pts.push(knot(sd));
    for (let x = 0.66; x >= -1.66; x -= 0.24) pts.push(roofPt(x, sd));
    return pts;
  }
  // Scharniersäule (A-Säule unten): senkrecht, parallel zur Stirnwand, vom Schweller bis zum Knoten
  const hingeCtrl = (sd) => [[hingeX(0.38), sd * 0.785, 0.38], knot(sd)];
  // B-Säule: Schweller → entlang der Seitenwand → Dachrahmen
  const bPillarCtrl = (sd) => [[-0.2, sd * 0.78, 0.39], sidePt(-0.21, 0.55, 0.07, sd), sidePt(-0.22, 0.8, 0.07, sd), sidePt(-0.23, 1.05, 0.07, sd), sidePt(-0.24, 1.22, 0.07, sd), roofPt(-0.26, sd)];
  const railPart = (p) => (p[0] > 0.7 ? P.RAIL : P.SILL);
  const upperPart = (p) => (p[0] > KNOT_X - 0.05 ? P.UPPER : P.CABIN);

  /** Komplette Struktur; H = Ziel-Elementkante */
  function buildStructure(H) {
    const G = [];
    for (const sd of [-1, 1]) {
      // Längsträger → Schweller (Lastpfad 1); auf der Kameraseite reißt die Fügestelle (Zickzack-Riss)
      G.push(tube(railCtrl(sd), 0.1, 0.14, P.RAIL, H, { partAt: railPart, crack: sd > 0 ? { x: Car.CRACK.x, reach: 0.25, part: P.JOINT } : null }));
      // Crashbox mit zwei Auslöse-Sicken + Flanschplatte
      G.push(tube([[2.19, sd * 0.52, 0.47], [1.97, sd * 0.52, 0.47]], 0.11, 0.15, P.CRASHBOX, H * 0.8, { scale: (u) => 1 - 0.16 * (bead(u, 0.33) + bead(u, 0.7)) }));
      G.push(plate((u, v) => [1.965, sd * 0.52 + (u - 0.5) * 0.22, 0.47 + (v - 0.5) * 0.26], 7, 8, P.CRASHBOX));
      // Obergurt → A-Säule → Dachrahmen (Lastpfad 2)
      G.push(tube(upperCtrl(sd), 0.07, 0.08, P.UPPER, H, { partAt: upperPart }));
      // Scharniersäule und B-Säule
      G.push(tube(hingeCtrl(sd), 0.09, 0.1, P.CABIN, H));
      G.push(tube(bPillarCtrl(sd), 0.09, 0.06, P.CABIN, H));
      // Fahrschemel längs
      G.push(tube([[1.95, sd * 0.4, 0.26], [0.88, sd * 0.44, 0.24]], 0.06, 0.06, P.SUBFRAME, H));
    }
    // Biegequerträger (gekrümmt)
    G.push(tube([[2.16, -0.8, 0.47], [2.22, -0.4, 0.47], [2.24, 0, 0.47], [2.22, 0.4, 0.47], [2.16, 0.8, 0.47]], 0.06, 0.12, P.BUMPER, H));
    // Fahrschemel quer
    G.push(tube([[1.95, -0.4, 0.26], [1.95, 0.4, 0.26]], 0.06, 0.06, P.SUBFRAME, H));
    G.push(tube([[0.88, -0.44, 0.24], [0.88, 0.44, 0.24]], 0.06, 0.06, P.SUBFRAME, H));
    // Stirnwand + Windlauf
    G.push(plate((u, v) => { const z = 0.2 + 0.82 * v; return [0.8 + 0.08 * (z - 0.6), -0.76 + 1.52 * u, z]; }, Math.round(1.52 / H) + 1, Math.round(0.82 / H) + 1, P.FIREWALL));
    G.push(tube([[0.87, -0.78, 1.02], [0.87, 0.78, 1.02]], 0.1, 0.08, P.FIREWALL, H));
    // Quermotor (kompakt): Block, Zylinderkopf, Ölwanne, Getriebe
    G.push(...box([1.28, -0.3, 0.4], [1.62, 0.2, 0.74], P.ENGINE, H * 1.2));
    G.push(...box([1.31, -0.28, 0.74], [1.59, 0.18, 0.86], P.ENGINE, H * 1.2));
    G.push(...box([1.33, -0.26, 0.3], [1.57, 0.14, 0.4], P.ENGINE, H * 1.2));
    G.push(...cyl([1.45, 0.2, 0.52], [1.45, 0.42, 0.52], 0.12, P.ENGINE, H * 1.2));
    // Bremskraftverstärker + Hauptbremszylinder direkt hinter dem Zylinderkopf – kippt beim Kontakt in die Stirnwand
    G.push(...cyl([0.84, 0.14, 0.8], [1.0, 0.14, 0.8], 0.1, P.BOOSTER, H));
    G.push(...cyl([1.0, 0.14, 0.8], [1.16, 0.14, 0.8], 0.035, P.BOOSTER, H));
    return G;
  }

  /** Lastpfade entlang der Profil-Mittellinien als Vertexlisten [x,y,z,0,0,part]:
      1 Crashbox → Längsträger → Schweller, 2 Obergurt → A-Säule → Dach, 3 Fahrschemel → Tunnel */
  function loadPaths() {
    const out = [];
    const add = (tone, ctrl, partOf) => {
      const dense = resample(smoothPath(ctrl, 10), 72).pts;
      out.push({ tone, v: dense.map((p) => [p[0], p[1], p[2], 0, 0, partOf(p)]) });
    };
    for (const sd of [1, -1]) {
      add('blue', [[2.24, sd * 0.4, 0.47], [2.08, sd * 0.52, 0.47], ...railCtrl(sd)], (p) => (p[0] > 2.12 ? P.BUMPER : p[0] > 1.965 ? P.CRASHBOX : railPart(p)));
      add('warn', upperCtrl(sd), upperPart);
    }
    add('ink', [[1.95, 0, 0.26], [1.6, 0.25, 0.25], [0.9, 0.44, 0.24], [0.45, 0.25, 0.22], [-0.8, 0.12, 0.22]], (p) => (p[0] > 0.7 ? P.SUBFRAME : P.RIGID));
    return out;
  }

  S.Structure = { buildStructure, loadPaths, tube, plate, box, cyl };
})(window.STAGE = window.STAGE || {});
