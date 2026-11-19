/* =========================================================
   STAGE · Objekte der Unterseiten (schematische FE-Netze)
   - steering: Zahnstangenlenkung (Masterarbeit) – Gehäuse,
     schrägverzahnte Zahnstange, Ritzel mit Härtekontur an der
     Stirnfläche, Eingangswelle, Faltenbälge, Spurstangen, Gelenke
   - conrod: Pleuel (Bachelorarbeit) – Doppel-T-Schaft, kleines
     und großes Auge mit Kerben, Schraubenaugen (Gewinde-Sackloch
     im Schaft, Durchgangsbohrung und Kopfauflage im Deckel),
     Crackdorne, Keil, Riss, Bruchflächen mit identischer Textur,
     eiförmiger Verzug der Bohrung (überhöht), Verschraubung
   Jedes Objekt liefert: Netz-Sätze, pose(st, t), vertex(...),
   color(...), Beschriftungen, optional overlay(...) für Linien.
   Vertexdaten: [x, y, z, a3, a4, part].
   ========================================================= */
(function (S) {
  'use strict';
  const { TAU, clamp, smooth, lerp, V, mix3, turbo } = S;

  /* ---------- Bausteine ---------- */
  function frameOf(axis) {
    const a = V.norm(axis);
    const ref = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = V.norm(V.cross(ref, a));
    return { a, u, v: V.cross(a, u) };
  }
  const pt = (c, f, s, r, phi) => {
    const cp = Math.cos(phi) * r, sp = Math.sin(phi) * r;
    return [
      c[0] + f.a[0] * s + f.u[0] * cp + f.v[0] * sp,
      c[1] + f.a[1] * s + f.u[1] * cp + f.v[1] * sp,
      c[2] + f.a[2] * s + f.u[2] * cp + f.v[2] * sp,
    ];
  };
  const phiAt = (range, j, nv) => (range ? range[0] + ((range[1] - range[0]) * j) / (nv - 1) : (j / nv) * TAU);

  /** Rotationsfläche ab c0 entlang axis (Länge len); rad(t, phi); opt.range = Winkelbereich (offen) */
  function revolve(c0, axis, len, rad, nu, nv, part, opt = {}) {
    const f = frameOf(axis), src = new Float32Array(nu * nv * 6), range = opt.range;
    for (let i = 0; i < nu; i++) {
      const t = i / (nu - 1);
      for (let j = 0; j < nv; j++) {
        const phi = phiAt(range, j, nv), p = pt(c0, f, t * len, rad(t, phi), phi);
        const ax = opt.aux ? opt.aux(t, phi) : [t, phi];
        src.set([p[0], p[1], p[2], ax[0], ax[1], part], (i * nv + j) * 6);
      }
    }
    return { nu, nv, wrapU: false, wrapV: !range, src };
  }

  /** Ringfläche senkrecht zur Achse bei c, von rIn(phi) bis rOut(phi); a3 = Abstand zur Außenkontur */
  function annulus(c, axis, rIn, rOut, K, nv, part, opt = {}) {
    const f = frameOf(axis), src = new Float32Array(K * nv * 6), range = opt.range;
    for (let k = 0; k < K; k++) {
      const g = k / (K - 1);
      for (let j = 0; j < nv; j++) {
        const phi = phiAt(range, j, nv), r0 = rIn(phi), r1 = rOut(phi), p = pt(c, f, 0, r0 + (r1 - r0) * g, phi);
        src.set([p[0], p[1], p[2], (1 - g) * (r1 - r0), phi, part], (k * nv + j) * 6);
      }
    }
    return { nu: K, nv, wrapU: false, wrapV: !range, src };
  }

  /** Fläche fn(s, t) → [x, y, z], s, t ∈ [0, 1] */
  function sheet(fn, nu, nv, part) {
    const src = new Float32Array(nu * nv * 6);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const s = i / (nu - 1), t = j / (nv - 1), p = fn(s, t);
        src.set([p[0], p[1], p[2], s, t, part], (i * nv + j) * 6);
      }
    }
    return { nu, nv, wrapU: false, wrapV: false, src };
  }

  /** Quader aus sechs Flächen */
  function box(a, b, part, n = 4) {
    const L = (u, v, w) => [lerp(a[0], b[0], u), lerp(a[1], b[1], v), lerp(a[2], b[2], w)];
    return [
      sheet((s, t) => L(0, s, t), n, n, part), sheet((s, t) => L(1, s, t), n, n, part),
      sheet((s, t) => L(s, 0, t), n, n, part), sheet((s, t) => L(s, 1, t), n, n, part),
      sheet((s, t) => L(s, t, 0), n, n, part), sheet((s, t) => L(s, t, 1), n, n, part),
    ];
  }

  /** Drehung des Punkts (x, y, z) um die Einheitsachse k durch c um th (Rodrigues) */
  function rotate(x, y, z, c, k, th, out, oo) {
    const px = x - c[0], py = y - c[1], pz = z - c[2], ct = Math.cos(th), st = Math.sin(th);
    const d = k[0] * px + k[1] * py + k[2] * pz;
    out[oo] = c[0] + px * ct + (k[1] * pz - k[2] * py) * st + k[0] * d * (1 - ct);
    out[oo + 1] = c[1] + py * ct + (k[2] * px - k[0] * pz) * st + k[1] * d * (1 - ct);
    out[oo + 2] = c[2] + pz * ct + (k[0] * py - k[1] * px) * st + k[2] * d * (1 - ct);
  }

  /** Zahnform (Trapez, weich verrundet) über der Teilung q ∈ [0, 1): Zahnmitte bei 0,22 */
  const tooth = (q) => {
    q -= Math.floor(q);
    const t = q < 0.14 ? q / 0.14 : q < 0.3 ? 1 : q < 0.44 ? 1 - (q - 0.3) / 0.14 : 0;
    return t * t * (3 - 2 * t);
  };
  const sphere = (r) => (t) => r * Math.sqrt(Math.max(0.0004, 1 - (2 * t - 1) * (2 * t - 1)));

  /* =========================================================
     Zahnstangenlenkung (Masterarbeit)
     Zahnstange entlang y (z = 1), Ritzelachse D in der x-z-Ebene
     ========================================================= */
  function steering(small) {
    const P = { HOUSING: 0, RACK: 1, PINION: 2, SECTION: 3, BELLOWS: 4, TIEROD: 5, JOINT: 6, SHAFT: 7, MOUNT: 8 };
    const n = (k) => Math.max(4, Math.round(k * (small ? 0.7 : 1)));
    const ZR = 1.0, RB = 0.105, HT = 0.044, YP = 0.95;
    const PIN = { z: 7, r0: 0.072, r1: 0.118, w: 0.2, beta: 0.42 };
    PIN.rp = (PIN.r0 + PIN.r1) / 2;
    PIN.pitch = (TAU * PIN.rp) / PIN.z;
    const tanB = Math.tan(PIN.beta);
    const D = V.norm([-0.36, 0, 0.93]);           // Ritzelachse
    const NN = V.norm([0.93, 0, 0.36]);           // von der Zahnstange zum Ritzel (senkrecht zu D und y)
    const CP = V.add([0, YP, ZR], V.scale(NN, RB + 0.002 + HT / 2 + PIN.rp));
    const fp = frameOf(D);
    const toCp = V.scale(NN, -1);
    const phiC = Math.atan2(V.dot(toCp, fp.v), V.dot(toCp, fp.u));   // Winkel zur Zahnstange
    const phi0 = phiC - (0.72 * TAU) / PIN.z;                          // Zahnlücke liegt an der Zahnstange
    const pinR = (s, phi) => PIN.r0 + (PIN.r1 - PIN.r0) * tooth(((phi - phi0 - (s * tanB) / PIN.rp) * PIN.z) / TAU);
    const NV = PIN.z * 14;

    const G = [];   // undurchsichtig
    const H = [];   // Gehäuse (durchscheinend)

    // Ritzel: schrägverzahnte Mantelfläche + Stirnflächen (Schnitt mit Härtekontur)
    G.push(revolve(V.add(CP, V.scale(D, -PIN.w / 2)), D, PIN.w, (t, phi) => pinR((t - 0.5) * PIN.w, phi), n(9), NV, P.PINION, { aux: () => [0, 0] }));
    for (const sd of [-1, 1]) {
      G.push(annulus(V.add(CP, V.scale(D, (sd * PIN.w) / 2)), D, () => 0.004, (phi) => pinR((sd * PIN.w) / 2, phi), n(9), NV, P.SECTION));
    }
    // Eingangswelle mit Lagerbund und Keilverzahnung, unterer Lagerzapfen
    G.push(revolve(V.add(CP, V.scale(D, 0.1)), D, 0.88, (t, phi) => (t > 0.8 ? 0.051 + 0.007 * Math.sign(Math.sin(phi * 10)) : t > 0.06 && t < 0.18 ? 0.085 : 0.05), n(30), 40, P.SHAFT));
    G.push(annulus(V.add(CP, V.scale(D, 0.98)), D, () => 0.003, (phi) => 0.051 + 0.007 * Math.sign(Math.sin(phi * 10)), 3, 40, P.SHAFT));
    G.push(revolve(V.add(CP, V.scale(D, -0.18)), D, 0.08, () => 0.045, 4, 16, P.SHAFT));

    // Zahnstange: Rundstab + schrägverzahnte Zahnreihe (mit Seitenwänden bis auf den Stab)
    G.push(revolve([0, -2.1, ZR], [0, 1, 0], 4.2, () => RB, n(70), n(18), P.RACK));
    const NT = 11, LR = NT * PIN.pitch, y0 = YP - LR / 2, yRef = YP - 0.22 * PIN.pitch, W2 = 0.08;
    const land = RB + 0.002, foot = Math.sqrt(RB * RB - W2 * W2) - 0.002, NVT = 8;
    G.push(sheet((s, t) => {
      const y = y0 + LR * s, j = Math.round(t * (NVT - 1));
      let w, h;
      if (j === 0) { w = -W2; h = foot; } else if (j === NVT - 1) { w = W2; h = foot; } else {
        w = -W2 + (2 * W2 * (j - 1)) / (NVT - 3);
        h = land + HT * tooth((y + w * tanB - yRef) / PIN.pitch);
      }
      return V.add(V.add([0, y, ZR], V.scale(NN, h)), V.scale(D, w));
    }, n(NT * 12), NVT, P.RACK));

    for (const sd of [-1, 1]) {
      const ax = [0, sd, 0];
      // Spurstange mit Kontermutter, inneres Axialgelenk, äußeres Spurstangengelenk mit Zapfen
      G.push(revolve([0, sd * 2.06, ZR], ax, 0.8, (t) => (t > 0.66 && t < 0.74 ? 0.058 : 0.036), n(24), 12, P.TIEROD));
      G.push(revolve([0, sd * 1.98, ZR], ax, 0.16, sphere(0.075), 10, 14, P.JOINT));
      const ce = [0, sd * 2.94, ZR];
      G.push(revolve(V.add(ce, [0, 0, -0.09]), [0, 0, 1], 0.18, sphere(0.09), 10, 16, P.JOINT));
      G.push(revolve(V.add(ce, [0, 0, -0.06]), [0, 0, -1], 0.3, (t) => 0.034 - 0.012 * t, 8, 10, P.JOINT));
      // Faltenbalg: weit am Gehäuse, eng an der Spurstange; a3 = Lage entlang des Balgs (für Dehnung)
      G.push(revolve([0, sd * 1.44, ZR], ax, 0.74, (t) => {
        const base = lerp(0.21, 0.058, smooth(0.62, 0.97, t));
        return base + 0.042 * (1 - smooth(0.6, 0.86, t)) * Math.abs(Math.sin(Math.PI * 9 * t));
      }, n(72), 22, P.BELLOWS));
    }
    // Lagerböcke mit Gummilager
    for (const yy of [-1.2, 1.32]) {
      const c = [-0.1, yy, ZR + 0.27];
      G.push(revolve(c, [1, 0, 0], 0.2, () => 0.08, 4, 18, P.MOUNT));
      G.push(annulus(c, [1, 0, 0], () => 0.035, () => 0.08, 3, 18, P.MOUNT));
      G.push(annulus(V.add(c, [0.2, 0, 0]), [1, 0, 0], () => 0.035, () => 0.08, 3, 18, P.MOUNT));
      H.push(...box([-0.05, yy - 0.05, ZR + 0.12], [0.05, yy + 0.05, ZR + 0.21], P.HOUSING, 3));
    }
    // Gehäuse: Rohr mit Bunden, Ritzelgehäuse mit Deckel
    H.push(revolve([0, -1.47, ZR], [0, 1, 0], 2.94, (t) => 0.2 + (t < 0.025 || t > 0.975 ? 0.016 : 0), n(56), n(30), P.HOUSING));
    H.push(revolve(V.add(CP, V.scale(D, -0.19)), D, 0.6, () => 0.16, n(16), n(28), P.HOUSING));
    H.push(annulus(V.add(CP, V.scale(D, 0.41)), D, () => 0.058, () => 0.16, 4, n(28), P.HOUSING));

    // Zahnspitze an der unteren Stirnfläche, Richtung vom Gehäuse weg (für die Beschriftung der Randschicht)
    const phiOut = Math.atan2(V.dot(NN, fp.v), V.dot(NN, fp.u));
    const kT = Math.round(((phiOut - phi0) * PIN.z) / TAU - 0.22);
    const phiT = phi0 + ((kT + 0.22) * TAU) / PIN.z - ((PIN.w / 2) * tanB) / PIN.rp;
    const hardAt = pt(V.add(CP, V.scale(D, -PIN.w / 2)), fp, 0, PIN.r1 - 0.004, phiT);

    const pose = (st, t) => {
      const dy = 0.13 * st.steer * Math.sin(t * 1.25);
      return { dy, th: -dy / PIN.rp };   // Abrollen: Zahnstangenweg = Teilkreisradius × Drehwinkel
    };
    const key = (Q) => Q.dy.toFixed(4);
    function vertex(src, o, Q, out, oo) {
      const x = src[o], y = src[o + 1], z = src[o + 2], part = src[o + 5];
      if (part === P.PINION || part === P.SECTION || part === P.SHAFT) rotate(x, y, z, CP, D, Q.th, out, oo);
      else {
        out[oo] = x; out[oo + 2] = z;
        out[oo + 1] = y + (part === P.RACK || part === P.TIEROD || part === P.JOINT ? Q.dy : part === P.BELLOWS ? Q.dy * src[o + 3] : 0);
      }
      // Härte: Mantelfläche = Randschicht, Stirnfläche nach Abstand zur Zahnkontur
      return part === P.PINION ? 1 : part === P.SECTION ? 1 - smooth(0.006, 0.026, src[o + 3]) : 0;
    }
    function color(part, e, st, C) {
      const d = C.dark;
      const base = part === P.HOUSING ? (d ? [0.62, 0.68, 0.74] : [0.76, 0.8, 0.85])
        : part === P.BELLOWS || part === P.MOUNT ? (d ? [0.3, 0.32, 0.34] : [0.24, 0.25, 0.27])
          : part === P.JOINT ? (d ? [0.42, 0.46, 0.5] : [0.46, 0.49, 0.53])
            : part === P.PINION || part === P.SECTION ? (d ? [0.52, 0.6, 0.68] : [0.6, 0.67, 0.75])
              : d ? [0.52, 0.56, 0.6] : [0.66, 0.7, 0.74];
      if (st.fringe < 0.01) return base;
      if (part === P.PINION || part === P.SECTION) return mix3(base, turbo(0.1 + 0.85 * e), st.fringe);
      return mix3(base, d ? [0.24, 0.27, 0.3] : [0.86, 0.88, 0.9], st.fringe * 0.45);
    }
    return {
      sets: [
        { key: 'st_in', grids: G, alpha: () => 1, edge: 0.85, sample: true },
        { key: 'st_hs', grids: H, alpha: (st) => 0.3 * st.shell, edge: 0.5, sample: true },
      ],
      pose, key, vertex, color,
      labels: [
        { text: 'Pinion', at: V.add(CP, V.scale(NN, 0.22)), on: 'parts' },
        { text: 'Rack', at: [0, -0.5, ZR + 0.24], on: 'parts', move: 'rack' },
        { text: 'Input shaft', at: V.add(CP, V.add(V.scale(D, 0.86), V.scale(NN, 0.09))), on: 'parts' },
        { text: 'Bellows', at: [0, 1.85, ZR + 0.28], on: 'parts' },
        { text: 'Tie rod', at: [0, -2.62, ZR + 0.08], on: 'parts', move: 'rack' },
        { text: 'Hardened surface layer', at: hardAt, on: 'fringe', cls: 'is-hot' },
      ],
      labelPos(L, Q) { return L.move === 'rack' ? [L.at[0], L.at[1] + Q.dy, L.at[2]] : L.at; },
      focus: CP,
    };
  }

  /* =========================================================
     Pleuel (Bachelorarbeit) – Pleuelebene x-z, Dicke entlang y
     Lokale Koordinaten am großen Auge: X = x − BC.x (zum Deckel),
     Z = z − BC.z; Winkel φ: X = −r·cos φ, Z = r·sin φ
     (φ = 0 Schaftseite, ±π/2 Trennebene, π Deckelscheitel)
     ========================================================= */
  function conrod(small) {
    const P = { ROD: 0, CAP: 1, FRAC_R: 2, FRAC_C: 3, BUSH: 4, THREAD: 5, TOOL_R: 6, TOOL_C: 7, WEDGE: 8, BOLT: 9 };
    const n = (k) => Math.max(3, Math.round(k * (small ? 0.7 : 1)));
    const BC = [1.0, 0, 1.0], SC = [-1.55, 0, 1.0];
    const RB = 0.46, TB = 0.15, RSI = 0.2, RSO = 0.34, TS = 0.12, Y = [0, 1, 0];
    const HALF = Math.PI / 2;
    const L = (X, y, Z) => [BC[0] + X, y, BC[2] + Z];
    // Schraubenaugen an der Trennebene: Oberkante ZO, Schraubenachse ZB, ebene Kopfauflage am Deckel bei XS,
    // Augenende am Schaft bei −XR, Deckelrücken mit Radius RC
    const ZO = 0.8, ZB = 0.65, XS = 0.3, XR = 0.34, RC = 0.62, ZD = Math.sqrt(RC * RC - XS * XS);
    const RHC = 0.059, DH = 0.28, LB = 0.25, PITCH = 0.035;   // Durchgangsbohrung, Gewindetiefe, Gewindelänge der Schraube, Steigung
    const bump = (phi, c) => Math.exp(-(((phi - c) / 0.05) ** 2));
    const bore = (phi) => RB + 0.024 * (bump(phi, HALF) + bump(phi, -HALF) + bump(phi, 3 * HALF));   // Kerben
    const RN = RB + 0.024;
    const tri = (q) => 1 - Math.abs(2 * (q - Math.floor(q)) - 1);
    const thrIn = (s, psi) => 0.047 + 0.012 * tri(s / PITCH + psi / TAU);          // Innengewinde im Schaftauge
    const thrOut = (s, psi) => 0.045 + 0.012 * tri(s / PITCH + psi / TAU + 0.5);   // Schraubengewinde
    // Bruchtextur: identisch für Schaft- und Deckelseite → passt nur zum Gegenstück; am Bohrungsrand glatt
    const rough = (r, y) => 0.009 * (Math.sin(r * 93 + y * 47) * Math.cos(y * 81 - r * 29) + 0.5 * Math.sin(r * 171 + y * 133 + 1.3))
      * smooth(RHC, RHC + 0.03, Math.hypot(r - ZB, y));
    // Verzug der Bohrung durch das Cracken (überhöht): gestreckt in Crackrichtung, Spitze zum Deckel → Eiform.
    // Radiale Verschiebung bei voller Ausprägung, c = X / r; wirkt an der Bohrung und klingt nach außen ab
    const egg = (c) => RB * (0.1 * c * c + 0.08 * c * c * c - 0.03 * (1 - c * c));
    const eggW = (r) => 1 - smooth(RB, RB + 0.2, r);

    const G = [], T = [], B = [], TH = [];

    /* ----- großes Auge: Außenkontur als Polygonzug (obere Hälfte), nach unten gespiegelt ----- */
    const bez = (a, b, c, u) => [0, 1].map((d) => (1 - u) * (1 - u) * a[d] + 2 * u * (1 - u) * b[d] + u * u * c[d]);
    const poly = (segs) => {
      const out = [];
      segs.forEach(([m, f], s) => { for (let k = s ? 1 : 0; k <= m; k++) out.push(f(k / m)); });
      return out;
    };
    const PHS = Math.atan2(ZD, -XS);   // Kante Kopfauflage → Deckelrücken
    const rodTop = poly([
      [n(6), (u) => { const ph = 0.3693 * u, r = lerp(0.66, 0.6648, u); return [-r * Math.cos(ph), r * Math.sin(ph)]; }],
      [n(14), (u) => bez([-0.62, 0.24], [-0.42, 0.38], [-XR, 0.7], u)],   // Hohlkehle vom Schaft ins Schraubenauge
      [n(3), (u) => [-XR, lerp(0.7, ZO, u)]],
      [n(9), (u) => [-XR * Math.pow(1 - u, 1.7), ZO]],                    // zur Trennebene hin feiner
    ]);
    const capTop = poly([
      [n(8), (u) => [XS * Math.pow(u, 1.7), ZO]],
      [n(7), (u) => [XS, lerp(ZO, ZD, u)]],                                // ebene Kopfauflage
      [n(18), (u) => { const ph = lerp(PHS, Math.PI, u); return [-RC * Math.cos(ph), RC * Math.sin(ph)]; }],
    ]);
    const mirror = (list) => list.map(([X, Z]) => [X, -Z]);
    const rodOut = [...mirror(rodTop).reverse(), ...rodTop.slice(1)];     // φ −π/2 → π/2
    const capOut = [...capTop, ...mirror(capTop).reverse().slice(1)];     // φ π/2 → 3π/2

    /** Hälfte des großen Auges: Außenfläche (Kopfauflagen ausgespart), Bohrung, Vorder- und Rückseite */
    function ringHalf(out, part) {
      const m = out.length, ny = n(6), K = n(6);
      const inn = out.map(([X, Z]) => {
        let ph = Math.atan2(Z, -X);
        if (part === P.CAP && ph < 0) ph += TAU;
        const r = bore(ph);
        return [-r * Math.cos(ph), r * Math.sin(ph)];
      });
      const sweep = (pts) => {
        const src = new Float32Array(ny * m * 6);
        for (let i = 0; i < ny; i++) {
          const y = lerp(-TB, TB, i / (ny - 1));
          pts.forEach(([X, Z], j) => src.set([...L(X, y, Z), 0, 0, part], (i * m + j) * 6));
        }
        return src;
      };
      const seat = out.map((p, j) => j < m - 1 && Math.abs(p[0] - XS) < 1e-6 && Math.abs(out[j + 1][0] - XS) < 1e-6);
      const faces = [-TB, TB].map((y) => {
        const src = new Float32Array(K * m * 6);
        for (let k = 0; k < K; k++) {
          const g = k / (K - 1);
          for (let j = 0; j < m; j++) src.set([...L(lerp(inn[j][0], out[j][0], g), y, lerp(inn[j][1], out[j][1], g)), 0, 0, part], (k * m + j) * 6);
        }
        return { nu: K, nv: m, wrapU: false, wrapV: false, src };
      });
      return [
        { nu: ny, nv: m, wrapU: false, wrapV: false, src: sweep(out), skip: (i, j) => seat[j] },
        { nu: ny, nv: m, wrapU: false, wrapV: false, src: sweep(inn) },
        ...faces,
      ];
    }
    G.push(...ringHalf(rodOut, P.ROD), ...ringHalf(capOut, P.CAP));

    /** Rechteck [a0, a1] × [b0, b1] (Ebenenkoordinaten) mit Bohrung um (ca, 0), Radius rh(θ), als O-Netz;
        die Ecken sind Knoten. map(a, b) → Weltpunkt */
    function plateWithHole(a0, a1, b0, b1, ca, rh, map, part) {
      const M = n(44), K = n(7);
      const pieces = [[a1, 0, a1, b1], [a1, b1, a0, b1], [a0, b1, a0, b0], [a0, b0, a1, b0], [a1, b0, a1, 0]];
      const len = pieces.map(([p, q, r, s]) => Math.hypot(r - p, s - q)), tot = len.reduce((x, y) => x + y, 0);
      const rim = [];
      pieces.forEach(([p, q, r, s], k) => {
        const c = Math.max(1, Math.round((len[k] / tot) * M));
        for (let i = 0; i < c; i++) rim.push([lerp(p, r, i / c), lerp(q, s, i / c)]);
      });
      const nv = rim.length, src = new Float32Array(K * nv * 6);
      rim.forEach((o, j) => {
        const th = Math.atan2(o[1], o[0] - ca), r = rh(th), h = [ca + r * Math.cos(th), r * Math.sin(th)];
        for (let k = 0; k < K; k++) {
          const g = Math.pow(k / (K - 1), 1.35), p = map(lerp(h[0], o[0], g), lerp(h[1], o[1], g));
          src.set([p[0], p[1], p[2], 0, 0, part], (k * nv + j) * 6);
        }
      });
      return { nu: K, nv, wrapU: false, wrapV: true, src };
    }
    for (const sz of [1, -1]) {
      const ax = (X) => L(X, 0, sz * ZB);
      // Bruchflächen (Ebene: Abstand zur Mitte × Dicke) mit den Schraubenbohrungen; Schaftseite mit Gewindeanfang
      const mapF = (r, y) => L(rough(r, y), y, sz * r);
      G.push(plateWithHole(RN, ZO, -TB, TB, ZB, (th) => thrIn(0, Math.atan2(sz * Math.cos(th), -Math.sin(th))), mapF, P.FRAC_R));
      G.push(plateWithHole(RN, ZO, -TB, TB, ZB, () => RHC, mapF, P.FRAC_C));
      // Deckel: ebene Kopfauflage mit Bohrung, Durchgangsbohrung bis zur Trennebene
      G.push(plateWithHole(ZD, ZO, -TB, TB, ZB, () => RHC, (r, y) => L(XS, y, sz * r), P.CAP));
      G.push(revolve(ax(0), [1, 0, 0], XS, () => RHC, n(8), n(20), P.CAP));
      // Schaftseite: Gewinde-Sackloch mit Bohrspitze
      TH.push(revolve(ax(0), [-1, 0, 0], DH, (t, psi) => thrIn(t * DH, psi), n(46), n(22), P.THREAD));
      TH.push(revolve(ax(-DH), [-1, 0, 0], 0.035, (t) => 0.001 + 0.046 * (1 - t), 3, n(22), P.THREAD));
    }

    // Schaft mit Doppel-T-Profil (Ausnehmungen auf beiden Seiten), nach Bogenlänge gleichmäßig vernetzt
    const prof = (h, tt, wt, ft) => [[-tt, -h / 2], [tt, -h / 2], [tt, -h / 2 + ft], [wt, -h / 2 + ft], [wt, h / 2 - ft], [tt, h / 2 - ft], [tt, h / 2], [-tt, h / 2], [-tt, h / 2 - ft], [-wt, h / 2 - ft], [-wt, -h / 2 + ft], [-tt, -h / 2 + ft]];
    const resampleLoop = (poly, m) => {
      const L = [0];
      for (let i = 1; i <= poly.length; i++) { const a = poly[i - 1], b = poly[i % poly.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
      const out = [];
      for (let j = 0, i = 0; j < m; j++) {
        const d = (L[poly.length] * j) / m;
        while (L[i + 1] < d) i++;
        const f = (d - L[i]) / (L[i + 1] - L[i] || 1), a = poly[i], b = poly[(i + 1) % poly.length];
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
      return out;
    };
    {
      const x0 = SC[0] + RSO - 0.05, x1 = BC[0] - 0.58, nu = n(24), m = 48, src = new Float32Array(nu * m * 6);
      for (let i = 0; i < nu; i++) {
        const s = i / (nu - 1), x = lerp(x0, x1, s);
        resampleLoop(prof(lerp(0.3, 0.46, s), lerp(0.112, 0.14, s), 0.035, 0.055), m)
          .forEach(([yy, zz], j) => src.set([x, yy, BC[2] + zz, s, 0, P.ROD], (i * m + j) * 6));
      }
      G.push({ nu, nv: m, wrapU: false, wrapV: true, src });
    }
    // kleines Auge mit Buchse
    G.push(revolve([SC[0], -TS, SC[2]], Y, 2 * TS, () => RSO, 5, n(40), P.ROD));
    G.push(revolve([SC[0], -TS, SC[2]], Y, 2 * TS, () => RSI, 5, n(40), P.BUSH));
    G.push(annulus([SC[0], -TS, SC[2]], Y, () => RSI, () => RSO, 4, n(40), P.ROD));
    G.push(annulus([SC[0], TS, SC[2]], Y, () => RSI, () => RSO, 4, n(40), P.ROD));

    // Crackwerkzeug: zwei halbe Dorne in der Bohrung, Keil im Spalt (wird entlang y eingetrieben)
    const RM = 0.424, YM = 0.26, GAP = 0.032;
    const mandrel = (range, sg, part) => [
      revolve([BC[0] + sg * GAP, -YM, BC[2]], Y, 2 * YM, () => RM, 6, n(26), part, { range }),
      sheet((s, t) => [BC[0] + sg * GAP, lerp(-YM, YM, s), BC[2] + lerp(-RM, RM, t)], 6, n(12), part),
      annulus([BC[0] + sg * GAP, -YM, BC[2]], Y, () => 0.003, () => RM, 4, n(26), part, { range }),
      annulus([BC[0] + sg * GAP, YM, BC[2]], Y, () => 0.003, () => RM, 4, n(26), part, { range }),
    ];
    T.push(...mandrel([-HALF, HALF], -1, P.TOOL_R), ...mandrel([HALF, 3 * HALF], 1, P.TOOL_C));
    T.push(...box([BC[0] - 0.028, 0, BC[2] - 0.22], [BC[0] + 0.028, 0.8, BC[2] + 0.22], P.WEDGE, 5));
    // Die Dorne folgen der verformten Bohrung: größte Verschiebung ohne Durchdringung (bei voller Verformung)
    const fitShift = (sg) => {
      let lo = 0, hi = 0.2;
      for (let it = 0; it < 24; it++) {
        const s = (lo + hi) / 2;
        let ok = true;
        for (let k = 0; k <= 48 && ok; k++) {
          const b = -HALF + (Math.PI * k) / 48, X = sg * (GAP + s + RM * Math.cos(b)), Z = RM * Math.sin(b), r = Math.hypot(X, Z);
          if (r > RB - 0.003 + egg(X / r)) ok = false;
        }
        if (ok) lo = s; else hi = s;
      }
      return lo;
    };
    const SHC = fitShift(1), SHR = fitShift(-1);

    // Pleuelschrauben: Sechskantkopf auf der Kopfauflage, Schaft, Gewinde (greift ins Schaftauge)
    const hex = (phi) => 0.1 * (1 - 0.07 * Math.abs(Math.cos(3 * phi)));
    for (const sz of [1, -1]) {
      const ax = (X) => L(X, 0, sz * ZB);
      B.push(revolve(ax(XS), [1, 0, 0], 0.12, (t, phi) => hex(phi), 4, 24, P.BOLT));
      B.push(annulus(ax(XS + 0.12), [1, 0, 0], () => 0.003, hex, 3, 24, P.BOLT));
      B.push(annulus(ax(XS), [1, 0, 0], () => 0.052, hex, 2, 24, P.BOLT));
      B.push(revolve(ax(-0.02), [1, 0, 0], XS + 0.02, () => 0.052, 6, 16, P.BOLT));
      B.push(revolve(ax(-LB), [1, 0, 0], LB - 0.02, (t, psi) => thrOut(t * (LB - 0.02), psi), n(36), n(20), P.BOLT));
      B.push(annulus(ax(-LB), [1, 0, 0], () => 0.003, (psi) => thrOut(0, psi), 3, n(20), P.BOLT));
    }

    const pose = (st) => {
      const ov = smooth(0, 1, st.crack) * (1 - 0.35 * smooth(0.4, 1, st.bolt));   // Verschrauben gleicht einen Teil aus
      const boff = (1 - st.bolt) * 0.75;
      return {
        wedge: st.wedge, crack: st.crack, split: st.split, bolt: st.bolt, ov, boff,
        open: 0.012 * st.crack * (1 - st.split) * (1 - st.bolt),
        fly: 0.36 * st.split,
        sC: SHC * ov, sR: SHR * ov,
        bth: (clamp(LB - boff, 0, LB) / PITCH) * TAU,   // die Schraube dreht, sobald das Gewinde greift
      };
    };
    const key = (Q) => `${Q.wedge.toFixed(3)}|${Q.crack.toFixed(3)}|${Q.split.toFixed(3)}|${Q.bolt.toFixed(3)}`;
    function vertex(src, o, Q, out, oo) {
      let x = src[o], y = src[o + 1], z = src[o + 2];
      const part = src[o + 5], X0 = x - BC[0], Z0 = z - BC[2];
      if (part <= P.THREAD && Q.ov > 0.0005) {   // Eiform der Bohrung
        const r = Math.hypot(X0, Z0) || 1, w = eggW(r);
        if (w > 0) { const d = (Q.ov * egg(X0 / r) * w) / r; x += d * X0; z += d * Z0; }
      }
      if (part === P.ROD || part === P.FRAC_R || part === P.BUSH || part === P.THREAD) x -= Q.fly + Q.open;   // Schaft sitzt auf dem Schlitten
      else if (part === P.CAP || part === P.FRAC_C) x += Q.open;                                          // Deckel wird festgehalten
      else if (part === P.TOOL_R) x -= Q.sR + 0.07 * Q.split;
      else if (part === P.TOOL_C) x += Q.sC;
      else if (part === P.WEDGE) y += 0.4 - 0.72 * Q.wedge;
      else if (part === P.BOLT) {
        x += Q.boff;
        if (Q.bth) {
          const zc = BC[2] + (Z0 > 0 ? ZB : -ZB), dz = z - zc, c = Math.cos(Q.bth), s = Math.sin(Q.bth);
          z = zc + y * s + dz * c;
          y = y * c - dz * s;
        }
      }
      out[oo] = x; out[oo + 1] = y; out[oo + 2] = z;
      if (part > P.FRAC_C || Q.crack < 0.001) return 0;
      // Riss: läuft von der Kerbe (Bohrung) nach außen, nahe der Trennebene
      const front = (Math.hypot(X0, Z0) - RB) / (ZO - RB);
      return (1 - smooth(0, 0.07, Math.abs(X0))) * (1 - smooth(Q.crack - 0.08, Q.crack + 0.02, front));
    }
    function color(part, e, st, C) {
      const d = C.dark;
      const base = part === P.BUSH ? [0.8, 0.62, 0.38]
        : part === P.TOOL_R || part === P.TOOL_C ? (d ? [0.36, 0.4, 0.46] : [0.4, 0.44, 0.5])
          : part === P.WEDGE ? C.amber
            : part === P.BOLT ? (d ? [0.38, 0.4, 0.44] : [0.32, 0.34, 0.37])
              : part === P.THREAD ? (d ? [0.44, 0.48, 0.52] : [0.5, 0.54, 0.58])
                : part === P.FRAC_R || part === P.FRAC_C ? (d ? [0.46, 0.5, 0.54] : [0.54, 0.57, 0.61])
                  : d ? [0.52, 0.56, 0.6] : [0.66, 0.7, 0.74];
      if (part > P.FRAC_C) return base;
      const hot = smooth(0.01, 0.25, e);
      if (st.fringe > 0.01) return mix3(base, turbo(0.08 + 0.9 * e), st.fringe);   // FE-Kontur: blau → Riss rot
      return hot > 0 ? mix3(base, turbo(0.62 + 0.36 * e), hot) : base;
    }

    // Idealkreis (gestrichelt) und verformte Bohrung als Linien auf der Stirnseite zur Kamera
    const circ = (ph, r, off, y) => [BC[0] - r * Math.cos(ph) + off, y, BC[2] + r * Math.sin(ph)];
    const boreAt = (ph, Q, y, off, dr = 0) => {
      const r = bore(ph);
      return circ(ph, r + Q.ov * egg(-Math.cos(ph)) * eggW(r) + dr, off, y);
    };
    function overlay(Q, st, cam, seg) {
      const a = clamp(st.oval);
      if (a < 0.01) return;
      const yf = cam.eye[1] < 0 ? -TB - 0.004 : TB + 0.004, NS = 120;
      for (let k = 0; k < NS; k++) {
        const p0 = (k / NS) * TAU - HALF, p1 = ((k + 1) / NS) * TAU - HALF;
        const off = Math.cos((p0 + p1) / 2) > 0 ? -(Q.fly + Q.open) : Q.open;   // Schaft- bzw. Deckelhälfte
        if (k % 2 === 0) for (const dr of [-0.0025, 0.0025]) seg(circ(p0, RB + dr, off, yf), circ(p1, RB + dr, off, yf), 'blue', a);
        for (const dr of [-0.002, 0.002]) seg(boreAt(p0, Q, yf, off, dr), boreAt(p1, Q, yf, off, dr), 'warn', a * 0.9);
      }
    }
    const toolOnly = (st) => st.tool * (1 - st.oval);

    return {
      // Reihenfolge: Innenteile zuerst; stage.js zeichnet undurchsichtige Sätze vor durchscheinenden
      sets: [
        { key: 'cr_thread', grids: TH, alpha: () => 1, edge: 0.6 },
        { key: 'cr_bolt', grids: B, alpha: (st) => smooth(0, 0.25, st.bolt), edge: 0.6 },
        { key: 'cr_tool', grids: T, alpha: (st) => st.tool, edge: 0.7 },
        { key: 'cr_body', grids: G, alpha: (st) => 1 - 0.7 * st.xray, edge: 0.85, sample: true },
      ],
      pose, key, vertex, color, overlay,
      labels: [
        { text: 'Small end', at: [SC[0], -0.12, SC[2] + 0.44], on: 'parts', move: 'rod' },
        { text: 'Shank (I-beam)', at: [-0.45, -0.14, BC[2] + 0.25], on: 'parts', move: 'rod' },
        { text: 'Big end', at: [BC[0] - 0.3, -0.15, BC[2] + 0.6], on: 'parts', move: 'rod' },
        { text: 'Cap', at: [BC[0] + 0.56, -0.15, BC[2] + 0.2], on: 'parts' },
        { text: 'Wedge', at: [BC[0], 0.8, BC[2] + 0.22], on: toolOnly, move: 'wedge' },
        { text: 'Cracking mandrels', at: [BC[0] - 0.3, YM, BC[2] - 0.25], on: toolOnly },
        { text: 'Notch', at: [BC[0], 0.16, BC[2] + RB + 0.012], on: toolOnly },
        { text: 'Ideal circle', on: 'oval', move: 'ideal', cls: 'is-ref' },
        { text: 'Egg shape (exaggerated)', on: 'oval', move: 'egg', cls: 'is-hot' },
        { text: 'Fracture surface', at: [BC[0] + 0.02, -0.15, BC[2] + 0.74], on: (st) => st.split * (1 - st.bolt), cls: 'is-hot' },
        { text: 'Thread', at: [BC[0], 0, BC[2] + ZB + 0.055], on: (st) => st.split * st.fringe, move: 'rod' },
        { text: 'Bolting', at: [BC[0] + XS + 0.06, 0, BC[2] + ZB + 0.1], on: 'bolt', move: 'bolt' },
      ],
      labelPos(L, Q, cam) {
        const yf = cam && cam.eye[1] < 0 ? -TB : TB;
        if (L.move === 'rod') return [L.at[0] - Q.fly - Q.open, L.at[1], L.at[2]];
        if (L.move === 'wedge') return [L.at[0], L.at[1] + 0.4 - 0.72 * Q.wedge, L.at[2]];
        if (L.move === 'bolt') return [L.at[0] + Q.boff, L.at[1], L.at[2]];
        if (L.move === 'ideal') return circ(1.2 * Math.PI, RB, Q.open, yf);
        if (L.move === 'egg') return boreAt(0.8 * Math.PI, Q, yf, Q.open);
        return L.at;
      },
      focus: BC,
    };
  }

  S.Objects = { steering, conrod };
})(window.STAGE = window.STAGE || {});
