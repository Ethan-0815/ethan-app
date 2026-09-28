/* ESA · 最近使用
 * 来源全部为真实记录：
 *  - 工具箱：modules/toolbox 自身的 localStorage「toolbox.recent.v1」（进入工具即记录）
 *  - 我的空间：items store 最近创建的物品（名称非敏感）
 *  - 旅行足迹：最近一次旅行的城市
 *  - ETHAN：只记录「打开过 ETHAN」，绝不记录任何条目名称（安全红线）
 * 无历史时显示空状态，不伪造数据。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});
  const KEY = 'esa.recents.v1';

  function readOwn() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; }
    catch (e) { return []; }
  }
  function writeOwn(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* ignore */ }
  }

  /** 记录一次 App 级打开（id: my-space / toolbox / travel-footprint / ethan） */
  function touchApp(id) {
    if (id === 'ethan') {
      // ETHAN 只记录应用级事件，不含任何条目元数据
      const list = readOwn().filter(function (r) { return r.kind !== 'ethan'; });
      list.unshift({ kind: 'ethan', at: Date.now() });
      writeOwn(list);
    } else {
      const list = readOwn().filter(function (r) { return !(r.kind === 'app' && r.id === id); });
      list.unshift({ kind: 'app', id: id, at: Date.now() });
      writeOwn(list);
    }
  }

  function toolboxName(id) {
    try {
      const t = root.TB && root.TB.registry && root.TB.registry.get(id);
      return t ? t.name : null;
    } catch (e) { return null; }
  }

  /** 组装最近使用列表（最多 max 条） */
  function list(max) {
    const limit = max || 5;
    const out = [];

    // 1. 工具箱最近使用的工具（真实记录）
    try {
      const raw = JSON.parse(localStorage.getItem('toolbox.recent.v1') || '[]') || [];
      raw.slice(0, 3).forEach(function (r) {
        const name = toolboxName(r.id);
        if (name && r.at) out.push({ icon: '🧰', name: name, at: r.at });
      });
    } catch (e) { /* ignore */ }

    // 2. 我的空间最近收纳的物品
    // 3. 旅行足迹最近一次旅程
    // 4. ETHAN 应用级记录
    const own = readOwn();
    own.forEach(function (r) {
      if (r.kind === 'ethan') out.push({ icon: '🔐', name: '密码', sub: '最近使用', at: r.at, app: 'ethan' });
      else if (r.kind === 'app' && r.id === 'my-space') out.push({ icon: '📦', name: '我的空间', sub: '最近打开', at: r.at, app: 'my-space' });
      else if (r.kind === 'app' && r.id === 'toolbox') out.push({ icon: '🧰', name: '工具箱', sub: '最近打开', at: r.at, app: 'toolbox' });
      else if (r.kind === 'app' && r.id === 'travel-footprint') out.push({ icon: '🗺️', name: '旅行足迹', sub: '最近打开', at: r.at, app: 'travel-footprint' });
    });

    // 2/3 号来源是异步数据库 —— 由 home 页在 stats 查询后合并传入
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    const seen = {};
    const uniq = [];
    out.forEach(function (r) {
      const key = r.icon + '|' + r.name;
      if (seen[key]) return;
      seen[key] = true;
      uniq.push(r);
    });
    return uniq.slice(0, limit);
  }

  /** 合并数据库侧的最近条目（我的空间物品 / 旅行城市），由 home 调用 */
  function mergeDynamic(base, mySpace, travel) {
    const out = base.slice();
    if (mySpace && mySpace.recentName && mySpace.recentAt) {
      out.push({ icon: '📦', name: mySpace.recentName, sub: '最近收纳', at: mySpace.recentAt, app: 'my-space' });
    }
    if (travel && travel.latestCity && travel.latestAt) {
      out.push({ icon: '🗺️', name: travel.latestCity + '行程', sub: '最近旅程', at: travel.latestAt, app: 'travel-footprint' });
    }
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    const seen = {};
    const uniq = [];
    out.forEach(function (r) {
      const key = r.icon + '|' + r.name;
      if (seen[key]) return;
      seen[key] = true;
      uniq.push(r);
    });
    return uniq.slice(0, 5);
  }

  ESA.recents = { touchApp: touchApp, list: list, mergeDynamic: mergeDynamic };
})(typeof globalThis !== 'undefined' ? globalThis : this);
