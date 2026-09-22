/*
 * site.js — teerthsharma.github.io
 * One IIFE, four behaviours, no imports, no external requests, no eval.
 * Every function guards its own DOM lookups so this file is safe to include
 * on both index.html and work.html unchanged.
 *
 * DOM contract for initScaleSlider (pr-mujoco-3396 card):
 *   .slider__input          <input type="range" min="64" max="4096" value="4096">
 *   .slider__out[data-metric="before"|"after"]   the two readouts
 *   .card__art svg[data-ymin][data-ymax][data-px0][data-py0][data-px1][data-py1]
 *     [data-marker="before"|"after"]             the two plotted points (cx/cy)
 *   ymin/ymax are the log-scale byte domain; px0/py0..px1/py1 is the plot
 *   rectangle in the SVG's own viewBox units. The x domain is the slider's
 *   own min/max, so the slider and the chart can never disagree on ntree.
 *
 * DOM contract for initFilter (work.html):
 *   .filter[data-filter="all"|"python"|"rust"|"doi"]   real <button> elements
 *   .proj[data-lang="Python"|"Rust"][data-doi="true"|"false"]
 */
(function () {
  'use strict';

  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initScaleSlider() {
    var input = document.querySelector('.slider__input');
    if (!input) return;

    var card = input.closest('.card');
    if (!card) return;

    var outs = card.querySelectorAll('.slider__out');
    if (!outs.length) return;

    var svg = card.querySelector('.card__art svg') || card.querySelector('svg');

    var xMin = Number(input.min) || 64;
    var xMax = Number(input.max) || 4096;

    var yMin, yMax, px0, py0, px1, py1, canPlot = false;
    var markerBefore = null;
    var markerAfter = null;

    if (svg) {
      yMin = parseFloat(svg.getAttribute('data-ymin'));
      yMax = parseFloat(svg.getAttribute('data-ymax'));
      px0 = parseFloat(svg.getAttribute('data-px0'));
      py0 = parseFloat(svg.getAttribute('data-py0'));
      px1 = parseFloat(svg.getAttribute('data-px1'));
      py1 = parseFloat(svg.getAttribute('data-py1'));
      canPlot = [yMin, yMax, px0, py0, px1, py1].every(function (n) { return !isNaN(n); });
      markerBefore = svg.querySelector('[data-marker="before"]');
      markerAfter = svg.querySelector('[data-marker="after"]');
    }

    function xPos(n) {
      /* The axis is logarithmic: 64, 256, 1,024 and 4,096 are drawn evenly
         spaced. Interpolating linearly in n put ntree = 256 at x = 77.6
         when the drawn tick is at 183.33. */
      if (svg && svg.getAttribute('data-xlog') === '1') {
        var l0 = Math.log(xMin), l1 = Math.log(xMax);
        return px0 + ((Math.log(n) - l0) / (l1 - l0)) * (px1 - px0);
      }
      return px0 + ((n - xMin) / (xMax - xMin)) * (px1 - px0);
    }
    function yPos(v) {
      var lo = Math.log10(yMin), hi = Math.log10(yMax);
      return py1 - ((Math.log10(v) - lo) / (hi - lo)) * (py1 - py0);
    }

    var units = svg ? svg.querySelectorAll('.unit') : [];
    var outRatio = svg ? svg.querySelector('[data-out="ratio"]') : null;
    var outBefore = svg ? svg.querySelector('[data-out="before"]') : null;
    var outAfter = svg ? svg.querySelector('[data-out="after"]') : null;

    var units = svg ? svg.querySelectorAll('.unit') : [];
    var unitRef = svg ? svg.querySelector('#unit-ref') : null;
    var outRatio = svg ? svg.querySelector('[data-out="ratio"]') : null;
    var outBefore = svg ? svg.querySelector('[data-out="before"]') : null;
    var outAfter = svg ? svg.querySelector('[data-out="after"]') : null;

    /* The block is laid out square rather than across a fixed column count.
       Row-major across 47 columns drew 22 units as one partial row, which
       reads as a dashed line and not as a quantity. */
    var BOX_X = 300, BOX_Y = 40, BOX_W = 300, BOX_H = 270;

    function update() {
      var n = Number(input.value);
      var before = 5 * n * n + 36 * n + 32;
      var after = 16 * n + 32;
      var fmt = function (v) { return v.toLocaleString('en-US'); };
      var shown = Math.ceil(before / after);
      /* The field is canvas now; the count is still computed here. */
      if (window.FIG) window.FIG.set('units', 'shown', shown);

      var cols = Math.ceil(Math.sqrt(shown));
      var rows = Math.ceil(shown / cols);
      /* One size for the units and the reference both. They must match
         exactly: one square is one allocation of the new path, and drawing
         the reference larger merely to make it visible would make the
         picture untrue. */
      var pitch = Math.min(BOX_W / cols, BOX_H / rows);
      var size = Math.max(2, pitch * 0.82);

      for (var k = 0; k < units.length; k++) {
        if (k >= shown) { units[k].style.display = 'none'; continue; }
        units[k].style.display = '';
        var r = Math.floor(k / cols), c = k % cols;
        units[k].setAttribute('x', (BOX_X + c * pitch).toFixed(2));
        units[k].setAttribute('y', (BOX_Y + r * pitch).toFixed(2));
        units[k].setAttribute('width', size.toFixed(2));
        units[k].setAttribute('height', size.toFixed(2));
      }
      if (unitRef) {
        unitRef.setAttribute('width', size.toFixed(2));
        unitRef.setAttribute('height', size.toFixed(2));
      }

      if (outRatio) outRatio.textContent = fmt(shown);
      if (outBefore) outBefore.textContent = fmt(before) + ' B';
      if (outAfter) outAfter.textContent = fmt(after) + ' B';

      outs.forEach(function (out) {
        var metric = out.getAttribute('data-metric');
        if (metric === 'before') out.textContent = fmt(before);
        else if (metric === 'after') out.textContent = fmt(after);
        else out.textContent = 'ntree = ' + fmt(n) + ', scratch ' + fmt(before) + ' B to ' + fmt(after) + ' B';
      });
    }

    input.addEventListener('input', update);
    update();
  }

  function initFilter() {
    var buttons = document.querySelectorAll('.filter');
    var cards = document.querySelectorAll('.proj');
    if (!buttons.length || !cards.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var filter = (btn.getAttribute('data-filter') || 'all').toLowerCase();

        buttons.forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });

        cards.forEach(function (card) {
          var lang = (card.getAttribute('data-lang') || '').toLowerCase();
          var doi = card.getAttribute('data-doi') === 'true';
          var show = filter === 'all' || filter === lang || (filter === 'doi' && doi);
          card.classList.toggle('is-hidden', !show);
        });
      });
    });
  }

  function initReveal() {
    var els = document.querySelectorAll('.card, .proj');
    if (!els.length) return;

    if (reduceMotion) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var order = Array.prototype.slice.call(els);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        var idx = order.indexOf(entry.target);
        var delay = idx < 0 ? 0 : idx * 40;
        setTimeout(function () {
          entry.target.classList.add('is-in');
        }, delay);
      });
    }, { threshold: 0.2 });

    order.forEach(function (el) { io.observe(el); });
  }

  /*
   * initArt — the SVG animation contract (draw / pop / wipe / pulse).
   *   .draw   stroked path|line|polyline|polygon — draws itself on via
   *           getTotalLength()/strokeDasharray, left to right.
   *   .pop    circle|rect|ellipse|text — scales up from ~0.7 and fades in,
   *           staggered against its DOM siblings.
   *   .wipe   a <g> with many children — reveals left to right behind a
   *           clip-path edge (percentages resolve against the element's own
   *           fill-box, so no bbox measurement is needed).
   *   .pulse  circle — pulses gently twice, once its entrance finishes.
   * One IntersectionObserver (threshold .25) watches every <svg> that has
   * at least one of these classes; each svg plays once and is unobserved.
   * Never sets an inline style on more than ART_MAX_STYLED elements in one
   * svg — above that, the offending .draw/.pop elements are skipped and
   * their nearest ancestor group (a direct child of the svg) gets the wipe
   * treatment instead, so a 1,000-circle diagram costs one clip-path.
   */
  function initArt() {
    var svgs = Array.prototype.slice.call(document.querySelectorAll('svg')).filter(function (svg) {
      return svg.querySelector('.draw, .pop, .wipe, .pulse');
    });
    if (!svgs.length || reduceMotion) return;

    var ART_POP_DURATION = 480;
    var ART_POP_STAGGER = 30;
    var ART_POP_STAGGER_CAP = 600;
    var ART_DRAW_DURATION = 900;
    var ART_WIPE_DURATION = 700;
    var ART_MAX_STYLED = 80;

    function uniq(list) {
      var out = [];
      list.forEach(function (el) { if (out.indexOf(el) === -1) out.push(el); });
      return out;
    }

    function groupByParent(list) {
      var groups = [];
      list.forEach(function (el) {
        var g = null;
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].parent === el.parentNode) { g = groups[i]; break; }
        }
        if (!g) { g = { parent: el.parentNode, items: [] }; groups.push(g); }
        g.items.push(el);
      });
      return groups;
    }

    function topGroups(list, svg) {
      return uniq(list.map(function (el) {
        var node = el;
        while (node.parentNode && node.parentNode !== svg) node = node.parentNode;
        return node;
      }));
    }

    function playDraw(el) {
      var len;
      try { len = el.getTotalLength(); } catch (e) { return; }
      if (!len) return;
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      el.getBoundingClientRect(); // force reflow so the next change transitions
      el.style.transition = 'stroke-dashoffset ' + ART_DRAW_DURATION + 'ms var(--hover-ease)';
      el.style.strokeDashoffset = '0';
    }

    function playPop(el, delay) {
      el.style.opacity = '0';
      el.style.transform = 'scale(.7)';
      el.getBoundingClientRect();
      var t = ART_POP_DURATION + 'ms var(--hover-ease) ' + delay + 'ms';
      el.style.transition = 'opacity ' + t + ', transform ' + t;
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
    }

    function playWipe(el) {
      el.style.clipPath = 'inset(0 100% 0 0)';
      el.getBoundingClientRect();
      el.style.transition = 'clip-path ' + ART_WIPE_DURATION + 'ms var(--hover-ease)';
      el.style.clipPath = 'inset(0 0% 0 0)';
    }

    function playPulse(el, delay) {
      el.style.setProperty('--pulse-delay', delay + 'ms');
      el.classList.add('is-pulsing');
    }

    function playSvg(svg) {
      var drawEls = Array.prototype.slice.call(svg.querySelectorAll('.draw'));
      var popEls = Array.prototype.slice.call(svg.querySelectorAll('.pop'));
      var wipeEls = Array.prototype.slice.call(svg.querySelectorAll('.wipe'));
      var pulseEls = Array.prototype.slice.call(svg.querySelectorAll('.pulse'));
      var styled = uniq(drawEls.concat(popEls));

      if (styled.length > ART_MAX_STYLED) {
        uniq(topGroups(styled, svg).concat(wipeEls)).forEach(playWipe);
        return;
      }

      drawEls.forEach(playDraw);

      groupByParent(popEls).forEach(function (group) {
        group.items.forEach(function (el, i) {
          var delay = Math.min(i * ART_POP_STAGGER, ART_POP_STAGGER_CAP);
          playPop(el, delay);
          if (pulseEls.indexOf(el) !== -1) playPulse(el, delay + ART_POP_DURATION);
        });
      });

      wipeEls.forEach(playWipe);

      pulseEls.forEach(function (el) {
        if (popEls.indexOf(el) === -1) playPulse(el, 0);
      });
    }

    /* IntersectionObserver does not reliably fire on inline <svg> nodes: an SVG
       element is not a standard HTML box in every engine, and observing one
       yields no entry even when it is centred in the viewport. Observe the
       nearest HTML ancestor instead and play the SVG it wraps. */
    var pairs = svgs.map(function (svg) {
      var host = svg.parentNode;
      while (host && host.nodeType === 1 && !(host instanceof HTMLElement)) host = host.parentNode;
      return { host: host || svg, svg: svg };
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        pairs.forEach(function (p) { if (p.host === entry.target) playSvg(p.svg); });
      });
    }, { threshold: 0.2 });

    pairs.forEach(function (p) { io.observe(p.host); });

    /* Anything already on screen at load gets played straight away, because an
       observer only reports a change and the first screen never changes. */
    requestAnimationFrame(function () {
      pairs.forEach(function (p) {
        var r = p.host.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) { io.unobserve(p.host); playSvg(p.svg); }
      });
    });
  }

  /*
   * initMosaic — the moving mosaic that replaces the number strip.
   * A fixed population of blocks lives on one canvas and is never still.
   * Each achievement's SHAPE is a set of cells on a 40 x 10 grid. On a
   * switch every block travels on a damped spring from wherever it is to a
   * cell of the next shape, departures sweeping left to right so the new
   * shape assembles as a wave. Blocks the shape does not need drift, small
   * and faint, in a calm swarm around the grid until a later shape recruits
   * them. While a shape holds, a slow wave runs through it. Positions are in
   * cell units, so a resize rescales the picture without disturbing motion.
   * The canvas draws no words; the readout is the accessible content.
   * DOM contract (index.html owns the markup, this only fills it in):
   *   section.mosaic > .wrap.mosaic__inner
   *     .mosaic__grid#mosaic-grid            gets one aria-hidden <canvas>
   *     .mosaic__read > .mosaic__org #mosaic-org, .mosaic__num #mosaic-num,
   *                     .mosaic__label #mosaic-label, .mosaic__sub #mosaic-sub
   * No-op if #mosaic-grid is absent (work.html has none of this markup).
   */
  function initMosaic() {
    var grid = document.getElementById('mosaic-grid');
    if (!grid) return;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    canvas.setAttribute('aria-hidden', 'true');
    grid.appendChild(canvas);

    var COLS = 40, ROWS = 10;
    var MX = 1, MY = 2;               // swarm room around the grid, in cells
    var CYCLE = 6;                    // seconds per achievement
    var SWEEP = 1.2;                  // departures sweep left to right over this
    var OMEGA = 3.6, ZETA = 0.78;     // spring: settles in ~1.4s, ~2% overshoot
    var WAVE_T = 2.8, WAVE_K = 0.28;  // hold wave: period (s), phase per column
    var WAVE_A = reduceMotion ? 0 : 0.12, WAVE_S = reduceMotion ? 0 : 0.08;
    var SWARM_SIZE = 0.42, SWARM_ALPHA = 0.3;

    var ACHIEVEMENTS = [
      { org: 'google-deepmind/mujoco #3396', num: '1,281.6x', label: 'less scratch memory', sub: 'island discovery, ntree 4,096', shape: 'quadratic' },
      { org: 'google-deepmind/mujoco_warp #1541', num: '1.513x', label: 'faster island discovery', sub: '2,048 worlds, 247,308 active EFC rows', shape: 'twobars' },
      { org: 'google-deepmind/mujoco #3450', num: '15,361x', label: 'fewer probes', sub: 'convex hull graph construction, V 40,962', shape: 'nested' },
      { org: 'google/highway #3244', num: '65.5x', label: 'fewer comparisons', sub: 'one million keys', shape: 'densesparse' },
      { org: 'google/XNNPACK #10801', num: '6.42%', label: 'lower peak memory', sub: 'MobileNet V1, 23.862980 to 22.331730 MiB', shape: 'arena' },
      { org: 'tensorflow/tensorflow #124410', num: '4 to 3', label: 'control edges, correctly', sub: 'transitive reduction of collective control edges', shape: 'chain' },
      { org: 'NVIDIA/NeMo-Relay #481', num: '23 files', label: 'one scaffold, not one profile per task', sub: 'learning key no longer fragments', shape: 'collapse' },
      { org: 'triton-lang/kernels #22', num: '804 lines', label: 'a sparse attention kernel, merged', sub: 'topology derived block schedule, 17 tests passing', shape: 'triangle' },
      { org: 'openxla/xla #46539', num: '5 lines', label: 'deterministic GPU codegen', sub: 'the same program stopped compiling two ways', shape: 'fork' },
      { org: 'dsx-ai-factory/topograph #432', num: '4 files', label: 'permissions gated to what applies', sub: 'cluster wide RBAC narrowed by engine and provider', shape: 'gate' },
      { org: 'facebook/pyrefly #4180', num: '208 SCCs', label: 'a regression pinned so it cannot return', sub: 'capped recheck propagation, caught in one Rust test', shape: 'chainlong' }
    ];

    var CHAIN_NODES = [4, 14, 24, 34];
    var COLLAPSE_COLS = [1, 6, 11, 16];
    var COLLAPSE_ROWS = [1, 6];
    var CHAINLONG_COLS = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38];

    var SHAPES = {
      quadratic: function (col, row) {
        return row >= 10 - Math.round(10 * Math.pow(col / 39, 2));
      },
      twobars: function (col, row) {
        if (row === 2 || row === 3) return true;
        return (row === 6 || row === 7) && col < Math.floor(40 * 0.66);
      },
      nested: function (col, row) {
        return (col < 10 && row < 10) || (col === 39 && row === 4);
      },
      densesparse: function (col, row) {
        if (col <= 15) return true;
        return col >= 24 && (col + row) % 5 === 0;
      },
      arena: function (col, row) {
        return (row === 3 && col <= 33) || (row === 6 && col <= 26);
      },
      chain: function (col, row) {
        for (var i = 0; i < CHAIN_NODES.length; i++) {
          var s = CHAIN_NODES[i];
          if ((row === 4 || row === 5) && col >= s && col <= s + 1) return true;
        }
        if (row === 4) {
          for (var j = 0; j < CHAIN_NODES.length - 1; j++) {
            if (col >= CHAIN_NODES[j] + 2 && col <= CHAIN_NODES[j + 1] - 1) return true;
          }
        }
        return false;
      },
      collapse: function (col, row) {
        for (var i = 0; i < COLLAPSE_COLS.length; i++) {
          for (var j = 0; j < COLLAPSE_ROWS.length; j++) {
            var cs = COLLAPSE_COLS[i], rs = COLLAPSE_ROWS[j];
            if (col >= cs && col <= cs + 1 && row >= rs && row <= rs + 1) return true;
          }
        }
        return col >= 30 && col <= 33 && row >= 3 && row <= 6;
      },
      triangle: function (col, row) {
        return col < 20 && row <= Math.floor(col / 2);
      },
      // fork: one lit line (cols 0-9), splitting into two branches that
      // diverge to a peak separation at col 17 then converge back to a
      // single line by col 24, straight again for cols 25-39.
      fork: function (col, row) {
        if (col < 10) return row === 4;
        if (col <= 24) {
          var dist = Math.abs(col - 17);
          var offset = 3 - Math.round(dist * 3 / 7);
          return row === 4 - offset || row === 4 + offset;
        }
        return row === 4;
      },
      // gate: a full-height block (cols 0-9) funnels down through cols
      // 10-29 to a third of its width, held for cols 30-39.
      gate: function (col, row) {
        if (col < 10) return true;
        if (col <= 29) {
          var t = (col - 10) / 19;
          var n = Math.round(10 - 7 * t);
          var rowStart = Math.max(0, 4 - Math.floor((n - 1) / 2));
          var rowEnd = Math.min(9, rowStart + n - 1);
          return row >= rowStart && row <= rowEnd;
        }
        return row >= 3 && row <= 5;
      },
      // chainlong: a single-column serpentine, each of 10 evenly spaced
      // columns lit top to bottom, joined at alternating top/bottom rows.
      chainlong: function (col, row) {
        for (var i = 0; i < CHAINLONG_COLS.length; i++) {
          if (col === CHAINLONG_COLS[i]) return true;
        }
        for (var j = 0; j < CHAINLONG_COLS.length - 1; j++) {
          var turnRow = (j % 2 === 0) ? 9 : 0;
          if (row === turnRow && col > CHAINLONG_COLS[j] && col < CHAINLONG_COLS[j + 1]) return true;
        }
        return false;
      }
    };
    // "the odd accent cell" — nested's single lit cell far right.
    var ACCENT = {
      nested: function (col, row) { return col === 39 && row === 4; }
    };

    var orgEl = document.getElementById('mosaic-org');
    var numEl = document.getElementById('mosaic-num');
    var labelEl = document.getElementById('mosaic-label');
    var subEl = document.getElementById('mosaic-sub');
    var readEl = grid.parentNode.querySelector('.mosaic__read');

    function litMap(shapeName) {
      var fn = SHAPES[shapeName];
      var accentFn = ACCENT[shapeName];
      var map = {};
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          if (fn(c, r)) map[r * COLS + c] = accentFn ? accentFn(c, r) : false;
        }
      }
      return map;
    }

    function renderText(a) {
      if (orgEl) orgEl.textContent = a.org;
      if (numEl) numEl.textContent = a.num;
      if (labelEl) labelEl.textContent = a.label;
      if (subEl) subEl.textContent = a.sub;
    }

    var css = getComputedStyle(document.documentElement);
    function tok(name) {
      var h = (css.getPropertyValue(name).trim() || '#2456dc').slice(1);
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      var n = parseInt(h, 16);
      return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }
    // Formed blocks are --blue-500 (the accent cell --blue-700); the swarm
    // is a faint mix that turns blue as each block is recruited.
    var BLUE = tok('--blue-500'), DEEP = tok('--blue-700');
    var TINTS = [BLUE, BLUE, tok('--violet-500'), tok('--mint-500')];

    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    var most = 0;
    ACHIEVEMENTS.forEach(function (a) { most = Math.max(most, Object.keys(litMap(a.shape)).length); });
    var blocks = [];
    for (var i = 0; i < most + 40; i++) {
      var hx = rand(0, COLS), hy = rand(-1.2, ROWS + 1.2);
      blocks.push({
        x: hx, y: hy, vx: 0, vy: 0, f: 0,       // f: 0 swarm .. 1 formed
        cell: -1, acc: false, next: null, nacc: false, at: 0,
        hx: hx, hy: hy, gx: hx, gy: hy, tint: TINTS[i % TINTS.length], rot: rand(-0.6, 0.6),
        w1: 2 * Math.PI / rand(9, 16), w2: 2 * Math.PI / rand(6, 11),
        p1: rand(0, 6.3), p2: rand(0, 6.3), p3: rand(0, 6.3)
      });
    }

    var clock = 0, switchedAt = 0, currentIdx = 0;

    // Where block b is heading at this instant, written into tgt.
    var tgt = { x: 0, y: 0 };
    function aim(b) {
      if (b.cell >= 0) {
        var c = b.cell % COLS;
        tgt.x = c + 0.5;
        tgt.y = (b.cell - c) / COLS + 0.5 + WAVE_A * Math.sin(clock * 2 * Math.PI / WAVE_T - c * WAVE_K);
      } else {
        tgt.x = clamp(b.hx + 1.8 * Math.sin(clock * b.w1 + b.p1) + 0.5 * Math.sin(clock * b.w2 * 1.7 + b.p2), -0.4, COLS + 0.4);
        tgt.y = clamp(b.hy + 0.6 * Math.sin(clock * b.w2 + b.p3) + 0.25 * Math.sin(clock * b.w1 * 1.9 + b.p1), 0.6 - MY, ROWS + MY - 0.6);
      }
    }

    function depart(b) {
      b.cell = b.next; b.acc = b.nacc; b.next = null;
      // A released block joins the swarm where it is, then roams slowly to a
      // random spot, so the swarm evens out instead of piling up where shapes were.
      if (b.cell < 0) { b.hx = b.x; b.hy = b.y; b.gx = rand(0, COLS); b.gy = rand(-1.2, ROWS + 1.2); }
    }
    function flush() { blocks.forEach(function (b) { if (b.next !== null) depart(b); }); }

    /* Every cell of the next shape gets a block. A block already on one of
       its cells stays put. The other cells are handed out left to right, each
       taking the nearest block still free, with blocks of the old shape
       preferred over swarm blocks (the +2 cells) so the old shape visibly
       flows into the new one. A block leaves when the sweep reaches its
       target column, so the shape assembles as a wave from the left, and
       leftovers rejoin the swarm on the same sweep. */
    function applyShape(idx, animate) {
      var a = ACHIEVEMENTS[idx], map = litMap(a.shape), kept = {}, pool = [];
      function send(b, cell, acc, delay) {
        b.next = cell; b.nacc = acc; b.at = clock + (animate ? delay + rand(0, 0.12) : 0);
      }
      flush();
      blocks.forEach(function (b) {
        if (b.cell >= 0 && b.cell in map) { kept[b.cell] = 1; b.acc = map[b.cell]; }
        else pool.push(b);
      });
      Object.keys(map).map(Number).filter(function (k) { return !kept[k]; })
        .sort(function (p, q) { return p % COLS - q % COLS || p - q; })
        .forEach(function (k) {
          var c = k % COLS, r = (k - c) / COLS, best = 0, bestD = Infinity;
          for (var i = 0; i < pool.length; i++) {
            var b = pool[i];
            if (!b) continue;
            var dx = b.x - c - 0.5, dy = b.y - r - 0.5;
            var d = Math.sqrt(dx * dx + dy * dy) + (b.cell < 0 ? 2 : 0);
            if (d < bestD) { bestD = d; best = i; }
          }
          send(pool[best], k, map[k], SWEEP * c / (COLS - 1));
          pool[best] = null;
        });
      pool.forEach(function (b) {
        if (b && b.cell >= 0) send(b, -1, false, 0.8 * SWEEP * clamp(b.x / COLS, 0, 1));
      });

      if (animate && readEl) {
        readEl.classList.add('is-fading');
        setTimeout(function () {
          renderText(a);
          readEl.classList.remove('is-fading');
        }, 500);
      } else {
        renderText(a);
      }
    }

    // Damped spring toward aim(b), in 20ms substeps so a 50ms interval tick
    // stays as smooth and stable as a 16ms frame. Returns whether anything moves.
    function physics(dt) {
      var n = Math.ceil(dt / 0.02), h = dt / n, k = OMEGA * OMEGA, damp = 2 * ZETA * OMEGA;
      var ease = 1 - Math.exp(-dt / 0.35), roam = userPaused ? 0 : 1 - Math.exp(-dt / 5), moving = false;
      blocks.forEach(function (b) {
        if (b.next !== null && clock >= b.at) depart(b);
        if (b.cell < 0) { b.hx += (b.gx - b.hx) * roam; b.hy += (b.gy - b.hy) * roam; }
        aim(b);
        for (var s = 0; s < n; s++) {
          b.vx += (k * (tgt.x - b.x) - damp * b.vx) * h; b.x += b.vx * h;
          b.vy += (k * (tgt.y - b.y) - damp * b.vy) * h; b.y += b.vy * h;
        }
        var goal = b.cell >= 0 ? 1 : 0;
        b.f += (goal - b.f) * ease;
        if (Math.abs(b.vx) + Math.abs(b.vy) > 0.02 || Math.abs(tgt.x - b.x) + Math.abs(tgt.y - b.y) > 0.01 ||
            Math.abs(goal - b.f) > 0.01) moving = true;
      });
      return moving;
    }

    var pitch = 0, dpr = 1, lastW = 0, round = !!ctx.roundRect;
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!pitch) return;
      var u = pitch * dpr, full = u * 0.84, ph = clock * 2 * Math.PI / WAVE_T;
      // Swarm underneath, formed blocks on top.
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i], f = b.f;
          if ((f > 0.5) !== (pass === 1) || (reduceMotion && b.cell < 0)) continue;
          var t = b.tint, to = b.acc ? DEEP : BLUE;
          var s = full * (SWARM_SIZE + (1 - SWARM_SIZE) * f) *
                  (1 - WAVE_S * f * (0.5 - 0.5 * Math.sin(ph - b.x * WAVE_K)));
          var ang = (1 - f) * (b.rot + 0.35 * Math.sin(clock * b.w2 + b.p2)) + clamp(b.vx * 0.012, -0.35, 0.35);
          var cs = Math.cos(ang), sn = Math.sin(ang);
          ctx.globalAlpha = SWARM_ALPHA + (1 - SWARM_ALPHA) * f;
          ctx.fillStyle = 'rgb(' + Math.round(t[0] + (to[0] - t[0]) * f) + ',' +
            Math.round(t[1] + (to[1] - t[1]) * f) + ',' + Math.round(t[2] + (to[2] - t[2]) * f) + ')';
          ctx.setTransform(cs, sn, -sn, cs, (b.x + MX) * u, (b.y + MY) * u);
          if (round) { ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.14); ctx.fill(); }
          else ctx.fillRect(-s / 2, -s / 2, s, s);
        }
      }
    }

    // 40 x 10 cells plus the swarm margin, fitted to the container width.
    function resize() {
      var w = grid.clientWidth, r = Math.min(2, window.devicePixelRatio || 1);
      if (w && (w !== lastW || r !== dpr)) {
        lastW = w; dpr = r;
        pitch = w / (COLS + 2 * MX);
        var h = pitch * (ROWS + 2 * MY);
        canvas.style.height = h + 'px';
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      draw();
    }

    // First shape already formed, painted now, whatever the frame loop does later.
    applyShape(0, false);
    flush();
    blocks.forEach(function (b) {
      if (b.cell < 0) { b.hx = b.gx = rand(0, COLS); b.hy = b.gy = rand(-1.2, ROWS + 1.2); }   // swarm spread evenly
      aim(b); b.x = tgt.x; b.y = tgt.y; b.f = b.cell >= 0 ? 1 : 0;
    });
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(grid);
    window.addEventListener('resize', resize, {passive:true});
    if (reduceMotion) return; // first achievement formed and still, no cycling, no controls.

    var inView = false, userPaused = false, settled = false;
    var running = false, useInterval = false, rafSeen = false, rafId = 0, ivId = 0, dogId = 0, last = 0;

    function pickNext(exclude) {
      var choices = [];
      for (var i = 0; i < ACHIEVEMENTS.length; i++) { if (i !== exclude) choices.push(i); }
      return choices[Math.floor(Math.random() * choices.length)];
    }

    function step() {
      var now = performance.now(), dt = clamp((now - last) / 1000, 0, 0.1);
      last = now;
      if (!userPaused) {
        clock += dt;
        if (clock - switchedAt >= CYCLE) {
          switchedAt = clock;
          currentIdx = pickNext(currentIdx);
          applyShape(currentIdx, true);
        }
      }
      var moving = physics(dt);
      draw();
      // Paused: the clock stops, blocks settle where they are, then the loop stops.
      if (userPaused && !moving) { settled = true; stop(); }
    }

    /* requestAnimationFrame is not guaranteed to run (it never fired in the
       embedded preview this site is checked in). If no frame arrives within
       1.2s, a 50ms interval drives the same step instead. */
    function onFrame() {
      rafSeen = true;
      if (!running || useInterval) return;
      step();
      if (running) rafId = requestAnimationFrame(onFrame);
    }
    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      if (useInterval) { ivId = setInterval(step, 50); return; }
      rafId = requestAnimationFrame(onFrame);
      if (!rafSeen) dogId = setTimeout(function () {
        if (rafSeen || !running) return;
        useInterval = true;
        cancelAnimationFrame(rafId);
        ivId = setInterval(step, 50);
      }, 1200);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
      clearInterval(ivId);
      clearTimeout(dogId);
    }

    function onScreen() {
      var r = grid.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 0) + 80;
    }

    function sync() {
      var shouldRun = (inView || onScreen()) && !document.hidden && !(userPaused && settled);
      if (shouldRun) start(); else stop();
    }

    var section = grid.closest('.mosaic');
    if (section && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          inView = entry.isIntersecting;
          sync();
        });
      }, { threshold: 0.1 });
      io.observe(section);
    } else {
      inView = true;
    }

    document.addEventListener('visibilitychange', sync);

    window.addEventListener('scroll', sync, {passive:true});

    window.addEventListener('resize', sync, {passive:true});

    sync();   // start now rather than waiting for an observer that may never fire

    if (readEl) {
      var pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'mosaic__pause';
      pauseBtn.textContent = 'Pause';
      pauseBtn.addEventListener('click', function () {
        userPaused = !userPaused;
        settled = false;
        if (userPaused) flush();   // finish the shape in progress, then hold still
        pauseBtn.textContent = userPaused ? 'Resume' : 'Pause';
        sync();
      });
      readEl.appendChild(pauseBtn);
    }
  }


  /* ------------------------------------------------------------------
   * initInspect - makes every diagram on the site interrogable.
   *
   * Nineteen bespoke controls would be nineteen things to maintain and
   * nineteen ways to be inconsistent. Every figure already carries the
   * information a reader wants: each SVG has a <title> and a <desc>, and
   * the meaningful marks carry their own text. So one mechanism serves
   * all of them: point at any part of a figure and that part is isolated
   * while everything else recedes, with a readout naming what it is.
   *
   * Works with a mouse, with touch, and from the keyboard: each figure is
   * focusable and arrow keys walk its parts.
   *
   * With this script absent the figures are simply static and complete,
   * which is what they already were.
   * ---------------------------------------------------------------- */
  function initInspect(){
    var figs = document.querySelectorAll('.card__art svg, .proj__art svg');
    if (!figs.length) return;

    function labelFor(el, svg){
      var own = el.getAttribute('data-label')
             || (el.querySelector && el.querySelector('title') && el.querySelector('title').textContent);
      if (own) return own.trim();
      // A shape rarely names itself, so fall back to the nearest text in
      // its own group, which is how these diagrams are actually authored.
      var g = el.parentNode, txt = g && g.querySelector && g.querySelector('text');
      if (txt && txt.textContent.trim()) return txt.textContent.trim();
      var st = svg.querySelector('title');
      return st ? st.textContent.trim() : '';
    }

    Array.prototype.forEach.call(figs, function(svg){
      var parts = svg.querySelectorAll('rect, circle, ellipse, path, polyline, line, polygon');
      if (!parts.length) return;

      var fig = svg.closest ? svg.closest('figure, .card__art, .proj__art') : svg.parentNode;
      if (!fig) return;

      var out = document.createElement('p');
      out.className = 'inspect__out mono';
      out.setAttribute('aria-live', 'polite');
      out.textContent = '';
      fig.appendChild(out);

      svg.setAttribute('tabindex', '0');
      svg.classList.add('is-inspectable');

      var idx = -1;
      function show(el){
        svg.classList.add('is-inspecting');
        Array.prototype.forEach.call(parts, function(p){ p.classList.remove('is-held'); });
        if (!el) { svg.classList.remove('is-inspecting'); out.textContent = ''; return; }
        el.classList.add('is-held');
        out.textContent = labelFor(el, svg);
      }
      function clear(){
        svg.classList.remove('is-inspecting');
        Array.prototype.forEach.call(parts, function(p){ p.classList.remove('is-held'); });
        out.textContent = '';
        idx = -1;
      }

      svg.addEventListener('pointermove', function(e){
        var el = e.target;
        if (el === svg || !el.tagName) return;
        if (/^(rect|circle|ellipse|path|polyline|line|polygon)$/.test(el.tagName.toLowerCase())) show(el);
      });
      /* Engaging the figure opens the evidence folded beneath it, so the
         detail is something the drawing hands over rather than something
         the page states unprompted. It is a real <details>, so it still
         opens by click or keyboard with this script absent. */
      var host = svg.closest ? svg.closest('.card, .proj') : null;
      var ev = host ? host.querySelector('details.ev') : null;
      function reveal(){ if (ev && !ev.open) ev.open = true; }
      svg.addEventListener('pointerenter', reveal);
      svg.addEventListener('focus', reveal);
      svg.addEventListener('pointerleave', clear);
      svg.addEventListener('blur', clear);
      svg.addEventListener('keydown', function(e){
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { idx = (idx + 1) % parts.length; show(parts[idx]); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { idx = (idx - 1 + parts.length) % parts.length; show(parts[idx]); e.preventDefault(); }
        else if (e.key === 'Escape') { clear(); }
      });
    });
  }

  function boot() {
    initScaleSlider();
    initFilter();
    initReveal();
    /* Diagram motion is pure CSS now; see the art-draw/art-pop/art-wipe
       block in site.css. initArt stays defined but unused so nothing
       writes inline styles over the stylesheet. */
    initMosaic();
    initInspect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
