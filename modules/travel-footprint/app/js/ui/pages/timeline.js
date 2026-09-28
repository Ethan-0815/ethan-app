/* ==========================================================================
   Travel Footprint — ui/pages/timeline.js
   Chronological memory view: year → month → trip, newest first.
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
    var screen = h('section.screen-timeline');

    var years = repo.timeline();
    var stats = repo.stats();

    var head = h('header.tl-header', [
      // Super App：左上角返回主页
      (window.TF && window.TF.ui && typeof window.TF.ui.esaBackChip === 'function' ? window.TF.ui.esaBackChip() : null),
      h('div', [
        h('h1.tl-header__title', '时间线'),
        h('p.tl-header__sub', stats.tripCount
          ? ['从最近一次开始，倒着看 ', h('strong', String(stats.tripCount)), ' 次旅行']
          : '你的旅行会按时间排列在这里')
      ])
    ]);
    screen.appendChild(head);

    var scroller = h('div.tl-scroll.scroll');

    if (!years.length) {
      scroller.appendChild(parts.emptyState({
        glyph: 'timeline',
        title: '时间线还在等待第一条记录',
        message: '记录一次旅行，这里就会按时间把回忆排好',
        action: parts.primaryButton('添加足迹', function () { UI.flows.addTrip(); }, { icon: 'plus' })
      }));
      screen.appendChild(scroller);
      return screen;
    }

    years.forEach(function (yearEntry) {
      scroller.appendChild(h('div.tl-year', [
        h('div.tl-year__rail', [
          h('span.tl-year__label', String(yearEntry.year))
        ])
      ]));

      yearEntry.months.forEach(function (monthEntry) {
        var count = monthEntry.trips.length;
        scroller.appendChild(h('div.tl-month', [
          h('div.tl-month__head', [
            h('span.tl-month__badge', U.monthLabelEn(monthEntry.month)),
            h('span.tl-month__name', U.monthLabelCn(monthEntry.month)),
            h('span.tl-month__count', count + ' 次')
          ])
        ]));

        monthEntry.trips.forEach(function (item, idx) {
          scroller.appendChild(buildEntry(item, idx, monthEntry));
        });
      });
    });

    scroller.appendChild(h('div.tl-end', [
      h('span.tl-end__dot'),
      h('span.tl-end__text', '这是你最早的旅行记录')
    ]));

    screen.appendChild(scroller);
    return screen;
  }

  function buildEntry(item, idx, monthEntry) {
    var app = TF.app;
    var trip = item.trip;
    var city = item.city;
    var days = item.days;

    var metaBits = [h('span.tl-item__days', U.pluralDays(days))];
    if (item.photoCount > 0) {
      metaBits.push(h('span.tl-item__sep'));
      metaBits.push(h('span.tl-item__chip', [
        icon('image', { size: 13, strokeWidth: 1.8 }),
        String(item.photoCount)
      ]));
    }
    if (item.attachmentCount > 0) {
      metaBits.push(h('span.tl-item__chip', [
        icon('file', { size: 13, strokeWidth: 1.8 }),
        String(item.attachmentCount)
      ]));
    }

    return h('article.tl-item', {
      class: 'anim-rise',
      style: { animationDelay: Math.min(idx * 40, 200) + 'ms' },
      onClick: function () {
        app.router.push('city', {
          cityId: city ? city.id : null,
          focusTripId: trip.id
        });
      },
      role: 'button',
      tabindex: '0'
    }, [
      h('div.tl-item__marker', [
        h('span.tl-item__dot'),
        h('span.tl-item__stem')
      ]),
      h('div.tl-item__card', [
        h('div.tl-item__top', [
          h('h3.tl-item__city', city ? M.cityName(city) : '未命名地点'),
          h('span.tl-item__range', U.formatRange(trip.startDate, trip.endDate))
        ]),
        h('div.tl-item__meta', metaBits),
        trip.note ? h('p.tl-item__note.t-clamp-3', trip.note) : null,
        item.photoCount > 0 ? buildThumbs(trip.id) : null
      ])
    ]);
  }

  /** A thin strip of thumbnails so the timeline feels like a photo album. */
  function buildThumbs(tripId) {
    var repo = TF.app.repo;
    var photos = repo.photosOfTrip(tripId).slice(0, 4);
    if (!photos.length) return null;

    var strip = h('div.tl-item__thumbs');
    photos.forEach(function (p) {
      var img = h('img.tl-item__thumb', { alt: '', loading: 'lazy' });
      TF.app.attachThumb(img, p.blobId);
      strip.appendChild(img);
    });
    return strip;
  }

  function refresh(screen, params) {
    return mount({ params: params });
  }

  P.timeline = {
    id: 'timeline',
    mount: mount,
    refresh: refresh
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
