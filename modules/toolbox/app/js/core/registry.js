/*!
 * 工具箱 · 工具注册表与搜索（纯函数）
 * V0.1 一共 13 个工具，新增工具只需在这里加一条记录 + 一个页面模块，互不影响。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const CATEGORIES = [
    { id: 'image', label: '图片', emoji: '📷', desc: '压缩、格式转换与 PDF' },
    { id: 'calc', label: '计算', emoji: '🧮', desc: '日常算数、换算与随机' },
    { id: 'dev', label: '开发 / 电脑', emoji: '💻', desc: '文本与数据格式处理' }
  ];

  const TOOLS = [
    {
      id: 'img-compress', name: '图片压缩', desc: '减小图片体积，可调压缩质量',
      emoji: '🗜️', category: 'image',
      keywords: ['图片', '压缩', '压缩图片', '体积', '瘦身', 'compress', 'image', 'jpg', 'jpeg', 'png', 'webp', '大小']
    },
    {
      id: 'img-convert', name: '图片格式转换', desc: 'JPG / PNG / WebP 互转',
      emoji: '🔄', category: 'image',
      keywords: ['图片', '格式', '转换', '格式转换', 'jpg', 'jpeg', 'png', 'webp', 'convert', 'image', '透明', '背景']
    },
    {
      id: 'img-pdf', name: '图片转 PDF', desc: '一张或多张图片合成 PDF',
      emoji: '📄', category: 'image',
      keywords: ['图片', 'pdf', '合并', '合成', '转pdf', 'image', '多张', '排序', 'a4']
    },
    {
      id: 'calc', name: '计算器', desc: '快速进行日常计算',
      emoji: '🧮', category: 'calc',
      keywords: ['计算', '计算器', '加', '减', '乘', '除', '括号', '百分号', 'calc', 'calculator', '算数']
    },
    {
      id: 'discount', name: '折扣计算', desc: '算折后价与省了多少钱',
      emoji: '🏷️', category: 'calc',
      keywords: ['折扣', '打折', '折后价', '优惠', '省', '原价', 'discount', '打折计算', '七折']
    },
    {
      id: 'percent', name: '百分比计算', desc: '求占比、求变化、求百分之几',
      emoji: '％', category: 'calc',
      keywords: ['百分比', '百分数', '占比', '比例', '变化', '涨', '跌', '百分', 'percent', 'percentage', '%']
    },
    {
      id: 'units', name: '单位换算', desc: '长度 / 重量 / 温度等常用单位',
      emoji: '📏', category: 'calc',
      keywords: ['单位', '换算', '长度', '重量', '温度', '面积', '容量', '速度', '厘米', '米', '千克', 'unit', 'convert']
    },
    {
      id: 'filesize', name: '文件大小换算', desc: 'B / KB / MB / GB / TB 互转',
      emoji: '💾', category: 'calc',
      keywords: ['文件', '大小', '体积', '存储', '字节', 'gb', 'mb', 'kb', 'tb', 'filesize', '数据量', '1024']
    },
    {
      id: 'random', name: '随机数 / 随机选择', desc: '抽数字、抽选项、不重复抽取',
      emoji: '🎲', category: 'calc',
      keywords: ['随机', '随机数', '抽签', '抽奖', '选择', '骰子', '点名', 'random', '抽', '不重复']
    },
    {
      id: 'json', name: 'JSON 格式化', desc: '美化、压缩与格式检查',
      emoji: '🧩', category: 'dev',
      keywords: ['json', '格式化', '美化', '压缩', '校验', '检查', 'beautify', '格式化json', '报错']
    },
    {
      id: 'radix', name: '进制转换', desc: '二进制 / 八进制 / 十进制 / 十六进制',
      emoji: '🔢', category: 'dev',
      keywords: ['进制', '二进制', '八进制', '十进制', '十六进制', 'hex', 'bin', 'radix', '255', 'ff']
    },
    {
      id: 'uuid', name: 'UUID 生成', desc: '批量生成 UUID v4',
      emoji: '🆔', category: 'dev',
      keywords: ['uuid', 'guid', '唯一', '标识', 'id', '生成', '批量', '编号']
    },
    {
      id: 'timestamp', name: '时间戳转换', desc: '时间戳与日期时间互转',
      emoji: '🕒', category: 'dev',
      keywords: ['时间戳', 'timestamp', 'unix', '日期', '时间', '秒', '毫秒', '时区', '转换']
    }
  ];

  function all() { return TOOLS.slice(); }

  function get(id) {
    for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i];
    return null;
  }

  function byCategory(categoryId) {
    return TOOLS.filter(function (t) { return t.category === categoryId; });
  }

  function normalize(text) {
    return U.str(text)
      .toLowerCase()
      .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s\-_/·、，。,.]+/g, '');
  }

  /** 子序列匹配：query 的字符按顺序出现在 target 中（用于简写，如 jsonfmt） */
  function subsequence(target, query) {
    if (!query) return false;
    let i = 0;
    for (let j = 0; j < target.length && i < query.length; j++) {
      if (target.charAt(j) === query.charAt(i)) i++;
    }
    return i === query.length;
  }

  /** 计算单个工具的匹配得分，越大越匹配；0 表示不匹配 */
  function score(tool, query) {
    const q = normalize(query);
    if (!q) return 0;
    const name = normalize(tool.name);
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 92;
    if (name.indexOf(q) > 0) return 84;
    for (let i = 0; i < tool.keywords.length; i++) {
      const k = normalize(tool.keywords[i]);
      if (k === q) return 78;
      if (k.indexOf(q) === 0) return 70;
      if (k.indexOf(q) > 0) return 62;
    }
    const desc = normalize(tool.desc);
    if (desc.indexOf(q) >= 0) return 46;
    for (let i = 0; i < tool.keywords.length; i++) {
      if (subsequence(normalize(tool.keywords[i]), q)) return 34;
    }
    if (name.length > 3 && subsequence(name, q)) return 28;
    return 0;
  }

  /** 搜索工具：返回按匹配度排序的列表 */
  function search(query) {
    const q = normalize(query);
    if (q === '') return all();
    const scored = [];
    TOOLS.forEach(function (tool) {
      const s = score(tool, query);
      if (s > 0) scored.push({ tool: tool, score: s });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (item) { return item.tool; });
  }

  function count() { return TOOLS.length; }

  TB.registry = {
    CATEGORIES: CATEGORIES,
    TOOLS: TOOLS,
    all: all,
    get: get,
    byCategory: byCategory,
    search: search,
    normalize: normalize,
    score: score,
    count: count
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
