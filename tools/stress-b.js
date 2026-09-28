/* XSS 专项 + 随机状态机 1000 actions + 竞态测试 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CDP_PORT = '9557';
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
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
(async () => {
  const SEED = 20260928;
  const rand = mulberry32(SEED);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-stress-b-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', '--window-size=412,901', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const bugLog = [];
  try {
    let target = null;
    for (let i = 0; i < 50; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {} }
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8924/app/index.html' });
    await sleep(3000);
    const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails.exception).slice(0, 200); return r.result.value; };
    const openTF = async () => { await ev(`ESA.app.openApp('travel-footprint')`); await sleep(2200); };
    await openTF();

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
    fs.writeFileSync(path.join(os.tmpdir(), 'tf-backup3.json'), backup || '{}');
    const restoreFn = fs.readFileSync(path.join(__dirname, 'restore-snippet.txt'), 'utf8').replace('__BACKUP_JSON__', backup || '{}');

    /* XSS 专项 */
    await ev(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const r = w.TF.app.repo;
      const c = await r.save('city', { name: '<img src=x onerror=window.__xss=1>', latitude: 30, longitude: 110 });
      await r.save('trip', { cityId: c.id, startDate: '2026-09-28', endDate: '2026-09-28', note: '<script>window.__xss2=1</script>' });
      w.TF.app.router.showTab('cities');
    })()`);
    await sleep(1200);
    console.log('XSS专项:', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; return JSON.stringify({ xss1: !!window.__xss, xss2: !!w.__xss2, cityRendered: w.document.body.textContent.indexOf('img src=x') >= 0 }); })()`));
    // 清理 XSS 测试数据（软删）
    await ev(`(async () => { const w = document.querySelector('.module-frame.is-active').contentWindow; const r = w.TF.app.repo; const c = r.findCityByName('<img src=x onerror=window.__xss=1>'); if (c) { (r.tripsOfCity ? r.tripsOfCity(c.id) : []).forEach(async t => await r.save('trip', { id: t.id, deletedAt: new Date().toISOString() })); await r.save('city', { id: c.id, deletedAt: new Date().toISOString() }); } })()`);
    await sleep(400);

    /* 随机状态机 1000 actions */
    const ACTIONS = ['OPEN_TRAVEL', 'BACK_HOME', 'MAP', 'TIMELINE', 'CITIES', 'SWITCH_THEME', 'ADD_TRIP', 'DELETE_TRIP', 'RESTORE_TRIP', 'RELOAD', 'CLICK_WIDGET'];
    const seqLog = [];
    let actions = 0;
    const dates = ['2026-09-28', '2024-02-29', '2025-12-31', '2026-01-01', '2020-02-29', '2026-06-15'];
    const names = ['随机城A', '随机城B', 'Tokyo', '서울', '😀城', '长'.repeat(80)];
    for (let i = 0; i < 1000; i++) {
      const act = ACTIONS[Math.floor(rand() * ACTIONS.length)];
      seqLog.push(act);
      try {
        switch (act) {
          case 'OPEN_TRAVEL': await ev(`ESA.app.openApp('travel-footprint')`); await sleep(300); break;
          case 'BACK_HOME': await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(220); break;
          case 'MAP': await ev(`(() => { const w = document.querySelector('.module-frame.is-active'); if (w) { const x = w.contentWindow; try { x.TF.app.router.showTab('map'); } catch (e) {} } })()`); await sleep(120); break;
          case 'TIMELINE': await ev(`(() => { const w = document.querySelector('.module-frame.is-active'); if (w) { const x = w.contentWindow; try { x.TF.app.router.showTab('timeline'); } catch (e) {} } })()`); await sleep(120); break;
          case 'CITIES': await ev(`(() => { const w = document.querySelector('.module-frame.is-active'); if (w) { const x = w.contentWindow; try { x.TF.app.router.showTab('cities'); } catch (e) {} } })()`); await sleep(120); break;
          case 'SWITCH_THEME': await ev(`ESA.prefs.setTheme('${rand() < 0.5 ? 'dark' : 'light'}')`); await sleep(150); break;
          case 'ADD_TRIP': {
            const name = names[Math.floor(rand() * names.length)];
            const d1 = dates[Math.floor(rand() * dates.length)];
            await ev(`(async () => { const w = document.querySelector('.module-frame.is-active'); if (!w) return; const x = w.contentWindow; const r = x.TF.app.repo; let c = r.findCityByName('${name}'); if (!c) c = await r.save('city', { name: '${name}', latitude: 30 + Math.random() * 10, longitude: 110 + Math.random() * 10 }); await r.save('trip', { cityId: c.id, startDate: '${d1}', endDate: '${d1}' }); })()`);
            await sleep(200); break;
          }
          case 'DELETE_TRIP': await ev(`(async () => { const w = document.querySelector('.module-frame.is-active'); if (!w) return; const x = w.contentWindow; const ts = x.TF.app.repo.liveTrips(); if (ts.length) await x.TF.app.repo.save('trip', { id: ts[ts.length - 1].id, deletedAt: new Date().toISOString() }); })()`); await sleep(200); break;
          case 'RESTORE_TRIP': await ev(`(async () => { const w = document.querySelector('.module-frame.is-active'); if (!w) return; const x = w.contentWindow; const all = x.TF.app.repo.allTrips ? x.TF.app.repo.allTrips() : []; const del = all.filter(t => t.deletedAt); if (del.length) await x.TF.app.repo.save('trip', { id: del[0].id, deletedAt: null }); })()`); await sleep(200); break;
          case 'RELOAD': if (rand() < 0.15) { await ev(`location.reload()`); await sleep(2500); } break;
          case 'CLICK_WIDGET': await ev(`(() => { const c = document.querySelectorAll('.appcard')[2]; if (c) c.click(); })()`); await sleep(200); break;
        }
        actions++;
      } catch (e) {
        bugLog.push({ i, act, err: String(e).slice(0, 150), seq: seqLog.slice(-12) });
        // 记录证据
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`D:/workbuddy/all/ethan-super-app/docs/shots/stress-bug-${i}.png`, Buffer.from(shot.data, 'base64'));
        fs.writeFileSync(`D:/workbuddy/all/ethan-super-app/docs/shots/stress-bug-${i}.json`, JSON.stringify({ seed: SEED, i, act, seq: seqLog, exc: excLog.slice(-5) }, null, 2));
      }
      // 每 200 actions 健康抽查
      if (i % 200 === 199) {
        const bad = await ev(`(() => { const b = document.body.textContent || ''; return /undefined|NaN|\\[object Object\\]/.test(b); })()`);
        if (bad) bugLog.push({ i, type: 'badText', seq: seqLog.slice(-12) });
        console.log('...进度', i + 1, '| consoleErr:', consoleErrors, '| exc:', pageExceptions, '| badText:', bad);
      }
    }
    console.log('随机状态机完成:', actions, 'actions | bugs:', bugLog.length, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    fs.writeFileSync(path.join(os.tmpdir(), 'stress-b-seq.json'), JSON.stringify({ seed: SEED, seq: seqLog, bugs: bugLog }, null, 2));

    /* 竞态专项：打开中返回 × 20 + 主题-加载竞态 × 20 */
    for (let i = 0; i < 20; i++) {
      await ev(`ESA.app.openApp('travel-footprint')`);
      await sleep(40 + i * 10); // 递增延迟：覆盖加载各阶段
      await ev(`window.ESA_back ? window.ESA_back() : null`);
      await sleep(80);
    }
    for (let i = 0; i < 20; i++) {
      await ev(`ESA.app.openApp('travel-footprint')`);
      await sleep(60);
      await ev(`ESA.prefs.setTheme('${i % 2 ? 'dark' : 'light'}')`);
      await sleep(120);
    }
    await sleep(1000);
    const hc = await ev(`(() => { const b = document.body.textContent || ''; const themes = Array.from(document.querySelectorAll('.module-frame')).map(f => { try { return f.contentDocument.documentElement.getAttribute('data-theme'); } catch (e) { return 'N/A'; } }); return JSON.stringify({ badText: /undefined|NaN|\\[object Object\\]/.test(b), themes }); })()`);
    console.log('竞态后状态:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);

    /* 恢复真实数据 */
    await ev(`window.__TF_BACKUP__ = ${fs.readFileSync(path.join(os.tmpdir(), 'tf-backup3.json'), 'utf8')}`);
    const restoreFn2 = `(async () => {
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
    console.log('恢复:', await ev(restoreFn2));
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(600);
    console.log('恢复后首页:', await ev(`(() => { const d = document; const cards = d.querySelectorAll('.appcard'); const stat = cards[2] ? (cards[2].querySelector('.appcard__stat') || {}).textContent || '' : ''; return JSON.stringify({ stat, consoleErr: ${consoleErrors}, exc: ${pageExceptions}, bugs: ${bugLog.length} }); })()`));
    if (excLog.length) console.log('异常样本:\n' + excLog.slice(0, 12).join('\n'));
  } finally { try { edge.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
