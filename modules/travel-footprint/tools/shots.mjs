/* tools/shots.mjs — capture screenshots of every screen for visual review. */
import { launch, newPage, evaluate, sleep } from './cdp.mjs';
import { server, PORT } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.cwd(), 'docs', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const { child, client } = await launch({ port: 9228 });
await newPage(client, `http://127.0.0.1:${PORT}/`);
await sleep(1800);

await evaluate(client, `return (async()=>{const d=await indexedDB.databases();for(const x of d)if(x.name)indexedDB.deleteDatabase(x.name);return 1;})();`);
await client.send('Page.reload', { ignoreCache: true });
await sleep(1800);

const SIZE = { w: 390, h: 844 };

async function setSize(w, h) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 2, mobile: true
  });
}

async function shot(name) {
  await sleep(650);
  const r = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  saved ' + name + '.png');
}

async function seedData() {
  return evaluate(client, `
    return (async () => {
      const repo = TF.app.repo;
      async function city(n, c, p, la, lo) { return repo.save('city', { name:n, country:c, province:p, latitude:la, longitude:lo }); }
      async function trip(id, s, e, note) { return repo.save('trip', { cityId:id, startDate:s, endDate:e, note:note||null }); }

      const sh = await city('上海','中国','上海',31.2304,121.4737);
      await trip(sh.id,'2024-10-01','2024-10-04','外滩的夜风和生煎，城市的呼吸声很轻。');
      await trip(sh.id,'2025-07-12','2025-07-16',null);
      await trip(sh.id,'2026-07-20','2026-07-24','去看朋友的新家，楼下有一棵很大的梧桐。');
      const gl = await city('桂林','中国','广西',25.2736,110.29);
      await trip(gl.id,'2026-08-12','2026-08-15','漓江的水比照片更安静，竹筏划过时能听见水声。');
      const tk = await city('东京','日本','东京都',35.6762,139.6503);
      await trip(tk.id,'2025-03-28','2025-04-02','樱花开到第七分，风一过就落了一地。');
      const gz = await city('广州','中国','广东',23.1291,113.2644);
      await trip(gz.id,'2025-12-30','2026-01-02','跨年的人潮，还有凌晨两点的肠粉。');
      await trip(gz.id,'2026-03-08','2026-03-08','当天往返，只为一口早茶。');
      const xa = await city('西安','中国','陕西',34.3416,108.9398);
      await trip(xa.id,'2024-05-01','2024-05-05','城墙上的风很大，钟楼的灯亮了一整夜。');
      const cd = await city('成都','中国','四川',30.5728,104.0668);
      await trip(cd.id,'2025-09-10','2025-09-14','在茶馆坐了一下午，时间过得很慢。');
      const xm = await city('厦门','中国','福建',24.4798,118.0894);
      await trip(xm.id,'2024-02-14','2024-02-18','海边的风带着一点咸味。');
      const km = await city('昆明','中国','云南',25.0389,102.7183);
      await trip(km.id,'2023-11-03','2023-11-08','滇池边喂海鸥，阳光很好。');
      const hz = await city('杭州','中国','浙江',30.2741,120.1551);
      await trip(hz.id,'2023-04-06','2023-04-09','西湖边走了一整天，柳絮飘得像雪。');
      return repo.stats();
    })();
  `);
}

async function main() {
  await setSize(SIZE.w, SIZE.h);

  console.log('capturing empty states …');
  await shot('01-home-empty');
  await evaluate(client, `TF.app.router.showTab('map'); return 1;`);
  await shot('02-map-empty');
  await evaluate(client, `TF.app.router.showTab('timeline'); return 1;`);
  await shot('03-timeline-empty');
  await evaluate(client, `TF.app.router.showTab('cities'); return 1;`);
  await shot('04-cities-empty');

  console.log('seeding + capturing populated screens …');
  const stats = await seedData();
  console.log('  stats: ' + JSON.stringify(stats));
  await sleep(700);

  await evaluate(client, `TF.app.router.showTab('home'); return 1;`);
  await sleep(1400);   // let the count-up finish
  await shot('05-home');
  await evaluate(client, `document.querySelector('.home-scroll').scrollTop = 9999; return 1;`);
  await shot('06-home-bottom');

  await evaluate(client, `TF.app.router.showTab('map'); return 1;`);
  await shot('07-map');

  // world view
  await evaluate(client, `document.querySelector('.map-mode[data-mode="world"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;`);
  await shot('08-map-world');
  await evaluate(client, `document.querySelector('.map-mode[data-mode="china"]').dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;`);

  await evaluate(client, `TF.app.router.showTab('timeline'); return 1;`);
  await shot('09-timeline');
  await evaluate(client, `document.querySelector('.tl-scroll, .scroll').scrollTop = 640; return 1;`);
  await shot('10-timeline-scrolled');

  await evaluate(client, `TF.app.router.showTab('cities'); return 1;`);
  await shot('11-cities');

  // city detail — 上海 (3 trips)
  await evaluate(client, `
    const sh = TF.app.repo.liveCities().find(c => c.name === '上海');
    TF.app.router.showTab('cities');
    TF.app.router.push('city', { cityId: sh.id });
    return 1;
  `);
  await shot('12-city-detail');
  await evaluate(client, `document.querySelector('.city-scroll').scrollTop = 900; return 1;`);
  await shot('13-city-detail-trips');

  // add-trip form (real sheet, from the home add button)
  await evaluate(client, `TF.app.router.popToRoot(); return 1;`);
  await sleep(400);
  await evaluate(client, `TF.ui.flows.addTrip(); return 1;`);
  await shot('14-add-trip');

  // search sheet
  await evaluate(client, `
    if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
    return 1;
  `);
  await sleep(300);
  await evaluate(client, `TF.ui.flows.openSearch('漓江'); return 1;`);
  await shot('15-search');

  // recycle bin (with one city in it)
  await evaluate(client, `
    if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
    const repo = TF.app.repo;
    const xa = repo.liveCities().find(c => c.name === '西安');
    repo.softDelete('city', xa.id);
    return 1;
  `);
  await sleep(400);
  await evaluate(client, `TF.ui.flows.openRecycleBin(); return 1;`);
  await shot('16-recycle-bin');

  // settings
  await evaluate(client, `
    if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
    TF.ui.flows.openSettings();
    return 1;
  `);
  await shot('17-settings');

  // dark mode — toggle in settings, then look at home in the dark theme
  await evaluate(client, `
    const darkBtn = document.querySelector('.theme-option[data-theme-mode="dark"]');
    if (darkBtn) darkBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 1;
  `);
  await sleep(300);
  await evaluate(client, `
    if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
    TF.app.router.showTab('home');
    return 1;
  `);
  await sleep(500);
  await shot('20-dark-home');

  // back to light for any later shots
  await evaluate(client, `if (TF.theme) TF.theme.set('light'); return 1;`);

  // trip overflow menu
  await evaluate(client, `
    if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
    const sh = TF.app.repo.liveCities().find(c => c.name === '上海');
    TF.app.router.popToRoot();
    TF.app.router.push('city', { cityId: sh.id });
    return 1;
  `);
  await sleep(500);
  await evaluate(client, `
    const btn = Array.from(document.querySelectorAll('.city-city__actions .icon-btn, .city-head__actions .icon-btn'))
      .find(b => (b.getAttribute('aria-label')||'').includes('更多'));
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!btn;
  `);
  await shot('18-city-menu');

  console.log('\nall screenshots written to ' + OUT);
  try { child.kill(); } catch {}
  server.close();
  process.exit(0);
}

main();
