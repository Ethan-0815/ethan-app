/*!
 * 工具箱 · 最近使用（只保存在本机）
 * 最多 4 条、同一工具只保留一条、按最近使用时间倒序。
 * localStorage 不可用时（隐私模式等）退化为内存存储，功能不中断。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const RECENT_KEY = 'toolbox.recent.v1';
  const PREFS_KEY = 'toolbox.prefs.v1';
  const MAX_RECENT = 4;

  const memory = {};
  let useMemory = false;

  function readRaw(key) {
    if (!useMemory) {
      try {
        if (root.localStorage) {
          const raw = root.localStorage.getItem(key);
          return raw === null ? null : raw;
        }
      } catch (e) {
        useMemory = true;
      }
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    if (!useMemory) {
      try {
        if (root.localStorage) {
          root.localStorage.setItem(key, value);
          return;
        }
      } catch (e) {
        useMemory = true;      // 配额或隐私模式 → 降级
      }
    }
    memory[key] = value;
  }

  function readJson(key, fallback) {
    const raw = readRaw(key);
    if (raw === null || raw === undefined) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  /* ---------------------------------------------------------------- 最近使用 */

  /** @returns {Array<{id:string, at:number}>} 最新的在前 */
  function list() {
    const saved = readJson(RECENT_KEY, []);
    if (!Array.isArray(saved)) return [];
    const known = {};
    TB.registry.all().forEach(function (tool) { known[tool.id] = true; });
    const seen = {};
    const out = [];
    saved.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const id = U.trimOrNull(item.id);
      if (!id || !known[id] || seen[id]) return;      // 过滤掉已下线的工具与脏数据
      seen[id] = true;
      out.push({ id: id, at: Number.isFinite(item.at) ? item.at : 0 });
    });
    out.sort(function (a, b) { return b.at - a.at; });
    return out.slice(0, MAX_RECENT);
  }

  /** 记录一次使用；重复使用只更新时间与位置 */
  function touch(id) {
    const key = U.trimOrNull(id);
    if (!key || !TB.registry.get(key)) return list();
    const current = list().filter(function (item) { return item.id !== key; });
    current.unshift({ id: key, at: Date.now() });
    const trimmed = current.slice(0, MAX_RECENT);
    writeRaw(RECENT_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  function clear() {
    writeRaw(RECENT_KEY, '[]');
    return [];
  }

  function ids() {
    return list().map(function (item) { return item.id; });
  }

  /* ---------------------------------------------------------------- 工具偏好 */
  /* 只保存"真正有必要"的设置，例如文件大小换算的进制偏好 */

  function prefs() {
    const saved = readJson(PREFS_KEY, {});
    return saved && typeof saved === 'object' ? saved : {};
  }

  function getPref(key, fallback) {
    const p = prefs();
    return Object.prototype.hasOwnProperty.call(p, key) ? p[key] : fallback;
  }

  function setPref(key, value) {
    const p = prefs();
    p[key] = value;
    writeRaw(PREFS_KEY, JSON.stringify(p));
    return value;
  }

  TB.recent = {
    MAX: MAX_RECENT,
    RECENT_KEY: RECENT_KEY,
    PREFS_KEY: PREFS_KEY,
    list: list,
    ids: ids,
    touch: touch,
    clear: clear,
    getPref: getPref,
    setPref: setPref
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
