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

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function initCounters() {
    var nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length) return;

    nodes.forEach(function (node) {
      var valueEl = node.classList.contains('stat__value')
        ? node
        : node.querySelector('.stat__value');
      if (!valueEl) return;

      var target = parseFloat(node.getAttribute('data-count'));
      if (isNaN(target)) return;

      var decimals = (String(target).split('.')[1] || '').length;
      var raw = valueEl.textContent;
      var match = raw.match(/[\d,.]+/);
      var prefix = match ? raw.slice(0, match.index) : '';
      var suffix = match ? raw.slice(match.index + match[0].length) : '';

      function render(v) {
        var fixed = decimals ? v.toFixed(decimals) : String(Math.round(v));
        var parts = fixed.split('.');
        parts[0] = Number(parts[0]).toLocaleString('en-US');
        valueEl.textContent = prefix + parts.join('.') + suffix;
      }

      if (reduceMotion) {
        render(target);
        return;
      }

      var done = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || done) return;
          done = true;
          io.unobserve(entry.target);

          var duration = 1200;
          var start = null;

          function frame(now) {
            if (start === null) start = now;
            var t = Math.min(1, (now - start) / duration);
            render(target * easeOutCubic(t));
            if (t < 1) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
      }, { threshold: 0.4 });
      io.observe(node);
    });
  }

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
      return px0 + ((n - xMin) / (xMax - xMin)) * (px1 - px0);
    }
    function yPos(v) {
      var lo = Math.log10(yMin), hi = Math.log10(yMax);
      return py1 - ((Math.log10(v) - lo) / (hi - lo)) * (py1 - py0);
    }

    function update() {
      var n = Number(input.value);
      var before = 5 * n * n + 36 * n + 32;
      var after = 16 * n + 32;

      outs.forEach(function (out) {
        var metric = out.getAttribute('data-metric');
        if (metric === 'before') out.textContent = before.toLocaleString('en-US');
        else if (metric === 'after') out.textContent = after.toLocaleString('en-US');
      });

      if (canPlot) {
        if (markerBefore) {
          markerBefore.setAttribute('cx', xPos(n));
          markerBefore.setAttribute('cy', yPos(before));
        }
        if (markerAfter) {
          markerAfter.setAttribute('cx', xPos(n));
          markerAfter.setAttribute('cy', yPos(after));
        }
      }
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

  function boot() {
    initCounters();
    initScaleSlider();
    initFilter();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
