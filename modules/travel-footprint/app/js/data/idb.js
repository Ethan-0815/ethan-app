/* ==========================================================================
   Travel Footprint — data/idb.js
   IndexedDB adapter + blob store. Fully offline, no network.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  var DB_NAME = 'travel-footprint';
  // v2: photos/attachments stores were first created WITHOUT a keyPath, which
  // made every photo/attachment write fail with "out-of-line keys … key not
  // provided". Nothing ever landed in those stores (every put failed), so
  // recreating them on upgrade loses nothing.
  var DB_VERSION = 2;
  var STORES = ['cities', 'trips', 'photos', 'attachments', 'blobs', 'meta'];

  /* ------------------------------------------------------------- open --- */

  function openDb(name, version) {
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(name || DB_NAME, version || DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }

      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        for (var i = 0; i < STORES.length; i++) {
          var s = STORES[i];
          if (db.objectStoreNames.contains(s)) {
            // v1 shipped photos/attachments without a keyPath — rebuild them.
            if ((s === 'photos' || s === 'attachments') && ev.oldVersion < 2) {
              db.deleteObjectStore(s);
              db.createObjectStore(s, { keyPath: 'id' });
            }
            continue;
          }
          if (s === 'blobs') {
            db.createObjectStore(s);   // blob payloads use an explicit key
          } else if (s === 'meta') {
            db.createObjectStore(s, { keyPath: 'key' });
          } else {
            db.createObjectStore(s, { keyPath: 'id' });
          }
        }
        // useful indexes for filtered reads
        try {
          var tripStore = ev.target.transaction.objectStore('trips');
          if (!tripStore.indexNames.contains('cityId')) {
            tripStore.createIndex('cityId', 'cityId', { unique: false });
          }
          var photoStore = ev.target.transaction.objectStore('photos');
          if (!photoStore.indexNames.contains('tripId')) {
            photoStore.createIndex('tripId', 'tripId', { unique: false });
          }
          var attStore = ev.target.transaction.objectStore('attachments');
          if (!attStore.indexNames.contains('tripId')) {
            attStore.createIndex('tripId', 'tripId', { unique: false });
          }
        } catch (e) { /* indexes are an optimisation, not a requirement */ }
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 被其他标签页占用，请关闭其他窗口后重试')); };
    });
  }

  /** Promise wrapper around an IDBRequest. */
  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* --------------------------------------------------- key-value adapter --- */

  /**
   * Adapter for metadata tables. Blobs use a separate store and their own API.
   */
  function IdbAdapter(name, dbName, version) {
    this.name = name;
    this.persistent = true;
    this._dbName = dbName || DB_NAME;
    this._version = version || DB_VERSION;
    this._db = null;
  }

  IdbAdapter.prototype.open = function () {
    var self = this;
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = openDb(this._dbName, this._version).then(function (db) {
      self._db = db;
      self._opening = null;
      db.onversionchange = function () { db.close(); self._db = null; };
      return db;
    });
    return this._opening;
  };

  IdbAdapter.prototype._tx = function (mode) {
    var self = this;
    return this.open().then(function (db) {
      var tx = db.transaction(self.name, mode);
      return { tx: tx, store: tx.objectStore(self.name) };
    });
  };

  IdbAdapter.prototype.all = function () {
    return this._tx('readonly').then(function (c) {
      return wrap(c.store.getAll());
    }).then(function (rows) {
      return rows || [];
    });
  };

  IdbAdapter.prototype.get = function (id) {
    return this._tx('readonly').then(function (c) {
      return wrap(c.store.get(id));
    }).then(function (row) {
      return row || null;
    });
  };

  IdbAdapter.prototype.put = function (row) {
    return this._tx('readwrite').then(function (c) {
      return wrap(c.store.put(row)).then(function () { return row; });
    });
  };

  IdbAdapter.prototype.putMany = function (rows) {
    if (!rows.length) return Promise.resolve(0);
    return this._tx('readwrite').then(function (c) {
      for (var i = 0; i < rows.length; i++) c.store.put(rows[i]);
      return new Promise(function (resolve, reject) {
        c.tx.oncomplete = function () { resolve(rows.length); };
        c.tx.onerror = function () { reject(c.tx.error); };
        c.tx.onabort = function () { reject(c.tx.error || new Error('写入被中止')); };
      });
    });
  };

  IdbAdapter.prototype.remove = function (id) {
    return this._tx('readwrite').then(function (c) {
      return wrap(c.store.delete(id)).then(function () { return true; });
    });
  };

  IdbAdapter.prototype.removeMany = function (ids) {
    if (!ids.length) return Promise.resolve(0);
    return this._tx('readwrite').then(function (c) {
      for (var i = 0; i < ids.length; i++) c.store.delete(ids[i]);
      return new Promise(function (resolve, reject) {
        c.tx.oncomplete = function () { resolve(ids.length); };
        c.tx.onerror = function () { reject(c.tx.error); };
      });
    });
  };

  IdbAdapter.prototype.clear = function () {
    return this._tx('readwrite').then(function (c) {
      return wrap(c.store.clear()).then(function () { return true; });
    });
  };

  IdbAdapter.prototype.count = function () {
    return this._tx('readonly').then(function (c) {
      return wrap(c.store.count());
    });
  };

  IdbAdapter.prototype.close = function () {
    if (this._db) { this._db.close(); this._db = null; }
    return Promise.resolve(true);
  };

  /* ------------------------------------------------------- blob store --- */

  function IdbBlobStore(dbName, version) {
    this.persistent = true;
    this._dbName = dbName || DB_NAME;
    this._version = version || DB_VERSION;
    this._db = null;
  }

  IdbBlobStore.prototype.open = function () {
    var self = this;
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = openDb(this._dbName, this._version).then(function (db) {
      self._db = db;
      self._opening = null;
      return db;
    });
    return this._opening;
  };

  IdbBlobStore.prototype.putBlob = function (id, bytes, mimeType) {
    var self = this;
    var payload = {
      bytes: toU8(bytes),
      mimeType: mimeType || 'application/octet-stream',
      savedAt: new Date().toISOString()
    };
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(payload, id);
      return new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(id); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('图片写入失败（可能空间不足）')); };
      });
    });
  };

  IdbBlobStore.prototype.getBlob = function (id) {
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readonly');
      return wrap(tx.objectStore('blobs').get(id));
    }).then(function (rec) {
      if (!rec) return null;
      return { bytes: toU8(rec.bytes), mimeType: rec.mimeType };
    });
  };

  IdbBlobStore.prototype.removeBlob = function (id) {
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(id);
      return new Promise(function (resolve) {
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    });
  };

  IdbBlobStore.prototype.removeBlobs = function (ids) {
    if (!ids.length) return Promise.resolve(true);
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readwrite');
      var store = tx.objectStore('blobs');
      for (var i = 0; i < ids.length; i++) store.delete(ids[i]);
      return new Promise(function (resolve) {
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    });
  };

  IdbBlobStore.prototype.listBlobIds = function () {
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readonly');
      return wrap(tx.objectStore('blobs').getAllKeys());
    }).then(function (keys) {
      return keys || [];
    });
  };

  IdbBlobStore.prototype.clear = function () {
    return this.open().then(function (db) {
      var tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').clear();
      return new Promise(function (resolve) {
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    });
  };

  /* ---------------------------------------------------------- helpers --- */

  function toU8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (typeof bytes === 'string') return TF.zip.utf8Encode(bytes);
    return new Uint8Array(0);
  }

  function isAvailable() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) {
      return false;
    }
  }

  /** Ask the browser to make storage persistent so the OS won't evict data. */
  function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().then(function (granted) {
          return !!granted;
        }).catch(function () { return false; });
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  }

  function estimateUsage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (est) {
          return { usage: est.usage || 0, quota: est.quota || 0 };
        }).catch(function () { return { usage: 0, quota: 0 }; });
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve({ usage: 0, quota: 0 });
  }

  TF.idb = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    openDb: openDb,
    IdbAdapter: IdbAdapter,
    IdbBlobStore: IdbBlobStore,
    isAvailable: isAvailable,
    requestPersistence: requestPersistence,
    estimateUsage: estimateUsage,
    toU8: toU8
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
