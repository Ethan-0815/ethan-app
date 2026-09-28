/*!
 * 我的空间 · 备份打包 / 解析 / 导入计划
 * 只做纯逻辑（不含 UI，不直接碰数据库），便于测试与复用。
 *
 * 备份结构（V1）：
 *   my-space-backup-YYYY-MM-DD.zip
 *   ├── data.json
 *   ├── metadata.json
 *   ├── images/
 *   └── attachments/          （V0.2 使用，V0.1 导出为空目录，保持格式稳定）
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const M = MS.models;

  const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/bmp': 'bmp',
    'application/pdf': 'pdf',
    'text/plain': 'txt'
  };

  function extFor(mime, name) {
    const byMime = MIME_EXT[String(mime || '').toLowerCase()];
    if (byMime) return byMime;
    const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : 'bin';
  }

  function mimeFor(name, fallback) {
    const ext = extFor('', name);
    for (const k in MIME_EXT) if (MIME_EXT[k] === ext) return k;
    return fallback || 'application/octet-stream';
  }

  function backupFileName(date) {
    const d = date instanceof Date ? date : new Date();
    return 'my-space-backup-' + M.toIsoDate(d) + '.zip';
  }

  function utf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function jsonBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value, null, 2));
  }

  /**
   * 生成备份 zip
   * @param {{items:Array, categories:Array, tags:Array, images:Array<{meta:object, blob:Blob}>}} dataset
   * @returns {Promise<{blob:Blob, fileName:string, counts:object}>}
   */
  async function buildBackup(dataset) {
    const d = dataset || {};
    const items = (d.items || []).map(M.normalizeItem);
    const categories = (d.categories || []).map(function (c, i) { return M.normalizeCategory(c, i); });
    const tags = (d.tags || []).map(M.normalizeTag);
    const images = (d.images || []).filter(function (x) { return x && x.meta && x.blob; });
    const createdAt = M.nowIso();

    const dataJson = {
      backupVersion: MS.BACKUP_VERSION,
      appVersion: MS.APP_VERSION,
      createdAt: createdAt,
      items: items,
      categories: categories,
      tags: tags
    };

    const imageMetas = [];
    const entries = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const meta = M.normalizeImageMeta(img.meta);
      const path = 'images/' + meta.id + '.' + extFor(meta.mime, meta.name);
      imageMetas.push({
        id: meta.id,
        itemId: meta.itemId,
        path: path,
        name: meta.name,
        mime: meta.mime,
        size: meta.size,
        width: meta.width,
        height: meta.height,
        createdAt: meta.createdAt
      });
      entries.push({ name: path, data: img.blob });
    }

    const metadataJson = {
      backupVersion: MS.BACKUP_VERSION,
      appVersion: MS.APP_VERSION,
      createdAt: createdAt,
      counts: {
        items: items.length,
        categories: categories.length,
        tags: tags.length,
        images: imageMetas.length,
        attachments: 0
      },
      images: imageMetas,
      attachments: []
    };

    const files = [
      { name: 'data.json', data: jsonBytes(dataJson) },
      { name: 'metadata.json', data: jsonBytes(metadataJson) }
    ].concat(entries).concat([{ name: 'attachments/', dir: true }]);

    const blob = await MS.zip.write(files);
    return {
      blob: blob,
      fileName: backupFileName(new Date(createdAt)),
      counts: metadataJson.counts
    };
  }

  function shallowestBySuffix(entries, suffix) {
    let best = null;
    let bestDepth = Infinity;
    entries.forEach(function (e) {
      if (e.dir) return;
      const lower = e.name.toLowerCase();
      if (lower === suffix || lower.endsWith('/' + suffix)) {
        const depth = e.name.split('/').length;
        if (depth < bestDepth) { bestDepth = depth; best = e; }
      }
    });
    return best;
  }

  /**
   * 解析备份（对损坏文件给出友好错误，不外泄技术异常）
   * @param {Blob|ArrayBuffer|Uint8Array} input
   */
  async function parseBackup(input) {
    let entries;
    try {
      entries = await MS.zip.read(input);
    } catch (e) {
      throw MS.appError('BACKUP_BROKEN', (e && e.detail) || (e && e.message));
    }

    const dataEntry = shallowestBySuffix(entries, 'data.json');
    if (!dataEntry) throw MS.appError('BACKUP_NO_DATA');

    const prefix = dataEntry.name.slice(0, dataEntry.name.length - 'data.json'.length);
    let raw;
    try {
      raw = JSON.parse(utf8(dataEntry.data));
    } catch (e) {
      throw MS.appError('BACKUP_JSON', e && e.message);
    }
    if (!raw || typeof raw !== 'object') throw MS.appError('BACKUP_JSON', 'not an object');

    const version = Number.isFinite(raw.backupVersion) ? raw.backupVersion : 1;
    if (version > MS.BACKUP_VERSION) {
      throw MS.appError('BACKUP_VERSION', 'backupVersion=' + version);
    }

    const warnings = [];
    const dataset = {
      backupVersion: version,
      appVersion: M.str(raw.appVersion) || null,
      createdAt: M.isIsoLike(raw.createdAt) ? raw.createdAt : null,
      items: Array.isArray(raw.items) ? raw.items : [],
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      tags: Array.isArray(raw.tags) ? raw.tags : []
    };

    // metadata.json 可选：没有就以 data.json 为准
    let metadata = null;
    const metaEntry = shallowestBySuffix(entries, 'metadata.json');
    if (metaEntry) {
      try { metadata = JSON.parse(utf8(metaEntry.data)); } catch (e) { metadata = null; }
    }

    // 收集图片文件
    const fileByPath = {};
    entries.forEach(function (e) {
      if (e.dir) return;
      if (/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(e.name)) fileByPath[e.name] = e.data;
    });

    const images = [];
    const metas = (metadata && Array.isArray(metadata.images)) ? metadata.images : [];
    metas.forEach(function (m) {
      const info = M.normalizeImageMeta(m);
      const path = M.str(m.path) || ('images/' + info.id + '.' + extFor(info.mime, info.name));
      const candidates = [prefix + path, path, prefix + 'images/' + info.id + '.' + extFor(info.mime, info.name)];
      let data = null;
      for (let i = 0; i < candidates.length; i++) {
        if (fileByPath[candidates[i]]) { data = fileByPath[candidates[i]]; break; }
      }
      if (!data) {
        // 兜底：按文件名在 images/ 下模糊查找
        const wanted = path.split('/').pop();
        for (const p in fileByPath) {
          if (p.split('/').pop() === wanted) { data = fileByPath[p]; break; }
        }
      }
      if (!data) { warnings.push('图片文件缺失：' + (info.name || info.id)); return; }
      if (!info.mime || info.mime === 'image/jpeg') info.mime = mimeFor(path, 'image/jpeg');
      images.push({ meta: info, data: data });
    });

    // metadata 缺失时：从 images/ 目录里按文件名（= id.ext）反推
    if (!metas.length) {
      Object.keys(fileByPath).forEach(function (p) {
        const base = p.split('/').pop();
        if (!base || base.indexOf('.') === -1) return;
        const id = base.slice(0, base.lastIndexOf('.'));
        if (!M.trimOrNull(id)) return;
        const data = fileByPath[p];
        const mime = mimeFor(base, 'image/jpeg');
        images.push({
          meta: M.normalizeImageMeta({ id: id, name: base, mime: mime, size: data.length }),
          data: data
        });
        warnings.push('图片 ' + base + ' 缺少元数据，已按文件名推断归属');
      });
    }

    return { dataset: dataset, metadata: metadata, images: images, warnings: warnings };
  }

  /**
   * 生成导入计划（不写库）
   * 冲突规则：ID 相同 → 更新；ID 不同 → 新增
   * 分类/标签：同名的复用本地已有记录，并把物品引用重映射过去
   */
  function planImport(parsed, existing) {
    const p = parsed || {};
    const ex = existing || {};
    const warnings = (p.warnings || []).slice();

    const localItems = new Map();
    (ex.items || []).forEach(function (it) { if (it && it.id) localItems.set(String(it.id), it); });
    const localCategories = ex.categories || [];
    const localTags = ex.tags || [];

    function byName(list, name) {
      const target = M.str(name).trim().toLowerCase();
      if (!target) return null;
      for (let i = 0; i < list.length; i++) {
        if (M.str(list[i].name).trim().toLowerCase() === target) return list[i];
      }
      return null;
    }

    // --- 分类 ---
    const catIdMap = {};
    const categories = [];
    (p.dataset && p.dataset.categories ? p.dataset.categories : []).forEach(function (raw, idx) {
      const cat = M.normalizeCategory(raw, idx);
      if (!cat.name) return;
      const same = byName(localCategories, cat.name);
      if (same && same.id !== cat.id) {
        catIdMap[cat.id] = same.id;      // 同名（不同 ID）→ 复用本地分类
        return;
      }
      catIdMap[cat.id] = cat.id;
      categories.push(cat);
    });

    // --- 标签 ---
    const tagIdMap = {};
    const tags = [];
    (p.dataset && p.dataset.tags ? p.dataset.tags : []).forEach(function (raw) {
      const tag = M.normalizeTag(raw);
      if (!tag.name) return;
      const same = byName(localTags, tag.name);
      if (same && same.id !== tag.id) {
        tagIdMap[tag.id] = same.id;
        return;
      }
      tagIdMap[tag.id] = tag.id;
      tags.push(tag);
    });

    // --- 图片 ---
    const imageIdSet = new Set();
    const images = [];
    (p.images || []).forEach(function (img) {
      const meta = M.normalizeImageMeta(img.meta);
      if (!meta.itemId) { warnings.push('图片缺少所属物品：' + meta.name); return; }
      imageIdSet.add(meta.id);
      images.push({ meta: meta, data: img.data });
    });

    // --- 物品 ---
    const items = [];
    let added = 0;
    let updated = 0;
    (p.dataset && p.dataset.items ? p.dataset.items : []).forEach(function (raw) {
      const hadId = !!(raw && typeof raw === 'object' && M.trimOrNull(raw.id));
      const item = M.normalizeItem(raw);
      if (!M.isValidItem(item)) { warnings.push('已跳过没有名称的记录'); return; }
      if (item.categoryId && catIdMap[item.categoryId]) item.categoryId = catIdMap[item.categoryId];
      item.tagIds = M.uniq(item.tagIds.map(function (t) { return tagIdMap[t] || t; }));
      item.imageIds = item.imageIds.filter(function (id) { return imageIdSet.has(id); });
      items.push(item);
      if (hadId && localItems.has(item.id)) updated++;
      else added++;
    });

    // 若物品没有 imageIds，但图片里标了 itemId，则自动关联（兼容外部生成的数据）
    const itemById = {};
    items.forEach(function (it) { itemById[it.id] = it; });
    images.forEach(function (img) {
      const owner = itemById[img.meta.itemId];
      if (owner && owner.imageIds.indexOf(img.meta.id) === -1) {
        owner.imageIds.push(img.meta.id);
        if (owner.updatedAt < img.meta.createdAt) owner.updatedAt = M.nowIso();
      }
    });

    return {
      items: items,
      categories: categories,
      tags: tags,
      images: images,
      counts: {
        items: items.length,
        added: added,
        updated: updated,
        images: images.length
      },
      warnings: warnings
    };
  }

  MS.backup = {
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    planImport: planImport,
    backupFileName: backupFileName,
    extFor: extFor,
    mimeFor: mimeFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
