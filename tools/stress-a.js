/* 旅行足迹小组件 · 暴力测试 A：备份 → 高频点击/刷新/切换/主题 → 数据边界 → 恢复 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CDP_PORT = '9551';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACKUP = path.join(os.tmpdir(), 'tf-backup.json');

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-stress-a-'));
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

    /* ---------- 备份真实数据（5 个 store） ---------- */
    const backup = await ev(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const dbs = await new Promise((res) => {
        const req = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
        Promise.resolve(req).then(r => res(r || [])).catch(() => res([]));
      });
      const names = dbs.map(d => d.name).filter(n => n && n.indexOf('travel-footprint') === 0);
      const out = {};
      for (const name of names) {
        const db = await new Promise((res) => { const q = indexedDB.open(name); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
        const stores = Array.from(db.objectStoreNames);
        out[name] = {};
        for (const st of stores) {
          out[name][st] = await new Promise((res) => {
            try { const rq = db.transaction(st, 'readonly').objectStore(st).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); } catch (e) { res([]); }
          });
        }
        db.close();
      }
      return JSON.stringify(out);
    })()`);
    fs.writeFileSync(BACKUP, backup || '{}');
    console.log('备份完成:', (backup || '').length, 'bytes, stores:', Object.keys(JSON.parse(backup || '{}')).length);

    /* ---------- 恢复函数（页面内注入） ---------- */
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
      const statOk = /^\\d+ 个城市$/.test(stat);
      const frames = d.querySelectorAll('.module-frame');
      return JSON.stringify({ badText, stat, statOk, frames: frames.length });
    })()`;

    /* ---------- A. 高频点击 widget ×100 ---------- */
    let widgetClickFails = 0;
    for (let i = 0; i < 100; i++) {
      await ev(`(() => { const c = document.querySelectorAll('.appcard')[2]; if (c) c.click(); })()`);
      if (i % 25 === 0) await sleep(120);
    }
    await sleep(800);
    // 回首页
    for (let i = 0; i < 3; i++) { await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(250); }
    let hc = await ev(health);
    console.log('A 高频点击×100:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    if (JSON.parse(hc).badText || !JSON.parse(hc).statOk) widgetClickFails++;

    /* ---------- B. 首页↔旅行足迹 快速切换 ×100 cycles ---------- */
    for (let i = 0; i < 100; i++) {
      await ev(`ESA.app.openApp('travel-footprint')`);
      await sleep(45);
      await ev(`window.ESA_back ? window.ESA_back() : null`);
      await sleep(45);
    }
    await sleep(800);
    hc = await ev(health);
    console.log('B 页面切换×100:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    if (JSON.parse(hc).badText || !JSON.parse(hc).statOk) widgetClickFails++;

    /* ---------- C. TF 内部 tab 循环 ×50 ---------- */
    await ev(`ESA.app.openApp('travel-footprint')`);
    await sleep(2500);
    for (let i = 0; i < 50; i++) {
      await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; try { w.TF.app.router.showTab('map'); } catch(e){} })()`);
      await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; try { w.TF.app.router.showTab('timeline'); } catch(e){} })()`);
      await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; try { w.TF.app.router.showTab('cities'); } catch(e){} })()`);
    }
    await sleep(800);
    hc = await ev(health);
    console.log('C 内部tab×50:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);

    /* ---------- D. 主题切换 ×100 ---------- */
    for (let i = 0; i < 100; i++) {
      await ev(`ESA.prefs.setTheme('${i % 2 ? 'dark' : 'light'}')`);
      if (i % 20 === 0) await sleep(80);
    }
    await ev(`ESA.prefs.setTheme('dark')`);
    await sleep(500);
    hc = await ev(health);
    console.log('D 主题切换×100:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);

    /* ---------- E/F. 数据边界 ---------- */
    // 空数据
    await ev(`(async () => { const w = document.querySelector('.module-frame.is-active').contentWindow; const r = w.TF.app.repo; const ts = r.liveTrips(); for (const t of ts) await r.save('trip', { id: t.id, deletedAt: new Date().toISOString() }); })()`);
    await sleep(400);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(300);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(300);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(500);
    hc = await ev(health);
    console.log('E 空数据:', hc, '| stat应为 0 个城市:', JSON.parse(hc).stat);

    // 1 城 1 行程
    await ev(`(async () => { const w = document.querySelector('.module-frame.is-active').contentWindow; const r = w.TF.app.repo; const c = await r.save('city', { name: '北京', latitude: 39.9, longitude: 116.4 }); await r.save('trip', { cityId: c.id, startDate: '2026-09-28', endDate: '2026-09-28' }); })()`);
    await sleep(600);
    hc = await ev(health);
    console.log('F 1城1行程:', hc);

    // 日期/字符串边界 + 极端量
    const edge = await ev(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const r = w.TF.app.repo;
      const dates = ['2026-09-28','2026-09-27','2026-09-29','2026-02-28','2024-02-29','2025-12-31','2026-01-01','2026-12-31','2020-02-29'];
      const names = ['北京','Tokyo','New York','São Paulo','서울','東京','<img src=x onerror=window.__xss=1>','X'.repeat(300),'😀emoji 城市','a\\nb'];
      const notes = ['', 'x', 'n'.repeat(100), 'n'.repeat(500), 'line1\\nline2\\nline3', '🎉🚀💯', '<script>window.__xss2=1</script>', '中文English123!@#'];
      let made = 0;
      for (let i = 0; i < names.length; i++) {
        const c = await r.save('city', { name: names[i], latitude: 30 + i * 0.1, longitude: 110 + i * 0.1 });
        await r.save('trip', { cityId: c.id, startDate: dates[i % dates.length], endDate: dates[(i + 1) % dates.length], note: notes[i % notes.length] });
        made++;
      }
      // 同一天多条
      const c2 = await r.save('city', { name: '同日城', latitude: 31, longitude: 118 });
      for (let i = 0; i < 3; i++) await r.save('trip', { cityId: c2.id, startDate: '2026-09-28', endDate: '2026-09-28' });
      // 极端量：200 城市 + 500 trips
      for (let i = 0; i < 200; i++) {
        const c = await r.save('city', { name: '压测城' + i, latitude: 20 + (i % 40) * 0.3, longitude: 100 + (i % 50) * 0.4 });
        if (i % 2 === 0) await r.save('trip', { cityId: c.id, startDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), endDate: '2026-0' + (1 + i % 9) + '-2' + (i % 9) });
      }
      return 'made ' + made;
    })()`);
    console.log('极端数据:', edge);
    await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; w.TF.app.router.showTab('home'); })()`);
    await sleep(1500);
    hc = await ev(health);
    console.log('极端数据后:', hc, '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    // XSS 检查
    console.log('XSS检查:', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; return JSON.stringify({ xss1: !!window.__xss, xss2: !!w.__xss2 }); })()`));
    // 滚动性能抽查（城市列表大 DOM）
    const t0 = Date.now();
    await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; w.TF.app.router.showTab('cities'); })()`);
    await sleep(1200);
    console.log('城市列表打开耗时:', Date.now() - t0, 'ms |', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const n = w.document.querySelectorAll('.city-card').length; return '城市卡: ' + n; })()`));

    /* ---------- 恢复真实数据 ---------- */
    await ev(`window.__TF_BACKUP__ = ${fs.readFileSync(BACKUP, 'utf8')}`);
    const restored = await ev(restoreFn);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(400);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(400);
    await ev(`window.ESA_back ? window.ESA_back() : null`); await sleep(600);
    console.log('数据恢复:', restored, '| 最终:', await ev(health), '| consoleErr:', consoleErrors, '| exc:', pageExceptions);
    fs.writeFileSync(path.join(os.tmpdir(), 'stress-a-log.json'), JSON.stringify({ consoleErrors, pageExceptions, excLog }, null, 2));
  } finally { try { edge.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
