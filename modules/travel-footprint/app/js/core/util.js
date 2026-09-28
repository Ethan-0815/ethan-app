/* ==========================================================================
   Travel Footprint — core/util.js
   Pure helpers. No DOM, no IO. Loadable in Node via vm.runInThisContext.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  /* ---------------------------------------------------------------- ids --- */

  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch (e) { /* fall through */ }

    var bytes = new Uint8Array(16);
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        throw new Error('no rng');
      }
    } catch (e) {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }

    // RFC 4122 version 4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    var hex = [];
    for (var j = 0; j < 16; j++) {
      hex.push((bytes[j] + 0x100).toString(16).slice(1));
    }
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  /* --------------------------------------------------------------- time --- */

  function nowIso() {
    return new Date().toISOString();
  }

  /**
   * Normalise any date-ish input to 'YYYY-MM-DD' or null.
   * Accepts Date, 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY-M-D', ISO datetime.
   */
  function toDateStr(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return fmtDate(value);
    }

    var s = String(value).trim();
    if (!s) return null;

    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var d = parseInt(m[3], 10);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return y + '-' + pad2(mo) + '-' + pad2(d);
    }

    var dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    return fmtDate(dt);
  }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** Parse 'YYYY-MM-DD' to a Date at local midnight, or null. */
  function parseDate(str) {
    var s = toDateStr(str);
    if (!s) return null;
    var p = s.split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function todayStr() {
    return fmtDate(new Date());
  }

  /** Days spanned inclusive: 2026-08-12 → 2026-08-15 === 4 */
  function daysBetween(startStr, endStr) {
    var a = parseDate(startStr);
    var b = parseDate(endStr);
    if (!a || !b) return 1;
    var diff = Math.round((b.getTime() - a.getTime()) / 86400000);
    if (diff < 0) diff = 0;
    return diff + 1;
  }

  var MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                   'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var MONTHS_CN = ['一月', '二月', '三月', '四月', '五月', '六月',
                   '七月', '八月', '九月', '十月', '十一月', '十二月'];

  function yearOf(str) {
    var s = toDateStr(str);
    return s ? parseInt(s.slice(0, 4), 10) : null;
  }

  function monthOf(str) {
    var s = toDateStr(str);
    return s ? parseInt(s.slice(5, 7), 10) : null;
  }

  function monthLabelEn(month) {
    return MONTHS_EN[(month - 1 + 12) % 12];
  }

  function monthLabelCn(month) {
    return MONTHS_CN[(month - 1 + 12) % 12];
  }

  /** '2026.08.12' */
  function formatDot(str) {
    var s = toDateStr(str);
    if (!s) return '';
    return s.replace(/-/g, '.');
  }

  /** '2026.08' */
  function formatDotMonth(str) {
    var s = toDateStr(str);
    if (!s) return '';
    return s.slice(0, 7).replace(/-/g, '.');
  }

  /**
   * Human range. Handles same-day, same-month, same-year, cross-year.
   *   '2026-08-12','2026-08-15' → '2026.08.12 — 08.15'
   *   '2026-07-30','2026-08-02' → '2026.07.30 — 08.02'
   *   '2025-12-28','2026-01-03' → '2025.12.28 — 2026.01.03'
   *   '2026-08-12','2026-08-12' → '2026.08.12'
   */
  function formatRange(startStr, endStr) {
    var a = toDateStr(startStr);
    var b = toDateStr(endStr);
    if (!a && !b) return '';
    if (!a) return formatDot(b);
    if (!b) return formatDot(a);
    if (a === b) return formatDot(a);

    if (a.slice(0, 4) === b.slice(0, 4)) {
      if (a.slice(0, 7) === b.slice(0, 7)) {
        return formatDot(a) + ' — ' + b.slice(8);
      }
      return formatDot(a) + ' — ' + b.slice(5).replace(/-/g, '.');
    }
    return formatDot(a) + ' — ' + formatDot(b);
  }

  /** 2026-08-12 → '2026年8月' */
  function formatCnMonth(str) {
    var s = toDateStr(str);
    if (!s) return '';
    return parseInt(s.slice(0, 4), 10) + '年' + parseInt(s.slice(5, 7), 10) + '月';
  }

  function pluralDays(n) {
    return n + ' 天';
  }

  /* -------------------------------------------------------------- value --- */

  /** '' / undefined / NaN / Invalid Date → null. Everything else trimmed string. */
  function nn(value) {
    if (value === null || value === undefined) return null;
    var s = String(value).trim();
    return s === '' ? null : s;
  }

  function toNum(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(self, args);
      }, wait || 200);
    };
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /** Yield to the event loop so long loops don't block paint. */
  function yieldToUI() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  /* --------------------------------------------------------------- sort --- */

  function byDesc(a, b) {
    return a < b ? 1 : a > b ? -1 : 0;
  }

  function byAsc(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /**
   * Compare two ordering keys as a predicate (NOT a sort comparator).
   * Use this for "is A newer than B" — byDesc/byAsc return -1 for the
   * newer-first case, so testing them with `> 0` silently inverts the answer.
   * Returns 1 / 0 / -1 meaning a is newer / equal / older than b.
   */
  function compareKeys(a, b) {
    var x = a === null || a === undefined ? '' : String(a);
    var y = b === null || b === undefined ? '' : String(b);
    return x > y ? 1 : x < y ? -1 : 0;
  }

  function isAfter(a, b) {
    return compareKeys(a, b) > 0;
  }

  TF.util = {
    uuid: uuid,
    nowIso: nowIso,
    toDateStr: toDateStr,
    fmtDate: fmtDate,
    parseDate: parseDate,
    todayStr: todayStr,
    daysBetween: daysBetween,
    yearOf: yearOf,
    monthOf: monthOf,
    monthLabelEn: monthLabelEn,
    monthLabelCn: monthLabelCn,
    formatDot: formatDot,
    formatDotMonth: formatDotMonth,
    formatRange: formatRange,
    formatCnMonth: formatCnMonth,
    pluralDays: pluralDays,
    nn: nn,
    toNum: toNum,
    clamp: clamp,
    pad2: pad2,
    debounce: debounce,
    sleep: sleep,
    yieldToUI: yieldToUI,
    byDesc: byDesc,
    byAsc: byAsc,
    compareKeys: compareKeys,
    isAfter: isAfter,
    MONTHS_EN: MONTHS_EN
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
