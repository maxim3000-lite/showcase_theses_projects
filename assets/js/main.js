/* =========================================================
   Portfolio – Interaktionen & Komponenten
   - Header-Zustand
   - Schreibmaschinen-Effekt (Shell-Stil, einmalig beim ersten Scrollen)
   - Einblenden von Elementen
   - Standortkarte (Locator)
   - Crash-Scrollytelling
   - Bauteil ↔ Effekt-Visualisierung
   - Knowledge Graph
   ========================================================= */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** rAF-Animation; `alive()` erlaubt Abbruch, wenn sich der Zustand ändert. */
  function tween(duration, onFrame, alive = () => true) {
    return new Promise((resolve) => {
      if (reduceMotion || duration <= 0) { onFrame(1); resolve(); return; }
      const start = performance.now();
      const tick = (now) => {
        if (!alive()) { resolve(); return; }
        const p = Math.min(1, (now - start) / duration);
        onFrame(p);
        if (p < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  /** Einfacher deterministischer Zufallsgenerator (stabile Grafiken). */
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 3D-Ansicht an/aus (Einstellung bleibt im Browser gespeichert) ---------- */
  const stageToggle = $('.stage-toggle');
  if (stageToggle) {
    let off = false;
    try { off = localStorage.getItem('stage') === 'off'; } catch (e) { /* kein Speicher */ }
    const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })();
    if (webgl) {
      stageToggle.hidden = false;
      stageToggle.setAttribute('aria-pressed', String(!off));
      stageToggle.textContent = off ? 'Turn on 3D view' : 'Turn off 3D view';
      stageToggle.addEventListener('click', () => {
        try { localStorage.setItem('stage', off ? 'on' : 'off'); } catch (e) { /* kein Speicher */ }
        window.location.reload();
      });
    }
  }

  /* ---------- Header ---------- */
  const header = $('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Aktiven Reiter auf schmalen Displays sichtbar halten
  const tabList = $('.tabs ul');
  const activeTab = $('.tabs [aria-current="page"]');
  if (tabList && activeTab && tabList.scrollWidth > tabList.clientWidth) {
    const li = activeTab.parentElement;
    tabList.scrollLeft = li.offsetLeft - (tabList.clientWidth - li.offsetWidth) / 2;
  }

  /* ---------- 3D-Modus: alle Textblöcke wandern in ein festes Terminal-Fenster oben rechts ----------
     Die Abschnitte ([data-scene]) bleiben als leere Scroll-Strecken stehen; ihr Inhalt wird – in
     unveränderter Reihenfolge – in das Terminal verschoben. Sichtbar ist der aktuelle Abschnitt;
     data-pin="<scene>" hält zusätzlich den Inhalt eines früheren Abschnitts darüber fest (Steckbrief). */
  function buildDeck() {
    if (!root.classList.contains('has-stage')) return null;
    const scenes = $$('[data-scene]');
    const main = $('#main');
    if (!scenes.length || !main) return null;
    const path = $('.locator__path');
    const el = document.createElement('div');
    el.className = 'deck';
    el.innerHTML = '<div class="deck__bar" aria-hidden="true"><span class="term__dot"></span><span class="term__dot"></span><span class="term__dot"></span><span class="deck__title"></span><span class="deck__count"></span></div><div class="deck__body"></div>';
    $('.deck__title', el).textContent = path ? path.textContent.trim() : '~';
    const body = $('.deck__body', el);
    const panels = scenes.map((sc) => {
      const p = document.createElement('div');
      p.className = 'panel';
      const parts = sc.classList.contains('step') ? [$('.step__card', sc)]
        : sc.classList.contains('locator') ? [$('.locator__hud', sc), $('.infowin', sc)]
          : [$(':scope > .container', sc)];
      parts.forEach((n) => { if (n) p.appendChild(n); });
      sc.__panel = p;
      body.appendChild(p);
      return p;
    });
    scenes.forEach((sc, i) => {
      const pin = sc.dataset.pin ? scenes.findIndex((s) => s.dataset.scene === sc.dataset.pin) : -1;
      panels[i].__base = pin >= 0 && pin < i ? pin : -1;
      if (panels[i].__base >= 0) panels[i].classList.add('is-sub');
    });
    main.prepend(el);
    return { el, body, panels, scenes };
  }
  const DECK = buildDeck();
  const inDeck = (el) => !!(DECK && el.closest('.deck'));

  /* ---------- Schreibmaschinen-Effekt ---------- */
  const SPEED = {
    default: { perChar: 30, max: 1200 },
    fast: { perChar: 5, max: 800 },
    title: { perChar: 26, max: 4200 },
  };

  function textNodes(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) out.push({ node: n, text: n.data });
    return out;
  }

  /** Tippt den Text eines Elements Zeichen für Zeichen; inneres Markup bleibt erhalten.
      alive() = false bricht ab und zeigt sofort den vollständigen Text. */
  function typeElement(el, alive = () => true) {
    return new Promise((resolve) => {
      const items = textNodes(el);
      const total = items.reduce((sum, i) => sum + i.text.length, 0);
      const finish = () => {
        el.classList.remove('tw-pending', 'tw-typing');
        el.classList.add('tw-done');
        el.style.minHeight = '';
        resolve();
      };
      if (reduceMotion || !total) { items.forEach((i) => { i.node.data = i.text; }); finish(); return; }

      const cfg = SPEED[el.dataset.type] || SPEED.default;
      const duration = Math.min(total * cfg.perChar, cfg.max);
      // Höhe festhalten (in den CSS-Pixeln des Elements – im Terminal kann ein Zoom aktiv sein)
      const z = el.currentCSSZoom || parseFloat((el.closest('.panel') || el).style.zoom) || 1;
      el.style.minHeight = `${el.getBoundingClientRect().height / z}px`;
      items.forEach((i) => { i.node.data = ''; });
      el.classList.remove('tw-pending');
      el.classList.add('tw-typing');

      tween(duration, (p) => {
        let count = Math.round(p * total);
        for (const i of items) {
          const take = Math.min(i.text.length, count);
          if (i.node.data.length !== take) i.node.data = i.text.slice(0, take);
          count -= take;
        }
      }, alive).then(() => { items.forEach((i) => { i.node.data = i.text; }); finish(); });
    });
  }

  // Elemente, die gemeinsam sichtbar werden, werden nacheinander getippt.
  let typeChain = Promise.resolve();
  const queueType = (el) => { typeChain = typeChain.then(() => typeElement(el)); return typeChain; };

  // Im Terminal wird beim ersten Öffnen eines Abschnitts getippt (siehe initDeck), nicht beim Sichtbarwerden
  $$('[data-type]').filter((el) => inDeck(el) && !el.closest('[data-type-manual]'))
    .forEach((el) => el.classList.add(reduceMotion ? 'tw-done' : 'tw-pending'));

  const autoTyped = $$('[data-type]').filter((el) => !el.closest('[data-type-manual]') && !inDeck(el));
  if (!reduceMotion && 'IntersectionObserver' in window) {
    autoTyped.forEach((el) => el.classList.add('tw-pending'));
    const io = new IntersectionObserver((entries) => {
      entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        .forEach((e) => { io.unobserve(e.target); queueType(e.target); });
    }, { rootMargin: '0px 0px -8% 0px' });
    autoTyped.forEach((el) => io.observe(el));
  } else {
    autoTyped.forEach((el) => el.classList.add('tw-done'));
  }

  /* ---------- Einblenden ---------- */
  function onceVisible(elements, cb, options = { rootMargin: '0px 0px -12% 0px' }) {
    if (!('IntersectionObserver' in window)) { elements.forEach(cb); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); cb(e.target); } });
    }, options);
    elements.forEach((el) => io.observe(el));
  }
  onceVisible($$('.reveal, .trail, .kg').filter((el) => !inDeck(el)), (el) => el.classList.add('is-in'));

  /* =========================================================
     Standortkarte
     ========================================================= */
  const CITIES = [
    ['Hamburg', 53.551, 9.994], ['Berlin', 52.520, 13.405], ['Hanover', 52.375, 9.732],
    ['Bremen', 53.079, 8.802], ['Magdeburg', 52.121, 11.628], ['Cologne', 50.938, 6.960],
    ['Frankfurt', 50.110, 8.682], ['Leipzig', 51.340, 12.375], ['Dresden', 51.050, 13.738],
    ['Nuremberg', 49.452, 11.077], ['Stuttgart', 48.776, 9.183], ['Munich', 48.137, 11.576],
    ['Zurich', 47.377, 8.541], ['Salzburg', 47.809, 13.055], ['Innsbruck', 47.269, 11.404],
    ['Linz', 48.306, 14.286], ['Vienna', 48.208, 16.373], ['Graz', 47.071, 15.439],
    ['Prague', 50.075, 14.438], ['Amsterdam', 52.368, 4.904], ['Copenhagen', 55.676, 12.568],
    ['Passau', 48.574, 13.461], ['Kassel', 51.312, 9.480], ['Düsseldorf', 51.227, 6.773],
  ];

  function toDMS(value, pos, neg) {
    const abs = Math.abs(value);
    let d = Math.floor(abs);
    let m = Math.floor((abs - d) * 60);
    let s = Math.round(((abs - d) * 60 - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″ ${value >= 0 ? pos : neg}`;
  }
  const fmtCoord = (la, lo) => `${Math.abs(la).toFixed(4)}° ${la >= 0 ? 'N' : 'S'} · ${Math.abs(lo).toFixed(4)}° ${lo >= 0 ? 'E' : 'W'}`;

  function initLocator(sec, index) {
    const lat = parseFloat(sec.dataset.lat);
    const lon = parseFloat(sec.dataset.lon);
    const place = sec.dataset.place || '';
    const mapEl = $('.locator__map', sec);
    if (!mapEl || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const W = 1000, H = 640, S = 120, Z = 3.4;
    const k = Math.cos((lat * Math.PI) / 180);
    const project = (la, lo) => [(lo - lon) * S * k + W / 2, (lat - la) * S + H / 2];

    const latHalf = (H / S) * Z / 2 + 1;
    const lonHalf = (W / (S * k)) * Z / 2 + 1;
    const [x0, y0] = project(lat + latHalf, lon - lonHalf);
    const [x1, y1] = project(lat - latHalf, lon + lonHalf);

    let grid = '';
    for (let la = Math.floor(lat - latHalf); la <= Math.ceil(lat + latHalf); la++) {
      const [, y] = project(la, lon);
      grid += `<line class="map-grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" vector-effect="non-scaling-stroke"/>`;
      const [lx] = project(la, Math.floor(lon) - 3);
      grid += `<text class="map-grid-label" x="${lx + 4}" y="${y - 4}">${la}°N</text>`;
    }
    for (let lo = Math.floor(lon - lonHalf); lo <= Math.ceil(lon + lonHalf); lo++) {
      const [x] = project(lat, lo);
      grid += `<line class="map-grid" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" vector-effect="non-scaling-stroke"/>`;
      if (lo === Math.floor(lon) - 3) continue; // Kreuzung mit den Breitengrad-Labels freihalten
      const [, ly] = project(Math.ceil(lat) + 1, lo);
      grid += `<text class="map-grid-label" x="${x + 4}" y="${ly - 4}">${lo}°E</text>`;
    }

    const cities = CITIES
      .filter(([, la, lo]) => Math.hypot(la - lat, (lo - lon) * k) > 0.3)
      .map(([name, la, lo]) => {
        const [x, y] = project(la, lo);
        return `<g class="map-city"><circle cx="${x}" cy="${y}" r="3.5"/><text x="${x + 8}" y="${y + 4}">${name}</text></g>`;
      }).join('');

    const cs = S / 4;
    // Mit 3D-Bühne zeichnet WebGL die Karte; hier nur Koordinaten + Info-Fenster
    if (!root.classList.contains('has-stage')) mapEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="dots-${index}" width="${cs * k}" height="${cs}" patternUnits="userSpaceOnUse" x="${W / 2}" y="${H / 2}">
            <circle cx="${(cs * k) / 2}" cy="${cs / 2}" r="1.5" fill="var(--map-dot)"/>
          </pattern>
        </defs>
        <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="url(#dots-${index})"/>
        ${grid}
        ${cities}
        <line class="map-cross" x1="${x0}" y1="${H / 2}" x2="${x1}" y2="${H / 2}" vector-effect="non-scaling-stroke"/>
        <line class="map-cross" x1="${W / 2}" y1="${y0}" x2="${W / 2}" y2="${y1}" vector-effect="non-scaling-stroke"/>
        <circle class="map-ring" cx="${W / 2}" cy="${H / 2}" r="16"/>
        <circle class="map-ring map-ring--2" cx="${W / 2}" cy="${H / 2}" r="16"/>
        <circle class="map-pin" cx="${W / 2}" cy="${H / 2}" r="9"/>
        <text class="map-pin-label" x="${W / 2 - 14}" y="${H / 2 - 18}" text-anchor="end">${place}</text>
      </svg>`;
    const svg = $('svg', mapEl);

    const setZoom = (z) => {
      if (!svg) return;
      const w = W * z, h = H * z;
      svg.setAttribute('viewBox', `${W / 2 - w / 2} ${H / 2 - h / 2} ${w} ${h}`);
    };

    const scope = sec.__panel || sec; // im 3D-Modus stehen Koordinaten und Info-Fenster im Terminal
    const val = $('.coords__val', scope);
    const dms = $('.coords__dms', scope);
    const status = $('.coords__status', scope);
    const info = $('.infowin', scope);
    const infoRows = info ? $$('[data-type]', info) : [];


    const run = async () => {
      const random = rng(index + 7);
      if (status) status.textContent = 'Acquiring GPS fix …';
      if (dms) dms.textContent = '—';
      await tween(2400, (p) => {
        const e = easeInOut(p);
        setZoom(Math.pow(Z, 1 - e));
        if (val) {
          const n = (1 - e) * 4;
          val.textContent = fmtCoord(lat + (random() - 0.5) * n, lon + (random() - 0.5) * n);
        }
      });
      setZoom(1);
      sec.classList.add('is-fixed');
      if (val) val.textContent = fmtCoord(lat, lon);
      if (dms) dms.textContent = `${toDMS(lat, 'N', 'S')}  ${toDMS(lon, 'E', 'W')}`;
      if (status) status.textContent = `✓ Location: ${place}`;
      await sleep(500);
      if (info) {
        info.classList.add('is-open');
        await sleep(350);
        for (const row of infoRows) await typeElement(row);
      }
    };

    setZoom(Z);
    onceVisible([sec], run, { threshold: 0.25 });
  }
  $$('.locator').forEach(initLocator);

  /* =========================================================
     Fahrzeug-Komponente (Seitenansicht, schematisch)
     Lokale Koordinaten: Heck bei x=0, Front bei x≈420, Boden y=318
     ========================================================= */
  const CAR = {
    body: 'M6,262 L4,214 Q6,196 30,190 L112,180 Q150,124 196,116 L286,116 Q318,120 350,172 L398,182 Q420,188 420,214 L418,256 Q416,266 404,266 L366,266 A36,36 0 0 0 294,266 L126,266 A36,36 0 0 0 54,266 L16,266 Q6,266 6,262 Z',
    bodyCrushed: 'M6,262 L4,214 Q6,196 30,190 L112,180 Q150,124 196,116 L284,118 Q304,124 318,150 L334,142 L342,160 L354,150 L364,176 Q370,190 368,214 L364,252 L354,266 A36,36 0 0 0 282,266 L126,266 A36,36 0 0 0 54,266 L16,266 Q6,266 6,262 Z',
    win1: 'M124,178 Q156,134 198,128 L238,128 L238,178 Z',
    win2: 'M248,128 L282,128 Q304,134 334,176 L248,178 Z',
    win2Crushed: 'M248,128 L280,130 Q298,136 312,160 L248,178 Z',
    firewall: 'M262,140 C266,180 266,222 270,256',
    firewallA: 'M262,140 C244,180 246,222 270,256',
    firewallB: 'M262,140 C257,180 257,222 270,256',
    beam: 'M262,240 L412,240',
    beamA: 'M262,240 L296,240 L306,230 L318,250 L330,230 L342,250 L356,240',
    beamB: 'M262,240 L288,240 L295,232 L302,248 L309,232 L316,248 L323,232 L330,248 L337,232 L344,248 L356,240',
  };

  const wheel = (x) => `<g class="wheel"><circle cx="${x}" cy="288" r="30"/><circle class="wheel__hub" cx="${x}" cy="288" r="11"/><line class="wheel__spoke" x1="${x}" y1="279" x2="${x}" y2="297"/></g>`;

  function carCrushed(variant = 'A') {
    return `<g class="car__crushed">
      <path class="car__body" d="${CAR.bodyCrushed}"/>
      <path class="car__win" d="${CAR.win1}"/><path class="car__win" d="${CAR.win2Crushed}"/>
      <path class="car__crack" d="M328,146 l6,6 l-4,5 l8,4"/>
      <g class="xray">
        <path class="xr-firewall" d="${variant === 'B' ? CAR.firewallB : CAR.firewallA}"/>
        <rect class="xr-engine" x="282" y="158" width="60" height="74" rx="8" transform="rotate(-6 312 195)"/>
        <circle class="xr-booster" cx="266" cy="168" r="13"/>
        <path class="xr-beam" d="${variant === 'B' ? CAR.beamB : CAR.beamA}"/>
        <rect class="xr-bumper" x="356" y="220" width="8" height="38" rx="2" transform="rotate(4 360 239)"/>
      </g>
      ${wheel(90)}${wheel(318)}
    </g>`;
  }

  /* =========================================================
     Crash-Scrollytelling
     ========================================================= */
  // Die Fahrzeugszene selbst rendert die 3D-Bühne (assets/js/stage/);
  // hier laufen nur die Detailgrafiken in den Schritt-Karten.
  function figPlay(fig, alive) {
    fig.classList.remove('play', 'is-plastic');
    void fig.getBoundingClientRect(); // Animation neu starten
    fig.classList.add('play');

    const kind = fig.dataset.kind;
    if (kind === 'flow') {
      const path = $('.fig-curve', fig);
      const dot = $('.fig-dot', fig);
      const len = path.getTotalLength();
      const yieldLen = parseFloat(fig.dataset.yield || '0.32') * len;
      const place = (l) => { const pt = path.getPointAtLength(l); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); };
      place(0);
      sleep(300).then(() => tween(2600, (p) => {
        const l = easeInOut(p) * len;
        place(l);
        fig.classList.toggle('is-plastic', l > yieldLen);
      }, alive));
    }

    if (kind === 'buckle') {
      // Ausknicken: ein Knick in eine Richtung (asymmetrisch bei Punkt K) – keine Falten
      const beam = $('.fig-beam', fig);
      const arrow = $('.fig-arrow-g', fig);
      const hinge = $('.fig-hinge', fig);
      const N = 11, K = 4;
      const from = Array.from({ length: N }, (_, i) => [40 + i * 22, 80]);
      const to = Array.from({ length: N }, (_, i) => [40 + i * 17.5, 80 - 42 * (i <= K ? i / K : (N - 1 - i) / (N - 1 - K))]);
      const draw = (p) => {
        // kurze elastische Stauchung, dann schlagartiges Ausknicken
        const e = p < 0.3 ? 0.04 * (p / 0.3) : 0.04 + 0.96 * (1 - Math.pow(1 - (p - 0.3) / 0.7, 3));
        const pts = from.map(([fx, fy], i) => [fx + (to[i][0] - fx) * e, fy + (to[i][1] - fy) * e]);
        beam.setAttribute('d', `M${pts.map((pt) => pt.map((v) => v.toFixed(1)).join(',')).join(' L')}`);
        arrow.setAttribute('transform', `translate(${(pts[N - 1][0] - from[N - 1][0]).toFixed(1)} 0)`);
        if (hinge) { hinge.setAttribute('cx', pts[K][0].toFixed(1)); hinge.setAttribute('cy', pts[K][1].toFixed(1)); }
        fig.classList.toggle('is-plastic', e > 0.3);
      };
      draw(0);
      sleep(300).then(() => tween(2400, draw, alive));
    }
  }

  /** FE-Netz für die Versagens-Grafik (11 × 5 Elemente). */
  function buildMesh(g) {
    const cols = 11, rows = 5, size = 20, ox = 40, oy = 22;
    const failed = [[5, 0], [5, 1], [5, 2], [6, 2], [6, 3], [5, 4]];
    const key = (c, r) => `${c},${r}`;
    const failIndex = new Map(failed.map(([c, r], i) => [key(c, r), i]));
    let out = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let cls = '';
        let style = '';
        if (failIndex.has(key(c, r))) {
          cls = 'fail';
          style = ` style="--i:${failIndex.get(key(c, r))}"`;
        } else {
          const d = Math.min(...failed.map(([fc, fr]) => Math.max(Math.abs(fc - c), Math.abs(fr - r))));
          cls = d === 1 ? 's2' : d === 2 ? 's1' : '';
        }
        out += `<rect class="${cls}"${style} x="${ox + c * size}" y="${oy + r * size}" width="${size}" height="${size}"/>`;
      }
    }
    g.innerHTML = out;
  }
  $$('[data-mesh]').forEach(buildMesh);

  /** Kurbeltrieb (Bachelorarbeit): Kolbenweg und Pleuelwinkel exakt aus dem Kurbelwinkel */
  function initCrank(svg) {
    const cx = 222, cy = 80, r = 34, L = 112;
    const piston = $('.ck-piston', svg), rod = $('.ck-rod', svg), crank = $('.ck-crank', svg);
    if (!piston || !rod || !crank) return;
    const draw = (th) => {
      const px = cx + r * Math.cos(th), py = cy + r * Math.sin(th);
      const xp = px - Math.sqrt(L * L - (py - cy) * (py - cy));   // Kolbenbolzen auf der Zylinderachse
      const ang = (Math.atan2(py - cy, px - xp) * 180) / Math.PI;
      piston.setAttribute('transform', `translate(${xp.toFixed(2)} 0)`);
      rod.setAttribute('transform', `translate(${xp.toFixed(2)} ${cy}) rotate(${ang.toFixed(2)})`);
      crank.setAttribute('transform', `rotate(${((th * 180) / Math.PI).toFixed(2)} ${cx} ${cy})`);
    };
    draw(0.9);
    if (reduceMotion) return;
    const t0 = performance.now();
    const loop = (now) => {
      if (!svg.isConnected) return;
      draw(((now - t0) / 1000) * 2.4);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  $$('[data-kind="crank"] svg').forEach(initCrank);

  /** Aktiver Schritt = Karte nahe der Bildschirmmitte; dessen Detailgrafik startet. */
  function initCrash(sec) {
    const steps = $$('.step', sec);
    let current = null;
    let token = 0;

    function activate(step) {
      if (step === current) return;
      current = step;
      token += 1;
      const myToken = token;
      const alive = () => myToken === token;
      steps.forEach((s) => s.classList.toggle('is-active', s === step));
      $$('.fig', sec).forEach((f) => f.classList.remove('play'));
      const fig = step && $('.fig', step);
      if (fig) figPlay(fig, alive);
    }

    let ticking = false;
    function update() {
      ticking = false;
      const line = window.innerHeight * 0.5;
      let best = null;
      let bestDist = Infinity;
      steps.forEach((st) => {
        const r = $('.step__card', st).getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - line);
        if (d < bestDist) { bestDist = d; best = st; }
      });
      activate(bestDist < window.innerHeight * 0.6 ? best : null);
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }
  if (!DECK) $$('.crash').forEach(initCrash); // im 3D-Modus steuert das Terminal die Detailgrafiken

  /* =========================================================
     Terminal (3D-Modus): zeigt den aktuellen Abschnitt; Text bleibt stehen,
     beim Wechsel Überblendung im selben Fenster, beim ersten Öffnen wird getippt
     ========================================================= */
  async function typePanel(panel, alive) {
    const els = $$('[data-type]', panel).filter((e) => !e.closest('[data-type-manual]') && e.classList.contains('tw-pending'));
    for (const e of els) {
      if (!alive()) break;
      await typeElement(e, alive);
    }
    els.forEach((e) => { if (e.classList.contains('tw-pending')) { e.classList.remove('tw-pending'); e.classList.add('tw-done'); } });
  }

  function initDeck({ el, body, panels, scenes }) {
    const count = $('.deck__count', el);
    const bar = $('.deck__bar', el);
    const narrow = window.matchMedia('(max-width: 900px)');
    let cur = -1, token = 0, hTimer = 0, visible = [];

    const avail = () => parseFloat(getComputedStyle(el).maxHeight) - bar.offsetHeight - 2;
    const zoomOf = (p) => parseFloat(p.style.zoom) || 1;
    const applyZoom = (p) => { p.style.zoom = p.__z && p.__z < 0.995 ? p.__z.toFixed(3) : ''; };
    const bases = [...new Set(panels.filter((p) => p.__base >= 0).map((p) => panels[p.__base]))];
    // dargestellte Höhe eines sichtbaren Abschnitts (aus der Messung – unabhängig von laufenden Übergängen)
    const shownHeight = (q, base) => (q === base ? (narrow.matches ? 0 : q.__rp) : q.__r);

    /* Kein Scrollen im Fenster: Schrift je Abschnitt so verkleinern (zoom), dass alles passt.
       Ein angehefteter Steckbrief und seine Unterabschnitte teilen sich einen Faktor,
       damit die Schrift beim Weiterscrollen nicht springt. */
    function fitAll() {
      const wasPinned = panels.filter((p) => p.classList.contains('is-pinned'));
      const rect = (p) => p.getBoundingClientRect().height;
      const measure = (key) => { // Höhe normal (key) und angeheftet (key + 'p')
        panels.forEach((p) => p.classList.remove('is-pinned'));
        panels.forEach((p) => { p[key] = rect(p); });
        bases.forEach((b) => b.classList.add('is-pinned'));
        bases.forEach((b) => { b[`${key}p`] = rect(b); });
        bases.forEach((b) => b.classList.remove('is-pinned'));
      };
      body.classList.add('is-measuring', 'is-raw');
      measure('__h');
      const a = avail();
      const fit = (h) => Math.max(0.7, Math.min(1, (a / h) * 0.985));
      panels.forEach((p) => { p.__z = fit(p.__h); });
      if (!narrow.matches) { // auf dem Smartphone wird der Steckbrief beim Anheften ausgeblendet
        panels.forEach((p) => { if (p.__base >= 0) { const b = panels[p.__base]; b.__z = Math.min(b.__z, fit(b.__hp + p.__h)); } });
        panels.forEach((p) => { if (p.__base >= 0) p.__z = panels[p.__base].__z; });
      }
      body.classList.remove('is-raw');
      panels.forEach(applyZoom);
      measure('__r');
      wasPinned.forEach((p) => p.classList.add('is-pinned'));
      void body.offsetHeight; // Zustand übernehmen, solange Übergänge noch aus sind
      body.classList.remove('is-measuring');
    }

    function show(i) {
      if (i === cur) return;
      cur = i;
      token += 1;
      const my = token, alive = () => my === token;
      const p = panels[i];
      const base = p.__base >= 0 ? panels[p.__base] : null;
      const next = base ? [base, p] : [p];
      const box = body.getBoundingClientRect();

      // ausgehende Abschnitte blenden an ihrer Stelle aus
      visible.filter((q) => !next.includes(q)).forEach((q) => {
        q.style.top = `${(q.getBoundingClientRect().top - box.top) / zoomOf(q)}px`;
        q.classList.remove('is-current');
        clearTimeout(q.__t);
        q.__t = setTimeout(() => { if (!q.classList.contains('is-current')) q.style.top = ''; }, 450);
      });
      next.forEach((q) => { clearTimeout(q.__t); q.style.top = ''; q.classList.add('is-current'); });
      panels.forEach((q) => q.classList.toggle('is-pinned', q === base));
      visible = next;

      count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(panels.length).padStart(2, '0')}`;
      if (!reduceMotion && box.height > 0) { // Fensterhöhe weich an den neuen Inhalt anpassen
        const h1 = Math.min(next.reduce((s, q) => s + shownHeight(q, base), 0), avail());
        body.style.height = `${box.height}px`;
        void body.offsetHeight;
        body.style.height = `${h1}px`;
        clearTimeout(hTimer);
        hTimer = setTimeout(() => { body.style.height = ''; }, 480);
      }

      next.forEach((q) => {
        if (q.__seen) return;
        q.__seen = true;
        $$('.reveal, .trail', q).forEach((x) => x.classList.add('is-in'));
      });
      (async () => { // beim ersten Öffnen tippen – angehefteter Steckbrief zuerst
        for (const q of next) {
          if (q.__typed) continue;
          q.__typed = true;
          await typePanel(q, alive);
        }
      })();
      const fig = $('.fig', p);
      if (fig) figPlay(fig, alive);
    }

    // aktueller Abschnitt = der, dessen Bereich die Bildschirmmitte überdeckt (wie die 3D-Szene)
    function current() {
      const line = window.innerHeight * 0.5;
      let idx = 0;
      for (let k = 0; k < scenes.length; k++) {
        if (scenes[k].getBoundingClientRect().top <= line) idx = k; else break;
      }
      return idx;
    }
    let ticking = false, rTimer = 0;
    const update = () => { ticking = false; show(current()); };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', () => {
      clearTimeout(rTimer);
      rTimer = setTimeout(() => { fitAll(); update(); }, 150);
    });

    // Tastatur: Fokus in einem anderen Abschnitt → dorthin scrollen, damit er sichtbar wird
    panels.forEach((p, i) => p.addEventListener('focusin', () => {
      if (visible.includes(p)) return;
      const r = scenes[i].getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.3, behavior: reduceMotion ? 'auto' : 'smooth' });
    }));
    fitAll();
    update();
  }
  if (DECK) initDeck(DECK);

  /* =========================================================
     Bauteil ↔ Effekt (Variante A/B)
     ========================================================= */
  function initLinkFig(el) {
    const canvas = $('.linkfig__canvas', el);
    canvas.innerHTML = `
      <svg viewBox="176 92 264 214" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="hatch-l" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line class="hatch-line" x1="0" y1="0" x2="0" y2="6"/>
          </pattern>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/>
          </marker>
        </defs>
        <line class="scene-ground" x1="176" y1="318" x2="440" y2="318"/>
        <rect x="366" y="96" width="16" height="222" fill="url(#hatch-l)" stroke="var(--ink)" stroke-width="1"/>
        ${carCrushed('A')}
        <path class="link-arrow" d="M326,236 C324,206 296,192 266,196" marker-end="url(#arrowhead)"/>
        <text class="link-label link-label--z" x="186" y="106">Z: Δ firewall intrusion</text>
        <line x1="236" y1="109" x2="258" y2="146" stroke="var(--warn)" stroke-width=".8"/>
        <text class="link-label link-label--x" x="186" y="259">X: Δ rail</text>
        <text class="link-label link-label--k" x="300" y="212">relationship</text>
      </svg>`;
    const beam = $('.xr-beam', canvas);
    const wall = $('.xr-firewall', canvas);
    const bar = $('.bar__fill[data-variant]', el);
    const buttons = $$('[data-set-variant]', el);
    const desc = $('[data-variant-desc]', el);

    const set = (v) => {
      beam.setAttribute('d', v === 'B' ? CAR.beamB : CAR.beamA);
      wall.setAttribute('d', v === 'B' ? CAR.firewallB : CAR.firewallA);
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setVariant === v)));
      if (bar) bar.style.setProperty('--w', v === 'B' ? '38%' : '82%');
      if (window.STAGE && window.STAGE.setVariant) window.STAGE.setVariant(v);
      if (desc) desc.textContent = v === 'B'
        ? 'Variant B: modified rail geometry – stable folding, less firewall intrusion.'
        : 'Variant A: baseline – the rail buckles early, the firewall intrudes more.';
    };
    buttons.forEach((b) => b.addEventListener('click', () => {
      set(b.dataset.setVariant);
      // nach der ersten Auswahl verschwindet die animierte Hand
      const sw = b.closest('.variant-switch');
      if (sw) sw.classList.add('is-used');
    }));
    set('A');
  }
  $$('.linkfig').forEach(initLinkFig);

  /* =========================================================
     Knowledge Graph
     ========================================================= */
  const KG_TYPES = {
    component: ['Component', 'var(--blue)'],
    modification: ['Modification', 'var(--accent)'],
    effect: ['Effect', 'var(--warn)'],
    loadcase: ['Load case', 'var(--amber)'],
    variant: ['Variant', 'var(--violet)'],
    simulation: ['Simulation', 'var(--slate)'],
    decision: ['Decision', 'var(--ink)'],
  };
  const KG_NODES = [
    { id: 'c', label: 'Longitudinal rail', type: 'component', x: 140, y: 110 },
    { id: 'm', label: 'Δ Geometry', type: 'modification', x: 400, y: 64 },
    { id: 'e', label: 'Firewall intrusion', type: 'effect', x: 650, y: 120 },
    { id: 'l', label: 'Frontal crash', type: 'loadcase', x: 430, y: 236 },
    { id: 'v', label: 'Model variant B', type: 'variant', x: 160, y: 330 },
    { id: 's', label: 'Simulation #[n]', type: 'simulation', x: 430, y: 400 },
    { id: 'd', label: 'Design decision', type: 'decision', x: 660, y: 330 },
  ];
  const KG_EDGES = [
    ['m', 'c', 'modifies'], ['m', 'e', 'causes'], ['e', 'l', 'observed under'],
    ['v', 'm', 'contains'], ['s', 'v', 'simulates'], ['s', 'e', 'evidence'],
    ['d', 'v', 'selects'], ['c', 'l', 'loaded in'],
  ];

  function initKG(el) {
    const canvas = $('.kg__canvas', el);
    const W = 800, H = 460;
    const random = rng(7);
    const bgPts = Array.from({ length: 70 }, () => [20 + random() * (W - 40), 20 + random() * (H - 40)]);
    let bg = '';
    bgPts.forEach(([x, y], i) => {
      bgPts.slice(i + 1).forEach(([x2, y2]) => {
        if (Math.hypot(x - x2, y - y2) < 85) bg += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/>`;
      });
    });
    bg += bgPts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.5 + random() * 2).toFixed(1)}"/>`).join('');

    const byId = Object.fromEntries(KG_NODES.map((n) => [n.id, n]));
    const edges = KG_EDGES.map(([a, b, label], i) => {
      const A = byId[a], B = byId[b];
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      return `<path class="kg-edge" style="--i:${i};--len:${len.toFixed(0)}" d="M${A.x},${A.y} L${B.x},${B.y}"/>
        <text class="kg-edge-label" style="--i:${i}" x="${mx}" y="${my - 6}" text-anchor="middle" paint-order="stroke" stroke="var(--surface)" stroke-width="5">${label}</text>`;
    }).join('');

    const nodes = KG_NODES.map((n, i) => {
      const [typeLabel, color] = KG_TYPES[n.type];
      const w = Math.max(n.label.length, typeLabel.length) * 7.6 + 28;
      return `<g class="kg-node" style="--i:${i};--c:${color}">
        <rect x="${n.x - w / 2}" y="${n.y - 22}" width="${w}" height="44" rx="10"/>
        <text class="kg-type" x="${n.x}" y="${n.y - 9}">${typeLabel}</text>
        <text x="${n.x}" y="${n.y + 8}">${n.label}</text>
      </g>`;
    }).join('');

    canvas.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
      <g class="kg-bg">${bg}</g>${edges}${nodes}</svg>`;

    const legend = $('.kg__legend', el);
    if (legend) {
      legend.innerHTML = Object.values(KG_TYPES)
        .map(([label, color]) => `<li><i style="--c:${color}"></i>${label}</li>`).join('');
    }
  }
  $$('.kg').forEach(initKG);
})();
