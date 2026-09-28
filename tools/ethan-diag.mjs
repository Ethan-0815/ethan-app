#!/usr/bin/env node
/* 诊断：ETHAN 设置 PIN → 解锁 → 截图首页/机密页 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_URL = `http://127.0.0.1:${process.argv[2] || 8924}/`;
const OUT = 'D:/workbuddy/all/ethan-super-app/docs/shots';
const CDP_PORT = '9375';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res2, rej2) => {
          const mid = ++id;
          pending.set(mid, { res2, rej2 });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { try { ws.close(); } catch (e) {} }
    });
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.rej2(new Error(JSON.stringify(msg.error))) : p.res2(msg.result);
      }
    };
  });
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-ethdiag-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) {}
    }
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(2200);
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result.value;
    };
    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.data, 'base64'));
      console.log('saved', name);
    };
    const tapPin = async () => {
      await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const keys = Array.from(w.document.querySelectorAll('#lock button')); '123456'.split('').forEach(ch => { const k = keys.find(b => b.textContent.trim() === ch); if (k) k.click(); }); const ok = keys.find(b => b.textContent.trim() === '✓'); if (ok) ok.click(); return true; })()`);
      await sleep(700);
    };
    await ev(`localStorage.setItem('esa.theme','dark'); ESA.prefs.setTheme('dark'); ESA.app.openApp('ethan')`);
    await sleep(2600);
    await tapPin(); // 设置 PIN
    await tapPin(); // 确认 PIN
    console.log('locked?', await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; return w.document.getElementById('lock').hidden; })()`));
    await shot('ethan-home-after-unlock');
    // 切到机密 tab
    await ev(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const tabs = Array.from(w.document.querySelectorAll('#tabbar .tab')); const t = tabs.find(b => b.textContent.includes('机密')); if (t) t.click(); })()`);
    await sleep(800);
    await shot('ethan-secrets-after-unlock');
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
