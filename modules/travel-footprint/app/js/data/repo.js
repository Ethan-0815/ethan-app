/* ==========================================================================
   Travel Footprint — data/repo.js
   Repository: the only API the UI touches. Adapter-injected.
   Enforces the 'keys present in patch win' update semantics.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var U = TF.util;
  var M = TF.model;

  function Repo(deps) {
    var d = deps || {};
    this.cities = d.cities;
    this.trips = d.trips;
    this.photos = d.photos;
    this.attachments = d.attachments;
    this.blobs = d.blobs;

    this._cache = { cities: null, trips: null, photos: null, attachments: null };
    this._listeners = [];
    this.ready = false;
  }

  Repo.prototype.table = function (kind) {
    var map = {
      city: this.cities,
      trip: this.trips,
      photo: this.photos,
      attachment: this.attachments
    };
    return map[kind];
  };

  /* --------------------------------------------------------- lifecycle --- */

  Repo.prototype.init = function () {
    var self = this;
    return Promise.all([
      this.cities.all(),
      this.trips.all(),
      this.photos.all(),
      this.attachments.all()
    ]).then(function (res) {
      self._cache.cities = res[0];
      self._cache.trips = res[1];
      self._cache.photos = res[2];
      self._cache.attachments = res[3];
      self.ready = true;
      return self;
    });
  };

  /** Reload everything from storage (after import/clear). */
  Repo.prototype.reload = function () {
    var self = this;
    return Promise.all([
      this.cities.all(),
      this.trips.all(),
      this.photos.all(),
      this.attachments.all()
    ]).then(function (res) {
      self._cache.cities = res[0];
      self._cache.trips = res[1];
      self._cache.photos = res[2];
      self._cache.attachments = res[3];
      return self;
    });
  };

  /* ------------------------------------------------------------ reads --- */

  Repo.prototype.allCities = function () { return (this._cache.cities || []).slice(); };
  Repo.prototype.allTrips = function () { return (this._cache.trips || []).slice(); };
  Repo.prototype.allPhotos = function () { return (this._cache.photos || []).slice(); };
  Repo.prototype.allAttachments = function () { return (this._cache.attachments || []).slice(); };

  Repo.prototype.liveCities = function () {
    return this.allCities().filter(M.isLive);
  };

  Repo.prototype.liveTrips = function () {
    return this.allTrips().filter(M.isLive);
  };

  Repo.prototype.livePhotos = function () {
    return this.allPhotos().filter(M.isLive);
  };

  Repo.prototype.liveAttachments = function () {
    return this.allAttachments().filter(M.isLive);
  };

  Repo.prototype.findCity = function (id) {
    var list = this._cache.cities || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Repo.prototype.findTrip = function (id) {
    var list = this._cache.trips || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Repo.prototype.findPhoto = function (id) {
    var list = this._cache.photos || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Repo.prototype.findAttachment = function (id) {
    var list = this._cache.attachments || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /** Case-insensitive exact name lookup — used to detect "already have this city". */
  Repo.prototype.findCityByName = function (name) {
    var target = (U.nn(name) || '').toLowerCase();
    if (!target) return null;
    var list = this.liveCities();
    for (var i = 0; i < list.length; i++) {
      if ((list[i].name || '').toLowerCase() === target) return list[i];
    }
    return null;
  };

  Repo.prototype.tripsOfCity = function (cityId) {
    return M.sortTripsDesc(this.liveTrips().filter(function (t) { return t.cityId === cityId; }));
  };

  Repo.prototype.photosOfTrip = function (tripId) {
    return M.sortPhotos(this.livePhotos().filter(function (p) { return p.tripId === tripId; }));
  };

  Repo.prototype.attachmentsOfTrip = function (tripId) {
    return this.liveAttachments().filter(function (a) { return a.tripId === tripId; });
  };

  Repo.prototype.stats = function () {
    return M.computeStats({
      cities: this.allCities(),
      trips: this.allTrips(),
      photos: this.allPhotos(),
      attachments: this.allAttachments()
    });
  };

  Repo.prototype.cityList = function () {
    return M.buildCityList(this.allCities(), this.allTrips(), this.allPhotos());
  };

  Repo.prototype.timeline = function () {
    return M.buildTimeline(this.allTrips(), this.allCities(), this.allPhotos(), this.allAttachments());
  };

  Repo.prototype.search = function (query) {
    return M.search(query, this.allCities(), this.allTrips());
  };

  /* ----------------------------------------------------------- writes --- */

  /**
   * Create or update.
   *
   * Patch semantics: a field is written **only if the key is present in `input`**.
   * This lets a form submit all fields (cleared ones as '') to genuinely null them,
   * while a partial call like {name:'x'} cannot silently wipe other columns.
   */
  Repo.prototype.save = function (kind, input) {
    var self = this;
    var adapter = this.table(kind);
    if (!adapter) throw new Error('unknown table: ' + kind);

    var existing = null;
    var id = U.nn(input && input.id);

    if (id) {
      existing = this._findByKind(kind, id);
      if (!existing) throw new Error('记录不存在：' + id);
    }

    var merged;
    if (existing) {
      merged = {};
      // start from existing values
      for (var k in existing) {
        if (Object.prototype.hasOwnProperty.call(existing, k)) merged[k] = existing[k];
      }
      // apply only keys present in input
      for (var k2 in input) {
        if (!Object.prototype.hasOwnProperty.call(input, k2)) continue;
        if (k2 === 'id' || k2 === 'createdAt') continue;
        merged[k2] = input[k2];
      }
      merged.id = existing.id;
      merged.createdAt = existing.createdAt;
    } else {
      merged = input || {};
    }

    merged.updatedAt = U.nowIso();
    var entity = M.normalize(kind, merged);

    return adapter.put(entity).then(function (saved) {
      self._putCache(kind, saved);
      self._emit(kind, saved);
      return saved;
    });
  };

  Repo.prototype.saveMany = function (kind, inputs) {
    var self = this;
    var adapter = this.table(kind);
    var entities = [];
    for (var i = 0; i < inputs.length; i++) {
      var e = M.normalize(kind, inputs[i]);
      e.updatedAt = e.updatedAt || U.nowIso();
      entities.push(e);
    }
    return adapter.putMany(entities).then(function () {
      for (var j = 0; j < entities.length; j++) self._putCache(kind, entities[j]);
      self._emit(kind, null);
      return entities;
    });
  };

  Repo.prototype._findByKind = function (kind, id) {
    if (kind === 'city') return this.findCity(id);
    if (kind === 'trip') return this.findTrip(id);
    if (kind === 'photo') return this.findPhoto(id);
    if (kind === 'attachment') return this.findAttachment(id);
    return null;
  };

  Repo.prototype._putCache = function (kind, row) {
    var key = kind === 'city' ? 'cities' : kind === 'trip' ? 'trips' : kind === 'photo' ? 'photos' : 'attachments';
    var list = this._cache[key] || (this._cache[key] = []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === row.id) { list[i] = row; return; }
    }
    list.push(row);
  };

  Repo.prototype._removeCache = function (kind, ids) {
    var key = kind === 'city' ? 'cities' : kind === 'trip' ? 'trips' : kind === 'photo' ? 'photos' : 'attachments';
    var list = this._cache[key] || [];
    this._cache[key] = list.filter(function (r) { return ids.indexOf(r.id) === -1; });
  };

  /* ------------------------------------------------------- soft delete --- */

  /** Move a row (and, for a city/trip, its children) to the recycle bin. */
  Repo.prototype.softDelete = function (kind, id) {
    var self = this;
    var cascade = M.collectCascade(kind, id, {
      cities: this.allCities(),
      trips: this.allTrips(),
      photos: this.allPhotos(),
      attachments: this.allAttachments()
    }, 'live');

    var stamp = U.nowIso();
    var ops = [];

    ops.push(this._markDeleted('city', cascade.cities, stamp));
    ops.push(this._markDeleted('trip', cascade.trips, stamp));
    ops.push(this._markDeleted('photo', cascade.photos, stamp));
    ops.push(this._markDeleted('attachment', cascade.attachments, stamp));

    return Promise.all(ops).then(function () {
      self._emit(kind, null);
      return cascade;
    });
  };

  Repo.prototype._markDeleted = function (kind, ids, stamp) {
    if (!ids.length) return Promise.resolve(0);
    var self = this;
    var adapter = this.table(kind);
    return this._rowsByKind(kind, ids).then(function (rows) {
      var updated = rows.map(function (r) {
        var copy = {};
        for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
        copy.deletedAt = stamp;
        copy.updatedAt = stamp;
        return copy;
      });
      return adapter.putMany(updated).then(function () {
        for (var i = 0; i < updated.length; i++) self._putCache(kind, updated[i]);
        return updated.length;
      });
    });
  };

  Repo.prototype._rowsByKind = function (kind, ids) {
    var all = kind === 'city' ? this.allCities()
            : kind === 'trip' ? this.allTrips()
            : kind === 'photo' ? this.allPhotos()
            : this.allAttachments();
    return Promise.resolve(all.filter(function (r) { return ids.indexOf(r.id) !== -1; }));
  };

  /* --------------------------------------------------------- recycle bin --- */

  /** Everything currently in the bin, grouped for display. */
  Repo.prototype.recycleBin = function () {
    var cities = this.allCities().filter(function (r) { return !M.isLive(r); });
    var trips = this.allTrips().filter(function (r) { return !M.isLive(r); });
    var photos = this.allPhotos().filter(function (r) { return !M.isLive(r); });
    var attachments = this.allAttachments().filter(function (r) { return !M.isLive(r); });

    var liveCityIds = {};
    var i;
    for (i = 0; i < cities.length; i++) liveCityIds[cities[i].id] = true;

    // A trip shown in the bin should carry its city name even though the city
    // may also be in the bin (or was deleted separately).
    var cityById = {};
    var allCities = this.allCities();
    for (i = 0; i < allCities.length; i++) cityById[allCities[i].id] = allCities[i];

    var items = [];
    for (i = 0; i < cities.length; i++) {
      items.push({
        kind: 'city',
        table: 'cities',
        row: cities[i],
        title: M.cityName(cities[i]),
        subtitle: M.geoLine(cities[i]),
        deletedAt: cities[i].deletedAt
      });
    }
    for (i = 0; i < trips.length; i++) {
      var t = trips[i];
      var city = cityById[t.cityId];
      var stillExists = !!city;
      items.push({
        kind: 'trip',
        table: 'trips',
        row: t,
        // Prefer the real city name even when the city is also in the bin —
        // it is far more recognisable than a generic placeholder. Only fall
        // back when the city row is genuinely gone.
        title: stillExists ? M.cityName(city) : '（原城市已删除）',
        subtitle: U.formatRange(t.startDate, t.endDate) || '无日期',
        deletedAt: t.deletedAt,
        orphan: !stillExists || !M.isLive(city)
      });
    }

    items.sort(function (a, b) { return U.byDesc(a.deletedAt || '', b.deletedAt || ''); });

    return {
      items: items,
      photos: photos,
      attachments: attachments,
      cityCount: cities.length,
      tripCount: trips.length,
      photoCount: photos.length,
      attachmentCount: attachments.length,
      total: cities.length + trips.length + photos.length + attachments.length
    };
  };

  /**
   * Restore a bin item.
   * Restoring a trip also clears the tombstone on its photos/attachments
   * (they were swept up by the same cascade), and revives the parent city
   * when it too sits in the bin.
   */
  Repo.prototype.restore = function (kind, id) {
    var self = this;
    var stamp = U.nowIso();

    if (kind === 'city') {
      return this._revive('city', [id], stamp).then(function () {
        return self._reviveDescendantsOfCity(id, stamp);
      }).then(function () {
        self._emit('city', null);
        return true;
      });
    }

    if (kind === 'trip') {
      var trip = this.findTrip(id);
      return this._revive('trip', [id], stamp).then(function () {
        if (!trip) return 0;
        var photos = self.allPhotos()
          .filter(function (p) { return p.tripId === id && !M.isLive(p); })
          .map(function (p) { return p.id; });
        var atts = self.allAttachments()
          .filter(function (a) { return a.tripId === id && !M.isLive(a); })
          .map(function (a) { return a.id; });
        return Promise.all([
          self._revive('photo', photos, stamp),
          self._revive('attachment', atts, stamp),
          trip.cityId ? self._revive('city', [trip.cityId], stamp) : 0
        ]);
      }).then(function () {
        self._emit('trip', null);
        return true;
      });
    }

    var tableMap = { photo: 'photo', attachment: 'attachment' };
    var k = tableMap[kind];
    if (!k) return Promise.resolve(false);
    return this._revive(k, [id], stamp).then(function () {
      self._emit(kind, null);
      return true;
    });
  };

  Repo.prototype._reviveDescendantsOfCity = function (cityId, stamp) {
    var self = this;
    var trips = this.allTrips()
      .filter(function (t) { return t.cityId === cityId && !M.isLive(t); })
      .map(function (t) { return t.id; });

    return this._revive('trip', trips, stamp).then(function () {
      var photos = self.allPhotos()
        .filter(function (p) { return trips.indexOf(p.tripId) !== -1 && !M.isLive(p); })
        .map(function (p) { return p.id; });
      var atts = self.allAttachments()
        .filter(function (a) { return trips.indexOf(a.tripId) !== -1 && !M.isLive(a); })
        .map(function (a) { return a.id; });
      return Promise.all([
        self._revive('photo', photos, stamp),
        self._revive('attachment', atts, stamp)
      ]);
    });
  };

  Repo.prototype._revive = function (kind, ids, stamp) {
    if (!ids.length) return Promise.resolve(0);
    var self = this;
    var adapter = this.table(kind);
    return this._rowsByKind(kind, ids).then(function (rows) {
      var updated = rows.map(function (r) {
        var copy = {};
        for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
        copy.deletedAt = null;
        copy.updatedAt = stamp;
        return copy;
      });
      return adapter.putMany(updated).then(function () {
        for (var i = 0; i < updated.length; i++) self._putCache(kind, updated[i]);
        return updated.length;
      });
    });
  };

  /** Permanently remove a bin item, including its blob bytes. */
  Repo.prototype.purge = function (kind, id) {
    var self = this;
    // default mode 'all': purging takes the row, its descendants, and its own
    // bin entries. A trip deleted under a *different* branch is unreachable
    // by id here, so it keeps its own bin entry.
    var cascade = M.collectCascade(kind, id, {
      cities: this.allCities(),
      trips: this.allTrips(),
      photos: this.allPhotos(),
      attachments: this.allAttachments()
    });

    return this._purgeBlobs(collectBlobIds(
      this.allPhotos().filter(function (p) { return cascade.photos.indexOf(p.id) !== -1; }),
      this.allAttachments().filter(function (a) { return cascade.attachments.indexOf(a.id) !== -1; })
    )).then(function () {
      return Promise.all([
        self.cities.removeMany(cascade.cities),
        self.trips.removeMany(cascade.trips),
        self.photos.removeMany(cascade.photos),
        self.attachments.removeMany(cascade.attachments)
      ]);
    }).then(function () {
      self._removeCache('city', cascade.cities);
      self._removeCache('trip', cascade.trips);
      self._removeCache('photo', cascade.photos);
      self._removeCache('attachment', cascade.attachments);
      self._emit(kind, null);
      return cascade;
    });
  };

  /** Empty the entire bin — sweeps both tombstoned and orphaned rows. */
  Repo.prototype.purgeAll = function () {
    var self = this;
    var cities = this.allCities().filter(function (r) { return !M.isLive(r); });
    var trips = this.allTrips().filter(function (r) { return !M.isLive(r); });
    var photos = this.allPhotos().filter(function (r) { return !M.isLive(r); });
    var attachments = this.allAttachments().filter(function (r) { return !M.isLive(r); });
    var cityIds = cities.map(function (r) { return r.id; });
    var tripIds = trips.map(function (r) { return r.id; });
    var photoIds = photos.map(function (r) { return r.id; });
    var attIds = attachments.map(function (r) { return r.id; });

    // orphan rows whose parents were purged earlier also count
    return this._purgeBlobs(collectBlobIds(photos, attachments)).then(function () {
      return Promise.all([
        self.cities.removeMany(cityIds),
        self.trips.removeMany(tripIds),
        self.photos.removeMany(photoIds),
        self.attachments.removeMany(attIds)
      ]);
    }).then(function () {
      self._removeCache('city', cityIds);
      self._removeCache('trip', tripIds);
      self._removeCache('photo', photoIds);
      self._removeCache('attachment', attIds);
      self._emit('city', null);
      return { cities: cityIds.length, trips: tripIds.length, photos: photoIds.length, attachments: attIds.length };
    });
  };

  Repo.prototype._purgeBlobs = function (blobIds) {
    if (!this.blobs || !blobIds.length) return Promise.resolve(true);
    // don't delete blobs still referenced by a surviving row
    var keep = {};
    var allPhotos = this.allPhotos();
    var allAtts = this.allAttachments();
    var i;
    for (i = 0; i < allPhotos.length; i++) if (allPhotos[i].blobId) keep[allPhotos[i].blobId] = true;
    for (i = 0; i < allAtts.length; i++) if (allAtts[i].blobId) keep[allAtts[i].blobId] = true;

    var target = blobIds.filter(function (b) { return !keep[b]; });
    if (!target.length) return Promise.resolve(true);
    return this.blobs.removeBlobs(target);
  };

  function collectBlobIds(photos, attachments) {
    var out = [];
    var i;
    for (i = 0; i < photos.length; i++) if (photos[i].blobId) out.push(photos[i].blobId);
    for (i = 0; i < attachments.length; i++) if (attachments[i].blobId) out.push(attachments[i].blobId);
    return out;
  }

  /* ------------------------------------------------------------- blobs --- */

  Repo.prototype.putBlob = function (id, bytes, mimeType) {
    if (!this.blobs) return Promise.reject(new Error('存储不可用'));
    return this.blobs.putBlob(id, bytes, mimeType);
  };

  Repo.prototype.getBlob = function (id) {
    if (!this.blobs) return Promise.resolve(null);
    return this.blobs.getBlob(id);
  };

  Repo.prototype.removeBlob = function (id) {
    if (!this.blobs) return Promise.resolve(true);
    return this.blobs.removeBlob(id);
  };

  /* ------------------------------------------------------- bulk import --- */

  /**
   * Apply an import plan. `resolutions` maps conflict keys → 'incoming' | 'local'.
   * Blob writes are handled by the caller before/after this runs.
   */
  Repo.prototype.applyImport = function (plan, resolutions) {
    var self = this;
    var res = resolutions || {};
    var byTable = { cities: [], trips: [], photos: [], attachments: [] };
    var i;

    for (i = 0; i < plan.add.length; i++) {
      byTable[plan.add[i].table].push(plan.add[i].row);
    }
    for (i = 0; i < plan.update.length; i++) {
      byTable[plan.update[i].table].push(plan.update[i].row);
    }
    for (i = 0; i < plan.conflicts.length; i++) {
      var c = plan.conflicts[i];
      var key = c.table + ':' + c.row.id;
      if (res[key] === 'incoming') byTable[c.table].push(c.row);
    }

    var jobs = [];
    jobs.push(byTable.cities.length ? this.cities.putMany(byTable.cities) : 0);
    jobs.push(byTable.trips.length ? this.trips.putMany(byTable.trips) : 0);
    jobs.push(byTable.photos.length ? this.photos.putMany(byTable.photos) : 0);
    jobs.push(byTable.attachments.length ? this.attachments.putMany(byTable.attachments) : 0);

    return Promise.all(jobs).then(function () {
      return self.reload();
    }).then(function () {
      // preserve tombstoned rows: reload() reads everything, including deleted
      self._emit('city', null);
      return {
        added: plan.add.length,
        updated: plan.update.length,
        applied: byTable.cities.length + byTable.trips.length + byTable.photos.length + byTable.attachments.length,
        conflictsIncoming: plan.conflicts.filter(function (c) {
          return res[c.table + ':' + c.row.id] === 'incoming';
        }).length
      };
    });
  };

  /* --------------------------------------------------- events (for UI) --- */

  Repo.prototype.onChange = function (fn) {
    this._listeners.push(fn);
    return function () {
      var i = this._listeners.indexOf(fn);
      if (i !== -1) this._listeners.splice(i, 1);
    }.bind(this);
  };

  Repo.prototype._emit = function (kind, row) {
    for (var i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](kind, row);
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('repo listener error', e);
      }
    }
  };

  /* -------------------------------------------------------------- wipe --- */

  Repo.prototype.clearAll = function () {
    var self = this;
    return Promise.all([
      this.cities.clear(),
      this.trips.clear(),
      this.photos.clear(),
      this.attachments.clear(),
      this.blobs ? this.blobs.clear() : true
    ]).then(function () {
      self._cache = { cities: [], trips: [], photos: [], attachments: [] };
      self._emit('city', null);
      return true;
    });
  };

  TF.repo = {
    Repo: Repo
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
