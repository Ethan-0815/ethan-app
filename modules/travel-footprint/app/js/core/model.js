/* ==========================================================================
   Travel Footprint — core/model.js
   Entity schemas, normalisation, validation, statistics.
   Pure: no DOM, no IO.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var U = TF.util;

  /* ------------------------------------------------------------- schema --- */

  var SCHEMA = {
    city: {
      table: 'cities',
      patchable: ['name', 'country', 'province', 'latitude', 'longitude', 'sortIndex', 'deletedAt'],
      required: ['name'],
      fields: {
        id: null,
        name: '',
        country: null,
        province: null,
        latitude: null,
        longitude: null,
        sortIndex: 0,
        createdAt: null,
        updatedAt: null,
        deletedAt: null
      }
    },
    trip: {
      table: 'trips',
      patchable: ['cityId', 'fromCityId', 'startDate', 'endDate', 'note', 'deletedAt'],
      required: ['cityId', 'startDate'],
      fields: {
        id: null,
        cityId: null,
        fromCityId: null,
        startDate: null,
        endDate: null,
        note: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null
      }
    },
    photo: {
      table: 'photos',
      patchable: ['tripId', 'blobId', 'width', 'height', 'bytes', 'caption', 'deletedAt'],
      required: ['tripId', 'blobId'],
      fields: {
        id: null,
        tripId: null,
        blobId: null,
        width: null,
        height: null,
        bytes: null,
        caption: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null
      }
    },
    attachment: {
      table: 'attachments',
      patchable: ['tripId', 'name', 'mimeType', 'blobId', 'bytes', 'deletedAt'],
      required: ['tripId', 'name', 'blobId'],
      fields: {
        id: null,
        tripId: null,
        name: '',
        mimeType: null,
        blobId: null,
        bytes: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null
      }
    }
  };

  var TABLES = {
    cities: SCHEMA.city,
    trips: SCHEMA.trip,
    photos: SCHEMA.photo,
    attachments: SCHEMA.attachment
  };

  /* -------------------------------------------------------- normalise --- */

  /**
   * Coerce a raw object into a clean entity.
   * - Unknown keys dropped (prevents accidental schema drift)
   * - '' → null everywhere
   * - numbers parsed, NaN → null
   * - ids/dates filled in
   */
  function normalize(kind, raw) {
    var spec = SCHEMA[kind];
    if (!spec) throw new Error('unknown entity: ' + kind);

    var input = raw || {};
    var out = {};
    var key;

    for (key in spec.fields) {
      if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) continue;
      out[key] = spec.fields[key];
    }

    for (key in input) {
      if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) continue;
      out[key] = input[key];
    }

    // ids & timestamps
    out.id = U.nn(out.id) || U.uuid();
    out.createdAt = U.nn(out.createdAt) || U.nowIso();
    out.updatedAt = U.nn(out.updatedAt) || out.createdAt;

    // strings → null when blank
    out.name = U.nn(out.name);
    out.country = U.nn(out.country);
    out.province = U.nn(out.province);
    out.note = U.nn(out.note);
    out.caption = U.nn(out.caption);
    out.mimeType = U.nn(out.mimeType);
    out.blobId = U.nn(out.blobId);
    out.cityId = U.nn(out.cityId);
    out.tripId = U.nn(out.tripId);
    out.deletedAt = U.nn(out.deletedAt);

    // dates
    out.startDate = U.toDateStr(out.startDate);
    out.endDate = U.toDateStr(out.endDate);

    // numbers
    out.latitude = U.toNum(out.latitude);
    out.longitude = U.toNum(out.longitude);
    out.width = U.toNum(out.width);
    out.height = U.toNum(out.height);
    out.bytes = U.toNum(out.bytes);
    out.sortIndex = U.toNum(out.sortIndex) || 0;

    // entity-specific repair
    if (kind === 'trip') {
      if (!out.endDate) out.endDate = out.startDate;
      // guard against reversed range
      if (out.startDate && out.endDate && out.endDate < out.startDate) {
        out.endDate = out.startDate;
      }
    }

    return out;
  }

  /* -------------------------------------------------------- validate --- */

  /**
   * Returns { ok:boolean, errors:{field:message} }
   */
  function validate(kind, entity, ctx) {
    var spec = SCHEMA[kind];
    var errors = {};
    var context = ctx || {};

    if (kind === 'city') {
      var name = U.nn(entity.name);
      if (!name) {
        errors.name = '请填写城市名称';
      } else if (name.length > 40) {
        errors.name = '城市名称最多 40 个字';
      } else if (context.nameTaken) {
        errors.name = '已存在同名城市，请直接为它添加一次旅行记录';
      }
    }

    if (kind === 'trip') {
      if (!U.nn(entity.cityId)) errors.cityId = '请选择城市';
      if (!U.toDateStr(entity.startDate)) errors.startDate = '请选择开始日期';
      if (entity.startDate && entity.endDate && entity.endDate < entity.startDate) {
        errors.endDate = '结束日期不能早于开始日期';
      }
      if (entity.note && String(entity.note).length > 2000) {
        errors.note = '备注最多 2000 个字';
      }
    }

    if (kind === 'attachment') {
      if (!U.nn(entity.name)) errors.name = '缺少附件名称';
      if (!U.nn(entity.blobId)) errors.blobId = '附件内容为空';
    }

    var keys = Object.keys(errors);
    return { ok: keys.length === 0, errors: errors };
  }

  /* -------------------------------------------------- trip statistics --- */

  /** Effective date used for ordering a trip: start date, else end, else createdAt. */
  function tripSortKey(trip) {
    return trip.startDate || trip.endDate || (trip.createdAt || '').slice(0, 10);
  }

  /**
   * Sorted desc by start date (newest first).
   * Ties broken by createdAt desc so insertion order stays stable.
   */
  function sortTripsDesc(trips) {
    return trips.slice().sort(function (a, b) {
      var d = U.byDesc(tripSortKey(a), tripSortKey(b));
      if (d !== 0) return d;
      return U.byDesc(a.createdAt || '', b.createdAt || '');
    });
  }

  /**
   * Aggregate statistics over live (non-deleted) rows.
   *   cityCount  — distinct cities that have at least one trip
   *   regionCount— 省区 count: Chinese cities count by province, each
   *                foreign country counts as one
   *   tripCount  — number of trips
   *   photoCount — number of photos
   *   attachmentCount
   *   countryCount
   *   daysTotal  — sum of trip durations
   *   years      — sorted list of years with travel
   */
  function computeStats(input) {
    var cities = (input.cities || []).filter(isLive);
    var trips = (input.trips || []).filter(isLive);
    var photos = (input.photos || []).filter(isLive);
    var attachments = (input.attachments || []).filter(isLive);

    var cityById = {};
    var i;
    for (i = 0; i < cities.length; i++) cityById[cities[i].id] = cities[i];

    var visitedCityIds = {};
    var regions = {};
    var countries = {};
    var years = {};
    var daysTotal = 0;

    for (i = 0; i < trips.length; i++) {
      var t = trips[i];
      if (t.cityId) visitedCityIds[t.cityId] = true;

      var city = cityById[t.cityId];
      if (city) {
        // 省区 semantics: Chinese cities count by province, every foreign
        // country counts as ONE region regardless of its provinces/states.
        var country = (city.country || '').trim();
        var province = (city.province || '').trim();
        var isChina = !country || country === '中国';
        var region = isChina ? (province || '中国') : country;
        if (region) regions[region] = true;
        if (country) countries[country] = true;
      }

      var y = U.yearOf(tripSortKey(t));
      if (y) years[y] = true;

      daysTotal += U.daysBetween(t.startDate, t.endDate);
    }

    var yearList = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });

    return {
      cityCount: Object.keys(visitedCityIds).length,
      cityTotal: cities.length,
      regionCount: Object.keys(regions).length,
      countryCount: Object.keys(countries).length,
      tripCount: trips.length,
      photoCount: photos.length,
      attachmentCount: attachments.length,
      daysTotal: daysTotal,
      years: yearList
    };
  }

  function isLive(row) {
    return !!row && !U.nn(row.deletedAt);
  }

  /** How many times each city was visited → { cityId: count } */
  function tripCountByCity(trips) {
    var out = {};
    for (var i = 0; i < trips.length; i++) {
      if (!isLive(trips[i])) continue;
      var id = trips[i].cityId;
      if (!id) continue;
      out[id] = (out[id] || 0) + 1;
    }
    return out;
  }

  /** { tripId: count } for photos and attachments */
  function countsByTrip(rows) {
    var out = {};
    for (var i = 0; i < rows.length; i++) {
      if (!isLive(rows[i])) continue;
      var id = rows[i].tripId;
      if (!id) continue;
      out[id] = (out[id] || 0) + 1;
    }
    return out;
  }

  function photosByTrip(photos) {
    var out = {};
    var list = sortPhotos(photos);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!isLive(p)) continue;
      if (!out[p.tripId]) out[p.tripId] = [];
      out[p.tripId].push(p);
    }
    return out;
  }

  function sortPhotos(photos) {
    return photos.slice().sort(function (a, b) {
      return U.byAsc(a.createdAt || '', b.createdAt || '');
    });
  }

  function attachmentsByTrip(attachments) {
    var out = {};
    var list = attachments.slice().sort(function (a, b) {
      return U.byAsc(a.createdAt || '', b.createdAt || '');
    });
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!isLive(a)) continue;
      if (!out[a.tripId]) out[a.tripId] = [];
      out[a.tripId].push(a);
    }
    return out;
  }

  /* ------------------------------------------------------------ search --- */

  /**
   * Fuzzy-ish subsequence match: query chars must appear in order.
   * 'gl' matches '桂林'? no — but '漓江' matches note '去了漓江和阳朔' exactly.
   * Handles both substring and subsequence so short queries feel forgiving.
   */
  function fuzzyMatch(haystack, needle) {
    if (!needle) return true;
    if (!haystack) return false;
    var h = haystack.toLowerCase();
    var n = needle.toLowerCase();
    if (h.indexOf(n) !== -1) return true;

    var hi = 0;
    for (var ni = 0; ni < n.length; ni++) {
      var c = n.charAt(ni);
      if (c === ' ') continue;
      var found = h.indexOf(c, hi);
      if (found === -1) return false;
      hi = found + 1;
    }
    return true;
  }

  /**
   * Search cities + trips.
   * Returns { cities: [...], trips: [...] } matching the query against
   * city name / country / province and trip note.
   */
  function search(query, cities, trips) {
    var q = U.nn(query);
    if (!q) return { cities: [], trips: [], active: false };

    var liveCities = cities.filter(isLive);
    var liveTrips = trips.filter(isLive);
    var cityById = {};
    var i;
    for (i = 0; i < liveCities.length; i++) cityById[liveCities[i].id] = liveCities[i];

    var hitCities = liveCities.filter(function (c) {
      return fuzzyMatch(c.name, q) ||
             fuzzyMatch(c.province, q) ||
             fuzzyMatch(c.country, q);
    });

    var directCityIds = {};
    for (i = 0; i < hitCities.length; i++) directCityIds[hitCities[i].id] = true;

    var hitTrips = liveTrips.filter(function (t) {
      if (fuzzyMatch(t.note, q)) return true;
      // note-only match shouldn't duplicate city-name matches
      var city = cityById[t.cityId];
      if (city && directCityIds[city.id]) return false;
      return false;
    });

    // also surface trips whose city matched, so a city search lists its visits
    for (i = 0; i < liveTrips.length; i++) {
      var t = liveTrips[i];
      if (directCityIds[t.cityId] && hitTrips.indexOf(t) === -1) {
        hitTrips.push(t);
      }
    }

    return {
      active: true,
      query: q,
      cities: hitCities,
      trips: sortTripsDesc(hitTrips)
    };
  }

  /* --------------------------------------------------------- timeline --- */

  /**
   * Group trips into [{ year, months: [{ month, trips: [...] }] }], newest first.
   * Each entry carries the resolved city + counts so the view stays dumb.
   */
  function buildTimeline(trips, cities, photos, attachments) {
    var liveTrips = sortTripsDesc(trips.filter(isLive));
    var cityById = {};
    var i;
    for (i = 0; i < cities.length; i++) {
      if (isLive(cities[i])) cityById[cities[i].id] = cities[i];
    }
    var photoCounts = countsByTrip(photos || []);
    var attachmentCounts = countsByTrip(attachments || []);

    var years = [];
    var yearMap = {};
    var monthMap = {};

    for (i = 0; i < liveTrips.length; i++) {
      var t = liveTrips[i];
      var key = U.toDateStr(tripSortKey(t)) || '0000-01-01';
      var y = parseInt(key.slice(0, 4), 10);
      var m = parseInt(key.slice(5, 7), 10);

      if (!yearMap[y]) {
        yearMap[y] = { year: y, months: [], _monthMap: {} };
        years.push(yearMap[y]);
      }
      var yEntry = yearMap[y];

      if (!yEntry._monthMap[m]) {
        yEntry._monthMap[m] = { month: m, trips: [] };
        yEntry.months.push(yEntry._monthMap[m]);
      }

      yEntry._monthMap[m].trips.push({
        trip: t,
        city: cityById[t.cityId] || null,
        photoCount: photoCounts[t.id] || 0,
        attachmentCount: attachmentCounts[t.id] || 0,
        days: U.daysBetween(t.startDate, t.endDate)
      });
    }

    for (i = 0; i < years.length; i++) {
      delete years[i]._monthMap;
    }

    return years;
  }

  /**
   * Group trips per city → sorted by visit count desc then name.
   * Returns [{ city, trips: [...], visitCount, lastVisit, firstVisit, photoCount }]
   */
  function buildCityList(cities, trips, photos) {
    var liveCities = cities.filter(isLive);
    var liveTrips = trips.filter(isLive);
    var photoCounts = countsByTrip(photos || []);

    var byCity = {};
    var i;
    for (i = 0; i < liveTrips.length; i++) {
      var t = liveTrips[i];
      if (!t.cityId) continue;
      if (!byCity[t.cityId]) byCity[t.cityId] = [];
      byCity[t.cityId].push(t);
    }

    var out = [];
    for (i = 0; i < liveCities.length; i++) {
      var c = liveCities[i];
      var list = sortTripsDesc(byCity[c.id] || []);
      var pc = 0;
      for (var j = 0; j < list.length; j++) pc += photoCounts[list[j].id] || 0;

      out.push({
        city: c,
        trips: list,
        visitCount: list.length,
        firstVisit: list.length ? U.toDateStr(tripSortKey(list[list.length - 1])) : null,
        lastVisit: list.length ? U.toDateStr(tripSortKey(list[0])) : null,
        photoCount: pc,
        days: list.reduce(function (sum, t) {
          return sum + U.daysBetween(t.startDate, t.endDate);
        }, 0)
      });
    }

    return out;
  }

  /** Cities that have no trips yet — used to nudge completing a record. */
  function orphanCities(cityList) {
    return cityList.filter(function (e) { return e.visitCount === 0; });
  }

  /* ---------------------------------------------------------- recycle --- */

  /**
   * Cascade target ids for a delete.
   *
   * Two distinct operations need different reach:
   *
   *   softDelete (mode 'live') — move a live row plus its LIVE descendants to
   *      the bin. An already-binned descendant keeps its own entry (and its
   *      own original deletedAt) instead of being re-stamped.
   *
   *   purge (mode 'all', the default) — hard-remove the target, its
   *      descendants, and its own bin entries, because the user explicitly
   *      asked to permanently delete this record. Descendants belonging to an
   *      unrelated branch are not reachable by id and are never touched.
   */
  function collectCascade(kind, id, data, mode) {
    var cities = data.cities || [];
    var trips = data.trips || [];
    var photos = data.photos || [];
    var attachments = data.attachments || [];
    var liveOnly = mode === 'live';

    function keep(row) {
      return liveOnly ? isLive(row) : true;
    }

    if (kind === 'city') {
      var tripIds = trips.filter(function (t) {
        return t.cityId === id && keep(t);
      }).map(function (t) { return t.id; });

      return {
        cities: cities.some(function (c) { return c.id === id && keep(c); }) ? [id] : [],
        trips: tripIds,
        photos: photos.filter(function (p) {
          return tripIds.indexOf(p.tripId) !== -1 && keep(p);
        }).map(function (p) { return p.id; }),
        attachments: attachments.filter(function (a) {
          return tripIds.indexOf(a.tripId) !== -1 && keep(a);
        }).map(function (a) { return a.id; })
      };
    }

    if (kind === 'trip') {
      return {
        cities: [],
        trips: trips.some(function (t) { return t.id === id && keep(t); }) ? [id] : [],
        photos: photos.filter(function (p) {
          return p.tripId === id && keep(p);
        }).map(function (p) { return p.id; }),
        attachments: attachments.filter(function (a) {
          return a.tripId === id && keep(a);
        }).map(function (a) { return a.id; })
      };
    }

    if (kind === 'photo') {
      return { cities: [], trips: [], photos: [id], attachments: [] };
    }
    if (kind === 'attachment') {
      return { cities: [], trips: [], photos: [], attachments: [id] };
    }
    return { cities: [], trips: [], photos: [], attachments: [] };
  }

  /* ------------------------------------------------------------ display --- */

  /** '桂林 · 中国 · 广西' style secondary line, never undefined. */
  function geoLine(city) {
    if (!city) return '';
    var parts = [];
    if (city.country) parts.push(city.country);
    if (city.province) parts.push(city.province);
    return parts.join(' · ');
  }

  function cityName(city) {
    return (city && U.nn(city.name)) || '未命名地点';
  }

  function mimeIcon(mime, name) {
    var m = (mime || '').toLowerCase();
    var n = (name || '').toLowerCase();
    if (m.indexOf('pdf') !== -1 || n.endsWith('.pdf')) return '📄';
    if (m.indexOf('image') !== -1) return '🖼️';
    if (m.indexOf('video') !== -1) return '🎬';
    if (m.indexOf('audio') !== -1) return '🎧';
    if (m.indexOf('zip') !== -1 || n.endsWith('.zip')) return '🗂️';
    if (n.endsWith('.doc') || n.endsWith('.docx')) return '📝';
    if (n.endsWith('.xls') || n.endsWith('.xlsx')) return '📊';
    if (n.endsWith('.ppt') || n.endsWith('.pptx')) return '📽️';
    if (n.endsWith('.txt')) return '📃';
    return '📎';
  }

  function formatBytes(bytes) {
    var b = U.toNum(bytes);
    if (b === null || b < 0) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  TF.model = {
    SCHEMA: SCHEMA,
    TABLES: TABLES,
    normalize: normalize,
    validate: validate,
    isLive: isLive,
    tripSortKey: tripSortKey,
    sortTripsDesc: sortTripsDesc,
    sortPhotos: sortPhotos,
    computeStats: computeStats,
    tripCountByCity: tripCountByCity,
    countsByTrip: countsByTrip,
    photosByTrip: photosByTrip,
    attachmentsByTrip: attachmentsByTrip,
    fuzzyMatch: fuzzyMatch,
    search: search,
    buildTimeline: buildTimeline,
    buildCityList: buildCityList,
    orphanCities: orphanCities,
    collectCascade: collectCascade,
    geoLine: geoLine,
    cityName: cityName,
    mimeIcon: mimeIcon,
    formatBytes: formatBytes
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
