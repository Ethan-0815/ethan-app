/*!
 * 工具箱 · 逻辑单元测试（Node，无需浏览器）
 *   node tests/run-tests.mjs
 *
 * 原理：核心层是 IIFE + 全局命名空间（不使用 ES module），
 *      因此同一份源码既能跑在浏览器里，也能被 Node 用 vm.runInThisContext 直接加载，
 *      不需要任何构建步骤或打包器。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SCRIPTS = [
  'app/js/core/util.js',
  'app/js/core/calculator.js',
  'app/js/core/units.js',
  'app/js/core/numbers.js',
  'app/js/core/jsonutil.js',
  'app/js/core/radix.js',
  'app/js/core/timestamp.js',
  'app/js/core/registry.js',
  'app/js/platform/pdf.js',
  'app/js/platform/recent.js'
];

for (const rel of SCRIPTS) {
  const file = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: rel });
}

const TB = globalThis.TB;
const U = TB.util;

/* ---------------------------------------------------------------- 断言框架 */

let passed = 0;
const failures = [];
let group = '';

async function describe(name, fn) {
  group = name;
  console.log('\n' + name);
  await fn();
}

function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failures.push(group + ' → ' + name + (extra ? '  [' + extra + ']' : ''));
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, a + ' ≠ ' + e);
}

function noBadText(name, text) {
  const bad = /NaN|Infinity|undefined|null|\[object Object\]/.test(String(text));
  ok(name + '（不出现 NaN/Infinity/undefined）', !bad, String(text).slice(0, 90));
}

/* ================================================================ 基础工具 */

await describe('基础工具 util', () => {
  eq('parseNum 支持千分位', U.parseNum('1,234'), 1234);
  eq('parseNum 支持前后空格', U.parseNum('  3.5  '), 3.5);
  eq('parseNum 支持全角数字', U.parseNum('１２３'), 123);
  eq('parseNum 支持负号与货币符号', U.parseNum('￥-88'), -88);
  eq('parseNum 拒绝夹杂字母', U.parseNum('12abc'), null);
  eq('parseNum 拒绝空字符串', U.parseNum(''), null);
  eq('parseNum 拒绝只有小数点', U.parseNum('.'), null);
  eq('parseNum 处理非法数字类型', U.parseNum(NaN), null);
  eq('parseNum 处理 Infinity', U.parseNum(Infinity), null);
  eq('parseNum 科学计数法', U.parseNum('1e3'), 1000);

  eq('trimOrNull 空串转 null', U.trimOrNull('   '), null);
  eq('trimOrNull 去空格', U.trimOrNull('  a '), 'a');

  eq('cleanFloat 修正 0.1+0.2', U.cleanFloat(0.1 + 0.2), 0.3);
  eq('roundTo 两位小数', U.roundTo(224.25000000000003, 2), 224.25);

  eq('formatNumber 千分位', U.formatNumber(1234567.891, 3), '1,234,567.891');
  eq('formatNumber 去掉尾随零', U.formatNumber(1.5, 4), '1.5');
  eq('formatNumber 处理 NaN', U.formatNumber(NaN, 2), '');
  eq('formatNumber 处理 Infinity', U.formatNumber(Infinity, 2), '');
  eq('formatFixed 固定两位', U.formatFixed(224.25, 2), '224.25');
  eq('formatFixed 千分位与两位小数', U.formatFixed(12345.6, 2), '12,345.60');

  eq('formatBytes 十进制 1.5MB', U.formatBytes(1500000, false), '1.5 MB');
  eq('formatBytes 1024 进制', U.formatBytes(1500000, true), '1.43 MiB');
  eq('formatBytes 小于 1000 字节', U.formatBytes(999, false), '999 B');
  eq('formatBytes 非法输入', U.formatBytes(-1, false), '—');
  noBadText('formatBytes 不产生异常文字', U.formatBytes(NaN, false));

  ok('timezoneLabel 形如 UTC+08:00', /^UTC[+-]\d{2}:\d{2}$/.test(U.timezoneLabel(new Date())));

  const id1 = U.uuidV4();
  const id2 = U.uuidV4();
  ok('uuidV4 符合标准格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1), id1);
  ok('uuidV4 每次不同', id1 !== id2);
  const set = new Set();
  for (let i = 0; i < 2000; i++) set.add(U.uuidV4());
  eq('uuidV4 2000 次无重复', set.size, 2000);

  let inRange = true;
  for (let i = 0; i < 500; i++) {
    const v = U.randomBelow(7);
    if (v < 0 || v > 6 || !Number.isInteger(v)) inRange = false;
  }
  ok('randomBelow 结果落在区间内', inRange);
  eq('randomBelow(0) 安全返回 0', U.randomBelow(0), 0);

  ok('friendly 翻译业务错误码', TB.friendly(TB.appError('DIV_ZERO')) === '不能除以 0');
  ok('friendly 翻译未知异常', TB.friendly(new Error('boom')).length > 0);
  ok('friendly 处理空值', TB.friendly(null).length > 0);

  ok('新增的文件相关错误提示都已定义',
    ['FILE_READ_FAIL', 'FILE_TOO_BIG', 'FILE_EMPTY'].every(function (k) { return !!U.ERROR_MESSAGES[k]; }));
  eq('safeFileName 去掉非法字符', U.safeFileName('a/b:c*?.png', 'x.png'), 'a_b_c__.png');
  eq('baseName 去扩展名', U.baseName('照片.压缩.jpg'), '照片.压缩');
  eq('extOf 取扩展名', U.extOf('A.PNG'), 'png');
});

/* ================================================================ 计算器 */

await describe('计算器 TB.calc', () => {
  const ev = (e) => TB.calc.evaluate(e);

  eq('整数乘法 125 × 3.5', ev('125*3.5').text, '437.5');
  eq('带括号的运算', ev('(1+2)*3').value, 9);
  eq('嵌套括号', ev('((2+3)*(4-1))').value, 15);
  eq('负数参与运算', ev('-5+3').value, -2);
  eq('连续负号', ev('--5').value, 5);
  eq('隐式乘法 2(3+4)', ev('2(3+4)').value, 14);
  eq('百分号按除以 100：200 × 15%', ev('200*15%').value, 30);
  eq('小数点运算', ev('0.1+0.2').text, '0.3');
  eq('小数除法', ev('7/2').value, 3.5);
  eq('除以 0 给出中文提示', ev('1/0').message, '不能除以 0');
  eq('除以 0 的错误码', ev('1/0').code, 'DIV_ZERO');
  eq('除以 0 的括号形式', ev('1/(2-2)').code, 'DIV_ZERO');
  eq('空表达式提示', ev('').code, 'EMPTY_INPUT');
  eq('只有运算符 → 语法错误', ev('2+').code, 'CALC_SYNTAX');
  eq('不匹配的括号 → 语法错误', ev('(1+2').code, 'CALC_SYNTAX');
  eq('非法字符 → 语法错误', ev('1+abc').code, 'CALC_SYNTAX');
  eq('多个小数点 → 语法错误', ev('1.2.3').code, 'CALC_SYNTAX');
  ok('全角运算符也能识别', ev('125×3.5').value === 437.5);
  ok('结果为 1/3 时保留 10 位小数', ev('1/3').text.indexOf('0.3333333333') === 0, ev('1/3').text);
  ok('超大结果使用科学计数法', /e\+?\d+/.test(ev('999999999999*999999999999').text), ev('999999999999*999999999999').text);
  noBadText('计算结果文本安全', ev('125*3.5').text);

  let expr = '';
  expr = TB.calc.applyKey(expr, '1');
  expr = TB.calc.applyKey(expr, '2');
  eq('键盘输入数字', expr, '12');
  expr = TB.calc.applyKey(expr, 'back');
  eq('退格', expr, '1');
  expr = TB.calc.applyKey(expr, 'clear');
  eq('清空', expr, '');
  eq('连续按 0 不会累积成 00', TB.calc.applyKey(TB.calc.applyKey('', '0'), '0'), '0');
  eq('0 之后输入数字会替换前导 0', TB.calc.applyKey(TB.calc.applyKey(TB.calc.applyKey('', '0'), '0'), '7'), '7');
  eq('非零数字可以连续输入', TB.calc.applyKey('10', '5'), '105');
  eq('小数点不重复', TB.calc.applyKey('1.5', 'dot'), '1.5');
  eq('运算符后按小数点补 0', TB.calc.applyKey('1+', 'dot'), '1+0.');
  eq('连续运算符自动替换', TB.calc.applyKey('1+', 'mul'), '1*');
  eq('开头不允许运算符', TB.calc.applyKey('', 'mul'), '');
  eq('± 给整个算式取负', TB.calc.applyKey('5+3', 'sign'), '-5+3');
  eq('± 再次按下取消负号', TB.calc.applyKey('-5+3', 'sign'), '5+3');
  eq('括号自动补右括号', TB.calc.applyKey('(1+2', 'paren'), '(1+2)');
  eq('括号再次按下补左括号', TB.calc.applyKey('(1+2)', 'paren'), '(1+2)(');
  eq('百分号是后缀，后面可以接乘号', TB.calc.applyKey(TB.calc.applyKey('5', 'percent'), 'mul'), '5%*');
  eq('百分号后接加号', TB.calc.applyKey(TB.calc.applyKey('5', 'percent'), 'add'), '5%+');
  eq('百分号可以连续按', TB.calc.applyKey(TB.calc.applyKey('5', 'percent'), 'percent'), '5%%');
  eq('中缀运算符互相替换', TB.calc.applyKey('5+', 'mul'), '5*');
  eq('算式 5%×200 的结果为 10', TB.calc.evaluate('5%*200').value, 10);
  ok('键盘布局包含全部必需按键', ['clear', 'paren', 'percent', 'back', 'sign', 'dot', 'eq'].every((id) =>
    TB.calc.KEYPAD.some((k) => k.id === id)));
});

/* ================================================================ 单位换算 */

await describe('单位换算 TB.units', () => {
  const c = (cat, from, to, v) => TB.units.convert(cat, from, to, v);

  eq('100 厘米 = 1 米', c('length', 'cm', 'm', 100).value, 1);
  eq('1 千米 = 1000 米', c('length', 'km', 'm', 1).value, 1000);
  eq('1000 毫米 = 1 米', c('length', 'mm', 'm', 1000).value, 1);
  eq('1000 克 = 1 千克', c('weight', 'g', 'kg', 1000).value, 1);
  eq('1 吨 = 1000 千克', c('weight', 't', 'kg', 1).value, 1000);
  eq('0 摄氏度 = 32 华氏度', c('temperature', 'c', 'f', 0).value, 32);
  eq('100 摄氏度 = 212 华氏度', c('temperature', 'c', 'f', 100).value, 212);
  eq('32 华氏度 = 0 摄氏度', c('temperature', 'f', 'c', 32).value, 0);
  eq('摄氏转华氏保留小数', c('temperature', 'c', 'f', 37).value, 98.6);
  eq('1 平方米 = 10000 平方厘米', c('area', 'm2', 'cm2', 1).value, 10000);
  eq('1 平方千米 = 1000000 平方米', c('area', 'km2', 'm2', 1).value, 1000000);
  eq('1 升 = 1000 毫升', c('volume', 'l', 'ml', 1).value, 1000);
  eq('36 千米/小时 = 10 米/秒', c('speed', 'kmh', 'mps', 36).value, 10);
  eq('同单位换算保持原值', c('length', 'm', 'm', 3.5).value, 3.5);
  eq('负数换算', c('temperature', 'c', 'f', -40).value, -40);
  eq('非法输入提示', c('length', 'cm', 'm', 'abc').code, 'INVALID_NUMBER');
  eq('空输入提示', c('length', 'cm', 'm', '').code, 'INVALID_NUMBER');
  noBadText('换算结果文本安全', c('speed', 'kmh', 'mps', 36).text);
  eq('六个分类齐全', TB.units.CATEGORIES.length, 6);
  ok('每类至少两个单位', TB.units.CATEGORIES.every((cat) => cat.units.length >= 2));
});

/* ================================================================ 折扣 / 百分比 */

await describe('折扣与百分比 TB.numbers', () => {
  const d1 = TB.numbers.discount({ price: '299', discount: '7.5' });
  eq('299 元 7.5 折 → 折后价 224.25', d1.final, 224.25);
  eq('299 元 7.5 折 → 节省 74.75', d1.saved, 74.75);
  eq('折扣率 25%', d1.percentOff, 25);
  eq('折扣支持「折」后缀', TB.numbers.discount({ price: '100', discount: '8 折' }).final, 80);
  eq('10 折等于原价', TB.numbers.discount({ price: '100', discount: '10' }).final, 100);
  eq('折扣百分比写法给出明确提示', TB.numbers.discount({ price: '100', discount: '75%' }).ok, false);
  eq('折扣为 0 被判为无效', TB.numbers.discount({ price: '100', discount: '0' }).ok, false);
  eq('折扣为负被判为无效', TB.numbers.discount({ price: '100', discount: '-1' }).ok, false);
  eq('原价为负被判为无效', TB.numbers.discount({ price: '-5', discount: '8' }).ok, false);
  eq('原价空 → 提示填空', TB.numbers.discount({ price: '', discount: '8' }).code, 'EMPTY_INPUT');
  eq('原价非法 → 提示有效数字', TB.numbers.discount({ price: 'abc', discount: '8' }).code, 'INVALID_NUMBER');
  ok('折扣大于 10 折时给出提醒标记', TB.numbers.discount({ price: '100', discount: '12' }).higher === true);
  noBadText('折扣结果文本安全', JSON.stringify(d1));

  eq('200 的 15% = 30', TB.numbers.percentOf('200', '15').value, 30);
  eq('百分比带 % 也能算', TB.numbers.percentOf('200', '15%').value, 30);
  eq('0 的 50% = 0', TB.numbers.percentOf('0', '50').value, 0);
  eq('百分比空输入', TB.numbers.percentOf('200', '').code, 'EMPTY_INPUT');

  eq('100 → 120 变化 +20%', TB.numbers.percentChange('100', '120').value, 20);
  eq('100 → 120 方向为上升', TB.numbers.percentChange('100', '120').direction, 'up');
  eq('100 → 80 变化 -20%', TB.numbers.percentChange('100', '80').value, -20);
  eq('100 → 80 方向为下降', TB.numbers.percentChange('100', '80').direction, 'down');
  eq('100 → 100 无变化', TB.numbers.percentChange('100', '100').direction, 'same');
  eq('原数为 0 时提示无法计算', TB.numbers.percentChange('0', '5').code, 'DIV_ZERO');

  eq('30 占 120 = 25%', TB.numbers.percentRatio('30', '120').value, 25);
  eq('占比分母为 0 → 报错', TB.numbers.percentRatio('30', '0').code, 'DIV_ZERO');

  const bytes = TB.numbers.convertBytes('1.5', 2, false);
  eq('1.5 MB = 1500000 字节', bytes.bytes, 1500000);
  eq('1.5 MB 的 KB 表示', bytes.results[1].text, '1,500');
  eq('1024 进制下 1 MiB', TB.numbers.convertBytes('1', 2, true).bytes, 1048576);
  eq('负数体积被判无效', TB.numbers.convertBytes('-1', 2, false).ok, false);
  eq('空体积输入', TB.numbers.convertBytes('', 2, false).code, 'EMPTY_INPUT');
});

/* ================================================================ 随机 */

await describe('随机数 / 随机选择 TB.numbers', () => {
  const r = TB.numbers.randomNumber({ min: '1', max: '100', integer: true });
  ok('1~100 整数落在区间内', r.ok && r.value >= 1 && r.value <= 100 && Number.isInteger(r.value), String(r.value));
  noBadText('随机数文本安全', r.text);

  let allInRange = true;
  const seen = new Set();
  for (let i = 0; i < 800; i++) {
    const one = TB.numbers.randomNumber({ min: '1', max: '6', integer: true });
    if (one.value < 1 || one.value > 6) allInRange = false;
    seen.add(one.value);
  }
  ok('1~6 循环 800 次都在区间内', allInRange);
  ok('1~6 的结果分布覆盖所有可能值', seen.size === 6, [...seen].join(','));

  eq('最小值大于最大值 → 报错', TB.numbers.randomNumber({ min: '100', max: '1', integer: true }).code, 'RANGE_INVALID');
  eq('最小值等于最大值 → 结果就是该值', TB.numbers.randomNumber({ min: '5', max: '5', integer: true }).value, 5);
  eq('空输入 → 提示', TB.numbers.randomNumber({ min: '', max: '5', integer: true }).code, 'EMPTY_INPUT');
  eq('非法数字 → 提示', TB.numbers.randomNumber({ min: 'a', max: '5', integer: true }).code, 'INVALID_NUMBER');

  let decimalsOk = true;
  for (let i = 0; i < 300; i++) {
    const one = TB.numbers.randomNumber({ min: '0', max: '1', integer: false, decimals: 2 });
    const str = String(one.value);
    const dot = str.indexOf('.');
    if (one.value < 0 || one.value > 1) decimalsOk = false;
    if (dot >= 0 && str.length - dot - 1 > 2) decimalsOk = false;
  }
  ok('小数模式遵守小数位数', decimalsOk);
  eq('小数模式 0 位时结果为整数', Number.isInteger(TB.numbers.randomNumber({ min: '1', max: '5', integer: false, decimals: 0 }).value), true);

  eq('随机选择解析忽略空行', TB.numbers.parseOptions('奶茶\n\n 咖啡 \n\n\n可乐\n').length, 3);
  eq('随机选择解析去掉首尾空格', TB.numbers.parseOptions('  奶茶  ')[0], '奶茶');
  eq('只有 1 个选项 → 提示不够', TB.numbers.pick({ options: '只有一行', count: 1 }).code, 'OPTIONS_TOO_FEW');
  eq('空输入 → 提示不够', TB.numbers.pick({ options: '', count: 1 }).code, 'OPTIONS_TOO_FEW');

  const pool = ['a', 'b', 'c', 'd', 'e'];
  const one = TB.numbers.pick({ options: pool, count: 1 });
  ok('抽取 1 个命中列表中的值', one.ok && pool.indexOf(one.items[0].text) >= 0, one.items[0].text);
  const three = TB.numbers.pick({ options: pool, count: 3 });
  eq('抽取 3 个互不重复', new Set(three.indices).size, 3);
  eq('抽取数量超过总数时按总数给', TB.numbers.pick({ options: pool, count: 99 }).items.length, 5);
  eq('抽取数量为 0 时按 1 处理', TB.numbers.pick({ options: pool, count: 0 }).items.length, 1);
  eq('非法抽取数量按 1 处理', TB.numbers.pick({ options: pool, count: 'x' }).items.length, 1);

  const exclude = [0, 1, 2, 3];
  const left = TB.numbers.pick({ options: pool, count: 1, exclude: exclude });
  eq('不重复抽取只返回剩下的项', left.items[0].text, 'e');
  eq('剩余数量统计正确', left.remaining, 0);
  eq('全部抽完后给出提示', TB.numbers.pick({ options: pool, count: 1, exclude: [0, 1, 2, 3, 4] }).ok, false);

  const indices = TB.numbers.sampleIndices(10, 10);
  eq('抽满 10 个时无重复', new Set(indices).size, 10);
});

/* ================================================================ JSON */

await describe('JSON 处理 TB.jsonutil', () => {
  const good = '{"name":"工具箱","tags":["a","b"],"nested":{"v":1}}';
  eq('美化成功', TB.jsonutil.beautify(good, 2).ok, true);
  ok('美化结果包含缩进', TB.jsonutil.beautify(good, 2).text.indexOf('\n  "name"') >= 0);
  eq('压缩成一行', TB.jsonutil.minify(good).text, good);
  eq('数组也能处理', TB.jsonutil.minify('[1,2,3]').text, '[1,2,3]');
  eq('数字字面量也能处理', TB.jsonutil.minify('42').text, '42');
  eq('空输入提示', TB.jsonutil.beautify('', 2).code, 'JSON_EMPTY');
  eq('只有空格也提示空', TB.jsonutil.beautify('   ', 2).code, 'JSON_EMPTY');

  const bad = '{\n  "a": 1,\n  "b": ,\n  "c": 2\n}';
  const r1 = TB.jsonutil.parse(bad);
  eq('错误 JSON 被判为格式有误', r1.ok, false);
  ok('错误提示包含行号', r1.line === 3, 'line=' + r1.line);
  ok('错误提示包含中文说明', /JSON 格式有误/.test(r1.message), r1.message);
  ok('错误提示给出出错行内容', r1.lineText.indexOf('"b"') >= 0, r1.lineText);

  const r2 = TB.jsonutil.parse('{"a": 1,}');
  eq('尾随逗号被判错', r2.ok, false);

  const r3 = TB.jsonutil.parse("{'a': 1}");
  eq('单引号被判错', r3.ok, false);
  ok('单引号错误提示友好', /JSON/.test(r3.message), r3.message);

  const r4 = TB.jsonutil.parse('{"a": "未闭合}');
  eq('未闭合字符串被判错', r4.ok, false);

  const r5 = TB.jsonutil.parse('{"a": 1');
  eq('内容不完整被判错', r5.ok, false);
  ok('不完整时提示缺少括号', /不完整|缺少/.test(r5.message), r5.message);

  const s = TB.jsonutil.describe(JSON.parse(good));
  eq('结构概览识别对象类型', s.type, '对象');
  eq('结构概览统计顶层键', s.topKeys.length, 3);
  eq('结构概览的嵌套层数（最外层算 0 层）', s.depth, 2);
  eq('三层嵌套结构统计为 3 层', TB.jsonutil.describe(JSON.parse('{"nested":{"deep":{"x":2}}}')).depth, 3);
  eq('结构概览识别数组', TB.jsonutil.describe([1, 2, 3]).type, '数组');
  eq('结构概览统计数组长度', TB.jsonutil.describe([1, 2, 3]).length, 3);
  eq('结构概览识别 null', TB.jsonutil.describe(null).type, 'null');
  eq('单层对象的嵌套层数为 1', TB.jsonutil.describe({ a: 1 }).depth, 1);
  eq('空对象的嵌套层数为 0', TB.jsonutil.describe({}).depth, 0);
  eq('两层嵌套的层数为 2', TB.jsonutil.describe({ a: { b: 1 } }).depth, 2);
});

/* ================================================================ 进制 */

await describe('进制转换 TB.radix', () => {
  const r = TB.radix.convert('255', 10);
  const get = (base) => r.results.find((x) => x.base === base).text;
  eq('十进制 255 → 二进制', get(2), '11111111');
  eq('十进制 255 → 八进制', get(8), '377');
  eq('十进制 255 → 十进制', get(10), '255');
  eq('十进制 255 → 十六进制（大写）', get(16), 'FF');

  eq('十六进制 ff → 十进制', TB.radix.convert('ff', 16).results.find((x) => x.base === 10).text, '255');
  eq('十六进制 0x1A → 十进制', TB.radix.convert('0x1A', 16).results.find((x) => x.base === 10).text, '26');
  eq('二进制 1010 → 十进制', TB.radix.convert('1010', 2).results.find((x) => x.base === 10).text, '10');
  eq('八进制 777 → 十进制', TB.radix.convert('777', 8).results.find((x) => x.base === 10).text, '511');
  eq('0 在所有进制下都是 0', TB.radix.convert('0', 10).results.every((x) => x.text === '0'), true);
  eq('十进制 0 的十六进制', TB.radix.convert('0', 10).results.find((x) => x.base === 16).text, '0');
  eq('负数十进制 -255 → 十六进制', TB.radix.convert('-255', 10).results.find((x) => x.base === 16).text, '-FF');
  eq('负数二进制', TB.radix.convert('-10', 10).results.find((x) => x.base === 2).text, '-1010');
  eq('十六进制 -1A → 十进制', TB.radix.convert('-1A', 16).results.find((x) => x.base === 10).text, '-26');

  const e1 = TB.radix.convert('12G5', 16);
  eq('十六进制含 G 被判无效', e1.ok, false);
  ok('提示明确指出是十六进制', /十六进制/.test(e1.message), e1.message);
  ok('非十进制输入出错时指导用户切换输入进制', /改为「十进制」/.test(e1.message), e1.message);
  ok('二进制输入 255 时报错并给出正确示例',
    /只能包含 0 和 1/.test(TB.radix.convert('255', 2).message) && /1010/.test(TB.radix.convert('255', 2).message),
    TB.radix.convert('255', 2).message);
  ok('十进制输入 FF 时报错并指导切换', /改为「十六进制」/.test(TB.radix.convert('FF', 10).message),
    TB.radix.convert('FF', 10).message);
  eq('二进制含 2 被判无效', TB.radix.convert('102', 2).ok, false);
  eq('八进制含 8 被判无效', TB.radix.convert('18', 8).ok, false);
  eq('十进制含字母被判无效', TB.radix.convert('1a', 10).ok, false);
  eq('空输入提示', TB.radix.convert('', 10).code, 'EMPTY_INPUT');
  eq('超长输入给出提示', TB.radix.convert('1'.repeat(2000), 2).code, 'RADIX_TOO_LONG');

  const big = '123456789012345678901234567890';
  const bigResult = TB.radix.convert(big, 10);
  eq('超大数字不丢精度', bigResult.results.find((x) => x.base === 10).text, big);
  const back = TB.radix.convert(bigResult.results.find((x) => x.base === 16).text, 16);
  eq('大数字十进制 → 十六进制 → 十进制往返一致', back.results.find((x) => x.base === 10).text, big);

  eq('输入带空格也能识别', TB.radix.convert('1 0101', 2).results.find((x) => x.base === 10).text, '21');
  eq('四种进制输出齐全', r.results.length, 4);
});

/* ================================================================ 时间戳 */

await describe('时间戳 TB.time', () => {
  const r = TB.time.timestampToDate('1750000000', 's');
  eq('秒级时间戳换算成功', r.ok, true);
  eq('1750000000 秒对应 UTC 时间', new Date(r.ms).toISOString(), '2025-06-15T15:06:40.000Z');
  eq('毫秒值为秒值 × 1000', r.milliseconds, 1750000000000);
  eq('秒值一致', r.seconds, 1750000000);
  ok('给出本地时间文本', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(r.local), r.local);
  ok('给出中文日期与星期', /年.*月.*日 星期/.test(r.dateCn), r.dateCn);
  ok('给出 ISO 字符串', r.iso.indexOf('2025-06-15') === 0, r.iso);
  ok('给出时区信息', /UTC[+-]\d{2}:\d{2}/.test(r.timezone), r.timezone);
  noBadText('时间戳结果文本安全', JSON.stringify(r));

  const ms = TB.time.timestampToDate('1750000000000', 'ms');
  eq('毫秒模式与秒模式结果相同', ms.milliseconds, 1750000000000);
  ok('毫秒模式下 13 位数字不提示单位疑问', !/秒/.test(ms.hint || ''), ms.hint);

  const wrongUnit = TB.time.timestampToDate('175000000000', 's');
  ok('12 位数字按秒解析会提醒可能选错单位', /毫秒/.test(wrongUnit.hint || ''), wrongUnit.hint);
  eq('13 位数字按秒解析因超范围被拒绝', TB.time.timestampToDate('1750000000000', 's').code, 'TIME_INVALID');
  const wrongUnit2 = TB.time.timestampToDate('1750000000', 'ms');
  ok('10 位数字按毫秒解析会提醒可能选错单位', /秒/.test(wrongUnit2.hint || ''), wrongUnit2.hint);

  eq('小数时间戳被判无效', TB.time.timestampToDate('1.5', 's').code, 'TIME_INVALID');
  eq('非数字时间戳被判无效', TB.time.timestampToDate('abc', 's').code, 'TIME_INVALID');
  eq('空时间戳提示', TB.time.timestampToDate('', 's').code, 'EMPTY_INPUT');
  eq('超大时间戳被判无效', TB.time.timestampToDate('99999999999999999999', 's').code, 'TIME_INVALID');
  eq('负数时间戳可用（1970 之前）', TB.time.timestampToDate('-1000000', 's').ok, true);

  const back = TB.time.dateToTimestamp({ date: '2025-06-15', time: '15:06:40', unit: 's' });
  eq('日期转时间戳成功', back.ok, true);
  eq('秒级时间戳与日期一致', TB.time.timestampToDate(String(back.unitSeconds), 's').local, '2025-06-15 15:06:40');
  ok('同时给出毫秒时间戳', back.unitMillis === back.unitSeconds * 1000 + (back.ms % 1000), String(back.unitMillis));
  eq('日期带斜杠也能解析', TB.time.dateToTimestamp({ date: '2025/06/15', time: '', unit: 's' }).ok, true);
  eq('8 位连写日期也能解析', TB.time.dateToTimestamp({ date: '20250615', time: '', unit: 's' }).ok, true);
  eq('不存在的日期 2025-02-30 被拒绝', TB.time.dateToTimestamp({ date: '2025-02-30', time: '', unit: 's' }).ok, false);
  eq('月份 13 被拒绝', TB.time.dateToTimestamp({ date: '2025-13-01', time: '', unit: 's' }).ok, false);
  eq('时间 25:00 被拒绝', TB.time.dateToTimestamp({ date: '2025-06-15', time: '25:00', unit: 's' }).ok, false);
  eq('时间 12:70 被拒绝', TB.time.dateToTimestamp({ date: '2025-06-15', time: '12:70', unit: 's' }).ok, false);
  eq('时间为空按 00:00:00', TB.time.dateToTimestamp({ date: '2025-06-15', time: '', unit: 's' }).local, '2025-06-15 00:00:00');
  eq('只填 HH:mm 也能用', TB.time.dateToTimestamp({ date: '2025-06-15', time: '08:30', unit: 's' }).local, '2025-06-15 08:30:00');
  eq('2 月 29 日在闰年有效', TB.time.dateToTimestamp({ date: '2024-02-29', time: '', unit: 's' }).ok, true);
  eq('2 月 29 日在平年被拒绝', TB.time.dateToTimestamp({ date: '2025-02-29', time: '', unit: 's' }).ok, false);

  const now = TB.time.nowParts();
  ok('当前时间文本格式正确', /\d{4}-\d{2}-\d{2}/.test(now.date) && /\d{2}:\d{2}:\d{2}/.test(now.time), now.date + ' ' + now.time);
});

/* ================================================================ 注册表与搜索 */

await describe('工具注册表 TB.registry', () => {
  eq('V0.1 一共 13 个工具', TB.registry.count(), 13);
  eq('工具 id 唯一', new Set(TB.registry.all().map((t) => t.id)).size, 13);
  eq('三个分类', TB.registry.CATEGORIES.length, 3);
  eq('图片分类 3 个工具', TB.registry.byCategory('image').length, 3);
  eq('计算分类 6 个工具', TB.registry.byCategory('calc').length, 6);
  eq('开发/电脑分类 4 个工具', TB.registry.byCategory('dev').length, 4);
  ok('每个工具都有名称/说明/图标/关键词', TB.registry.all().every((t) =>
    t.name && t.desc && t.emoji && Array.isArray(t.keywords) && t.keywords.length > 0));

  const first = (q) => (TB.registry.search(q)[0] || {}).id;
  eq('搜索 JSON → JSON 格式化', first('JSON'), 'json');
  eq('搜索 json 小写同样命中', first('json'), 'json');
  eq('搜索 uuid → UUID 生成', first('uuid'), 'uuid');
  eq('搜索 时间戳 → 时间戳转换', first('时间戳'), 'timestamp');
  eq('搜索 压缩 → 图片压缩', first('压缩'), 'img-compress');
  eq('搜索 PDF → 图片转 PDF', first('PDF'), 'img-pdf');
  eq('搜索 随机 → 随机数/随机选择', first('随机'), 'random');
  eq('搜索 进制 → 进制转换', first('进制'), 'radix');
  eq('搜索 折扣 → 折扣计算', first('折扣'), 'discount');
  eq('搜索 百分比 → 百分比计算', first('百分比'), 'percent');
  eq('搜索 单位 → 单位换算', first('单位'), 'units');
  eq('搜索 文件大小 → 文件大小换算', first('文件大小'), 'filesize');
  eq('搜索 计算器 → 计算器', first('计算器'), 'calc');

  const images = TB.registry.search('图片').map((t) => t.id);
  eq('搜索「图片」命中 3 个图片工具', images.length, 3);
  ok('搜索结果含压缩/转换/PDF', ['img-compress', 'img-convert', 'img-pdf'].every((id) => images.indexOf(id) >= 0), images.join(','));
  eq('搜索不存在的关键词返回空', TB.registry.search('zzz不存在zzz').length, 0);
  eq('空关键词返回全部', TB.registry.search('').length, 13);
  eq('空白字符关键词返回全部', TB.registry.search('   ').length, 13);
  ok('搜索「compress」命中图片压缩', TB.registry.search('compress')[0].id === 'img-compress');
  ok('搜索「hex」命中进制转换', TB.registry.search('hex')[0].id === 'radix');
  ok('搜索「255」通过关键词命中进制转换', TB.registry.search('255')[0].id === 'radix');
  ok('中英混写「js格式」通过子序列命中 JSON 工具', TB.registry.search('js格式').some((t) => t.id === 'json'),
    TB.registry.search('js格式').map((t) => t.id).join(','));

  const sorted = TB.registry.search('图片压缩');
  ok('精确名称排在最前', sorted[0].id === 'img-compress', sorted.map((t) => t.id).join(','));
});

/* ================================================================ 最近使用 */

await describe('最近使用 TB.recent', () => {
  TB.recent.clear();
  eq('初始为空', TB.recent.list().length, 0);

  TB.recent.touch('calc');
  TB.recent.touch('json');
  eq('记录两条', TB.recent.ids().join(','), 'json,calc');
  TB.recent.touch('calc');
  eq('重复使用只保留一条并提前', TB.recent.ids().join(','), 'calc,json');
  eq('去重后数量仍为 2', TB.recent.list().length, 2);

  TB.recent.touch('uuid');
  TB.recent.touch('radix');
  eq('最多保留 4 条', TB.recent.list().length, 4);
  TB.recent.touch('timestamp');
  eq('超出后淘汰最旧的', TB.recent.ids().join(','), 'timestamp,radix,uuid,calc');
  eq('仍不超过 4 条', TB.recent.list().length, 4);

  TB.recent.touch('不存在的工具');
  eq('忽略不存在的工具', TB.recent.list().length, 4);

  eq('偏好默认值', TB.recent.getPref('filesize.binary', false), false);
  TB.recent.setPref('filesize.binary', true);
  eq('偏好可以写入并读回', TB.recent.getPref('filesize.binary', false), true);

  TB.recent.clear();
  eq('清空后为空', TB.recent.list().length, 0);
});

/* ================================================================ PDF 生成 */

await describe('PDF 生成 TB.pdf', async () => {
  const info = TB.pdf.readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11, 0x00]));
  ok('能读出 JPEG 的宽高', info && info.width === 32 && info.height === 16, JSON.stringify(info));
  eq('能读出颜色分量数', info.components, 3);
  eq('非 JPEG 数据返回 null', TB.pdf.readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  eq('空数据返回 null', TB.pdf.readJpegInfo(new Uint8Array([])), null);

  eq('A4 宽度（pt）', Math.round(TB.pdf.A4.width * 100) / 100, 595.28);
  eq('A4 高度（pt）', Math.round(TB.pdf.A4.height * 100) / 100, 841.89);

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9]);

  const blob = await TB.pdf.build([
    { bytes: fakeJpeg, width: 32, height: 16 },
    { bytes: fakeJpeg, width: 32, height: 16 }
  ]);
  eq('生成的文件类型为 PDF', blob.type, 'application/pdf');
  ok('文件体积大于 500 字节', blob.size > 500, String(blob.size));

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let latin = '';
  for (let i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);

  eq('文件以 %PDF- 开头', latin.slice(0, 5), '%PDF-');
  ok('文件以 %%EOF 结尾', latin.trim().indexOf('%%EOF') === latin.trim().length - 5);
  ok('包含 2 个页面对象', (latin.match(/\/Type \/Page[^s]/g) || []).length === 2, String((latin.match(/\/Type \/Page[^s]/g) || []).length));
  ok('页面树 Count 为 2', latin.indexOf('/Count 2') >= 0);
  ok('内嵌 JPEG 使用 DCTDecode', (latin.match(/\/DCTDecode/g) || []).length === 2);
  ok('声明了 RGB 颜色空间', latin.indexOf('/ColorSpace /DeviceRGB') >= 0);
  ok('MediaBox 使用 A4 尺寸', latin.indexOf('/MediaBox [0 0 595.28 841.89]') >= 0);
  ok('图像按比例居中（cm 变换存在）', /cm\n\/Im0 Do/.test(latin));

  // 交叉引用表偏移量必须精确指向对应的对象
  const xrefStart = latin.lastIndexOf('\nxref');
  const xrefBody = latin.slice(xrefStart + 1).split('\n');
  const sizeLine = xrefBody[1].split(' ');
  const objectCount = Number(sizeLine[1]) - 1;
  eq('交叉引用表记录的对象数量', objectCount, 8);
  let offsetsOk = true;
  const badOffsets = [];
  for (let i = 1; i <= objectCount; i++) {
    const entry = xrefBody[2 + i];
    if (!entry) { offsetsOk = false; badOffsets.push(i + ':missing'); continue; }
    const offset = Number(entry.slice(0, 10));
    const expect = i + ' 0 obj';
    if (latin.slice(offset, offset + expect.length) !== expect) {
      offsetsOk = false;
      badOffsets.push(i + ':' + offset + '→' + JSON.stringify(latin.slice(offset, offset + 8)));
    }
  }
  ok('所有对象的 xref 偏移量都正确', offsetsOk, badOffsets.join(' '));
  eq('trailer 指向根对象', latin.indexOf('/Size 9 /Root 1 0 R') >= 0, true);
  eq('startxref 存在', /startxref\n\d+\n/.test(latin), true);
  eq('空页面列表被拒绝', await TB.pdf.build([]).then(() => 'no-error').catch((e) => e.code), 'PDF_EMPTY');
});

/* ================================================================ 汇总 */

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('  · ' + f));
  console.log('通过 ' + passed + ' 项 / 共 ' + (passed + failures.length) + ' 项');
  process.exit(1);
} else {
  console.log('全部通过：' + passed + ' 项断言');
}
