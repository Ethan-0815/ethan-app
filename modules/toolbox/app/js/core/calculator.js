/*!
 * 工具箱 · 计算器表达式求值（纯函数）
 * 不依赖 eval / Function 构造器，手写词法分析 + 递归下降。
 * 支持：+ − × ÷ % ( ) 小数 负数 括号，以及隐式乘法（2(3+4)）。
 * 除零、语法错误都转成用户能看懂的中文提示。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const OPS = { '+': 1, '-': 1, '*': 2, '/': 2 };

  /** 词法分析：返回 token 列表 [{type:'num'|'op'|'lp'|'rp'|'pct', value}] */
  function tokenize(input) {
    const src = U.str(input)
      .replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[×✕✖]/g, '*').replace(/[÷∕]/g, '/')
      .replace(/[−–—]/g, '-').replace(/＋/g, '+')
      .replace(/\s+/g, '');
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src.charAt(i);
      if (ch >= '0' && ch <= '9' || ch === '.') {
        let j = i;
        let dots = 0;
        while (j < src.length && ((src.charAt(j) >= '0' && src.charAt(j) <= '9') || src.charAt(j) === '.')) {
          if (src.charAt(j) === '.') dots++;
          j++;
        }
        if (dots > 1) return { error: 'CALC_SYNTAX' };
        tokens.push({ type: 'num', value: Number(src.slice(i, j)) });
        i = j;
        continue;
      }
      if (OPS[ch]) { tokens.push({ type: 'op', value: ch }); i++; continue; }
      if (ch === '%') { tokens.push({ type: 'pct' }); i++; continue; }
      if (ch === '(') { tokens.push({ type: 'lp' }); i++; continue; }
      if (ch === ')') { tokens.push({ type: 'rp' }); i++; continue; }
      return { error: 'CALC_SYNTAX' };
    }
    return { tokens: tokens };
  }

  /** 递归下降求值：expr / term / unary / postfix / primary */
  function parse(tokens) {
    let pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function next() { return tokens[pos++]; }

    function parseExpr() {
      let left = parseTerm();
      if (left === null) return null;
      for (;;) {
        const t = peek();
        if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
          next();
          const right = parseTerm();
          if (right === null) return null;
          left = t.value === '+' ? left + right : left - right;
        } else break;
      }
      return U.cleanFloat(left);
    }

    function parseTerm() {
      let left = parseUnary();
      if (left === null) return null;
      for (;;) {
        const t = peek();
        if (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
          next();
          const right = parseUnary();
          if (right === null) return null;
          if (t.value === '/') {
            if (right === 0) throw U.appError('DIV_ZERO');
            left = left / right;
          } else {
            left = left * right;
          }
          left = U.cleanFloat(left);
        } else if (t && (t.type === 'num' || t.type === 'lp')) {
          // 隐式乘法：2(3+4) / 2 3
          const right = parseUnary();
          if (right === null) return null;
          left = U.cleanFloat(left * right);
        } else break;
      }
      return left;
    }

    function parseUnary() {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
        next();
        const v = parseUnary();
        if (v === null) return null;
        return t.value === '-' ? -v : v;
      }
      return parsePostfix();
    }

    function parsePostfix() {
      let v = parsePrimary();
      if (v === null) return null;
      for (;;) {
        const t = peek();
        if (t && t.type === 'pct') {
          next();
          v = v / 100;              // 百分号按"除以 100"处理：200 × 15% = 30
        } else break;
      }
      return U.cleanFloat(v);
    }

    function parsePrimary() {
      const t = next();
      if (!t) return null;
      if (t.type === 'num') return t.value;
      if (t.type === 'lp') {
        const v = parseExpr();
        if (v === null) return null;
        const close = next();
        if (!close || close.type !== 'rp') return null;
        return v;
      }
      return null;
    }

    const value = parseExpr();
    if (value === null || pos !== tokens.length) return null;
    return value;
  }

  /** 结果 → 展示文本（大数/极小数用科学计数法，绝不出现 Infinity / NaN） */
  function toText(v) {
    if (!Number.isFinite(v)) return '';
    const abs = Math.abs(v);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      return v.toExponential(9)
        .replace(/\.?0+e/, 'e')
        .replace(/e\+?(-?)(\d+)$/, function (m, sign, digits) {
          return 'e' + (sign || '') + digits;
        });
    }
    return U.formatNumber(v, 10);
  }

  /**
   * 求值
   * @returns {{ok:true, value:number, text:string} | {ok:false, code:string, message:string}}
   */
  function evaluate(expr) {
    const raw = U.str(expr).trim();
    if (raw === '') return { ok: false, code: 'EMPTY_INPUT', message: U.ERROR_MESSAGES.EMPTY_INPUT };

    const lex = tokenize(raw);
    if (lex.error) {
      return { ok: false, code: lex.error, message: U.ERROR_MESSAGES[lex.error] };
    }
    if (!lex.tokens.length) {
      return { ok: false, code: 'EMPTY_INPUT', message: U.ERROR_MESSAGES.EMPTY_INPUT };
    }

    let value;
    try {
      value = parse(lex.tokens);
    } catch (e) {
      if (e && e.code) return { ok: false, code: e.code, message: U.ERROR_MESSAGES[e.code] };
      return { ok: false, code: 'CALC_SYNTAX', message: U.ERROR_MESSAGES.CALC_SYNTAX };
    }

    if (value === null || value === undefined) {
      return { ok: false, code: 'CALC_SYNTAX', message: U.ERROR_MESSAGES.CALC_SYNTAX };
    }
    if (!Number.isFinite(value)) {
      return { ok: false, code: 'CALC_RESULT', message: U.ERROR_MESSAGES.CALC_RESULT };
    }
    const text = toText(value);
    if (text === '') return { ok: false, code: 'CALC_RESULT', message: U.ERROR_MESSAGES.CALC_RESULT };
    return { ok: true, value: value, text: text };
  }

  /* ---------------------------------------------------------------- 键盘动作 */

  const KEYPAD = [
    { id: 'clear', label: 'AC', kind: 'fn' },
    { id: 'paren', label: '( )', kind: 'fn' },
    { id: 'percent', label: '%', kind: 'fn' },
    { id: 'back', label: '⌫', kind: 'warn' },

    { id: '7', label: '7' }, { id: '8', label: '8' }, { id: '9', label: '9' },
    { id: 'div', label: '÷', kind: 'fn' },

    { id: '4', label: '4' }, { id: '5', label: '5' }, { id: '6', label: '6' },
    { id: 'mul', label: '×', kind: 'fn' },

    { id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' },
    { id: 'sub', label: '−', kind: 'fn' },

    { id: 'sign', label: '±', kind: 'fn' }, { id: '0', label: '0' }, { id: 'dot', label: '.' },
    { id: 'add', label: '+', kind: 'fn' },

    { id: 'eq', label: '=', kind: 'eq wide' }
  ];

  /**
   * 把按键动作应用到表达式字符串上（纯函数，便于测试）
   * @returns {string} 新的表达式
   */
  function applyKey(expr, keyId) {
    const s = U.str(expr);
    const last = s.charAt(s.length - 1);
    // 中缀运算符：连续按下会相互替换
    const isInfix = function (c) { return c === '+' || c === '-' || c === '*' || c === '/'; };
    // 百分号是"后缀"，可以紧跟数字，也可以继续接运算符（5% × 200）
    const isOpLike = function (c) { return isInfix(c) || c === '%'; };
    const map = { add: '+', sub: '-', mul: '*', div: '/', percent: '%', dot: '.', paren: '(' };

    switch (keyId) {
      case 'clear':
        return '';
      case 'back':
        return s.slice(0, -1);
      case 'paren':
        // 自动配对：左括号多于右括号 → 补右括号，否则加左括号
        {
          let open = 0;
          for (let i = 0; i < s.length; i++) {
            if (s.charAt(i) === '(') open++;
            else if (s.charAt(i) === ')') open--;
          }
          if (open > 0 && !isOpLike(last) && last !== '' && last !== '(') return s + ')';
          return s + '(';
        }
      case 'sign':
        if (s === '') return '-';
        if (s.charAt(0) === '-') return s.slice(1);
        return '-' + s;
      case 'dot':
        // 同一个数字里不重复出现小数点
        {
          let cut = s.length;
          while (cut > 0 && /[0-9.]/.test(s.charAt(cut - 1))) cut--;
          if (s.slice(cut).indexOf('.') >= 0) return s;
          if (cut === s.length) {
            // 前一个字符不是数字 → 补 0
            return s + (s === '' || isOpLike(last) || last === '(' ? '0.' : '.');
          }
          return s + '.';
        }
      default: break;
    }

    if (map[keyId]) {
      const c = map[keyId];
      if (c === '(') return s + '(';
      if (s === '' && (c === '+' || c === '*' || c === '/' || c === '%')) return s;
      if (isInfix(c) && isInfix(last)) return s.slice(0, -1) + c;   // 连续中缀运算符 → 替换
      return s + c;
    }

    // 数字
    if (/^[0-9]$/.test(keyId)) {
      const tail = /(\d+)$/.exec(s);
      if (tail && /^0+$/.test(tail[0])) {
        // 末尾是 0（或一长串 0）：再按 0 不追加，按真实数字则替换掉这个 0
        if (keyId === '0') return s;
        return s.slice(0, s.length - tail[0].length) + keyId;
      }
      return s + keyId;
    }
    return s;
  }

  TB.calc = {
    tokenize: tokenize,
    evaluate: evaluate,
    toText: toText,
    applyKey: applyKey,
    KEYPAD: KEYPAD
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
