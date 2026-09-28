/* Diagnose: trip-form photo/attachment save path. */
import { launch, evaluate, sleep, captureConsole } from './cdp.mjs';
import { server, PORT } from './serve.mjs';

const { child, client } = await launch({ port: 9231 });
const C = client;
const sink = [];
captureConsole(C, sink);
C.on('Runtime.exceptionThrown', (p) => {
  console.log('[exception]', p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
});

await evaluate(C, `
  location.href = 'http://127.0.0.1:${PORT}/';
  return true;
`);
await evaluate(C, `return new Promise(r => setTimeout(r, 1500));`);

// wipe + seed minimal
await evaluate(C, `
  return (async () => {
    try { TF.app.repo.clearAll && await TF.app.repo.clearAll(); } catch (e) {}
    return true;
  })();
`);

// stub pickers with a REAL 1x1 jpeg
const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

await evaluate(C, `
  return (async () => {
    const b64 = '${jpegB64}';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // sanity: can TF.image decode it at all?
    const file = new File([bytes], 'shot.jpg', { type: 'image/jpeg' });
    let decErr = null;
    try {
      const out = await TF.image.processFile(file);
      window.__decode = { ok: true, w: out.width, h: out.height, bytes: out.bytes.length };
    } catch (e) { window.__decode = { ok: false, err: String(e) }; }

    TF.native.pickImages = function () { return Promise.resolve([file]); };
    TF.native.pickFile = function () { return Promise.resolve({ name: 'note.txt', mime: 'text/plain', bytes: new Uint8Array([104, 105]) }); };

    const sh = await TF.app.repo.save('city', { name: '上海', country: '中国', province: '上海', latitude: 31.23, longitude: 121.47 });
    TF.ui.flows.addTrip({ cityId: sh.id });
    await new Promise(r => setTimeout(r, 600));
    return { cityId: sh.id, decode: window.__decode, formOpen: !!document.querySelector('.sheet--form') };
  })();
`);

// click pickers
await evaluate(C, `
  return (async () => {
    const btns = Array.from(document.querySelectorAll('.form-picks__actions .btn--ghost'));
    const pick = btns.find(b => /相册/.test(b.textContent));
    if (pick) pick.click();
    await new Promise(r => setTimeout(r, 400));
    const thumbs = document.querySelectorAll('.form-pick__thumb').length;
    const fileBtn = Array.from(document.querySelectorAll('.form-picks__actions .btn--ghost')).find(b => /文件/.test(b.textContent));
    if (fileBtn) fileBtn.click();
    await new Promise(r => setTimeout(r, 400));
    const files = document.querySelectorAll('.form-pick__file').length;
    return { thumbs, files };
  })();
`);

// click save
const saved = await evaluate(C, `
  return (async () => {
    // instrument the save pipeline
    const origProcess = TF.image.processFiles;
    TF.image.processFiles = function (files, opts) {
      window.__log.push('processFiles(' + files.length + ')');
      return origProcess.call(TF.image, files, opts).then(r => {
        window.__log.push('processFiles → ' + r.results.map(x => x && x.ok ? 'ok' : 'FAIL:' + (x && x.error && x.error.message)).join(','));
        return r;
      });
    };
    const origPut = TF.app.repo.putBlob.bind(TF.app.repo);
    TF.app.repo.putBlob = function (id, bytes, mime) {
      window.__log.push('putBlob ' + id.slice(0, 6) + ' len=' + (bytes ? bytes.length : 'null'));
      return origPut(id, bytes, mime).then(r => { window.__log.push('putBlob ok'); return r; }, e => { window.__log.push('putBlob ERR ' + e.message); throw e; });
    };
    const origSave = TF.app.repo.save.bind(TF.app.repo);
    TF.app.repo.save = function (table, row) {
      window.__log.push('save ' + table);
      return origSave(table, row).then(r => { window.__log.push('save ' + table + ' ok'); return r; }, e => { window.__log.push('save ' + table + ' ERR ' + e.message); throw e; });
    };

    window.__log = [];
    const saveBtn = Array.from(document.querySelectorAll('.sheet--form .btn--primary')).find(b => /保存/.test(b.textContent));
    if (!saveBtn) return { saveBtn: false };
    saveBtn.click();
    await new Promise(r => setTimeout(r, 2500));
    const s = TF.app.repo.stats();
    return {
      saveBtn: true,
      formOpen: !!document.querySelector('.sheet--form'),
      photo: s.photoCount,
      att: s.attachmentCount,
      log: window.__log
    };
  })();
`);

console.log('decode:', JSON.stringify((await evaluate(C, 'return window.__decode;'))));
console.log('saved:', JSON.stringify(saved));
console.log('console:', sink.slice(-12).join('\n  '));

child.kill();
process.exit(0);
