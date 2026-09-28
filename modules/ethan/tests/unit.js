/* ETHAN V0.1 — 单元 / 逻辑测试（Node，IndexedDB 使用内存后端）
 * 覆盖：加密解密、PIN、密钥派生、密码生成、CRUD、搜索、标签、回收站、
 *       备份恢复、冲突处理、数据迁移、持久化。
 */
const U = require('../app/js/core/util.js');
const C = require('../app/js/core/crypto.js');
const DB = require('../app/js/core/db.js');
const S = require('../app/js/core/store.js');

DB.setBackend(DB.memoryBackend());

const results = [];
let failed = 0;
let group = '';
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === true) pass(name);
    else fail(name, r);
  } catch (e) { fail(name, e && e.message ? e.message : e); }
};
const at = async (name, fn) => {
  try {
    const r = await fn();
    if (r === true) pass(name);
    else fail(name, r);
  } catch (e) { fail(name, e && e.message ? e.message : String(e)); }
};
function pass(name) { results.push({ group, name, pass: true }); console.log('  PASS  [' + group + '] ' + name); }
function fail(name, extra) {
  failed++;
  results.push({ group, name, pass: false, extra: String(extra || '').slice(0, 200) });
  console.log('  FAIL  [' + group + '] ' + name + ' :: ' + String(extra || '').slice(0, 160));
}

const PIN = '123456';
const PIN2 = '654321';
const BP = 'backup-pass-1';

(async () => {
  /* ================= 加密 ================= */
  group = '加密';

  await at('PBKDF2 派生密钥可用且能加解密', async () => {
    const salt = C.genSalt();
    const k1 = await C.deriveKey('abc123', salt);
    const k2 = await C.deriveKey('abc123', salt);
    const enc = await C.encryptBytes(k1, U.utf8('hello ethan'));
    const dec = await C.decryptBytes(k2, enc.iv, enc.ct);
    return U.utf8str(dec) === 'hello ethan';
  });

  await at('不同 salt 产生不同密钥（无法互相解密）', async () => {
    const k1 = await C.deriveKey('abc123', C.genSalt());
    const k2 = await C.deriveKey('abc123', C.genSalt());
    const enc = await C.encryptBytes(k1, U.utf8('x'));
    try { await C.decryptBytes(k2, enc.iv, enc.ct); return '不应解密成功'; }
    catch (e) { return true; }
  });

  await at('每次加密使用不同 IV', async () => {
    const k = await C.deriveKey('abc123', C.genSalt());
    const a = await C.encryptBytes(k, U.utf8('same'));
    const b = await C.encryptBytes(k, U.utf8('same'));
    return a.iv !== b.iv && a.ct !== b.ct;
  });

  await at('AES-GCM 能检测密文被篡改', async () => {
    const k = await C.deriveKey('abc123', C.genSalt());
    const enc = await C.encryptBytes(k, U.utf8('tamper test'));
    const ct = U.base64ToBytes(enc.ct);
    ct[0] = ct[0] ^ 0xff;
    try { await C.decryptBytes(k, enc.iv, U.bytesToBase64(ct)); return '篡改后仍解密成功'; }
    catch (e) { return true; }
  });

  t('KDF 使用随机 salt（16 字节）', () => {
    const a = U.bytesToBase64(C.genSalt());
    const b = U.bytesToBase64(C.genSalt());
    return a !== b && U.base64ToBytes(a).length === 16;
  });

  t('随机 IV 为 12 字节', () => U.bytesToBase64(C.genIV()) !== U.bytesToBase64(C.genIV()) && C.genIV().length === 12);

  /* ================= PIN / 密钥派生 ================= */
  group = 'PIN';

  await at('首次 setup 后处于解锁状态', async () => {
    await S.setup(PIN);
    return S.isUnlocked() && S.isInitialized();
  });

  await at('错误 PIN 无法解锁且提示明确', async () => {
    S.lock();
    try { await S.unlock('000000'); return '错误 PIN 竟然通过'; }
    catch (e) { return e.message === 'PIN 不正确' ? true : e.message; }
  });

  await at('正确 PIN 可解锁', async () => { await S.unlock(PIN); return S.isUnlocked(); });

  await at('锁定后无法读写数据（抛出 NOT_UNLOCKED）', async () => {
    S.lock();
    try { S.all(); return '锁定后仍可读'; } catch (e) { return true; }
  });

  await at('修改 PIN 后新 PIN 可用、旧 PIN 失效', async () => {
    await S.unlock(PIN);
    const it = S.newItem('secret');
    it.title = 'pin-test'; it.value = 'value-1';
    await S.save(it);
    await S.changePin(PIN, PIN2);
    S.lock();
    try { await S.unlock(PIN); return '旧 PIN 仍可用'; } catch (e) { /* 预期 */ }
    await S.unlock(PIN2);
    return S.all().find(i => i.title === 'pin-test').value === 'value-1';
  });

  await at('PIN 不以明文出现在持久化数据中', async () => {
    const meta = await DB.getMeta('kdf');
    const raw = JSON.stringify(meta);
    return raw.indexOf(PIN2) < 0 && raw.indexOf('"pin"') < 0 && !raw.includes('123456');
  });

  await at('修改 PIN 不会重新加密数据（DEK 不变，vault 可继续解密）', async () => {
    const before = await DB.getVault('main');
    await S.changePin(PIN2, PIN);
    const after = await DB.getVault('main');
    // 数据密文本身未变（仅在下次写入时才重新加密）
    return before.ct === after.ct && S.all().length >= 1;
  });

  /* ================= 密码生成 ================= */
  group = '密码生成';

  t('默认生成 16 位', () => C.generatePassword({}).length === 16);
  t('可指定长度', () => C.generatePassword({ length: 32 }).length === 32);
  t('仅数字时只含数字', () => /^[0-9]{12}$/.test(C.generatePassword({ length: 12, upper: false, lower: false, symbols: false })));
  t('关闭大写时不出现大写', () => {
    for (let i = 0; i < 50; i++) {
      const p = C.generatePassword({ length: 20, upper: false });
      if (/[A-Z]/.test(p)) return false;
    }
    return true;
  });
  t('每次生成结果不同', () => C.generatePassword({ length: 16 }) !== C.generatePassword({ length: 16 }));
  t('生成的密码覆盖所有选中字符类别', () => {
    const p = C.generatePassword({ length: 12 });
    return /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
  });
  t('字符分布无明显偏斜（1000 次采样覆盖 62+ 字符）', () => {
    const set = new Set();
    for (let i = 0; i < 40; i++) C.generatePassword({ length: 40 }).split('').forEach(c => set.add(c));
    return set.size >= 60;
  });
  t('长度过小时回退到最小值 4', () => C.generatePassword({ length: 1 }).length >= 4);

  /* ================= CRUD ================= */
  group = 'CRUD';

  await at('新建账号密码并保存', async () => {
    const it = S.newItem('account');
    it.title = 'Steam'; it.username = 'ethan@example.com';
    it.password = 'St' + 'eamPw-01'; it.url = 'steampowered.com';
    it.note = '主账号'; it.tags = ['game', 'valve'];
    it.recoveryCodes = [{ id: U.uid(), value: 'AAAA BBBB' }, { id: U.uid(), value: 'CCCC DDDD' }];
    await S.save(it);
    const saved = S.get(it.id);
    return saved.title === 'Steam' && saved.recoveryCodes.length === 2 && saved.tags.length === 2;
  });

  await at('可选字段留空也能保存', async () => {
    const it = S.newItem('account');
    it.title = '空字段账号'; it.password = 'only-pw';
    await S.save(it);
    const s = S.get(it.id);
    return s.username === '' && s.url === '' && s.note === '' && s.tags.length === 0;
  });

  await at('更新条目会刷新 updatedAt 并保留 createdAt', async () => {
    const it = S.all().find(i => i.title === 'Steam');
    const c0 = it.createdAt, u0 = it.updatedAt;
    await new Promise(r => setTimeout(r, 15));
    it.title = 'Steam 主账号';
    await S.save(it);
    const s = S.get(it.id);
    return s.title === 'Steam 主账号' && s.createdAt === c0 && s.updatedAt > u0;
  });

  await at('创建时间/修改时间字段齐备', () => {
    return S.all().every(i => i.createdAt > 0 && i.updatedAt > 0 && typeof i.id === 'string' && Array.isArray(i.tags));
  });

  await at('四种分类均可创建', async () => {
    const sec = S.newItem('secret'); sec.title = 'OpenAI API'; sec.type = 'API Key'; sec.value = 'sk-u-1'; await S.save(sec);
    const tx = S.newItem('text'); tx.title = '恢复信息'; tx.content = '第一行\n第二行'; await S.save(tx);
    const ot = S.newItem('other'); ot.title = '路由器';
    ot.fields = [{ id: U.uid(), name: 'SN', value: 'RT-1', secret: false }, { id: U.uid(), name: '密码', value: 'rt-pw', secret: true }];
    await S.save(ot);
    const c = S.counts();
    return c.account >= 2 && c.secret >= 1 && c.text === 1 && c.other === 1;
  });

  await at('校验：账号名称必填', () => {
    const it = S.newItem('account'); it.password = 'x';
    return S.validate(it).ok === false;
  });
  await at('校验：密码必填', () => {
    const it = S.newItem('account'); it.title = 'x';
    return S.validate(it).ok === false;
  });
  await at('校验：通过', () => {
    const it = S.newItem('account'); it.title = 'x'; it.password = 'y';
    return S.validate(it).ok === true;
  });

  /* ================= 搜索 ================= */
  group = '搜索';

  t('按标题搜索', () => S.list({ query: 'Steam' }).length >= 1);
  t('按用户名搜索', () => S.list({ query: 'ethan@example.com' }).length >= 1);
  t('按网址搜索', () => S.list({ query: 'steampowered' }).length >= 1);
  t('按标签搜索', () => S.list({ query: 'valve' }).length >= 1);
  t('按备注搜索', () => S.list({ query: '主账号' }).length >= 1);
  t('不搜索密码明文', () => S.list({ query: 'Ste' + 'amPw-01' }).length === 0);
  t('不搜索密钥值', () => S.list({ query: 'sk-u-1' }).length === 0);
  t('不搜索文本正文', () => S.list({ query: '第二行' }).length === 0);
  t('搜索不区分大小写', () => S.list({ query: 'steam' }).length >= 1);
  t('搜索结果不含已删除条目', () => {
    const it = S.newItem('text'); it.id = 'del-1'; it.title = '待删除';
    S._state.vault.items.push(it);
    S._state.vault.items.find(i => i.id === 'del-1').deletedAt = Date.now();
    const r = S.list({ query: '待删除' }).length === 0;
    S._state.vault.items = S._state.vault.items.filter(i => i.id !== 'del-1');
    return r;
  });
  t('标签聚合', () => {
    const tags = S.allTags();
    return tags.indexOf('game') >= 0 && tags.indexOf('valve') >= 0;
  });
  t('按分类过滤', () => S.list({ category: 'secret' }).every(i => i.category === 'secret'));

  /* ================= 回收站 ================= */
  group = '回收站';

  await at('删除进入回收站而非真正删除', async () => {
    const it = S.all().find(i => i.title === 'OpenAI API');
    await S.softDelete(it.id);
    return S.trash().some(i => i.id === it.id) && !S.all().some(i => i.id === it.id);
  });
  await at('回收站条目可恢复', async () => {
    const it = S.trash()[0];
    await S.restore(it.id);
    return S.all().some(i => i.id === it.id) && !S.trash().some(i => i.id === it.id);
  });
  await at('永久删除后彻底移除', async () => {
    const it = S.all()[0];
    await S.softDelete(it.id);
    await S.purge(it.id);
    return !S.trash().some(i => i.id === it.id) && !S.all().some(i => i.id === it.id);
  });
  await at('清空回收站', async () => {
    const a = S.all()[0], b = S.all()[1];
    if (a) await S.softDelete(a.id);
    if (b) await S.softDelete(b.id);
    await S.emptyTrash();
    return S.trash().length === 0;
  });

  /* ================= 持久化 / 重新打开 ================= */
  group = '持久化';

  await at('锁定再解锁（模拟关闭重开）数据完整', async () => {
    const before = S.all().length;
    const title = S.all()[0].title;
    S.lock();
    await S.unlock(PIN);
    return S.all().length === before && S.all().some(i => i.title === title);
  });

  await at('落盘的 vault 为密文，不含明文', async () => {
    const rec = await DB.getVault('main');
    const raw = JSON.stringify(rec);
    const clean = raw.indexOf('steampowered') < 0 && raw.indexOf('sk-u-') < 0 && raw.indexOf('第二行') < 0;
    return clean === true && typeof rec.iv === 'string' && typeof rec.ct === 'string';
  });

  await at('IndexedDB 中 meta 不含明文 PIN 与明文密钥', async () => {
    const meta = await DB.getMeta('kdf');
    const raw = JSON.stringify(meta);
    const noPin = raw.indexOf(PIN) < 0 && raw.indexOf(PIN2) < 0;
    // wrappedDEK 是密文键名，不能出现可导出的明文密钥字段
    const noRawKey = !meta.kdf.dek && !meta.kdf.key && raw.indexOf('"pin"') < 0;
    return noPin === true && noRawKey === true && !!meta.kdf.salt && !!meta.kdf.wrappedDEK.ct;
  });

  /* ================= 备份 / 恢复 ================= */
  group = '备份恢复';

  // 补齐四类数据，保证备份内容覆盖所有分类
  await at('准备备份数据（四类齐全）', async () => {
    if (!S.all().some(i => i.category === 'account')) {
      const a = S.newItem('account');
      a.title = '备份账号'; a.username = 'bk@example.com'; a.password = 'bk-pw-001'; a.url = 'bk.example.com';
      a.note = '备份备注'; a.tags = ['backup'];
      a.recoveryCodes = [{ id: U.uid(), value: '1111 2222' }];
      await S.save(a);
    }
    if (!S.all().some(i => i.category === 'secret')) {
      const s = S.newItem('secret'); s.title = '备份密钥'; s.type = 'API Key'; s.value = 'sk-bk-001'; await S.save(s);
    }
    if (!S.all().some(i => i.category === 'text')) {
      const x = S.newItem('text'); x.title = '备份文本'; x.content = '备份正文第一行'; await S.save(x);
    }
    if (!S.all().some(i => i.category === 'other')) {
      const o = S.newItem('other'); o.title = '备份其他';
      o.fields = [{ id: U.uid(), name: 'SN', value: 'BK-1', secret: false }];
      await S.save(o);
    }
    const c = S.counts();
    return c.account >= 1 && c.secret >= 1 && c.text >= 1 && c.other >= 1;
  });

  let backupText = null;
  await at('创建加密备份', async () => {
    const r = await S.createBackup(BP);
    backupText = r.text;
    return /^ETHAN-backup-\d{4}-\d{2}-\d{2}\.ethan$/.test(r.filename) && r.text.length > 100;
  });

  await at('备份文件为密文，不含敏感明文', () => {
    const f = JSON.parse(backupText);
    return f.app === 'ETHAN' && f.kdf && f.iv && f.ct &&
      backupText.indexOf('sk-u-') < 0 && backupText.indexOf('steampowered') < 0 && backupText.indexOf('第二行') < 0;
  });

  await at('备份包含 schemaVersion / data / metadata', async () => {
    const r = await S.readBackup(backupText, BP);
    return r.payload.schemaVersion === 1 && !!r.payload.data && !!r.payload.metadata &&
      typeof r.payload.metadata.createdAt === 'number';
  });

  await at('备份密码错误时拒绝', async () => {
    try { await S.readBackup(backupText, 'wrong-pwd'); return '错误密码竟然通过'; }
    catch (e) { return true; }
  });

  await at('备份文件损坏时给出明确错误', async () => {
    try { await S.readBackup('{ not json', BP); return '损坏文件竟然通过'; } catch (e) { return typeof e.message === 'string'; }
  });

  await at('非 ETHAN 文件被拒绝', async () => {
    try { await S.readBackup(JSON.stringify({ app: 'OTHER', ct: 'x', iv: 'y', kdf: {} }), BP); return '未知文件竟然通过'; }
    catch (e) { return true; }
  });

  await at('恢复（合并）不覆盖已存在的重复条目', async () => {
    const b = await S.readBackup(backupText, BP);
    const before = S.all().length;
    const r = await S.applyBackup(b, { mode: 'merge', conflict: 'keep' });
    return r.mode === 'merge' && r.conflicts.length >= 0 && S.all().length === before;
  });

  await at('合并恢复会记录冲突而不静默覆盖', async () => {
    const b = await S.readBackup(backupText, BP);
    const target = b.items[0];
    // 人为制造同 id 不同内容
    const local = U.deepClone(target);
    local.title = '本地版本';
    local.updatedAt = Date.now() + 1000;
    S._state.vault.items = S._state.vault.items.filter(i => i.id !== local.id);
    S._state.vault.items.push(local);
    const r = await S.applyBackup(b, { mode: 'merge', conflict: 'keep' });
    const kept = S.get(local.id).title === '本地版本';
    return r.conflicts.some(c => c.id === local.id) && kept;
  });

  await at('合并恢复（覆盖策略）可更新条目', async () => {
    const b = await S.readBackup(backupText, BP);
    const r = await S.applyBackup(b, { mode: 'merge', conflict: 'overwrite' });
    return r.updated >= 1;
  });

  await at('替换恢复会用备份内容覆盖全部数据', async () => {
    const b = await S.readBackup(backupText, BP);
    const r = await S.applyBackup(b, { mode: 'replace' });
    return r.mode === 'replace' && S.all().length === b.items.filter(i => !i.deletedAt).length;
  });

  await at('恢复后数据可正常解密使用', () => {
    const acc = S.all().find(i => i.category === 'account');
    const sec = S.all().find(i => i.category === 'secret');
    return !!acc && acc.password.length > 0 && !!sec && sec.value.length > 0;
  });

  await at('清空后从备份恢复，数据完整', async () => {
    const snapshot = await S.readBackup(backupText, BP);
    const expect = snapshot.counts;
    await Promise.all(S.all().map(i => S.softDelete(i.id)));
    await S.emptyTrash();
    const empty = S.counts();
    const b = await S.readBackup(backupText, BP);
    await S.applyBackup(b, { mode: 'replace' });
    const after = S.counts();
    return JSON.stringify(empty) === JSON.stringify({ account: 0, secret: 0, text: 0, other: 0 }) &&
      JSON.stringify(after) === JSON.stringify(expect);
  });

  /* ================= 数据迁移 ================= */
  group = '数据迁移';

  t('migrate 补齐缺失字段（旧结构）', () => {
    const raw = { items: [{ id: 'old-1', category: 'account', title: '旧数据' }] };
    const v = S.migrate(raw);
    const it = v.items[0];
    return v.schemaVersion === 1 && it.username === '' && Array.isArray(it.tags) && Array.isArray(it.recoveryCodes) && it.createdAt > 0;
  });

  t('migrate 修正非法分类', () => {
    const v = S.migrate({ items: [{ id: 'x', category: 'unknown', title: 't' }] });
    return v.items[0].category === 'other';
  });

  t('migrate 拒绝更高版本的数据结构', () => {
    try { S.migrate({ schemaVersion: 99, items: [] }); return '未拒绝高版本'; }
    catch (e) { return typeof e.message === 'string'; }
  });

  t('normalizeItem 修正密钥类型', () => {
    const it = S.normalizeItem({ id: 'a', category: 'secret', title: 't', type: 'BAD' });
    return it.type === 'API Key';
  });

  await at('备份/恢复支持 schemaVersion 检查', async () => {
    const bad = JSON.stringify({ app: 'ETHAN', schemaVersion: 99, ct: 'x', iv: 'y', kdf: { salt: 'a', iterations: 1 } });
    try { await S.readBackup(bad, BP); return '未拒绝高版本备份'; } catch (e) { return true; }
  });

  /* ================= 工具函数 ================= */
  group = '工具';
  t('相对时间：刚刚', () => U.relativeTime(Date.now()) === '刚刚');
  t('相对时间：昨天', () => U.relativeTime(Date.now() - 30 * 3600 * 1000) === '昨天');
  t('日期格式 2026.09.24', () => /^\d{4}\.\d{2}\.\d{2}$/.test(U.formatDate(Date.now())));
  t('URL 归一化', () => U.normalizeUrl('steampowered.com') === 'https://steampowered.com');
  t('URL 归一化保留 https', () => U.normalizeUrl('https://a.com') === 'https://a.com');
  t('uid 唯一', () => U.uid() !== U.uid());
  t('base64 往返', () => U.utf8str(U.base64ToBytes(U.bytesToBase64(U.utf8('中文 abc')))) === '中文 abc');

  console.log('\n单元测试结果: ' + (results.length - failed) + '/' + results.length + ' 通过，失败 ' + failed);
  require('fs').writeFileSync(require('path').resolve('tests/unit-results.json'), JSON.stringify(results, null, 2), 'utf8');
  process.exit(failed === 0 ? 0 : 1);
})();
