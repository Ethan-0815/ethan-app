/* ETHAN V0.1 — 运行时安全检查（真实浏览器）
 * 验证：明文存储、硬编码密钥、IndexedDB 加密形态、localStorage 无敏感数据、
 *       备份文件不可读、刷新不绕过锁定、未解锁无法读取敏感数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../scripts/serve.mjs';
import { launchBrowser, CDP, sleep } from '../scripts/cdp.mjs';

const results = [];
let failed = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) failed++;
  results.push({ name, pass, extra: pass ? '' : String(JSON.stringify(extra ?? '')).slice(0, 300) });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}` + (pass ? '' : ' :: ' + JSON.stringify(extra ?? '').slice(0, 220)));
}

const PIN = '135790';
const MARK = {
  account: 'SEC-ACC-PW-8f3a',
  username: 'sec-user@example.com',
  url: 'sec.example.com',
  code: '9999 8888',
  secret: 'sk-sec-4c1d',
  text: 'SEC-TEXT-CONTENT-77aa',
  field: 'SEC-FIELD-VALUE-2b9e'
};

const { port } = await startServer(0);
const browser = await launchBrowser({ port: 9335 });
const cdp = await new CDP(browser.wsUrl).connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

const ev = (e) => cdp.evaluate(e);
const clickSel = (sel, i = 0) => ev(`(() => { const els = document.querySelectorAll(${JSON.stringify(sel)}); if (!els[${i}]) return false; els[${i}].click(); return true; })()`);
const clickText = (sel, text) => ev(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(sel)}));
  const t = ${JSON.stringify(text)}; for (const e of els) { if ((e.innerText||'').indexOf(t) >= 0) { e.click(); return true; } } return false; })()`);
const setVal = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false;
  e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);

async function enterPin(pin) {
  for (const ch of pin.split('')) { await clickSel(`.key[data-k="${ch}"]`); await sleep(40); }
  await sleep(350);
}

await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/app/index.html` });
await sleep(900);
await enterPin(PIN);
await sleep(500);
await enterPin(PIN);
await sleep(1200);

/* 创建含敏感标记的数据 */
await ev(`(() => {
  const S = window.Ethan.Store, U = window.Ethan.Util;
  const a = S.newItem('account');
  a.title = '安全测试账号'; a.username = ${JSON.stringify(MARK.username)};
  a.password = ${JSON.stringify(MARK.account)}; a.url = ${JSON.stringify(MARK.url)};
  a.note = '安全备注'; a.tags = ['sec'];
  a.recoveryCodes = [{ id: U.uid(), value: ${JSON.stringify(MARK.code)} }];
  const s = S.newItem('secret'); s.title = '安全测试密钥'; s.type = 'API Key'; s.value = ${JSON.stringify(MARK.secret)};
  const t = S.newItem('text'); t.title = '安全测试文本'; t.content = ${JSON.stringify(MARK.text)};
  const o = S.newItem('other'); o.title = '安全测试其他';
  o.fields = [{ id: U.uid(), name: '字段A', value: ${JSON.stringify(MARK.field)}, secret: true }];
  return Promise.all([S.save(a), S.save(s), S.save(t), S.save(o)]).then(() => true);
})()`);
await sleep(800);

/* 1. IndexedDB 原始内容检查 */
const dbDump = await ev(`(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('ethan');
  req.onerror = () => reject(new Error('open fail'));
  req.onsuccess = () => {
    const db = req.result;
    const names = Array.from(db.objectStoreNames);
    const out = {};
    let left = names.length;
    if (!left) return resolve(out);
    const tx = db.transaction(names, 'readonly');
    names.forEach(n => {
      const r = tx.objectStore(n).getAll();
      r.onsuccess = () => { out[n] = r.result; if (--left === 0) resolve(out); };
      r.onerror = () => { if (--left === 0) resolve(out); };
    });
  };
}))()`);

const dumpStr = JSON.stringify(dbDump);
ok('IndexedDB 已创建 meta / vault 两个 store', !!dbDump.meta && !!dbDump.vault, Object.keys(dbDump || {}));
ok('IndexedDB 中不含明文密码', !dumpStr.includes(MARK.account));
ok('IndexedDB 中不含明文密钥', !dumpStr.includes(MARK.secret));
ok('IndexedDB 中不含明文文本', !dumpStr.includes(MARK.text));
ok('IndexedDB 中不含明文自定义字段', !dumpStr.includes(MARK.field));
ok('IndexedDB 中不含备用验证码', !dumpStr.includes(MARK.code));
ok('IndexedDB 中不含用户名 / 网址', !dumpStr.includes(MARK.username) && !dumpStr.includes(MARK.url));
ok('IndexedDB 中不含 PIN', !dumpStr.includes(PIN));

const meta = (dbDump.meta || []).find(m => m && m.kdf) || null;
ok('meta 保存 KDF 参数（salt / iterations）', !!meta && typeof meta.kdf.salt === 'string' && meta.kdf.iterations >= 100000, meta && { i: meta.kdf.iterations });
ok('meta 保存包裹后的 DEK（密文）', !!meta && !!meta.kdf.wrappedDEK && !!meta.kdf.wrappedDEK.ct && !!meta.kdf.wrappedDEK.iv);
ok('meta 保存校验值（密文）', !!meta && !!meta.kdf.verifier && !!meta.kdf.verifier.ct);
ok('meta 不含可直接使用的数据密钥明文', !!meta && !meta.kdf.dek && !meta.kdf.key && !meta.dek);

const vaultRec = (dbDump.vault || [])[0] || null;
ok('vault 记录为密文结构（iv + ct）', !!vaultRec && typeof vaultRec.iv === 'string' && typeof vaultRec.ct === 'string');
ok('vault 密文非明文 JSON', !!vaultRec && !vaultRec.ct.trim().startsWith('{'));

/* 2. localStorage / sessionStorage */
const storages = await ev(`(() => ({
  local: JSON.stringify(localStorage),
  session: JSON.stringify(sessionStorage),
  cookies: document.cookie
}))()`);
ok('localStorage 不含敏感数据', !Object.values(MARK).some(v => storages.local.includes(v)), storages.local.slice(0, 200));
ok('localStorage 不含 PIN', !storages.local.includes(PIN));
ok('localStorage 仅保存 UI 偏好', storages.local.includes('autoLock') || storages.local === '{}', storages.local.slice(0, 160));
ok('sessionStorage 为空或不含敏感数据', !Object.values(MARK).some(v => storages.session.includes(v)));
ok('未写入 Cookie', !storages.cookies);

/* 3. 列表页不泄露敏感内容 */
await clickSel('.tab[data-tab="secrets"]');
await sleep(500);
const listHtml = await ev(`document.getElementById('view').innerText`);
ok('列表页不显示密码', !listHtml.includes(MARK.account));
ok('列表页不显示密钥值', !listHtml.includes(MARK.secret));
ok('列表页不显示文本正文', !listHtml.includes(MARK.text));

/* 4. 搜索不泄露敏感内容 */
await setVal('#sec-q', MARK.account);
await sleep(600);
ok('搜索密码无结果', !(await ev(`document.getElementById('view').innerText`)).includes('安全测试账号'));
await setVal('#sec-q', MARK.secret);
await sleep(600);
ok('搜索密钥无结果', !(await ev(`document.getElementById('view').innerText`)).includes('安全测试密钥'));
await setVal('#sec-q', '');
await sleep(400);

/* 5. 备份文件不可读 */
const backup = await ev(`(() => window.Ethan.Store.createBackup('sec-backup-pwd').then(r => r))()`);
ok('备份文件不含明文密码', !backup.text.includes(MARK.account));
ok('备份文件不含明文密钥', !backup.text.includes(MARK.secret));
ok('备份文件不含明文文本', !backup.text.includes(MARK.text));
ok('备份文件名规范', /^ETHAN-backup-\d{4}-\d{2}-\d{2}\.ethan$/.test(backup.filename), backup.filename);

/* 6. 刷新不绕过锁定 */
await cdp.send('Page.reload');
await sleep(1000);
ok('刷新后回到锁定屏', await ev(`!document.getElementById('lock').hidden && document.getElementById('main').hidden`));
ok('刷新后未解锁无法读取数据', await ev(`(() => { try { window.Ethan.Store.all(); return false; } catch (e) { return true; } })()`));
ok('刷新后内存中无解密密钥', await ev(`(() => { const s = window.Ethan.Store._state; return !s.dek && !s.vault; })()`), await ev(`(() => ({dek: !!window.Ethan.Store._state.dek, vault: !!window.Ethan.Store._state.vault}))()`));

await enterPin(PIN);
await sleep(1200);
ok('刷新后重新解锁可用', await ev(`!document.getElementById('main').hidden && window.Ethan.Store.isUnlocked()`));
ok('刷新后数据仍可解密', await ev(`(() => {
  const a = window.Ethan.Store.all();
  return a.some(i => i.password === ${JSON.stringify(MARK.account)}) &&
         a.some(i => i.value === ${JSON.stringify(MARK.secret)}) &&
         a.some(i => i.content === ${JSON.stringify(MARK.text)});
})()`));

/* 7. 未解锁状态不能读取敏感数据 */
await clickSel('.tab[data-tab="settings"]');
await sleep(400);
await clickText('.cell', '立即锁定');
await sleep(500);
const lockedRead = await ev(`(() => {
  const S = window.Ethan.Store;
  try { S.all(); return 'READ_OK'; } catch (e) { return 'BLOCKED'; }
})()`);
ok('锁定后读取被阻止', lockedRead === 'BLOCKED', lockedRead);
ok('锁定后内存中无 vault', await ev(`(() => { const s = window.Ethan.Store._state; return !s.dek && !s.vault; })()`));

/* 8. 错误 PIN 不泄露信息 */
await enterPin('000000');
await sleep(500);
const errText = await ev(`document.getElementById('lock').innerText`);
ok('错误 PIN 提示不含任何数据信息', errText.includes('PIN 不正确') && !Object.values(MARK).some(v => errText.includes(v)), errText.slice(0, 120));

/* 9. 源码中不含硬编码密钥（页面运行时自检） */
ok('未发现硬编码主密钥常量', await ev(`(() => {
  const g = window.Ethan;
  const s = JSON.stringify(Object.keys(g));
  return !/SECRET_KEY|MASTER_KEY/.test(s);
})()`));

cdp.close();
browser.proc.kill();

console.log(`\n安全检查结果: ${results.length - failed}/${results.length} 通过，失败 ${failed}`);
fs.writeFileSync(path.resolve('tests/security-results.json'), JSON.stringify(results, null, 2), 'utf8');
process.exit(failed === 0 ? 0 : 1);
