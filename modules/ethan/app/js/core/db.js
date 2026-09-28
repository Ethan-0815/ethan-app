/* ETHAN V0.1 — db.js
 * IndexedDB 封装。所有敏感数据进入 IndexedDB（且为密文）。
 * localStorage 仅用于极少量非敏感 UI 偏好（自动锁定时长等），见 store.js/settings。
 *
 * 说明：为了让 Node 环境下的单元测试能够运行核心逻辑，本模块内置了一个
 * 可选的内存后端（仅测试注入使用）。浏览器运行时始终走真实 IndexedDB。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Ethan = root.Ethan || {};
  root.Ethan.DB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : this;

  var DB_NAME = 'ethan';
  var DB_VERSION = 1;
  var STORE_META = 'meta';
  var STORE_VAULT = 'vault';

  var injectedBackend = null; // 仅测试使用

  function memoryBackend() {
    var stores = {};
    function store(name) { return (stores[name] = stores[name] || new Map()); }
    return {
      get: function (name, key) {
        return Promise.resolve(store(name).has(key) ? store(name).get(key) : undefined);
      },
      put: function (name, value, key) {
        store(name).set(key == null ? value.id : key, value);
        return Promise.resolve(true);
      },
      del: function (name, key) {
        store(name).delete(key);
        return Promise.resolve(true);
      },
      keys: function (name) {
        return Promise.resolve(Array.from(store(name).keys()));
      },
      clear: function (name) {
        store(name).clear();
        return Promise.resolve(true);
      }
    };
  }

  // 测试注入（浏览器不会调用）
  function setBackend(backend) { injectedBackend = backend; }

  function hasIndexedDB() {
    try {
      return !!(root.indexedDB || (typeof indexedDB !== 'undefined' && indexedDB));
    } catch (e) { return false; }
  }

  var dbPromise = null;

  function open() {
    if (injectedBackend) return Promise.resolve(injectedBackend);
    if (!hasIndexedDB()) {
      return Promise.reject(new Error('当前浏览器环境不支持 IndexedDB，无法保存数据'));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var factory = root.indexedDB || indexedDB;
      var req;
      try { req = factory.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_VAULT)) db.createObjectStore(STORE_VAULT);
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(idbBackend(db));
      };
      req.onerror = function () { reject(req.error || new Error('无法打开本地数据库')); };
      req.onblocked = function () { reject(new Error('本地数据库被其它页面占用')); };
    }).catch(function (e) {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }

  function idbBackend(db) {
    function tx(name, mode) {
      return db.transaction(name, mode).objectStore(name);
    }
    return {
      get: function (name, key) {
        return new Promise(function (resolve, reject) {
          var r = tx(name, 'readonly').get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error || new Error('读取失败')); };
        });
      },
      put: function (name, value, key) {
        return new Promise(function (resolve, reject) {
          var r = tx(name, 'readwrite').put(value, key == null ? value.id : key);
          r.onsuccess = function () { resolve(true); };
          r.onerror = function () {
            var e = r.error;
            reject(new Error(e && e.name === 'QuotaExceededError' ? '存储空间不足' : '写入失败'));
          };
        });
      },
      del: function (name, key) {
        return new Promise(function (resolve, reject) {
          var r = tx(name, 'readwrite').delete(key);
          r.onsuccess = function () { resolve(true); };
          r.onerror = function () { reject(r.error || new Error('删除失败')); };
        });
      },
      keys: function (name) {
        return new Promise(function (resolve, reject) {
          var r = tx(name, 'readonly').getAllKeys();
          r.onsuccess = function () { resolve(r.result || []); };
          r.onerror = function () { reject(r.error || new Error('读取失败')); };
        });
      },
      clear: function (name) {
        return new Promise(function (resolve, reject) {
          var r = tx(name, 'readwrite').clear();
          r.onsuccess = function () { resolve(true); };
          r.onerror = function () { reject(r.error || new Error('清空失败')); };
        });
      }
    };
  }

  function getMeta(key) { return open().then(function (b) { return b.get(STORE_META, key); }); }
  function putMeta(key, value) { return open().then(function (b) { return b.put(STORE_META, value, key); }); }
  function delMeta(key) { return open().then(function (b) { return b.del(STORE_META, key); }); }
  function getVault(key) { return open().then(function (b) { return b.get(STORE_VAULT, key); }); }
  function putVault(key, value) { return open().then(function (b) { return b.put(STORE_VAULT, value, key); }); }
  function wipe() {
    return open().then(function (b) {
      return b.clear(STORE_META).then(function () { return b.clear(STORE_VAULT); });
    });
  }

  function isAvailable() {
    return open().then(function () { return true; }).catch(function () { return false; });
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORE_META: STORE_META,
    STORE_VAULT: STORE_VAULT,
    setBackend: setBackend,
    memoryBackend: memoryBackend,
    open: open,
    isAvailable: isAvailable,
    getMeta: getMeta,
    putMeta: putMeta,
    delMeta: delMeta,
    getVault: getVault,
    putVault: putVault,
    wipe: wipe
  };
});
