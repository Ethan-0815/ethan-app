/*!
 * 我的空间 · 业务逻辑层（仓储 Repository）
 * 数据层通过适配器注入，因此同一套业务逻辑可以跑在 IndexedDB / 内存（测试）/ 原生 SQLite 之上。
 *
 * 关键约定：
 *  1. 除 name 外所有字段均可为空，绝不阻止保存。
 *  2. 编辑即"整体替换"：UI 清空的字段在库里必须变成 null（不会残留旧值）。
 *  3. 删除分类不会删除物品，只把 categoryId 置空。
 *  4. 删除物品是软删除（deletedAt），永久删除才真正清理记录与图片。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const M = MS.models;

  const VIEW_THROTTLE_MS = 3000;
  const RECENT_LIMIT = 20;

  function createRepository(adapter) {
    if (!adapter) throw new Error('adapter required');

    const state = {
      loaded: false,
      items: [],
      categories: [],
      tags: [],
      images: [],
      itemsById: new Map(),
      categoriesById: new Map(),
      tagsById: new Map(),
      imagesById: new Map(),
      lastViewWrite: new Map()
    };

    const listeners = { change: [] };

    /* ---------------------------------------------------------- 事件 */
    function on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return function () { off(event, cb); };
    }
    function off(event, cb) {
      const list = listeners[event];
      if (!list) return;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    }
    function emit(event, payload) {
      (listeners[event] || []).slice().forEach(function (cb) {
        try { cb(payload || {}); } catch (e) { /* 单个监听器出错不影响其它 */ }
      });
    }

    /* ---------------------------------------------------------- 初始化 */
    async function init() {
      await adapter.ready();
      const [items, categories, tags, images] = await Promise.all([
        adapter.items.all(),
        adapter.categories.all(),
        adapter.tags.all(),
        adapter.images.all()
      ]);
      state.items = (items || []).map(M.normalizeItem);
      state.categories = (categories || []).map(function (c, i) { return M.normalizeCategory(c, i); });
      state.tags = (tags || []).map(M.normalizeTag);
      state.images = (images || []).map(M.normalizeImageMeta);
      reindex();
      state.loaded = true;
      await seedCategoriesIfNeeded();
      return state;
    }

    function reindex() {
      state.itemsById = new Map();
      state.categoriesById = new Map();
      state.tagsById = new Map();
      state.imagesById = new Map();
      state.items.forEach(function (i) { state.itemsById.set(i.id, i); });
      state.categories.forEach(function (c) { state.categoriesById.set(c.id, c); });
      state.tags.forEach(function (t) { state.tagsById.set(t.id, t); });
      state.images.forEach(function (im) { state.imagesById.set(im.id, im); });
      state.categories.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    }

    async function seedCategoriesIfNeeded() {
      const seeded = await adapter.meta.get('categoriesSeeded');
      if (seeded || state.categories.length) return;
      const created = M.DEFAULT_CATEGORIES.map(function (name, i) {
        return M.normalizeCategory({ name: name, order: i }, i);
      });
      await adapter.categories.putMany(created);
      state.categories = created;
      reindex();
      await adapter.meta.set('categoriesSeeded', true);
    }

    /* ---------------------------------------------------------- 查询辅助 */

    function liveItems() {
      return state.items.filter(function (i) { return !i.deletedAt; });
    }

    function trashedItems() {
      return state.items.filter(function (i) { return !!i.deletedAt; });
    }

    function categoryName(id) {
      const c = id ? state.categoriesById.get(id) : null;
      return c ? c.name : '';
    }

    function tagNames(ids) {
      return (ids || []).map(function (id) {
        const t = state.tagsById.get(id);
        return t ? t.name : '';
      }).filter(Boolean);
    }

    function contextFor(item) {
      return { categoryName: categoryName(item.categoryId), tagNames: tagNames(item.tagIds) };
    }

    function sortItems(list, sort) {
      const arr = list.slice();
      switch (sort) {
        case 'name':
          arr.sort(function (a, b) { return M.str(a.name).localeCompare(M.str(b.name), 'zh-Hans-CN'); });
          break;
        case 'price':
          arr.sort(function (a, b) {
            const pa = M.numOrNull(a.purchasePrice);
            const pb = M.numOrNull(b.purchasePrice);
            if (pa === null && pb === null) return 0;
            if (pa === null) return 1;      // 无价格永远排在后面
            if (pb === null) return -1;
            return pb - pa;
          });
          break;
        case 'created':
          arr.sort(function (a, b) { return M.str(b.createdAt).localeCompare(M.str(a.createdAt)); });
          break;
        case 'updated':
        default:
          arr.sort(function (a, b) {
            const ka = M.str(b.updatedAt || b.createdAt);
            const kb = M.str(a.updatedAt || a.createdAt);
            return ka.localeCompare(kb);
          });
          break;
      }
      return arr;
    }

    function listItems(opts) {
      const o = opts || {};
      let list = o.includeDeleted ? state.items.slice() : liveItems();
      if (o.deletedOnly) list = trashedItems();
      if (o.categoryId) list = list.filter(function (i) { return i.categoryId === o.categoryId; });
      if (o.tagId) list = list.filter(function (i) { return (i.tagIds || []).indexOf(o.tagId) >= 0; });
      if (o.query) {
        return MS.search.searchItems(list, o.query, contextFor).map(function (r) { return r.item; });
      }
      return sortItems(list, o.sort || 'updated');
    }

    function getItem(id) {
      return state.itemsById.get(String(id)) || null;
    }

    function search(query, opts) {
      const o = opts || {};
      const pool = o.includeDeleted ? state.items.slice() : liveItems();
      const result = MS.search.searchItems(pool, query, contextFor, o);
      if (o.sort && o.sort !== 'relevance') {
        return sortItems(result.map(function (r) { return r.item; }), o.sort);
      }
      return result.map(function (r) { return r.item; });
    }

    function recentAdded(limit) {
      return sortItems(liveItems(), 'created').slice(0, limit || RECENT_LIMIT);
    }

    function recentViewed(limit) {
      const list = liveItems().filter(function (i) { return !!i.lastViewedAt; });
      list.sort(function (a, b) { return M.str(b.lastViewedAt).localeCompare(M.str(a.lastViewedAt)); });
      return list.slice(0, limit || RECENT_LIMIT);
    }

    /** 今天新增的物品数量（用于首页"今日添加"） */
    function createdTodayCount() {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const since = start.getTime();
      return liveItems().filter(function (item) {
        const t = new Date(item.createdAt).getTime();
        return !isNaN(t) && t >= since;
      }).length;
    }

    function locations() {
      const seen = new Set();
      const out = [];
      state.items.forEach(function (i) {
        const v = M.trimOrNull(i.location);
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      });
      return out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); });
    }

    /* ---------------------------------------------------------- 物品写入 */

    async function createItem(input) {
      const item = M.normalizeItem(input);
      if (!M.isValidItem(item)) throw MS.appError('UNKNOWN', 'name required');
      const now = M.nowIso();
      item.createdAt = now;
      item.updatedAt = now;
      await adapter.items.put(item);
      state.items.push(item);
      reindex();
      emit('change', { type: 'item:create', item: item });
      return item;
    }

    /**
     * 更新物品。语义：以「传入对象里出现过的键」为准覆盖，未出现的键保持原值。
     *
     * 这是"清除字段"强制要求的落地点：
     * 编辑页每次都提交完整表单（清空的字段会以 '' 出现），因此 '' → null 会真正覆盖旧值；
     * 而调用方只传 { name } 时，不会误伤其它字段（避免静默数据丢失）。
     */
    async function updateItem(id, input) {
      const existing = getItem(id);
      if (!existing) throw MS.appError('NOT_FOUND', String(id));
      const src = Object.assign({}, existing);
      const patchable = ['name', 'tagIds'].concat(M.ITEM_CLEARABLE_FIELDS);
      if (input && typeof input === 'object') {
        patchable.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(input, key)) src[key] = input[key];
        });
      }
      const next = M.normalizeItem(src);
      if (!M.isValidItem(next)) throw MS.appError('UNKNOWN', 'name required');
      next.id = existing.id;
      next.createdAt = existing.createdAt;
      next.lastViewedAt = existing.lastViewedAt;
      next.deletedAt = existing.deletedAt;
      next.imageIds = (input && Array.isArray(input.imageIds)) ? input.imageIds : existing.imageIds;
      next.updatedAt = M.nowIso();
      await adapter.items.put(next);
      replaceInState(next);
      emit('change', { type: 'item:update', item: next, previous: existing });
      return next;
    }

    function replaceInState(item) {
      const idx = state.items.findIndex(function (i) { return i.id === item.id; });
      if (idx >= 0) state.items[idx] = item;
      else state.items.push(item);
      state.itemsById.set(item.id, item);
    }

    async function touchViewed(id) {
      const item = getItem(id);
      if (!item) return null;
      const now = Date.now();
      const last = state.lastViewWrite.get(id) || 0;
      if (now - last < VIEW_THROTTLE_MS) return item;   // 同一物品短时间内重复打开不重复写入
      state.lastViewWrite.set(id, now);
      // 单调递增时间戳：避免同一毫秒内两次浏览导致"最近查看"排序抖动
      let stamp = now;
      state.items.forEach(function (i) {
        if (!i.lastViewedAt) return;
        const t = new Date(i.lastViewedAt).getTime();
        if (!isNaN(t) && t >= stamp) stamp = t + 1;
      });
      const next = Object.assign({}, item, { lastViewedAt: new Date(stamp).toISOString() });
      await adapter.items.put(next);
      replaceInState(next);
      emit('change', { type: 'item:viewed', item: next });
      return next;
    }

    async function softDelete(id) {
      const item = getItem(id);
      if (!item) throw MS.appError('NOT_FOUND', String(id));
      const next = Object.assign({}, item, { deletedAt: M.nowIso(), updatedAt: M.nowIso() });
      await adapter.items.put(next);
      replaceInState(next);
      emit('change', { type: 'item:delete', item: next });
      return next;
    }

    async function restore(id) {
      const item = getItem(id);
      if (!item) throw MS.appError('NOT_FOUND', String(id));
      const next = Object.assign({}, item, { deletedAt: null, updatedAt: M.nowIso() });
      await adapter.items.put(next);
      replaceInState(next);
      emit('change', { type: 'item:restore', item: next });
      return next;
    }

    /** 永久删除：物品 + 关联图片 + 关联二进制一并清理 */
    async function purge(id) {
      const item = getItem(id);
      if (!item) return { removed: 0 };
      const imageIds = (item.imageIds || []).slice();
      // 兜底：按 itemId 找出所有关联图片
      state.images.forEach(function (im) {
        if (im.itemId === item.id && imageIds.indexOf(im.id) === -1) imageIds.push(im.id);
      });
      if (imageIds.length) {
        await adapter.images.removeMany(imageIds);
        await adapter.blobs.removeMany(imageIds);
      }
      await adapter.items.remove(item.id);
      state.items = state.items.filter(function (i) { return i.id !== item.id; });
      state.images = state.images.filter(function (im) { return imageIds.indexOf(im.id) === -1; });
      reindex();
      emit('change', { type: 'item:purge', id: item.id, images: imageIds.length });
      return { removed: 1 + imageIds.length };
    }

    async function purgeAllTrash() {
      const ids = trashedItems().map(function (i) { return i.id; });
      for (let i = 0; i < ids.length; i++) await purge(ids[i]);
      return ids.length;
    }

    /* ---------------------------------------------------------- 分类 */

    function categoriesWithCounts() {
      const counts = {};
      state.items.forEach(function (i) {
        if (i.deletedAt) return;
        const key = i.categoryId || '__none__';
        counts[key] = (counts[key] || 0) + 1;
      });
      const list = state.categories.map(function (c) {
        return { category: c, count: counts[c.id] || 0 };
      });
      return { list: list, uncategorized: counts['__none__'] || 0 };
    }

    function findCategoryByName(name) {
      const key = M.str(name).trim().toLowerCase();
      return state.categories.find(function (c) { return c.name.trim().toLowerCase() === key; }) || null;
    }

    async function createCategory(name) {
      const clean = M.str(name).trim();
      if (!clean) throw MS.appError('UNKNOWN', 'empty category name');
      const same = findCategoryByName(clean);
      if (same) return same;
      const cat = M.normalizeCategory({ name: clean, order: state.categories.length }, state.categories.length);
      await adapter.categories.put(cat);
      state.categories.push(cat);
      reindex();
      emit('change', { type: 'category:create', category: cat });
      return cat;
    }

    async function renameCategory(id, name) {
      const cat = state.categoriesById.get(String(id));
      if (!cat) throw MS.appError('NOT_FOUND', String(id));
      const clean = M.str(name).trim();
      if (!clean) throw MS.appError('UNKNOWN', 'empty category name');
      const same = findCategoryByName(clean);
      if (same && same.id !== cat.id) return same;   // 已存在同名分类：直接复用
      const next = Object.assign({}, cat, { name: clean });
      await adapter.categories.put(next);
      const idx = state.categories.findIndex(function (c) { return c.id === cat.id; });
      if (idx >= 0) state.categories[idx] = next;
      reindex();
      emit('change', { type: 'category:rename', category: next });
      return next;
    }

    /** 删除分类 —— 绝不删除该分类下的物品，只把它们的 categoryId 置空 */
    async function deleteCategory(id) {
      const cat = state.categoriesById.get(String(id));
      if (!cat) return { affected: 0 };
      const affected = state.items.filter(function (i) { return i.categoryId === cat.id; });
      const updated = affected.map(function (i) {
        return Object.assign({}, i, { categoryId: null, updatedAt: M.nowIso() });
      });
      if (updated.length) await adapter.items.putMany(updated);
      updated.forEach(replaceInState);
      await adapter.categories.remove(cat.id);
      state.categories = state.categories.filter(function (c) { return c.id !== cat.id; });
      reindex();
      emit('change', { type: 'category:delete', id: cat.id, affected: updated.length });
      return { affected: updated.length };
    }

    /* ---------------------------------------------------------- 标签 */

    function tagsWithCounts() {
      const counts = {};
      state.items.forEach(function (i) {
        if (i.deletedAt) return;
        (i.tagIds || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      });
      return state.tags.map(function (t) { return { tag: t, count: counts[t.id] || 0 }; })
        .sort(function (a, b) { return b.count - a.count || a.tag.name.localeCompare(b.tag.name, 'zh-Hans-CN'); });
    }

    function findTagByName(name) {
      const key = M.str(name).trim().toLowerCase();
      return state.tags.find(function (t) { return t.name.trim().toLowerCase() === key; }) || null;
    }

    async function ensureTag(name) {
      const clean = M.str(name).trim();
      if (!clean) return null;
      const same = findTagByName(clean);
      if (same) return same;
      const tag = M.normalizeTag({ name: clean });
      await adapter.tags.put(tag);
      state.tags.push(tag);
      reindex();
      emit('change', { type: 'tag:create', tag: tag });
      return tag;
    }

    async function renameTag(id, name) {
      const tag = state.tagsById.get(String(id));
      if (!tag) throw MS.appError('NOT_FOUND', String(id));
      const clean = M.str(name).trim();
      if (!clean) throw MS.appError('UNKNOWN', 'empty tag name');
      const same = findTagByName(clean);
      if (same && same.id !== tag.id) return same;
      const next = Object.assign({}, tag, { name: clean });
      await adapter.tags.put(next);
      const idx = state.tags.findIndex(function (t) { return t.id === tag.id; });
      if (idx >= 0) state.tags[idx] = next;
      reindex();
      emit('change', { type: 'tag:rename', tag: next });
      return next;
    }

    /** 删除标签：仅解除物品上的引用，不删除物品 */
    async function deleteTag(id) {
      const tag = state.tagsById.get(String(id));
      if (!tag) return { affected: 0 };
      const affected = state.items.filter(function (i) { return (i.tagIds || []).indexOf(tag.id) >= 0; });
      const updated = affected.map(function (i) {
        return Object.assign({}, i, {
          tagIds: i.tagIds.filter(function (t) { return t !== tag.id; }),
          updatedAt: M.nowIso()
        });
      });
      if (updated.length) await adapter.items.putMany(updated);
      updated.forEach(replaceInState);
      await adapter.tags.remove(tag.id);
      state.tags = state.tags.filter(function (t) { return t.id !== tag.id; });
      reindex();
      emit('change', { type: 'tag:delete', id: tag.id, affected: updated.length });
      return { affected: updated.length };
    }

    /** 设置某个物品的标签（整体替换 tagIds） */
    async function setItemTags(itemId, tagIds) {
      const item = getItem(itemId);
      if (!item) throw MS.appError('NOT_FOUND', String(itemId));
      const next = Object.assign({}, item, {
        tagIds: M.uniq(tagIds || []),
        updatedAt: M.nowIso()
      });
      await adapter.items.put(next);
      replaceInState(next);
      emit('change', { type: 'item:update', item: next });
      return next;
    }

    /* ---------------------------------------------------------- 图片 */

    function itemImages(itemId) {
      return state.images
        .filter(function (im) { return im.itemId === String(itemId); })
        .sort(function (a, b) { return M.str(a.createdAt).localeCompare(M.str(b.createdAt)); });
    }

    async function imageData(imageId) {
      const record = await adapter.blobs.get(String(imageId));
      if (!record) return null;
      return { blob: record.data || null, thumb: record.thumb || null };
    }

    /**
     * 添加图片（业务层只负责记录与关联，压缩由 platform/imaging 负责）
     * @param {string} itemId
     * @param {Array<{meta:object, blob:Blob, thumb:Blob|null}>} list
     */
    async function addImages(itemId, list) {
      const item = getItem(itemId);
      if (!item) throw MS.appError('NOT_FOUND', String(itemId));
      const metas = [];
      for (let i = 0; i < (list || []).length; i++) {
        const entry = list[i];
        if (!entry || !entry.blob) continue;
        const meta = M.normalizeImageMeta(Object.assign({}, entry.meta, {
          id: M.uuid(),
          itemId: item.id
        }));
        await adapter.images.put(meta);
        await adapter.blobs.put({ id: meta.id, data: entry.blob, thumb: entry.thumb || null });
        state.images.push(meta);
        metas.push(meta);
      }
      if (metas.length) {
        const next = Object.assign({}, getItem(itemId), {
          imageIds: (getItem(itemId).imageIds || []).concat(metas.map(function (m) { return m.id; })),
          updatedAt: M.nowIso()
        });
        await adapter.items.put(next);
        replaceInState(next);
      }
      reindex();
      emit('change', { type: 'image:add', itemId: itemId, count: metas.length });
      return metas;
    }

    async function removeImage(imageId) {
      const id = String(imageId);
      const meta = state.imagesById.get(id);
      if (!meta) return false;
      await adapter.images.remove(id);
      await adapter.blobs.remove(id);
      state.images = state.images.filter(function (im) { return im.id !== id; });
      const owner = getItem(meta.itemId);
      if (owner) {
        const next = Object.assign({}, owner, {
          imageIds: (owner.imageIds || []).filter(function (i) { return i !== id; }),
          updatedAt: M.nowIso()
        });
        await adapter.items.put(next);
        replaceInState(next);
      }
      reindex();
      emit('change', { type: 'image:remove', imageId: id, itemId: meta.itemId });
      return true;
    }

    /* ---------------------------------------------------------- 导入 / 导出 */

    async function exportDataset() {
      const images = [];
      for (let i = 0; i < state.images.length; i++) {
        const meta = state.images[i];
        const data = await adapter.blobs.get(meta.id);
        if (!data || !data.data) continue;
        images.push({ meta: meta, blob: data.data });
      }
      return {
        items: state.items.slice(),              // 含回收站中的物品，保证"完整性"
        categories: state.categories.slice(),
        tags: state.tags.slice(),
        images: images
      };
    }

    function buildImportPlan(parsed) {
      return MS.backup.planImport(parsed, {
        items: state.items,
        categories: state.categories,
        tags: state.tags
      });
    }

    /**
     * 执行导入
     * @param {object} plan 由 buildImportPlan 生成
     * @param {function} [onProgress] (done, total, phase)
     */
    async function applyImport(plan, onProgress) {
      const p = plan || {};
      const total = (p.images || []).length + (p.items || []).length + 1;
      let done = 0;
      const tick = function (phase) {
        done++;
        if (typeof onProgress === 'function') {
          try { onProgress(done, total, phase); } catch (e) { /* ignore */ }
        }
      };

      if (p.categories && p.categories.length) await adapter.categories.putMany(p.categories);
      if (p.tags && p.tags.length) await adapter.tags.putMany(p.tags);
      p.categories.forEach(function (c) { state.categories.push(M.normalizeCategory(c)); });
      p.tags.forEach(function (t) { state.tags.push(M.normalizeTag(t)); });
      reindex();
      tick('分类与标签');

      // 图片：元数据 + 二进制；导入的图片若没有缩略图则尝试生成
      const imaging = MS.imaging;
      for (let i = 0; i < (p.images || []).length; i++) {
        const entry = p.images[i];
        const meta = M.normalizeImageMeta(entry.meta);
        let blob = entry.blob;
        if (!blob) {
          blob = new Blob([entry.data], { type: meta.mime || 'image/jpeg' });
        }
        let thumb = null;
        if (imaging && imaging.makeThumbFromBlob) {
          try { thumb = await imaging.makeThumbFromBlob(blob); } catch (e) { thumb = null; }
        }
        await adapter.images.put(meta);
        await adapter.blobs.put({ id: meta.id, data: blob, thumb: thumb });
        const idx = state.images.findIndex(function (x) { return x.id === meta.id; });
        if (idx >= 0) state.images[idx] = meta; else state.images.push(meta);
        tick('图片');
      }

      // 物品（同 ID 覆盖为更新，不同 ID 作为新增）
      for (let i = 0; i < (p.items || []).length; i++) {
        const item = M.normalizeItem(p.items[i]);
        await adapter.items.put(item);
        replaceInState(item);
      }
      tick('物品');
      reindex();
      emit('change', { type: 'import', counts: p.counts });
      return p.counts;
    }

    async function clearAll() {
      await adapter.clearAll();
      state.items = [];
      state.categories = [];
      state.tags = [];
      state.images = [];
      state.lastViewWrite.clear();
      reindex();
      emit('change', { type: 'clear' });
    }

    function stats() {
      return {
        items: liveItems().length,
        trashed: trashedItems().length,
        images: state.images.length,
        categories: state.categories.length,
        tags: state.tags.length
      };
    }

    return {
      init: init,
      on: on,
      off: off,
      adapter: adapter,
      state: state,
      // 物品
      listItems: listItems,
      getItem: getItem,
      search: search,
      recentAdded: recentAdded,
      recentViewed: recentViewed,
      createdTodayCount: createdTodayCount,
      locations: locations,
      createItem: createItem,
      updateItem: updateItem,
      touchViewed: touchViewed,
      softDelete: softDelete,
      restore: restore,
      purge: purge,
      purgeAllTrash: purgeAllTrash,
      trashed: trashedItems,
      contextFor: contextFor,
      categoryName: categoryName,
      tagNames: tagNames,
      // 分类
      listCategories: function () { return state.categories.slice(); },
      categoriesWithCounts: categoriesWithCounts,
      createCategory: createCategory,
      renameCategory: renameCategory,
      deleteCategory: deleteCategory,
      // 标签
      listTags: function () { return state.tags.slice(); },
      tagsWithCounts: tagsWithCounts,
      ensureTag: ensureTag,
      renameTag: renameTag,
      deleteTag: deleteTag,
      setItemTags: setItemTags,
      // 图片
      itemImages: itemImages,
      imageData: imageData,
      addImages: addImages,
      removeImage: removeImage,
      // 备份
      exportDataset: exportDataset,
      buildImportPlan: buildImportPlan,
      applyImport: applyImport,
      clearAll: clearAll,
      stats: stats
    };
  }

  MS.createRepository = createRepository;
})(typeof globalThis !== 'undefined' ? globalThis : this);
