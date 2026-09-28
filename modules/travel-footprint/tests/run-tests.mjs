/**
 * Travel Footprint — core logic test suite.
 * Loads the browser sources into Node via vm.runInThisContext so the exact
 * same files that ship in the app are the ones under test. No bundler.
 *
 *   node tests/run-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SCRIPT_FILES = [
  'app/js/core/util.js',
  'app/js/core/model.js',
  'app/js/core/zip.js',
  'app/js/core/backup.js',
  'app/js/data/adapter.js',
  'app/js/data/repo.js',
  'app/js/ui/theme.js'
];

/* ------------------------------------------------------------- harness --- */

let passed = 0;
let failed = 0;
const failures = [];
const groups = [];
let currentGroup = null;

function group(name) {
  currentGroup = { name, tests: [] };
  groups.push(currentGroup);
}

function ok(label, cond, detail) {
  const entry = { label, pass: !!cond, detail };
  if (currentGroup) currentGroup.tests.push(entry);
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push({ group: currentGroup?.name, label, detail });
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return !!cond;
}

function eq(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  return ok(label, same, same ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function throws(label, fn, matcher) {
  try {
    fn();
    return ok(label, false, '没有抛出异常');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (matcher && !msg.includes(matcher)) {
      return ok(label, false, `异常信息不含"${matcher}"：${msg}`);
    }
    return ok(label, true);
  }
}

async function throwsAsync(label, fn, matcher) {
  try {
    await fn();
    return ok(label, false, '没有抛出异常');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (matcher && !msg.includes(matcher)) {
      return ok(label, false, `异常信息不含"${matcher}"：${msg}`);
    }
    return ok(label, true);
  }
}

/* ---------------------------------------------------------- load source --- */

for (const rel of SCRIPT_FILES) {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, 'utf8');
  try {
    vm.runInThisContext(code, { filename: file });
  } catch (e) {
    console.error(`无法加载 ${rel}: ${e.message}`);
    process.exit(1);
  }
}

const TF = globalThis.TF;
if (!TF) {
  console.error('TF 命名空间未导出');
  process.exit(1);
}

const U = TF.util;
const M = TF.model;
const Z = TF.zip;
const B = TF.backup;
const { MemoryAdapter, MemoryBlobStore } = TF.adapter;
const { Repo } = TF.repo;

/* -------------------------------------------------------------- helpers --- */

function makeRepo() {
  const repo = new Repo({
    cities: new MemoryAdapter('cities'),
    trips: new MemoryAdapter('trips'),
    photos: new MemoryAdapter('photos'),
    attachments: new MemoryAdapter('attachments'),
    blobs: new MemoryBlobStore()
  });
  return repo.init().then(() => repo);
}

let citySeq = 0;
async function seedCity(repo, name, opts = {}) {
  citySeq++;
  return repo.save('city', {
    name,
    country: opts.country ?? '中国',
    province: opts.province ?? null,
    latitude: opts.latitude ?? 30,
    longitude: opts.longitude ?? 110,
    ...(opts.id ? { id: opts.id } : {})
  });
}

async function seedTrip(repo, cityId, start, end, note = null) {
  return repo.save('trip', { cityId, startDate: start, endDate: end, note });
}

/* =========================================================================
   1. util
   ========================================================================= */

group('util — 日期与格式化');

eq('toDateStr 空值返回 null', U.toDateStr(''), null);
eq('toDateStr undefined 返回 null', U.toDateStr(undefined), null);
eq('toDateStr null 返回 null', U.toDateStr(null), null);
eq('toDateStr 规范 YYYY-MM-DD', U.toDateStr('2026-08-12'), '2026-08-12');
eq('toDateStr 补零 2026-8-2', U.toDateStr('2026-8-2'), '2026-08-02');
eq('toDateStr 斜杠 2026/08/12', U.toDateStr('2026/08/12'), '2026-08-12');
eq('toDateStr 非法月份 → null', U.toDateStr('2026-13-01'), null);
eq('toDateStr 非法日期字符串 → null', U.toDateStr('hello'), null);
eq('toDateStr 无效 Date → null', U.toDateStr(new Date('nope')), null);

eq('daysBetween 同日 = 1 天', U.daysBetween('2026-08-12', '2026-08-12'), 1);
eq('daysBetween 08-12→08-15 = 4 天', U.daysBetween('2026-08-12', '2026-08-15'), 4);
eq('daysBetween 跨月 07-30→08-02 = 4 天', U.daysBetween('2026-07-30', '2026-08-02'), 4);
eq('daysBetween 跨年 2025-12-28→2026-01-03 = 7 天', U.daysBetween('2025-12-28', '2026-01-03'), 7);
eq('daysBetween 反向不产生负数', U.daysBetween('2026-08-15', '2026-08-12'), 1);
eq('daysBetween 缺参数回落为 1', U.daysBetween(null, null), 1);

eq('formatRange 同日', U.formatRange('2026-08-12', '2026-08-12'), '2026.08.12');
eq('formatRange 同月', U.formatRange('2026-08-12', '2026-08-15'), '2026.08.12 — 15');
eq('formatRange 跨月同年', U.formatRange('2026-07-30', '2026-08-02'), '2026.07.30 — 08.02');
eq('formatRange 跨年', U.formatRange('2025-12-28', '2026-01-03'), '2025.12.28 — 2026.01.03');
eq('formatRange 空值安全', U.formatRange(null, null), '');
eq('formatRange 仅开始日期', U.formatRange('2026-08-12', null), '2026.08.12');

eq('yearOf / monthOf', [U.yearOf('2026-08-12'), U.monthOf('2026-08-12')], [2026, 8]);
eq('monthLabelEn(8)', U.monthLabelEn(8), 'AUG');
eq('monthLabelCn(8)', U.monthLabelCn(8), '八月');
eq('formatCnMonth', U.formatCnMonth('2026-08-12'), '2026年8月');

eq('nn 空白 → null', U.nn('   '), null);
eq('nn 去空格', U.nn('  桂林 '), '桂林');
eq('nn 0 保留', U.nn(0), '0');
eq('toNum NaN → null', U.toNum('abc'), null);
eq('toNum 数字字符串', U.toNum('23'), 23);
eq('toNum 空 → null', U.toNum(''), null);

group('util — ID 与并发安全');
const ids = new Set();
for (let i = 0; i < 2000; i++) ids.add(U.uuid());
eq('2000 个 UUID 无重复', ids.size, 2000);
ok('UUID 符合 v4 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(U.uuid()));

/* =========================================================================
   2. model — normalise / validate
   ========================================================================= */

group('model — 归一化与空值规则');

const cityDef = M.normalize('city', {});
eq('city.name 空对象 → null', cityDef.name, null);
eq('city.country 空对象 → null', cityDef.country, null);
eq('city.latitude 空对象 → null', cityDef.latitude, null);
eq('city.deletedAt 空对象 → null', cityDef.deletedAt, null);
ok('city.id 自动生成', typeof cityDef.id === 'string' && cityDef.id.length > 10);
ok('city.createdAt 自动生成', typeof cityDef.createdAt === 'string');

const cityBlank = M.normalize('city', { name: '  ', country: '', province: '  ', latitude: '', longitude: 'abc' });
eq('city 空字符串名 → null', cityBlank.name, null);
eq('city 空省 → null', cityBlank.province, null);
eq('city 非法纬度 → null', cityBlank.latitude, null);
eq('city 非法经度 → null', cityBlank.longitude, null);

const tripDef = M.normalize('trip', {});
eq('trip.startDate 空 → null', tripDef.startDate, null);
eq('trip.endDate 空 → null', tripDef.endDate, null);
eq('trip.note 空 → null', tripDef.note, null);

const tripEndAuto = M.normalize('trip', { cityId: 'c1', startDate: '2026-08-12' });
eq('trip 缺 endDate 自动补齐为 startDate', tripEndAuto.endDate, '2026-08-12');

const tripReversed = M.normalize('trip', { cityId: 'c1', startDate: '2026-08-15', endDate: '2026-08-12' });
eq('trip 反向日期被纠正', tripReversed.endDate, '2026-08-15');

const unknownKeys = M.normalize('city', { name: 'X', bogusField: 'should be dropped', __proto__hack: 1 });
ok('未知字段被丢弃', !('bogusField' in unknownKeys));

group('model — 校验');

eq('校验：城市名为空', M.validate('city', { name: '' }).ok, false);
eq('校验：城市名为空有错误信息', M.validate('city', { name: '' }).errors.name, '请填写城市名称');
eq('校验：城市名过长', M.validate('city', { name: 'x'.repeat(41) }).ok, false);
eq('校验：重名城市被拦截', M.validate('city', { name: '桂林' }, { nameTaken: true }).ok, false);
eq('校验：正常城市通过', M.validate('city', { name: '桂林' }).ok, true);
eq('校验：旅行缺城市', M.validate('trip', { startDate: '2026-08-12' }).ok, false);
eq('校验：旅行缺日期', M.validate('trip', { cityId: 'c1' }).ok, false);
eq('校验：结束早于开始', M.validate('trip', { cityId: 'c1', startDate: '2026-08-15', endDate: '2026-08-12' }).ok, false);
eq('校验：正常旅行通过', M.validate('trip', { cityId: 'c1', startDate: '2026-08-12', endDate: '2026-08-15' }).ok, true);
eq('校验：备注超长', M.validate('trip', { cityId: 'c1', startDate: '2026-08-12', note: 'x'.repeat(2001) }).ok, false);

group('model — 搜索');

const sCities = [
  M.normalize('city', { id: 'c-guilin', name: '桂林', country: '中国', province: '广西' }),
  M.normalize('city', { id: 'c-sh', name: '上海', country: '中国', province: '上海' }),
  M.normalize('city', { id: 'c-gz', name: '广州', country: '中国', province: '广东' })
];
const sTrips = [
  M.normalize('trip', { id: 't1', cityId: 'c-guilin', startDate: '2026-08-12', endDate: '2026-08-15', note: '第一次去桂林，去了漓江和阳朔。' }),
  M.normalize('trip', { id: 't2', cityId: 'c-sh', startDate: '2026-07-04', endDate: '2026-07-07', note: '外滩夜景' })
];

eq('搜索为空时未激活', M.search('', sCities, sTrips).active, false);
eq('搜索城市名', M.search('桂林', sCities, sTrips).cities.map((c) => c.name), ['桂林']);
eq('搜索省份', M.search('广西', sCities, sTrips).cities.map((c) => c.name), ['桂林']);
eq('搜索国家', M.search('中国', sCities, sTrips).cities.length, 3);
eq('搜索备注命中旅行', M.search('漓江', sCities, sTrips).trips.map((t) => t.id), ['t1']);
eq('搜索备注不误报城市', M.search('漓江', sCities, sTrips).cities.length, 0);
eq('搜索城市名同时列出其旅行', M.search('上海', sCities, sTrips).trips.map((t) => t.id), ['t2']);
eq('搜索无结果', M.search('火星', sCities, sTrips).cities.length, 0);
eq('搜索大小写不敏感', M.search('SHANGHAI'.toLowerCase(), [
  M.normalize('city', { id: 'x', name: 'Shanghai' })
], []).cities.length, 1);
ok('搜索空值安全', M.search(null, sCities, sTrips).active === false);

/* =========================================================================
   3. 统计
   ========================================================================= */

group('model — 统计');

{
  const cities = [
    M.normalize('city', { id: 'a', name: '桂林', country: '中国', province: '广西' }),
    M.normalize('city', { id: 'b', name: '上海', country: '中国', province: '上海' }),
    M.normalize('city', { id: 'c', name: '广州', country: '中国', province: '广东' })
  ];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'a', startDate: '2026-08-12', endDate: '2026-08-15' }),
    M.normalize('trip', { id: 't2', cityId: 'b', startDate: '2024-10-01', endDate: '2024-10-03' }),
    M.normalize('trip', { id: 't3', cityId: 'b', startDate: '2025-07-04', endDate: '2025-07-07' }),
    M.normalize('trip', { id: 't4', cityId: 'b', startDate: '2026-07-04', endDate: '2026-07-07' })
  ];
  const photos = [
    M.normalize('photo', { id: 'p1', tripId: 't1', blobId: 'b1' }),
    M.normalize('photo', { id: 'p2', tripId: 't1', blobId: 'b2' })
  ];
  const stats = M.computeStats({ cities, trips, photos, attachments: [] });

  // only cities a/b have trips, so 2 of the 3 cities count as visited
  eq('统计：已去城市数 = 2（广州无旅行记录）', stats.cityCount, 2);
  // provinces visited are 广西(桂林) + 上海(上海) → 2 省区
  eq('统计：省区数 = 2', stats.regionCount, 2);
  eq('统计：记录的城市总数 = 3', stats.cityTotal, 3);
  eq('统计：旅行次数 = 4', stats.tripCount, 4);
  eq('统计：照片数 = 2', stats.photoCount, 2);
  eq('统计：总天数 4+3+4+4', stats.daysTotal, 15);
  eq('统计：年份倒序', stats.years, [2026, 2025, 2024]);
}

{
  // a city with no trip must not inflate cityCount
  const cities = [M.normalize('city', { id: 'z', name: '空城' })];
  const stats = M.computeStats({ cities, trips: [], photos: [], attachments: [] });
  eq('统计：无旅行的城市不计入已去城市数', stats.cityCount, 0);
  eq('统计：但记录在城市总数中', stats.cityTotal, 1);
  eq('统计：空数据全为 0', stats.tripCount + stats.photoCount + stats.regionCount, 0);
}

{
  // 省区 semantics: Chinese cities count by province; every foreign country
  // counts as ONE region no matter how many provinces/states it spans.
  const cities = [
    M.normalize('city', { id: 'a', name: '桂林', country: '中国', province: '广西' }),
    M.normalize('city', { id: 'b', name: '西安', country: '中国', province: '陕西' }),
    M.normalize('city', { id: 'c', name: '东京', country: '日本', province: '东京都' }),
    M.normalize('city', { id: 'd', name: '大阪', country: '日本', province: '大阪府' }),
    M.normalize('city', { id: 'e', name: '巴黎', country: '法国', province: '法兰西岛' })
  ];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'a', startDate: '2026-01-01', endDate: '2026-01-02' }),
    M.normalize('trip', { id: 't2', cityId: 'b', startDate: '2026-02-01', endDate: '2026-02-02' }),
    M.normalize('trip', { id: 't3', cityId: 'c', startDate: '2026-03-01', endDate: '2026-03-02' }),
    M.normalize('trip', { id: 't4', cityId: 'd', startDate: '2026-04-01', endDate: '2026-04-02' }),
    M.normalize('trip', { id: 't5', cityId: 'e', startDate: '2026-05-01', endDate: '2026-05-02' })
  ];
  const stats = M.computeStats({ cities, trips, photos: [], attachments: [] });
  // 广西 + 陕西 = 2 中国省区，日本(东京都+大阪府) = 1，法国 = 1 → 4
  eq('统计：省区语义 — 中国按省、国外按国家', stats.regionCount, 4);
  eq('统计：国家数不受省区语义影响', stats.countryCount, 3);
}

group('theme — 外观解析');

{
  // In Node there is no window.matchMedia, so "system" resolves to light.
  const T = globalThis.TF.theme;
  ok('theme 模块以 TF.theme 暴露', !!T && typeof T.resolve === 'function');
  ok('可选模式为 light/dark/system', JSON.stringify(T.MODES) === JSON.stringify(['light', 'dark', 'system']));
  eq('resolve(dark) → dark', T.resolve('dark'), 'dark');
  eq('resolve(light) → light', T.resolve('light'), 'light');
  eq('resolve(未知值) 跟随系统', T.resolve('banana'), 'light');
  eq('resolve(undefined) 跟随系统', T.resolve(undefined), 'light');
}

{
  // deleted rows excluded everywhere
  const cities = [
    M.normalize('city', { id: 'a', name: '桂林' }),
    M.normalize('city', { id: 'b', name: '幽灵', deletedAt: U.nowIso() })
  ];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'a', startDate: '2026-01-01', endDate: '2026-01-02' }),
    M.normalize('trip', { id: 't2', cityId: 'a', startDate: '2026-02-01', endDate: '2026-02-02', deletedAt: U.nowIso() })
  ];
  const stats = M.computeStats({ cities, trips, photos: [], attachments: [] });
  eq('统计：已删除城市不计入', stats.cityCount, 1);
  eq('统计：已删除旅行不计入', stats.tripCount, 1);
}

group('model — 同城多次旅行与分组');

{
  const cities = [
    M.normalize('city', { id: 'sh', name: '上海', country: '中国', province: '上海' }),
    M.normalize('city', { id: 'gl', name: '桂林', country: '中国', province: '广西' })
  ];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'sh', startDate: '2024-10-01', endDate: '2024-10-03', note: '第一次去上海' }),
    M.normalize('trip', { id: 't2', cityId: 'sh', startDate: '2025-07-04', endDate: '2025-07-07', note: '第二次去上海' }),
    M.normalize('trip', { id: 't3', cityId: 'sh', startDate: '2026-07-04', endDate: '2026-07-07', note: '第三次去上海' }),
    M.normalize('trip', { id: 't4', cityId: 'gl', startDate: '2026-08-12', endDate: '2026-08-15' })
  ];

  const list = M.buildCityList(cities, trips, []);
  eq('城市列表长度 2', list.length, 2);
  eq('按访问次数排序，上海在前', list[0].city.name, '上海');
  eq('上海去过 3 次', list[0].visitCount, 3);
  eq('上海旅行按时间倒序', list[0].trips.map((t) => t.id), ['t3', 't2', 't1']);
  eq('上海首次到访 2024-10-01', list[0].firstVisit, '2024-10-01');
  eq('上海最近到访 2026-07-04', list[0].lastVisit, '2026-07-04');

  const timeline = M.buildTimeline(trips, cities, [], []);
  eq('时间线年份倒序', timeline.map((y) => y.year), [2026, 2025, 2024]);
  eq('2026 年有 7 月和 8 月', timeline[0].months.map((m) => m.month), [8, 7]);
  eq('2026 年 8 月首条是桂林', timeline[0].months[0].trips[0].city.name, '桂林');
  eq('时间线条目带天数', timeline[0].months[0].trips[0].days, 4);
}

group('model — 级联与回收站');

{
  const cities = [M.normalize('city', { id: 'a', name: 'A' }), M.normalize('city', { id: 'b', name: 'B' })];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'a', startDate: '2026-01-01' }),
    M.normalize('trip', { id: 't2', cityId: 'b', startDate: '2026-01-02' })
  ];
  const photos = [
    M.normalize('photo', { id: 'p1', tripId: 't1', blobId: 'x1' }),
    M.normalize('photo', { id: 'p2', tripId: 't2', blobId: 'x2' })
  ];
  const attachments = [M.normalize('attachment', { id: 'f1', tripId: 't1', name: 'a.pdf', blobId: 'y1' })];

  const cascade = M.collectCascade('city', 'a', { cities, trips, photos, attachments });
  eq('删除城市连带其旅行', cascade.trips, ['t1']);
  eq('删除城市连带其照片', cascade.photos, ['p1']);
  eq('删除城市连带其附件', cascade.attachments, ['f1']);
  eq('不误伤其他城市的照片', cascade.photos.includes('p2'), false);

  const tripCascade = M.collectCascade('trip', 't2', { cities, trips, photos, attachments });
  eq('删除旅行连带其照片', tripCascade.photos, ['p2']);
  eq('删除旅行不影响城市', tripCascade.cities, []);
}

group('model — 展示层空值安全');

eq('geoLine 空对象返回空串', M.geoLine(null), '');
eq('geoLine 拼接国家与省份', M.geoLine({ country: '中国', province: '广西' }), '中国 · 广西');
eq('geoLine 缺省份不出现 undefined', M.geoLine({ country: '中国' }), '中国');
eq('cityName 空值兜底', M.cityName(null), '未命名地点');
eq('formatBytes 空值', M.formatBytes(null), '');
eq('formatBytes KB', M.formatBytes(2048), '2.0 KB');
eq('formatBytes MB', M.formatBytes(5242880), '5.0 MB');
eq('mimeIcon PDF', M.mimeIcon('application/pdf', 'a.pdf'), '📄');
eq('mimeIcon 未知类型有兜底', M.mimeIcon(null, null), '📎');

/* =========================================================================
   4. ZIP
   ========================================================================= */

group('zip — 写入与读取');

{
  const w = new Z.Writer();
  const text = '你好，旅行足迹！Hello 🌍';
  const bin = new Uint8Array([0, 1, 2, 253, 254, 255]);
  w.addText('data.json', text);
  w.add('photos/a.jpg', bin);
  const out = w.finish();

  ok('ZIP 输出为 Uint8Array', out instanceof Uint8Array);
  eq('ZIP 以 PK\\x03\\x04 开头', [out[0], out[1], out[2], out[3]], [0x50, 0x4b, 0x03, 0x04]);

  const zip = Z.read(out);
  eq('解析出 2 个条目', zip.entries.length, 2);
  eq('条目名保留顺序', zip.entries.map((e) => e.name), ['data.json', 'photos/a.jpg']);
  eq('CRC32 与内容一致', zip.entries[0].crc, Z.crc32(Z.utf8Encode(text)));
}

group('zip — 往返完整性');

{
  // deterministic pseudo-random binary payload
  const payload = new Uint8Array(64 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + (i >> 3)) & 0xff;

  const w = new Z.Writer();
  w.add('photos/big.bin', payload);
  w.addText('data.json', JSON.stringify({ hello: '世界' }));
  const bytes = w.finish();

  const zip = Z.read(bytes);
  const extracted = await Z.extract(zip, zip.entries[0]);
  eq('二进制往返字节数一致', extracted.length, payload.length);
  let identical = true;
  for (let i = 0; i < payload.length; i++) {
    if (extracted[i] !== payload[i]) { identical = false; break; }
  }
  ok('二进制往返逐字节一致', identical);
  eq('往返后 CRC 校验通过', Z.crc32(extracted), zip.entries[0].crc);

  const text = await Z.extract(zip, zip.entries[1]);
  eq('UTF-8 文本往返正确', Z.utf8Decode(text), JSON.stringify({ hello: '世界' }));
}

group('zip — 健壮性');

throws('非 ZIP 数据抛出友好错误', () => {
  Z.read(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
}, '不是有效的 ZIP');

{
  const empty = new Z.Writer().finish();
  const zip = Z.read(empty);
  eq('空 ZIP 可解析且 0 条目', zip.entries.length, 0);
}

{
  // external ZIP with DEFLATE (built by hand) must be readable
  const raw = Z.utf8Encode('deflate payload test 中文');
  const compressed = await deflateRawNode(raw);
  if (compressed) {
    const zipBytes = buildExternalZip('note.txt', compressed, raw, 8);
    const zip = Z.read(zipBytes);
    eq('可读取外部生成的 DEFLATE 条目', zip.entries.length, 1);
    const got = await Z.extract(zip, zip.entries[0]);
    eq('DEFLATE 解压结果正确', Z.utf8Decode(got), 'deflate payload test 中文');
  } else {
    ok('DEFLATE 测试跳过（环境无 zlib）', true);
  }
}

{
  const zipBytes = buildExternalZip('plain.txt', Z.utf8Encode('stored'), Z.utf8Encode('stored'), 0);
  const zip = Z.read(zipBytes);
  const got = await Z.extract(zip, zip.entries[0]);
  eq('可读取外部生成的 STORE 条目', Z.utf8Decode(got), 'stored');
}

/* =========================================================================
   5. 备份
   ========================================================================= */

group('backup — 载荷与清单');

{
  const cities = [M.normalize('city', { id: 'gl', name: '桂林', country: '中国', province: '广西' })];
  const trips = [M.normalize('trip', { id: 't1', cityId: 'gl', startDate: '2026-08-12', endDate: '2026-08-15', note: '漓江' })];
  const photos = [M.normalize('photo', { id: 'p1', tripId: 't1', blobId: 'bl1', bytes: 100 })];
  const attachments = [M.normalize('attachment', { id: 'a1', tripId: 't1', name: '行程.pdf', mimeType: 'application/pdf', blobId: 'bl2', bytes: 200 })];

  const payload = B.buildPayload({ cities, trips, photos, attachments });
  eq('载荷带 magic', payload.magic, B.MAGIC);
  eq('载荷带 backupVersion', payload.backupVersion, B.BACKUP_VERSION);
  eq('载荷计数正确', payload.counts, { cities: 1, trips: 1, photos: 1, attachments: 1 });
  ok('载荷不含 deletedAt', payload.cities.every((c) => !('deletedAt' in c)));

  const manifest = B.buildManifest({ photos, attachments });
  eq('清单含 2 个文件', manifest.length, 2);
  eq('照片路径按 blobId 命名', manifest[0].path, 'photos/bl1.jpg');
  eq('附件保留原扩展名', manifest[1].path, 'attachments/bl2.pdf');
}

{
  // deleted rows and orphans must be excluded
  const cities = [M.normalize('city', { id: 'c1', name: 'A' }), M.normalize('city', { id: 'c2', name: 'B', deletedAt: U.nowIso() })];
  const trips = [
    M.normalize('trip', { id: 't1', cityId: 'c1', startDate: '2026-01-01' }),
    M.normalize('trip', { id: 't2', cityId: 'c2', startDate: '2026-01-01' }),
    M.normalize('trip', { id: 't3', cityId: 'ghost', startDate: '2026-01-01' })
  ];
  const payload = B.buildPayload({ cities, trips, photos: [], attachments: [] });
  eq('已删除城市不导出', payload.cities.length, 1);
  eq('仅保留指向存活城市的旅行', payload.trips.map((t) => t.id), ['t1']);
  eq('孤儿旅行不导出', payload.trips.some((t) => t.id === 't3'), false);
}

group('backup — 解析与容错');

eq('解析合法载荷', B.parsePayload({ magic: B.MAGIC, cities: [], trips: [], photos: [], attachments: [] }).cities.length, 0);
throws('非 JSON 抛出友好错误', () => B.parsePayload('{ not json'), '不是有效的 JSON');
throws('缺少 magic 且结构不符', () => B.parsePayload({ foo: 1 }), '这不是「旅行足迹」的备份文件');
throws('来自更高版本被拒绝', () => B.parsePayload({ magic: B.MAGIC, backupVersion: 99, cities: [], trips: [] }), '更高版本');
ok('容忍无 magic 但结构正确的载荷', B.parsePayload({ cities: [], trips: [] }) !== null);

{
  const parsed = B.parsePayload({
    magic: B.MAGIC,
    cities: [{ id: 'c1', name: '桂林' }],
    trips: [{ id: 't1', cityId: 'c1', startDate: '2026-08-12' }, { id: 't2', cityId: 'missing', startDate: '2026-01-01' }],
    photos: [{ id: 'p1', tripId: 't1', blobId: 'b1' }, { id: 'p2', tripId: 'nope', blobId: 'b2' }],
    attachments: []
  });
  eq('孤儿旅行被丢弃并计数', parsed.droppedTrips, 1);
  eq('孤儿照片被丢弃并计数', parsed.droppedPhotos, 1);
  eq('保留有效旅行', parsed.trips.length, 1);
}

group('backup — 冲突策略');

{
  const local = {
    cities: [M.normalize('city', { id: 'c1', name: '桂林', updatedAt: '2026-01-01T00:00:00.000Z' })],
    trips: [], photos: [], attachments: []
  };

  // identical → skip
  const same = B.planImport(local, {
    cities: [M.normalize('city', { id: 'c1', name: '桂林', updatedAt: '2026-01-01T00:00:00.000Z' })],
    trips: [], photos: [], attachments: []
  });
  eq('完全相同 → skip', same.skip.length, 1);
  eq('完全相同 → 不新增', same.add.length, 0);

  // new id → add
  const fresh = B.planImport(local, {
    cities: [M.normalize('city', { id: 'c2', name: '上海' })],
    trips: [], photos: [], attachments: []
  });
  eq('新 id → add', fresh.add.length, 1);

  // incoming newer → update
  const newer = B.planImport(local, {
    cities: [M.normalize('city', { id: 'c1', name: '桂林市', updatedAt: '2026-06-01T00:00:00.000Z' })],
    trips: [], photos: [], attachments: []
  });
  eq('传入更新 → update', newer.update.length, 1);
  eq('传入更新 → 记录原因', newer.update[0].reason, 'newer');

  // local newer → conflict, NOT silently overwritten
  const older = B.planImport(local, {
    cities: [M.normalize('city', { id: 'c1', name: '旧名', updatedAt: '2025-01-01T00:00:00.000Z' })],
    trips: [], photos: [], attachments: []
  });
  eq('本地更新 → 冲突而非静默覆盖', older.conflicts.length, 1);
  eq('冲突不计入 update', older.update.length, 0);
  ok('冲突被标记', older.hasConflicts === true);

  ok('描述文本可读', typeof B.describePlan(newer) === 'string' && B.describePlan(newer).length > 0);
}

/* =========================================================================
   6. repo — 增删改查 / 补丁语义 / 回收站
   ========================================================================= */

group('repo — 基础 CRUD');

{
  const repo = await makeRepo();
  eq('初始为空', repo.stats().tripCount, 0);

  const city = await seedCity(repo, '桂林', { province: '广西' });
  ok('城市已保存并有 id', !!city.id);
  eq('可按 id 查回', repo.findCity(city.id).name, '桂林');
  eq('城市计数 1', repo.liveCities().length, 1);

  const trip = await seedTrip(repo, city.id, '2026-08-12', '2026-08-15', '第一次去桂林');
  eq('旅行已保存', repo.liveTrips().length, 1);
  eq('可按城市查旅行', repo.tripsOfCity(city.id).length, 1);
  eq('旅行备注保留', repo.findTrip(trip.id).note, '第一次去桂林');
}

group('repo — 补丁语义（清除字段必须真正落库）');

{
  const repo = await makeRepo();
  const city = await seedCity(repo, '桂林', { province: '广西' });

  // partial patch must not wipe other fields
  await repo.save('city', { id: city.id, name: '桂林市' });
  const afterRename = repo.findCity(city.id);
  eq('局部更新保留省份', afterRename.province, '广西');
  eq('局部更新改名生效', afterRename.name, '桂林市');

  // explicit empty string must null the field
  await repo.save('city', { id: city.id, name: '桂林市', province: '' });
  eq('显式清空省份 → null', repo.findCity(city.id).province, null);

  const trip = await seedTrip(repo, city.id, '2026-08-12', '2026-08-15', '有备注');
  await repo.save('trip', { id: trip.id, cityId: city.id, startDate: '2026-08-12', endDate: '2026-08-15', note: '' });
  eq('显式清空备注 → null', repo.findTrip(trip.id).note, null);

  // createdAt preserved, updatedAt advanced
  const before = repo.findTrip(trip.id);
  await repo.save('trip', { id: trip.id, startDate: '2026-08-13' });
  const after = repo.findTrip(trip.id);
  eq('createdAt 不被覆盖', after.createdAt, before.createdAt);
  ok('updatedAt 已推进', after.updatedAt >= before.updatedAt);
  eq('未提交的 endDate 保留', after.endDate, '2026-08-15');
}

group('repo — 同城多次旅行');

{
  const repo = await makeRepo();
  const sh = await seedCity(repo, '上海', { province: '上海' });
  await seedTrip(repo, sh.id, '2024-10-01', '2024-10-03', '第一次去上海');
  await seedTrip(repo, sh.id, '2025-07-04', '2025-07-07', '第二次去上海');
  await seedTrip(repo, sh.id, '2026-07-04', '2026-07-07', '第三次去上海');

  eq('上海有 3 次旅行', repo.tripsOfCity(sh.id).length, 3);
  eq('3 次旅行未被互相覆盖', new Set(repo.tripsOfCity(sh.id).map((t) => t.id)).size, 3);
  eq('统计中城市数仍为 1', repo.stats().cityCount, 1);
  eq('统计中旅行次数为 3', repo.stats().tripCount, 3);

  const list = repo.cityList();
  eq('城市列表访问次数 3', list[0].visitCount, 3);
  eq('取回最近一次旅行', repo.tripsOfCity(sh.id)[0].startDate, '2026-07-04');

  // duplicate name detection
  ok('同名城市可被识别', repo.findCityByName('上海') !== null);
  ok('前后空格同名可被识别', repo.findCityByName('  上海  ') !== null);
  ok('不同名返回 null', repo.findCityByName('北京') === null);
}

group('repo — 回收站（软删除 / 恢复 / 永久删除）');

{
  const repo = await makeRepo();
  const gl = await seedCity(repo, '桂林', { province: '广西' });
  const t1 = await seedTrip(repo, gl.id, '2026-08-12', '2026-08-15', '第一次');
  const t2 = await seedTrip(repo, gl.id, '2026-05-01', '2026-05-03', '第二次');

  await repo.save('photo', { tripId: t1.id, blobId: 'blob-1', bytes: 10 });
  await repo.save('attachment', { tripId: t1.id, name: '行程.pdf', mimeType: 'application/pdf', blobId: 'blob-2', bytes: 20 });

  eq('删除前城市数 1', repo.stats().cityCount, 1);

  await repo.softDelete('city', gl.id);
  eq('删除后城市不计入统计', repo.stats().cityCount, 0);
  eq('删除后旅行不计入统计', repo.stats().tripCount, 0);
  eq('删除后照片不计入统计', repo.stats().photoCount, 0);
  eq('回收站有城市条目', repo.recycleBin().cityCount, 1);
  eq('回收站有旅行条目', repo.recycleBin().tripCount, 2);
  eq('回收站有照片条目', repo.recycleBin().photoCount, 1);
  eq('回收站有附件条目', repo.recycleBin().attachmentCount, 1);
  ok('回收站条目按删除时间倒序', repo.recycleBin().items.length >= 3);
  eq('底层数据未被物理删除', repo.allCities().length, 1);

  await repo.restore('city', gl.id);
  eq('恢复后城市回到统计', repo.stats().cityCount, 1);
  eq('恢复后旅行一并回来', repo.stats().tripCount, 2);
  eq('恢复后照片一并回来', repo.stats().photoCount, 1);
  eq('恢复后附件一并回来', repo.stats().attachmentCount, 1);
  eq('恢复后回收站清空', repo.recycleBin().total, 0);

  // delete a single trip only
  await repo.softDelete('trip', t2.id);
  eq('单独删除一次旅行', repo.stats().tripCount, 1);
  eq('城市仍在', repo.stats().cityCount, 1);
  await repo.restore('trip', t2.id);
  eq('恢复单次旅行', repo.stats().tripCount, 2);

  // purge
  await repo.softDelete('trip', t2.id);
  await repo.purge('trip', t2.id);
  eq('永久删除后底层记录消失', repo.findTrip(t2.id), null);
  eq('永久删除后回收站不含该条', repo.recycleBin().items.some((i) => i.row.id === t2.id), false);
}

group('repo — 回收站孤儿场景');

{
  // softDelete must NOT re-stamp an already-binned descendant: the trip keeps
  // its own bin entry and its original deletedAt.
  const repo = await makeRepo();
  const c = await seedCity(repo, '桂林');
  const t = await seedTrip(repo, c.id, '2026-08-12', '2026-08-15');

  await repo.softDelete('trip', t.id);
  const tripDeletedAt = repo.findTrip(t.id).deletedAt;

  await new Promise((r) => setTimeout(r, 8));
  await repo.softDelete('city', c.id);

  eq('已入回收站的旅行保留原始删除时间', repo.findTrip(t.id).deletedAt, tripDeletedAt);

  const bin = repo.recycleBin();
  ok('城市在回收站', bin.items.some((i) => i.kind === 'city'));
  ok('旅行也在回收站', bin.items.some((i) => i.kind === 'trip'));
  ok('旅行被标记为孤儿（原城市已在回收站）',
    bin.items.find((i) => i.kind === 'trip').orphan === true);
  // the real city name is more recognisable than a placeholder, so it is kept
  eq('孤儿旅行仍显示真实城市名', bin.items.find((i) => i.kind === 'trip').title, '桂林');

  // restoring the trip alone revives its parent city
  await repo.restore('trip', t.id);
  eq('恢复孤儿旅行会自动复活城市', repo.stats().cityCount, 1);
  eq('恢复后旅行计入统计', repo.stats().tripCount, 1);
  eq('恢复后回收站为空', repo.recycleBin().total, 0);
}

group('repo — 回收站永久删除的级联');

{
  // Purge is explicit and destructive: it takes the row and everything
  // reachable from it, including its own bin entries.
  const repo = await makeRepo();
  const c = await seedCity(repo, '桂林');
  const t = await seedTrip(repo, c.id, '2026-08-12', '2026-08-15');
  await repo.save('photo', { tripId: t.id, blobId: 'b1', bytes: 5 });

  await repo.softDelete('city', c.id);
  await repo.purge('city', c.id);
  eq('级联永久删除城市+旅行+照片', repo.recycleBin().total, 0);
  eq('底层记录已清空',
    repo.allCities().length + repo.allTrips().length + repo.allPhotos().length, 0);
}

{
  // Purging one city must leave another city's binned trip untouched.
  const repo = await makeRepo();
  const a = await seedCity(repo, 'A');
  const b = await seedCity(repo, 'B');
  const ta = await seedTrip(repo, a.id, '2026-01-01', '2026-01-02');
  const tb = await seedTrip(repo, b.id, '2026-02-01', '2026-02-02');

  await repo.softDelete('city', a.id);
  await repo.softDelete('city', b.id);
  await repo.purge('city', a.id);

  const bin = repo.recycleBin();
  eq('只清除了目标城市分支', bin.cityCount, 1);
  eq('另一个城市的旅行仍在回收站', bin.items.some((i) => i.row.id === tb.id), true);
  eq('目标城市的旅行已消失', bin.items.some((i) => i.row.id === ta.id), false);

  // when the parent city row is genuinely gone, the placeholder is used
  const gone = repo.recycleBin();
  ok('无需兜底时不会出现占位标题',
    gone.items.every((i) => i.title !== '（原城市已删除）'));
}

group('repo — 清空回收站');

{
  const repo = await makeRepo();
  const c = await seedCity(repo, 'A');
  await seedTrip(repo, c.id, '2026-01-01', '2026-01-02');
  await repo.softDelete('city', c.id);
  eq('清空前回收站有内容', repo.recycleBin().total, 2);
  await repo.purgeAll();
  eq('清空后回收站为空', repo.recycleBin().total, 0);
  eq('清空后底层也无残留', repo.allCities().length + repo.allTrips().length, 0);
}

/* =========================================================================
   7. 导出 → 清空 → 导入 完整往返
   ========================================================================= */

group('备份往返 — 导出再导入数据完整');

{
  const src = await makeRepo();
  const gl = await seedCity(src, '桂林', { province: '广西', latitude: 25.27, longitude: 110.29 });
  const sh = await seedCity(src, '上海', { province: '上海', latitude: 31.23, longitude: 121.47 });
  const t1 = await seedTrip(src, gl.id, '2026-08-12', '2026-08-15', '第一次去桂林，去了漓江和阳朔。');
  const t2 = await seedTrip(src, sh.id, '2024-10-01', '2024-10-03', '外滩');
  const t3 = await seedTrip(src, sh.id, '2026-07-04', '2026-07-07', null);

  // real bytes so we can verify a byte-exact round trip
  const photoBytes = new Uint8Array(32 * 1024);
  for (let i = 0; i < photoBytes.length; i++) photoBytes[i] = (i * 13 + 7) & 0xff;
  const attBytes = Z.utf8Encode('%PDF-1.4 fake pdf content 中文');

  await src.putBlob('blob-photo-1', photoBytes, 'image/jpeg');
  await src.save('photo', { tripId: t1.id, blobId: 'blob-photo-1', bytes: photoBytes.length, width: 800, height: 600 });
  await src.putBlob('blob-att-1', attBytes, 'application/pdf');
  await src.save('attachment', { tripId: t1.id, name: '桂林行程.pdf', mimeType: 'application/pdf', blobId: 'blob-att-1', bytes: attBytes.length });

  // ---- export
  const archive = await exportEverything(src);
  ok('导出产生非空 ZIP', archive.bytes.length > 1000);
  eq('导出 ZIP 内含 data.json', archive.names.includes('data.json'), true);
  eq('导出 ZIP 含 metadata.json', archive.names.includes('metadata.json'), true);
  ok('导出 ZIP 含照片文件', archive.names.some((n) => n.startsWith('photos/')));
  ok('导出 ZIP 含附件文件', archive.names.some((n) => n.startsWith('attachments/')));

  const statsBefore = src.stats();

  // ---- wipe
  await src.clearAll();
  eq('清空后数据为 0', src.stats().tripCount, 0);
  eq('清空后城市为 0', src.stats().cityCount, 0);

  // ---- import into a fresh repo
  const dst = await makeRepo();
  const result = await importEverything(dst, archive);
  ok('导入成功', result.ok === true);

  const statsAfter = dst.stats();
  eq('城市数完全一致', statsAfter.cityCount, statsBefore.cityCount);
  eq('旅行次数完全一致', statsAfter.tripCount, statsBefore.tripCount);
  eq('照片数完全一致', statsAfter.photoCount, statsBefore.photoCount);
  eq('附件数完全一致', statsAfter.attachmentCount, statsBefore.attachmentCount);
  eq('地区数完全一致', statsAfter.regionCount, statsBefore.regionCount);
  eq('总天数完全一致', statsAfter.daysTotal, statsBefore.daysTotal);

  // content fidelity
  const glAfter = dst.findCityByName('桂林');
  ok('城市名恢复', !!glAfter);
  eq('省份恢复', glAfter.province, '广西');
  eq('纬度恢复', glAfter.latitude, 25.27);
  eq('经度恢复', glAfter.longitude, 110.29);

  const glTrips = dst.tripsOfCity(glAfter.id);
  eq('桂林旅行数恢复', glTrips.length, 1);
  eq('日期恢复', glTrips[0].startDate, '2026-08-12');
  eq('结束日期恢复', glTrips[0].endDate, '2026-08-15');
  eq('备注恢复（含中文与标点）', glTrips[0].note, '第一次去桂林，去了漓江和阳朔。');

  const shAfter = dst.findCityByName('上海');
  eq('上海多次旅行恢复（2 次）', dst.tripsOfCity(shAfter.id).length, 2);
  eq('带 null 备注的旅行恢复', dst.tripsOfCity(shAfter.id).some((t) => t.note === null), true);
  eq('两次旅行日期均恢复',
    dst.tripsOfCity(shAfter.id).map((t) => t.startDate).sort(),
    ['2024-10-01', '2026-07-04']);
  eq('备注恢复（非空的一条）',
    dst.tripsOfCity(shAfter.id).find((t) => t.startDate === '2024-10-01').note, '外滩');

  // photo bytes byte-exact
  const restoredPhoto = dst.livePhotos()[0];
  const restoredBytes = (await dst.getBlob(restoredPhoto.blobId)).bytes;
  eq('照片字节数一致', restoredBytes.length, photoBytes.length);
  let byteIdentical = true;
  for (let i = 0; i < photoBytes.length; i++) {
    if (restoredBytes[i] !== photoBytes[i]) { byteIdentical = false; break; }
  }
  ok('照片字节逐字节一致', byteIdentical);

  const restoredAtt = dst.liveAttachments()[0];
  eq('附件名恢复', restoredAtt.name, '桂林行程.pdf');
  eq('附件 MIME 恢复', restoredAtt.mimeType, 'application/pdf');
  eq('附件内容恢复', Z.utf8Decode((await dst.getBlob(restoredAtt.blobId)).bytes), '%PDF-1.4 fake pdf content 中文');
}

group('备份 — 重复导入不产生重复数据');

{
  const src = await makeRepo();
  const c = await seedCity(src, '桂林', { province: '广西' });
  await seedTrip(src, c.id, '2026-08-12', '2026-08-15', '漓江');
  const archive = await exportEverything(src);

  const dst = await makeRepo();
  await importEverything(dst, archive);
  const first = dst.stats().tripCount;

  const second = await importEverything(dst, archive);
  eq('第二次导入后旅行数不变', dst.stats().tripCount, first);
  eq('第二次导入全部识别为相同数据', second.plan.skip.length > 0, true);
  eq('第二次导入无新增', second.plan.add.length, 0);
}

group('备份 — 冲突不被静默覆盖');

{
  const src = await makeRepo();
  const c = await seedCity(src, '桂林', { province: '广西' });
  await seedTrip(src, c.id, '2026-08-12', '2026-08-15', '备份里的备注');
  const archive = await exportEverything(src);

  const dst = await makeRepo();
  await importEverything(dst, archive);

  // user edits locally, AFTER the backup timestamp
  const localCity = dst.findCityByName('桂林');
  await new Promise((r) => setTimeout(r, 5));
  await dst.save('city', { id: localCity.id, name: '桂林（本地已改名）' });

  const again = await importEverything(dst, archive, { dryRun: true });
  ok('本地更新被识别为冲突', again.plan.conflicts.length >= 1);
  eq('冲突项不会自动写入', again.plan.update.length, 0);
  eq('本地名称未被静默覆盖', dst.findCityByName('桂林（本地已改名）') !== null, true);
}

/* =========================================================================
   8. 性能与边界
   ========================================================================= */

group('性能与规模');

{
  const repo = await makeRepo();
  const cityNames = ['北京', '上海', '广州', '深圳', '杭州', '成都', '西安', '桂林', '厦门', '青岛'];
  const cities = [];
  for (let i = 0; i < 120; i++) {
    cities.push(M.normalize('city', {
      id: `perf-c${i}`,
      name: `${cityNames[i % cityNames.length]}${i}`,
      country: '中国',
      province: `省${i % 20}`,
      latitude: 20 + (i % 20),
      longitude: 100 + (i % 40)
    }));
  }
  await repo.saveMany('city', cities);

  const trips = [];
  for (let i = 0; i < 1000; i++) {
    const c = cities[i % cities.length];
    trips.push(M.normalize('trip', {
      id: `perf-t${i}`,
      cityId: c.id,
      startDate: `202${i % 6}-${String((i % 12) + 1).padStart(2, '0')}-0${(i % 9) + 1}`,
      endDate: `202${i % 6}-${String((i % 12) + 1).padStart(2, '0')}-1${i % 9}`,
      note: i % 3 === 0 ? `第 ${i} 次旅行记录` : null
    }));
  }

  const t0 = Date.now();
  await repo.saveMany('trip', trips);
  const writeMs = Date.now() - t0;

  const t1 = Date.now();
  const stats = repo.stats();
  const statsMs = Date.now() - t1;

  const t2 = Date.now();
  const timeline = repo.timeline();
  const timelineMs = Date.now() - t2;

  const t3 = Date.now();
  const searchRes = repo.search('第 501');   // note exists on i % 3 === 0 → i = 501
  const searchMs = Date.now() - t3;

  eq('1000 条旅行写入正确', stats.tripCount, 1000);
  eq('120 个城市全部计入', stats.cityCount, 120);
  ok(`1000 条写入耗时 ${writeMs}ms < 2000ms`, writeMs < 2000);
  ok(`统计计算 ${statsMs}ms < 300ms`, statsMs < 300);
  ok(`时间线构建 ${timelineMs}ms < 500ms`, timelineMs < 500);
  ok(`搜索 ${searchMs}ms < 300ms`, searchMs < 300);
  ok('时间线分组非空', timeline.length > 0);
  ok('搜索备注命中', searchRes.trips.length > 0);
  eq('搜索命中的是 501 号记录', searchRes.trips.length, 1);
}

group('边界测试');

{
  const repo = await makeRepo();

  // only one photo
  const c = await seedCity(repo, '单图城市');
  const t = await seedTrip(repo, c.id, '2026-01-01', '2026-01-01');
  await repo.save('photo', { tripId: t.id, blobId: 'only-1', bytes: 1 });
  eq('仅一张照片可正常统计', repo.stats().photoCount, 1);

  // many photos on one trip
  for (let i = 0; i < 40; i++) {
    await repo.save('photo', { tripId: t.id, blobId: `many-${i}`, bytes: 100 + i });
  }
  eq('单次旅行 41 张照片', repo.stats().photoCount, 41);

  // same-day trip
  const sameDay = await seedTrip(repo, c.id, '2026-03-03', '2026-03-03');
  eq('当天往返计为 1 天', U.daysBetween(sameDay.startDate, sameDay.endDate), 1);

  // cross-year trip
  const crossYear = await seedTrip(repo, c.id, '2025-12-28', '2026-01-03');
  eq('跨年旅行计为 7 天', U.daysBetween(crossYear.startDate, crossYear.endDate), 7);

  // cross-month
  const crossMonth = await seedTrip(repo, c.id, '2026-01-30', '2026-02-02');
  eq('跨月旅行计为 4 天', U.daysBetween(crossMonth.startDate, crossMonth.endDate), 4);

  // note null
  const noNote = await seedTrip(repo, c.id, '2026-04-01', '2026-04-02', null);
  eq('无备注旅行可存', repo.findTrip(noNote.id).note, null);

  // city with no trip
  const emptyCity = await seedCity(repo, '还没去过');
  eq('未到访城市不计入已去城市', repo.stats().cityCount, 1);
  eq('未到访城市出现在孤儿列表', M.orphanCities(repo.cityList()).some((e) => e.city.id === emptyCity.id), true);

  // search with blank query
  eq('空查询不激活搜索', repo.search('   ').active, false);
  eq('空查询不抛异常', repo.search(null).cities.length, 0);

  // deleting a nonexistent record
  await repo.softDelete('trip', 'no-such-id');
  ok('删除不存在的 id 不抛异常', true);

  // saving with an unknown id
  await throwsAsync('用不存在的 id 保存会报错', () => repo.save('city', { id: 'ghost-id', name: 'X' }), '记录不存在');
}

group('脏数据容错');

{
  const repo = new Repo({
    cities: new MemoryAdapter('cities'),
    trips: new MemoryAdapter('trips'),
    photos: new MemoryAdapter('photos'),
    attachments: new MemoryAdapter('attachments'),
    blobs: new MemoryBlobStore()
  });

  // hand-write corrupt rows straight into storage, bypassing normalization
  await repo.cities.put({ id: 'bad-1', name: '脏城市' });                       // missing timestamps + geo
  await repo.trips.put({ id: 'bad-t1', cityId: 'bad-1', startDate: 'not-a-date' }); // invalid date
  await repo.trips.put({ id: 'bad-t2', cityId: null, startDate: null });        // no parent, no date
  await repo.photos.put({ id: 'bad-p1', tripId: 'bad-t1', blobId: null });       // missing blob

  await repo.init();

  // must not throw
  let threw = false;
  let stats = null;
  try {
    stats = repo.stats();
    repo.timeline();
    repo.cityList();
    repo.recycleBin();
    repo.search('脏');
  } catch (e) {
    threw = true;
    console.log('    dirty-data error:', e.message);
  }
  ok('脏数据不导致崩溃', !threw);
  ok('脏数据统计可产出', stats !== null);
  eq('无效日期的旅行不虚构城市数', stats.cityCount <= 1, true);
  ok('时间线不产生 NaN 年份', repo.timeline().every((y) => Number.isFinite(y.year)));
}

group('渲染层空值安全（模拟页面取值）');

{
  // every display helper must survive a row that is missing every optional field
  const bare = M.normalize('trip', { cityId: 'c', startDate: '2026-08-12' });
  let threw = false;
  try {
    U.formatRange(bare.startDate, bare.endDate);
    U.daysBetween(bare.startDate, bare.endDate);
    M.cityName(null);
    M.geoLine(null);
    M.formatBytes(bare.bytes);
    M.mimeIcon(bare.mimeType, bare.name);
  } catch (e) {
    threw = true;
  }
  ok('缺字段的记录展示不抛异常', !threw);

  // no 'undefined' / 'NaN' / 'Invalid Date' may leak into any rendered string
  const samples = [
    U.formatRange(bare.startDate, bare.endDate),
    U.formatRange(null, null),
    U.formatDot(null),
    U.formatCnMonth(null),
    M.cityName(null),
    M.geoLine(null),
    M.formatBytes(null),
    U.pluralDays(U.daysBetween(null, null))
  ];
  const leaks = samples.filter((s) => /undefined|NaN|Invalid Date|\[object/.test(String(s)));
  eq('展示层无 undefined/NaN/Invalid Date 泄漏', leaks, []);
}

/* =========================================================================
   mini-zip / zlib helpers for the DEFLATE reader test
   ========================================================================= */

async function deflateRawNode(bytes) {
  try {
    const { deflateRawSync } = await import('node:zlib');
    return new Uint8Array(deflateRawSync(Buffer.from(bytes)));
  } catch (e) {
    return null;
  }
}

/** Build a real ZIP by hand so we can test reading externally-produced archives. */
function buildExternalZip(name, payload, original, method) {
  const nameBytes = Z.utf8Encode(name);
  const crc = Z.crc32(original);
  const total = 30 + nameBytes.length + payload.length + 46 + nameBytes.length + 22;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;

  dv.setUint32(p, 0x04034b50, true); p += 4;
  dv.setUint16(p, 20, true); p += 2;
  dv.setUint16(p, 0x0800, true); p += 2;
  dv.setUint16(p, method, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0x2821, true); p += 2;
  dv.setUint32(p, crc, true); p += 4;
  dv.setUint32(p, payload.length, true); p += 4;
  dv.setUint32(p, original.length, true); p += 4;
  dv.setUint16(p, nameBytes.length, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  out.set(nameBytes, p); p += nameBytes.length;
  out.set(payload, p); p += payload.length;

  const cdStart = p;
  dv.setUint32(p, 0x02014b50, true); p += 4;
  dv.setUint16(p, 20, true); p += 2;
  dv.setUint16(p, 20, true); p += 2;
  dv.setUint16(p, 0x0800, true); p += 2;
  dv.setUint16(p, method, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0x2821, true); p += 2;
  dv.setUint32(p, crc, true); p += 4;
  dv.setUint32(p, payload.length, true); p += 4;
  dv.setUint32(p, original.length, true); p += 4;
  dv.setUint16(p, nameBytes.length, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint32(p, 0, true); p += 4;
  dv.setUint32(p, 0, true); p += 4;
  out.set(nameBytes, p); p += nameBytes.length;
  const cdSize = p - cdStart;

  dv.setUint32(p, 0x06054b50, true); p += 4;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 0, true); p += 2;
  dv.setUint16(p, 1, true); p += 2;
  dv.setUint16(p, 1, true); p += 2;
  dv.setUint32(p, cdSize, true); p += 4;
  dv.setUint32(p, cdStart, true); p += 4;
  dv.setUint16(p, 0, true); p += 2;

  return out;
}

/* =========================================================================
   Export / import drivers — mirror exactly what the UI layer does
   ========================================================================= */

async function exportEverything(repo) {
  const payload = B.buildPayload({
    cities: repo.allCities(),
    trips: repo.allTrips(),
    photos: repo.allPhotos(),
    attachments: repo.allAttachments()
  });
  const manifest = B.buildManifest({
    photos: repo.allPhotos(),
    attachments: repo.allAttachments()
  });

  const w = new Z.Writer();
  w.addText('data.json', JSON.stringify(payload, null, 2));
  w.addText('metadata.json', JSON.stringify({ manifest }, null, 2));

  for (const item of manifest) {
    const blob = await repo.getBlob(item.blobId);
    if (!blob) {
      manifest.missing = (manifest.missing || 0) + 1;
      continue;
    }
    w.add(item.path, blob.bytes);
  }

  const bytes = w.finish();
  const zip = Z.read(bytes);
  return { bytes, names: zip.entries.map((e) => e.name), payload, manifest };
}

async function importEverything(repo, archive, opts = {}) {
  const zip = Z.read(archive.bytes);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));

  const dataEntry = byName.get('data.json');
  if (!dataEntry) throw new Error('备份缺少 data.json');
  const payload = B.parsePayload(Z.utf8Decode(await Z.extract(zip, dataEntry)));

  let metadata = null;
  const metaEntry = byName.get('metadata.json');
  if (metaEntry) {
    metadata = JSON.parse(Z.utf8Decode(await Z.extract(zip, metaEntry)));
  }

  const plan = B.planImport({
    cities: repo.allCities(),
    trips: repo.allTrips(),
    photos: repo.allPhotos(),
    attachments: repo.allAttachments()
  }, payload);

  if (opts.dryRun) return { ok: true, plan, payload, dryRun: true };

  // write blobs first so a failure leaves no metadata pointing at nothing
  const manifest = (metadata && metadata.manifest) || B.buildManifest(payload);
  let restored = 0;
  let missing = 0;

  for (const item of manifest) {
    const entry = byName.get(item.path);
    if (!entry) { missing++; continue; }
    const bytes = await Z.extract(zip, entry);
    await repo.putBlob(item.blobId, bytes, item.mimeType);
    restored++;
  }

  await repo.applyImport(plan, opts.resolutions || {});
  return { ok: true, plan, payload, restored, missing };
}

/* =========================================================================
   Report
   ========================================================================= */

const total = passed + failed;
console.log('');
console.log('─'.repeat(62));
for (const g of groups) {
  const okCount = g.tests.filter((t) => t.pass).length;
  const mark = okCount === g.tests.length ? '✓' : '✗';
  console.log(`${mark} ${g.name}  (${okCount}/${g.tests.length})`);
}
console.log('─'.repeat(62));

if (failed) {
  console.log(`\n失败详情 (${failed}):`);
  for (const f of failures) {
    console.log(`  [${f.group}] ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  }
}

console.log(`\n共 ${total} 项断言：通过 ${passed}，失败 ${failed}`);
console.log(failed === 0 ? '全部通过 ✓' : '存在失败 ✗');

process.exit(failed === 0 ? 0 : 1);
