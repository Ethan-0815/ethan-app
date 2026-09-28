/* ==========================================================================
   Travel Footprint — ui/pages/cities.js
   All visited cities: search, sort, jump to detail.
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

  // sort modes cycle through these
  var SORTS = [
    { id: 'visits', label: '按次数' },
    { id: 'recent', label: '按最近' },
    { id: 'name', label: '按名称' }
  ];

  var sortState = 'visits';

  function mount(ctx) {
    var app = TF.app;
    var repo = app.repo;
    var screen = h('section.screen-cities');

    var all = repo.cityList();

    var head = h('header.cities-header', [
      h('div.cities-header__row', [
        // 返回键与标题成组（返回在左、标题紧随其右）
        h('div', { class: 'esa-head-group', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
          (window.TF && window.TF.ui && typeof window.TF.ui.esaBackChip === 'function' ? window.TF.ui.esaBackChip() : null),
          h('div', [
            h('h1.cities-header__title', '城市'),
            h('p.cities-header__sub', all.length + ' 个城市记录在册')
          ])
        ]),
        h('button.cities-header__add', {
          type: 'button',
          onClick: function () { UI.flows.addTrip(); },
          'aria-label': '添加足迹'
        }, icon('plus', { size: 20, strokeWidth: 2.2 }))
      ])
    ]);
    screen.appendChild(head);

    /* ------------------------------------------------------------ search --- */

    var searchInput = h('input.cities-search__input', {
      type: 'search',
      placeholder: '搜索城市…',
      'aria-label': '搜索城市',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false'
    });

    var searchWrap = h('div.cities-search', [
      h('span.cities-search__icon', [icon('search', { size: 17 })]),
      searchInput,
      h('button.cities-search__clear', {
        type: 'button',
        hidden: true,
        'aria-label': '清除搜索',
        onClick: function () {
          searchInput.value = '';
          applySearch('');
          searchInput.focus();
        }
      }, icon('close', { size: 15, strokeWidth: 2.2 }))
    ]);

    /* -------------------------------------------------------------- sort --- */

    var sortBtn = h('button.cities-sort', {
      type: 'button',
      onClick: function () {
        var i = SORTS.findIndex(function (s) { return s.id === sortState; });
        sortState = SORTS[(i + 1) % SORTS.length].id;
        sortLabel.textContent = SORTS.find(function (s) { return s.id === sortState; }).label;
        render(list, currentQuery);
      }
    }, [
      icon('more', { size: 16 }),
      h('span.cities-sort__label', { class: 'cities-sort__label' }, SORTS.find(function (s) { return s.id === sortState; }).label)
    ]);
    var sortLabel = sortBtn.querySelector('.cities-sort__label');

    screen.appendChild(h('div.cities-toolbar', [searchWrap, sortBtn]));

    /* -------------------------------------------------------------- list --- */

    var list = h('div.cities-list');
    var scroller = h('div.cities-scroll.scroll');
    scroller.appendChild(list);
    screen.appendChild(scroller);

    if (!all.length) {
      scroller.appendChild(parts.emptyState({
        glyph: 'compass',
        title: '还没有城市',
        message: '记录你的第一个城市，它会出现在这里',
        action: parts.primaryButton('添加足迹', function () { UI.flows.addTrip(); }, { icon: 'plus' })
      }));
      return screen;
    }

    var currentQuery = '';

    function applySearch(q) {
      currentQuery = q || '';
      searchWrap.classList.toggle('has-value', !!currentQuery);
      var clearBtn = searchWrap.querySelector('.cities-search__clear');
      clearBtn.hidden = !currentQuery;
      render(list, currentQuery);
    }

    searchInput.addEventListener('input', U.debounce(function () {
      applySearch(searchInput.value);
    }, 130));

    render(list, '');
    return screen;

    /* ------------------------------------------------------------ render --- */

    function render(container, query) {
      var source = all;

      if (query) {
        // match on city name / province / country, and surface note matches
        var hit = M.search(query, repo.allCities(), repo.allTrips());
        var ids = {};
        hit.cities.forEach(function (c) { ids[c.id] = true; });

        source = all.filter(function (e) {
          if (ids[e.city.id]) return true;
          // also allow a note hit to bring its city forward
          return hit.trips.some(function (t) { return t.cityId === e.city.id; });
        });
      }

      source = sortEntries(source.slice(), query);

      UI.dom.clear(container);

      if (!source.length) {
        container.appendChild(parts.emptyState({
          glyph: 'search',
          title: '没有找到「' + query + '」',
          message: '试试其他城市名，或者搜索备注里的关键词'
        }));
        return;
      }

      // group visited vs not-yet-visited so an empty city never looks broken
      var visited = source.filter(function (e) { return e.visitCount > 0; });
      var pending = source.filter(function (e) { return e.visitCount === 0; });

      if (visited.length) {
        if (pending.length) container.appendChild(groupLabel('已去过 · ' + visited.length));
        var vWrap = h('div.cities-list__group.stagger');
        visited.forEach(function (e) {
          vWrap.appendChild(parts.cityCard(e, { onClick: function () { open(e); } }));
        });
        container.appendChild(vWrap);
      }

      if (pending.length) {
        container.appendChild(groupLabel('已记录，还没添加旅行 · ' + pending.length));
        var pWrap = h('div.cities-list__group');
        pending.forEach(function (e) {
          pWrap.appendChild(parts.cityCard(e, { onClick: function () { open(e); } }));
        });
        container.appendChild(pWrap);
      }
    }

    function groupLabel(text) {
      return h('p.cities-list__label.t-label', text);
    }

    function sortEntries(entries, query) {
      if (sortState === 'name') {
        return entries.sort(function (a, b) {
          return U.byAsc(M.cityName(a.city), M.cityName(b.city));
        });
      }
      if (sortState === 'recent') {
        return entries.sort(function (a, b) {
          if (!a.lastVisit && !b.lastVisit) return 0;
          if (!a.lastVisit) return 1;
          if (!b.lastVisit) return -1;
          return U.byDesc(a.lastVisit, b.lastVisit);
        });
      }
      // visits: most-visited first, then most recent, then name
      return entries.sort(function (a, b) {
        if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
        if (a.lastVisit && b.lastVisit && a.lastVisit !== b.lastVisit) {
          return U.byDesc(a.lastVisit, b.lastVisit);
        }
        return U.byAsc(M.cityName(a.city), M.cityName(b.city));
      });
    }

    function open(entry) {
      app.router.push('city', { cityId: entry.city.id });
    }
  }

  function refresh(screen, params) {
    return mount({ params: params });
  }

  P.cities = {
    id: 'cities',
    mount: mount,
    refresh: refresh
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
