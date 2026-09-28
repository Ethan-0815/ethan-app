// 复现修复效果：①真实命中测试点击空白处关闭 ②内置城市建议可选
import '../tools/serve.mjs';
import * as CDP from './cdp.mjs';

const browser = await CDP.launch({ port: 9343 });
const client = browser.client;
const sink = [];
CDP.captureConsole(client, sink);

/** 真实鼠标点击（走 Chromium 输入管线，含命中测试） */
async function realClick(x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

await CDP.newPage(client, 'http://127.0.0.1:5178/');
await CDP.waitFor(client, '!!(window.TF && TF.app && TF.app.router)', 15000);

// ---- 1. 空库打开选择器：应出现热门城市 ----
await CDP.evaluate(client, `
  TF.ui.flows.addTrip();
  await new Promise(r => setTimeout(r, 500));
  return true;
`);
const s1 = await CDP.evaluate(client, `
  const groups = [...document.querySelectorAll('.chooser__group')].map(g => g.textContent);
  const rows = [...document.querySelectorAll('.chooser__row')].slice(0, 5).map(b => b.textContent.trim().slice(0, 22));
  return JSON.stringify({ groups, rows, total: document.querySelectorAll('.chooser__row').length });
`);
console.log('--- 空库时的选择器 ---');
console.log(s1);

// ---- 2. 真实点击 sheet 上方的空白处（backdrop）应关闭 ----
const hit = await CDP.evaluate(client, `
  const bd = document.querySelector('#overlay-root .overlay__backdrop');
  const r = bd.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + 30);
  const el = document.elementFromPoint(x, y);
  return JSON.stringify({ x, y, hit: el ? el.className || el.tagName : 'none' });
`);
console.log('--- 空白处命中测试（应命中 backdrop）---');
console.log(hit);
const h = JSON.parse(hit);
await realClick(h.x, h.y);
await CDP.sleep(400);
const s2 = await CDP.evaluate(client, `return document.querySelectorAll('#overlay-root .overlay').length;`);
console.log('--- 真实点击空白后 overlay 数量（应为 0）---', s2);

// ---- 3. 输入"桂"应出现内置桂林建议 ----
await CDP.evaluate(client, `
  TF.ui.flows.addTrip();
  await new Promise(r => setTimeout(r, 500));
  const input = document.querySelector('.chooser__input');
  input.value = '桂';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return true;
`);
const s3 = await CDP.evaluate(client, `
  const rows = [...document.querySelectorAll('.chooser__row')].map(b => ({
    cls: b.className.includes('builtin') ? 'BUILTIN' : b.className.includes('new') ? 'NEW' : 'CITY',
    text: b.textContent.trim().slice(0, 30)
  }));
  return JSON.stringify(rows, null, 1);
`);
console.log('--- 输入"桂"后的行（应含 BUILTIN 桂林）---');
console.log(s3);

// ---- 4. 点击内置桂林 → 表单锁定桂林 ----
await CDP.evaluate(client, `
  const row = document.querySelector('.chooser__row--builtin');
  if (row) row.click();
  await new Promise(r => setTimeout(r, 600));
  return true;
`);
const s4 = await CDP.evaluate(client, `
  const locked = document.querySelector('.form__locked-name');
  return JSON.stringify({
    lockedCity: locked ? locked.textContent : null,
    overlays: document.querySelectorAll('#overlay-root .overlay').length
  });
`);
console.log('--- 点击内置桂林后 ---');
console.log(s4);

// ---- 5. 填日期保存 → 城市应带广西+坐标 ----
const s5 = await CDP.evaluate(client, `
  const start = document.querySelector('#overlay-root input[type="date"]');
  const btns = [...document.querySelectorAll('#overlay-root button')];
  const save = btns.find(b => /保存|记录|完成/.test(b.textContent));
  if (start) start.value = '2026-08-12';
  if (start) start.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  if (save) save.click();
  await new Promise(r => setTimeout(r, 700));
  const city = TF.app.repo.findCityByName('桂林');
  return JSON.stringify({
    saved: !!city,
    province: city ? city.province : null,
    lat: city ? city.latitude : null,
    lng: city ? city.longitude : null
  });
`);
console.log('--- 保存后城市数据（应有广西+坐标）---');
console.log(s5);

console.log('--- console ---');
for (const l of sink) console.log(l.type + ': ' + l.text);

client.close();
try { browser.child.kill(); } catch (e) {}
process.exit(0);
