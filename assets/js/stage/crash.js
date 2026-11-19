/* =========================================================
   STAGE · Crash-Kinematik (schematisch, angelehnt an typische
   LS-DYNA-Frontalcrashs gegen eine starre Wand)
   - Eindrücken: schnell, dann abbremsend; Deformationszone wächst
     von vorn nach hinten; Crashboxen falten progressiv
   - Variante A: ein Längsträger (Seite +y) knickt einseitig aus –
     ein plastisches Gelenk, Knick in eine Richtung (keine Falten)
   - Variante B: geänderter Längsträger faltet stabil (Faltenbeulen),
     weniger Motorverschiebung → geringere Stirnwandintrusion
   - Obergurt biegt sich nach oben, Haube faltet zeltförmig auf
   - Vorderräder werden zurückgeschoben
   - Motor kippt spät nach hinten → BKV kippt in die Stirnwand
   - Fügestelle Längsträger ↔ Schweller reißt (Zickzack-Riss)
   - Heck hebt sich, am Ende federt das Fahrzeug zurück
   ========================================================= */
(function (S) {
  'use strict';
  const { clamp, smooth, Car } = S;
  const { XF, DMAX, WR, PART: P } = Car;
  const RATIO = 0.32;                         // Restlänge der Deformationszone
  const KA = 1.12, KH = 1.47, KB = 1.96;      // Ausknicken: hinteres Gelenk, Knick, vorderes Ende
  const KNOT = 0.84;                          // Knoten Obergurt / A-Säule / Scharniersäule
  const XC = Car.CRACK.x;                     // Riss an der Fügestelle Längsträger ↔ Schweller

  function pose(drive, XW) {
    const contact = XW - XF;
    const p = clamp((drive - contact) / DMAX);
    const u = clamp(p / 0.85);
    const d = DMAX * (1 - (1 - u) * (1 - u));
    const Z = d > 0 ? Math.min(d / (1 - RATIO), XF - 0.7) : 0;
    return {
      p, d, c: d / DMAX,
      x: p > 0 ? contact + d - 0.05 * smooth(0.85, 1, p) : drive,
      roll: Math.min(drive, contact) / WR,
      pitch: 0.055 * smooth(0, 0.55, p) * (1 - smooth(0.62, 1, p)),
      pivot: XF - d,
      x0: XF - Z, Z, k: Z > 0 ? 1 - d / Z : 1,
    };
  }

  function deform1(x, y, z, ny, nz, part, Q, vb, out) {
    const c = Q.c, inZone = Q.Z > 0 && x > Q.x0;
    const u = inZone ? (x - Q.x0) / Q.Z : 0;
    const ramp = inZone ? smooth(0, 0.12, x - Q.x0) : 0;
    const crushX = inZone ? Q.x0 + (x - Q.x0) * Q.k : x;
    const behind = Q.Z > 0 ? Math.exp(-(((x - Q.x0) / 0.25) ** 2)) * c : 0;
    const kv = vb ? 0.55 : 1;
    const engS = 0.16 * smooth(0.5, 1, c) * kv;   // Motor wird nach hinten geschoben …
    const engT = 0.38 * smooth(0.55, 1, c) * kv;  // … und kippt (Zylinderkopf nach hinten)
    const bkv = 0.42 * smooth(0.66, 1, c) * kv;   // BKV kippt nach dem Kontakt (Front nach unten)
    let X = x, Y = y, Zc = z, e = 0;
    switch (part) {
      case P.SKIN: {
        X = crushX;
        if (inZone) {
          const f = Math.sin(x * 28 + 1.3) * (0.6 + 0.4 * Math.sin(x * 9.3 + y * 3));
          const tent = 0.26 * c * Math.pow(Math.sin(Math.PI * clamp(u * 1.1)), 1.5) * clamp((nz - 0.4) * 2);
          const bulge = 0.05 * c * Math.sin(Math.PI * u) * clamp((Math.abs(ny) - 0.5) * 2) * Math.sign(y);
          Y += ny * 0.06 * ramp * f + bulge;
          Zc += nz * 0.06 * ramp * f + tent;
          e = (0.3 + 0.55 * Math.abs(f) * ramp + tent * 1.5) * (0.4 + 0.6 * c);
        } else {
          const a = Math.exp(-(((x - 0.85) / 0.3) ** 2)) * c;
          X -= a * (vb ? 0.008 : 0.025);
          e = behind * 0.5 + a * 0.25 * (z > 0.9 ? 1 : 0.4);
        }
        break;
      }
      case P.WHEEL: if (x > 0) X = x - Math.max(0, Q.d - 0.42) * 0.85; break;
      case P.RAIL: {
        X = crushX;
        if (vb) { // Variante B: geänderter Längsträger faltet stabil (Faltenbeulen)
          if (inZone) {
            const f = Math.sin(x * 40 + 0.6), amp = 0.03 * ramp;
            Y += f * amp * ny;
            Zc += f * amp * nz;
            e = (0.35 + 0.6 * Math.abs(f) * ramp) * (0.5 + 0.5 * c);
          } else {
            e = behind * 0.6 + c * 0.15 * Math.exp(-(((x - 0.95) / 0.14) ** 2));
          }
        } else { // Variante A: Ausknicken – nur auf der Seite +y, ein Knick nach außen (dreieckige Biegelinie, plastische Gelenke)
          const a = y > 0 ? smooth(0.1, 0.55, c) : 0;
          const tri = x < KH ? clamp((x - KA) / (KH - KA)) : clamp((KB - x) / (KB - KH));
          Y += 0.12 * a * tri;
          Zc -= 0.03 * a * tri;
          const hinge = Math.exp(-(((x - KH) / 0.045) ** 2)) + 0.45 * Math.exp(-(((x - KA) / 0.05) ** 2));
          e = (inZone ? 0.3 + 0.25 * c : behind * 0.6) + c * 0.5 * Math.exp(-(((x - 0.95) / 0.14) ** 2)) + a * 0.7 * hinge;
        }
        break;
      }
      case P.CRASHBOX: {
        X = crushX;
        if (inZone) {
          const f = Math.sin(x * 60);
          Y += f * 0.035 * ramp * ny;
          Zc += f * 0.035 * ramp * nz;
          e = 0.5 + 0.5 * Math.abs(f) * ramp;
        }
        break;
      }
      case P.BUMPER: X = crushX + 0.06 * (y / 0.8) ** 2 * smooth(0, 0.35, c); e = c * (0.35 + 0.6 * (1 - (y / 0.8) ** 2)); break;
      case P.UPPER: { // Obergurt biegt sich als Ganzes nach oben (keine Falten)
        X = crushX;
        if (inZone) {
          const b = Math.sin(Math.PI * u);
          Zc += 0.08 * c * b;
          e = 0.3 + 0.45 * c * b;
        } else {
          e = behind * 0.5 + c * 0.3 * Math.exp(-(((x - KNOT) / 0.2) ** 2));
        }
        break;
      }
      case P.SUBFRAME: { // Fahrschemel biegt sich nach unten durch
        X = crushX;
        if (inZone) { const b = Math.sin(Math.PI * u); Zc -= 0.05 * c * b; e = 0.3 + 0.35 * c * b; } else e = behind * 0.4;
        break;
      }
      case P.ENGINE: { // starre Drehung um das untere Lager (x 1.45, z 0.36) + Verschiebung
        const cs = Math.cos(engT), sn = Math.sin(engT), dx = x - 1.45, dz = z - 0.36;
        X = 1.45 + dx * cs - dz * sn - engS;
        Zc = 0.36 + dx * sn + dz * cs;
        e = c * 0.05;
        break;
      }
      case P.BOOSTER: { // kippt um die obere Lagerung an der Stirnwand (x 0.84, z 0.9) – unterer Rand schlägt ein
        const cs = Math.cos(bkv), sn = Math.sin(bkv), dx = x - 0.84, dz = z - 0.9;
        X = 0.84 + dx * cs + dz * sn - 0.02 * smooth(0.6, 1, c) * kv;
        Zc = 0.9 - dx * sn + dz * cs;
        e = c * 0.1 + bkv * 0.9;
        break;
      }
      case P.FIREWALL: {
        const dent = 0.085 * smooth(0.66, 1, c) * kv * Math.exp(-(((y - 0.14) ** 2) / 0.02 + ((z - 0.7) ** 2) / 0.012));
        const rails = c * (vb ? 0.015 : 0.05) * Math.exp(-((Math.abs(y) - 0.52) ** 2) / 0.04) * Math.exp(-((z - 0.45) ** 2) / 0.05);
        X = x - dent - rails;
        e = c * 0.08 + dent * 9 + rails * 6;
        break;
      }
      case P.JOINT: { // vorderes Rissufer an der Fügestelle: klafft oben auf (Biegung), Elemente sind gerissen
        const w = Math.exp(-(((x - XC) / 0.18) ** 2)), o = smooth(0.5, 1, c);
        X = x + 0.03 * o * w * clamp((z - 0.27) / 0.14);
        Zc = z - 0.012 * o * w;
        e = c * (0.3 + 0.65 * Math.exp(-(((x - XC) / 0.06) ** 2)));
        break;
      }
      case P.CABIN: {
        const a = Math.exp(-(((x - 0.88) / 0.3) ** 2)) * (z < 1.2 ? 1 : 0.4);
        X = x - c * (vb ? 0.01 : 0.03) * a;
        e = c * (vb ? 0.2 : 0.4) * a;
        break;
      }
      case P.SILL: e = c * (0.25 * Math.exp(-(((x - 0.84) / 0.3) ** 2)) + 0.9 * Math.exp(-(((x - XC) / 0.07) ** 2))); break;
      default: break; // starr: Bemaßung, Bodenpfad
    }
    out[0] = X; out[1] = Y; out[2] = Zc;
    return clamp(e);
  }

  const tmpB = [0, 0, 0];
  /** Deformation (Fahrzeugsystem) mit stufenloser Variante vb ∈ [0,1]; Rückgabe: Dehnung 0..1 */
  function deform(x, y, z, ny, nz, part, Q, vb, out) {
    if (Q.c <= 0 || part === P.RIGID) { out[0] = x; out[1] = y; out[2] = z; return 0; }
    if (vb <= 0.001) return deform1(x, y, z, ny, nz, part, Q, 0, out);
    if (vb >= 0.999) return deform1(x, y, z, ny, nz, part, Q, 1, out);
    const ea = deform1(x, y, z, ny, nz, part, Q, 0, out);
    const eb = deform1(x, y, z, ny, nz, part, Q, 1, tmpB);
    for (let k = 0; k < 3; k++) out[k] += (tmpB[k] - out[k]) * vb;
    return ea + (eb - ea) * vb;
  }

  /** Fahrzeugsystem → Welt: Nicken um den Kontaktpunkt (Heck hebt sich) + Fahrweg */
  function place(out, Q) {
    if (Q.pitch) {
      const c = Math.cos(Q.pitch), s = Math.sin(Q.pitch), dx = out[0] - Q.pivot, dz = out[2] - 0.45;
      out[0] = Q.pivot + dx * c + dz * s;
      out[2] = 0.45 - dx * s + dz * c;
    }
    out[0] += Q.x;
  }

  S.Crash = { pose, deform, place };
})(window.STAGE = window.STAGE || {});
