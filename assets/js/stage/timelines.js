/* =========================================================
   STAGE · Drehbücher
   Kamera und Szenenzustand je Abschnitt ([data-scene]).
   Position im Abschnitt: 0 = Abschnittsanfang erreicht die
   Bildschirmmitte, 0.5 = Abschnitt zentriert, 1 = Ende.
   Nicht genannte Werte werden vom vorherigen Schlüssel übernommen.
   shift/lift = Linsenverschiebung (NDC): das Motiv steht links,
   rechts oben liegt das Terminal mit dem Text.
   ========================================================= */
(function (S) {
  'use strict';
  const { Car } = S;

  const XW = 12;                         // starre Wand (Welt-x)
  const CONTACT = XW - Car.XF;           // Fahrzeug berührt die Wand
  const CRASHED = CONTACT + Car.DMAX;    // Crash inkl. Rückfederung abgeschlossen
  const SH = -0.36;                      // Standard: Motiv links neben dem Terminal

  // Start: Ziel = Mitte der Stationen (setzt stage.js), Bild leicht angehoben
  const BASE = {
    eye: [0, -3.8, 36.5], tgt: [0, 0, 0], fov: 38, shift: -0.36, lift: 0.12,
    phi: 0, drive: 0, pts: 1, map: 1, grid: 0, wire: 0, xray: 0, mesh: 0, fringe: 0, cloudFringe: 0, focus: 0,
    wall: 0, dims: 0, loads: 0, poi0: 0, poi1: 0, poi2: 0, poi3: 0, poiAll: 0, link: 0, anom: 0,
    edges: 0, path: 0, tess: 0, dim: 0,
    // Objekte der Unterseiten: Bauteil-Beschriftungen, Lenkbewegung, Gehäuse-Deckkraft, Crackvorgang,
    // oval = Idealkreis und Eiform der Bohrung einblenden
    parts: 0, steer: 0, shell: 1, tool: 0, wedge: 0, crack: 0, split: 0, bolt: 0, oval: 0,
  };

  const rise = (tgtZ) => ({ phi: 0.5, map: 0.35, eye: [3, -15, 11], tgt: [0, 0, tgtZ], fov: 34, shift: -0.3, lift: 0 });

  S.XW = XW;
  S.BASE = BASE;
  S.TIMELINES = {
    promotion: {
      // Formationen der Partikel in Reihenfolge (phi = Index)
      forms: ['map', 'car', 'lake', 'tess', 'car', 'runs', 'car', 'graph'],
      keys: [
        ['hero', 0.5, {}],
        // Seite 2 (Steckbrief, lange Strecke): Stationen → Punktewolke → CAD-Zeichnung mit Bemaßung
        ['title', 0, rise(0.5)],
        ['title', 0.3, { phi: 1, map: 0, grid: 0.5, eye: [8.4, -10.2, 4.0], tgt: [0.2, 0, 0.75], fov: 30, shift: SH }],
        ['title', 0.72, { wire: 1, pts: 0.3, dims: 1, grid: 0.7, eye: [0.3, -17.5, 2.3], tgt: [0, 0, 0.72], fov: 27, shift: -0.42 }],
        ['title', 1, { drive: 2.5, dims: 0 }],
        ['crash-intro', 0.5, { drive: 5, mesh: 1, wire: 0, pts: 0.1, wall: 1, eye: [10.6, -9.6, 3.6], tgt: [5.8, 0, 0.7], fov: 30, shift: SH }],
        ['step0', 0.5, { drive: CONTACT - 1.3, eye: [11.6, -7.6, 3.0], tgt: [10.1, 0, 0.6], fov: 32 }],
        ['step1', 0.5, { drive: CRASHED, fringe: 1, mesh: 0.5, xray: 0.8, loads: 1, eye: [13.0, -8.8, 3.6], tgt: [10.6, 0, 0.6] }],
        ['step2', 0.5, { loads: 0, poi0: 1, mesh: 0.06, xray: 1, pts: 0.04, eye: [11.3, 1.4, 2.9], tgt: [11.33, 0.6, 0.42], fov: 30 }],
        ['step3', 0.5, { poi0: 0, poi1: 1, eye: [11.48, -0.45, 3.6], tgt: [11.48, 0.05, 0.44], fov: 34 }],
        ['step4', 0.5, { poi1: 0, poi2: 1, mesh: 0.06, xray: 1, eye: [10.35, 1.85, 1.2], tgt: [10.95, 0.78, 0.38], fov: 30 }],
        ['step5', 0.5, { poi2: 0, poi3: 1, eye: [12.5, 1.9, 1.6], tgt: [11.2, 0.12, 0.75], fov: 32 }],
        ['step7', 0.5, { poi3: 0, poiAll: 1, mesh: 0.75, xray: 0.5, pts: 0.08, eye: [8.4, -9.4, 5.2], tgt: [10.8, 0, 0.6], fov: 30 }],
        ['step8', 0.5, { poiAll: 0, phi: 2, pts: 1, mesh: 0, xray: 0, fringe: 0, wall: 0, grid: 0.25, eye: [12, -13.5, 7.5], tgt: [12, 0, 0.3], fov: 34 }],
        // „Unlocking the treasure“ (lange Strecke): Tesserakt → gecrashte Punktewolke nach Dehnung →
        // nur die relevanten Punkte bleiben stehen
        ['challenges', 0.3, { phi: 3, tess: 1, grid: 0.15, eye: [12, -8.4, 4.2], tgt: [12, 0, 2.4], fov: 32 }],
        ['challenges', 0.62, { phi: 4, tess: 0, cloudFringe: 1, wire: 0.3, grid: 0.4, eye: [7.6, -12.4, 4.2], tgt: [10.4, 0, 0.7], fov: 30, shift: -0.36 }],
        ['challenges', 0.9, { focus: 1, wire: 0.12, eye: [9.0, -7.6, 2.9], tgt: [11.0, 0, 0.65], shift: -0.4 }],
        ['anomaly', 0.5, { phi: 5, focus: 0, anom: 1, wire: 0, grid: 0.15, eye: [13.2, -13.8, 6.2], tgt: [12, 0, 2.2], fov: 32, shift: -0.42 }],
        ['link', 0.5, { phi: 6, anom: 0, xray: 1, link: 1, pts: 0.14, wire: 0.12, cloudFringe: 0.4, grid: 0.4, eye: [10.4, 5.8, 2.7], tgt: [11.2, 0.3, 0.6], fov: 34, shift: SH }],
        ['kg', 0.5, { phi: 7, pts: 1, xray: 0, link: 0, wire: 0, cloudFringe: 0, edges: 1, grid: 0.1, eye: [15, -17, 8], tgt: [12, 0, 2.4], fov: 34, shift: -0.42 }],
        ['ai', 0.45, { path: 0.5, eye: [8.5, -15.5, 7.4], tgt: [12, 0, 2.4], shift: -0.4 }],
        ['ai', 0.9, { path: 1, eye: [10.5, -16.5, 8.2] }],
        ['pubs', 0.5, { eye: [10.5, -23, 12], fov: 30, shift: -0.42, dim: 0.5 }],
      ],
    },
    master: {
      // Partikel → FE-Netz der Zahnstangenlenkung (objects.js · steering)
      forms: ['map', 'obj'],
      obj: 'steering',
      mesh: 'steering',
      keys: [
        ['hero', 0.5, {}],
        ['title', 0, rise(0.6)],
        ['title', 0.5, { phi: 1, map: 0, grid: 0.5, eye: [8.2, -8.6, 4.6], tgt: [0, 0, 1.0], fov: 32, shift: SH }],
        ['situation', 0.5, { mesh: 1, pts: 0.08, parts: 1, steer: 1, grid: 0.6, eye: [6.2, -7.6, 4.0], tgt: [0, 0.35, 1.0], fov: 32, shift: -0.34 }],
        ['complication', 0.5, { parts: 0, steer: 0, shell: 0.1, fringe: 1, pts: 0, eye: [1.1, 0.05, 0.38], tgt: [0.2, 0.92, 1.0], fov: 30, shift: SH }],
        ['rq', 0.5, { fringe: 0, shell: 1, eye: [-7.5, -8.5, 5.5], tgt: [0, 0, 1], fov: 30, dim: 0.35 }],
        ['solution', 0.5, { fringe: 1, shell: 0.1, dim: 0, eye: [1.9, -0.5, 2.0], tgt: [0.15, 0.95, 1.05], fov: 30, shift: -0.4 }],
        ['results', 0.5, { fringe: 0, shell: 1, steer: 1, eye: [8.5, -10.5, 6.5], tgt: [0, 0, 1], dim: 0.25, shift: SH }],
      ],
    },
    bachelor: {
      // Partikel → FE-Netz des Pleuels; Crackvorgang beim Scrollen (objects.js · conrod)
      forms: ['map', 'obj'],
      obj: 'conrod',
      mesh: 'conrod',
      keys: [
        ['hero', 0.5, {}],
        ['title', 0, rise(0.8)],
        ['title', 0.5, { phi: 1, map: 0, grid: 0.5, eye: [2.0, -8.8, 4.2], tgt: [-0.1, 0, 1.0], fov: 30, shift: SH }],
        ['situation', 0.5, { mesh: 1, pts: 0.08, parts: 1, grid: 0.6, eye: [1.0, -8.8, 3.5], tgt: [-0.35, 0, 1.0], fov: 32, shift: -0.36 }],
        // Complication (lange Strecke): Werkzeug → Keil schießt ein → Riss läuft, die Bohrung wird eiförmig
        // (Blick fast senkrecht auf die Stirnseite, Idealkreis als Bezug) → Schaft fährt weg, Bruchflächen
        ['complication', 0.06, { parts: 0, pts: 0, tool: 1, eye: [3.1, 3.9, 2.7], tgt: [1.0, 0.1, 1.0], fov: 32, shift: SH }],
        ['complication', 0.22, { wedge: 0.5, eye: [2.55, 4.5, 2.3] }],
        ['complication', 0.5, { wedge: 1, crack: 1, oval: 1, eye: [1.55, 5.6, 1.7], tgt: [1.05, 0, 1.0], fov: 30 }],
        ['complication', 0.66, { eye: [1.75, 5.45, 2.05] }],
        ['complication', 0.9, { split: 1, eye: [3.35, 4.2, 3.2], tgt: [0.85, 0, 1.15], fov: 32 }],
        ['solution', 0.5, { tool: 0, oval: 0, fringe: 1, eye: [2.75, -2.75, 3.2], tgt: [0.75, 0, 1.2], fov: 32, shift: -0.38 }],
        // Verschrauben (Röntgenblick auf die Gewinde): die Eiform bleibt – Bezug Idealkreis
        ['results', 0.5, { fringe: 0, split: 0, bolt: 1, oval: 1, xray: 0.85, eye: [2.9, 4.0, 2.3], tgt: [0.6, 0, 1.0], fov: 30, dim: 0.15, shift: SH }],
      ],
    },
  };
})(window.STAGE = window.STAGE || {});
