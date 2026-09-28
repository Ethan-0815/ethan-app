/* ==========================================================================
   Travel Footprint — core/backup.js
   Backup payload build/parse + conflict resolution policy.
   Pure: takes data in, returns data out. ZIP assembly lives in the caller.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var U = TF.util;
  var M = TF.model;

  var BACKUP_VERSION = 1;
  var APP_VERSION = '0.1.0';
  var MAGIC = 'travel-footprint-backup';

  /* --------------------------------------------------------- payload --- */

  /**
   * Build the JSON payload that goes into data.json.
   * `records` are the live (non-deleted) rows only.
   */
  function buildPayload(input, opts) {
    var options = opts || {};
    var cities = (input.cities || []).filter(M.isLive);
    var trips = (input.trips || []).filter(M.isLive);
    var photos = (input.photos || []).filter(M.isLive);
    var attachments = (input.attachments || []).filter(M.isLive);

    // Only keep trips that still have a live city
    var cityIds = {};
    var i;
    for (i = 0; i < cities.length; i++) cityIds[cities[i].id] = true;
    trips = trips.filter(function (t) { return cityIds[t.cityId]; });

    var tripIds = {};
    for (i = 0; i < trips.length; i++) tripIds[trips[i].id] = true;
    photos = photos.filter(function (p) { return tripIds[p.tripId]; });
    attachments = attachments.filter(function (a) { return tripIds[a.tripId]; });

    return {
      magic: MAGIC,
      backupVersion: BACKUP_VERSION,
      appVersion: options.appVersion || APP_VERSION,
      createdAt: U.nowIso(),
      counts: {
        cities: cities.length,
        trips: trips.length,
        photos: photos.length,
        attachments: attachments.length
      },
      cities: cities.map(strip),
      trips: trips.map(strip),
      photos: photos.map(strip),
      attachments: attachments.map(strip)
    };
  }

  function strip(row) {
    var out = {};
    for (var k in row) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
      if (k === 'deletedAt') continue;   // never export tombstoned rows
      if (row[k] === undefined) continue;
      out[k] = row[k];
    }
    return out;
  }

  /**
   * Build the binary file manifest: [{ id, kind, path, mimeType, name, bytes, width, height }]
   * `blobs` maps blobId → true for blobs that actually exist.
   */
  function buildManifest(input) {
    var manifest = [];
    var photos = (input.photos || []).filter(M.isLive);
    var attachments = (input.attachments || []).filter(M.isLive);
    var i;

    for (i = 0; i < photos.length; i++) {
      var p = photos[i];
      manifest.push({
        id: p.id,
        kind: 'photo',
        blobId: p.blobId,
        path: 'photos/' + p.blobId + '.jpg',
        mimeType: 'image/jpeg',
        name: null,
        bytes: p.bytes,
        width: p.width,
        height: p.height
      });
    }

    for (i = 0; i < attachments.length; i++) {
      var a = attachments[i];
      manifest.push({
        id: a.id,
        kind: 'attachment',
        blobId: a.blobId,
        path: 'attachments/' + a.blobId + extOf(a.name, a.mimeType),
        mimeType: a.mimeType,
        name: a.name,
        bytes: a.bytes,
        width: null,
        height: null
      });
    }

    return manifest;
  }

  function extOf(name, mime) {
    var n = U.nn(name);
    if (n) {
      var m = n.match(/\.([a-z0-9]{1,8})$/i);
      if (m) return '.' + m[1].toLowerCase();
    }
    var map = {
      'application/pdf': '.pdf',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'text/plain': '.txt',
      'application/zip': '.zip'
    };
    return map[(mime || '').toLowerCase()] || '.bin';
  }

  /* ------------------------------------------------------------ parse --- */

  /**
   * Validate + normalise a parsed data.json.
   * Throws a friendly Error when the file isn't a Travel Footprint backup.
   */
  function parsePayload(raw) {
    var json = raw;
    if (typeof raw === 'string') {
      try {
        json = JSON.parse(raw);
      } catch (e) {
        throw new Error('备份文件损坏：data.json 不是有效的 JSON');
      }
    }

    if (!json || typeof json !== 'object') {
      throw new Error('备份文件损坏：缺少数据内容');
    }

    if (json.magic !== MAGIC) {
      // tolerate a bare payload without magic, but require the shape
      var hasShape = Array.isArray(json.cities) && Array.isArray(json.trips);
      if (!hasShape) {
        throw new Error('这不是「旅行足迹」的备份文件');
      }
    }

    var version = U.toNum(json.backupVersion) || 1;
    if (version > BACKUP_VERSION) {
      throw new Error('备份文件来自更高版本（v' + version + '），请先升级 App');
    }

    var payload = {
      backupVersion: version,
      appVersion: U.nn(json.appVersion) || 'unknown',
      createdAt: U.nn(json.createdAt),
      cities: normList('city', json.cities),
      trips: normList('trip', json.trips),
      photos: normList('photo', json.photos),
      attachments: normList('attachment', json.attachments)
    };

    // Referential repair: drop children whose parent is missing rather than
    // importing orphans that would render as blank rows.
    var cityIds = {};
    var i;
    for (i = 0; i < payload.cities.length; i++) cityIds[payload.cities[i].id] = true;

    var droppedTrips = 0;
    payload.trips = payload.trips.filter(function (t) {
      var ok = t.cityId && cityIds[t.cityId];
      if (!ok) droppedTrips++;
      return ok;
    });
    payload.droppedTrips = droppedTrips;

    var tripIds = {};
    for (i = 0; i < payload.trips.length; i++) tripIds[payload.trips[i].id] = true;

    var droppedPhotos = 0;
    payload.photos = payload.photos.filter(function (p) {
      var ok = p.tripId && tripIds[p.tripId];
      if (!ok) droppedPhotos++;
      return ok;
    });
    payload.droppedPhotos = droppedPhotos;

    var droppedAttachments = 0;
    payload.attachments = payload.attachments.filter(function (a) {
      var ok = a.tripId && tripIds[a.tripId];
      if (!ok) droppedAttachments++;
      return ok;
    });
    payload.droppedAttachments = droppedAttachments;

    return payload;
  }

  function normList(kind, list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== 'object') continue;
      var e = M.normalize(kind, list[i]);
      // imported rows are always live
      e.deletedAt = null;
      out.push(e);
    }
    return out;
  }

  /* ------------------------------------------------------- conflicts --- */

  /**
   * Decide what to do with an incoming backup against existing local data.
   *
   * Policy (explicit, never silent):
   *   - Different id                  → 'add'      new row
   *   - Same id, same content         → 'skip'     identical, nothing to do
   *   - Same id, incoming is newer    → 'update'   incoming updatedAt wins
   *   - Same id, local is newer       → 'keep'     local edited more recently, ask user
   *
   * Returns a full plan the UI can show before anything is written.
   */
  function planImport(existing, incoming, opts) {
    var options = opts || {};
    var preferIncoming = options.preferIncoming !== false; // default: incoming wins ties
    var plan = { add: [], update: [], skip: [], conflicts: [] };

    applyTable('cities', 'city', plan, existing.cities, incoming.cities, preferIncoming);
    applyTable('trips', 'trip', plan, existing.trips, incoming.trips, preferIncoming);
    applyTable('photos', 'photo', plan, existing.photos, incoming.photos, preferIncoming);
    applyTable('attachments', 'attachment', plan, existing.attachments, incoming.attachments, preferIncoming);

    plan.total = plan.add.length + plan.update.length + plan.skip.length + plan.conflicts.length;
    plan.hasConflicts = plan.conflicts.length > 0;
    return plan;
  }

  function applyTable(table, kind, plan, existingList, incomingList, preferIncoming) {
    var byId = {};
    var i;
    for (i = 0; i < (existingList || []).length; i++) {
      byId[existingList[i].id] = existingList[i];
    }

    for (i = 0; i < (incomingList || []).length; i++) {
      var inc = incomingList[i];
      var cur = byId[inc.id];

      if (!cur) {
        plan.add.push({ table: table, kind: kind, row: inc });
        continue;
      }

      if (sameContent(kind, cur, inc)) {
        plan.skip.push({ table: table, kind: kind, row: inc, reason: 'identical' });
        continue;
      }

      // Local row was soft-deleted but incoming is live → treat as a restore,
      // unless the local deletion is newer than the backup itself.
      if (M.isLive(cur) === false) {
        if (U.isAfter(cur.deletedAt, inc.updatedAt) && !preferIncoming) {
          plan.conflicts.push({ table: table, kind: kind, row: inc, local: cur, reason: 'deleted-locally' });
        } else {
          plan.update.push({ table: table, kind: kind, row: inc, before: cur, reason: 'restore' });
        }
        continue;
      }

      var cmp = U.compareKeys(inc.updatedAt, cur.updatedAt);
      if (cmp > 0) {
        plan.update.push({ table: table, kind: kind, row: inc, before: cur, reason: 'newer' });
      } else if (cmp === 0 && preferIncoming) {
        plan.update.push({ table: table, kind: kind, row: inc, before: cur, reason: 'same-time' });
      } else {
        plan.conflicts.push({ table: table, kind: kind, row: inc, local: cur, reason: 'local-newer' });
      }
    }
  }

  var CONTENT_FIELDS = {
    city: ['name', 'country', 'province', 'latitude', 'longitude'],
    trip: ['cityId', 'startDate', 'endDate', 'note'],
    photo: ['tripId', 'blobId', 'width', 'height', 'caption'],
    attachment: ['tripId', 'name', 'mimeType', 'blobId', 'bytes']
  };

  function sameContent(kind, a, b) {
    var fields = CONTENT_FIELDS[kind] || [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var av = a[f] === undefined ? null : a[f];
      var bv = b[f] === undefined ? null : b[f];
      if (String(av === null ? '' : av) !== String(bv === null ? '' : bv)) return false;
    }
    return true;
  }

  /** Human summary of a plan for the confirm dialog. */
  function describePlan(plan) {
    var bits = [];
    if (plan.add.length) bits.push('新增 ' + plan.add.length + ' 项');
    if (plan.update.length) bits.push('更新 ' + plan.update.length + ' 项');
    if (plan.skip.length) bits.push('跳过 ' + plan.skip.length + ' 项相同数据');
    if (plan.conflicts.length) bits.push(plan.conflicts.length + ' 项冲突需确认');
    return bits.length ? bits.join('，') : '没有可导入的数据';
  }

  function countByKind(rows) {
    var out = { city: 0, trip: 0, photo: 0, attachment: 0 };
    for (var i = 0; i < rows.length; i++) {
      if (out[rows[i].kind] !== undefined) out[rows[i].kind]++;
    }
    return out;
  }

  TF.backup = {
    BACKUP_VERSION: BACKUP_VERSION,
    APP_VERSION: APP_VERSION,
    MAGIC: MAGIC,
    buildPayload: buildPayload,
    buildManifest: buildManifest,
    parsePayload: parsePayload,
    planImport: planImport,
    describePlan: describePlan,
    countByKind: countByKind,
    sameContent: sameContent,
    extOf: extOf
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
