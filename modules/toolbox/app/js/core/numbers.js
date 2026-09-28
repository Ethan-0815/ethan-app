/*!
 * 工具箱 · 计算类纯逻辑
 * 折扣 / 百分比三模式 / 文件体积换算 / 随机数与随机选择
 * 全部为纯函数，随机源统一走 util.randomBelow（优先安全随机）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  function fail(code, message) {
    return { ok: false, code: code, message: message || U.ERROR_MESSAGES[code] };
  }

  /* ---------------------------------------------------------------- 折扣计算 */

  /**
   * 解析折扣输入（单位：折）
   * 接受 "7.5"、"7.5折"、"7.5 折"；百分比写法给出明确提示，避免歧义
   */
  function parseDiscount(text) {
    const raw = U.str(text).trim();
    if (raw === '') return fail('EMPTY_INPUT');
    if (raw.indexOf('%') >= 0) {
      return fail('INVALID_NUMBER', '折扣请填「折」，例如 7.5 表示七五折');
    }
    const cleaned = raw.replace(/[折]\s*$/, '').trim();
    const v = U.parseNum(cleaned);
    if (v === null) return fail('INVALID_NUMBER');
    if (v <= 0) return fail('INVALID_NUMBER', '折扣需要大于 0');
    return { ok: true, value: v };
  }

  /**
   * 折扣计算
   * @param {{price:string|number, discount:string|number}} input
   */
  function discount(input) {
    const src = input || {};
    const price = U.parseNum(src.price);
    if (U.str(src.price).trim() === '') return fail('EMPTY_INPUT', '请输入原价');
    if (price === null) return fail('INVALID_NUMBER', '请输入有效的原价');
    if (price < 0) return fail('INVALID_NUMBER', '原价不能是负数');

    const d = parseDiscount(src.discount);
    if (!d.ok) return d;

    const final = U.cleanFloat(price * d.value / 10);
    const saved = U.cleanFloat(price - final);
    const percent = U.cleanFloat((1 - d.value / 10) * 100);

    return {
      ok: true,
      price: price,
      discount: d.value,
      final: U.roundTo(final, 2),
      saved: U.roundTo(saved, 2),
      percentOff: U.roundTo(percent, 2),
      higher: d.value > 10
    };
  }

  /* ---------------------------------------------------------------- 百分比 */

  /** 模式 1：求一个数的百分之多少 */
  function percentOf(numberText, percentText) {
    if (U.str(numberText).trim() === '' || U.str(percentText).trim() === '') return fail('EMPTY_INPUT');
    const n = U.parseNum(numberText);
    if (n === null) return fail('INVALID_NUMBER', '请输入有效的数字');
    const p = U.parseNum(U.str(percentText).replace(/%/g, ''));
    if (p === null) return fail('INVALID_NUMBER', '请输入有效的百分比');
    const value = U.cleanFloat(n * p / 100);
    return { ok: true, value: U.roundTo(value, 6), number: n, percent: p };
  }

  /** 模式 2：求百分比变化（新数相对原数的变化） */
  function percentChange(oldText, newText) {
    if (U.str(oldText).trim() === '' || U.str(newText).trim() === '') return fail('EMPTY_INPUT');
    const a = U.parseNum(oldText);
    if (a === null) return fail('INVALID_NUMBER', '请输入有效的原数');
    const b = U.parseNum(newText);
    if (b === null) return fail('INVALID_NUMBER', '请输入有效的新数');
    if (a === 0) return fail('DIV_ZERO', '原数不能为 0，无法计算变化比例');
    const diff = U.cleanFloat(b - a);
    const pct = U.cleanFloat(diff / Math.abs(a) * 100);
    return {
      ok: true,
      value: U.roundTo(pct, 4),
      diff: U.roundTo(diff, 6),
      old: a,
      now: b,
      direction: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'same')
    };
  }

  /** 模式 3：求一个数占另一个数的百分比 */
  function percentRatio(partText, wholeText) {
    if (U.str(partText).trim() === '' || U.str(wholeText).trim() === '') return fail('EMPTY_INPUT');
    const a = U.parseNum(partText);
    if (a === null) return fail('INVALID_NUMBER', '请输入有效的数字');
    const b = U.parseNum(wholeText);
    if (b === null) return fail('INVALID_NUMBER', '请输入有效的总数');
    if (b === 0) return fail('DIV_ZERO', '总数不能为 0');
    const pct = U.cleanFloat(a / b * 100);
    return { ok: true, value: U.roundTo(pct, 4), part: a, whole: b };
  }

  /* ---------------------------------------------------------------- 文件体积换算 */

  /** 体积换算：把 value + 单位序号 换成所有单位的值 */
  function convertBytes(valueText, unitIndex, binary) {
    if (U.str(valueText).trim() === '') return fail('EMPTY_INPUT', '请输入数值');
    const n = U.parseNum(valueText);
    if (n === null) return fail('INVALID_NUMBER');
    if (n < 0) return fail('INVALID_NUMBER', '数值不能是负数');
    const step = binary ? 1024 : 1000;
    const units = binary ? U.BYTE_UNITS_BIN : U.BYTE_UNITS_DEC;
    const bytes = n * Math.pow(step, U.clamp(unitIndex, 0, 5));
    const results = units.map(function (label, i) {
      const v = bytes / Math.pow(step, i);
      return { label: label, value: v, text: U.formatNumber(U.roundTo(v, 8), 8) };
    });
    return { ok: true, bytes: bytes, bytesText: U.formatBytes(bytes, binary), results: results };
  }

  /* ---------------------------------------------------------------- 随机数 */

  /**
   * 随机数
   * @param {{min:string|number, max:string|number, decimals:number, integer:boolean}} opts
   */
  function randomNumber(opts) {
    const o = opts || {};
    if (U.str(o.min).trim() === '' || U.str(o.max).trim() === '') return fail('EMPTY_INPUT', '请输入最小值和最大值');
    const min = U.parseNum(o.min);
    const max = U.parseNum(o.max);
    if (min === null) return fail('INVALID_NUMBER', '最小值需要是有效数字');
    if (max === null) return fail('INVALID_NUMBER', '最大值需要是有效数字');
    if (min > max) return fail('RANGE_INVALID');

    const integer = o.integer !== false;
    const decimals = U.clamp(Number.isFinite(o.decimals) ? Math.round(o.decimals) : 2, 0, 8);

    if (integer && Number.isInteger(min) && Number.isInteger(max)) {
      const span = max - min + 1;
      if (span > 4294967295) return fail('RANGE_INVALID', '区间过大，请缩小范围');
      const value = min + U.randomBelow(span);
      return { ok: true, value: value, text: String(value), integer: true };
    }

    // 小数（或整数模式下端点带小数）：用两个 32 位随机数拼 53 位精度
    const frac = U.randomBelow(4294967296) / 4294967296;
    const frac2 = U.randomBelow(2097152) / 2097152;
    const r = (frac + frac2) / 2;
    let value = min + r * (max - min);
    value = U.roundTo(value, integer ? 0 : decimals);
    value = U.clamp(value, min, max);
    return {
      ok: true,
      value: value,
      text: integer ? U.formatNumber(value, 0) : U.formatNumber(value, decimals === 0 ? 0 : decimals),
      integer: false
    };
  }

  /* ---------------------------------------------------------------- 随机选择 */

  /** 解析多行选项：去掉空行与首尾空格，保留原顺序 */
  function parseOptions(text) {
    return U.str(text)
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line !== ''; });
  }

  /** 从 total 个下标里不重复地抽 count 个（部分洗牌） */
  function sampleIndices(total, count, randBelow) {
    const rand = randBelow || U.randomBelow;
    const n = Math.max(0, Math.min(Math.floor(total), Math.floor(count)));
    const pool = [];
    for (let i = 0; i < total; i++) pool.push(i);
    const picked = [];
    for (let i = 0; i < n; i++) {
      const j = i + rand(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      picked.push(pool[i]);
    }
    return picked;
  }

  /**
   * 随机选择
   * @param {{options:string[]|string, count:number, exclude:number[]}} input
   *   options 可以是已解析的数组，也可以是多行文本
   *   exclude 为"不重复抽取"模式下已经抽过的下标
   */
  function pick(input) {
    const src = input || {};
    const options = Array.isArray(src.options) ? src.options : parseOptions(src.options);
    if (options.length < 2) return fail('OPTIONS_TOO_FEW');
    const exclude = Array.isArray(src.exclude) ? src.exclude : [];
    const excluded = {};
    exclude.forEach(function (i) { excluded[i] = true; });

    const pool = [];
    for (let i = 0; i < options.length; i++) if (!excluded[i]) pool.push(i);
    if (!pool.length) return fail('OPTIONS_TOO_FEW', '所有选项都已经抽取过了');

    let count = Math.floor(U.parseNum(src.count) === null ? 1 : U.parseNum(src.count));
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > pool.length) count = pool.length;

    const pickedIdx = sampleIndices(pool.length, count).map(function (p) { return pool[p]; });
    return {
      ok: true,
      items: pickedIdx.map(function (i) { return { index: i, text: options[i] }; }),
      indices: pickedIdx,
      remaining: pool.length - pickedIdx.length,
      total: options.length
    };
  }

  TB.numbers = {
    parseDiscount: parseDiscount,
    discount: discount,
    percentOf: percentOf,
    percentChange: percentChange,
    percentRatio: percentRatio,
    convertBytes: convertBytes,
    randomNumber: randomNumber,
    parseOptions: parseOptions,
    sampleIndices: sampleIndices,
    pick: pick
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
