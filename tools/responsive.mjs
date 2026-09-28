#!/usr/bin/env node
/* 响应式检查：320/375/390/430/768/1280 断言无横向溢出 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_URL = `http://127.0.0.1:${process.argv[2] || 8924}/`;
const CDP_PORT = '9355';
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-resp-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let passed = 0, failed = 0;
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
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(2000);
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result.value;
    };
    const check = `(() => { const d = document.documentElement; return { sw: d.scrollWidth, cw: d.clientWidth, overflow: d.scrollWidth > d.clientWidth }; })()`;

    for (const [w, h, name] of [[320, 640, '320 手机小屏'], [375, 812, '375 手机'], [390, 844, '390 手机'], [430, 932, '430 大屏手机'], [768, 1024, '768 平板'], [1280, 800, '1280 桌面']]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 800 });
      await sleep(450);
      const home = await ev(check);
      if (!home.overflow) passed++; else { failed++; console.log(`  ✗ ${name} 首页横向溢出 ${home.sw}>${home.cw}`); }
      // 设置页
      await ev(`ESA.app.openSettings('general')`);
      await sleep(350);
      const settings = await ev(check);
      if (!settings.overflow) passed++; else { failed++; console.log(`  ✗ ${name} 设置页横向溢出 ${settings.sw}>${settings.cw}`); }
      // 模块页（toolbox）
      await ev(`ESA.app.closeSettings(); ESA.app.openApp('toolbox')`);
      await sleep(1400);
      const mod = await ev(`(() => { const f = document.querySelector('.module-frame.is-active'); if (!f || !f.contentDocument) return {overflow:false}; const d = f.contentDocument.documentElement; return { overflow: d.scrollWidth > d.clientWidth, sw: d.scrollWidth }; })()`);
      if (!mod.overflow) passed++; else { failed++; console.log(`  ✗ ${name} 工具箱横向溢出 ${JSON.stringify(mod)}`); }
      await ev(`ESA_back()`);
      await sleep(300);
      console.log(`  ✓ ${name}（首页/设置/工具箱）`);
    }
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(`\n响应式：通过 ${passed}，失败 ${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('响应式检查失败:', e.message); process.exit(2); });
