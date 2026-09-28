/* ==========================================================================
   Travel Footprint — ui/pages/city.js
   City detail: every visit to this city, each with notes/photos/attachments.
   Supports multiple trips to the same city without overwriting.
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
    var params = ctx.params || {};
    var cityId = params.cityId;

    var screen = h('section.screen-city');

    var city = cityId ? repo.findCity(cityId) : null;

    if (!city || !M.isLive(city)) {
      screen.appendChild(buildHeader('城市', false));
      screen.appendChild(parts.emptyState({
        glyph: 'search',
        title: '找不到这个城市',
        message: '它可能已经被删除了',
        action: parts.ghostButton('返回', function () { app.router.back(); })
      }));
      return screen;
    }

    var trips = repo.tripsOfCity(city.id);
    var stats = summarise(trips, repo);

    /* ------------------------------------------------------------ header --- */

    var header = h('header.city-head', [
      h('div.city-head__topbar', [
        parts.iconButton('back', function () { app.router.back(); }, { label: '返回' }),
        h('div.city-head__actions', [
          parts.iconButton('plus', function () { UI.flows.addTrip({ cityId: city.id }); }, { label: '为这座城市添加旅行' }),
          parts.iconButton('edit', function () { UI.flows.editCity(city.id); }, { label: '编辑城市' }),
          parts.iconButton('more', function () { openCityMenu(city); }, { label: '更多操作' })
        ])
      ]),
      h('div.city-head__main', [
        h('h1.city-head__name', M.cityName(city)),
        M.geoLine(city) ? h('p.city-head__geo', M.geoLine(city)) : null
      ]),
      h('div.city-head__stats', [
        statPill(trips.length, '次旅行', true),
        statPill(stats.days, '天'),
        stats.photos ? statPill(stats.photos, '张照片') : null,
        stats.attachments ? statPill(stats.attachments, '个附件') : null
      ]),
      trips.length
        ? h('p.city-head__range', [
            h('span', '首次 ' + U.formatDot(stats.first)),
            h('span.city-head__range-sep', '·'),
            h('span', '最近 ' + U.formatDot(stats.last))
          ])
        : null
    ]);

    screen.appendChild(header);

    /* -------------------------------------------------------------- trips --- */

    var scroller = h('div.city-scroll.scroll');

    if (!trips.length) {
      scroller.appendChild(parts.emptyState({
        glyph: 'timeline',
        title: '这个城市还没有旅行记录',
        message: '为它添加第一次旅行，写下日期和你想记住的事',
        action: parts.primaryButton('添加旅行', function () {
          UI.flows.addTrip({ cityId: city.id });
        }, { icon: 'plus' })
      }));
      screen.appendChild(scroller);
      return screen;
    }

    var listWrap = h('div.city-trips');

    trips.forEach(function (trip, idx) {
      listWrap.appendChild(buildTripBlock(trip, trips.length - idx, trips.length));
    });

    scroller.appendChild(h('div.city-trips__head', [
      h('h2.city-trips__title', '旅行记录'),
      h('span.city-trips__count', trips.length + ' 次')
    ]));
    scroller.appendChild(listWrap);

    scroller.appendChild(h('div.city-actions', [
      parts.ghostButton('再添加一次旅行', function () {
        UI.flows.addTrip({ cityId: city.id });
      }, { icon: 'plus', block: true }),
      parts.ghostButton('删除这座城市', function () {
        UI.flows.deleteCity(city.id);
      }, { icon: 'trash', block: true, class: 'btn--danger-ghost' })
    ]));

    screen.appendChild(scroller);

    // scroll to a specific trip when arriving from the timeline
    if (params.focusTripId) {
      setTimeout(function () {
        var el = screen.querySelector('[data-trip-id="' + params.focusTripId + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (el) {
          el.classList.add('is-flash');
          setTimeout(function () { el.classList.remove('is-flash'); }, 1400);
        }
      }, 120);
    }

    return screen;
  }

  /* ------------------------------------------------------------ trip block --- */

  function buildTripBlock(trip, ordinal, total) {
    var app = TF.app;
    var repo = app.repo;
    var photos = repo.photosOfTrip(trip.id);
    var attachments = repo.attachmentsOfTrip(trip.id);
    var days = U.daysBetween(trip.startDate, trip.endDate);

    var block = h('article.city-trip', {
      dataset: { tripId: trip.id }
    });

    /* --- header row: ordinal + dates + menu --- */
    var fromCity = trip.fromCityId ? repo.findCity(trip.fromCityId) : null;
    block.appendChild(h('div.city-trip__head', [
      h('div.city-trip__ordinal', [
        h('span.city-trip__ordinal-num', String(ordinal)),
        h('span.city-trip__ordinal-label', total > 1 ? '次' : '次记录')
      ]),
      h('div.city-trip__dates.u-grow', [
        h('p.city-trip__range', U.formatRange(trip.startDate, trip.endDate)),
        h('p.city-trip__days', fromCity
          ? '从 ' + M.cityName(fromCity) + ' 出发 · ' + U.pluralDays(days)
          : U.pluralDays(days))
      ]),
      parts.iconButton('edit', function () { UI.flows.editTrip(trip.id); }, { label: '编辑这次旅行', size: 18 }),
      parts.iconButton('more', function () { openTripMenu(trip); }, { label: '更多操作', size: 18 })
    ]));

    /* --- note --- */
    block.appendChild(h('section.city-trip__section', [
      h('div.city-trip__section-head', [
        h('span.city-trip__section-title', '备注')
      ]),
      trip.note
        ? h('p.city-trip__note', trip.note)
        : h('button.city-trip__add-inline', {
            type: 'button',
            onClick: function () { UI.flows.editTrip(trip.id, { focus: 'note' }); }
          }, '＋ 写点什么')
    ]));

    /* --- photos --- */
    var photoGrid = h('div.photo-grid');
    photos.forEach(function (photo, i) {
      photoGrid.appendChild(photoCell(photo, i, photos));
    });
    photoGrid.appendChild(h('button.photo-grid__add.u-tap', {
      type: 'button',
      onClick: function () { UI.flows.addPhotos(trip.id); },
      'aria-label': '添加照片'
    }, [
      icon('plus', { size: 20, strokeWidth: 2 }),
      h('span', photos.length ? '添加' : '添加照片')
    ]));

    block.appendChild(h('section.city-trip__section', [
      h('div.city-trip__section-head', [
        h('span.city-trip__section-title', '照片'),
        photos.length ? h('span.city-trip__section-count', photos.length + ' 张') : null
      ]),
      photos.length
        ? photoGrid
        // A trip with no photos is a complete record, not an unfinished one —
        // so this offers a quiet way in rather than asking the user to fix it.
        : h('button.city-trip__empty-row.city-trip__empty-row--action.u-tap', {
            type: 'button',
            onClick: function () { UI.flows.addPhotos(trip.id); }
          }, [
            h('span.city-trip__empty-text', '文字记录'),
            h('span.city-trip__empty-btn', [
              icon('plus', { size: 15, strokeWidth: 2.2 }),
              ' 照片'
            ])
          ])
    ]));

    /* --- attachments --- */
    var attList = h('div.att-list');
    attachments.forEach(function (att) {
      attList.appendChild(attachmentRow(att));
    });
    attList.appendChild(h('button.att-add.u-tap', {
      type: 'button',
      onClick: function () { UI.flows.addAttachment(trip.id); }
    }, [
      icon('plus', { size: 17, strokeWidth: 2 }),
      h('span', attachments.length ? '添加附件' : '添加附件')
    ]));

    block.appendChild(h('section.city-trip__section', [
      h('div.city-trip__section-head', [
        h('span.city-trip__section-title', '附件'),
        attachments.length ? h('span.city-trip__section-count', attachments.length + ' 个') : null
      ]),
      attachments.length
        ? attList
        : h('button.city-trip__empty-row.city-trip__empty-row--action.u-tap', {
            type: 'button',
            onClick: function () { UI.flows.addAttachment(trip.id); }
          }, [
            h('span.city-trip__empty-text', '票据与文件'),
            h('span.city-trip__empty-btn', [
              icon('plus', { size: 15, strokeWidth: 2.2 }),
              ' 附件'
            ])
          ])
    ]));

    /* --- delete this single trip --- */
    if (total > 1) {
      block.appendChild(h('div.city-trip__foot', [
        h('button.city-trip__delete', {
          type: 'button',
          onClick: function () { UI.flows.deleteTrip(trip.id); }
        }, [icon('trash', { size: 15 }), ' 删除这次旅行'])
      ]));
    }

    return block;
  }

  /* ------------------------------------------------------------- photos --- */

  function photoCell(photo, index, allPhotos) {
    var img = h('img.photo-cell__img', { alt: '', loading: 'lazy' });
    TF.app.attachThumb(img, photo.blobId);

    return h('button.photo-cell.u-tap', {
      type: 'button',
      dataset: { photoId: photo.id, index: String(index) },
      onClick: function () { UI.flows.viewPhoto(allPhotos, index); },
      'aria-label': '查看照片'
    }, img);
  }

  /* -------------------------------------------------------- attachments --- */

  function attachmentRow(att) {
    return h('div.att-row', [
      h('span.att-row__icon', M.mimeIcon(att.mimeType, att.name)),
      h('div.att-row__info.u-grow', [
        h('p.att-row__name.u-ellipsis', att.name || '未命名附件'),
        h('p.att-row__meta', [M.formatBytes(att.bytes) || '未知大小'].filter(Boolean).join(' · '))
      ]),
      parts.iconButton('more', function () { openAttachmentMenu(att); }, { label: '附件操作', size: 17 })
    ]);
  }

  /* -------------------------------------------------------------- menus --- */

  function openCityMenu(city) {
    var app = TF.app;
    UI.parts.sheet(h('div.sheet', [
      h('div.sheet__handle'),
      h('h3.sheet__title', M.cityName(city)),
      h('div.sheet__list', [
        sheetItem('plus', '为这座城市添加旅行', function () { UI.flows.addTrip({ cityId: city.id }); }),
        sheetItem('edit', '编辑城市信息', function () { UI.flows.editCity(city.id); }),
        sheetItem('trash', '删除这座城市', function () { UI.flows.deleteCity(city.id); }, true)
      ])
    ]), { onClose: function () {} });
  }

  function openTripMenu(trip) {
    UI.parts.sheet(h('div.sheet', [
      h('div.sheet__handle'),
      h('h3.sheet__title', U.formatRange(trip.startDate, trip.endDate)),
      h('div.sheet__list', [
        sheetItem('edit', '编辑这次旅行', function () { UI.flows.editTrip(trip.id); }),
        sheetItem('image', '添加照片', function () { UI.flows.addPhotos(trip.id); }),
        sheetItem('file', '添加附件', function () { UI.flows.addAttachment(trip.id); }),
        sheetItem('trash', '删除这次旅行', function () { UI.flows.deleteTrip(trip.id); }, true)
      ])
    ]));
  }

  function openAttachmentMenu(att) {
    UI.parts.sheet(h('div.sheet', [
      h('div.sheet__handle'),
      h('h3.sheet__title.u-ellipsis', att.name || '附件'),
      h('div.sheet__list', [
        sheetItem('share', '打开 / 查看', function () { UI.flows.openAttachment(att.id); }),
        sheetItem('trash', '删除附件', function () { UI.flows.deleteAttachment(att.id); }, true)
      ])
    ]));
  }

  function sheetItem(iconName, label, onClick, danger) {
    return h('button.sheet__item', {
      type: 'button',
      class: danger ? 'is-danger' : '',
      onClick: function () {
        UI.parts.closeTopOverlay();
        setTimeout(onClick, 180);
      }
    }, [
      h('span.sheet__item-icon', [icon(iconName, { size: 18 })]),
      h('span.sheet__item-label', label)
    ]);
  }

  /* ----------------------------------------------------------- helpers --- */

  function statPill(value, unit, primary) {
    return h('div.city-stat', { class: primary ? 'city-stat--primary' : '' }, [
      h('span.city-stat__num', String(value)),
      h('span.city-stat__unit', unit)
    ]);
  }

  function buildHeader(title, showBack) {
    return h('header.city-head', [
      h('div.city-head__topbar', [
        showBack
          ? parts.iconButton('back', function () { TF.app.router.back(); }, { label: '返回' })
          : h('div.header__spacer')
      ]),
      h('div.city-head__main', [h('h1.city-head__name', title)])
    ]);
  }

  function summarise(trips, repo) {
    var days = 0;
    var photos = 0;
    var attachments = 0;
    var first = null;
    var last = null;

    trips.forEach(function (t) {
      days += U.daysBetween(t.startDate, t.endDate);
      photos += repo.photosOfTrip(t.id).length;
      attachments += repo.attachmentsOfTrip(t.id).length;
      var key = M.tripSortKey(t);
      if (key) {
        if (!first || U.compareKeys(key, first) < 0) first = key;
        if (!last || U.compareKeys(key, last) > 0) last = key;
      }
    });

    return { days: days, photos: photos, attachments: attachments, first: first, last: last };
  }

  function refresh(screen, params) {
    return mount({ params: params });
  }

  P.city = {
    id: 'city',
    mount: mount,
    refresh: refresh
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
