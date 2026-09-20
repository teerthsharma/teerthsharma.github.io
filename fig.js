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
    var r = c.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    if (c._w === w && c._h === h && c._dpr === DPR) return false;
    c._w = w; c._h = h; c._dpr = DPR;
    c.width = Math.round(w * DPR);
    c.height = Math.round(h * DPR);
    var s = (w / vbw) * DPR;
    c.getContext('2d').setTransform(s, 0, 0, s, 0, 0);
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
    var a = REDUCED ? 0 : Math.sin(t / 5200) * 0.085;
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
    g.strokeStyle = rgba(coral, 0.018);
    g.lineWidth = 1.0;
    for (var j = 0; j < N; j++) {
      var bb = (-0.965 + 1.93 * j / (N - 1)) * R;
      var kk = Math.sqrt(Math.max(R * R - bb * bb, 1e-9));
      var px = CX + bb * pxv + kk * dx, py = CY + bb * pyv + kk * dy;
      var nx = -(px - CX) / R, ny = -(py - CY) / R;
      var dn = dx * nx + dy * ny;
      var rx = dx - 2 * dn * nx, ry = dy - 2 * dn * ny;
      var tt = -2 * ((px - CX) * rx + (py - CY) * ry);
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

    /* A wave crosses the field rather than every cell blinking together.
       A thousand marks flickering in unison reads as a fault; a slow tide
       reads as a quantity that is alive. */
    var phase = REDUCED ? 0 : t / 2600;
    for (var k = 0; k < shown; k++) {
      var r = (k / cols) | 0, c = k % cols;
      var x = BOX_X + c * pitch, y = BOX_Y + r * pitch;
      var w = REDUCED ? 1 : 0.62 + 0.38 * Math.sin(phase * Math.PI * 2 - (c + r) * 0.22);
      g.fillStyle = rgba(coral, 0.30 + 0.55 * w);
      g.fillRect(x, y, size, size);
    }

    g.fillStyle = rgba(blue, 1);
    g.fillRect(20, 44, size, size);
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

  var RENDER = { caustic: caustic, units: units, funnel: funnel, transport: transport };

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

  function paint(t, all) {
    for (var i = 0; i < live.length; i++) {
      var f = live[i];
      if (!all && !onScreen(f.c)) continue;
      fit(f.c, f.vb[0], f.vb[1]);
      f.fn(f.c.getContext('2d'), f.vb, t, f.st);
    }
  }

  function frame(t) {
    ticked = true;
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
      setInterval(function () { t0 += 50; paint(t0, false); }, 50);
    }, 1200);
  }

  /* The slider owns the count; this only owns the drawing. site.js sets
     shown and calls redraw, so the one interactive control on the site keeps
     the behaviour it already had. */
  window.FIG = {
    set: function (name, key, value) {
      for (var i = 0; i < live.length; i++) {
        if (live[i].c.getAttribute('data-fig') === name) live[i].st[key] = value;
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
