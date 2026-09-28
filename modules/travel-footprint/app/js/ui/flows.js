/* ==========================================================================
   Travel Footprint — ui/flows.js
   Every multi-step interaction: add/edit trip & city, photos, attachments,
   backup export/import, recycle bin, settings.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var h = UI.dom.h;
  var svg = UI.dom.svg;
  var icon = UI.dom.icon;
  var parts = UI.parts;
  var U = TF.util;
  var M = TF.model;

  function app() { return TF.app; }
  function repo() { return TF.app.repo; }

  function after(reason) {
    app().router.refreshAll();
    if (reason) app().flash(reason);
  }

  /**
   * Normalise a picked file into a Blob.
   * Browser pickers already hand us File objects; the Android bridge hands us
   * { name, mime, bytes } records — canvas decoding and object URLs need a
   * real Blob either way.
   */
  function asBlob(file) {
    if (!file) return null;
    if (typeof Blob !== 'undefined' && file instanceof Blob) return file;
    var bytes = file.bytes || new Uint8Array(0);
    return new Blob([bytes], { type: file.mime || 'application/octet-stream' });
  }

  /* ==================================================================== */
  /*  ADD / EDIT TRIP                                                     */
  /* ==================================================================== */

  /**
   * Calendar-style date field. Native <input type=date> is inconsistent
   * across WebViews, so we use a text field with a date picker sheet and
   * validate/normalise on save.
   */
  function dateField(opts) {
    var o = opts || {};
    var input = h('input.field__input', {
      type: 'date',
      value: o.value || '',
      'aria-label': o.label || '日期'
    });

    // keep a plain text fallback for engines without date support
    var wrap = h('label.field', [
      o.label ? h('span.field__label', o.label) : null,
      input
    ]);

    return { el: wrap, input: input, get value() { return input.value || ''; } };
  }

  function addTrip(prefill) {
    var p = prefill || {};
    var cities = repo().liveCities();

    // If the city is known we skip straight to the date step.
    if (p.cityId) {
      openTripForm({ cityId: p.cityId, tripId: null });
      return;
    }
    openCityChooserThenTrip();
  }

  /** Step 1: pick (or create) a city. Step 2: dates + note. */
  function openCityChooserThenTrip() {
    var r = repo();
    var all = r.cityList();
    var visited = all.filter(function (e) { return e.visitCount > 0; });
    var pending = all.filter(function (e) { return e.visitCount === 0; });

    var query = '';
    var listWrap = h('div.chooser__list');

    var input = h('input.chooser__input', {
      type: 'search',
      placeholder: '搜索或输入新的城市名',
      autocomplete: 'off',
      spellcheck: 'false'
    });

    var sheetRef = parts.sheet(h('div.sheet.sheet--tall', [
      h('div.sheet__handle'),
      h('h3.sheet__title', '选择城市'),
      h('p.sheet__sub', '去过的地方会排在前面'),
      h('div.chooser__search', [icon('search', { size: 17 }), input]),
      listWrap
    ]), { onClose: function () {} });

    /** Curated starter list — shown before anything is recorded. */
    var POPULAR = ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '重庆', '南京', '桂林', '香港', '东京'];

    /** Find a recorded city, or create it with region + coordinates from the
     * offline geo database. Resolves with the repo entry. */
    function ensureCity(name) {
      var existing = r.findCityByName(name);
      if (existing) return Promise.resolve(existing);
      var d = TF.geo.cities.defaultsFor(name);
      return r.save('city', {
        name: name,
        country: d.country,
        province: d.province,
        latitude: d.latitude,
        longitude: d.longitude
      });
    }

    /** A tappable row for a city that only exists in the offline geo DB. */
    function builtinRow(info, onClick) {
      var geoParts = [];
      if (info.country) geoParts.push(info.country);
      if (info.province && info.province !== info.country) geoParts.push(info.province);
      var geo = geoParts.join(' · ');
      return h('button.chooser__row.chooser__row--builtin', { type: 'button', onClick: onClick }, [
        h('span.chooser__row-badge', info.name.charAt(0)),
        h('div.chooser__row-info.u-grow', [
          h('span.chooser__row-name', info.name),
          geo ? h('span.chooser__row-geo', geo) : null
        ]),
        h('span.chooser__row-visits', '＋ 记录')
      ]);
    }

    function render() {
      var q = query.trim();
      UI.dom.clear(listWrap);

      var shownNames = {};

      var visits = [];
      var rest = [];
      var source = all;
      if (q) {
        source = all.filter(function (e) {
          return M.fuzzyMatch(e.city.name, q) ||
                 M.fuzzyMatch(e.city.province, q) ||
                 M.fuzzyMatch(e.city.country, q);
        });
      }
      source.forEach(function (e) {
        shownNames[M.cityName(e.city)] = true;
        (e.visitCount > 0 ? visits : rest).push(e);
      });

      if (visits.length) {
        listWrap.appendChild(h('p.chooser__group', '已去过的城市'));
        visits.forEach(function (e) {
          listWrap.appendChild(chooserRow(e, function () {
            sheetRef.close();
            openTripForm({ cityId: e.city.id, tripId: null });
          }));
        });
      }

      if (rest.length) {
        listWrap.appendChild(h('p.chooser__group', '已记录的城市'));
        rest.forEach(function (e) {
          listWrap.appendChild(chooserRow(e, function () {
            sheetRef.close();
            openTripForm({ cityId: e.city.id, tripId: null });
          }));
        });
      }

      // Built-in offline suggestions: popular cities when idle, fuzzy matches
      // while typing. Selecting one creates the city (region + coordinates
      // filled from the geo DB) and continues to the trip form.
      var builtins = q
        ? TF.geo.cities.suggest(q, 8)
        : POPULAR.map(function (name) { return TF.geo.cities.lookup(name); })
            .filter(Boolean);
      builtins = builtins.filter(function (info) { return !shownNames[info.name]; });

      if (builtins.length) {
        listWrap.appendChild(h('p.chooser__group', q ? '从城市库中选择' : '热门城市'));
        builtins.forEach(function (info) {
          listWrap.appendChild(builtinRow(info, function () {
            ensureCity(info.name).then(function (city) {
              sheetRef.close();
              openTripForm({ cityId: city.id, tripId: null });
            }).catch(function () {
              app().flash('创建城市失败，请重试');
            });
          }));
        });
      }

      // "create this exact name" affordance — last, after real suggestions
      if (q && !r.findCityByName(q)) {
        listWrap.appendChild(h('button.chooser__row.chooser__row--new', {
          type: 'button',
          onClick: function () { sheetRef.close(); openTripForm({ newCityName: q, tripId: null }); }
        }, [
          h('span.chooser__new-icon', [icon('plus', { size: 18, strokeWidth: 2.2 })]),
          h('div.chooser__new-text', [
            h('span.chooser__new-title', '新城市「' + q + '」'),
            h('span.chooser__new-sub', '城市库中没有，将按输入创建')
          ])
        ]));
      }

      if (!source.length && !builtins.length && !q) {
        listWrap.appendChild(parts.emptyState({
          glyph: 'compass',
          title: '还没有城市',
          message: '输入城市名开始记录'
        }));
      }

      if (!source.length && !builtins.length && q && r.findCityByName(q)) {
        listWrap.appendChild(h('p.chooser__hint', '该城市已存在，直接点击上面的「' + q + '」'));
      }
    }

    function chooserRow(entry, onClick) {
      var geo = M.geoLine(entry.city);
      return h('button.chooser__row', { type: 'button', onClick: onClick }, [
        h('span.chooser__row-badge', M.cityName(entry.city).charAt(0)),
        h('div.chooser__row-info.u-grow', [
          h('span.chooser__row-name', M.cityName(entry.city)),
          geo ? h('span.chooser__row-geo', geo) : null
        ]),
        entry.visitCount > 0
          ? h('span.chooser__row-visits', '去过 ' + entry.visitCount + ' 次')
          : h('span.chooser__row-visits.chooser__row-visits--none', '还没记录')
      ]);
    }

    input.addEventListener('input', U.debounce(function () {
      query = input.value;
      render();
    }, 120));

    // Enter on a brand-new name creates it directly
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = input.value.trim();
      if (!q) return;
      if (repo().findCityByName(q)) return;
      sheetRef.close();
      openTripForm({ newCityName: q, tripId: null });
    });

    render();
    setTimeout(function () { input.focus(); }, 300);
  }

  /**
   * 出发地：表单内嵌展开面板（不再用叠层 sheet——避免 UI 互挡与动画衔接问题）。
   * 带「常用出发地」记忆：选过的出发地置顶，下次一键点选。
   */
  function freqFroms() {
    try { return JSON.parse(localStorage.getItem('tf.fromFrequent.v1') || '[]') || []; }
    catch (e) { return []; }
  }

  function rememberFrom(name) {
    var list = freqFroms().filter(function (n) { return n !== name; });
    list.unshift(name);
    if (list.length > 5) list.length = 5;
    try { localStorage.setItem('tf.fromFrequent.v1', JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /** 常驻出发地（城市名）：未填出发地的行程自动用它画航线。返回完整 city 对象 */
  function readHomeCity() {
    try {
      var name = JSON.parse(localStorage.getItem('tf.homeCity.v1') || 'null');
      if (!name) return null;
      var c = repo().findCityByName(name);
      return c ? Object.assign({}, c, { name: M.cityName(c) }) : null;
    } catch (e) { return null; }
  }

  function readHomeCityId() {
    var home = readHomeCity();
    return home ? home.id : null;
  }

  /** 设置常驻出发地（叠层 sheet 独立场景），保存后回调 onDone */
  function setHomeCity(onDone) {
    var r = repo();
    var input = h('input.chooser__search-input', {
      type: 'text',
      placeholder: '输入城市名，如 徐州',
      autocomplete: 'off'
    });
    var listWrap = h('div.chooser__list');
    var sheetRef = null;

    function ensure(name) {
      var existing = r.findCityByName(name);
      if (existing) return Promise.resolve(existing);
      var d = TF.geo.cities.defaultsFor(name);
      return r.save('city', {
        name: name,
        country: d.country,
        province: d.province,
        latitude: d.latitude,
        longitude: d.longitude
      });
    }

    function save(city) {
      try { localStorage.setItem('tf.homeCity.v1', JSON.stringify(M.cityName(city))); } catch (e) { /* ignore */ }
      rememberFrom(M.cityName(city));
      sheetRef.close();
      if (typeof onDone === 'function') onDone(city);
    }

    function render() {
      UI.dom.clear(listWrap);
      var q = input.value.trim();

      if (!q) {
        var freq = freqFroms()
          .map(function (n) { return r.findCityByName(n); })
          .filter(Boolean);
        if (freq.length) {
          listWrap.appendChild(h('p.chooser__group', '常用出发地'));
          freq.forEach(function (c) {
            listWrap.appendChild(h('button.chooser__row', { type: 'button', onClick: function () { save(c); } }, [
              h('span.chooser__row-badge', M.cityName(c).charAt(0)),
              h('span.chooser__row-name', M.cityName(c))
            ]));
          });
        }
      }

      var mine = r.cityList().filter(function (e) {
        return !q || M.fuzzyMatch(e.city.name, q) || M.fuzzyMatch(e.city.province, q);
      });
      if (mine.length) {
        listWrap.appendChild(h('p.chooser__group', '我记录过的城市'));
        mine.forEach(function (e) {
          listWrap.appendChild(h('button.chooser__row', { type: 'button', onClick: function () { save(e.city); } }, [
            h('span.chooser__row-badge', M.cityName(e.city).charAt(0)),
            h('span.chooser__row-name', M.cityName(e.city))
          ]));
        });
      }

      var builtins = q ? TF.geo.cities.suggest(q, 6) : [];
      builtins = builtins.filter(function (info) {
        return !mine.some(function (e) { return M.cityName(e.city) === info.name; });
      });
      if (builtins.length) {
        listWrap.appendChild(h('p.chooser__group', '从城市库中选择'));
        builtins.forEach(function (info) {
          listWrap.appendChild(h('button.chooser__row', {
            type: 'button',
            onClick: function () { ensure(info.name).then(save).catch(function () { app().flash('创建城市失败，请重试'); }); }
          }, [
            h('span.chooser__row-badge', info.name.charAt(0)),
            h('span.chooser__row-name', info.name)
          ]));
        });
      }

      if (q && !r.findCityByName(q)) {
        listWrap.appendChild(h('button.chooser__row.chooser__row--new', {
          type: 'button',
          onClick: function () { ensure(q).then(save).catch(function () { app().flash('创建城市失败，请重试'); }); }
        }, [
          h('span.chooser__new-icon', [icon('plus', { size: 18, strokeWidth: 2.2 })]),
          h('span.chooser__new-title', '新城市「' + q + '」')
        ]));
      }

      if (!listWrap.firstChild) {
        listWrap.appendChild(h('p.chooser__hint', '输入城市名开始搜索'));
      }
    }

    input.addEventListener('input', U.debounce(function () { render(); }, 120));
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = input.value.trim();
      if (!q) return;
      ensure(q).then(save).catch(function () { app().flash('创建城市失败，请重试'); });
    });

    var sheet = h('div.sheet.sheet--tall', [
      h('div.sheet__handle'),
      h('h3.sheet__title', '设置常驻出发地'),
      h('p.sheet__sub', '没填出发地的行程会自动从这里出发连线'),
      h('div.chooser__search', [icon('search', { size: 17 }), input]),
      listWrap
    ]);
    sheetRef = parts.sheet(sheet, { onClose: function () {} });
    setTimeout(function () { input.focus(); }, 300);
  }

  /**
   * The trip form. Deliberately short: city + dates are the only required
   * fields; everything else is optional. Completable in well under a minute.
   */
  function openTripForm(opts) {
    var o = opts || {};
    var r = repo();
    var existing = o.tripId ? r.findTrip(o.tripId) : null;
    var isEdit = !!existing;

    var cityId = existing ? existing.cityId : (o.cityId || null);
    var newCityName = o.newCityName || null;

    /* --- resolve / create the city up front --- */
    var resolvedCity = cityId ? r.findCity(cityId) : null;

    var errorsFor = {};

    /* --- fields --- */
    var cityValueHolder = { id: cityId, name: newCityName || (resolvedCity ? resolvedCity.name : '') };
    var citySlot = h('div', {});
    var cityPanelList = h('div.from-panel__list');
    var cityPanelSearch = h('input.from-panel__input', {
      type: 'text',
      placeholder: '搜索或输入城市名',
      autocomplete: 'off'
    });
    var cityPanel = h('div.from-panel', { hidden: true }, [
      h('div.from-panel__search', [cityPanelSearch]),
      cityPanelList
    ]);
    var cityOps = h('div.form-picks__actions', { hidden: true });

    /* 统一交互：点卡片弹出「更换 / 清除」；同一时间只展开一个区块 */
    function closeOtherPickers(which) {
      if (which !== 'city') { cityOps.hidden = true; cityPanel.hidden = true; }
      if (which !== 'from' && typeof fromOps !== 'undefined') { fromOps.hidden = true; fromPanel.hidden = true; }
    }

    function renderCity() {
      UI.dom.clear(citySlot);
      var c = cityValueHolder.id ? r.findCity(cityValueHolder.id) : null;
      var displayName = c ? M.cityName(c) : (cityValueHolder.name || '');
      if (displayName) {
        var geo = c ? (M.geoLine(c) || '未填写地区') : '将创建新城市';
        citySlot.appendChild(h('div.form__locked.form__locked--tap', {
          role: 'button',
          tabindex: '0',
          'aria-label': displayName + '，点按可更换或清除',
          onClick: function () {
            closeOtherPickers('city');
            cityOps.hidden = !cityOps.hidden;
          }
        }, [
          h('span.form__locked-badge', displayName.charAt(0)),
          h('div.form__locked-info', [
            h('span.form__locked-name', displayName),
            h('span.form__locked-geo', geo)
          ]),
          h('span.form__locked-chev', [icon('chevron', { size: 14 })])
        ]));
        UI.dom.clear(cityOps);
        cityOps.appendChild(parts.ghostButton('更换', function () {
          cityOps.hidden = true;
          toggleCityPanel(true);
        }, { icon: 'refresh' }));
        cityOps.appendChild(parts.ghostButton('清除', function () {
          cityValueHolder.id = null;
          cityValueHolder.name = '';
          cityOps.hidden = true;
          renderCity();
        }, { icon: 'close' }));
        citySlot.appendChild(cityOps);
      } else {
        citySlot.appendChild(h('button.form__pick', {
          type: 'button',
          onClick: function () {
            closeOtherPickers('city');
            toggleCityPanel(false);
          }
        }, [
          h('span.form__pick-icon', [icon('pin', { size: 18 })]),
          h('span.form__pick-text', '选择城市'),
          icon('chevron', { size: 16 })
        ]));
      }
    }

    function toggleCityPanel(forceOpen) {
      closeOtherPickers('city');
      cityPanel.hidden = forceOpen === true ? false : !cityPanel.hidden;
      if (!cityPanel.hidden) {
        cityPanelSearch.value = '';
        renderCityPanel();
        setTimeout(function () {
          if (!('ontouchstart' in root)) cityPanelSearch.focus();
        }, 120);
      }
    }

    function renderCityPanel() {
      UI.dom.clear(cityPanelList);
      var q = cityPanelSearch.value.trim();
      function pickCity(city) {
        cityValueHolder.id = city.id;
        cityValueHolder.name = M.cityName(city);
        cityPanel.hidden = true;
        renderCity();
        TF.app.haptic();
      }
      var POPULAR = ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '重庆', '南京', '徐州', '香港', '东京'];
      var mine = r.cityList().filter(function (e) {
        return !q || M.fuzzyMatch(e.city.name, q) || M.fuzzyMatch(e.city.province, q);
      });
      if (mine.length) {
        cityPanelList.appendChild(h('p.from-panel__label', '我记录过的城市'));
        mine.forEach(function (e) {
          cityPanelList.appendChild(h('button.from-panel__row', {
            type: 'button',
            onClick: function () { pickCity(e.city); }
          }, [
            h('span.chooser__row-badge', M.cityName(e.city).charAt(0)),
            h('span.chooser__row-name', M.cityName(e.city))
          ]));
        });
      }
      var builtins = q ? TF.geo.cities.suggest(q, 6)
        : POPULAR.map(function (name) { return TF.geo.cities.lookup(name); }).filter(Boolean);
      builtins = builtins.filter(function (info) {
        return !mine.some(function (e) { return M.cityName(e.city) === info.name; });
      });
      if (builtins.length) {
        cityPanelList.appendChild(h('p.from-panel__label', q ? '从城市库中选择' : '热门城市'));
        builtins.forEach(function (info) {
          cityPanelList.appendChild(h('button.from-panel__row', {
            type: 'button',
            onClick: function () { ensureCityInline(info.name, pickCity); }
          }, [
            h('span.chooser__row-badge', info.name.charAt(0)),
            h('span.chooser__row-name', info.name)
          ]));
        });
      }
      if (q && !r.findCityByName(q)) {
        cityPanelList.appendChild(h('button.from-panel__row.from-panel__row--new', {
          type: 'button',
          onClick: function () { ensureCityInline(q, pickCity); }
        }, [
          h('span.chooser__new-icon', [icon('plus', { size: 16, strokeWidth: 2.2 })]),
          h('span.chooser__new-title', '新城市「' + q + '」')
        ]));
      }
      if (!cityPanelList.firstChild) {
        cityPanelList.appendChild(h('p.from-panel__hint', '输入城市名开始搜索'));
      }
    }

    function ensureCityInline(name, onOk) {
      var exist = r.findCityByName(name);
      var p = exist ? Promise.resolve(exist) : (function () {
        var d = TF.geo.cities.defaultsFor(name);
        return r.save('city', {
          name: name,
          country: d.country,
          province: d.province,
          latitude: d.latitude,
          longitude: d.longitude
        });
      })();
      p.then(onOk).catch(function () { app().flash('创建城市失败，请重试'); });
    }

    cityPanelSearch.addEventListener('input', U.debounce(function () { renderCityPanel(); }, 120));
    cityPanelSearch.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = cityPanelSearch.value.trim();
      if (!q) return;
      ensureCityInline(q, pickCity);
    });
    renderCity();

    var startField = dateField({
      label: '开始日期',
      value: existing ? existing.startDate : U.todayStr()
    });
    var endField = dateField({
      label: '结束日期',
      value: existing ? existing.endDate : U.todayStr()
    });

    /* --- 出发地（可选）：内嵌展开面板 + 常用出发地记忆 --- */
    /* 新建或编辑时，出发地默认预填「常驻出发地」（避免每次都要手选） */
    var fromHolder = { id: existing ? (existing.fromCityId || null) : null };
    if (!fromHolder.id) {
      var homePre = readHomeCity();
      var arrivalId = existing ? existing.cityId : (cityId || null);
      if (homePre && homePre.id !== arrivalId) fromHolder.id = homePre.id;
    }
    var fromSlot = h('div', {});
    var fromOps = h('div.form-picks__actions', { hidden: true });
    var fromList = h('div.from-panel__list');
    var fromSearch = h('input.from-panel__input', {
      type: 'text',
      placeholder: '搜索或输入城市名，如 徐州',
      autocomplete: 'off'
    });
    var fromPanel = h('div.from-panel', { hidden: true }, [
      h('div.from-panel__search', [fromSearch]),
      fromList
    ]);

    function ensureCityFrom(name) {
      var existingCity = r.findCityByName(name);
      var p = existingCity
        ? Promise.resolve(existingCity)
        : (function () {
            var d = TF.geo.cities.defaultsFor(name);
            return r.save('city', {
              name: name,
              country: d.country,
              province: d.province,
              latitude: d.latitude,
              longitude: d.longitude
            });
          })();
      p.then(function (city) { chooseFrom(city); })
       .catch(function () { app().flash('创建城市失败，请重试'); });
    }

    function chooseFrom(city) {
      fromHolder.id = city.id;
      rememberFrom(M.cityName(city));
      renderFrom();
      fromPanel.hidden = true;
      TF.app.haptic();
    }

    function toggleFromPanel(forceOpen) {
      closeOtherPickers('from');
      fromOps.hidden = true;
      fromPanel.hidden = forceOpen === true ? false : !fromPanel.hidden;
      if (!fromPanel.hidden) {
        fromSearch.value = '';
        renderFromPanel();
        setTimeout(function () {
          if (!('ontouchstart' in root)) fromSearch.focus();
        }, 120);
      }
    }

    function renderFrom() {
      UI.dom.clear(fromSlot);
      var fc = fromHolder.id ? r.findCity(fromHolder.id) : null;
      if (fc) {
        fromSlot.appendChild(h('div.form__locked.form__locked--tap', {
          role: 'button',
          tabindex: '0',
          'aria-label': M.cityName(fc) + '，点按可更换或清除',
          onClick: function () {
            closeOtherPickers('from');
            fromOps.hidden = !fromOps.hidden;
          }
        }, [
          h('span.form__locked-badge', M.cityName(fc).charAt(0)),
          h('div.form__locked-info', [
            h('span.form__locked-name', M.cityName(fc)),
            h('span.form__locked-geo', M.geoLine(fc) || '未填写地区')
          ]),
          h('span.form__locked-chev', [icon('chevron', { size: 14 })])
        ]));
        UI.dom.clear(fromOps);
        fromOps.appendChild(parts.ghostButton('更换', function () {
          fromOps.hidden = true;
          toggleFromPanel(true);
        }, { icon: 'refresh' }));
        fromOps.appendChild(parts.ghostButton('清除', function () {
          fromHolder.id = null;
          fromOps.hidden = true;
          renderFrom();
        }, { icon: 'close' }));
        fromSlot.appendChild(fromOps);
      } else {
        fromSlot.appendChild(h('button.form__pick', {
          type: 'button',
          onClick: function () {
            closeOtherPickers('from');
            toggleFromPanel(false);
          }
        }, [
          h('span.form__pick-icon', [icon('pin', { size: 18 })]),
          h('span.form__pick-text', '选择出发地（可选，用于地图航线）'),
          icon('chevron', { size: 16 })
        ]));
      }
    }

    function renderFromPanel() {
      UI.dom.clear(fromList);
      var q = fromSearch.value.trim();

      /* 常驻出发地（默认）置顶 + 常用出发地 */
      if (!q) {
        var homePre2 = readHomeCity();
        var chipSeen = {};
        var chipCities = [];
        if (homePre2) {
          chipCities.push({ city: homePre2, isHome: true });
          chipSeen[homePre2.name] = true;
        }
        freqFroms().forEach(function (n) {
          if (chipSeen[n]) return;
          var c = r.findCityByName(n);
          if (c) { chipCities.push({ city: c, isHome: false }); chipSeen[n] = true; }
        });
        if (chipCities.length) {
          fromList.appendChild(h('p.from-panel__label', '常用出发地'));
          var chips = h('div.from-chips');
          chipCities.forEach(function (item) {
            chips.appendChild(h('button.from-chip', {
              type: 'button',
              class: item.isHome ? 'from-chip--home' : '',
              onClick: function () { chooseFrom(item.city); }
            }, [
              h('span.from-chip__badge', M.cityName(item.city).charAt(0)),
              h('span.from-chip__name', M.cityName(item.city) + (item.isHome ? ' · 默认' : ''))
            ]));
          });
          fromList.appendChild(chips);
        }
      }

      /* 我记录过的城市 */
      var mine = r.cityList().filter(function (e) {
        return !q || M.fuzzyMatch(e.city.name, q) || M.fuzzyMatch(e.city.province, q);
      });
      if (mine.length) {
        fromList.appendChild(h('p.from-panel__label', '我记录过的城市'));
        mine.forEach(function (e) {
          fromList.appendChild(h('button.from-panel__row', {
            type: 'button',
            onClick: function () { chooseFrom(e.city); }
          }, [
            h('span.chooser__row-badge', M.cityName(e.city).charAt(0)),
            h('span.chooser__row-name', M.cityName(e.city))
          ]));
        });
      }

      /* 城市库联想（无搜索词时给热门城市兜底） */
      var POPULAR = ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '重庆', '南京', '徐州', '香港', '东京'];
      var builtins = q ? TF.geo.cities.suggest(q, 6)
        : POPULAR.map(function (name) { return TF.geo.cities.lookup(name); }).filter(Boolean);
      builtins = builtins.filter(function (info) {
        return !mine.some(function (e) { return M.cityName(e.city) === info.name; });
      });
      if (builtins.length) {
        fromList.appendChild(h('p.from-panel__label', q ? '从城市库中选择' : '热门城市'));
        builtins.forEach(function (info) {
          fromList.appendChild(h('button.from-panel__row', {
            type: 'button',
            onClick: function () { ensureCityFrom(info.name); }
          }, [
            h('span.chooser__row-badge', info.name.charAt(0)),
            h('span.chooser__row-name', info.name)
          ]));
        });
      }

      /* 新建城市 */
      if (q && !r.findCityByName(q)) {
        fromList.appendChild(h('button.from-panel__row.from-panel__row--new', {
          type: 'button',
          onClick: function () { ensureCityFrom(q); }
        }, [
          h('span.chooser__new-icon', [icon('plus', { size: 16, strokeWidth: 2.2 })]),
          h('span.chooser__new-title', '新城市「' + q + '」')
        ]));
      }

      if (!fromList.firstChild) {
        fromList.appendChild(h('p.from-panel__hint', '输入城市名开始搜索'));
      }
    }

    fromSearch.addEventListener('input', U.debounce(function () { renderFromPanel(); }, 120));
    fromSearch.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = fromSearch.value.trim();
      if (!q) return;
      ensureCityFrom(q);
    });
    renderFrom();

    var noteInput = h('textarea.field__input', {
      rows: 4,
      placeholder: '写下这次旅行想记住的事（可选）'
    });
    noteInput.value = existing && existing.note ? existing.note : '';

    /* --- pending photos & attachments (attached once the trip is saved) --- */
    var pendingPhotos = [];   // { file: Blob, url: objectURL }
    var pendingFiles = [];    // { file: {name, mime, bytes} }

    var photoThumbs = h('div.form-picks__thumbs');
    var fileRows = h('div.form-picks__files');

    function pickPhotosForForm(useCamera) {
      var picking = useCamera
        ? TF.native.capturePhoto().then(function (f) { return f ? [f] : []; })
        : TF.native.pickImages({ max: 20 });

      picking.then(function (files) {
        (files || []).filter(Boolean).forEach(function (f) {
          var blob = asBlob(f);
          if (!blob) return;
          pendingPhotos.push({
            file: blob,
            name: f.name || '',
            url: URL.createObjectURL(blob)
          });
        });
        renderPicks();
      }).catch(function (err) {
        app().flash((err && err.message) || '选择照片失败');
      });
    }

    function pickFileForForm() {
      TF.native.pickFile({ accept: '*/*' }).then(function (file) {
        if (!file) return;
        var bytes = file.bytes || new Uint8Array(0);
        if (!bytes.length) { app().flash('这个文件是空的'); return; }
        if (bytes.length > 64 * 1024 * 1024) { app().flash('文件超过 64 MB，暂不支持'); return; }
        pendingFiles.push({ file: file });
        renderPicks();
      }).catch(function (err) {
        app().flash((err && err.message) || '选择附件失败');
      });
    }

    function renderPicks() {
      UI.dom.clear(photoThumbs);
      pendingPhotos.forEach(function (item, i) {
        photoThumbs.appendChild(h('div.form-pick__thumb', [
          h('img', { src: item.url, alt: item.name || '' }),
          h('button.form-pick__remove', {
            type: 'button',
            'aria-label': '移除这张照片',
            onClick: function () {
              URL.revokeObjectURL(item.url);
              pendingPhotos.splice(i, 1);
              renderPicks();
            }
          }, [icon('close', { size: 11, strokeWidth: 2.4 })])
        ]));
      });
      photoThumbs.hidden = !pendingPhotos.length;

      UI.dom.clear(fileRows);
      pendingFiles.forEach(function (item, i) {
        var sizeKb = Math.max(1, Math.round((item.file.bytes ? item.file.bytes.length : 0) / 1024));
        fileRows.appendChild(h('div.form-pick__file', [
          icon('file', { size: 14 }),
          h('span.form-pick__name', (item.file.name || '附件') + ' · ' + sizeKb + ' KB'),
          h('button.form-pick__remove', {
            type: 'button',
            'aria-label': '移除这个附件',
            onClick: function () {
              pendingFiles.splice(i, 1);
              renderPicks();
            }
          }, [icon('close', { size: 11, strokeWidth: 2.4 })])
        ]));
      });
      fileRows.hidden = !pendingFiles.length;
    }

    /** Drop pending picks and free their preview URLs. */
    function releasePicks() {
      pendingPhotos.forEach(function (p) { URL.revokeObjectURL(p.url); });
      pendingPhotos = [];
      pendingFiles = [];
    }

    var countryInput = h('input.field__input', { type: 'text', placeholder: '例如 中国', autocomplete: 'off' });
    var provinceInput = h('input.field__input', { type: 'text', placeholder: '例如 广西', autocomplete: 'off' });

    if (resolvedCity) {
      countryInput.value = resolvedCity.country || '';
      provinceInput.value = resolvedCity.province || '';
    }

    // optional geo detail block, collapsed by default to keep the form short
    var advancedOpen = false;
    var advancedBody = h('div.form__advanced-body', { hidden: true }, [
      h('div.field-row', [
        h('label.field', [h('span.field__label', '国家 / 地区'), countryInput]),
        h('label.field', [h('span.field__label', '省 / 州'), provinceInput])
      ])
    ]);

    var advancedToggle = h('button.form__advanced-toggle', {
      type: 'button',
      onClick: function () {
        advancedOpen = !advancedOpen;
        advancedBody.hidden = !advancedOpen;
        advancedToggle.classList.toggle('is-open', advancedOpen);
      }
    }, [
      icon('chevron', { size: 15 }),
      h('span', '国家 / 地区（可选）')
    ]);

    var errorBox = h('div.form__errors', { hidden: true });

    var form = h('div.sheet.sheet--form', [
      h('div.sheet__handle'),
      h('h3.sheet__title', isEdit ? '编辑旅行' : '添加足迹'),
      h('p.sheet__sub', isEdit ? '修改这次旅行的时间或备注' : '选好城市和日期就可以了，其他都可以稍后补充'),

      h('div.form__body', [
        h('section.form__group', [
          h('span.form__group-label', '城市'),
          citySlot,
          cityPanel
        ]),

        h('section.form__group', [
          h('span.form__group-label', '出发地（可选）'),
          fromSlot,
          fromPanel
        ]),

        h('section.form__group', [
          h('span.form__group-label', '日期'),
          h('div.field-row', [startField.el, endField.el])
        ]),

        h('section.form__group', [
          h('span.form__group-label', '备注'),
          noteInput
        ]),

        h('section.form__group', [
          h('span.form__group-label', '照片（可选）'),
          h('div.form-picks', [
            photoThumbs,
            h('div.form-picks__actions', [
              parts.ghostButton('从相册选择', function () { pickPhotosForForm(false); }, { icon: 'image' }),
              TF.native.canCapture()
                ? parts.ghostButton('拍照', function () { pickPhotosForForm(true); }, { icon: 'camera' })
                : null
            ])
          ])
        ]),

        h('section.form__group', [
          h('span.form__group-label', '附件（可选）'),
          h('div.form-picks', [
            fileRows,
            h('div.form-picks__actions', [
              parts.ghostButton('选择文件', pickFileForForm, { icon: 'upload' })
            ])
          ])
        ]),

        advancedToggle,
        advancedBody,
        errorBox
      ]),

      h('div.sheet__actions', [
        parts.ghostButton('取消', function () { formRef.close(); }, { block: true }),
        parts.primaryButton(isEdit ? '保存修改' : '保存足迹', submit, {
          block: true,
          icon: isEdit ? null : 'check'
        })
      ])
    ]);

    var formRef = parts.sheet(form, { variant: 'sheet', onClose: releasePicks });

    setTimeout(function () {
      var first = form.querySelector('input[type=date]');
      // don't autofocus dates on mobile (it pops a native picker immediately)
      if (first && !('ontouchstart' in root)) first.focus();
    }, 320);

    function showErrors(errors) {
      UI.dom.clear(errorBox);
      var keys = Object.keys(errors);
      if (!keys.length) { errorBox.hidden = true; return; }
      errorBox.hidden = false;
      keys.forEach(function (k) {
        errorBox.appendChild(h('p.form__error', errors[k]));
      });
    }

    function submit() {
      var startDate = startField.value;
      var endDate = endField.value || startDate;

      var payload = {
        startDate: startDate,
        endDate: endDate,
        note: noteInput.value,
        cityId: cityValueHolder.id || null,
        fromCityId: fromHolder.id || null
      };

      var validation = M.validate('trip', payload);
      var errors = Object.assign({}, validation.errors);

      if (!payload.cityId && !cityValueHolder.name) errors.cityId = '请选择城市';

      // normalise impossible ranges
      if (startDate && endDate && endDate < startDate) {
        errors.endDate = '结束日期不能早于开始日期';
      }

      if (Object.keys(errors).length) {
        showErrors(errors);
        TF.app.haptic();
        return;
      }

      errorBox.hidden = true;

      runSave(payload);
    }

    /** Small blocking dialog while picked photos compress into blobs. */
    var formProgress = null;
    function showFormProgress() {
      formProgress = parts.overlay(h('div.progress-dialog.anim-pop', [
        h('h3.progress-dialog__title', '正在保存照片与附件'),
        h('p.progress-dialog__hint', '正在压缩并写入本机…')
      ]), { variant: 'center', dismissible: false });
    }
    function closeFormProgress() {
      if (formProgress) { formProgress.close(); formProgress = null; }
    }

    /** Write every pending pick into the blob store + DB for tripId. */
    function savePendingFor(tripId) {
      var r2 = repo();
      var photoChain = Promise.resolve();

      if (pendingPhotos.length) {
        photoChain = photoChain.then(function () {
          return TF.image.processFiles(pendingPhotos.map(function (p) { return p.file; }), {
            concurrency: 2
          }).then(function (out) {
            var saves = [];
            out.results.forEach(function (item) {
              if (!item || !item.ok) return;
              var blobId = U.uuid();
              var thumbId = 'thumb-' + blobId;
              saves.push(
                r2.putBlob(blobId, item.value.full, 'image/jpeg')
                  .then(function () { return r2.putBlob(thumbId, item.value.thumb, 'image/jpeg'); })
                  .then(function () {
                    return r2.save('photo', {
                      tripId: tripId,
                      blobId: blobId,
                      thumbBlobId: thumbId,
                      width: item.value.width,
                      height: item.value.height,
                      bytes: item.value.bytes
                    });
                  })
              );
            });
            return Promise.all(saves);
          });
        });
      }

      var fileChain = Promise.resolve();
      if (pendingFiles.length) {
        fileChain = fileChain.then(function () {
          var saves = pendingFiles.map(function (item) {
            var f = item.file;
            var bytes = f.bytes || new Uint8Array(0);
            var blobId = U.uuid();
            return r2.putBlob(blobId, bytes, f.mime || 'application/octet-stream')
              .then(function () {
                return r2.save('attachment', {
                  tripId: tripId,
                  name: f.name || 'attachment',
                  mimeType: f.mime || 'application/octet-stream',
                  blobId: blobId,
                  bytes: bytes.length
                });
              });
          });
          return Promise.all(saves);
        });
      }

      return photoChain.then(function () { return fileChain; });
    }

    function runSave(payload) {
      var r2 = repo();

      // 1. make sure the city exists (create when it's a new name)
      var cityPromise;
      if (payload.cityId) {
        cityPromise = Promise.resolve(r2.findCity(payload.cityId));
      } else {
        var existingCity = r2.findCityByName(cityValueHolder.name);
        if (existingCity) {
          cityPromise = Promise.resolve(existingCity);
        } else {
          var defaults = TF.geo.cities.defaultsFor(cityValueHolder.name);
          cityPromise = r2.save('city', {
            name: cityValueHolder.name,
            country: countryInput.value || defaults.country,
            province: provinceInput.value || defaults.province,
            latitude: defaults.latitude,
            longitude: defaults.longitude
          });
        }
      }

      cityPromise.then(function (city) {
        if (!city) throw new Error('城市创建失败');

        // 2. keep city geo fields in sync when the user edited them
        var patch = {};
        if (countryInput.value !== (city.country || '')) patch.country = countryInput.value;
        if (provinceInput.value !== (city.province || '')) patch.province = provinceInput.value;

        var chain = Object.keys(patch).length
          ? r2.save('city', Object.assign({ id: city.id }, patch))
          : Promise.resolve(city);

        return chain.then(function () {
          var tripPayload = {
            cityId: city.id,
            /* 出发地与到达地相同则不存 */
            fromCityId: payload.fromCityId && payload.fromCityId !== city.id ? payload.fromCityId : null,
            startDate: payload.startDate,
            endDate: payload.endDate,
            note: payload.note
          };
          if (isEdit) tripPayload.id = existing.id;
          return r2.save('trip', tripPayload);
        }).then(function (trip) {
          // 3. attach anything the user picked in the form
          if (!pendingPhotos.length && !pendingFiles.length) return trip;
          showFormProgress();
          return savePendingFor(trip.id).then(function () {
            closeFormProgress();
            return trip;
          }).catch(function (err) {
            closeFormProgress();
            // the trip itself is already saved — picks failing is not fatal
            app().flash((err && err.message) || '部分照片或附件保存失败');
            return trip;
          });
        }).then(function (trip) {
          releasePicks();
          formRef.close();
          after(isEdit ? '旅行已更新' : '足迹已记录');
          return trip;
        });
      }).catch(function (err) {
        showErrors({ _: err && err.message ? err.message : '保存失败' });
      });
    }
  }

  /* ==================================================================== */
  /*  EDIT / DELETE CITY                                                  */
  /* ==================================================================== */

  function editCity(cityId) {
    var r = repo();
    var city = r.findCity(cityId);
    if (!city) return;

    var nameInput = h('input.field__input', { type: 'text', autocomplete: 'off' });
    nameInput.value = city.name || '';

    var countryInput = h('input.field__input', { type: 'text', placeholder: '例如 中国', autocomplete: 'off' });
    countryInput.value = city.country || '';

    var provinceInput = h('input.field__input', { type: 'text', placeholder: '例如 广西', autocomplete: 'off' });
    provinceInput.value = city.province || '';

    var errorBox = h('div.form__errors', { hidden: true });

    var sheetRef = parts.sheet(h('div.sheet.sheet--form', [
      h('div.sheet__handle'),
      h('h3.sheet__title', '编辑城市'),
      h('div.form__body', [
        h('section.form__group', [
          h('span.form__group-label', '城市名称'),
          h('label.field', [nameInput])
        ]),
        h('div.field-row', [
          h('label.field', [h('span.field__label', '国家 / 地区'), countryInput]),
          h('label.field', [h('span.field__label', '省 / 州'), provinceInput])
        ]),
        errorBox
      ]),
      h('div.sheet__actions', [
        parts.ghostButton('取消', function () { sheetRef.close(); }, { block: true }),
        parts.primaryButton('保存', submit, { block: true })
      ])
    ]));

    function submit() {
      var name = nameInput.value;
      var trimmed = (name || '').trim();

      var errors = {};
      if (!trimmed) errors.name = '请填写城市名称';

      // renaming onto an existing city would merge two records silently
      var clash = r.findCityByName(trimmed);
      if (clash && clash.id !== city.id) {
        errors.name = '已存在同名城市';
      }

      if (Object.keys(errors).length) {
        UI.dom.clear(errorBox);
        errorBox.hidden = false;
        errorBox.appendChild(h('p.form__error', errors.name));
        return;
      }

      // refresh coordinates when the name changed to a known place
      var nextGeo = {};
      if (trimmed !== city.name) {
        var hit = TF.geo.cities.lookup(trimmed);
        if (hit) {
          nextGeo.latitude = hit.lat;
          nextGeo.longitude = hit.lng;
          if (!countryInput.value && !city.country) nextGeo.country = hit.country;
          if (!provinceInput.value && !city.province) nextGeo.province = hit.province;
        }
      }

      repo().save('city', Object.assign({
        id: city.id,
        name: trimmed,
        country: countryInput.value,
        province: provinceInput.value
      }, nextGeo)).then(function () {
        sheetRef.close();
        after('城市已更新');
      }).catch(function (e) {
        UI.dom.clear(errorBox);
        errorBox.hidden = false;
        errorBox.appendChild(h('p.form__error', e.message || '保存失败'));
      });
    }

    setTimeout(function () { nameInput.focus(); }, 300);
  }

  function deleteCity(cityId) {
    var r = repo();
    var city = r.findCity(cityId);
    if (!city) return;

    var trips = r.tripsOfCity(cityId);
    var photoCount = 0;
    var attCount = 0;
    trips.forEach(function (t) {
      photoCount += r.photosOfTrip(t.id).length;
      attCount += r.attachmentsOfTrip(t.id).length;
    });

    var detailBits = [];
    if (trips.length) detailBits.push(trips.length + ' 次旅行');
    if (photoCount) detailBits.push(photoCount + ' 张照片');
    if (attCount) detailBits.push(attCount + ' 个附件');

    parts.confirm({
      title: '删除「' + M.cityName(city) + '」？',
      message: '即将移到回收站，可以随时恢复。',
      detail: detailBits.length ? '同时移入回收站：' + detailBits.join('、') : null,
      confirmLabel: '移到回收站',
      danger: true,
      onConfirm: function () {
        r.softDelete('city', cityId).then(function () {
          TF.app.router.showTab('cities');
          after('已移到回收站');
        });
      }
    });
  }

  function deleteTrip(tripId) {
    var r = repo();
    var trip = r.findTrip(tripId);
    if (!trip) return;

    var photos = r.photosOfTrip(tripId).length;
    var atts = r.attachmentsOfTrip(tripId).length;

    parts.confirm({
      title: '删除这次旅行？',
      message: U.formatRange(trip.startDate, trip.endDate) + ' 的记录将移到回收站。',
      detail: (photos || atts)
        ? '同时移入回收站：' + [photos ? photos + ' 张照片' : null, atts ? atts + ' 个附件' : null].filter(Boolean).join('、')
        : null,
      confirmLabel: '移到回收站',
      danger: true,
      onConfirm: function () {
        r.softDelete('trip', tripId).then(function () {
          after('已移到回收站');
        });
      }
    });
  }

  function editTrip(tripId, opts) {
    openTripForm({ tripId: tripId });
  }

  /* ==================================================================== */
  /*  PHOTOS                                                              */
  /* ==================================================================== */

  function addPhotos(tripId) {
    var r = repo();
    var trip = r.findTrip(tripId);
    if (!trip) return;

    var menu = h('div.sheet', [
      h('div.sheet__handle'),
      h('h3.sheet__title', '添加照片'),
      h('div.sheet__list', [
        sheetAction('image', '从相册选择', function () { sheetRef.close(); pickAndStore(tripId, false); }),
        TF.native.canCapture()
          ? sheetAction('camera', '拍照', function () { sheetRef.close(); pickAndStore(tripId, true); })
          : null
      ])
    ]);

    var sheetRef = parts.sheet(menu);
  }

  function sheetAction(iconName, label, onClick) {
    return h('button.sheet__item', { type: 'button', onClick: onClick }, [
      h('span.sheet__item-icon', [icon(iconName, { size: 18 })]),
      h('span.sheet__item-label', label)
    ]);
  }

  function pickAndStore(tripId, useCamera) {
    var r = repo();

    var progressRef = null;

    function showProgress(done, total) {
      if (!progressRef) {
        progressRef = parts.overlay(h('div.progress-dialog.anim-pop', [
          h('h3.progress-dialog__title', '正在处理照片'),
          h('p.progress-dialog__hint', '正在压缩并保存到本机'),
          h('div.progress-dialog__bar', [h('span.progress-dialog__fill')])
        ]), { variant: 'center', dismissible: false });
      }
      var fill = progressRef.el.querySelector('.progress-dialog__fill');
      var pct = total ? Math.round((done / total) * 100) : 0;
      if (fill) fill.style.width = pct + '%';
      var title = progressRef.el.querySelector('.progress-dialog__title');
      if (title) title.textContent = '正在处理照片 ' + done + ' / ' + total;
    }

    var picking = useCamera
      ? TF.native.capturePhoto().then(function (f) { return f ? [f] : []; })
      : TF.native.pickImages({ max: 30 });

    picking.then(function (files) {
      var list = (files || []).filter(Boolean);
      if (!list.length) return null;

      showProgress(0, list.length);

      return TF.image.processFiles(list.map(asBlob), {
        concurrency: 2,
        onProgress: function (done, total) { showProgress(done, total); }
      }).then(function (out) {
        var saved = 0;
        var failed = 0;

        return out.results.reduce(function (chain, item) {
          return chain.then(function () {
            if (!item || !item.ok) { failed++; return; }
            var blobId = U.uuid();
            var thumbId = 'thumb-' + blobId;

            return r.putBlob(blobId, item.value.full, 'image/jpeg')
              .then(function () { return r.putBlob(thumbId, item.value.thumb, 'image/jpeg'); })
              .then(function () {
                return r.save('photo', {
                  tripId: tripId,
                  blobId: blobId,
                  thumbBlobId: thumbId,
                  width: item.value.width,
                  height: item.value.height,
                  bytes: item.value.bytes
                });
              })
              .then(function () { saved++; })
              .catch(function () { failed++; });
          });
        }, Promise.resolve()).then(function () {
          return { saved: saved, failed: failed };
        });
      });
    }).then(function (result) {
      if (progressRef) { progressRef.close(); progressRef = null; }
      if (!result) return;

      app().router.refreshAll();

      if (result.saved && !result.failed) app().flash('已添加 ' + result.saved + ' 张照片');
      else if (result.saved && result.failed) app().flash('已添加 ' + result.saved + ' 张，' + result.failed + ' 张失败');
      else if (result.failed) app().flash('照片添加失败，可能是格式不支持');
    }).catch(function (err) {
      if (progressRef) { progressRef.close(); progressRef = null; }
      app().flash((err && err.message) || '添加照片失败');
    });
  }

  /** Full-screen photo viewer with swipe navigation. */
  function viewPhoto(photos, startIndex) {
    if (!photos || !photos.length) return;

    var index = U.clamp(startIndex || 0, 0, photos.length - 1);
    var currentUrl = null;

    var img = h('img.viewer__img', { alt: '' });
    var counter = h('span.viewer__counter', (index + 1) + ' / ' + photos.length);

    function load(i) {
      var photo = photos[i];
      if (!photo) return;
      app().resolveBlobUrl(photo.blobId).then(function (url) {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = url;
        img.src = url;
      }).catch(function () {
        img.removeAttribute('src');
        app().flash('无法读取这张照片');
      });
      counter.textContent = (i + 1) + ' / ' + photos.length;
    }

    var body = h('div.viewer', [
      h('div.viewer__stage', [img]),
      h('div.viewer__chrome', [
        h('div.viewer__top', [
          counter,
          h('div.viewer__top-actions', [
            TF.native.canCapture() ? null : null,
            parts.iconButton('close', function () { viewer.close(); }, { label: '关闭', size: 22 })
          ])
        ]),
        photos.length > 1
          ? h('div.viewer__bottom', [
              parts.iconButton('back', function () { go(-1); }, { label: '上一张', size: 22 }),
              h('div.viewer__dots', photos.map(function (_, i) {
                return h('span.viewer__dot', { class: i === index ? 'is-active' : '' });
              })),
              parts.iconButton('chevron', function () { go(1); }, { label: '下一张', size: 22 })
            ])
          : null,
        h('div.viewer__danger', [
          parts.ghostButton('删除这张照片', function () { askDelete(); }, {
            icon: 'trash',
            class: 'btn--danger-ghost'
          })
        ])
      ])
    ]);

    var viewer = parts.overlay(body, {
      variant: 'fullscreen',
      class: 'overlay--viewer',
      onClose: function () {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
      }
    });

    // tapping anywhere on the photo stage (blank space) dismisses the viewer
    var stage = body.querySelector('.viewer__stage');
    if (stage) {
      stage.addEventListener('click', function () { viewer.close(); });
    }

    function go(delta) {
      var next = index + delta;
      if (next < 0 || next >= photos.length) return;
      index = next;
      load(index);
      var dots = body.querySelectorAll('.viewer__dot');
      Array.prototype.forEach.call(dots, function (d, i) {
        d.classList.toggle('is-active', i === index);
      });
    }

    function askDelete() {
      var photo = photos[index];
      parts.confirm({
        title: '删除这张照片？',
        message: '照片会移到回收站，可以恢复。',
        confirmLabel: '删除',
        danger: true,
        onConfirm: function () {
          repo().softDelete('photo', photo.id).then(function () {
            viewer.close();
            app().router.refreshAll();
            app().flash('照片已移到回收站');
          });
        }
      });
    }

    // swipe navigation
    var startX = 0;
    var startY = 0;
    body.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    body.addEventListener('touchend', function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) viewer.close();
    }, { passive: true });

    // keyboard
    function onKey(e) {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') viewer.close();
    }
    document.addEventListener('keydown', onKey);
    var origClose = viewer.close;
    viewer.close = function () {
      document.removeEventListener('keydown', onKey);
      origClose();
    };

    load(index);
  }

  /* ==================================================================== */
  /*  ATTACHMENTS                                                         */
  /* ==================================================================== */

  function addAttachment(tripId) {
    TF.native.pickFile({ accept: '*/*' }).then(function (file) {
      if (!file) return null;
      if (!file.bytes || !file.bytes.length) {
        app().flash('这个文件是空的');
        return null;
      }

      // guard against absurdly large files degrading the app
      var MAX = 64 * 1024 * 1024;
      if (file.bytes.length > MAX) {
        app().flash('文件超过 64 MB，暂不支持');
        return null;
      }

      var blobId = U.uuid();
      return repo().putBlob(blobId, file.bytes, file.mime || 'application/octet-stream')
        .then(function () {
          return repo().save('attachment', {
            tripId: tripId,
            name: file.name || 'attachment',
            mimeType: file.mime || 'application/octet-stream',
            blobId: blobId,
            bytes: file.bytes.length
          });
        })
        .then(function () {
          app().router.refreshAll();
          app().flash('已添加附件');
        });
    }).catch(function (err) {
      app().flash((err && err.message) || '添加附件失败');
    });
  }

  function openAttachment(attId) {
    var att = repo().findAttachment(attId);
    if (!att) return;

    repo().getBlob(att.blobId).then(function (blob) {
      if (!blob) { app().flash('附件内容已丢失'); return; }

      var type = att.mimeType || 'application/octet-stream';
      var file = new File([blob.bytes], att.name || 'attachment', { type: type });
      var url = URL.createObjectURL(file);

      // images render inline; anything else is handed to the OS / browser
      if (type.indexOf('image/') === 0) {
        parts.overlay(h('div.viewer.viewer--att', [
          h('div.viewer__stage', [h('img.viewer__img', { src: url, alt: att.name || '' })]),
          h('div.viewer__chrome', [
            h('div.viewer__top', [
              h('span.viewer__counter.u-ellipsis', att.name || '附件'),
              parts.iconButton('close', function () { ref.close(); }, { label: '关闭', size: 22 })
            ])
          ])
        ]), {
          variant: 'fullscreen',
          class: 'overlay--viewer',
          onClose: function () { URL.revokeObjectURL(url); }
        });
        return;
      }

      var opened = false;
      try {
        var win = root.open(url, '_blank');
        opened = !!win;
      } catch (e) { opened = false; }

      if (!opened) {
        var a = h('a', { href: url, download: att.name || 'attachment' });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 3000);
        app().flash('已开始下载附件');
      }
    });
  }

  function deleteAttachment(attId) {
    parts.confirm({
      title: '删除这个附件？',
      message: '附件会移到回收站，可以恢复。',
      confirmLabel: '删除',
      danger: true,
      onConfirm: function () {
        repo().softDelete('attachment', attId).then(function () {
          app().router.refreshAll();
          app().flash('附件已移到回收站');
        });
      }
    });
  }

  /* ==================================================================== */
  function kindLabel(kind) {
    return kind === 'city' ? '城市' : kind === 'trip' ? '旅行'
         : kind === 'photo' ? '照片' : '附件';
  }

  /* ==================================================================== */
  /*  RECYCLE BIN                                                         */
  /* ==================================================================== */

  function openRecycleBin() {
    var screen = h('section.screen-bin');

    function render() {
      var r = repo();
      var bin = r.recycleBin();

      UI.dom.clear(screen);

      screen.appendChild(parts.pageHeader({
        title: '回收站',
        subtitle: bin.total ? bin.total + ' 项已删除的内容' : '这里还没有内容',
        showBack: true,
        onBack: function () { app().router.back(); },
        right: bin.total
          ? parts.iconButton('trash', function () { askEmpty(bin); }, { label: '清空回收站' })
          : null
      }));

      var scroller = h('div.bin-scroll.scroll');

      if (!bin.total) {
        scroller.appendChild(parts.emptyState({
          glyph: 'trash',
          title: '回收站是空的',
          message: '删除的旅行、城市和照片会先放在这里，可以随时恢复'
        }));
        screen.appendChild(scroller);
        return;
      }

      var list = h('div.bin-list');

      bin.items.forEach(function (item) {
        list.appendChild(h('div.bin-item', [
          h('div.bin-item__main.u-grow', [
            h('p.bin-item__title', item.title),
            h('p.bin-item__sub', [
              h('span.bin-item__type', kindLabel(item.kind)),
              h('span.bin-item__sep', '·'),
              h('span', item.subtitle || '')
            ]),
            item.orphan ? h('p.bin-item__warn', '原城市已删除，恢复时会一并恢复') : null
          ]),
          h('div.bin-item__actions', [
            h('button.bin-btn.bin-btn--restore', {
              type: 'button',
              onClick: function () { restore(item); }
            }, [icon('restore', { size: 15 }), '恢复']),
            h('button.bin-btn.bin-btn--purge', {
              type: 'button',
              onClick: function () { purge(item); }
            }, [icon('close', { size: 15 }), '彻底删除'])
          ])
        ]));
      });

      // photos and attachments swept up by a parent deletion
      if (bin.photos.length || bin.attachments.length) {
        list.appendChild(h('p.bin-list__note',
          '另有 ' + bin.photoCount + ' 张照片、' + bin.attachmentCount +
          ' 个附件随所属记录一起在回收站中，恢复对应旅行会自动恢复它们。'));
      }

      scroller.appendChild(list);
      screen.appendChild(scroller);
    }

    function restore(item) {
      repo().restore(item.kind, item.row.id).then(function () {
        render();
        app().router.refreshAll();
        app().flash('已恢复');
      });
    }

    function purge(item) {
      var warning = item.kind === 'city'
        ? '这座城市及其全部旅行记录、照片和附件将被永久删除，无法找回。'
        : item.kind === 'trip'
          ? '这次旅行及其照片、附件将被永久删除，无法找回。'
          : '这项内容将被永久删除，无法找回。';

      parts.confirm({
        title: '彻底删除？',
        message: warning,
        confirmLabel: '永久删除',
        danger: true,
        onConfirm: function () {
          repo().purge(item.kind, item.row.id).then(function () {
            render();
            app().router.refreshAll();
            app().flash('已永久删除');
          });
        }
      });
    }

    function askEmpty(bin) {
      parts.confirm({
        title: '清空回收站？',
        message: '共 ' + bin.total + ' 项内容将被永久删除。',
        detail: '此操作无法撤销，删除后数据无法找回。',
        confirmLabel: '永久删除全部',
        danger: true,
        onConfirm: function () {
          repo().purgeAll().then(function () {
            render();
            app().router.refreshAll();
            app().flash('回收站已清空');
          });
        }
      });
    }

    render();
    app().router.push('bin', {}, screen);
  }

  /* ==================================================================== */
  /*  SEARCH (global)                                                     */
  /* ==================================================================== */

  function openSearch(initialQuery) {
    var r = repo();
    var query = initialQuery || '';
    var results = h('div.search-results');

    var input = h('input.search-input', {
      type: 'search',
      placeholder: '搜索城市、备注…',
      autocomplete: 'off',
      spellcheck: 'false'
    });
    input.value = query;

    var sheetRef = parts.sheet(h('div.sheet.sheet--tall.sheet--search', [
      h('div.sheet__handle'),
      h('div.search-bar', [
        icon('search', { size: 18 }),
        input,
        h('button.search-bar__cancel', {
          type: 'button',
          onClick: function () { sheetRef.close(); }
        }, '取消')
      ]),
      results
    ]));

    function render() {
      UI.dom.clear(results);
      var q = query.trim();

      if (!q) {
        results.appendChild(h('div.search-hints', [
          h('p.search-hints__title', '可以搜索'),
          h('div.search-hints__chips', [
            hintChip('城市名，例如 桂林'),
            hintChip('省份，例如 广西'),
            hintChip('备注里的词，例如 漓江')
          ])
        ]));
        return;
      }

      var hit = M.search(q, r.allCities(), r.allTrips());

      if (!hit.cities.length && !hit.trips.length) {
        results.appendChild(parts.emptyState({
          glyph: 'search',
          title: '没有找到「' + q + '」',
          message: '换个关键词试试，比如城市名或备注里的词'
        }));
        return;
      }

      if (hit.cities.length) {
        results.appendChild(h('p.search-group', '城市 · ' + hit.cities.length));
        hit.cities.forEach(function (city) {
          var entry = r.cityList().find(function (e) { return e.city.id === city.id; });
          results.appendChild(parts.cityCard(entry || { city: city, visitCount: 0 }, {
            onClick: function () {
              sheetRef.close();
              setTimeout(function () { app().router.push('city', { cityId: city.id }); }, 180);
            }
          }));
        });
      }

      if (hit.trips.length) {
        results.appendChild(h('p.search-group', '旅行记录 · ' + hit.trips.length));
        hit.trips.slice(0, 40).forEach(function (trip) {
          var city = r.findCity(trip.cityId);
          var photos = r.photosOfTrip(trip.id).length;
          results.appendChild(h('button.search-trip', {
            type: 'button',
            onClick: function () {
              sheetRef.close();
              setTimeout(function () {
                app().router.push('city', { cityId: trip.cityId, focusTripId: trip.id });
              }, 180);
            }
          }, [
            h('div.search-trip__top', [
              h('span.search-trip__city', city ? M.cityName(city) : '未命名地点'),
              h('span.search-trip__date', U.formatRange(trip.startDate, trip.endDate))
            ]),
            trip.note ? h('p.search-trip__note.t-clamp-2', highlight(trip.note, q)) : null,
            photos ? h('span.search-trip__photos', photos + ' 张照片') : null
          ]));
        });
      }
    }

    function hintChip(text) {
      return h('button.search-chip', {
        type: 'button',
        onClick: function () {
          var word = text.split('，').pop();
          input.value = word;
          query = word;
          render();
        }
      }, text);
    }

    /** Wrap matched substrings so results feel responsive to the query. */
    function highlight(text, q) {
      var str = String(text || '');
      var idx = str.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return str;

      var frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(str.slice(0, idx)));
      var mark = h('mark.search-mark', str.slice(idx, idx + q.length));
      frag.appendChild(mark);
      frag.appendChild(document.createTextNode(str.slice(idx + q.length)));
      return frag;
    }

    input.addEventListener('input', U.debounce(function () {
      query = input.value;
      render();
    }, 120));

    render();
    setTimeout(function () { input.focus(); }, 320);

    return sheetRef;
  }

  /* ==================================================================== */
  /*  SETTINGS                                                            */
  /* ==================================================================== */

  function openSettings() {
    var r = repo();
    var stats = r.stats();
    var caps = TF.native.capabilities();

    var sheetRef = parts.sheet(h('div.sheet.sheet--tall', [
      h('div.sheet__handle'),
      h('h3.sheet__title', '设置与数据'),

      h('section.settings-group', [
        h('p.settings-group__label', '数据概览'),
        h('div.settings-stats', [
          settingsStat(stats.cityCount, '城市'),
          settingsStat(stats.tripCount, '旅行'),
          settingsStat(stats.photoCount, '照片'),
          settingsStat(stats.attachmentCount, '附件')
        ]),
        h('p.settings-storage', { class: 'settings-storage' }, '正在读取存储占用…')
      ]),

      h('section.settings-group', [
        h('p.settings-group__label', '外观'),
        h('p.settings-storage', { class: 'settings-storage' }, '外观（浅色 / 深色 / 跟随系统）由 ETHAN 统一设置中心管理。')
      ]),

      h('section.settings-group', [
        h('p.settings-group__label', '回收站'),
        settingsItem('trash', '打开回收站', '恢复或永久删除已删除的内容', function () {
          sheetRef.close();
          setTimeout(openRecycleBin, 180);
        })
      ]),

      h('section.settings-group', [
        h('p.settings-group__label', '关于'),
        h('div.settings-about', [
          h('p.settings-about__row', [h('span', '版本'), h('span', 'v' + TF.backup.APP_VERSION)]),
          h('p.settings-about__row', [h('span', '运行环境'), h('span', caps.platform === 'android' ? 'Android App' : '浏览器')]),
          h('p.settings-about__row', [h('span', '网络'), h('span', caps.offline ? '离线' : '未使用网络')]),
          h('p.settings-about__note', '「旅行足迹」完全离线运行，你的所有数据只保存在这台设备上，不会上传到任何服务器。')
        ])
      ]),

      h('section.settings-group.settings-group--danger', [
        h('p.settings-group__label', '危险操作'),
        settingsItem('trash', '清空全部数据', '删除所有城市、旅行、照片与附件', function () {
          sheetRef.close();
          setTimeout(askWipeAll, 180);
        }, true)
      ])
    ]));

    // storage estimate is async; fill it in when it arrives
    TF.idb.estimateUsage().then(function (est) {
      var el = sheetRef.el.querySelector('.settings-storage');
      if (!el) return;
      if (est.usage) {
        var mb = (est.usage / 1048576).toFixed(1);
        var quota = est.quota ? ' / ' + (est.quota / 1073741824).toFixed(1) + ' GB' : '';
        el.textContent = '本地已使用 ' + mb + ' MB' + quota;
      } else {
        el.textContent = '数据保存在本机浏览器存储中';
      }
    }).catch(function () {});
  }

  function settingsStat(value, label) {
    return h('div.settings-stat', [
      h('span.settings-stat__num', String(value)),
      h('span.settings-stat__label', label)
    ]);
  }

  /** One of the three appearance choices; highlights the active mode live. */
  function themeOption(iconName, label, mode) {
    var btn = h('button.theme-option', {
      type: 'button',
      class: TF.theme && TF.theme.get() === mode ? 'is-active' : '',
      dataset: { themeMode: mode },
      'aria-pressed': TF.theme && TF.theme.get() === mode ? 'true' : 'false',
      onClick: function () {
        if (TF.theme) TF.theme.set(mode);
        UI.dom.$$('.theme-option', btn.parentNode).forEach(function (b) {
          var active = b.dataset.themeMode === mode;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
    }, [
      h('span.theme-option__swatch.theme-option__swatch--' + mode),
      icon(iconName, { size: 17 }),
      h('span', label)
    ]);
    return btn;
  }

  function settingsItem(iconName, title, sub, onClick, danger) {
    return h('button.settings-item', {
      type: 'button',
      class: danger ? 'is-danger' : '',
      onClick: onClick
    }, [
      h('span.settings-item__icon', [icon(iconName, { size: 18 })]),
      h('div.settings-item__text.u-grow', [
        h('span.settings-item__title', title),
        h('span.settings-item__sub', sub)
      ]),
      icon('chevron', { size: 16, class: 'settings-item__chev' })
    ]);
  }

  function askWipeAll() {
    parts.prompt({
      title: '清空全部数据',
      fields: [{
        name: 'confirm',
        label: '这个操作无法撤销。请输入「清空」以确认',
        placeholder: '清空',
        value: ''
      }],
      confirmLabel: '永久删除全部数据',
      onConfirm: function (values) {
        if ((values.confirm || '').trim() !== '清空') {
          app().flash('输入不正确，已取消');
          return;
        }
        repo().clearAll().then(function () {
          app().router.showTab('home');
          app().flash('全部数据已清空');
        });
      }
    });
  }

  UI.flows = {
    addTrip: addTrip,
    editTrip: editTrip,
    editCity: editCity,
    deleteCity: deleteCity,
    deleteTrip: deleteTrip,
    addPhotos: addPhotos,
    viewPhoto: viewPhoto,
    addAttachment: addAttachment,
    openAttachment: openAttachment,
    deleteAttachment: deleteAttachment,
    openRecycleBin: openRecycleBin,
    openSearch: openSearch,
    openSettings: openSettings,
    readHomeCity: readHomeCity,
    setHomeCity: setHomeCity
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
