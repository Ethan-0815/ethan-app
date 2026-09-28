/* ==========================================================================
   tools/e2e.mjs — end-to-end tests against the real app in a real browser.
   Drives the actual UI (clicks, forms, flows) over CDP; nothing is mocked.

     node tools/e2e.mjs            # full run
     node tools/e2e.mjs --keep     # leave the browser open on failure
   ========================================================================== */
import { launch, newPage, evaluate, waitFor, sleep, captureConsole } from './cdp.mjs';
import { server, PORT, ROOT } from './serve.mjs';

/* ------------------------------------------------------------- harness --- */

const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log('\n\x1b[1m── ' + name + ' ──\x1b[0m');
}

let passed = 0;
let failed = 0;

function ok(cond, label, detail) {
  if (cond) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + label);
  } else {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + label + (detail ? '\n      → ' + detail : ''));
    results.push({ group: currentGroup, label, detail });
  }
}

function eq(actual, expected, label) {
  ok(
    actual === expected,
    label,
    actual === expected ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/* ----------------------------------------------------------- page API --- */

let C;   // cdp client

const P = {
  /* --- app-level helpers injected once --- */
  async boot(url) {
    await newPage(C, url);
    await waitFor(C, 'window.TF && TF.app && TF.app.repo', 12000, 'app boot');
    // the boot screen is replaced by the real shell
    await waitFor(C, 'document.querySelector(".screen--root")', 6000, 'first screen');
  },

  /** Wipe all persisted state so each run starts from a true first-open. */
  async wipe() {
    await evaluate(C, `
      return (async () => {
        try { TF.app.repo.clearAll && await TF.app.repo.clearAll(); } catch (e) {}
        try {
          if (indexedDB.databases) {
            const dbs = await indexedDB.databases();
            for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
          } else {
            indexedDB.deleteDatabase('travel-footprint');
          }
        } catch (e) {}
        try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
        return true;
      })();
    `);
    await sleep(400);
    // reload into a clean app
    await C.send('Page.reload', { ignoreCache: true });
    await waitFor(C, 'window.TF && TF.app && TF.app.repo', 12000, 're-boot');
    await waitFor(C, 'document.querySelector(".screen--root")', 6000, 'first screen');
  },

  ev: (expr) => evaluate(C, expr),

  /** Click the first element matching a selector. */
  async click(sel) {
    const hit = await evaluate(C, `
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    `);
    if (!hit) throw new Error('click: no element for ' + sel);
    await sleep(140);
  },

  /** Type into an input/textarea (fires input + change). */
  async type(sel, value) {
    const hit = await evaluate(C, `
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    if (!hit) throw new Error('type: no element for ' + sel);
    await sleep(90);
  },

  text: (sel) => evaluate(C, `
    const el = document.querySelector(${JSON.stringify(sel)});
    return el ? el.textContent.trim() : null;
  `),

  count: (sel) => evaluate(C, `return document.querySelectorAll(${JSON.stringify(sel)}).length;`),

  exists: (sel) => evaluate(C, `return !!document.querySelector(${JSON.stringify(sel)});`),

  visible: (sel) => evaluate(C, `
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.opacity !== '0';
  `),

  clickText: (tag, text) => evaluate(C, `
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
    const el = nodes.find(n => n.textContent.trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  `)
};

/** Real mouse click through Chromium's input pipeline (includes hit-testing). */
async function realClick(x, y) {
  await C.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await C.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await C.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/* ------------------------------------------------- data seed + inspect --- */

/** Inject records directly through the repo (fast, deterministic fixtures). */
async function seed() {
  return evaluate(C, `
    const repo = TF.app.repo;

    async function city(name, country, province, lat, lng) {
      return repo.save('city', {
        name: name, country: country, province: province,
        latitude: lat, longitude: lng
      });
    }
    async function trip(cityId, s, e, note) {
      return repo.save('trip', { cityId: cityId, startDate: s, endDate: e, note: note || null });
    }

    // 上海 3 次（用户规格里的关键场景：同城多次，不能覆盖）
    const sh = await city('上海', '中国', '上海', 31.2304, 121.4737);
    await trip(sh.id, '2024-10-01', '2024-10-04', '外滩的夜风和生煎');
    await trip(sh.id, '2025-07-12', '2025-07-16', null);
    await trip(sh.id, '2026-07-20', '2026-07-24', '去看朋友的新家');

    // 桂林（规格里的示例城市）
    const gl = await city('桂林', '中国', '广西', 25.2736, 110.2900);
    await trip(gl.id, '2026-08-12', '2026-08-15', '漓江的水比照片更安静');

    // 东京（跨国）
    const tk = await city('东京', '日本', '东京都', 35.6762, 139.6503);
    await trip(tk.id, '2025-03-28', '2025-04-02', '樱花开到第七分');

    // 一个还没有旅行的城市 → 用于测试“未记录”分组与删除
    await city('西安', '中国', '陕西', 34.3416, 108.9398);

    // 跨年 + 当天往返
    const gz = await city('广州', '中国', '广东', 23.1291, 113.2644);
    await trip(gz.id, '2025-12-30', '2026-01-02', '跨年的人潮');
    await trip(gz.id, '2026-03-08', '2026-03-08', '当天往返，只为一口肠粉');

    const s = repo.stats();
    return {
      cities: repo.allCities().length,
      trips: repo.allTrips().length,
      cityCount: s.cityCount,
      regionCount: s.regionCount,
      tripCount: s.tripCount,
      shTrips: repo.tripsOfCity(sh.id).length,
      shId: sh.id, glId: gl.id, tkId: tk.id, gzId: gz.id
    };
  `);
}

/* -------------------------------------------------------------- tests --- */

async function main() {
  const { child, client } = await launch({ port: 9223 });
  C = client;

  const consoleSink = [];
  captureConsole(C, consoleSink);

  const URL = `http://127.0.0.1:${PORT}/`;
  console.log('\x1b[1m旅行足迹 — E2E\x1b[0m  ' + URL);

  try {
    /* ============================================================ boot === */
    group('启动与外壳');
    const loadErrors = [];
    C.on('Runtime.exceptionThrown', (p) => {
      loadErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    });

    await P.boot(URL);
    await P.wipe();
    ok(await P.exists('#app'), '应用外壳 #app 存在');
    ok(await P.exists('#viewport'), '#viewport 存在');
    ok(await P.exists('#nav-root .glass-nav'), '毛玻璃底部导航已挂载');
    ok(await P.exists('#overlay-root'), 'overlay 挂载点存在');
    eq(await P.count('.glass-nav__tab'), 4, '底部导航有 4 个 Tab');
    eq(loadErrors.length, 0, '启动期无未捕获异常');
    if (loadErrors.length) console.log('      ' + loadErrors.join('\n      '));

    const storage = await P.ev('return TF.app.storage;');
    ok(storage === 'idb' || storage === 'memory', '存储层已选定：' + storage);

    /* ========================================================== empty === */
    group('空状态');
    await P.click('.glass-nav__tab[data-tab="home"]');
    await sleep(400);
    const emptyHero = await P.text('.hero-stat__number');
    eq(emptyHero, '0', '首次打开：大数字显示 0');
    ok(await P.ev('return !!document.querySelector(".empty");'),
      '首页显示空状态组件');
    const noPhotoNag = await P.ev(`
      const t = document.body.innerText;
      return /快去添加|请添加照片|完善记录|还没有照片/.test(t);
    `);
    ok(noPhotoNag === false, '空状态不出现“催添加照片”文案');

    /* =========================================================== seed === */
    group('数据种子（真实 repo 写入）');
    const s = await seed();
    eq(s.cities, 5, '写入 5 个城市');
    eq(s.trips, 7, '写入 7 次旅行');
    // 规格定义：城市统计 = 有旅行记录的城市。西安没有旅行 → 不计入。
    eq(s.cityCount, 4, '统计：4 个“去过”的城市（西安无旅行不计入）');
    eq(s.regionCount, 4, '统计：4 个省区（沪/桂/粤 + 日本算 1）');
    eq(s.tripCount, 7, '统计：7 次旅行');
    eq(s.shTrips, 3, '上海拥有 3 次独立旅行（未被覆盖）');

    await sleep(500);   // let repo.onChange → refreshAll settle

    /* =========================================================== home === */
    group('首页');
    await waitFor(C, 'document.querySelector(".hero-stat__number").textContent.trim() === "4"', 4000, 'count-up');
    eq(await P.text('.hero-stat__number'), '4', '大数字 = 4（真实数据）');

    const heroSize = await P.ev(`
      const el = document.querySelector('.hero-stat__number');
      const cs = getComputedStyle(el);
      return { fs: parseFloat(cs.fontSize), fw: cs.fontWeight };
    `);
    ok(heroSize.fs >= 60, '大数字字号足够突出 (' + heroSize.fs + 'px)');
    ok(Number(heroSize.fw) >= 600, '大数字字重足够粗 (' + heroSize.fw + ')');

    const subText = await P.ev('return document.querySelector(".home-substats").innerText;');
    ok(/省区/.test(subText) && /旅行/.test(subText) && /照片/.test(subText),
      '副统计包含 省区/旅行/照片');
    ok(/7/.test(subText), '旅行次数来自真实数据（7）');

    const ticketCount = await P.count('.ticket');
    ok(ticketCount > 0, '最近旅程使用票根组件 (' + ticketCount + ' 张)');
    const hasNotch = await P.exists('.ticket__notch');
    const hasDash = await P.exists('.ticket__dash');
    ok(hasNotch && hasDash, '票根含缺口与虚线分隔（视觉身份要素）');
    ok(await P.exists('.home-mini-map svg, .mini-map svg, .home-map svg'),
      '首页有足迹地图预览');

    // the home map must be a REAL map now: land silhouettes, not a wave chart
    const miniLand = await P.ev(`
      const svg = document.querySelector('.home-map svg');
      return svg ? svg.querySelectorAll('.mini-map__land').length : 0;
    `);
    ok(miniLand >= 1, '首页足迹地图渲染真实轮廓（' + miniLand + ' 块陆地）');

    // overall background is pure white
    const bodyBg = await P.ev('return getComputedStyle(document.body).backgroundColor;');
    eq(bodyBg, 'rgb(255, 255, 255)', '整体底色为纯白');

    /* ================================================= form photo/att === */
    group('足迹表单：照片与附件');

    // Real 1×1 JPEG so canvas decoding inside TF.image succeeds.
    await P.ev(`
      TF.__pickedJpeg = (function () {
        const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      })();
      TF.__origPickImages = TF.native.pickImages;
      TF.__origPickFile = TF.native.pickFile;
      TF.native.pickImages = function () {
        return Promise.resolve([new File([TF.__pickedJpeg], 'shot.jpg', { type: 'image/jpeg' })]);
      };
      TF.native.pickFile = function () {
        return Promise.resolve({ name: 'note.txt', mime: 'text/plain', bytes: new Uint8Array([104, 105]) });
      };
      return true;
    `);

    const beforeForm = await P.ev(`
      const s = TF.app.repo.stats();
      return { photo: s.photoCount, att: s.attachmentCount };
    `);

    await P.ev(`
      const sh = TF.app.repo.findCityByName('上海');
      TF.ui.flows.addTrip({ cityId: sh.id });
      return true;
    `);
    await sleep(650);

    // pick a photo → inline preview must appear inside the form
    await P.clickText('.form-picks__actions .btn--ghost', '从相册选择');
    await sleep(450);
    eq(await P.count('.form-pick__thumb'), 1, '表单内照片预览缩略图出现');

    // pick an attachment → its row must appear
    await P.clickText('.form-picks__actions .btn--ghost', '选择文件');
    await sleep(450);
    eq(await P.count('.form-pick__file'), 1, '表单内附件行出现');

    // saving must persist the photo + attachment along with the trip
    await P.clickText('.sheet--form .btn--primary', '保存足迹');
    await waitFor(C,
      `TF.app.repo.stats().photoCount === ${beforeForm.photo + 1} && TF.app.repo.stats().attachmentCount === ${beforeForm.att + 1}`,
      6000, '照片与附件随足迹入库');
    await sleep(550);   // let the sheet close animation finish before asserting
    ok(await P.ev('return !document.querySelector(".sheet--form");'), '保存后表单关闭');

    const afterForm = await P.ev(`
      const r = TF.app.repo;
      const s = r.stats();
      const sh = r.findCityByName('上海');
      const total = r.tripsOfCity(sh.id).reduce((n, t) => n + r.photosOfTrip(t.id).length, 0);
      return { photo: s.photoCount, att: s.attachmentCount, shPhotos: total };
    `);
    eq(afterForm.photo, beforeForm.photo + 1, '照片数量 +1');
    eq(afterForm.att, beforeForm.att + 1, '附件数量 +1');
    eq(afterForm.shPhotos, 1, '照片挂在刚保存的上海旅行上');

    // restore real picker behaviour for the rest of the suite
    await P.ev(`
      TF.native.pickImages = TF.__origPickImages;
      TF.native.pickFile = TF.__origPickFile;
      return true;
    `);

    /* ====================================================== nav + anim === */
    group('底部导航与 Tab 动画');
    const cap = await P.ev(`
      const el = document.querySelector('.glass-nav__capsule');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const nav = document.querySelector('.glass-nav');
      const ncs = getComputedStyle(nav);
      const host = document.getElementById('nav-root');
      const hcs = getComputedStyle(host);
      const navRect = nav.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      return {
        transition: cs.transitionProperty + ' ' + cs.transitionDuration,
        backdrop: ncs.backdropFilter || ncs.webkitBackdropFilter,
        bg: ncs.backgroundColor,
        radius: parseFloat(ncs.borderRadius),
        navPos: ncs.position,
        hostPos: hcs.position,
        // the nav must actually float: not full-bleed, inset from the edges
        navW: navRect.width,
        vw: vw,
        bottomGap: vh - navRect.bottom,
        vh: vh,
        safeB: getComputedStyle(document.documentElement).getPropertyValue('--safe-b')
      };
    `);
    ok(/transform/.test(cap.transition), '胶囊用 transform 过渡（滑动动画）');
    // transitionDuration is reported in seconds: "0.3s" → 300ms
    const durMs = Math.max(
      ...cap.transition.split(',').map((t) => {
        const m = t.match(/([\d.]+)(ms|s)/);
        if (!m) return 0;
        return m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      })
    );
    ok(durMs >= 150 && durMs <= 600, '胶囊过渡时长在 150–600ms 之间 (' + durMs + 'ms)');
    ok(cap.backdrop && cap.backdrop !== 'none', '导航使用 backdrop-filter 毛玻璃: ' + cap.backdrop);
    ok(cap.radius >= 18, '导航为圆角/胶囊形 (' + cap.radius + 'px)');
    ok(cap.hostPos === 'fixed' || cap.navPos === 'fixed', '导航浮动定位 (fixed)');
    ok(cap.navW < cap.vw - 8, `导航为浮动胶囊而非满宽条 (${Math.round(cap.navW)}px / ${cap.vw}px)`);
    ok(cap.bottomGap >= 0 && cap.bottomGap < cap.vh * 0.35,
      `导航悬浮在底部安全距离内 (距底 ${Math.round(cap.bottomGap)}px)`);
    ok(/rgba|0\./.test(cap.bg), '导航半透明背景: ' + cap.bg);

    // capsule actually moves between tabs
    const pos0 = await P.ev(`return document.querySelector('.glass-nav__capsule').getBoundingClientRect().left;`);
    await P.click('.glass-nav__tab[data-tab="timeline"]');
    await sleep(500);
    const pos1 = await P.ev(`return document.querySelector('.glass-nav__capsule').getBoundingClientRect().left;`);
    ok(Math.abs(pos1 - pos0) > 20, '切换 Tab 时胶囊确实移动到新位置');

    // tab body really swapped
    ok(await P.exists('.screen-timeline, [data-page="timeline"]'), '时间线页面已渲染');

    /* ======================================================== timeline === */
    group('时间线页面');
    const tlText = await P.ev('return document.querySelector("[data-page=\\"timeline\\"]").innerText;');
    ok(/2026/.test(tlText), '时间线包含年份 2026');
    ok(/2025/.test(tlText), '时间线包含年份 2025');
    ok(/2024/.test(tlText), '时间线包含年份 2024');
    ok(/桂林/.test(tlText), '时间线包含桂林');
    ok(/AUG|8月/.test(tlText), '时间线有月份标识');
    ok(/漓江的水比照片更安静/.test(tlText), '时间线展示备注');

    // reverse chronological: 2026 block must precede 2025 block
    const order = await P.ev(`
      const years = Array.from(document.querySelectorAll('.tl-year__label'))
        .map(el => parseInt(el.textContent, 10));
      return years;
    `);
    ok(order.length >= 3 && order[0] >= order[order.length - 1],
      '时间线按年份倒序: ' + JSON.stringify(order));

    /* ========================================================== cities === */
    group('城市页面');
    await P.click('.glass-nav__tab[data-tab="cities"]');
    await sleep(400);
    ok(await P.exists('[data-page="cities"]'), '城市页面已渲染');
    const citiesText = await P.ev('return document.querySelector("[data-page=\\"cities\\"]").innerText;');
    ok(/上海/.test(citiesText) && /桂林/.test(citiesText), '城市列表包含上海与桂林');
    ok(await P.exists('[data-page="cities"] input'), '城市页面有搜索框');

    // 上海 去过 3 次
    const shLabel = await P.ev(`
      const cards = Array.from(document.querySelectorAll('[data-page="cities"] .city-card, [data-page="cities"] .city-row, [data-page="cities"] li, [data-page="cities"] a, [data-page="cities"] div'));
      const el = cards.find(n => n.textContent.includes('上海') && n.textContent.includes('3'));
      return el ? el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : null;
    `);
    ok(shLabel && /3/.test(shLabel), '上海显示去过 3 次: ' + shLabel);

    // search
    await P.type('[data-page="cities"] input', '桂林');
    await sleep(350);
    const filtered = await P.ev('return document.querySelector("[data-page=\\"cities\\"]").innerText;');
    ok(/桂林/.test(filtered), '搜索“桂林”后仍显示桂林');
    ok(!/上海/.test(filtered), '搜索“桂林”后上海被过滤掉');
    await P.type('[data-page="cities"] input', '');
    await sleep(350);

    // stagger 级联动画：每个位置的延迟符合映射，且第 9 个及之后沿用最大延迟
    //（否则列表尾部 delay=0 会抢跑，与上面的城市不同步）
    const staggerTail = await P.ev(`
      const wrap = document.querySelector('.cities-list__group.stagger');
      if (!wrap) return null;
      const probe = document.createElement('div');
      wrap.appendChild(probe);
      const n = wrap.children.length;          // probe is the n-th child
      const d = getComputedStyle(probe).animationDelay;
      probe.remove();
      const ladder = ['0.02s','0.055s','0.09s','0.125s','0.16s','0.195s','0.23s','0.265s'];
      const expected = n <= 8 ? ladder[n - 1] : '0.265s';
      return { n: n, delay: d, expected: expected, ok: d === expected };
    `);
    ok(staggerTail && staggerTail.ok,
      '列表级联动画延迟符合位置映射（第 ' + (staggerTail && staggerTail.n) + ' 项 = ' +
      (staggerTail && staggerTail.delay) + '，尾部封顶 0.265s）');

    /* ==================================================== city detail === */
    group('城市详情页');
    const opened = await P.clickText('[data-page="cities"] .city-card, [data-page="cities"] .city-row', '桂林')
      || await P.clickText('[data-page="cities"] *', '桂林');
    ok(opened, '可以点击进入桂林详情');
    await sleep(450);
    ok(await P.exists('[data-page="city"], .screen-city'), '城市详情页已渲染');
    const cityText = await P.ev('return document.querySelector("[data-page=\\"city\\"]")?.innerText || "";');
    ok(/桂林/.test(cityText), '详情页显示城市名');
    ok(/2026\.08\.12/.test(cityText) || /2026-08-12/.test(cityText), '详情页显示旅行日期');
    ok(/漓江的水比照片更安静/.test(cityText), '详情页显示备注');
    ok(/旅行记录/.test(cityText), '详情页有“旅行记录”分区');
    ok(/照片/.test(cityText), '详情页有“照片”分区');
    ok(/附件/.test(cityText), '详情页有“附件”分区');

    const navHidden = await P.ev(`
      const el = document.querySelector('.glass-nav');
      return el.classList.contains('is-hidden');
    `);
    ok(navHidden, '推入详情页时底部导航自动隐藏');

    // back arrow returns + nav reappears
    await P.ev(`
      const btns = Array.from(document.querySelectorAll('button, .icon-btn'));
      const back = btns.find(b => b.classList.contains('icon-btn') || /返回|back/i.test(b.getAttribute('aria-label')||''));
      if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!back;
    `);
    await sleep(400);
    const navBack = await P.ev(`return !document.querySelector('.glass-nav').classList.contains('is-hidden');`);
    ok(navBack, '返回后底部导航重新出现');

    /* ============================================================ map === */
    group('地图页面');
    await P.click('.glass-nav__tab[data-tab="map"]');
    await sleep(500);
    ok(await P.exists('[data-page="map"], .screen-map'), '地图页面已渲染');
    const mapInfo = await P.ev(`
      const screen = document.querySelector('.screen-map');
      const svg = document.querySelector('.map-svg');
      if (!svg || !screen) return null;
      const count = () => document.querySelectorAll('.map-dot').length;
      const chinaDots = count();
      // switch to the World view
      const worldBtn = document.querySelector('.map-mode[data-mode="world"]');
      if (worldBtn) worldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return {
        tag: svg.tagName,
        chinaDots: chinaDots,
        worldDots: count(),
        land: svg.querySelectorAll('.map-land').length,
        hasWorldBtn: !!worldBtn,
        modeCount: document.querySelectorAll('.map-mode').length
      };
    `);
    await sleep(320);
    ok(mapInfo && mapInfo.tag.toLowerCase() === 'svg', '地图使用本地 SVG（无在线地图）');
    ok(mapInfo && mapInfo.chinaDots >= 3,
      '中国视图绘制全部中国城市点 (' + (mapInfo && mapInfo.chinaDots) + ' 个)');
    ok(mapInfo && mapInfo.modeCount === 2, '地图提供 中国 / 世界 两种视图');
    ok(mapInfo && mapInfo.worldDots >= mapInfo.chinaDots,
      '世界视图覆盖中国视图（含境外城市）: ' +
      (mapInfo && (mapInfo.chinaDots + ' → ' + mapInfo.worldDots)));
    ok(mapInfo && mapInfo.land >= 1, '地图绘制了陆地轮廓');

    const mapNetwork = await P.ev(`
      const html = document.documentElement.outerHTML;
      return /openstreetmap|mapbox|amap|google\\.com\\/maps|tianditu|leaflet|maptalks/i.test(html);
    `);
    ok(mapNetwork === false, '页面内无任何在线地图痕迹');

    /* ============================================ theme + zoom focus === */
    group('主题切换与缩放聚焦');

    // --- 地图缩放以指定点为聚焦点
    await P.click('.glass-nav__tab[data-tab="map"]');
    await sleep(500);
    const zoomInfo = await P.ev(`
      const shell = document.querySelector('.map-viewport');
      if (!shell || !shell.zoomBy) return null;
      const rect = shell.getBoundingClientRect();
      const ox = rect.left + rect.width * 0.25;
      const oy = rect.top + rect.height * 0.45;
      const cx = ox - rect.left - rect.width / 2;
      const cy = oy - rect.top - rect.height / 2;
      const before = { scale: shell.state.scale, tx: shell.state.tx, ty: shell.state.ty };
      shell.zoomBy(2, ox, oy);
      const ratio = 2;
      const expTx = cx - (cx - before.tx) * ratio;
      const expTy = cy - (cy - before.ty) * ratio;
      const focalOk =
        Math.abs(shell.state.tx - expTx) < 0.01 &&
        Math.abs(shell.state.ty - expTy) < 0.01;
      return {
        scale: shell.state.scale,
        focalOk: focalOk,
        moved: Math.abs(shell.state.tx - before.tx) > 0.5 ||
               Math.abs(shell.state.ty - before.ty) > 0.5
      };
    `);
    ok(zoomInfo && zoomInfo.scale === 2, '缩放后 scale 正确 (×2)');
    ok(zoomInfo && zoomInfo.focalOk, '缩放以指定点为聚焦点（焦点固定不动）');
    ok(zoomInfo && zoomInfo.moved, '聚焦点偏离中心时平移量确实改变');

    // 双击在点击处放大
    const dbl = await P.ev(`
      const shell = document.querySelector('.map-viewport');
      if (!shell) return null;
      const rect = shell.getBoundingClientRect();
      const before = shell.state.scale;
      shell.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + rect.width * 0.3, clientY: rect.top + rect.height * 0.3
      }));
      return { before: before, after: shell.state.scale };
    `);
    ok(dbl && dbl.after > dbl.before,
      '双击以点击处为焦点放大 (' + (dbl && dbl.before) + ' → ' + (dbl && dbl.after) + ')');
    await P.ev(`if (document.querySelector('.map-viewport')) document.querySelector('.map-viewport').reset();`);

    // --- 页面推入动画真实存在（不再"秒切"）
    const animProbe = await P.ev(`
      const probe = document.createElement('div');
      probe.className = 'screen screen--pushing screen--visible';
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const durs = cs.transitionDuration.split(',').map(s => parseFloat(s));
      probe.remove();
      return { maxDur: Math.max.apply(null, durs), transform: cs.transform !== 'none' };
    `);
    ok(animProbe && animProbe.maxDur >= 0.28,
      '推入页有可见过渡动画（' + (animProbe && animProbe.maxDur) + 's）');

    // 从时间线点进城市的旅行卡片有聚焦闪光
    const flashProbe = await P.ev(`
      const probe = document.createElement('div');
      probe.className = 'city-trip is-flash';
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const name = getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    `);
    ok(flashProbe === 'tf-trip-flash', '焦点旅行卡片有闪光动画 (tf-trip-flash)');

    // --- 主题切换：设置里三选一，深色立即生效并持久化
    await P.ev(`return TF.ui.flows.openSettings();`);
    await sleep(450);
    const themeCount = await P.count('.theme-option');
    ok(themeCount === 3, '设置里有 浅色/深色/跟随系统 三个选项 (' + themeCount + ')');

    await P.click('.theme-option[data-theme-mode="dark"]');
    await sleep(200);
    const darkState = await P.ev(`
      const active = document.querySelector('.theme-option.is-active');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        bg: getComputedStyle(document.body).backgroundColor,
        stored: localStorage.getItem('tf-theme'),
        active: active ? active.dataset.themeMode : null
      };
    `);
    ok(darkState && darkState.theme === 'dark', '点击深色后 html[data-theme=dark]');
    ok(darkState && darkState.active === 'dark', '深色选项处于高亮');
    ok(darkState && darkState.stored === 'dark', '主题偏好已持久化到 localStorage');

    await P.click('.theme-option[data-theme-mode="light"]');
    await sleep(200);
    const lightTheme = await P.ev(`return document.documentElement.getAttribute('data-theme');`);
    ok(lightTheme === 'light', '切回浅色立即生效');

    // close the sheet and pin a clean light state for later groups
    await P.ev(`return TF.ui.parts.closeTopOverlay();`);
    await sleep(300);
    await P.ev(`if (TF.theme) TF.theme.set('light');`);

    /* ========================================================== flows === */
    group('添加足迹流程');
    await P.click('.glass-nav__tab[data-tab="home"]');
    await sleep(350);

    // open the add-trip sheet via the primary CTA
    const openedForm = await P.ev(`
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => /添加足迹|添加旅行|开始记录|添加城市/.test(x.textContent));
      if (!b) return false;
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    `);
    ok(openedForm, '首页有“添加足迹”入口');
    await sleep(450);

    const sheetAppeared = await P.exists('.sheet, .overlay, .city-chooser');
    ok(sheetAppeared, '添加足迹弹出选择/表单面板');

    /* ================================================== city chooser === */
    // 关闭刚才的 sheet，回到干净状态再测选择器
    await P.ev(`return TF.ui.parts.closeTopOverlay();`);
    await sleep(350);

    group('城市选择器与遮罩回退');

    // 空库打开选择器 → 应出现热门城市（内置城市库）
    await P.ev(`return TF.ui.flows.addTrip();`);
    await sleep(500);
    ok(await P.exists('.chooser__row--builtin'), '空库时展示内置热门城市');
    const popularRows = await P.count('.chooser__row--builtin');
    ok(popularRows >= 5, '热门城市有足够选择（' + popularRows + ' 个）');

    // 真实命中测试：点击 sheet 上方空白处（backdrop）应关闭
    const hitInfo = await P.ev(`
      const bd = document.querySelector('#overlay-root .overlay__backdrop');
      const r = bd.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + 30);
      const el = document.elementFromPoint(x, y);
      return { x, y, hitBackdrop: el ? el.className.includes('backdrop') : false };
    `);
    ok(hitInfo.hitBackdrop, '空白处命中 backdrop（panel 不再拦截点击）');
    await realClick(hitInfo.x, hitInfo.y);
    await sleep(420);
    eq(await P.count('#overlay-root .overlay'), 0, '真实点击空白处关闭弹层');

    // 重新打开，输入“长” → 内置长沙建议（夹具未记录过的城市）
    await P.ev(`return TF.ui.flows.addTrip();`);
    await sleep(450);
    await P.type('.chooser__input', '长');
    await sleep(350);
    const builtinCS = await P.ev(`
      const rows = Array.from(document.querySelectorAll('.chooser__row--builtin'));
      const hit = rows.find(b => b.textContent.includes('长沙'));
      return !!hit;
    `);
    ok(builtinCS, '输入“长”出现内置“长沙”建议');
    const rowOrder = await P.ev(`
      const rows = Array.from(document.querySelectorAll('.chooser__row'));
      const firstBuiltin = rows.findIndex(b => b.className.includes('builtin'));
      const newRow = rows.findIndex(b => b.className.includes('row--new'));
      return { firstBuiltin, newRow };
    `);
    ok(rowOrder.newRow === -1 || rowOrder.newRow > rowOrder.firstBuiltin,
       '“新城市”排在建议之后');

    // 点击内置长沙 → 建城（带地区+坐标）→ 表单锁定长沙
    await P.clickText('.chooser__row--builtin', '长沙');
    await sleep(650);
    const locked = await P.text('.form__locked-name');
    eq(locked, '长沙', '点击建议后表单锁定长沙');
    ok(await P.exists('#overlay-root .overlay'), '选择后进入旅行表单');

    // 真实点击空白处 → 表单也应能关闭（回退上一级）
    const hit2 = await P.ev(`
      const bd = document.querySelector('#overlay-root .overlay__backdrop');
      const r = bd.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 20) };
    `);
    await realClick(hit2.x, hit2.y);
    await sleep(420);
    eq(await P.count('#overlay-root .overlay'), 0, '旅行表单也可点击空白处回退');

    // Esc 键关闭（桌面端回退方式）
    await P.ev(`return TF.ui.flows.addTrip();`);
    await sleep(450);
    await P.ev(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    `);
    await sleep(400);
    eq(await P.count('#overlay-root .overlay'), 0, 'Esc 键关闭弹层');

    // 通过选择器完整记录一次 → 城市应带省份与坐标（可上地图）
    await P.ev(`return TF.ui.flows.addTrip();`);
    await sleep(450);
    await P.type('.chooser__input', '杭');
    await sleep(350);
    await P.click('.chooser__row--builtin');
    await sleep(650);
    await P.ev(`
      const d = document.querySelector('#overlay-root input[type="date"]');
      if (d) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(d, '2026-09-10');
        d.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    `);
    await sleep(120);
    await P.ev(`
      const btns = Array.from(document.querySelectorAll('#overlay-root button'));
      const save = btns.find(b => /保存|记录足迹|完成/.test(b.textContent));
      if (save) save.click();
      return true;
    `);
    await sleep(700);
    const hangzhou = await P.ev(`
      const c = TF.app.repo.findCityByName('杭州');
      return c ? { province: c.province, lat: c.latitude, lng: c.longitude } : null;
    `);
    ok(hangzhou, '从城市库选择并保存成功（杭州）');
    ok(hangzhou && hangzhou.province === '浙江', '省份来自内置城市库（浙江）');
    ok(hangzhou && hangzhou.lat !== null && hangzhou.lng !== null, '坐标来自内置城市库（可上地图）');

    /* ======================================================= overflow === */
    group('响应式与溢出');
    const sizes = [
      { w: 320, h: 568, name: '320×568' },
      { w: 375, h: 812, name: '375×812' },
      { w: 390, h: 844, name: '390×844' },
      { w: 430, h: 932, name: '430×932' },
      { w: 768, h: 1024, name: '768×1024' },
      { w: 1280, h: 800, name: '1280×800' }
    ];

    // close any sheet first
    await evaluate(C, `
      if (TF.ui.parts && TF.ui.parts.closeTopOverlay) TF.ui.parts.closeTopOverlay();
      return true;
    `);
    await sleep(250);

    for (const sz of sizes) {
      await C.send('Emulation.setDeviceMetricsOverride', {
        width: sz.w, height: sz.h, deviceScaleFactor: 1, mobile: sz.w < 700
      });
      await sleep(320);

      const m = await evaluate(C, `
        const doc = document.documentElement;
        const body = document.body;
        const overflowX = Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth;

        // find any element wider than the viewport
        let worst = null, worstW = 0;
        const vw = doc.clientWidth;
        document.querySelectorAll('#viewport *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > vw + 1 && r.width > worstW) {
            worstW = r.width;
            worst = (el.className && typeof el.className === 'string')
              ? el.className.split(' ')[0] : el.tagName;
          }
        });

        // nav must not be off-screen, and must sit above the bottom edge
        const nav = document.querySelector('.glass-nav');
        const nr = nav ? nav.getBoundingClientRect() : null;

        return {
          vw, overflowX,
          scrollW: doc.scrollWidth,
          worst, worstW,
          navBottomGap: nr ? (doc.clientHeight - nr.bottom) : null,
          navWidth: nr ? nr.width : null,
          navVisible: nr ? nr.width > 0 : false
        };
      `);

      ok(m.overflowX <= 1, `${sz.name} 无横向溢出`, `scrollWidth 超出 ${m.overflowX}px`);
      ok(m.worstW <= m.vw + 1, `${sz.name} 无元素超出视口`,
        m.worst ? `${m.worst} = ${m.worstW}px > ${m.vw}px` : '');
      ok(m.navVisible && m.navWidth <= m.vw + 1, `${sz.name} 导航完整显示`);
      ok(m.navBottomGap === null || m.navBottomGap >= 0, `${sz.name} 导航未被裁出屏幕`);
    }

    await C.send('Emulation.clearDeviceMetricsOverride');

    /* ========================================================= offline === */
    group('离线能力（断网模拟）');
    await C.send('Network.enable');
    await C.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
    });

    const offlineChecks = await evaluate(C, `
      return (async () => {
        const out = {};
        // 1) navigate all four tabs
        const tabs = ['home', 'map', 'timeline', 'cities'];
        out.tabs = [];
        for (const t of tabs) {
          TF.app.router.showTab(t);
          await new Promise(r => setTimeout(r, 90));
          const el = document.querySelector('[data-page="' + t + '"], .screen-' + t);
          out.tabs.push(!!el);
        }
        // 2) data still readable
        out.stats = TF.app.repo.stats();
        // 3) push a city detail
        const gl = TF.app.repo.liveCities().find(c => c.name === '桂林');
        TF.app.router.push('city', { cityId: gl.id });
        await new Promise(r => setTimeout(r, 120));
        out.cityOk = !!document.querySelector('[data-page="city"]');
        out.cityHasName = /桂林/.test(document.querySelector('[data-page="city"]').innerText);
        TF.app.router.popToRoot();
        // 4) write a new record while offline
        out.tripsBefore = TF.app.repo.allTrips().length;
        const c = await TF.app.repo.save('city', { name: '断网测试城', country: '中国', province: '测试' });
        await TF.app.repo.save('trip', { cityId: c.id, startDate: '2026-09-01', endDate: '2026-09-02', note: '离线写入' });
        out.tripsAfter = TF.app.repo.allTrips().length;
        out.wroteOffline = out.tripsAfter === out.tripsBefore + 1;
        return out;
      })();
    `);
    ok(offlineChecks.tabs.every(Boolean), '断网下四个 Tab 全部正常渲染');
    ok(offlineChecks.stats && offlineChecks.stats.cityCount >= 4, '断网下数据仍可读取');
    ok(offlineChecks.cityOk, '断网下可进入城市详情');
    ok(offlineChecks.cityHasName, '断网下城市详情内容正常');
    ok(offlineChecks.wroteOffline,
      `断网下可以新增记录（本地写入 ${offlineChecks.tripsBefore} → ${offlineChecks.tripsAfter}）`);

    const netReq = await P.ev(`
      return performance.getEntriesByType('resource')
        .filter(r => !r.name.startsWith('http://127.0.0.1:${PORT}') && !r.name.startsWith('blob:') && !r.name.startsWith('data:'))
        .map(r => r.name);
    `);
    ok(netReq.length === 0, '断网下无任何外部资源请求', netReq.join(', '));

    await C.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
    });
    await C.send('Network.disable');

    /* ======================================================== zod scan === */
    group('网络依赖静态扫描（源码）');
    const scan = await evaluate(C, `
      // Scan the loaded source of every script we shipped.
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
      return scripts;
    `);
    ok(scan.length >= 20, '应用由 ' + scan.length + ' 个本地脚本组成');
    ok(scan.every((s) => !/^https?:\/\//.test(s)), '所有脚本均为本地相对路径（无 CDN）');

    /* ========================================================== export === */
    group('导出 / 导入往返');
    const roundtrip = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;

        // Build a real backup ZIP through the shipping code path.
        const payload = TF.backup.buildPayload({ cities: repo.allCities(), trips: repo.allTrips(), photos: repo.allPhotos(), attachments: repo.allAttachments() });
        const manifest = TF.backup.buildManifest(payload);

        const writer = new TF.zip.Writer();
        writer.addJson('data.json', payload);
        for (const item of manifest) {
          const blob = await repo.getBlob(item.blobId);
          if (blob) writer.add(item.name, blob.bytes);
        }
        const bytes = writer.finish();

        // Read it back with our own reader.
        const read = TF.zip.read(bytes);
        const names = read.entries.map(e => e.name);
        const dataEntry = read.entries.find(e => e.name === 'data.json');
        const jsonBytes = await TF.zip.extract(read, dataEntry);
        const parsed = TF.backup.parsePayload(
          JSON.parse(new TextDecoder().decode(jsonBytes))
        );

        return {
          zipBytes: bytes.length,
          entryCount: names.length,
          names: names,
          hasDataJson: names.includes('data.json'),
          cities: parsed.cities.length,
          trips: parsed.trips.length,
          photos: parsed.photos.length,
          attachments: parsed.attachments.length,
          manifestCount: manifest.length
        };
      })();
    `);
    ok(roundtrip.hasDataJson, '导出 ZIP 含 data.json');
    ok(roundtrip.zipBytes > 200, '导出 ZIP 非空 (' + roundtrip.zipBytes + ' 字节)');
    ok(roundtrip.cities >= 5, '导出包含全部城市 (' + roundtrip.cities + ')');
    ok(roundtrip.trips >= 7, '导出包含全部旅行 (' + roundtrip.trips + ')');

    // Re-import into a clean memory repo → must reproduce the data exactly.
    const reimport = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;
        const payload = TF.backup.buildPayload({ cities: repo.allCities(), trips: repo.allTrips(), photos: repo.allPhotos(), attachments: repo.allAttachments() });

        // fresh, empty repo
        const fresh = new TF.repo.Repo({
          cities: new TF.adapter.MemoryAdapter('cities'),
          trips: new TF.adapter.MemoryAdapter('trips'),
          photos: new TF.adapter.MemoryAdapter('photos'),
          attachments: new TF.adapter.MemoryAdapter('attachments'),
          blobs: new TF.adapter.MemoryBlobStore()
        });
        await fresh.init();

        const plan = TF.backup.planImport({ cities: fresh.allCities(), trips: fresh.allTrips(), photos: fresh.allPhotos(), attachments: fresh.allAttachments() }, payload, {});
        await fresh.applyImport(plan, {});

        const sh = fresh.liveCities().find(c => c.name === '上海');

        return {
          // compare against the payload's own declared counts — that is the
          // real round-trip guarantee (a backup must restore what it exported)
          citiesIn: payload.counts.cities, citiesOut: fresh.allCities().length,
          tripsIn: payload.counts.trips, tripsOut: fresh.allTrips().length,
          outCityIds: new Set(fresh.allCities().map(c => c.id)).size,
          inCityIds: new Set(payload.cities.map(c => c.id)).size,
          shTrips: sh ? fresh.tripsOfCity(sh.id).length : 0,
          noteKept: !!(sh && fresh.tripsOfCity(sh.id).some(t => /外滩的夜风/.test(t.note || '')))
        };
      })();
    `);
    eq(reimport.citiesOut, reimport.citiesIn, '重新导入后城市数量一致 (精确还原)');
    eq(reimport.tripsOut, reimport.tripsIn, '重新导入后旅行数量一致 (精确还原)');
    eq(reimport.outCityIds, reimport.inCityIds, '重新导入后城市 ID 无重复亦无丢失');
    eq(reimport.shTrips, 4, '重新导入后同城多次旅行保留（3 次种子 + 表单流程新增 1 次）');
    ok(reimport.noteKept, '重新导入后备注保留');

    // Duplicate import must be detected, never silently duplicated/overwritten.
    const dup = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;
        const payload = TF.backup.buildPayload({ cities: repo.allCities(), trips: repo.allTrips(), photos: repo.allPhotos(), attachments: repo.allAttachments() });
        const plan = TF.backup.planImport({ cities: repo.allCities(), trips: repo.allTrips(), photos: repo.allPhotos(), attachments: repo.allAttachments() }, payload, {});
        return {
          add: plan.add.length,
          update: plan.update.length,
          skip: plan.skip.length,
          conflicts: plan.conflicts.length
        };
      })();
    `);
    eq(dup.add, 0, '重复导入：不新增任何记录（不静默重复）');
    eq(dup.update, 0, '重复导入：不覆盖任何记录（不静默覆盖）');
    ok(dup.skip > 0, '重复导入：相同内容识别为跳过 (' + dup.skip + ')');

    /* ====================================================== recycle bin === */
    group('回收站');
    const bin = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;
        const gl = repo.liveCities().find(c => c.name === '桂林');
        const statsBefore = repo.stats().cityCount;

        await repo.softDelete('city', gl.id);

        const binData = repo.recycleBin();
        const inBin = binData.items.some(r => r.row && r.row.id === gl.id);
        const goneFromList = !repo.liveCities().some(c => c.id === gl.id);
        const statsAfter = repo.stats().cityCount;
        const binTrips = binData.items.filter(r => r.kind === 'trip').length;

        // restore
        await repo.restore('city', gl.id);
        const back = repo.liveCities().some(c => c.id === gl.id);
        const tripsBack = repo.tripsOfCity(gl.id).length;
        const statsRestored = repo.stats().cityCount;

        return {
          inBin, goneFromList, statsBefore, statsAfter, statsRestored,
          back, tripsBack, binTrips, totalInBin: binData.total
        };
      })();
    `);
    ok(bin.inBin, '删除城市后进入回收站');
    ok(bin.goneFromList, '删除后不出现在城市列表');
    eq(bin.statsAfter, bin.statsBefore - 1,
      `删除后统计正确减少 (${bin.statsBefore} → ${bin.statsAfter})`);
    ok(bin.binTrips >= 1, '城市的旅行记录一并进入回收站 (' + bin.binTrips + ' 条)');
    ok(bin.back, '从回收站可恢复城市');
    ok(bin.tripsBack === 1, '恢复城市时其旅行记录一并恢复');
    eq(bin.statsRestored, bin.statsBefore, '恢复后统计回到删除前的值');

    /* --- the recycle bin screen itself (UI level) --- */
    const binScreen = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;
        const xa = repo.liveCities().find(c => c.name === '西安');
        await repo.softDelete('city', xa.id);
        await new Promise(r => setTimeout(r, 260));

        TF.app.router.showTab('home');
        await new Promise(r => setTimeout(r, 200));
        TF.ui.flows.openRecycleBin();
        await new Promise(r => setTimeout(r, 420));

        const screen = document.querySelector('.screen-bin');
        if (!screen) return { rendered: false };

        const text = screen.innerText;
        return {
          rendered: true,
          onTop: TF.app.router.top().id === 'bin',
          hasTitle: /回收站/.test(text),
          hasSubtitle: /已删除的内容/.test(text),
          hasItems: screen.querySelectorAll('.bin-item').length,
          hasRestore: screen.querySelectorAll('.bin-btn--restore').length,
          hasPurge: screen.querySelectorAll('.bin-btn--purge').length,
          mentionsXian: /西安/.test(text),
          visible: screen.classList.contains('screen--visible')
        };
      })();
    `);
    ok(binScreen.rendered, '回收站页面能真正打开（不是空白）');
    ok(binScreen.visible, '回收站页面可见');
    ok(binScreen.onTop, '回收站位于页面栈顶层');
    ok(binScreen.hasTitle, '回收站显示标题');
    ok(binScreen.hasItems >= 1, '回收站列出已删除项 (' + binScreen.hasItems + ')');
    ok(binScreen.hasRestore >= 1, '回收站提供“恢复”按钮');
    ok(binScreen.hasPurge >= 1, '回收站提供“彻底删除”按钮');
    ok(binScreen.mentionsXian, '回收站显示被删除的城市名');

    // restore from the UI and confirm it returns to the list
    const restored = await evaluate(C, `
      return (async () => {
        const btn = document.querySelector('.bin-btn--restore');
        if (!btn) return { ok: false };
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        return {
          ok: true,
          xianBack: TF.app.repo.liveCities().some(c => c.name === '西安'),
          binTotal: TF.app.repo.recycleBin().total
        };
      })();
    `);
    ok(restored.ok && restored.xianBack, '在回收站界面点击“恢复”后城市回到列表');
    eq(restored.binTotal, 0, '恢复后回收站清空');

    await evaluate(C, `
      TF.app.router.popToRoot();
      if (TF.ui.parts.hasOverlay()) TF.ui.parts.closeTopOverlay();
      return 1;
    `);
    await sleep(300);

    /* ===================================================== purge safety === */
    group('永久删除的级联安全');
    const purge = await evaluate(C, `
      return (async () => {
        const repo = TF.app.repo;
        const gz = repo.liveCities().find(c => c.name === '广州');
        const tripIds = repo.tripsOfCity(gz.id).map(t => t.id);
        // delete one trip first (goes to bin), then purge the whole city
        await repo.softDelete('trip', tripIds[0]);
        await repo.purge('city', gz.id);
        const cityGone = !repo.allCities().some(c => c.id === gz.id);
        return {
          cityGone,
          tripsAfter: repo.allTrips().filter(t => tripIds.includes(t.id)).length,
          binEmpty: repo.recycleBin().total === 0
        };
      })();
    `);
    ok(purge.cityGone, '永久删除后城市底层记录消失');
    ok(purge.tripsAfter === 0, '永久删除城市时其全部旅行一并清除');
    ok(purge.binEmpty, '永久删除后回收站不残留该城市的记录');

    /* ============================================================ done === */
    group('控制台健康度');
    const errors = consoleSink.filter((m) => m.type === 'error' || m.type === 'exception');
    const warnings = consoleSink.filter((m) => m.type === 'warning');
    ok(errors.length === 0, '整个流程无 console 错误',
      errors.slice(0, 6).map((e) => e.text).join('\n      '));
    if (warnings.length) {
      console.log('  \x1b[33m!\x1b[0m ' + warnings.length + ' 条警告（非致命）');
      warnings.slice(0, 4).forEach((w) => console.log('      · ' + w.text.slice(0, 160)));
    }

  } catch (err) {
    failed++;
    console.log('\n\x1b[31mFATAL\x1b[0m ' + err.message);
    console.log(err.stack);
  } finally {
    /* ------------------------------------------------------------ done --- */
    console.log('\n' + '─'.repeat(58));
    const total = passed + failed;
    const color = failed === 0 ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}E2E: ${passed}/${total} 通过, ${failed} 失败\x1b[0m`);
    if (failed) {
      console.log('\n失败项：');
      results.forEach((r) => console.log(`  [${r.group}] ${r.label}${r.detail ? '\n    ' + r.detail : ''}`));
    }
    console.log('─'.repeat(58));

    try { child.kill(); } catch {}
    server.close();
    process.exit(failed ? 1 : 0);
  }
}

main();
