// 生成 launcher 图标 PNG（各密度）。
// 思路：用无头浏览器把 SVG 渲染成任意尺寸的 PNG，避免引入 canvas/sharp 依赖。
// 用法：node tools/gen-icons.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICON_DIR = join(ROOT, 'android', 'icon');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

// 传统 launcher 图标密度尺寸（正方形）+ 圆角版本
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192]
];

// 自适应图标前景需要 108dp，各密度 = dp * scale * 108/48? 直接用规范尺寸：
// mdpi 108, hdpi 162, xhdpi 216, xxhdpi 324, xxxhdpi 432
const ADAPTIVE = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432]
];

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;

function startBrowser(profile) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank'
  ];
  return spawn(EDGE, args, { stdio: 'ignore', detached: false });
}

async function waitTargets(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('浏览器未就绪');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        close() { try { ws.close(); } catch {} }
      })
    );
    ws.addEventListener('error', (e) => reject(new Error('WS 错误')));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
  });
}

async function renderSvg(client, svgText, size, outPath) {
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}</style>
${svgText}`;
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: size, height: size, deviceScaleFactor: 1, mobile: false
  });
  await client.send('Page.navigate', { url: dataUrl });
  await new Promise((r) => setTimeout(r, 260));
  await client.send('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 }
  });
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(data, 'base64'));
}

async function main() {
  const profile = join(tmpdir(), 'tf-icon-' + Date.now());
  const proc = startBrowser(profile);
  let client;
  try {
    const wsUrl = await waitTargets();
    client = await connect(wsUrl);

    const squareSvg = readFileSync(join(ICON_DIR, 'icon.svg'), 'utf8');
    const fgSvg = readFileSync(join(ICON_DIR, 'foreground.svg'), 'utf8');

    let n = 0;
    for (const [d, px] of DENSITIES) {
      const dir = join(RES, `mipmap-${d}`);
      await renderSvg(client, squareSvg, px, join(dir, 'ic_launcher.png'));
      await renderSvg(client, squareSvg, px, join(dir, 'ic_launcher_round.png'));
      n += 2;
    }
    for (const [d, px] of ADAPTIVE) {
      const dir = join(RES, `mipmap-${d}`);
      await renderSvg(client, fgSvg, px, join(dir, 'ic_launcher_foreground.png'));
      n += 1;
    }
    console.log(`已生成 ${n} 个图标文件`);
  } finally {
    if (client) client.close();
    try { proc.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error('图标生成失败：', e.message); process.exit(1); });
