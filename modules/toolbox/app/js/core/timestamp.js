/*!
 * 工具箱 · 时间戳转换（纯函数）
 * 双向：时间戳 → 日期、日期 → 时间戳。
 * 秒 / 毫秒由界面明确选择，默认使用设备当前时区。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const MAX_MS = 8.64e15;   // ECMAScript 可表示的时间上限

  const UNITS = [
    { id: 's', label: '秒', full: 'Unix 时间戳（秒）' },
    { id: 'ms', label: '毫秒', full: 'Unix 时间戳（毫秒）' }
  ];

  function unitInfo(id) {
    return id === 'ms' ? UNITS[1] : UNITS[0];
  }

  function ok(ms) {
    const d = new Date(ms);
    return {
      ok: true,
      ms: ms,
      seconds: Math.floor(ms / 1000),
      milliseconds: ms,
      local: U.formatDateTime(d),
      dateCn: U.formatDateCn(d),
      iso: isNaN(d.getTime()) ? '' : d.toISOString(),
      utc: isNaN(d.getTime()) ? '' : d.toUTCString(),
      timezone: U.timezoneLabel(d) + (U.timezoneName() ? ' · ' + U.timezoneName() : ''),
      relative: relative(ms)
    };
  }

  function relative(ms) {
    const diff = Date.now() - ms;
    const abs = Math.abs(diff);
    const suffix = diff >= 0 ? '前' : '后';
    if (abs < 1000) return '就是现在';
    const sec = Math.floor(abs / 1000);
    if (sec < 60) return sec + ' 秒' + suffix;
    const min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分钟' + suffix;
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时' + suffix;
    const day = Math.floor(hour / 24);
    if (day < 30) return day + ' 天' + suffix;
    const month = Math.floor(day / 30.44);
    if (month < 12) return month + ' 个月' + suffix;
    return Math.floor(day / 365.25) + ' 年' + suffix;
  }

  /**
   * 时间戳 → 日期
   * @param {string|number} text
   * @param {'s'|'ms'} unit
   */
  function timestampToDate(text, unit) {
    const raw = U.str(text).trim();
    if (raw === '') return { ok: false, code: 'EMPTY_INPUT', message: '请输入时间戳' };
    const n = U.parseNum(raw);
    if (n === null || !Number.isInteger(n)) {
      return { ok: false, code: 'TIME_INVALID', message: '时间戳需要是整数，请检查输入' };
    }
    const ms = unit === 'ms' ? n : n * 1000;
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) {
      return { ok: false, code: 'TIME_INVALID', message: '时间戳超出可表示范围' };
    }
    const d = new Date(ms);
    if (isNaN(d.getTime())) {
      return { ok: false, code: 'TIME_INVALID', message: '时间戳超出可表示范围' };
    }
    const y = d.getFullYear();
    if (y < 1 || y > 9999) {
      return { ok: false, code: 'TIME_INVALID', message: '时间戳超出可表示范围（年份需在 1 ~ 9999 之间）' };
    }
    const result = ok(ms);
    // 给用户一个"单位选错了"的友好提示
    result.hint = '';
    const digits = String(Math.abs(n)).length;
    if (unit === 's' && digits >= 12) result.hint = '这个数值看起来更像毫秒时间戳，可以切换单位后再试。';
    if (unit === 'ms' && digits <= 10) result.hint = '这个数值看起来更像秒时间戳，可以切换单位后再试。';
    return result;
  }

  /** 解析 YYYY-MM-DD（也接受 / . 与 8 位连写） */
  function parseDateText(text) {
    const s = U.str(text).trim();
    if (s === '') return { ok: false, code: 'EMPTY_INPUT', message: '请选择日期' };
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (!m) {
      const m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
      if (m2) m = m2;
    }
    if (!m) return { ok: false, code: 'TIME_INVALID', message: '日期格式应为 2025-06-15' };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
      return { ok: false, code: 'TIME_INVALID', message: '日期不存在，请检查月份与日期' };
    }
    const probe = new Date(y, mo - 1, d, 0, 0, 0, 0);
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
      return { ok: false, code: 'TIME_INVALID', message: '日期不存在，请检查月份与日期' };
    }
    return { ok: true, y: y, mo: mo, d: d };
  }

  /** 解析 HH:mm 或 HH:mm:ss（留空按 00:00:00） */
  function parseTimeText(text) {
    const s = U.str(text).trim();
    if (s === '') return { ok: true, h: 0, mi: 0, se: 0 };
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (!m) return { ok: false, code: 'TIME_INVALID', message: '时间格式应为 15:06:40' };
    const h = Number(m[1]);
    const mi = Number(m[2]);
    const se = m[3] === undefined ? 0 : Number(m[3]);
    if (h > 23 || mi > 59 || se > 59) {
      return { ok: false, code: 'TIME_INVALID', message: '时间超出有效范围（00:00:00 ~ 23:59:59）' };
    }
    return { ok: true, h: h, mi: mi, se: se };
  }

  /**
   * 日期 → 时间戳
   * @param {{date:string, time:string, unit:'s'|'ms'}} input
   */
  function dateToTimestamp(input) {
    const src = input || {};
    const d = parseDateText(src.date);
    if (!d.ok) return d;
    const t = parseTimeText(src.time);
    if (!t.ok) return t;
    const date = new Date(d.y, d.mo - 1, d.d, t.h, t.mi, t.se, 0);
    const ms = date.getTime();
    if (!Number.isFinite(ms)) {
      return { ok: false, code: 'TIME_INVALID', message: '无法换算该日期，请检查输入' };
    }
    const result = ok(ms);
    result.unitSeconds = Math.floor(ms / 1000);
    result.unitMillis = ms;
    result.chosenUnit = src.unit === 'ms' ? 'ms' : 's';
    result.chosen = src.unit === 'ms' ? ms : Math.floor(ms / 1000);
    return result;
  }

  /** 当前时间（供"使用当前时间"按钮） */
  function nowParts() {
    const d = new Date();
    return {
      date: d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate()),
      time: U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) + ':' + U.pad2(d.getSeconds()),
      seconds: Math.floor(d.getTime() / 1000),
      milliseconds: d.getTime()
    };
  }

  TB.time = {
    UNITS: UNITS,
    unitInfo: unitInfo,
    timestampToDate: timestampToDate,
    dateToTimestamp: dateToTimestamp,
    parseDateText: parseDateText,
    parseTimeText: parseTimeText,
    nowParts: nowParts,
    relative: relative
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
