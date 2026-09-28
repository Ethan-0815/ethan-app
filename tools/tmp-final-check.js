/* 深浅色同步抽查：主题切换后四模块 data-theme 一致性 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CDP_PORT = '9547';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({ send(method, params = {}) { return new Promise((res2, rej2) => { const mid = ++id; pending.set(mid, { res2, rej2 }); ws.send(JSON.stringify({ id: mid, method, params })); }); }, close() { try { ws.close(); } catch (e) {} } });
    ws.onerror = () => reject(new Error('ws'));
    ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej2(new Error(JSON.stringify(msg.error))) : p.res2(msg.result); } };
  });
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-final-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', '--window-size=412,901', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); target = list.find((t) => t.type === 'page'); if (target) break; } catch (e) {} }
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8924/app/index.html' });
    await sleep(3000);
    const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails.exception).slice(0, 200); return r.result.value; };

    // 依次打开四个模块（预加载全部 iframe），设置深色，检查全部同步
    for (const m of ['my-space', 'toolbox', 'travel-footprint', 'ethan']) {
      await ev(`ESA.app.openApp('${m}')`);
      await sleep(2200);
      await ev(`window.ESA_back ? window.ESA_back() : null`);
      await sleep(500);
    }
    await ev(`ESA.prefs.setTheme('dark')`);
    await sleep(800);
    console.log('深色同步:', await ev(`(() => {
      const themes = Array.from(document.querySelectorAll('.module-frame')).map(f => f.contentDocument.documentElement.getAttribute('data-theme'));
      return JSON.stringify({ shell: document.documentElement.getAttribute('data-theme'), modules: themes, all: themes.every(t => t === 'dark') });
    })()`));
    await ev(`ESA.prefs.setTheme('light')`);
    await sleep(800);
    console.log('浅色同步:', await ev(`(() => {
      const themes = Array.from(document.querySelectorAll('.module-frame')).map(f => f.contentDocument.documentElement.getAttribute('data-theme'));
      return JSON.stringify({ shell: document.documentElement.getAttribute('data-theme'), modules: themes, all: themes.every(t => t === 'light') });
    })()`));

    // 响应式抽查：三档视口横向溢出
    for (const wh of [[320, 568], [390, 844], [1280, 800]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: wh[0], height: wh[1], deviceScaleFactor: 2, mobile: wh[0] < 800 });
      await sleep(500);
      console.log(wh[0] + 'x' + wh[1], await ev(`(() => { const d = document.documentElement; const overflowHome = d.scrollWidth > d.clientWidth; const cards = Array.from(document.querySelectorAll('.appcard')).map(c => Math.round(c.getBoundingClientRect().height)); return JSON.stringify({ overflowHome, cardsEqual: new Set(cards).size <= 1 }); })()`));
    }
  } finally { try { edge.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
