// 诊断：地图页为何渲染失败
import '../tools/serve.mjs';
import * as CDP from './cdp.mjs';

const browser = await CDP.launch({ port: 9339 });
const client = browser.client;
const logs = CDP.captureConsole(client);

await CDP.newPage(client, 'http://127.0.0.1:5178/');
await CDP.waitFor(client, '!!(window.TF && TF.app && TF.app.router)', 15000);

await CDP.evaluate(client, `
  TF.app.router.showTab('map');
  await new Promise(r => setTimeout(r, 800));
  return true;
`);
await CDP.sleep(600);

const dump = await CDP.evaluate(client, `
  const s = document.querySelector('.screen-map');
  const vp = document.querySelector('.map-viewport');
  const svg = document.querySelector('.map-svg');
  const r = vp ? vp.getBoundingClientRect() : null;
  return JSON.stringify({
    hasScreen: !!s,
    screenClass: s ? s.className : null,
    hasViewport: !!vp,
    vpRect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    hasSvg: !!svg,
    viewBox: svg ? svg.getAttribute('viewBox') : null,
    par: svg ? svg.getAttribute('preserveAspectRatio') : null,
    dots: document.querySelectorAll('.map-dot').length,
    land: document.querySelectorAll('.map-land').length,
    modes: document.querySelectorAll('.map-mode').length,
    activeTab: TF.app.router.tab
  }, null, 2);
`);
console.log('--- DOM ---');
console.log(dump);
console.log('--- console 日志 ---');
for (const l of logs()) console.log(l);

client.close();
await browser.close();
process.exit(0);
