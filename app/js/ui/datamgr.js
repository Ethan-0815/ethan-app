/* ESA · 统一数据管理：全量备份 / 恢复（唯一入口）
 *
 * 数据范围：
 *   我的空间   → IndexedDB my-space          （items/categories/tags/images/meta + blobs 二进制）
 *   旅行足迹   → IndexedDB travel-footprint   （cities/trips/photos/attachments/meta + blobs 二进制）
 *   ETHAN      → IndexedDB ethan              （meta/vault，密文原样拷贝，保持独立加密边界）
 *
 * 文件格式（.ethan，单一文件）：
 * {
 *   format: 'ethan-superapp-backup',
 *   version: 1,
 *   createdAt: ISO,
 *   modules: {
 *     mySpace:         { stores: {...JSON 行...}, blobs: [{key, dataB64, mime, thumbB64}] },
 *     travelFootprint: { stores: {...JSON 行...}, blobs: [{key, dataB64, mime}] },
 *     ethan:           { encrypted: true, stores: { meta: [...], vault: [...] } }
 *   }
 * }
 *
 * 安全边界：ETHAN 的 vault 是 AES-256-GCM 密文（含随机 IV），统一备份只拷贝密文行，
 * 绝不出现明文机密；meta 为 KDF 参数（盐/校验器），非敏感。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  const MODULES = [
    {
      key: 'mySpace', label: '我的空间', db: 'my-space', version: 1, encrypted: false,
      jsonStores: [
        { name: 'items', keyPath: 'id' },
        { name: 'categories', keyPath: 'id' },
        { name: 'tags', keyPath: 'id' },
        { name: 'images', keyPath: 'id' },
        { name: 'meta', keyPath: 'key' }
      ],
      blobStores: [{ name: 'blobs', dataField: 'data', thumbField: 'thumb', inline: true }]
    },
    {
      key: 'travelFootprint', label: '旅行足迹', db: 'travel-footprint', version: 2, encrypted: false,
      jsonStores: [
        { name: 'cities', keyPath: 'id' },
        { name: 'trips', keyPath: 'id' },
        { name: 'photos', keyPath: 'id' },
        { name: 'attachments', keyPath: 'id' },
        { name: 'meta', keyPath: 'key' }
      ],
      blobStores: [{ name: 'blobs', dataField: 'bytes', mimeField: 'mimeType', inline: false, u8: true }]
    },
    {
      key: 'ethan', label: 'ETHAN', db: 'ethan', version: 1, encrypted: true,
      jsonStores: [
        { name: 'meta', keyPath: null },
        { name: 'vault', keyPath: null }
      ],
      blobStores: []
    }
  ];

  /* ------------------------------------------------------------ 工具 */

  function openExisting(name) {
    return new Promise(function (resolve) {
      if (!root.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(name); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function (ev) {
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

  function createDb(mod) {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(mod.db, mod.version);
      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;
        mod.jsonStores.forEach(function (s) {
          if (!db.objectStoreNames.contains(s.name)) db.createObjectStore(s.name, { keyPath: s.keyPath });
        });
        mod.blobStores.forEach(function (b) {
          if (!db.objectStoreNames.contains(b.name)) db.createObjectStore(b.name);   // 显式 key
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(new Error('无法打开数据库 ' + mod.db)); };
    });
  }

  function getAll(db, store) {
    return new Promise(function (resolve) {
      try {
        const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
        rq.onsuccess = function () { resolve(rq.result || []); };
        rq.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }
  function getAllKeys(db, store) {
    return new Promise(function (resolve) {
      try {
        const rq = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
        rq.onsuccess = function () { resolve(rq.result || []); };
        rq.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }
  function clearStore(db, store) {
    return new Promise(function (resolve) {
      try {
        const rq = db.transaction(store, 'readwrite').objectStore(store).clear();
        rq.onsuccess = function () { resolve(true); };
        rq.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取二进制数据失败')); };
      reader.onload = function () {
        const s = String(reader.result || '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function base64ToU8(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function buildBlobRow(b, entry) {
    const row = {};
    if (b.inline) row.id = entry.key;   // 行内键模式：key 必须在值里
    if (b.u8) row[b.dataField] = base64ToU8(entry.dataB64);   // TF 期望 Uint8Array
    else row[b.dataField] = base64ToBlob(entry.dataB64, entry.mime);
    if (b.thumbField && entry.thumbB64) row[b.thumbField] = base64ToBlob(entry.thumbB64, entry.mime);
    return row;
  }

  function u8ToBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)));
    }
    return btoa(s);
  }

  function idbError() { return 'ERROR:IndexedDB 不可用'; }

  /* ------------------------------------------------------------ 收集（导出用） */

  async function collectModule(mod) {
    const db = await openExisting(mod.db);
    const out = { stores: {}, keys: {}, blobs: [] };
    if (!db) return out;
    for (const s of mod.jsonStores) {
      if (s.keyPath) {
        out.stores[s.name] = await getAll(db, s.name);
      } else {
        // 显式键 store（如 ETHAN meta/vault）：行与键必须成对保存
        out.stores[s.name] = await getAll(db, s.name);
        out.keys[s.name] = await getAllKeys(db, s.name);
      }
    }
    for (const b of mod.blobStores) {
      const keys = await getAllKeys(db, b.name);
      const rows = await getAll(db, b.name);
      const arr = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const data = row[b.dataField];
        const isBlob = data instanceof Blob;
        const isU8 = data && typeof data.length === 'number' && typeof data.subarray === 'function';
        if (!isBlob && !isU8) continue;   // 非 Blob/Uint8Array 载荷跳过（防御）
        const dataB64 = isBlob ? await blobToBase64(data) : u8ToBase64(data);
        const entry = {
          key: String(keys[i] !== undefined ? keys[i] : row.id || i),
          dataB64: dataB64,
          mime: (isBlob ? data.type : null) || row[b.mimeField] || 'application/octet-stream'
        };
        if (b.thumbField && row[b.thumbField] instanceof Blob) {
          entry.thumbB64 = await blobToBase64(row[b.thumbField]);
        }
        arr.push(entry);
      }
      out.blobs = arr;
    }
    db.close();
    return out;
  }

  /** 收集全部模块数据，返回统一备份 JSON 字符串（已做 round-trip 校验） */
  let lastJson = null;   // 供测试 / 调试直接读取（ESA.dataMgr.lastJson）
  async function buildBackup() {
    const modules = {};
    for (const mod of MODULES) {
      const data = await collectModule(mod);
      modules[mod.key] = { stores: data.stores, keys: data.keys, blobs: data.blobs };
      if (mod.encrypted) modules[mod.key].encrypted = true;
    }
    const pkg = {
      format: 'ethan-superapp-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      modules: modules
    };
    const json = JSON.stringify(pkg);
    JSON.parse(json);   // round-trip 完整性校验
    lastJson = json;
    return json;
  }

  /* ------------------------------------------------------------ 写回（导入用） */

  async function writeModule(mod, moduleData, mode) {
    const payload = moduleData || {};
    const stores = payload.stores || {};
    const db = await createDb(mod);

    // 完整替换：先清空全部 store（合并模式保留现有数据）
    if (mode === 'replace') {
      for (const s of mod.jsonStores) await clearStore(db, s.name);
      for (const b of mod.blobStores) await clearStore(db, b.name);
    }

    // JSON 行写回：合并模式跳过已存在的 id（不覆盖现有数据）
    for (const s of mod.jsonStores) {
      const rows = stores[s.name] || [];
      const keys = (payload.keys && payload.keys[s.name]) || [];
      if (!rows.length) continue;
      await new Promise(function (resolve, reject) {
        let tx;
        try { tx = db.transaction(s.name, 'readwrite'); } catch (e) { resolve(); return; }
        const os = tx.objectStore(s.name);
        rows.forEach(function (row, i) {
          if (s.keyPath) {
            if (mode === 'merge') {
              const getReq = os.get(row[s.keyPath]);
              getReq.onsuccess = function () {
                if (getReq.result === undefined || getReq.result === null) os.put(row);
              };
            } else {
              os.put(row);
            }
          } else {
            // 显式键 store（ETHAN）：键来自备份中的 keys 数组
            const key = keys[i] !== undefined ? keys[i] : row.id;
            if (mode === 'merge') {
              const getReq = os.get(key);
              getReq.onsuccess = function () {
                if (getReq.result === undefined || getReq.result === null) os.put(row, key);
              };
            } else {
              os.put(row, key);
            }
          }
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(new Error('写入 ' + s.name + ' 失败')); };
        tx.onabort = function () { reject(new Error('写入 ' + s.name + ' 被中断')); };
      });
    }

    // blobs 写回（无 keyPath，显式 key；合并模式跳过已存在的 key）
    for (const b of mod.blobStores) {
      const list = payload.blobs || [];
      if (!list.length) continue;
      await new Promise(function (resolve, reject) {
        let tx;
        try { tx = db.transaction(b.name, 'readwrite'); } catch (e) { resolve(); return; }
        const os = tx.objectStore(b.name);
        list.forEach(function (entry) {
          if (!entry.dataB64) return;
          if (mode === 'merge') {
            const getReq = os.get(entry.key);
            getReq.onsuccess = function () {
              if (getReq.result !== undefined && getReq.result !== null) return;
              const row = buildBlobRow(b, entry);
              if (b.inline) os.put(row); else os.put(row, entry.key);
            };
          } else {
            const row = buildBlobRow(b, entry);
            if (b.inline) os.put(row); else os.put(row, entry.key);
          }
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(new Error('写入 ' + b.name + ' 失败')); };
        tx.onabort = function () { reject(new Error('写入 ' + b.name + ' 被中断')); };
      });
    }
    db.close();
  }

  /* ------------------------------------------------------------ 导出 */

  async function exportAll() {
    const json = await buildBackup();
    const blob = new Blob([json], { type: 'application/octet-stream' });
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const fileName = 'ETHAN-SuperApp-Backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.ethan';

    const bridge = root.ESANative || root.MySpaceNative || root.TravelFootprintNative || null;
    if (bridge && typeof bridge.beginSave === 'function' &&
        typeof bridge.appendChunk === 'function' && typeof bridge.endSave === 'function') {
      const CHUNK = 384 * 1024;
      const token = String(bridge.beginSave(fileName, blob.type) || '');
      if (!token || token.indexOf('ERROR') === 0) throw new Error(token ? token.replace(/^ERROR:?/, '') : '无法创建导出文件');
      const buf = new Uint8Array(await blob.arrayBuffer());
      let offset = 0;
      while (offset < buf.length) {
        const end = Math.min(offset + CHUNK, buf.length);
        const part = buf.subarray(offset, end);
        let b64 = '';
        for (let i = 0; i < part.length; i += 0x8000) {
          b64 += String.fromCharCode.apply(null, part.subarray(i, Math.min(i + 0x8000, part.length)));
        }
        const feedback = String(bridge.appendChunk(token, btoa(b64)) || '');
        if (feedback.indexOf('ERROR') === 0) throw new Error(feedback.replace(/^ERROR:?/, ''));
        offset = end;
      }
      const where = String(bridge.endSave(token) || '');
      if (where.indexOf('ERROR') === 0) throw new Error(where.replace(/^ERROR:?/, ''));
      return { target: where || fileName, bytes: buf.length };
    }

    // 浏览器环境：a.download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
    return { target: '浏览器下载目录', bytes: blob.size };
  }

  /* ------------------------------------------------------------ 导入 */

  function parseBackup(text) {
    let pkg;
    try { pkg = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的备份文件（JSON 解析失败）'); }
    if (!pkg || pkg.format !== 'ethan-superapp-backup') throw new Error('不是 ETHAN Super App 统一备份文件');
    if (typeof pkg.version !== 'number' || pkg.version > 1) throw new Error('备份版本不受支持（version ' + pkg.version + '）');
    if (!pkg.modules || !pkg.modules.mySpace || !pkg.modules.travelFootprint || !pkg.modules.ethan) {
      throw new Error('备份缺少模块数据，文件可能已损坏');
    }
    return pkg;
  }

  function countRows(stores) {
    let n = 0;
    for (const k of Object.keys(stores || {})) n += (stores[k] || []).length;
    return n;
  }

  function previewInfo(pkg) {
    const m = pkg.modules || {};
    return [
      { label: '我的空间', rows: countRows(m.mySpace && m.mySpace.stores), blobs: (m.mySpace && m.mySpace.blobs || []).length },
      { label: '旅行足迹', rows: countRows(m.travelFootprint && m.travelFootprint.stores), blobs: (m.travelFootprint && m.travelFootprint.blobs || []).length },
      { label: 'ETHAN', rows: countRows(m.ethan && m.ethan.stores), encrypted: true }
    ];
  }

  async function hasExistingData() {
    for (const mod of MODULES) {
      const db = await openExisting(mod.db);
      if (!db) continue;
      for (const s of mod.jsonStores) {
        const rows = await getAll(db, s.name);
        if (s.name === 'meta') continue;   // meta（如分类种子标记）不算用户数据
        if (rows.length) { db.close(); return true; }
      }
      db.close();
    }
    return false;
  }

  async function importAll(pkg, mode) {
    const order = ['mySpace', 'travelFootprint', 'ethan'];
    for (const key of order) {
      const mod = MODULES.find(function (m) { return m.key === key; });
      await writeModule(mod, pkg.modules[key], mode);
    }
  }

  /** 导入完成后重载已加载的模块 iframe（回到锁定态/刷新数据视图） */
  function reloadModules() {
    document.querySelectorAll('.module-frame').forEach(function (f) {
      if (f.src && f.src.indexOf('http') === 0) {
        try { f.src = f.src; } catch (e) { /* ignore */ }
      }
    });
  }

  /* ------------------------------------------------------------ UI（数据管理面板） */

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function openOverlay(html) {
    const el = document.createElement('div');
    el.className = 'dm-overlay';
    el.innerHTML = '<div class="dm-backdrop"></div><div class="dm-panel">' + html + '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-open'); });
    const close = function () {
      el.classList.remove('is-open');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    };
    el.querySelector('.dm-backdrop').addEventListener('click', close);
    return { el: el, close: close, panel: el.querySelector('.dm-panel') };
  }

  function setErr(panel, msg) {
    const box = panel.querySelector('.dm-err');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function open() {
    const ui = openOverlay(
      '<h3 class="dm-title">数据管理</h3>' +
      '<p class="dm-sub">管理 ETHAN Super App 的全部个人数据<br>（我的空间 · 旅行足迹 · ETHAN）</p>' +
      '<button class="dm-btn dm-btn--primary" data-act="export">导出全部数据</button>' +
      '<button class="dm-btn" data-act="import">导入数据</button>' +
      '<p class="dm-note">导出为单个 .ethan 备份文件（含全部图片与附件）。<br>ETHAN 机密数据始终以加密形式写入，不会出现明文。</p>' +
      '<p class="dm-err" hidden></p>'
    );
    ui.panel.querySelector('[data-act="export"]').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = '正在收集数据…';
      setErr(ui.panel, '');
      try {
        const res = await exportAll();
        btn.textContent = '导出全部数据';
        btn.disabled = false;
        ui.close();
        if (root.ESA.util && root.ESA.util.toast) root.ESA.util.toast('备份已保存：' + (res.target || '完成'), { icon: 'download' });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '导出全部数据';
        setErr(ui.panel, e.message || '导出失败');
      }
    });
    ui.panel.querySelector('[data-act="import"]').addEventListener('click', function () {
      openImportWizard(ui);
    });
  }

  function openImportWizard(parentUi) {
    const ui = openOverlay(
      '<h3 class="dm-title">导入数据</h3>' +
      '<p class="dm-sub">选择 ETHAN Super App 统一备份文件（.ethan）</p>' +
      '<input type="file" class="dm-file" accept=".ethan,.json,application/json,application/octet-stream" hidden>' +
      '<button class="dm-btn" data-act="pick">选择备份文件</button>' +
      '<div class="dm-preview" hidden></div>' +
      '<p class="dm-err" hidden></p>' +
      '<p class="dm-note">导入前请确认备份文件来源可信。ETHAN 机密数据将保持加密状态写回。</p>'
    );
    const fileInput = ui.panel.querySelector('.dm-file');
    ui.panel.querySelector('[data-act="pick"]').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      setErr(ui.panel, '');
      let pkg;
      try {
        pkg = parseBackup(await f.text());
      } catch (e) {
        setErr(ui.panel, e.message);
        return;
      }
      renderConfirm(ui, pkg);
    });
  }

  function renderConfirm(ui, pkg) {
    const info = previewInfo(pkg);
    const created = pkg.createdAt ? esc(String(pkg.createdAt).replace('T', ' ').slice(0, 16)) : '未知';
    let rows = '';
    info.forEach(function (m) {
      let detail = m.rows + ' 条数据';
      if (m.blobs !== undefined) detail += ' · ' + m.blobs + ' 张图片/附件';
      if (m.encrypted) detail += ' · 加密数据';
      rows += '<div class="dm-preview__row"><span>' + esc(m.label) + '</span><strong>' + esc(detail) + '</strong></div>';
    });
    const hasData = hasExistingData();
    ui.panel.innerHTML =
      '<h3 class="dm-title">即将导入</h3>' +
      '<div class="dm-preview">' + rows + '</div>' +
      '<p class="dm-note">备份创建时间：' + created + '</p>' +
      '<div class="dm-modes" hidden>' +
      '<p class="dm-warn">检测到当前设备已有数据，请选择导入方式：</p>' +
      '<label class="dm-radio"><input type="radio" name="dm-mode" value="merge" checked><span><strong>合并导入</strong> — 保留现有数据，只补充备份中新增的内容</span></label>' +
      '<label class="dm-radio"><input type="radio" name="dm-mode" value="replace"><span><strong>完整替换</strong> — 删除当前设备上的现有数据，用备份恢复（不可撤销）</span></label>' +
      '</div>' +
      '<button class="dm-btn dm-btn--primary" data-act="go">开始导入</button>' +
      '<button class="dm-btn" data-act="cancel">取消</button>' +
      '<p class="dm-err" hidden></p>';

    hasData.then(function (exists) {
      const modes = ui.panel.querySelector('.dm-modes');
      if (modes) modes.hidden = !exists;
      const go = ui.panel.querySelector('[data-act="go"]');
      if (go && exists === false) go.textContent = '开始导入';
    });

    ui.panel.querySelector('[data-act="cancel"]').addEventListener('click', function () { ui.close(); });
    ui.panel.querySelector('[data-act="go"]').addEventListener('click', async function () {
      const modeRadio = ui.panel.querySelector('input[name="dm-mode"]:checked');
      const mode = modeRadio ? modeRadio.value : 'merge';
      if (mode === 'replace') {
        const ok = root.confirm && root.confirm('完整替换将删除当前设备上的现有数据，并使用备份中的数据恢复。\n\n确定要继续吗？');
        if (!ok) return;
      }
      const btn = this;
      btn.disabled = true;
      btn.textContent = '正在导入…';
      setErr(ui.panel, '');
      try {
        await importAll(pkg, mode);
        reloadModules();
        if (typeof root.ESA.refreshHome === 'function') root.ESA.refreshHome();
        ui.panel.innerHTML =
          '<h3 class="dm-title">导入完成</h3>' +
          '<p class="dm-sub">数据已成功恢复。ETHAN 模块已重置到锁定状态，用 PIN 解锁即可查看。</p>' +
          '<button class="dm-btn dm-btn--primary" data-act="done">完成</button>';
        ui.panel.querySelector('[data-act="done"]').addEventListener('click', function () { ui.close(); });
        if (root.ESA.util && root.ESA.util.toast) root.ESA.util.toast('数据导入完成', { icon: 'check' });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '开始导入';
        setErr(ui.panel, '导入失败：' + (e.message || '未知错误') + '（原有数据未被破坏）');
      }
    });
  }

  ESA.dataMgr = {
    open: open,
    MODULES: MODULES,
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    previewInfo: previewInfo,
    hasExistingData: hasExistingData,
    importAll: importAll,
    exportAll: exportAll,
    reloadModules: reloadModules,
    get lastJson() { return lastJson; },
    _helpers: { openExisting: openExisting, createDb: createDb, getAll: getAll, getAllKeys: getAllKeys, clearStore: clearStore, blobToBase64: blobToBase64, base64ToBlob: base64ToBlob, writeModule: writeModule }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
