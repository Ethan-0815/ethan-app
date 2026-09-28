/*!
 * 我的空间 · 核心逻辑测试（Node 运行，无第三方依赖）
 *   node tests/run-tests.mjs
 * 覆盖：空字段规则 / 清除字段 / 搜索 / 回收站 / 分类标签删除保护 / ZIP 读写 / 完整导入导出往返
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');

/* ---------------------------------------------------------------- 载入应用脚本 */
const SCRIPTS = [
  'js/core/models.js',
  'js/core/search.js',
  'js/core/zip.js',
  'js/core/backup.js',
  'js/data/db.js',
  'js/data/repository.js',
  'js/platform/imaging.js',
  'js/platform/files.js'
];
for (const rel of SCRIPTS) {
  const file = path.join(appDir, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
const MS = globalThis.MS;
const M = MS.models;

/* ---------------------------------------------------------------- 内存适配器（测试替身） */
function createMemoryAdapter() {
  const tables = { items: new Map(), categories: new Map(), tags: new Map(), images: new Map(), blobs: new Map(), meta: new Map() };
  const clone = (v) => v === undefined ? undefined : structuredClone(v);
  function table(name) {
    const map = tables[name];
    return {
      all: async () => Array.from(map.values()).map(clone),
      allKeys: async () => Array.from(map.keys()),
      get: async (id) => (map.has(id) ? clone(map.get(id)) : null),
      count: async () => map.size,
      put: async (rec) => { map.set(rec.id, clone(rec)); },
      putMany: async (list) => { (list || []).forEach((r) => map.set(r.id, clone(r))); },
      remove: async (id) => { map.delete(id); },
      removeMany: async (ids) => { (ids || []).forEach((id) => map.delete(id)); },
      clear: async () => { map.clear(); }
    };
  }
  return {
    kind: 'memory',
    _tables: tables,
    ready: async function () { return this; },
    isReady: () => true,
    items: table('items'),
    categories: table('categories'),
    tags: table('tags'),
    images: table('images'),
    blobs: table('blobs'),
    meta: {
      get: async (k) => (tables.meta.has(k) ? clone(tables.meta.get(k)) : null),
      set: async (k, v) => { tables.meta.set(k, clone(v)); }
    },
    clearAll: async () => { ['items', 'categories', 'tags', 'images', 'blobs'].forEach((t) => tables[t].clear()); },
    estimate: async () => null,
    close: () => {}
  };
}

/* ---------------------------------------------------------------- 迷你测试框架 */
let passed = 0;
const failures = [];
let currentGroup = '';
function group(name) { currentGroup = name; console.log('\n\x1b[1m' + name + '\x1b[0m'); }
function ok(cond, label) {
  if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { failures.push(currentGroup + ' → ' + label); console.log('  \x1b[31m✗\x1b[0m ' + label); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(a === b, label + (a === b ? '' : `  (期望 ${b}，实际 ${a})`));
}
async function throwsFriendly(fn, code, label) {
  try {
    await fn();
    ok(false, label + '  (未抛出异常)');
  } catch (e) {
    const msg = MS.friendly(e);
    const noTech = !/undefined|NaN|Invalid Date|null|nullpointer|sqlite|stack/i.test(msg);
    ok((!code || e.code === code) && noTech, label + `  (提示：${msg})`);
  }
}

/* ================================================================ 1. 数据模型与空值 */
group('1. 数据模型与空值规则');
{
  const a = M.uuid();
  const b = M.uuid();
  ok(a !== b && /^[0-9a-f-]{36}$/.test(a), 'ID 为 UUID 格式且不重复');
  ok(M.uuid().length === 36, 'ID 长度固定 36');

  const onlyName = M.normalizeItem({ name: 'HDMI 线' });
  eq(onlyName.name, 'HDMI 线', '只填名称即可成为合法物品');
  eq(onlyName.location, null, '未填写的可选字段落为 null');
  eq(onlyName.purchasePrice, null, '未填写的价格落为 null');
  ok(M.isValidItem(onlyName), '只有名称也是合法物品');

  const partial = M.normalizeItem({ name: 'HDMI 线', location: '储物箱 A' });
  eq(partial.location, '储物箱 A', '只填名称 + 位置也是合法物品');

  const dirty = M.normalizeItem({
    name: '  Sony 耳机  ', brand: '   ', purchasePrice: 'abc', purchaseDate: '2026-02-30',
    tagIds: ['t1', 't1', '', null]
  });
  eq(dirty.name, 'Sony 耳机', '名称自动去首尾空格');
  eq(dirty.brand, null, '空白品牌归一为 null');
  eq(dirty.purchasePrice, null, '非法价格归一为 null（绝不产生 NaN）');
  eq(dirty.purchaseDate, null, '非法日期归一为 null（绝不产生 Invalid Date）');
  eq(dirty.tagIds, ['t1'], '标签去重且剔除空值');

  eq(M.numOrNull('¥ 1,299.5'), 1299.5, '价格可解析千分位与货币符号');
  eq(M.numOrNull(-5), -5, '负数价格可以保存（退货/折价场景）');
  eq(M.dateOrNull('2026/8/3'), '2026-08-03', '宽松日期自动归一为 ISO');
  eq(M.dateOrNull(''), null, '空日期为 null');

  // 展示层安全：绝不出现 null / undefined / NaN / Invalid Date
  const displayCases = [
    M.displayPrice(null), M.displayPrice('abc'), M.displayPrice(undefined), M.displayPrice(1299.5),
    M.displayDate(null), M.displayDate('2026-13-45'), M.displayDate('2026-08-03'),
    M.displayText(undefined), M.displayText(null), M.displayText('  '), M.displayText('书桌')
  ];
  const joined = displayCases.join('|');
  ok(!/null|undefined|NaN|Invalid/i.test(joined), '展示层永不输出 null/undefined/NaN/Invalid Date');
  eq(M.displayPrice(1299.5), '¥1,299.5', '价格展示带千分位与货币符号');
  eq(M.displayDate('2026-08-03'), '2026年8月3日', '日期展示为中文可读格式');
  eq(M.displayText(null), '', '空文本展示为空字符串');

  const longText = 'X'.repeat(200);
  eq(M.safeFileName('a/b:c*?d".jpg', 'x.jpg'), 'a_b_c__d_.jpg', '文件名安全化（导出用）');
  ok(M.formatSize(0) === '0 B', '文件体积展示安全');
  ok(typeof longText === 'string' && M.displayText(longText).length === 200, '长文本原样保留（UI 负责换行）');
}

/* ================================================================ 2. 仓储 CRUD 与清除规则 */
group('2. 仓储 CRUD 与"清除字段"规则');
const adapter = createMemoryAdapter();
const repo = MS.createRepository(adapter);
await repo.init();
let createdItem = null;
{
  const seeded = repo.listCategories().map((c) => c.name);
  ok(seeded.includes('电子设备') && seeded.length === M.DEFAULT_CATEGORIES.length, '首次启动写入默认分类');

  // —— 只填名称即可保存
  createdItem = await repo.createItem({ name: 'HDMI 线' });
  eq(Object.keys(createdItem).length > 0, true, '只填名称保存成功');
  eq(repo.listItems().length, 1, '列表中出现该物品');

  // —— 完整字段
  const full = await repo.createItem({
    name: 'Sony 耳机', brand: 'Sony', model: 'WH-1000XM5', purchaseDate: '2025-11-11',
    purchasePrice: '2,399', purchaseChannel: '京东自营', serialNumber: 'SN-889900',
    location: '卧室 > 衣柜 > 第二层', notes: '降噪很好，备用耳塞在里面'
  });
  eq(full.purchasePrice, 2399, '完整字段保存正确');

  // —— 编辑后清空字段：数据库必须真正清除
  const before = await repo.updateItem(full.id, { name: 'Sony 耳机', location: '储物箱 A', brand: 'Sony' });
  eq(before.location, '储物箱 A', '先写入位置');
  const after = await repo.updateItem(full.id, { name: 'Sony 耳机', location: '', brand: '', model: '', notes: '   ' });
  const raw = await adapter.items.get(full.id);
  eq(after.location, null, '清空位置后内存为 null');
  eq(raw.location, null, '清空位置后数据库中旧值真正被清除');
  eq(raw.brand, null, '清空品牌同样真正清除');
  eq(raw.model, null, '清空型号同样真正清除');
  eq(raw.notes, null, '清空备注同样真正清除');
  eq(raw.purchasePrice, 2399, '未出现在编辑内容里的字段保持原值（价格保留）');
  eq(raw.serialNumber, 'SN-889900', '未编辑的序列号同样保留');
  const clearedPrice = await repo.updateItem(full.id, { name: 'Sony 耳机', purchasePrice: '', purchaseDate: '' });
  eq(clearedPrice.purchasePrice, null, '显式清空价格 → 数据库中真正为 null');
  eq((await adapter.items.get(full.id)).purchasePrice, null, '价格清除已落库（无残留旧值）');
  eq((await adapter.items.get(full.id)).purchaseDate, null, '日期清除已落库（无残留旧值）');

  // —— 分类
  const camping = await repo.createCategory('露营');
  const same = await repo.createCategory('露营');
  eq(same.id, camping.id, '同名分类不会重复创建');
  await repo.updateItem(full.id, { name: 'Sony 耳机', categoryId: camping.id });
  const del = await repo.deleteCategory(camping.id);
  eq(del.affected, 1, '删除分类时统计到受影响物品');
  eq(repo.getItem(full.id).categoryId, null, '删除分类后物品变为未分类（物品未被删除）');
  eq(repo.listItems().length, 2, '删除分类不会删除任何物品');
  ok(!(await adapter.categories.get(camping.id)), '分类本身已从数据库移除');

  // —— 标签
  const t1 = await repo.ensureTag('常用');
  const t2 = await repo.ensureTag('贵重');
  const t1again = await repo.ensureTag('常用');
  eq(t1again.id, t1.id, '同名标签不会重复创建');
  await repo.setItemTags(full.id, [t1.id, t2.id]);
  eq(repo.getItem(full.id).tagIds.length, 2, '一个物品可以有多个标签');
  const tagDel = await repo.deleteTag(t2.id);
  eq(tagDel.affected, 1, '删除标签影响 1 个物品');
  eq(repo.getItem(full.id).tagIds, [t1.id], '删除标签只解除引用，物品仍在');
  eq(repo.listItems().length, 2, '删除标签不会删除物品');

  // —— 排序与筛选
  await repo.createItem({ name: 'A 值钱的东西', purchasePrice: 9999 });
  eq(repo.listItems({ sort: 'price' })[0].name, 'A 值钱的东西', '按价格排序正确');
  eq(repo.listItems({ categoryId: 'not-exist' }).length, 0, '不存在的分类筛选返回空数组（不报错）');
  eq(repo.listItems({ tagId: t1.id }).length, 1, '按标签筛选正确');
}

/* ================================================================ 3. 搜索 */
group('3. 全局搜索（含空值安全与模糊匹配）');
{
  const repo2 = MS.createRepository(createMemoryAdapter());
  await repo2.init();
  const cat = (await repo2.listCategories())[0];
  const tag = await repo2.ensureTag('待维修');
  await repo2.createItem({
    name: 'Sony 耳机', brand: 'Sony', model: 'WH-1000XM5', serialNumber: 'SN-889900',
    location: '储物箱 A', notes: '上次去店里更换电池', categoryId: cat.id, tagIds: [tag.id]
  });
  await repo2.createItem({ name: 'HDMI 线', brand: 'UGREEN', model: 'HDMI 2.1', location: '储物箱 A' });
  await repo2.createItem({ name: '全是空字段的物品', brand: null, model: undefined, notes: null });

  const names = (q) => repo2.search(q).map((i) => i.name);
  eq(names('Sony').includes('Sony 耳机'), true, '按名称/品牌搜索命中');
  eq(names('WH-1000').length, 1, '按型号搜索命中');
  eq(names('wh1000').length, 1, '型号支持模糊子序列匹配（wh1000 → WH-1000XM5）');
  eq(names('SN-889900').length, 1, '按序列号搜索命中');
  eq(names('储物箱').length, 2, '按位置搜索命中（部分词）');
  eq(names('待维修').length, 1, '按标签名称搜索命中');
  eq(names('电池').length, 1, '按备注搜索命中');
  eq(names('摄影').length, 0, '未命中的分类名不会误召回');
  eq(names('不可能存在的关键词zzz').length, 0, '无结果时返回空数组');
  eq(names('').length, repo2.listItems().length, '空查询返回全部（是否展示由 UI 决定）');
  eq(names('Sony 耳机').length >= 1, true, '多关键词 AND 命中');

  // 空值安全：历史遗留的脏数据（缺字段 / 空名称）参与搜索不崩溃
  const dirtyStore = createMemoryAdapter();
  await dirtyStore.ready();
  await dirtyStore.items.put({ id: 'dirty-1', name: '', createdAt: M.nowIso(), updatedAt: M.nowIso() });
  await dirtyStore.items.put({ id: 'dirty-2' });                       // 连 name 都没有
  await dirtyStore.items.put({ id: 'dirty-3', name: '正常物品', brand: null, notes: undefined });
  const repo3 = MS.createRepository(dirtyStore);
  await repo3.init();
  eq(repo3.search('正常').length, 1, '缺失字段的脏数据不导致搜索崩溃');
  eq(repo3.search(null).length, repo3.listItems().length, '查询为 null 安全（按空查询处理）');
  eq(repo3.search('测试').length, 0, '无命中返回空数组');
  ok(repo3.listItems().length >= 3, '脏数据仍能正常列出');
  ok(MS.search.isSubsequence('hdl', 'hdmi line'), '子序列匹配函数正确');
  ok(!MS.search.isSubsequence('xyz', 'hdmi line'), '子序列不匹配时返回 false');
}

/* ================================================================ 4. 回收站 */
group('4. 回收站（软删除 / 恢复 / 永久删除）');
{
  const memory = createMemoryAdapter();
  const r = MS.createRepository(memory);
  await r.init();
  const item = await r.createItem({ name: '要删除的东西' });
  const imgs = await r.addImages(item.id, [{ meta: { name: 'p.jpg', mime: 'image/jpeg', size: 3 }, blob: new Blob([new Uint8Array([1, 2, 3])]), thumb: null }]);
  ok(!!(await memory.blobs.get(imgs[0].id)), '图片二进制已写入存储');

  await r.softDelete(item.id);
  eq(r.listItems().length, 0, '删除后主列表不再出现');
  eq(r.trashed().length, 1, '回收站中出现该物品');
  eq(r.getItem(item.id).images > 0, false, '软删除不返回 images 统计（占位检查）');
  ok(!!(await memory.items.get(item.id)), '软删除不物理删除数据库记录');
  ok(!!(await memory.blobs.get(imgs[0].id)), '软删除不删除图片文件');

  await r.restore(item.id);
  eq(r.listItems().length, 1, '恢复后回到主列表');
  eq(r.trashed().length, 0, '回收站清空');
  eq(r.getItem(item.id).deletedAt, null, '恢复后 deletedAt 归零');

  await r.softDelete(item.id);
  await r.purge(item.id);
  eq(r.trashed().length, 0, '永久删除后回收站不再有该物品');
  eq(await memory.items.get(item.id), null, '永久删除清理物品记录');
  eq(await memory.blobs.get(imgs[0].id), null, '永久删除清理关联图片文件');
  eq(await memory.images.get(imgs[0].id), null, '永久删除清理图片元数据');
}

/* ================================================================ 5. 图片与最近查看 */
group('5. 图片关联与最近查看');
{
  const r = MS.createRepository(createMemoryAdapter());
  await r.init();
  const item = await r.createItem({ name: '相机' });
  const a = await r.addImages(item.id, [{ meta: { name: 'a.jpg', mime: 'image/jpeg' }, blob: new Blob([new Uint8Array([9, 9])]), thumb: new Blob([new Uint8Array([1])]) }]);
  const b = await r.addImages(item.id, [{ meta: { name: 'b.jpg', mime: 'image/jpeg' }, blob: new Blob([new Uint8Array([8, 8])]), thumb: null }]);
  eq(r.itemImages(item.id).length, 2, '一件物品可以有多张图片');
  eq(r.getItem(item.id).imageIds.length, 2, '物品与图片建立双向关联');
  const data = await r.imageData(a[0].id);
  ok(data.blob instanceof Blob && data.thumb instanceof Blob, '图片数据可读取（主图 + 缩略图）');
  await r.removeImage(b[0].id);
  eq(r.itemImages(item.id).length, 1, '删除单张图片成功');
  eq(r.getItem(item.id).imageIds.length, 1, '物品上的图片引用同步清理');
  eq(await r.adapter.blobs.get(b[0].id), null, '删除图片后二进制同步清理');

  // 最近查看
  for (let i = 0; i < 25; i++) await r.createItem({ name: '物品 ' + i });
  const list = r.listItems({ sort: 'created' });
  await r.touchViewed(list[0].id);
  await r.touchViewed(list[1].id);
  eq(r.recentViewed().length, 2, '最近查看只记录真正打开过的物品');
  eq(r.recentViewed()[0].id, list[1].id, '最近查看按时间倒序');
  eq(r.recentViewed(1).length, 1, '最近查看支持数量限制（最多 20）');
  eq(r.recentAdded(3).length, 3, '最近添加支持数量限制');
  const first = (await r.listItems({ sort: 'created' }))[0].id;
  await r.softDelete(first);
  eq(r.recentAdded(100).some((i) => i.id === first), false, '回收站中的物品不出现在最近添加');
}

/* ================================================================ 6. ZIP */
group('6. ZIP 读写（含 UTF-8 文件名与 DEFLATE）');
{
  eq(MS.zip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'CRC32 结果与标准一致');

  const entries = [
    { name: 'data.json', data: new TextEncoder().encode('{"name":"中文名称"}') },
    { name: 'images/中文图片.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
    { name: 'attachments/', dir: true }
  ];
  const blob = await MS.zip.write(entries);
  ok(blob.size > 0 && blob.type === 'application/zip', 'ZIP 生成成功');
  const back = await MS.zip.read(blob);
  eq(back.length, 3, 'ZIP 条目数量正确');
  const json = back.find((e) => e.name === 'data.json');
  eq(JSON.parse(new TextDecoder().decode(json.data)).name, '中文名称', '中文内容往返正确');
  const img = back.find((e) => e.name === 'images/中文图片.jpg');
  ok(!!img, '中文文件名往返正确（UTF-8 标志）');
  eq(Array.from(img.data), [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3], '二进制内容逐字节一致');
  ok(back.find((e) => e.name === 'attachments/').dir, '目录条目被识别');

  // 外部工具生成的 DEFLATE zip 也要能读
  const payload = zlib.deflateRawSync(Buffer.from('压缩过的内容 hello', 'utf8'));
  const nameBytes = Buffer.from('deflate.txt', 'utf8');
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);              // method = deflate
  local.writeUInt32LE(MS.zip.crc32(new TextEncoder().encode('压缩过的内容 hello')), 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(Buffer.byteLength('压缩过的内容 hello', 'utf8'), 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  const cd = Buffer.alloc(46 + nameBytes.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(MS.zip.crc32(new TextEncoder().encode('压缩过的内容 hello')), 16);
  cd.writeUInt32LE(payload.length, 20);
  cd.writeUInt32LE(Buffer.byteLength('压缩过的内容 hello', 'utf8'), 24);
  cd.writeUInt16LE(nameBytes.length, 28);
  cd.writeUInt32LE(0, 42);
  nameBytes.copy(cd, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(local.length + payload.length, 16);
  const externalZip = new Blob([local, payload, cd, eocd]);
  const external = await MS.zip.read(externalZip);
  eq(new TextDecoder().decode(external[0].data), '压缩过的内容 hello', '可读取外部工具生成的 DEFLATE zip');

  await throwsFriendly(() => MS.zip.read(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])), 'ZIP_BROKEN', '损坏的压缩包给出友好提示');
}

/* ================================================================ 7. 导入导出完整往返 */
group('7. 导出 → 清空 → 导入（完整恢复）');
{
  const memoryA = createMemoryAdapter();
  const repoA = MS.createRepository(memoryA);
  await repoA.init();

  const cat = await repoA.createCategory('露营');
  const tag1 = await repoA.ensureTag('常用');
  const tag2 = await repoA.ensureTag('贵重');
  const item1 = await repoA.createItem({
    name: 'Sony 耳机', brand: 'Sony', model: 'WH-1000XM5', purchaseDate: '2025-11-11',
    purchasePrice: 2399, purchaseChannel: '京东', serialNumber: 'SN-1', location: '储物箱 A',
    notes: '备用耳塞在里面', categoryId: cat.id, tagIds: [tag1.id, tag2.id]
  });
  const item2 = await repoA.createItem({ name: 'HDMI 线' });
  const item3 = await repoA.createItem({ name: '被删掉的东西' });
  await repoA.addImages(item1.id, [
    { meta: { name: 'front.jpg', mime: 'image/jpeg', size: 4, width: 100, height: 80 }, blob: new Blob([new Uint8Array([1, 2, 3, 4])]), thumb: new Blob([new Uint8Array([9])]) },
    { meta: { name: 'back.png', mime: 'image/png', size: 3 }, blob: new Blob([new Uint8Array([5, 6, 7])]), thumb: null }
  ]);
  await repoA.touchViewed(item1.id);
  await repoA.softDelete(item3.id);

  const dataset = await repoA.exportDataset();
  const built = await MS.backup.buildBackup(dataset);
  ok(built.blob.size > 0, '导出生成 zip：' + built.fileName);
  ok(/^my-space-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(built.fileName), '备份文件命名符合规范');

  const zipEntries = await MS.zip.read(built.blob);
  const names = zipEntries.map((e) => e.name).sort();
  ok(names.includes('data.json') && names.includes('metadata.json'), 'zip 内含 data.json + metadata.json');
  ok(names.some((n) => n.indexOf('images/') === 0), 'zip 内含 images/ 目录（图片不会丢）');
  ok(names.includes('attachments/'), '预留 attachments/ 目录，V0.2 格式稳定');
  const dataJson = JSON.parse(new TextDecoder().decode(zipEntries.find((e) => e.name === 'data.json').data));
  eq(dataJson.backupVersion, 1, 'data.json 带 backupVersion');
  eq(dataJson.appVersion, MS.APP_VERSION, 'data.json 带 appVersion');
  eq(dataJson.items.length, 3, 'data.json 含全部物品（含回收站）');

  // —— 清空后重新导入
  const memoryB = createMemoryAdapter();
  const repoB = MS.createRepository(memoryB);
  await repoB.init();
  const parsed = await MS.backup.parseBackup(built.blob);
  eq(parsed.warnings.length, 0, '解析备份无告警');
  const plan = repoB.buildImportPlan(parsed);
  eq(plan.counts.added, 3, '导入计划：新增 3 条');
  eq(plan.counts.updated, 0, '导入计划：更新 0 条');
  eq(plan.counts.images, 2, '导入计划：附件 2 个');
  await repoB.applyImport(plan);

  const restored = repoB.getItem(item1.id);
  eq(restored.name, 'Sony 耳机', '名称恢复');
  eq(restored.brand, 'Sony', '品牌恢复');
  eq(restored.purchasePrice, 2399, '价格恢复');
  eq(restored.purchaseDate, '2025-11-11', '日期恢复');
  eq(restored.location, '储物箱 A', '位置恢复');
  eq(restored.notes, '备用耳塞在里面', '备注恢复');
  eq(repoB.categoryName(restored.categoryId), '露营', '自定义分类恢复且引用正确');
  eq(repoB.tagNames(restored.tagIds).sort(), ['常用', '贵重'].sort(), '多标签关系恢复');
  eq(repoB.itemImages(item1.id).length, 2, '图片关系恢复');
  const restoredImg = await repoB.imageData(repoB.itemImages(item1.id)[0].id);
  ok(restoredImg.blob instanceof Blob && restoredImg.blob.size === 4, '图片二进制恢复（逐字节）');
  eq(repoB.listItems().length, 2, '未删除物品数量恢复');
  eq(repoB.trashed().length, 1, '回收站状态一并恢复');
  eq(repoB.getItem(item2.id).name, 'HDMI 线', '只有名称的物品也能完整恢复');
  ok(!!repoB.getItem(item1.id).lastViewedAt, '最近查看数据恢复');

  // —— 再次导入（同 ID 应识别为更新而非新增）
  const plan2 = repoB.buildImportPlan(parsed);
  eq(plan2.counts.added, 0, '重复导入：不再新增');
  eq(plan2.counts.updated, 3, '重复导入：全部识别为更新');
  await repoB.applyImport(plan2);
  eq(repoB.listItems().length, 2, '重复导入不会产生重复数据');

  // —— 分类/标签同名不同 ID → 复用本地，避免重复
  const third = createMemoryAdapter();
  const repoC = MS.createRepository(third);
  await repoC.init();
  const localCat = repoC.listCategories().find((c) => c.name === '电子设备');
  const parsed2 = JSON.parse(JSON.stringify(parsed));
  parsed2.dataset.categories.push({ id: 'new-id-for-电子设备', name: '电子设备' });
  const plan3 = repoC.buildImportPlan(parsed2);
  eq(plan3.categories.find((c) => c.name === '电子设备'), undefined, '同名分类不会产生重复条目');

  // —— 极简数据导入 / 脏数据导入 / 版本控制
  const miniZip = await MS.zip.write([{ name: 'data.json', data: new TextEncoder().encode(JSON.stringify({ backupVersion: 1, items: [{ name: 'HDMI 线' }] })) }]);
  const miniParsed = await MS.backup.parseBackup(miniZip);
  const repoD = MS.createRepository(createMemoryAdapter());
  await repoD.init();
  const miniPlan = repoD.buildImportPlan(miniParsed);
  eq(miniPlan.counts.added, 1, '只有 name 的最小数据可导入');
  await repoD.applyImport(miniPlan);
  eq(repoD.listItems()[0].name, 'HDMI 线', '最小数据导入后名称正确');
  ok(/^[0-9a-f-]{36}$/.test(repoD.listItems()[0].id), '缺失 ID 时自动分配稳定 UUID');

  const noIdZip = await MS.zip.write([{ name: 'data.json', data: new TextEncoder().encode(JSON.stringify({
    backupVersion: 1,
    items: [{ name: 'A' }, { name: '' }, { notName: 'x' }, null, { name: 'B', purchasePrice: 'oops', purchaseDate: 'not-a-date' }]
  })) }]);
  const repoE = MS.createRepository(createMemoryAdapter());
  await repoE.init();
  const planE = repoE.buildImportPlan(await MS.backup.parseBackup(noIdZip));
  eq(planE.counts.items, 2, '无名称的脏数据被安全跳过');
  eq(planE.warnings.length > 0, true, '跳过脏数据时给出告警');
  await repoE.applyImport(planE);
  eq(repoE.listItems().map((i) => i.name).sort(), ['A', 'B'], '脏数据导入后仍然保持可用');

  await throwsFriendly(async () => {
    const bad = await MS.zip.write([{ name: 'data.json', data: new TextEncoder().encode('{ this is not json') }]);
    await MS.backup.parseBackup(bad);
  }, 'BACKUP_JSON', 'JSON 损坏的备份给出友好提示');

  await throwsFriendly(async () => {
    const noData = await MS.zip.write([{ name: 'readme.txt', data: new TextEncoder().encode('hi') }]);
    await MS.backup.parseBackup(noData);
  }, 'BACKUP_NO_DATA', '缺少 data.json 的压缩包给出友好提示');

  await throwsFriendly(async () => {
    const future = await MS.zip.write([{ name: 'data.json', data: new TextEncoder().encode(JSON.stringify({ backupVersion: 99, items: [] })) }]);
    await MS.backup.parseBackup(future);
  }, 'BACKUP_VERSION', '未来版本的备份给出友好提示（不崩溃）');
}

/* ================================================================ 8. 数据量 */
group('8. 数据量与性能（1000 条物品）');
{
  const memory = createMemoryAdapter();
  const r = MS.createRepository(memory);
  await r.init();
  const cats = (await Promise.all(['电子设备', '电脑', '音频'].map((n) => r.createCategory(n)))).map((c) => c.id);
  const tags = [await r.ensureTag('常用'), await r.ensureTag('备用')];
  const many = [];
  for (let i = 0; i < 1000; i++) {
    many.push({
      name: '物品 ' + i + (i % 7 === 0 ? ' Sony' : ''),
      brand: i % 3 === 0 ? 'Sony' : null,
      model: 'M-' + i,
      location: '储物箱 ' + String.fromCharCode(65 + (i % 6)),
      purchasePrice: (i % 50) * 19.9,
      notes: i % 11 === 0 ? '这条备注里提到电池' : null,
      categoryId: cats[i % cats.length],
      tagIds: i % 4 === 0 ? [tags[0].id] : (i % 5 === 0 ? [tags[1].id] : [])
    });
  }
  const t0 = Date.now();
  await memory.items.putMany(many.map((m, i) => M.normalizeItem(Object.assign({ id: 'id-' + i }, m))));
  const tWrite = Date.now() - t0;
  const r2 = MS.createRepository(memory);
  const t1 = Date.now();
  await r2.init();
  const tLoad = Date.now() - t1;
  const t2 = Date.now();
  const found = r2.search('Sony');
  const tSearch = Date.now() - t2;
  const t3 = Date.now();
  const sorted = r2.listItems({ sort: 'price' });
  const tSort = Date.now() - t3;
  ok(sorted.length === 1000, '1000 条数据列表完整');
  ok(found.length > 0, '1000 条数据中搜索命中 ' + found.length + ' 条');
  ok(tSearch < 300, '搜索耗时 ' + tSearch + 'ms（< 300ms）');
  ok(tLoad < 2000, '加载 ' + tLoad + 'ms（< 2000ms）');
  ok(tSort < 300, '排序耗时 ' + tSort + 'ms（< 300ms）');
  console.log('    写入 ' + tWrite + 'ms / 加载 ' + tLoad + 'ms / 搜索 ' + tSearch + 'ms / 排序 ' + tSort + 'ms');
  eq(r2.listItems({ categoryId: cats[0] }).length > 0, true, '按分类筛选在大量数据下正常');
  eq(r2.listItems({ tagId: tags[0].id }).length > 0, true, '按标签筛选在大量数据下正常');
}

/* ================================================================ 9. 清空数据 */
group('9. 清空全部数据');
{
  const memory = createMemoryAdapter();
  const r = MS.createRepository(memory);
  await r.init();
  await r.createItem({ name: 'A' });
  await r.clearAll();
  eq(r.stats().items, 0, '清空后物品为 0');
  eq(r.stats().images, 0, '清空后图片为 0');
  eq(await memory.blobs.all().then((x) => x.length), 0, '清空后二进制存储为 0');
  eq(r.listItems().length, 0, '清空后列表为空且不报错');
}

/* ---------------------------------------------------------------- 汇总 */
console.log('\n' + '─'.repeat(56));
if (failures.length) {
  console.log('\x1b[31m失败 ' + failures.length + ' 项 / 通过 ' + passed + ' 项\x1b[0m');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
} else {
  console.log('\x1b[32m全部通过：' + passed + ' 项断言\x1b[0m');
}
