/*!
 * 我的空间 · 数据模型 / 空值规则 / 展示安全层
 * 纯函数，无 DOM、无副作用，可直接在 Node 中单元测试。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const APP_VERSION = '0.1.0';
  const BACKUP_VERSION = 1;

  /** 物品的文本类可选字段（空字符串一律归一为 null） */
  const ITEM_TEXT_FIELDS = [
    'name', 'brand', 'model', 'purchaseChannel', 'serialNumber', 'location', 'notes'
  ];
  /** 物品可被「清空」的字段（编辑页删除内容后必须真正落库为 null） */
  const ITEM_CLEARABLE_FIELDS = [
    'categoryId', 'brand', 'model', 'purchaseDate', 'purchasePrice',
    'purchaseChannel', 'serialNumber', 'location', 'notes'
  ];

  const ITEM_LABELS = {
    name: '名称',
    categoryId: '分类',
    brand: '品牌',
    model: '型号',
    purchaseDate: '购买日期',
    purchasePrice: '购买价格',
    purchaseChannel: '购买渠道',
    serialNumber: '序列号',
    location: '存放位置',
    notes: '备注'
  };

  const DEFAULT_CATEGORIES = ['电子设备', '电脑', '手机', '音频', '摄影', '家居', '工具', '交通', '其他'];
  const SUGGESTED_TAGS = ['常用', '备用', '重要', '闲置', '待维修', '贵重'];

  const SORT_OPTIONS = [
    { id: 'updated', label: '最近更新' },
    { id: 'created', label: '最近添加' },
    { id: 'name', label: '名称' },
    { id: 'price', label: '价格' }
  ];

  /* ---------------------------------------------------------------- 基础工具 */

  function str(v) {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : String(v);
  }

  /** 去空格；空 → null（数据库层面统一空值方案） */
  function trimOrNull(v) {
    const s = str(v).trim();
    return s === '' ? null : s;
  }

  /** 非法数字一律 → null，绝不产生 NaN */
  function numOrNull(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
    const s = String(v).trim().replace(/[,¥￥\s]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    if (!/^-?\d*\.?\d*$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? round2(n) : null;
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** 非法日期一律 → null，绝不产生 Invalid Date */
  function dateOrNull(v) {
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : toIsoDate(v);
    }
    const s = str(v).trim();
    if (!s) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const probe = new Date(Date.UTC(y, mo - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
      return pad4(y) + '-' + pad2(mo) + '-' + pad2(d);
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return dateOrNull(m[1] + '-' + m[2] + '-' + m[3]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : toIsoDate(d);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad4(n) { return String(n).padStart(4, '0'); }

  function toIsoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nowIso() { return new Date().toISOString(); }

  function isIsoLike(v) {
    return typeof v === 'string' && !isNaN(new Date(v).getTime());
  }

  /** 稳定、唯一 ID：优先 crypto.randomUUID，降级为安全随机 UUIDv4 */
  function uuid() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* ignore */ }
    }
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [];
    for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    (arr || []).forEach(function (v) {
      if (v === null || v === undefined) return;
      const k = String(v);
      if (k.trim() === '') return;      // 空字符串不视为有效引用
      if (seen.has(k)) return;
      seen.add(k);
      out.push(k);
    });
    return out;
  }

  /* ---------------------------------------------------------------- 归一化 */

  /** 物品归一化：任何残缺、脏数据、null 都能安全通过；只有 name 为业务必填 */
  function normalizeItem(input) {
    const s = input && typeof input === 'object' ? input : {};
    const createdAt = isIsoLike(s.createdAt) ? s.createdAt : nowIso();
    const updatedAt = isIsoLike(s.updatedAt) ? s.updatedAt : createdAt;
    return {
      id: trimOrNull(s.id) || uuid(),
      name: str(s.name).trim(),
      categoryId: trimOrNull(s.categoryId),
      brand: trimOrNull(s.brand),
      model: trimOrNull(s.model),
      purchaseDate: dateOrNull(s.purchaseDate),
      purchasePrice: numOrNull(s.purchasePrice),
      purchaseChannel: trimOrNull(s.purchaseChannel),
      serialNumber: trimOrNull(s.serialNumber),
      location: trimOrNull(s.location),
      notes: trimOrNull(s.notes),
      tagIds: uniq(Array.isArray(s.tagIds) ? s.tagIds : []),
      imageIds: uniq(Array.isArray(s.imageIds) ? s.imageIds : []),
      createdAt: createdAt,
      updatedAt: updatedAt,
      lastViewedAt: isIsoLike(s.lastViewedAt) ? s.lastViewedAt : null,
      deletedAt: isIsoLike(s.deletedAt) ? s.deletedAt : null
    };
  }

  /** 名称是否有效（唯一必填项） */
  function isValidItem(item) {
    return !!item && str(item.name).trim() !== '';
  }

  function normalizeCategory(input, index) {
    const s = input && typeof input === 'object' ? input : {};
    return {
      id: trimOrNull(s.id) || uuid(),
      name: str(s.name).trim(),
      order: Number.isFinite(s.order) ? s.order : (Number.isFinite(index) ? index : 0),
      createdAt: isIsoLike(s.createdAt) ? s.createdAt : nowIso()
    };
  }

  function normalizeTag(input) {
    const s = input && typeof input === 'object' ? input : {};
    return {
      id: trimOrNull(s.id) || uuid(),
      name: str(s.name).trim(),
      createdAt: isIsoLike(s.createdAt) ? s.createdAt : nowIso()
    };
  }

  function normalizeImageMeta(input) {
    const s = input && typeof input === 'object' ? input : {};
    return {
      id: trimOrNull(s.id) || uuid(),
      itemId: trimOrNull(s.itemId),
      name: trimOrNull(s.name) || 'image.jpg',
      mime: trimOrNull(s.mime) || 'image/jpeg',
      size: Number.isFinite(s.size) ? s.size : 0,
      width: Number.isFinite(s.width) ? s.width : null,
      height: Number.isFinite(s.height) ? s.height : null,
      createdAt: isIsoLike(s.createdAt) ? s.createdAt : nowIso()
    };
  }

  /* ---------------------------------------------------------------- 展示安全层 */
  /* UI 层只能通过这里取值，从根上杜绝 null / undefined / NaN / Invalid Date */

  function displayText(v) {
    return trimOrNull(v) || '';
  }

  function formatAmount(n) {
    const v = numOrNull(n);
    if (v === null) return '';
    const neg = v < 0;
    const abs = Math.abs(v);
    const parts = abs.toFixed(2).split('.');
    const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const dec = parts[1];
    let tail = '';
    if (dec !== '00') tail = dec[1] === '0' ? '.' + dec[0] : '.' + dec;
    return (neg ? '-' : '') + int + tail;
  }

  function displayPrice(v) {
    const n = numOrNull(v);
    return n === null ? '' : '¥' + formatAmount(n);
  }

  function displayDate(v) {
    const d = dateOrNull(v);
    if (!d) return '';
    const p = d.split('-');
    return (+p[0]) + '年' + (+p[1]) + '月' + (+p[2]) + '日';
  }

  function displayDateTime(v) {
    if (!isIsoLike(v)) return '';
    const d = new Date(v);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 相对时间：刚刚 / 3 分钟前 / 昨天 / 2026年8月3日 */
  function relativeTime(v) {
    if (!isIsoLike(v)) return '';
    const t = new Date(v).getTime();
    const diff = Date.now() - t;
    if (diff < 0) return displayDate(v);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    const day = Math.floor(hour / 24);
    if (day === 1) return '昨天';
    if (day < 7) return day + ' 天前';
    return displayDate(v);
  }

  function formatSize(bytes) {
    const n = numOrNull(bytes);
    if (n === null || n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 文件名安全化（导出时使用） */
  function safeFileName(name, fallback) {
    const s = (trimOrNull(name) || fallback || 'file').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
    return s.slice(0, 80) || (fallback || 'file');
  }

  /* ---------------------------------------------------------------- 错误友好化 */

  const ERROR_MESSAGES = {
    QUOTA: '存储空间不足，请清理一些图片后重试。',
    IMAGE_BROKEN: '这张图片已损坏或不支持，无法添加。',
    BACKUP_BROKEN: '无法导入该备份文件，请检查文件是否完整。',
    BACKUP_NO_DATA: '这个压缩包里没有找到 data.json，可能不是「我的空间」的备份。',
    BACKUP_JSON: '备份文件里的数据格式损坏，无法解析。',
    BACKUP_VERSION: '这个备份来自更新版本的应用，请先升级「我的空间」再导入。',
    ZIP_BROKEN: '压缩包结构异常，无法读取。',
    DB_UNAVAILABLE: '本地数据库不可用，无法读写数据。',
    NOT_FOUND: '找不到这条记录，它可能已被删除。',
    UNKNOWN: '操作未能完成，请稍后再试。'
  };

  function appError(code, detail) {
    const e = new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN);
    e.code = code;
    if (detail) e.detail = String(detail);
    return e;
  }

  /** 把任何异常翻译成一句用户能看懂的话，绝不外泄技术堆栈 */
  function friendly(err) {
    if (!err) return ERROR_MESSAGES.UNKNOWN;
    if (err.code && ERROR_MESSAGES[err.code]) return ERROR_MESSAGES[err.code];
    const raw = String((err && err.message) || err);
    if (/QuotaExceeded|quota/i.test(raw)) return ERROR_MESSAGES.QUOTA;
    if (/not a valid zip|end of central|zip/i.test(raw)) return ERROR_MESSAGES.ZIP_BROKEN;
    if (/JSON/i.test(raw)) return ERROR_MESSAGES.BACKUP_JSON;
    if (/IDB|IndexedDB|database/i.test(raw)) return ERROR_MESSAGES.DB_UNAVAILABLE;
    return ERROR_MESSAGES.UNKNOWN;
  }

  MS.APP_VERSION = APP_VERSION;
  MS.BACKUP_VERSION = BACKUP_VERSION;
  MS.models = {
    ITEM_TEXT_FIELDS: ITEM_TEXT_FIELDS,
    ITEM_CLEARABLE_FIELDS: ITEM_CLEARABLE_FIELDS,
    ITEM_LABELS: ITEM_LABELS,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    SUGGESTED_TAGS: SUGGESTED_TAGS,
    SORT_OPTIONS: SORT_OPTIONS,
    str: str,
    trimOrNull: trimOrNull,
    numOrNull: numOrNull,
    round2: round2,
    dateOrNull: dateOrNull,
    toIsoDate: toIsoDate,
    nowIso: nowIso,
    isIsoLike: isIsoLike,
    uuid: uuid,
    uniq: uniq,
    normalizeItem: normalizeItem,
    normalizeCategory: normalizeCategory,
    normalizeTag: normalizeTag,
    normalizeImageMeta: normalizeImageMeta,
    isValidItem: isValidItem,
    displayText: displayText,
    formatAmount: formatAmount,
    displayPrice: displayPrice,
    displayDate: displayDate,
    displayDateTime: displayDateTime,
    relativeTime: relativeTime,
    formatSize: formatSize,
    safeFileName: safeFileName
  };
  MS.appError = appError;
  MS.friendly = friendly;
  MS.ERROR_MESSAGES = ERROR_MESSAGES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
