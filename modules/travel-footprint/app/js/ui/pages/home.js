/* ==========================================================================
   Travel Footprint — ui/pages/home.js
   The most important screen: "原来我已经去过这么多地方了。"
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

    var stats = repo.stats();
    var cityList = repo.cityList();
    var timeline = repo.timeline();

    var screen = h('section.screen-home');

    var scroller = h('div.home-scroll.scroll');

    /* ------------------------------------------------------------ hero --- */

    var hero = h('header.home-hero', [
      h('div.home-hero__eyebrow', [
        // ETHAN Super App：外壳内运行时在标题行内联返回键（走已包装的返回链路，根页面回超级 App 首页）
        (function () {
          var inShell = false;
          try { inShell = !!(window.parent && window.parent !== window); } catch (e) { inShell = false; }
          if (!inShell) return null;
          return h('button', {
            class: 'esa-back-btn',
            type: 'button',
            'aria-label': '返回主页',
            onClick: function () {
              // 走 backHandler.backArrow（已被模块桥包装：根页面 → 通知外壳关闭模块）
              if (window.TF && window.TF.ui && window.TF.ui.backHandler && typeof window.TF.ui.backHandler.backArrow === 'function') {
                window.TF.ui.backHandler.backArrow();
              } else if (window.__esaModule && typeof window.__esaModule.back === 'function') {
                window.__esaModule.back();
              }
            }
          }, [
            h('span.esa-back-btn__icon', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>' })
          ]);
        })(),
        h('span.home-hero__mark', [icon('sparkle', { size: 13, strokeWidth: 1.9 })]),
        h('span', '旅行足迹')
      ]),
      h('p.home-hero__tagline', '记录我走过的地方')
    ]);

    // A persistent add affordance. The empty state has its own big button, but
    // once records exist the user still needs a one-tap way in — otherwise the
    // main action of the app hides behind a menu.
    if (stats.tripCount > 0) {
      hero.appendChild(
        h('div.home-hero__actions', [
          parts.primaryButton('添加足迹', function () { UI.flows.addTrip(); }, { icon: 'plus' })
        ])
      );
    }

    /* -------------------------------------------------------- big stats --- */

    var heroStat = h('div.hero-stat', [
      h('div.hero-stat__primary', [
        h('span.hero-stat__number.t-display', { dataset: { count: String(stats.cityCount) } }, '0'),
        h('span.hero-stat__unit', '个城市')
      ])
    ]);

    var subStats = h('div.home-substats.stagger', [
      subStat(stats.regionCount, '个省区'),
      subStat(stats.tripCount, '次旅行'),
      subStat(stats.photoCount, '张照片')
    ]);

    var statsBlock = h('section.home-section.home-section--stats', [
      heroStat,
      subStats
    ]);

    /* ------------------------------------------------------------- map --- */

    var mapPreview = h('section.home-section', [
      sectionHead('足迹地图', '查看我的足迹', function () {
        app.router.showTab('map');
      }),
      buildMapPreview(repo)
    ]);

    /* --------------------------------------------------------- recent --- */

    var recentTrips = [];
    for (var i = 0; i < timeline.length && recentTrips.length < 3; i++) {
      var months = timeline[i].months;
      for (var j = 0; j < months.length && recentTrips.length < 3; j++) {
        var list = months[j].trips;
        for (var k = 0; k < list.length && recentTrips.length < 3; k++) {
          recentTrips.push(list[k]);
        }
      }
    }

    var recentBlock = h('section.home-section', [
      sectionHead('最近旅程', recentTrips.length ? '全部' : null, recentTrips.length
        ? function () { app.router.showTab('timeline'); }
        : null),
      recentTrips.length
        ? h('div.home-recent.stagger', recentTrips.map(function (entry, idx) {
            return parts.ticket(entry, {
              index: idx + 1,
              onClick: function () {
                app.router.push('city', { cityId: entry.city ? entry.city.id : null, focusTripId: entry.trip.id });
              }
            });
          }))
        : parts.emptyState({
            glyph: 'compass',
            title: '还没有旅行足迹',
            message: '记录你的第一个城市',
            action: parts.primaryButton('添加足迹', function () { UI.flows.addTrip(); }, { icon: 'plus' })
          })
    ]);

    /* ----------------------------------------------------------- footer --- */

    var footer = h('footer.home-footer', [
      h('span.home-footer__brand', 'TRAVEL FOOTPRINT'),
      h('span.home-footer__version', 'v' + TF.backup.APP_VERSION + ' · 离线运行')
    ]);

    scroller.appendChild(hero);
    scroller.appendChild(statsBlock);
    if (stats.tripCount > 0) scroller.appendChild(mapPreview);
    scroller.appendChild(recentBlock);
    scroller.appendChild(footer);

    screen.appendChild(scroller);

    // animate the headline number once the screen is actually on screen
    scheduleCountUp(screen, stats.cityCount);

    return screen;
  }

  function subStat(value, unit) {
    return h('div.substat', [
      h('span.substat__num', { dataset: { count: String(value) } }, '0'),
      h('span.substat__unit', unit)
    ]);
  }

  function sectionHead(title, actionLabel, onAction) {
    return h('div.section-head', [
      h('h2.section-head__title', title),
      actionLabel
        ? h('button.section-head__action', { type: 'button', onClick: onAction }, [
            h('span', actionLabel),
            icon('chevron', { size: 14, strokeWidth: 2 })
          ])
        : null
    ]);
  }

  /* --------------------------------------------------------- map preview --- */

  /**
   * A real miniature map: offline silhouettes + a dot per visited city,
   * tapping through to the full map. All visited cities are plotted (not
   * just the first few) — the labels below stay limited to keep it tidy.
   */
  function buildMapPreview(repo) {
    var cities = repo.cityList().filter(function (e) { return e.visitCount > 0; });
    var limit = 6;
    var shown = cities.slice(0, limit);

    var wrap = h('button.home-map.u-tap', {
      type: 'button',
      onClick: function () { TF.app.router.showTab('map'); }
    });

    // 航线数据：行程 + 常驻出发地（与地图页同一套连线逻辑）
    var trips = repo.liveTrips ? repo.liveTrips() : [];
    var home = TF.ui.flows && typeof TF.ui.flows.readHomeCity === 'function'
      ? TF.ui.flows.readHomeCity() : null;
    var homeCity = home ? repo.findCityByName(home.name) : null;

    var svgEl = UI.map.renderMini(cities, trips, homeCity);
    wrap.appendChild(svgEl);

    // 标签：常驻出发地排最前，其次已去过的城市
    var labels = h('div.home-map__labels');
    var labelCities = [];
    if (homeCity && !cities.some(function (e) { return e.city.id === homeCity.id; })) {
      labelCities.push(homeCity);
    }
    shown.forEach(function (e) { labelCities.push(e.city); });
    labelCities.slice(0, limit).forEach(function (c, i) {
      labels.appendChild(h('span.home-map__label', {
        class: i === 0 ? 'is-first' : ''
      }, M.cityName(c)));
    });
    wrap.appendChild(labels);

    if (cities.length > limit) {
      wrap.appendChild(h('span.home-map__more', '还有 ' + (cities.length - limit) + ' 个城市 →'));
    }

    return wrap;
  }

  /* ------------------------------------------------------------ countUp --- */

  /**
   * 0 → 5 → 12 → 23 style count-up. Short (about 900ms), eased out.
   * Respects prefers-reduced-motion by jumping straight to the final value.
   */
  function scheduleCountUp(screen, target) {
    var reduce = false;
    try {
      reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduce = false; }

    var nodes = Array.prototype.slice.call(screen.querySelectorAll('[data-count]'));
    if (!nodes.length) return;

    function finish() {
      nodes.forEach(function (node) {
        node.textContent = node.dataset.count;
        node.dataset.countDone = '1';
      });
    }

    if (reduce || target === 0) {
      finish();
      return;
    }

    var DURATION = 900;
    var start = null;

    function loop(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / DURATION);
      var eased = 1 - Math.pow(1 - p, 3);   // easeOutCubic

      nodes.forEach(function (node) {
        if (node.dataset.countDone === '1') return;
        var value = parseInt(node.dataset.count, 10) || 0;
        node.textContent = String(Math.round(value * eased));
        if (p >= 1) node.dataset.countDone = '1';
      });

      if (p < 1) requestAnimationFrame(loop);
      else finish();
    }

    // two frames so the screen is painted before numbers start moving
    requestAnimationFrame(function () { requestAnimationFrame(loop); });
  }

  function refresh(screen, params) {
    return mount({ params: params });
  }

  P.home = {
    id: 'home',
    mount: mount,
    refresh: refresh
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
