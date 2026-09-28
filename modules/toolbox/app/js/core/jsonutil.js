/*!
 * 工具箱 · JSON 处理（纯函数）
 * 美化 / 压缩 / 校验，错误信息尽量给出"第几行第几列"和常见原因，而不是只丢一个 Error。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  /** 位置 → 行号/列号（都从 1 开始） */
  function locate(text, position) {
    const src = U.str(text);
    const pos = Math.max(0, Math.min(src.length, position));
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < pos; i++) {
      if (src.charAt(i) === '\n') { line++; lineStart = i + 1; }
    }
    return {
      line: line,
      column: pos - lineStart + 1,
      lineText: (src.split(/\r?\n/)[line - 1] || '').slice(0, 200)
    };
  }

  const KNOWN = [
    { re: /Unexpected end of JSON input/i, cn: '内容不完整，结尾可能缺少 } 或 ]' },
    { re: /Unterminated string/i, cn: '有字符串没有正确闭合（缺少结尾的双引号）' },
    { re: /Bad control character/i, cn: '字符串里含有不允许的控制字符（例如未转义的换行）' },
    { re: /Bad escaped character|Bad Unicode escape/i, cn: '转义字符不合法（反斜杠后的写法有问题）' },
    { re: /Expected double-quoted property name/i, cn: '属性名必须使用双引号包裹，例如 "name"' },
    { re: /Expected property name or '\}'/i, cn: '这里应该是一个属性名（双引号包裹）或者 }' },
    { re: /Expected ':' after property name/i, cn: '属性名后面缺少冒号 :' },
    { re: /Expected ',' or '\}' after property value/i, cn: '属性值后面缺少逗号 , 或 }' },
    { re: /Expected ',' or '\]' after array element/i, cn: '数组元素后面缺少逗号 , 或 ]' },
    { re: /Unexpected non-whitespace character after JSON/i, cn: 'JSON 内容结束后还有多余字符' },
    { re: /Unexpected token '?'/i, cn: '出现了意料之外的字符（常见原因：使用了中文标点或单引号）' },
    { re: /Unexpected token/i, cn: '出现了意料之外的字符（常见原因：单引号、多余的逗号或缺少引号）' }
  ];

  function translate(raw, token) {
    if (token === ',') return '多了一个逗号：JSON 里最后一个属性或元素后面不能带逗号';
    if (token === "'") return 'JSON 必须使用双引号，不能用单引号包裹';
    if (token === '}') return '这里多了一个 }（或缺少一个属性）';
    if (token === ']') return '这里多了一个 ]（或缺少一个数组元素）';
    for (let i = 0; i < KNOWN.length; i++) {
      if (KNOWN[i].re.test(raw)) return KNOWN[i].cn;
    }
    return '格式不符合 JSON 规范';
  }

  /** 去掉所有空白，同时记录每个字符在原文中的下标 */
  function compactWithMap(text) {
    let out = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (/\s/.test(ch)) continue;
      out += ch;
      map.push(i);
    }
    return { out: out, map: map };
  }

  /** 用"忽略空白差异"的方式在原文里找到报错片段的起始下标 */
  function findSnippet(text, snippet) {
    const a = compactWithMap(text);
    const b = compactWithMap(snippet);
    if (!b.out) return -1;
    const idx = a.out.indexOf(b.out);
    if (idx < 0) return -1;
    return a.map[idx];
  }

  /** 从原生异常里提取位置信息 */
  function positionOf(raw, text, token) {
    let m = /\(line (\d+) column (\d+)\)/i.exec(raw);
    if (m) {
      const line = Number(m[1]);
      return { line: line, column: Number(m[2]), lineText: (U.str(text).split(/\r?\n/)[line - 1] || '').slice(0, 200) };
    }
    m = /position (\d+)/i.exec(raw);
    if (m) return locate(text, Number(m[1]));

    // 新版 V8：Unexpected token 'X', ..."片段"... is not valid JSON（不含 position）
    m = /Unexpected token '([^']*)'[\s\S]*?\.\.\.([\s\S]*?)\.\.\.[\s\S]*is not valid JSON/.exec(raw);
    if (m) {
      const tok = m[1];
      const raw2 = m[2];
      const candidates = [raw2, raw2.replace(/^"/, ''), raw2.replace(/"$/, ''), raw2.replace(/^"|"$/g, '')];
      let start = -1;
      for (let i = 0; i < candidates.length && start < 0; i++) start = findSnippet(text, candidates[i]);
      if (start >= 0) {
        // 片段本身可能有偏移，优先把指针落在片段附近最后一个出错字符上
        if (tok) {
          const end = Math.min(text.length, start + raw2.length + 60);
          const at = text.lastIndexOf(tok, end);
          if (at >= start) return locate(text, at);
        }
        return locate(text, start);
      }
    }
    return { line: 0, column: 0, lineText: '' };
  }

  /**
   * 解析 JSON
   * @returns {{ok:true,value:*,type:string} | {ok:false,code:string,message:string,detail:string,line:number,column:number,lineText:string}}
   */
  function parse(text) {
    const src = U.str(text);
    if (src.trim() === '') {
      return { ok: false, code: 'JSON_EMPTY', message: U.ERROR_MESSAGES.JSON_EMPTY, detail: '', line: 0, column: 0, lineText: '' };
    }
    try {
      const value = JSON.parse(src);
      return { ok: true, value: value, type: typeName(value) };
    } catch (e) {
      const raw = U.str(e && e.message);
      const tokenMatch = /Unexpected token '([^']*)'/.exec(raw);
      const token = tokenMatch ? tokenMatch[1] : '';
      const pos = positionOf(raw, src, token);
      const cn = translate(raw, token);
      const where = pos.line > 0 ? '（第 ' + pos.line + ' 行第 ' + pos.column + ' 列附近）' : '';
      return {
        ok: false,
        code: 'JSON_BROKEN',
        message: 'JSON 格式有误：' + cn + where,
        detail: cn,
        line: pos.line,
        column: pos.column,
        lineText: pos.lineText
      };
    }
  }

  function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '数组';
    const t = typeof value;
    if (t === 'object') return '对象';
    if (t === 'string') return '字符串';
    if (t === 'number') return '数字';
    if (t === 'boolean') return '布尔值';
    return t;
  }

  /** 美化：默认 2 空格缩进 */
  function beautify(text, indent) {
    const parsed = parse(text);
    if (!parsed.ok) return parsed;
    const space = U.clamp(Number.isFinite(indent) ? indent : 2, 0, 8);
    try {
      return { ok: true, text: JSON.stringify(parsed.value, null, space), value: parsed.value, type: parsed.type };
    } catch (e) {
      return { ok: false, code: 'JSON_BROKEN', message: U.ERROR_MESSAGES.JSON_BROKEN, detail: '', line: 0, column: 0, lineText: '' };
    }
  }

  /** 压缩成一行 */
  function minify(text) {
    const parsed = parse(text);
    if (!parsed.ok) return parsed;
    try {
      return { ok: true, text: JSON.stringify(parsed.value), value: parsed.value, type: parsed.type };
    } catch (e) {
      return { ok: false, code: 'JSON_BROKEN', message: U.ERROR_MESSAGES.JSON_BROKEN, detail: '', line: 0, column: 0, lineText: '' };
    }
  }

  /** 结构概览：类型 / 节点数 / 顶层键 / 嵌套层数（最外层算第 0 层） */
  function describe(value) {
    let nodes = 0;
    let depth = 0;
    let keys = 0;

    (function walk(node, level) {
      nodes++;
      if (level > depth) depth = level;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i], level + 1);
        return;
      }
      if (node && typeof node === 'object') {
        const list = Object.keys(node);
        keys += list.length;
        for (let i = 0; i < list.length; i++) walk(node[list[i]], level + 1);
      }
    })(value, 0);

    const topKeys = (value && typeof value === 'object' && !Array.isArray(value)) ? Object.keys(value).slice(0, 8) : [];
    return {
      type: typeName(value),
      nodes: nodes,
      keys: keys,
      depth: depth,
      length: Array.isArray(value) ? value.length : null,
      topKeys: topKeys
    };
  }

  /** 校验：只返回结论与错误位置 */
  function validate(text) {
    const r = parse(text);
    if (!r.ok) return r;
    return { ok: true, value: r.value, type: r.type, summary: describe(r.value) };
  }

  TB.jsonutil = {
    parse: parse,
    validate: validate,
    beautify: beautify,
    minify: minify,
    describe: describe,
    locate: locate,
    typeName: typeName
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
