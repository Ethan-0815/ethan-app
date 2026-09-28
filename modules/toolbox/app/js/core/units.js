/*!
 * 工具箱 · 单位换算（纯函数）
 * 只保留日常真正会用到的单位，不做专业单位库。
 * 每个分类内以"基准单位"换算，温度单独处理（不是简单的倍率关系）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const CATEGORIES = [
    {
      id: 'length',
      label: '长度',
      emoji: '📏',
      base: 'm',
      units: [
        { id: 'mm', label: '毫米', short: 'mm', factor: 0.001 },
        { id: 'cm', label: '厘米', short: 'cm', factor: 0.01 },
        { id: 'm', label: '米', short: 'm', factor: 1 },
        { id: 'km', label: '千米', short: 'km', factor: 1000 }
      ]
    },
    {
      id: 'weight',
      label: '重量',
      emoji: '⚖️',
      base: 'kg',
      units: [
        { id: 'g', label: '克', short: 'g', factor: 0.001 },
        { id: 'kg', label: '千克', short: 'kg', factor: 1 },
        { id: 't', label: '吨', short: 't', factor: 1000 }
      ]
    },
    {
      id: 'temperature',
      label: '温度',
      emoji: '🌡️',
      base: 'c',
      special: true,
      units: [
        { id: 'c', label: '摄氏度', short: '°C' },
        { id: 'f', label: '华氏度', short: '°F' }
      ]
    },
    {
      id: 'area',
      label: '面积',
      emoji: '🔲',
      base: 'm2',
      units: [
        { id: 'cm2', label: '平方厘米', short: 'cm²', factor: 0.0001 },
        { id: 'm2', label: '平方米', short: 'm²', factor: 1 },
        { id: 'km2', label: '平方千米', short: 'km²', factor: 1000000 }
      ]
    },
    {
      id: 'volume',
      label: '容量',
      emoji: '🧴',
      base: 'l',
      units: [
        { id: 'ml', label: '毫升', short: 'mL', factor: 0.001 },
        { id: 'l', label: '升', short: 'L', factor: 1 }
      ]
    },
    {
      id: 'speed',
      label: '速度',
      emoji: '🚀',
      base: 'mps',
      units: [
        { id: 'mps', label: '米/秒', short: 'm/s', factor: 1 },
        { id: 'kmh', label: '千米/小时', short: 'km/h', factor: 1 / 3.6 }
      ]
    }
  ];

  function category(id) {
    for (let i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[0];
  }

  function unitOf(cat, unitId) {
    for (let i = 0; i < cat.units.length; i++) if (cat.units[i].id === unitId) return cat.units[i];
    return cat.units[0];
  }

  function convertTemperature(from, to, value) {
    if (from === to) return value;
    if (from === 'c' && to === 'f') return value * 9 / 5 + 32;
    if (from === 'f' && to === 'c') return (value - 32) * 5 / 9;
    return null;
  }

  /**
   * 换算
   * @returns {{ok:true,value:number,text:string,unit:string} | {ok:false,code:string,message:string}}
   */
  function convert(categoryId, fromId, toId, rawValue) {
    const cat = category(categoryId);
    const value = U.parseNum(rawValue);
    if (value === null) {
      return { ok: false, code: 'INVALID_NUMBER', message: U.ERROR_MESSAGES.INVALID_NUMBER };
    }
    const from = unitOf(cat, fromId);
    const to = unitOf(cat, toId);

    let out;
    if (cat.special) {
      out = convertTemperature(from.id, to.id, value);
    } else {
      out = value * from.factor / to.factor;
    }
    if (out === null || !Number.isFinite(out)) {
      return { ok: false, code: 'UNKNOWN', message: U.ERROR_MESSAGES.UNKNOWN };
    }
    const clean = U.cleanFloat(out);
    return {
      ok: true,
      value: clean,
      text: formatResult(clean),
      unit: to.short
    };
  }

  /** 结果文本：整数不带小数点，大数用科学计数法，最多保留 6 位小数 */
  function formatResult(v) {
    if (!Number.isFinite(v)) return '';
    const abs = Math.abs(v);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-7)) {
      return v.toExponential(6).replace(/\.?0+e/, 'e');
    }
    return U.formatNumber(v, 6);
  }

  TB.units = {
    CATEGORIES: CATEGORIES,
    category: category,
    unitOf: unitOf,
    convert: convert,
    formatResult: formatResult
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
