#!/usr/bin/env node
/* 诊断：点击齿轮后的错误定位 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_URL = `http://127.0.0.1:${process.argv[2] || 8924}/`;
const CDP_PORT = '9345';
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
        console.log('[console.' + msg.params.type + ']', msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log('[exception]', d.text, d.exception && (d.exception.description || d.exception.value) || '', d.stackTrace ? JSON.stringify(d.stackTrace.callFrames.slice(0,3)) : '');
      }
    };
  });
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-diag2-'));
  const edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', '--headless=new', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
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
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result.value !== undefined ? r.result.value : JSON.stringify(r);
    };
    console.log(await ev(`typeof ESA.app.openSettings`));
    console.log(await ev(`try { ESA.app.openSettings('general'); 'ok' } catch(e) { 'ERR: ' + e.message + ' | ' + e.stack.split('\\n')[1] }`));
    await sleep(300);
    console.log(await ev(`document.getElementById('settings-screen').classList.contains('is-active')`));
    console.log(await ev(`try { document.querySelectorAll('.theme-seg__opt')[1].click(); 'ok' } catch(e) { 'ERR: ' + e.message }`));
    await sleep(300);
    console.log('theme=' + await ev(`document.documentElement.getAttribute('data-theme')`));
    console.log('esa.theme=' + await ev(`localStorage.getItem('esa.theme')`));
    console.log(await ev(`try { document.querySelectorAll('.appcard')[1].click(); 'ok' } catch(e) { 'ERR: ' + e.message }`));
    await sleep(2500);
    console.log('toolbox ready=' + await ev(`ESA.modules.isReady('toolbox')`));
    console.log('iframes=' + await ev(`document.querySelectorAll('.module-frame').length`));
    console.log('iframe src=' + await ev(`(document.querySelector('.module-frame')||{}).src`));
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main();
