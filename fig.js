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
  /* collapse — epsilon-hollow                                           */
  /* ==================================================================== */
  function collapse(g, vb, t, st) {
    /* Epsilon-Hollow. OS state is topology on S2: memory, files and the
       scheduler live as points on the unit sphere, and the kernel's day job
       is machine learning. So the figure is a hollow world: the sphere is a
       shell of light, a real triangulation with nothing filled in, so the far
       wall and the bare metal burning at the centre are seen straight through
       it. Its points are coloured by territory (memory blue, files violet,
       scheduler mint), its film shimmers like a bubble's, and a ring of token
       traffic orbits it.

       Eviction is what the card says: a point folds onto its neighbour. It
       is an honest edge contraction. The pair is the shortest edge whose ends
       share exactly two neighbours, so the result is still a sphere, and no
       face may turn inside out; the more crowded end slides onto the other
       and the two triangles between them fold flat, drawn coral, the only
       filled shapes in the figure. A hundred of them turn a fine crystal into
       a coarse gem that is a sphere at every step. A band of light then sweeps
       it pole to pole, and the ring feeds it back: each point returns out of
       the neighbour it folded into, in the reverse order.

       Inside it hangs Epsilon: a second, finer hollow sphere, the receptacle
       of the context teleport, turning the other way round the bare metal.
       A file's payload is a small cloud of points on the surface. To move it
       the kernel does not walk it along the sphere; it gathers, dives through
       the hollow on a thread of light, passes the receptacle as the governor
       grants its one-shot permit, and comes up whole on the far side. Every
       jump takes the same time however far it goes: the payload is not
       copied, only its place is rewired.

       Only the clock is scheduled; the mesh, the victims and their order are
       computed when the figure is first drawn. The territories and the ring
       are illustrative. */
    var TAU = Math.PI * 2;
    var CX = 235, CY = 252, R = 154, TILT = 0.36, ROLL = -0.17;
    var D = 720, PS = 1500;

    var M = collapse.cache;
    if (!M) {
      /* built whole, then published */
      var C = {};
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var mix = function (a, b, k) {
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      };
      var rgb = function (c, a) {
        return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')';
      };
      var WH = [255, 255, 255];
      C.mix = mix; C.rgb = rgb; C.WH = WH;
      C.b5 = hex('--blue-500', '#2456dc'); C.b7 = hex('--blue-700', '#163a9a');
      C.v5 = hex('--violet-500', '#a66cf0'); C.m5 = hex('--mint-500', '#0b93ab');
      C.c5 = hex('--coral-500', '#d9376e'); C.a5 = hex('--amber-500', '#d96a06');
      C.terrCol = [C.b5, C.v5, C.m5];

      var norm = function (p) {
        var l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
        return [p[0] / l, p[1] / l, p[2] / l];
      };
      var sub = function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; };
      var cross = function (a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      };
      var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
      C.norm = norm; C.cross = cross; C.sub = sub;

      /* the sphere: an icosahedron subdivided twice, 162 points, 320 faces */
      var gr = (1 + Math.sqrt(5)) / 2;
      var V = [[-1, gr, 0], [1, gr, 0], [-1, -gr, 0], [1, -gr, 0], [0, -1, gr], [0, 1, gr],
               [0, -1, -gr], [0, 1, -gr], [gr, 0, -1], [gr, 0, 1], [-gr, 0, -1], [-gr, 0, 1]].map(norm);
      var F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
               [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
               [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      var s, f, i, j;
      for (s = 0; s < 2; s++) {
        var mid = {}, NF = [];
        var mp = function (a, b) {
          var key = a < b ? a + '_' + b : b + '_' + a;
          if (mid[key] == null) {
            mid[key] = V.length;
            V.push(norm([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2]));
          }
          return mid[key];
        };
        for (f = 0; f < F.length; f++) {
          var fa = F[f][0], fb = F[f][1], fc = F[f][2];
          var ab = mp(fa, fb), bc = mp(fb, fc), ca = mp(fc, fa);
          NF.push([fa, ab, ca], [fb, bc, ab], [fc, ca, bc], [ab, bc, ca]);
        }
        F = NF;
      }
      var outward = function (a, b, c) {
        var n = cross(sub(V[b], V[a]), sub(V[c], V[a]));
        return dot(n, [V[a][0] + V[b][0] + V[c][0], V[a][1] + V[b][1] + V[c][1], V[a][2] + V[b][2] + V[c][2]]);
      };
      for (f = 0; f < F.length; f++) if (outward(F[f][0], F[f][1], F[f][2]) < 0) F[f] = [F[f][0], F[f][2], F[f][1]];
      C.V = V; C.F = F;

      /* three territories, with ragged coasts */
      var seeds = [norm([0.25, 0.85, 0.45]), norm([-0.85, -0.15, 0.5]), norm([0.55, -0.55, -0.65])];
      C.terr = V.map(function (p) {
        var best = 0, bv = -9;
        for (var q = 0; q < 3; q++) {
          var d = dot(p, seeds[q]) + 0.14 * Math.sin(7 * p[0] + 3 * p[2] + 2 * q) * Math.cos(5 * p[1] - q);
          if (d > bv) { bv = d; best = q; }
        }
        return best;
      });

      /* the evictions, computed: shortest valid edge, crowded end folds */
      var cur = F.map(function (x) { return x.slice(); });
      var ev = [];
      var len = function (a, b) { var d = sub(V[a], V[b]); return Math.sqrt(dot(d, d)); };
      for (var n = 0; n < 100; n++) {
        var N = [];
        for (i = 0; i < V.length; i++) N.push([]);
        var link = function (a, b) {
          if (N[a].indexOf(b) < 0) N[a].push(b);
          if (N[b].indexOf(a) < 0) N[b].push(a);
        };
        for (f = 0; f < cur.length; f++) { link(cur[f][0], cur[f][1]); link(cur[f][1], cur[f][2]); link(cur[f][2], cur[f][0]); }
        var E = [];
        for (i = 0; i < V.length; i++) for (j = 0; j < N[i].length; j++) if (i < N[i][j]) E.push([i, N[i][j], len(i, N[i][j])]);
        E.sort(function (x, y) { return x[2] - y[2]; });
        var crowd = function (x) {
          var sm = 0;
          for (var q = 0; q < N[x].length; q++) sm += len(x, N[x][q]);
          return sm / N[x].length;
        };
        var pick = null;
        for (var e = 0; e < E.length && !pick; e++) {
          var a = E[e][0], b = E[e][1];
          if (N[a].length < 4 || N[b].length < 4) continue;
          var common = 0;
          for (j = 0; j < N[a].length; j++) if (N[b].indexOf(N[a][j]) >= 0) common++;
          if (common !== 2) continue;                  /* the link condition: still a sphere */
          var v = crowd(a) < crowd(b) ? a : b, u = v === a ? b : a, ok = true;
          for (f = 0; f < cur.length && ok; f++) {
            var cf = cur[f];
            if (cf.indexOf(v) < 0 || cf.indexOf(u) >= 0) continue;
            var r3 = cf.map(function (x) { return x === v ? u : x; });
            if (outward(r3[0], r3[1], r3[2]) < 1e-4) ok = false;   /* no face turns inside out */
          }
          if (ok) pick = { u: u, v: v };
        }
        if (!pick) break;
        var nu = pick.u, nv = pick.v;
        cur = cur.filter(function (x) { return !(x.indexOf(nv) >= 0 && x.indexOf(nu) >= 0); })
                 .map(function (x) { return x.map(function (y) { return y === nv ? nu : y; }); });
        ev.push(pick);
      }

      /* the clock: one fold every 90 ms. Folds overlap; a point that folds
         onto one that is itself folding follows it, see below */
      var last = PS;
      for (i = 0; i < ev.length; i++) { ev[i].s = PS + i * 90; last = ev[i].s; }
      C.HOLD = last + D + 300;
      C.RS = C.HOLD + 2600;
      for (i = 0; i < ev.length; i++) ev[i].r = C.RS + (last - ev[i].s);
      C.P = C.RS + (last - PS) + D + 900;
      C.ev = ev;

      /* the ring: token traffic in two bands */
      var ring = [], rs = 7;
      var rnd = function () { rs = (rs * 16807) % 2147483647; return (rs - 1) / 2147483646; };
      for (i = 0; i < 240; i++) {
        var band = rnd() < 0.55;
        var rr = band ? 1.2 + 0.11 * rnd() : 1.34 + 0.13 * rnd();
        ring.push({ r: rr, ph: rnd() * TAU, w: 0.00017 * Math.pow(1.2 / rr, 1.5),
                    c: rnd() < 0.45 ? 0 : rnd() < 0.55 ? 1 : 2, sz: 1.1 + 1.3 * rnd(), y: (rnd() - 0.5) * 0.02 });
      }
      C.ring = ring;
      var dotSpr = function (base) {
        var cv = document.createElement('canvas'), S = 24;
        cv.width = cv.height = S;
        var x = cv.getContext('2d');
        var q = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        q.addColorStop(0, rgb(mix(base, WH, 0.6), 1));
        q.addColorStop(0.35, rgb(base, 0.55));
        q.addColorStop(1, rgb(base, 0));
        x.fillStyle = q; x.fillRect(0, 0, S, S);
        return cv;
      };
      C.spr = [dotSpr(C.b5), dotSpr(C.v5), dotSpr(C.m5)];
      C.sprC = dotSpr(C.c5); C.sprW = dotSpr(mix(C.b5, WH, 0.7));
      collapse.cache = M = C;
    }

    var P = M.P, HOLD = M.HOLD, RS = M.RS;
    var tc = REDUCED ? HOLD + 1300 : t % P;
    var yaw = REDUCED ? 0.8 : t * TAU / 70000;
    var A = REDUCED ? 1 : ease(t / 1500);
    var rgb = M.rgb, mix = M.mix, WH = M.WH;
    var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    var seg = function (a, d) { return clamp((tc - a) / d); };

    var cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(TILT), stl = Math.sin(TILT);
    var cr = Math.cos(ROLL), sr = Math.sin(ROLL);
    var view = function (p, spin) {
      var x = p[0], y = p[1], z = p[2];
      if (spin) { var x1 = cyw * x + syw * z; z = -syw * x + cyw * z; x = x1; }
      var y2 = ct * y - stl * z, z2 = stl * y + ct * z;
      return [cr * x - sr * y2, sr * x + cr * y2, z2];
    };
    var sx = function (v) { return CX + R * v[0]; };
    var sy = function (v) { return CY - R * v[1]; };
    var spr = function (im, x, y, r, a) {
      if (a <= 0.004) return;
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(im, x - r, y - r, 2 * r, 2 * r);
      g.globalAlpha = 1;
    };



    /* the colours of a thin film: a loop through the palette that never mixes
       across the wheel (amber never meets mint or blue), so it stays clean */
    if (!M.iri) {
      var stops = [M.m5, M.b5, M.v5, M.c5, M.a5, M.c5, M.v5, M.b5], iri = [];
      for (var qb = 0; qb < 16; qb++) {
        var pos = qb / 16 * stops.length, si = Math.floor(pos);
        iri.push(rgb(mix(stops[si], stops[(si + 1) % stops.length], pos - si)));
      }
      M.iri = iri; M.stops = stops;
    }

    /* view with any spin: the planet turns one way, the sphere inside it the other */
    var viewAt = function (p, yw) {
      var cy2 = Math.cos(yw), sy2 = Math.sin(yw);
      var x = cy2 * p[0] + sy2 * p[2], z = -sy2 * p[0] + cy2 * p[2], y = p[1];
      var y2 = ct * y - stl * z, z2 = stl * y + ct * z;
      return [cr * x - sr * y2, sr * x + cr * y2, z2];
    };

    /* The mesh at any moment: which points have folded away and where the
       moving ones are. Latest fold first, so a point folding onto one that
       is itself on the move heads for where that one is now. */
    var V = M.V, nV = V.length, ev = M.ev, i, e;
    var stateAt = function (tq) {
      var to = [], body = [], moving = [], k, c;
      for (k = 0; k < nV; k++) { to.push(-1); body.push(V[k]); moving.push(-1); }
      var find = function (x) { while (to[x] >= 0) x = to[x]; return x; };
      for (k = ev.length - 1; k >= 0; k--) {
        var q = ev[k];
        if (tq < q.s) c = 0;
        else if (tq < q.s + D) c = ease((tq - q.s) / D);
        else if (tq < q.r) c = 1;
        else if (tq < q.r + D) c = 1 - ease((tq - q.r) / D);
        else c = 0;
        if (c >= 1) to[q.v] = q.u;
        else if (c > 0) {
          var pv = V[q.v], pu = body[find(q.u)];
          body[q.v] = M.norm([pv[0] + (pu[0] - pv[0]) * c, pv[1] + (pu[1] - pv[1]) * c, pv[2] + (pu[2] - pv[2]) * c]);
          moving[q.v] = find(q.u);
        }
      }
      return { to: to, body: body, moving: moving, find: find };
    };
    var edgesOf = function (S) {
      var seen = {}, out = [], FF = M.F;
      for (var f = 0; f < FF.length; f++) {
        var a = S.find(FF[f][0]), b = S.find(FF[f][1]), d = S.find(FF[f][2]);
        if (a === b || b === d || a === d) continue;
        var pr = [a, b, b, d, d, a];
        for (var q = 0; q < 6; q += 2) {
          var x = pr[q], y = pr[q + 1], key = x < y ? x * 1000 + y : y * 1000 + x;
          if (seen[key]) continue;
          seen[key] = 1; out.push(x, y);
        }
      }
      return out;
    };

    /* a hollow shell of light: every edge of the mesh, the near side bright
       and the far side seen faintly through it, each edge tinted by where it
       sits on the film, drifting with time. Returns the projected points and
       a painter for each half, so things inside can be drawn between them. */
    var NB = 16;
    var shell = function (S, scale, yw, drift) {
      var E = edgesOf(S), Wv = [], k;
      for (k = 0; k < nV; k++) Wv.push(viewAt(S.body[k], yw));
      var bf = [], bb = [];
      for (k = 0; k < NB; k++) { bf.push([]); bb.push([]); }
      for (k = 0; k < E.length; k += 2) {
        var p = Wv[E[k]], q = Wv[E[k + 1]];
        var mz = (p[2] + q[2]) / 2;
        var h = Math.atan2(p[1] + q[1], p[0] + q[0]) / TAU + 0.3 * mz + drift;
        h -= Math.floor(h);
        (mz > 0 ? bf : bb)[Math.floor(h * NB) % NB].push(p, q);
      }
      var X = function (v) { return CX + R * scale * v[0]; };
      var Y = function (v) { return CY - R * scale * v[1]; };
      var run = function (B, a, w) {
        if (a <= 0.004) return;
        g.lineWidth = w; g.globalAlpha = a > 1 ? 1 : a; g.lineCap = 'round';
        for (var bk = 0; bk < NB; bk++) {
          var L = B[bk];
          if (!L.length) continue;
          g.strokeStyle = M.iri[bk];
          g.beginPath();
          for (var j = 0; j < L.length; j += 2) { g.moveTo(X(L[j]), Y(L[j])); g.lineTo(X(L[j + 1]), Y(L[j + 1])); }
          g.stroke();
        }
        g.globalAlpha = 1;
      };
      return {
        W: Wv,
        back: function (a, w) { run(bb, a, w); },
        front: function (a, w, glow) { if (glow) run(bf, a * 0.16, w * 4.5); run(bf, a, w); }
      };
    };

    var now = stateAt(tc);
    var drift = REDUCED ? 0.2 : t / 11000;
    var RA = REDUCED ? 1 : 0.35 + 0.65 * A;
    var pulse = 0.5 + 0.5 * Math.sin((REDUCED ? 0 : t) / 3200 * TAU);
    var RIN = 0.4, yawIn = -1.7 * yaw + 0.6;

    /* ---------- the teleports: Epsilon moving a payload across the sphere
       through the hollow, not along it. A payload is a small cloud of points
       on the surface; it gathers, dives through the void, passes through the
       receptacle at the centre as the governor grants its one-shot permit,
       and comes up on the far side whole, where it unfolds. Every jump takes
       the same time however far it goes. */
    var TT = 2100, TD = 1900;
    var hsh = function (m, k) { var x = Math.sin(m * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
    if (!M.nearMemo) M.nearMemo = {};
    var near = function (vi, count) {
      if (M.nearMemo[vi]) return M.nearMemo[vi];
      var c = V[vi], best = [], k, d, dx, dy, dz;
      for (k = 0; k < nV; k++) {
        dx = V[k][0] - c[0]; dy = V[k][1] - c[1]; dz = V[k][2] - c[2]; d = dx * dx + dy * dy + dz * dz;
        best.push([d, k]);
      }
      best.sort(function (p, q) { return p[0] - q[0]; });
      var out = [];
      for (k = 0; k < count; k++) out.push(best[k][1]);
      M.nearMemo[vi] = out;
      return out;
    };
    var trips = [];
    {
      var mNow = Math.floor((REDUCED ? tc : t) / TT);
      for (var mm = mNow - 1; mm <= mNow; mm++) {
        if (mm < 1) continue;
        var u0 = ((REDUCED ? tc : t) - mm * TT) / TD;
        if (u0 < 0 || u0 >= 1) continue;
        var sv = Math.floor(hsh(mm, 1) * nV), s0 = now.body[now.find(sv)];
        var dv = Math.floor(hsh(mm, 2) * nV), d0 = now.body[now.find(dv)];
        if (s0[0] * d0[0] + s0[1] * d0[1] + s0[2] * d0[2] > 0.2) d0 = [-s0[0], -s0[1], -s0[2]];
        trips.push({ u: u0, s: s0, d: d0, ns: near(now.find(sv), 7), nd: near(now.find(dv), 7), c: M.terr[now.find(sv)] });
      }
    }
    /* where the payload is: gathering, diving, or unfolding */
    var tripAt = function (tr) {
      var u = tr.u, pts = [], k, cl, sp;
      if (u < 0.2) {                                   /* gather on the surface */
        cl = ease(u / 0.2);
        for (k = 0; k < 7; k++) {
          sp = V[tr.ns[k]];
          pts.push([sp[0] + (tr.s[0] - sp[0]) * cl, sp[1] + (tr.s[1] - sp[1]) * cl, sp[2] + (tr.s[2] - sp[2]) * cl]);
        }
        return { pts: pts, head: null, glow: cl };
      }
      if (u < 0.8) {                                   /* through the hollow, by the centre */
        var w = ease((u - 0.2) / 0.6), a2 = (1 - w) * (1 - w), c2 = w * w;
        var hd = [a2 * tr.s[0] + c2 * tr.d[0], a2 * tr.s[1] + c2 * tr.d[1], a2 * tr.s[2] + c2 * tr.d[2]];
        return { pts: null, head: hd, w: w };
      }
      cl = 1 - ease((u - 0.8) / 0.2);                  /* unfold on the far side */
      for (k = 0; k < 7; k++) {
        sp = V[tr.nd[k]];
        pts.push([sp[0] + (tr.d[0] - sp[0]) * cl, sp[1] + (tr.d[1] - sp[1]) * cl, sp[2] + (tr.d[2] - sp[2]) * cl]);
      }
      return { pts: pts, head: null, glow: cl, land: 1 - cl };
    };

    /* ---------- the air, and the ring's far half */
    var at = g.createRadialGradient(CX, CY, R * 0.9, CX, CY, R * 1.12);
    at.addColorStop(0, rgb(M.v5, 0)); at.addColorStop(0.45, rgb(M.b5, 0.1 * A)); at.addColorStop(1, rgb(M.b5, 0));
    g.fillStyle = at;
    g.beginPath(); g.arc(CX, CY, R * 1.12, 0, TAU); g.fill();

    var ringLane = function (rr, farSide, alpha) {
      g.strokeStyle = rgb(mix(M.b5, WH, 0.35), alpha); g.lineWidth = 1;
      g.beginPath();
      var open = false;
      for (var k = 0; k <= 96; k++) {
        var th = k / 96 * TAU, p = view([rr * Math.cos(th), 0, rr * Math.sin(th)], false);
        if ((p[2] < 0) === farSide) {
          if (!open) { g.moveTo(sx(p), sy(p)); open = true; } else g.lineTo(sx(p), sy(p));
        } else open = false;
      }
      g.stroke();
    };
    var ringDots = function (farSide) {
      var rg = M.ring;
      for (var k = 0; k < rg.length; k++) {
        var q = rg[k], th = q.ph + q.w * (REDUCED ? 20000 : t);
        var p = view([q.r * Math.cos(th), q.y, q.r * Math.sin(th)], false);
        if ((p[2] < 0) !== farSide) continue;
        spr(M.spr[q.c], sx(p), sy(p), q.sz * 2.2, (farSide ? 0.4 : 0.9) * RA);
      }
    };
    ringLane(1.25, true, 0.14 * RA); ringLane(1.405, true, 0.1 * RA);
    ringDots(true);

    /* ---------- the far wall of the planet */
    var outer = shell(now, 1, yaw, drift);
    outer.back(0.3 * A, 0.8);

    /* ---------- Epsilon inside Epsilon: the receptacle at the centre, a
       finer hollow sphere turning the other way, the bare metal inside it */
    var core = g.createRadialGradient(CX, CY, 0, CX, CY, R * RIN * 1.05);
    core.addColorStop(0, rgb(mix(M.a5, WH, 0.5), (0.7 + 0.15 * pulse) * RA));
    core.addColorStop(0.3, rgb(M.a5, 0.25 * RA));
    core.addColorStop(1, rgb(M.a5, 0));
    g.fillStyle = core;
    g.beginPath(); g.arc(CX, CY, R * RIN * 1.05, 0, TAU); g.fill();
    spr(M.sprW, CX, CY, 6 + 2 * pulse, RA);
    var granted = 0;
    for (i = 0; i < trips.length; i++) {
      var tw = (trips[i].u - 0.2) / 0.6;
      if (tw > 0.3 && tw < 0.75) granted = Math.max(granted, Math.sin(Math.PI * (tw - 0.3) / 0.45));
    }
    var inner = shell(stateAt(0), RIN, yawIn, drift + 0.5);
    inner.back((0.35 + 0.25 * granted) * A, 0.7);
    inner.front((0.75 + 0.25 * granted) * A, 1.05, true);
    g.strokeStyle = rgb(mix(M.v5, WH, 0.2), (0.35 + 0.6 * granted) * A); g.lineWidth = 1 + 2.5 * granted;
    g.beginPath(); g.arc(CX, CY, R * RIN * (1.02 + 0.1 * granted), 0, TAU); g.stroke();

    /* ---------- payloads in flight, inside the hollow: the whole jump is
       drawn as a thread of light from the cell it leaves, past the
       receptacle, to the cell it lands in, and the payload rides it */
    var P3 = function (p) { var v = view(p, true); return [sx(v), sy(v), v[2]]; };
    var bez = function (tr, w) {
      var a3 = (1 - w) * (1 - w), c3 = w * w;
      return [a3 * tr.s[0] + c3 * tr.d[0], a3 * tr.s[1] + c3 * tr.d[1], a3 * tr.s[2] + c3 * tr.d[2]];
    };
    for (i = 0; i < trips.length; i++) {
      var tr = trips[i], col = tr.c, ccol = M.terrCol[col];
      var thread = Math.min(1, tr.u / 0.2) * (tr.u > 0.8 ? 1 - (tr.u - 0.8) / 0.2 : 1);
      if (thread > 0.01) {
        var pts3 = [];
        for (var q3 = 0; q3 <= 40; q3++) pts3.push(P3(bez(tr, q3 / 40)));
        for (var pass3 = 0; pass3 < 2; pass3++) {
          g.strokeStyle = rgb(pass3 ? mix(ccol, WH, 0.3) : ccol, (pass3 ? 0.75 : 0.16) * thread);
          g.lineWidth = pass3 ? 1.6 : 8; g.lineCap = 'round';
          g.beginPath(); g.moveTo(pts3[0][0], pts3[0][1]);
          for (q3 = 1; q3 <= 40; q3++) g.lineTo(pts3[q3][0], pts3[q3][1]);
          g.stroke();
        }
      }
      var st2 = tripAt(tr);
      if (st2.head) {
        for (var tq = 8; tq >= 1; tq--) {              /* its wake */
          var tp = P3(bez(tr, Math.max(0, st2.w - tq * 0.03)));
          spr(M.spr[col], tp[0], tp[1], 9 - 0.7 * tq, 0.8 * (1 - tq / 9));
        }
        var hp = P3(st2.head);
        spr(M.spr[col], hp[0], hp[1], 24, 1);
        spr(M.sprW, hp[0], hp[1], 8, 1);
      }
    }

    /* ---------- the near wall */
    outer.front(0.92 * A, 1.35, true);
    var W = outer.W;

    /* the only filled shapes on the planet: triangles folding flat right now */
    var FF = M.F;
    for (var f = 0; f < FF.length; f++) {
      var a = now.find(FF[f][0]), b = now.find(FF[f][1]), d = now.find(FF[f][2]);
      if (a === b || b === d || a === d) continue;
      var mv = now.moving;
      var fold = (mv[a] >= 0 && (mv[a] === b || mv[a] === d)) || (mv[b] >= 0 && (mv[b] === a || mv[b] === d)) ||
                 (mv[d] >= 0 && (mv[d] === a || mv[d] === b));
      if (!fold) continue;
      var zf = (W[a][2] + W[b][2] + W[d][2]) / 3;
      g.beginPath();
      g.moveTo(sx(W[a]), sy(W[a])); g.lineTo(sx(W[b]), sy(W[b])); g.lineTo(sx(W[d]), sy(W[d])); g.closePath();
      g.fillStyle = rgb(M.c5, zf > 0 ? 0.7 : 0.25);
      g.fill();
    }

    /* the film: brightest at the rim, as a bubble is, its colours swirling */
    if (g.createConicGradient) {
      var cg = g.createConicGradient((REDUCED ? 0 : t) * 0.00011, CX, CY);
      var cs = M.stops;
      for (var k3 = 0; k3 <= cs.length; k3++) cg.addColorStop(k3 / cs.length, rgb(cs[k3 % cs.length], 1));
      var rims = [[1.5, 0.34], [5, 0.2], [10, 0.1], [17, 0.05]];
      for (var k4 = 0; k4 < rims.length; k4++) {
        g.strokeStyle = cg; g.lineWidth = rims[k4][0] < 3 ? 1.6 : 5;
        g.globalAlpha = rims[k4][1] * A;
        g.beginPath(); g.arc(CX, CY, R - rims[k4][0], 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
    } else {
      g.strokeStyle = rgb(M.v5, 0.3 * A); g.lineWidth = 1.6;
      g.beginPath(); g.arc(CX, CY, R - 1.5, 0, TAU); g.stroke();
    }
    g.strokeStyle = rgb(WH, 0.85 * A); g.lineWidth = 1.2;
    g.beginPath(); g.arc(CX, CY, R - 3, Math.PI * 0.98, Math.PI * 1.55); g.stroke();

    /* the points of state */
    for (i = 0; i < nV; i++) {
      if (now.to[i] >= 0) continue;
      var zz = W[i][2], mvg = now.moving[i] >= 0;
      spr(M.spr[M.terr[i]], sx(W[i]), sy(W[i]), mvg ? 7 : zz > 0 ? 3.6 : 2.4, (mvg ? 1 : zz > 0 ? 0.9 : 0.35) * A);
    }

    /* payloads on the surface: gathering to leave, or unfolding on arrival */
    for (i = 0; i < trips.length; i++) {
      var s3 = tripAt(trips[i]);
      if (!s3.pts) continue;
      for (var k5 = 0; k5 < s3.pts.length; k5++) {
        var pp3 = P3(s3.pts[k5]);
        spr(M.spr[trips[i].c], pp3[0], pp3[1], 6 + 6 * s3.glow, (pp3[2] > 0 ? 1 : 0.45));
        spr(M.sprW, pp3[0], pp3[1], 2.5 + 2 * s3.glow, (pp3[2] > 0 ? 1 : 0.4));
      }
      if (s3.land) {                                    /* a ripple where it lands */
        var lp = P3(trips[i].d), lr = 6 + 26 * s3.land;
        g.strokeStyle = rgb(M.terrCol[trips[i].c], 0.6 * (1 - s3.land) * (lp[2] > 0 ? 1 : 0.4)); g.lineWidth = 1.4;
        g.beginPath(); g.arc(lp[0], lp[1], lr, 0, TAU); g.stroke();
      }
    }

    /* the hero: after the thinning, a band of light sweeps pole to pole */
    var sk = seg(HOLD + 300, 2000);
    if (sk > 0 && sk < 1) {
      var scanH = 1.05 - 2.1 * ease(sk), rr2 = Math.sqrt(Math.max(0, 1 - scanH * scanH)), sa = Math.sin(Math.PI * sk);
      g.lineCap = 'round';
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? rgb(WH, 0.95 * sa) : rgb(M.v5, 0.3 * sa);
        g.lineWidth = pass ? 1.6 : 8;
        g.beginPath();
        var open2 = false;
        for (var k2 = 0; k2 <= 72; k2++) {
          var th2 = k2 / 72 * TAU, p2 = view([rr2 * Math.cos(th2), scanH, rr2 * Math.sin(th2)], true);
          if (p2[2] > 0) { if (!open2) { g.moveTo(sx(p2), sy(p2)); open2 = true; } else g.lineTo(sx(p2), sy(p2)); }
          else open2 = false;
        }
        g.stroke();
      }
    }

    /* each evicted point leaves as a spark; each returning one arrives from the ring */
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      var kx = seg(e.s + D, 900);
      if (kx > 0 && kx < 1) {
        var pu2 = V[e.u], up = 1 + 0.3 * ease(kx);
        var ps = view([pu2[0] * up, pu2[1] * up, pu2[2] * up], true);
        spr(M.sprC, sx(ps), sy(ps), 4.5, (ps[2] > 0 ? 0.9 : 0.35) * (1 - kx));
      }
      var kr = seg(e.r - 650, 650);
      if (kr > 0 && kr < 1) {
        var th3 = i * 2.39996 + (REDUCED ? 0 : t) * 0.00017;
        var from = [1.3 * Math.cos(th3), 0, 1.3 * Math.sin(th3)];
        var tgt = V[e.u], ke = ease(kr), lift = 0.25 * Math.sin(Math.PI * ke);
        var pp = [from[0] + (tgt[0] - from[0]) * ke, from[1] + (tgt[1] - from[1]) * ke + lift, from[2] + (tgt[2] - from[2]) * ke];
        var pw = view(pp, ke > 0.5);
        spr(M.spr[M.terr[e.v]], sx(pw), sy(pw), 5, pw[2] > 0 ? 1 : 0.4);
      }
    }

    /* the near half of the ring passes in front */
    ringLane(1.25, false, 0.22 * RA); ringLane(1.405, false, 0.16 * RA);
    ringDots(false);
  }

  /* ==================================================================== */
  /* witness — nerve                                                     */
  /* ==================================================================== */
  function witness(g, vb, t, st) {
    /* nerve finds topological witnesses in polymer chains, and the project is
       remembered for what it did to its own result: it built the control that
       could kill it, and withdrew 3 of its own 4 hypotheses when that control
       said so. The figure is both halves, drawn as an illustration of the
       method rather than as measured data.

       Above, one polymer chain in three dimensions: a tube of 150 shaded beads
       coloured blue to violet along its length, writhing slowly while the view
       sways. Its projection is searched for crossings in every frame. Every
       pair of non-adjacent segments is intersected in the plane, and where two
       meet, the depth of each strand at that point decides which passes over;
       the over strand is redrawn with a gap cut round it, as a knot diagram
       would draw it. The chain is shaped so the search finds exactly one
       crossing, and that crossing is ringed in amber as the witness. Nothing
       places the ring by hand: while the chain is still being laid down there
       is no crossing and no ring, and the ring blooms the moment the chain
       first passes over itself.

       Behind it is the control: randomised chains, smoothed random walks,
       writhing too and searched the same way, with their crossings marked as
       faintly as they are drawn; each mark is weighted by the sine of its
       crossing angle, so a crossing that forms grows from nothing. Random chains cross themselves as well, which is exactly
       why a crossing alone proves nothing and a control is needed.

       Below are four lanes, one per hypothesis. Each cycle the witness sends a
       bead of the chain's own colour down to each lane: the value that
       hypothesis measured on the chain. Then the same measurement taken on the
       control rains into the lane as beads of the control's colour and piles up
       where the control's values fall: each grain drops straight down onto the
       heap and rolls into the notch between two grains below it, so the heap
       takes the shape of the control's spread. The verdict is not
       scheduled; it is read off the heap. Where the control's pile buries the
       bead, the control reproduces the result and the hypothesis is withdrawn,
       left on the record as a hollow coral ring. Three go that way. One sits
       far out where the control never lands, and when the rain is over and it
       is still standing, it and the witness ring together, once a cycle.

       Beads and grains are sprites painted once from a radial gradient and
       depth sorted every frame, so the chain occludes itself correctly. Shading
       mixes each -500 token toward its -700 and toward white, never darker
       than the palette. */
    var TAU = Math.PI * 2;
    var N = 150, U = 3.85, AA = 0.34, BB = 1.08, CC = 0.62;  /* the chain: a looped trochoid in 3D */
    var S = 90, CX = 235, CY = 192, EL = 0.36, R0 = 8.2, PERS = 0.15;
    var GROW = 420, BUILD = 2300, B0 = -330;                   /* bead i appears at B0 + BUILD i/N */
    var C0 = 2400, P = 12400;                                  /* first test, cycle length */
    var FLY = 1250, LAG = 240, RAIN0 = 1300, RAIN = 5200, FALL = 420;
    var HERO = 7300, FADE0 = 10500, FADE = 1500;
    var LX0 = 34, LY = [356, 388, 420, 452], NG = 42, DG = 6.6;
    var SURV = 2;

    var M = witness.cache;
    if (!M) {
      M = witness.cache = {};
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var mix = function (a, b, k) {
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      };
      var css = function (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; };
      var WH = [255, 255, 255];
      var b5 = hex('--blue-500', '#2456dc'), b7 = hex('--blue-700', '#163a9a');
      var v5 = hex('--violet-500', '#a66cf0'), v7 = hex('--violet-700', '#6b35c4');
      var m5 = hex('--mint-500', '#0b93ab'), m7 = hex('--mint-700', '#0a6b7c');
      M.mint = token('--mint-500', '#0b93ab'); M.mint7 = token('--mint-700', '#0a6b7c');
      M.amber = token('--amber-500', '#d96a06');
      M.coral = token('--coral-500', '#d9376e');
      M.blue = token('--blue-500', '#2456dc');
      M.ground = token('--ground', '#fbfaf7');

      /* one sphere sprite per colour, lit from the upper left */
      var sprite = function (c5, c7) {
        var cv = document.createElement('canvas'), SZ = 64;
        cv.width = cv.height = SZ;
        var x = cv.getContext('2d');
        var gr = x.createRadialGradient(SZ * 0.36, SZ * 0.32, 0, SZ * 0.46, SZ * 0.44, SZ * 0.56);
        gr.addColorStop(0, css(mix(c5, WH, 0.74)));
        gr.addColorStop(0.3, css(mix(c5, WH, 0.16)));
        gr.addColorStop(0.64, css(c5));
        gr.addColorStop(1, css(mix(c5, c7, 0.6)));
        x.fillStyle = gr;
        x.beginPath(); x.arc(SZ / 2, SZ / 2, SZ / 2 - 0.5, 0, TAU); x.fill();
        return cv;
      };
      M.K = 20; M.spr = [];
      for (var k = 0; k < M.K; k++) {
        var f = k / (M.K - 1);
        M.spr.push(sprite(mix(b5, v5, f), mix(b7, v7, f)));
      }
      M.sprB = M.spr[0];
      M.sprM = sprite(mix(m5, WH, 0.08), m7);

      var hash = function (i, j) { var s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s); };

      /* the chain's slow writhe: three harmonics per axis, depth the strongest */
      M.mz = [];
      for (k = 0; k < 9; k++) {
        M.mz.push({ a: (k % 3 === 2 ? 0.2 : 0.03) + 0.03 * hash(k, 1), f: 0.6 + 1.1 * hash(k, 2),
                    w: TAU / (7000 + 7000 * hash(k, 3)), p: TAU * hash(k, 4) });
      }
      M.px = new Float32Array(N); M.py = new Float32Array(N); M.pz = new Float32Array(N);
      M.pr = new Float32Array(N); M.ord = [];
      for (var i = 0; i < N; i++) M.ord.push(i);

      /* the control: persistent random walks, smoothed and centred */
      M.NE = 6; M.NP = 56; M.ens = [];
      for (var e = 0; e < M.NE; e++) {
        var xs = new Float32Array(M.NP), ys = new Float32Array(M.NP), zs = new Float32Array(M.NP);
        var dx = hash(e, 11) - 0.5, dy = hash(e, 12) - 0.5, dz = hash(e, 13) - 0.5, X = 0, Y = 0, Z = 0;
        for (var j = 0; j < M.NP; j++) {
          dx += 0.9 * (hash(e * 97 + j, 21) - 0.5); dy += 0.9 * (hash(e * 97 + j, 22) - 0.5);
          dz += 0.9 * (hash(e * 97 + j, 23) - 0.5);
          var dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          X += dx; Y += dy; Z += dz;
          xs[j] = X; ys[j] = Y; zs[j] = Z;
        }
        /* two passes of a 5-point average turn the walk into a smooth coil */
        for (var pass = 0; pass < 2; pass++) {
          [xs, ys, zs].forEach(function (A) {
            var B = Float32Array.from(A);
            for (var q = 0; q < A.length; q++) {
              var s = 0, c = 0;
              for (var w = -2; w <= 2; w++) if (q + w >= 0 && q + w < A.length) { s += B[q + w]; c++; }
              A[q] = s / c;
            }
          });
        }
        var mx = 0, my = 0, mzz = 0;
        for (j = 0; j < M.NP; j++) { mx += xs[j]; my += ys[j]; mzz += zs[j]; }
        mx /= M.NP; my /= M.NP; mzz /= M.NP;
        var ex = 0, ey = 0;
        for (j = 0; j < M.NP; j++) {
          xs[j] -= mx; ys[j] -= my; zs[j] -= mzz;
          ex = Math.max(ex, Math.abs(xs[j])); ey = Math.max(ey, Math.abs(ys[j]));
        }
        var sc = Math.min(2.2 / ex, 1.02 / ey);
        for (j = 0; j < M.NP; j++) { xs[j] *= sc; ys[j] *= sc; zs[j] *= sc; }
        M.ens.push({ x: xs, y: ys, z: zs, ph: TAU * hash(e, 31), w: TAU / (9000 + 5000 * hash(e, 32)),
                     sx: new Float32Array(M.NP), sy: new Float32Array(M.NP) });
      }

      /* The four tests: where the control's values fall (mean, spread) and the
         value measured on the chain. Grains are settled once, in the order they
         arrive, so the heap every frame shows is the heap physics would build. */
      var LANES = [[198, 34, 212], [262, 29, 246], [170, 27, 392], [236, 38, 252]];
      var NK = Math.floor((436 - LX0) / DG);
      M.lanes = [];
      for (var l = 0; l < 4; l++) {
        var mu = LANES[l][0], sg = LANES[l][1], occ = [], gx = [], gy = [], gh = [], ga = [];
        for (var hh = 0; hh < 10; hh++) occ.push(new Uint8Array(NK + 2));
        for (j = 0; j < NG; j++) {
          var u1 = Math.max(1e-4, hash(l * 211 + j, 41)), u2 = hash(l * 211 + j, 42);
          var zz = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
          var x0 = mu + sg * Math.max(-2.5, Math.min(2.5, zz)), row = 0, put;
          /* Slot k of row h is centred at LX0 + (k + h/2 + 1/2) DG and rests on
             slots k and k+1 of the row below. A grain falls straight down at its
             value until it meets the heap, then rolls into whichever hole under
             it is open, and keeps rolling until both grains beneath it are there. */
          for (;;) {
            put = Math.max(0, Math.min(NK - 1 - row, Math.round((x0 - LX0) / DG - 0.5 - row * 0.5)));
            if (!occ[row][put] || row === 9) break;
            row++;
          }
          while (row > 0 && !(occ[row - 1][put] && occ[row - 1][put + 1])) {
            var kl = put, kr = put + 1;
            if (!occ[row - 1][kl] && !occ[row - 1][kr]) {
              put = Math.abs(LX0 + (kl + row * 0.5) * DG - x0) <= Math.abs(LX0 + (kr + row * 0.5) * DG - x0) ? kl : kr;
            } else put = occ[row - 1][kl] ? kr : kl;
            row--;
          }
          occ[row][put] = 1;
          gx.push(LX0 + (put + row * 0.5 + 0.5) * DG);
          gy.push(LY[l] - DG / 2 - row * DG * 0.866);
          gh.push(row);
          ga.push(RAIN0 + l * 150 + RAIN * (j + 0.7 * hash(l * 211 + j, 43)) / NG);
        }
        /* the grains that bury the bead: any that settle over its footprint */
        var near = [];
        for (j = 0; j < NG; j++) if (Math.abs(gx[j] - LANES[l][2]) < DG * 1.5 && gh[j] <= 2) near.push(j);
        M.lanes.push({ v: LANES[l][2], mu: mu, sg: sg, gx: gx, gy: gy, ga: ga, near: near });
      }
    }

    var RED = REDUCED;
    var T = RED ? C0 + 9300 : t;
    var FILL = rgba;

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* --- view ------------------------------------------------------------ */
    var phi = RED ? 0.2 : 0.14 + 0.26 * Math.sin(TAU * T / 21000);
    var cp = Math.cos(phi), sp = Math.sin(phi), ce = Math.cos(EL), se = Math.sin(EL);
    var PR = [0, 0, 0];
    function proj(x, y, z) {
      var X = x * cp + z * sp, Z = -x * sp + z * cp;
      var Y = y * ce - Z * se, D = y * se + Z * ce;          /* D > 0 is toward the viewer */
      var q = 1 + PERS * D;
      PR[0] = CX + S * X * q; PR[1] = CY + S * Y * q; PR[2] = D;
      return PR;
    }

    /* --- the chain ---------------------------------------------------------- */
    var i, j, k, n, l, L, r;
    for (i = 0; i < N; i++) {
      var u = -U + 2 * U * i / (N - 1), mx2 = 0, my2 = 0, mz2 = 0;
      for (k = 0; k < 9; k++) {
        var h = M.mz[k], sv = h.a * Math.sin(h.f * u + h.w * T + h.p);
        if (k % 3 === 0) mx2 += sv; else if (k % 3 === 1) my2 += sv; else mz2 += sv;
      }
      proj(AA * u - BB * Math.sin(u) + mx2, -BB * Math.cos(u) + my2, CC * Math.sin(u) + mz2);
      M.px[i] = PR[0]; M.py[i] = PR[1]; M.pz[i] = PR[2];
      M.pr[i] = R0 * (1 + PERS * PR[2]) * ease((T - B0 - BUILD * i / N) / GROW);
    }
    var built = 0;
    while (built < N && M.pr[built] > R0 * 0.45) built++;

    /* crossings of a projected polyline: every non-adjacent pair of segments */
    function crossings(xs, ys, ds, m, out) {
      for (var a = 0; a + 1 < m; a++) {
        var ax = xs[a], ay = ys[a], bx = xs[a + 1], by = ys[a + 1];
        var lx = Math.min(ax, bx), hx = Math.max(ax, bx), ly = Math.min(ay, by), hy = Math.max(ay, by);
        for (var b = a + 3; b + 1 < m; b++) {
          var cx = xs[b], cy = ys[b], dx = xs[b + 1], dy = ys[b + 1];
          if (Math.max(cx, dx) < lx || Math.min(cx, dx) > hx || Math.max(cy, dy) < ly || Math.min(cy, dy) > hy) continue;
          var den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
          if (den === 0) continue;
          var s1 = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
          var s2 = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
          if (s1 < 0 || s1 > 1 || s2 < 0 || s2 > 1) continue;
          /* k: how firmly they cross, the sine of the crossing angle, faded near
             the chain's ends; a crossing is born tangent or at an end, so a mark
             weighted by k grows from nothing instead of appearing */
          var sn = Math.abs(den) / ((Math.hypot(bx - ax, by - ay) * Math.hypot(dx - cx, dy - cy)) || 1);
          out.push({ x: ax + (bx - ax) * s1, y: ay + (by - ay) * s1, a: a, b: b,
                     k: ease(sn / 0.5) * ease(Math.min(a + s1, m - 1 - b - s2) / 4),
                     over: ds && ds[a] + (ds[a + 1] - ds[a]) * s1 < ds[b] + (ds[b + 1] - ds[b]) * s2 ? b : a });
        }
      }
      return out;
    }
    var X = crossings(M.px, M.py, M.pz, built, []);
    st.crossings = X.length;
    var W = X.length ? X[0] : { x: CX, y: CY, b: N };
    /* the witness blooms from the moment the second strand is laid over the first */
    var wit = X.length ? ease((T - (B0 + BUILD * (W.b + 1) / N + GROW * 0.45)) / 750) : 0;

    /* --- the control, behind everything ------------------------------------ */
    var ensA = RED ? 1 : 0.4 + 0.6 * ease((T + 300) / 2200);
    for (n = 0; n < M.NE; n++) {
      var E = M.ens[n];
      for (j = 0; j < M.NP; j++) {
        var wob = 0.11 * Math.sin(E.w * T + E.ph + j * 0.35);
        proj(E.x[j] + wob, E.y[j] + 0.8 * wob * Math.cos(j * 0.21 + E.ph), E.z[j] - wob);
        E.sx[j] = PR[0]; E.sy[j] = PR[1];
      }
      g.beginPath();
      g.moveTo(E.sx[0], E.sy[0]);
      for (j = 1; j < M.NP; j++) g.lineTo(E.sx[j], E.sy[j]);
      g.strokeStyle = FILL(M.mint, 0.08 * ensA); g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = FILL(M.mint7, 0.24 * ensA); g.lineWidth = 1.3;
      g.stroke();
      var EX = crossings(E.sx, E.sy, null, M.NP, []);
      g.lineWidth = 1.4;
      for (j = 0; j < EX.length; j++) {
        if (EX[j].k < 0.02) continue;
        g.strokeStyle = FILL(M.mint7, 0.46 * ensA * EX[j].k);
        g.beginPath(); g.arc(EX[j].x, EX[j].y, 4, 0, TAU); g.stroke();
      }
    }

    /* --- cycle clock -------------------------------------------------------- */
    var tau = T < C0 ? -1 : (T - C0) % P;
    var fadeOut = tau < 0 ? 0 : 1 - ease((tau - FADE0) / FADE);
    var hero = tau < 0 || RED ? -1 : (tau - HERO) / 1500;
    var heroOn = RED ? 1 : tau < 0 ? 0 : ease((tau - HERO + 250) / 500) * fadeOut;

    /* the witness's glow sits under the chain */
    if (wit > 0) {
      var br = RED ? 1 : 0.86 + 0.14 * Math.sin(TAU * T / 3600);
      var hg = g.createRadialGradient(W.x, W.y, 0, W.x, W.y, 46);
      hg.addColorStop(0, FILL(M.amber, 0.36 * wit * br));
      hg.addColorStop(0.5, FILL(M.amber, 0.13 * wit * br));
      hg.addColorStop(1, FILL(M.amber, 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(W.x, W.y, 46, 0, TAU); g.fill();
    }

    /* beads, far to near */
    var ord = M.ord;
    ord.sort(function (a, b) { return M.pz[a] - M.pz[b]; });
    function bead(i) {
      var rr = M.pr[i];
      if (rr > 0.05) g.drawImage(M.spr[Math.round(i / (N - 1) * (M.K - 1))], M.px[i] - rr, M.py[i] - rr, 2 * rr, 2 * rr);
    }
    for (n = 0; n < N; n++) bead(ord[n]);

    /* the over strand again, with a gap cut round it where it crosses: the cut
       tapers to nothing at both ends, so it never notches its own neighbours */
    if (X.length) {
      var o = W.over, k0 = Math.max(0, o - 6), k1 = Math.min(built - 1, o + 7);
      g.fillStyle = FILL(M.ground, 1);
      for (k = k0; k <= k1; k++) {
        var wgap = Math.sin(Math.PI * (k - k0) / (k1 - k0 || 1));
        g.beginPath(); g.arc(M.px[k], M.py[k], M.pr[k] + 2.6 * wgap * wit, 0, TAU); g.fill();
      }
      for (k = k0; k <= k1; k++) bead(k);
    }

    /* the witness ring, over the crossing */
    if (wit > 0) {
      var rb = RED ? 0 : Math.sin(TAU * T / 3600);
      g.strokeStyle = FILL(M.amber, 0.92 * wit); g.lineWidth = 2.8;
      g.beginPath(); g.arc(W.x, W.y, (19 + 1.3 * rb) * (0.6 + 0.4 * wit), 0, TAU); g.stroke();
      if (hero >= 0 && hero < 1) {
        var ho = 1 - (1 - hero) * (1 - hero) * (1 - hero);
        g.strokeStyle = FILL(M.amber, 0.5 * (1 - hero) * (1 - hero) * ease(hero / 0.12));
        g.lineWidth = 2.2;
        g.beginPath(); g.arc(W.x, W.y, 21 + 22 * ho, 0, TAU); g.stroke();
      }
    }

    if (tau < 0) return;

    /* --- the four tests ---------------------------------------------------- */
    /* how far the control's pile has buried each bead, from the grains landed */
    var eng = [];
    for (l = 0; l < 4; l++) {
      L = M.lanes[l];
      var c = 0;
      for (j = 0; j < L.near.length; j++) c += ease((tau - L.ga[L.near[j]]) / 200);
      eng[l] = ease((c - 1) / 2.6);
    }

    function bez(l, s, out) {
      var x0 = W.x, y0 = W.y, x2 = M.lanes[l].v, y2 = LY[l] - 6.4;
      var x1 = x0 + (x2 - x0) * 0.9, y1 = y0 + (y2 - y0) * 0.08;
      var a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, cc = s * s;
      out[0] = a * x0 + b * x1 + cc * x2; out[1] = a * y0 + b * y1 + cc * y2;
      return out;
    }

    /* the chain's own values, one bead per lane, laid down before the grains
       so the control's pile can bury them */
    var flying = [];
    for (l = 0; l < 4; l++) {
      L = M.lanes[l];
      var fk = (tau - l * LAG) / FLY;
      if (fk <= 0) continue;
      if (fk < 1) { flying.push([l, ease(fk)]); continue; }
      if (l === SURV && heroOn > 0) {
        var hl = g.createRadialGradient(L.v, LY[l] - 6.4, 0, L.v, LY[l] - 6.4, 20);
        hl.addColorStop(0, FILL(M.blue, 0.28 * heroOn));
        hl.addColorStop(1, FILL(M.blue, 0));
        g.fillStyle = hl;
        g.beginPath(); g.arc(L.v, LY[l] - 6.4, 20, 0, TAU); g.fill();
      }
      var a2 = (1 - 0.7 * eng[l]) * fadeOut;
      if (a2 > 0.01) {
        r = 6.4;
        g.globalAlpha = a2;
        g.drawImage(M.sprB, L.v - r, LY[l] - 6.4 - r, 2 * r, 2 * r);
        g.globalAlpha = 1;
      }
    }

    /* the control's grains: in the air, then on the heap, which sits in its
       own soft contact shadow as it grows */
    if (fadeOut > 0.005) {
      for (l = 0; l < 4; l++) {
        L = M.lanes[l];
        var grown = ease((tau - RAIN0 - l * 150) / RAIN);
        if (grown <= 0) continue;
        var rx = 2.5 * L.sg;
        g.save();
        g.translate(L.mu, LY[l] + 0.5);
        g.scale(1, 0.085);
        var sh = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        sh.addColorStop(0, FILL(M.mint7, 0.22 * grown * fadeOut));
        sh.addColorStop(1, FILL(M.mint7, 0));
        g.fillStyle = sh;
        g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill();
        g.restore();
      }
      g.globalAlpha = fadeOut;
      for (l = 0; l < 4; l++) {
        L = M.lanes[l];
        for (j = 0; j < NG; j++) {
          var fk2 = (tau - L.ga[j] + FALL) / FALL;
          if (fk2 <= 0) continue;
          var yy = fk2 >= 1 ? L.gy[j] : L.gy[j] - 30 * (1 - fk2 * fk2);
          var rg = DG / 2 * (0.4 + 0.6 * ease(fk2 / 0.3));
          g.drawImage(M.sprM, L.gx[j] - rg, yy - rg, 2 * rg, 2 * rg);
        }
      }
      g.globalAlpha = 1;
    }

    /* withdrawn: the buried value stays on the record as a hollow ring */
    for (l = 0; l < 4; l++) {
      if (eng[l] <= 0.01 || (tau - l * LAG) < FLY) continue;
      L = M.lanes[l];
      g.strokeStyle = FILL(M.coral, 0.95 * eng[l] * fadeOut); g.lineWidth = 2.6;
      g.beginPath(); g.arc(L.v, LY[l] - 6.4, 7.2, 0, TAU); g.stroke();
    }

    /* the survivor: still standing once the rain is over */
    L = M.lanes[SURV];
    if (hero >= 0 && hero < 1) {
      var so = 1 - (1 - hero) * (1 - hero) * (1 - hero);
      g.strokeStyle = FILL(M.blue, 0.55 * (1 - hero) * (1 - hero) * ease(hero / 0.12));
      g.lineWidth = 2.2;
      g.beginPath(); g.arc(L.v, LY[SURV] - 6.4, 10 + 16 * so, 0, TAU); g.stroke();
    }
    if (heroOn > 0) {
      g.strokeStyle = FILL(M.blue, 0.8 * heroOn); g.lineWidth = 2;
      g.beginPath(); g.arc(L.v, LY[SURV] - 6.4, 10.5, 0, TAU); g.stroke();
    }

    /* measurements in flight, from the witness down to their lanes */
    var TR = [0, 0];
    for (n = 0; n < flying.length; n++) {
      l = flying[n][0]; var s = flying[n][1];
      g.strokeStyle = FILL(M.blue, 0.3 * ease(s / 0.1));
      g.lineWidth = 3.2;
      g.beginPath();
      for (k = 0; k <= 10; k++) {
        bez(l, Math.max(0, s - 0.2 * (1 - k / 10)), TR);
        if (k === 0) g.moveTo(TR[0], TR[1]); else g.lineTo(TR[0], TR[1]);
      }
      g.stroke();
      bez(l, s, TR);
      r = 6.4 * ease(s / 0.12);
      g.drawImage(M.sprB, TR[0] - r, TR[1] - r, 2 * r, 2 * r);
    }
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
  /* refuse — planimeter                                                 */
  /* ==================================================================== */
  function refuse(g, vb, t, st) {
    /* The same 528 files, answered by two tools, drawn as the drawings they
       are. Each file here is a small line drawing, generated from a fixed
       seed: a polygon, a polygon split by a chord, a house of two faces, a
       shape with a tail, a shape beside a loose stroke, or an open zigzag
       with no face at all. Every one has a junction where two endpoints sit
       almost on top of each other, which is how the 528 test drawings were
       constructed: endpoints microns apart.

       The top sheet is planimeter, the bottom sheet shapely.polygonize_full,
       and both sheets hold the same drawings in the same places. One wave
       passes through both in step, a file at a time. Where it passes, a
       drawing swells, its strokes are laid down, and its faces are found and
       filled. planimeter fills a face only when the answer is exact, 495
       times; 33 times it cannot give an exact answer, so it refuses, and the
       drawing is held open in amber at its near-miss junction with both
       endpoints marked. shapely answers every drawing, and at first its
       sheet looks like a perfect result, every drawing filled alike.

       Then a second wave checks every answer. On the top sheet it passes and
       nothing changes: 0 wrong.
       On the bottom sheet 336 answers turn coral as it passes, scattered all
       through the sheet, because a wrong answer looks exactly like a right
       one until it is checked. The sheets hold, then drain back to bare
       strokes in a wave and the tally runs again.

       Which drawing sits where, and which ones are refused or wrong, is an
       illustration; the counts are the measured ones.

       Drawing: drawings that share a colour and alphas (quantised to 24
       levels) share one path, so the 1,056 drawings cost at most 166 fills
       and strokes a frame whatever the waves are doing. */
    var TAU = Math.PI * 2;
    var C = 12500, A0 = 600, AD = 4800, V0 = 6000, VD = 2600, H1 = 8600, D0 = 11000, DD = 1200;
    var M = refuse.M || (refuse.M = build());

    function build() {
      var m = {};
      var s = 7;
      function rnd() {
        s = (s + 0x6D2B79F5) >>> 0;
        var x = s;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      }
      function rot(pts, th) {
        var c = Math.cos(th), sn = Math.sin(th);
        return pts.map(function (p) { return [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c]; });
      }
      function poly(n, rad) {
        var th0 = rnd() * TAU, out = [];
        for (var k = 0; k < n; k++) {
          var a = th0 + TAU * (k + (rnd() - 0.5) * 0.45) / n, rr = rad * (0.82 + 0.26 * rnd());
          out.push([rr * Math.cos(a), rr * Math.sin(a)]);
        }
        return out;
      }
      /* one drawing: an outline (closed unless it is the zigzag), extra
         strokes, and the faces those strokes enclose */
      function drawing() {
        var u = rnd(), o, ch = [], f;
        if (u < 0.3) {
          o = poly(rnd() < 0.5 ? 4 : 5, 4.7); f = [o];
        } else if (u < 0.55) {
          o = poly(rnd() < 0.5 ? 4 : 5, 4.9);
          ch.push([o[0], o[2]]);
          f = [o.slice(0, 3), o.slice(2).concat([o[0]])];
        } else if (u < 0.7) {
          var w = 3.3 + rnd() * 0.8, h = 2.6 + rnd() * 0.8, rf = 4.4 + rnd() * 0.8;
          o = rot([[-w, h], [w, h], [w, -1], [0, -rf], [-w, -1]], (rnd() - 0.5) * 0.9);
          ch.push([o[2], o[4]]);
          f = [[o[0], o[1], o[2], o[4]], [o[2], o[3], o[4]]];
        } else if (u < 0.85) {
          o = poly(rnd() < 0.5 ? 3 : 4, 3.9);
          var v = o[1], l = Math.hypot(v[0], v[1]);
          ch.push([v, [v[0] / l * 5.6, v[1] / l * 5.6]]);
          f = [o];
        } else if (u < 0.95) {
          o = poly(3, 3.2).map(function (p) { return [p[0] - 1.6, p[1]]; });
          ch.push(rot([[3.2, -3.4], [3.9, 3.6]], (rnd() - 0.5) * 0.6));
          f = [o];
        } else {
          o = rot([[-4.6, 2.2], [-1.6, -3], [1.4, 2.6], [4.6, -2.4]], rnd() * TAU);
          f = [];
        }
        return { o: o, ch: ch, f: f, open: f.length === 0 };
      }
      var COLS = 33, ROWS = 16, PXP = 13.2, PYP = 11, XA = 20.5, YS = [75, 276];
      m.gl = [];
      for (var i = 0; i < COLS * ROWS; i++) {
        var col = i % COLS, row = (i / COLS) | 0;
        var dr = drawing();
        dr.x = XA + (col + (row % 2 ? 0.5 : 0)) * PXP + (rnd() - 0.5) * 1.4;
        dr.y = row * PYP + (rnd() - 0.5) * 1.2;           /* relative to its sheet */
        /* one diagonal order for the answering wave, the drain and the check */
        var uu = (dr.x - XA + 0.45 * dr.y) / (32.5 * PXP + 0.45 * 15 * PYP);
        dr.tA = A0 + AD * uu + (rnd() - 0.5) * 160;
        dr.tV = V0 + VD * uu + (rnd() - 0.5) * 160;
        dr.tD = D0 + DD * uu + (rnd() - 0.5) * 100;
        dr.ref = false; dr.bad = false;
        m.gl.push(dr);
      }
      /* 33 refused and 336 wrong, drawn independently from the drawings that
         have a face, since it is not known which files the two sets share */
      var faced = m.gl.filter(function (d) { return !d.open; });
      function pick(n, key) {
        var a = faced.slice();
        for (var k = a.length - 1; k > 0; k--) { var j = (rnd() * (k + 1)) | 0, tmp = a[k]; a[k] = a[j]; a[j] = tmp; }
        for (k = 0; k < n; k++) a[k][key] = true;
      }
      pick(33, 'ref');
      pick(336, 'bad');
      m.YS = YS; m.XA = XA; m.XR = 32.5 * PXP; m.YR = 15 * PYP;
      m.mint = token('--mint-500', '#0b93ab');
      m.mint7 = token('--mint-700', '#0a6b7c');
      m.amber = token('--amber-500', '#d96a06');
      m.amber7 = token('--amber-700', '#9a4906');
      m.coral = token('--coral-500', '#d9376e');
      m.muted = token('--muted', '#5f5b53');
      return m;
    }

    var R = REDUCED;
    var tau = R ? 9800 : t % C;
    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    /* Strokes are one device pixel wide whatever the screen: crisp, and on
       the rasteriser's hairline path, which measured 13 ms a frame cheaper
       than 2-pixel strokes over these few thousand segments. */
    g.lineCap = 'butt'; g.lineJoin = 'miter'; g.miterLimit = 3;
    var HAIR = g.getTransform ? 0.98 / g.getTransform().a : 0.5;

    function bump(x) { return x <= 0 || x >= 1 ? 0 : Math.pow(Math.sin(Math.PI * x), 2); }

    /* --- the waves, as soft bands of light behind the drawings ---------- */
    var dx = 1, dy = 0.45, dl = Math.hypot(dx, dy), span = M.XR + 0.45 * M.YR;
    function band(sheet, u, col, a) {
      if (u < -0.08 || u > 1.08 || a <= 0) return;
      var y0 = M.YS[sheet];
      /* the front is the line x + 0.45 y = u * span, in the sheet's frame */
      var px = M.XA + u * span, py = y0;
      var gx0 = px - 46 * dx / dl, gy0 = py - 46 * dy / dl, gx1 = px + 10 * dx / dl, gy1 = py + 10 * dy / dl;
      var gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
      gr.addColorStop(0, rgba(col, 0));
      gr.addColorStop(0.8, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      /* only where the band is: the gradient is clear everywhere else */
      var xl = Math.max(8, px - 0.45 * (M.YR + 9) - 52), xr = Math.min(vb[0] - 8, px + 16);
      if (xr > xl) g.fillRect(xl, y0 - 9, xr - xl, M.YR + 18);
    }
    if (!R) {
      var ua = (tau - A0) / AD, uv = (tau - V0) / VD, ud = (tau - D0) / DD;
      band(0, ua, M.mint, 0.13); band(1, ua, M.mint, 0.13);
      band(0, uv, M.mint, 0.1); band(1, uv, M.coral, 0.12);
      band(0, ud, M.muted, 0.06); band(1, ud, M.muted, 0.06);
    }

    /* --- every drawing, twice, into shared paths ------------------------ */
    /* A bucket is one path: a kind, a colour, and a fill and a stroke alpha
       quantised to 24 levels. An answered drawing puts its outline and chords
       into one bucket, which is filled and then stroked, so each drawing is
       built once. Buckets live on the function and are reused every frame.
       Kinds: 0 bare strokes, 1 amber light, 2 answered, 3 held open, 4 the
       two endpoints of a refusal. */
    var BK = M.BK || (M.BK = []), used = M.used || (M.used = []);
    var COLS = [M.mint, M.coral, M.amber, M.muted], STRK = [M.mint7, M.coral, M.amber, M.muted];
    var ox = 0, oy = 0;
    function add(kind, ci, fa, sa, d, sh, sc, gap) {
      var fq = Math.round(Math.min(1, fa) * 24), sq = Math.round(Math.min(1, sa) * 24);
      if (fq + sq === 0) return;
      var key = ((kind * 4 + ci) * 25 + fq) * 25 + sq, b = BK[key];
      if (!b) b = BK[key] = { kind: kind, ci: ci, fa: fq / 24, sa: sq / 24, it: [] };
      if (!b.it.length) used.push(key);
      b.it.push(d, sh, sc, gap, ox, oy);
    }
    var hold = R ? 1 : ease((tau - H1 + 400) / 600) * (1 - ease((tau - D0 + 200) / 400));
    for (var i = 0; i < M.gl.length; i++) {
      var d = M.gl[i];
      var pA = tau - d.tA, pV = tau - d.tV, pD = tau - d.tD;
      if (R) { pA = 5000; pV = 5000; pD = -1; }
      var on = ease((pA - 60) / 300) * (1 - ease(pD / 380));          /* strokes laid */
      var filled = ease((pA - 220) / 380) * (1 - ease(pD / 380));     /* faces found */
      var ghost = 1 - on;
      var swA = 0.7 * bump(pA / 560), swV = bump(pV / 520);
      var drift = R ? 0 : 0.05 * hold * Math.sin(TAU * (tau / 3200 - (d.x + d.y) / 170));
      /* a lens rides the answering wave: drawings just ahead of its centre
         are pushed on, those just behind are held back, so the magnified
         ones have room */
      var lz = (pA - 280) / 560, push = Math.abs(lz) < 1 ? -4.5 * Math.sin(Math.PI * lz) : 0;
      ox = push * dx / dl; oy = push * dy / dl;
      for (var sh = 0; sh < 2; sh++) {
        var mine = sh === 0;
        var sc = 1 + swA + (mine ? 0.16 : d.bad ? 0.55 : 0.16) * swV + drift;
        if (ghost > 0.02) add(0, 3, 0, 0.34 * ghost, d, sh, sc, 0);
        if (on <= 0.02) continue;
        if (mine && d.ref) {
          /* refused: held open in amber, its two endpoints marked, and a
             soft amber light round it so a refusal is never missed */
          var gap = 1.3 * ease((pA - 200) / 380);
          add(1, 2, 0.17 * filled, 0, d, sh, sc, 7.5 * (1 + 0.1 * hold * Math.sin(TAU * tau / 2400 + d.x)));
          add(3, 2, 0, on, d, sh, sc, gap);
          add(4, 2, on, 0, d, sh, sc, gap);
          continue;
        }
        /* checked and found wrong: coral blooms from the middle of the
           drawing over its old answer, rather than the two mixing to grey */
        var wr = !mine && d.bad ? ease(pV / 420) : 0;
        var fl = d.open ? 0 : filled, keep = 1 - ease((wr - 0.55) / 0.45);
        if (keep > 0) add(2, 0, 0.46 * fl * keep, on * keep, d, sh, sc, 0);
        if (wr > 0) add(2, 1, 0.52 * fl, on * ease(wr / 0.3), d, sh, sc * (0.2 + 0.8 * wr), 0);
      }
    }

    /* --- flush, bare strokes first and endpoints last ------------------- */
    used.sort(function (a, b) { return a - b; });
    for (var k = 0; k < used.length; k++) {
      var b = BK[used[k]], it = b.it;
      g.beginPath();
      for (var n = 0; n < it.length; n += 6) {
        var dd = it[n], X = dd.x + it[n + 4], Y = M.YS[it[n + 1]] + dd.y + it[n + 5], S = it[n + 2], gp = it[n + 3], o = dd.o, p, q;
        if (b.kind === 1) {
          g.moveTo(X + gp, Y); g.arc(X, Y, gp, 0, TAU);
        } else if (b.kind === 4) {
          var l1 = o[1], ln = o[o.length - 1], a0 = o[0];
          var e1 = Math.hypot(l1[0] - a0[0], l1[1] - a0[1]), e2 = Math.hypot(ln[0] - a0[0], ln[1] - a0[1]);
          var ax = X + S * a0[0] + gp * (l1[0] - a0[0]) / e1, ay = Y + S * a0[1] + gp * (l1[1] - a0[1]) / e1;
          var bx = X + S * a0[0] + gp * (ln[0] - a0[0]) / e2, by = Y + S * a0[1] + gp * (ln[1] - a0[1]) / e2;
          var rr = 1.5 + (R ? 0 : 0.3 * hold * Math.sin(TAU * tau / 2400 + dd.x));
          g.moveTo(ax + rr, ay); g.arc(ax, ay, rr, 0, TAU);
          g.moveTo(bx + rr, by); g.arc(bx, by, rr, 0, TAU);
        } else {
          if (gp > 0) {
            /* the outline with a gap at its first vertex: it does not close */
            var s1 = o[1], sl = o[o.length - 1], z0 = o[0];
            var q1 = Math.hypot(s1[0] - z0[0], s1[1] - z0[1]), q2 = Math.hypot(sl[0] - z0[0], sl[1] - z0[1]);
            g.moveTo(X + S * z0[0] + gp * (s1[0] - z0[0]) / q1, Y + S * z0[1] + gp * (s1[1] - z0[1]) / q1);
            for (p = 1; p < o.length; p++) g.lineTo(X + S * o[p][0], Y + S * o[p][1]);
            g.lineTo(X + S * z0[0] + gp * (sl[0] - z0[0]) / q2, Y + S * z0[1] + gp * (sl[1] - z0[1]) / q2);
          } else {
            g.moveTo(X + S * o[0][0], Y + S * o[0][1]);
            for (p = 1; p < o.length; p++) g.lineTo(X + S * o[p][0], Y + S * o[p][1]);
            if (!dd.open) g.closePath();
          }
          for (q = 0; q < dd.ch.length; q++) {
            var c2 = dd.ch[q];
            g.moveTo(X + S * c2[0][0], Y + S * c2[0][1]); g.lineTo(X + S * c2[1][0], Y + S * c2[1][1]);
          }
        }
      }
      if (b.fa > 0) { g.fillStyle = rgba(b.kind === 4 ? M.amber7 : COLS[b.ci], b.fa); g.fill(); }
      if (b.sa > 0) {
        g.strokeStyle = rgba(STRK[b.ci], b.sa);
        g.lineWidth = b.kind === 3 ? 1.3 : HAIR;
        g.stroke();
      }
      it.length = 0;
    }
    used.length = 0;
  }

  /* ==================================================================== */
  /* cut — topological-ml-toolkit                                        */
  /* ==================================================================== */
  function cut(g, vb, t, st) {
    /* Persistent homology, computed here rather than drawn from memory.

       The cloud is 82 points sampled with noise around two loops of different
       size, from a fixed seed so it is the same cloud on every visit. Grow a
       scale r. Two points are joined by an edge once they are within r of each
       other, and three points fill a triangle once all three edges exist: that
       is the Vietoris-Rips complex, and the figure builds it on load, 1,613
       edges and 16,095 triangles up to the last death. Its homology is then
       computed exactly: pieces merge in a union-find over the edges in order
       of length (H0), and loops are born and killed by reducing the triangle
       boundary matrix over Z/2 (H1). Every bar in the barcode is one of those
       pairs: 82 pieces, one of which never dies, and 8 loops.

       The cloud shows the same computation in the plane. Each 1.5-unit cell
       records the scale at which a triangle first covers it, and the scale at
       which edges first wall it off from the outside (a union-find run with r
       going down). A cell walled off and not yet covered is inside a hole, and
       every walled-off group must match a real H1 bar or it is not drawn. So a
       hole glows from the moment its loop closes, violet at the rim and blue
       where it has longest to live, shrinks as longer triangles reach across
       it, flares, and fills at exactly the scale its bar ends. Filled cells
       are mint where they were never enclosed and violet where they were once
       a hole. Beneath, a sweep at the same r draws the barcode bar by bar, and
       when a true loop dies, or the two pieces join, a thread of light runs
       from where it happened to the end of its bar.

       Then the cut. The bars slide left so each is measured by how long it
       lived, the loops re-sort by that length, and a cut sweeps in from the
       right. Every bar it crosses leaves a bead, and that column of beads is
       the feature: two pieces and two loops. The noise, 80 short H0 bars and
       6 short loops, is greyed out and kept. The cloud meanwhile rewinds to a
       scale inside the cut where exactly two pieces and two holes exist, so
       the beads and the picture say the same thing. Mint is always a piece,
       violet always a loop, and coral is only ever the cut.

       Cost: the homology and cell fields are built once and cached on the
       function, about 80 ms in the preview. Per frame the cell field is one
       putImageData and one drawImage, and every edge bucket, bar group and
       bead set is one batched path: at most 36 draw calls. */
    var TAU = Math.PI * 2;
    var C = 16000;
    var X0 = 34, X1 = 436;
    var M = cut.M || (cut.M = build());

    function build() {
      var m = {};
      /* the cloud: mulberry32 from seed 1, two noisy loops, then placed */
      var s = 1;
      function rnd() {
        s = (s + 0x6D2B79F5) >>> 0;
        var x = s;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      }
      function gauss() { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(TAU * rnd()); }
      var PX = [], PY = [];
      function loop(cx, cy, rx, ry, n) {
        for (var i = 0; i < n; i++) {
          var th = (i + (rnd() - 0.5) * 0.7) / n * TAU, rr = 1 + gauss() * 0.15;
          PX.push(cx + rx * rr * Math.cos(th)); PY.push(cy + ry * rr * Math.sin(th));
        }
      }
      loop(150, 172, 90, 76, 50);
      loop(356, 170, 58, 54, 32);
      var N = PX.length, SC = 0.9, i, j, k;
      for (i = 0; i < N; i++) { PX[i] = 235 + (PX[i] - 235) * SC; PY[i] = 172 + (PY[i] - 170) * SC; }
      m.PX = PX; m.PY = PY; m.N = N;

      /* edges, shortest first, up to a cap past the last death */
      var RCAP = 132, EA = [], EB = [], EL = [], ord = [];
      for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) {
        var l = Math.hypot(PX[i] - PX[j], PY[i] - PY[j]);
        if (l <= RCAP) { EA.push(i); EB.push(j); EL.push(l); }
      }
      for (i = 0; i < EL.length; i++) ord.push(i);
      ord.sort(function (a, b) { return EL[a] - EL[b]; });
      var NE = ord.length;
      m.EA = new Int16Array(NE); m.EB = new Int16Array(NE); m.EL = new Float32Array(NE);
      var eid = new Int32Array(N * N).fill(-1);
      for (k = 0; k < NE; k++) {
        var o = ord[k];
        m.EA[k] = EA[o]; m.EB[k] = EB[o]; m.EL[k] = EL[o];
        eid[EA[o] * N + EB[o]] = k; eid[EB[o] * N + EA[o]] = k;
      }
      m.NE = NE;

      /* H0: union-find over the edges in order */
      var par = new Int32Array(N);
      for (i = 0; i < N; i++) par[i] = i;
      function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
      m.h0 = [];
      for (k = 0; k < NE; k++) {
        var ra = find(m.EA[k]), rb = find(m.EB[k]);
        if (ra !== rb) {
          par[ra] = rb;
          m.h0.push({ d: m.EL[k], mx: (PX[m.EA[k]] + PX[m.EB[k]]) / 2, my: (PY[m.EA[k]] + PY[m.EB[k]]) / 2 });
        }
      }
      m.h0.push({ d: Infinity, mx: 0, my: 0 });        /* the one that never dies */

      /* triangles, ordered by (longest edge, next, next) = by diameter */
      var keys = [], NE2 = NE * NE;
      for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) {
        var a1 = eid[i * N + j];
        if (a1 < 0) continue;
        for (k = j + 1; k < N; k++) {
          var b1 = eid[i * N + k], c1 = eid[j * N + k];
          if (b1 < 0 || c1 < 0) continue;
          var e0 = Math.max(a1, b1, c1), e2 = Math.min(a1, b1, c1), e1 = a1 + b1 + c1 - e0 - e2;
          keys.push(e0 * NE2 + e1 * NE + e2);
        }
      }
      var TK = new Float64Array(keys);
      TK.sort();
      m.NT = TK.length;

      /* H1: column reduction of the triangle boundary matrix over Z/2 */
      var pivot = new Int32Array(NE).fill(-1), cols = [];
      var tv = new Int16Array(TK.length * 3);           /* triangle vertices, for the raster */
      m.h1 = [];
      for (var q = 0; q < TK.length; q++) {
        var key = TK[q], x0 = Math.floor(key / NE2), rem = key - x0 * NE2;
        var x1 = Math.floor(rem / NE), x2 = rem - x1 * NE;
        var va = m.EA[x0], vbb = m.EB[x0];
        var vc = (m.EA[x1] !== va && m.EA[x1] !== vbb) ? m.EA[x1] : m.EB[x1];
        tv[q * 3] = va; tv[q * 3 + 1] = vbb; tv[q * 3 + 2] = vc;
        var col = [x0, x1, x2];
        while (col.length && pivot[col[0]] >= 0) {
          var oc = cols[pivot[col[0]]], r2 = [], p1 = 0, p2 = 0;
          while (p1 < col.length || p2 < oc.length) {
            if (p2 >= oc.length || (p1 < col.length && col[p1] > oc[p2])) r2.push(col[p1++]);
            else if (p1 >= col.length || oc[p2] > col[p1]) r2.push(oc[p2++]);
            else { p1++; p2++; }
          }
          col = r2;
        }
        cols.push(col);
        if (!col.length) continue;
        pivot[col[0]] = q;
        var bth = m.EL[col[0]], dth = m.EL[x0];
        if (dth - bth > 0.05) {
          m.h1.push({ b: bth, d: dth, be: col[0],
                      cx: (PX[va] + PX[vbb] + PX[vc]) / 3, cy: (PY[va] + PY[vbb] + PY[vc]) / 3 });
        }
      }

      /* the scale the sweep runs to, the cut, and the scale the cloud rests at */
      var fin = m.h0.filter(function (b) { return b.d < Infinity; }).map(function (b) { return b.d; });
      fin.sort(function (a, b) { return b - a; });
      var p1s = m.h1.map(function (b) { return b.d - b.b; }).sort(function (a, b) { return b - a; });
      m.RMAX = Math.ceil(Math.max(fin[0], m.h1.reduce(function (a, b) { return Math.max(a, b.d); }, 0)) * 1.07);
      m.CUT = 0.5 * (Math.max(fin[1], p1s[2]) + Math.min(fin[0], p1s[1]));
      m.RSTAR = 0.87 * fin[0];

      /* the cell fields */
      var CELL = 1.5, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (i = 0; i < N; i++) {
        minx = Math.min(minx, PX[i]); maxx = Math.max(maxx, PX[i]);
        miny = Math.min(miny, PY[i]); maxy = Math.max(maxy, PY[i]);
      }
      var BX = minx - 6, BY = miny - 6;
      var GW = Math.ceil((maxx + 6 - BX) / CELL), GH = Math.ceil((maxy + 6 - BY) / CELL), NC = GW * GH;
      m.BX = BX; m.BY = BY; m.GW = GW; m.GH = GH; m.CELL = CELL;
      var INF = 1e9, fT = new Float32Array(NC).fill(INF), fA = new Float32Array(NC).fill(INF);
      /* triangles, scanline over cell centres, smallest diameter first so the
         first triangle to reach a cell is the scale it is covered at */
      (function (fT, tv, TK, EL, PX, PY, NE2, BX, BY, GW, GH, CELL, INF) {
        for (var q = 0; q < TK.length; q++) {
          var ia = tv[q * 3], ib = tv[q * 3 + 1], ic = tv[q * 3 + 2];
          var dq = EL[Math.floor(TK[q] / NE2)];
          var ax = PX[ia], ay = PY[ia], bx = PX[ib], by = PY[ib], cx = PX[ic], cy = PY[ic];
          var jy0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - BY) / CELL - 0.5));
          var jy1 = Math.min(GH - 1, Math.floor((Math.max(ay, by, cy) - BY) / CELL - 0.5));
          for (var jy = jy0; jy <= jy1; jy++) {
            var yy = BY + (jy + 0.5) * CELL, lo = 1e9, hi = -1e9, xx;
            if ((yy < ay) !== (yy < by)) { xx = ax + (bx - ax) * (yy - ay) / (by - ay); if (xx < lo) lo = xx; if (xx > hi) hi = xx; }
            if ((yy < by) !== (yy < cy)) { xx = bx + (cx - bx) * (yy - by) / (cy - by); if (xx < lo) lo = xx; if (xx > hi) hi = xx; }
            if ((yy < cy) !== (yy < ay)) { xx = cx + (ax - cx) * (yy - cy) / (ay - cy); if (xx < lo) lo = xx; if (xx > hi) hi = xx; }
            var ix0 = Math.max(0, Math.ceil((lo - BX) / CELL - 0.5)), ix1 = Math.min(GW - 1, Math.floor((hi - BX) / CELL - 0.5));
            for (var ix = ix0, cc = jy * GW + ix0; ix <= ix1; ix++, cc++) if (fT[cc] === INF) fT[cc] = dq;
          }
        }
      })(fT, tv, TK, m.EL, new Float64Array(PX), new Float64Array(PY), NE2, BX, BY, GW, GH, CELL, INF);
      /* edges, sampled at half a cell so the wall they make is 8-connected */
      for (k = 0; k < NE; k++) {
        var xa = PX[m.EA[k]], ya2 = PY[m.EA[k]], xb = PX[m.EB[k]], yb2 = PY[m.EB[k]];
        var ns = Math.ceil(m.EL[k] / (CELL / 2));
        for (var u = 0; u <= ns; u++) {
          var ci = Math.floor((xa + (xb - xa) * u / ns - BX) / CELL), cj = Math.floor((ya2 + (yb2 - ya2) * u / ns - BY) / CELL);
          var c2 = cj * GW + ci;
          if (fA[c2] > m.EL[k]) fA[c2] = m.EL[k];
        }
      }
      for (i = 0; i < NC; i++) if (fT[i] < fA[i]) fA[i] = fT[i];
      /* Enclosure. Run the scale downwards and add each cell as it becomes
         uncovered, joining it to its uncovered neighbours (union-find), with
         the border and never-covered cells joined to the outside. A group of
         cells that has not reached the outside is walled in: a hole. It joins
         the outside at the scale its loop closed, and its first cell is the
         scale it filled. That pair must match a real H1 bar; a group that
         matches none is an artefact of the cell walls and is never drawn. */
      var enc = new Float32Array(NC).fill(INF), OUT = NC;
      var up = new Int32Array(NC + 1), nxt = new Int32Array(NC).fill(-1), tail = new Int32Array(NC);
      var size = new Int32Array(NC + 1), eld = new Float32Array(NC + 1), added = new Uint8Array(NC);
      var cord = new Int32Array(NC);
      for (i = 0; i < NC; i++) cord[i] = i;
      cord.sort(function (a, b) { return fA[b] - fA[a]; });
      up[OUT] = OUT;
      function root(x) { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; }
      var h1s = m.h1;
      function join(a, b, v) {
        var ra = root(a), rb = root(b);
        if (ra === rb) return;
        if (ra === OUT || rb === OUT) {
          var cmp = ra === OUT ? rb : ra, e = eld[cmp], bar = null;
          for (var z = 0; z < h1s.length; z++) {
            if (h1s[z].d - e >= -0.01 && h1s[z].d - e <= 4 && h1s[z].b <= e) { bar = h1s[z]; break; }
          }
          var st0 = bar && e < INF ? Math.max(v, bar.b) : INF;
          for (var mm = cmp; mm >= 0; mm = nxt[mm]) enc[mm] = st0;
          up[cmp] = OUT;
          return;
        }
        if (size[ra] < size[rb]) { var tmp = ra; ra = rb; rb = tmp; }
        up[rb] = ra; size[ra] += size[rb];
        if (eld[rb] > eld[ra]) eld[ra] = eld[rb];
        nxt[tail[ra]] = rb; tail[ra] = tail[rb];
      }
      for (q = 0; q < NC; q++) {
        var cq = cord[q], v = fA[cq], xq = cq % GW, yq = (cq / GW) | 0;
        up[cq] = cq; size[cq] = 1; eld[cq] = v; tail[cq] = cq; added[cq] = 1;
        if (v >= INF || xq === 0 || yq === 0 || xq === GW - 1 || yq === GH - 1) join(cq, OUT, v);
        if (xq > 0 && added[cq - 1]) join(cq, cq - 1, v);
        if (xq < GW - 1 && added[cq + 1]) join(cq, cq + 1, v);
        if (yq > 0 && added[cq - GW]) join(cq, cq - GW, v);
        if (yq < GH - 1 && added[cq + GW]) join(cq, cq + GW, v);
      }
      m.fT = fT; m.fA = fA; m.enc = enc;

      /* the offscreen cell image */
      m.off = document.createElement('canvas');
      m.off.width = GW; m.off.height = GH;
      m.octx = m.off.getContext('2d');
      m.img = m.octx.createImageData(GW, GH);

      /* barcode rows: loops on top in order of birth, then pieces by death */
      /* the two longest pieces get room of their own, so their beads never merge */
      var BY0 = 288, P1 = 8.5, GAP = 10, P0 = 1.0, PL = 9;
      m.h1.sort(function (a, b) { return a.b - b.b; });
      var byP = m.h1.slice().sort(function (a, b) { return (b.d - b.b) - (a.d - a.b); });
      m.h1.forEach(function (b, n) { b.yB = BY0 + n * P1; b.yP = BY0 + byP.indexOf(b) * P1; b.p = b.d - b.b; });
      m.h0.sort(function (a, b) { return b.d - a.d; });
      var Y0 = BY0 + m.h1.length * P1 + GAP;
      m.h0.forEach(function (b, n) { b.y = Y0 + Math.min(n, 2) * PL + Math.max(0, n - 2) * P0; b.b = 0; b.p = b.d; });
      m.barTop = BY0 - 4; m.barBot = m.h0[m.h0.length - 1].y + 3;

      /* colours as channels, for the cell image */
      function ch(name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      m.cMint = ch('--mint-500', '#0b93ab');
      m.cViolet = ch('--violet-500', '#a66cf0');
      m.cBlue = ch('--blue-500', '#2456dc');
      m.violet = token('--violet-500', '#a66cf0');
      m.violet7 = token('--violet-700', '#6b35c4');
      m.mint = token('--mint-500', '#0b93ab');
      m.mint7 = token('--mint-700', '#0a6b7c');
      m.coral = token('--coral-500', '#d9376e');
      m.coral7 = token('--coral-700', '#a0183f');
      m.hair = token('--hair2', '#cfcbc1');
      m.muted = token('--muted', '#5f5b53');
      m.raised = token('--raised', '#ffffff');
      return m;
    }

    /* --- time ----------------------------------------------------------- */
    var R = REDUCED;
    var tau = R ? 13400 : t % C;
    var RM = M.RMAX, RS = M.RSTAR, kx = (X1 - X0) / RM;
    function X(v) { return X0 + kx * v; }
    function prog(a, d) { return ease((tau - a) / d); }
    /* the sweep: constant speed through the middle, easing in and out */
    function sweep(k) {
      var e = 0.1;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      var v = k < e ? k * k / (2 * e) : k < 1 - e ? k - e / 2 : 1 - e - (1 - k) * (1 - k) / (2 * e);
      return v / (1 - e);
    }
    var r;
    if (tau < 500) r = 0;
    else if (tau < 7700) r = RM * sweep((tau - 500) / 7200);
    else if (tau < 9900) r = RM + (RS - RM) * prog(7700, 2200);
    else if (tau < 14400) r = RS;
    else r = RS * (1 - prog(14400, 1400));
    var inSweep = tau >= 500 && tau < 7700;
    var slide = prog(7700, 1400), sortk = prog(9300, 1200);
    var cutk = prog(10600, 1400), settle = prog(11600, 800), outk = prog(14400, 1400);
    var sweepA = tau < 7700 ? ease((tau - 300) / 400) : 1 - prog(7700, 500);
    var breathe = R ? 0 : Math.sin((tau - 12000) / 2000 * TAU);
    /* the rewind runs r back fast, so cells fade across a wider band of r
       while it does, and a hole reopens over many frames rather than a few */
    var ew = 4 + (tau > 7600 && tau < 10000 ? 5 * Math.sin(Math.PI * (tau - 7600) / 2400) : 0);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* --- the cell field: covered region and open holes ------------------ */
    /* Covered cells are mint (a piece) or violet (it was a hole once), and
       brighter for a moment after they are covered, so the front of the fill
       can be seen moving. Open holes are violet deepening to blue with how
       much longer they have to live, brightest at the rim about to close. */
    var fT = M.fT, fA = M.fA, enc = M.enc, d = M.img.data, NC = M.GW * M.GH;
    var glow = settle * (1 - outk);
    var cm = M.cMint, cv = M.cViolet, cb = M.cBlue;
    var holeGlow = 0.16 * glow * (1 + 0.3 * breathe), pieceGlow = 0.08 * glow, RIM = 0.8;
    for (var c = 0, o4 = 0; c < NC; c++, o4 += 4) {
      var ft = fT[c], a = 0;
      if (ft <= r) {
        if (enc[c] < ft) {
          /* it was a hole: it takes over at the brightness the hole had
             when it closed and settles, so a hole flares and never blinks */
          d[o4] = cv[0]; d[o4 + 1] = cv[1]; d[o4 + 2] = cv[2];
          a = 0.1 + (RIM * ease((ft - enc[c]) / 9) - 0.1) * Math.exp(-(r - ft) / 6);
        } else {
          d[o4] = cm[0]; d[o4 + 1] = cm[1]; d[o4 + 2] = cm[2];
          a = (0.1 + 0.2 * Math.exp(-(r - ft) / 7) + pieceGlow) * ease((r - ft) / ew);
        }
      } else if (enc[c] <= r && fA[c] > r) {
        var fa = fA[c], depth = fa - r, w = Math.min(1, depth / 60);
        d[o4] = cv[0] + (cb[0] - cv[0]) * w;
        d[o4 + 1] = cv[1] + (cb[1] - cv[1]) * w;
        d[o4 + 2] = cv[2] + (cb[2] - cv[2]) * w;
        a = (0.34 + (RIM - 0.34) * Math.exp(-depth / 5) + holeGlow) * ease((r - enc[c]) / 9);
      }
      d[o4 + 3] = a > 0 ? Math.round(a * 255) : 0;
    }
    M.octx.putImageData(M.img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(M.off, M.BX, M.BY, M.GW * M.CELL, M.GH * M.CELL);

    var PX = M.PX, PY = M.PY, N = M.N, n, b;

    /* --- balls of radius r/2: they touch exactly when the edge exists ---- */
    var ballA = 1 - ease((r - 18) / 22);
    if (r > 0.5 && ballA > 0.01) {
      g.beginPath();
      for (n = 0; n < N; n++) { g.moveTo(PX[n] + r / 2, PY[n]); g.arc(PX[n], PY[n], r / 2, 0, TAU); }
      g.fillStyle = rgba(M.violet, 0.07 * ballA); g.fill();
      g.strokeStyle = rgba(M.violet, 0.24 * ballA); g.lineWidth = 0.7; g.stroke();
    }

    /* --- edges: four buckets, short or long, fresh or settled ----------- */
    /* Short edges stay drawn. A long edge is drawn as it appears and fades
       over the next 14 units of r: at large r there are over a thousand of
       them spanning the whole cloud, the fill already shows what they
       enclose, and stroking them all would bury the holes and the frame
       budget together. */
    var EA = M.EA, EB = M.EB, EL = M.EL;
    var bk = [[], [], [], []];
    for (var k = 0; k < M.NE && EL[k] <= r; k++) {
      var age = r - EL[k];
      if (EL[k] <= 34) bk[age < 5 ? 0 : 1].push(k);
      else if (age < 14 && sweepA > 0.01) bk[age < 5 ? 2 : 3].push(k);
    }
    var ES = [[M.violet7, 0.66, 1.15], [M.violet, 0.36, 0.85], [M.violet, 0.26 * sweepA, 0.8], [M.violet, 0.1 * sweepA, 0.7]];
    for (var q = 3; q >= 0; q--) {
      if (!bk[q].length) continue;
      g.beginPath();
      for (n = 0; n < bk[q].length; n++) {
        var ek = bk[q][n];
        g.moveTo(PX[EA[ek]], PY[EA[ek]]); g.lineTo(PX[EB[ek]], PY[EB[ek]]);
      }
      g.strokeStyle = rgba(ES[q][0], ES[q][1]); g.lineWidth = ES[q][2]; g.stroke();
    }

    /* --- a loop closing, and a loop dying, as the sweep passes ---------- */
    function bump(x) { return x <= 0 || x >= 1 ? 0 : Math.pow(x * Math.exp(1 - x), 2) * (1 - x) * 1.6; }
    var hits = [];
    if (inSweep) {
      for (n = 0; n < M.h1.length; n++) {
        b = M.h1[n];
        var big = b.p > M.CUT;
        var kb = bump((r - b.b) / (big ? 14 : 8));
        if (kb > 0.01) {
          g.strokeStyle = rgba(M.violet7, 0.95 * kb); g.lineWidth = big ? 3.2 : 2.2;
          g.beginPath(); g.moveTo(PX[EA[b.be]], PY[EA[b.be]]); g.lineTo(PX[EB[b.be]], PY[EB[b.be]]); g.stroke();
        }
        var kd = (r - b.d) / (big ? 18 : 8);
        if (kd > 0 && kd < 1) {
          var ring = 1 - (1 - kd) * (1 - kd) * (1 - kd);
          g.strokeStyle = rgba(M.violet7, (big ? 0.75 : 0.45) * (1 - kd) * (1 - kd) * ease(kd / 0.12));
          g.lineWidth = big ? 2.4 : 1.4;
          g.beginPath(); g.arc(b.cx, b.cy, (big ? 6 : 3) + (big ? 30 : 8) * ring, 0, TAU); g.stroke();
          if (big) hits.push([b.cx, b.cy, X(b.d), b.yB, 1 - kd, M.violet7]);
        }
      }
      b = M.h0[1];
      var km = (r - b.d) / 18;
      if (km > 0 && km < 1) {
        var rm = 1 - (1 - km) * (1 - km) * (1 - km);
        g.strokeStyle = rgba(M.mint7, 0.75 * (1 - km) * (1 - km) * ease(km / 0.12)); g.lineWidth = 2.4;
        g.beginPath(); g.arc(b.mx, b.my, 5 + 22 * rm, 0, TAU); g.stroke();
        hits.push([b.mx, b.my, X(b.d), b.y, 1 - km, M.mint7]);
      }
    }

    /* --- the points ----------------------------------------------------- */
    var grow = R || t >= 900 ? 1 : 0.6 + 0.4 * ease(t / 900);
    g.fillStyle = rgba(M.violet, 0.18);
    g.beginPath();
    for (n = 0; n < N; n++) { g.moveTo(PX[n] + 4.6 * grow, PY[n]); g.arc(PX[n], PY[n], 4.6 * grow, 0, TAU); }
    g.fill();
    g.fillStyle = rgba(M.violet7, 1);
    g.beginPath();
    for (n = 0; n < N; n++) { g.moveTo(PX[n] + 2.2 * grow, PY[n]); g.arc(PX[n], PY[n], 2.2 * grow, 0, TAU); }
    g.fill();
    g.fillStyle = rgba(M.raised, 0.85);
    g.beginPath();
    for (n = 0; n < N; n++) { g.moveTo(PX[n] - 0.5 + 0.8 * grow, PY[n] - 0.7); g.arc(PX[n] - 0.5, PY[n] - 0.7, 0.8 * grow, 0, TAU); }
    g.fill();

    /* --- threads from a death in the cloud to the end of its bar -------- */
    for (n = 0; n < hits.length; n++) {
      var h = hits[n], ha = h[4] * ease((1 - h[4]) / 0.15);
      var tg = g.createLinearGradient(h[0], h[1], h[2], h[3]);
      tg.addColorStop(0, rgba(h[5], 0.1 * ha));
      tg.addColorStop(1, rgba(h[5], 0.85 * ha));
      g.strokeStyle = tg; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(h[0], h[1]);
      g.quadraticCurveTo(h[0] + (h[2] - h[0]) * 0.2, h[3] - 10, h[2], h[3]); g.stroke();
      g.fillStyle = rgba(h[5], 0.9 * ha);
      g.beginPath(); g.arc(h[2], h[3], 3.2, 0, TAU); g.fill();
    }

    /* --- the barcode ---------------------------------------------------- */
    var top = M.barTop, bot = M.barBot;
    if (sweepA > 0.01) {
      var sx = X(Math.min(r, RM));
      var sg = g.createLinearGradient(sx - 18, 0, sx, 0);
      sg.addColorStop(0, rgba(M.violet, 0));
      sg.addColorStop(1, rgba(M.violet, 0.18 * sweepA));
      g.fillStyle = sg; g.fillRect(sx - 18, top, 18, bot - top);
      g.strokeStyle = rgba(M.violet7, 0.6 * sweepA); g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(sx, top - 3); g.lineTo(sx, bot + 3); g.stroke();
    }

    var cutX = X1 + 14 - (X1 + 14 - X(M.CUT)) * cutk;
    var fade = 1 - outk;
    /* one bar's span now: drawn out by the sweep, slid to zero, retracted */
    function span(b) {
      var s0 = b.b, s1 = inSweep ? Math.min(r, b.d) : tau < 500 ? s0 : Math.min(b.d, RM * 1.02);
      var xs = X(s0 * (1 - slide)), xe = X(s1 - s0 * slide);
      if (b.d === Infinity && tau >= 7700) xe = X1 + 4;
      return [xs, xe + (xs - xe) * outk];
    }
    function survivor(b) { return b.p > M.CUT; }

    /* pieces: the noise comb in one stroke, the two long ones on their own */
    var tipsP = [];
    g.lineCap = 'butt';
    g.beginPath();
    for (n = 2; n < M.h0.length; n++) {
      b = M.h0[n];
      var sp0 = span(b);
      if (sp0[1] - sp0[0] < 0.3) continue;
      g.moveTo(sp0[0], b.y); g.lineTo(sp0[1], b.y);
      if (inSweep && r < b.d) tipsP.push(sp0[1], b.y);
    }
    /* one gradient for the whole comb, brightest where the pieces die */
    var cg0 = g.createLinearGradient(X0, 0, X(M.h0[2].d), 0);
    cg0.addColorStop(0, rgba(M.mint, (0.3 - 0.15 * settle) * fade));
    cg0.addColorStop(1, rgba(M.mint, (0.8 - 0.4 * settle) * fade));
    g.strokeStyle = cg0; g.lineWidth = 0.6; g.stroke();
    if (settle > 0) { g.strokeStyle = rgba(M.hair, 0.5 * settle * fade); g.stroke(); }
    if (tipsP.length) {
      g.fillStyle = rgba(M.mint7, 0.85);
      g.beginPath();
      for (n = 0; n < tipsP.length; n += 2) { g.moveTo(tipsP[n] + 1.2, tipsP[n + 1]); g.arc(tipsP[n], tipsP[n + 1], 1.2, 0, TAU); }
      g.fill();
    }

    /* every other bar is stroked on its own: two long pieces and the loops */
    var bars = [M.h0[0], M.h0[1]].concat(M.h1);
    for (n = 0; n < bars.length; n++) {
      b = bars[n];
      var loop1 = n >= 2;
      if ((inSweep && r <= b.b) || tau < 500) continue;
      var sp1 = span(b), y1 = loop1 ? b.yB + (b.yP - b.yB) * sortk : b.y, sv = survivor(b);
      if (sp1[1] - sp1[0] < 0.3) continue;
      var c5 = loop1 ? M.violet : M.mint, c7 = loop1 ? M.violet7 : M.mint7;
      var lw = (loop1 ? 2.8 : 2.2) + (sv ? 1.2 * settle : -0.6 * settle);
      var bg = g.createLinearGradient(sp1[0], 0, sp1[1], 0);
      bg.addColorStop(0, rgba(c5, (sv ? 0.75 : 0.7 - 0.35 * settle) * fade));
      bg.addColorStop(1, rgba(sv ? c7 : c5, (sv ? 1 : 0.85 - 0.45 * settle) * fade));
      g.strokeStyle = bg; g.lineWidth = lw;
      if (b.d === Infinity && tau >= 7700) {
        /* the piece that never dies runs off the end rather than stopping */
        var ig = g.createLinearGradient(X1 - 40, 0, X1 + 4, 0);
        ig.addColorStop(0, rgba(c7, fade)); ig.addColorStop(1, rgba(c7, 0));
        g.strokeStyle = ig;
      }
      g.beginPath(); g.moveTo(sp1[0], y1); g.lineTo(sp1[1], y1); g.stroke();
      if (!sv && settle > 0) { g.strokeStyle = rgba(M.hair, 0.55 * settle * fade); g.stroke(); }
      if (sv && glow > 0.01 && !R) {
        /* light running along a bar that survived */
        var fl = ((tau - 12000) / 1900 + n * 0.21) % 1, fx = sp1[0] + (sp1[1] - sp1[0]) * fl;
        var fg = g.createLinearGradient(fx - 44, 0, fx + 4, 0);
        fg.addColorStop(0, rgba(M.raised, 0));
        fg.addColorStop(0.9, rgba(M.raised, 0.75 * glow));
        fg.addColorStop(1, rgba(M.raised, 0));
        g.strokeStyle = fg; g.lineWidth = lw * 0.45;
        g.beginPath(); g.moveTo(Math.max(sp1[0], fx - 44), y1); g.lineTo(Math.min(sp1[1], fx + 4), y1); g.stroke();
      }
      if (inSweep && r < b.d) {
        g.fillStyle = rgba(c7, 1);
        g.beginPath(); g.arc(sp1[1], y1, loop1 ? 2.6 : 2.2, 0, TAU); g.fill();
      }
    }
    g.lineCap = 'round';

    /* --- the cut, and the beads it leaves on every bar it crosses ------- */
    var cutA = ease((tau - 10600) / 300) * fade;
    if (cutA > 0.01) {
      var cg = g.createLinearGradient(cutX - 12, 0, cutX + 12, 0);
      cg.addColorStop(0, rgba(M.coral, 0));
      cg.addColorStop(0.5, rgba(M.coral, 0.16 * cutA));
      cg.addColorStop(1, rgba(M.coral, 0));
      g.fillStyle = cg; g.fillRect(cutX - 12, top - 6, 24, bot - top + 12);
      g.strokeStyle = rgba(M.coral, 0.9 * cutA); g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cutX, top - 6); g.lineTo(cutX, bot + 6); g.stroke();
      var beads = [];
      for (n = 0; n < bars.length; n++) {
        b = bars[n];
        var sp2 = span(b), yb = n >= 2 ? b.yB + (b.yP - b.yB) * sortk : b.y;
        var over = ease((sp2[1] - cutX) / 10);
        if (over > 0.01) beads.push(cutX, yb, over);
      }
      if (beads.length) {
        var pul = 1 + 0.1 * glow * breathe;
        g.fillStyle = rgba(M.coral, 0.2 * cutA);
        g.beginPath();
        for (n = 0; n < beads.length; n += 3) {
          var rh = 7 * beads[n + 2] * pul;
          g.moveTo(beads[n] + rh, beads[n + 1]); g.arc(beads[n], beads[n + 1], rh, 0, TAU);
        }
        g.fill();
        g.fillStyle = rgba(M.raised, cutA);
        g.strokeStyle = rgba(M.coral, cutA); g.lineWidth = 2;
        g.beginPath();
        for (n = 0; n < beads.length; n += 3) {
          var rc = 3.2 * beads[n + 2];
          g.moveTo(beads[n] + rc, beads[n + 1]); g.arc(beads[n], beads[n + 1], rc, 0, TAU);
        }
        g.fill(); g.stroke();
      }
    }
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
  /* smatrix — resolvent                                                 */
  /* ==================================================================== */
  function smatrix(g, vb, t, st) {
    /* resolvent reads one causal attention head through a resolvent,
       (I - gP)^-1 = I + gP + g^2 P^2 + ..., the closed form the
       Lippmann-Schwinger equation gives the scattering operator. The hop
       expansion is the Born series, and g times the spectral radius of P
       staying under one is why it converges. Wheeler's S-matrix (1937) maps
       in-states to out-states "with no account of the path between them".

       So the figure builds the series as a solid, the way a video becomes a
       block when every frame is stacked along time. The plane of each slice
       is state space, a 40 by 40 lattice; the depth axis is hop order. Slice
       k is g^k P^k x0, computed for real: x0 is all its mass on one site,
       and P is a directed transition matrix, a drift that turns the mass
       forward round the centre and a little inward on every hop, never back,
       plus a small Gaussian spread. Every column of P sums to one, so mass is
       conserved, rho(P) = 1, and g = 0.82 keeps the series convergent. The
       plume that leaves x0 travels, shears and widens, and through the stack
       it is a tapering helix: the whole history of the hops as one shape.
       The lattice and P are made up for the picture; the project measures
       nothing here, and the label layer says so.

       Three walls carry three views of that one stack. The back wall is the
       sum of every slice, the out-state (I - gP)^-1 x0, in one colour,
       because a sum keeps where the mass went and loses in which order it
       got there. The floor is each order's mass summed over y, laid out along
       x and depth, and the far side wall is the same summed over x: the helix
       casts a sine on one and a cosine on the other, as a video cube's xt
       and yt planes would. Once a cycle the camera turns to look straight
       down the depth axis. It is orthographic, so every slice then lands
       exactly on the sum, the floor and side wall go edge on, and the path
       between in and out cannot be seen anywhere. It holds, then turns away.

       Motion. From t = 0 a scan plane runs through the orders at 220 ms
       each; every slice develops as it passes, the floor and side wall fill
       behind it, and the back wall crossfades through the partial sums, one
       order behind. The camera turns onto the axis as the last terms land
       and holds there for 2.2 s, the colour of the individual orders
       draining so that only the sum is left. Then the loop: the camera rises
       away on the other side, over the top, down the first side and back
       onto the axis, once every 20 s, easing into and out of the hold with
       zero velocity and acceleration. The scan keeps running every 10 s,
       each order it passes flowing into the sum in its own colour.

       Drawing. Each slice is a texture: the lattice is upsampled with a
       cubic B-spline, normalised to its own peak so its shape reads, and
       drawn with opacity falling with g^k. Hue runs blue, violet, coral with
       k. The sum is on a log scale so its tail stays visible under the
       identity term's spike at x0. Under an orthographic camera a slice is
       an affine image of a unit square, one drawImage under g.transform, and
       painter's order is fixed, far to near, because the camera never passes
       behind the block. Textures are painted on first use.

       Measured, in the preview harness:
       - The glass tint of each plate once faded in step with the others.
         Colour alpha is 8 bit, so all 23 plates crossed the same 1/255 level
         on one frame and the whole square jumped (13 per pixel against a
         median of 2.5). Each plate now fades over its own stretch. The
         build's partial sums, the flow into the sum, the scan's hue and the
         edge weights had smaller jumps of the same kind and are continuous.
       - The first call cost 88 ms when every texture was painted up front;
         painting on first use brings it to 36 ms.
       - Worst frame is 126 fills, strokes and images; the darkest painted
         pixel is the -700 blue core at luminance 0.054, over the 0.042 of
         #3a3a3a. */
    var TAU = Math.PI * 2;
    var N = 40, K = 22, GAM = 0.82, TX = 128;
    var D = 2.3, GAP = 0.36, Z0 = (D + GAP) / 2, ZS = -Z0;
    var S = 104, CX = 235, CY = 250;
    var A = 0.86, E = 0.46;                    /* orbit: yaw half-width, pitch at the top */
    var C = 20000, SCAN = 10000, T0 = 500, DT = 220, HOLD = 0.055;
    var SW = K * DT, TA = T0 + SW + 1700;      /* first alignment is centred at TA */

    var M = smatrix.cache;
    if (!M) {
      M = {};                                  /* built whole, published at the end */
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var C5 = [hex('--blue-500', '#2456dc'), hex('--violet-500', '#a66cf0'), hex('--coral-500', '#d9376e')];
      var C7 = [hex('--blue-700', '#163a9a'), hex('--violet-700', '#6b35c4'), hex('--coral-700', '#a0183f')];
      var ramp = function (P, f) {
        var x = Math.max(0, Math.min(1, f)) * 2, i = Math.min(1, Math.floor(x)), u = x - i;
        return [P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u,
                P[i][2] + (P[i + 1][2] - P[i][2]) * u];
      };
      var css = function (c, a) {
        return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
      };
      M.css = css;
      M.hue5 = []; M.hue7 = [];
      for (var k = 0; k <= K; k++) { M.hue5.push(ramp(C5, k / K)); M.hue7.push(ramp(C7, k / K)); }
      M.vio5 = C5[1]; M.vio7 = C7[1];
      M.muted = hex('--muted', '#5f5b53');
      M.hair = hex('--hair2', '#cfcbc1');
      M.white = hex('--raised', '#ffffff');

      /* P: from each site the mass is carried forward round the centre and a
         little inward, then spread by a Gaussian over its neighbours. Each
         column sums to one, so mass is conserved and rho(P) = 1. */
      var h = 2 / N, NN = N * N, W0 = TAU / K, SH = 0.8, DR = 0.013, SIG = 0.75;
      var src = [], dst = [], wt = [];
      for (var j = 0; j < N; j++) {
        for (var i = 0; i < N; i++) {
          var x = -1 + (i + 0.5) * h, y = 1 - (j + 0.5) * h;
          var r = Math.sqrt(x * x + y * y), th = Math.atan2(y, x);
          var dth = W0 * (1 + SH * (0.55 - r)), r2 = Math.max(0.05, r - DR);
          var fi = (r2 * Math.cos(th + dth) + 1) / h - 0.5, fj = (1 - r2 * Math.sin(th + dth)) / h - 0.5;
          var ii = Math.round(fi), jj = Math.round(fj), b0 = wt.length, tot = 0;
          for (var dj = -3; dj <= 3; dj++) {
            for (var di = -3; di <= 3; di++) {
              var ci = ii + di, cj = jj + dj;
              var w = Math.exp(-((ci - fi) * (ci - fi) + (cj - fj) * (cj - fj)) / (2 * SIG * SIG));
              if (w < 1e-4) continue;
              ci = Math.max(0, Math.min(N - 1, ci)); cj = Math.max(0, Math.min(N - 1, cj));
              src.push(j * N + i); dst.push(cj * N + ci); wt.push(w); tot += w;
            }
          }
          for (var q = b0; q < wt.length; q++) wt[q] /= tot;
        }
      }

      /* cubic B-spline upsampling, lattice to texture, separable */
      var bw = [], bi = [];
      for (var p = 0; p < TX; p++) {
        var qq = (p + 0.5) * N / TX - 0.5, fl = Math.floor(qq), u = qq - fl;
        bi.push([0, 1, 2, 3].map(function (m) { return Math.max(0, Math.min(N - 1, fl - 1 + m)); }));
        bw.push([(1 - u) * (1 - u) * (1 - u) / 6, (3 * u * u * u - 6 * u * u + 4) / 6,
                 (-3 * u * u * u + 3 * u * u + 3 * u + 1) / 6, u * u * u / 6]);
      }
      var up = function (f) {
        var tmp = new Float32Array(N * TX), out = new Float32Array(TX * TX), a, m, s;
        for (a = 0; a < N; a++) {
          for (p = 0; p < TX; p++) {
            for (s = 0, m = 0; m < 4; m++) s += bw[p][m] * f[a * N + bi[p][m]];
            tmp[a * TX + p] = s;
          }
        }
        for (a = 0; a < TX; a++) {
          for (p = 0; p < TX; p++) {
            for (s = 0, m = 0; m < 4; m++) s += bw[p][m] * tmp[bi[p][m] * TX + a];
            out[p * TX + a] = s;
          }
        }
        return out;
      };
      /* a texture: per pixel a value v in 0..1 sets alpha and deepens the
         colour from -500 toward -700 at the core, transparent where v is 0 */
      var paint = function (F, v, c5, c7, alphaOf, deep) {
        deep = deep || 0.55;
        var cv = document.createElement('canvas');
        cv.width = cv.height = TX;
        var cx = cv.getContext('2d'), im = cx.createImageData(TX, TX), d = im.data;
        for (var n = 0; n < TX * TX; n++) {
          var vv = v(F[n]);
          if (vv <= 0) continue;
          var mix = deep * vv * vv;
          d[4 * n] = c5[0] + (c7[0] - c5[0]) * mix;
          d[4 * n + 1] = c5[1] + (c7[1] - c5[1]) * mix;
          d[4 * n + 2] = c5[2] + (c7[2] - c5[2]) * mix;
          d[4 * n + 3] = 255 * alphaOf(vv);
        }
        cx.putImageData(im, 0, 0);
        return cv;
      };

      /* the series: slice k = g^k P^k x0, and the running sums */
      var X0 = [0.68 * Math.cos(-0.35), 0.68 * Math.sin(-0.35)];
      var xk = new Float64Array(NN), run = new Float64Array(NN);
      var i0 = Math.round((X0[0] + 1) / h - 0.5), j0 = Math.round((1 - X0[1]) / h - 0.5);
      xk[j0 * N + i0] = 1;
      M.x0 = [-1 + (i0 + 0.5) * h, 1 - (j0 + 0.5) * h];
      M.com = [];
      var slices = [], sums = [], margX = [], margY = [];
      for (k = 0; k <= K; k++) {
        var gk = Math.pow(GAM, k), cxm = 0, cym = 0, mass = 0;
        for (var sI = 0; sI < NN; sI++) {
          var vS = xk[sI];
          run[sI] += gk * vS;
          mass += vS; cxm += vS * (-1 + ((sI % N) + 0.5) * h); cym += vS * (1 - (Math.floor(sI / N) + 0.5) * h);
        }
        M.com.push([cxm / mass, cym / mass]);
        var mx = new Float64Array(N), my = new Float64Array(N);
        for (sI = 0; sI < NN; sI++) { mx[sI % N] += xk[sI]; my[Math.floor(sI / N)] += xk[sI]; }
        margX.push(mx); margY.push(my);
        slices.push(xk); sums.push(Float64Array.from(run));
        var nx = new Float64Array(NN);
        for (q = 0; q < wt.length; q++) nx[dst[q]] += xk[src[q]] * wt[q];
        xk = nx;
      }
      /* Textures are painted the first time a frame needs them, so arriving
         costs the chain and the first slice, and the rest spread over the
         build at one or two a frame. The sum is on a log scale over three
         decades of its own peak (the peak is the identity term at x0). */
      var full = up(sums[K]), spk = 0, n;
      for (n = 0; n < full.length; n++) if (full[n] > spk) spk = full[n];
      var logv = function (f) { var v = 1 + Math.log(Math.max(f, 1e-12) / spk) / Math.LN10 / 3; return v <= 0.02 ? 0 : (v - 0.02) / 0.98; };
      var texs = [], parts = [];
      M.tex = function (k) {
        if (!texs[k]) {
          var U = up(slices[k]), pk = 0;
          for (var n = 0; n < U.length; n++) if (U[n] > pk) pk = U[n];
          texs[k] = paint(U, function (f) { var v = f / pk; return v < 0.035 ? 0 : (v - 0.035) / 0.965; },
                          M.hue5[k], M.hue7[k], function (v) { return Math.pow(v, 0.95); });
        }
        return texs[k];
      };
      M.part = function (k) {
        if (!parts[k]) {
          parts[k] = paint(k === K ? full : up(sums[k]), logv, M.vio5, M.vio7,
                           function (v) { return Math.min(1, 1.25 * Math.pow(v, 1.15)); }, 0.85);
        }
        return parts[k];
      };

      /* the other two views of the block, as in a video cube's xt and yt
         planes: each order's mass summed over y, laid along x on the floor,
         and summed over x, laid along y on the side wall. Each order is
         normalised to its own peak and fades with g^k, like its slice; the
         texture runs continuously in k between the orders. */
      var side = function (marg, alongK) {
        var cv = document.createElement('canvas');
        cv.width = cv.height = TX;
        var cx = cv.getContext('2d'), im = cx.createImageData(TX, TX), d = im.data;
        var U1 = [], pk1 = [];
        for (var k3 = 0; k3 <= K; k3++) {
          var row = new Float32Array(TX), pk3 = 0;
          for (var p3 = 0; p3 < TX; p3++) {
            for (var m3 = 0, s3 = 0; m3 < 4; m3++) s3 += bw[p3][m3] * marg[k3][bi[p3][m3]];
            row[p3] = s3; if (s3 > pk3) pk3 = s3;
          }
          U1.push(row); pk1.push(pk3);
        }
        for (var a3 = 0; a3 < TX; a3++) {             /* a3 runs along k */
          var kf = (a3 + 0.5) / TX * K, k0 = Math.min(K - 1, Math.floor(kf)), w1 = kf - k0;
          var wk = (0.34 + 0.66 * Math.pow(GAM, kf)) * (1 - ease((kf - K + 2.2) / 2.2));
          var c5 = M.hue5[k0].map(function (v, i) { return v + (M.hue5[k0 + 1][i] - v) * w1; });
          var c7 = M.hue7[k0].map(function (v, i) { return v + (M.hue7[k0 + 1][i] - v) * w1; });
          for (var b3 = 0; b3 < TX; b3++) {           /* b3 runs across the wall */
            var v3 = (1 - w1) * U1[k0][b3] / pk1[k0] + w1 * U1[k0 + 1][b3] / pk1[k0 + 1];
            v3 = v3 < 0.05 ? 0 : (v3 - 0.05) / 0.95;
            if (v3 <= 0) continue;
            var o3 = alongK ? 4 * (b3 * TX + a3) : 4 * (a3 * TX + b3), mix3 = 0.5 * v3 * v3;
            d[o3] = c5[0] + (c7[0] - c5[0]) * mix3;
            d[o3 + 1] = c5[1] + (c7[1] - c5[1]) * mix3;
            d[o3 + 2] = c5[2] + (c7[2] - c5[2]) * mix3;
            d[o3 + 3] = 255 * wk * Math.pow(v3, 1.1);
          }
        }
        cx.putImageData(im, 0, 0);
        return cv;
      };
      M.floorTex = side(margX, false);   /* rows: k from the front; columns: x */
      M.sideTex = side(margY, true);     /* columns: k from the front; rows: y from the top */

      /* Dust. Slice k carries mass g^k, so it is also drawn as exactly
         round(360 g^k) grains sampled from its own distribution: 360 at the
         in-state, 44 by the tenth hop, 4 by the last. As the series recedes
         into the block each slice gives up its body and is left as dust,
         and the thinning of the dust is the shrinking of the term. */
      var rs = 20260923, rnd = function () { rs = (rs * 16807) % 2147483647; return (rs - 1) / 2147483646; };
      M.dust = [];
      for (k = 0; k <= K; k++) {
        var sl = slices[k], cum = new Float64Array(NN), tot2 = 0, ng = Math.round(360 * Math.pow(GAM, k));
        for (n = 0; n < NN; n++) { tot2 += sl[n]; cum[n] = tot2; }
        var gr = new Float32Array(ng * 4);
        for (var gi = 0; gi < ng; gi++) {
          var target = rnd() * tot2, lo = 0, hi = NN - 1;
          while (lo < hi) { var md = (lo + hi) >> 1; if (cum[md] < target) lo = md + 1; else hi = md; }
          gr[4 * gi] = ((lo % N) + 0.5 + (rnd() - 0.5) * 1.6) / N;
          gr[4 * gi + 1] = (Math.floor(lo / N) + 0.5 + (rnd() - 0.5) * 1.6) / N;
          gr[4 * gi + 2] = rnd() * TAU;
          gr[4 * gi + 3] = rnd() * TAU;
        }
        M.dust.push(gr);
      }
      smatrix.cache = M;
    }

    /* --- time ----------------------------------------------------------- */
    var RED = REDUCED;
    var T = RED ? 60000 : t;
    /* the camera loop: phi runs once round per cycle at a steady rate, is
       held at 0 (looking straight down the depth axis) for 2 x HOLD of it,
       and eases in and out of the hold over RAMP of the loop, so it arrives
       and leaves with zero velocity and zero acceleration */
    var phi, RAMP = 0.14;
    var Fr = function (x) { return x * x * x * x * (2.5 + x * (x - 3)); };   /* integral of ease */
    if (RED) phi = 4.75;
    else {
      var u = (T - TA) / C;
      u -= Math.floor(u);
      if (u < HOLD || u > 1 - HOLD) phi = 0;
      else {
        var s = (u - HOLD) / (1 - 2 * HOLD), I;
        if (s < RAMP) I = RAMP * Fr(s / RAMP);
        else if (s > 1 - RAMP) I = 1 - RAMP - RAMP * Fr((1 - s) / RAMP);
        else I = s - RAMP / 2;
        phi = TAU * I / (1 - RAMP);
      }
    }
    var psi = A * Math.sin(phi), eps = E * Math.sin(phi / 2);
    var ang = Math.min(Math.abs(phi), TAU - Math.abs(phi));
    var hero = RED ? 0 : 1 - ease(ang / 0.5);            /* 1 when aligned */

    /* scan: runs through the orders every SCAN ms, the first run builds */
    var KW = K * (D + GAP) / D;                          /* the order at which the scan meets the sum */
    var tau = T - T0, ks = -10, sweep = 0, arrive = 0;
    if (!RED && tau >= 0) {
      var tl = tau - Math.floor(tau / SCAN) * SCAN;
      ks = tl / DT;
      sweep = ease(tl / 400);
      arrive = 1 - ease((ks - K) / (KW - K));             /* fades as it crosses the gap to the wall */
    }
    var built = RED ? K + 1 : tau / DT;                  /* orders developed in the first run */

    /* --- projection ----------------------------------------------------- */
    var cp = Math.cos(psi), sp = Math.sin(psi), ce = Math.cos(eps), se = Math.sin(eps);
    function P(x, y, z, o) {
      var x1 = x * cp + z * sp, z1 = -x * sp + z * cp;
      o[0] = CX + S * x1; o[1] = CY - S * (y * ce - z1 * se); o[2] = y * se + z1 * ce;
      return o;
    }
    var O = [0, 0, 0], Ua = [0, 0, 0], Va = [0, 0, 0];
    function frame(z) {                         /* the affine map of the unit square at depth z */
      P(-1, 1, z, O); P(1, 1, z, Ua); P(-1, -1, z, Va);
      return [Ua[0] - O[0], Ua[1] - O[1], Va[0] - O[0], Va[1] - O[1], O[0], O[1]];
    }
    function quad(m) {
      g.beginPath();
      g.moveTo(m[4], m[5]); g.lineTo(m[4] + m[0], m[5] + m[1]);
      g.lineTo(m[4] + m[0] + m[2], m[5] + m[1] + m[3]); g.lineTo(m[4] + m[2], m[5] + m[3]);
      g.closePath();
    }
    function zk(k) { return Z0 - D * k / K; }

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.imageSmoothingEnabled = true;

    /* --- the scene: a studio floor the block stands on ------------------------
       The floor is lit from the front, falls away into the page at its rim,
       carries the block's contact shadow, and takes the violet light of the
       sum through the glass, strongest when the camera looks down the stack. */
    if (!M.glassT) {
      var mixc = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
      M.glassT = mixc(M.hair, M.vio5, 0.22);
      M.edgeCore = mixc(M.muted, M.vio7, 0.25);
    }
    var fy = -1.03;
    function floorPatch(x0, x1, z0, z1, stops) {
      P(x0, fy, z0, O); P(x1, fy, z0, Ua); P(x0, fy, z1, Va);
      g.save();
      g.transform(Ua[0] - O[0], Ua[1] - O[1], Va[0] - O[0], Va[1] - O[1], O[0], O[1]);
      var fg = g.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5);
      for (var si = 0; si < stops.length; si++) fg.addColorStop(stops[si][0], stops[si][1]);
      g.fillStyle = fg;
      g.fillRect(0, 0, 1, 1);
      g.restore();
    }
    var sh = Math.min(1, Math.max(0, (se + 0.12) / 0.3));
    floorPatch(-2.05, 2.05, Z0 + 0.25, ZS - 0.25, [[0, M.css(M.white, 0.55 * sh)], [0.55, M.css(M.hair, 0.22 * sh)], [1, M.css(M.hair, 0)]]);
    floorPatch(-1.4, 1.4, Z0 + 0.12, ZS - 0.12, [[0, M.css(M.muted, 0.16 * sh)], [0.6, M.css(M.muted, 0.07 * sh)], [1, M.css(M.muted, 0)]]);
    floorPatch(-1.05, 1.05, 0.1, ZS - 0.55, [[0, M.css(M.vio5, (0.1 + 0.16 * hero) * sh)], [1, M.css(M.vio5, 0)]]);

    /* --- the block: its eight corners, back faces and back edges ---------- */
    var BX = 1.0, cz = [Z0, ZS], cor = [];
    for (var c = 0; c < 8; c++) {
      cor.push(P(c & 1 ? BX : -BX, c & 2 ? BX : -BX, cz[c >> 2], [0, 0, 0]));
    }
    var FACES = [[0, 2, 6, 4, -1, 0, 0], [1, 3, 7, 5, 1, 0, 0], [0, 1, 5, 4, 0, -1, 0],
                 [2, 3, 7, 6, 0, 1, 0], [4, 5, 7, 6, 0, 0, -1], [0, 1, 3, 2, 0, 0, 1]];
    var EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    var zc = P(0, 0, 0, [0, 0, 0])[2];
    var faceDepth = function (f) { return P(f[4], f[5], f[6], [0, 0, 0])[2] - zc; };
    /* an edge is in front when either face that holds it faces the camera */
    var vis = {};
    for (var fi2 = 0; fi2 < FACES.length; fi2++) {
      var fd = faceDepth(FACES[fi2]);
      for (var e = 0; e < 4; e++) {
        var ea = FACES[fi2][e], eb = FACES[fi2][(e + 1) % 4], key = Math.min(ea, eb) * 8 + Math.max(ea, eb);
        vis[key] = Math.max(vis[key] == null ? -9 : vis[key], fd);
      }
    }
    var front = function (ed) { return vis[Math.min(ed[0], ed[1]) * 8 + Math.max(ed[0], ed[1])] > 1e-6; };
    var edgeA = function (ed) {
      var v = vis[Math.min(ed[0], ed[1]) * 8 + Math.max(ed[0], ed[1])];
      return 0.26 + 0.36 * ease(v / 0.12);
    };
    /* the far faces are glass seen from inside: tinted, lighter at the top */
    for (fi2 = 0; fi2 < FACES.length - 1; fi2++) {
      var F = FACES[fi2];
      if (faceDepth(F) >= 0) continue;
      var ytop = Math.min(cor[F[0]][1], cor[F[1]][1], cor[F[2]][1], cor[F[3]][1]);
      var ybot = Math.max(cor[F[0]][1], cor[F[1]][1], cor[F[2]][1], cor[F[3]][1]);
      var bg2 = g.createLinearGradient(0, ytop, 0, ybot);
      bg2.addColorStop(0, M.css(M.white, 0.2));
      bg2.addColorStop(1, M.css(M.glassT, 0.2));
      g.fillStyle = bg2;
      g.beginPath();
      g.moveTo(cor[F[0]][0], cor[F[0]][1]);
      for (e = 1; e < 4; e++) g.lineTo(cor[F[e]][0], cor[F[e]][1]);
      g.closePath(); g.fill();
    }
    /* an edge of the block is a bar of glass: a soft body, a core, and on
       the near side a lit lip */
    function glassEdge(ed, near) {
      var x0 = cor[ed[0]][0], y0 = cor[ed[0]][1], x1 = cor[ed[1]][0], y1 = cor[ed[1]][1], k0 = edgeA(ed);
      g.lineCap = 'round';
      g.strokeStyle = M.css(M.glassT, (near ? 0.45 : 0.25) * k0);
      g.lineWidth = near ? 6 : 3.5;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = M.css(M.edgeCore, (near ? 1.05 : 0.75) * k0);
      g.lineWidth = near ? 1.7 : 1;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (near) {
        g.strokeStyle = M.css(M.white, 0.9);
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x0 - 0.9, y0 - 1); g.lineTo(x1 - 0.9, y1 - 1); g.stroke();
      }
    }
    for (e = 0; e < 12; e++) if (!front(EDGES[e])) glassEdge(EDGES[e], false);

    /* --- the floor and the far side wall: the stack seen from below and from the side */
    var ZD = Z0 - D;
    /* during the build the walls fill order by order, just behind the scan */
    var wf = RED ? 1 : Math.max(0, Math.min(1, (built + 0.2) / K));
    if (se > 0.02 && wf > 0.004) {
      var fa = Math.min(1, (se - 0.02) / 0.18) * 0.62;
      P(-1, -1, Z0, O); P(1, -1, Z0, Ua); P(-1, -1, ZD, Va);
      g.save();
      g.transform(Ua[0] - O[0], Ua[1] - O[1], Va[0] - O[0], Va[1] - O[1], O[0], O[1]);
      g.globalAlpha = fa;
      g.drawImage(M.floorTex, 0, 0, TX, TX * wf, 0, 0, 1, wf);
      g.restore();
    }
    if (Math.abs(sp) > 0.02 && wf > 0.004) {
      var xw = sp > 0 ? 1 : -1;
      P(xw, 1, Z0, O); P(xw, 1, ZD, Ua); P(xw, -1, Z0, Va);
      g.save();
      g.transform(Ua[0] - O[0], Ua[1] - O[1], Va[0] - O[0], Va[1] - O[1], O[0], O[1]);
      g.globalAlpha = Math.min(1, (Math.abs(sp) - 0.02) / 0.18) * 0.55;
      g.drawImage(M.sideTex, 0, 0, TX * wf, TX, 0, 0, wf, 1);
      g.restore();
    }
    g.globalAlpha = 1;

    /* --- the back wall: the sum, the out-state ----------------------------- */
    var mS = frame(ZS);
    g.fillStyle = M.css(M.white, 0.55);
    quad(mS); g.fill();
    g.save();
    g.transform(mS[0], mS[1], mS[2], mS[3], mS[4], mS[5]);
    var bw2 = built - 1;                                /* the wall lags the scan by one order */
    var inBuild = !RED && bw2 < K;
    if (inBuild) {
      var kb = Math.max(0, Math.min(K - 1, Math.floor(bw2))), fr = ease(Math.max(0, Math.min(1, bw2 - kb)));
      var a0 = bw2 < 0 ? ease(built) : 1;               /* the identity term arrives first */
      if (built > 0) {
        g.globalAlpha = a0 * (1 - fr);
        g.drawImage(M.part(kb), 0, 0, 1, 1);
        g.globalAlpha = a0 * fr;
        g.drawImage(M.part(kb + 1), 0, 0, 1, 1);
      }
    } else {
      var done = RED ? 1 : ease((bw2 - K) / 1.5);
      g.globalAlpha = 1;
      g.drawImage(M.part(K), 0, 0, 1, 1);
      /* hero: the aligned view, the sum is everything that is left */
      if (hero > 0.01) {
        g.shadowColor = M.css(M.vio5, 0.9);
        g.shadowBlur = 16 * hero;
        g.globalAlpha = 0.55 * hero * done;
        g.drawImage(M.part(K), 0, 0, 1, 1);
        g.shadowBlur = 0;
      }
    }
    /* each order the scan passes flows into the sum, in its own colour */
    if (sweep > 0.01 && !inBuild) {
      for (var kk = Math.max(0, Math.floor(ks - 2.8)); kk <= Math.min(K, Math.ceil(ks + 0.4)); kk++) {
        var wdep = Math.max(0, 1 - Math.abs(ks - kk - 1.2) / 1.6);
        if (wdep <= 0.01) continue;
        g.globalAlpha = 0.5 * wdep * sweep * done * (0.45 + 0.55 * Math.pow(GAM, kk * 0.5));
        g.drawImage(M.tex(kk), 0, 0, 1, 1);
      }
    }
    g.restore();
    g.globalAlpha = 1;
    g.strokeStyle = M.css(M.vio7, 0.45);
    g.lineWidth = 1.2;
    quad(mS); g.stroke();

    /* --- the slices, far to near, with the thread and the scan between ---- */
    var pts = [];
    for (var k2 = 0; k2 <= K; k2++) pts.push(P(M.com[k2][0], M.com[k2][1], zk(k2), [0, 0, 0]));
    var zScan = Z0 - D * ks / K;
    var scanDrawn = false;
    var sheenX = 0.5 + 0.4 * Math.sin(psi * 1.4 + eps);
    function drawScan() {
      scanDrawn = true;
      var sa = sweep * arrive;
      if (sa <= 0.01 || zScan < ZS || zScan > Z0 + 0.02) return;
      var m = frame(zScan), kf = Math.max(0, Math.min(K, ks)), k0 = Math.min(K - 1, Math.floor(kf)), w = kf - k0;
      var hc = [0, 1, 2].map(function (i) { return M.hue5[k0][i] + (M.hue5[k0 + 1][i] - M.hue5[k0][i]) * w; });
      g.fillStyle = M.css(hc, 0.07 * sa * (1 - hero));
      quad(m); g.fill();
      g.save();
      g.shadowColor = M.css(hc, 0.8);
      g.shadowBlur = 8;
      g.strokeStyle = M.css(hc, 0.85 * sa);
      g.lineWidth = 1.6;
      quad(m); g.stroke();
      g.restore();
    }
    for (k2 = K; k2 >= 0; k2--) {
      var z = zk(k2);
      if (!scanDrawn && zScan < z) drawScan();
      /* how far this order has developed: the first scan builds them */
      var dev = RED || k2 === 0 ? 1 : ease((built - k2 + 0.4) / 1.2);
      if (dev <= 0.002) continue;
      var gk2 = Math.pow(GAM, k2);
      var near = RED ? 0 : sweep * Math.exp(-Math.pow((ks - k2) / 1.1, 2));
      var flow = RED ? 0 : 0.1 * Math.sin(TAU * (T / 2600 - k2 / 8));
      var al = Math.min(1, (0.42 + 0.58 * gk2) * (1 + 0.5 * near + flow)) * dev * (1 - 0.62 * hero);
      /* the thread from this slice to the next one back */
      if (k2 < K && built > k2 + 1) {
        var th2 = ease(built - k2 - 1);
        g.strokeStyle = M.css(M.hue7[k2], 0.5 * th2 * dev * (1 - 0.7 * hero));
        g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(pts[k2 + 1][0], pts[k2 + 1][1]); g.lineTo(pts[k2][0], pts[k2][1]); g.stroke();
      }
      var m2 = frame(z);
      /* the glass of the slide, faint, so the block has a body. Colour alpha
         is 8 bit, so plates that fade in step all cross the same 1/255 level
         on the same frame and the stack's tint jumps; each plate fades over
         its own stretch of the approach instead. */
      var h5 = M.hue5[k2];
      var gl = Math.max(0, Math.min(1, (1 - hero) * 1.6 - 0.6 * k2 / K));
      if (gl * dev > 0.001) {
        g.fillStyle = M.css(h5, 0.018 * dev * gl);
        quad(m2); g.fill();
      }
      g.save();
      g.transform(m2[0], m2[1], m2[2], m2[3], m2[4], m2[5]);
      /* the deeper the slice, the more of it is dust and the less is body */
      var dust = ease(k2 / 9);
      g.globalAlpha = al * (1 - 0.86 * dust);
      g.drawImage(M.tex(k2), 0, 0, 1, 1);
      var dg = M.dust[k2], gs = 0.0085 * (1 - 0.35 * dust), amp = 0.003 + 0.03 * dust;
      var cu = (M.com[k2][0] + 1) / 2, cv2 = (1 - M.com[k2][1]) / 2, spread = 1 + 0.16 * dust;
      g.globalAlpha = Math.min(1, al * (0.35 + 0.75 * dust));
      g.fillStyle = M.css(M.hue7[k2], 1);
      g.beginPath();
      for (var gq = 0; gq < dg.length; gq += 4) {
        var wob = RED ? 0.5 : 0.5 + 0.5 * Math.sin(T / 1700 + dg[gq + 3]);
        var gx = cu + (dg[gq] - cu) * spread + Math.cos(dg[gq + 2]) * amp * wob;
        var gy = cv2 + (dg[gq + 1] - cv2) * spread + Math.sin(dg[gq + 2]) * amp * wob;
        g.rect(gx - gs / 2, gy - gs / 2, gs, gs);
      }
      g.fill();
      g.restore();
      g.globalAlpha = 1;
      if (near > 0.02) {
        g.strokeStyle = M.css(h5, 0.45 * near * dev);
        g.lineWidth = 1;
        quad(m2); g.stroke();
      }
      /* the bead: this order's centre of mass */
      g.fillStyle = M.css(M.hue7[k2], (0.55 + 0.4 * near) * dev * (1 - 0.7 * hero));
      g.beginPath(); g.arc(pts[k2][0], pts[k2][1], 1.3 + 1.5 * near, 0, TAU); g.fill();
    }
    if (!scanDrawn) drawScan();

    /* --- the in-state: one site, on the front face -------------------------- */
    P(M.x0[0], M.x0[1], Z0, O);
    g.fillStyle = M.css(M.hue7[0], 1);
    g.beginPath(); g.arc(O[0], O[1], 2.6, 0, TAU); g.fill();

    /* --- front faces: a sheen; front edges ---------------------------------- */
    for (fi2 = 0; fi2 < FACES.length; fi2++) {
      F = FACES[fi2];
      var fdn = faceDepth(F);
      if (fdn <= 0) continue;
      /* glass reflects more at a glancing angle than face on */
      var facing = Math.min(1, fdn / (F[6] ? Z0 : BX)), fres = 0.035 + 0.14 * (1 - facing) * (1 - facing);
      g.fillStyle = M.css(M.glassT, fres);
      g.beginPath();
      g.moveTo(cor[F[0]][0], cor[F[0]][1]);
      for (e = 1; e < 4; e++) g.lineTo(cor[F[e]][0], cor[F[e]][1]);
      g.closePath(); g.fill();
      if (F[6] === 1) continue;
      var c0 = cor[F[0]], c2 = cor[F[2]];
      var lg = g.createLinearGradient(c0[0], c0[1], c2[0], c2[1]);
      lg.addColorStop(0, M.css(M.white, 0));
      lg.addColorStop(Math.max(0.05, Math.min(0.95, sheenX)), M.css(M.white, 0.16));
      lg.addColorStop(1, M.css(M.white, 0));
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(cor[F[0]][0], cor[F[0]][1]);
      for (e = 1; e < 4; e++) g.lineTo(cor[F[e]][0], cor[F[e]][1]);
      g.closePath(); g.fill();
    }
    for (e = 0; e < 12; e++) if (front(EDGES[e])) glassEdge(EDGES[e], true);
    /* the near corners catch the light */
    for (c = 0; c < 8; c++) {
      if (cor[c][2] - zc < 0.25) continue;
      var gl2 = g.createRadialGradient(cor[c][0] - 0.8, cor[c][1] - 0.8, 0, cor[c][0] - 0.8, cor[c][1] - 0.8, 6);
      gl2.addColorStop(0, M.css(M.white, 0.95));
      gl2.addColorStop(1, M.css(M.white, 0));
      g.fillStyle = gl2;
      g.beginPath(); g.arc(cor[c][0] - 0.8, cor[c][1] - 0.8, 6, 0, TAU); g.fill();
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

  /* ==================================================================== */
  /* closure — tensorflow-124410                                         */
  /* ==================================================================== */
  function closure(g, vb, t, st) {
    /* tensorflow #124410, drawn as the thing it runs.

       CreateControlDependencies serializes the concurrent CollectiveReduce
       ops on a device. Each of those ops is an all-reduce across workers, so
       each is drawn as a ring of workers with the gradient chunks going round
       it: they grow on the first lap as the partial sums build (reduce-
       scatter), then come round again carrying the sum, until every worker
       holds the same value (all-gather). The rings are stacked in the order
       they run, c4 first, and the axis through their centres is the chain of
       control edges that makes each one wait for the one above. No ring starts
       until the edge above it has delivered.

       The edges are the ones in the commit's own test, created in its order:
       4 -> 3, 4 -> 1, 3 -> 2, 2 -> 1. The small rings round each op count what
       the pass believes that op reaches. Before the fix all_paths[src] is a
       copy of all_paths[dst] taken when src -> dst is created and never
       revisited, so c3 believes it reaches only c2. The prune asks whether
       another successor of c4 already reaches c1: the check runs 4 -> 3 -> 2
       and stops, and the bypass 4 -> 1 survives, drawn coral outside the
       tower. Its signal reaches c1 early and is held there. Four control
       edges where the unique transitive reduction is three, and the extra one
       over-serializes the collectives.

       The fix closes reachability first, in ascending instance key, so light
       climbs the axis from c1 and c3 learns it reaches c1 (amber: the fact the
       old pass never delivered). The same check then runs all the way down,
       the bypass snaps, and the collectives run again on three edges.

       The number of workers is illustrative. The four ops, the edges, their
       creation order and both passes are the commit's. */
    var TAU = Math.PI * 2;
    var CX = 250, R = 140, TILT = 0.27, NW = 8;
    var Y = [0, 368, 286, 204, 122];            /* Y[k] is the axis height of op ck */
    var P = 21600;
    var EC = { 4: 700, 3: 1500, 2: 1900 }, E41 = 1100, GROW = 380;

    var M = closure.cache;
    if (!M) {
      /* built whole, then published, so a failure here cannot leave a half
         built cache behind for every later frame to trip on */
      var C = {};
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var mix = function (a, b, k) {
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      };
      var rgb = function (c, a) {
        return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')';
      };
      var WH = [255, 255, 255];
      C.mix = mix; C.rgb = rgb; C.WH = WH;
      C.b5 = hex('--blue-500', '#2456dc'); C.b7 = hex('--blue-700', '#163a9a');
      C.v5 = hex('--violet-500', '#a66cf0'); C.v7 = hex('--violet-700', '#6b35c4');
      C.m5 = hex('--mint-500', '#0b93ab'); C.m7 = hex('--mint-700', '#0a6b7c');
      C.a5 = hex('--amber-500', '#d96a06'); C.a7 = hex('--amber-700', '#9a4906');
      C.c5 = hex('--coral-500', '#d9376e'); C.c7 = hex('--coral-700', '#a0183f');
      C.h2 = hex('--hair2', '#cfcbc1');
      C.glass = mix(C.h2, C.b5, 0.28);

      var orb = function (base, deep) {
        var cv = document.createElement('canvas'), S = 48;
        cv.width = cv.height = S;
        var x = cv.getContext('2d');
        var gr = x.createRadialGradient(S * 0.36, S * 0.32, 0, S * 0.46, S * 0.44, S * 0.56);
        gr.addColorStop(0, rgb(mix(base, WH, 0.8)));
        gr.addColorStop(0.34, rgb(mix(base, WH, 0.2)));
        gr.addColorStop(0.7, rgb(base));
        gr.addColorStop(1, rgb(mix(base, deep, 0.6)));
        x.fillStyle = gr;
        x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 0.5, 0, TAU); x.fill();
        return cv;
      };
      var glow = function (base) {
        var cv = document.createElement('canvas'), S = 64;
        cv.width = cv.height = S;
        var x = cv.getContext('2d');
        var gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        gr.addColorStop(0, rgb(mix(base, WH, 0.4), 0.6));
        gr.addColorStop(0.4, rgb(base, 0.2));
        gr.addColorStop(1, rgb(base, 0));
        x.fillStyle = gr; x.fillRect(0, 0, S, S);
        return cv;
      };
      /* a worker's own gradient before its ring has run: four hues round the
         ring; after it has run, every worker holds the same violet sum */
      C.hue = [C.b5, C.v5, C.m5, C.a5];
      var deep = [C.b7, C.v7, C.m7, C.a7];
      C.orbW = []; C.glowW = [];
      for (var i = 0; i < 4; i++) { C.orbW.push(orb(C.hue[i], deep[i])); C.glowW.push(glow(C.hue[i])); }
      C.orbSum = orb(C.v5, C.v7); C.glowSum = glow(C.v5);
      C.orbOp = orb(C.b5, C.b7); C.glowB = glow(C.b5);
      C.glowA = glow(C.a5); C.glowC = glow(C.c5); C.orbC = orb(C.c5, C.c7);

      /* the bypass 4 -> 1, sampled once; it bows out past the tower */
      var x0 = CX + 9, y0 = Y[4] + 4, x1 = CX + 9, y1 = Y[1] - 4, qx = CX + R + 92;
      var q1 = Y[4] + 30, q2 = Y[1] - 30;
      C.arc = [];
      for (var s = 0; s <= 60; s++) {
        var u = s / 60, v = 1 - u;
        C.arc.push([v * v * v * x0 + 3 * v * v * u * qx + 3 * v * u * u * qx + u * u * u * x1,
                    v * v * v * y0 + 3 * v * v * u * q1 + 3 * v * u * u * q2 + u * u * u * y1]);
      }

      /* when each ring gets its signal, runs, and passes it on, in both
         passes: the ripple, then the all-reduce, then the edge carries the
         signal down to the next op */
      C.old = {}; C.fix = {};
      var at = 2400, k;
      for (k = 4; k >= 1; k--) {
        C.old[k] = { rip: at, r0: at + 300, r1: at + 1400 };
        at = C.old[k].r1 + 420;
      }
      at = 15100;
      for (k = 4; k >= 1; k--) {
        C.fix[k] = { rip: at, r0: at + 200, r1: at + 850 };
        at = C.fix[k].r1 + 290;
      }
      /* what each op believes it reaches: [when it is learned, late?] */
      C.halo = { 4: [[EC[4] + GROW, 0], [E41 + GROW, 0], [12850, 1]],
                 3: [[EC[3] + GROW, 0], [12500, 1]],
                 2: [[EC[2] + GROW, 0]], 1: [] };
      closure.cache = M = C;
    }

    var tc = REDUCED ? 20150 : t % P;
    var yaw = REDUCED ? 0.5 : t * TAU / 46000;
    var A0 = REDUCED ? 1 : 0.35 + 0.65 * ease(t / 900);
    var rgb = M.rgb, mix = M.mix;
    var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    var seg = function (a, d) { return clamp((tc - a) / d); };
    var reset = 1 - ease(seg(20700, 800));
    var wth = function (i) { return yaw + i * TAU / NW; };
    var px = function (k, th) { return CX + R * Math.cos(th); };
    var py = function (k, th) { return Y[k] + R * TILT * Math.sin(th); };
    var spr = function (im, x, y, r, a) {
      if (a <= 0.004) return;
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(im, x - r, y - r, 2 * r, 2 * r);
      g.globalAlpha = 1;
    };
    var allreduce = function (s) { return (tc >= s.r0 && tc < s.r1) ? (tc - s.r0) / (s.r1 - s.r0) : -1; };
    var running = function (k) { var p = allreduce(M.old[k]); return p >= 0 ? p : allreduce(M.fix[k]); };
    var gathered = function (p) { return clamp((ease(p) * 14 - 7) / 7); };
    /* how far each ring's workers hold the reduced value */
    var held = function (k) {
      var o = M.old[k], f = M.fix[k];
      if (tc < o.r0) return 0;
      if (tc < o.r1) return gathered((tc - o.r0) / (o.r1 - o.r0));
      if (tc < 14700) return 1;
      if (tc < f.r0) return 1 - ease(seg(14700, 300));
      if (tc < f.r1) return gathered((tc - f.r0) / (f.r1 - f.r0));
      return reset;
    };
    var lit = function (k) {
      var v = 0, ss = [M.old[k], M.fix[k]];
      for (var i = 0; i < 2; i++) {
        var s = ss[i];
        if (tc >= s.rip && tc < s.r1) v = Math.max(v, ease(seg(s.rip, 260)));
        else if (tc >= s.r1) v = Math.max(v, 1 - ease(seg(s.r1, 520)));
      }
      return Math.max(v, 0.85 * Math.sin(Math.PI * seg(19800, 900)));
    };

    /* the floor the tower stands on */
    g.save();
    g.translate(CX, 414); g.scale(1, 0.07);
    var fl = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    fl.addColorStop(0, rgb(M.h2, 0.55 * A0)); fl.addColorStop(1, rgb(M.h2, 0));
    g.fillStyle = fl;
    g.beginPath(); g.arc(0, 0, R * 1.1, 0, TAU); g.fill();
    g.restore();

    var pillars = function (front) {
      for (var i = 0; i < NW; i++) {
        var th = wth(i), sn = Math.sin(th);
        if ((sn > 0) !== front) continue;
        var x = CX + R * Math.cos(th), ya = Y[4] + R * TILT * sn - 12, yb = Y[1] + R * TILT * sn + 12;
        var a = (front ? 0.6 : 0.3) * A0;
        var lg = g.createLinearGradient(0, ya, 0, yb);
        lg.addColorStop(0, rgb(M.glass, 0)); lg.addColorStop(0.1, rgb(M.glass, a));
        lg.addColorStop(0.9, rgb(M.glass, a)); lg.addColorStop(1, rgb(M.glass, 0));
        g.strokeStyle = lg; g.lineWidth = front ? 1.4 : 1;
        g.beginPath(); g.moveTo(x, ya); g.lineTo(x, yb); g.stroke();
        /* each worker's own timeline runs down its pillar, all the time */
        for (var m = 0; m < 2; m++) {
          var u = ((REDUCED ? 0.3 : t / 3400) + i * 0.37 + m * 0.5) % 1;
          spr(M.glowB, x, ya + (yb - ya) * u, 5, (front ? 0.55 : 0.3) * Math.sin(Math.PI * u) * A0);
        }
      }
    };

    /* part of a ring from angle a over span b, clipped to the near or far half */
    var ringArc = function (k, a, b, front) {
      var lo = front ? 0 : Math.PI, hi = front ? Math.PI : TAU;
      a = a % TAU; if (a < 0) a += TAU;
      var span = b, e = a + span;
      for (var w = -TAU; w <= TAU; w += TAU) {          /* the two halves repeat every turn */
        var s0 = Math.max(a, lo + w), s1 = Math.min(e, hi + w);
        if (s1 > s0) { g.beginPath(); g.ellipse(CX, Y[k], R, R * TILT, 0, s0, s1); g.stroke(); }
      }
    };

    /* each ring is a glass tube: a body, a darker underside, a lit lip */
    var ring = function (k, front) {
      var a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : TAU, L = lit(k), f = front ? 1 : 0.62;
      g.lineCap = 'butt';
      g.strokeStyle = rgb(M.b5, (0.05 + 0.16 * L) * A0 * f);
      g.lineWidth = 14 + 8 * L;
      g.beginPath(); g.ellipse(CX, Y[k], R, R * TILT, 0, a0, a1); g.stroke();
      var body = g.createLinearGradient(0, Y[k] - R * TILT, 0, Y[k] + R * TILT);
      body.addColorStop(0, rgb(mix(M.glass, M.WH, 0.35), 0.5 * A0));
      body.addColorStop(1, rgb(mix(M.glass, M.b5, 0.25 + 0.4 * L), 0.85 * A0));
      g.strokeStyle = body; g.lineWidth = 5.2;
      g.beginPath(); g.ellipse(CX, Y[k], R, R * TILT, 0, a0, a1); g.stroke();
      g.strokeStyle = rgb(mix(M.b7, M.glass, 0.35), 0.28 * A0 * f); g.lineWidth = 1;
      g.beginPath(); g.ellipse(CX, Y[k] + 2.4, R, R * TILT, 0, a0, a1); g.stroke();
      g.strokeStyle = rgb(M.WH, (front ? 0.9 : 0.5) * A0); g.lineWidth = 1.1;
      g.beginPath(); g.ellipse(CX, Y[k] - 1.5, R, R * TILT, 0, a0, a1); g.stroke();
    };

    var workers = function (k, front) {
      var h = held(k), i, th, sn, x, y, r, a;
      for (i = 0; i < NW; i++) {
        th = wth(i); sn = Math.sin(th);
        if ((sn > 0) !== front) continue;
        x = CX + R * Math.cos(th); y = Y[k] + R * TILT * sn;
        r = 7.2 * (1 + 0.14 * sn); a = (front ? 1 : 0.6) * A0;
        var hi = clamp(h * 1.35 - 0.35 * i / NW);
        spr(M.orbW[i % 4], x, y, r, a * (1 - hi));
        spr(M.orbSum, x, y, r, a * hi);
      }
      var p = running(k);
      if (p < 0) return;
      /* each worker's chunk is a length of light going round the tube: it
         thickens on the first lap as the partial sum builds, then goes round
         again as the sum itself */
      var hops = 14 * ease(p), step = TAU / NW;
      var vel = 30 * p * p * (1 - p) * (1 - p) / 1.875;       /* smootherstep's speed, 0 to 1 */
      var fa = (front ? 1 : 0.6) * A0;
      g.lineCap = 'round';
      for (var j = 0; j < NW; j++) {
        var ph = wth(j) + hops * step, rs = hops < 7;
        var col = rs ? M.hue[j % 4] : M.v5, len = step * (0.38 + 0.4 * vel);
        var thick = rs ? 2.2 + 0.55 * hops : 6;
        g.strokeStyle = rgb(col, 0.16 * fa); g.lineWidth = thick * 3.2;
        ringArc(k, ph - len, len, front);
        g.strokeStyle = rgb(col, 0.78 * fa); g.lineWidth = thick;
        ringArc(k, ph - len, len, front);
        g.strokeStyle = rgb(mix(col, M.WH, 0.6), 0.9 * fa); g.lineWidth = Math.max(1, thick * 0.3);
        ringArc(k, ph - len * 0.45, len * 0.45, front);
        if ((Math.sin(ph) > 0) === front) {
          var hx = px(k, ph), hy = py(k, ph), sz = rs ? 2.8 + 0.4 * hops : 5.4;
          spr(rs ? M.glowW[j % 4] : M.glowSum, hx, hy, sz * 3.4, 0.9 * fa);
          spr(rs ? M.orbW[j % 4] : M.orbSum, hx, hy, sz, fa);
        }
      }
    };

    /* ----- behind the axis */
    pillars(false);
    var k;
    for (k = 4; k >= 1; k--) { ring(k, false); workers(k, false); }

    /* a running collective lights the plane of its ring */
    for (k = 4; k >= 1; k--) {
      var Ld = lit(k);
      if (Ld <= 0.01) continue;
      g.save();
      g.translate(CX, Y[k]); g.scale(1, TILT);
      var dg = g.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
      dg.addColorStop(0, rgb(M.b5, 0));
      dg.addColorStop(0.75, rgb(held(k) > 0.5 ? M.v5 : M.b5, 0.07 * Ld * A0));
      dg.addColorStop(1, rgb(held(k) > 0.5 ? M.v5 : M.b5, 0.16 * Ld * A0));
      g.fillStyle = dg;
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.restore();
    }

    /* ----- the axis: control edges, the bypass, what each op believes */
    var spineY0 = function (k) { return Y[k] + 11; };
    var spineY1 = function (k) { return Y[k - 1] - 11; };
    var path = ease(seg(13850, 500)) * reset;      /* 4 -> 3 -> 2 -> 1 confirmed */
    for (k = 4; k >= 2; k--) {
      var c = ease(seg(EC[k], GROW)) * reset;
      if (c <= 0) continue;
      var ya = spineY0(k), yb = ya + (spineY1(k) - ya) * c;
      g.lineCap = 'round';
      g.strokeStyle = rgb(M.glass, 0.45 * A0); g.lineWidth = 9;
      g.beginPath(); g.moveTo(CX, ya); g.lineTo(CX, yb); g.stroke();
      g.strokeStyle = rgb(M.b5, (0.1 + 0.18 * path) * A0); g.lineWidth = 12 + 6 * path;
      g.beginPath(); g.moveTo(CX, ya); g.lineTo(CX, yb); g.stroke();
      g.strokeStyle = rgb(M.b5, 0.8 * A0); g.lineWidth = 2.2 + 1 * path;
      g.beginPath(); g.moveTo(CX, ya); g.lineTo(CX, yb); g.stroke();
    }

    /* the fact that never arrived: 2 -> 1 is there, but c3 does not know it */
    var gap = Math.sin(Math.PI * seg(10400, 1200));
    if (gap > 0.004) {
      g.setLineDash([4, 5]);
      g.strokeStyle = rgb(M.a5, 0.75 * gap); g.lineWidth = 2;
      g.beginPath(); g.moveTo(CX + 7, spineY0(2)); g.lineTo(CX + 7, spineY1(2)); g.stroke();
      g.beginPath(); g.moveTo(CX - 7, spineY0(2)); g.lineTo(CX - 7, spineY1(2)); g.stroke();
      g.setLineDash([]);
    }

    /* the bypass 4 -> 1 */
    var AR = M.arc;
    var arcSeg = function (u0, u1, col, w) {
      var i0 = Math.max(0, Math.floor(u0 * 60)), i1 = Math.min(60, Math.ceil(u1 * 60));
      if (i1 <= i0) return;
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.moveTo(AR[i0][0], AR[i0][1]);
      for (var i = i0 + 1; i <= i1; i++) g.lineTo(AR[i][0], AR[i][1]);
      g.stroke();
    };
    var grown = ease(seg(E41, GROW)) * A0;
    var flare = Math.sin(Math.PI * seg(10700, 900));
    var cut = seg(13850, 950), ce = ease(cut);
    g.lineCap = 'round';
    if (tc < 13850) {
      if (grown > 0) {
        arcSeg(0, grown, rgb(M.c5, (0.1 + 0.22 * flare) * reset), 7 + 6 * flare);
        arcSeg(0, grown, rgb(M.c5, 0.8 * reset), 2.1 + 0.9 * flare);
      }
    } else {
      if (ce < 1) {
        arcSeg(0, 0.5 - 0.5 * ce, rgb(M.c5, 0.8 * (1 - ce)), 2.1);
        arcSeg(0.5 + 0.5 * ce, 1, rgb(M.c5, 0.8 * (1 - ce)), 2.1);
      }
      g.setLineDash([3, 6]);
      arcSeg(0, 1, rgb(M.c5, 0.16 * ce * reset), 1.2);
      g.setLineDash([]);
      var sk = seg(13850, 750);
      if (sk > 0 && sk < 1) {
        var mid = AR[30];
        for (var q = 0; q < 12; q++) {
          var an = q * TAU / 12 + 0.3, d = 4 + 26 * ease(sk);
          g.fillStyle = rgb(M.c5, 0.8 * (1 - sk));
          g.beginPath(); g.arc(mid[0] + Math.cos(an) * d, mid[1] + Math.sin(an) * d * 0.8, 1.9 * (1 - 0.5 * sk), 0, TAU); g.fill();
        }
        spr(M.glowC, mid[0], mid[1], 22 * (1 - sk) + 6, 0.8 * (1 - sk));
      }
    }

    /* the bypass signal: it reaches c1 long before the chain does, and waits */
    if (tc >= 3880 && tc < 4780) {
      var au = AR[Math.round(ease(seg(3880, 900)) * 60)];
      spr(M.glowC, au[0], au[1], 15, 0.9); spr(M.orbC, au[0], au[1], 4.2, 1);
    }
    if (tc >= 4780 && tc < 8120) {
      var wv = tc < 7860 ? ease(seg(4780, 300)) : 1 - ease(seg(7860, 260));
      var br = 0.5 + 0.5 * Math.sin((tc - 4780) / 1500 * TAU);
      var rr = 17 + 3 * br;
      g.strokeStyle = rgb(M.c5, (0.35 + 0.3 * br) * wv); g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(CX, Y[1], rr, rr * 0.45, 0, 0, TAU); g.stroke();
      spr(M.glowC, AR[60][0], AR[60][1], 13, 0.75 * wv); spr(M.orbC, AR[60][0], AR[60][1], 4.2, wv);
    }

    /* what each op believes it reaches, as small rings round it */
    for (k = 4; k >= 1; k--) {
      var hs = M.halo[k];
      for (var hj = 0; hj < hs.length; hj++) {
        var gk = ease(seg(hs[hj][0], 350)) * reset * A0;
        if (gk <= 0) continue;
        var hr = 8 + (6 + 5 * hj) * gk, late = hs[hj][1];
        g.strokeStyle = rgb(late ? M.a5 : M.b5, (late ? 0.9 : 0.55) * gk);
        g.lineWidth = late ? 1.7 : 1.3;
        g.beginPath(); g.ellipse(CX, Y[k], hr, hr * 0.42, 0, 0, TAU); g.stroke();
      }
    }

    /* the ripple that starts a ring, from its op out to the workers */
    for (k = 4; k >= 1; k--) {
      var ss = [M.old[k], M.fix[k]];
      for (var si = 0; si < 2; si++) {
        var rp = seg(ss[si].rip, ss[si].r0 - ss[si].rip + 200);
        if (rp <= 0 || rp >= 1) continue;
        var re = ease(rp);
        g.strokeStyle = rgb(M.b5, 0.5 * (1 - rp)); g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(CX, Y[k], R * re, R * TILT * re, 0, 0, TAU); g.stroke();
      }
    }

    /* the ops themselves */
    for (k = 4; k >= 1; k--) {
      spr(M.glowB, CX, Y[k], 17 + 6 * lit(k), (0.3 + 0.45 * lit(k)) * A0);
      spr(M.orbOp, CX, Y[k], 8.5, A0);
    }

    /* signals travelling down the chain, both passes */
    var mote = function (y, im, gl, r) { spr(gl, CX, y, r * 3, 0.9); spr(im, CX, y, r, 1); };
    var passes = [M.old, M.fix];
    for (var pi = 0; pi < 2; pi++) {
      for (k = 4; k >= 2; k--) {
        var s0 = passes[pi][k].r1 + 80, d0 = passes[pi][k - 1].rip - s0;
        var mu = seg(s0, d0);
        if (mu <= 0 || mu >= 1) continue;
        mote(spineY0(k) + (spineY1(k) - spineY0(k)) * ease(mu), M.orbOp, M.glowB, 4);
      }
    }

    /* the prune's question, before the fix: it dies at c2 */
    var probe = function (start, legs, leg) {
      for (var l = 0; l < legs; l++) {
        var pu = seg(start + l * leg, leg);
        if (pu <= 0 || pu >= 1) continue;
        var kk = 4 - l;
        mote(spineY0(kk) + (spineY1(kk) - spineY0(kk)) * ease(pu), M.orbOp, M.glowB, 3.6);
      }
    };
    probe(9800, 2, 280);
    var fz = seg(10360, 500);
    if (fz > 0 && fz < 1) {
      for (var fq = 0; fq < 8; fq++) {
        var fa2 = fq * TAU / 8, fd = 3 + 14 * ease(fz);
        g.fillStyle = rgb(M.b5, 0.7 * (1 - fz));
        g.beginPath(); g.arc(CX + Math.cos(fa2) * fd, Y[2] + 14 + Math.sin(fa2) * fd * 0.6, 1.5, 0, TAU); g.fill();
      }
    }

    /* the fix: reachability climbs the axis from c1, carrying what c3 lacked */
    for (var cl = 0; cl < 3; cl++) {
      var cu = seg(11800 + cl * 350, 350);
      if (cu <= 0 || cu >= 1) continue;
      var kb = cl + 2, yc = spineY1(kb) + (spineY0(kb) - spineY1(kb)) * ease(cu);
      mote(yc, M.orbW[3], M.glowA, 4);
    }

    /* the same question after it: it reaches c1, and the bypass goes */
    probe(13100, 3, 250);
    var arr = seg(13850, 500);
    if (arr > 0 && arr < 1) spr(M.glowB, CX, Y[1], 12 + 26 * ease(arr), 0.8 * (1 - arr));

    /* ----- in front of the axis */
    pillars(true);
    for (k = 4; k >= 1; k--) { ring(k, true); workers(k, true); }
  }

  /* ==================================================================== */
  /* link — tangle                                                       */
  /* ==================================================================== */
  function link(g, vb, t, st) {
      /* Two loops, one ink and one grey, genuinely linked in three dimensions:
         a Hopf link. Each ring is a circle of radius R, and both centres sit on
         one axis, the pull axis. Every point of the ink ring lies in a plane
         that contains that axis, and so does every point of the grey ring, so
         the ink ring can cross the grey ring's plane only on the axis, at two
         places, and exactly one of them is inside the grey ring's disc. It
         passes through once. That single passage is linking number 1, and it
         holds for every pose drawn here, because every pose keeps both centres
         on the axis and both planes through it.

         The rings roll about the pull axis, open and close on it like a pair of
         scissors, and the pair swings from side to side, so they turn on
         different axes and pass through each other's hole and never part. Once
         a cycle they are pulled apart along the axis as far as they can go.
         With the planes square to each other the closest the two centre lines
         come is 2(R - d) at half separation d, so the tubes, radius RT, would
         meet at d = R - RT. They are pulled to just short of that, catch,
         recoil a couple of units, and are held taut while they keep turning.
         No pull separates them, which is the thing tangle certifies.

         Every crossing of one ring over the other in the picture is found each
         frame by intersecting the two projected centre lines, and which strand
         is over is read off depth at that point. Each crossing is lit blue in
         the gap under its over strand, and the light swells while the rings
         are held taut. Rolling, scissoring and swinging move the crossings,
         never change their number: two, the two crossings of the caption.

         The tubes are solid. Each ring is 128 short segments, each stroked
         once with a gradient across its width that is a real lighting sample:
         the surface normal across a tube runs from one silhouette through the
         side facing the eye to the other, and each stop is a key light, a
         Fresnel lift at the rims, the overhead softbox mirrored in the lacquer,
         and a specular highlight placed exactly where the half vector says, so
         the sheen slides round the tube as it turns. The ink ring is lacquer,
         a sharp streak; the grey ring is satin, a broad one. Colours are mixes
         of --ink and --muted toward --raised. All 256 segments are sorted far
         to near every frame, so every over and under is decided by depth and
         nothing is hand placed. The floor shadow is each ring projected down
         onto the floor along the light.

         Measured in the preview harness, over a full cycle after the build:
         - The two centre lines never come closer than 24.18 units, against
           the 23 at which the tubes would touch.
         - 2 crossings in all 243 frames sampled.
         - Occlusion checked against ground truth, by casting the real view ray
           through a grid of pixels at both tubes: 5 wrong of 31,965, each on
           a silhouette within a pixel, where a ring is seen almost edge on. Round caps everywhere
           first leaked a near cap over a far strand; the repair round one
           crossing first reached the other; an edge-on ring's near arc was
           first painted under the light. Each is fixed below.
         - With the thin ink edge swapped out, no painted pixel is darker than
           #3a3a3a. The only darker pixels are that edge.
         - Colour stops as 'rgb()' strings cost 1.8 ms a frame to parse; hex
           strings roughly halve the frame. 284 draw calls a frame on average,
           315 at worst; the script alone is 0.71 ms a frame. */
      var TAU = Math.PI * 2;
      var R = 100, RT = 11.5, N = 128;
      var D0 = R / 2, D1 = R - RT - 0.8;      /* half separation: at rest, taut */
      var CX = 235, CY = 226, EL = 0.3, CAM = 1000;
      var YF = -(R + RT + 18);                /* floor, world y */
      var CYC = 11000, T1 = 4300, PULL = 1400, HOLD = 1700, REL = 1500;
      var THC = T1 + PULL + HOLD / 2;         /* middle of the first hold */
      var BUILD = 1900, YAW = 0.46, SCIS = 0.34, ROLL0 = Math.PI / 4;

      var M = link._m;
      if (!M) {
        M = link._m = {};
        var hex = function (name, fb) {
          var h = (token(name, fb) || fb).trim().replace('#', '');
          if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
          var n = parseInt(h, 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        };
        M.ink = hex('--ink', '#1c1b19');
        M.mut = hex('--muted', '#5f5b53');
        M.wht = hex('--raised', '#ffffff');
        M.edge = [M.ink, [(M.mut[0] + M.ink[0]) / 2, (M.mut[1] + M.ink[1]) / 2, (M.mut[2] + M.ink[2]) / 2]];
        M.muted = token('--muted', '#5f5b53');
        M.blue = token('--blue-500', '#2456dc');
        M.rings = [];
        for (var k = 0; k < 2; k++) {
          var F = function () { return new Float64Array(N + 1); };
          M.rings.push({ wx: F(), wy: F(), wz: F(), tx: F(), ty: F(), tz: F(),
                         sx: F(), sy: F(), dp: F(), tn: F(), n: 0, fr: 0 });
        }
        M.items = [];
        for (k = 0; k < 2; k++) for (var i = 0; i < N; i++) M.items.push({ k: k, i: i, d: 0, on: false });
        /* body stops across the tube, even in the angle of the normal */
        M.body = [];
        for (i = -4; i <= 4; i++) M.body.push(Math.sin(i * 0.28));
        var nrm = function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
        M.K = nrm([-0.52, 0.78, 0.46]);       /* key light, upper left, in front */
        M.SD = nrm([0, -1, 0.3]);             /* the light the floor shadow falls along */
        M.LB = nrm([-0.25, 1, 0.35]);         /* the overhead softbox the lacquer mirrors */
        M.cross = [];
        M.hx = [];                            /* byte to two hex digits: '#rrggbb' parses fastest */
        for (i = 0; i < 256; i++) M.hx.push((i < 16 ? '0' : '') + i.toString(16));
      }

      /* --- time ---------------------------------------------------------- */
      var T = REDUCED ? THC : t;
      var ph = ((T - T1) % CYC + CYC) % CYC, P;
      if (ph < PULL) {
        /* smooth from rest, arriving with speed: the rings are caught, not parked */
        var k1 = ph / PULL;
        P = k1 * k1 * (3 - k1) / 2;
      } else if (ph < PULL + HOLD) {
        var tr = ph - PULL;
        P = 1 - (2.2 / (D1 - D0)) * Math.sin(Math.PI * tr / 260) * Math.exp(-tr / 170);
      } else if (ph < PULL + HOLD + REL) {
        P = 1 - ease((ph - PULL - HOLD) / REL);
      } else P = 0;
      var d = D0 + (D1 - D0) * P;
      var th = TAU * (T - THC) / CYC;
      var yaw = YAW * Math.sin(th);
      var roll = th + ROLL0;
      var sc = SCIS * Math.sin(2 * th) * (1 - Math.min(1, P));
      var grow = [REDUCED ? 1 : 0.06 + 0.94 * ease(T / BUILD),
                  REDUCED ? 1 : 0.06 + 0.94 * ease((T - 180) / BUILD)];
      var lit = REDUCED ? 1 : ease((T - BUILD + 300) / 700);

      /* --- geometry ------------------------------------------------------ */
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), ce = Math.cos(EL), se = Math.sin(EL);
      var EX = 0, EY = CAM * se, EZ = CAM * ce;
      var spec = [[-d, roll + sc, Math.PI, 1], [d, roll + Math.PI / 2 - sc, 0, -1]];
      var k, i, a, n;
      for (k = 0; k < 2; k++) {
        a = M.rings[k];
        var cx = spec[k][0], cu = Math.cos(spec[k][1]), su = Math.sin(spec[k][1]);
        for (i = 0; i <= N; i++) {
          var phi = spec[k][2] + spec[k][3] * TAU * i / N;
          var c = Math.cos(phi), s = Math.sin(phi);
          var ox = cx + R * c, oy = R * s * cu, oz = R * s * su;
          var x = ox * cyw + oz * syw, z = -ox * syw + oz * cyw;
          a.wx[i] = x; a.wy[i] = oy; a.wz[i] = z;
          var tx0 = -s * spec[k][3], ty0 = c * cu * spec[k][3], tz0 = c * su * spec[k][3];
          a.tx[i] = tx0 * cyw + tz0 * syw; a.ty[i] = ty0; a.tz[i] = -tx0 * syw + tz0 * cyw;
          var dep = oy * se + z * ce, f = CAM / (CAM - dep);
          a.sx[i] = CX + x * f; a.sy[i] = CY - (oy * ce - z * se) * f; a.dp[i] = dep;
        }
        var gN = grow[k] * N;
        a.n = Math.min(N, Math.floor(gN));
        a.fr = a.n < N ? gN - a.n : 0;
      }

      g.clearRect(0, 0, vb[0], vb[1]);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.lineCap = 'round'; g.lineJoin = 'round';

      /* --- floor shadow: each ring dropped onto the floor along the light ---
         Drawn at a third of the resolution and scaled up, which softens it
         for nothing: a penumbra with no banding, at a ninth of the fill. */
      var SC = link._sh;
      if (!SC) {
        SC = link._sh = document.createElement('canvas');
        SC.width = Math.round(vb[0] / 3); SC.height = Math.round(vb[1] / 3);
      }
      var sg = SC.getContext('2d'), kx = SC.width / vb[0], ky = SC.height / vb[1];
      var dF = YF * se, fF = CAM / (CAM - dF);
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, SC.width, SC.height);
      sg.setTransform(kx * fF, 0, 0, ky * fF * se, kx * CX, ky * (CY - YF * ce * fF));
      sg.lineCap = 'round'; sg.lineJoin = 'round';
      var amb = sg.createRadialGradient(0, 0, 0, 0, 0, 1.45 * R);
      amb.addColorStop(0, rgba(M.muted, REDUCED ? 0.095 : 0.095 * ease(T / BUILD)));
      amb.addColorStop(1, rgba(M.muted, 0));
      sg.fillStyle = amb;
      sg.beginPath(); sg.arc(0, 0, 1.45 * R, 0, TAU); sg.fill();
      var PASS = [[3.6, 0.045], [2.4, 0.05], [1.5, 0.055]];
      for (k = 0; k < 2; k++) {
        a = M.rings[k];
        var last = a.n + (a.fr > 0 ? 1 : 0);
        sg.beginPath();
        for (i = 0; i <= last; i++) {
          var lam = (a.wy[i] - YF) / -M.SD[1];
          var qx = a.wx[i] + M.SD[0] * lam, qz = a.wz[i] + M.SD[2] * lam;
          if (i === last && a.fr > 0) {
            var lam0 = (a.wy[i - 1] - YF) / -M.SD[1];
            var px0 = a.wx[i - 1] + M.SD[0] * lam0, pz0 = a.wz[i - 1] + M.SD[2] * lam0;
            qx = px0 + (qx - px0) * a.fr; qz = pz0 + (qz - pz0) * a.fr;
          }
          if (i === 0) sg.moveTo(qx, qz); else sg.lineTo(qx, qz);
        }
        if (a.n === N) sg.closePath();
        for (var p = 0; p < PASS.length; p++) {
          sg.strokeStyle = rgba(M.muted, PASS[p][1]);
          sg.lineWidth = RT * PASS[p][0];
          sg.stroke();
        }
      }
      g.drawImage(SC, 0, 0, vb[0], vb[1]);

      /* --- crossings of the two projected centre lines ------------------- */
      var A = M.rings[0], B = M.rings[1], cr = M.cross;
      cr.length = 0;
      var endX = function (r, j) { return j < r.n || r.fr === 0 ? r.sx[j + 1] : r.sx[j] + (r.sx[j + 1] - r.sx[j]) * r.fr; };
      var endY = function (r, j) { return j < r.n || r.fr === 0 ? r.sy[j + 1] : r.sy[j] + (r.sy[j + 1] - r.sy[j]) * r.fr; };
      var nA = A.n + (A.fr > 0 ? 1 : 0), nB = B.n + (B.fr > 0 ? 1 : 0);
      for (i = 0; i < nA; i++) {
        var ax0 = A.sx[i], ay0 = A.sy[i], ax1 = endX(A, i), ay1 = endY(A, i);
        var aL = Math.min(ax0, ax1), aR = Math.max(ax0, ax1), aT = Math.min(ay0, ay1), aB = Math.max(ay0, ay1);
        for (var j = 0; j < nB; j++) {
          var bx0 = B.sx[j], by0 = B.sy[j], bx1 = endX(B, j), by1 = endY(B, j);
          if (Math.max(bx0, bx1) < aL || Math.min(bx0, bx1) > aR ||
              Math.max(by0, by1) < aT || Math.min(by0, by1) > aB) continue;
          var ux = ax1 - ax0, uy = ay1 - ay0, vx = bx1 - bx0, vy = by1 - by0;
          var den = ux * vy - uy * vx;
          if (Math.abs(den) < 1e-9) continue;
          var wx = bx0 - ax0, wy = by0 - ay0;
          var ta = (wx * vy - wy * vx) / den, tb = (wx * uy - wy * ux) / den;
          if (ta < 0 || ta >= 1 || tb < 0 || tb >= 1) continue;
          /* which strand is over is read off depth at the crossing itself */
          var dA = A.dp[i] + (A.dp[i + 1] - A.dp[i]) * ta, dB = B.dp[j] + (B.dp[j + 1] - B.dp[j]) * tb;
          cr.push(ax0 + ux * ta, ay0 + uy * ta, dA > dB ? 0 : 1, dA > dB ? i : j, (dA + dB) / 2);
        }
      }
      st.crossings = cr.length / 5;

      /* --- the tubes, far to near ---------------------------------------- */
      var it = M.items;
      for (n = 0; n < it.length; n++) {
        var e = it[n], r0 = M.rings[e.k];
        e.on = e.i < r0.n || (e.i === r0.n && r0.fr > 0);
        e.d = e.on ? (r0.dp[e.i] + r0.dp[e.i + 1]) / 2 : -1e9;
      }
      it.sort(function (p1, p2) { return p1.d - p2.d; });

      /* how sharply each ring turns on screen at each vertex */
      for (k = 0; k < 2; k++) {
        a = M.rings[k];
        var closed = a.n === N;
        for (i = 0; i <= N; i++) {
          var ip = i - 1, inx = i + 1;
          if (closed) { if (ip < 0) ip = N - 1; if (inx > N) inx = 1; }
          if (ip < 0 || inx > N) { a.tn[i] = 0; continue; }
          var d1x = a.sx[i] - a.sx[ip], d1y = a.sy[i] - a.sy[ip], d2x = a.sx[inx] - a.sx[i], d2y = a.sy[inx] - a.sy[i];
          a.tn[i] = Math.hypot(d1x, d1y) < 0.05 || Math.hypot(d2x, d2y) < 0.05 ? Math.PI
            : Math.abs(Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y));
        }
      }

      var K = M.K, stops = [], Sx, Sy, Sz, Px, Py, Pz, Vx, Vy, Vz, Hx, Hy, Hz, rk, fog, pk;
      /* one lighting sample across the tube: s runs from one silhouette (-1)
         through the side facing the eye (0) to the other (+1) */
      function shadeAt(sv) {
        var cz = Math.sqrt(Math.max(0, 1 - sv * sv));
        var Nx = sv * Sx + cz * Px, Ny = sv * Sy + cz * Py, Nz = sv * Sz + cz * Pz;
        var df = Math.max(0, Nx * K[0] + Ny * K[1] + Nz * K[2]);
        var nv = Math.max(0, Nx * Vx + Ny * Vy + Nz * Vz), fr = (1 - nv) * (1 - nv) * (1 - nv);
        var nh = Math.max(0, Nx * Hx + Ny * Hy + Nz * Hz), mm, sp, base;
        /* the eye's ray mirrored off the surface, and how much of the
           overhead softbox it sees: a soft band, so it never shimmers */
        var n2 = 2 * (Nx * Vx + Ny * Vy + Nz * Vz);
        var eb = (n2 * Nx - Vx) * M.LB[0] + (n2 * Ny - Vy) * M.LB[1] + (n2 * Nz - Vz) * M.LB[2];
        var env = ease((eb - 0.35) / 0.5);
        if (rk === 0) {                      /* lacquer */
          mm = 0.15 + 0.06 * df + 0.3 * fr + 0.3 * env;
          base = M.ink;
          sp = Math.pow(Math.min(1, nh / pk), 110) * Math.pow(pk, 14) + 0.16 * Math.pow(nh, 14);
        } else {                             /* satin */
          mm = 0.1 + 0.44 * df + 0.26 * fr + 0.08 * env;
          base = M.mut;
          sp = 0.65 * Math.pow(Math.min(1, nh / pk), 24) * Math.pow(pk, 6) + 0.08 * Math.pow(nh, 5);
        }
        mm += fog;
        var c0 = base[0] + (M.wht[0] - base[0]) * mm, c1 = base[1] + (M.wht[1] - base[1]) * mm,
            c2 = base[2] + (M.wht[2] - base[2]) * mm;
        sp = Math.min(1, sp);
        return [c0 + (M.wht[0] - c0) * sp, c1 + (M.wht[1] - c1) * sp, c2 + (M.wht[2] - c2) * sp];
      }
      for (n = 0; n < it.length; n++) {
        var e2 = it[n];
        if (!e2.on) continue;
        rk = e2.k;
        var rg = M.rings[rk], i0 = e2.i, i1 = i0 + 1;
        var x0 = rg.sx[i0], y0 = rg.sy[i0], x1 = rg.sx[i1], y1 = rg.sy[i1];
        if (i0 === rg.n) { x1 = x0 + (x1 - x0) * rg.fr; y1 = y0 + (y1 - y0) * rg.fr; }
        var mx = (rg.wx[i0] + rg.wx[i1]) / 2, my = (rg.wy[i0] + rg.wy[i1]) / 2, mz = (rg.wz[i0] + rg.wz[i1]) / 2;
        var Tx = rg.tx[i0] + rg.tx[i1], Ty = rg.ty[i0] + rg.ty[i1], Tz = rg.tz[i0] + rg.tz[i1];
        var tl = Math.hypot(Tx, Ty, Tz); Tx /= tl; Ty /= tl; Tz /= tl;
        Vx = EX - mx; Vy = EY - my; Vz = EZ - mz;
        var vl = Math.hypot(Vx, Vy, Vz);
        Vx /= vl; Vy /= vl; Vz /= vl;
        var vt = Vx * Tx + Vy * Ty + Vz * Tz;
        Px = Vx - vt * Tx; Py = Vy - vt * Ty; Pz = Vz - vt * Tz;
        var pl = Math.hypot(Px, Py, Pz);
        if (pl < 1e-4) { Px = -Ty; Py = Tx; Pz = 0; pl = Math.hypot(Px, Py) || 1; }
        Px /= pl; Py /= pl; Pz /= pl;
        Sx = Ty * Pz - Tz * Py; Sy = Tz * Px - Tx * Pz; Sz = Tx * Py - Ty * Px;
        /* where the tube's two silhouettes land on screen */
        var dq = (my + Sy * RT) * se + (mz + Sz * RT) * ce, fq = CAM / (CAM - dq);
        var qx1 = CX + (mx + Sx * RT) * fq, qy1 = CY - ((my + Sy * RT) * ce - (mz + Sz * RT) * se) * fq;
        dq = (my - Sy * RT) * se + (mz - Sz * RT) * ce; fq = CAM / (CAM - dq);
        var qx0 = CX + (mx - Sx * RT) * fq, qy0 = CY - ((my - Sy * RT) * ce - (mz - Sz * RT) * se) * fq;
        var lx = qx1 - qx0, ly = qy1 - qy0, w = Math.hypot(lx, ly);
        var sgx = x1 - x0, sgy = y1 - y0, sl = Math.hypot(sgx, sgy);
        if (sl > 0.05) {                     /* square the gradient to the stroke */
          var ox2 = -sgy / sl, oy2 = sgx / sl;
          if (ox2 * lx + oy2 * ly < 0) { ox2 = -ox2; oy2 = -oy2; }
          lx = ox2 * w; ly = oy2 * w;
        }
        var gx = (x0 + x1) / 2, gy = (y0 + y1) / 2;
        var gr = g.createLinearGradient(gx - lx / 2, gy - ly / 2, gx + lx / 2, gy + ly / 2);

        Hx = K[0] + Vx; Hy = K[1] + Vy; Hz = K[2] + Vz;
        var hl = Math.hypot(Hx, Hy, Hz);
        Hx /= hl; Hy /= hl; Hz /= hl;
        var hs = Sx * Hx + Sy * Hy + Sz * Hz, hp = Px * Hx + Py * Hy + Pz * Hz;
        /* The brightest the highlight gets on this segment. Across the tube it
           stays as sharp as lacquer; along the tube it follows this gently, so
           the streak runs on unbroken instead of flaring segment by segment. */
        pk = Math.max(1e-6, hp > 0 ? Math.hypot(hs, hp) : Math.abs(hs));
        fog = 0.09 * Math.max(0, Math.min(1, (60 - e2.d) / 260));
        stops.length = 0;
        stops.push(-1, -0.955);
        for (var b = 0; b < M.body.length; b++) stops.push(M.body[b]);
        if (hp > 0) {                       /* the highlight's own stops, at its peak */
          var bp = Math.atan2(hs, hp);
          for (var q = -2; q <= 2; q++) {
            var sv = Math.sin(bp + q * 0.1);
            if (sv > -0.92 && sv < 0.92) stops.push(sv);
          }
        }
        stops.push(0.955, 1);
        stops.sort(function (u, v) { return u - v; });
        /* Joints. On a gentle bend the segments are butted and each is
           lengthened just enough to close the wedge on the outside of the
           bend, so neighbours overlap by a fraction of a unit and the sheen
           never shows a seam. Where the ring turns sharply on screen, which is
           the end of a ring seen edge on, and at an open end while it builds,
           round caps make the turn. There a thin dark rim would cut across the
           tube on the inside of the turn, so it fades out as the curvature
           radius comes down to the tube's own. */
        var aS = rg.tn[i0], aE = i0 === rg.n ? 0 : rg.tn[i1];
        var open = rg.n < N && (i0 === 0 || i0 === rg.n || (rg.fr === 0 && i0 === rg.n - 1));
        var round = open || Math.max(aS, aE) > 0.35 || sl < 0.05;
        if (!round) {
          var eS = w / 2 * Math.tan(aS / 2) + 0.35, eE = w / 2 * Math.tan(aE / 2) + 0.35;
          var dx1 = sgx / sl, dy1 = sgy / sl;
          x0 -= dx1 * eS; y0 -= dy1 * eS; x1 += dx1 * eE; y1 += dy1 * eE;
        }
        var rho = sl / Math.max(1e-3, (aS + aE) / 2);
        var rim = Math.max(0, Math.min(1, (rho - 0.55 * w) / (0.6 * w)));
        var ec = M.edge[rk];
        for (q = 0; q < stops.length; q++) {
          var sv2 = stops[q], col;
          if (sv2 <= -0.955 || sv2 >= 0.955) {
            col = ec;
            if (rim < 1) {
              var cb = shadeAt(sv2 < 0 ? -0.955 : 0.955);
              col = [cb[0] + (ec[0] - cb[0]) * rim, cb[1] + (ec[1] - cb[1]) * rim, cb[2] + (ec[2] - cb[2]) * rim];
            }
          } else col = shadeAt(sv2);
          gr.addColorStop((sv2 + 1) / 2, '#' + M.hx[col[0] | 0] + M.hx[col[1] | 0] + M.hx[col[2] | 0]);
        }
        g.lineCap = round ? 'round' : 'butt';
        g.strokeStyle = gr;
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        e2.cap = g.lineCap;
        e2.gr = gr; e2.w = w; e2.x0 = x0; e2.y0 = y0; e2.x1 = x1; e2.y1 = y1;
      }

      /* --- the crossings, lit where the under strand passes beneath -------
         Inside a small disc round each crossing the light goes over
         everything, and then everything in front of the gap is stroked again,
         in depth order and with the same gradients: the stretch of the over
         strand through the crossing, and anything nearer still, which is the
         near arc of a ring seen edge on. So the light sits exactly in the gap.
         The disc is never more than half the way to the other crossing, so
         one crossing's repair can never reach the other's. */
      for (n = 0; n < cr.length; n += 5) {
        var hx = cr[n], hy = cr[n + 1], ov = cr[n + 2], oi = cr[n + 3], hd = cr[n + 4], HR = 2.4 * RT;
        for (var o = 0; o < cr.length; o += 5) {
          if (o !== n) HR = Math.min(HR, Math.hypot(cr[o] - hx, cr[o + 1] - hy) / 2);
        }
        /* two crossings meeting is a ring seen edge on: the light fades out
           as they close, rather than shrinking to a spot */
        var hl2 = lit * ease((HR - 14) / 12) * (1 + 0.45 * Math.min(1, P));
        if (hl2 < 0.01) continue;
        g.save();
        g.beginPath(); g.arc(hx, hy, HR, 0, TAU); g.clip();
        var hg = g.createRadialGradient(hx, hy, 0, hx, hy, HR);
        hg.addColorStop(0, rgba(M.blue, 0.55 * hl2));
        hg.addColorStop(0.45, rgba(M.blue, 0.2 * hl2));
        hg.addColorStop(1, rgba(M.blue, 0));
        g.fillStyle = hg;
        g.fillRect(hx - HR, hy - HR, 2 * HR, 2 * HR);
        for (var m = 0; m < it.length; m++) {
          var e3 = it[m], di = Math.abs(e3.i - oi);
          if (!e3.on || !(e3.d > hd || (e3.k === ov && Math.min(di, N - di) <= 8))) continue;
          var ex = e3.x1 - e3.x0, ey = e3.y1 - e3.y0, el = ex * ex + ey * ey;
          var u = el > 0 ? Math.max(0, Math.min(1, ((hx - e3.x0) * ex + (hy - e3.y0) * ey) / el)) : 0;
          if (Math.hypot(e3.x0 + ex * u - hx, e3.y0 + ey * u - hy) > HR + e3.w / 2 + 1) continue;
          g.strokeStyle = e3.gr; g.lineWidth = e3.w; g.lineCap = e3.cap;
          g.beginPath(); g.moveTo(e3.x0, e3.y0); g.lineTo(e3.x1, e3.y1); g.stroke();
        }
        g.restore();
      }
    }

  /* ==================================================================== */
  /* glass — faraday                                                     */
  /* ==================================================================== */
  function glass(g, vb, t, st) {
    /* The claim is that the coupling between the electric and the magnetic
       field is computed, found at a fixed point, and not assumed. So the
       picture holds two real fields and makes the coupling wait for the
       computation.

       The fields are those of a two wire line, the plainest place where E
       and H meet: two conductors pierce a sheet of glass, and in the sheet
       the potential is phi = 1/2 ln(((x+a)^2 + y^2) / ((x-a)^2 + y^2)). E is
       minus its gradient, and its lines are the circles through both wires,
       drawn blue. H runs along the level sets of phi, the Apollonian circles
       round each wire, drawn violet. The two families cross at right angles
       at every point, because one is the gradient of phi and the other is
       tangent to its level sets.

       Nothing is drawn from that formula directly. Each cycle starts from a
       wrong field: the true potential plus a smooth random error. Weighted
       Jacobi relaxation of the Laplacian (omega 0.8, a 24 by 16 grid,
       Dirichlet walls) is a contraction whose only fixed point is the true
       field. It is applied in its own eigenbasis, so iterate k multiplies
       each error mode by its eigenvalue to the power k, exactly. The lines
       are traced from each drawn iterate, by integrating the gradient for E
       and following the level set with a Newton correction for H, and the
       figure steps through a subsequence of iterates in order, each one
       leaving a fading ghost, so the sheaf of lines visibly narrows onto one
       field as the residual shrinks by about 0.6 a step. The three starting
       guesses differ from cycle to cycle and land on the same field.

       Only once the iterate has settled does the coupling appear. E x H
       points along the wires, out of the sheet, with magnitude |grad phi|^2
       here, so it is drawn in amber twice: glowing in the sheet where both
       fields are strong, and rising out of the glass as copies of that same
       sheet, since E x H has one cross section at every height along a two
       wire line. The glass is gradients, alpha and highlights only.
       Per frame work is projection and drawing; each iterate's lines are
       traced once, when first needed, and cached. */
    var TAU = Math.PI * 2, PI = Math.PI;
    var CX = 235, CY = 240, S = 166, EL = 0.9, YAW = -0.24, SWAY = 0.05;
    var LX = 1.12, LY = 0.76, TH = 0.1;
    var DD = 0.45, RC = 0.07, A = Math.sqrt(DD * DD - RC * RC);
    var ZB = -0.3, ZT = 0.95;
    var NX = 24, NY = 16, OM = 0.8, NMODE = 4, K = 9, NSEQ = 3;
    var NE = 24, LEV = [0.42, 0.66, 0.9, 1.14, 1.39, 1.66, 1.95, 2.25], ME = 56, MH = 72;
    var P = 9800, SEED = 900, STEP = 420, CONV = SEED + K * STEP;

    var M = glass.cache;
    if (!M) {
      M = glass.cache = { seq: [], snaps: [] };
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      M.blue = hex('--blue-500', '#2456dc'); M.blue7 = hex('--blue-700', '#163a9a');
      M.vio = hex('--violet-500', '#a66cf0'); M.vio7 = hex('--violet-700', '#6b35c4');
      M.amb = hex('--amber-500', '#d96a06'); M.amb7 = hex('--amber-700', '#9a4906');
      M.mint = hex('--mint-500', '#0b93ab'); M.mint7 = hex('--mint-700', '#0a6b7c');
      M.white = hex('--raised', '#ffffff'); M.hair = hex('--hair2', '#cfcbc1');
      M.muted = hex('--muted', '#5f5b53');
      M.lam = [];
      for (var m0 = 1; m0 <= NMODE; m0++) {
        for (var n0 = 1; n0 <= NMODE; n0++) {
          M.lam.push(1 - OM * (1 - (Math.cos(m0 * PI / NX) + Math.cos(n0 * PI / NY)) / 2));
        }
      }
    }

    function hash(i, k) { var h = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return h - Math.floor(h); }
    function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    function css(c, al) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al + ')'; }
    function clamp(k) { return k < 0 ? 0 : k > 1 ? 1 : k; }

    /* --- the field: exact potential plus the iterate's error ------------ */
    var SU = new Float64Array(5), CU = new Float64Array(5), SV = new Float64Array(5), CV = new Float64Array(5);
    function trig(w, s, c) {
      s[1] = Math.sin(PI * w); c[1] = Math.cos(PI * w);
      for (var q = 2; q <= NMODE; q++) {
        s[q] = s[q - 1] * c[1] + c[q - 1] * s[1];
        c[q] = c[q - 1] * c[1] - s[q - 1] * s[1];
      }
    }
    function field(x, y, co, out) {
      var xp = x + A, xm = x - A, r1 = xp * xp + y * y, r2 = xm * xm + y * y;
      var ph = 0.5 * Math.log(r1 / r2), gx = xp / r1 - xm / r2, gy = y / r1 - y / r2;
      if (co) {
        trig((x + LX) / (2 * LX), SU, CU); trig((y + LY) / (2 * LY), SV, CV);
        var fx = PI / (2 * LX), fy = PI / (2 * LY), q = 0;
        for (var m = 1; m <= NMODE; m++) {
          for (var n = 1; n <= NMODE; n++, q++) {
            var c = co[q];
            ph += c * SU[m] * SV[n];
            gx += c * m * fx * CU[m] * SV[n];
            gy += c * n * fy * SU[m] * CV[n];
          }
        }
      }
      out[0] = ph; out[1] = gx; out[2] = gy;
    }

    /* the starting guesses, and which iterates are drawn */
    function sequence(s) {
      if (M.seq[s]) return M.seq[s];
      var c0 = [], q, m, n;
      for (m = 1, q = 0; m <= NMODE; m++) {
        for (n = 1; n <= NMODE; n++, q++) c0.push((hash(s * 31 + q, 7) * 2 - 1) / Math.pow(m * n, 0.7));
      }
      var big = 0;
      for (var i = 1; i < 12; i++) {
        for (var j = 1; j < 8; j++) {
          var e = 0;
          trig(i / 12, SU, CU); trig(j / 8, SV, CV);
          for (m = 1, q = 0; m <= NMODE; m++) for (n = 1; n <= NMODE; n++, q++) e += c0[q] * SU[m] * SV[n];
          if (Math.abs(e) > big) big = Math.abs(e);
        }
      }
      for (q = 0; q < c0.length; q++) c0[q] *= 0.95 / big;
      /* bound on the error after k sweeps; step k up until it falls by 0.6 */
      var bound = function (k) {
        var b = 0;
        for (var q2 = 0; q2 < c0.length; q2++) b += Math.abs(c0[q2]) * Math.pow(M.lam[q2], k);
        return b;
      };
      var ks = [0], b0 = bound(0), k = 0;
      for (var jj = 1; jj < K; jj++) {
        while (bound(k) > b0 * Math.pow(0.6, jj)) k++;
        ks.push(k);
      }
      M.seq[s] = { c0: c0, ks: ks };
      return M.seq[s];
    }

    function resample(pts, cnt, closed) {
      var n = pts.length / 2, L = [0], i;
      for (i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]));
      var tot = L[n - 1] || 1e-6, out = new Float32Array(cnt * 2), seg = 0;
      for (var j = 0; j < cnt; j++) {
        var want = tot * j / (cnt - 1);
        while (seg < n - 2 && L[seg + 1] < want) seg++;
        var f = (want - L[seg]) / ((L[seg + 1] - L[seg]) || 1);
        out[2 * j] = pts[2 * seg] + (pts[2 * seg + 2] - pts[2 * seg]) * f;
        out[2 * j + 1] = pts[2 * seg + 1] + (pts[2 * seg + 3] - pts[2 * seg + 1]) * f;
      }
      return { p: out, len: tot, closed: closed };
    }
    function inside(x, y) { return x > -LX && x < LX && y > -LY && y < LY; }

    /* trace every line of one iterate; co is null for the fixed point */
    function trace(co) {
      var o = [0, 0, 0], H = 0.012, lines = { E: [], H: [] }, i, st2;
      var dirE = function (x, y, out) {
        field(x, y, co, o); var n = Math.hypot(o[1], o[2]) || 1e-9;
        out[0] = -o[1] / n; out[1] = -o[2] / n;
      };
      var d1 = [0, 0], d2 = [0, 0];
      for (i = 0; i < NE; i++) {
        var th = (i + 0.5) / NE * TAU, x = A + 0.085 * Math.cos(th), y = 0.085 * Math.sin(th);
        var pts = [x, y];
        for (st2 = 0; st2 < 520; st2++) {
          dirE(x, y, d1); dirE(x + d1[0] * H / 2, y + d1[1] * H / 2, d2);
          var nx = x + d2[0] * H, ny = y + d2[1] * H;
          if (!inside(nx, ny)) {
            var f = 1;
            if (nx > LX) f = Math.min(f, (LX - x) / (nx - x));
            if (nx < -LX) f = Math.min(f, (-LX - x) / (nx - x));
            if (ny > LY) f = Math.min(f, (LY - y) / (ny - y));
            if (ny < -LY) f = Math.min(f, (-LY - y) / (ny - y));
            pts.push(x + (nx - x) * f, y + (ny - y) * f);
            break;
          }
          x = nx; y = ny; pts.push(x, y);
          if (Math.hypot(x + DD, y) < RC + 0.004) break;
        }
        lines.E.push(resample(pts, ME, false));
      }
      /* H: the level set through a fixed seed, walked with phi held constant */
      var walk = function (x, y, c, sgn, xc, out) {
        var acc = 0, a0 = Math.atan2(y, x - xc), pts2 = [x, y];
        for (var s3 = 0; s3 < 1400; s3++) {
          field(x, y, co, o); var n = Math.hypot(o[1], o[2]) || 1e-9;
          var tx = sgn * o[2] / n, ty = -sgn * o[1] / n;
          var mx = x + tx * H / 2, my = y + ty * H / 2;
          field(mx, my, co, o); n = Math.hypot(o[1], o[2]) || 1e-9;
          x += sgn * o[2] / n * H; y -= sgn * o[1] / n * H;
          field(x, y, co, o); var g2 = o[1] * o[1] + o[2] * o[2] || 1e-9;
          x += (c - o[0]) * o[1] / g2; y += (c - o[0]) * o[2] / g2;
          if (!inside(x, y)) { out.open = true; break; }
          var a1 = Math.atan2(y, x - xc), da = a1 - a0;
          if (da > PI) da -= TAU; if (da < -PI) da += TAU;
          acc += da; a0 = a1;
          pts2.push(x, y);
          if (Math.abs(acc) > TAU - 0.02) { out.open = false; break; }
        }
        return pts2;
      };
      for (var side = 1; side >= -1; side -= 2) {
        for (i = 0; i < LEV.length; i++) {
          var sx = side * A * Math.tanh(LEV[i] / 2), sy = 0;
          field(sx, sy, co, o);
          var lev = o[0], res = {};
          var fw = walk(sx, sy, lev, 1, side * DD, res);
          if (res.open) {
            var bw = walk(sx, sy, lev, -1, side * DD, {}), all = [];
            for (var b2 = bw.length - 2; b2 >= 2; b2 -= 2) all.push(bw[b2], bw[b2 + 1]);
            lines.H.push(resample(all.concat(fw), MH, false));
          } else {
            lines.H.push(resample(fw, MH, true));
          }
        }
      }
      return lines;
    }
    function snap(s, j) {
      if (j >= K) { if (!M.exact) M.exact = trace(null); return M.exact; }
      var key = s * K + j;
      if (!M.snaps[key]) {
        var sq = sequence(s), co = [];
        for (var q = 0; q < sq.c0.length; q++) co.push(sq.c0[q] * Math.pow(M.lam[q], sq.ks[j]));
        M.snaps[key] = trace(co);
      }
      return M.snaps[key];
    }

    /* E x H in the sheet, as an image laid on the plane: |grad phi|^2 */
    if (!M.glow) {
      var IW = 230, IH = 156, cv = document.createElement('canvas');
      cv.width = IW; cv.height = IH;
      var cx2 = cv.getContext('2d'), im = cx2.createImageData(IW, IH), o2 = [0, 0, 0];
      for (var jy = 0; jy < IH; jy++) {
        for (var ix = 0; ix < IW; ix++) {
          var wx = -LX + 2 * LX * (ix + 0.5) / IW, wy = LY - 2 * LY * (jy + 0.5) / IH;
          var inC = Math.hypot(wx - DD, wy) < RC || Math.hypot(wx + DD, wy) < RC;
          field(wx, wy, null, o2);
          var sS = o2[1] * o2[1] + o2[2] * o2[2];
          var al = inC ? 0 : Math.pow(1 - Math.exp(-sS / 30), 1.1);
          var hot = 0.45 * Math.pow(1 - Math.exp(-sS / 400), 2), hc = mix(M.amb, M.white, hot);
          var pI = 4 * (jy * IW + ix);
          im.data[pI] = hc[0]; im.data[pI + 1] = hc[1]; im.data[pI + 2] = hc[2];
          im.data[pI + 3] = Math.round(255 * al);
        }
      }
      cx2.putImageData(im, 0, 0);
      M.glow = cv; M.IW = IW; M.IH = IH;
    }

    /* --- time ------------------------------------------------------------ */
    var T = REDUCED ? 7000 : t;
    var u = T % P, cyc = Math.floor(T / P), s0 = cyc % NSEQ, first = cyc === 0;
    var yaw = YAW + (REDUCED ? 0 : SWAY * Math.sin(TAU * T / 17000));
    var cy = Math.cos(yaw), sy2 = Math.sin(yaw), ce = Math.cos(EL), se = Math.sin(EL);
    function px(x, y) { return CX + S * (x * cy - y * sy2); }
    function py(x, y, z) { return CY - S * (z * ce + (x * sy2 + y * cy) * se); }

    /* which iterate the lines are at: A morphs to B by w */
    var Asn, Bsn, w, ghosts = [];
    if (u < SEED) {
      Bsn = snap(s0, 0);
      if (first) { Asn = Bsn; w = 1; }
      else { Asn = snap(0, K); w = ease(u / SEED); }
    } else if (u < CONV) {
      var jst = Math.floor((u - SEED) / STEP), us = u - SEED - jst * STEP;
      Asn = snap(s0, jst); Bsn = snap(s0, jst + 1); w = ease(us / (STEP * 0.72));
      for (var gj = Math.max(0, jst - 3); gj <= jst; gj++) {
        var age = u - SEED - gj * STEP;
        ghosts.push([snap(s0, gj), 0.34 * Math.exp(-age / (1.5 * STEP))]);
      }
    } else {
      Asn = Bsn = snap(s0, K); w = 1;
      for (var gk = K - 3; gk < K; gk++) {
        var age2 = u - SEED - gk * STEP;
        ghosts.push([snap(s0, gk), 0.34 * Math.exp(-age2 / (1.5 * STEP)) * (1 - ease((u - CONV) / 700))]);
      }
    }
    if (REDUCED) {
      ghosts = [];
      for (var gr0 = 0; gr0 < 4; gr0++) ghosts.push([snap(s0, gr0), 0.22 - 0.04 * gr0]);
    }
    var appear = first && !REDUCED ? 0.3 + 0.7 * ease(T / 700) : 1;
    var drawOn = first && !REDUCED ? ease((T - 150) / 850) : 1;
    var rise = first && !REDUCED ? 0.2 + 0.8 * ease((T - 100) / 900) : 1;
    var flux = REDUCED ? 1 : (u >= CONV ? ease((u - CONV) / 900) : (first ? 0 : 1 - ease(u / 500)));
    var settled = REDUCED ? 1 : (u >= CONV ? ease((u - CONV) / 600) : 0);

    g.clearRect(0, 0, vb[0], vb[1]);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* --- the glass, below the fields ------------------------------------ */
    function quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3) {
      g.beginPath();
      g.moveTo(px(x0, y0), py(x0, y0, z0)); g.lineTo(px(x1, y1), py(x1, y1, z1));
      g.lineTo(px(x2, y2), py(x2, y2, z2)); g.lineTo(px(x3, y3), py(x3, y3, z3));
      g.closePath();
    }
    /* its shadow on the page */
    g.save();
    var shx = px(0.08, -0.1), shy = py(0.08, -0.1, -0.5);
    g.translate(shx, shy); g.scale(1, 0.36);
    var shd = g.createRadialGradient(0, 0, 0, 0, 0, 210);
    shd.addColorStop(0, css(M.muted, 0.12 * appear)); shd.addColorStop(1, css(M.muted, 0));
    g.fillStyle = shd; g.beginPath(); g.arc(0, 0, 210, 0, TAU); g.fill();
    g.restore();

    function rod(xw, z0, z1, al, cap) {
      if (z1 <= z0) return;
      var cxp = px(xw, 0), w2 = S * RC, yt = py(xw, 0, z1), yb = py(xw, 0, z0), ry = S * RC * se;
      var gr = g.createLinearGradient(cxp - w2, 0, cxp + w2, 0);
      gr.addColorStop(0, css(mix(M.hair, M.muted, 0.3), al));
      gr.addColorStop(0.16, css(mix(M.hair, M.white, 0.7), al));
      gr.addColorStop(0.28, css(M.white, al));
      gr.addColorStop(0.45, css(mix(M.hair, M.white, 0.55), al));
      gr.addColorStop(0.8, css(mix(M.hair, M.muted, 0.22), al));
      gr.addColorStop(1, css(mix(M.hair, M.muted, 0.5), al));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(cxp - w2, yt); g.lineTo(cxp - w2, yb);
      g.ellipse(cxp, yb, w2, ry, 0, PI, 0, true);
      g.lineTo(cxp + w2, yt);
      g.ellipse(cxp, yt, w2, ry, 0, 0, PI, true);
      g.closePath(); g.fill();
      if (cap) {
        var cg = g.createLinearGradient(cxp - w2, yt - ry, cxp + w2, yt + ry);
        cg.addColorStop(0, css(M.white, al)); cg.addColorStop(1, css(M.hair, al));
        g.fillStyle = cg;
        g.beginPath(); g.ellipse(cxp, yt, w2, ry, 0, 0, TAU); g.fill();
        g.strokeStyle = css(M.muted, 0.35 * al); g.lineWidth = 0.8; g.stroke();
      }
    }
    var zTop = TH + (ZT - TH) * rise;
    rod(-DD, ZB, -TH, 0.9 * appear, false);
    rod(DD, ZB, -TH, 0.9 * appear, false);
    g.fillStyle = css(M.mint, 0.07 * appear);
    quad(-LX, -LY, -TH, LX, -LY, -TH, LX, LY, -TH, -LX, LY, -TH); g.fill();

    /* --- the fields in the sheet ---------------------------------------- */
    var ax2 = 2 * LX / M.IW, ay2 = 2 * LY / M.IH;
    if (flux > 0.005) {
      /* the coupling, laid on the plane by the plane's own affine map */
      g.save();
      g.globalAlpha = flux;
      g.transform(S * cy * ax2, -S * se * sy2 * ax2, S * sy2 * ay2, S * se * cy * ay2,
                  px(-LX, LY), py(-LX, LY, 0));
      g.drawImage(M.glow, 0, 0);
      g.restore();
    }
    function path(sn, fam, frac) {
      var L = fam === 0 ? sn.E : sn.H, cnt = fam === 0 ? ME : MH;
      for (var i2 = 0; i2 < L.length; i2++) {
        var p = L[i2].p, last = Math.max(1, Math.floor((cnt - 1) * frac));
        g.moveTo(px(p[0], p[1]), py(p[0], p[1], 0));
        for (var k2 = 1; k2 <= last; k2++) g.lineTo(px(p[2 * k2], p[2 * k2 + 1]), py(p[2 * k2], p[2 * k2 + 1], 0));
        if (L[i2].closed && frac >= 1) g.closePath();
      }
    }
    for (var gi = 0; gi < ghosts.length; gi++) {
      var ga = ghosts[gi][1];
      if (ga < 0.01) continue;
      g.lineWidth = 1.1;
      g.strokeStyle = css(M.blue, ga); g.beginPath(); path(ghosts[gi][0], 0, 1); g.stroke();
      g.strokeStyle = css(M.vio, ga); g.beginPath(); path(ghosts[gi][0], 1, 1); g.stroke();
    }
    /* the current iterate, morphing from A to B */
    var cur = { E: [], H: [] }, fam2, li;
    for (fam2 = 0; fam2 < 2; fam2++) {
      var La = fam2 === 0 ? Asn.E : Asn.H, Lb = fam2 === 0 ? Bsn.E : Bsn.H, dst = fam2 === 0 ? cur.E : cur.H;
      for (li = 0; li < La.length; li++) {
        var pa = La[li].p, pb = Lb[li].p, pc = new Float32Array(pa.length);
        for (var q3 = 0; q3 < pa.length; q3++) pc[q3] = pa[q3] + (pb[q3] - pa[q3]) * w;
        dst.push({ p: pc, closed: w < 0.5 ? La[li].closed : Lb[li].closed,
                   len: La[li].len + (Lb[li].len - La[li].len) * w });
      }
    }
    var lineA = 0.55 + 0.35 * settled;
    g.lineWidth = 1.45;
    g.strokeStyle = css(M.blue, lineA * appear); g.beginPath(); path(cur, 0, drawOn); g.stroke();
    g.strokeStyle = css(M.vio, lineA * appear); g.beginPath(); path(cur, 1, drawOn); g.stroke();

    /* light travelling along the lines: E from the + wire to the - wire, H
       round each wire, E x H pointing up out of the glass */
    var beadA = (0.3 + 0.7 * settled) * (first ? ease((T - 900) / 600) : 1);
    function beads(L, cnt, col, col7, speed, per) {
      for (var i3 = 0; i3 < L.length; i3++) {
        var ln = L[i3], p = ln.p;
        for (var b = 0; b < per; b++) {
          var f0 = (T * speed / 1000 / Math.max(ln.len, 0.3) + hash(i3 + b * 17, cnt) + b / per) % 1;
          var head = f0 * (cnt - 1), tailN = 0.13 / Math.max(ln.len, 0.3) * (cnt - 1);
          var edge2 = ln.closed ? 1 : Math.min(1, head / 2, (cnt - 1 - head) / 2);
          var al = beadA * edge2;
          if (al < 0.02) continue;
          var h0 = Math.floor(head), hf = head - h0, h1 = Math.min(h0 + 1, cnt - 1);
          var hx = p[2 * h0] + (p[2 * h1] - p[2 * h0]) * hf, hy = p[2 * h0 + 1] + (p[2 * h1 + 1] - p[2 * h0 + 1]) * hf;
          var t0 = head - tailN, sxh = px(hx, hy), syh = py(hx, hy, 0);
          if (!ln.closed) t0 = Math.max(0, t0);
          var ti = ((Math.floor(t0) % (cnt - 1)) + (cnt - 1)) % (cnt - 1);
          var gxx = g.createLinearGradient(px(p[2 * ti], p[2 * ti + 1]), py(p[2 * ti], p[2 * ti + 1], 0), sxh, syh);
          gxx.addColorStop(0, css(col, 0)); gxx.addColorStop(1, css(col, 0.95 * al));
          g.strokeStyle = gxx; g.lineWidth = 2.6;
          g.beginPath();
          for (var k5 = Math.floor(t0); k5 <= h0; k5++) {
            var kk = ((k5 % (cnt - 1)) + (cnt - 1)) % (cnt - 1);
            if (k5 === Math.floor(t0)) g.moveTo(px(p[2 * kk], p[2 * kk + 1]), py(p[2 * kk], p[2 * kk + 1], 0));
            else g.lineTo(px(p[2 * kk], p[2 * kk + 1]), py(p[2 * kk], p[2 * kk + 1], 0));
          }
          g.lineTo(sxh, syh); g.stroke();
          g.fillStyle = css(col, 0.2 * al);
          g.beginPath(); g.arc(sxh, syh, 5, 0, TAU); g.fill();
          g.fillStyle = css(col7, al);
          g.beginPath(); g.arc(sxh, syh, 2.1, 0, TAU); g.fill();
        }
      }
    }
    if (beadA > 0.01) {
      beads(cur.E, ME, M.blue, M.blue7, 380, 1);
      beads(cur.H, MH, M.vio, M.vio7, 300, 2);
    }

    /* --- the wires through the glass, and the glass over the fields ----- */
    rod(-DD, -TH, TH, 0.95 * appear, false);
    rod(DD, -TH, TH, 0.95 * appear, false);
    var c00 = [px(-LX, LY), py(-LX, LY, TH)], c11 = [px(LX, -LY), py(LX, -LY, TH)];
    var top = g.createLinearGradient(c00[0], c00[1], c11[0], c11[1]);
    top.addColorStop(0, css(M.white, 0.26 * appear));
    top.addColorStop(0.5, css(M.white, 0.06 * appear));
    top.addColorStop(1, css(M.vio, 0.06 * appear));
    g.fillStyle = top;
    quad(-LX, -LY, TH, LX, -LY, TH, LX, LY, TH, -LX, LY, TH); g.fill();
    if (flux > 0.005) {
      /* the coupling seen again at the top of the glass: it runs through it */
      g.save();
      g.globalAlpha = 0.5 * flux;
      g.transform(S * cy * ax2, -S * se * sy2 * ax2, S * sy2 * ay2, S * se * cy * ay2,
                  px(-LX, LY), py(-LX, LY, TH));
      g.drawImage(M.glow, 0, 0);
      g.restore();
    }
    /* a sheen that drifts across the top face, and a glint when the field
       settles */
    g.save();
    quad(-LX, -LY, TH, LX, -LY, TH, LX, LY, TH, -LX, LY, TH); g.clip();
    var sh1 = REDUCED ? 0.3 : ((T / 9000) % 1) * 1.6 - 0.3;
    var gk2 = (u - CONV) / 1300, glint = (!REDUCED && gk2 > 0 && gk2 < 1) ? Math.sin(PI * gk2) : 0;
    var bands = [[sh1, 0.22 * appear, 0.07]];
    if (glint > 0) bands.push([-0.2 + 1.4 * ease(gk2), 0.5 * glint, 0.05]);
    for (var bi = 0; bi < bands.length; bi++) {
      var bc = bands[bi][0], ba = bands[bi][1], bwid = bands[bi][2];
      var lg = g.createLinearGradient(c00[0], c00[1] - 60, c11[0], c11[1] + 60);
      lg.addColorStop(clamp(bc - bwid), css(M.white, 0));
      lg.addColorStop(clamp(bc), css(M.white, ba));
      lg.addColorStop(clamp(bc + bwid), css(M.white, 0));
      g.fillStyle = lg;
      quad(-LX, -LY, TH, LX, -LY, TH, LX, LY, TH, -LX, LY, TH); g.fill();
    }
    g.restore();
    /* the two faces towards us: glass is green at its edge */
    var fg = g.createLinearGradient(0, py(0, -LY, TH), 0, py(0, -LY, -TH));
    fg.addColorStop(0, css(M.mint, 0.16 * appear)); fg.addColorStop(1, css(M.mint, 0.3 * appear));
    g.fillStyle = fg;
    quad(-LX, -LY, TH, LX, -LY, TH, LX, -LY, -TH, -LX, -LY, -TH); g.fill();
    var rg = g.createLinearGradient(0, py(LX, LY, TH), 0, py(LX, -LY, -TH));
    rg.addColorStop(0, css(M.mint, 0.12 * appear)); rg.addColorStop(1, css(M.mint, 0.26 * appear));
    g.fillStyle = rg;
    quad(LX, -LY, TH, LX, LY, TH, LX, LY, -TH, LX, -LY, -TH); g.fill();
    /* edges: lit along the top, darker along the bottom */
    g.lineWidth = 1.3;
    g.strokeStyle = css(M.white, 0.95 * appear);
    g.beginPath();
    g.moveTo(px(-LX, LY), py(-LX, LY, TH)); g.lineTo(px(-LX, -LY), py(-LX, -LY, TH));
    g.lineTo(px(LX, -LY), py(LX, -LY, TH)); g.lineTo(px(LX, LY), py(LX, LY, TH));
    g.stroke();
    g.strokeStyle = css(M.white, 0.6 * appear); g.lineWidth = 1;
    g.beginPath(); g.moveTo(px(LX, LY), py(LX, LY, TH)); g.lineTo(px(-LX, LY), py(-LX, LY, TH)); g.stroke();
    /* the bevel: a second, fainter line of light just inside the top edge */
    var IN = 0.035;
    g.strokeStyle = css(M.white, 0.55 * appear); g.lineWidth = 0.9;
    quad(-LX + IN, -LY + IN, TH, LX - IN, -LY + IN, TH, LX - IN, LY - IN, TH, -LX + IN, LY - IN, TH);
    g.stroke();
    g.strokeStyle = css(M.mint7, 0.34 * appear); g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px(-LX, -LY), py(-LX, -LY, -TH)); g.lineTo(px(LX, -LY), py(LX, -LY, -TH));
    g.lineTo(px(LX, LY), py(LX, LY, -TH));
    g.moveTo(px(LX, -LY), py(LX, -LY, TH)); g.lineTo(px(LX, -LY), py(LX, -LY, -TH));
    g.moveTo(px(-LX, -LY), py(-LX, -LY, TH)); g.lineTo(px(-LX, -LY), py(-LX, -LY, -TH));
    g.stroke();

    /* --- above the glass: the wires, and the coupling rising out of it -- */
    if (flux > 0.005) {
      /* E x H points along the wires and has the same cross section at every
         height, so it leaves the glass as copies of its own sheet, rising
         and thinning out */
      for (var k6 = 0; k6 < 3; k6++) {
        var fr = REDUCED ? (k6 + 0.5) / 3 : ((T - CONV) / 3000 + k6 / 3) % 1;
        if (fr < 0) fr += 1;
        var zs = TH + 0.03 + 0.72 * fr, as = flux * 0.24 * Math.sin(PI * fr) * (1 - 0.4 * fr);
        if (as < 0.01) continue;
        g.save();
        g.globalAlpha = as;
        g.transform(S * cy * ax2, -S * se * sy2 * ax2, S * sy2 * ay2, S * se * cy * ay2,
                    px(-LX, LY), py(-LX, LY, zs));
        g.drawImage(M.glow, 0, 0);
        g.restore();
      }
    }
    rod(-DD, TH, zTop, appear, true);
    rod(DD, TH, zTop, appear, true);
  }

  /* ==================================================================== */
  /* aether — aether-lang                                                */
  /* ==================================================================== */
  function aether(g, vb, t, st) {
    /* Aether-Lang: a loop whose exit test is the shape of its state.
       The program state is a cloud of 30 points. Each pass of the loop moves
       it, then the runtime measures it: a Vietoris-Rips filtration grows a
       scale r and joins every pair of points closer than r, drawn here as
       crisp lines appearing between the points (coloured by length). When
       the lines close a ring round empty space an H1 class is born: that
       ring is lit in violet, the circle made. When three lines finally span
       the hole, the triangle that kills the class is drawn and the ring
       dims, the circle broken. The barcode (every H0 and H1 bar) is computed
       once from the real distances by union-find and boundary-matrix
       reduction over Z2; the ring drawn is a real cycle through the edge
       that created the longest bar (shortest path plus that edge).
       Passes are layers stacked in depth, oldest at the back; each keeps its
       ring and the skeleton at the scale the ring closed, and thin threads
       follow every point from pass to pass. The loop exits on the first pass
       whose barcode equals the previous one exactly: the last pass slides
       every point one slot along the ring, so the state moved but the point
       set, and so every bar, is identical. The two layers lock together, the
       camera swings end-on so every pass's ring nests round the same centre,
       then the final ring breaks open and the next run begins.
       The cloud and its passes are illustrative; the topology is computed. */
    var TAU = Math.PI * 2;
    var N = 30, NP = 7;
    var PASS = 2600, MOVE = 700, FILT = 1600;
    var LOCK = 1300, GLOW = 1400, BREAK = 1700, FADE = 900;
    var L = NP * PASS + LOCK + GLOW + BREAK + FADE;
    var DZ = 0.5, FOC = 6, S = 146, GROW = 0.07, NB = 7;

    var M = aether.cache;
    if (!M) {
      var C = {};
      var hex3 = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      var RAMP = [hex3('--mint-500', '#0b93ab'), hex3('--blue-500', '#2456dc'),
                  hex3('--violet-500', '#a66cf0'), hex3('--coral-500', '#d9376e')];
      C.bcol = [];
      for (var b0 = 0; b0 < NB; b0++) {
        var kk = b0 / (NB - 1) * 3, ii = Math.min(2, Math.floor(kk)), ff = kk - ii;
        C.bcol.push([0, 1, 2].map(function (q) {
          return Math.round(RAMP[ii][q] + (RAMP[ii + 1][q] - RAMP[ii][q]) * ff);
        }));
      }
      C.rgb = function (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; };
      C.v7 = hex3('--violet-700', '#6b35c4');
      C.v5 = hex3('--violet-500', '#a66cf0');
      C.b7 = hex3('--blue-700', '#163a9a');
      C.b5 = hex3('--blue-500', '#2456dc');
      C.c5 = hex3('--coral-500', '#d9376e');
      C.m7 = hex3('--mint-700', '#0a6b7c');

      /* seeded generator, so every visitor sees the same run */
      var seed = 20260923;
      var rnd = function () {
        seed = (seed + 0x6D2B79F5) | 0;
        var q = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
        return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
      };
      var PH0 = -Math.PI / 2;
      var wrapPi = function (a) { return a - TAU * Math.round(a / TAU); };
      /* pass states in polar form: th (unwrapped, for travel) and exact x, y */
      var SPAN = [0, 0.55, 0.8, 1, 1], RAD = [0, 0.7, 0.85, 0.93, 0.98],
          NR = [0, 0.34, 0.24, 0.17, 0.08], NT = [0, 0.22, 0.12, 0.07, 0.03];
      C.P = [];
      var p, i, j, k;
      for (k = 0; k < NP; k++) {
        var th = new Float64Array(N), rr = new Float64Array(N);
        var X = new Float64Array(N), Y = new Float64Array(N);
        if (k === 0) {
          var an = [];
          for (i = 0; i < N; i++) an.push(rnd() * TAU);
          an.sort(function (a, b) { return a - b; });
          for (i = 0; i < N; i++) { th[i] = an[i] + PH0; rr[i] = 0.52 * Math.sqrt(0.08 + 0.92 * rnd()); }
        } else if (k < 5) {
          for (i = 0; i < N; i++) {
            th[i] = PH0 + (1 - SPAN[k]) * Math.PI + SPAN[k] * TAU * i / N + NT[k] * (rnd() - 0.5);
            rr[i] = RAD[k] + NR[k] * (rnd() - 0.5);
          }
        } else {
          for (i = 0; i < N; i++) { th[i] = PH0 + TAU * (i + k - 5) / N; rr[i] = 1; }
        }
        for (i = 0; i < N; i++) {
          if (k > 0) th[i] = C.P[k - 1].th[i] + (k === 6 ? TAU / N : wrapPi(th[i] - C.P[k - 1].th[i]));
          /* exact coordinates from the slot index, so pass 6 is pass 5's set */
          var ang = k >= 5 ? PH0 + TAU * ((i + k - 5) % N) / N : th[i];
          X[i] = rr[i] * Math.cos(ang); Y[i] = rr[i] * Math.sin(ang);
        }
        C.P.push({ th: th, r: rr, x: X, y: Y });
      }

      /* persistent homology of one pass: H0 by union-find, H1 by reducing
         the triangle boundary matrix over Z2 */
      var symdiff = function (a, b) {
        var o = [], x = 0, y = 0;
        while (x < a.length || y < b.length) {
          if (y >= b.length || (x < a.length && a[x] > b[y])) o.push(a[x++]);
          else if (x >= a.length || b[y] > a[x]) o.push(b[y++]);
          else { x++; y++; }
        }
        return o;
      };
      for (k = 0; k < NP; k++) {
        p = C.P[k];
        var E = [];
        for (i = 0; i < N; i++) for (j = i + 1; j < N; j++)
          E.push({ i: i, j: j, l: Math.hypot(p.x[i] - p.x[j], p.y[i] - p.y[j]) });
        E.sort(function (a, b) { return a.l - b.l; });
        var eid = new Int32Array(N * N);
        for (i = 0; i < E.length; i++) { eid[E[i].i * N + E[i].j] = i; eid[E[i].j * N + E[i].i] = i; }
        var par = [];
        for (i = 0; i < N; i++) par.push(i);
        var find = function (a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
        var bars0 = [];
        for (i = 0; i < E.length; i++) {
          var ra = find(E[i].i), rb = find(E[i].j);
          if (ra !== rb) { par[ra] = rb; bars0.push(E[i].l); }
        }
        var T = [];
        for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) for (var m = j + 1; m < N; m++) {
          var c3 = [eid[i * N + j], eid[i * N + m], eid[j * N + m]].sort(function (a, b) { return b - a; });
          T.push({ c: c3, v: [i, j, m] });
        }
        T.sort(function (a, b) { return a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.c[2] - b.c[2]; });
        var piv = new Array(E.length), dtri = new Array(E.length);
        for (i = 0; i < T.length; i++) {
          var col = T[i].c;
          while (col.length && piv[col[0]]) col = symdiff(col, piv[col[0]]);
          if (col.length) { piv[col[0]] = col; dtri[col[0]] = T[i]; }
        }
        var bars1 = [], best = null;
        for (i = 0; i < E.length; i++) {
          if (!piv[i]) continue;
          var bb = E[i].l, dd = E[dtri[i].c[0]].l;
          if (dd === bb) continue;
          bars1.push([bb, dd]);
          if (!best || dd - bb > best.d - best.b) best = { e: i, b: bb, d: dd, tri: dtri[i].v };
        }
        bars1.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        /* a real cycle for the longest bar: shortest path between the ends of
           its birth edge through edges that already exist, closed by it */
        var src = E[best.e].i, dst = E[best.e].j, dist = [], prev = [], done = [];
        for (i = 0; i < N; i++) { dist.push(1e9); prev.push(-1); done.push(false); }
        dist[src] = 0;
        for (var it = 0; it < N; it++) {
          var u = -1;
          for (i = 0; i < N; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
          if (u < 0 || dist[u] >= 1e9) break;
          done[u] = true;
          for (i = 0; i < N; i++) {
            if (i === u || eid[u * N + i] >= best.e) continue;
            var nd = dist[u] + E[eid[u * N + i]].l;
            if (nd < dist[i]) { dist[i] = nd; prev[i] = u; }
          }
        }
        var cyc = [];
        for (var v = dst; v >= 0; v = prev[v]) cyc.push(v);
        cyc.reverse();
        var bk = [];
        for (i = 0; i < NB; i++) bk.push([]);
        for (i = 0; i < E.length; i++) bk[Math.min(NB - 1, Math.floor(E[i].l / 2 * NB))].push(E[i]);
        p.E = E; p.bk = bk; p.bars0 = bars0; p.bars1 = bars1; p.best = best; p.cyc = cyc;
        p.rmax = Math.max(0.6, best.d * 1.05 + 0.04);
      }
      /* the exit test: first pass whose whole barcode equals the one before */
      var same = function (a, b) {
        if (a.bars0.length !== b.bars0.length || a.bars1.length !== b.bars1.length) return false;
        for (var q = 0; q < a.bars0.length; q++) if (a.bars0[q] !== b.bars0[q]) return false;
        for (q = 0; q < a.bars1.length; q++) if (a.bars1[q][0] !== b.bars1[q][0] || a.bars1[q][1] !== b.bars1[q][1]) return false;
        return true;
      };
      C.exit = NP - 1;
      for (k = 1; k < NP; k++) if (same(C.P[k], C.P[k - 1])) { C.exit = k; break; }
      C.sx = new Float64Array(N * (NP + 1)); C.sy = new Float64Array(N * (NP + 1));
      aether.cache = M = C;
    }

    /* --- time ----------------------------------------------------------- */
    var tt = REDUCED ? NP * PASS + LOCK + 500 : t % L;
    var k0, mv = 1, rNow, fp = 1, post = -1, lock = 0, hero = 0, brk = 0, fade = 0;
    if (tt < NP * PASS) {
      k0 = Math.floor(tt / PASS);
      var u0 = tt - k0 * PASS;
      mv = k0 > 0 ? ease(u0 / MOVE) : 1;
      fp = Math.max(0, Math.min(1, (u0 - MOVE) / FILT));
    } else {
      k0 = NP - 1;
      post = tt - NP * PASS;
      lock = ease(post / LOCK);
      hero = post < LOCK + GLOW ? lock : 1 - ease((post - LOCK - GLOW) / (BREAK + FADE));
      brk = ease((post - LOCK - GLOW) / BREAK);
      fade = ease((post - LOCK - GLOW - BREAK) / FADE);
    }
    if (REDUCED) hero = 0;
    var cur = M.P[k0];
    rNow = cur.rmax * Math.pow(ease(fp), 1.25);

    /* --- camera: oblique down the stack, end-on at the hero ---------------- */
    var sway = REDUCED ? 0 : 0.09 * Math.sin(TAU * t / 15000) * (1 - hero);
    var yaw = 0.55 * (1 - hero) + sway, pit = 0.4 * (1 - hero);
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
    var CX = 180 + 55 * hero, CY = 280 - 36 * hero;
    var SX = M.sx, SY = M.sy;
    var proj = function (x, y, z, o) {
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var q = FOC / (FOC + z2);
      SX[o] = CX + S * x1 * q; SY[o] = CY + S * y2 * q;
      return q;
    };

    /* layer depths: the current pass at the front, older ones pushed back */
    var zs = [], s = k0 - 1 + mv;
    for (var j0 = 0; j0 <= k0; j0++) zs.push(j0 === k0 ? 0 : Math.max(0, (s - j0 - lock) * DZ));
    for (j0 = 0; j0 <= k0; j0++) {
      var P0 = M.P[j0];
      for (var i0 = 0; i0 < N; i0++) {
        var x0 = P0.x[i0], y0 = P0.y[i0];
        if (j0 === k0 && mv < 1) {
          var Pp = M.P[j0 - 1], rr0 = Pp.r[i0] + (P0.r[i0] - Pp.r[i0]) * mv,
              a0 = Pp.th[i0] + (P0.th[i0] - Pp.th[i0]) * mv;
          x0 = rr0 * Math.cos(a0); y0 = rr0 * Math.sin(a0);
        }
        proj(x0, y0, zs[j0], j0 * N + i0);
      }
    }
    var ga = 1 - fade;
    var line = function (a, b) { g.moveTo(SX[a], SY[a]); g.lineTo(SX[b], SY[b]); };
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* threads: every point followed from pass to pass */
    if (k0 > 0) {
      g.beginPath();
      for (i0 = 0; i0 < N; i0++) {
        g.moveTo(SX[i0], SY[i0]);
        for (j0 = 1; j0 <= k0; j0++) g.lineTo(SX[j0 * N + i0], SY[j0 * N + i0]);
      }
      g.lineWidth = 0.6; g.strokeStyle = M.rgb(M.b5, 0.16 * ga * (k0 > 1 ? 1 : mv)); g.stroke();
    }

    var ring = function (j, o, a, w, col, f0, f1) {
      /* the cycle of pass j as a polyline, drawn between arclength fractions */
      var cyc = M.P[j].cyc, n = cyc.length;
      if (f1 <= f0) return;
      var i1 = Math.floor(f0 * n), i2 = Math.ceil(f1 * n);
      g.beginPath();
      for (var q = i1; q <= i2; q++) {
        var fq = Math.max(f0, Math.min(f1, q / n)) * n, qa = Math.min(n - 1, Math.floor(fq)), qf = fq - qa;
        var A = o + cyc[qa % n], B = o + cyc[(qa + 1) % n];
        var X1 = SX[A] + (SX[B] - SX[A]) * qf, Y1 = SY[A] + (SY[B] - SY[A]) * qf;
        if (q === i1) g.moveTo(X1, Y1); else g.lineTo(X1, Y1);
      }
      g.lineWidth = w; g.strokeStyle = M.rgb(col, a); g.stroke();
    };
    var edges = function (j, o, r, aS, aL, wS, wL, grow) {
      var bk = M.P[j].bk;
      for (var b = 0; b < NB; b++) {
        var list = bk[b], any = false;
        g.beginPath();
        for (var q = 0; q < list.length; q++) {
          var e = list[q];
          if (e.l > r) break;
          var f = grow ? Math.min(1, (r - e.l) / GROW) : 1, A = o + e.i, B = o + e.j;
          any = true;
          if (f >= 1) { line(A, B); continue; }
          var h = f * 0.5;
          g.moveTo(SX[A], SY[A]); g.lineTo(SX[A] + (SX[B] - SX[A]) * h, SY[A] + (SY[B] - SY[A]) * h);
          g.moveTo(SX[B], SY[B]); g.lineTo(SX[B] + (SX[A] - SX[B]) * h, SY[B] + (SY[A] - SY[B]) * h);
        }
        if (!any) continue;
        var kb = b / (NB - 1);
        g.lineWidth = wS + (wL - wS) * kb;
        g.strokeStyle = M.rgb(M.bcol[b], aS + (aL - aS) * kb);
        g.stroke();
      }
    };
    var dots = function (o, a, rad, col) {
      g.beginPath();
      for (var q = 0; q < N; q++) { g.moveTo(SX[o + q] + rad, SY[o + q]); g.arc(SX[o + q], SY[o + q], rad, 0, TAU); }
      g.fillStyle = M.rgb(col, a); g.fill();
    };

    /* older passes, back to front: skeleton at the scale their ring closed,
       their ring, their points; the one just left fades its full filtration */
    for (j0 = 0; j0 < k0; j0++) {
      var Pj = M.P[j0], o0 = j0 * N, dep = zs[j0] / DZ;
      var da = Math.max(0.3, 1 - 0.13 * dep) * ga;
      if (post >= 0 && j0 === k0 - 1) da *= 1 - brk;
      /* lj: 0 while the layer is still dressed as the current pass, 1 once it
         has settled into the stack, so leaving the front never pops */
      var lj = j0 === k0 - 1 ? mv : 1;
      if (lj < 1) edges(j0, o0, Pj.rmax, 0.78 * (1 - lj) * da, 0.2 * (1 - lj) * da, 1.05, 0.55, true);
      if (lj > 0) edges(j0, o0, Pj.best.b, 0.24 * lj * da, 0.15 * lj * da, 0.8, 0.8, false);
      var tj = Pj.best.tri;
      g.beginPath(); line(o0 + tj[0], o0 + tj[1]); line(o0 + tj[1], o0 + tj[2]); line(o0 + tj[2], o0 + tj[0]);
      g.lineWidth = 1.5 - 0.7 * lj; g.strokeStyle = M.rgb(M.c5, (0.85 + (0.3 * (1 - hero) - 0.85) * lj) * da); g.stroke();
      ring(j0, o0, (0.57 + 0.05 * lj) * da, 1.9 - 0.6 * lj, M.v7, 0, 1);
      if (lj > 0) dots(o0, 0.55 * lj * da, 1.5, M.b7);
    }

    /* the current pass: its filtration grows, its ring is made and filled */
    var oc = k0 * N, best = cur.best;
    if (fp > 0 || post >= 0) {
      /* at the lock the filtration steps back so the two rings read clean */
      var calm = 1 - 0.75 * lock;
      edges(k0, oc, rNow, 0.78 * ga * calm, 0.2 * ga * calm, 1.05, 0.55, true);
      var made = Math.max(0, Math.min(1, (rNow - best.b) / 0.3));
      var dead = Math.max(0, Math.min(1, (rNow - best.d) / GROW));
      if (dead > 0) {
        var tv = best.tri, h3 = ease(dead);
        g.beginPath();
        for (var e3 = 0; e3 < 3; e3++) {
          var A3 = oc + tv[e3], B3 = oc + tv[(e3 + 1) % 3];
          g.moveTo(SX[A3], SY[A3]);
          g.lineTo(SX[A3] + (SX[B3] - SX[A3]) * h3, SY[A3] + (SY[B3] - SY[A3]) * h3);
        }
        g.lineWidth = 1.5; g.strokeStyle = M.rgb(M.c5, 0.85 * ga * calm); g.stroke();
      }
      if (made > 0) {
        var mk = ease(made), locked = post >= 0 ? lock : 0;
        var ra = (1 - 0.4 * dead * (1 - locked)) * ga;
        var f0 = post >= 0 ? 0.5 * brk : 0.5 - 0.5 * mk, f1 = 1 - f0;
        /* made: the violet ring sweeps out from the edge that closed it */
        /* draw from the closing edge outward: fractions measured from it */
        g.beginPath();
        var cyc = cur.cyc, n = cyc.length, first = true;
        for (var q = 0; q <= 2 * n; q++) {
          var fr = q / (2 * n);
          if (fr < f0 || fr > f1) continue;
          var pos = (fr * n + n * 0.5) % n, qa = Math.floor(pos), qf = pos - qa;
          var A = oc + cyc[qa % n], B = oc + cyc[(qa + 1) % n];
          var X1 = SX[A] + (SX[B] - SX[A]) * qf, Y1 = SY[A] + (SY[B] - SY[A]) * qf;
          if (first) { g.moveTo(X1, Y1); first = false; } else g.lineTo(X1, Y1);
        }
        g.lineWidth = 1.9 + 0.8 * locked; g.strokeStyle = M.rgb(M.v7, 0.95 * ra); g.stroke();
        if (locked > 0) {
          /* the locked ring's glow: two wider, fainter strokes of the same path */
          g.lineWidth = 7; g.strokeStyle = M.rgb(M.v5, 0.1 * locked * ra); g.stroke();
          g.lineWidth = 4.2; g.strokeStyle = M.rgb(M.v5, 0.16 * locked * ra); g.stroke();
        }
        /* waves of light travelling round the ring */
        var WB = 4, wv = REDUCED ? 0.2 : (t / 2200) % 1;
        /* the waves settle over the last half second of every pass but the last */
        var wamp = post < 0 && k0 < NP - 1 ? 1 - ease((tt - k0 * PASS - (PASS - 500)) / 500) : 1;
        for (var wb = 1; wb <= WB; wb++) {
          g.beginPath();
          var anyw = false;
          for (q = 0; q < n; q++) {
            var fm = (q + 0.5) / n, fe = (fm + 0.5) % 1;
            if (fe < f0 || fe > f1) continue;
            var d1 = Math.abs(((fm - wv) % 0.5 + 0.5) % 0.5 - 0.25) / 0.25;
            var lv = Math.floor(Math.pow(d1, 3) * WB + 0.5);
            if (lv !== wb) continue;
            anyw = true; line(oc + cyc[q], oc + cyc[(q + 1) % n]);
          }
          if (!anyw) continue;
          g.lineWidth = 1.9 + 0.5 * wb + 0.8 * locked;
          g.strokeStyle = M.rgb(M.v5, (0.14 * wb) * ra * mk * wamp);
          g.stroke();
        }
      }
    }
    dots(oc, 0.9 * ga, 1.9, M.b7);

    /* the next run's cloud arrives while this one fades */
    if (fade > 0) {
      var P0n = M.P[0];
      for (i0 = 0; i0 < N; i0++) proj(P0n.x[i0], P0n.y[i0], 0, NP * N + i0);
      dots(NP * N, 0.9 * fade, 1.9, M.b7);
    }
  }

  /* ==================================================================== */
  /* grant — topograph-432                                               */
  /* ==================================================================== */
  function grant(g, vb, t, st) {
    /* A least privilege fix, drawn as a place. The cluster is a hall of glass
       server blades standing in rows. Inside each blade its pods glow as small
       lit blocks, and on top of each blade sits the one agent a daemonset puts
       on every node. In front, on its own disc, is the chart install: a gem for
       its ServiceAccount.

       Before the change the ClusterRole rendered the same rules whatever the
       engine and provider, so this install, one that never talks to the
       Kubernetes API (provider test, engine slurm), could still list every pod,
       get and list every node and get every daemonset, cluster wide. That reach
       is drawn as light: one arc from the gem to every pod, every node and every
       daemonset agent. Each rule leaves at its own elevation, so the three rules
       form three canopies over the whole hall. The arcs are real trajectories,
       z(d) = z0 + d tan(a) - K d^2 with K fixed by the target, and a bead of
       light flies each one at constant horizontal speed, taking the time a
       projectile would. Every arc starts at the gem, so they crowd there, and
       that crowding is the bright plume. Nothing is painted to look bright.

       Then the change: two glass walls, engine.name and provider.name, rise out
       of the install's disc. Their rising edge is the test. When the outer
       wall's edge reaches an arc, at the height that arc really crosses it,
       the arc is withdrawn: its light pulls back out of the hall into the gem.
       The low canopy (pods list) is met first, then nodes get/list, then
       daemonsets get, because that is the order the edge meets them. The floor
       goes calm, the gem turns mint, and for this install nothing reaches the
       cluster. The cluster itself keeps running the whole time.

       The hall (12 nodes, their pods, the layout) is illustrative, not measured.

       Measured, in preview-grant.html (strict mode, DPR 2):
       - A ballistic arc is a parabola and this view is orthographic, so every
         arc, and every stretch of one, is drawn as one exact quadratic Bezier.
         That replaced 26-point polylines and cut the mean frame from about 10
         to about 7 ms with the raster forced (caustic, same harness: 4.4 ms).
       - Worst frame 614 draw calls, mean 302. The widest two glows are one
         path each; only the core is stroked arc by arc, so crowding still adds.
       - The walls rise at constant speed through the canopies (zero speed at
         both ends); with smootherstep the three rules were cut 200 ms apart and
         read as one event. Now pods list ~8.2 s, nodes get/list ~8.7 s,
         daemonsets get ~9.4 to 9.8 s into each 15.6 s cycle.
       - A straight coral to mint mix turned the gem slate grey mid-way; it runs
         along the site's ramp (coral, violet, blue, mint) instead.
       - Darkest painted pixel luminance 0.064 (floor #3a3a3a is 0.042). */
    var TAU = Math.PI * 2;
    var W = vb[0], H = vb[1];
    var P = 15600;                               /* one cycle */
    var PHI0 = -0.62, SWAY = 0.07, SWP = 23000, EL = 0.6;
    var GRAV = 1.5e-6;                           /* world units per ms^2 */
    var HG = 1.45, R1 = 0.42, R2 = 0.56;         /* the two walls */
    var UP0 = 6300, UP1 = 10500, RT = 1300, DN0 = 13700, DN1 = 14800;
    var RA = 0.2;                                /* the rise: speeds up, holds, settles */
    var YT = 70, YB = H - 104, XM = 12;
    var ANG = [0.4, 0.74, 1.06];                 /* pods list, nodes get/list, daemonsets get */
    var BL = 0.5, BT = 0.17, BH = 0.52;          /* a blade: length, thickness, height */

    function rise(u) {
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      var vm = 1 / (1 - RA);
      if (u < RA) return vm * u * u / (2 * RA);
      if (u > 1 - RA) return 1 - vm * (1 - u) * (1 - u) / (2 * RA);
      return vm * (RA / 2 + u - RA);
    }

    var M = grant.cache;
    if (!M) {
      var o = {}, i, j, k;
      var hex = function (name, fb) {
        var h = (token(name, fb) || fb).trim().replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      o.c = {
        coral: hex('--coral-500', '#d9376e'), coral7: hex('--coral-700', '#a01c3f'),
        mint: hex('--mint-500', '#0b93ab'), mint7: hex('--mint-700', '#0a6b7c'),
        blue: hex('--blue-500', '#2456dc'), blue7: hex('--blue-700', '#163d9a'),
        violet: hex('--violet-500', '#a66cf0'), violet7: hex('--violet-700', '#6b35c4'),
        amber: hex('--amber-500', '#d96a06'), amber7: hex('--amber-700', '#9a4906'),
        raised: hex('--raised', '#ffffff'), hair: hex('--hair', '#e5e2da'),
        hair2: hex('--hair2', '#cfcbc1'), muted: hex('--muted', '#5f5b53')
      };
      var hash = function (a, b) { var s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

      /* the install: a disc at the origin, the gem above a glass plinth */
      o.src = [0, 0, 0.5];
      o.disc = 0.8;
      /* the hall: three rows of four blades */
      var PX = 0.64, PY = 0.78, DC = 2.35;
      var FW = 0.5 + 3 * PX + BL, FD = 0.56 + 2 * PY + BT;
      var FX0 = -FW / 2, FY0 = DC - FD / 2;
      o.floor = [FX0, FX0 + FW, FY0, FY0 + FD];
      o.nodes = [];
      var SL = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
      for (j = 0; j < 3; j++) {
        for (i = 0; i < 4; i++) {
          var cx = FX0 + 0.25 + BL / 2 + i * PX, cy = FY0 + 0.28 + BT / 2 + j * PY;
          var nd = { cx: cx, cy: cy, x0: cx - BL / 2, x1: cx + BL / 2, y0: cy - BT / 2, y1: cy + BT / 2,
                     pods: [], arcs: [] };
          var np = 2 + Math.floor(hash(i + 7, j + 3) * 2.999);
          var off = Math.floor(hash(i + 2, j + 11) * 4);
          for (k = 0; k < np; k++) {
            var s2 = SL[(off + k) % 4];
            nd.pods.push({ x: cx + s2[0] * 0.115, y: cy, z: 0.09 + s2[1] * 0.2,
                           ns: Math.floor(hash(i * 4 + j, k + 1) * 1.999), ph: hash(i + k, j + 9) });
          }
          nd.ag = [cx - 0.17, cy, BH + 0.045];
          o.nodes.push(nd);
        }
      }

      /* the arcs: every pod, every node, every daemonset agent */
      var sx = o.src[0], sy = o.src[1], sz = o.src[2];
      o.arcs = [];
      var amin = 1e9, amax = -1e9;
      var addArc = function (fam, nd, tx, ty, tz) {
        var dx = tx - sx, dy = ty - sy, D = Math.hypot(dx, dy), az = Math.atan2(dy, dx);
        var tn = Math.tan(ANG[fam]), Kc = (D * tn - (tz - sz)) / (D * D);
        var a = { fam: fam, D: D, az: az, ca: Math.cos(az), sa: Math.sin(az), tn: tn, K: Kc,
                  T: Math.sqrt(2 * Kc * D * D / GRAV) };
        a.z1 = sz + R1 * tn - Kc * R1 * R1;
        a.z2 = sz + R2 * tn - Kc * R2 * R2;
        a.L = 250 + fam * 330 + 650 * hash(o.arcs.length, 3);
        a.Pb = 2300 + 800 * hash(o.arcs.length, 7);
        if (az < amin) amin = az;
        if (az > amax) amax = az;
        nd.arcs.push(a);
        o.arcs.push(a);
        return a;
      };
      for (i = 0; i < o.nodes.length; i++) {
        var n2 = o.nodes[i];
        for (k = 0; k < n2.pods.length; k++) {
          var pp = n2.pods[k];
          pp.arc = addArc(0, n2, pp.x, pp.y, pp.z + 0.11);
        }
        n2.arc = addArc(1, n2, n2.cx + 0.1, n2.cy, BH);
        n2.agArc = addArc(2, n2, n2.ag[0], n2.ag[1], n2.ag[2]);
      }
      /* when each wall's rising edge meets each arc: invert the rise */
      var riseInv = function (z) {
        var lo = 0, hi = 1;
        for (var q = 0; q < 40; q++) { var m = (lo + hi) / 2; if (HG * rise(m) < z) lo = m; else hi = m; }
        return UP0 + (UP1 - UP0) * (lo + hi) / 2;
      };
      for (i = 0; i < o.arcs.length; i++) {
        o.arcs[i].t1 = riseInv(o.arcs[i].z1);
        o.arcs[i].cut = riseInv(o.arcs[i].z2);
      }
      o.A0 = amin - 0.6; o.A1 = amax + 0.6;
      o.NW = 22;

      /* fit the whole scene, at every sway, into the band between the labels */
      var bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      var pts = [], f = o.floor;
      pts.push([f[0], f[2], -0.12], [f[1], f[2], -0.12], [f[0], f[3], BH + 0.12], [f[1], f[3], BH + 0.12],
               [f[1], f[2], BH + 0.12], [f[0], f[2], BH + 0.12]);
      for (i = 0; i < 24; i++) pts.push([o.disc * Math.cos(i / 24 * TAU), o.disc * Math.sin(i / 24 * TAU), -0.1]);
      for (i = 0; i <= 12; i++) {
        var aa = o.A0 + (o.A1 - o.A0) * i / 12;
        pts.push([R2 * Math.cos(aa), R2 * Math.sin(aa), HG + 0.05]);
      }
      for (i = 0; i < o.arcs.length; i++) {
        var ar = o.arcs[i];
        for (k = 0; k <= 24; k++) {
          var dk = ar.D * k / 24;
          pts.push([sx + dk * ar.ca, sy + dk * ar.sa, sz + dk * ar.tn - ar.K * dk * dk]);
        }
      }
      pts.push([0, 0, sz + 0.55]);
      for (k = 0; k <= 8; k++) {
        var ph = PHI0 + SWAY * (k / 4 - 1), cp = Math.cos(ph), sp = Math.sin(ph);
        for (i = 0; i < pts.length; i++) {
          var X = pts[i][0] * cp - pts[i][1] * sp;
          var Y = pts[i][2] * Math.cos(EL) + (pts[i][0] * sp + pts[i][1] * cp) * Math.sin(EL);
          if (X < bx0) bx0 = X; if (X > bx1) bx1 = X;
          if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
        }
      }
      var PAD = 8;
      o.S = Math.min((W - 2 * XM - 2 * PAD) / (bx1 - bx0), (YB - YT - 2 * PAD) / (by1 - by0));
      o.CX = W / 2 - o.S * (bx0 + bx1) / 2;
      o.CY = (YT + YB) / 2 + o.S * (by0 + by1) / 2;
      grant.cache = M = o;
    }

    /* --- time ------------------------------------------------------------ */
    var RED = REDUCED;
    var c = RED ? 12500 : t % P;
    var phi = PHI0 + (RED ? 0 : SWAY * Math.sin(TAU * t / SWP));
    var cp = Math.cos(phi), sp = Math.sin(phi), ce = Math.cos(EL), se = Math.sin(EL);
    var S = M.S, CX = M.CX, CY = M.CY, C = M.c;
    var hgt = 0;                                 /* the walls' height */
    if (c >= UP0 && c < DN0) hgt = HG * rise((c - UP0) / (UP1 - UP0));
    else if (c >= DN0 && c < DN1) hgt = HG * (1 - ease((c - DN0) / (DN1 - DN0)));
    var wv = ease(hgt / 0.3);
    /* toward the viewer, for glass that brightens at grazing angles */
    var vx = -sp * ce, vy = -cp * ce, vz = se;

    function col(a, al) { return 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')'; }
    function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    var PX_ = 0, PY_ = 0;
    function pj(x, y, z) {
      PX_ = CX + S * (x * cp - y * sp);
      PY_ = CY - S * (z * ce + (x * sp + y * cp) * se);
    }
    function dep(x, y, z) { return -(x * sp + y * cp) * ce + z * se; }
    function poly(p) {
      g.beginPath();
      for (var q = 0; q < p.length; q += 3) {
        pj(p[q], p[q + 1], p[q + 2]);
        if (q === 0) g.moveTo(PX_, PY_); else g.lineTo(PX_, PY_);
      }
      g.closePath();
    }
    function floorGlow(x, y, r, colr, al) {
      pj(x, y, 0);
      g.save();
      g.translate(PX_, PY_); g.scale(1, se);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, r * S);
      rg.addColorStop(0, col(colr, al)); rg.addColorStop(1, col(colr, 0));
      g.fillStyle = rg;
      g.beginPath(); g.arc(0, 0, r * S, 0, TAU); g.fill();
      g.restore();
    }
    function halo(x, y, r, colr, al) {
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col(colr, al)); rg.addColorStop(1, col(colr, 0));
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    /* --- per-arc state ---------------------------------------------------- */
    var arcs = M.arcs, NA = arcs.length, a, n, q;
    var live = 0;
    for (n = 0; n < NA; n++) {
      a = arcs[n];
      var v = a.D / a.T, dhi;
      if (RED) dhi = 0;
      else {
        dhi = Math.max(0, Math.min(a.D, v * (c - a.L)));
        if (c > a.cut) dhi = Math.min(dhi, a.D * (1 - ease((c - a.cut) / RT)));
      }
      a.dhi = dhi;
      a.R = ease((dhi - (a.D - 0.3)) / 0.3);
      /* a landing swells the target and never pops: (s e^(1-s))^2 */
      var pulse = 0;
      if (a.R > 0) {
        var m0 = Math.floor((c - a.L - a.T) / a.Pb);
        for (var m = m0; m >= Math.max(0, m0 - 1); m--) {
          var ta = a.L + m * a.Pb + a.T;
          if (ta > a.cut || ta > c) continue;
          var s = (c - ta) / 240;
          if (s < 6) pulse = Math.max(pulse, s * s * Math.exp(2 - 2 * s));
        }
      }
      a.glow = a.R * (0.65 + 0.35 * pulse);
      live += dhi / a.D;
    }
    live /= NA;
    var warm = c < UP0 ? 1 : c < DN0 ? live : ease((c - DN0 - 200) / 1100);
    if (RED) warm = 0;
    /* coral to mint along the site's own ramp (mint, blue, violet, coral), so
       the gem never passes through the grey a straight mix would give */
    function ramp(L, w) {
      var k = Math.max(0, Math.min(2.999, w * 3)), i = Math.floor(k);
      return mix(L[i], L[i + 1], k - i);
    }
    var gemC = ramp([C.mint, C.blue, C.violet, C.coral], warm);
    var gemC7 = ramp([C.mint7, C.blue7, C.violet7, C.coral7], warm);

    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* --- the hall floor --------------------------------------------------- */
    var f = M.floor, FT = 0.1;
    g.fillStyle = col(mix(C.hair2, C.blue, 0.04), 1);
    poly([f[1], f[2], 0, f[1], f[3], 0, f[1], f[3], -FT, f[1], f[2], -FT]); g.fill();
    g.fillStyle = col(mix(C.hair, C.blue, 0.03), 1);
    poly([f[0], f[2], 0, f[1], f[2], 0, f[1], f[2], -FT, f[0], f[2], -FT]); g.fill();
    pj(f[0], f[3], 0); var gx0 = PX_, gy0 = PY_;
    pj(f[1], f[2], 0);
    var fg = g.createLinearGradient(gx0, gy0, PX_, PY_);
    fg.addColorStop(0, col(C.raised, 1));
    fg.addColorStop(1, col(mix(C.hair, C.blue, 0.04), 1));
    g.fillStyle = fg;
    poly([f[0], f[2], 0, f[1], f[2], 0, f[1], f[3], 0, f[0], f[3], 0]); g.fill();
    g.strokeStyle = col(C.raised, 1); g.lineWidth = 1.5;
    g.beginPath();
    pj(f[0], f[2], 0); g.moveTo(PX_, PY_);
    pj(f[1], f[2], 0); g.lineTo(PX_, PY_);
    pj(f[1], f[3], 0); g.lineTo(PX_, PY_);
    g.stroke();

    /* coral light pooled on the floor wherever the reach lands */
    var nodes = M.nodes, NN = nodes.length, nd, k2;
    for (n = 0; n < NN; n++) {
      nd = nodes[n];
      var pool = 0;
      for (k2 = 0; k2 < nd.arcs.length; k2++) pool += nd.arcs[k2].glow;
      nd.pool = pool / nd.arcs.length;
      nd.d = dep(nd.cx, nd.cy, 0);
    }
    /* the whole floor takes the coral light, as strongly as the reach lands */
    var wash = 0;
    for (n = 0; n < NN; n++) wash += nodes[n].pool / NN;
    if (wash > 0.01) {
      g.beginPath();
      pj(f[0], f[2], 0); g.moveTo(PX_, PY_);
      pj(f[1], f[2], 0); g.lineTo(PX_, PY_);
      pj(f[1], f[3], 0); g.lineTo(PX_, PY_);
      pj(f[0], f[3], 0); g.lineTo(PX_, PY_);
      g.closePath();
      /* the gradient is a circle on the floor, so it is laid in floor space */
      pj((f[0] + f[1]) / 2, (f[2] + f[3]) / 2, 0);
      var wr = 0.55 * S * Math.hypot(f[1] - f[0], f[3] - f[2]);
      g.save();
      g.translate(PX_, PY_); g.scale(1, se);
      var wgr = g.createRadialGradient(0, 0, 0, 0, 0, wr);
      wgr.addColorStop(0, col(C.coral, 0.24 * wash));
      wgr.addColorStop(0.6, col(C.coral, 0.15 * wash));
      wgr.addColorStop(1, col(C.coral, 0.03 * wash));
      g.fillStyle = wgr;
      g.fill();
      g.restore();
    }
    /* contact shadows, all in one path: two soft rings, painted once each */
    for (var sh = 0; sh < 2; sh++) {
      g.fillStyle = col(C.muted, 0.05);
      g.beginPath();
      for (n = 0; n < NN; n++) {
        nd = nodes[n];
        pj(nd.cx + 0.05, nd.cy + 0.03, 0);
        g.moveTo(PX_ + (0.36 - 0.1 * sh) * S, PY_);
        g.ellipse(PX_, PY_, (0.36 - 0.1 * sh) * S, (0.36 - 0.1 * sh) * S * se * 0.7, 0, 0, TAU);
      }
      g.fill();
    }

    /* --- the blades, back to front --------------------------------------- */
    var order = nodes.slice().sort(function (p1, p2) { return p1.d - p2.d; });
    var tAbs = RED ? 1e9 : t;
    var NSC = [C.blue, C.violet], NSC7 = [C.blue7, C.violet7];
    for (n = 0; n < NN; n++) {
      nd = order[n];
      var x0 = nd.x0, x1 = nd.x1, y0 = nd.y0, y1 = nd.y1;
      var reach = nd.arc.glow, tint = mix(C.blue, C.coral, 0.8 * reach);
      /* back walls and base */
      g.fillStyle = col(tint, 0.07 + 0.05 * reach);
      poly([x0, y0, 0, x0, y1, 0, x1, y1, 0, x1, y1, BH, x0, y1, BH, x0, y0, BH]); g.fill();
      /* pods, lit blocks inside the glass */
      var pods = nd.pods;
      for (k2 = 0; k2 < pods.length; k2++) pods[k2].d = dep(pods[k2].x, pods[k2].y, pods[k2].z);
      var po = pods.slice().sort(function (p1, p2) { return p1.d - p2.d; });
      for (k2 = 0; k2 < po.length; k2++) {
        var pd = po[k2], hx = 0.065, hy = 0.05, z0 = pd.z, z1 = pd.z + 0.11;
        var on = ease((tAbs - 120 - 70 * (n * 3 + k2)) / 520);
        if (on <= 0) continue;
        var br = RED ? 0.5 : 0.5 + 0.5 * Math.sin(TAU * (t / 3400 + pd.ph));
        var pc = NSC[pd.ns], pc7 = NSC7[pd.ns], pr = pd.arc.glow;
        var X0 = pd.x - hx, X1 = pd.x + hx, Y0 = pd.y - hy, Y1 = pd.y + hy;
        pj(X0, Y0, z0); var xl = PX_;
        pj(X1, Y1, z0); var xr = PX_;
        pj(X1, Y0, z0);
        var kk = Math.max(0, Math.min(1, (PX_ - xl) / (xr - xl)));
        var sg = g.createLinearGradient(xl, 0, xr, 0);
        var cf = col(mix(mix(pc, C.raised, 0.08 * br), C.coral, 0.6 * pr), on);
        var cs2 = col(mix(mix(pc, pc7, 0.3), C.coral7, 0.55 * pr), on);
        sg.addColorStop(0, cf); sg.addColorStop(kk, cf); sg.addColorStop(kk, cs2); sg.addColorStop(1, cs2);
        g.fillStyle = sg;
        poly([X0, Y0, z0, X1, Y0, z0, X1, Y1, z0, X1, Y1, z1, X1, Y0, z1, X0, Y0, z1]); g.fill();
        g.fillStyle = col(mix(mix(pc, C.raised, 0.3 + 0.2 * br), C.coral, 0.5 * pr), on);
        poly([X0, Y0, z1, X1, Y0, z1, X1, Y1, z1, X0, Y1, z1]); g.fill();
      }
      /* front walls and lid: glass, with a streak of light across the face */
      pj(x0, y0, BH); var fyt = PY_;
      pj(x0, y0, 0);
      var gg = g.createLinearGradient(0, fyt, 0, PY_);
      gg.addColorStop(0, col(mix(tint, C.raised, 0.4), 0.1 + 0.08 * reach));
      gg.addColorStop(1, col(tint, 0.2 + 0.12 * reach));
      g.fillStyle = gg;
      poly([x0, y0, 0, x1, y0, 0, x1, y1, 0, x1, y1, BH, x1, y0, BH, x0, y0, BH]); g.fill();
      g.fillStyle = col(C.raised, 0.32);
      var sk = 0.18 + 0.05 * Math.sin(TAU * t / SWP + n);
      poly([x0 + BL * (sk + 0.1), y0, BH, x0 + BL * (sk + 0.2), y0, BH, x0 + BL * (sk - 0.02), y0, 0, x0 + BL * (sk - 0.12), y0, 0]);
      g.fill();
      g.fillStyle = col(mix(C.raised, tint, 0.2 + 0.3 * reach), 0.7);
      poly([x0, y0, BH, x1, y0, BH, x1, y1, BH, x0, y1, BH]); g.fill();
      /* edges: a lit rim on the lid, tinted edges below */
      g.lineWidth = 0.9;
      g.strokeStyle = col(mix(C.blue7, C.coral7, reach), 0.3 + 0.4 * reach);
      g.beginPath();
      pj(x0, y0, 0); g.moveTo(PX_, PY_);
      pj(x1, y0, 0); g.lineTo(PX_, PY_);
      pj(x1, y1, 0); g.lineTo(PX_, PY_);
      pj(x1, y0, 0); g.moveTo(PX_, PY_);
      pj(x1, y0, BH); g.lineTo(PX_, PY_);
      pj(x0, y0, 0); g.moveTo(PX_, PY_);
      pj(x0, y0, BH); g.lineTo(PX_, PY_);
      pj(x1, y1, 0); g.moveTo(PX_, PY_);
      pj(x1, y1, BH); g.lineTo(PX_, PY_);
      g.stroke();
      g.strokeStyle = col(reach > 0.02 ? mix(C.raised, C.coral, reach) : C.raised, 0.95); g.lineWidth = 1.3;
      poly([x0, y0, BH, x1, y0, BH, x1, y1, BH, x0, y1, BH]); g.stroke();
      /* the daemonset's agent: one on every node, breathing in a wave */
      pj(nd.ag[0], nd.ag[1], nd.ag[2]);
      var ax = PX_, ay = PY_, ar = 0.045 * S;
      var wave = RED ? 0.5 : 0.5 + 0.5 * Math.sin(TAU * (t / 4200 - (nd.cx + nd.cy) * 0.18));
      var agR = nd.agArc.glow;
      if (agR > 0.02) halo(ax, ay, ar * 3.2, C.coral, 0.4 * agR);
      var ag = g.createRadialGradient(ax - ar * 0.35, ay - ar * 0.4, ar * 0.1, ax, ay, ar);
      ag.addColorStop(0, col(mix(C.amber, C.raised, 0.35 + 0.35 * wave), 1));
      ag.addColorStop(1, col(mix(C.amber, C.coral, agR), 1));
      g.fillStyle = ag;
      g.beginPath(); g.arc(ax, ay, ar, 0, TAU); g.fill();
    }

    /* --- the install's disc -------------------------------------------- */
    var DR = M.disc, sx = M.src[0], sy = M.src[1], sz = M.src[2];
    pj(sx, sy, 0);
    var dcx = PX_, dcy = PY_;
    g.save();
    g.translate(dcx, dcy); g.scale(1, se);
    g.fillStyle = col(mix(C.hair2, C.blue, 0.04), 1);
    g.beginPath(); g.arc(0, 0.09 * S * ce / se, DR * S, 0, TAU); g.fill();
    var dg = g.createLinearGradient(0, -DR * S, 0, DR * S);
    dg.addColorStop(0, col(C.raised, 1)); dg.addColorStop(1, col(mix(C.hair, C.raised, 0.3), 1));
    g.fillStyle = dg;
    g.beginPath(); g.arc(0, 0, DR * S, 0, TAU); g.fill();
    g.strokeStyle = col(C.raised, 1); g.lineWidth = 1.4 / se;
    g.beginPath(); g.arc(0, 0, DR * S - 1, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.restore();
    /* the grooves the walls rise from */
    g.lineWidth = 1;
    for (var wI = 0; wI < 2; wI++) {
      var RR = wI ? R2 : R1;
      g.strokeStyle = col(C.mint7, 0.16 + 0.4 * wv);
      g.beginPath();
      for (q = 0; q <= 30; q++) {
        var aq = M.A0 + (M.A1 - M.A0) * q / 30;
        pj(sx + RR * Math.cos(aq), sy + RR * Math.sin(aq), 0);
        if (q === 0) g.moveTo(PX_, PY_); else g.lineTo(PX_, PY_);
      }
      g.stroke();
    }
    floorGlow(sx, sy, 0.66, gemC, 0.24 + 0.12 * warm);

    /* --- the reach ------------------------------------------------------ */
    /* Any stretch of a parabola is a quadratic Bezier, and an orthographic
       view is affine, so it stays one on screen: the control point is where
       the tangent at d0, run for half the stretch, lands. One curve, exact. */
    function trace(a, d0, d1) {
      if (d1 <= d0) return false;
      var z0 = sz + d0 * a.tn - a.K * d0 * d0, h = (d1 - d0) / 2;
      pj(sx + d0 * a.ca, sy + d0 * a.sa, z0); g.moveTo(PX_, PY_);
      pj(sx + (d0 + h) * a.ca, sy + (d0 + h) * a.sa, z0 + (a.tn - 2 * a.K * d0) * h);
      var qx = PX_, qy = PY_;
      pj(sx + d1 * a.ca, sy + d1 * a.sa, sz + d1 * a.tn - a.K * d1 * d1);
      g.quadraticCurveTo(qx, qy, PX_, PY_);
      return true;
    }
    /* the two glows are one path each, painted once; the core is stroked arc
       by arc, so where arcs share a place their light adds up */
    var BW = [7, 2.8, 1.25], BA = [0.07, 0.1, 0.5];
    function beams() {
      for (var b = 0; b < 3; b++) {
        g.lineWidth = BW[b];
        g.strokeStyle = col(b === 2 ? C.coral : mix(C.coral, C.raised, 0.1), BA[b]);
        var any = false;
        if (b < 2) g.beginPath();
        for (var nn = 0; nn < NA; nn++) {
          var aa = arcs[nn];
          if (aa.dhi <= 0.001) continue;
          if (b < 2) { any = trace(aa, 0, aa.dhi) || any; continue; }
          g.beginPath();
          if (trace(aa, 0, aa.dhi)) g.stroke();
        }
        if (b < 2 && any) g.stroke();
      }
    }
    /* --- the two walls ---------------------------------------------------- */
    function wall(RR, al) {
      if (hgt <= 0.001) return;
      var NW = M.NW, A0 = M.A0, A1 = M.A1;
      pj(sx, sy, 0); var yb = PY_;
      pj(sx, sy, hgt);
      var wg = g.createLinearGradient(0, PY_ - S * RR * se, 0, yb + S * RR * se);
      wg.addColorStop(0, col(C.mint, 0.3 * al * wv));
      wg.addColorStop(0.3, col(C.mint, 0.09 * al * wv));
      wg.addColorStop(1, col(C.mint, 0.2 * al * wv));
      g.fillStyle = wg;
      /* glass is clearer face on and denser at grazing angles; strips go in
         groups of GS, each group one path at its mean angle's opacity */
      var GS = 4;
      for (var ww = 0; ww < NW; ww += GS) {
        var we = Math.min(NW, ww + GS), am = A0 + (A1 - A0) * (ww + we) / 2 / NW;
        var fr = 1 - Math.abs(Math.cos(am) * vx + Math.sin(am) * vy) / ce;
        g.globalAlpha = 0.45 + 0.55 * fr * fr;
        g.beginPath();
        for (var w4 = ww; w4 <= we; w4++) {
          var a4 = A0 + (A1 - A0) * w4 / NW;
          pj(sx + RR * Math.cos(a4), sy + RR * Math.sin(a4), 0);
          if (w4 === ww) g.moveTo(PX_, PY_); else g.lineTo(PX_, PY_);
        }
        for (w4 = we; w4 >= ww; w4--) {
          var a5 = A0 + (A1 - A0) * w4 / NW;
          pj(sx + RR * Math.cos(a5), sy + RR * Math.sin(a5), hgt);
          g.lineTo(PX_, PY_);
        }
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      /* end posts */
      g.strokeStyle = col(C.mint7, 0.55 * wv); g.lineWidth = 1.1;
      g.beginPath();
      pj(sx + RR * Math.cos(A0), sy + RR * Math.sin(A0), 0); g.moveTo(PX_, PY_);
      pj(sx + RR * Math.cos(A0), sy + RR * Math.sin(A0), hgt); g.lineTo(PX_, PY_);
      pj(sx + RR * Math.cos(A1), sy + RR * Math.sin(A1), 0); g.moveTo(PX_, PY_);
      pj(sx + RR * Math.cos(A1), sy + RR * Math.sin(A1), hgt); g.lineTo(PX_, PY_);
      g.stroke();
      g.strokeStyle = col(C.raised, 0.7 * wv); g.lineWidth = 1;
      g.beginPath();
      for (var w1 = 0; w1 <= NW; w1++) {
        var au = A0 + (A1 - A0) * w1 / NW;
        pj(sx + RR * Math.cos(au), sy + RR * Math.sin(au), Math.max(0, hgt - 0.035));
        if (w1 === 0) g.moveTo(PX_, PY_); else g.lineTo(PX_, PY_);
      }
      g.stroke();
      /* the rising edge: this is where the gate is evaluated */
      for (var b = 0; b < 2; b++) {
        g.strokeStyle = b ? col(C.mint7, 0.95 * wv) : col(C.mint, 0.22 * wv);
        g.lineWidth = b ? 1.6 : 6;
        g.beginPath();
        for (var w2 = 0; w2 <= NW; w2++) {
          var aw = A0 + (A1 - A0) * w2 / NW;
          pj(sx + RR * Math.cos(aw), sy + RR * Math.sin(aw), hgt);
          if (w2 === 0) g.moveTo(PX_, PY_); else g.lineTo(PX_, PY_);
        }
        g.stroke();
      }
    }
    wall(R2, 1);
    wall(R1, 0.85);

    /* --- the install: plinth ---------------------------------------------- */
    var PR = 0.2, PH = 0.24, hexp = [];
    for (q = 0; q < 6; q++) {
      var ah = q / 6 * TAU + 0.3;
      hexp.push([sx + PR * Math.cos(ah), sy + PR * Math.sin(ah), ah + TAU / 12]);
    }
    for (q = 0; q < 6; q++) {
      var h0 = hexp[q], h1 = hexp[(q + 1) % 6];
      var nf = Math.cos(h0[2]) * vx + Math.sin(h0[2]) * vy;
      if (nf <= 0) continue;
      g.fillStyle = col(mix(C.hair2, C.raised, 0.25 + 0.5 * nf / ce), 1);
      poly([h0[0], h0[1], 0, h1[0], h1[1], 0, h1[0], h1[1], PH, h0[0], h0[1], PH]); g.fill();
    }
    g.fillStyle = col(mix(C.raised, gemC, 0.12), 1);
    poly([hexp[0][0], hexp[0][1], PH, hexp[1][0], hexp[1][1], PH, hexp[2][0], hexp[2][1], PH,
          hexp[3][0], hexp[3][1], PH, hexp[4][0], hexp[4][1], PH, hexp[5][0], hexp[5][1], PH]);
    g.fill();
    g.strokeStyle = col(C.raised, 1); g.lineWidth = 1.2; g.stroke();

    beams();

    /* beads of light: each rule reading, flown at ballistic speed */
    if (!RED) {
      for (n = 0; n < NA; n++) {
        a = arcs[n];
        if (a.dhi <= 0.001) continue;
        var vh = a.D / a.T;
        var mm = Math.floor((c - a.L) / a.Pb);
        for (var m2 = mm; m2 >= 0; m2--) {
          var lm = a.L + m2 * a.Pb;
          if (lm > a.cut) continue;
          var db = vh * (c - lm);
          if (db > a.D + 0.02) break;
          if (db > a.dhi + 1e-6) continue;
          var fade = ease(Math.min(db, a.D - db) / 0.18) * (c > a.cut ? ease((a.dhi - db) / 0.25) : 1);
          if (fade <= 0.01) continue;
          var dt0 = Math.max(0, db - 0.34);
          g.beginPath();
          if (!trace(a, dt0, db)) continue;
          var zb = sz + db * a.tn - a.K * db * db;
          pj(sx + db * a.ca, sy + db * a.sa, zb);
          var bx = PX_, by = PY_;
          var zt = sz + dt0 * a.tn - a.K * dt0 * dt0;
          pj(sx + dt0 * a.ca, sy + dt0 * a.sa, zt);
          var bg = g.createLinearGradient(PX_, PY_, bx, by);
          bg.addColorStop(0, col(C.coral, 0));
          bg.addColorStop(1, col(C.coral, 0.95 * fade));
          g.strokeStyle = bg; g.lineWidth = 2.6; g.lineCap = 'butt';
          g.stroke();
          g.lineCap = 'round';
          var hb = g.createRadialGradient(bx, by, 0, bx, by, 5.5);
          hb.addColorStop(0, col(mix(C.coral, C.raised, 0.25), fade));
          hb.addColorStop(0.36, col(C.coral, 0.85 * fade));
          hb.addColorStop(0.42, col(C.coral, 0.22 * fade));
          hb.addColorStop(1, col(C.coral, 0));
          g.fillStyle = hb;
          g.beginPath(); g.arc(bx, by, 5.5, 0, TAU); g.fill();
        }
        /* while a rule is withdrawn, its front is a bright point running home */
        if (c > a.cut && a.dhi > 0.02) {
          var zf = sz + a.dhi * a.tn - a.K * a.dhi * a.dhi;
          pj(sx + a.dhi * a.ca, sy + a.dhi * a.sa, zf);
          var fk = ease(a.dhi / 0.3);
          g.fillStyle = col(C.coral, 0.22 * fk);
          g.beginPath(); g.arc(PX_, PY_, 5, 0, TAU); g.fill();
          g.fillStyle = col(C.coral, 0.9 * fk);
          g.beginPath(); g.arc(PX_, PY_, 1.8, 0, TAU); g.fill();
        }
      }
    } else {
      /* reduced motion: the old reach, left as faint traces behind the gates */
      g.strokeStyle = col(C.coral, 0.16); g.lineWidth = 1;
      for (n = 0; n < NA; n++) {
        g.beginPath(); if (trace(arcs[n], R2, arcs[n].D)) g.stroke();
      }
    }

    /* sparks where a wall's edge meets an arc */
    if (!RED && hgt > 0) {
      for (n = 0; n < NA; n++) {
        a = arcs[n];
        for (var w3 = 0; w3 < 2; w3++) {
          var tt = w3 ? a.cut : a.t1, s3 = (c - tt) / 180;
          if (s3 <= 0 || s3 > 5) continue;
          var e3 = s3 * s3 * Math.exp(2 - 2 * s3);
          var RR3 = w3 ? R2 : R1, zz = w3 ? a.z2 : a.z1;
          pj(sx + RR3 * a.ca, sy + RR3 * a.sa, zz);
          g.fillStyle = col(C.mint, 0.3 * e3);
          g.beginPath(); g.arc(PX_, PY_, 3 + 5 * e3, 0, TAU); g.fill();
          g.fillStyle = col(mix(C.mint, C.raised, 0.5), 0.9 * e3);
          g.beginPath(); g.arc(PX_, PY_, 1.8, 0, TAU); g.fill();
        }
      }
    }

    /* the gem: the install's ServiceAccount, coral while it holds the reach */
    var bob = RED ? 0 : 0.025 * Math.sin(TAU * t / 3800);
    var gz = sz + bob, rot = RED ? 0.4 : t / 9000 * TAU;
    pj(sx, sy, gz);
    halo(PX_, PY_, 34, gemC, 0.36);
    var GR = 0.16, GHt = 0.21, GV = [];
    for (q = 0; q < 4; q++) GV.push([sx + GR * Math.cos(rot + q * TAU / 4), sy + GR * Math.sin(rot + q * TAU / 4), gz]);
    var top3 = [sx, sy, gz + GHt], bot3 = [sx, sy, gz - GHt];
    var faces = [];
    for (q = 0; q < 4; q++) {
      var e0 = GV[q], e1 = GV[(q + 1) % 4];
      for (var up = 0; up < 2; up++) {
        var apx = up ? top3 : bot3;
        var mx = (e0[0] + e1[0]) / 2 - sx, my = (e0[1] + e1[1]) / 2 - sy;
        var ml = Math.hypot(mx, my);
        var nz = up ? GR / GHt : -GR / GHt, nl = Math.hypot(1, nz);
        var nx3 = mx / ml / nl, ny3 = my / ml / nl, nz3 = nz / nl;
        faces.push({ p: [e0, e1, apx], v: nx3 * vx + ny3 * vy + nz3 * vz,
                     l: Math.max(0, -0.45 * nx3 - 0.55 * ny3 + 0.7 * nz3) });
      }
    }
    faces.sort(function (p1, p2) { return p1.v - p2.v; });
    for (q = 0; q < faces.length; q++) {
      var fc = faces[q], front = fc.v > 0;
      g.fillStyle = col(mix(gemC7, mix(gemC, C.raised, 0.5), fc.l), front ? 0.88 : 0.45);
      poly([fc.p[0][0], fc.p[0][1], fc.p[0][2], fc.p[1][0], fc.p[1][1], fc.p[1][2], fc.p[2][0], fc.p[2][1], fc.p[2][2]]);
      g.fill();
      if (front) { g.strokeStyle = col(C.raised, 0.55); g.lineWidth = 0.7; g.stroke(); }
    }
    g.globalAlpha = 1;
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
                 schedule: schedule,
                 closure: closure,
                 link: link,
                 glass: glass,
                 aether: aether,
                 grant: grant };

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
      /* One figure that throws must not blank the page. Without this guard a
         single renderer failing stopped the loop before the reveal, and every
         figure on work.html stayed clipped out of sight. The failing figure is
         logged once and left empty; the rest keep drawing. */
      try { f.fn(ctx, f.vb, local, f.st); }
      catch (e) {
        if (!f.failed && window.console) console.error('figure ' + f.c.getAttribute('data-fig') + ' failed', e);
        f.failed = true;
      }
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
