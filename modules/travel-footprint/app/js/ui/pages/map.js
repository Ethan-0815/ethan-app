/* ==========================================================================
   Travel Footprint — ui/pages/map.js
   Full-screen lightweight footprint map + city popover.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var P = (UI.pages = UI.pages || {});
  var h = UI.dom.h;
  var icon = UI.dom.icon;
  var parts = UI.parts;
  var U = TF.util;
  var M = TF.model;

  function mount(ctx) {
    var app = TF.app;
    var repo = app.repo;
    var screen = h('section.screen-map');

    var entries = repo.cityList().filter(function (e) {
      return e.visitCount > 0 && e.city.latitude !== null && e.city.longitude !== null;
    });

    var hasChina = entries.some(function (e) { return TF.geo.map.isChina(e.city); });
    var initialMode = hasChina ? 'china' : 'world';

    /* ------------------------------------------------------------ head --- */

    var countLabel = h('span.map-count__num', String(entries.length));
    var fromLabel = h('span.map-header__from');
    var head = h('header.map-header', [
      // 返回键与标题成组
      h('div', { class: 'esa-head-group', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
        (window.TF && window.TF.ui && typeof window.TF.ui.esaBackChip === 'function' ? window.TF.ui.esaBackChip() : null),
        h('div.map-header__text', [
          h('h1.map-header__title', '足迹地图'),
          h('p.map-header__sub', [
            h('span', '已点亮 '),
            countLabel,
            h('span', ' 个城市')
          ])
        ])
      ]),
      h('div.map-header__toggle', [
        modeBtn('中国', 'china', initialMode === 'china'),
        modeBtn('世界', 'world', initialMode === 'world')
      ])
    ]);

    /* 常驻出发地入口：未填出发地的行程自动用它连线 */
    function renderFromLabel() {
      UI.dom.clear(fromLabel);
      var home = UI.flows.readHomeCity();
      fromLabel.appendChild(h('button.map-from', {
        type: 'button',
        onClick: function () { UI.flows.setHomeCity(function () { TF.app.router.showTab('map'); }); }
      }, [
        UI.dom.icon('pin', { size: 12 }),
        home ? '出发地：' + home.name : '设置出发地'
      ]));
    }
    renderFromLabel();
    head.querySelector('.map-header__text').appendChild(fromLabel);

    function modeBtn(label, mode, active) {
      return h('button.map-mode', {
        type: 'button',
        class: active ? 'is-active' : '',
        dataset: { mode: mode },
        onClick: function () {
          viewport.setView(mode);
          UI.dom.$$('.map-mode', head).forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.mode === mode);
          });
          hidePopover();
        }
      }, label);
    }

    /* --------------------------------------------------------- viewport --- */

    var popover = h('div.map-popover', { hidden: true });

    var viewport = UI.map.create({
      mode: initialMode,
      onSelect: function (entry) {
        if (entry) showPopover(entry);
        else hidePopover();
      },
      onCount: function (n) {
        countLabel.textContent = String(n);
      }
    });

    var canvas = h('div.map-canvas', [viewport, popover]);

    /* ----------------------------------------------------------- toolbar --- */

    var zoomLabel = h('span.map-zoom__label', '100%');

    // Zoom buttons focus on the selected city when there is one, so tapping
    // 放大 keeps growing the map out of the place the user is reading.
    function zoomOrigin() {
      var p = viewport.selectionPoint ? viewport.selectionPoint() : null;
      return p ? [p[0], p[1]] : undefined;
    }

    var controls = h('div.map-controls', [
      h('button.map-ctrl', { type: 'button', 'aria-label': '放大', onClick: function () { var o = zoomOrigin(); viewport.zoomBy(1.25, o && o[0], o && o[1]); } },
        icon('zoomIn', { size: 20 })),
      h('button.map-ctrl', { type: 'button', 'aria-label': '缩小', onClick: function () { var o = zoomOrigin(); viewport.zoomBy(0.8, o && o[0], o && o[1]); } },
        icon('zoomOut', { size: 20 })),
      h('button.map-ctrl', { type: 'button', 'aria-label': '重置', onClick: function () { viewport.reset(); } },
        icon('fit', { size: 20 }))
    ]);

    screen.appendChild(head);
    screen.appendChild(canvas);
    screen.appendChild(controls);

    // The map is a fixed-height canvas, not a scrolling list: the header and
    // map share the visible area and nothing runs off the bottom.
    screen.classList.add('screen-map--fixed');

    if (!entries.length) {
      canvas.appendChild(parts.emptyState({
        glyph: 'globe',
        title: '地图还是空的',
        message: '记录一个城市后，它会在这里亮起来',
        action: parts.primaryButton('添加足迹', function () { UI.flows.addTrip(); }, { icon: 'plus' }),
        class: 'empty--overlay'
      }));
    }

    /* --------------------------------------------------------- popover --- */

    function showPopover(entry) {
      var city = entry.city;
      var trips = entry.trips || [];
      var last = trips[0];

      UI.dom.mount(popover, h('div.map-popover__card.anim-pop', [
        h('div.map-popover__head', [
          h('div', [
            h('h3.map-popover__name', M.cityName(city)),
            h('p.map-popover__geo', M.geoLine(city) || '未填写地区')
          ]),
          parts.iconButton('close', hidePopover, { label: '关闭', size: 17 })
        ]),
        h('div.map-popover__meta', [
          h('span.map-popover__visits', ['去过 ', h('strong', String(entry.visitCount)), ' 次']),
          last ? h('span.map-popover__when', U.formatCnMonth(last.startDate)) : null
        ]),
        h('button.map-popover__go', {
          type: 'button',
          onClick: function () {
            hidePopover();
            app.router.push('city', { cityId: city.id });
          }
        }, [
          h('span', '查看城市'),
          icon('arrowRight', { size: 16, strokeWidth: 2 })
        ])
      ]));

      popover.hidden = false;
      positionPopover(entry);
    }

    function positionPopover(entry) {
      // place near the dot when we can compute it, else centre
      var rect = viewport.getBoundingClientRect();
      var p = viewport.projectPoint(entry.city.longitude, entry.city.latitude);
      var box = viewport.box ? viewport.box() : [UI.map.W, UI.map.H];

      var st = viewport.state;
      var scaleFactor = Math.min(rect.width / box[0], rect.height / box[1]) * st.scale;
      var offsetX = (rect.width - box[0] * scaleFactor) / 2 + st.tx;
      var offsetY = (rect.height - box[1] * scaleFactor) / 2 + st.ty;

      var x = p[0] * scaleFactor + offsetX;
      var y = p[1] * scaleFactor + offsetY;

      var cardW = 210;
      var left = U.clamp(x - cardW / 2, 10, Math.max(10, rect.width - cardW - 10));
      var top = y - 24;

      popover.style.left = left + 'px';
      popover.style.top = Math.max(10, top) + 'px';
      popover.style.setProperty('--pop-anchor', (x - left) + 'px');
      popover.classList.toggle('is-below', top < 120);
      if (top < 120) {
        popover.style.top = (y + 40) + 'px';
      }
    }

    // Break the hidePopover → clearSelection → onSelect(null) → hidePopover
    // cycle: hiding the card must not re-enter its own handler.
    var closingPopover = false;

    function hidePopover() {
      popover.hidden = true;
      if (closingPopover) return;
      closingPopover = true;
      if (viewport.clearSelection) viewport.clearSelection();
      closingPopover = false;
    }

    // tapping the map background closes the card
    viewport.addEventListener('click', function (e) {
      if (e.target === viewport || e.target.classList.contains('map-land')) hidePopover();
    });

    return screen;
  }

  function refresh(screen, params) {
    return mount({ params: params });
  }

  P.map = {
    id: 'map',
    mount: mount,
    refresh: refresh
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
