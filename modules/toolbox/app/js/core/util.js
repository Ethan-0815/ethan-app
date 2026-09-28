/*!
 * 工具箱 · 基础工具（纯函数，零 DOM、零 IO）
 * 数字解析 / 格式化 / 错误友好化 / UUID / 时间格式
 * 这里是全应用"不出 NaN / Infinity / undefined"的第一道防线。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});

  const APP_VERSION = '0.1.0';

  /* ---------------------------------------------------------------- 基础类型 */

  function str(v) {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : String(v);
  }

  /** 去空格；空字符串 → null */
  function trimOrNull(v) {
    const s = str(v).trim();
    return s === '' ? null : s;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * 把用户输入解析为有限数字；任何非法输入一律返回 null（绝不产生 NaN）
   * 容忍：前后空格、千分位逗号、全角数字、全角小数点、前后货币符号
   */
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = str(v);
    // 全角数字与符号 → 半角
    s = s.replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/\uFF0E/g, '.').replace(/\uFF0D/g, '-').replace(/\uFF0B/g, '+')
      .replace(/[,，\s\u00A0¥￥$]/g, '');
    if (s === '' || s === '.' || s === '-' || s === '+') return null;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** 解析整数，限制位数，避免超大输入拖垮界面 */
  function parseBigInt(text, maxDigits) {
    const s = str(text).trim().replace(/[\uFF10-\uFF19]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/[,，\s_]/g, '');
    const body = s.replace(/^[+-]/, '');
    if (!/^\d+$/.test(body)) return null;
    if (maxDigits && body.length > maxDigits) return { overflow: true };
    const neg = s.charAt(0) === '-';
    const v = BigInt(body);
    return { value: neg ? -v : v, negative: neg };
  }

  function roundTo(n, digits) {
    if (!Number.isFinite(n)) return null;
    const d = clamp(Number.isFinite(digits) ? digits : 2, 0, 12);
    const f = Math.pow(10, d);
    return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * f) / f;
  }

  /** 清掉浮点误差尾数：0.1 + 0.2 → 0.3 */
  function cleanFloat(n) {
    if (!Number.isFinite(n)) return null;
    if (n === 0) return 0;
    const r = Number(n.toPrecision(12));
    return Number.isFinite(r) ? r : n;
  }

  /* ---------------------------------------------------------------- 数字格式化 */

  /** 加千分位、按需保留小数（去掉无意义的尾随 0），绝不出现 NaN */
  function formatNumber(n, maxFrac) {
    if (!Number.isFinite(n)) return '';
    const digits = clamp(Number.isFinite(maxFrac) ? maxFrac : 6, 0, 12);
    const neg = n < 0;
    const abs = Math.abs(n);
    const fixed = abs.toFixed(digits);
    let out = fixed;
    if (digits > 0) out = fixed.replace(/\.?0+$/, '');
    const parts = out.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  /** 固定小数位（用于金额 2 位） */
  function formatFixed(n, digits) {
    if (!Number.isFinite(n)) return '';
    const d = clamp(Number.isFinite(digits) ? digits : 2, 0, 12);
    const s = n.toFixed(d);
    const parts = s.split('.');
    const neg = parts[0].charAt(0) === '-';
    const intPart = (neg ? parts[0].slice(1) : parts[0]).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intPart + (parts[1] ? '.' + parts[1] : '');
  }

  const BYTE_UNITS_DEC = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const BYTE_UNITS_BIN = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

  /** 字节数 → 可读文本。binary=true 时使用 1024 进制 */
  function formatBytes(bytes, binary) {
    const n = Number.isFinite(bytes) ? bytes : null;
    if (n === null || n < 0) return '—';
    const step = binary ? 1024 : 1000;
    const units = binary ? BYTE_UNITS_BIN : BYTE_UNITS_DEC;
    if (n < step) return Math.round(n) + ' B';
    let value = n;
    let i = 0;
    while (value >= step && i < units.length - 1) { value /= step; i++; }
    const digits = value < 10 ? 2 : (value < 100 ? 1 : 0);
    return formatNumber(value, digits) + ' ' + units[i];
  }

  /** 体积（数据量）换算：单位 → 字节 */
  function bytesOf(value, unitIndex, binary) {
    const n = parseNum(value);
    if (n === null) return null;
    const step = binary ? 1024 : 1000;
    return n * Math.pow(step, clamp(unitIndex, 0, 5));
  }

  /* ---------------------------------------------------------------- 时间 */

  /** 设备当前时区描述，例如 UTC+08:00 */
  function timezoneLabel(date) {
    const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    return 'UTC' + sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
  }

  function timezoneName() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz || '';
    } catch (e) { return ''; }
  }

  /** 本地时间 → 'YYYY-MM-DD HH:mm:ss' */
  function formatDateTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function formatDateCn(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    const week = '日一二三四五六'.charAt(date.getDay());
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 星期' + week;
  }

  /* ---------------------------------------------------------------- UUID */

  /** 稳定唯一的 UUID v4；优先浏览器安全随机，降级为 getRandomValues / Math.random */
  function uuidV4() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* 降级 */ }
    }
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(b);
    } else {
      for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;    // version 4
    b[8] = (b[8] & 0x3f) | 0x80;    // variant 10
    const h = [];
    for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
  }

  /** 有安全随机源时返回 true（用于给用户一个"随机质量"的说明） */
  function hasSecureRandom() {
    const c = root.crypto;
    return !!(c && (typeof c.randomUUID === 'function' || typeof c.getRandomValues === 'function'));
  }

  /** 安全随机整数 [0, max) */
  function randomBelow(max) {
    const c = root.crypto;
    if (max <= 0) return 0;
    if (c && typeof c.getRandomValues === 'function') {
      // 拒绝采样，保证均匀分布
      const limit = Math.floor(0xFFFFFFFF / max) * max;
      const buf = new Uint32Array(1);
      for (let i = 0; i < 100; i++) {
        c.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % max;
      }
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  /* ---------------------------------------------------------------- 错误友好化 */

  const ERROR_MESSAGES = {
    INVALID_NUMBER: '请输入有效数字',
    EMPTY_INPUT: '请先填写内容',
    DIV_ZERO: '不能除以 0',
    CALC_SYNTAX: '表达式有误，请检查输入',
    CALC_RESULT: '计算结果超出范围，无法显示',
    IMAGE_FAIL: '图片处理失败，请尝试选择其他图片。',
    IMAGE_BROKEN: '这张图片已损坏或格式不支持，请换一张试试。',
    IMAGE_TOO_LARGE: '图片太大，设备内存不足，请选择尺寸更小的图片。',
    IMAGE_ENCODE_FAIL: '图片转换失败，请尝试更换目标格式。',
    NO_IMAGE: '请先选择图片',
    PDF_FAIL: 'PDF 生成失败，请重试。',
    PDF_EMPTY: '请至少添加一张图片后再生成 PDF。',
    JSON_EMPTY: '请先粘贴 JSON 内容',
    JSON_BROKEN: 'JSON 格式有误，请检查输入内容。',
    FILE_READ_FAIL: '文件读取失败，请确认文件完整后重试。',
    FILE_TOO_BIG: '文件太大，暂不支持读取超过 5 MB 的文本文件。',
    FILE_EMPTY: '这个文件是空的，请换一个文件试试。',
    FILE_TYPE: '请选择 .json 或 .txt 文本文件。',
    RADIX_INVALID: '输入的数字无效',
    RADIX_TOO_LONG: '数字位数过多，请减少后重试',
    TIME_INVALID: '请输入有效的时间戳或日期',
    RANGE_INVALID: '最小值不能大于最大值',
    OPTIONS_TOO_FEW: '至少需要 2 个有效选项',
    COPY_FAIL: '复制失败，请长按选择后手动复制',
    SAVE_FAIL: '保存失败，请重试',
    UNKNOWN: '操作未能完成，请稍后再试。'
  };

  function appError(code, detail) {
    const e = new Error(ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN);
    e.code = code || 'UNKNOWN';
    if (detail) e.detail = str(detail);
    return e;
  }

  /** 把任何异常翻译成一句用户能看懂的话，绝不外泄技术堆栈 */
  function friendly(err) {
    if (!err) return ERROR_MESSAGES.UNKNOWN;
    if (err.code && ERROR_MESSAGES[err.code]) return ERROR_MESSAGES[err.code];
    const raw = str(err.message || err);
    if (/quota|storage full/i.test(raw)) return '存储空间不足，请清理一些内容后重试。';
    if (/out of memory|allocation failed/i.test(raw)) return ERROR_MESSAGES.IMAGE_TOO_LARGE;
    if (/decode|image|bitmap/i.test(raw)) return ERROR_MESSAGES.IMAGE_FAIL;
    if (/JSON/i.test(raw)) return ERROR_MESSAGES.JSON_BROKEN;
    if (/network|fetch|Failed to fetch/i.test(raw)) return ERROR_MESSAGES.UNKNOWN;
    return ERROR_MESSAGES.UNKNOWN;
  }

  /* ---------------------------------------------------------------- 其它 */

  /** 生成安全的文件名（去掉系统非法字符） */
  function safeFileName(name, fallback) {
    const s = (trimOrNull(name) || fallback || 'file').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
    return s.slice(0, 90) || (fallback || 'file');
  }

  /** 去掉扩展名 */
  function baseName(name) {
    const s = str(name);
    const i = s.lastIndexOf('.');
    return i > 0 ? s.slice(0, i) : s;
  }

  function extOf(name) {
    const s = str(name);
    const i = s.lastIndexOf('.');
    return i > 0 ? s.slice(i + 1).toLowerCase() : '';
  }

  /** 数字 → 固定宽度的展示文本，永不空白 */
  function displayNumber(value, fallback) {
    const n = parseNum(value);
    if (n === null) return fallback === undefined ? '—' : fallback;
    return formatNumber(n, 6);
  }

  TB.APP_VERSION = APP_VERSION;
  TB.util = {
    str: str,
    trimOrNull: trimOrNull,
    pad2: pad2,
    clamp: clamp,
    parseNum: parseNum,
    parseBigInt: parseBigInt,
    roundTo: roundTo,
    cleanFloat: cleanFloat,
    formatNumber: formatNumber,
    formatFixed: formatFixed,
    formatBytes: formatBytes,
    bytesOf: bytesOf,
    BYTE_UNITS_DEC: BYTE_UNITS_DEC,
    BYTE_UNITS_BIN: BYTE_UNITS_BIN,
    timezoneLabel: timezoneLabel,
    timezoneName: timezoneName,
    formatDateTime: formatDateTime,
    formatDateCn: formatDateCn,
    uuidV4: uuidV4,
    hasSecureRandom: hasSecureRandom,
    randomBelow: randomBelow,
    appError: appError,
    friendly: friendly,
    ERROR_MESSAGES: ERROR_MESSAGES,
    safeFileName: safeFileName,
    baseName: baseName,
    extOf: extOf,
    displayNumber: displayNumber
  };
  TB.appError = appError;
  TB.friendly = friendly;
})(typeof globalThis !== 'undefined' ? globalThis : this);
