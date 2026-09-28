/* ==========================================================================
   Travel Footprint — data/adapter.js
   Storage adapter contract + in-memory implementation (used by tests).
   Adapters expose: all/get/put/putMany/remove/removeMany/clear/count
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  /**
   * In-memory adapter — the reference implementation of the contract.
   * Also used as the fallback when IndexedDB is unavailable (private mode).
   */
  function MemoryAdapter(name) {
    this.name = name || 'memory';
    this._map = new Map();
    this.persistent = false;
  }

  MemoryAdapter.prototype.all = function () {
    var out = [];
    this._map.forEach(function (v) { out.push(clone(v)); });
    return Promise.resolve(out);
  };

  MemoryAdapter.prototype.get = function (id) {
    var v = this._map.get(id);
    return Promise.resolve(v ? clone(v) : null);
  };

  MemoryAdapter.prototype.put = function (row) {
    this._map.set(row.id, clone(row));
    return Promise.resolve(row);
  };

  MemoryAdapter.prototype.putMany = function (rows) {
    for (var i = 0; i < rows.length; i++) this._map.set(rows[i].id, clone(rows[i]));
    return Promise.resolve(rows.length);
  };

  MemoryAdapter.prototype.remove = function (id) {
    this._map.delete(id);
    return Promise.resolve(true);
  };

  MemoryAdapter.prototype.removeMany = function (ids) {
    for (var i = 0; i < ids.length; i++) this._map.delete(ids[i]);
    return Promise.resolve(ids.length);
  };

  MemoryAdapter.prototype.clear = function () {
    this._map.clear();
    return Promise.resolve(true);
  };

  MemoryAdapter.prototype.count = function () {
    return Promise.resolve(this._map.size);
  };

  MemoryAdapter.prototype.close = function () {
    return Promise.resolve(true);
  };

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch (e) {
      return v;
    }
  }

  /**
   * Blob store contract (separate from metadata tables):
   *   putBlob(id, bytes, mimeType) / getBlob(id) → {bytes, mimeType} | null
   *   removeBlob(id) / listBlobIds()
   */
  function MemoryBlobStore() {
    this._map = new Map();
    this.persistent = false;
  }

  MemoryBlobStore.prototype.putBlob = function (id, bytes, mimeType) {
    this._map.set(id, { bytes: toU8(bytes), mimeType: mimeType || 'application/octet-stream' });
    return Promise.resolve(id);
  };

  MemoryBlobStore.prototype.getBlob = function (id) {
    var v = this._map.get(id);
    return Promise.resolve(v ? { bytes: v.bytes, mimeType: v.mimeType } : null);
  };

  MemoryBlobStore.prototype.removeBlob = function (id) {
    this._map.delete(id);
    return Promise.resolve(true);
  };

  MemoryBlobStore.prototype.removeBlobs = function (ids) {
    for (var i = 0; i < ids.length; i++) this._map.delete(ids[i]);
    return Promise.resolve(true);
  };

  MemoryBlobStore.prototype.listBlobIds = function () {
    var out = [];
    this._map.forEach(function (v, k) { out.push(k); });
    return Promise.resolve(out);
  };

  MemoryBlobStore.prototype.clear = function () {
    this._map.clear();
    return Promise.resolve(true);
  };

  function toU8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Uint8Array(0);
  }

  TF.adapter = {
    MemoryAdapter: MemoryAdapter,
    MemoryBlobStore: MemoryBlobStore
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
