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
   * initMosaic — the assembling mosaic that replaces the number strip.
   * DOM contract (index.html owns the markup, this only fills it in):
   *   section.mosaic > .wrap.mosaic__inner
   *     .mosaic__grid#mosaic-grid            populated here, 40x10 <i> cells
   *     .mosaic__read > .mosaic__org #mosaic-org, .mosaic__num #mosaic-num,
   *                     .mosaic__label #mosaic-label, .mosaic__sub #mosaic-sub
   * No-op if #mosaic-grid is absent (work.html has none of this markup).
   */
  function initMosaic() {
    var grid = document.getElementById('mosaic-grid');
    if (!grid) return;

    var COLS = 40, ROWS = 10;
    var CYCLE_MS = 5000;

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

    var cells = [];
    var frag = document.createDocumentFragment();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var i = document.createElement('i');
        frag.appendChild(i);
        cells.push(i);
      }
    }
    grid.appendChild(frag);
    cells.forEach(scatter);   // every cell starts out in the swarm

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

    /* Where a cell waits when it is not part of the current shape. Far
       enough out to read as travel, not so far that four hundred of them
       become noise across the band. */
    function scatter(cell) {
      var dx = (Math.random() * 2 - 1) * 46;
      var dy = (Math.random() * 2 - 1) * 34;
      var rot = (Math.random() * 2 - 1) * 110;
      cell.style.setProperty('--dx', dx.toFixed(1) + 'px');
      cell.style.setProperty('--dy', dy.toFixed(1) + 'px');
      cell.style.setProperty('--rot', rot.toFixed(1) + 'deg');
    }

    function applyShape(idx, animate) {
      var a = ACHIEVEMENTS[idx];
      var map = litMap(a.shape);

      cells.forEach(function (cell, i) {
        var shouldLight = Object.prototype.hasOwnProperty.call(map, i);
        var wasLit = cell.classList.contains('is-lit');
        var delay = animate ? Math.round(Math.random() * (shouldLight ? 700 : 400)) : 0;
        cell.style.transitionDelay = delay + 'ms';

        /* A cell going dark is thrown to a fresh position, so the next shape
           that needs it flies in from somewhere it has never been. Re-rolling
           only on the way out means a cell already travelling is never yanked
           to a new vector mid-flight. */
        if (animate && wasLit && !shouldLight) scatter(cell);

        cell.classList.toggle('is-lit', shouldLight);
        cell.classList.toggle('is-accent', shouldLight && !!map[i]);
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

    applyShape(0, false);
    if (reduceMotion) return; // first achievement lit, no cycling, no controls.

    var currentIdx = 0;
    var timer = null;
    var inView = false;
    var userPaused = false;

    function pickNext(exclude) {
      var choices = [];
      for (var i = 0; i < ACHIEVEMENTS.length; i++) { if (i !== exclude) choices.push(i); }
      return choices[Math.floor(Math.random() * choices.length)];
    }

    function tick() {
      currentIdx = pickNext(currentIdx);
      applyShape(currentIdx, true);
    }

    function onScreen() {
      var r = grid.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 0) + 80;
    }

    function sync() {
      var shouldRun = (inView || onScreen()) && !document.hidden && !userPaused;
      if (shouldRun && !timer) {
        timer = setInterval(tick, CYCLE_MS);
      } else if (!shouldRun && timer) {
        clearInterval(timer);
        timer = null;
      }
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
      sync();
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
