/* ==========================================================================
   Travel Footprint — ui/map.js
   Extremely lightweight local vector map: simplified silhouettes + city dots.
   No tiles, no SDK, no network. Media Mercator projection, hand-rolled.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var svgEl = UI.dom.svg;

  var W = 1000;   // internal drawing width
  var H = 620;    // internal drawing height

  /* ------------------------------------------------- projection --- */

  function project(lng, lat, view) {
    // Equirectangular with a cosine latitude correction — cheap, stable and
    // visually fine at these scales (no need for full Mercator).
    var v = view;
    var x = (lng - v.minLng) / (v.maxLng - v.minLng) * W;
    var y = (v.maxLat - lat) / (v.maxLat - v.minLat) * H;
    return [x, y];
  }

  function ringToPath(ring, proj) {
    var d = '';
    for (var i = 0; i < ring.length; i++) {
      var p = proj(ring[i][0], ring[i][1]);
      d += (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      if (i < ring.length - 1) d += ' ';
    }
    return d + ' Z';
  }

  function lineToPath(line, proj) {
    var d = '';
    for (var i = 0; i < line.length; i++) {
      var p = proj(line[i][0], line[i][1]);
      d += (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      if (i < line.length - 1) d += ' ';
    }
    return d;
  }

  /* ------------------------------------------------------ full map --- */

  /**
   * Render the full map into a container.
   * Returns { el, setView, focusCity, zoomBy, fit }.
   */
  function create(opts) {
    var o = opts || {};
    var repo = TF.app.repo;

    var entryById = {};
    repo.cityList().forEach(function (e) { entryById[e.city.id] = e; });

    var state = {
      mode: o.mode || 'china',          // 'china' | 'world'
      scale: 1,
      tx: 0,
      ty: 0,
      selectedId: null
    };

    var view = function () { return TF.geo.map.VIEWS[state.mode]; };

    /** Geographic window that fits the current container, recentred. */
    var proj = null;
    var frameW = W;
    var frameH = H;
    var boxW = W;   // current drawing-box width (varies with the container shape)
    var boxH = H;

    /** Extra breathing room around the landmass, per view. */
    var FIT = { china: 0.98, world: 1.0 };

    /**
     * Fit the map into a container of any aspect ratio.
     *
     * Rules that keep this readable:
     *  1. The base geographic window is a FLOOR, never a crop — every visited
     *     city must stay on screen, so the visible window only ever grows.
     *  2. Growth happens on whichever axis has slack, so shapes keep their true
     *     proportions (a tall phone shows extra ocean above and below rather
     *     than squashing China).
     *  3. The viewBox mirrors the container's own pixel size, so drawing units
     *     map 1:1 onto screen pixels — circles stay round, dots keep a stable
     *     on-screen size, and strokes never thin out with scale.
     *  4. Longitude is compressed by cos(centre latitude) — the equirectangular
     *     correction — so China looks like China instead of a stretched mat.
     */
    function rebuildProjector(containerW, containerH) {
      var w = containerW > 0 ? containerW : W;
      var h = containerH > 0 ? containerH : H;
      frameW = w;
      frameH = h;

      var fit = FIT[state.mode] || 1;
      var v = view();

      // Base window (rule 1: this is the minimum we ever show).
      var baseW = v.maxLng - v.minLng;
      var baseH = v.maxLat - v.minLat;
      var cLng = (v.minLng + v.maxLng) / 2;
      var cLat = (v.minLat + v.maxLat) / 2;

      // Rule 4: 1° of longitude on screen = cos(cLat) × 1° of latitude.
      var kLat = Math.max(0.2, Math.cos(cLat * Math.PI / 180));
      var effBaseW = baseW * kLat;   // window width in equivalent lat-degrees

      // scale = drawing px per degree of latitude; the tighter axis wins.
      var scale = Math.min(w / effBaseW, h / baseH) * fit;

      // Rule 2: the visible window grows (never shrinks below the base).
      var spanLat = h / scale;
      var spanLng = w / (scale * kLat);

      var minLng = cLng - spanLng / 2;
      var maxLat = cLat + spanLat / 2;

      proj = function (lng, lat) {
        return [
          (lng - minLng) * scale * kLat,
          (maxLat - lat) * scale
        ];
      };

      boxW = Math.round(w);
      boxH = Math.round(h);
      svgRoot.setAttribute('viewBox', '0 0 ' + boxW + ' ' + boxH);
      svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }

    var svgRoot = svgEl('svg', {
      class: 'map-svg',
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid meet'
    });

    var gWorld = svgEl('g', { class: 'map-layer map-layer--land' });
    var gGuides = svgEl('g', { class: 'map-layer map-layer--guides' });
    var gRoutes = svgEl('g', { class: 'map-layer map-layer--routes' });
    var gDots = svgEl('g', { class: 'map-layer map-layer--dots' });

    svgRoot.appendChild(gWorld);
    svgRoot.appendChild(gGuides);
    svgRoot.appendChild(gRoutes);
    svgRoot.appendChild(gDots);

    function drawBase() {
      while (gWorld.firstChild) gWorld.removeChild(gWorld.firstChild);
      while (gGuides.firstChild) gGuides.removeChild(gGuides.firstChild);

      var v = view();

      if (state.mode === 'china') {
        // neighbouring landmass first, so the China shape sits clearly on top
        gWorld.appendChild(svgEl('path', {
          class: 'map-land map-land--context',
          d: ringToPath(TF.geo.map.WORLD[1].ring, proj)
        }));
        gWorld.appendChild(svgEl('path', {
          class: 'map-land map-land--primary',
          d: ringToPath(TF.geo.map.CHINA_OUTLINE, proj)
        }));
        TF.geo.map.CHINA_ISLANDS.forEach(function (isl) {
          gWorld.appendChild(svgEl('path', {
            class: 'map-land map-land--island',
            d: ringToPath(isl.ring, proj)
          }));
        });
        // South China Sea islands + the traditional island-line, part of the
        // standard depiction of a full China map.
        TF.geo.map.NANHAI_ISLANDS.forEach(function (isl) {
          gWorld.appendChild(svgEl('path', {
            class: 'map-land map-land--island',
            d: ringToPath(isl.ring, proj)
          }));
        });
        TF.geo.map.NANHAI_LINES.forEach(function (seg) {
          gGuides.appendChild(svgEl('path', {
            class: 'map-guide map-guide--island-line',
            d: lineToPath(seg, proj)
          }));
        });
        TF.geo.map.CHINA_GUIDES.forEach(function (line) {
          gGuides.appendChild(svgEl('path', {
            class: 'map-guide',
            d: lineToPath(line, proj)
          }));
        });
      } else {
        TF.geo.map.WORLD_MAIN.forEach(function (mass) {
          gWorld.appendChild(svgEl('path', {
            class: 'map-land map-land--primary',
            d: ringToPath(mass.ring, proj)
          }));
        });
      }
    }

    function drawDots() {
      while (gDots.firstChild) gDots.removeChild(gDots.firstChild);
      while (gRoutes.firstChild) gRoutes.removeChild(gRoutes.firstChild);

      var plotted = [];

      // order by first visit so the route line tells a chronological story
      var ordered = repo.cityList()
        .filter(function (e) {
          if (e.visitCount === 0) return false;
          if (state.mode === 'china') return TF.geo.map.isChina(e.city);
          return true;
        })
        .filter(function (e) {
          return e.city.latitude !== null && e.city.longitude !== null;
        })
        .sort(function (a, b) {
          return TF.util.byAsc(a.firstVisit || '9999', b.firstVisit || '9999');
        });

      ordered.forEach(function (e) {
        var p = proj(e.city.longitude, e.city.latitude);
        plotted.push({ entry: e, x: p[0], y: p[1] });
      });

      // 航线：每条行程按「出发地 → 到达地」画一条弧线（同一对城市去重）。
      // 行程没填出发地时，自动用「常驻出发地」（tf.homeCity.v1）兜底连线；
      // 两者都没有的行程不参与连线。
      var homeId = null;
      try {
        var hn = JSON.parse(localStorage.getItem('tf.homeCity.v1') || 'null');
        if (hn) {
          var hc = repo.findCityByName(hn);
          if (hc) homeId = hc.id;
        }
      } catch (e) { /* ignore */ }

      var segSeen = {};
      var segs = [];
      repo.liveTrips().forEach(function (t) {
        var fromId = t.fromCityId || homeId;
        if (!fromId || fromId === t.cityId) return;
        var fc = repo.findCity(fromId);
        var tc = repo.findCity(t.cityId);
        if (!fc || !tc) return;
        if (fc.latitude === null || fc.longitude === null) return;
        if (tc.latitude === null || tc.longitude === null) return;
        var key = fc.id < tc.id ? fc.id + '|' + tc.id : tc.id + '|' + fc.id;
        if (segSeen[key]) return;
        segSeen[key] = true;
        segs.push([fc, tc]);
      });

      segs.forEach(function (seg) {
        var p1 = proj(seg[0].longitude, seg[0].latitude);
        var p2 = proj(seg[1].longitude, seg[1].latitude);
        var mx = (p1[0] + p2[0]) / 2;
        var my = (p1[1] + p2[1]) / 2;
        var dx = p2[0] - p1[0];
        var dy = p2[1] - p1[1];
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        // 垂直方向轻微拱起的弧线，航线感更强
        var bow = Math.min(26, len * 0.14);
        var cx = mx - (dy / len) * bow;
        var cy = my + (dx / len) * bow;
        var d = 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
                ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) +
                ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
        gRoutes.appendChild(svgEl('path', { class: 'map-route-shadow', d: d }));
        gRoutes.appendChild(svgEl('path', { class: 'map-route', d: d }));
      });

      // 航线端点里「只作为出发地、还没单独记录过」的城市：补画空心小点，
      // 保证像「徐州 → 香港」这样的航线两端都可见。
      var plottedIds = {};
      plotted.forEach(function (pt) { plottedIds[pt.entry.city.id] = true; });
      var originSeen = {};
      segs.forEach(function (seg) {
        var fc = seg[0];
        if (plottedIds[fc.id] || originSeen[fc.id]) return;
        originSeen[fc.id] = true;
        var p = proj(fc.longitude, fc.latitude);
        var g = svgEl('g', {
          class: 'map-dot map-dot--origin',
          transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')',
          dataset: { cityId: fc.id },
          role: 'button',
          'aria-label': TF.model.cityName(fc) + '（出发地）'
        });
        g.appendChild(svgEl('circle', { class: 'map-dot__halo', r: '7' }));
        g.appendChild(svgEl('circle', { class: 'map-dot__core map-dot__core--origin', r: '4.4' }));
        var t = svgEl('text', { class: 'map-dot__label', x: '0', y: '-10' });
        var ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        ts.textContent = TF.model.cityName(fc);
        t.appendChild(ts);
        g.appendChild(t);
        gDots.appendChild(g);
      });

      plotted.forEach(function (pt) {
        var isSelected = pt.entry.city.id === state.selectedId;
        var visits = pt.entry.visitCount;

        var g = svgEl('g', {
          class: 'map-dot' + (isSelected ? ' is-selected' : ''),
          transform: 'translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ')',
          dataset: { cityId: pt.entry.city.id },
          tabindex: '0',
          role: 'button',
          'aria-label': TF.model.cityName(pt.entry.city)
        });

        // halo scales a little with repeat visits so frequent places read louder
        g.appendChild(svgEl('circle', {
          class: 'map-dot__halo',
          r: String(7 + Math.min(visits, 4) * 1.4)
        }));
        g.appendChild(svgEl('circle', { class: 'map-dot__core', r: '3.6' }));
        if (visits > 1) {
          g.appendChild(svgEl('text', {
            class: 'map-dot__count',
            x: '0', y: '1.2'
          }, [
            (function () {
              var t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
              t.textContent = String(visits);
              return t;
            })()
          ]));
        }

        g.addEventListener('click', function (ev) {
          ev.stopPropagation();
          select(pt.entry);
        });
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') select(pt.entry);
        });

        gDots.appendChild(g);
      });

      if (o.onCount) o.onCount(plotted.length);
    }

    function select(entry) {
      state.selectedId = entry.city.id;
      drawDots();
      if (o.onSelect) o.onSelect(entry);
    }

    function clearSelection() {
      state.selectedId = null;
      drawDots();
      if (o.onSelect) o.onSelect(null);
    }

    /* ------------------------------------------------- pan / zoom --- */

    var viewportEl = null;

    function applyTransform() {
      svgRoot.style.transform =
        'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    }

    /**
     * Zoom to an absolute scale, keeping the geographic point under
     * (originX, originY) — a cursor, a pinch midpoint or a double-tap —
     * visually fixed. This is the focal point: zooming grows the map out of
     * that spot instead of the viewport centre.
     */
    function zoomTo(next, originX, originY) {
      if (originX !== undefined && viewportEl) {
        var rect = viewportEl.getBoundingClientRect();
        var cx = originX - rect.left - rect.width / 2;
        var cy = originY - rect.top - rect.height / 2;
        var ratio = next / state.scale;
        state.tx = cx - (cx - state.tx) * ratio;
        state.ty = cy - (cy - state.ty) * ratio;
      }

      state.scale = next;
      applyTransform();
      if (o.onZoom) o.onZoom(state.scale);
    }

    function zoomBy(factor, originX, originY) {
      var next = TF.util.clamp(state.scale * factor, 0.6, 6);
      if (next === state.scale) return;
      zoomTo(next, originX, originY);
    }

    function reset() {
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      applyTransform();
      if (o.onZoom) o.onZoom(state.scale);
    }

    function attachInteractions(viewport) {
      viewportEl = viewport;

      var dragging = false;
      var startX = 0;
      var startY = 0;
      var baseX = 0;
      var baseY = 0;
      var moved = false;
      var pinchStart = 0;
      var pinchScale = 1;
      // double-tap detection (touch) — desktop uses the dblclick event
      var lastTapT = 0;
      var lastTapX = 0;
      var lastTapY = 0;
      var lastTouchZoomT = 0;

      function pointerDown(x, y) {
        dragging = true;
        moved = false;
        startX = x;
        startY = y;
        baseX = state.tx;
        baseY = state.ty;
        viewport.classList.add('is-dragging');
      }

      function pointerMove(x, y) {
        if (!dragging) return;
        var dx = x - startX;
        var dy = y - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        state.tx = baseX + dx;
        state.ty = baseY + dy;
        applyTransform();
      }

      function pointerUp() {
        if (!dragging) return;
        dragging = false;
        viewport.classList.remove('is-dragging');
      }

      viewport.addEventListener('mousedown', function (e) {
        pointerDown(e.clientX, e.clientY);
      });
      root.addEventListener('mousemove', function (e) {
        if (dragging) pointerMove(e.clientX, e.clientY);
      });
      root.addEventListener('mouseup', pointerUp);

      viewport.addEventListener('touchstart', function (e) {
        if (e.touches.length === 1) {
          pointerDown(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
          dragging = false;
          pinchStart = touchDistance(e.touches);
          pinchScale = state.scale;
        }
      }, { passive: true });

      viewport.addEventListener('touchmove', function (e) {
        if (e.touches.length === 1 && dragging) {
          pointerMove(e.touches[0].clientX, e.touches[0].clientY);
          if (moved && e.cancelable) e.preventDefault();
        } else if (e.touches.length === 2 && pinchStart) {
          var d = touchDistance(e.touches);
          var next = TF.util.clamp(pinchScale * (d / pinchStart), 0.6, 6);
          if (next !== state.scale) {
            // focal point = midpoint between the two fingers: the content
            // under the pinch stays put instead of drifting to the centre
            var mid = touchMidpoint(e.touches);
            lastTouchZoomT = Date.now();
            zoomTo(next, mid[0], mid[1]);
          }
          if (e.cancelable) e.preventDefault();
        }
      }, { passive: false });

      viewport.addEventListener('touchend', function (e) {
        pointerUp();
        pinchStart = 0;

        // double-tap zooms in at the tapped point
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var now = Date.now();
        if (now - lastTapT < 320 &&
            Math.abs(t.clientX - lastTapX) < 32 &&
            Math.abs(t.clientY - lastTapY) < 32) {
          lastTapT = 0;
          if (!moved) zoomBy(1.7, t.clientX, t.clientY);
        } else {
          lastTapT = now;
          lastTapX = t.clientX;
          lastTapY = t.clientY;
        }
      });

      viewport.addEventListener('wheel', function (e) {
        // let the page scroll vertically when the user is clearly scrolling
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
      }, { passive: false });

      // desktop double-click zooms in at the cursor (same focal rule as pinch)
      viewport.addEventListener('dblclick', function (e) {
        // some browsers fire dblclick right after a touch double-tap — skip
        // if the touch path already zoomed a moment ago
        if (Date.now() - lastTouchZoomT < 500) return;
        zoomBy(1.7, e.clientX, e.clientY);
      });

      // click empty space clears the selection
      svgRoot.addEventListener('click', function (e) {
        if (moved) return;
        if (e.target === svgRoot || e.target.classList.contains('map-land')) {
          clearSelection();
        }
      });
    }

    function touchDistance(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function touchMidpoint(touches) {
      return [
        (touches[0].clientX + touches[1].clientX) / 2,
        (touches[0].clientY + touches[1].clientY) / 2
      ];
    }

    /* ---------------------------------------------------- assemble --- */

    var shell = document.createElement('div');
    shell.className = 'map-viewport';

    var stage = document.createElement('div');
    stage.className = 'map-stage';
    stage.appendChild(svgRoot);
    shell.appendChild(stage);

    function relayout() {
      var r = shell.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var changed = Math.abs(r.width - frameW) > 1 || Math.abs(r.height - frameH) > 1;
      rebuildProjector(r.width, r.height);
      return changed;
    }

    // Elements only get a real box once mounted, so measure on the next frame
    // (and again whenever the shell is resized).
    function firstLayout() {
      relayout();
      drawBase();
      drawDots();
      applyTransform();
    }

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (relayout()) {
          drawBase();
          drawDots();
          applyTransform();
        }
      });
      ro.observe(shell);
    } else {
      root.addEventListener('resize', function () {
        if (relayout()) {
          drawBase();
          drawDots();
          applyTransform();
        }
      });
    }

    // Seed a projector so the very first paint has geometry even before the
    // element has been measured; requestAnimationFrame re-fits with real numbers.
    rebuildProjector(W, H);
    drawBase();
    drawDots();
    attachInteractions(shell);
    requestAnimationFrame(firstLayout);

    shell.setView = function (mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      state.selectedId = null;
      reset();
      var r = shell.getBoundingClientRect();
      rebuildProjector(r.width || frameW, r.height || frameH);
      drawBase();
      drawDots();
    };

    shell.getView = function () { return state.mode; };

    shell.select = select;
    shell.clearSelection = clearSelection;
    shell.zoomBy = zoomBy;
    shell.reset = reset;
    shell.redraw = function () { drawBase(); drawDots(); };
    shell.state = state;
    /** Map a lng/lat into the SVG's own unit space (0..boxW, 0..boxH). */
    shell.projectPoint = function (lng, lat) {
      return proj(lng, lat);
    };
    shell.box = function () { return [boxW, boxH]; };
    /**
     * Client-space position of the selected city dot — used as the focal
     * point for the zoom buttons (falls back to the viewport centre).
     */
    shell.selectionPoint = function () {
      if (!state.selectedId || !viewportEl) return null;
      var e = entryById[state.selectedId];
      if (!e || e.city.latitude === null || e.city.longitude === null) return null;
      var p = proj(e.city.longitude, e.city.latitude);
      var rect = viewportEl.getBoundingClientRect();
      var s = Math.min(rect.width / boxW, rect.height / boxH) * state.scale;
      return [
        (rect.width - boxW * s) / 2 + state.tx + p[0] * s,
        (rect.height - boxH * s) / 2 + state.ty + p[1] * s
      ];
    };

    return shell;
  }

  /* ------------------------------------------------- mini map (home) --- */

  /**
   * A real miniature footprint map for the home page: the same offline
   * silhouettes as the full map, drawn with the cosine-corrected projection.
   * China view when every visited city is domestic; world view (windowed on
   * the cities themselves) as soon as a foreign city joins the footprints.
   */
  function renderMini(entries, trips, homeCity) {
    var w = 640;
    var ht = 520;

    var s = svgEl('svg', {
      class: 'mini-map mini-map--real',
      viewBox: '0 0 ' + w + ' ' + ht,
      preserveAspectRatio: 'xMidYMid meet'
    });

    var list = (entries || []).filter(function (e) {
      return e.city && e.city.latitude !== null && e.city.longitude !== null;
    });

    if (!list.length) {
      s.setAttribute('viewBox', '0 0 ' + w + ' 190');
      s.appendChild(svgEl('text', {
        class: 'mini-map__hint',
        x: w / 2, y: 100, 'text-anchor': 'middle'
      }, [textNode('添加第一条旅行记录后，这里会出现你的足迹地图')]));
      return s;
    }

    var hasForeign = list.some(function (e) { return !TF.geo.map.isChina(e.city); });

    /* --------------------------------------------- geographic window --- */

    var minLng, maxLng, minLat, maxLat;
    if (!hasForeign) {
      // full China view (includes the South China Sea, standard depiction)
      var v = TF.geo.map.VIEWS.china;
      minLng = v.minLng; maxLng = v.maxLng;
      minLat = v.minLat; maxLat = v.maxLat;
    } else {
      // world view windowed on the visited cities, with a comfortable pad
      minLng = Infinity; maxLng = -Infinity;
      minLat = Infinity; maxLat = -Infinity;
      list.forEach(function (e) {
        minLng = Math.min(minLng, e.city.longitude);
        maxLng = Math.max(maxLng, e.city.longitude);
        minLat = Math.min(minLat, e.city.latitude);
        maxLat = Math.max(maxLat, e.city.latitude);
      });
      var padLng = Math.max((maxLng - minLng) * 0.18, 8);
      var padLat = Math.max((maxLat - minLat) * 0.18, 6);
      minLng -= padLng; maxLng += padLng;
      minLat -= padLat; maxLat += padLat;
    }

    var cLng = (minLng + maxLng) / 2;
    var cLat = (minLat + maxLat) / 2;
    var kLat = Math.max(0.2, Math.cos(cLat * Math.PI / 180));
    var scale = Math.min(
      w / ((maxLng - minLng) * kLat),
      ht / (maxLat - minLat)
    ) * 0.96;

    // Clamp to just outside the viewBox: geometry that falls outside the
    // window (other continents in world view) gets pinned to the rim where
    // the viewBox clips it away anyway. This keeps DOM bounding boxes inside
    // the container without distorting anything that is actually visible.
    var CLAMP = 4;
    function proj(lng, lat) {
      var x = w / 2 + (lng - cLng) * kLat * scale;
      var y = ht / 2 - (lat - cLat) * scale;
      return [
        Math.max(-CLAMP, Math.min(w + CLAMP, x)),
        Math.max(-CLAMP, Math.min(ht + CLAMP, y))
      ];
    }

    function ringD(ring) {
      var d = '';
      for (var i = 0; i < ring.length; i++) {
        var p = proj(ring[i][0], ring[i][1]);
        d += (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        if (i < ring.length - 1) d += ' ';
      }
      return d + ' Z';
    }

    /* -------------------------------------------------------- land --- */

    if (!hasForeign) {
      s.appendChild(svgEl('path', {
        class: 'mini-map__land',
        d: ringD(TF.geo.map.CHINA_OUTLINE)
      }));
      TF.geo.map.CHINA_ISLANDS.forEach(function (isl) {
        s.appendChild(svgEl('path', {
          class: 'mini-map__land mini-map__land--small',
          d: ringD(isl.ring)
        }));
      });
      TF.geo.map.NANHAI_ISLANDS.forEach(function (isl) {
        s.appendChild(svgEl('path', {
          class: 'mini-map__land mini-map__land--tiny',
          d: ringD(isl.ring)
        }));
      });
      TF.geo.map.NANHAI_LINES.forEach(function (seg) {
        var p1 = proj(seg[0][0], seg[0][1]);
        var p2 = proj(seg[1][0], seg[1][1]);
        s.appendChild(svgEl('line', {
          class: 'mini-map__dash',
          x1: p1[0].toFixed(1), y1: p1[1].toFixed(1),
          x2: p2[0].toFixed(1), y2: p2[1].toFixed(1)
        }));
      });
    } else {
      TF.geo.map.WORLD_MAIN.forEach(function (mass) {
        s.appendChild(svgEl('path', {
          class: 'mini-map__land',
          d: ringD(mass.ring)
        }));
      });
      // the domestic shape keeps its detailed outline even in world view
      s.appendChild(svgEl('path', {
        class: 'mini-map__land mini-map__land--china',
        d: ringD(TF.geo.map.CHINA_OUTLINE)
      }));
    }

    /* -------------------------------------------- route + city dots --- */

    // 航线与地图页同一逻辑：每条行程「出发地 → 到达地」（常驻出发地兜底，
    // 城市对去重）；origin 端点画空心点。没有可用航线时退回旧的串联线。
    var byId = {};
    list.forEach(function (e) { byId[e.city.id] = e.city; });
    // 常驻出发地可能不在已访问列表：直接使用传入的完整 city 对象
    var homeCityObj = homeCity
      ? (byId[homeCity.id] || (homeCity.latitude !== null && homeCity.longitude !== null ? homeCity : null))
      : null;

    var segSeenMini = {};
    var segsMini = [];
    (trips || []).forEach(function (t) {
      var fromId = t.fromCityId || (homeCityObj ? homeCityObj.id : null);
      if (!fromId || fromId === t.cityId) return;
      var fcCity = byId[fromId] || (homeCityObj && fromId === homeCityObj.id ? homeCityObj : null);
      var tcCity = byId[t.cityId];
      if (!fcCity || !tcCity) return;
      var key = fcCity.id < tcCity.id ? fcCity.id + '|' + tcCity.id : tcCity.id + '|' + fcCity.id;
      if (segSeenMini[key]) return;
      segSeenMini[key] = true;
      segsMini.push([fcCity, tcCity]);
    });

    segsMini.forEach(function (seg) {
      var p1 = proj(seg[0].longitude, seg[0].latitude);
      var p2 = proj(seg[1].longitude, seg[1].latitude);
      var d = 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' L' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
      s.appendChild(svgEl('path', { class: 'mini-map__path', d: d }));
    });

    // 没有任何可用航线时，退回旧的按时间串联线，避免主页空白
    if (!segsMini.length) {
      var ordered = list.slice().sort(function (a, b) {
        return TF.util.byAsc(a.firstVisit || '9999', b.firstVisit || '9999');
      });
      if (ordered.length > 1) {
        var d = '';
        ordered.forEach(function (e) {
          var p = proj(e.city.longitude, e.city.latitude);
          d += (d ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ';
        });
        s.appendChild(svgEl('path', { class: 'mini-map__path', d: d }));
      }
    }

    // origin 端点（只作为出发地的城市）：空心点
    var originSeen = {};
    segsMini.forEach(function (seg) {
      var fc = seg[0];
      if (byId[fc.id]) return; // 已访问城市有点
      if (originSeen[fc.id]) return;
      originSeen[fc.id] = true;
      var p = proj(fc.longitude, fc.latitude);
      var grp = svgEl('g', {
        class: 'mini-map__dot mini-map__dot--origin',
        transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')'
      });
      grp.appendChild(svgEl('circle', { class: 'mini-map__halo', r: '9' }));
      grp.appendChild(svgEl('circle', { class: 'mini-map__core mini-map__core--origin', r: '4' }));
      s.appendChild(grp);
    });

    list.forEach(function (e) {
      var p = proj(e.city.longitude, e.city.latitude);
      var grp = svgEl('g', {
        class: 'mini-map__dot',
        transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')'
      });
      grp.appendChild(svgEl('circle', { class: 'mini-map__halo', r: '11' }));
      grp.appendChild(svgEl('circle', { class: 'mini-map__core', r: '4.6' }));
      s.appendChild(grp);
    });

    return s;
  }

  function textNode(str) {
    return document.createTextNode(str);
  }

  UI.map = {
    create: create,
    renderMini: renderMini,
    project: project,
    W: W,
    H: H
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
