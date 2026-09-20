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
  /* A caustic is the bright curve light makes where distinct rays crowd onto
     one place, and that is exactly the claim the project makes about a model
     that cannot reach a fact. So this is not a picture of the idea, it is the
     thing itself: every ray is reflected off the inside of a circular wall by
     the actual law of reflection, and the cusp appears because they genuinely
     cross there. Nobody draws the cusp. It arrives.

     The blending is ordinary alpha, and that choice is load bearing. Adding
     light to a white ground produces nothing, so lighter is useless here.
     Multiply looks right until it is measured: repeated multiply converges on
     black, and the cusp came out at 78 of 765 on the first render, which is
     darker than anything allowed on this page. Repeated alpha converges on the
     stroke colour instead and can never go past it, so a hundred overlapping
     rays saturate to solid coral and no further. The density lands exactly on
     the crossings and the page keeps its palette. */
  function caustic(g, vb, t) {
    var CX = 236, CY = 232, R = 150;
    var N = 620;
    var coral = token('--coral-500', '#d9376e');
    var mint = token('--mint-500', '#0b93ab');
    var hair = token('--hair2', '#cfcbc1');

    /* The whole bundle tilts very slowly. The cusp is a function of the
       incoming angle, so tilting it makes the bright curve breathe and
       re-form, which is the figure performing its own mechanism rather
       than a decoration laid over it. */
    var a = REDUCED ? 0 : Math.sin(t / 6400) * 0.26;
    var band = REDUCED ? -9 : ((t % 6400) / 6400) * 2.4 - 1.2;
    var dx = Math.cos(a), dy = Math.sin(a);
    var pxv = -dy, pyv = dx;

    g.clearRect(0, 0, vb[0], vb[1]);

    g.globalCompositeOperation = 'source-over';
    g.lineWidth = 1.4;
    g.strokeStyle = rgba(hair, 0.9);
    g.beginPath();
    g.arc(CX, CY, R, 0, Math.PI * 2);
    g.stroke();

    /* Incoming rays are drawn only up to the wall, never across the inside.
       Physically they do cross it, but drawn that way they filled the whole
       interior and the cusp stopped standing out: measured, the crowded region
       came back at a mean of 343 against 335 for an empty one, which is no
       difference at all. The interior belongs to the reflected bundle alone,
       so the only dense structure in it is the one the rays actually make. */
    g.strokeStyle = rgba(mint, 0.28);
    g.lineWidth = 0.9;
    g.beginPath();
    for (var i = 0; i < N; i += 4) {
      var b = (-0.965 + 1.93 * i / (N - 1)) * R;
      var k = Math.sqrt(Math.max(R * R - b * b, 1e-9));
      var ex = CX + b * pxv - k * dx, ey = CY + b * pyv - k * dy;
      g.moveTo(ex - dx * 150, ey - dy * 150);
      g.lineTo(ex, ey);
    }
    g.stroke();

    /* Reflected: the same rays, now crowding. Each one is stroked on its own,
       and that is the difference between this figure working and not working.

       Built as one path with 620 subpaths and a single stroke, canvas paints
       the union once, so crossings do not accumulate any opacity and every
       part of the interior comes out the same weight. Measured that way the
       crowded region read 383 against 384 for an empty one, which is nothing,
       and the caustic was invisible although the geometry was right: counting
       the chords numerically, 172 of them pass within two units of the cusp
       against a median of 10 elsewhere. Stroking each ray separately lets that
       seventeen to one concentration actually land on the pixels.

       The opacity is then set from that ratio rather than by eye. Saturation
       after n overlapping strokes is 1-(1-a)^n, so at the 0.085 that looked
       right, ten rays already reach 0.58 and the cusp's 172 reach 1.00: both
       the empty interior and the bright curve paint solid coral and the whole
       measurement is clipped away, which is exactly what the pixels showed.
       At 0.018 ten rays sit at 0.17 and 172 reach 0.96, so the sparse field
       stays pale and only the crowding goes solid. */
    g.lineWidth = 1.0;
    for (var j = 0; j < N; j++) {
      var bb = (-0.965 + 1.93 * j / (N - 1)) * R;
      var kk = Math.sqrt(Math.max(R * R - bb * bb, 1e-9));
      var px = CX + bb * pxv + kk * dx, py = CY + bb * pyv + kk * dy;
      var nx = -(px - CX) / R, ny = -(py - CY) / R;
      var dn = dx * nx + dy * ny;
      var rx = dx - 2 * dn * nx, ry = dy - 2 * dn * ny;
      var tt = -2 * ((px - CX) * rx + (py - CY) * ry);
      /* a band of brighter rays travels across the bundle, so light is seen
         moving through it instead of the whole figure fading together */
      var f = bb / R - band;
      g.strokeStyle = rgba(coral, 0.018 + 0.055 * Math.exp(-f * f * 11));
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + tt * rx, py + tt * ry);
      g.stroke();
    }

    /* the wall itself, drawn last so it reads as the surface */
    g.strokeStyle = rgba(token('--ink', '#1c1b19'), 0.92);
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(CX, CY, R, -Math.PI / 2 + a, Math.PI / 2 + a);
    g.stroke();
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
      var w = REDUCED ? 1 : 0.82 + 0.18 * Math.sin(phase * Math.PI * 2 - dist * 5.2);
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
  /* The previous drawing was a circle with four triangles on it, and nothing
     in it ever came back changed, which is the only thing monodromy is about.
     Carry a frame all the way round a closed loop and it returns pointing
     somewhere else. The angle it fails to close by is the whole subject, and
     it is visible without a derivative being computed anywhere, which is the
     claim the project makes.

     So the loop is drawn with the frame stamped at forty stations, turning as
     it goes, and at the start the frame it set out with is drawn beside the
     frame it came back with. The gap between those two is the measurement. */
  function transport(g, vb, t) {
    var CX = 235, CY = 236, R = 132;
    var STATIONS = 40;
    var TWIST = Math.PI * 0.62;          /* what the loop fails to close by */
    var mint = token('--mint-500', '#0b93ab');
    var mint7 = token('--mint-700', '#0a6b7c');
    var ink = token('--ink', '#1c1b19');
    var hair = token('--hair2', '#cfcbc1');

    function at(th) {
      var rr = R * (1 + 0.15 * Math.sin(3 * th));
      return [CX + rr * Math.cos(th), CY + rr * Math.sin(th)];
    }
    function frame(x, y, ang, col, w, len) {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.moveTo(x, y); g.lineTo(x + Math.cos(ang + Math.PI / 2) * len * 0.62,
                               y + Math.sin(ang + Math.PI / 2) * len * 0.62);
      g.stroke();
    }

    g.clearRect(0, 0, vb[0], vb[1]);

    g.strokeStyle = rgba(hair, 1); g.lineWidth = 2; g.beginPath();
    for (var s = 0; s <= 240; s++) {
      var p = at(s / 240 * Math.PI * 2);
      if (s === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.closePath(); g.stroke();

    for (var i = 0; i < STATIONS; i++) {
      var f = i / STATIONS, th = f * Math.PI * 2, q = at(th);
      frame(q[0], q[1], th + TWIST * f, rgba(mint, 0.30 + 0.35 * f), 2, 17);
    }

    /* the one that is travelling now, so the turning is watched and not
       merely inferred from a row of stamps */
    var cyc = REDUCED ? 0.999 : (t % 7600) / 7600;
    var tp = at(cyc * Math.PI * 2);
    frame(tp[0], tp[1], cyc * Math.PI * 2 + TWIST * cyc, rgba(mint7, 1), 3.4, 24);
    g.fillStyle = rgba(mint7, 1);
    g.beginPath(); g.arc(tp[0], tp[1], 5, 0, Math.PI * 2); g.fill();

    /* set out with, and came back with */
    var st = at(0);
    frame(st[0], st[1], 0, rgba(ink, 0.85), 3.4, 30);
    frame(st[0], st[1], TWIST, rgba(mint7, 0.95), 3.4, 30);
    g.strokeStyle = rgba(mint7, 0.5); g.lineWidth = 2;
    g.setLineDash([4, 4]);
    g.beginPath(); g.arc(st[0], st[1], 44, 0, TWIST); g.stroke();
    g.setLineDash([]);
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

      /* an arrival sweeps the grid; the box it reaches lights up and still
         holds exactly one when it has passed */
      var reach = ((cyc * (COLS * ROWS) * 1.0) | 0) === i;
      g.beginPath();
      g.arc(bx + BW / 2, by + BH / 2, reach && !REDUCED ? 8.4 : 6.2, 0, Math.PI * 2);
      g.fillStyle = reach && !REDUCED ? rgba(coral7, 1) : rgba(coral, 0.85);
      g.fill();
    }

    /* right: one profile, and the same observations land on each other */
    var RX = 292, RY = 130, RW = 140, RH = ROWS * (BH + GAP) - GAP;
    g.strokeStyle = rgba(violet, 0.95); g.lineWidth = 2.2;
    g.fillStyle = rgba(violet, 0.06);
    g.fillRect(RX, RY, RW, RH);
    g.strokeRect(RX, RY, RW, RH);

    var filled = REDUCED ? 24 : Math.min(24, Math.floor((Math.min(cyc, 0.42) / 0.42) * 24 + 0.001));
    for (var j = 0; j < filled; j++) {
      var cc = j % 4, rr = (j / 4) | 0;
      var dx = RX + 26 + cc * 30, dy = RY + RH - 24 - rr * 27;
      g.beginPath();
      g.arc(dx, dy, 8.6, 0, Math.PI * 2);
      g.fillStyle = rgba(violet7, 0.94);
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
          var w = 0.86 + 0.14 * Math.sin(cyc * Math.PI * 2 - (r * 0.18));
          a = 0.62 + 0.38 * w;
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
    var drift = REDUCED ? 0 : Math.sin(t / 4200) * 9;

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
      var gap = (1 - i / ROWS) * 46 - 10 + (u - 0.5) * 14;
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

  var RENDER = { caustic: caustic, units: units, funnel: funnel,
                 transport: transport, collapse: collapse,
                 witness: witness, gather: gather,
                 refuse: refuse, cut: cut, certify: certify };

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

  function paint(t, all) {
    for (var i = 0; i < live.length; i++) {
      var f = live[i];
      if (!all && !onScreen(f.c)) continue;
      fit(f.c, f.vb[0], f.vb[1]);
      var ctx = f.c.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, f.c.width, f.c.height);
      ctx.restore();
      f.fn(ctx, f.vb, t, f.st);
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
        f.fn(ctx, f.vb, lastT, f.st);
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
