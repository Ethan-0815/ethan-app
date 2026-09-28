/*!
 * 工具箱 · 进制转换（纯函数）
 * 使用 BigInt，大数字不丢精度；负数、0、大小写十六进制都正确处理。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const BASES = [
    { base: 2, label: '二进制', short: 'BIN', allow: '只能包含 0 和 1', prefix: '0b' },
    { base: 8, label: '八进制', short: 'OCT', allow: '只能包含 0 ~ 7', prefix: '0o' },
    { base: 10, label: '十进制', short: 'DEC', allow: '只能包含 0 ~ 9', prefix: '' },
    { base: 16, label: '十六进制', short: 'HEX', allow: '只能包含 0 ~ 9 与 A ~ F', prefix: '0x' }
  ];

  const DIGIT_LIMIT = 1024;

  function baseInfo(base) {
    for (let i = 0; i < BASES.length; i++) if (BASES[i].base === base) return BASES[i];
    return BASES[2];
  }

  /** 校验输入是否符合目标进制 */
  function validateDigits(text, base) {
    const info = baseInfo(base);
    let s = U.str(text).trim();
    if (s === '') return { ok: false, code: 'EMPTY_INPUT', message: U.ERROR_MESSAGES.EMPTY_INPUT };
    // 全角字符容错
    s = s.replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    // 去掉常见前缀、分隔符
    let negative = false;
    if (s.charAt(0) === '-' || s.charAt(0) === '+' || s.charAt(0) === '−') {
      negative = s.charAt(0) === '-' || s.charAt(0) === '−';
      s = s.slice(1);
    }
    if (info.prefix && s.slice(0, 2).toLowerCase() === info.prefix) s = s.slice(2);
    s = s.replace(/[\s_,，]/g, '').toUpperCase();
    if (s === '') return { ok: false, code: 'EMPTY_INPUT', message: U.ERROR_MESSAGES.EMPTY_INPUT };
    if (s.length > DIGIT_LIMIT) {
      return { ok: false, code: 'RADIX_TOO_LONG', message: U.ERROR_MESSAGES.RADIX_TOO_LONG };
    }

    const patterns = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9A-F]+$/ };
    if (!patterns[base].test(s)) {
      const example = { 2: '1010', 8: '777', 10: '255', 16: 'FF' }[base];
      const guide = base === 10
        ? '要输入 FF 这类十六进制数，请先把上面的输入进制改为「十六进制」。'
        : '要输入 255 这类十进制数，请先把上面的输入进制改为「十进制」。';
      return {
        ok: false,
        code: 'RADIX_INVALID',
        message: '输入的' + info.label + '数字无效：' + info.allow + '（例如 ' + example + '）。' + guide
      };
    }
    // 前导 0 去掉，避免 BigInt 解析异常长的字符串
    s = s.replace(/^0+(?=\d)/, '');
    return { ok: true, digitString: s, negative: negative, base: base };
  }

  /**
   * 转换：输入任意进制的数字，得到四种进制的表示
   * @returns {{ok:true,negative:boolean,results:Array<{base,label,short,text}>} | {ok:false,...}}
   */
  function convert(text, fromBase) {
    const checked = validateDigits(text, fromBase);
    if (!checked.ok) return checked;

    let value;
    try {
      const body = checked.digitString;
      value = BigInt(
        checked.base === 16 ? '0x' + body
          : checked.base === 8 ? '0o' + body
            : checked.base === 2 ? '0b' + body
              : body
      );
    } catch (e) {
      return { ok: false, code: 'RADIX_INVALID', message: '输入的' + baseInfo(checked.base).label + '数字无效' };
    }

    const signed = checked.negative ? -value : value;
    const results = BASES.map(function (info) {
      let body = signed.toString(info.base);
      let neg = false;
      if (body.charAt(0) === '-') { neg = true; body = body.slice(1); }
      return {
        base: info.base,
        label: info.label,
        short: info.short,
        text: (neg ? '-' : '') + (info.base === 16 ? body.toUpperCase() : body)
      };
    });

    return {
      ok: true,
      negative: checked.negative,
      results: results,
      source: baseInfo(checked.base)
    };
  }

  TB.radix = {
    BASES: BASES,
    baseInfo: baseInfo,
    DIGIT_LIMIT: DIGIT_LIMIT,
    validateDigits: validateDigits,
    convert: convert
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
