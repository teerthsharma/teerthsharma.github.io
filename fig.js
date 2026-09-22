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
  /* units — mujoco-3396                                                 */
  /* ==================================================================== */
  function units(g, vb, t, st) {
    /* Island discovery used to allocate scratch that grew with the square of
       the tree count, 5 ntree^2 + 36 ntree + 32 bytes. Rebuilt on a
       disjoint-set forest it needs 16 ntree + 32. The picture is a count, not
       an axis: the small blue cube on the left is the new path's ENTIRE
       allocation, and the coral block is made of cubes of exactly that size,
       one for every time the old path asked for that much again. The slider
       sets how many, ceil(before / after): 22 at ntree 64, 1,282 at 4,096.
       Every cube is drawn at the identical size, the one on its own, the ones
       in flight and the ones in the block, because enlarging the reference
       to make it visible would make the picture untrue.

       The block is a near cube, b by b in plan, filled a layer at a time from
       the back, so any count is exact: at 1,282 it is ten full layers of 121
       and 72 more on top. Full layers are drawn as one solid, lit mass with a
       seam at every unit, so it reads as a single heavy thing made of units
       rather than as a field of squares; only the unfinished top layer is
       drawn cube by cube. At rest that is at most 158 fills; the worst frame,
       mid-pour with some 300 copies in the air, measured 1,059.

       Motion. On arrival the block is poured: copies leave the blue cube,
       blue, arc across and set into the block in fill order, turning coral as
       they join it, a trickle that becomes a torrent, so the count is watched
       being made. Then a copy leaves the blue cube every 240 ms and sinks into
       the block, and once every 7 s the blue cube rings and a band of light
       climbs the block layer by layer, counting it. The count itself never
       animates: whatever st.shown says is what is standing, every frame. */
    var TAU = Math.PI * 2;
    var E = 12, CXK = 0.9, CYK = 0.36, CZK = 0.94;   /* unit edge, projection */
    var BX = 462, BG = 216.5;                        /* block footprint centre */
    var UX = 150;                                    /* the lone cube */
    var POUR = 2300, FLY = 400, TRICKLE = 240, TFLY = 1400, WAVE = 7000, WSWEEP = 2400;
    var GAP = 0.05;

    var shown = Math.max(1, Math.round(st.shown || 1282));
    var b = Math.max(1, Math.ceil(Math.cbrt(shown) - 1e-9));
    var nb = b * b, L = Math.ceil(shown / nb);
    st.size = E;

    var M = units.m;
    if (!M) {
      M = units.m = { lay: {}, col: {} };
      var hexc = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      M.mix = function (a, c, k) { return [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k]; };
      M.css = function (c, al) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al + ')'; };
      var W = [255, 255, 255];
      M.co5 = hexc('--coral-500', '#d9376e'); M.co7 = hexc('--coral-700', '#a0183f');
      M.bl5 = hexc('--blue-500', '#2456dc'); M.bl7 = hexc('--blue-700', '#163a9a');
      M.hair = hexc('--hair2', '#cfcbc1'); M.W = W;
      /* one material per family: top lit, the +j face mid, the +i face in shade */
      M.face = [[M.mix(M.co5, W, 0.36), M.mix(M.co5, W, 0.08), M.mix(M.co5, M.co7, 0.4)],
                [M.mix(M.bl5, W, 0.42), M.mix(M.bl5, W, 0.06), M.mix(M.bl5, M.bl7, 0.45)]];
      /* the solid mass: gradients run from these at the top to these at the foot */
      M.mTop = [M.css(M.mix(M.co5, W, 0.5), 0.97), M.css(M.mix(M.co5, W, 0.3), 0.97)];
      M.mL = [M.css(M.mix(M.co5, W, 0.08), 0.96), M.css(M.mix(M.co5, M.co7, 0.22), 0.96)];
      M.mR = [M.css(M.mix(M.co5, M.co7, 0.4), 0.96), M.css(M.mix(M.co5, M.co7, 0.72), 0.96)];
    }
    /* a face colour at a light level, cached. fam runs 0 (coral, the old
       path) to 8 (blue, the new one), so a copy changes colour smoothly */
    function col(fam, f, lv) {
      var key = fam * 64 + f * 16 + lv, s = M.col[key];
      if (!s) s = M.col[key] = M.css(M.mix(M.mix(M.face[0][f], M.face[1][f], fam / 8), M.W, lv / 15 * 0.6), 0.96);
      return s;
    }
    /* fill order within a layer, back first, cached per b */
    var lay = M.lay[b];
    if (!lay) {
      lay = M.lay[b] = { rank: new Int32Array(nb), cell: [] };
      for (var i = 0; i < b; i++) for (var j = 0; j < b; j++) lay.cell.push([i, j]);
      lay.cell.sort(function (p, q) { return (p[0] + p[1]) - (q[0] + q[1]) || p[0] - q[0]; });
      for (var r = 0; r < nb; r++) lay.rank[lay.cell[r][0] * b + lay.cell[r][1]] = r;
    }

    /* projection: +i runs right and down, +j left and down, +k up */
    var ex = E * CXK, ey = E * CYK, ez = E * CZK;
    function PX(i, j) { return BX + (i - j) * ex; }
    function PY(i, j, k) { return BG + (i + j - b) * ey - k * ez; }

    var RED = REDUCED;
    var T = RED ? 60000 : t;

    /* --- the pour: copy f leaves at POUR * (f / shown)^(1 / 1.4) ---------- */
    function depart(f) { return POUR * Math.pow(f / shown, 1 / 1.4); }
    var landed = shown, flying = shown;
    if (!RED && T < POUR + FLY) {
      var u0 = Math.max(0, T - FLY) / POUR, u1 = Math.min(1, Math.max(0, T) / POUR);
      landed = Math.min(shown, Math.floor(shown * Math.pow(u0, 1.4)));
      flying = Math.min(shown, Math.floor(shown * Math.pow(u1, 1.4)) + 1);
    }
    var Lf = Math.floor(landed / nb), part = landed - Lf * nb;   /* full layers, top layer */

    /* --- light: the counting band, the ring, the trickle ----------------- */
    var after = POUR + FLY + 400;
    var cyc = RED ? -1 : (T - after) % WAVE, kw = -9, ring = -1;
    if (cyc >= 0 && T > after) {
      if (cyc < 900) ring = cyc / 900;
      var wp = (cyc - 300) / WSWEEP;
      if (wp > 0 && wp < 1) kw = -1.5 + (L + 3) * ease(wp);
    }
    var trick = [], glint = [];
    if (!RED && T > after - TFLY) {
      var n0 = Math.floor((T - after + TFLY) / TRICKLE);
      for (var m = n0; m >= n0 - 9; m--) {
        var dep = after - TFLY + m * TRICKLE, age = T - dep;
        if (age < 0 || age > TFLY + 600) continue;
        var hsh = Math.sin(m * 91.7 + 3.1) * 43758.5453; hsh -= Math.floor(hsh);
        var cl0 = lay.cell[Math.floor(hsh * nb)];
        var hgt = Lf + (lay.rank[cl0[0] * b + cl0[1]] < part ? 1 : 0);
        if (age < TFLY) trick.push([cl0[0], cl0[1], hgt, age / TFLY]);
        else { var s3 = (age - TFLY) / 200; glint.push([cl0[0], cl0[1], hgt, s3 * s3 * Math.exp(2 - 2 * s3)]); }
      }
    }
    /* the still frame keeps three copies on their way, so it tells the story */
    if (RED) for (var rq = 0; rq < 3; rq++) {
      var rc = lay.cell[Math.floor(nb * (0.2 + 0.3 * rq)) % nb];
      trick.push([rc[0], rc[1], Lf + (lay.rank[rc[0] * b + rc[1]] < part ? 1 : 0), 0.28 + 0.24 * rq]);
    }
    var breath = RED ? 1 : 0.85 + 0.15 * Math.sin(T / 2600 * TAU);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round'; g.lineCap = 'round';

    function quad(a0, a1, b0, b1, c0, c1, d0, d1) {
      g.beginPath(); g.moveTo(a0, a1); g.lineTo(b0, b1); g.lineTo(c0, c1); g.lineTo(d0, d1); g.closePath();
    }

    /* --- ground: soft shadows under the block and the lone cube ---------- */
    var hx = b * ex, hy = b * ey, grown = RED ? 1 : Math.min(1, landed / shown + 0.25);
    g.fillStyle = M.css(M.hair, 0.5 * grown);
    g.shadowColor = M.css(M.hair, 0.9); g.shadowBlur = 12;
    quad(BX - hx - 4, BG + 2, BX, BG - hy - 1, BX + hx + 7, BG + 3, BX + 2, BG + hy + 4); g.fill();
    if (Lf > 0 || part > 0) {
      var sl = Math.min(20, (Lf + (part > 0 ? 0.5 : 0)) * ez * 0.3);
      g.fillStyle = M.css(M.hair, 0.34 * grown);
      quad(BX, BG + hy + 2, BX + hx + 4, BG + 2, BX + hx + 4 + sl, BG + 2 - sl * 0.22, BX + sl, BG + hy + 2 - sl * 0.22); g.fill();
    }
    g.fillStyle = M.css(M.hair, 0.5);
    g.beginPath(); g.ellipse(UX, BG + 1.5, E * 1.25, E * 0.46, 0, 0, TAU); g.fill();
    g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)';

    /* --- the lone cube's light, and its ring once a cycle ---------------- */
    var UY = BG - ez * 0.5;
    var halo = g.createRadialGradient(UX, UY, 0, UX, UY, 36);
    halo.addColorStop(0, M.css(M.bl5, 0.32 * breath));
    halo.addColorStop(0.45, M.css(M.bl5, 0.11 * breath));
    halo.addColorStop(1, M.css(M.bl5, 0));
    g.fillStyle = halo;
    g.beginPath(); g.arc(UX, UY, 36, 0, TAU); g.fill();
    if (ring >= 0) {
      var ro = 1 - Math.pow(1 - ring, 3);
      g.strokeStyle = M.css(M.bl5, 0.55 * Math.pow(1 - ring, 2) * Math.min(1, ring / 0.12));
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(UX, UY + 2, 12 + 30 * ro, (12 + 30 * ro) * 0.62, 0, 0, TAU); g.stroke();
    }

    /* one cube, (ox, oy) its (i, j, k) corner, size s, the faces asked for */
    function cube(ox, oy, fam, lv, fT, fL, fR, s) {
      var a = GAP * s, z = s - GAP * s;
      if (fT) {
        g.fillStyle = col(fam, 0, lv);
        quad(ox, oy + 2 * a * ey - ez * s, ox + (z - a) * ex, oy + (z + a) * ey - ez * s,
             ox, oy + 2 * z * ey - ez * s, ox + (a - z) * ex, oy + (a + z) * ey - ez * s);
        g.fill();
      }
      if (fL) {
        g.fillStyle = col(fam, 1, lv);
        quad(ox + (a - s) * ex, oy + (a + s) * ey - ez * a, ox + (z - s) * ex, oy + (z + s) * ey - ez * a,
             ox + (z - s) * ex, oy + (z + s) * ey - ez * z, ox + (a - s) * ex, oy + (a + s) * ey - ez * z);
        g.fill();
      }
      if (fR) {
        g.fillStyle = col(fam, 2, lv);
        quad(ox + (s - a) * ex, oy + (s + a) * ey - ez * a, ox + (s - z) * ex, oy + (s + z) * ey - ez * a,
             ox + (s - z) * ex, oy + (s + z) * ey - ez * z, ox + (s - a) * ex, oy + (s + a) * ey - ez * z);
        g.fill();
      }
    }
    function band(k) { return Math.round(11 * Math.exp(-Math.pow((k - kw) / 0.9, 2))); }

    /* --- the solid mass: Lf full layers, one lit body with a seam per unit - */
    if (Lf > 0) {
      var xL = PX(0, b), xF = PX(b, b), xR = PX(b, 0), xB = PX(0, 0);
      var yL0 = PY(0, b, 0), yF0 = PY(b, b, 0), yR0 = PY(b, 0, 0);
      var yLt = PY(0, b, Lf), yFt = PY(b, b, Lf), yRt = PY(b, 0, Lf), yBt = PY(0, 0, Lf);
      var gL = g.createLinearGradient(0, yFt, 0, yF0);
      gL.addColorStop(0, M.mL[0]); gL.addColorStop(1, M.mL[1]);
      g.fillStyle = gL; quad(xL, yL0, xF, yF0, xF, yFt, xL, yLt); g.fill();
      var gR = g.createLinearGradient(0, yFt, 0, yF0);
      gR.addColorStop(0, M.mR[0]); gR.addColorStop(1, M.mR[1]);
      g.fillStyle = gR; quad(xF, yF0, xR, yR0, xR, yRt, xF, yFt); g.fill();
      var gT = g.createLinearGradient(xB, yBt, xF, yFt);
      gT.addColorStop(0, M.mTop[0]); gT.addColorStop(1, M.mTop[1]);
      g.fillStyle = gT; quad(xB, yBt, xR, yRt, xF, yFt, xL, yLt); g.fill();
      var hl = g.createLinearGradient(xL, 0, xF, 0);
      hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(255,255,255,0.16)');
      g.fillStyle = hl; quad(xL, yL0, xF, yF0, xF, yFt, xL, yLt); g.fill();
      var hr = g.createLinearGradient(xF, 0, xR, 0);
      hr.addColorStop(0, 'rgba(255,255,255,0.1)'); hr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hr; quad(xF, yF0, xR, yR0, xR, yRt, xF, yFt); g.fill();
      /* the counting light, climbing both faces a layer at a time */
      if (kw > -1.4 && kw < Lf + 1.4) {
        for (var sb = -4; sb <= 4; sb++) {
          var k0 = kw + sb * 0.22 - 0.11, k1 = k0 + 0.22;
          if (k1 <= 0 || k0 >= Lf) continue;
          k0 = Math.max(0, k0); k1 = Math.min(Lf, k1);
          g.fillStyle = 'rgba(255,255,255,' + (0.3 * Math.exp(-sb * sb / 6)).toFixed(3) + ')';
          quad(xL, PY(0, b, k0), xF, PY(b, b, k0), xF, PY(b, b, k1), xL, PY(0, b, k1)); g.fill();
          quad(xF, PY(b, b, k0), xR, PY(b, 0, k0), xR, PY(b, 0, k1), xF, PY(b, b, k1)); g.fill();
        }
      }
      var bt = band(Lf);
      if (bt > 0) {
        g.fillStyle = 'rgba(255,255,255,' + (bt / 11 * 0.32).toFixed(3) + ')';
        quad(xB, yBt, xR, yRt, xF, yFt, xL, yLt); g.fill();
      }
      /* the foot sits in its own shade */
      var ao = g.createLinearGradient(0, yF0 - ez * 1.4, 0, yF0);
      ao.addColorStop(0, M.css(M.co7, 0)); ao.addColorStop(1, M.css(M.co7, 0.28));
      g.fillStyle = ao;
      var ak = Math.min(Lf, 1.4);
      quad(xL, yL0, xF, yF0, xF, PY(b, b, ak), xL, PY(0, b, ak)); g.fill();
      quad(xF, yF0, xR, yR0, xR, PY(b, 0, ak), xF, PY(b, b, ak)); g.fill();
      /* a seam at every unit, so the count can be read off the mass */
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.65;
      g.beginPath();
      for (var s1 = 1; s1 < b; s1++) {
        g.moveTo(PX(s1, b), PY(s1, b, 0)); g.lineTo(PX(s1, b), PY(s1, b, Lf));   /* left face */
        g.moveTo(PX(b, s1), PY(b, s1, 0)); g.lineTo(PX(b, s1), PY(b, s1, Lf));   /* right face */
        g.moveTo(PX(s1, 0), PY(s1, 0, Lf)); g.lineTo(PX(s1, b), PY(s1, b, Lf));  /* top */
        g.moveTo(PX(0, s1), PY(0, s1, Lf)); g.lineTo(PX(b, s1), PY(b, s1, Lf));
      }
      for (var s2 = 1; s2 < Lf; s2++) {
        g.moveTo(xL, PY(0, b, s2)); g.lineTo(xF, PY(b, b, s2)); g.lineTo(xR, PY(b, 0, s2));
      }
      g.stroke();
      /* light along the edges nearest the eye */
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(xL, yLt); g.lineTo(xF, yFt); g.lineTo(xR, yRt); g.moveTo(xF, yFt); g.lineTo(xF, yF0); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xL, yLt); g.lineTo(xB, yBt); g.lineTo(xR, yRt); g.stroke();
    }

    /* --- the unfinished top layer, cube by cube, back to front ----------- */
    if (part > 0) {
      var lvT = band(Lf + 0.5);
      for (var p = 0; p < part; p++) {
        var cc = lay.cell[p], ci = cc[0], cj = cc[1];
        var rgt = ci + 1 >= b || lay.rank[(ci + 1) * b + cj] >= part;
        var lft = cj + 1 >= b || lay.rank[ci * b + cj + 1] >= part;
        cube(PX(ci, cj), PY(ci, cj, Lf), 0, lvT, true, lft, rgt, 1);
      }
    }
    /* where a copy has just sunk in, the cell it chose glows */
    for (var gq = 0; gq < glint.length; gq++) {
      var gl = glint[gq], gi = gl[0], gj = gl[1], gk = gl[2];
      g.fillStyle = 'rgba(255,255,255,' + (0.6 * gl[3]).toFixed(3) + ')';
      quad(PX(gi, gj), PY(gi, gj, gk), PX(gi + 1, gj), PY(gi + 1, gj, gk),
           PX(gi + 1, gj + 1), PY(gi + 1, gj + 1, gk), PX(gi, gj + 1), PY(gi, gj + 1, gk));
      g.fill();
    }

    /* --- copies in the air ------------------------------------------------ */
    var sx = UX, sy = BG - ey;                      /* the lone cube's corner */
    function flyer(tx, ty, k3, lift, sink) {
      /* an arc from the lone cube to its place, blue turning coral as it joins */
      var cxp = (sx + tx) / 2, cyp = Math.max(72, Math.min(sy, ty) - lift);
      var e3 = ease(k3), a = 1 - e3;
      var x = a * a * sx + 2 * a * e3 * cxp + e3 * e3 * tx;
      var y = a * a * sy + 2 * a * e3 * cyp + e3 * e3 * ty;
      var fk = ease((k3 - 0.3) / 0.4), fam = Math.round(8 * (1 - fk));
      if (sink) {
        /* a short tail of light along the arc behind it */
        var eb = ease(Math.max(0, k3 - 0.16)), ab = 1 - eb;
        var bx = ab * ab * sx + 2 * ab * eb * cxp + eb * eb * tx, by = ab * ab * sy + 2 * ab * eb * cyp + eb * eb * ty;
        var oxy = ey - ez / 2 + ey;
        var tg2 = g.createLinearGradient(bx, by + oxy, x, y + oxy);
        var tc = M.mix(M.bl5, M.co5, fk), ta = 0.5 * Math.min(1, k3 / 0.15) * (1 - ease((k3 - 0.75) / 0.2));
        tg2.addColorStop(0, M.css(tc, 0)); tg2.addColorStop(1, M.css(tc, ta));
        g.strokeStyle = tg2; g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(bx, by + oxy);
        for (var w = 1; w <= 6; w++) {
          var ew = eb + (e3 - eb) * w / 6, aw = 1 - ew;
          g.lineTo(aw * aw * sx + 2 * aw * ew * cxp + ew * ew * tx, aw * aw * sy + 2 * aw * ew * cyp + ew * ew * ty + oxy);
        }
        g.stroke();
      }
      var s = 1;
      if (sink) { s = 1 - 0.8 * ease((k3 - 0.82) / 0.18); y += (1 - s) * ez; }
      cube(x, y + (1 - s) * ey, fam, 2 + Math.round(fam / 8), true, true, true, s);
    }
    if (!RED && flying > landed) {
      for (var f1 = landed; f1 < flying; f1++) {
        var k4 = (T - depart(f1)) / FLY;
        if (k4 <= 0 || k4 >= 1) continue;
        var kL = Math.floor(f1 / nb), c1 = lay.cell[f1 - kL * nb];
        flyer(PX(c1[0], c1[1]), PY(c1[0], c1[1], kL), k4, 40 + 36 * ((f1 * 0.618) % 1), false);
      }
    }
    for (var tq = 0; tq < trick.length; tq++) {
      var tr = trick[tq];
      flyer(PX(tr[0], tr[1]), PY(tr[0], tr[1], tr[2]), tr[3], 70 + 40 * ((tq * 0.618) % 1), true);
    }

    /* --- the lone cube: the new path's whole allocation ------------------ */
    cube(sx, sy, 8, RED ? 3 : Math.round(3 + 4 * (breath - 0.7) / 0.3), true, true, true, 1);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx + (GAP - 1) * ex, sy + (GAP + 1) * ey - ez); g.lineTo(sx, sy + 2 * ey - ez);
    g.lineTo(sx + (1 - GAP) * ex, sy + (1 + GAP) * ey - ez);
    g.stroke();
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
  /* funnel — mujoco-war1541                                             */
  /* ==================================================================== */
  function funnel(g, vb, t, st) {
    /* Island discovery asks which of the scene's 22 kinematic trees are joined,
       directly or through others, by constraints. The old GPU kernel answered it
       with a matrix: one cell for every pair of trees, 22 x 22 = 484 cells of
       scratch, carried onto the device every step. The replacement is a
       disjoint-set union: one entry per tree, 22 entries, each holding a pointer
       to another tree, and a tree whose pointer ends at itself is the root that
       names its island.

       So the figure opens on the thing that was removed. The 484-cell matrix is
       laid out as a floor in coral, and then every row slides into its diagonal
       cell: the 22 cells of row i collapse into the single entry for tree i. Those
       22 entries lift off the floor and become the forest, and the floor stays
       behind as a ghost of the scratch that is no longer allocated.

       The forest then runs the union for real, one simulation step at a time,
       on three different sets of contacts that repeat. Every step it starts over
       with every pointer at itself (each tree alone), then takes its contacts in
       three rounds. A contact is drawn as a bundle of fine threads between two
       trees, the constraint rows that tie them. Each end walks its pointers up to
       its root (the bright bead climbing), and if the two roots differ, one root's
       pointer swings over to the other: two islands become one, the absorbed one
       takes the survivor's colour and settles in around it. If both walks reach
       the same root the trees were already one island and nothing is linked.
       Height is depth in the union's tree: roots stand highest, and a tree hung
       under a hooked root sinks a level.

       Then the pointers are compressed. Every tree deeper than one level has its
       pointer snap straight to its root and rises to join the others, so each
       island ends as one root with every member pointing at it. That is the hero
       moment, and straight after it the ghost floor lights every pair of trees
       that share an island, in the island's colour: the whole 484-cell answer the
       old kernel had to store, read off 22 entries. Beads keep flowing along every
       pointer toward its root, which is the direction every find walks.

       Everything drawn is computed: the keyframes are the actual parent arrays of
       a union run on these contacts, the heights are actual tree depths, and the
       lit floor is actual root equality. The scene itself (positions, contacts,
       the order they are taken in) is an illustration, not the benchmark scene.

       Drawing is orthographic 3D with a slow sway, the floor first, then halos,
       pointers and threads, then the trees sorted far to near. Shading is alpha
       and a mix toward each hue's -700 token, never darker than the palette.

       Measured, in the preview harness:
       - The step clock first started at 3,000 ms while the last entries were
         still lifting until 3,778, so they jumped to their places. The lift now
         ends at 3,394 and the clock starts at 3,400. The matrix also lists the
         trees in the order they stand on screen, which halved the fastest lift
         from 13.3 to 6.0 units a frame.
       - A change of island mixed complementary hues into olive and mauve. The
         change now takes a short window and passes through a paler tint.
       - Darkest pixel is luma 69.9 against the floor of 58. Worst frame is 486
         fills and strokes (the matrix build); after it, about 190. */
    var TAU = Math.PI * 2, N = 22;
    var F = 0.95;                              /* floor half side, world units */
    var ZL = [1.12, 0.8, 0.56, 0.4];           /* height by depth in the union's tree */
    var PULL = 0.6;                            /* a member sits this far out from its root */
    var S = 150, CX = 235, YAW = -0.66, SWAY = 0.1;
    var EL0 = 1.02, CY0 = 250, EL1 = 0.5, CY1 = 312;   /* the camera tilts from the matrix to the forest */
    var COND0 = 1000, COND = 1200, LIFT0 = 2000, LIFT = 1100;
    var T_S = 3400;                            /* the step clock, once the last entry has landed */
    var INIT = 900, ROUND = 1250, COMP = 1300, HOLD = 3000;
    var STEP = INIT + 3 * ROUND + COMP + HOLD; /* 8,950 ms; three steps repeat every 26,850 */

    var C = funnel.cache;
    if (!C) {
      C = funnel.cache = {};
      C.home = [[-0.246, 0.686], [-0.026, -0.858], [0.709, -0.083], [-0.879, -0.064], [0.478, 0.73],
                [-0.04, 0.006], [-0.377, -0.448], [-0.605, 0.322], [0.41, -0.522], [0.764, 0.408],
                [0.221, 0.327], [0.158, -0.269], [0.333, -0.834], [0.368, -0.011], [-0.452, 0.016],
                [0.145, 0.878], [-0.681, -0.357], [-0.103, 0.405], [0.706, -0.433], [-0.293, -0.795],
                [0.128, -0.551], [-0.536, -0.68]];
      for (var h = 0; h < N; h++) { C.home[h][0] *= 1.1; C.home[h][1] *= 1.1; }
      /* The matrix may list the trees in any order, so it lists them left to
         right as they stand in the forest, and each entry rises nearly straight
         up to its place instead of flying across the scene. */
      var sig = [], so = [];
      for (h = 0; h < N; h++) so.push(h);
      so.sort(function (a, b) {
        return (C.home[a][0] * Math.cos(YAW) - C.home[a][1] * Math.sin(YAW)) -
               (C.home[b][0] * Math.cos(YAW) - C.home[b][1] * Math.sin(YAW));
      });
      for (h = 0; h < N; h++) sig[so[h]] = h;
      C.sig = sig;
      C.hue = [0, 3, 2, 2, 2, 1, 1, 1, 0, 3, 2, 2, 2, 0, 3, 0, 3, 3, 1, 1, 1, 3];
      /* contacts per step, in three rounds; [a, b] hooks root(b) under root(a) */
      var STEPS = [
        [[[17, 0], [4, 15], [10, 13], [8, 20], [18, 2], [11, 12], [19, 21], [6, 1], [14, 7]],
         [[10, 17], [4, 9], [20, 11], [19, 1], [14, 5]],
         [[0, 15], [8, 18], [8, 12]]],
        [[[17, 0], [13, 11], [4, 15], [10, 5], [8, 20], [18, 2], [12, 9], [14, 7], [3, 16], [6, 21]],
         [[10, 17], [13, 4], [8, 18], [14, 3]],
         [[5, 11], [8, 12], [5, 17]]],
        [[[19, 21], [6, 16], [1, 20], [17, 0], [14, 7], [5, 3], [8, 18], [11, 13], [4, 15]],
         [[19, 1], [17, 5], [8, 12], [4, 10]],
         [[21, 6], [5, 14], [8, 11], [19, 20]]]];
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      C.c5 = [hex('--blue-500', '#2456dc'), hex('--mint-500', '#0b93ab'),
              hex('--violet-500', '#a66cf0'), hex('--amber-500', '#d96a06')];
      C.c7 = [hex('--blue-700', '#163a9a'), hex('--mint-700', '#0a6b7c'),
              hex('--violet-700', '#6b35c4'), hex('--amber-700', '#9a4906')];
      C.coral = hex('--coral-500', '#d9376e');
      C.coral7 = hex('--coral-700', '#a0183f');
      C.white = hex('--raised', '#ffffff');
      C.muted = hex('--muted', '#5f5b53');

      /* keyframes: the parent array after each phase of each step */
      var snap = function (par) {
        var root = [], depth = [], size = [], i, k, x;
        for (i = 0; i < N; i++) size.push(0);
        for (i = 0; i < N; i++) {
          x = i; k = 0;
          while (par[x] !== x) { x = par[x]; k++; }
          root.push(x); depth.push(k); size[x]++;
        }
        return { par: par.slice(), root: root, depth: depth, size: size };
      };
      var findPath = function (par, x) {
        var p = [x];
        while (par[x] !== x) { x = par[x]; p.push(x); }
        return p;
      };
      C.K = []; C.E = [];
      for (var s = 0; s < STEPS.length; s++) {
        var par = [], i, r;
        for (i = 0; i < N; i++) par.push(i);
        var ks = [snap(par)], es = [];
        for (r = 0; r < 3; r++) {
          var ev = [], e;
          for (e = 0; e < STEPS[s][r].length; e++) {
            var a = STEPS[s][r][e][0], b = STEPS[s][r][e][1];
            var pa = findPath(par, a), pb = findPath(par, b);
            ev.push({ a: a, b: b, pa: pa, pb: pb, ra: pa[pa.length - 1], rb: pb[pb.length - 1],
                      ph: ((a * 7 + b * 13) % 11) / 11 });
          }
          for (e = 0; e < ev.length; e++) if (ev[e].ra !== ev[e].rb) par[ev[e].rb] = ev[e].ra;
          ks.push(snap(par)); es.push(ev);
        }
        var fin = ks[3];
        for (i = 0; i < N; i++) par[i] = fin.root[i];   /* compression: every pointer to its root */
        ks.push(snap(par));
        /* trees sorted by island, islands left to right as their roots stand on
           screen: in that order the lit pairs fall into one square per island */
        var cy = Math.cos(YAW), sy = Math.sin(YAW), ord = [];
        for (i = 0; i < N; i++) ord.push(i);
        var sx = function (i) { var hh = C.home[fin.root[i]]; return hh[0] * cy - hh[1] * sy; };
        ord.sort(function (a, b) { return sx(a) - sx(b) || fin.root[a] - fin.root[b] || a - b; });
        var perm = [];
        for (i = 0; i < N; i++) perm[ord[i]] = i;
        ks[4].perm = perm;
        C.K.push(ks); C.E.push(es);
      }
      C.pos = []; C.col = []; C.col7 = []; C.scr = [];
      for (i = 0; i < N; i++) { C.pos.push([0, 0, 0]); C.col.push([0, 0, 0]); C.col7.push([0, 0, 0]); C.scr.push([0, 0, 0]); }
      C.rootw = new Float32Array(N); C.halo = new Float32Array(N);
      C.from = new Int8Array(N); C.to = new Int8Array(N); C.pe = new Float32Array(N);
      C.order = []; for (i = 0; i < N; i++) C.order.push(i);
      C.grid = new Float32Array(23 * 23 * 2);
    }

    function hash(i, k) { var q = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return q - Math.floor(q); }
    function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    function css(c, al) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al + ')'; }
    function clamp(k) { return k < 0 ? 0 : k > 1 ? 1 : k; }
    /* (s e^(1-s))^2: a swell that leaves zero with zero slope and never pops */
    function swell(k) { return k <= 0 ? 0 : k * k * Math.exp(2 - 2 * k); }

    var RED = REDUCED;
    var T = RED ? T_S + INIT + 3 * ROUND + COMP + 2400 : t;

    /* --- projection ------------------------------------------------------ */
    var phi = RED ? YAW : YAW + SWAY * Math.sin(TAU * T / 26000);
    var tilt = RED ? 1 : ease((T - 1700) / 1500);
    var EL = EL0 + (EL1 - EL0) * tilt, CY = CY0 + (CY1 - CY0) * tilt;
    var ca = Math.cos(phi), sa = Math.sin(phi), ce = Math.cos(EL), se = Math.sin(EL);
    function proj(x, y, z, o) {
      var X = x * ca - y * sa, Y = x * sa + y * ca;
      o[0] = CX + S * X; o[1] = CY - S * (z * ce + Y * se); o[2] = -Y * ce + z * se;
      return o;
    }

    /* --- where the clock is ---------------------------------------------- */
    var building = T < T_S;
    var sIdx = 0, sT = 0, phase = 0, pk = 0, K0, K1, ksNow;
    if (!building) {
      var step = Math.floor((T - T_S) / STEP);
      sT = (T - T_S) - step * STEP;
      sIdx = step % 3;
      var KS = C.K[sIdx];
      ksNow = KS;
      if (sT < INIT) {
        phase = 0; pk = sT / INIT;
        K0 = step === 0 ? KS[0] : C.K[(step + 2) % 3][4]; K1 = KS[0];
      } else if (sT < INIT + 3 * ROUND) {
        var rr = Math.floor((sT - INIT) / ROUND);
        phase = 1 + rr; pk = (sT - INIT - rr * ROUND) / ROUND;
        K0 = KS[rr]; K1 = KS[rr + 1];
      } else if (sT < INIT + 3 * ROUND + COMP) {
        phase = 4; pk = (sT - INIT - 3 * ROUND) / COMP;
        K0 = KS[3]; K1 = KS[4];
      } else {
        phase = 5; pk = (sT - INIT - 3 * ROUND - COMP) / HOLD;
        K0 = KS[4]; K1 = KS[4];
      }
    }

    var home = C.home, pos = C.pos, col = C.col, col7 = C.col7, scr = C.scr, c5 = C.c5, c7 = C.c7;
    var i, j, k, n, q = [0, 0, 0];
    var bob = RED ? 0 : 1;

    function target(K, i, out) {
      var r = K.root[i], hx = home[i][0], hy = home[i][1];
      if (r !== i) {
        hx = home[r][0] + (hx - home[r][0]) * PULL;
        hy = home[r][1] + (hy - home[r][1]) * PULL;
      }
      out[0] = hx; out[1] = hy; out[2] = ZL[Math.min(3, K.depth[i])];
      return out;
    }

    /* --- per tree: position, colour, pointer ------------------------------ */
    var A = [0, 0, 0], B = [0, 0, 0];
    for (i = 0; i < N; i++) {
      var e;
      if (building) {
        /* lift: the diagonal entry (i, i) rises out of the floor as a row,
           then the row fans out into the forest */
        var dx = -F + (C.sig[i] + 0.5) * 2 * F / N, lk = (T - LIFT0 - C.sig[i] * 14) / LIFT;
        e = ease((lk - 0.3) / 0.7);
        var h0 = home[i];
        pos[i][0] = dx + (h0[0] - dx) * e;
        pos[i][1] = dx + (h0[1] - dx) * e;
        pos[i][2] = ZL[0] * ease(lk / 0.55) + bob * 0.018 * Math.sin(TAU * T / 3400 + i * 1.7) * ease(lk);
        var ck0 = ease((lk - 0.45) / 0.3);
        var cc = mix(mix(C.coral, c5[C.hue[i]], ck0), C.white, 0.35 * Math.sin(Math.PI * ck0));
        var cd = mix(C.coral7, c7[C.hue[i]], ck0);
        col[i][0] = cc[0]; col[i][1] = cc[1]; col[i][2] = cc[2];
        col7[i][0] = cd[0]; col7[i][1] = cd[1]; col7[i][2] = cd[2];
        C.rootw[i] = 1; C.halo[i] = 0; C.from[i] = i; C.to[i] = i; C.pe[i] = 1;
        continue;
      }
      /* each tree's own progress through the phase */
      if (phase === 0) e = ease((pk - 0.25 * hash(i, 4)) / 0.7);
      else if (phase <= 3) e = ease((pk - 0.52) / 0.42);
      else if (phase === 4) e = ease((pk - 0.12 - 0.22 * hash(i, 5)) / 0.42);
      else e = 1;
      target(K0, i, A); target(K1, i, B);
      pos[i][0] = A[0] + (B[0] - A[0]) * e;
      pos[i][1] = A[1] + (B[1] - A[1]) * e;
      pos[i][2] = A[2] + (B[2] - A[2]) * e + bob * 0.018 * Math.sin(TAU * T / 3400 + i * 1.7);
      var ca0 = c5[C.hue[K0.root[i]]], cb0 = c5[C.hue[K1.root[i]]];
      /* a change of island passes through a paler tint rather than a muddy mix */
      var ec = ease((e - 0.35) / 0.3);
      var cm = mix(mix(ca0, cb0, ec), C.white, 0.35 * Math.sin(Math.PI * ec));
      var cn = mix(c7[C.hue[K0.root[i]]], c7[C.hue[K1.root[i]]], ec);
      col[i][0] = cm[0]; col[i][1] = cm[1]; col[i][2] = cm[2];
      col7[i][0] = cn[0]; col7[i][1] = cn[1]; col7[i][2] = cn[2];
      var r0 = K0.root[i] === i ? 1 : 0, r1 = K1.root[i] === i ? 1 : 0;
      C.rootw[i] = r0 + (r1 - r0) * e;
      var h0w = K0.size[K0.root[i]] > 1 ? 1 : 0, h1w = K1.size[K1.root[i]] > 1 ? 1 : 0;
      C.halo[i] = h0w + (h1w - h0w) * e;
      C.from[i] = K0.par[i]; C.to[i] = K1.par[i]; C.pe[i] = e;
    }
    for (i = 0; i < N; i++) proj(pos[i][0], pos[i][1], pos[i][2], scr[i]);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* --- the floor: the pair matrix -------------------------------------- */
    var cw = 2 * F / N;
    var Ux = S * ca * cw, Uy = -S * sa * se * cw;       /* one column along a row, on screen */
    var Vx = -S * sa * cw, Vy = -S * ca * se * cw;      /* one row down a column */
    /* the cell at row rf, column cf (fractional while it slides), shrunk by sh */
    function cellQ(rf, cf, sh) {
      proj(-F + (cf + 0.5) * cw, -F + (rf + 0.5) * cw, 0, q);
      var ux = Ux * sh / 2, uy = Uy * sh / 2, vx = Vx * sh / 2, vy = Vy * sh / 2;
      g.moveTo(q[0] - ux - vx, q[1] - uy - vy);
      g.lineTo(q[0] + ux - vx, q[1] + uy - vy);
      g.lineTo(q[0] + ux + vx, q[1] + uy + vy);
      g.lineTo(q[0] - ux + vx, q[1] - uy + vy);
      g.closePath();
    }
    var ghost = building ? ease((T - COND0 - 400) / 900) : 1;
    /* the rim of the floor */
    g.strokeStyle = css(C.coral7, 0.18 + 0.1 * (1 - ghost)); g.lineWidth = 1.2;
    g.beginPath();
    proj(-F, -F, 0, q); g.moveTo(q[0], q[1]);
    proj(F, -F, 0, q); g.lineTo(q[0], q[1]);
    proj(F, F, 0, q); g.lineTo(q[0], q[1]);
    proj(-F, F, 0, q); g.lineTo(q[0], q[1]);
    g.closePath(); g.stroke();
    /* the ghost: what is no longer allocated */
    if (ghost > 0) {
      g.fillStyle = css(C.coral, 0.075 * ghost);
      g.beginPath();
      for (j = 0; j < N; j++) for (i = 0; i < N; i++) cellQ(j, i, 0.8);
      g.fill();
    }
    if (building) {
      /* the matrix builds in a wave, then every row slides into its diagonal */
      for (j = 0; j < N; j++) {
        for (i = 0; i < N; i++) {
          var appear = ease((T + 260 - (i + j) * 12) / 420);
          if (appear <= 0) continue;
          var ck = ease((T - COND0 - j * 14 - Math.abs(i - j) * 9) / (COND * 0.55));
          var diag = i === j;
          var lift = diag ? ease((T - LIFT0 - i * 14) / (LIFT * 0.25)) : 0;
          var al = diag ? (0.78 + 0.22 * ck) * (1 - lift) : 0.72 * (1 - ck);
          /* the dense kernel touching every pair: a shimmer crossing the field */
          var sh = swell((T - 350 - (i + j) * 16) / 260);
          al = Math.min(1, al * appear + 0.18 * sh * (1 - ck));
          if (al <= 0.01) continue;
          g.fillStyle = css(diag && ck > 0 ? mix(C.coral, C.coral7, 0.35 * ck) : C.coral, al);
          g.beginPath();
          cellQ(j, diag ? i : i + (j - i) * ck, 0.8 * appear * (diag ? 1 + 0.12 * ck : 1 - 0.3 * ck));
          g.fill();
        }
      }
    }

    /* The pairs that share an island, read off the roots and lit on the floor.
       They light where they are, then every row and column is carried to its
       tree's place in island order, and the scatter gathers into one square per
       island: the relation the matrix held, rebuilt from 22 entries. */
    var plaid = 0, KP = null;
    if (!building) {
      if (phase === 5) { plaid = 1; KP = ksNow[4]; }
      else if (phase === 0 && (T - T_S) >= STEP) { plaid = 1 - ease(pk / 0.7); KP = C.K[(Math.floor((T - T_S) / STEP) + 2) % 3][4]; }
    }
    if (plaid > 0.004) {
      var since = phase === 5 ? sT - INIT - 3 * ROUND - COMP : 1e9;
      var pm = KP.perm;
      for (j = 0; j < N; j++) {
        for (i = 0; i < N; i++) {
          if (KP.root[i] !== KP.root[j]) continue;
          var si = C.sig[i], sj = C.sig[j];
          var lit = RED ? 1 : ease((since - 80 - (si + sj) * 11) / 360) * plaid;
          if (lit <= 0.004) continue;
          var mv = RED ? 1 : ease((since - 800 - (pm[i] + pm[j]) * 12) / 900);
          var hc = c5[C.hue[KP.root[i]]];
          g.fillStyle = css(hc, (i === j ? 0.82 : 0.55) * lit);
          g.beginPath(); cellQ(sj + (pm[j] - sj) * mv, si + (pm[i] - si) * mv, 0.8); g.fill();
        }
      }
    }

    /* --- the forest --------------------------------------------------------- */
    var ctl = [0, 0, 0], P0 = [0, 0, 0], P1 = [0, 0, 0], PC = [0, 0, 0];
    /* a pointer from tree i to a point: a quadratic arc bowing upward, in screen space */
    function arc(i, tx, ty, tz, out0, outC, out1) {
      var ax = pos[i][0], ay = pos[i][1], az = pos[i][2];
      var L = Math.hypot(tx - ax, ty - ay);
      proj(ax, ay, az, out0);
      proj((ax + tx) / 2, (ay + ty) / 2, (az + tz) / 2 + 0.1 + 0.16 * L, outC);
      proj(tx, ty, tz, out1);
    }
    function bez(p0, pc, p1, u, o) {
      var v = 1 - u;
      o[0] = v * v * p0[0] + 2 * v * u * pc[0] + u * u * p1[0];
      o[1] = v * v * p0[1] + 2 * v * u * pc[1] + u * u * p1[1];
      return o;
    }
    /* the arc cut at u, by de Casteljau, into the current path */
    function arcPath(p0, pc, p1, u) {
      var qx = p0[0] + (pc[0] - p0[0]) * u, qy = p0[1] + (pc[1] - p0[1]) * u;
      bez(p0, pc, p1, u, ctl);
      g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(qx, qy, ctl[0], ctl[1]);
    }

    /* soft pools of light on the floor under every tree; where an island
       gathers, its pools run together */
    var poolIn = building ? ease((T - LIFT0 - 300) / LIFT) : 1;
    if (poolIn > 0) {
      for (i = 0; i < N; i++) {
        proj(pos[i][0], pos[i][1], 0, q);
        var pr = 13 + 7 * C.halo[i];
        g.save(); g.translate(q[0], q[1]); g.scale(1, se);
        var pg = g.createRadialGradient(0, 0, 0, 0, 0, pr);
        pg.addColorStop(0, css(col[i], (0.16 + 0.08 * C.halo[i]) * poolIn));
        pg.addColorStop(1, css(col[i], 0));
        g.fillStyle = pg;
        g.beginPath(); g.arc(0, 0, pr, 0, TAU); g.fill();
        g.restore();
      }
    }

    /* island halos: every member glows, and overlapping glow is the island */
    for (i = 0; i < N; i++) {
      var hw = C.halo[i];
      if (hw <= 0.01) continue;
      var R0 = 34 + 8 * C.rootw[i];
      var br = RED ? 1 : 0.9 + 0.1 * Math.sin(TAU * T / 4200 + i);
      var hg = g.createRadialGradient(scr[i][0], scr[i][1], 0, scr[i][0], scr[i][1], R0);
      hg.addColorStop(0, css(col[i], 0.26 * hw * br));
      hg.addColorStop(0.5, css(col[i], 0.1 * hw * br));
      hg.addColorStop(1, css(col[i], 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(scr[i][0], scr[i][1], R0, 0, TAU); g.fill();
    }

    /* The contacts: the constraint rows that tie two trees, drawn as a bundle
       of threads in the colour of one tree at one end and the other at the
       other. A contact flares while its round takes it, then stays on as a
       faint web, the union's actual input, until the step starts over. */
    function contact(E, al, seed) {
      var pa = pos[E.a], pb = pos[E.b];
      var tg = g.createLinearGradient(scr[E.a][0], scr[E.a][1], scr[E.b][0], scr[E.b][1]);
      tg.addColorStop(0, css(col7[E.a], al));
      tg.addColorStop(1, css(col7[E.b], al));
      g.strokeStyle = tg; g.lineWidth = 0.85;
      var nx = -(pb[1] - pa[1]), ny = pb[0] - pa[0], nl = Math.hypot(nx, ny) || 1;
      proj(pa[0], pa[1], pa[2], P0);
      proj(pb[0], pb[1], pb[2], P1);
      g.beginPath();
      for (var m = 0; m < 7; m++) {
        var off = (m / 6 - 0.5) * 0.09, sag = 0.04 + 0.07 * hash(seed, m);
        proj((pa[0] + pb[0]) / 2 + nx / nl * off, (pa[1] + pb[1]) / 2 + ny / nl * off, (pa[2] + pb[2]) / 2 - sag, PC);
        g.moveTo(P0[0], P0[1]); g.quadraticCurveTo(PC[0], PC[1], P1[0], P1[1]);
      }
      g.stroke();
    }
    var WEB = 0.17;
    if (!building) {
      var evs, rN, wa;
      if (phase === 0) {
        if (T - T_S >= STEP) {
          evs = C.E[(Math.floor((T - T_S) / STEP) + 2) % 3];
          wa = WEB * (1 - ease(pk / 0.6));
          if (wa > 0.004) for (rN = 0; rN < 3; rN++) for (n = 0; n < evs[rN].length; n++) contact(evs[rN][n], wa, n + 3 * (rN + 1));
        }
      } else {
        evs = C.E[sIdx];
        for (rN = 0; rN < 3; rN++) {
          if (phase <= 3 && rN > phase - 1) break;
          wa = WEB;
          if (rN === phase - 1) {
            var env = ease(pk / 0.12) * (1 - ease((pk - 0.42) / 0.28));
            wa = Math.max(0.55 * env, WEB * ease((pk - 0.35) / 0.3));
          }
          if (wa > 0.004) for (n = 0; n < evs[rN].length; n++) contact(evs[rN][n], wa, n + 3 * (rN + 1));
        }
      }
    }

    /* pointers, and light flowing along each one toward its root */
    var flows = [];
    if (!building) {
      for (i = 0; i < N; i++) {
        var f0 = C.from[i], f1 = C.to[i], pe = C.pe[i], tgt, frac = 1, al2 = 1;
        if (f0 === i && f1 === i) continue;
        if (f0 === i) { tgt = f1; frac = pe; }                    /* hooked: the pointer grows */
        else if (f1 === i) { tgt = f0; frac = 1 - pe; }           /* reset: it retracts */
        else tgt = -1;                                            /* compressed: it slides */
        if (frac <= 0.01) continue;
        var tx, ty, tz;
        if (tgt >= 0) { tx = pos[tgt][0]; ty = pos[tgt][1]; tz = pos[tgt][2]; }
        else {
          tx = pos[f0][0] + (pos[f1][0] - pos[f0][0]) * pe;
          ty = pos[f0][1] + (pos[f1][1] - pos[f0][1]) * pe;
          tz = pos[f0][2] + (pos[f1][2] - pos[f0][2]) * pe;
        }
        arc(i, tx, ty, tz, P0, PC, P1);
        var c7i = mix(col[i], col7[i], 0.45);
        g.strokeStyle = css(col[i], 0.16 * al2); g.lineWidth = 6;
        g.beginPath(); arcPath(P0, PC, P1, frac); g.stroke();
        g.strokeStyle = css(c7i, 0.78 * al2); g.lineWidth = 2;
        g.beginPath(); arcPath(P0, PC, P1, frac); g.stroke();
        if (frac > 0.98) flows.push([i, P0.slice(), PC.slice(), P1.slice()]);
      }
    }

    /* contacts and the finds they start */
    if (!building && phase >= 1 && phase <= 3) {
      var ev = C.E[sIdx][phase - 1];
      for (n = 0; n < ev.length; n++) {
        var E = ev[n];
        /* each end walks up its pointers to its root */
        var fk = ease((pk - 0.1) / 0.4);
        for (var side = 0; side < 2; side++) {
          var path = side ? E.pb : E.pa;
          if (fk <= 0 || fk >= 1) continue;
          var segs = path.length - 1;
          var hc2 = col[path[0]];
          for (var tr = 4; tr >= 0; tr--) {
            var u = Math.max(0, fk - tr * 0.035) * Math.max(segs, 0.0001);
            var sgi = Math.min(segs - 1, Math.floor(u)), su = u - sgi;
            var bx, by;
            if (segs === 0) { bx = scr[path[0]][0]; by = scr[path[0]][1]; }
            else {
              var cN = path[sgi], pN = path[sgi + 1];
              arc(cN, pos[pN][0], pos[pN][1], pos[pN][2], P0, PC, P1);
              bez(P0, PC, P1, su, q); bx = q[0]; by = q[1];
            }
            var fa = Math.sin(Math.PI * fk);
            g.fillStyle = tr === 0 ? css(C.white, 0.95 * fa) : css(hc2, 0.5 * fa * (1 - tr / 5));
            g.beginPath(); g.arc(bx, by, tr === 0 ? 2.6 : 3.8 - tr * 0.4, 0, TAU); g.fill();
            if (tr === 0) {
              g.strokeStyle = css(mix(hc2, col7[path[0]], 0.5), 0.9 * fa); g.lineWidth = 1.6;
              g.stroke();
            }
          }
        }
        /* both walks arrive, and the root that survives rings once; when both
           reached the same root it rings harder, and nothing is linked */
        var rk = (pk - 0.47) / 0.3;
        if (rk > 0 && rk < 1) {
          var rx = scr[E.ra], same = E.ra === E.rb;
          g.strokeStyle = css(col[E.ra], (same ? 0.75 : 0.5) * (1 - rk) * ease(rk / 0.15));
          g.lineWidth = same ? 2.4 : 1.6;
          g.beginPath(); g.arc(rx[0], rx[1], 10 + 16 * (1 - (1 - rk) * (1 - rk)), 0, TAU); g.stroke();
        }
      }
    }

    /* compression lands: every root rings once as its island completes */
    if (!building && phase === 4) {
      var ck2 = (pk - 0.55) / 0.45;
      if (ck2 > 0) {
        for (i = 0; i < N; i++) {
          if (K1.root[i] !== i || K1.size[i] < 2) continue;
          g.strokeStyle = css(col[i], 0.55 * (1 - ck2) * ease(ck2 / 0.12));
          g.lineWidth = 2.2;
          g.beginPath(); g.arc(scr[i][0], scr[i][1], 12 + 26 * (1 - (1 - ck2) * (1 - ck2)), 0, TAU); g.stroke();
        }
      }
    }

    /* light flowing up every settled pointer, the way a find walks */
    var hd = [0, 0, 0];
    for (n = 0; n < flows.length; n++) {
      var fl = flows[n], fi = fl[0];
      var fu = RED ? 0.62 : ((T / 1400 + hash(fi, 6)) % 1), f0u = Math.max(0, fu - 0.3);
      var fa2 = Math.sin(Math.PI * fu);
      if (fa2 < 0.02) continue;
      bez(fl[1], fl[2], fl[3], f0u, q); bez(fl[1], fl[2], fl[3], fu, hd);
      var lg = g.createLinearGradient(q[0], q[1], hd[0], hd[1]);
      lg.addColorStop(0, css(mix(col[fi], C.white, 0.6), 0));
      lg.addColorStop(1, css(mix(col[fi], C.white, 0.75), 0.95 * fa2));
      g.strokeStyle = lg; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(q[0], q[1]);
      for (k = 1; k <= 6; k++) { bez(fl[1], fl[2], fl[3], f0u + (fu - f0u) * k / 6, q); g.lineTo(q[0], q[1]); }
      g.stroke();
      g.fillStyle = css(C.white, 0.95 * fa2);
      g.beginPath(); g.arc(hd[0], hd[1], 1.8, 0, TAU); g.fill();
    }

    /* the trees, far to near */
    var ord = C.order;
    ord.sort(function (a, b) { return scr[a][2] - scr[b][2]; });
    for (n = 0; n < N; n++) {
      i = ord[n];
      var x = scr[i][0], y = scr[i][1], rw = C.rootw[i];
      var rad = 6.2 + 2.4 * rw;
      if (building) {
        var le = ease((T - LIFT0 - C.sig[i] * 14) / (LIFT * 0.25));
        if (le <= 0) continue;
        rad *= le;
      }
      var cHi = mix(col[i], C.white, 0.5);
      var cLo = mix(col[i], col7[i], 0.6);
      var ng = g.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
      ng.addColorStop(0, css(cHi, 1));
      ng.addColorStop(0.55, css(col[i], 1));
      ng.addColorStop(1, css(cLo, 1));
      g.fillStyle = ng;
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      /* a root wears a ring: the tree whose pointer ends at itself names its island */
      if (!building && rw > 0.02 && C.halo[i] > 0.02) {
        g.strokeStyle = css(col[i], 0.7 * rw * C.halo[i]); g.lineWidth = 1.6;
        g.beginPath(); g.arc(x, y, rad + 3.6, 0, TAU); g.stroke();
      }
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
  /* gather — nemo-relay-481                                             */
  /* ==================================================================== */
  function gather(g, vb, t, st) {
    /* Adaptive learning keeps a profile per key and adds every observation of a
       request to the profile its key names. The key was built from the model,
       the system prompt, the tool schema and the first user message. The first
       three are the scaffold and never change between tasks; the first user
       message changes every time. So every request got a key of its own, every
       profile held a single observation, and nothing ever accumulated. The fix
       keys on the stable scaffold alone.

       Every request here is a packet: a violet core, the scaffold, identical in
       all of them, with one coloured satellite circling it, the first user
       message, a different colour each time. The stream comes down to a fork and
       every packet is keyed both ways at once, so the two outcomes are always on
       screen together for the same requests.

       Left, the old key. It includes the message, so the packet takes the
       message's colour and flies to wherever its key hashes: a fresh profile, a
       small glass sphere holding exactly one dot. The stream is split into a fan
       of rays by the one field that differs, and the profiles never grow.

       Right, the new key. It leaves the message out, so the satellite fades and
       every packet flies to the same place: one profile, drawn as a globe of
       nested shells that fills from the bottom up, one dot per observation. The
       rays all land together and thicken into one beam. When a shell closes it
       rings once: that is the hero moment, and it keeps arriving because the
       profile keeps growing.

       Placement is computed, not drawn by hand: a left profile sits where a
       32-bit hash of its full key puts it, so the scatter is the scatter a hash
       really makes, and the right globe is the one place every key now shares.
       The requests, their count and their timing are an illustration.

       Drawing is source-over alpha only. The globe and the left cloud are real
       3D point sets, rotated and sorted far to near every frame.

       Measured, in the preview harness:
       - Plain FNV-1a put keys that differ only in their last characters on a
         straight line, so the "scatter" was a diagonal. A murmur3 finaliser
         after it gives the scatter a hash should give.
       - Packet tails at the top of the source reached the second top label.
         The source now starts at y 80 and tails are clamped to it; the
         closest label gap is 15 units. The shell ring also clipped the right
         edge at x 469; painted extent is now x 12..461, y 75..387.
       - Two hundred globe dots were two hundred fills. They go in eight depth
         bands now, and settled rays in one stroke per colour. Worst frame is
         273 fills and strokes. Darkest pixel is luma 74.6 against 58. */
    var TAU = Math.PI * 2;
    var DT = 200, PRE = 700, D1 = 650, D2 = 1150;       /* emission period, source leg, branch leg */
    var FX = 235, FY = 150, SY = 80;                    /* the fork, and the top of the source */
    var LX = 118, LY = 280, LW = 80, LH = 76, LD = 48;   /* the old key's cloud of profiles */
    var RX = 346, RY = 272, R = 98, EL = 0.38;          /* the new key's one profile */
    var LIFE = 32 * DT, FADE = 1600;
    var SHELL = [16, 28, 40, 52, 64], RAD = [0.3, 0.48, 0.66, 0.83, 1.0];

    var C = gather.cache;
    if (!C) {
      C = gather.cache = {};
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      C.v5 = hex('--violet-500', '#a66cf0'); C.v7 = hex('--violet-700', '#6b35c4');
      /* the first user message: a different colour every task */
      C.m5 = [hex('--amber-500', '#d96a06'), hex('--mint-500', '#0b93ab'),
              hex('--blue-500', '#2456dc'), hex('--coral-500', '#d9376e')];
      C.m7 = [hex('--amber-700', '#9a4906'), hex('--mint-700', '#0a6b7c'),
              hex('--blue-700', '#163a9a'), hex('--coral-700', '#a0183f')];
      C.white = hex('--raised', '#ffffff');
      C.hair = hex('--hair2', '#cfcbc1');
      /* the globe's slots: a Fibonacci sphere per shell, ordered bottom to top
         so each shell fills like a vessel */
      C.slot = []; C.base = [];
      var ga = Math.PI * (3 - Math.sqrt(5)), acc = 0;
      for (var s = 0; s < SHELL.length; s++) {
        var n = SHELL[s], pts = [];
        for (var i = 0; i < n; i++) {
          var y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), th = i * ga + s * 0.7;
          pts.push([rr * Math.cos(th), y, rr * Math.sin(th)]);
        }
        pts.sort(function (a, b) { return a[1] - b[1]; });
        C.slot.push(pts); C.base.push(acc); acc += n;
      }
      C.cap = acc;                                      /* 120 */
      C.keyMemo = {};
      C.dots = [];                                      /* reused draw list for the globe */
      for (i = 0; i < acc; i++) C.dots.push({ x: 0, y: 0, d: 0, s: 0, k: 0 });
      C.profs = [];
    }

    /* FNV-1a over the key, then the murmur3 finaliser: a real 32-bit hash.
       FNV alone left keys that differ only at the end in a straight line. */
    function fnv(str) {
      var h = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
      return h >>> 0;
    }
    function oldKey(k) {
      var m = C.keyMemo[k];
      if (m) return m;
      var h = fnv('model|system prompt|tool schema|first user message ' + k);
      m = C.keyMemo[k] = { x: (h & 1023) / 1023 * 2 - 1, y: ((h >>> 10) & 1023) / 1023 * 2 - 1,
                           z: ((h >>> 20) & 1023) / 1023 * 2 - 1, hue: fnv('first user message ' + k) % 4 };
      return m;
    }
    function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    function css(c, al) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al + ')'; }
    function swell(k) { return k <= 0 ? 0 : k * k * Math.exp(2 - 2 * k); }

    var T = REDUCED ? 52000 : t;
    var v5 = C.v5, v7 = C.v7;

    /* --- 3D ---------------------------------------------------------------- */
    var ce = Math.cos(EL), se = Math.sin(EL);
    /* the left cloud turns slowly about its vertical axis */
    var lth = REDUCED ? 0.4 : 0.4 + T * 0.00011;
    var lc = Math.cos(lth), ls = Math.sin(lth);
    function leftAt(m, o) {
      var x = m.x * LW, y = m.y * LH, z = m.z * LD;
      var X = x * lc + z * ls, Z = -x * ls + z * lc;
      o[0] = LX + X; o[1] = LY - (y * ce - Z * se) * 0.92; o[2] = y * se + Z * ce;
      return o;
    }
    function shellAng(s) { return (REDUCED ? 0 : T) * (0.00016 + 0.00005 * s) * (s % 2 ? -1 : 1) + s * 1.3; }
    function slotAt(s, j, o) {
      var p = C.slot[s][j], r = R * RAD[s], a = shellAng(s);
      var ca = Math.cos(a), sa = Math.sin(a);
      var x = (p[0] * ca + p[2] * sa) * r, z = (-p[0] * sa + p[2] * ca) * r, y = p[1] * r;
      o[0] = RX + x; o[1] = RY - (y * ce - z * se); o[2] = y * se + z * ce;
      return o;
    }
    function slotOf(k) {                               /* observation k: which shell, which slot */
      if (k < C.cap) {
        for (var s = SHELL.length - 1; s >= 0; s--) if (k >= C.base[s]) return [s, k - C.base[s]];
      }
      var last = SHELL.length - 1;
      return [last, (k - C.cap) % SHELL[last]];
    }

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* how many packets have been emitted, and landed */
    var kNow = Math.floor((T + PRE) / DT);             /* packets emitted so far: 0 .. kNow */
    var landed = Math.floor((T + PRE - D1 - D2) / DT) + 1;
    if (landed < 0) landed = 0;
    var q = [0, 0, 0], q2 = [0, 0, 0], k, i, s, j;

    /* --- the source: one stream of requests ---------------------------------- */
    var sIn = REDUCED ? 1 : ease(T / 700);
    var sg = g.createLinearGradient(0, SY, 0, FY);
    sg.addColorStop(0, css(v5, 0));
    sg.addColorStop(1, css(v5, 0.22 * sIn));
    g.strokeStyle = sg; g.lineWidth = 9;
    g.beginPath(); g.moveTo(FX, SY); g.lineTo(FX, FY); g.stroke();
    g.lineWidth = 1.2; g.strokeStyle = css(v5, 0.45 * sIn);
    g.beginPath(); g.moveTo(FX, SY + 18); g.lineTo(FX, FY); g.stroke();

    /* --- left: a fan of rays, one to every live profile ------------------------ */
    var profs = C.profs; profs.length = 0;
    var k0 = Math.max(0, landed - Math.ceil((LIFE + FADE) / DT) - 1);
    /* forget the keys of profiles that have faded, so the memo stays small */
    if (k0 > (C.pruned || 0)) { for (var z = C.pruned || 0; z < k0; z++) delete C.keyMemo[z]; C.pruned = k0; }
    for (k = k0; k < landed; k++) {
      var age = T + PRE - (k * DT + D1 + D2);
      if (age < 0) continue;
      var life = age < LIFE ? 1 : 1 - ease((age - LIFE) / FADE);
      if (life <= 0.004) continue;
      var m = oldKey(k);
      leftAt(m, q);
      var P = (C.pool || (C.pool = []))[profs.length] || (C.pool[profs.length] = {});
      P.k = k; P.x = q[0]; P.y = q[1]; P.d = q[2]; P.m = m; P.age = age; P.life = life;
      profs.push(P);
    }
    /* settled rays go out in one stroke per colour; young and fading ones alone */
    g.lineWidth = 1.1;
    for (var hh = 0; hh < 4; hh++) {
      g.strokeStyle = css(C.m5[hh], 0.22); g.beginPath();
      var any = false;
      for (i = 0; i < profs.length; i++) {
        var P1 = profs[i];
        if (P1.m.hue !== hh || P1.life < 1 || P1.age < 400) continue;
        g.moveTo(FX, FY); g.quadraticCurveTo(FX - 30, FY + 40, P1.x, P1.y); any = true;
      }
      if (any) g.stroke();
    }
    for (i = 0; i < profs.length; i++) {
      var P2 = profs[i];
      if (P2.life >= 1 && P2.age >= 400) continue;
      g.strokeStyle = css(C.m5[P2.m.hue], 0.22 * P2.life * ease(P2.age / 400));
      g.beginPath(); g.moveTo(FX, FY); g.quadraticCurveTo(FX - 30, FY + 40, P2.x, P2.y); g.stroke();
    }

    /* --- right: the rays of the last arrivals, which all land together ------- */
    var rb = Math.max(0, landed - 18);
    for (k = rb; k < landed; k++) {
      var so = slotOf(k); slotAt(so[0], so[1], q);
      var fade = 1 - (landed - k) / 19;
      g.strokeStyle = css(v5, 0.11 * fade); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(FX, FY);
      g.quadraticCurveTo(FX + 34, FY + 36, q[0], q[1]); g.stroke();
    }

    /* --- the one profile: a globe of shells ----------------------------------- */
    var fill = Math.min(landed, C.cap) / C.cap;
    if (landed > 0) {
      var br = REDUCED ? 1 : 0.92 + 0.08 * Math.sin(TAU * T / 5200);
      var gr = R * (0.6 + 0.5 * Math.sqrt(fill));
      var gg = g.createRadialGradient(RX, RY, 0, RX, RY, gr);
      gg.addColorStop(0, css(v5, (0.1 + 0.2 * fill) * br));
      gg.addColorStop(0.6, css(v5, (0.04 + 0.08 * fill) * br));
      gg.addColorStop(1, css(v5, 0));
      g.fillStyle = gg;
      g.beginPath(); g.arc(RX, RY, gr, 0, TAU); g.fill();
    }
    /* The glass of the one profile: its silhouette grows out to each new shell
       as that shell begins, with a tilted equator so it reads as a sphere. */
    var rSil = 0;
    if (landed > 0) {
      rSil = R * RAD[0];
      for (s = 1; s < SHELL.length; s++) {
        var tb = C.base[s] * DT + D1 + D2 - PRE;
        if (REDUCED ? landed > C.base[s] : T > tb) rSil += R * (RAD[s] - RAD[s - 1]) * (REDUCED ? 1 : ease((T - tb) / 700));
      }
      var sIn2 = REDUCED ? 1 : ease((T + PRE - D1 - D2) / 500);
      g.strokeStyle = css(v5, 0.3 * sIn2); g.lineWidth = 1.2;
      g.beginPath(); g.arc(RX, RY, rSil, 0, TAU); g.stroke();
      g.strokeStyle = css(v5, 0.16 * sIn2); g.lineWidth = 1;
      g.beginPath(); g.ellipse(RX, RY, rSil, rSil * se, 0, 0, TAU); g.stroke();
    }
    /* the shell being filled shows its waterline, how far up it has come */
    for (s = 0; s < SHELL.length; s++) {
      var start = C.base[s];
      if (landed <= start) continue;
      var sk = Math.min(1, (landed - start) / SHELL[s]);
      var rs = R * RAD[s];
      if (sk < 1) {
        var wl = -1 + 2 * sk, wr = Math.sqrt(Math.max(0, 1 - wl * wl)) * rs;
        g.strokeStyle = css(v5, 0.28); g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(RX, RY - wl * rs * ce, wr, wr * se, 0, 0, TAU); g.stroke();
      }
    }
    /* a shell closes: the hero ring, at the moment its last dot lands */
    for (s = 0; s < SHELL.length + 12; s++) {
      var closeK = s < SHELL.length ? C.base[s] + SHELL[s] - 1 : C.cap - 1 + (s - SHELL.length + 1) * SHELL[SHELL.length - 1];
      var tc = closeK * DT + D1 + D2 - PRE;
      var ck = (T - tc) / 1500;
      if (ck <= 0 || ck >= 1 || REDUCED) continue;
      var rr2 = R * RAD[Math.min(s, SHELL.length - 1)];
      g.strokeStyle = css(v7, 0.5 * (1 - ck) * (1 - ck) * ease(ck / 0.12)); g.lineWidth = 2.4;
      g.beginPath(); g.arc(RX, RY, rr2 + 4 + 14 * (1 - (1 - ck) * (1 - ck)), 0, TAU); g.stroke();
      g.strokeStyle = css(v5, 0.35 * (1 - ck) * ease(ck / 0.12)); g.lineWidth = 6;
      g.beginPath(); g.arc(RX, RY, rr2, 0, TAU); g.stroke();
    }
    /* the dots, far to near: every one is an observation, all in one profile */
    var dots = C.dots, nd = 0;
    var shown = Math.min(landed, C.cap);
    for (k = 0; k < shown; k++) {
      var so2 = slotOf(k); slotAt(so2[0], so2[1], q);
      var D = dots[nd++]; D.x = q[0]; D.y = q[1]; D.d = q[2]; D.s = so2[0]; D.k = k;
    }
    var sorted = C.sorted || (C.sorted = []);
    sorted.length = nd;
    for (i = 0; i < nd; i++) sorted[i] = dots[i];
    sorted.sort(function (a, b) { return a.d - b.d; });
    var lastK = landed - 1;
    /* Batched by depth: eight bands, back to front, one fill each, so two
       hundred observations cost eight fills rather than two hundred. */
    var BINS = 8, bin = -1;
    for (i = 0; i < sorted.length; i++) {
      var dd = sorted[i];
      var dn = (dd.d / R + 1) / 2;                            /* 0 at the back, 1 at the front */
      /* the newest arrival in its slot swells in and settles */
      var kk = dd.k;
      if (landed > C.cap) {
        var so3 = slotOf(lastK);
        if (dd.s === so3[0] && dd.k - C.base[dd.s] === so3[1]) kk = lastK;
      }
      var since = T + PRE - (kk * DT + D1 + D2);
      var sw = REDUCED ? 0 : swell(since / 220) * 0.9;
      var rad = (1.6 + 2.6 * dn) * (REDUCED ? 1 : ease(since / 260) * 0.7 + 0.3) + 2.4 * sw;
      var b2 = Math.min(BINS - 1, Math.floor(dn * BINS));
      if (b2 !== bin) {
        if (bin >= 0) g.fill();
        bin = b2;
        var dc = (b2 + 0.5) / BINS;
        g.fillStyle = css(mix(v5, v7, 0.15 + 0.4 * dc), 0.24 + 0.74 * dc);
        g.beginPath();
      }
      g.moveTo(dd.x + rad, dd.y); g.arc(dd.x, dd.y, rad, 0, TAU);
    }
    if (bin >= 0) g.fill();
    /* a highlight on the glass, upper left, over everything inside it */
    if (rSil > 0) {
      var hx = RX - rSil * 0.38, hy = RY - rSil * 0.42;
      var hl = g.createRadialGradient(hx, hy, 0, hx, hy, rSil * 0.6);
      hl.addColorStop(0, css(C.white, 0.34));
      hl.addColorStop(1, css(C.white, 0));
      g.fillStyle = hl;
      g.beginPath(); g.arc(hx, hy, rSil * 0.6, 0, TAU); g.fill();
    }

    /* --- the old key's profiles: one dot each, far to near --------------------- */
    profs.sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < profs.length; i++) {
      var Pp = profs[i], h5 = C.m5[Pp.m.hue], h7 = C.m7[Pp.m.hue];
      var dn2 = (Pp.d / (LH * se + LD * ce) + 1) / 2;
      var born = REDUCED ? 1 : ease(Pp.age / 500);
      var pr = (7.5 + 3 * dn2) * born * (0.7 + 0.3 * Pp.life);
      var al = Pp.life * (0.55 + 0.45 * dn2);
      /* a small glass sphere: tinted body, rim, and a highlight */
      g.fillStyle = css(h5, 0.13 * al);
      g.beginPath(); g.arc(Pp.x, Pp.y, pr, 0, TAU); g.fill();
      g.strokeStyle = css(mix(h5, h7, 0.4), 0.75 * al); g.lineWidth = 1.2;
      g.stroke();
      g.fillStyle = css(C.white, 0.7 * al);
      g.beginPath(); g.arc(Pp.x - pr * 0.36, Pp.y - pr * 0.4, pr * 0.28, 0, TAU); g.fill();
      g.fillStyle = css(h5, al);
      g.beginPath(); g.arc(Pp.x, Pp.y + pr * 0.25, 2.6 * born, 0, TAU); g.fill();
      /* a profile is created: one ripple, and it never rings again */
      if (!REDUCED && Pp.age < 900) {
        var rk = Pp.age / 900;
        g.strokeStyle = css(h5, 0.45 * (1 - rk) * (1 - rk) * ease(rk / 0.12)); g.lineWidth = 1.4;
        g.beginPath(); g.arc(Pp.x, Pp.y, pr + 4 + 12 * (1 - (1 - rk) * (1 - rk)), 0, TAU); g.stroke();
      }
    }

    /* --- packets in flight ----------------------------------------------------- */
    var kFirst = Math.max(0, Math.floor((T + PRE - D1 - D2) / DT));
    for (k = kFirst; k <= kNow; k++) {
      var a0 = T + PRE - k * DT;                        /* this packet's age */
      if (a0 < 0 || a0 > D1 + D2) continue;
      var mk = oldKey(k);
      var sat = TAU * a0 / 1100 + k * 2.1;
      if (a0 < D1) {
        /* down the source: the scaffold, with its message circling it */
        var u = a0 / D1, py = SY + (FY - SY) * u, al0 = ease(a0 / 220);
        packet(FX, py, v5, v7, C.m5[mk.hue], 1, al0, sat, FX, Math.max(SY - 6, py - 26));
      } else {
        var b = (a0 - D1) / D2, e2 = 1 - Math.pow(1 - b, 2.2);
        var land = 1 - ease((b - 0.86) / 0.14);
        /* left: keyed on everything, so it takes the message's colour */
        leftAt(mk, q);
        bezAt(FX, FY, FX - 30, FY + 40, q[0], q[1], e2, q2);
        var tl = [0, 0];
        bezAt(FX, FY, FX - 30, FY + 40, q[0], q[1], Math.max(0, e2 - 0.2), tl);
        var cl = mix(v5, C.m5[mk.hue], ease(b / 0.35)), cl7 = mix(v7, C.m7[mk.hue], ease(b / 0.35));
        packet(q2[0], q2[1], cl, cl7, C.m5[mk.hue], 1, land, sat, tl[0], tl[1]);
        /* right: keyed on the scaffold, so the message drops out of the key */
        var so4 = slotOf(k); slotAt(so4[0], so4[1], q);
        bezAt(FX, FY, FX + 34, FY + 36, q[0], q[1], e2, q2);
        bezAt(FX, FY, FX + 34, FY + 36, q[0], q[1], Math.max(0, e2 - 0.2), tl);
        packet(q2[0], q2[1], v5, v7, C.m5[mk.hue], 1 - ease(b / 0.45), land, sat, tl[0], tl[1]);
      }
    }
    /* the fork: where every request is keyed both ways */
    g.fillStyle = css(v5, 0.2 * sIn);
    g.beginPath(); g.arc(FX, FY, 9, 0, TAU); g.fill();
    g.fillStyle = css(v7, 0.9 * sIn);
    g.beginPath(); g.arc(FX, FY, 3.2, 0, TAU); g.fill();

    function bezAt(x0, y0, cx, cy, x1, y1, u, o) {
      var w = 1 - u;
      o[0] = w * w * x0 + 2 * w * u * cx + u * u * x1;
      o[1] = w * w * y0 + 2 * w * u * cy + u * u * y1;
      return o;
    }
    /* one request: a comet tail, a core (the scaffold) and a satellite (the
       first user message); msgA is how much of the message is still in the key */
    function packet(x, y, c5, c7, cm, msgA, al, ang, tx, ty) {
      if (al <= 0.004) return;
      var tg = g.createLinearGradient(tx, ty, x, y);
      tg.addColorStop(0, css(c5, 0));
      tg.addColorStop(1, css(c5, 0.75 * al));
      g.strokeStyle = tg; g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
      g.fillStyle = css(c5, 0.2 * al);
      g.beginPath(); g.arc(x, y, 8.5, 0, TAU); g.fill();
      g.fillStyle = css(mix(c5, c7, 0.35), al);
      g.beginPath(); g.arc(x, y, 3.8, 0, TAU); g.fill();
      if (msgA > 0.02) {
        g.fillStyle = css(cm, al * msgA);
        g.beginPath(); g.arc(x + Math.cos(ang) * 6.5, y + Math.sin(ang) * 6.5 * 0.8, 2.3, 0, TAU); g.fill();
      }
    }
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
  /* certify — separatrix                                                */
  /* ==================================================================== */
  function certify(g, vb, t, st) {
    /* A top-k, an argmin or a threshold is a decision about which side of a
       boundary an input falls on, and a phase portrait is the cleanest honest
       picture of that. The flow is the damped Duffing oscillator,
       x' = y, y' = x - x^3 - 0.3 y: two wells, two attractors, one saddle
       between them. Every starting point flows to one attractor or the other,
       and the curve that divides the two basins is the stable manifold of the
       saddle, which is what a separatrix is. It is computed here by running
       the flow backwards out of the saddle along its stable direction.

       A start is only known to within rounding, drawn as a disc of radius
       EPS. If the disc lies wholly in one basin, every value rounding could
       have produced ends at the same attractor: the answer was decided by the
       data, and the particle is certified as it settles, ringing its
       attractor. If the disc touches the separatrix, which answer comes back
       is decided by where the rounding fell, and nothing is returned. Those
       are drawn as the disc itself, carried by the flow: it slides along the
       separatrix into the saddle and is torn along the saddle's unstable
       direction into both basins at once, which is the literal picture of an
       ordering that is the arithmetic and not the data. They never settle.
       The coral band is exactly the set of starts within EPS of the curve,
       so a particle is refused if and only if it is born inside the band.

       Once a cycle a pulse of light runs down both arms of the separatrix into
       the saddle, the way the flow itself runs along it, and parts along the
       unstable manifold toward both attractors.

       Trajectories are integrated once (RK4) and cached on the function; each
       frame only interpolates them. */
    var TAU = Math.PI * 2;
    var D = 0.3, EMAX = 0.95, EPS = 0.058;       /* damping, rim energy, rounding */
    var S = 118, CX = 235, CY = 246;             /* phase units to viewBox units */
    var UNIT = 300, DT = 0.1, NS = 261;          /* ms per time unit, sample step, samples */
    var NP = 128, P = 211, LIFE = 8200, PULSE = 9000;

    /* one RK4 step of the flow, in place on s = [x, y], allocating nothing */
    function rk(s, h) {
      var x = s[0], y = s[1];
      var ax = y, ay = x - x * x * x - D * y;
      var x2 = x + h / 2 * ax, y2 = y + h / 2 * ay, bx = y2, by = x2 - x2 * x2 * x2 - D * y2;
      var x3 = x + h / 2 * bx, y3 = y + h / 2 * by, cx = y3, cy = x3 - x3 * x3 * x3 - D * y3;
      var x4 = x + h * cx, y4 = y + h * cy, ex = y4, ey = x4 - x4 * x4 * x4 - D * y4;
      s[0] = x + h / 6 * (ax + 2 * bx + 2 * cx + ex); s[1] = y + h / 6 * (ay + 2 * by + 2 * cy + ey);
    }
    function energy(x, y) { return y * y / 2 - x * x / 2 + x * x * x * x / 4; }

    var M = certify.m;
    if (!M) {
      M = certify.m = {};
      var seed = 11, i, j, k, x, y, q = [0, 0];
      var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      /* a trajectory sampled every DT time units, as flat x,y pairs */
      var traj = function (x0, y0) {
        var o = new Float32Array(NS * 2), r = [x0, y0];
        for (var n = 0; n < NS; n++) {
          o[2 * n] = r[0]; o[2 * n + 1] = r[1];
          for (var m = 0; m < 3; m++) rk(r, DT / 3);
        }
        return o;
      };
      /* the separatrix: backwards out of the saddle along the stable direction,
         both arms, until the rim; kept every 0.02 of arc */
      var ls = (-D - Math.sqrt(D * D + 4)) / 2, lu = (-D + Math.sqrt(D * D + 4)) / 2;
      M.sep = [];
      for (var sg = -1; sg <= 1; sg += 2) {
        x = sg * 1e-5; y = sg * 1e-5 * ls;
        var arm = [[0, 0], [x, y]], acc = 0;
        while (energy(x, y) < EMAX) {
          q[0] = x; q[1] = y; rk(q, -0.002); acc += Math.hypot(q[0] - x, q[1] - y); x = q[0]; y = q[1];
          if (acc > 0.02) { arm.push([x, y]); acc = 0; }
        }
        arm.push([x, y]);
        M.sep.push(arm);
      }
      /* the unstable manifold, the saddle's two exits, into each attractor */
      M.uns = [];
      for (sg = -1; sg <= 1; sg += 2) {
        x = sg * 1e-4; y = sg * 1e-4 * lu;
        var ua = [[0, 0]];
        q[0] = x; q[1] = y;
        for (j = 0; j < 1400; j++) { rk(q, 0.02); if (j % 3 === 0) ua.push([q[0], q[1]]); }
        M.uns.push(ua);
      }
      var dist = function (px, py) {           /* to the separatrix, and the nearest point on it */
        var best = 81, bx0 = 0, by0 = 0;
        for (var a = 0; a < 2; a++) {
          var A = M.sep[a];
          for (var n = 0; n + 1 < A.length; n++) {
            var ax = A[n][0], ay = A[n][1], bx = A[n + 1][0] - ax, by = A[n + 1][1] - ay;
            var u = ((px - ax) * bx + (py - ay) * by) / (bx * bx + by * by || 1);
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            var dx = px - ax - u * bx, dy = py - ay - u * by, dd = dx * dx + dy * dy;
            if (dd < best) { best = dd; bx0 = ax + u * bx; by0 = ay + u * by; }
          }
        }
        return [Math.sqrt(best), [bx0, by0]];
      };
      var side = function (tr) { return tr[2 * (NS - 1)] > 0 ? 1 : 0; };
      /* the pool of starts, uniform inside the rim */
      M.pool = [];
      while (M.pool.length < P) {
        x = (rnd() * 2 - 1) * 1.8; y = (rnd() * 2 - 1) * 1.56;
        if (energy(x, y) > EMAX - 0.03) continue;
        var dv = dist(x, y), it = { x: x, y: y, tr: traj(x, y), bad: dv[0] < EPS };
        it.side = side(it.tr);
        if (it.bad) {
          /* the rounding disc: samples round the circle, packed toward the two
             places it crosses the separatrix so the tear is drawn smoothly */
          var th0 = Math.atan2(dv[1][1] - y, dv[1][0] - x), cross = [];
          var al = Math.acos(Math.max(-1, Math.min(1, dv[0] / EPS)));
          cross.push(th0 - al, th0 + al);
          var angs = [];
          for (j = 0; j < 18; j++) angs.push(j / 18 * TAU);
          for (j = 0; j < 2; j++) for (k = 1; k <= 8; k++) {
            var dd2 = 0.9 * Math.pow(0.45, k);
            angs.push(cross[j] - dd2, cross[j] + dd2);
          }
          it.angs = angs.map(function (a) { return ((a % TAU) + TAU) % TAU; }).sort(function (a, b) { return a - b; });
          it.disc = null;                  /* integrated the first time it is shown */
          /* when the disc's centre reaches the saddle, where the tear starts */
          it.sad = NS - 1;
          for (j = 0; j < NS; j++) if (Math.hypot(it.tr[2 * j], it.tr[2 * j + 1]) < 0.3) { it.sad = j; break; }
        } else {
          /* arrival: the first sample inside a small ring round its attractor */
          it.arr = NS - 1;
          for (j = 0; j < NS; j++) {
            if (Math.hypot(it.tr[2 * j] - (it.side ? 1 : -1), it.tr[2 * j + 1]) < 0.075) { it.arr = j; break; }
          }
        }
        M.pool.push(it);
      }
      /* streamlines for the background, each coloured by where it ends */
      M.stream = [[], []];
      for (i = 0; i < 12; i++) for (j = 0; j < 9; j++) {
        x = -1.75 + 3.5 * (i + 0.5 + 0.3 * (rnd() - 0.5)) / 12;
        y = -1.5 + 3.0 * (j + 0.5 + 0.3 * (rnd() - 0.5)) / 9;
        if (energy(x, y) > EMAX - 0.02) continue;
        var tr2 = traj(x, y), line = [];
        for (k = 0; k < 140; k++) line.push(tr2[2 * k], tr2[2 * k + 1]);
        M.stream[side(tr2)].push(line);
      }
      M.traj = traj;
      M.slot = [];
      for (i = 0; i < NP; i++) {
        var h1 = rnd(), h2 = rnd();
        M.slot.push({ off: i % 2 ? 150 + h1 * 1100 : 1300 + h1 * (LIFE - 1300), life: LIFE - 700 + 1400 * h2 });
      }
      M.bas = [token('--mint-500', '#0b93ab'), token('--blue-500', '#2456dc')];
      /* the two basins as a soft tint: each cell of a coarse grid is run
         forward until its energy drops below zero, after which it can no
         longer cross from one well to the other, and takes that well's
         colour. Upscaled with smoothing, so the basins glow rather than tile */
      var GW = 94, GH = 78, img = null, cv = document.createElement('canvas');
      cv.width = GW; cv.height = GH;
      var cx2 = cv.getContext('2d'), rgb = M.bas.map(function (h) {
        h = h.trim().replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var nn = parseInt(h, 16); return [(nn >> 16) & 255, (nn >> 8) & 255, nn & 255];
      });
      img = cx2.createImageData(GW, GH);
      for (j = 0; j < GH; j++) for (i = 0; i < GW; i++) {
        x = -2.1 + 4.2 * (i + 0.5) / GW; y = 1.75 - 3.5 * (j + 0.5) / GH;
        var e0 = energy(x, y);
        if (e0 > EMAX) continue;
        q[0] = x; q[1] = y;
        for (k = 0; k < 3000 && energy(q[0], q[1]) >= 0; k++) rk(q, 0.08);
        x = q[0];
        var bb = x > 0 ? 1 : 0, o4 = 4 * (j * GW + i);
        img.data[o4] = rgb[bb][0]; img.data[o4 + 1] = rgb[bb][1]; img.data[o4 + 2] = rgb[bb][2];
        img.data[o4 + 3] = Math.round(34 * ease((EMAX - e0) / 0.35));
      }
      cx2.putImageData(img, 0, 0);
      M.tint = cv;
      M.bas7 = [token('--mint-700', '#0a6b7c'), token('--blue-700', '#163a9a')];
      M.coral = token('--coral-500', '#d9376e'); M.coral7 = token('--coral-700', '#a0183f');
    }

    var T = REDUCED ? 21400 : t;
    function X(px) { return CX + S * px; }
    function Y(py) { return CY - S * py; }
    /* a trajectory's position at a given age, linear between samples */
    function at(tr, age) {
      var u = Math.max(0, age / UNIT / DT), n = Math.min(NS - 2, Math.floor(u)), f = Math.min(1, u - n);
      return [X(tr[2 * n] + (tr[2 * n + 2] - tr[2 * n]) * f), Y(tr[2 * n + 1] + (tr[2 * n + 3] - tr[2 * n + 1]) * f)];
    }

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';
    var build = REDUCED ? 1 : ease(T / 1400);
    var i, j, k, p;

    /* collect this frame's live particles first, so the attractors can glow
       with what is arriving in them */
    var live = [], glow = [0, 0];
    for (i = 0; i < NP; i++) {
      var sl = M.slot[i], rel = T - sl.off;
      if (rel < 0) continue;
      var n = Math.floor(rel / sl.life), age = rel - n * sl.life;
      var it = M.pool[(i * 7 + n * 53) % P];
      var env = ease(age / 350);
      if (it.bad) env *= 1 - ease((age - it.sad * DT * UNIT - 700) / 1100);
      else {
        var ta = it.arr * DT * UNIT;
        env *= 1 - ease((age - ta) / 650);
        glow[it.side] += Math.exp(-Math.pow((age - ta) / 500, 2));
      }
      if (env > 0.004) live.push([it, age, env]);
    }

    g.globalAlpha = 0.25 + 0.75 * build;
    g.drawImage(M.tint, X(-2.1), Y(1.75), 4.2 * S, 3.5 * S);
    g.globalAlpha = 1;

    /* the attractors: a halo that swells as certified answers settle in */
    for (k = 0; k < 2; k++) {
      var fx = X(k ? 1 : -1), fy = Y(0), gl = Math.min(1, 0.35 + 0.22 * glow[k]) * build;
      var hg = g.createRadialGradient(fx, fy, 0, fx, fy, 62);
      hg.addColorStop(0, rgba(M.bas[k], 0.34 * gl));
      hg.addColorStop(0.4, rgba(M.bas[k], 0.12 * gl));
      hg.addColorStop(1, rgba(M.bas[k], 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(fx, fy, 62, 0, TAU); g.fill();
    }

    /* the flow: streamlines in the colour of the basin they end in, drawn in
       from their starts as the figure arrives */
    for (k = 0; k < 2; k++) {
      g.strokeStyle = rgba(M.bas[k], 0.16 * (0.4 + 0.6 * build));
      g.lineWidth = 1;
      g.beginPath();
      for (j = 0; j < M.stream[k].length; j++) {
        var L = M.stream[k][j];
        g.moveTo(X(L[0]), Y(L[1]));
        for (p = 1; p < 140; p++) g.lineTo(X(L[2 * p]), Y(L[2 * p + 1]));
      }
      g.stroke();
    }

    /* the band of starts within rounding of the separatrix, and the curve */
    function sepPath(frac) {
      g.beginPath();
      for (var a = 0; a < 2; a++) {
        var A = M.sep[a], m = Math.max(2, Math.floor(A.length * frac));
        g.moveTo(X(A[0][0]), Y(A[0][1]));
        for (var q = 1; q < m; q++) g.lineTo(X(A[q][0]), Y(A[q][1]));
      }
    }
    sepPath(build);
    g.strokeStyle = rgba(M.coral, 0.13); g.lineWidth = 2 * EPS * S; g.stroke();
    g.strokeStyle = rgba(M.coral7, 0.85); g.lineWidth = 1.7; g.stroke();

    /* once a cycle: light runs down both arms into the saddle, then out along
       the unstable manifold to both attractors */
    var pc = REDUCED ? -1 : ((T - 2600) % PULSE + PULSE) % PULSE / 1000;
    if (T > 2600 && pc < 3.2) {
      for (var a2 = 0; a2 < 2; a2++) {
        var A2 = M.sep[a2], U2 = M.uns[a2], seg, q0, q1, w, cl;
        if (pc < 1.9) {                      /* inward along the separatrix */
          var s1 = 1 - ease(pc / 1.9);
          seg = A2; q1 = Math.floor(s1 * (A2.length - 1)); q0 = Math.min(A2.length - 1, q1 + 40);
          w = Math.sin(Math.PI * Math.min(1, pc / 1.9)) * 0.8 + 0.2; cl = M.coral;
        } else {                             /* out along the unstable manifold */
          var s2 = ease((pc - 1.9) / 1.3);
          seg = U2; q1 = Math.floor(s2 * 0.55 * (U2.length - 1)); q0 = Math.max(0, q1 - 30);
          w = 1 - s2; cl = M.coral;
        }
        var lo = Math.min(q0, q1), hi = Math.max(q0, q1);
        if (hi - lo < 2) continue;
        var gx = g.createLinearGradient(X(seg[q0][0]), Y(seg[q0][1]), X(seg[q1][0]), Y(seg[q1][1]));
        gx.addColorStop(0, rgba(cl, 0));
        gx.addColorStop(1, rgba(cl, 0.9 * w));
        g.strokeStyle = gx; g.lineWidth = 5;
        g.shadowColor = rgba(cl, 0.8 * w); g.shadowBlur = 10;
        g.beginPath(); g.moveTo(X(seg[lo][0]), Y(seg[lo][1]));
        for (p = lo + 1; p <= hi; p++) g.lineTo(X(seg[p][0]), Y(seg[p][1]));
        g.stroke();
        g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)';
      }
    }

    /* particles */
    var held = null;
    for (i = 0; i < live.length; i++) {
      var itm = live[i][0], ag = live[i][1], ev = live[i][2];
      if (itm.bad) {
        /* refused: the rounding disc itself, carried and torn by the flow */
        if (!itm.disc) itm.disc = itm.angs.map(function (a) {
          return M.traj(itm.x + EPS * Math.cos(a), itm.y + EPS * Math.sin(a));
        });
        g.beginPath();
        for (j = 0; j < itm.disc.length; j++) {
          var pt = at(itm.disc[j], ag);
          if (j === 0) g.moveTo(pt[0], pt[1]); else g.lineTo(pt[0], pt[1]);
        }
        g.closePath();
        var tsd = ag - itm.sad * DT * UNIT, body = 1 - ease(tsd / 350);
        if (body > 0.01) { g.fillStyle = rgba(M.coral, 0.2 * body * ev); g.fill(); }
        if (tsd <= 0) g.strokeStyle = rgba(M.coral7, 0.9 * ev);
        else {
          /* torn: bright where it is held at the saddle, gone where it would
             have been an answer */
          if (!held) {
            held = g.createRadialGradient(X(0), Y(0), 0, X(0), Y(0), 92);
            held.addColorStop(0, rgba(M.coral7, 0.9));
            held.addColorStop(0.5, rgba(M.coral7, 0.45));
            held.addColorStop(1, rgba(M.coral7, 0));
          }
          g.globalAlpha = ev; g.strokeStyle = held;
        }
        g.lineWidth = 1.4; g.stroke(); g.globalAlpha = 1;
        /* where it was born, a fading ring the size of its rounding */
        var r0 = 1 - ease(ag / 1500);
        if (r0 > 0.01) {
          g.strokeStyle = rgba(M.coral7, 0.7 * r0 * ev); g.lineWidth = 1.2;
          g.beginPath(); g.arc(X(itm.x), Y(itm.y), EPS * S + 5 * (1 - r0), 0, TAU); g.stroke();
        }
        continue;
      }
      /* certified: a bead with a tail, settling into its attractor */
      var c5 = M.bas[itm.side], head = at(itm.tr, ag), tail = at(itm.tr, Math.max(0, ag - 520));
      var tg = g.createLinearGradient(tail[0], tail[1], head[0], head[1]);
      tg.addColorStop(0, rgba(c5, 0));
      tg.addColorStop(1, rgba(c5, 0.75 * ev));
      g.strokeStyle = tg; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(tail[0], tail[1]);
      for (p = 1; p <= 6; p++) { var pp = at(itm.tr, Math.max(0, ag - 520 + 520 * p / 6)); g.lineTo(pp[0], pp[1]); }
      g.stroke();
      g.fillStyle = rgba(c5, ev);
      g.beginPath(); g.arc(head[0], head[1], 2.6, 0, TAU); g.fill();
      /* certified: it rings once as it settles */
      var ra = (ag - itm.arr * DT * UNIT) / 800;
      if (ra > 0 && ra < 1) {
        g.strokeStyle = rgba(M.bas7[itm.side], 0.55 * (1 - ra) * (1 - ra));
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(head[0], head[1], 4 + 12 * ease(ra), 0, TAU); g.stroke();
      }
    }

    /* the three fixed points: two attractors and the saddle between them */
    for (k = 0; k < 2; k++) {
      g.fillStyle = rgba(M.bas7[k], build);
      g.beginPath(); g.arc(X(k ? 1 : -1), Y(0), 4.2, 0, TAU); g.fill();
    }
    g.strokeStyle = rgba(M.coral7, build); g.lineWidth = 2;
    g.fillStyle = rgba(token('--raised', '#ffffff'), build);
    g.beginPath(); g.arc(X(0), Y(0), 4.2, 0, TAU); g.fill(); g.stroke();
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

  /* ==================================================================== */
  /* settle — openxla-46539                                              */
  /* ==================================================================== */
  function settle(g, vb, t, st) {
    /* One XLA fusion, drawn twice: the compiler before the change on the
       left, after it on the right. Its reduction roots lie on the floor in
       four groups (the soft regions, each held together by the union-find
       merges that joined it). That partition is the same in both panels and
       in every run. What was not fixed was the ORDER of the groups:
       GroupDisjointReductions iterated a hash set to choose which value
       survived each union-find merge, so the order of grouped_roots, and the
       group ids with it, followed hash iteration order.

       A run is a thread laid through the roots in the order its groups came
       out, ending at the code that order emits. Each root is a pillar, and
       run k is laid at height k, so ten runs of the same program build a
       stack. Colour is the code a run emitted: blue for code X, coral for
       code Y. On the left the ten runs follow the old figure's sequence, and
       the stack is two orders interleaved. On the right the order is fixed.

       Where a run follows the same order as the run below it, the band
       between the two threads is filled. Two different orders span nothing,
       so the left stays loose threads with one patch where two runs happened
       to agree. On the right every run agrees with the last, and the bands
       join into one continuous folded curtain: sameness, drawn as a solid.
       Each output pillar keeps a bead for every run that landed on it, so
       the left shows two gapped columns and the right one full column.

       Only height separates the layers, so each route is projected once a
       frame and every layer is that polyline lifted by its height. The view
       sways a little so the stack reads as depth.

       Timing: the floor assembles over 1.4 s, then a run leaves every
       1,250 ms and takes 1,000 ms to cross. After the tenth, a gleam runs
       through all ten layers at once along the finished curtain and climbs
       the column of ten at code X, the stack fades, and the ten runs begin
       again: 16.2 s a cycle. Measured in the preview harness: worst frame
       151 fills and strokes, and no painted pixel darker than #3a3a3a. */
    var TAU = Math.PI * 2;
    var RUNS = 10, P = 1250, TR = 1000, T0 = 1400, HERO = 2600, FADE = 1100;
    var CYC = RUNS * P + HERO + FADE;
    var SEQ = [0, 1, 0, 0, 1, 0, 1, 0, 1, 0];   /* before: code X (0) or code Y (1) */
    var PX = [125, 375], CY = 226, S = 1.12;     /* panel centres, floor centre height, scale */
    var Z0 = 7, DZ = 8.5, EL = 0.86, TAIL = 46, STEP = 3;
    var PH0 = -0.22, SW = 0.05;

    var C = settle.cache;
    if (!C) {
      C = settle.cache = {};
      /* four groups on the floor: centre, root offsets (3, 2, 3, 2 roots) */
      var G4 = [[-54, -46, [[-22, 8], [0, -12], [22, 8]]],
                [54, -46, [[-16, 2], [16, 2]]],
                [-54, 42, [[-22, 8], [0, -12], [22, 8]]],
                [54, 42, [[-16, 2], [16, 2]]]];
      C.grp = G4.map(function (q) {
        return { x: q[0], y: q[1],
                 r: q[2].map(function (o) { return [q[0] + o[0], q[1] + o[1]]; }) };
      });
      C.E = [0, -112];
      C.out = [[3, 112], [-69, 108]];             /* code X, code Y */
      var ORD = [[0, 1, 2, 3], [1, 3, 0, 2]];     /* group order of each route */

      /* centripetal Catmull-Rom through the knots, resampled to equal steps */
      var path = function (pts) {
        var n = pts.length, ext = [[2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]]
          .concat(pts, [[2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]]);
        var sx = [], sy = [], kn = [0];
        var tj = function (a, b, tt) { return tt + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1e-6; };
        for (var s = 0; s < n - 1; s++) {
          var p0 = ext[s], p1 = ext[s + 1], p2 = ext[s + 2], p3 = ext[s + 3];
          var t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
          for (var m = 0; m < 24; m++) {
            var tt = t1 + (t2 - t1) * m / 24, xy = [0, 0];
            for (var c = 0; c < 2; c++) {
              var a1 = ((t1 - tt) * p0[c] + (tt - t0) * p1[c]) / (t1 - t0);
              var a2 = ((t2 - tt) * p1[c] + (tt - t1) * p2[c]) / (t2 - t1);
              var a3 = ((t3 - tt) * p2[c] + (tt - t2) * p3[c]) / (t3 - t2);
              var b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
              var b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
              xy[c] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
            }
            sx.push(xy[0]); sy.push(xy[1]);
          }
          kn.push(sx.length);
        }
        sx.push(pts[n - 1][0]); sy.push(pts[n - 1][1]);
        var cum = [0];
        for (var i = 1; i < sx.length; i++) cum.push(cum[i - 1] + Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1]));
        var len = cum[cum.length - 1], N = Math.ceil(len / STEP) + 1;
        var R = { len: len, n: N, x: new Float32Array(N), y: new Float32Array(N), knot: [],
                  px: new Float32Array(N), py: new Float32Array(N) };
        for (i = 0; i < kn.length; i++) R.knot.push(cum[Math.min(kn[i], cum.length - 1)]);
        var j = 0;
        for (i = 0; i < N; i++) {
          var d = len * i / (N - 1);
          while (j < cum.length - 2 && cum[j + 1] < d) j++;
          var f = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
          R.x[i] = sx[j] + (sx[j + 1] - sx[j]) * f; R.y[i] = sy[j] + (sy[j + 1] - sy[j]) * f;
        }
        return R;
      };
      C.route = ORD.map(function (ord, k) {
        var pts = [C.E], roots = [];
        ord.forEach(function (gi) {
          C.grp[gi].r.forEach(function (p, ri) { pts.push(p); roots.push([gi, ri]); });
        });
        pts.push(C.out[k]);
        var R = path(pts);
        R.roots = roots.map(function (q, i) { return [q[0], q[1], R.knot[i + 1]]; });
        return R;
      });
    }

    var CX = [token('--blue-500', '#2456dc'), token('--coral-500', '#d9376e')];   /* code X, code Y */
    var vio = token('--violet-500', '#a66cf0'), vio7 = token('--violet-700', '#6b35c4');
    var muted = token('--muted', '#5f5b53');

    /* --- time ---------------------------------------------------------- */
    var T = REDUCED ? T0 + RUNS * P + 900 : t;
    var bld = ease(T / 1400);
    var u = T - T0, tc = -1;
    if (u >= 0) tc = u - Math.floor(u / CYC) * CYC;
    var fadeK = tc > RUNS * P + HERO ? 1 - ease((tc - RUNS * P - HERO) / FADE) : 1;
    var hero = !REDUCED && tc >= RUNS * P && tc < RUNS * P + HERO ? (tc - RUNS * P) / HERO : -1;
    var phi = REDUCED ? PH0 : PH0 + SW * Math.sin(TAU * T / 21000);
    var ca = Math.cos(phi), sa = Math.sin(phi), se = Math.sin(EL), ce = Math.cos(EL);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    function pj(x, y, z, o) {
      o[0] = S * (x * ca - y * sa); o[1] = CY + S * ((x * sa + y * ca) * se - z * ce); return o;
    }
    /* project both routes on the floor once; a layer is that line lifted */
    for (var r = 0; r < 2; r++) {
      var Rr = C.route[r];
      for (var i = 0; i < Rr.n; i++) {
        Rr.px[i] = S * (Rr.x[i] * ca - Rr.y[i] * sa);
        Rr.py[i] = CY + S * (Rr.x[i] * sa + Rr.y[i] * ca) * se;
      }
    }
    function line(R, lift, from, to, rev) {   /* arc length from..to, lifted */
      var a = Math.min(R.n - 1, Math.max(0, from / STEP)), b = Math.max(a, Math.min(R.n - 1, to / STEP));
      var ia = Math.ceil(a), ib = Math.floor(b), m;
      var x0 = lerp(R.px, a), y0 = lerp(R.py, a) - lift, x1 = lerp(R.px, b), y1 = lerp(R.py, b) - lift;
      if (!rev) {
        g.lineTo(x0, y0);
        for (m = ia; m <= ib; m++) g.lineTo(R.px[m], R.py[m] - lift);
        g.lineTo(x1, y1);
      } else {
        g.lineTo(x1, y1);
        for (m = ib; m >= ia; m--) g.lineTo(R.px[m], R.py[m] - lift);
        g.lineTo(x0, y0);
      }
    }
    function lerp(A, f) { var k = Math.floor(f), k2 = Math.min(A.length - 1, k + 1); return A[k] + (A[k2] - A[k]) * (f - k); }

    var q = [0, 0], q2 = [0, 0];
    for (var p = 0; p < 2; p++) {
      g.save();
      g.translate(PX[p], 0);

      /* this panel's runs: route, how far laid, landed or not */
      var runs = [], fly = null;
      if (tc >= 0) {
        for (var k = 0; k < RUNS; k++) {
          var s0 = k * P;
          if (tc < s0) break;
          var rk = p === 0 ? SEQ[k] : 0, R = C.route[rk];
          var d = ease((tc - s0) / TR) * (R.len + TAIL);
          var run = { k: k, rk: rk, R: R, d: d, lay: Math.min(d, R.len), z: S * (Z0 + DZ * k) * ce };
          runs.push(run);
          if (tc < s0 + TR) fly = run;
        }
      }
      var top = S * (Z0 + DZ * (RUNS - 1)) * ce;

      /* root glow from the bead in flight */
      var glow = {};
      if (fly) {
        for (k = 0; k < fly.R.roots.length; k++) {
          var rr = fly.R.roots[k], qq = (fly.lay - rr[2]) / 18;
          glow[rr[0] + ':' + rr[1]] = Math.exp(-qq * qq);
        }
      }

      /* the floor: four groups, the partition that never changes */
      var bs0 = 0.6 + 0.4 * bld;
      for (var gi = 0; gi < 4; gi++) {
        var G = C.grp[gi], rx = G.r.length === 3 ? 40 : 32;
        var bs = bs0 * (0.5 + 0.5 * ease((bld * 1.3 - 0.08 * gi) / 0.6));
        pj(G.x, G.y, 0, q);
        g.save();
        g.translate(q[0], q[1]); g.rotate(-phi * se * 0.9); g.scale(S, S * se);
        var rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        rg.addColorStop(0, rgba(vio, 0.3 * bs));
        rg.addColorStop(0.75, rgba(vio, 0.17 * bs));
        rg.addColorStop(1, rgba(vio, 0.05 * bs));
        g.fillStyle = rg;
        g.beginPath(); g.ellipse(0, 0, rx, 26, 0, 0, TAU); g.fill();
        g.restore();
        /* the merges that joined this group, on the floor */
        g.strokeStyle = rgba(vio7, 0.4 * bs); g.lineWidth = 1.2;
        g.beginPath();
        for (k = 0; k < G.r.length; k++) {
          pj(G.r[k][0], G.r[k][1], 0, q);
          if (k === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
        }
        g.stroke();
      }

      /* pillars: each root, and each output, rising through the stack */
      var ps = ease((bld - 0.3) / 0.6);
      if (ps > 0) {
        g.lineWidth = 1.4;
        g.strokeStyle = rgba(vio, 0.34);
        g.beginPath();
        for (gi = 0; gi < 4; gi++) {
          G = C.grp[gi];
          for (k = 0; k < G.r.length; k++) {
            pj(G.r[k][0], G.r[k][1], 0, q);
            g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - top * ps);
          }
        }
        g.stroke();
        for (var oi = 0; oi < (p === 0 ? 2 : 1); oi++) {
          pj(C.out[oi][0], C.out[oi][1], 0, q);
          g.strokeStyle = rgba(CX[oi], 0.3);
          g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - top * ps); g.stroke();
        }
        pj(C.E[0], C.E[1], 0, q);
        g.strokeStyle = rgba(muted, 0.32);
        g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - top * ps); g.stroke();
      }

      /* curtains: the band between two runs that followed the same order */
      for (k = 1; k < runs.length; k++) {
        var lo = runs[k - 1], hi = runs[k];
        if (lo.rk !== hi.rk) continue;
        g.fillStyle = rgba(CX[hi.rk], (0.1 + 0.1 * hi.k / (RUNS - 1)) * fadeK);
        g.beginPath();
        line(hi.R, hi.z, 0, hi.lay, false);
        line(lo.R, lo.z, 0, hi.lay, true);
        g.closePath(); g.fill();
      }

      /* the threads, one per run, at its own height */
      for (k = 0; k < runs.length; k++) {
        var rn = runs[k], c5 = CX[rn.rk];
        if (rn.lay <= 0.5) continue;
        var age = 0.62 + 0.38 * rn.k / (RUNS - 1);   /* older runs a shade paler */
        g.strokeStyle = rgba(c5, 0.1 * fadeK); g.lineWidth = 5;
        g.beginPath(); line(rn.R, rn.z, 0, rn.lay, false); g.stroke();
        g.strokeStyle = rgba(c5, 0.92 * age * fadeK); g.lineWidth = 1.7;
        g.beginPath(); line(rn.R, rn.z, 0, rn.lay, false); g.stroke();
      }

      /* the gleam: once all ten agree, light runs through the whole stack at
         once, which it can only do because every layer is the same route */
      var pulse = -1e9;
      if (p === 1 && hero >= 0 && runs.length === RUNS) {
        var R3 = C.route[0], gw = 44, gk = ease(hero / 0.7);
        var ga = Math.sin(Math.PI * Math.min(1, hero / 0.7));
        var c0 = -gw + gk * (R3.len + 2 * gw);
        pulse = c0 - R3.len;
        var zlo = runs[0].z, zhi = runs[RUNS - 1].z;
        for (var band = 0; band < 2; band++) {
          var w = gw * (1 - band * 0.45);
          g.fillStyle = rgba(CX[0], 0.2 * ga);
          g.beginPath();
          line(R3, zhi, c0 - w, c0 + w, false);
          line(R3, zlo, c0 - w, c0 + w, true);
          g.closePath(); g.fill();
        }
        g.strokeStyle = rgba(CX[0], ga); g.lineWidth = 2.6;
        g.beginPath();
        for (k = 0; k < RUNS; k++) {
          var z3 = runs[k].z, f3 = Math.min(R3.n - 1, Math.max(0, c0 - gw * 0.6) / STEP);
          g.moveTo(lerp(R3.px, f3), lerp(R3.py, f3) - z3);
          line(R3, z3, c0 - gw * 0.6, c0 + gw * 0.6, false);
        }
        if (c0 + gw * 0.6 > 0 && c0 - gw * 0.6 < R3.len) g.stroke();
      }

      /* the floor nodes: the program, and the ten roots */
      var es = ease(bld / 0.5);
      pj(C.E[0], C.E[1], 0, q);
      g.strokeStyle = rgba(muted, 0.9); g.lineWidth = 2;
      g.beginPath(); g.arc(q[0], q[1], 6.5 * es, 0, TAU); g.stroke();
      g.fillStyle = rgba(muted, 1);
      g.beginPath(); g.arc(q[0], q[1], 2.6 * es, 0, TAU); g.fill();
      for (gi = 0; gi < 4; gi++) {
        G = C.grp[gi];
        for (k = 0; k < G.r.length; k++) {
          var ns = ease((bld - 0.15 - 0.04 * (gi * 3 + k)) / 0.35);
          if (ns <= 0) continue;
          pj(G.r[k][0], G.r[k][1], 0, q);
          g.fillStyle = rgba(vio, 1);
          g.beginPath(); g.arc(q[0], q[1], 3.8 * ns, 0, TAU); g.fill();
          var gg = glow[gi + ':' + k] || 0;
          if (gg > 0.02 && fly) {
            /* the bead lights the root it passes, up at its own height */
            g.fillStyle = rgba(CX[fly.rk], 0.25 * gg);
            g.beginPath(); g.arc(q[0], q[1] - fly.z, 9 * gg, 0, TAU); g.fill();
          }
        }
      }
      /* the output bases */
      for (oi = 0; oi < (p === 0 ? 2 : 1); oi++) {
        var os = ease((bld - 0.5) / 0.4);
        if (os <= 0) continue;
        pj(C.out[oi][0], C.out[oi][1], 0, q);
        g.fillStyle = rgba(CX[oi], 0.18);
        g.beginPath(); g.ellipse(q[0], q[1], 11 * os, 11 * se * os, 0, 0, TAU); g.fill();
        g.fillStyle = rgba(CX[oi], 1);
        g.beginPath(); g.ellipse(q[0], q[1], 4.2 * os, 4.2 * se * os, 0, 0, TAU); g.fill();
      }

      /* the record: a bead on its output pillar for every run that landed */
      for (k = 0; k < runs.length; k++) {
        rn = runs[k];
        if (rn.d < rn.R.len) continue;
        var ag = (rn.d - rn.R.len) / TAIL;          /* 0..1 over the tail's drain */
        var bsz = ease(ag / 0.5) * fadeK;
        /* the gleam reaches the output and climbs its column of ten */
        if (pulse > -60) { var pq = (pulse - 5 * rn.k) / 14; bsz *= 1 + 0.45 * Math.exp(-pq * pq); }
        pj(C.out[rn.rk][0], C.out[rn.rk][1], 0, q);
        g.fillStyle = rgba(CX[rn.rk], 0.2 * bsz);
        g.beginPath(); g.arc(q[0], q[1] - rn.z, 7 * bsz, 0, TAU); g.fill();
        g.fillStyle = rgba(CX[rn.rk], 1);
        g.beginPath(); g.arc(q[0], q[1] - rn.z, 3.4 * bsz, 0, TAU); g.fill();
      }

      /* the bead of the run in flight, its tail draining into the output */
      if (fly) {
        var R4 = fly.R, head = fly.lay, tl = Math.max(0, fly.d - TAIL), c6 = CX[fly.rk];
        if (head > tl + 0.5) {
          var ha = Math.max(0, tl / STEP), hb = head / STEP;
          var tg = g.createLinearGradient(lerp(R4.px, ha), lerp(R4.py, ha) - fly.z, lerp(R4.px, hb), lerp(R4.py, hb) - fly.z);
          tg.addColorStop(0, rgba(c6, 0));
          tg.addColorStop(1, rgba(c6, 0.95));
          g.strokeStyle = tg; g.lineWidth = 3.4; g.lineCap = 'butt';
          g.beginPath(); line(R4, fly.z, tl, head, false); g.stroke();
          g.lineCap = 'round';
        }
        var hs = ease(Math.min(fly.d, R4.len - fly.d) / 14);
        if (hs > 0) {
          var hx = lerp(R4.px, head / STEP), hy = lerp(R4.py, head / STEP) - fly.z;
          g.fillStyle = rgba(c6, 0.2);
          g.beginPath(); g.arc(hx, hy, 7.5 * hs, 0, TAU); g.fill();
          g.fillStyle = rgba(c6, 1);
          g.beginPath(); g.arc(hx, hy, 3.2 * hs, 0, TAU); g.fill();
        }
      }
      g.restore();
    }
  }

  /* ==================================================================== */
  /* chain — pyrefly-4180                                                */
  /* ==================================================================== */
  function chain(g, vb, t, st) {
    /* The reproducer from the pull request, drawn as it is built: 208
       strongly connected components, each of two modules that import each
       other, chained so that each component depends on the one before. All
       208 are here, wound into a tapering coil that descends to commit at
       its foot. Every component is a pair of beads, one per module, bound by a short thick bond: the cycle that makes the two one
       component. A thin link joins each component to the next.

       One export change enters at the top and propagates down the coil, one
       component after another, lighting each as it is rechecked. The
       incremental recheck has a budget of 100 epochs, drawn as a hoop the
       chain passes through. The change spends the budget reaching it, and a
       membrane closes across the hoop: the door shuts. Forced invalidation
       then produces another export change on the far side (coral), which
       runs the rest of the coil and reaches commit with that change still
       pending. That arrival is the panic, Transaction has uncommitted
       changes: a burst, with shock rings running out across the lower turns.
       The same moment a swell runs back up every component still pending,
       from commit to the door: the uncommitted changes the panic reports.
       The test catches it with should_panic, drawn as a ring that closes on
       the burst and holds it. The door sits at the 100th component as an
       illustration of the budget, not as a count of epochs per component.

       Geometry: a point at arc length s is (r cos a, r sin a, z), with the
       radius tapering and the height falling linearly in the angle, and the
       208 components spaced at equal arc length along it (the length is
       tabulated once and inverted). The coil sways about its axis and is
       projected at a low elevation, so its front and back turns separate.
       Components are sorted far to near every frame; nearer ones are larger
       and denser, so the coil reads as a solid spiral without any shading.

       Timing: the coil builds itself top to bottom over 1.8 s. Each cycle,
       11.6 s: the change crosses 100 components in 4.5 s, the door shuts
       over 0.6 s, the second change runs the remaining 108 into commit in
       2.3 s, the burst is caught and held, and everything eases back.
       Measured in the preview harness: worst frame 951 fills and strokes,
       1.3 ms mean per frame, and no painted pixel darker than #3a3a3a. */
    var TAU = Math.PI * 2;
    var N = 208, DOOR = 100;
    var R1 = 1, R0 = 0.3, TURNS = 4.5, ZT = 0.55, ZB = -0.55, ZC = -0.49;
    var S = 190, CX = 250, CY = 228, EL = 0.36, SW = 0.28;
    var BUILD = 1800, T0 = 2000, WAVE = 4500, SHUT = 600, SPK0 = 4900, SPK = 2300;
    var HIT = SPK0 + SPK, HOLD = 10000, RESET = 1200, CYC = 11600;

    var M = chain.cache;
    if (!M) {
      M = chain.cache = {};
      var A = TURNS * TAU, K = 6000, cum = new Float64Array(K + 1), i;
      var at = function (a) {
        var f = a / A, r = R1 + (R0 - R1) * f;
        return [r * Math.cos(a), r * Math.sin(a), ZT + (ZB - ZT) * f];
      };
      var prev = at(0);
      for (i = 1; i <= K; i++) {
        var cur = at(A * i / K);
        cum[i] = cum[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
        prev = cur;
      }
      var L = cum[K];
      var pt = function (s) {                /* s in 0..1 of the coil's length */
        var target = s * L, lo = 0, hi = K;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid; else hi = mid; }
        return at(A * (lo + (target - cum[lo]) / ((cum[hi] - cum[lo]) || 1)) / K);
      };
      var gap = 1 / N, half = gap * 0.22;
      M.w = [];
      for (i = 0; i < N; i++) {
        var sc = gap * (i + 0.5);
        M.w.push({ i: i, a: pt(sc - half), b: pt(sc + half), c: pt(sc), d: 0,
                   ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 });
      }
      M.order = M.w.slice();
      M.commit = [0, 0, ZC];
      /* the door: a hoop round the chain between components 99 and 100 */
      var sd = gap * DOOR, p0 = pt(sd - 0.002), p1 = pt(sd + 0.002), pc = pt(sd);
      var tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2], tl = Math.hypot(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;
      var ux = ty, uy = -tx, ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;   /* t x z, horizontal */
      var vx = ty * 0 - tz * uy, vy = tz * ux - tx * 0, vz = tx * uy - ty * ux;
      M.hoop = [];
      for (i = 0; i <= 36; i++) {
        var th = i / 36 * TAU, rh = 0.12;
        M.hoop.push([pc[0] + rh * (Math.cos(th) * ux + Math.sin(th) * vx),
                     pc[1] + rh * (Math.cos(th) * uy + Math.sin(th) * vy),
                     pc[2] + rh * Math.sin(th) * vz]);
      }
      M.hc = pc;
      /* turn the coil so the door stands at its left flank, a little forward,
         where the chain runs toward the viewer and the hoop is seen open */
      M.ph0 = Math.PI + 0.42 - Math.atan2(pc[1], pc[0]);
      M.hx = new Float32Array(37); M.hy = new Float32Array(37); M.hd = new Float32Array(37);
    }

    var blue = token('--blue-500', '#2456dc'), mint = token('--mint-500', '#0b93ab');
    var mint7 = token('--mint-700', '#0a6b7c'), coral = token('--coral-500', '#d9376e');
    var coral7 = token('--coral-700', '#a0183f'), vio = token('--violet-500', '#a66cf0');
    var vio7 = token('--violet-700', '#6b35c4'), muted = token('--muted', '#5f5b53');

    /* --- time ---------------------------------------------------------- */
    var T = REDUCED ? T0 + HIT + 1600 : t;
    var front = REDUCED ? N + 2 : (N + 2) * ease(T / BUILD);    /* build front, in components */
    var tc = T < T0 ? -1 : (T - T0) % CYC;
    var rel = tc < HOLD ? 1 : 1 - ease((tc - HOLD) / RESET);    /* eases to 0 at the reset */
    var wave = tc < 0 ? -1 : tc < WAVE ? DOOR * ease(tc / WAVE) : DOOR;
    var shut = tc < 0 ? 0 : ease((tc - WAVE + 150) / SHUT) * rel;
    var spark = tc < SPK0 ? -1 : DOOR + (N - DOOR + 1.6) * ease((tc - SPK0) / SPK);
    var hit = tc < HIT ? -1 : tc - HIT;
    var spent = tc < WAVE ? 0 : ease((tc - WAVE) / 700);        /* the first change fades at the door */
    var phi = M.ph0 + (REDUCED ? 0 : SW * Math.sin(TAU * T / 24000));

    var ca = Math.cos(phi), sa = Math.sin(phi), se = Math.sin(EL), ce = Math.cos(EL);
    function pj(p, o) {
      var X = p[0] * ca - p[1] * sa, Y = p[0] * sa + p[1] * ca;
      o[0] = CX + S * X; o[1] = CY - S * (p[2] * ce + Y * se); o[2] = -Y * ce + p[2] * se;
      return o;
    }

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    var q = [0, 0, 0], k, w;
    for (k = 0; k < N; k++) {
      w = M.w[k];
      pj(w.a, q); w.ax = q[0]; w.ay = q[1];
      pj(w.b, q); w.bx = q[0]; w.by = q[1];
      pj(w.c, q); w.cx = q[0]; w.cy = q[1]; w.d = q[2];
    }
    M.order.sort(function (a, b) { return a.d - b.d; });
    var CM = pj(M.commit, [0, 0, 0]);
    var HC = pj(M.hc, [0, 0, 0]);
    for (k = 0; k <= 36; k++) { pj(M.hoop[k], q); M.hx[k] = q[0]; M.hy[k] = q[1]; M.hd[k] = q[2]; }

    /* how lit component i is: by the first change, or pending from the second */
    function state(i, s) {
      s.on = 0; s.glow = 0; s.pend = 0;
      if (wave >= 0 && i < DOOR) {
        var dw = wave - i;
        if (dw > -0.6) { s.on = ease((dw + 0.6) / 1.6) * rel; s.glow = tail(dw) * (1 - spent); }
      }
      if (spark >= 0 && i >= DOOR) {
        var ds = spark - i;
        if (ds > -0.6) { s.pend = ease((ds + 0.6) / 1.6) * rel; s.glow = tail(ds); }
        /* the panic reports what is still pending: a swell runs back up the
           coral from commit to the door, once, and leaves nothing behind */
        if (hit > 0) {
          var xr = (hit - (N - 1 - i) * 6) / 200;
          if (xr > 0) s.glow = Math.max(s.glow, 0.85 * xr * xr * Math.exp(2 - 2 * xr) * rel);
        }
      }
      if (REDUCED) s.glow = 0;
      return s;
    }
    /* a head is sharp in front and trails a fading wake behind it */
    function tail(d) { return d < 0 ? Math.exp(-d * d / 1.2) : Math.exp(-d / 9) * (1 - Math.exp(-(d + 0.6) * 3)); }
    function mix(c1, c2, f) {             /* two #rrggbb tokens, f of the way */
      var a = parseInt(c1.replace('#', ''), 16), b = parseInt(c2.replace('#', ''), 16);
      var r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * f);
      var gg = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * f);
      var bb = (a & 255) + (((b & 255) - (a & 255)) * f);
      return '#' + ((1 << 24) | (r << 16) | (gg << 8) | bb).toString(16).slice(1);
    }

    /* the hoop's far half sits behind the chain */
    var ds0 = ease((front - DOOR) / 8);
    function hoop(far) {
      g.strokeStyle = rgba(vio7, (far ? 0.4 : 0.85) * ds0); g.lineWidth = far ? 2 : 3;
      g.beginPath();
      var on = false;
      for (var m = 0; m <= 36; m++) {
        var isFar = M.hd[m] < HC[2];
        if (isFar === far) { if (!on) { g.moveTo(M.hx[m], M.hy[m]); on = true; } else g.lineTo(M.hx[m], M.hy[m]); }
        else on = false;
      }
      g.stroke();
    }
    if (ds0 > 0) hoop(true);

    /* the burst sits behind the coil's foot */
    var burst = 0, caught = 0;
    if (hit >= 0) {
      burst = Math.min(1, hit / 600);
      burst = (1 - Math.pow(1 - burst, 3)) * rel;
      caught = ease((hit - 450) / 800);
      var br = (18 + 30 * burst) * (1 - 0.3 * caught);
      var bgr = g.createRadialGradient(CM[0], CM[1], 0, CM[0], CM[1], br);
      bgr.addColorStop(0, rgba(coral, 0.6 * burst));
      bgr.addColorStop(0.45, rgba(coral, 0.24 * burst));
      bgr.addColorStop(1, rgba(coral, 0));
      g.fillStyle = bgr;
      g.beginPath(); g.arc(CM[0], CM[1], br, 0, TAU); g.fill();
      if (!REDUCED) {
        /* shock rings run out level with commit, under the lower turns */
        for (var ri = 0; ri < 2; ri++) {
          var rk = (hit - ri * 280) / 1600;
          if (rk <= 0 || rk >= 1) continue;
          var rr = (0.06 + 0.62 * (1 - Math.pow(1 - rk, 2))) * S;
          g.strokeStyle = rgba(coral, 0.42 * (1 - rk) * (1 - rk) * ease(rk / 0.1));
          g.lineWidth = 2.4 - ri * 0.8;
          g.beginPath(); g.ellipse(CM[0], CM[1], rr, rr * se, 0, 0, TAU); g.stroke();
        }
      }
    }

    /* the components, far to near */
    var s0 = { on: 0, glow: 0, pend: 0 }, cb = blue, cm = mint;
    for (k = 0; k < N; k++) {
      w = M.order[k];
      var bi = w.i, bs = 0.26 + 0.74 * ease((front - bi) / 6);  /* unbuilt: a faint ghost */
      state(bi, s0);
      var dn = Math.max(0, Math.min(1, (w.d + 1.1) / 2.2));   /* 0 far .. 1 near */
      var sz = (0.62 + 0.62 * dn) * bs, lit = Math.max(s0.on, s0.pend);
      var sw = 1 + 0.55 * s0.glow;
      /* the link to the next component */
      if (bi < N - 1) {
        var nx = M.w[bi + 1];
        var lc = bi + 1 >= DOOR && s0.pend > 0.02 ? coral : bi < DOOR - 1 && s0.on > 0.02 ? mint : blue;
        g.strokeStyle = rgba(lc, (0.2 + 0.3 * dn) * (0.7 + 0.3 * lit) * bs);
        g.lineWidth = 1 + 0.5 * dn;
        g.beginPath(); g.moveTo(w.bx, w.by); g.lineTo(nx.ax, nx.ay); g.stroke();
      }
      if (s0.glow > 0.03) {
        g.fillStyle = rgba(bi >= DOOR ? coral : mint, 0.22 * s0.glow);
        g.beginPath(); g.arc(w.cx, w.cy, 3 + 9 * sz * s0.glow, 0, TAU); g.fill();
      }
      /* the pair's cycle: a short thick bond */
      var bond = s0.pend > 0.02 ? coral : s0.on > 0.02 ? mint : blue;
      g.strokeStyle = rgba(bond, (0.16 + 0.26 * dn + 0.34 * lit) * bs);
      g.lineWidth = 5.4 * sz * sw;
      g.beginPath(); g.moveTo(w.ax, w.ay); g.lineTo(w.bx, w.by); g.stroke();
      /* the two modules */
      var ma = ((0.34 + 0.4 * dn) * (1 - lit) + (0.8 + 0.2 * dn) * lit) * bs;
      if (s0.pend > 0.02) { cb = coral; cm = coral7; }
      else if (s0.on > 0.02) { cb = mix(blue, mint, s0.on); cm = mix(blue, mint7, s0.on); }
      else { cb = blue; cm = blue; }
      g.fillStyle = rgba(cb, ma);
      g.beginPath(); g.arc(w.ax, w.ay, 2.5 * sz * sw, 0, TAU); g.fill();
      g.fillStyle = rgba(cm, ma);
      g.beginPath(); g.arc(w.bx, w.by, 2.5 * sz * sw, 0, TAU); g.fill();
    }

    /* the last link, into commit */
    if (front > N) {
      var W0 = M.w[N - 1], lk = spark > N ? ease((spark - N) / 1.6) * rel : 0;
      g.strokeStyle = rgba(lk > 0 ? coral : blue, 0.35 + 0.5 * lk);
      g.lineWidth = 1.6 + lk;
      g.beginPath(); g.moveTo(W0.bx, W0.by); g.lineTo(CM[0], CM[1]); g.stroke();
    }

    /* the door: the hoop's near half, and the membrane that shuts it */
    if (ds0 > 0) {
      if (shut > 0.002) {
        g.fillStyle = rgba(vio, 0.42 * shut * ds0);
        g.beginPath();
        for (k = 0; k <= 36; k++) {
          /* the membrane closes from the rim inward */
          var fx = HC[0] + (M.hx[k] - HC[0]), fy = HC[1] + (M.hy[k] - HC[1]);
          if (k === 0) g.moveTo(fx, fy); else g.lineTo(fx, fy);
        }
        var inner = 1 - shut;
        for (k = 36; k >= 0; k--) g.lineTo(HC[0] + (M.hx[k] - HC[0]) * inner, HC[1] + (M.hy[k] - HC[1]) * inner);
        g.closePath(); g.fill();
      }
      hoop(false);
      if (!REDUCED && tc >= 0) {
        var dk = (tc - WAVE - 450) / 900;
        if (dk > 0 && dk < 1) {
          g.strokeStyle = rgba(vio, 0.5 * (1 - dk) * (1 - dk) * ease(dk / 0.12));
          g.lineWidth = 1.6;
          g.beginPath(); g.arc(HC[0], HC[1], 18 + 16 * (1 - Math.pow(1 - dk, 3)), 0, TAU); g.stroke();
        }
      }
    }

    /* the travelling heads: the first change, and the one born past the door */
    function head(pos, col, col7, al) {
      var i0 = Math.max(0, Math.min(N - 1, Math.floor(pos))), f = pos - i0;
      var w0 = M.w[i0], w1 = M.w[Math.min(N - 1, i0 + 1)];
      var hx = w0.cx + (w1.cx - w0.cx) * f, hy = w0.cy + (w1.cy - w0.cy) * f;
      var hd = w0.d + (w1.d - w0.d) * f;
      if (pos > N - 1) {                         /* the last stretch, into commit */
        var fk = Math.min(1, (pos - (N - 1)) / 1.6);
        hx = w0.cx + (CM[0] - w0.cx) * fk; hy = w0.cy + (CM[1] - w0.cy) * fk;
      }
      var hs = 0.7 + 0.45 * Math.max(0, Math.min(1, (hd + 1.1) / 2.2));
      g.fillStyle = rgba(col, 0.2 * al);
      g.beginPath(); g.arc(hx, hy, 10 * hs, 0, TAU); g.fill();
      g.fillStyle = rgba(col, al);
      g.beginPath(); g.arc(hx, hy, 4.4 * hs, 0, TAU); g.fill();
      g.strokeStyle = rgba(col7, 0.9 * al); g.lineWidth = 1.4;
      g.stroke();
    }
    if (!REDUCED) {
      /* the first change is spent at the door and fades there */
      if (wave >= 0 && tc < WAVE + 700) head(wave, mint, mint7, ease(tc / 300) * (1 - spent));
      if (spark >= DOOR && hit < 300) head(spark, coral, coral7, ease((tc - SPK0) / 300) * (hit < 0 ? 1 : 1 - ease(hit / 300)));
    }

    /* commit: the node the coil ends in */
    if (front > N + 0.5) {
      var cs = ease((front - N - 0.5) / 1.5), hc = mix(blue, coral, hit >= 0 ? ease(hit / 250) * rel : 0);
      g.fillStyle = rgba(hc, 0.18 * cs);
      g.beginPath(); g.arc(CM[0], CM[1], 13 * cs, 0, TAU); g.fill();
      g.fillStyle = rgba(hc, cs);
      g.beginPath(); g.arc(CM[0], CM[1], (5.5 + 2.5 * burst) * cs, 0, TAU); g.fill();
      g.strokeStyle = rgba(muted, 0.9 * cs); g.lineWidth = 2;
      g.beginPath(); g.arc(CM[0], CM[1], 9.5 * cs, 0, TAU); g.stroke();
      /* should_panic: a ring closes on the burst and holds it */
      if (caught > 0) {
        var cr = 40 - 22 * caught;
        g.strokeStyle = rgba(coral7, 0.85 * caught * rel); g.lineWidth = 2.6;
        g.beginPath(); g.arc(CM[0], CM[1], cr, 0, TAU); g.stroke();
        g.strokeStyle = rgba(coral7, 0.3 * caught * rel); g.lineWidth = 1.2;
        g.beginPath(); g.arc(CM[0], CM[1], cr + 5, 0, TAU); g.stroke();
      }
    }
  }

  /* ==================================================================== */
  /* hull — mujoco-3450                                                  */
  /* ==================================================================== */
  function hull(g, vb, t, st) {
    /* A convex hull arrives from qhull as faces whose corners are point ids.
       Building the graph means turning every corner into the hull's own
       vertex index, and a triangulated hull has 6V - 12 corners. The old code
       found each one by scanning the vertex list from the top until the id
       matched, about V/2 probes a corner, so 3V^2 - 6V in all. The fix writes
       an inverted point-id table once and then reads each corner straight out
       of it: 8V - 12 probes.

       So the figure is a real hull, rotating: the geodesic sphere got by
       splitting each face of an icosahedron in four, put through an affine
       stretch, which moves the points and keeps every face (an affine map
       sends a convex polytope to a convex polytope with the same faces). Its
       vertex list is shuffled once, because qhull's order has nothing to do
       with where a point sits. Faces are built outward from the one nearest
       the viewer, three corner lookups each.

       The two builds alternate and run on ONE clock, the same number of probes
       per second. For each corner the scan throws a coral ray from the
       face's previous corner to every list entry it tests, from the top of
       the list every time, so the first entries glow hot and the rays spray
       through the body of the hull; in the table's budget of 8V - 12 = 324
       probes it finishes 5 to 7 of the 80 faces. The table spends its first
       2V probes writing one entry per vertex, each vertex ringing mint as it
       is written, and then every corner is one stroke along its face's edge,
       and the whole hull closes in the same time. Every count drawn is the
       real count for this hull and this list order (the full scan is 5,170
       probes against 3V^2 - 6V = 5,040); nothing is scaled for effect. The
       graph is the same either way, so a face looks the same whichever build
       laid it: coloured by when it was built, mint first to violet last.

       Shading mixes each face's -500 colour toward its -700 by a fixed light
       in view space, so the hull glints as it turns, with alpha only and
       never darker than the palette. Geometry, orders and schedules are
       built once and cached on the function. Worst frame 364 fills and
       strokes. */
    var TAU = Math.PI * 2;
    var CX = 235, CY = 225, R = 150, PERSP = 4.6, TILT = 0.36;
    var RATE = 0.09;                           /* probes per ms, both builds */
    var CYC = 14000, ROT = 28000;
    var S0 = 500, T0 = 5400, PH = 3600;        /* scan, table: 8V - 12 = 324 probes each */
    var HOLD = 12600;                          /* the hull dissolves after this */

    var M = hull.m;
    if (!M) {
      M = hull.m = {};
      var seed = 7;
      var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      var ph = (1 + Math.sqrt(5)) / 2;
      var P = [[-1, ph, 0], [1, ph, 0], [-1, -ph, 0], [1, -ph, 0], [0, -1, ph], [0, 1, ph],
               [0, -1, -ph], [0, 1, -ph], [ph, 0, -1], [ph, 0, 1], [-ph, 0, -1], [-ph, 0, 1]];
      var F0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      var mids = {}, F = [], i, j, k;
      var mid = function (a, b) {
        var key = Math.min(a, b) * 64 + Math.max(a, b);
        if (mids[key] === undefined) {
          P.push([(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2, (P[a][2] + P[b][2]) / 2]);
          mids[key] = P.length - 1;
        }
        return mids[key];
      };
      for (i = 0; i < F0.length; i++) {
        var a = F0[i][0], b = F0[i][1], c = F0[i][2];
        var ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        F.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      var NV = P.length, NF = F.length;
      /* onto the sphere, so every point is extreme; then a turn and a stretch */
      var ry = 0.5, rx = 0.7, S3 = [1.17, 0.9, 1.0];
      var pts = function (p) {
        var n = Math.hypot(p[0], p[1], p[2]) || 1, x = p[0] / n, y = p[1] / n, z = p[2] / n;
        var x1 = x * Math.cos(ry) + z * Math.sin(ry), z1 = -x * Math.sin(ry) + z * Math.cos(ry);
        var y1 = y * Math.cos(rx) - z1 * Math.sin(rx), z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
        return [x1 * S3[0], y1 * S3[1], z2 * S3[2]];
      };
      M.NV = NV; M.NF = NF;
      M.x = new Float32Array(NV); M.y = new Float32Array(NV); M.z = new Float32Array(NV);
      for (i = 0; i < NV; i++) { var q = pts(P[i]); M.x[i] = q[0]; M.y[i] = q[1]; M.z[i] = q[2]; }
      /* outward winding, checked rather than trusted */
      for (i = 0; i < NF; i++) {
        var f = F[i], ux = M.x[f[1]] - M.x[f[0]], uy = M.y[f[1]] - M.y[f[0]], uz = M.z[f[1]] - M.z[f[0]];
        var vx = M.x[f[2]] - M.x[f[0]], vy = M.y[f[2]] - M.y[f[0]], vz = M.z[f[2]] - M.z[f[0]];
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * (M.x[f[0]] + M.x[f[1]] + M.x[f[2]]) + ny * (M.y[f[0]] + M.y[f[1]] + M.y[f[2]]) +
            nz * (M.z[f[0]] + M.z[f[1]] + M.z[f[2]]) < 0) { var sw = f[1]; f[1] = f[2]; f[2] = sw; }
      }
      M.F = F;
      /* edges, each with the two faces that share it */
      var em = {};
      M.E = []; M.nb = [];
      for (i = 0; i < NF; i++) M.nb.push([]);
      for (i = 0; i < NF; i++) {
        for (k = 0; k < 3; k++) {
          var e0 = F[i][k], e1 = F[i][(k + 1) % 3], key = Math.min(e0, e1) * 64 + Math.max(e0, e1);
          if (em[key] === undefined) { em[key] = M.E.length; M.E.push([e0, e1, i, -1]); }
          else { var ed = M.E[em[key]]; ed[3] = i; M.nb[i].push(ed[2]); M.nb[ed[2]].push(i); }
        }
      }
      /* the rest of the cloud: points strictly inside, which the hull wraps */
      M.NI = 46;
      M.ix = new Float32Array(M.NI); M.iy = new Float32Array(M.NI); M.iz = new Float32Array(M.NI);
      for (i = 0; i < M.NI; i++) {
        var u = rnd() * 2 - 1, w = rnd() * TAU, rr = 0.82 * Math.cbrt(rnd()), s1 = Math.sqrt(1 - u * u);
        var qq = pts([s1 * Math.cos(w), s1 * Math.sin(w), u]);
        M.ix[i] = qq[0] * rr; M.iy[i] = qq[1] * rr; M.iz[i] = qq[2] * rr;
      }
      /* the vertex list, in an order that has nothing to do with position */
      M.L = []; M.pos = new Int32Array(NV);
      for (i = 0; i < NV; i++) M.L.push(i);
      for (i = NV - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); var tmp = M.L[i]; M.L[i] = M.L[j]; M.L[j] = tmp; }
      for (i = 0; i < NV; i++) M.pos[M.L[i]] = i;
      M.ord = {};
      /* per-frame scratch */
      M.rx = new Float32Array(NV); M.ry = new Float32Array(NV); M.rz = new Float32Array(NV);
      M.sx = new Float32Array(NV); M.sy = new Float32Array(NV); M.ss = new Float32Array(NV);
      M.fnx = new Float32Array(NF); M.fny = new Float32Array(NF); M.fnz = new Float32Array(NF);
      M.fd = new Float32Array(NF); M.bf = new Float32Array(NF); M.fo = [];
      for (i = 0; i < NF; i++) M.fo.push(i);
      M.heat = new Float32Array(NV); M.lit = new Float32Array(NV);
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      M.C5 = [hex('--mint-500', '#0b93ab'), hex('--blue-500', '#2456dc'), hex('--violet-500', '#a66cf0')];
      M.C7 = [hex('--mint-700', '#0a6b7c'), hex('--blue-700', '#163a9a'), hex('--violet-700', '#6b35c4')];
      M.wh = hex('--raised', '#ffffff'); M.white = token('--raised', '#ffffff');
      M.gr = hex('--muted', '#5f5b53'); M.hr = hex('--hair2', '#cfcbc1'); M.K5 = hex('--coral-500', '#d9376e');
      M.mint = token('--mint-500', '#0b93ab'); M.mint7 = token('--mint-700', '#0a6b7c');
      M.coral = token('--coral-500', '#d9376e'); M.muted = token('--muted', '#5f5b53');
      M.hair = token('--hair2', '#cfcbc1');
    }

    /* the build order from a seed face: breadth first, three lookups a face,
       each face turned so its first corner is one already found */
    function order(sf) {
      if (M.ord[sf]) return M.ord[sf];
      var O = { faces: [], look: [], lf: [], rank: new Int32Array(M.NF) };
      var seen = new Uint8Array(M.NF), got = new Uint8Array(M.NV), qu = [sf], h = 0, i, k;
      seen[sf] = 1;
      while (h < qu.length) {
        var f = qu[h++];
        O.rank[f] = O.faces.length; O.faces.push(f);
        for (k = 0; k < 3; k++) { var n = M.nb[f][k]; if (!seen[n]) { seen[n] = 1; qu.push(n); } }
      }
      for (i = 0; i < O.faces.length; i++) {
        var fc = M.F[O.faces[i]], r0 = 0;
        for (k = 0; k < 3; k++) if (got[fc[k]]) { r0 = k; break; }
        for (k = 0; k < 3; k++) { var v = fc[(r0 + k) % 3]; O.look.push(v); O.lf.push(O.faces[i]); got[v] = 1; }
      }
      /* the scan: lookup n starts at probe start[n] and tests list entries
         0..pos[v], so it lands on probe start[n] + pos[v] */
      var NL = O.look.length, c = 0;
      O.sStart = new Int32Array(NL); O.sHit = new Int32Array(NL);
      O.pl = []; O.pc = [];
      for (i = 0; i < NL; i++) {
        O.sStart[i] = c;
        for (k = 0; k <= M.pos[O.look[i]]; k++) { O.pl.push(i); O.pc.push(M.L[k]); }
        c += M.pos[O.look[i]] + 1;
        O.sHit[i] = c - 1;
      }
      O.scanProbes = c;
      /* the table: 2V probes to write it, then one per lookup */
      O.sDone = new Float32Array(M.NF); O.tDone = new Float32Array(M.NF);
      for (i = 0; i < NL; i++) {
        if (i % 3 !== 2) continue;
        O.sDone[O.lf[i]] = O.sHit[i] / RATE;
        O.tDone[O.lf[i]] = (2 * M.NV + i) / RATE;
      }
      O.tableProbes = 2 * M.NV + NL;
      return (M.ord[sf] = O);
    }

    /* --- time ----------------------------------------------------------- */
    var RED = REDUCED;
    var T = RED ? 3000 : t;
    var cyc = Math.floor(T / CYC), tau = T - cyc * CYC;
    var intro = cyc === 0 && !RED ? ease(tau / 900) : 1;

    /* --- projection ------------------------------------------------------ */
    function rot(th) { return [Math.cos(th), Math.sin(th), Math.cos(TILT), Math.sin(TILT)]; }
    var th = TAU * T / ROT, cr = rot(th);
    var NV = M.NV, NF = M.NF, i, k;
    for (i = 0; i < NV; i++) {
      var x1 = M.x[i] * cr[0] + M.z[i] * cr[1], z1 = -M.x[i] * cr[1] + M.z[i] * cr[0];
      var y2 = M.y[i] * cr[2] - z1 * cr[3], z2 = M.y[i] * cr[3] + z1 * cr[2];
      M.rx[i] = x1; M.ry[i] = y2; M.rz[i] = z2;
      var s = PERSP / (PERSP - z2);
      M.sx[i] = CX + R * x1 * s; M.sy[i] = CY - R * y2 * s; M.ss[i] = s;
    }
    var LX = -0.4, LY = 0.58, LZ = 0.71;
    for (i = 0; i < NF; i++) {
      var f = M.F[i];
      var ux = M.rx[f[1]] - M.rx[f[0]], uy = M.ry[f[1]] - M.ry[f[0]], uz = M.rz[f[1]] - M.rz[f[0]];
      var vx = M.rx[f[2]] - M.rx[f[0]], vy = M.ry[f[2]] - M.ry[f[0]], vz = M.rz[f[2]] - M.rz[f[0]];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nn = Math.hypot(nx, ny, nz) || 1;
      M.fnx[i] = nx / nn; M.fny[i] = ny / nn; M.fnz[i] = nz / nn;
      M.fd[i] = M.rz[f[0]] + M.rz[f[1]] + M.rz[f[2]];
    }
    /* the seed of a build is the face most squarely toward the viewer at the
       moment that build starts */
    function seedAt(ts) {
      var c2 = rot(TAU * ts / ROT), best = 0, bz = -9;
      for (var n = 0; n < NF; n++) {
        var f2 = M.F[n], sy = 0, sz = 0;
        for (var m = 0; m < 3; m++) {
          var a = f2[m], zz = -M.x[a] * c2[1] + M.z[a] * c2[0];
          sy += M.y[a] * c2[2] - zz * c2[3]; sz += M.y[a] * c2[3] + zz * c2[2];
        }
        if (sz + 0.35 * sy > bz) { bz = sz + 0.35 * sy; best = n; }
      }
      return best;
    }

    /* --- state of the builds ---------------------------------------------- */
    var mode = 0, ts = 0, tt = 0, O = null, fade = 1;
    if (RED) { mode = 2; O = order(seedAt(T)); tt = 1e9; }
    else if (tau >= S0 && tau < T0) {
      mode = 1; ts = tau - S0; O = order(seedAt(cyc * CYC + S0));
      fade = 1 - ease((ts - PH - 150) / 750);
    } else if (tau >= T0) {
      mode = 2; tt = tau - T0; O = order(seedAt(cyc * CYC + T0));
      fade = 1 - ease((tau - HOLD) / 900);
    }
    for (i = 0; i < NF; i++) {
      var b = 0;
      if (mode === 1) b = O.sDone[i] < PH ? ease((ts - O.sDone[i]) / 260) : 0;
      else if (mode === 2) b = ease((tt - O.tDone[i]) / 260);
      M.bf[i] = b * fade;
    }
    /* the hero moment: once the table has closed the hull, one wave of light
       runs over it in the order it was built */
    var wave = mode === 2 && !RED ? (tt - PH) / 1400 * 1.3 - 0.15 : -9;

    /* heat: how often each vertex was just tested; lit: found or written */
    for (i = 0; i < NV; i++) { M.heat[i] = 0; M.lit[i] = 0; }
    var kNow = -1;
    if (mode === 1) {
      kNow = Math.min(Math.floor(ts * RATE), Math.round(PH * RATE) - 1);
      for (k = Math.max(0, kNow - 160); k <= kNow; k++) {
        var age = ts - k / RATE;
        if (age < 1800) M.heat[O.pc[k]] += Math.exp(-age / 380) * ease(age / 50);
      }
      for (k = 0; k < O.look.length && O.sHit[k] <= kNow; k++) M.lit[O.look[k]] = fade;
    } else if (mode === 2) {
      for (k = 0; k < NV; k++) M.lit[M.L[k]] = ease((tt - (2 * k + 1) / RATE) / 180) * fade;
    }

    /* --- draw ------------------------------------------------------------- */
    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';
    var fo = M.fo;
    fo.sort(function (a, b) { return M.fd[a] - M.fd[b]; });

    /* a face is coloured by when it was built, mint first through blue to
       violet last, so the finished hull still shows the order of its build */
    function ramp(C, r) {
      var k1 = Math.min(1.999, Math.max(0, r) * 2), j = Math.floor(k1), u = k1 - j;
      return [C[j][0] + (C[j + 1][0] - C[j][0]) * u, C[j][1] + (C[j + 1][1] - C[j][1]) * u,
              C[j][2] + (C[j + 1][2] - C[j][2]) * u];
    }
    function css(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')'; }
    function wv(n) { return wave > -1 ? Math.exp(-Math.pow((wave - O.rank[n] / NF) / 0.1, 2)) : 0; }
    function face(n) {
      var f = M.F[n], front = M.fnz[n] > 0, bf = M.bf[n];
      g.beginPath();
      g.moveTo(M.sx[f[0]], M.sy[f[0]]); g.lineTo(M.sx[f[1]], M.sy[f[1]]); g.lineTo(M.sx[f[2]], M.sy[f[2]]);
      g.closePath();
      if (bf < 0.01) {
        g.fillStyle = rgba(M.mint, intro * (front ? 0.06 : 0.035));
        g.fill(); return;
      }
      var lam = Math.max(0, M.fnx[n] * LX + M.fny[n] * LY + M.fnz[n] * LZ), w = wv(n) * bf;
      var r = O.rank[n] / (NF - 1), c5 = ramp(M.C5, r), c7 = ramp(M.C7, r), k1 = 0.2 + 0.8 * lam;
      var c = [c7[0] + (c5[0] - c7[0]) * k1, c7[1] + (c5[1] - c7[1]) * k1, c7[2] + (c5[2] - c7[2]) * k1];
      var sp = 0.62 * Math.pow(lam, 9) + 0.55 * w;
      c[0] += (M.wh[0] - c[0]) * sp; c[1] += (M.wh[1] - c[1]) * sp; c[2] += (M.wh[2] - c[2]) * sp;
      var a = front ? 0.36 + 0.3 * lam + 0.15 * w : 0.13;
      g.fillStyle = css(c, intro * ((front ? 0.06 : 0.035) * (1 - bf) + a * bf));
      g.fill();
    }
    /* An edge is a blend of three states, weighted so nothing ever switches:
       unbuilt (grey), the rim of the built patch (deep, one face built) and
       inside it (lit white, both faces built). The hull's outline stays deep. */
    function edges(front) {
      for (var n = 0; n < M.E.length; n++) {
        var e = M.E[n], f1 = e[2], f2 = e[3], a1 = M.fnz[f1] > 0, a2 = M.fnz[f2] > 0;
        if ((a1 || a2) !== front) continue;
        var b1 = M.bf[f1], b2 = M.bf[f2], lit = Math.max(b1, b2), both = Math.min(b1, b2);
        var deep = lit > 0.001 ? ramp(M.C7, O.rank[b1 >= b2 ? f1 : f2] / (NF - 1)) : M.gr;
        var wg = 1 - lit, wi = front && a1 === a2 ? both : 0, wf = lit - wi;
        var w = wi > 0 ? Math.max(wv(f1), wv(f2)) : 0;
        var base = front ? M.gr : M.hr, ag = intro * (front ? 0.3 : 0.6);
        var af = front ? (a1 !== a2 ? 0.92 : 0.9) : 0.3, ai = 0.55 + 0.35 * w;
        var A = wg * ag + wf * af + wi * ai;
        if (A < 0.004) continue;
        var cc = [0, 0, 0];
        for (var m = 0; m < 3; m++) cc[m] = (wg * ag * base[m] + wf * af * deep[m] + wi * ai * M.wh[m]) / A;
        g.strokeStyle = css(cc, A);
        g.lineWidth = front ? wg * (a1 !== a2 ? 1.2 : 0.8) + wf * (a1 !== a2 ? 2.1 : 1.9) + wi * (1.1 + 1.2 * w)
                            : 0.7 + 0.2 * lit;
        g.beginPath(); g.moveTo(M.sx[e[0]], M.sy[e[0]]); g.lineTo(M.sx[e[1]], M.sy[e[1]]); g.stroke();
      }
    }
    function vtx(n) { return [M.sx[n], M.sy[n]]; }
    /* lookup n asks for one corner of its face; it is drawn departing from
       the corner before it, so the answers trace that face's own edges */
    function origin(n) { return vtx(O.look[n % 3 ? n - 1 : n + 2]); }

    /* a glow behind the hull: coral while the scan storms through it, mint
       swelling once the table has closed it and settling while it holds */
    var heatSum = 0;
    for (i = 0; i < NV; i++) heatSum += M.heat[i];
    var closed = RED ? 1 : mode === 2 ? ease((tt - PH + 150) / 700) * fade : 0;
    var swell = mode === 2 && !RED ? Math.exp(-Math.pow((tt - PH - 550) / 650, 2)) * fade : 0;
    var glows = [[M.coral, mode === 1 ? 0.13 * Math.min(1, heatSum / 12) : 0],
                 [M.mint, 0.1 * closed + 0.16 * swell]];
    for (k = 0; k < 2; k++) {
      if (glows[k][1] < 0.004) continue;
      g.save(); g.translate(CX, CY); g.scale(1.2, 1);
      var hg = g.createRadialGradient(0, 0, 0, 0, 0, 158);
      hg.addColorStop(0, rgba(glows[k][0], glows[k][1]));
      hg.addColorStop(0.6, rgba(glows[k][0], glows[k][1] * 0.55));
      hg.addColorStop(1, rgba(glows[k][0], 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(0, 0, 158, 0, TAU); g.fill();
      g.restore();
    }

    /* far half of the hull, then the cloud inside it */
    for (i = 0; i < NF; i++) if (M.fnz[fo[i]] <= 0) face(fo[i]);
    edges(false);
    g.fillStyle = rgba(M.muted, 0.34);
    g.beginPath();
    for (i = 0; i < M.NI; i++) {
      var ax = M.ix[i] * cr[0] + M.iz[i] * cr[1], az = -M.ix[i] * cr[1] + M.iz[i] * cr[0];
      var ay = M.iy[i] * cr[2] - az * cr[3], az2 = M.iy[i] * cr[3] + az * cr[2], s2 = PERSP / (PERSP - az2);
      var px = CX + R * ax * s2, py = CY - R * ay * s2, pr = 1.25 + 0.45 * az2;
      g.moveTo(px + pr, py); g.arc(px, py, pr, 0, TAU);
    }
    g.fill();

    /* the scan's rays run through the body, so they sit under the near faces */
    var o, c;
    if (mode === 1 && kNow >= 0) {
      for (k = Math.max(0, kNow - 120); k <= kNow; k++) {
        var ag = ts - k / RATE, n1 = O.pl[k], hit = O.pc[k] === O.look[n1];
        var life = hit ? 1300 : 900;
        if (ag < 0 || ag > life) continue;
        o = origin(n1); c = vtx(O.pc[k]);
        var gr = ease(ag / 100), al = Math.pow(1 - ag / life, 1.4);
        if (hit) { g.strokeStyle = rgba(M.mint7, 0.95 * al); g.lineWidth = 3; }
        else { g.strokeStyle = rgba(M.coral, 0.8 * al); g.lineWidth = 1.4; }
        g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] + (c[0] - o[0]) * gr, o[1] + (c[1] - o[1]) * gr); g.stroke();
      }
    }

    /* near half of the hull */
    for (i = 0; i < NF; i++) if (M.fnz[fo[i]] > 0) face(fo[i]);
    edges(true);

    /* the table's strokes: one per corner, along the skin */
    if (mode === 2 && !RED) {
      var k0 = 2 * NV, kN = Math.floor(tt * RATE);
      g.lineWidth = 3;
      for (k = Math.max(k0, kN - 40); k <= Math.min(kN, O.tableProbes - 1); k++) {
        var n2 = k - k0, ag2 = tt - k / RATE;
        if (ag2 < 0 || ag2 > 420) continue;
        o = origin(n2); c = vtx(O.look[n2]);
        var gr2 = ease(ag2 / 110);
        g.strokeStyle = rgba(M.mint7, 0.95 * Math.pow(1 - ag2 / 420, 1.3) * fade);
        g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] + (c[0] - o[0]) * gr2, o[1] + (c[1] - o[1]) * gr2); g.stroke();
      }
    }
    if (RED) {
      /* the still: one corner found both ways, over the finished hull. Every
         probe the scan spends on it, and the one stroke the table does */
      var nR = 0;
      for (k = 1; k < 30; k++) if (M.pos[O.look[k]] > M.pos[O.look[nR]]) nR = k;
      o = origin(nR);
      g.lineWidth = 1.4;
      g.strokeStyle = rgba(M.coral, 0.72);
      for (k = 0; k < M.pos[O.look[nR]]; k++) {
        c = vtx(M.L[k]); M.heat[M.L[k]] = 0.9;
        g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(c[0], c[1]); g.stroke();
      }
      c = vtx(O.look[nR]);
      g.strokeStyle = rgba(M.mint7, 1); g.lineWidth = 3.6;
      g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(c[0], c[1]); g.stroke();
    }

    /* vertices: hot where the scan keeps testing, mint once found or written */
    for (i = 0; i < NV; i++) {
      var sx = M.sx[i], sy = M.sy[i], sc = M.ss[i], fz = M.rz[i] > -0.2 ? 1 : 0.5;
      var hh = Math.min(1.8, M.heat[i]);
      if (hh > 0.02) {
        g.fillStyle = rgba(M.coral, 0.26 * Math.min(1, hh) * fz);
        g.beginPath(); g.arc(sx, sy, (3.5 + 5 * hh) * sc, 0, TAU); g.fill();
      }
      if (mode === 2 && !RED) {
        var wk = tt - (2 * M.pos[i] + 1) / RATE;
        if (wk > 0 && wk < 650) {
          var e2 = wk / 650;
          g.strokeStyle = rgba(M.mint, 0.8 * (1 - e2) * (1 - e2) * fz);
          g.lineWidth = 1.8;
          g.beginPath(); g.arc(sx, sy, (3 + 11 * ease(e2)) * sc, 0, TAU); g.stroke();
        }
      }
      var lt = M.lit[i];
      var hc = Math.min(1, hh * 1.6) * (1 - lt), vc = [0, 0, 0];
      for (k = 0; k < 3; k++) vc[k] = M.gr[k] + (M.K5[k] - M.gr[k]) * hc + (M.C7[0][k] - M.gr[k]) * lt;
      g.fillStyle = css(vc, (0.4 + 0.4 * fz) * (1 - lt) + (0.5 + 0.5 * fz) * lt);
      g.beginPath(); g.arc(sx, sy, (1.9 + 0.8 * lt + 0.5 * Math.min(1, hh)) * sc, 0, TAU); g.fill();
    }
  }

  /* ==================================================================== */
  /* arena — xnnpack-10801                                               */
  /* ==================================================================== */
  function arena(g, vb, t, st) {
    /* A memory plan, drawn the way a planner engineer reads one: time runs
       left to right in operator steps, memory offset runs upward from the
       floor of the arena, and every value is a glass slab spanning the steps
       it is live for, at the offset it was given. The arena has to be as tall
       as the highest slab, for the whole run, so its lid is the peak.

       The plan is real, not sketched. Fifty values were generated and placed
       by greedy by size, largest first, each into the smallest gap between
       the live blocks that overlap it in time, else on top of them. Run twice,
       once never looking below the first live block and once also taking the
       leading gap, the two plans agree on 49 values and differ on one. The
       rest of the wall is identical both ways; only that value moves.

       The wall builds itself in placement order. Then the amber value
       arrives. The old search starts at the first live block, sweeps upward,
       finds no gap and stacks it on top: the lid rises from 112 to 144 across
       the whole run, although the value lives for four steps. Then the fix
       looks from the floor, finds the cave under the first live block, lifts
       the value off, carries it down and sets it in. The lid comes down with
       it to 112, with the old peak left as a faint high water mark. A time
       cursor sweeps the run throughout and lights whatever is live under it.

       Peaks are drawn in MiB: the generated plan was chosen so that its two
       peaks are exactly 144 and 112, the workspace the card reports. It is an
       illustration of the decision, not the MobileNet plan itself. Shading is
       alpha and hue only, -500 fronts toward -700 sides, so nothing is darker
       than the palette. At most 315 fills and strokes a frame, measured. */
    var OPS = 24, XL = 30, OW = 16.25, Y0 = 404, SY = 2.15, DX = 9, DY = -7;
    var HERO = 4, NEW_TOP = 112, OLD_TOP = 144;
    var BUILD = 2600, C = 11200, SWEEP = 5600;
    var TAU = Math.PI * 2;

    var A = arena.geo;
    if (!A) {
      /* [first step, last step, MiB, offset] in the fixed plan; the hero's
         offset in the old plan is 112 */
      var P = [[0,8,38,0],[16,23,38,0],[5,12,37,38],[6,17,37,75],[10,13,32,0],[19,23,18,63],
        [3,5,14,91],[19,21,8,99],[13,19,25,38],[23,23,3,105],[4,5,16,75],[0,2,24,38],[21,21,4,57],
        [20,21,4,53],[18,21,3,107],[4,4,13,56],[21,23,18,81],[20,21,15,38],[13,17,12,63],[0,1,3,80],
        [4,4,3,69],[0,4,7,105],[22,22,5,105],[2,2,10,94],[3,3,5,83],[22,23,24,38],[2,3,21,62],
        [0,1,8,72],[3,3,23,38],[4,4,18,38],[22,23,6,99],[18,20,3,95],[18,18,24,63],[23,23,3,108],
        [1,1,4,100],[1,1,8,62],[1,1,6,94],[0,0,7,94],[0,2,11,83],[19,19,14,81],[0,0,10,62],
        [20,20,3,57],[20,20,14,81],[18,18,8,87],[0,0,3,101],[4,4,3,72],[5,5,4,105],[20,20,3,60],
        [18,18,3,98],[18,18,3,101]];
      A = arena.geo = { s: [], order: [] };
      var hexc = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var mix = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
      var css = function (c, al) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al + ')'; };
      A.mix = mix; A.css = css;
      var B5 = hexc('--blue-500', '#2456dc'), V5 = hexc('--violet-500', '#a66cf0'), M5 = hexc('--mint-500', '#0b93ab');
      var B7 = hexc('--blue-700', '#163a9a'), V7 = hexc('--violet-700', '#6b35c4'), M7 = hexc('--mint-700', '#0a6b7c');
      /* offset ramp: mint on the floor, through blue, to violet at the lid */
      var ramp = function (a, b, c, v) { return v < 0.5 ? mix(a, b, v * 2) : mix(b, c, v * 2 - 1); };
      var WH = [255, 255, 255];
      A.am5 = hexc('--amber-500', '#d96a06'); A.am7 = hexc('--amber-700', '#9a4906');
      A.co5 = hexc('--coral-500', '#d9376e'); A.co7 = hexc('--coral-700', '#a0183f');
      A.bl7 = B7; A.ink = hexc('--ink', '#1c1b19'); A.hair = hexc('--hair2', '#cfcbc1');
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        var jit = Math.sin(i * 12.9898) * 43758.5453; jit = jit - Math.floor(jit);
        var v = Math.max(0, Math.min(1, Math.pow((p[3] + p[2] / 2) / NEW_TOP, 1.25) + (jit - 0.5) * 0.3));
        var c5 = i === HERO ? A.am5 : ramp(M5, B5, V5, v), c7 = i === HERO ? A.am7 : ramp(M7, B7, V7, v);
        A.s.push({ a: p[0], b: p[1], z: p[2], off: p[3],
          x0: XL + p[0] * OW, x1: XL + (p[1] + 1) * OW,
          top: css(mix(c5, WH, 0.5), 0.72), side: css(mix(c7, c5, 0.35), 0.62),
          hi: css(mix(c5, WH, 0.82), 0.95), rule: css(WH, 0.2),
          fT: css(mix(c5, WH, 0.3), 0.6), fM: css(mix(c5, WH, 0.12), 0.7), fB: css(c5, 0.88),
          lo: css(c7, 0.45), refl: css(c5, 0.2), c5: c5 });
        A.order.push(i);
      }
      /* the order the planner placed them: largest first, then earliest */
      A.order.sort(function (m, n) { return P[n][2] - P[m][2] || P[m][0] - P[n][0] || m - n; });
      A.rank = [];
      for (var i2 = 0, r2 = 0; i2 < A.order.length; i2++) if (A.order[i2] !== HERO) A.rank[A.order[i2]] = r2++;
    }

    var RED = REDUCED;
    var T = RED ? BUILD + C : t;
    function Y(m) { return Y0 - m * SY; }
    function rr(x0, y0, x1, y1, r) {             /* rounded rect, into the current path */
      r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
      g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arcTo(x1, y0, x1, y0 + r, r);
      g.lineTo(x1, y1 - r); g.arcTo(x1, y1, x1 - r, y1, r); g.lineTo(x0 + r, y1);
      g.arcTo(x0, y1, x0, y1 - r, r); g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r);
      g.closePath();
    }
    function sm(k) { k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k); }

    /* --- the hero's story, once per cycle after the build ------------------ */
    var p = RED ? 8600 : (T < BUILD ? -1 : (T - BUILD) % C);
    var lap = RED ? 1 : Math.floor((T - BUILD) / C);
    var hOff = OLD_TOP, hA = 0, lift = 0, rim = NEW_TOP;
    var oldScan = -1, newGlow = 0, ghost = 0, water = 0, ring = -1;
    if (p >= 0) {
      /* arrive: materialise above the wall and settle on it */
      var arr = ease(p / 1100);
      hA = arr * (1 - ease((p - 10000) / 1000));
      hOff = NEW_TOP + 6 * (1 - arr);
      /* the old search: from the first live block upward, never below it */
      if (p > 150 && p < 1250) oldScan = 38 + (NEW_TOP - 38) * ease((p - 150) / 1000);
      rim = NEW_TOP + 32 * ease((p - 900) / 800);
      /* the fix: look from the floor, and the cave fills with light */
      newGlow = ease((p - 3100) / 1000) * (1 - ease((p - 10000) / 1000));
      /* lift toward the viewer, carry down, set in */
      lift = ease((p - 4300) / 500) * (1 - ease((p - 6200) / 550));
      if (p >= 4800) hOff = NEW_TOP * (1 - ease((p - 4800) / 1400));
      if (p >= 4300) rim = Math.max(NEW_TOP, hOff + 32);
      ghost = ease((p - 4300) / 700) * (1 - ease((p - 9900) / 1100));
      water = ghost;
      if (p > 6500 && p < 8300) ring = (p - 6500) / 1800;
    }

    if (A.gctx !== g) { A.gctx = g; for (var z0 = 0; z0 < A.s.length; z0++) A.s[z0].gr = null; }
    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineJoin = 'round';
    var XR = XL + OPS * OW;

    /* --- the floor of the arena: offset zero, a glossy shelf with a tick for
       every operator step, and the slabs that stand on it reflected in it --- */
    g.fillStyle = A.css(A.hair, 0.5);
    g.beginPath();
    g.moveTo(XL - 12, Y0); g.lineTo(XR + 8, Y0); g.lineTo(XR + 8 + DX, Y0 + DY); g.lineTo(XL - 12 + DX, Y0 + DY);
    g.closePath(); g.fill();
    var fl = g.createLinearGradient(0, Y0, 0, Y0 + 16);
    fl.addColorStop(0, A.css(A.hair, 0.75)); fl.addColorStop(1, A.css(A.hair, 0));
    g.fillStyle = fl;
    g.fillRect(XL - 12, Y0, XR - XL + 20, 16);
    g.strokeStyle = A.css(A.hair, 1); g.lineWidth = 1;
    g.beginPath();
    for (var q = 0; q <= OPS; q++) { g.moveTo(XL + q * OW, Y0 + 1); g.lineTo(XL + q * OW, Y0 + (q % 4 === 0 ? 7 : 4)); }
    g.stroke();

    /* --- the cave: the leading gap, lit once the fix looks from the floor -- */
    var cx0 = XL + 9 * OW, cx1 = XL + 16 * OW;
    if (newGlow > 0.005) {
      var gh = 38 * newGlow;
      var cg = g.createLinearGradient(0, Y0, 0, Y(38));
      cg.addColorStop(0, A.css(A.am5, 0.34 * newGlow));
      cg.addColorStop(1, A.css(A.am5, 0.06 * newGlow));
      g.fillStyle = cg;
      g.beginPath(); rr(cx0 + 1, Y(gh), cx1 - 1, Y0, 3); g.fill();
    }

    /* --- the arena growth: every step pays for the tallest, 112 up to rim --- */
    if (rim > NEW_TOP + 0.2) {
      g.fillStyle = A.css(A.co5, 0.1 * sm((rim - NEW_TOP) / 8));
      g.beginPath(); rr(XL - 6, Y(rim), XR + 4, Y(NEW_TOP), 3); g.fill();
    }

    /* --- the wall: build-in, cursor light ---------------------------------- */
    var cur = RED ? -1 : (T - BUILD) / SWEEP;
    var cOn = RED ? 0 : ease((T - BUILD + 400) / 1200);
    var cx = XL + (cur - Math.floor(cur)) * OPS * OW;
    var S = A.s, k, s, dy = [], al = [], boost = [], built = 0;
    for (k = 0; k < S.length; k++) {
      s = S[k];
      if (k === HERO) { dy[k] = 0; al[k] = 0; boost[k] = 0; continue; }
      var st0 = A.rank[k] * 40 - 260, f = RED ? 1 : ease((T - st0) / 560);
      dy[k] = -26 * (1 - f); al[k] = f;
      built = Math.max(built, (s.off + s.z) * ease((T - st0 - 380) / 180));
      /* A value is only live between its first and last step. Under the
         cursor it is live and vivid; elsewhere it is planned space, pale.
         A slab lands vivid and relaxes, so the build reads as placement. */
      var inside = Math.min(cx - s.x0, s.x1 - cx);
      boost[k] = RED ? 0.5 : Math.max(cOn * sm((inside + 5) / 10), 1 - ease((T - st0 - 560) / 900));
    }

    /* while the wall builds, the lid is the arena so far: its tallest slab */
    if (p < 0) rim = built;

    function faces(s, oy, a, sc) {                /* top and side, behind every front */
      var x0 = s.x0 + 0.8, x1 = s.x1 - 0.8, y0 = Y(s.off + s.z) + 0.8 + oy, y1 = Y(s.off) - 0.8 + oy;
      g.globalAlpha = a;
      g.fillStyle = s.top;
      g.beginPath(); g.moveTo(x0 + 2, y0); g.lineTo(x1, y0); g.lineTo(x1 + DX * sc, y0 + DY * sc);
      g.lineTo(x0 + 2 + DX * sc, y0 + DY * sc); g.closePath(); g.fill();
      g.fillStyle = s.side;
      g.beginPath(); g.moveTo(x1, y0); g.lineTo(x1 + DX * sc, y0 + DY * sc);
      g.lineTo(x1 + DX * sc, y1 + DY * sc - 2); g.lineTo(x1, y1 - 2); g.closePath(); g.fill();
    }
    function front(s, oy, a, b) {
      var x0 = s.x0 + 0.8, x1 = s.x1 - 0.8, y0 = Y(s.off + s.z) + 0.8 + oy, y1 = Y(s.off) - 0.8 + oy;
      /* a landed slab never moves, so its gradient is made once per canvas */
      var gr = oy === 0 && A.gctx === g ? s.gr : null;
      if (!gr) {
        gr = g.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, s.fT); gr.addColorStop(0.42, s.fM); gr.addColorStop(1, s.fB);
        if (oy === 0 && A.gctx === g) s.gr = gr;
      }
      g.globalAlpha = a * (0.48 + 0.52 * b);
      g.fillStyle = gr;
      g.beginPath(); rr(x0, y0, x1, y1, 3); g.fill();
      /* ruled every 2 MiB, so a slab's height can be counted as memory */
      g.globalAlpha = a * (0.5 + 0.5 * b);
      g.strokeStyle = s.rule; g.lineWidth = 0.7;
      g.beginPath();
      for (var m = 2; m < s.z - 0.5; m += 2) { var yy = Y(s.off + m) + oy; g.moveTo(x0 + 2, yy); g.lineTo(x1 - 2, yy); }
      g.stroke();
      /* light catches the upper edge */
      g.globalAlpha = a * (0.6 + 0.4 * b);
      g.strokeStyle = s.hi; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x1 - 2.5, y0 + 1.1); g.lineTo(x0 + 2.5, y0 + 1.1);
      g.quadraticCurveTo(x0 + 1.1, y0 + 1.1, x0 + 1.1, y0 + 2.5); g.lineTo(x0 + 1.1, y1 - 3); g.stroke();
      /* and the lower edge sits in its own shade */
      g.globalAlpha = a * (0.45 + 0.55 * b);
      g.strokeStyle = s.lo; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x0 + 3, y1 - 0.8); g.lineTo(x1 - 3, y1 - 0.8); g.stroke();
    }

    function reflect(s, a, oy) {
      var rg = g.createLinearGradient(0, Y0 + 1 + oy, 0, Y0 + 15 + oy);
      rg.addColorStop(0, s.refl); rg.addColorStop(1, A.css(s.c5, 0));
      g.globalAlpha = a; g.fillStyle = rg;
      g.fillRect(s.x0 + 1, Y0 + 1 + oy, s.x1 - s.x0 - 2, 14);
    }
    for (k = 0; k < S.length; k++) if (S[k].off === 0 && al[k] > 0.01) reflect(S[k], al[k] * al[k], 0);
    for (k = 0; k < S.length; k++) if (al[k] > 0.01) faces(S[k], dy[k], al[k] * (0.55 + 0.45 * boost[k]), 1);
    for (k = 0; k < S.length; k++) if (al[k] > 0.01) front(S[k], dy[k], al[k], boost[k]);

    /* --- where the old planner put it, left behind as a ghost -------------- */
    var H = S[HERO];
    if (ghost > 0.01) {
      g.globalAlpha = 1;
      g.fillStyle = A.css(A.co5, 0.16 * ghost);
      g.beginPath(); rr(H.x0 + 0.8, Y(OLD_TOP) + 0.8, H.x1 - 0.8, Y(NEW_TOP) - 0.8, 3); g.fill();
      g.strokeStyle = A.css(A.co7, 0.42 * water); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(XL - 6, Y(OLD_TOP)); g.lineTo(XR + 4, Y(OLD_TOP)); g.stroke();
    }

    /* --- the lid: the arena is as tall as its tallest slab, for every step -- */
    var lidA = sm(rim / 12);
    var rk = sm((rim - NEW_TOP) / 32);
    var rc = A.mix(A.bl7, A.co7, rk);
    var ry = Y(rim);
    g.globalAlpha = lidA;
    g.fillStyle = A.css(rc, 0.1);
    g.beginPath(); g.moveTo(XL - 6, ry); g.lineTo(XR + 4, ry); g.lineTo(XR + 4 + DX, ry + DY); g.lineTo(XL - 6 + DX, ry + DY);
    g.closePath(); g.fill();
    var seat = ring >= 0 ? Math.pow(ring * 3 * Math.exp(1 - ring * 3), 2) : 0;
    g.shadowColor = A.css(rc, 0.5); g.shadowBlur = 6 + 8 * seat;
    g.strokeStyle = A.css(rc, 0.92); g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(XL - 6, ry); g.lineTo(XR + 4, ry); g.stroke();
    g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)';
    g.globalAlpha = 1;

    /* --- the old search, sweeping up from the first live block ------------- */
    if (oldScan > 0) {
      var sa = sm((oldScan - 38) / 8) * (1 - sm((oldScan - NEW_TOP + 10) / 10));
      var sy = Y(oldScan);
      var sg = g.createLinearGradient(0, sy, 0, sy + 22);
      sg.addColorStop(0, A.css(A.am5, 0.34 * sa)); sg.addColorStop(1, A.css(A.am5, 0));
      g.fillStyle = sg;
      g.fillRect(H.x0 + 1, sy, H.x1 - H.x0 - 2, 22);
      g.strokeStyle = A.css(A.am5, 0.95 * sa); g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(H.x0 + 2, sy); g.lineTo(H.x1 - 2, sy); g.stroke();
    }

    /* --- the value itself: stacked, lifted, carried, set in ---------------- */
    if (hA > 0.01) {
      var lx = -3 * lift, ly = -3 * lift, sc = 1 + 0.05 * lift;
      var hy0 = Y(hOff + 32), hy1 = Y(hOff), hcx = (H.x0 + H.x1) / 2, hcy = (hy0 + hy1) / 2;
      if (lift > 0.01) {                          /* its shadow stays on the wall */
        g.globalAlpha = hA * lift;
        g.fillStyle = A.css(A.ink, 0.1);
        g.shadowColor = A.css(A.ink, 0.16); g.shadowBlur = 10;
        g.beginPath(); rr(H.x0 + 3, hy0 + 3, H.x1 + 3, hy1 + 3, 4); g.fill();
        g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)';
      }
      g.save();
      g.translate(hcx + lx, hcy + ly); g.scale(sc, sc); g.translate(-hcx, -hcy);
      var ho = { x0: H.x0, x1: H.x1, off: hOff, z: 32, top: H.top, side: H.side, hi: H.hi, fT: H.fT, fB: H.fB };
      faces(ho, 0, hA, 1 - lift * 0.3);
      g.shadowColor = A.css(A.am5, 0.45); g.shadowBlur = 4 + 10 * lift + 10 * seat;
      var hf = g.createLinearGradient(0, hy0, 0, hy1);
      hf.addColorStop(0, A.css(A.mix(A.am5, [255, 255, 255], 0.25), 1));
      hf.addColorStop(1, A.css(A.am5, 1));
      g.globalAlpha = hA; g.fillStyle = hf;
      g.beginPath(); rr(H.x0 + 0.8, hy0 + 0.8, H.x1 - 0.8, hy1 - 0.8, 3); g.fill();
      g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)';
      g.strokeStyle = A.css(A.am7, 0.7); g.lineWidth = 1.1; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.7;
      g.beginPath();
      for (var m2 = 2; m2 < 31.5; m2 += 2) { var y2 = Y(hOff + m2); g.moveTo(H.x0 + 3, y2); g.lineTo(H.x1 - 3, y2); }
      g.stroke();
      g.strokeStyle = H.hi; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(H.x1 - 3.5, hy0 + 2); g.lineTo(H.x0 + 3.5, hy0 + 2);
      g.quadraticCurveTo(H.x0 + 2, hy0 + 2, H.x0 + 2, hy0 + 3.5); g.lineTo(H.x0 + 2, hy1 - 3); g.stroke();
      g.restore();
      /* standing on the floor, it shows in the floor */
      var onF = sm(1 - hOff / 6) * (1 - lift);
      if (onF > 0.01) reflect(H, hA * onF, 0);
    }

    /* --- set in: one ring leaves the cave, and the lid glows at 112 -------- */
    if (ring >= 0 && ring < 1) {
      var out = 1 - Math.pow(1 - ring, 3), ra = Math.pow(1 - ring, 2) * sm(ring / 0.12);
      var e = 3 + 16 * out;
      g.globalAlpha = 1;
      g.strokeStyle = A.css(A.am5, 0.6 * ra); g.lineWidth = 2;
      g.beginPath(); rr(H.x0 - e, Y(32) - e, H.x1 + e, Y0 + Math.min(e, 5), 6 + e / 2); g.stroke();
    }

    /* --- the time cursor: the step being executed ------------------------ */
    if (cOn > 0.01) {
      var ca = cOn * sm((cx - XL) / 10) * sm((XR - cx) / 10);
      g.globalAlpha = 1;
      var cgr = g.createLinearGradient(0, Y(NEW_TOP), 0, Y0);
      cgr.addColorStop(0, A.css(A.bl7, 0)); cgr.addColorStop(1, A.css(A.bl7, 0.5 * ca));
      g.strokeStyle = cgr; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx, Y(NEW_TOP) + 4); g.lineTo(cx, Y0 + 2); g.stroke();
      g.fillStyle = A.css(A.bl7, 0.85 * ca);
      g.beginPath(); g.arc(cx, Y0 + 4.5, 2.8, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    st.lap = lap;
  }

  /* ==================================================================== */
  /* prune — highway-3244                                                */
  /* ==================================================================== */
  function prune(g, vb, t, st) {
    /* Building a perfect hash, a candidate seed places every key of a bucket
       on a slot, and the builder rejects the seed if two keys share one. The
       old check found out by comparing every pair of keys, for every seed.
       But a key can only ever land inside its own slice: a window of slots
       fixed by its hash alone, whatever the seed. Two keys whose windows do
       not overlap can never share a slot, so comparing them can never find
       anything. The change collects the overlapping pairs once and compares
       only those, and it finds exactly the duplicates the full check found.

       So the slot table is the dotted line along the bottom, each key is a
       bead inside its own translucent window, and every comparison is an arc
       between two keys. An arc's height grows with the distance between the
       two windows, and that is the whole trick in one picture: two windows
       overlap exactly when their arc is lower than the arc of one window's
       width, so the pairs worth comparing are precisely the low arcs hugging
       the table, and every arc above that height is a pair the slice
       structure has already ruled out. The cut is a horizontal line.

       Each cycle runs one seed through both checks. First the old one: a
       front sweeps the keys, each key compares against every key before it,
       a fan of warm arcs fires, and the whole dome of pairs lights up. Then
       the light drains: a curtain falls from the top of the dome and stops
       at the cut, then what is left beneath it fades, and only the low arcs
       stay lit. Then the new check sweeps again and only those low mint
       arcs fire. A duplicate, two beads on one slot, can only happen where
       windows overlap, so the same amber pairs flare in both sweeps.
       Between cycles the beads hop to where the next seed puts them.

       This is an illustration of the mechanism, 48 keys and not a measured
       build. Arcs are cached as one Path2D per key, of every arc that ends
       on that key, and stroked one key at a time so overlapping arcs still
       accumulate. */
    var TAU = Math.PI * 2;
    var N = 48, L = 12, SEED = 143;       /* keys, slice width in units, layout */
    var XL = 26, XR = 444, YB = 388, TOP = 80, GAM = 0.7;
    var BUILD = 1300, CY = 12800, PASS = 4300;
    var OLD = 0, DRAIN = 4900, DRLEN = 1900, NEW = 6900, REST = 11300;

    function hash(i, k) { var s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }

    var G = prune.geo;
    if (!G) {
      G = prune.geo = {};
      /* windows: gaps with a floor and an exponential tail, so keys clump
         the way hashed keys do, and no two windows start at the same place */
      var xs = [0], i, j;
      for (i = 1; i < N; i++) xs.push(xs[i - 1] + 0.35 - Math.log(1 - 0.999 * hash(i, SEED)));
      var sc = (XR - L - XL) / xs[N - 1];
      G.b = xs.map(function (x) { return XL + x * sc; });
      G.c = G.b.map(function (x) { return x + L / 2; });
      var DM = G.c[N - 1] - G.c[0], HM = YB - TOP;
      G.hf = function (d) { return HM * Math.pow(d / DM, GAM); };
      G.cut = G.hf(L);
      /* one path per key of every arc that ends on it: pruned and kept apart */
      G.dome = []; G.keep = []; G.kp = [];
      for (j = 0; j < N; j++) {
        var pd = new Path2D(), pk = new Path2D(), nk = 0;
        for (i = 0; i < j; i++) {
          var d = G.c[j] - G.c[i], p = d < L ? pk : pd;
          p.moveTo(G.c[i], YB);
          p.ellipse((G.c[i] + G.c[j]) / 2, YB, d / 2, G.hf(d), 0, Math.PI, TAU);
          if (d < L) { nk++; G.kp.push([i, j]); }
        }
        G.dome.push(pd); G.keep.push(nk ? pk : null);
      }
      /* when the sweep reaches each key: its progress runs u - sin(2 pi u)/2 pi,
         which leaves and arrives at rest, so invert that once per key */
      G.at = [];
      for (j = 0; j < N; j++) {
        var target = (j + 0.5) / N, lo = 0, hi = 1;
        for (var it = 0; it < 40; it++) {
          var mid = (lo + hi) / 2;
          if (mid - Math.sin(TAU * mid) / TAU < target) lo = mid; else hi = mid;
        }
        G.at.push(lo * PASS);
      }
      /* each seed: where every bead lands, and which overlapping pairs share a slot */
      G.seed = function (k) {
        var s = G.seedCache || (G.seedCache = {});
        if (s[k]) return s[k];
        var pos = [], dup = [], used = {};
        for (var a = 0; a < N; a++) pos.push(G.b[a] + L * (0.14 + 0.72 * hash(a, k * 3 + 7)));
        for (var m = 0; m < 2; m++) {
          var q = G.kp[Math.floor(hash(k, 11 + m * 5) * G.kp.length)];
          if (used[q[0]] || used[q[1]]) continue;
          used[q[0]] = used[q[1]] = 1;
          var lo2 = G.b[q[1]], hi2 = G.b[q[0]] + L;
          pos[q[0]] = pos[q[1]] = lo2 + (hi2 - lo2) * (0.3 + 0.4 * hash(k, 23 + m));
          dup.push(q);
        }
        var keys = Object.keys(s);
        if (keys.length > 6) delete s[keys[0]];
        return (s[k] = { pos: pos, dup: dup });
      };
    }

    var RED = REDUCED;
    var blue = token('--blue-500', '#2456dc'), blue7 = token('--blue-700', '#163a9a');
    var mint = token('--mint-500', '#0b93ab'), mint7 = token('--mint-700', '#0a6b7c');
    var coral = token('--coral-500', '#d9376e'), violet = token('--violet-500', '#a66cf0');
    var amber = token('--amber-500', '#d96a06'), amber7 = token('--amber-700', '#9a4906');
    var hair = token('--hair2', '#cfcbc1'), muted = token('--muted', '#5f5b53');

    /* --- time ---------------------------------------------------------- */
    var c = RED ? 0 : t - BUILD, k = 0;
    if (c >= 0) { k = Math.floor(c / CY); c -= k * CY; }
    function swell(tau, w) {             /* (s e^(1-s))^2: leaves zero with zero slope */
      if (tau <= 0) return 0;
      var s = tau / w; return s * s * Math.exp(2 - 2 * s);
    }
    function sweep(p0) {                 /* where the front is, as an x on the table */
      var u = (c - p0) / PASS;
      if (u <= 0 || u >= 1) return null;
      var f = (u - Math.sin(TAU * u) / TAU) * N - 0.5;
      var f0 = Math.max(0, Math.min(N - 2, Math.floor(f)));
      return G.c[f0] + (G.c[f0 + 1] - G.c[f0]) * Math.max(0, Math.min(1, f - f0));
    }
    var inOld = !RED && c >= OLD && c < DRAIN + DRLEN;
    var inNew = !RED && c >= NEW && c < REST + 900;
    /* the curtain falls to the cut, then what is left under it fades */
    var curtain = c < DRAIN ? TOP - 12 : TOP - 12 + (YB - G.cut - TOP + 12) * ease((c - DRAIN) / (DRLEN * 0.62));
    var under = c < DRAIN + DRLEN * 0.55 ? 1 : 1 - ease((c - DRAIN - DRLEN * 0.55) / (DRLEN * 0.45));
    /* the dome goes quiet while the new check runs, and wakes for the next old one */
    var quiet = RED ? 0.3 : c < 0 ? 0.3 : 0.3 - 0.2 * (ease((c - DRAIN) / 1400) - ease((c - REST) / 1400));
    /* the low band brightens once the dome above it has drained */
    var band = RED ? 1 : c < 0 ? 0.4 : 0.4 + 0.6 * (ease((c - DRAIN - DRLEN * 0.5) / 900) - ease((c - REST - 200) / 1300));
    var S = G.seed(k), S2 = G.seed(k + 1);
    var hop = RED || c < REST + 400 ? 0 : ease((c - REST - 400) / 1100);
    var j, fl, x;
    function hex3(h) {
      h = h.trim().replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var v = parseInt(h, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* The dome never changes shape, so it is rasterised once, off screen, at
       this canvas's own pixel scale, and blitted. Stroking its 1,081 arcs
       every frame held 8 to 20 frames a second in the preview; a blit is one
       draw call. The quiet dome is one bitmap. The lit dome is a second one
       that the old check fills in as it goes: each key's fan is stroked into
       it once, when the sweep reaches that key. */
    var tr = g.getTransform ? g.getTransform() : null;
    var PX = +((tr ? Math.hypot(tr.a, tr.b) : g.canvas.width / vb[0]) || 1).toFixed(3);
    var BX = XL - 6, BY = TOP - 6, BW = XR - XL + 12, BH = YB + 3 - BY;
    function layer(name) {
      var o = st[name];
      if (!o || o.px !== PX) {
        o = st[name] = { cv: document.createElement('canvas'), px: PX, n: -1, k: -1 };
        o.cv.width = Math.ceil(BW * PX); o.cv.height = Math.ceil(BH * PX);
        o.g = o.cv.getContext('2d');
        o.g.setTransform(PX, 0, 0, PX, -BX * PX, -BY * PX);
        o.g.lineCap = 'round'; o.g.lineJoin = 'round';
      }
      return o;
    }
    /* blit the band of a layer between y0 and y1, in viewBox units */
    function blit(o, y0, y1, a) {
      y0 = Math.max(BY, y0); y1 = Math.min(BY + BH, y1);
      if (y1 <= y0 || a <= 0.004) return;
      g.globalAlpha = Math.min(1, a);
      g.drawImage(o.cv, 0, (y0 - BY) * PX, o.cv.width, (y1 - y0) * PX, BX, y0, o.cv.width / PX, y1 - y0);
      g.globalAlpha = 1;
    }
    /* a layer whose top edge is soft: full below yc + fw, tapering to 0 at yc */
    function soft(o, yc, a, fw, nb) {
      blit(o, yc + fw, BY + BH, a);
      for (var b2 = 0; b2 < nb; b2++) blit(o, yc + b2 * fw / nb, yc + (b2 + 1) * fw / nb, a * ease((b2 + 0.5) / nb));
    }
    var cA = hex3(coral), cB = hex3(violet);
    function warm(gg) {                  /* warm at the table, cooling toward the top */
      var gr = gg.createLinearGradient(0, YB, 0, TOP - 12);
      gr.addColorStop(0, coral); gr.addColorStop(0.45, coral); gr.addColorStop(1, violet);
      return gr;
    }

    var Q0 = layer('quiet');
    if (Q0.n < 0) {
      Q0.g.lineWidth = 0.8; Q0.g.strokeStyle = rgba(hair, 0.3);
      for (j = 1; j < N; j++) Q0.g.stroke(G.dome[j]);
      Q0.n = N;
    }
    /* the dome, every pair, quiet. It rises from the table as the keys arrive */
    var rise = RED || t >= BUILD ? -1e9 : YB - 30 - (YB - TOP + 50) * ease(t / BUILD);
    soft(Q0, rise, (quiet + 0.02) / 0.3, 64, 10);

    /* the old check: each key's fan fires as the sweep reaches it, and the
       compared dome stays lit until the curtain takes it */
    if (RED || inOld) {
      var L0 = layer('lit'), reach = 0;
      for (j = 0; j < N; j++) if (RED || c - OLD - G.at[j] > 60) reach = j + 1;
      if (L0.k !== k || reach < L0.n) {
        L0.g.clearRect(BX, BY, BW, BH); L0.n = 1; L0.k = k;
      }
      if (reach > L0.n) {
        L0.g.lineWidth = 0.8; L0.g.strokeStyle = warm(L0.g); L0.g.globalAlpha = 0.2;
        for (j = L0.n; j < reach; j++) L0.g.stroke(G.dome[j]);
        L0.g.globalAlpha = 1; L0.n = reach;
      }
      if (RED) blit(L0, BY, BY + BH, 0.9);
      else soft(L0, c >= DRAIN ? curtain : -1e9, under, 22, 6);
      /* the fans that have just fired, bright over the afterglow: the two
         newest only, since each is up to 47 long arcs and older ones are
         already in the lit layer */
      if (!RED) {
        g.strokeStyle = warm(g);
        var jf = N - 1;
        while (jf >= 1 && c - OLD - G.at[jf] <= 0) jf--;
        for (var nf = 0; jf >= 1 && nf < 2; jf--, nf++) {
          fl = swell(c - OLD - G.at[jf], 120);
          if (fl < 0.06) continue;
          g.globalAlpha = 0.62 * fl; g.lineWidth = 0.8 + 0.6 * fl;
          g.stroke(G.dome[jf]);
        }
        g.globalAlpha = 1;
      }
    }

    /* the sweep front, a soft light travelling the table */
    var fx = inOld ? sweep(OLD) : inNew ? sweep(NEW) : null;
    if (fx != null) {
      var rg = g.createRadialGradient(fx, YB, 0, fx, YB, 17);
      var fc = c < DRAIN ? coral : mint;
      rg.addColorStop(0, rgba(fc, 0.3)); rg.addColorStop(1, rgba(fc, 0));
      g.fillStyle = rg;
      g.beginPath(); g.arc(fx, YB, 17, 0, TAU); g.fill();
    }

    /* the slot table, and each key's window: a slice it cannot leave */
    g.setLineDash([0.01, 2.6]);
    g.lineWidth = 1.3;
    g.strokeStyle = rgba(muted, 0.55);
    g.beginPath(); g.moveTo(XL - 6, YB); g.lineTo(XR + 6, YB); g.stroke();
    g.setLineDash([]);
    g.lineWidth = 7;
    for (j = 0; j < N; j++) {
      var w = RED ? 1 : 0.4 + 0.6 * ease((t - j * 12) / 520);
      var hw = (L / 2 - 3.5) * w;
      g.strokeStyle = rgba(blue, 0.26 * w);
      g.beginPath(); g.moveTo(G.c[j] - hw, YB); g.lineTo(G.c[j] + hw + 0.01, YB); g.stroke();
    }

    /* the kept arcs, the only comparisons the new check makes, with a glow */
    for (j = 1; j < N; j++) {
      if (!G.keep[j]) continue;
      var fo = inOld ? swell(c - OLD - G.at[j], 170) : 0;
      var fn = inNew ? swell(c - NEW - G.at[j], 170) : 0;
      fl = Math.max(fo, fn);
      var kb = RED ? 1 : Math.min(1, ease(t / BUILD));
      /* each hoop holds a little light of its own, so the band glows */
      g.fillStyle = rgba(mint, (0.05 + 0.1 * band + 0.22 * fl) * kb);
      g.fill(G.keep[j]);
      if (band + fl > 0.5) {
        g.lineWidth = 5 + 3 * fl;
        g.strokeStyle = rgba(mint, (0.1 * band + 0.14 * fl) * kb);
        g.stroke(G.keep[j]);
      }
      g.lineWidth = 1.4 + 1.1 * fl;
      g.strokeStyle = rgba(fn > 0.05 ? mint : mint7, Math.min(1, (0.3 + 0.5 * band + 0.4 * fl) * kb));
      g.stroke(G.keep[j]);
    }

    /* duplicates: two beads on one slot. Both checks find them, at the same key */
    var q, n, dups = S.dup;
    for (n = 0; n < dups.length; n++) {
      q = dups[n];
      var ta = c - OLD - G.at[q[1]], tb = c - NEW - G.at[q[1]];
      var env = RED ? 1 : (ta > 0 ? ease(ta / 300) * (1 - 0.4 * ease((ta - 500) / 900)) : 0);
      if (!RED && tb > 0) env = Math.max(env, 0.6 + 0.4 * swell(tb, 280));
      env *= 1 - hop;
      if (env <= 0.01) continue;
      var d0 = G.c[q[1]] - G.c[q[0]];
      g.lineWidth = 2.3;
      g.strokeStyle = rgba(amber, 0.95 * env);
      g.beginPath(); g.moveTo(G.c[q[0]], YB);
      g.ellipse((G.c[q[0]] + G.c[q[1]]) / 2, YB, d0 / 2, G.hf(d0), 0, Math.PI, TAU);
      g.stroke();
    }

    /* the beads: where this seed puts each key, glinting as a sweep passes */
    g.fillStyle = rgba(blue7, 1);
    for (j = 0; j < N; j++) {
      x = S.pos[j] + (S2.pos[j] - S.pos[j]) * hop;
      var hb = Math.max(inOld ? swell(c - OLD - G.at[j], 170) : 0, inNew ? swell(c - NEW - G.at[j], 170) : 0);
      var bw = RED ? 1 : ease((t - 150 - j * 12) / 420);
      if (bw <= 0) continue;
      if (hb > 0.02) {
        g.fillStyle = rgba(blue, 0.24 * hb);
        g.beginPath(); g.arc(x, YB, 3 + 5 * hb, 0, TAU); g.fill();
        g.fillStyle = rgba(blue7, 1);
      }
      g.beginPath(); g.arc(x, YB, 2.3 * bw + 0.8 * hb, 0, TAU); g.fill();
    }
    for (n = 0; n < dups.length; n++) {
      q = dups[n];
      var sx = S.pos[q[0]], tA = c - OLD - G.at[q[1]], tB = c - NEW - G.at[q[1]];
      var mark = (RED ? 1 : ease(tA / 300)) * (1 - hop);
      if (mark > 0.01) {
        g.fillStyle = rgba(amber7, mark);
        g.beginPath(); g.arc(sx, YB, 3.1, 0, TAU); g.fill();
        g.strokeStyle = rgba(amber, 0.85 * mark); g.lineWidth = 1.8;
        g.beginPath(); g.arc(sx, YB, 6.5, 0, TAU); g.stroke();
      }
      /* the ring each check sends out when it finds this pair */
      var rings = RED ? [] : [tA, tB];
      for (var r2 = 0; r2 < rings.length; r2++) {
        var kk = rings[r2] / 1300;
        if (kk <= 0 || kk >= 1) continue;
        var out = 1 - (1 - kk) * (1 - kk) * (1 - kk);
        g.strokeStyle = rgba(amber, 0.75 * (1 - kk) * (1 - kk) * ease(kk / 0.12));
        g.lineWidth = 2;
        g.beginPath(); g.arc(sx, YB, 7 + 6 * out, 0, TAU); g.stroke();
      }
    }
  }

  /* ==================================================================== */
  /* schedule — triton-kernels-22                                        */
  /* ==================================================================== */
  function schedule(g, vb, t, st) {
    /* A causal attention matrix, 16 query blocks by 16 key blocks, laid down
       as a floor in perspective: queries run from the far edge toward the
       viewer, keys run left to right, and only the lower triangle exists.
       Every query is a ridgeline across that floor, and the height of the
       ridge over a key is how strongly that query attends to it.

       The schedule is the kernel's input: for every query block, a sorted
       list of the key blocks it may read. It holds the sink column (block
       0), the local window (the diagonal block and the one before it), and
       the key blocks with the highest salience, which every later query
       block reads too, so they run down the floor as whole columns.

       Salience is topology. Up in the empty half of the matrix sit the
       sixteen key-block centroids. Discs grow round every centroid at once,
       and two groups join when their discs touch: that is 0D persistence,
       single linkage in the order of distance. A block's salience is the
       distance at which its group was swallowed by a bigger one, so the
       blocks whose centroids stand apart from the rest keep their own disc
       longest. The two last to join are picked, and a pulse runs from each
       down to its column of the floor.

       Then the kernel launches one program per query block, all at once.
       Each walks its own list in order: it loads a key block, that tile's
       scores are computed, and the ridges over the tile rise out of the
       floor as it is folded into the program's running softmax. Then it
       jumps straight to the next scheduled block, over the ones it skips,
       which stay flat and grey because they are never computed. A program
       glows larger as it accumulates, and when its list is done it writes
       its output and leaves a coral bead at the end of its row, so the
       outputs finish as a chain along the diagonal, the longer lists last.
       Then the terrain sinks back into the floor and it all runs again.

       The centroids and the attention values are an illustration, shaped
       the way a sink, a local window and salient keys shape real attention.
       The schedule, the salience rule, the launch and the order of the walk
       follow the kernel. */
    var TAU = Math.PI * 2;
    var NB = 16, KS = 8, QS = 4;           /* blocks, key samples and query rows per block */
    var NK = NB * KS, NR = NB * QS;
    var XC = 236, WN = 416, YN = 402, HS = 640, DD = 0.74, HZ = 50;
    var SAL = [4, 10];                     /* the two blocks the filtration below picks */
    var BUILD = 1300, CY = 10600;
    var FIL = 1700, PULSE = 650, T1 = 2400, STEP = 950, HOP = 300, COMP = 560;
    var HOLD = 7400, SINK = 8700, SLEN = 1500;
    /* the centroid cloud, in the upper right */
    var CCX = 352, CCY = 150;

    function hash(i, k) { var s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }

    var G = schedule.geo;
    if (!G) {
      G = schedule.geo = {};
      /* the CSR schedule, exactly as the builder makes it: sink, local radius
         one, and the salience blocks at or before each query block */
      G.rows = [];
      for (var q = 0; q < NB; q++) {
        var set = {}; set[0] = 1; set[q] = 1; if (q > 0) set[q - 1] = 1;
        for (var s0 = 0; s0 < SAL.length; s0++) if (SAL[s0] <= q) set[SAL[s0]] = 1;
        G.rows.push(Object.keys(set).map(Number).sort(function (a, b) { return a - b; }));
      }
      /* attention of query position Qp on key k: a sink, a local window,
         the two salient keys, and a low ripple of everything else */
      G.v = new Float32Array(NR * (NK + 1));
      for (var r = 0; r < NR; r++) {
        var Qp = 2 * r + 1;
        for (var k = 0; k <= Qp; k++) {
          var v = 1.0 * Math.exp(-k / 1.6) + 0.8 * Math.exp(-(Qp - k) / 4) +
                  0.72 * Math.exp(-Math.pow((k - 36.5) / 1.4, 2)) + 0.64 * Math.exp(-Math.pow((k - 84.5) / 1.4, 2)) +
                  0.05 + 0.09 * (0.5 + 0.5 * Math.sin(k * 0.9 + Qp * 0.37) * Math.sin(k * 0.23 - Qp * 0.61));
          G.v[r * (NK + 1) + k] = Math.min(1.1, v);
        }
      }
      G.px = new Float32Array(NR * (NK + 1)); G.py = new Float32Array(NR * (NK + 1));
      /* sixteen centroids: three tight groups, and blocks 4 and 10 apart */
      var home = { 4: [-62, -44], 10: [70, -34] };
      var grp = [[0, 1, 2, 3, 5], [6, 7, 8, 9], [11, 12, 13, 14, 15]];
      var at = [[-34, 30], [8, -8], [40, 40]];
      G.cx = []; G.cy = [];
      for (var b = 0; b < NB; b++) { G.cx.push(0); G.cy.push(0); }
      for (var gi = 0; gi < grp.length; gi++) {
        for (var m = 0; m < grp[gi].length; m++) {
          var bb = grp[gi][m], an = hash(bb, 3) * TAU, rr = 5 + 11 * hash(bb, 5);
          G.cx[bb] = CCX + at[gi][0] + rr * Math.cos(an); G.cy[bb] = CCY + at[gi][1] + rr * Math.sin(an);
        }
      }
      G.cx[4] = CCX + home[4][0]; G.cy[4] = CCY + home[4][1];
      G.cx[10] = CCX + home[10][0]; G.cy[10] = CCY + home[10][1];
      /* single linkage, as the salience score runs it: edges by distance,
         union-find, and the smaller side takes the merge distance */
      var E = [];
      for (var i = 0; i < NB; i++) for (var j = i + 1; j < NB; j++) E.push([Math.hypot(G.cx[i] - G.cx[j], G.cy[i] - G.cy[j]), i, j]);
      E.sort(function (a, b) { return a[0] - b[0]; });
      var par = [], mem = [];
      for (i = 0; i < NB; i++) { par.push(i); mem.push([i]); }
      function find(x) { while (par[x] !== x) x = par[x] = par[par[x]]; return x; }
      G.mst = []; G.sal = new Float32Array(NB);
      for (var e = 0; e < E.length; e++) {
        var ra = find(E[e][1]), rb2 = find(E[e][2]);
        if (ra === rb2) continue;
        if (mem[ra].length > mem[rb2].length) { var tmp = ra; ra = rb2; rb2 = tmp; }
        for (var mm = 0; mm < mem[ra].length; mm++) G.sal[mem[ra][mm]] = E[e][0];
        par[ra] = rb2; mem[rb2] = mem[rb2].concat(mem[ra]); mem[ra] = [];
        G.mst.push(E[e]);
      }
      G.dmax = G.mst[G.mst.length - 1][0];
    }

    var RED = REDUCED;
    var violet = token('--violet-500', '#a66cf0'), violet7 = token('--violet-700', '#6b35c4');
    var amber = token('--amber-500', '#d96a06'), coral = token('--coral-500', '#d9376e'), coral7 = token('--coral-700', '#a0183f');
    var hair = token('--hair2', '#cfcbc1'), ground = token('--ground', '#fbfaf7');

    /* --- the floor in perspective: depth d runs 1 near to 1 + DD far ---- */
    function D(u) { return 1 + DD * (1 - u); }                 /* u: 0 far edge, 1 near edge */
    function X(k, u) { return XC + (k / NK - 0.5) * WN / D(u); }
    function Y(u) { return YN - HS + HS / D(u); }
    function S(u) { return 1 / D(u); }
    function uRow(r) { return (r + 0.5) / NR; }                /* a query row */
    function uEdge(rr) { return rr / NR; }                      /* between rows */

    /* --- time ---------------------------------------------------------- */
    var c = RED ? 0 : t - BUILD, cyc = 0;
    if (c >= 0) { cyc = Math.floor(c / CY); c -= cyc * CY; }
    var build = RED ? 1 : 0.35 + 0.65 * ease(t / BUILD);
    function swell(tau, w) {             /* (s e^(1-s))^2: leaves zero with zero slope */
      if (tau <= 0) return 0;
      var s = tau / w; return s * s * Math.exp(2 - 2 * s);
    }
    var sinkAll = RED || c < SINK ? 1 : 1 - ease((c - SINK) / SLEN);
    /* how far a tile has risen: its program reaches it at step s */
    function grown(rb, s) {
      if (RED) return 1;
      if (c < T1) return 0;
      var t0 = T1 + s * STEP + (s > 0 ? HOP : 0);
      var sink = c < SINK ? 1 : 1 - ease((c - SINK - (NB - 1 - rb) * 30) / SLEN);
      return ease((c - t0) / COMP) * sink;
    }
    var breathe = RED || c < HOLD ? 1 : 1 + 0.04 * Math.sin((c - HOLD) / 1300 * Math.PI) * (c < SINK ? 1 : 0);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    var rb, s, kb, k, r, u;
    function quad(kb0, kb1, rb0, rb1) {
      var ua = uEdge(rb0 * QS), ub = uEdge(rb1 * QS);
      g.moveTo(X(kb0 * KS, ua), Y(ua)); g.lineTo(X(kb1 * KS, ua), Y(ua));
      g.lineTo(X(kb1 * KS, ub), Y(ub)); g.lineTo(X(kb0 * KS, ub), Y(ub)); g.closePath();
    }

    /* --- the salience filtration, up in the empty half ------------------ */
    var RM = G.dmax / 2 + 6;
    var grow = RED ? RM : c < 0 ? 0 : RM * ease(c / FIL);   /* monotone: the merges it has reached */
    var rho = RED ? 15 : c < 0 ? 0 : c < FIL ? grow : c < SINK ? RM - (RM - 15) * ease((c - FIL - 250) / 800) : 15 * (1 - ease((c - SINK) / SLEN));
    var cloudA = RED ? 1 : ease((t - 300) / 700);
    var picked = RED ? 1 : c < FIL * 0.9 ? 0 : ease((c - FIL * 0.9) / 300) * sinkAll;
    for (var b = 0; b < NB; b++) {
      if (rho < 0.5) break;
      var dg = g.createRadialGradient(G.cx[b], G.cy[b], 0, G.cx[b], G.cy[b], rho);
      dg.addColorStop(0, rgba(violet, 0.16 * cloudA)); dg.addColorStop(0.8, rgba(violet, 0.1 * cloudA)); dg.addColorStop(1, rgba(violet, 0));
      g.fillStyle = dg;
      g.beginPath(); g.arc(G.cx[b], G.cy[b], rho, 0, TAU); g.fill();
    }
    /* the merges, drawn as the discs touch, each with a soft glow under it */
    for (var e2 = 0; e2 < G.mst.length; e2++) {
      var me = G.mst[e2], ja = ease((2 * grow - me[0]) / 8) * sinkAll;
      if (ja <= 0) continue;
      var ax = G.cx[me[1]], ay = G.cy[me[1]], bx = G.cx[me[2]], by = G.cy[me[2]];
      var ex2 = ax + (bx - ax) * ja, ey2 = ay + (by - ay) * ja;
      g.strokeStyle = rgba(violet, 0.16 * ja * cloudA); g.lineWidth = 7;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex2, ey2); g.stroke();
      g.strokeStyle = rgba(violet7, 0.75 * ja * cloudA); g.lineWidth = 2;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex2, ey2); g.stroke();
    }
    for (b = 0; b < NB; b++) {
      var sel = (b === SAL[0] || b === SAL[1]) ? picked : 0;
      if (sel > 0.01) {
        g.strokeStyle = rgba(violet7, 0.9 * sel); g.lineWidth = 2;
        g.beginPath(); g.arc(G.cx[b], G.cy[b], 7.5, 0, TAU); g.stroke();
      }
      g.fillStyle = rgba(violet7, cloudA);
      g.beginPath(); g.arc(G.cx[b], G.cy[b], 3 + 0.8 * sel, 0, TAU); g.fill();
    }

    /* --- the floor: the causal triangle, and the schedule on it --------- */
    g.fillStyle = rgba(hair, 0.26 * build);
    g.beginPath();
    for (rb = 0; rb < NB; rb++) quad(0, rb + 1, rb, rb + 1);
    g.fill();
    /* a pulse from each picked centroid to the far end of its column */
    for (var p = 0; p < 2; p++) {
      var sb = SAL[p], tp = RED ? 1 : (c - FIL) / PULSE;
      if (RED || tp <= 0 || tp >= 1.4) continue;
      var u0 = uEdge(sb * QS), ex = X((sb + 0.5) * KS, u0), ey = Y(u0);
      var sx = G.cx[sb], sy = G.cy[sb], mx = (sx + ex) / 2 - 30, my = Math.min(sy, ey) - 10;
      var hd = ease(Math.min(1, tp)), tl = Math.max(0, hd - 0.35);
      var pa = 1 - ease((tp - 1) / 0.4);
      g.strokeStyle = rgba(violet7, 0.85 * pa);
      g.lineWidth = 2.8;
      g.beginPath();
      for (var z = 0; z <= 16; z++) {
        var w2 = tl + (hd - tl) * z / 16, iw = 1 - w2;
        var qx = iw * iw * sx + 2 * iw * w2 * mx + w2 * w2 * ex, qy = iw * iw * sy + 2 * iw * w2 * my + w2 * w2 * ey;
        if (z === 0) g.moveTo(qx, qy); else g.lineTo(qx, qy);
      }
      g.stroke();
      g.fillStyle = rgba(violet7, pa);
      g.beginPath(); g.arc(qx, qy, 3.4, 0, TAU); g.fill();
      g.fillStyle = rgba(violet, 0.25 * pa);
      g.beginPath(); g.arc(qx, qy, 9, 0, TAU); g.fill();
    }
    for (rb = 0; rb < NB; rb++) {
      var row = G.rows[rb];
      for (s = 0; s < row.length; s++) {
        kb = row[s];
        /* the schedule draws itself: sink first, then the window, then the salience columns */
        var kind = kb === 0 ? 0 : kb >= rb - 1 ? 1 : 2;
        var bt = RED || (kind === 2 && cyc > 0) ? 1 : kind < 2 ? ease((t - 150 - kind * 350 - rb * 24) / 500) :
                 ease((c - FIL - PULSE * 0.8 - (rb - kb) * 45) / 380);
        var gr = grown(rb, s);
        var fl = RED ? 0 : swell(c - T1 - s * STEP - (s > 0 ? HOP : 0), 260);
        var a = (0.12 + 0.14 * gr + 0.22 * fl) * bt;
        if (a <= 0.005) continue;
        g.fillStyle = rgba(fl > 0.3 ? amber : violet, a);
        g.beginPath(); quad(kb + 0.05, kb + 0.95, rb + 0.03, rb + 0.97); g.fill();
      }
    }

    /* --- ridgelines, far to near --------------------------------------- */
    for (r = 0; r < NR; r++) {
      rb = (r / QS) | 0;
      u = uRow(r);
      var sc = S(u), yb = Y(u), Qp = 2 * r + 1, o = r * (NK + 1), row2 = G.rows[rb], hmax = 0;
      for (k = 0; k <= Qp; k++) {
        kb = (k / KS) | 0; if (kb > rb) kb = rb;
        var gk = 0;
        for (s = 0; s < row2.length; s++) if (row2[s] === kb) { gk = grown(rb, s); break; }
        var h = G.v[o + k] * gk * HZ * sc * breathe;
        G.px[o + k] = X(k, u); G.py[o + k] = yb - h;
        if (h > hmax) hmax = h;
      }
      if (hmax > 0.3) {
        /* the ridge body: paper that hides what is behind it, then heat */
        g.beginPath(); g.moveTo(G.px[o], yb);
        for (k = 0; k <= Qp; k++) g.lineTo(G.px[o + k], G.py[o + k]);
        g.lineTo(G.px[o + Qp], yb); g.closePath();
        g.fillStyle = ground; g.fill();
        var hg = g.createLinearGradient(0, yb, 0, yb - HZ * sc);
        hg.addColorStop(0, rgba(violet, 0.05)); hg.addColorStop(1, rgba(violet, 0.55));
        g.fillStyle = hg; g.fill();
      }
      /* grey at the floor for the whole row; violet over every tile a
         program has computed, fading in and out with that tile */
      g.lineWidth = 0.7 + 0.6 * u;
      g.strokeStyle = rgba(hair, 0.7 * build);
      g.beginPath(); g.moveTo(G.px[o], yb); g.lineTo(G.px[o + Qp], yb); g.stroke();
      g.lineWidth = 0.9 + 0.7 * u;
      for (s = 0; s < row2.length; s++) {
        var gt = grown(rb, s);
        if (gt <= 0.004) continue;
        var k0 = row2[s] * KS, k1 = Math.min(Qp, k0 + KS);
        g.strokeStyle = rgba(violet7, 0.9 * Math.min(1, gt * 3));
        g.beginPath(); g.moveTo(G.px[o + k0], G.py[o + k0]);
        for (k = k0 + 1; k <= k1; k++) g.lineTo(G.px[o + k], G.py[o + k]);
        g.stroke();
      }
    }

    /* --- the programs, one per query block ----------------------------- */
    for (rb = 0; rb < NB; rb++) {
      var list = G.rows[rb], n = list.length;
      var uf = uEdge(rb * QS + QS) + 0.004, ufy = Y(uf), fs = S(uf);
      var tEnd = T1 + n * STEP;
      var ox = X((rb + 1) * KS + 2.5, uf), oy = ufy;
      if (!RED && c >= T1 - 300 && c < tEnd) {
        var sNow = Math.min(n - 1, Math.max(0, Math.floor((c - T1) / STEP)));
        var into = c - T1 - sNow * STEP;
        var kFrom = sNow > 0 ? list[sNow - 1] : list[0], kTo = list[sNow];
        var hk = sNow > 0 ? ease(into / HOP) : 1;
        var hx = X((kFrom + (kTo - kFrom) * hk + 0.5) * KS, uf), hy = ufy;
        var acc = Math.max(0, Math.min(n, (c - T1 - HOP) / STEP + 0.5)) / 5;
        var on2 = ease((c - T1 + 300) / 300);
        /* the jump over skipped blocks, a streak that fades behind it */
        if (sNow > 0 && into < HOP + 260 && kTo - kFrom > 1) {
          var x0 = X((kFrom + 0.5) * KS, uf);
          var sg = g.createLinearGradient(x0, 0, hx, 0);
          sg.addColorStop(0, rgba(amber, 0)); sg.addColorStop(1, rgba(amber, 0.6 * (1 - ease((into - HOP) / 260))));
          g.strokeStyle = sg; g.lineWidth = 2.6 * fs;
          g.beginPath(); g.moveTo(x0, hy); g.lineTo(hx, hy); g.stroke();
        }
        var rh = (7 + 7 * acc) * fs;
        var hgr = g.createRadialGradient(hx, hy, 0, hx, hy, rh);
        hgr.addColorStop(0, rgba(amber, 0.42 * on2)); hgr.addColorStop(1, rgba(amber, 0));
        g.fillStyle = hgr;
        g.beginPath(); g.arc(hx, hy, rh, 0, TAU); g.fill();
        g.fillStyle = rgba(amber, on2);
        g.beginPath(); g.arc(hx, hy, (2.6 + 1.2 * acc) * fs, 0, TAU); g.fill();
      }
      /* written: a ring goes out, and the output stays at the row's end */
      var ob = RED ? 1 : c > tEnd - 100 ? ease((c - tEnd + 100) / 300) * sinkAll : 0;
      if (!RED && c > tEnd - 100) {
        var kk = (c - tEnd + 100) / 1000;
        if (kk < 1) {
          g.strokeStyle = rgba(coral, 0.75 * (1 - kk) * (1 - kk) * ease(kk / 0.15));
          g.lineWidth = 2;
          g.beginPath(); g.arc(ox, oy, (5 + 13 * (1 - (1 - kk) * (1 - kk))) * fs, 0, TAU); g.stroke();
        }
      }
      if (ob > 0.01) {
        /* when the last program has written, light runs down the chain */
        var wv = RED ? 0 : swell(c - T1 - 5 * STEP - 250 - rb * 60, 240);
        g.fillStyle = rgba(coral, (0.22 + 0.3 * wv) * ob);
        g.beginPath(); g.arc(ox, oy, (7 + 5 * wv) * fs, 0, TAU); g.fill();
        g.fillStyle = rgba(coral7, ob);
        g.beginPath(); g.arc(ox, oy, 3.2 * fs, 0, TAU); g.fill();
      }
    }
  }

  var RENDER = { caustic: caustic, units: units, funnel: funnel,
                 transport: transport, collapse: collapse,
                 witness: witness, gather: gather,
                 refuse: refuse, cut: cut, certify: certify,
                 smatrix: smatrix,
                 settle: settle,
                 chain: chain,
                 hull: hull,
                 arena: arena,
                 prune: prune,
                 schedule: schedule };

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
