/* ==========================================================================
   tools/cdp.mjs — tiny Chrome DevTools Protocol client over raw WebSocket.
   No dependencies: we speak the protocol directly so the test harness has
   nothing to install and works offline.
   ========================================================================== */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

/* ------------------------------------------------------------ browser --- */

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.TF_BROWSER || ''
];

export function findBrowser() {
  for (const c of CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(
    'No Chromium browser found. Set TF_BROWSER to an msedge.exe / chrome.exe path.'
  );
}

function waitPort(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('CDP port timeout'));
        else setTimeout(poll, 120);
      });
    })();
  });
}

export async function launch(opts = {}) {
  const exe = findBrowser();
  const port = opts.port || 9223;
  // NOTE: a persistent profile dir keeps IndexedDB usable across the run, and
  // keeps us from touching the user's real browser profile.
  const profile = opts.profile || path.join(os.tmpdir(), 'tf-cdp-profile-' + port);
  fs.mkdirSync(profile, { recursive: true });

  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--window-size=430,932',
    '--headless=new',
    'about:blank'
  ];

  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', () => {});   // silence MS Edge chatter

  await waitPort(port);

  // create a target
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT'
  }).catch(() => null);

  let target;
  if (res && res.ok) {
    target = await res.json();
  } else {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  }
  if (!target || !target.webSocketDebuggerUrl) {
    throw new Error('Could not obtain a CDP page target');
  }

  const client = await connect(target.webSocketDebuggerUrl);
  return { child, client, port, profile };
}

/* -------------------------------------------------------------- client --- */

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    // Node 22 ships a global WebSocket — use it, no ws dependency needed.
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(msg.error.message || 'CDP error'));
        else r(msg.result);
        return;
      }
      if (msg.method) {
        const fns = listeners.get(msg.method);
        if (fns) fns.forEach((f) => f(msg.params));
      }
    });

    ws.addEventListener('error', (e) => reject(e.error || new Error('ws error')));

    ws.addEventListener('open', () => {
      const client = {
        ws,
        send(method, params) {
          const mid = ++id;
          return new Promise((r, j) => {
            pending.set(mid, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
            setTimeout(() => {
              if (pending.has(mid)) {
                pending.delete(mid);
                j(new Error('CDP timeout: ' + method));
              }
            }, 40000);
          });
        },
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(fn);
        },
        close() { try { ws.close(); } catch {} }
      };
      resolve(client);
    });
  });
}

/* --------------------------------------------------------------- page --- */

export async function newPage(client, url = 'about:blank') {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  await client.send('Page.navigate', { url });
  await waitForLoad(client);
  return client;
}

function waitForLoad(client) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    client.on('Page.loadEventFired', finish);
    setTimeout(finish, 8000);
  });
}

/** Evaluate an async expression in the page and return its value. */
export async function evaluate(client, expression) {
  const wrapped = `(async () => { ${expression} })()`;
  const r = await client.send('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise: true,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(
      'Page exception: ' +
      (d.exception && (d.exception.description || d.exception.value)) ||
      d.text
    );
  }
  return r.result.value;
}

/** Wait until `expression` evaluates truthy, or throw. */
export async function waitFor(client, expression, timeoutMs = 6000, label = '') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await evaluate(client, `return (${expression});`).catch(() => false);
    if (v) return v;
    await sleep(120);
  }
  throw new Error('waitFor timeout' + (label ? ' (' + label + ')' : '') + ': ' + expression);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ console capture --- */

export function captureConsole(client, sink) {
  client.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || [])
      .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
      .join(' ');
    sink.push({ type: p.type, text });
  });
  client.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    sink.push({
      type: 'exception',
      text: (d.exception && (d.exception.description || d.exception.value)) || d.text
    });
  });
  client.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level === 'error' || e.level === 'warning') {
      sink.push({ type: e.level, text: e.text + (e.url ? ' @ ' + e.url : '') });
    }
  });
}
