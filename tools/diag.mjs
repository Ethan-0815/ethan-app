#!/usr/bin/env node
/* 诊断：加载首页，打印 console 错误与 DOM 状态 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_URL = `http://127.0.0.1:${process.argv[2] || 8923}/`;
const CDP_PORT = '9341';
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
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[console.' + msg.params.type + ']', msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[exception]', JSON.stringify(msg.params.exceptionDetails, null, 2).slice(0, 800));
      }
    };
  });
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-diag-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
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
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(2000);
    const r = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({readyState: document.readyState, scripts: document.scripts.length, brand: !!document.querySelector('.home__brand'), homeHTML: (document.getElementById('home-screen')||{}).innerHTML ? document.getElementById('home-screen').innerHTML.slice(0,200) : 'EMPTY', hasESA: !!window.ESA, hasHome: !!(window.ESA && ESA.home)})`, returnByValue: true });
    console.log(r.result.value);
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main();
