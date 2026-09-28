/* 暴力测试 A2：正确回首页路径下的数据边界/极端数据/XSS/性能 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CDP_PORT = '9553';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let consoleErrors = 0, pageExceptions = 0; const excLog = [];
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({ send(method, params = {}) { return new Promise((res2, rej2) => { const mid = ++id; pending.set(mid, { res2, rej2 }); ws.send(JSON.stringify({ id: mid, method, params })); }); }, close() { try { ws.close(); } catch (e) {} } });
    ws.onerror = () => reject(new Error('ws'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { consoleErrors++; excLog.push('console.error: ' + JSON.stringify(msg.params.args).slice(0, 150)); }
      if (msg.method === 'Runtime.exceptionThrown') { pageExceptions++; excLog.push('exception: ' + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text || '').slice(0, 150)); }
      if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej2(new Error(JSON.stringify(msg.error))) : p.res2(msg.result); }
    };
  });
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-stress-a2-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', '--window-size=412,901', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {} }
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8924/app/index.html' });
    await sleep(3000);
    const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails.exception).slice(0, 200); return r.result.value; };
    await ev(`ESA.app.openApp('travel-footprint')`);
    await sleep(3500);

    /* 备份 */
    const backup = await ev(`(async () => {
      const dbs = await Promise.resolve(indexedDB.databases ? indexedDB.databases() : []);
      const names = (dbs || []).map(d => d.name).filter(n => n && n.indexOf('travel-footprint') === 0);
      const out = {};
      for (const name of names) {
        const db = await new Promise((res) => { const q = indexedDB.open(name); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
        out[name] = {};
        for (const st of Array.from(db.objectStoreNames)) {
          out[name][st] = await new Promise((res) => { try { const rq = db.transaction(st, 'readonly').objectStore(st).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); } catch (e) { res([]); } });
        }
        db.close();
      }
      return JSON.stringify(out);
    })()`);
    fs.writeFileSync(path.join(os.tmpdir(), 'tf-backup2.json'), backup || '{}');
    console.log('备份:', (backup || '').length, 'bytes');
    const restoreFn = `(async () => {
      const data = window.__TF_BACKUP__ || {};
      for (const name of Object.keys(data)) {
        await new Promise((res) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = () => res(); q.onerror = () => res(); q.onblocked = () => res(); });
        const db = await new Promise((res) => { const q = indexedDB.open(name); q.onupgradeneeded = (ev) => { const db2 = ev.target.result; for (const st of Object.keys(data[name])) { if (!db2.objectStoreNames.contains(st)) db2.createObjectStore(st, { keyPath: 'id' }); } }; q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
        if (!db) continue;
        for (const st of Object.keys(data[name])) {
          if (!db.objectStoreNames.contains(st)) continue;
          await new Promise((res) => { const tx = db.transaction(st, 'readwrite'); const os = tx.objectStore(st); data[name][st].forEach(rec => os.put(rec)); tx.oncomplete = () => res(); tx.onerror = () => res(); });
        }
        db.close();
      }
      return 'restored';
    })()`;

    const health = `(() => {
      const d = document;
      const body = d.body.textContent || '';
      const badText = /undefined|NaN|\\[object Object\\]/.test(body);
      const cards = Array.from(d.querySelectorAll('.appcard'));
      const travelCard = cards[2];
      const stat = travelCard ? (travelCard.querySelector('.appcard__stat') || {}).textContent || '' : 'MISSING';
      return JSON.stringify({ badText, stat, statOk: /^\\d+ 个城市$/.test(stat) });
    })()`;
    const backHome = `(() => { const w = document.querySelector('.module-frame.is-active'); if (w && w.style.display !== 'none') { window.ESA_back(); } })()`;

    /* F. 1城1行程 → 回首页（走真实返回链路） → 卡片应更新 */
    await ev(`(async () => { const w = document.querySelector('.module-frame.is-active').contentWindow; const r = w.TF.app.repo; const c = await r.save('city', { name: '北京', latitude: 39.9, longitude: 116.4 }); await r.save('trip', { cityId: c.id, startDate: '2026-09-28', endDate: '2026-09-28' }); })()`);
    await ev(backHome); await sleep(900);
    console.log('F 1城1行程+返回:', await ev(health));

    /* G/H. 日期 + 字符串边界（在 TF 内 seed） */
    await ev(`ESA.app.openApp('travel-footprint')`);
    await sleep(3000);
    const edgeSeed = await ev(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const r = w.TF.app.repo;
      if (!w.TF.app.repo.findCityByName('徐州')) await r.save('city', { name: '徐州', latitude: 34.2, longitude: 117.28 });
      const dates = ['2026-09-28','2026-09-27','2026-09-29','2026-02-28','2024-02-29','2025-12-31','2026-01-01','2026-12-31','2020-02-29'];
      const names = ['Tokyo','New York','São Paulo','서울','東京','<img src=x onerror=window.__xss=1>','X'.repeat(200),'😀emoji城市'];
      const notes = ['', 'x', 'n'.repeat(500), 'line1\\nline2', '🎉🚀💯', '<script>window.__xss2=1</script>', '中文English123'];
      let made = 0;
      for (let i = 0; i < names.length; i++) {
        const c = await r.save('city', { name: names[i], latitude: 30 + i * 0.1, longitude: 110 + i * 0.1 });
        await r.save('trip', { cityId: c.id, startDate: dates[i % dates.length], endDate: dates[(i + 1) % dates.length], note: notes[i % notes.length] });
        made++;
      }
      const c2 = await r.save('city', { name: '同日城', latitude: 31, longitude: 118 });
      for (let i = 0; i < 3; i++) await r.save('trip', { cityId: c2.id, startDate: '2026-09-28', endDate: '2026-09-28' });
      return 'made ' + made;
    })()`);
    console.log('边界 seed:', edgeSeed);
    await ev(backHome); await sleep(900);
    console.log('边界后首页:', await ev(health));
    console.log('XSS:', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; return JSON.stringify({ xss1: !!window.__xss, xss2: !!w.__xss2 }); })()`));

    /* I. 极端量：200 城市（在 TF cities tab 打开测渲染耗时） */
    await ev(`ESA.app.openApp('travel-footprint')`);
    await sleep(3000);
    const bulk = await ev(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const r = w.TF.app.repo;
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) {
        const c = await r.save('city', { name: '压测城' + i, latitude: 20 + (i % 40) * 0.3, longitude: 100 + (i % 50) * 0.4 });
        if (i % 2 === 0) await r.save('trip', { cityId: c.id, startDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), endDate: '2026-0' + (1 + i % 9) + '-2' + (i % 9) });
      }
      return 'bulk ' + Math.round(performance.now() - t0) + 'ms';
    })()`);
    console.log('批量写入:', bulk);
    await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; w.TF.app.router.showTab('cities'); })()`);
    const t0 = Date.now();
    await sleep(1400);
    console.log('城市列表:', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const n = w.document.querySelectorAll('.city-card').length; return '卡片数 ' + n; })()`), '| 打开+渲染:', Date.now() - t0, 'ms');

    /* 恢复真实数据 */
    await ev(`window.__TF_BACKUP__ = ${fs.readFileSync(path.join(os.tmpdir(), 'tf-backup2.json'), 'utf8')}`);
    console.log('恢复:', await ev(restoreFn));
    await ev(backHome); await sleep(900);
    console.log('恢复后首页:', await ev(health), '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    if (excLog.length) console.log('异常日志:\n' + excLog.slice(0, 10).join('\n'));
    fs.writeFileSync(path.join(os.tmpdir(), 'stress-a2-log.json'), JSON.stringify({ consoleErrors, pageExceptions, excLog }, null, 2));
  } finally { try { edge.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
