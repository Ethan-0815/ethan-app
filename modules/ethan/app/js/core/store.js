/* ETHAN V0.1 — store.js
 * 加密数据层：PIN → KDF → KEK → 解包 DEK → 解密 vault。
 * 内存只持有已解密的 vault；刷新页面即回到锁定状态。
 * 所有落盘内容均为 AES-GCM 密文。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Ethan = root.Ethan || {};
  root.Ethan.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : this;

  var isNode = (typeof module === 'object' && module.exports);
  var U = isNode ? require('./util.js') : root.Ethan.Util;
  var C = isNode ? require('./crypto.js') : root.Ethan.Crypto;
  var DB = isNode ? require('./db.js') : root.Ethan.DB;

  var SCHEMA_VERSION = 1;
  var VAULT_KEY = 'main';
  var META_KEY = 'kdf';
  var PREFS_KEY = 'ethan.ui'; // localStorage：仅非敏感 UI 偏好

  var CATEGORIES = ['account', 'secret', 'text', 'other'];
  var CATEGORY_LABEL = {
    account: '账号密码',
    secret: '密钥 / Token',
    text: '文本',
    other: '其他'
  };
  var SECRET_TYPES = ['API Key', 'Access Token', 'Secret Key', 'SSH Key', 'Token', '其他'];

  var state = {
    ready: false,
    unlocked: false,
    dek: null,
    meta: null,
    vault: null,
    schemaVersion: SCHEMA_VERSION
  };

  var bus = new U.Emitter();

  /* ---------------- 迁移 ---------------- */
  function migrate(raw) {
    var v = raw && typeof raw === 'object' ? (raw.schemaVersion || 1) : 1;
    if (v > SCHEMA_VERSION) {
      throw new Error('备份来自更高版本（schemaVersion ' + v + '），请升级 ETHAN 后再恢复');
    }
    var out = { schemaVersion: SCHEMA_VERSION, items: [], updatedAt: Date.now() };
    if (raw && Array.isArray(raw.items)) out.items = raw.items;
    else if (raw && Array.isArray(raw.data)) out.items = raw.data;
    if (raw && raw.updatedAt) out.updatedAt = raw.updatedAt;
    // 逐条补齐字段（未来版本扩展时在这里做字段迁移）
    out.items = out.items.map(normalizeItem);
    return out;
  }

  function normalizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    if (!it.id) it.id = U.uid();
    if (CATEGORIES.indexOf(it.category) < 0) it.category = 'other';
    it.title = it.title == null ? '' : String(it.title);
    it.tags = Array.isArray(it.tags) ? it.tags.filter(function (t) { return t !== ''; }) : [];
    it.createdAt = it.createdAt || Date.now();
    it.updatedAt = it.updatedAt || it.createdAt;
    it.deletedAt = it.deletedAt || null;
    it.usedAt = it.usedAt || 0;
    if (it.category === 'account') {
      it.username = it.username == null ? '' : String(it.username);
      it.password = it.password == null ? '' : String(it.password);
      it.url = it.url == null ? '' : String(it.url);
      it.note = it.note == null ? '' : String(it.note);
      it.recoveryCodes = Array.isArray(it.recoveryCodes)
        ? it.recoveryCodes.map(function (c) {
            if (typeof c === 'string') return { id: U.uid(), value: c };
            return { id: c.id || U.uid(), value: c.value == null ? '' : String(c.value) };
          })
        : [];
    } else if (it.category === 'secret') {
      it.type = SECRET_TYPES.indexOf(it.type) >= 0 ? it.type : 'API Key';
      it.value = it.value == null ? '' : String(it.value);
      it.note = it.note == null ? '' : String(it.note);
    } else if (it.category === 'text') {
      it.content = it.content == null ? '' : String(it.content);
    } else {
      it.note = it.note == null ? '' : String(it.note);
      it.fields = Array.isArray(it.fields) ? it.fields.map(function (f) {
        return { id: f.id || U.uid(), name: f.name == null ? '' : String(f.name), value: f.value == null ? '' : String(f.value), secret: !!f.secret };
      }) : [];
    }
    return it;
  }

  function emptyVault() {
    return { schemaVersion: SCHEMA_VERSION, items: [], updatedAt: Date.now() };
  }

  /* ---------------- 持久化 ---------------- */
  function persist() {
    if (!state.unlocked || !state.dek) throw new Error('NOT_UNLOCKED');
    state.vault.updatedAt = Date.now();
    writeNonSensitiveStats();
    return C.encryptJson(state.dek, state.vault).then(function (enc) {
      return DB.putVault(VAULT_KEY, { id: VAULT_KEY, iv: enc.iv, ct: enc.ct, updatedAt: state.vault.updatedAt });
    });
  }

  /* ---------------- 非敏感统计（ETHAN Super App 首页卡片用） ----------------
   * 只写入「条目总数 + 更新时间」，不含任何标题、字段值或密文之外的内容。
   * 锁定态下超级 App 首页据此显示「N 条信息」，不触碰 vault 本体。 */
  function writeNonSensitiveStats() {
    try {
      var items = (state.vault && state.vault.items) || [];
      var live = 0;
      for (var i = 0; i < items.length; i++) {
        if (!items[i].deletedAt) live++;
      }
      localStorage.setItem('ethan.stats.v1', JSON.stringify({ count: live, updatedAt: Date.now() }));
    } catch (e) { /* localStorage 不可用时静默跳过 */ }
  }

  /* ---------------- 初始化 / PIN ---------------- */
  function init() {
    if (state.ready) return Promise.resolve({ initialized: !!state.meta });
    return DB.getMeta(META_KEY).then(function (meta) {
      state.meta = meta || null;
      state.ready = true;
      return { initialized: !!meta };
    });
  }

  function isInitialized() { return !!state.meta; }
  function isUnlocked() { return state.unlocked; }

  function setup(pin) {
    if (!/^\d{6}$/.test(String(pin))) throw new Error('PIN 必须为 6 位数字');
    return C.createVaultKeys(pin).then(function (keys) {
      var meta = {
        kdf: { salt: keys.salt, iterations: keys.iterations, wrappedDEK: keys.wrappedDEK, verifier: keys.verifier },
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        pinLength: String(pin).length
      };
      return DB.putMeta(META_KEY, meta).then(function () {
        state.meta = meta;
        state.dek = keys.dek;
        state.unlocked = true;
        state.vault = emptyVault();
        return persist();
      });
    });
  }

  function unlock(pin) {
    if (!state.meta) return Promise.reject(new Error('尚未初始化'));
    return C.unlockVaultKeys(pin, state.meta.kdf).then(function (keys) {
      state.dek = keys.dek;
      return DB.getVault(VAULT_KEY).then(function (rec) {
        if (!rec) {
          state.unlocked = true;
          state.vault = emptyVault();
          writeNonSensitiveStats();
          return true;
        }
        return C.decryptJson(keys.dek, rec.iv, rec.ct).then(function (raw) {
          state.vault = migrate(raw);
          state.unlocked = true;
          writeNonSensitiveStats();
          bus.emit('unlocked');
          return true;
        });
      });
    }).catch(function (e) {
      if (e && e.message === 'INVALID_PIN') throw new Error('PIN 不正确');
      throw e;
    });
  }

  function lock() {
    state.unlocked = false;
    state.dek = null;
    state.vault = null;
    bus.emit('locked');
  }

  function changePin(currentPin, newPin) {
    if (!state.unlocked) return Promise.reject(new Error('NOT_UNLOCKED'));
    if (!/^\d{6}$/.test(String(newPin))) return Promise.reject(new Error('新 PIN 必须为 6 位数字'));
    // 校验当前 PIN（用当前 PIN 派生 KEK 解 verifier）
    return C.unlockVaultKeys(currentPin, state.meta.kdf).then(function (keys) {
      // 用新 PIN 重新包裹同一个 DEK —— 数据无需重新加密，因此不会丢数据
      return C.rewrapDEK(state.dek, newPin).then(function (kdf) {
        var meta = {
          kdf: kdf,
          schemaVersion: SCHEMA_VERSION,
          createdAt: state.meta.createdAt,
          pinLength: String(newPin).length,
          updatedAt: Date.now()
        };
        return DB.putMeta(META_KEY, meta).then(function () {
          state.meta = meta;
          return true;
        });
      });
    }).catch(function (e) {
      if (e && e.message === 'INVALID_PIN') throw new Error('当前 PIN 不正确');
      throw e;
    });
  }

  /* ---------------- CRUD ---------------- */
  function assertUnlocked() {
    if (!state.unlocked || !state.vault) throw new Error('NOT_UNLOCKED');
  }

  function all() {
    assertUnlocked();
    return state.vault.items.filter(function (i) { return !i.deletedAt; });
  }

  function trash() {
    assertUnlocked();
    return state.vault.items.filter(function (i) { return !!i.deletedAt; });
  }

  function get(id) {
    assertUnlocked();
    var found = null;
    state.vault.items.forEach(function (i) { if (i.id === id) found = i; });
    return found;
  }

  function save(item) {
    assertUnlocked();
    var it = normalizeItem(U.deepClone(item));
    if (!it) throw new Error('数据无效');
    var idx = -1;
    state.vault.items.forEach(function (i, k) { if (i.id === it.id) idx = k; });
    if (idx >= 0) {
      it.createdAt = state.vault.items[idx].createdAt;
      it.updatedAt = Date.now();
      state.vault.items[idx] = it;
    } else {
      it.createdAt = it.createdAt || Date.now();
      it.updatedAt = Date.now();
      state.vault.items.push(it);
    }
    return persist().then(function () { bus.emit('changed'); return it; });
  }

  function softDelete(id) {
    assertUnlocked();
    var it = get(id);
    if (!it) return Promise.reject(new Error('内容不存在'));
    it.deletedAt = Date.now();
    return persist().then(function () { bus.emit('changed'); return true; });
  }

  function restore(id) {
    assertUnlocked();
    var it = get(id);
    if (!it) return Promise.reject(new Error('内容不存在'));
    it.deletedAt = null;
    it.updatedAt = Date.now();
    return persist().then(function () { bus.emit('changed'); return true; });
  }

  function purge(id) {
    assertUnlocked();
    var idx = -1;
    state.vault.items.forEach(function (i, k) { if (i.id === id) idx = k; });
    if (idx < 0) return Promise.reject(new Error('内容不存在'));
    state.vault.items.splice(idx, 1);
    return persist().then(function () { bus.emit('changed'); return true; });
  }

  function emptyTrash() {
    assertUnlocked();
    state.vault.items = state.vault.items.filter(function (i) { return !i.deletedAt; });
    return persist().then(function () { bus.emit('changed'); return true; });
  }

  function touch(id) {
    assertUnlocked();
    var it = get(id);
    if (!it) return Promise.resolve(null);
    it.usedAt = Date.now();
    return persist().then(function () { return it; });
  }

  function counts() {
    assertUnlocked();
    var c = { account: 0, secret: 0, text: 0, other: 0 };
    all().forEach(function (i) { if (c[i.category] != null) c[i.category]++; });
    return c;
  }

  function recent(n) {
    assertUnlocked();
    return all()
      .filter(function (i) { return i.usedAt > 0; })
      .sort(function (a, b) { return b.usedAt - a.usedAt; })
      .slice(0, n || 3);
  }

  /* ---------------- 搜索（仅检索非敏感字段） ---------------- */
  function searchableText(it) {
    var parts = [it.title, it.username, it.url, it.note];
    if (Array.isArray(it.tags)) parts = parts.concat(it.tags);
    if (it.category === 'secret') parts.push(it.type);
    if (it.category === 'other' && Array.isArray(it.fields)) {
      parts = parts.concat(it.fields.map(function (f) { return f.name; }));
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function list(opts) {
    assertUnlocked();
    opts = opts || {};
    var items = opts.scope === 'trash' ? trash() : all();
    if (opts.category && opts.category !== 'all') {
      items = items.filter(function (i) { return i.category === opts.category; });
    }
    if (opts.tag) {
      items = items.filter(function (i) { return (i.tags || []).indexOf(opts.tag) >= 0; });
    }
    var q = (opts.query || '').trim().toLowerCase();
    if (q) {
      items = items.filter(function (i) { return searchableText(i).indexOf(q) >= 0; });
    }
    return items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function allTags() {
    assertUnlocked();
    var set = {};
    all().forEach(function (i) { (i.tags || []).forEach(function (t) { set[t] = true; }); });
    return Object.keys(set).sort();
  }

  /* ---------------- 加密备份 / 恢复 ---------------- */
  function backupFilename(ts) {
    var d = new Date(ts || Date.now());
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return 'ETHAN-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.ethan';
  }

  function createBackup(password) {
    assertUnlocked();
    if (!password || password.length < 6) return Promise.reject(new Error('备份密码至少 6 位'));
    var snapshot = {
      schemaVersion: SCHEMA_VERSION,
      data: { items: U.deepClone(state.vault.items) },
      metadata: {
        app: 'ETHAN',
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        counts: counts(),
        total: state.vault.items.length
      }
    };
    return C.createBackupKeys(password).then(function (bk) {
      return C.encryptJson(bk.key, snapshot).then(function (enc) {
        var file = {
          app: 'ETHAN',
          kind: 'backup',
          schemaVersion: SCHEMA_VERSION,
          kdf: { salt: bk.salt, iterations: bk.iterations },
          iv: enc.iv,
          ct: enc.ct
        };
        return {
          filename: backupFilename(snapshot.metadata.createdAt),
          text: JSON.stringify(file),
          counts: snapshot.metadata.counts
        };
      });
    });
  }

  // 解析并解密备份文件；失败时给出明确错误
  function readBackup(text, password) {
    var file;
    try {
      file = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      return Promise.reject(new Error('备份文件损坏或不是 ETHAN 备份'));
    }
    if (!file || file.app !== 'ETHAN' || !file.ct || !file.iv || !file.kdf) {
      return Promise.reject(new Error('备份文件损坏或不是 ETHAN 备份'));
    }
    if (file.schemaVersion > SCHEMA_VERSION) {
      return Promise.reject(new Error('备份来自更高版本，请升级 ETHAN 后再恢复'));
    }
    return C.unlockBackupKeys(password, file.kdf.salt, file.kdf.iterations)
      .then(function (key) { return C.decryptJson(key, file.iv, file.ct); })
      .then(function (payload) {
        if (!payload || !payload.data) throw new Error('备份内容损坏');
        var items = (payload.data.items || []).map(normalizeItem).filter(Boolean);
        var c = { account: 0, secret: 0, text: 0, other: 0 };
        items.forEach(function (i) { if (!i.deletedAt && c[i.category] != null) c[i.category]++; });
        return {
          payload: payload,
          items: items,
          counts: c,
          createdAt: (payload.metadata && payload.metadata.createdAt) || 0
        };
      })
      .catch(function (e) {
        if (e && /INVALID_PIN|备份/.test(e.message)) throw e;
        throw new Error('备份密码错误或备份文件已损坏');
      });
  }

  /**
   * 应用备份
   * mode: 'merge' | 'replace'
   * conflict: 'keep'（保留现有） | 'overwrite'（用备份覆盖）
   * 返回 {added, updated, skipped, conflicts, mode}
   */
  function applyBackup(backup, opts) {
    assertUnlocked();
    opts = opts || {};
    var mode = opts.mode === 'replace' ? 'replace' : 'merge';
    var conflict = opts.conflict === 'overwrite' ? 'overwrite' : 'keep';
    var incoming = backup.items || [];
    var result = { added: 0, updated: 0, skipped: 0, conflicts: [], mode: mode };

    if (mode === 'replace') {
      state.vault.items = U.deepClone(incoming).map(normalizeItem);
      result.added = state.vault.items.length;
      return persist().then(function () { bus.emit('changed'); return result; });
    }

    var byId = {};
    state.vault.items.forEach(function (i) { byId[i.id] = i; });

    incoming.forEach(function (raw) {
      var it = normalizeItem(U.deepClone(raw));
      if (!it) return;
      var exist = byId[it.id];
      if (!exist) {
        state.vault.items.push(it);
        byId[it.id] = it;
        result.added++;
      } else {
        // 存在相同条目：明确记为冲突，绝不静默覆盖
        result.conflicts.push({ id: it.id, title: it.title, localUpdatedAt: exist.updatedAt, backupUpdatedAt: it.updatedAt });
        if (conflict === 'overwrite') {
          var idx = state.vault.items.indexOf(exist);
          state.vault.items[idx] = it;
          result.updated++;
        } else {
          result.skipped++;
        }
      }
    });

    state.vault.items = state.vault.items.map(normalizeItem);
    return persist().then(function () { bus.emit('changed'); return result; });
  }

  /* ---------------- 非敏感 UI 偏好（localStorage） ---------------- */
  // 仅非敏感 UI 偏好（自动锁定时长、上次所在页、外观主题）
  var DEFAULT_PREFS = { autoLock: 5, lastTab: 'home', theme: 'auto' };

  function getPrefs() {
    var p = {};
    try {
      var raw = (typeof localStorage !== 'undefined') && localStorage.getItem(PREFS_KEY);
      if (raw) p = JSON.parse(raw) || {};
    } catch (e) { p = {}; }
    return {
      autoLock: p.autoLock === undefined ? DEFAULT_PREFS.autoLock : p.autoLock,
      lastTab: p.lastTab || DEFAULT_PREFS.lastTab,
      theme: p.theme || DEFAULT_PREFS.theme
    };
  }

  function setPrefs(patch) {
    var cur = getPrefs();
    var next = { autoLock: cur.autoLock, lastTab: cur.lastTab, theme: cur.theme };
    if (patch && patch.autoLock !== undefined) next.autoLock = patch.autoLock;
    if (patch && patch.lastTab !== undefined) next.lastTab = patch.lastTab;
    if (patch && patch.theme !== undefined) next.theme = patch.theme;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (e) { /* 隐私模式下写入失败：不影响使用 */ }
    return next;
  }

  /* ---------------- 工厂：新建条目 ---------------- */
  function newItem(category) {
    var base = {
      id: U.uid(),
      category: category,
      title: '',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      usedAt: 0
    };
    if (category === 'account') {
      return Object.assign(base, { username: '', password: '', url: '', note: '', recoveryCodes: [] });
    }
    if (category === 'secret') {
      return Object.assign(base, { type: 'API Key', value: '', note: '' });
    }
    if (category === 'text') {
      return Object.assign(base, { content: '' });
    }
    return Object.assign(base, { note: '', fields: [] });
  }

  // 校验：返回 {ok, message}
  function validate(item) {
    if (!item) return { ok: false, message: '数据无效' };
    if (!String(item.title || '').trim()) return { ok: false, message: '名称不能为空' };
    if (item.category === 'account' && !String(item.password || '')) return { ok: false, message: '密码不能为空' };
    if (item.category === 'secret' && !String(item.value || '')) return { ok: false, message: '密钥内容不能为空' };
    return { ok: true };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    CATEGORIES: CATEGORIES,
    CATEGORY_LABEL: CATEGORY_LABEL,
    SECRET_TYPES: SECRET_TYPES,
    on: bus.on.bind(bus),
    off: bus.off.bind(bus),
    init: init,
    isInitialized: isInitialized,
    isUnlocked: isUnlocked,
    setup: setup,
    unlock: unlock,
    lock: lock,
    changePin: changePin,
    all: all,
    trash: trash,
    get: get,
    save: save,
    softDelete: softDelete,
    restore: restore,
    purge: purge,
    emptyTrash: emptyTrash,
    touch: touch,
    counts: counts,
    recent: recent,
    list: list,
    allTags: allTags,
    createBackup: createBackup,
    readBackup: readBackup,
    applyBackup: applyBackup,
    backupFilename: backupFilename,
    getPrefs: getPrefs,
    setPrefs: setPrefs,
    newItem: newItem,
    validate: validate,
    migrate: migrate,
    normalizeItem: normalizeItem,
    // 仅供测试与诊断
    _state: state,
    _persist: persist
  };
});
