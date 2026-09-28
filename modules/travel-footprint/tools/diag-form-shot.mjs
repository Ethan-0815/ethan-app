/* One-off visual check: trip form with photo preview + attachment row. */
import { launch, evaluate } from './cdp.mjs';
import { server, PORT } from './serve.mjs';
import { writeFileSync } from 'node:fs';

const { child, client } = await launch({ port: 9233 });
const C = client;

await evaluate(C, `
  location.href = 'http://127.0.0.1:${PORT}/';
  return true;
`);
await evaluate(C, `return new Promise(r => setTimeout(r, 1500));`);

await evaluate(C, `
  return (async () => {
    try { TF.app.repo.clearAll && await TF.app.repo.clearAll(); } catch (e) {}
    const sh = await TF.app.repo.save('city', { name: '上海', country: '中国', province: '上海', latitude: 31.23, longitude: 121.47 });
    TF.ui.flows.addTrip({ cityId: sh.id });
    await new Promise(r => setTimeout(r, 700));

    // a colourful 40×30 jpeg so the thumbnail is visible
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 30;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 40, 30);
    g.addColorStop(0, '#e8956d'); g.addColorStop(1, '#3c7a78');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 40, 30);
    ctx.fillStyle = '#fff'; ctx.fillRect(16, 10, 8, 8);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    const file = new File([blob], 'shot.jpg', { type: 'image/jpeg' });

    TF.native.pickImages = function () { return Promise.resolve([file, file]); };
    TF.native.pickFile = function () { return Promise.resolve({ name: '行程单.pdf', mime: 'application/pdf', bytes: new Uint8Array(2048) }); };

    const pickBtn = Array.from(document.querySelectorAll('.form-picks__actions .btn--ghost')).find(b => /相册/.test(b.textContent));
    pickBtn.click();
    await new Promise(r => setTimeout(r, 300));
    const fileBtn = Array.from(document.querySelectorAll('.form-picks__actions .btn--ghost')).find(b => /文件/.test(b.textContent));
    fileBtn.click();
    await new Promise(r => setTimeout(r, 300));
    return true;
  })();
`);

// scroll the form body to show the picks section
await evaluate(C, `
  const body = document.querySelector('.sheet--form .form__body');
  if (body) body.scrollTop = body.scrollHeight;
  return true;
`);
await evaluate(C, `return new Promise(r => setTimeout(r, 300));`);

const shot = await C.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('docs/shots/19-trip-form-picks.png', Buffer.from(shot.data, 'base64'));
console.log('saved 19-trip-form-picks.png');

child.kill();
process.exit(0);
