/* fig.js — the figures that are too dense for the DOM.

   Three of the drawings on this site were fighting the browser rather than the
   maths. The island discovery field is 1,316 elements, the GPU field is 484,
   and the caustic wanted hundreds of rays and was given forty four. Every one
   of those is a live DOM node with its own style recalculation, and on a
   tablet that is where the stutter came from. It was never the host: the whole
   published site is 1.38 MB against a 1 GB limit, so there was always room to
   draw properly and no room to draw this way.

   So those three move to canvas, which redraws a few hundred thousand marks a
   second without holding any of them. The rest of the figures stay as SVG,
   because they are sparse and SVG is sharper for a dozen shapes.

   Two rules hold the whole file together.

   The canvas draws in the SAME coordinate space as the SVG that sits on top of
   it. A figure declares a viewBox once and both layers use it, so a label
   placed at x=235 in the overlay lands exactly where the canvas puts x=235.
   Nothing has to be converted by hand and nothing drifts apart when the card
   is resized.

   The canvas never draws a word. Every label stays in the SVG overlay, which
   keeps text crisp at any pixel ratio, keeps it selectable and readable by a
   screen reader, and keeps the rule that words do not move: canvas content is
   repainted every frame, and a word repainted every frame is a word that can
   shimmer. Shapes move. Words are nailed down in the layer above. */

(function () {
  'use strict';

  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Two is enough for a retina panel. Three costs four times the fill for a
     difference nobody can see, and on a tablet that is the frame budget. */
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  var TOKENS = null;
  function token(name, fallback) {
    if (!TOKENS) TOKENS = getComputedStyle(document.documentElement);
    var v = TOKENS.getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  /* --- colour ---------------------------------------------------------
     Canvas cannot read var(--coral-500) out of a stroke string, so the
     tokens are resolved once and mixed here. Everything still comes from
     site.css, so the palette stays in one place. */
  function rgba(hex, a) {
    hex = (hex || '#000').trim().replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* Smootherstep. Travel that begins and ends at zero velocity is what makes
     motion read as smooth; constant speed with a hard stop is what reads as a
     jump, however long the cycle is. */
  function ease(k) {
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    return k * k * k * (k * (k * 6 - 15) + 10);
  }

  function fit(c, vbw, vbh) {
    /* vbh is used for the letterbox; see the note below. */
    var r = c.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    if (c._w === w && c._h === h && c._dpr === DPR) return false;
    c._w = w; c._h = h; c._dpr = DPR;
    c.width = Math.round(w * DPR);
    c.height = Math.round(h * DPR);
    var vbh = arguments[2] || vbw;
    var s = Math.min(w / vbw, h / vbh);
    var ox = (w - vbw * s) / 2, oy = (h - vbh * s) / 2;
    c.getContext('2d').setTransform(s * DPR, 0, 0, s * DPR, ox * DPR, oy * DPR);
    return true;
  }

  /* ==================================================================== */
  /* caustic                                                              */
  /* ==================================================================== */
  function caustic(g, vb, t, st) {
    /* A caustic is where distinct rays crowd onto one place, and that is the
       claim the project makes about a model that cannot reach a fact. So every
       entity here is a beam of rays in its own colour, and every beam focuses
       on its answer. Where the fact is reached, each focuses on an answer of
       its own. Where it is not, beams of different colours bend and focus on
       the same answer, and the knot there is bright only because their rays
       genuinely converge on it. Nobody draws the crowding. It arrives.

       The answers are the partition, drawn as petals: one petal for each
       entity that landed there. A reached answer has one. The knot has one
       for every entity collapsed onto it, and it rings coral on every arrival,
       several times as often as any single answer. Which entity is which is
       never needed to see the difference, which is the point.

       Each ray is stroked on its own, because one path of many subpaths paints
       their union once and the crowding never accumulates. Blending is plain
       source-over: it converges on the stroke colour and never past it.

       Measured, in the preview harness:
       - A bead's whole tail vanished in one frame the moment it reached its
         answer, because the build-front test still applied after the build:
         the answer's ink dropped by 20 unit^2 in one frame. The test now
         clamps the head to the answer column first, and every swell leaves
         zero with zero slope. The largest single-frame ink jump left is a
         bead crossing a tile, not anything appearing.
       - --blue-700 and --green-500 are left out of the entity colours. At
         full alpha they composited at luminance 58 and channel sum 171, at or
         below #3a3a3a. Without them the darkest pixel is sum 229, luminance 73.
       - Worst frame is 249 strokes and fills. */
    var N = 18, R = 5, BW = 7;             /* entities, rays per entity, beam width */
    var SX = 26, AX = 398;                 /* entities enter at SX, answers sit at AX */
    var XA = 112, XB = 372;                /* the model: the only place a path may bend */
    var Y0 = 96, Y1 = 404, KY = 250, GAP = 50;
    var COLLAPSED = [1, 4, 6, 9, 12, 14, 17];
    var RANK = [2, 5, 0, 3, 6, 1, 4];      /* the order they land in the knot */
    var BUILD = 2600, V = 0.105, RIP = 1400;
    var TT = (AX - SX) / V;                /* one bead's crossing, 3,543 ms */
    var PAL = [['--blue-500', '#2456dc'], ['--amber-500', '#d96a06'], ['--violet-500', '#a66cf0'],
               ['--mint-500', '#0b93ab'], ['--amber-700', '#9a4906'], ['--violet-700', '#6b35c4'],
               ['--mint-700', '#0a6b7c']];

    function bend(x) { return ease((x - XA) / (XB - XA)); }
    function yAt(b, x, o) { var s = bend(x); return b.y0 + (b.T - b.y0) * s + o * (1 - s); }
    function hash(i, k) { var s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }

    var G = caustic.geo;
    if (!G) {
      G = caustic.geo = { xs: [], beams: [] };
      for (var x = SX; x < AX; x += 6) G.xs.push(x);
      G.xs.push(AX);
      var ci = {}, up = [], dn = [], slot = {}, i, k;
      for (k = 0; k < COLLAPSED.length; k++) ci[COLLAPSED[k]] = k;
      for (i = 0; i < N; i++) {
        if (i in ci) continue;
        (Y0 + (Y1 - Y0) * i / (N - 1) < KY ? up : dn).push(i);
      }
      for (k = 0; k < up.length; k++) slot[up[k]] = Y0 + (KY - GAP - Y0) * k / (up.length - 1);
      for (k = 0; k < dn.length; k++) slot[dn[k]] = KY + GAP + (Y1 - KY - GAP) * k / (dn.length - 1);
      for (i = 0; i < N; i++) {
        var col = i in ci;
        var b = { y0: Y0 + (Y1 - Y0) * i / (N - 1), col: col, j: col ? ci[i] : -1, pal: i % PAL.length,
                  D: col ? 200 + RANK[ci[i]] * 210 : 700 * hash(i, 1),
                  P: 1500 + 700 * hash(i, 2), rays: [] };
        b.T = col ? KY : slot[i];
        b.phi = hash(i, 3) * b.P;
        for (var r = 0; r < R; r++) {
          var o = (r / (R - 1) - 0.5) * BW, ys = new Float32Array(G.xs.length);
          for (var s = 0; s < G.xs.length; s++) ys[s] = yAt(b, G.xs[s], o);
          b.rays.push(ys);
        }
        G.beams.push(b);
      }
    }

    var T = REDUCED ? 9000 : t;
    var cs = [];
    for (var p = 0; p < PAL.length; p++) cs.push(token(PAL[p][0], PAL[p][1]));
    var coral = token('--coral-500', '#d9376e');
    var TAU = Math.PI * 2;

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';

    var n, q, bm, front = [], land = [], pile = 0;
    for (n = 0; n < N; n++) {
      bm = G.beams[n];
      front[n] = SX + (AX - SX) * ease((T - bm.D) / BUILD);
      land[n] = ease((T - bm.D - 0.86 * BUILD) / 620);
      if (bm.col) pile += land[n] / COLLAPSED.length;
    }

    /* one cached ray into the current path, cut at the build front */
    function run(ys, fx) {
      var xs = G.xs, last = 0;
      while (last + 1 < xs.length && xs[last + 1] <= fx) last++;
      g.moveTo(xs[0], ys[0]);
      for (var m = 1; m <= last; m++) g.lineTo(xs[m], ys[m]);
      if (last + 1 < xs.length) {
        g.lineTo(fx, ys[last] + (ys[last + 1] - ys[last]) * (fx - xs[last]) / (xs[last + 1] - xs[last]));
      }
    }

    /* the knot's halo sits behind everything that lands in it */
    if (pile > 0.01) {
      var br = REDUCED ? 1 : 0.84 + 0.16 * Math.sin(T / 5200 * TAU);
      var hg = g.createRadialGradient(AX, KY, 0, AX, KY, 54);
      hg.addColorStop(0, rgba(coral, 0.30 * pile * br));
      hg.addColorStop(0.45, rgba(coral, 0.12 * pile * br));
      hg.addColorStop(1, rgba(coral, 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(AX, KY, 54, 0, TAU); g.fill();
    }

    /* beams: reached first, collapsed on top so the collapse is never hidden */
    g.lineWidth = 1.25;
    for (var pass = 0; pass < 2; pass++) {
      for (n = 0; n < N; n++) {
        bm = G.beams[n];
        if (bm.col !== (pass === 1) || front[n] <= SX + 0.5) continue;
        g.strokeStyle = rgba(cs[bm.pal], 0.34);
        for (q = 0; q < R; q++) {
          g.beginPath(); run(bm.rays[q], front[n]); g.stroke();
        }
      }
    }

    /* beads of light travel each beam and are carried into its answer */
    var rip = [], hit = [], TAIL = 30;
    for (n = 0; n < N; n++) {
      bm = G.beams[n];
      var base = bm.D + 600 + bm.phi;
      hit[n] = 0;
      if (T < base) continue;
      var c2 = cs[bm.pal];
      for (var m = Math.floor((T - base) / bm.P); m >= 0; m--) {
        var age = T - base - m * bm.P;
        if (age > TT + RIP) break;
        if (age >= TT) {
          rip.push([bm, (age - TT) / RIP]);
          /* (s e^(1-s))^2 leaves zero with zero slope, so a landing swells and never pops */
          var a3 = (age - TT) / 200;
          hit[n] = Math.max(hit[n], a3 * a3 * Math.exp(2 - 2 * a3));
        }
        var xh = SX + V * age;
        if (xh - TAIL >= AX || Math.min(xh, AX) > front[n] + 1) continue;
        var xa = Math.max(SX, xh - TAIL), xb = Math.min(AX, xh);
        var pg = g.createLinearGradient(xh - TAIL, 0, xh, 0);
        pg.addColorStop(0, rgba(c2, 0));
        pg.addColorStop(1, rgba(c2, 0.95 * ease((xh - SX) / 14)));
        g.strokeStyle = pg;
        g.lineWidth = 3.4;
        g.lineCap = 'butt';
        g.beginPath();
        for (q = 0; q <= 5; q++) {
          var px = xa + (xb - xa) * q / 5;
          g.lineTo(px, yAt(bm, px, 0));
        }
        g.stroke();
        /* the head grows out of its entity and shrinks into its answer */
        var hs = ease(Math.min(xh - SX, AX - xh) / 14);
        if (hs > 0) {
          var hy = yAt(bm, xh, 0);
          g.fillStyle = rgba(c2, 0.18);
          g.beginPath(); g.arc(xh, hy, 6.5 * hs, 0, TAU); g.fill();
          g.fillStyle = rgba(c2, 1);
          g.beginPath(); g.arc(xh, hy, 2.6 * hs, 0, TAU); g.fill();
        }
        g.lineCap = 'round';
      }
    }

    /* Each arrival rings its answer in that answer's colour. A reached answer
       holds one entity, so it rings in that entity's colour, once a cycle. The
       knot is coral and rings for every entity it holds, so it rings several
       times as often: the crowding shows, and nothing has to be labelled. */
    for (q = 0; q < rip.length; q++) {
      bm = rip[q][0];
      var k2 = rip[q][1], out = 1 - (1 - k2) * (1 - k2) * (1 - k2);
      g.strokeStyle = rgba(bm.col ? coral : cs[bm.pal], 0.55 * (1 - k2) * (1 - k2) * ease(k2 / 0.14));
      g.lineWidth = bm.col ? 2.2 : 1.6;
      g.beginPath();
      g.arc(AX, bm.T, bm.col ? 20 + 24 * out : 8 + 9 * out, 0, TAU);
      g.stroke();
    }

    /* Every answer is drawn as petals, one per entity that landed on it. A
       reached answer has one petal. The knot has one for each entity the
       model collapsed onto it, all round the same centre. */
    var rot = REDUCED ? 0 : T / 18000 * TAU;
    for (n = 0; n < N; n++) {
      bm = G.beams[n];
      if (land[n] <= 0) continue;
      var c3 = cs[bm.pal], L = land[n] * (1 + 0.28 * (hit[n] || 0));
      if (!bm.col) {
        g.fillStyle = rgba(c3, 1);
        g.beginPath(); g.arc(AX, bm.T, 5 * L, 0, TAU); g.fill();
        continue;
      }
      var th = rot + bm.j * TAU / COLLAPSED.length;
      g.fillStyle = rgba(c3, 0.74);
      g.beginPath();
      g.ellipse(AX + Math.cos(th) * 10 * L, KY + Math.sin(th) * 10 * L, 11.5 * L, 6 * L, th, 0, TAU);
      g.fill();
    }
    if (pile > 0) {
      g.fillStyle = rgba(coral, 1);
      g.beginPath(); g.arc(AX, KY, 6 * Math.sqrt(pile), 0, TAU); g.fill();
    }

    /* the entities, each swelling a little as a bead leaves it */
    for (n = 0; n < N; n++) {
      bm = G.beams[n];
      var since = T - bm.D - 600 - bm.phi + 240, sw = 0;
      if (since >= 0 && !REDUCED) { since = (since % bm.P) / 240; sw = 1.1 * since * since * Math.exp(2 - 2 * since); }
      g.fillStyle = rgba(cs[bm.pal], 1);
      g.beginPath(); g.arc(SX - 4, bm.y0, 5.2 + sw, 0, TAU); g.fill();
    }
  }

  /* ==================================================================== */
  /* units — the island discovery field, driven by the slider             */
  /* ==================================================================== */
  /* One square is the entire scratch allocation of the new path. The field
     holds one square for every time the old path asked for that much. The
     reference and the field squares are drawn at the identical size, because
     enlarging the reference to make it visible would make the picture untrue.

     The count comes from the slider and runs to 1,282 at ntree = 4,096. As
     1,282 DOM rects that was the heaviest thing on the site. As canvas it is
     one path. */
  function units(g, vb, t, st) {
    var BOX_X = 300, BOX_Y = 40, BOX_W = 300, BOX_H = 270;
    var shown = Math.max(1, st.shown || 1);
    var blue = token('--blue-500', '#2456dc');
    var coral = token('--coral-500', '#d9376e');

    var cols = Math.ceil(Math.sqrt(shown));
    var rows = Math.ceil(shown / cols);
    var pitch = Math.min(BOX_W / cols, BOX_H / rows);
    var size = Math.max(1.2, pitch * 0.82);

    g.clearRect(0, 0, vb[0], vb[1]);
    st.size = size;

    /* A tide crosses the field rather than every cell blinking together, but
       it has to be gentle. Phasing on (column + row) striped the block with
       hard diagonals that read as a rendering artefact rather than as
       movement, so it runs on distance from the centre and the swing is
       small: the quantity should look alive, not corrupted. */
    var phase = REDUCED ? 0 : t / 3400;
    var midC = cols / 2, midR = rows / 2;
    for (var k = 0; k < shown; k++) {
      var r = (k / cols) | 0, c = k % cols;
      var x = BOX_X + c * pitch, y = BOX_Y + r * pitch;
      var dcx = (c - midC) / cols, dcy = (r - midR) / rows;
      var dist = Math.sqrt(dcx * dcx + dcy * dcy);
      var w = REDUCED ? 1 : 0.62 + 0.38 * Math.sin(phase * Math.PI * 2 - dist * 5.2);
      g.fillStyle = rgba(coral, 0.42 + 0.46 * w);
      g.fillRect(x, y, size, size);
    }

    /* The reference is one allocation of the new path and is drawn at exactly
       the size of a field cell, because enlarging it to make it visible would
       make the picture untrue. At ntree = 4,096 that is six pixels, which
       disappears. The ring around it is annotation and carries no quantity,
       so it can be seen without the square lying about its size. */
    var RX = 22, RY = 62;
    g.strokeStyle = rgba(blue, 0.34); g.lineWidth = 1.6;
    g.beginPath(); g.arc(RX + size / 2, RY + size / 2, 19, 0, Math.PI * 2); g.stroke();
    g.fillStyle = rgba(blue, 1);
    g.fillRect(RX, RY, Math.max(size, 3), Math.max(size, 3));
    st.refAt = [RX + size / 2, RY + size / 2];
  }

  /* ==================================================================== */
  /* transport — monodromy                                                */
  /* ==================================================================== */
  /* The question is whether a transformation can be undone, and the answer
     is read off by going round a loop rather than by differentiating. So the
     picture is the oldest honest example there is: squaring, w = z*z, and
     the surface above the floor is its inverse, the square root, drawn as
     the graph of Re(sqrt w). Every point of the floor has two square roots,
     and the surface is both of them at once.

     A point walks a closed loop on the floor round the one place where the
     two roots meet. Directly above it the inverse is carried along the edge
     of the surface, continuously, never jumping. When the floor point is home
     the loop below has closed, but the carried value is on the other sheet,
     directly under the one it set out with: same floor point, opposite root.
     Only a second lap brings it home. That gap, seen by going round and
     looking, is the answer that squaring has no single-valued inverse here,
     and not one derivative was taken to find it.

     Everything on the surface is true to the formula. The height is
     sqrt(r) cos(theta/2) and the colour is cos(theta/2), the sign of that
     root, running mint where it is positive through blue and violet to coral
     where it is negative, so a colour change is a change of root and nothing
     else. The start is a hollow mint ring; the walker fills it only when it
     is genuinely back. The floor has a ring too, and the floor walker fills
     that one every lap, which is the whole contrast: below closes, above not.

     Drawing is painter's order, far to near, over every quad, every edge
     segment, the axis and the markers, re-sorted each frame because the view
     sways. Shading is alpha and hue only, a mix from each -500 token toward
     its -700 on the side facing away from the light, so no fill is ever
     darker than the palette. Geometry and colours are built once and cached
     on the function. About 1,000 fills and strokes a frame. */
  function transport(g, vb, t, st) {
    var TAU = Math.PI * 2;
    var NT = 112, NR = 7;                /* 112 steps round two laps, 7 rings */
    var H = 0.56, ZF = -0.84;            /* sheet height, floor level (R = 1) */
    var EL = 0.46, PHI0 = -0.45, SWAY = 0.2;
    var S = 168, CX = 235, CY = 212;
    var LAP = 5000, T0 = 900, RAMP = 1100, BUILD = 1700;
    var TAIL = TAU * 0.85;

    var M = transport._m;
    if (!M) {
      M = transport._m = {};
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var C5 = [hex('--mint-500', '#0b93ab'), hex('--blue-500', '#2456dc'),
                hex('--violet-500', '#a66cf0'), hex('--coral-500', '#d9376e')];
      var C7 = [hex('--mint-700', '#0a6b7c'), hex('--blue-700', '#163d9a'),
                hex('--violet-700', '#6b35c4'), hex('--coral-700', '#a01c3f')];
      /* v = +1 mint ... -1 coral, through blue and violet */
      var ramp = function (C, v) {
        var k = (1 - v) * 1.5, i = Math.min(2, Math.floor(k)), f = k - i;
        return [C[i][0] + (C[i + 1][0] - C[i][0]) * f,
                C[i][1] + (C[i + 1][1] - C[i][1]) * f,
                C[i][2] + (C[i + 1][2] - C[i][2]) * f];
      };
      var css = function (c) {
        return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      };
      M.ramp = ramp; M.css = css; M.C5 = C5; M.C7 = C7;
      M.mint7 = css(C7[0]);
      M.coral7 = token('--coral-700', '#a01c3f');
      M.muted = token('--muted', '#5f5b53');
      M.hair = token('--hair2', '#cfcbc1');
      M.amber = token('--amber-500', '#d96a06');

      /* vertices, world space: x, y on the floor, z the real part of the root */
      var NV = (NR + 1) * (NT + 1);
      M.wx = new Float32Array(NV); M.wy = new Float32Array(NV); M.wz = new Float32Array(NV);
      for (var j = 0; j <= NR; j++) {
        /* rings spaced so the root, not the radius, steps evenly: the throat
           at the branch point is vertical and gets the rings it needs */
        var r = (j / NR) * (j / NR);
        for (var i = 0; i <= NT; i++) {
          var th = i / NT * 2 * TAU, o = j * (NT + 1) + i;
          M.wx[o] = r * Math.cos(th); M.wy[o] = r * Math.sin(th);
          M.wz[o] = H * Math.sqrt(r) * Math.cos(th / 2);
        }
      }
      M.sx = new Float32Array(NV); M.sy = new Float32Array(NV); M.sd = new Float32Array(NV);

      /* quads: a fill colour and alpha each, shaded once against a fixed light */
      var L = [-0.42, -0.5, 0.76], ll = Math.hypot(L[0], L[1], L[2]);
      M.qcol = []; M.qa = []; M.qth = [];
      for (j = 0; j < NR; j++) {
        for (i = 0; i < NT; i++) {
          var a = j * (NT + 1) + i, b = a + 1, c = a + NT + 2, d = a + NT + 1;
          var ux = M.wx[c] - M.wx[a], uy = M.wy[c] - M.wy[a], uz = M.wz[c] - M.wz[a];
          var vx = M.wx[d] - M.wx[b], vy = M.wy[d] - M.wy[b], vz = M.wz[d] - M.wz[b];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          var nn = Math.hypot(nx, ny, nz) || 1;
          var lam = Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / (nn * ll));
          var thm = (i + 0.5) / NT * 2 * TAU;
          var v = Math.cos(thm / 2);
          var c5 = ramp(C5, v), c7 = ramp(C7, v), m = 0.62 * (1 - lam);
          M.qcol.push(css([c5[0] + (c7[0] - c5[0]) * m, c5[1] + (c7[1] - c5[1]) * m,
                           c5[2] + (c7[2] - c5[2]) * m]));
          /* every fourth step a little denser, so the ramp reads as ruled bands */
          M.qa.push(0.34 + 0.26 * lam + (i % 4 === 0 ? 0.1 : 0));
          M.qth.push(thm / (2 * TAU));
        }
      }
      M.rcol = [];
      for (i = 0; i < NT; i++) {
        var vm = Math.cos((i + 0.5) / NT * TAU);
        M.rcol.push(css(ramp(C7, vm)));
      }

      /* one persistent record per drawable, sorted in place every frame */
      M.items = [];
      var push = function (k, i) { M.items.push({ k: k, i: i, d: 0 }); };
      for (i = 0; i < NR * NT; i++) push(0, i);   /* surface quad */
      for (i = 0; i < NT; i++) push(1, i);        /* rim segment + tail */
      for (i = 0; i < 8; i++) push(2, i);         /* axis segment */
      push(3, 0);                                 /* start stalk + gap */
      push(4, 0);                                 /* walker + its stalk */
      push(5, 0);                                 /* start ring */
    }

    /* --- time ---------------------------------------------------------- */
    var RED = REDUCED;
    var phi = RED ? PHI0 : PHI0 + SWAY * Math.sin(TAU * t / 16000);
    var build = RED ? 1 : ease(t / BUILD);
    /* laps travelled: it pulls away from rest, then keeps a pace that dips
       to 0.4 of the mean at the start point every lap, where the comparison
       is made, and never stops. Position and speed are both continuous. */
    var tau = t - T0, u;
    if (RED) u = 1;
    else if (tau <= 0) u = 0;
    else if (tau < RAMP) u = tau * tau / (2 * RAMP * LAP);
    else u = (tau - RAMP / 2) / LAP;
    var p = u - 0.6 * Math.sin(TAU * u) / TAU;
    var TH = p * TAU;                    /* unwrapped angle travelled */
    var odd = Math.abs(u - (2 * Math.floor((u - 1) / 2 + 0.5) + 1));
    var cmp = RED ? 1 : (u > 0.4 ? Math.exp(-Math.pow(odd / 0.2, 2)) : 0);
    var ev = Math.abs(u - 2 * Math.round(u / 2));
    var home = RED ? 0 : (u > 1.4 ? Math.exp(-Math.pow(ev / 0.2, 2)) : 0);
    var tailLen = RED ? TAU : Math.min(TAIL, TH);

    /* --- projection ---------------------------------------------------- */
    var ca = Math.cos(phi), sa = Math.sin(phi), ce = Math.cos(EL), se = Math.sin(EL);
    function proj(x, y, z, out) {
      var X = x * ca - y * sa, Y = x * sa + y * ca;
      out[0] = CX + S * X; out[1] = CY - S * (z * ce + Y * se); out[2] = -Y * ce + z * se;
      return out;
    }
    var q = [0, 0, 0];
    var NV2 = M.wx.length;
    for (var n = 0; n < NV2; n++) {
      proj(M.wx[n], M.wy[n], M.wz[n], q);
      M.sx[n] = q[0]; M.sy[n] = q[1]; M.sd[n] = q[2];
    }
    function rimAt(th, out) {           /* point on the lifted loop, any angle */
      return proj(Math.cos(th), Math.sin(th), H * Math.cos(th / 2), out);
    }
    var W = rimAt(TH, [0, 0, 0]);
    var WF = proj(Math.cos(TH), Math.sin(TH), ZF, [0, 0, 0]);
    var S0 = rimAt(0, [0, 0, 0]), S1 = rimAt(TAU, [0, 0, 0]);
    var F0 = proj(1, 0, ZF, [0, 0, 0]);

    /* --- depths -------------------------------------------------------- */
    var it = M.items;
    for (n = 0; n < it.length; n++) {
      var e = it[n], i0;
      if (e.k === 0) {
        i0 = ((e.i / NT) | 0) * (NT + 1) + (e.i % NT);
        e.d = (M.sd[i0] + M.sd[i0 + 1] + M.sd[i0 + NT + 1] + M.sd[i0 + NT + 2]) / 4;
      } else if (e.k === 1) {
        i0 = NR * (NT + 1) + e.i;
        e.d = (M.sd[i0] + M.sd[i0 + 1]) / 2 + 0.004;
      } else if (e.k === 2) {
        e.d = ((ZF + (H + 0.14 - ZF) * (e.i + 0.5) / 8)) * se;
      } else if (e.k === 3) e.d = S1[2] - 0.006;
      else if (e.k === 4) e.d = W[2] + 0.008;
      else e.d = S0[2] + 0.012;
    }
    it.sort(function (a, b) { return a.d - b.d; });

    /* --- draw ---------------------------------------------------------- */
    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* the floor: the loop that closes, round the point where the roots meet */
    var fc = proj(0, 0, ZF, [0, 0, 0]);
    g.globalAlpha = 1;
    g.fillStyle = rgba(M.hair, 0.28);
    g.beginPath(); g.ellipse(fc[0], fc[1], S, S * se, 0, 0, TAU); g.fill();
    g.strokeStyle = rgba(M.muted, 0.72); g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(fc[0], fc[1], S, S * se, 0, 0, TAU); g.stroke();
    /* the floor walker's recent path, so the lap below is watched closing */
    if (TH > 0.001) {
      g.strokeStyle = rgba(M.muted, 0.5); g.lineWidth = 3;
      g.beginPath();
      var fl = Math.min(TAU * 0.5, TH), fq = [0, 0, 0];
      for (n = 0; n <= 24; n++) {
        var fth = TH - fl * (1 - n / 24);
        proj(Math.cos(fth), Math.sin(fth), ZF, fq);
        if (n === 0) g.moveTo(fq[0], fq[1]); else g.lineTo(fq[0], fq[1]);
      }
      g.stroke();
    }
    var near = RED ? 1 : Math.exp(-Math.pow((u - Math.round(u)) / 0.2, 2)) * (u > 0.4 ? 1 : 0);
    g.strokeStyle = rgba(M.muted, 0.95); g.lineWidth = 2;
    g.beginPath(); g.arc(F0[0], F0[1], 6.5 + 2.5 * near, 0, TAU); g.stroke();
    g.fillStyle = rgba(M.muted, 1);
    g.beginPath(); g.arc(WF[0], WF[1], 4.2, 0, TAU); g.fill();
    g.fillStyle = rgba(M.muted, 0.9);
    g.beginPath(); g.arc(fc[0], fc[1], 3.2, 0, TAU); g.fill();

    var P0 = [0, 0, 0], P1 = [0, 0, 0];
    for (n = 0; n < it.length; n++) {
      var e2 = it[n], k = e2.k, i1 = e2.i;
      if (k === 0) {
        var a0 = ((i1 / NT) | 0) * (NT + 1) + (i1 % NT);
        var rv = ease((build * 1.35 - M.qth[i1]) / 0.35);
        g.globalAlpha = M.qa[i1] * (0.24 + 0.76 * rv);
        g.fillStyle = M.qcol[i1];
        g.beginPath();
        g.moveTo(M.sx[a0], M.sy[a0]);
        g.lineTo(M.sx[a0 + 1], M.sy[a0 + 1]);
        g.lineTo(M.sx[a0 + NT + 2], M.sy[a0 + NT + 2]);
        g.lineTo(M.sx[a0 + NT + 1], M.sy[a0 + NT + 1]);
        g.closePath(); g.fill();
      } else if (k === 1) {
        var r0 = NR * (NT + 1) + i1;
        var rv2 = ease((build * 1.35 - (i1 + 0.5) / NT) / 0.35);
        /* butt caps: segments meet end to end, so a translucent edge does not
           bead where round caps would overlap and double the alpha */
        g.lineCap = 'butt';
        g.globalAlpha = 0.66 * (0.3 + 0.7 * rv2);
        g.strokeStyle = M.rcol[i1]; g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(M.sx[r0], M.sy[r0]); g.lineTo(M.sx[r0 + 1], M.sy[r0 + 1]); g.stroke();
        /* the carried value's recent path, brightest at the walker */
        var tA = i1 / NT * 2 * TAU, tB = (i1 + 1) / NT * 2 * TAU;
        var lo = TH - tailLen, hi = TH, base = Math.floor(TH / (2 * TAU)) * 2 * TAU;
        for (var w = -1; w <= 0; w++) {       /* this segment in this cycle or the last */
          var a1 = Math.max(tA + base + w * 2 * TAU, lo), b1 = Math.min(tB + base + w * 2 * TAU, hi);
          if (b1 <= a1) continue;
          var x = (hi - (a1 + b1) / 2) / (RED ? TAU * 1.1 : TAIL);
          var fade = Math.max(0, Math.min(1, 1 - x * x));
          g.globalAlpha = 0.12 + 0.88 * fade;
          g.strokeStyle = M.rcol[i1]; g.lineWidth = 1.6 + 4 * fade;
          rimAt(a1, P0); rimAt(b1, P1);
          g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
        }
        g.lineCap = 'round';
      } else if (k === 2) {
        var z0 = ZF + (H + 0.14 - ZF) * i1 / 8, z1 = ZF + (H + 0.14 - ZF) * (i1 + 1) / 8;
        proj(0, 0, z0, P0); proj(0, 0, z1, P1);
        g.globalAlpha = 1;
        g.strokeStyle = rgba(M.muted, 0.55); g.lineWidth = 1.4;
        g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
        g.setLineDash([]);
      } else if (k === 3) {
        /* the start, both roots of it: dashed from the floor, and the gap
           between the root it set out with and the one it came back with */
        g.globalAlpha = 1;
        g.strokeStyle = rgba(M.muted, 0.6); g.lineWidth = 1.4;
        g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(F0[0], F0[1] - 7); g.lineTo(S0[0], S0[1]); g.stroke();
        g.setLineDash([]);
        if (cmp > 0.01) {
          g.strokeStyle = rgba(M.amber, 0.9 * cmp); g.lineWidth = 5;
          g.beginPath(); g.moveTo(S1[0], S1[1] - 9); g.lineTo(S0[0], S0[1] + 11); g.stroke();
        }
      } else if (k === 4) {
        var vw = Math.cos(TH / 2);
        g.globalAlpha = 1;
        g.strokeStyle = rgba(M.muted, 0.5); g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(WF[0], WF[1]); g.lineTo(W[0], W[1]); g.stroke();
        var wc = M.ramp(M.C5, vw);
        g.fillStyle = M.css(wc);
        g.globalAlpha = 0.2;
        g.beginPath(); g.arc(W[0], W[1], 12, 0, TAU); g.fill();
        g.globalAlpha = 1;
        g.beginPath(); g.arc(W[0], W[1], 7, 0, TAU); g.fill();
        g.strokeStyle = M.css(M.ramp(M.C7, vw)); g.lineWidth = 2;
        g.stroke();
        /* it has come back to the start point and is not the root it left
           with: the ring rides on the walker, so it marks the arrival */
        if (cmp > 0.01) {
          g.strokeStyle = rgba(M.coral7, 0.55 * cmp);
          g.beginPath(); g.arc(W[0], W[1], 11 + 5 * cmp, 0, TAU); g.stroke();
        }
      } else {
        g.globalAlpha = 1;
        if (home > 0.01) {
          g.strokeStyle = M.mint7; g.globalAlpha = 0.45 * home; g.lineWidth = 2;
          g.beginPath(); g.arc(S0[0], S0[1], 12 + 6 * home, 0, TAU); g.stroke();
          g.globalAlpha = 1;
        }
        g.strokeStyle = M.mint7; g.lineWidth = 3;
        g.beginPath(); g.arc(S0[0], S0[1], 10, 0, TAU); g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  /* ==================================================================== */
  /* funnel — 484 cells collapsing into 22                                */
  /* ==================================================================== */
  /* The old drawing packed 484 tall thin rects with no vertical gap, so
     twenty two rows fused into twenty two bars and the shape said nothing.
     Square cells with a real gap on both axes, and the collapse animated,
     so the quadratic field is visibly emptying into the linear row. */
  function funnel(g, vb, t) {
    var N = 22;
    var coral = token('--coral-500', '#d9376e');
    var mint = token('--mint-500', '#0b93ab');
    var TOP_X = 92, TOP_Y = 96, SPAN = 286;
    var pitch = SPAN / N, size = pitch * 0.64;
    var ROW_Y = 448, ROW_PITCH = SPAN / N, ROW_SIZE = ROW_PITCH * 0.64;

    g.clearRect(0, 0, vb[0], vb[1]);
    var cyc = REDUCED ? 0 : (t % 5200) / 5200;

    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var x = TOP_X + c * pitch, y = TOP_Y + r * pitch;
        /* each cell leaves in its own moment, so the field drains as a
           body of water rather than switching off all at once */
        var own = ((r * N + c) % 97) / 97;
        var k = Math.max(0, Math.min(1, (cyc - own * 0.55) / 0.30));
        var e = k * k * (3 - 2 * k);
        var tx = TOP_X + c * ROW_PITCH, ty = ROW_Y;
        g.fillStyle = rgba(e > 0.98 ? mint : coral, 0.22 + 0.5 * (1 - e) + 0.28 * e);
        g.fillRect(x + (tx - x) * e, y + (ty - y) * e,
                   size + (ROW_SIZE - size) * e, size + (ROW_SIZE - size) * e);
      }
    }

    g.fillStyle = rgba(mint, 1);
    for (var i = 0; i < N; i++) {
      g.fillRect(TOP_X + i * ROW_PITCH, ROW_Y, ROW_SIZE, ROW_SIZE);
    }
  }


  /* ==================================================================== */
  /* collapse — Epsilon-Hollow                                            */
  /* ==================================================================== */
  function collapse(g, vb, t) {
    var CX = 235, CY = 250, R = 165, N = 300;
    var blue = token('--blue-500', '#2456dc');
    var blue7 = token('--blue-700', '#163a9a');
    var coral = token('--coral-500', '#d9376e');
    var hair = token('--hair2', '#cfcbc1');

    g.clearRect(0, 0, vb[0], vb[1]);

    /* the surface. It is the thing that must not change, so it is drawn
       first and identically on every frame. */
    g.strokeStyle = rgba(hair, 1); g.lineWidth = 2;
    g.beginPath(); g.arc(CX, CY, R, 0, Math.PI * 2); g.stroke();
    for (var e = 1; e <= 3; e++) {
      g.beginPath();
      g.ellipse(CX, CY, R * (e / 4), R, 0, 0, Math.PI * 2);
      g.strokeStyle = rgba(hair, 0.55); g.stroke();
    }

    var cyc = REDUCED ? 0 : t / 5400;
    for (var i = 0; i < N; i++) {
      /* a stable pseudo-random placement, so points do not jump between
         frames and the field reads as one population being thinned */
      var s = Math.sin(i * 12.9898) * 43758.5453;
      var u = s - Math.floor(s);
      var s2 = Math.sin(i * 78.233) * 43758.5453;
      var v = s2 - Math.floor(s2);
      var rr = R * 0.94 * Math.sqrt(u), th = v * Math.PI * 2;
      var x = CX + rr * Math.cos(th), y = CY + rr * Math.sin(th) * 0.82;

      /* each point has its own moment, and when it comes it folds onto its
         neighbour and is gone. Nothing about the surface changes. */
      var own = ((i * 37) % 101) / 101;
      var k = REDUCED ? 0 : Math.max(0, Math.min(1, ((cyc + own) % 1 - 0.72) / 0.17));
      var nx = CX + rr * 0.76 * Math.cos(th + 0.42);
      var ny = CY + rr * 0.76 * Math.sin(th + 0.42) * 0.82;
      var ex = k * k * (3 - 2 * k);
      var px = x + (nx - x) * ex, py = y + (ny - y) * ex;

      g.beginPath();
      g.arc(px, py, 3.4 * (1 - 0.55 * ex), 0, Math.PI * 2);
      g.fillStyle = ex > 0.04 ? rgba(coral, 0.9 * (1 - ex)) : rgba(blue, 0.78);
      g.fill();
    }

    g.strokeStyle = rgba(blue7, 0.9); g.lineWidth = 2.6;
    g.beginPath(); g.arc(CX, CY, R, 0, Math.PI * 2); g.stroke();
  }


  /* ==================================================================== */
  /* witness — nerve                                                      */
  /* ==================================================================== */
  /* The story is that he built the control capable of killing his own result
     and then published what it said: of his own four hypotheses, three did
     not survive it.

     The first build had the three columns crumble and vanish, and rendering
     it showed the same fault the NeMo figure had: for most of the cycle the
     panel was empty, so there was nothing left to compare the survivor
     against. The outcome is permanent here instead. Three columns stand as
     withdrawn stubs, one stands full height against the control line, and the
     motion is only the moment of withdrawal passing over them again. */
  function witness(g, vb, t) {
    var BASE = 366, TOP = 148, W = 56, GAP = 32;
    var N = 4, BLOCKS = 11;
    var x0 = (vb[0] - (N * W + (N - 1) * GAP)) / 2;
    var green = token('--green-500', '#146a32');
    var coral = token('--coral-500', '#d9376e');
    var hair = token('--hair2', '#cfcbc1');
    var ink = token('--ink', '#1c1b19');
    var SURVIVOR = 2;

    g.clearRect(0, 0, vb[0], vb[1]);

    var cyc = REDUCED ? 1 : (t % 6800) / 6800;
    var bh = (BASE - TOP) / BLOCKS - 3;

    for (var i = 0; i < N; i++) {
      var x = x0 + i * (W + GAP);
      var dies = i !== SURVIVOR;
      /* a withdrawn hypothesis keeps two blocks, so it is still a column and
         still countable, and the gap to the survivor is the finding */
      var kept = dies ? 2 : BLOCKS;

      for (var b = 0; b < BLOCKS; b++) {
        var y = BASE - (b + 1) * (bh + 3);
        var gone = b >= kept;

        if (!gone) {
          g.fillStyle = rgba(dies ? coral : green, dies ? 0.80 : 0.94);
          g.fillRect(x, y, W, bh);
          continue;
        }

        /* the part that was withdrawn is drawn as a faint outline, so what
           was given up stays visible instead of simply being absent */
        g.strokeStyle = rgba(coral, 0.22);
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, W - 1, bh - 1);

        /* the withdrawal passes over the three again, one block at a time */
        if (!REDUCED) {
          var own = 0.10 + i * 0.07 + (BLOCKS - b) * 0.030;
          var k = Math.max(0, Math.min(1, (cyc - own) / 0.10));
          var pulse = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
          if (pulse > 0.02) {
            g.fillStyle = rgba(coral, 0.55 * pulse);
            g.fillRect(x, y, W, bh);
          }
        }
      }
    }

    g.strokeStyle = rgba(ink, 0.82); g.lineWidth = 2.4;
    g.setLineDash([9, 6]);
    g.beginPath();
    g.moveTo(x0 - 30, TOP + 12); g.lineTo(x0 + N * (W + GAP) - GAP + 30, TOP + 12);
    g.stroke();
    g.setLineDash([]);

    g.strokeStyle = rgba(hair, 1); g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 - 30, BASE + 2); g.lineTo(x0 + N * (W + GAP) - GAP + 30, BASE + 2);
    g.stroke();
  }

  /* ==================================================================== */
  /* gather — NeMo-Relay                                                  */
  /* ==================================================================== */
  /* Two requests sharing a model, a system prompt hash and a tool schema hash
     were given different learning keys because one field differed, so every
     profile held a single observation and nothing ever accumulated.

     The first build of this flew the dots from one side to the other, and
     rendering it showed why that fails: mid flight the dots are a straggling
     diagonal, the destination is empty, and the source has been emptied out,
     so at no moment can the two states be compared, which is the only thing
     the figure exists to let you do.

     Both sides are permanently legible instead. On the left a new observation
     keeps arriving and keeps replacing the one already there, so the count
     stays at one forever and the stillness is the bug. On the right the same
     observations land on top of each other and the pile grows. */
  function gather(g, vb, t, st) {
    var coral = token('--coral-500', '#d9376e');
    var coral7 = token('--coral-700', '#a0183f');
    var violet = token('--violet-500', '#a66cf0');
    var violet7 = token('--violet-700', '#6b35c4');
    var hair = token('--hair2', '#cfcbc1');

    g.clearRect(0, 0, vb[0], vb[1]);

    var cyc = REDUCED ? 1 : (t % 7200) / 7200;

    /* left: twenty four profiles, one observation each, forever */
    var COLS = 4, ROWS = 6, BW = 42, BH = 33, GAP = 8;
    var LX = 36, LY = 130;
    for (var i = 0; i < COLS * ROWS; i++) {
      var c = i % COLS, r = (i / COLS) | 0;
      var bx = LX + c * (BW + GAP), by = LY + r * (BH + GAP);
      g.strokeStyle = rgba(hair, 1); g.lineWidth = 1.4;
      g.strokeRect(bx, by, BW, BH);

      /* An arrival sweeps the grid. It used to jump from box to box; now the
         highlight falls off with distance from the sweep, so a box brightens
         and fades rather than switching. The count it holds never changes,
         which is the point. */
      var head = cyc * (COLS * ROWS);
      var near = REDUCED ? 0 : Math.max(0, 1 - Math.abs(head - i) / 2.2);
      var lift = ease(near);
      g.beginPath();
      g.arc(bx + BW / 2, by + BH / 2, 6.2 + 2.4 * lift, 0, Math.PI * 2);
      g.fillStyle = lift > 0.02
        ? rgba(coral7, 0.85 + 0.15 * lift)
        : rgba(coral, 0.85);
      g.fill();
    }

    /* right: one profile, and the same observations land on each other */
    var RX = 292, RY = 130, RW = 140, RH = ROWS * (BH + GAP) - GAP;
    g.strokeStyle = rgba(violet, 0.95); g.lineWidth = 2.2;
    g.fillStyle = rgba(violet, 0.06);
    g.fillRect(RX, RY, RW, RH);
    g.strokeRect(RX, RY, RW, RH);

    /* The pile used to gain a whole dot at a time, which is 24 visible steps.
       Each dot now grows in over its own slice of the fill, so the pile rises
       continuously and the last one is mid-arrival rather than snapping. */
    var fill = REDUCED ? 1 : ease(Math.min(cyc, 0.46) / 0.46);
    for (var j = 0; j < 24; j++) {
      var grow = REDUCED ? 1 : ease((fill * 24 - j) / 1.6);
      if (grow <= 0.002) continue;
      var cc = j % 4, rr = (j / 4) | 0;
      var dx = RX + 26 + cc * 30, dy = RY + RH - 24 - rr * 27;
      g.beginPath();
      g.arc(dx, dy - (1 - grow) * 16, 8.6 * grow, 0, Math.PI * 2);
      g.fillStyle = rgba(violet7, 0.94 * grow);
      g.fill();
    }

    /* the line the observations never cross on the left */
    g.strokeStyle = rgba(hair, 0.9); g.lineWidth = 1.5;
    g.setLineDash([5, 6]);
    g.beginPath(); g.moveTo(258, 120); g.lineTo(258, RY + RH + 10); g.stroke();
    g.setLineDash([]);
  }

  /* ==================================================================== */
  /* refuse — planimeter                                                  */
  /* ==================================================================== */
  /* The strongest evidence on the site had the emptiest figure: one drawn
     element. On the same 528 files, planimeter refuses 33 and returns a wrong
     answer zero times, and shapely.polygonize_full refuses nothing and gets
     336 wrong. Both fields are drawn at once, one mark per file, so the trade
     is visible without a word: the amber band is what refusing costs, and the
     coral block is what answering anyway costs. */
  function refuse(g, vb, t) {
    var N = 528, COLS = 22;
    var green = token('--green-500', '#146a32');
    var amber = token('--amber-500', '#d96a06');
    var coral = token('--coral-500', '#d9376e');

    g.clearRect(0, 0, vb[0], vb[1]);
    var cyc = REDUCED ? 1 : (t % 6400) / 6400;

    function field(ox, oy, kind) {
      var pitch = 8.6, size = 6.6;
      for (var i = 0; i < N; i++) {
        var c = i % COLS, r = (i / COLS) | 0;
        var col, a = 1;
        if (kind === 'mine') {
          /* 33 refused, and they are the last 33 so they read as one band */
          col = i >= N - 33 ? amber : green;
        } else {
          /* 336 wrong, spread through the field because a wrong answer does
             not announce itself, which is the entire problem */
          col = ((i * 7) % 528) < 336 ? coral : green;
        }
        if (!REDUCED) {
          var scan = cyc * 27 - 1.5;
          var d = r - scan;
          a = 0.50 + 0.50 * Math.exp(-d * d / 2.2);
        }
        g.fillStyle = rgba(col, a);
        g.fillRect(ox + c * pitch, oy + r * pitch, size, size);
      }
    }

    field(26, 150, 'mine');
    field(255, 150, 'theirs');
  }

  /* ==================================================================== */
  /* cut — topological-ml-toolkit                                         */
  /* ==================================================================== */
  /* The point is a cut that separates structure from noise, and the previous
     drawing gave it fourteen bars, which is not a population and cannot show
     a separation. Two hundred and forty bars, one cut, and the bars that
     cross it are the feature while the ones that do not are noise. */
  function cut(g, vb, t) {
    var N = 240, X0 = 34, X1 = 436, BASE = 388, CUT = 208;
    var violet = token('--violet-500', '#a66cf0');
    var violet7 = token('--violet-700', '#6b35c4');
    var hair = token('--hair2', '#cfcbc1');
    var ink = token('--ink', '#1c1b19');

    g.clearRect(0, 0, vb[0], vb[1]);
    var pitch = (X1 - X0) / N;
    var drift = REDUCED ? 0 : Math.sin(t / 3400) * 34;

    for (var i = 0; i < N; i++) {
      /* a stable height per bar: a long tail of noise and a few that persist,
         which is the shape a barcode actually has */
      var s = Math.sin(i * 12.9898) * 43758.5453;
      var u = s - Math.floor(s);
      var h = Math.pow(u, 3.1) * (BASE - 96) + 6;
      var top = BASE - h;
      var lives = top < CUT + drift;
      g.fillStyle = lives ? rgba(violet7, 0.92) : rgba(violet, 0.26);
      g.fillRect(X0 + i * pitch, top, Math.max(pitch - 0.6, 0.9), h);
    }

    g.strokeStyle = rgba(ink, 0.85); g.lineWidth = 2.6;
    g.setLineDash([10, 6]);
    g.beginPath();
    g.moveTo(X0 - 14, CUT + drift); g.lineTo(X1 + 14, CUT + drift); g.stroke();
    g.setLineDash([]);

    g.strokeStyle = rgba(hair, 1); g.lineWidth = 2;
    g.beginPath(); g.moveTo(X0 - 14, BASE + 2); g.lineTo(X1 + 14, BASE + 2); g.stroke();
  }

  /* ==================================================================== */
  /* certify — separatrix                                                 */
  /* ==================================================================== */
  /* Either two candidates are separated by a real gap or their intervals
     touch, and if they touch the ordering came from the arithmetic and not
     the data, so nothing is returned. Thirty two comparisons are drawn, the
     separated ones certified and the touching ones refused, and the whole
     rule is legible without reading it. */
  function certify(g, vb, t) {
    var ROWS = 32, X0 = 40, W = 390, Y0 = 118, PITCH = 8.4;
    var mint = token('--mint-500', '#0b93ab');
    var mint7 = token('--mint-700', '#0a6b7c');
    var coral = token('--coral-500', '#d9376e');

    g.clearRect(0, 0, vb[0], vb[1]);
    var breathe = REDUCED ? 0 : Math.sin(t / 3800) * 0.5 + 0.5;

    for (var i = 0; i < ROWS; i++) {
      var y = Y0 + i * PITCH;
      var s = Math.sin(i * 45.233) * 43758.5453;
      var u = s - Math.floor(s);
      /* the gap narrows down the stack; near the bottom the intervals touch */
      var gap = (1 - i / ROWS) * 46 - 10 + (u - 0.5) * 14
              + (REDUCED ? 0 : Math.sin(t / 2600 + i * 0.47) * 8);
      var mid = X0 + W / 2;
      var half = 74 + u * 34;
      var g1 = mid - gap / 2, g2 = mid + gap / 2;
      var touching = gap < 4;

      var col = touching ? coral : mint;
      var a = touching ? 0.55 + 0.35 * breathe : 0.92;
      g.fillStyle = rgba(col, a);
      g.fillRect(g1 - half, y, half, 5.2);
      g.fillRect(g2, y, half, 5.2);

      if (!touching) {
        g.fillStyle = rgba(mint7, 0.85);
        g.fillRect(g1 - 2.6, y + 1, 2.6, 3.2);
        g.fillRect(g2, y + 1, 2.6, 3.2);
      }
    }
  }

  /* ==================================================================== */
  /* smatrix — resolvent                                                  */
  /* ==================================================================== */
  /* Wheeler wrote the S-matrix in 1937 as the matrix connecting in-states to
     out-states with no account of the path between them, and Heisenberg
     carried it through the 1940s. This project reads one attention head that
     way: (I - gP)^-1, the same closed form the Lippmann-Schwinger equation
     gives the scattering operator, with the hop expansion as the Born series.
     So the figure is that sentence.
     An in-state on the left and an out-state on the right. Between them every
     path the series sums, drawn by order: the direct hop, then the two hop
     paths, the three hop paths and so on, each order fainter than the last
     because each carries another factor of gamma. Over all of them one solid
     arrow straight across, which is the S-matrix and which says nothing about
     any of it. The orders arrive one after another, which is the series being
     summed, and they fade rather than stop because the convergence law is
     what makes the sum finite. */
  function smatrix(g, vb, t) {
    var IX = 58, OX = 412, MY = 286;
    var ORDERS = 6, PER = 7;
    var blue = token('--blue-500', '#2456dc');
    var blue7 = token('--blue-700', '#163a9a');
    var ink = token('--ink', '#1c1b19');
    var hair = token('--hair2', '#cfcbc1');

    g.clearRect(0, 0, vb[0], vb[1]);
    var cyc = REDUCED ? 1 : (t % 9000) / 9000;
    var front = IX - 60 + (OX - IX + 120) * ((t % 2800) / 2800);

    for (var k = 1; k <= ORDERS; k++) {
      /* each order enters in turn, and its weight is gamma^k */
      var arrive = REDUCED ? 1 : ease((cyc * (ORDERS + 2) - k) / 1.4);
      if (arrive <= 0.004) continue;
      var weight = Math.pow(0.62, k - 1);
      for (var p = 0; p < (k === 1 ? 1 : PER); p++) {
        var s = Math.sin((k * 17.3 + p * 7.13)) * 43758.5453;
        var u = s - Math.floor(s);
        var spread = (p - (PER - 1) / 2) / ((PER - 1) / 2);
        var amp = Math.min(86, 22 + k * 11) * spread * (0.65 + 0.35 * u);
        /* Once every order has arrived the figure used to stand still until
           the cycle came round, which measured under one percent of pixels
           changing. Amplitude now flows from the in-state to the out-state
           through every path at once: a front sweeps across and each segment
           brightens as it passes. That is the sum being taken, all orders in
           parallel, and it is what the single arrow above them hides. */
        var base = 0.38 * weight * arrive + 0.05;
        g.lineWidth = 1.3;
        var px = IX, py = MY;
        for (var h = 1; h <= k; h++) {
          var f = h / k;
          var x = IX + (OX - IX) * f;
          var y = MY + Math.sin(f * Math.PI) * amp;
          var dd = ((px + x) / 2 - front) / 44;
          var boost = REDUCED ? 0 : Math.exp(-dd * dd);
          g.strokeStyle = rgba(blue, Math.min(1, base * (1 + 1.8 * boost)));
          g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
          if (h < k) {
            g.fillStyle = rgba(blue7, Math.min(1, 0.55 * weight * arrive * (1 + 1.2 * boost)));
            g.beginPath(); g.arc(x, y, 2.6 + 1.4 * boost, 0, Math.PI * 2); g.fill();
          }
          px = x; py = y;
        }
      }
    }

    /* the S-matrix itself: one arrow, and it accounts for none of the above */
    var lit = REDUCED ? 1 : ease(Math.min(1, cyc * 1.25));
    g.strokeStyle = rgba(ink, 0.30 + 0.62 * lit);
    g.lineWidth = 4.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(IX + 20, MY); g.lineTo(OX - 26, MY); g.stroke();
    g.beginPath();
    g.moveTo(OX - 26, MY - 9); g.lineTo(OX - 10, MY); g.lineTo(OX - 26, MY + 9);
    g.closePath(); g.fillStyle = rgba(ink, 0.30 + 0.62 * lit); g.fill();

    /* the two states */
    [[IX, blue7], [OX, blue7]].forEach(function (n) {
      g.beginPath(); g.arc(n[0], MY, 17, 0, Math.PI * 2);
      g.fillStyle = rgba(token('--raised', '#ffffff'), 1); g.fill();
      g.strokeStyle = rgba(n[1], 1); g.lineWidth = 3; g.stroke();
    });

    /* the decaying terms, drawn as a strip so the convergence is a picture */
    var BX = 128, BY = 402, BW = 214;
    g.strokeStyle = rgba(hair, 1); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(BX, BY + 26); g.lineTo(BX + BW, BY + 26); g.stroke();
    for (var m = 0; m < ORDERS; m++) {
      var h2 = 24 * Math.pow(0.62, m);
      var a2 = REDUCED ? 1 : ease((cyc * (ORDERS + 2) - (m + 1)) / 1.4);
      g.fillStyle = rgba(blue7, 0.30 + 0.62 * a2);
      g.fillRect(BX + m * (BW / ORDERS), BY + 26 - h2, BW / ORDERS - 6, h2);
    }
  }

  var RENDER = { caustic: caustic, units: units, funnel: funnel,
                 transport: transport, collapse: collapse,
                 witness: witness, gather: gather,
                 refuse: refuse, cut: cut, certify: certify,
                 smatrix: smatrix };

  /* ------------------------------------------------------------------ */
  var live = [];

  function collect() {
    live = [];
    var nodes = document.querySelectorAll('canvas[data-fig]');
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i];
      var fn = RENDER[c.getAttribute('data-fig')];
      if (!fn) continue;
      var vb = (c.getAttribute('data-vb') || '470 540').split(/\s+/).map(Number);
      live.push({ c: c, fn: fn, vb: vb, st: c._st || (c._st = {}) });
    }
  }

  /* Only paint what is on screen. getBoundingClientRect is used rather than
     an IntersectionObserver because an observer on these nodes has already
     failed silently on this site once, and a figure that never paints is
     worse than one that paints a little too often. */
  function onScreen(c) {
    var r = c.getBoundingClientRect();
    return r.bottom > -160 && r.top < (window.innerHeight || 800) + 160 && r.width > 0;
  }

  var ticked = false;
  var lastT = 0;

  /* Every figure used to run on one global clock, so whichever point of its
     cycle it happened to be at was what you arrived to: you never saw a figure
     build, only one already in progress, which is most of why the motion read
     as dull. Each figure now keeps its own clock, held at zero until it has
     actually arrived on screen and started from there, so it constructs itself
     in front of you. It restarts only once it has left the screen entirely, so
     a small scroll does not replay it. */
  function arrived(r, vh) {
    /* A figure wholly on screen has always arrived, so one near the foot of the
       page, which can never be scrolled up to the reading line, is not left
       waiting for a position it cannot reach. */
    if (r.top >= 0 && r.bottom <= vh) return true;
    return r.top < vh * 0.86 && r.bottom > vh * 0.08;
  }

  function paint(t, all) {
    var vh = window.innerHeight || 800;
    for (var i = 0; i < live.length; i++) {
      var f = live[i];
      var near = onScreen(f.c);
      if (!near) { f.born = null; if (!all) continue; }
      if (f.born == null && arrived(f.c.getBoundingClientRect(), vh)) f.born = t;
      var local = f.born == null ? 0 : t - f.born;
      fit(f.c, f.vb[0], f.vb[1]);
      var ctx = f.c.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, f.c.width, f.c.height);
      ctx.restore();
      f.fn(ctx, f.vb, local, f.st);
    }
    reveal(vh);
  }

  /* The SVG figures get the same arrival. They are uncovered with clip-path
     rather than moved or scaled, because a transform on the figure would carry
     its labels with it and no word on this site moves. The class is only ever
     added, so if this script never runs every figure is simply visible. */
  var wraps = null;
  function reveal(vh) {
    if (!wraps) wraps = document.querySelectorAll('.card__figure, .proj__figure');
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i], r = w.getBoundingClientRect();
      var gone = r.bottom < -200 || r.top > vh + 200;
      if (gone) {
        if (w._in) {
          w.classList.remove('is-in', 'is-done');
          clearTimeout(w._done);
          w._in = false;
        }
        continue;
      }
      if (!w._in && arrived(r, vh)) {
        w.classList.add('is-in');
        w._in = true;
        /* Measured in the preview pane: the class went on and the clip stayed
           at fully hidden, because the transition never advanced. A frozen or
           throttled animation timeline would do the same to a real visitor and
           leave the whole site blank. So a timer, which keeps firing when frames
           do not, takes the clip off entirely once the reveal should be over.
           The reveal is a nicety; the figure being there is not. */
        (function (el) {
          el._done = setTimeout(function () { el.classList.add('is-done'); }, 1250);
        })(w);
      }
    }
  }

  function frame(t) {
    ticked = true;
    lastT = t;
    paint(t, false);
    requestAnimationFrame(frame);
  }

  /* A canvas that has not been painted is blank, which is worse than the SVG
     it replaced, and requestAnimationFrame is not guaranteed to run: it is
     throttled in a background tab, suppressed in some embedded views, and was
     measured here never firing at all. An observer that silently never fired
     has already cost this site a round of invisible animation.

     So the first frame is painted synchronously the moment the figures are
     collected, and if no animation frame has arrived shortly afterwards the
     drawing keeps updating on a timer instead. The resting state is always the
     correct figure, and motion is the thing that degrades, never the drawing. */
  function ensurePainted() {
    paint(0, true);
    setTimeout(function () {
      if (ticked) return;
      var t0 = 0;
      setInterval(function () { t0 += 50; lastT = t0; paint(t0, false); }, 50);
    }, 1200);
  }

  /* The slider owns the count; this only owns the drawing. site.js sets
     shown and calls redraw, so the one interactive control on the site keeps
     the behaviour it already had. */
  window.FIG = {
    /* Setting a value repaints that figure at once rather than waiting for the
       next animation frame. A control that only writes a number and hopes a
       frame arrives is a control that does nothing whenever the frame loop is
       throttled, which is exactly what a hidden tab, a background window or a
       low power mode will do to it. The slider on this site has already
       shipped broken four separate ways; it does not get a fifth. */
    set: function (name, key, value) {
      for (var i = 0; i < live.length; i++) {
        var f = live[i];
        if (f.c.getAttribute('data-fig') !== name) continue;
        if (f.st[key] === value) continue;
        f.st[key] = value;
        fit(f.c, f.vb[0], f.vb[1]);
        var ctx = f.c.getContext('2d');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, f.c.width, f.c.height);
        ctx.restore();
        f.fn(ctx, f.vb, f.born == null ? 0 : lastT - f.born, f.st);
      }
    },
    sizeOf: function (name) {
      for (var i = 0; i < live.length; i++) {
        if (live[i].c.getAttribute('data-fig') === name) return live[i].st.size || 0;
      }
      return 0;
    },
    refresh: collect
  };

  function boot() {
    /* Only a page this script is running on hides anything before it is
       revealed. If the script fails to load, the class is never set and
       every figure is plainly visible, which is the failure worth having. */
    if (!REDUCED) document.documentElement.classList.add('js-reveal');
    collect();
    ensurePainted();
    requestAnimationFrame(frame);
    var tid;
    window.addEventListener('resize', function () {
      clearTimeout(tid);
      tid = setTimeout(function () {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        collect();
        paint(0, true);
      }, 120);
    });
    /* The fonts landing changes the card width, which changes the canvas box.
       Repainting once they are ready avoids a figure drawn to the wrong size. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { collect(); paint(0, true); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
