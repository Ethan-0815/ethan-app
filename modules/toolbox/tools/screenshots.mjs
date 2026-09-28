/*!
 * 工具箱 · 界面截图（用于人工核对视觉改动）
 *   node tools/screenshots.mjs <pageUrl> <cdpPort> <outDir>
 */
const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const PORT = Number(process.argv[3] || 9334);
const OUT = process.argv[4] || 'D:/tmp';
const fs = await import('node:fs');
const path = await import('node:path');

const res = await fetch('http://127.0.0.1:' + PORT + '/json/new?url=about:blank', { method: 'PUT' });
const target = await res.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
});
await send('Page.enable');
await send('Runtime.enable');

async function shoot(name, script, metrics) {
  await send('Emulation.setDeviceMetricsOverride', metrics || { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL_UNDER_TEST });
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: '!!(window.TB && TB.app && TB.app.runtime)', returnByValue: true });
    if (r.result.value) break;
    await new Promise((r2) => setTimeout(r2, 150));
  }
  if (script) {
    await send('Runtime.evaluate', { expression: '(async () => {' + script + '})()', awaitPromise: true, returnByValue: true });
  }
  await new Promise((r) => setTimeout(r, 500));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, 'tb-' + name + '.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved ' + file);
}

const open = (tool) => "TB.app.runtime.openTool('" + tool + "'); await new Promise(r=>setTimeout(r,600));";

await shoot('home', null);
await shoot('calc', open('calc'));
await shoot('uuid', open('uuid'));
await shoot('json', open('json'));
await shoot('timestamp', open('timestamp'));
await shoot('radix-binary',
  "TB.app.runtime.openTool('radix'); await new Promise(r=>setTimeout(r,500));" +
  "const b=Array.prototype.slice.call(document.querySelectorAll('.screen--visible:not(.screen--behind)')).pop();" +
  "b.querySelectorAll('.segmented__item').forEach(function(el){ if(el.dataset.id==='2') el.click(); });" +
  "await new Promise(r=>setTimeout(r,300));" +
  "const inp=b.querySelector('.input--num'); inp.value='255'; inp.dispatchEvent(new Event('input',{bubbles:true}));" +
  "await new Promise(r=>setTimeout(r,400));");
ws.close();
