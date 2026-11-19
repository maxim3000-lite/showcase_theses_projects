/* =========================================================
   STAGE · MeshSet
   Bündelt strukturierte Viereck-Netze zu einem Satz:
   verformen → Normalen → Farben; Dreiecke und Kanten werden
   indiziert gezeichnet (nur gelöschte Elemente ändern Indizes).
   Gitter: { nu, nv, wrapU, wrapV, src(6 je Vertex),
             flags?, skip?(i,j), fail?(cx,cy,cz,i,j) }
   ========================================================= */
(function (S) {
  'use strict';

  function MeshSet(grids) {
    let n = 0;
    grids.forEach((g) => { g.off = n; n += g.nu * g.nv; });
    if (n > 65535) throw new Error('MeshSet: too many nodes for 16-bit indices');
    this.grids = grids;
    this.n = n;
    this.src = new Float32Array(n * 6);
    grids.forEach((g) => this.src.set(g.src, g.off * 6));

    const quads = [], fail = [], mask = [];
    grids.forEach((g) => {
      const U = g.wrapU ? g.nu : g.nu - 1, W = g.wrapV ? g.nv : g.nv - 1;
      for (let i = 0; i < U; i++) {
        for (let j = 0; j < W; j++) {
          const i1 = (i + 1) % g.nu, j1 = (j + 1) % g.nv;
          const q = [i * g.nv + j, i1 * g.nv + j, i1 * g.nv + j1, i * g.nv + j1];
          if (g.flags && q.every((k) => g.flags[k])) continue;
          if (g.skip && g.skip(i, j)) continue;
          let cx = 0, cy = 0, cz = 0;
          q.forEach((k) => { cx += g.src[k * 6] / 4; cy += g.src[k * 6 + 1] / 4; cz += g.src[k * 6 + 2] / 4; });
          quads.push(...q.map((k) => k + g.off));
          fail.push(g.fail ? g.fail(cx, cy, cz, i, j) : 2);
          mask.push((!g.wrapU && i === U - 1 ? 1 : 0) | (!g.wrapV && j === W - 1 ? 2 : 0));
        }
      }
    });
    this.quads = new Uint16Array(quads);
    this.fail = new Float32Array(fail);
    this.mask = new Uint8Array(mask);
    this.nq = fail.length;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.ecol = new Float32Array(n * 4);
    this.strain = new Float32Array(n);
    this.tri = { data: new Uint16Array(this.nq * 6), count: 0, ver: 0 };
    this.edge = { data: new Uint16Array(this.nq * 8), count: 0, ver: 0 };
    this.key = '';
    this.failed = -1;
  }

  /** Indizes neu aufbauen, sobald sich die Zahl gelöschter Elemente ändert */
  MeshSet.prototype.indices = function (c) {
    let failed = 0;
    for (let q = 0; q < this.nq; q++) if (this.fail[q] <= c) failed++;
    if (failed === this.failed) return;
    this.failed = failed;
    const Q = this.quads, T = this.tri.data, E = this.edge.data;
    let t = 0, e = 0;
    for (let q = 0; q < this.nq; q++) {
      if (this.fail[q] <= c) continue;
      const a = Q[q * 4], b = Q[q * 4 + 1], cc = Q[q * 4 + 2], d = Q[q * 4 + 3];
      T[t++] = a; T[t++] = b; T[t++] = cc; T[t++] = a; T[t++] = cc; T[t++] = d;
      E[e++] = a; E[e++] = b; E[e++] = a; E[e++] = d;
      if (this.mask[q] & 1) { E[e++] = b; E[e++] = cc; }
      if (this.mask[q] & 2) { E[e++] = d; E[e++] = cc; }
    }
    this.tri.count = t; this.tri.ver++;
    this.edge.count = e; this.edge.ver++;
  };

  /** deform(src, o, out, oo) → Dehnung; color(i, part, dehnung, col, src) */
  MeshSet.prototype.update = function (key, deform, color, c) {
    this.indices(c);
    if (key === this.key) return;
    this.key = key;
    for (let i = 0; i < this.n; i++) this.strain[i] = deform(this.src, i * 6, this.pos, i * 3);
    const P = this.pos, N = this.nrm;
    this.grids.forEach((g) => {
      for (let i = 0; i < g.nu; i++) {
        const ip = g.wrapU ? (i + 1) % g.nu : Math.min(i + 1, g.nu - 1), im = g.wrapU ? (i - 1 + g.nu) % g.nu : Math.max(i - 1, 0);
        for (let j = 0; j < g.nv; j++) {
          const jp = g.wrapV ? (j + 1) % g.nv : Math.min(j + 1, g.nv - 1), jm = g.wrapV ? (j - 1 + g.nv) % g.nv : Math.max(j - 1, 0);
          const a = (g.off + ip * g.nv + j) * 3, b = (g.off + im * g.nv + j) * 3;
          const cc = (g.off + i * g.nv + jp) * 3, d = (g.off + i * g.nv + jm) * 3, o = (g.off + i * g.nv + j) * 3;
          const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
          const vx = P[cc] - P[d], vy = P[cc + 1] - P[d + 1], vz = P[cc + 2] - P[d + 2];
          N[o] = uy * vz - uz * vy; N[o + 1] = uz * vx - ux * vz; N[o + 2] = ux * vy - uy * vx + 1e-7;
        }
      }
    });
    for (let i = 0; i < this.n; i++) color(i, this.src[i * 6 + 5], this.strain[i], this.col, this.src);
  };

  MeshSet.prototype.setEdgeColor = function (rgb, a) {
    for (let i = 0; i < this.n; i++) { this.ecol[i * 4] = rgb[0]; this.ecol[i * 4 + 1] = rgb[1]; this.ecol[i * 4 + 2] = rgb[2]; this.ecol[i * 4 + 3] = a; }
  };

  MeshSet.prototype.draw = function (R, key, alpha, edgeAlpha, fog) {
    R.tris(key, this.pos, this.nrm, this.col, this.n, alpha, this.tri);
    R.lines(`${key}E`, this.pos, this.ecol, this.n, edgeAlpha, fog, true, this.edge);
  };

  S.MeshSet = MeshSet;
})(window.STAGE = window.STAGE || {});
