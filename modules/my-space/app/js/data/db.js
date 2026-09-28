/*!
 * 我的空间 · 数据层（IndexedDB 适配器）
 *
 * 说明：H5 层使用 IndexedDB 作为结构化本地数据库（等价于原生端的 SQLite），
 * 表结构设计：items / categories / tags / images / blobs / meta。
 * 其中 item_tags 关系由 items.tagIds 数组承载，item_images 关系由 images.itemId
 * 与 items.imageIds 双向承载 —— 所有关联都使用稳定 UUID。
 * 大二进制（图片）只存在 blobs 表里，元数据与二进制分离，列表不会加载原图。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const DB_NAME = 'my-space';
  const DB_VERSION = 1;

  const STORES = {
    items: { keyPath: 'id', indexes: [['by_createdAt', 'createdAt'], ['by_updatedAt', 'updatedAt'], ['by_lastViewedAt', 'lastViewedAt'], ['by_deletedAt', 'deletedAt'], ['by_categoryId', 'categoryId']] },
    categories: { keyPath: 'id', indexes: [['by_order', 'order']] },
    tags: { keyPath: 'id', indexes: [['by_name', 'name']] },
    images: { keyPath: 'id', indexes: [['by_itemId', 'itemId'], ['by_createdAt', 'createdAt']] },
    blobs: { keyPath: 'id', indexes: [] },
    meta: { keyPath: 'key', indexes: [] }
  };

  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('aborted')); };
    });
  }

  function createStore(db, name, def) {
    const store = db.createObjectStore(name, { keyPath: def.keyPath });
    def.indexes.forEach(function (idx) {
      store.createIndex(idx[0], idx[1], { unique: false });
    });
  }

  function open() {
    return new Promise(function (resolve, reject) {
      let idb;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb) { reject(MS.appError('DB_UNAVAILABLE', 'indexedDB missing')); return; }
      let request;
      try {
        request = idb.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(MS.appError('DB_UNAVAILABLE', e && e.message));
        return;
      }
      request.onupgradeneeded = function (event) {
        const db = request.result;
        const existing = db.objectStoreNames;
        for (const name in STORES) {
          if (!existing.contains(name)) createStore(db, name, STORES[name]);
        }
        if (event.oldVersion < 1) {
          // 首次安装：写入一个初始化标记
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(MS.appError('DB_UNAVAILABLE', request.error && request.error.message)); };
      request.onblocked = function () { reject(MS.appError('DB_UNAVAILABLE', 'blocked')); };
    });
  }

  /**
   * 创建一个 IndexedDB 适配器。
   * 接口刻意保持简单（all/get/put/putMany/remove/removeMany/clear），
   * 因此可以无缝替换为原生 SQLite 桥接实现或内存实现（测试用）。
   */
  function createIdbAdapter() {
    let db = null;

    function table(name) {
      function ensure() {
        if (!db) throw MS.appError('DB_UNAVAILABLE', 'not ready');
        return db;
      }
      return {
        all: function () {
          const d = ensure();
          const tx = d.transaction(name, 'readonly');
          return req(tx.objectStore(name).getAll());
        },
        allKeys: function () {
          const d = ensure();
          const tx = d.transaction(name, 'readonly');
          return req(tx.objectStore(name).getAllKeys());
        },
        get: function (id) {
          const d = ensure();
          const tx = d.transaction(name, 'readonly');
          return req(tx.objectStore(name).get(id)).then(function (v) { return v === undefined ? null : v; });
        },
        count: function () {
          const d = ensure();
          const tx = d.transaction(name, 'readonly');
          return req(tx.objectStore(name).count());
        },
        put: function (record) {
          const d = ensure();
          const tx = d.transaction(name, 'readwrite');
          tx.objectStore(name).put(record);
          return txDone(tx);
        },
        putMany: function (records) {
          const list = Array.isArray(records) ? records : [];
          if (!list.length) return Promise.resolve();
          const d = ensure();
          const tx = d.transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          list.forEach(function (r) { store.put(r); });
          return txDone(tx);
        },
        remove: function (id) {
          const d = ensure();
          const tx = d.transaction(name, 'readwrite');
          tx.objectStore(name).delete(id);
          return txDone(tx);
        },
        removeMany: function (ids) {
          const list = Array.isArray(ids) ? ids : [];
          if (!list.length) return Promise.resolve();
          const d = ensure();
          const tx = d.transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          list.forEach(function (id) { store.delete(id); });
          return txDone(tx);
        },
        clear: function () {
          const d = ensure();
          const tx = d.transaction(name, 'readwrite');
          tx.objectStore(name).clear();
          return txDone(tx);
        }
      };
    }

    const adapter = {
      kind: 'indexeddb',
      ready: async function () {
        if (!db) db = await open();
        return adapter;
      },
      isReady: function () { return !!db; },
      items: table('items'),
      categories: table('categories'),
      tags: table('tags'),
      images: table('images'),
      blobs: table('blobs'),
      meta: {
        get: function (key) {
          const d = db;
          if (!d) return Promise.resolve(null);
          const tx = d.transaction('meta', 'readonly');
          return req(tx.objectStore('meta').get(key)).then(function (v) {
            return v && 'value' in v ? v.value : null;
          });
        },
        set: function (key, value) {
          const d = db;
          if (!d) return Promise.resolve();
          const tx = d.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ key: key, value: value });
          return txDone(tx);
        }
      },
      /** 清空所有业务数据（保留 meta 中的界面偏好） */
      clearAll: async function () {
        await adapter.items.clear();
        await adapter.categories.clear();
        await adapter.tags.clear();
        await adapter.images.clear();
        await adapter.blobs.clear();
      },
      /** 估算占用（浏览器支持时） */
      estimate: async function () {
        if (root.navigator && root.navigator.storage && root.navigator.storage.estimate) {
          try {
            const est = await root.navigator.storage.estimate();
            return { usage: est.usage || 0, quota: est.quota || 0 };
          } catch (e) { return null; }
        }
        return null;
      },
      close: function () {
        if (db) { try { db.close(); } catch (e) { /* ignore */ } }
        db = null;
      }
    };

    return adapter;
  }

  MS.storage = { createIdbAdapter: createIdbAdapter, DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, STORES: STORES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
