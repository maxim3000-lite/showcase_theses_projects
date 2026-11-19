/* =========================================================
   STAGE · Kern
   Minimaler WebGL-Renderer (Punkte, Linien, Dreiecke),
   Vektor-/Matrix-Mathematik, Farben und Colormap.
   Keine externen Abhängigkeiten.
   ========================================================= */
(function (S) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /** Deterministischer Zufall (mulberry32) – stabile Geometrie bei jedem Laden. */
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

  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  };

  /* Spaltenweise 4×4-Matrizen (WebGL-Konvention), z-Achse zeigt nach oben. */
  const M4 = {
    /** Perspektive mit Linsenverschiebung (sx, sy in NDC) – Motiv neben Textspalten. */
    perspective(fovy, aspect, near, far, sx = 0, sy = 0) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -sx, -sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, tgt, up = [0, 0, 1]) {
      const z = V.norm(V.sub(eye, tgt));
      let x = V.cross(up, z);
      if (V.len(x) < 1e-6) x = [1, 0, 0];
      x = V.norm(x);
      const y = V.cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1,
      ]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },
    /** Weltpunkt → [ndcX, ndcY, w] */
    project(m, p) {
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, y / w, w];
    },
  };

  /* ---------- Farben ---------- */
  function cssColor(name, fallback = '#888888') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const hex = raw.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const nums = raw.match(/[\d.]+/g);
    return nums && nums.length >= 3 ? [nums[0] / 255, nums[1] / 255, nums[2] / 255] : [0.5, 0.5, 0.5];
  }
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /** „Turbo“-Colormap (Polynom-Näherung) – klassische FE-Konturfarben blau → rot. */
  function turbo(t) {
    t = clamp(t);
    const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
    const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
    const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
    return [clamp(r), clamp(g), clamp(b)];
  }

  /* ---------- Shader ---------- */
  const FOG = `
    uniform vec4 uFog;
    float fog(vec3 p) {
      if (uFog.w <= 0.0) return 1.0;
      vec3 d = p - uFog.xyz;
      return exp(-dot(d, d) / (uFog.w * uFog.w));
    }`;

  const VS_POINT = `
    attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
    uniform mat4 uVP; uniform float uFocal; uniform float uAlpha;
    varying vec4 vCol;
    ${FOG}
    void main() {
      vec4 p = uVP * vec4(aPos, 1.0);
      gl_Position = p;
      gl_PointSize = clamp(aSize * uFocal / max(p.w, 0.001), 1.0, 22.0);
      vCol = vec4(aCol.rgb, aCol.a * uAlpha * fog(aPos));
    }`;
  const FS_POINT = `
    precision mediump float;
    varying vec4 vCol;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(c, c);
      if (r2 > 1.0) discard;
      float a = vCol.a * (1.0 - smoothstep(0.3, 1.0, r2));
      gl_FragColor = vec4(vCol.rgb * a, a);
    }`;
  const VS_LINE = `
    attribute vec3 aPos; attribute vec4 aCol;
    uniform mat4 uVP; uniform float uAlpha;
    varying vec4 vCol;
    ${FOG}
    void main() {
      gl_Position = uVP * vec4(aPos, 1.0);
      vCol = vec4(aCol.rgb, aCol.a * uAlpha * fog(aPos));
    }`;
  const FS_FLAT = `
    precision mediump float;
    varying vec4 vCol;
    void main() { gl_FragColor = vec4(vCol.rgb * vCol.a, vCol.a); }`;
  const VS_TRI = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol;
    uniform mat4 uVP; uniform vec3 uEye; uniform float uAlpha;
    varying vec4 vCol;
    void main() {
      gl_Position = uVP * vec4(aPos, 1.0);
      vec3 n = normalize(aNrm);
      vec3 v = normalize(uEye - aPos);
      vec3 l = normalize(vec3(0.35, -0.55, 0.8));
      float diff = abs(dot(n, l));
      float head = abs(dot(n, v));
      float rim = pow(1.0 - head, 2.5);
      vec3 c = aCol.rgb * (0.36 + 0.4 * diff + 0.3 * head) + rim * 0.2;
      vCol = vec4(c, aCol.a * uAlpha);
    }`;

  /* ---------- Renderer ---------- */
  function createRenderer(canvas) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    } catch (e) { gl = null; }
    if (!gl) return null;

    function program(vs, fs, attrs, unis) {
      const shader = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const a = {}, u = {};
      attrs.forEach((n) => { a[n] = gl.getAttribLocation(p, n); });
      unis.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
      return { p, a, u };
    }

    let PP, PL, PT;
    try {
      PP = program(VS_POINT, FS_POINT, ['aPos', 'aCol', 'aSize'], ['uVP', 'uFog', 'uFocal', 'uAlpha']);
      PL = program(VS_LINE, FS_FLAT, ['aPos', 'aCol'], ['uVP', 'uFog', 'uAlpha']);
      PT = program(VS_TRI, FS_FLAT, ['aPos', 'aNrm', 'aCol'], ['uVP', 'uEye', 'uAlpha']);
    } catch (e) {
      console.warn('Stage: Shader-Fehler', e);
      return null;
    }

    const buffers = new Map();
    function attr(prog, name, key, data, size, count) {
      const loc = prog.a[name];
      if (loc < 0) return;
      let b = buffers.get(key);
      if (!b) { b = gl.createBuffer(); buffers.set(key, b); }
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * size), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    const release = (prog) => Object.values(prog.a).forEach((l) => { if (l >= 0) gl.disableVertexAttribArray(l); });

    // Indexpuffer (Uint16) – nur bei neuer Version hochladen
    const ibufs = new Map();
    function drawIndexed(mode, key, ix) {
      let e = ibufs.get(key);
      if (!e) { e = { b: gl.createBuffer(), ver: -1 }; ibufs.set(key, e); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e.b);
      if (e.ver !== ix.ver) { gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix.data, gl.STATIC_DRAW); e.ver = ix.ver; }
      gl.drawElements(mode, ix.count, gl.UNSIGNED_SHORT, 0);
    }

    let F = { vp: null, eye: [0, 0, 0], focal: 1, glow: false };
    const blend = (glow) => {
      gl.enable(gl.BLEND);
      if (glow) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    const fog = (prog, f) => gl.uniform4f(prog.u.uFog, f ? f[0] : 0, f ? f[1] : 0, f ? f[2] : 0, f ? f[3] : 0);

    return {
      begin(vp, eye, focal, glow) {
        F = { vp, eye, focal, glow };
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
      },
      /** Dreiecke; mit ix = { data: Uint16Array, count, ver } indiziert. */
      tris(key, pos, nrm, col, count, alpha, ix) {
        if (!count || alpha <= 0.003 || (ix && !ix.count)) return;
        gl.useProgram(PT.p);
        gl.uniformMatrix4fv(PT.u.uVP, false, F.vp);
        gl.uniform3fv(PT.u.uEye, F.eye);
        gl.uniform1f(PT.u.uAlpha, alpha);
        attr(PT, 'aPos', key + ':p', pos, 3, count);
        attr(PT, 'aNrm', key + ':n', nrm, 3, count);
        attr(PT, 'aCol', key + ':c', col, 4, count);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 1.5);
        gl.depthMask(alpha > 0.55);
        blend(false);
        if (ix) drawIndexed(gl.TRIANGLES, key + ':i', ix); else gl.drawArrays(gl.TRIANGLES, 0, count);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        release(PT);
      },
      /** Linien; flat = normale Deckung (z. B. dunkle Netzkanten auch im Dark Mode). */
      lines(key, pos, col, count, alpha, fogSpec, flat, ix, overlay) {
        if (!count || alpha <= 0.003 || (ix && !ix.count)) return;
        if (overlay) gl.disable(gl.DEPTH_TEST);
        gl.useProgram(PL.p);
        gl.uniformMatrix4fv(PL.u.uVP, false, F.vp);
        gl.uniform1f(PL.u.uAlpha, alpha);
        fog(PL, fogSpec);
        attr(PL, 'aPos', key + ':p', pos, 3, count);
        attr(PL, 'aCol', key + ':c', col, 4, count);
        gl.depthMask(false);
        blend(F.glow && !flat);
        if (ix) drawIndexed(gl.LINES, key + ':i', ix); else gl.drawArrays(gl.LINES, 0, count);
        release(PL);
        if (overlay) gl.enable(gl.DEPTH_TEST);
      },
      points(key, pos, col, size, count, alpha, fogSpec, overlay) {
        if (!count || alpha <= 0.003) return;
        if (overlay) gl.disable(gl.DEPTH_TEST);
        gl.useProgram(PP.p);
        gl.uniformMatrix4fv(PP.u.uVP, false, F.vp);
        gl.uniform1f(PP.u.uFocal, F.focal);
        gl.uniform1f(PP.u.uAlpha, alpha);
        fog(PP, fogSpec);
        attr(PP, 'aPos', key + ':p', pos, 3, count);
        attr(PP, 'aCol', key + ':c', col, 4, count);
        attr(PP, 'aSize', key + ':s', size, 1, count);
        gl.depthMask(false);
        blend(F.glow);
        gl.drawArrays(gl.POINTS, 0, count);
        release(PP);
        if (overlay) gl.enable(gl.DEPTH_TEST);
      },
    };
  }

  Object.assign(S, { TAU, clamp, lerp, smooth, ease, rng, V, M4, cssColor, mix3, turbo, createRenderer });
})(window.STAGE = window.STAGE || {});
