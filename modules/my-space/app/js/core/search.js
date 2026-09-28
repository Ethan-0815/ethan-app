/*!
 * 我的空间 · 搜索（纯函数）
 * 支持：名称 / 品牌 / 型号 / 序列号 / 分类 / 标签 / 位置 / 备注 / 购买渠道
 * 特性：模糊匹配、多关键词 AND、空值安全、结果按相关度排序
 * V0.2 只需往 FIELDS 里加「资料名称 / 维修问题 / 维修处理」即可，无需改调用方。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  /** 字段权重：名称最高，备注最低 */
  const WEIGHTS = {
    name: 10,
    serialNumber: 8,
    brand: 6,
    model: 6,
    location: 6,
    category: 5,
    tags: 5,
    purchaseChannel: 3,
    notes: 2
  };
  /** 允许「子序列模糊匹配」的字段（避免备注把结果冲散） */
  const FUZZY_KEYS = { name: true, brand: true, model: true, serialNumber: true, location: true };

  function norm(v) {
    return (v === null || v === undefined) ? '' : String(v).toLowerCase();
  }

  function tokenize(query) {
    return norm(query).replace(/[，,、;；]+/g, ' ').split(/\s+/).filter(Boolean);
  }

  /** needle 是否为 hay 的子序列（如 "wh1000" 命中 "wh-1000xm5"） */
  function isSubsequence(needle, hay) {
    if (!needle || !hay) return false;
    let i = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  /**
   * 把物品摊平成可搜索字段。
   * @param {object} item
   * @param {{categoryName?:string, tagNames?:string[]}} ctx 由仓储层补充的关联名称
   */
  function fieldsOf(item, ctx) {
    const it = item || {};
    const c = ctx || {};
    return {
      name: norm(it.name),
      brand: norm(it.brand),
      model: norm(it.model),
      serialNumber: norm(it.serialNumber),
      location: norm(it.location),
      purchaseChannel: norm(it.purchaseChannel),
      notes: norm(it.notes),
      category: norm(c.categoryName),
      tags: norm((c.tagNames || []).join(' '))
    };
  }

  /** 返回相关度分数，-1 表示不匹配 */
  function scoreItem(item, tokens, ctx) {
    if (!tokens || !tokens.length) return 0;
    const f = fieldsOf(item, ctx);
    let total = 0;
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t];
      let best = 0;
      for (const key in f) {
        const value = f[key];
        if (!value) continue;                 // 空字段直接跳过，绝不参与匹配、绝不报错
        let base = 0;
        if (value === token) base = 3;
        else {
          const idx = value.indexOf(token);
          if (idx === 0) base = 2.4;
          else if (idx > 0) base = 1.6;
          else if (token.length >= 3 && FUZZY_KEYS[key] && isSubsequence(token, value)) base = 0.9;
        }
        if (base > 0) {
          const s = base * (WEIGHTS[key] || 1);
          if (s > best) best = s;
        }
      }
      if (best <= 0) return -1;               // AND 语义：每个关键词都必须命中
      total += best;
    }
    // 名称前缀命中额外加权，让最相关的排最前
    if (f.name && tokens.length && f.name.indexOf(tokens[0]) === 0) total += 4;
    return total;
  }

  /**
   * 搜索物品（空查询 → 原样返回，由调用方决定展示方式）
   * @returns {Array<{item:object, score:number}>}
   */
  function searchItems(items, query, ctxFor, opts) {
    const tokens = tokenize(query);
    const list = Array.isArray(items) ? items : [];
    if (!tokens.length) return list.map(function (it) { return { item: it, score: 0 }; });
    const options = opts || {};
    const limit = Number.isFinite(options.limit) ? options.limit : 0;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item) continue;
      let ctx = null;
      if (typeof ctxFor === 'function') {
        try { ctx = ctxFor(item); } catch (e) { ctx = null; }
      }
      const score = scoreItem(item, tokens, ctx);
      if (score >= 0) out.push({ item: item, score: score });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return norm(b.item.updatedAt) > norm(a.item.updatedAt) ? 1 : -1;
    });
    return limit > 0 ? out.slice(0, limit) : out;
  }

  /** 在文本中高亮命中片段（返回转义后的 HTML 片段数组） */
  function highlight(text, query) {
    const raw = (text === null || text === undefined) ? '' : String(text);
    const tokens = tokenize(query).filter(function (t) { return t.length > 0; });
    if (!raw || !tokens.length) return [raw];
    let segments = [{ text: raw, hit: false }];
    tokens.forEach(function (token) {
      const next = [];
      segments.forEach(function (seg) {
        if (seg.hit) { next.push(seg); return; }
        const lower = seg.text.toLowerCase();
        let from = 0;
        let idx = lower.indexOf(token, from);
        while (idx !== -1) {
          if (idx > from) next.push({ text: seg.text.slice(from, idx), hit: false });
          next.push({ text: seg.text.slice(idx, idx + token.length), hit: true });
          from = idx + token.length;
          idx = lower.indexOf(token, from);
        }
        if (from < seg.text.length) next.push({ text: seg.text.slice(from), hit: false });
      });
      segments = next;
    });
    return segments;
  }

  MS.search = {
    WEIGHTS: WEIGHTS,
    tokenize: tokenize,
    isSubsequence: isSubsequence,
    fieldsOf: fieldsOf,
    scoreItem: scoreItem,
    searchItems: searchItems,
    highlight: highlight
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
