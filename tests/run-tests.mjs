#!/usr/bin/env node
/* ETHAN Super App · Shell 单元测试
 * 运行：node tests/run-tests.mjs
 * 覆盖：工具函数 / 偏好引擎 / 最近使用合并 / 随机回忆安全过滤（ETHAN 永不出现在候选里）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ ' + name); }
}
function eq(a, b, name) {
  if (a === b) passed++;
  else { failed++; console.log(`  ✗ ${name}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
}

/* ---------- 环境模拟 ---------- */
const storage = new Map();
const listeners = {};
const sandbox = {
  console,
  navigator: { vibrate: () => true },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  document: {
    documentElement: { setAttribute() {}, getAttribute() { return null; } },
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, toggle() {} } }),
    createTextNode: (t) => ({ t }),
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    body: { appendChild() {} },
    readyState: 'complete'
  },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => 0,
  indexedDB: null,
  URL, URLSearchParams, Date, Math, JSON, Object, Array, String, Number, Promise, Error
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.parent = { postMessage() {} };

function load(rel) {
  const code = fs.readFileSync(path.join(appDir, rel), 'utf8');
  vm.runInThisContext(code, { filename: rel });
}
// vm.runInThisContext 使用全局沙箱：直接注入
for (const k of Object.keys(sandbox)) {
  if (!(k in globalThis)) globalThis[k] = sandbox[k];
}

load('js/core/util.js');
load('js/core/prefs.js');
load('js/core/stats.js');
load('js/core/recents.js');
load('js/core/memories.js');

const ESA = globalThis.ESA;

console.log('\n[1] 工具函数');
eq(ESA.util.esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'esc 转义');
eq(ESA.util.relTime(Date.now() - 30 * 1000), '刚刚', 'relTime 刚刚');
eq(ESA.util.relTime(Date.now() - 5 * 60000), '5 分钟前', 'relTime 分钟');
eq(ESA.util.relTime(Date.now() - 3 * 3600000), '3 小时前', 'relTime 小时');
eq(ESA.util.relTime(Date.now() - 26 * 3600000), '昨天', 'relTime 昨天');
eq(ESA.util.relTime(Date.now() - 5 * 86400000), '5 天前', 'relTime 天');
const span = ESA.util.h('div', { class: 'x', text: '<b>safe</b>' });
ok(span.className === 'x' && span.textContent === '<b>safe</b>', 'h() textContent 不解析 HTML');

console.log('\n[2] 偏好引擎');
eq(ESA.prefs.get().theme, 'system', '默认跟随系统');
ok(ESA.prefs.get().animations === true && ESA.prefs.get().transitions === true, '动画/过渡默认开');
ok(ESA.prefs.get().haptics === false, '触觉反馈默认关');
ESA.prefs.setTheme('dark');
eq(storage.get('esa.theme'), 'dark', '主题切换写入 esa.theme 镜像');
eq(JSON.parse(storage.get('esa.prefs.v1')).theme, 'dark', '主题写入完整偏好');
ESA.prefs.setAnimations(false);
eq(JSON.parse(storage.get('esa.prefs.v1')).animations, false, '动画开关持久化');
ESA.prefs.setTheme('light');
eq(ESA.prefs.resolvedTheme(), 'light', 'resolvedTheme 浅色');

console.log('\n[3] 最近使用（合并 + 去重 + ETHAN 安全）');
storage.set('toolbox.recent.v1', JSON.stringify([
  { id: 'calc', at: Date.now() - 3600 * 1000 },
  { id: 'json', at: Date.now() - 60 * 1000 }
]));
// globalThis.TB 不存在 → 工具名映射不可用，条目被安全跳过
const base1 = ESA.recents.list(5);
ok(base1.length === 0, '无 TB.registry 时工具条目安全跳过（不猜测名称）');
globalThis.TB = { registry: { get: (id) => ({ id, name: id === 'calc' ? '计算器' : 'JSON 格式化' }), count: () => 13 } };
const base2 = ESA.recents.list(5);
ok(base2.some((r) => r.name === 'JSON 格式化'), '工具箱最近使用映射真实工具名');
const merged = ESA.recents.mergeDynamic(
  base2,
  { count: 3, recentName: '旧相机', recentAt: Date.now() - 86400000 },
  { cityCount: 2, latestCity: '京都', latestAt: Date.now() - 3 * 86400000 }
);
eq(merged[0].name, 'JSON 格式化', '合并后按时间排序');
ok(merged.some((r) => r.name === '旧相机'), '我的空间最近物品进入最近使用');
ok(merged.some((r) => r.name === '京都行程'), '旅行足迹最近旅程进入最近使用');
ESA.recents.touchApp('ethan');
const withEthan = ESA.recents.list(5);
const ethanEntry = withEthan.find((r) => r.name === '密码');
ok(!!ethanEntry && ethanEntry.sub === '最近使用', 'ETHAN 只记录应用级事件（仅「最近使用」，无条目名）');
ok(!JSON.stringify(storage.get('esa.recents.v1')).includes('API'), 'ETHAN 记录不含敏感元数据');

console.log('\n[4] 随机回忆安全过滤');
// memories.candidates 只读两个库（沙箱 indexedDB=null → 空候选 → 空状态）
const mem = await Promise.resolve(ESA.memories.random(null));
eq(mem, null, '无数据时随机回忆返回空（不伪造）');
eq(ESA.memories.EMPTY_TEXT, '暂时没有值得回看的记录', '空状态文案');

console.log('\n[5] ETHAN 统计读取（非敏感）');
storage.set('ethan.stats.v1', JSON.stringify({ count: 12, updatedAt: Date.now() }));
const eth = await Promise.resolve(ESA.stats.ethan());
eq(eth.count, 12, '读取 ETHAN 非敏感计数');
storage.delete('ethan.stats.v1');
const eth2 = await Promise.resolve(ESA.stats.ethan());
eq(eth2.count, null, '无计数时为 null（锁定态显示「已加密保护」）');

console.log('\n' + '─'.repeat(56));
console.log(`Shell 单元测试：通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
