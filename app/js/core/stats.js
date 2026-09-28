/* ESA · 首页真实数据统计（只读，绝不写入任何模块数据库）
 * 我的空间  → IndexedDB my-space：live 物品数 + 最近收纳物品名
 * 旅行足迹  → IndexedDB travel-footprint：有旅行的城市数 + 最近一次城市
 * 工具箱    → modules/toolbox 的 registry（TB 命名空间，与 shell 无冲突）
 * ETHAN     → localStorage ethan.stats.v1（非敏感计数，由 ETHAN 模块在解锁/持久化时写入）
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  function idbOpen(name) {
    return new Promise(function (resolve) {
      if (!root.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(name); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function (ev) {
        // 数据库不存在时会被我们意外创建 —— 关掉并删除，避免污染模块
        if (ev.oldVersion === 0) {
          try { req.result.close(); } catch (e) {}
          try { indexedDB.deleteDatabase(name); } catch (e) {}
          resolve(null);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }

  function txAll(db, store) {
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  /* ---------------- 我的空间 ---------------- */
  function mySpaceStats() {
    return idbOpen('my-space').then(function (db) {
      if (!db) return { count: 0, recentName: null, recentAt: null };
      return txAll(db, 'items').then(function (items) {
        const live = items.filter(function (it) { return it && !it.deletedAt; });
        let recent = null;
        live.forEach(function (it) {
          if (!recent || (it.createdAt || 0) > (recent.createdAt || 0)) recent = it;
        });
        db.close();
        return {
          count: live.length,
          recentName: recent ? recent.name : null,
          recentAt: recent ? recent.createdAt : null
        };
      });
    });
  }

  /* ---------------- 旅行足迹 ---------------- */
  function travelStats() {
    return idbOpen('travel-footprint').then(function (db) {
      if (!db) return { cityCount: 0, latestCity: null, latestAt: null };
      return Promise.all([txAll(db, 'cities'), txAll(db, 'trips')]).then(function (rs) {
        const cities = rs[0] || [];
        const trips = (rs[1] || []).filter(function (t) { return t && !t.deletedAt; });
        const byId = {};
        cities.forEach(function (c) { if (c && !c.deletedAt) byId[c.id] = c; });
        const visited = {};
        let latest = null;
        trips.forEach(function (t) {
          if (!byId[t.cityId]) return;
          visited[t.cityId] = true;
          if (!latest || (t.startDate || '') > (latest.startDate || '')) latest = t;
        });
        db.close();
        return {
          cityCount: Object.keys(visited).length,
          latestCity: latest ? (byId[latest.cityId] ? byId[latest.cityId].name : null) : null,
          latestAt: latest ? (latest.startDate ? Date.parse(latest.startDate) : null) : null
        };
      });
    });
  }

  /* ---------------- 工具箱 ---------------- */
  function toolboxStats() {
    let count = 0;
    try {
      if (root.TB && root.TB.registry && typeof root.TB.registry.count === 'function') {
        count = root.TB.registry.count();
      }
    } catch (e) { count = 0; }
    return Promise.resolve({ count: count });
  }

  /* ---------------- ETHAN（非敏感） ---------------- */
  function ethanStats() {
    let out = { count: null, updatedAt: null };
    try {
      const raw = localStorage.getItem('ethan.stats.v1');
      if (raw) {
        const v = JSON.parse(raw);
        if (v && typeof v.count === 'number') out = { count: v.count, updatedAt: v.updatedAt || null };
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve(out);
  }

  function all() {
    return Promise.all([mySpaceStats(), toolboxStats(), travelStats(), ethanStats()])
      .then(function (rs) {
        return { mySpace: rs[0], toolbox: rs[1], travel: rs[2], ethan: rs[3] };
      });
  }

  ESA.stats = {
    all: all,
    mySpace: mySpaceStats,
    toolbox: toolboxStats,
    travel: travelStats,
    ethan: ethanStats
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
