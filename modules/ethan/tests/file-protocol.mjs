/* ETHAN — file:// 直接打开的可运行性检查（双击 index.html 的场景） */
import path from 'node:path';
import { launchBrowser, CDP, sleep } from '../scripts/cdp.mjs';

const fileUrl = 'file:///' + path.resolve('app/index.html').replace(/\\/g, '/');
const browser = await launchBrowser({ port: 9336 });
const cdp = await new CDP(browser.wsUrl).connect();
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');

const errors = [];
cdp.on('Runtime.exceptionThrown', p => errors.push((p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').split('\n')[0]));
cdp.on('Log.entryAdded', p => { if (p.entry.level === 'error') errors.push(p.entry.text); });

await cdp.send('Page.navigate', { url: fileUrl });
await sleep(1500);

const info = await cdp.evaluate(`(() => ({
  hasEthan: typeof window.Ethan === 'object',
  modules: Object.keys(window.Ethan || {}).length,
  idbAvailable: !!(window.indexedDB),
  fatal: !!document.querySelector('.fatal'),
  lockShown: !document.getElementById('lock').hidden,
  text: (document.getElementById('app').innerText || '').slice(0, 120)
}))()`);

console.log('file:// 加载结果:', info);
console.log('错误:', errors);

// 尝试写入 IndexedDB（file:// 下部分浏览器会拒绝）
const idbOk = await cdp.evaluate(`(() => new Promise(res => {
  try {
    const r = indexedDB.open('ethan-filetest', 1);
    r.onerror = () => res('ERROR:' + (r.error && r.error.name));
    r.onsuccess = () => { r.result.close(); res('OK'); };
    r.onblocked = () => res('BLOCKED');
  } catch (e) { res('THROW:' + e.name); }
}))()`);
console.log('file:// IndexedDB:', idbOk);

cdp.close();
browser.proc.kill();
process.exit(info.hasEthan && !info.fatal && errors.length === 0 ? 0 : 1);
