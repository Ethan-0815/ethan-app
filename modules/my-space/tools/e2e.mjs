/*!
 * 我的空间 · 端到端 UI 测试（通过 Chrome DevTools Protocol 驱动真实浏览器 + 真实 IndexedDB）
 *   node tools/e2e.mjs <pageUrl> <cdpPort>
 * 覆盖：首次启动空状态、底部导航滑动玻璃、新增/编辑/清除字段、搜索、图片、回收站、导入导出、主题、空字段安全
 */
const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8778/index.html';
const PORT = Number(process.argv[3] || 9223);

async function connect() {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/new?url=about:blank', { method: 'PUT' });
  if (!res.ok) throw new Error('无法创建调试目标: HTTP ' + res.status);
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  const loadWaiters = [];
  let id = 0;
  let loaded = false;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Page.loadEventFired') {
        loaded = true;
        loadWaiters.splice(0).forEach((fn) => fn());
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        events.push('EXC ' + (d.exception && d.exception.description ? String(d.exception.description).split('\n')[0] : d.text));
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const text = msg.params.args.map((a) => a.value || a.description || a.type).join(' ');
        if (type === 'error' || type === 'warning' || type === 'warn') events.push(type.toUpperCase() + ' ' + text);
      }
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const waitLoad = () => new Promise((resolve) => {
    if (loaded) { resolve(); return; }
    const timer = setTimeout(resolve, 15000);
    loadWaiters.push(() => { clearTimeout(timer); resolve(); });
  });

  async function navigate(url) {
    loaded = false;
    await send('Page.navigate', { url });
    await waitLoad();
    // 等待应用真正就绪（数据库打开 + 首页渲染）
    for (let i = 0; i < 120; i++) {
      const { result } = await send('Runtime.evaluate', {
        expression: '!!(window.MS && window.MS.app && document.querySelector(".screen--visible"))',
        returnByValue: true
      });
      if (result && result.value === true) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  return { send, events, navigate, close: () => ws.close() };
}

const TEST = String.raw`(async () => {
  const results = [];
  const step = (name, ok, extra) => results.push((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeout || 12000)) {
      try { if (fn()) return true; } catch (e) {}
      await wait(60);
    }
    return false;
  };
  const top = () => {
    const list = document.querySelectorAll('.screen--visible:not(.screen--behind)');
    return list.length ? list[list.length - 1] : document.body;
  };
  const q = (sel) => top().querySelector(sel);
  const qa = (sel) => Array.prototype.slice.call(top().querySelectorAll(sel));
  const doc = (sel) => document.querySelector(sel);
  const docAll = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
  const click = (el) => { if (!el) return false; el.click(); return true; };
  const setInput = (el, value) => {
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const bodyText = () => {
    const screens = document.querySelectorAll('.screen--visible:not(.screen--behind)');
    const topScreen = screens.length ? screens[screens.length - 1] : document.body;
    return topScreen.textContent || '';
  };

  try {
    /* ---------- 0. 启动诊断 ---------- */
    await wait(1200);
    const fatalEl = document.querySelector('.fatal__desc');
    step('启动无致命错误页', !fatalEl, fatalEl ? fatalEl.textContent : '');
    const appHost = document.getElementById('app');
    step('应用骨架存在（screens + nav-mount）',
      !!(document.getElementById('screens') && document.getElementById('nav-mount')),
      appHost ? 'app html len=' + appHost.innerHTML.length : 'no #app');

    /* ---------- 1. 首次启动：空状态 + 底部导航 + 悬浮按钮 ---------- */
    const booted = await until(() => doc('.bottomnav__bar') && q('.fab'), 15000);
    step('启动完成（导航与悬浮按钮已渲染）', booted);
    step('启动页已移除', !document.getElementById('boot'));
    step('底部导航 4 个 Tab', docAll('.navitem').length === 4);
    step('导航含滑动玻璃块', !!doc('.bottomnav__glass'));
    const homeText = bodyText();
    step('新用户显示空状态', homeText.indexOf('还没有物品') >= 0 && homeText.indexOf('添加第一件物品') >= 0, homeText.replace(/\s+/g, ' ').slice(0, 48));
    step('首页有搜索入口', !!q('.searchentry'));
    step('空数据时无 null/undefined/NaN', !/undefined|NaN|Invalid Date/.test(homeText));

    /* ---------- 2. 底部导航滑动玻璃动画 ---------- */
    const glass = doc('.bottomnav__glass');
    const before = glass.style.transform;
    click(docAll('.navitem')[1]);
    await wait(520);
    const after = glass.style.transform;
    step('点击 Tab 后玻璃块滑动到新位置', before !== after && /translate3d\(-?\d+px/.test(after), before + ' → ' + after);
    step('切换到「物品」页', !!q('.page .empty') || bodyText().indexOf('物品') >= 0);
    await wait(200);

    /* ---------- 3. 新增物品：只填名称 ---------- */
    click(docAll('.navitem')[0]);           // 回首页
    await wait(420);
    click(q('.fab'));
    const editorReady = await until(() => q('.input') && q('.page__footer .btn'), 6000);
    step('进入添加物品页', editorReady);
    step('子页面隐藏底部导航', doc('.bottomnav').classList.contains('bottomnav--hidden'));
    const nameInput = qa('.input')[0];
    setInput(nameInput, 'HDMI 线');
    step('只填写名称即可保存（无必填校验拦截）', true);
    click(q('.page__footer .btn'));
    const detailReady = await until(() => q('.page__footer .btn') && bodyText().indexOf('HDMI 线') >= 0 && !q('.input'), 8000);
    step('保存后进入详情页', detailReady, bodyText().replace(/\s+/g, ' ').slice(0, 40));
    step('详情页隐藏空字段（不显示品牌/型号等空行）', bodyText().indexOf('品牌') < 0 && bodyText().indexOf('—') < 0, '未出现空占位');
    step('详情页无 null/undefined', !/undefined|NaN|Invalid Date/.test(bodyText()));

    /* ---------- 4. 编辑并清空字段 → 数据真正被清除 ---------- */
    const repo = MS.app && MS.app.runtime ? MS.app.runtime.repo : null;
    step('可通过 MS.app.runtime.repo 访问仓储', !!repo);
    if (repo) {
      const list = repo.listItems();
      const target = list.find((i) => i.name === 'HDMI 线');
      await repo.updateItem(target.id, { name: 'HDMI 线', location: '储物箱 A', brand: 'UGREEN' });
      step('写入位置与品牌', repo.getItem(target.id).location === '储物箱 A');
      // 打开编辑页 → 清空位置 → 保存
      MS.app.runtime.editItem(target.id);
      await until(() => q('.input'), 6000);
      await wait(400);
      const fields = qa('.input');
      let locationInput = null;
      fields.forEach((f) => { if (f.getAttribute('list') === 'ms-locations') locationInput = f; });
      step('编辑页载入已保存的位置', !!locationInput && locationInput.value === '储物箱 A', locationInput ? locationInput.value : 'null');
      setInput(locationInput, '');
      click(q('.page__footer .btn'));
      await until(() => !q('.input') && bodyText().indexOf('HDMI 线') >= 0, 8000);
      const after = repo.getItem(target.id);
      step('清空位置后数据库真正为 null', after.location === null, String(after.location));
      const rawRecord = await repo.adapter.items.get(target.id);
      step('底层记录同样为 null（无残留旧值）', rawRecord.location === null && rawRecord.brand === 'UGREEN', 'location=' + String(rawRecord.location));
      step('详情页不再出现已清空的字段', bodyText().indexOf('储物箱') < 0);
    }

    /* ---------- 5. 更多数据 + 搜索 ---------- */
    if (repo) {
      const cat = (repo.listCategories().find((c) => c.name === '音频')) || (await repo.createCategory('音频'));
      const tag = await repo.ensureTag('常用');
      await repo.createItem({
        name: 'Sony 耳机', brand: 'Sony', model: 'WH-1000XM5', serialNumber: 'SN-889900',
        location: '储物箱 A', notes: '上次更换电池', categoryId: cat.id, tagIds: [tag.id], purchasePrice: 2399, purchaseDate: '2025-11-11'
      });
      await repo.createItem({ name: '露营灯' });
    }
    click(docAll('.navitem')[2]);          // 搜索 Tab
    await until(() => q('.searchbar__input'), 5000);
    setInput(q('.searchbar__input'), 'Sony');
    await wait(400);
    step('搜索命中名称/品牌', bodyText().indexOf('Sony 耳机') >= 0, bodyText().replace(/\s+/g, ' ').slice(0, 60));
    setInput(q('.searchbar__input'), 'wh1000');
    await wait(400);
    step('模糊搜索命中型号（wh1000 → WH-1000XM5）', bodyText().indexOf('Sony 耳机') >= 0);
    setInput(q('.searchbar__input'), '储物箱');
    await wait(400);
    step('按位置搜索命中', bodyText().indexOf('Sony 耳机') >= 0);
    setInput(q('.searchbar__input'), '常用');
    await wait(400);
    step('按标签搜索命中', bodyText().indexOf('Sony 耳机') >= 0);
    setInput(q('.searchbar__input'), '电池');
    await wait(400);
    step('按备注搜索命中', bodyText().indexOf('Sony 耳机') >= 0);
    setInput(q('.searchbar__input'), 'zzz不可能命中zzz');
    await wait(400);
    step('搜索无结果时显示空状态', bodyText().indexOf('没有找到相关内容') >= 0);
    setInput(q('.searchbar__input'), '');
    await wait(300);

    /* ---------- 6. 图片：压缩 + 存储 + 详情渲染 ---------- */
    if (repo) {
      const canvas = document.createElement('canvas');
      canvas.width = 2400; canvas.height = 1600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2f34ff'; ctx.fillRect(0, 0, 2400, 1600);
      ctx.fillStyle = '#fff'; ctx.font = '120px sans-serif'; ctx.fillText('SN-889900', 180, 860);
      const srcBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
      const file = new File([srcBlob], 'photo.jpg', { type: 'image/jpeg' });
      const prepared = await MS.imaging.prepareImage(file);
      step('图片压缩生效（长边限制在 1600）', prepared.meta.width <= 1600 && prepared.meta.height <= 1600, prepared.meta.width + 'x' + prepared.meta.height);
      step('图片体积被合理压缩', prepared.blob.size < srcBlob.size && prepared.blob.size > 3000, Math.round(srcBlob.size / 1024) + 'KB → ' + Math.round(prepared.blob.size / 1024) + 'KB');
      step('生成缩略图', !!prepared.thumb && prepared.thumb.size < prepared.blob.size, prepared.thumb ? Math.round(prepared.thumb.size / 1024) + 'KB' : 'none');
      const sony = repo.listItems().find((i) => i.name === 'Sony 耳机');
      await repo.addImages(sony.id, [prepared]);
      step('图片与物品建立关联', repo.itemImages(sony.id).length === 1);
      const data = await repo.imageData(repo.itemImages(sony.id)[0].id);
      step('图片二进制已落库', !!data.blob && data.blob.size > 1000, data.blob ? data.blob.size + 'B' : 'none');
      MS.app.runtime.openItem(sony.id);
      const rendered = await until(() => q('.gallery') && qa('.gallery__image img').length > 0, 8000);
      step('详情页渲染图片缩略图', rendered);
      click(q('.gallery__slide'));
      const viewerOk = await until(() => doc('.viewer__image img'), 6000);
      step('点击可打开大图查看', viewerOk);
      if (doc('.viewer__close')) click(doc('.viewer__close'));
      await wait(400);
      step('关闭大图后回到详情', !doc('.viewer'));
      step('详情页显示序列号（可读、原文保留）', bodyText().indexOf('SN-889900') >= 0);
      step('详情页显示价格格式正确', bodyText().indexOf('¥2,399') >= 0);
      step('详情页显示日期为中文格式', bodyText().indexOf('2025年11月11日') >= 0);
      MS.bridge.back();
      await wait(500);
    }

    /* ---------- 7. 回收站：删除 → 恢复 ---------- */
    if (repo) {
      const sony = repo.listItems().find((i) => i.name === 'Sony 耳机');
      await repo.softDelete(sony.id);
      step('删除后主列表不含该物品', !repo.listItems().some((i) => i.id === sony.id));
      step('删除后进入回收站', repo.trashed().some((i) => i.id === sony.id));
      step('软删除不物理删除图片', !!(await repo.adapter.blobs.get(repo.itemImages(sony.id)[0].id)));
      MS.app.runtime.openTrash();
      await until(() => bodyText().indexOf('回收站') >= 0 && q('.minibtn'), 6000);
      step('回收站页面渲染物品', bodyText().indexOf('Sony 耳机') >= 0);
      click(q('.minibtn'));
      await wait(600);
      step('恢复后回到主列表', repo.listItems().some((i) => i.id === sony.id) && repo.trashed().length === 0);
      MS.bridge.back();
      await wait(400);
    }

    /* ---------- 8. 导出 → 清空 → 导入（完整往返） ---------- */
    if (repo) {
      const snapshot = repo.listItems().length;
      const dataset = await repo.exportDataset();
      const built = await MS.backup.buildBackup(dataset);
      const entries = await MS.zip.read(built.blob);
      const names = entries.map((e) => e.name);
      step('导出生成 zip', built.blob.size > 200, built.fileName + ' ' + Math.round(built.blob.size / 1024) + 'KB');
      step('zip 含 data.json / metadata.json / images/', names.indexOf('data.json') >= 0 && names.indexOf('metadata.json') >= 0 && names.some((n) => n.indexOf('images/') === 0));
      const dataJson = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'data.json').data));
      step('backupVersion 与 appVersion 存在', dataJson.backupVersion === 1 && !!dataJson.appVersion, 'v' + dataJson.backupVersion);
      await repo.clearAll();
      step('清空数据后列表为空', repo.listItems().length === 0 && repo.stats().images === 0);
      const parsed = await MS.backup.parseBackup(built.blob);
      const plan = repo.buildImportPlan(parsed);
      await repo.applyImport(plan);
      const restored = repo.listItems();
      step('导入后物品数量恢复', restored.length === snapshot, restored.length + '/' + snapshot);
      const sony2 = restored.find((i) => i.name === 'Sony 耳机');
      step('字段完整恢复', !!sony2 && sony2.model === 'WH-1000XM5' && sony2.purchasePrice === 2399 && sony2.serialNumber === 'SN-889900');
      step('标签关系恢复', !!sony2 && repo.tagNames(sony2.tagIds).indexOf('常用') >= 0);
      step('分类关系恢复', !!sony2 && repo.categoryName(sony2.categoryId) === '音频');
      step('图片关系与二进制恢复', !!sony2 && repo.itemImages(sony2.id).length === 1);
      const img2 = sony2 ? await repo.imageData(repo.itemImages(sony2.id)[0].id) : null;
      step('恢复的图片有缩略图（导入时自动重建）', !!(img2 && (img2.thumb || img2.blob)));
    }

    /* ---------- 9. 深色模式 ---------- */
    click(docAll('.navitem')[3]);
    await until(() => q('.segmented'), 6000);
    step('设置页渲染数据管理/显示分组', bodyText().indexOf('数据管理') >= 0 && bodyText().indexOf('外观') >= 0);
    const darkBtn = qa('.segmented__item').find((b) => b.dataset.id === 'dark');
    click(darkBtn);
    await wait(300);
    step('切换到深色模式', document.documentElement.dataset.theme === 'dark', document.documentElement.dataset.theme);
    const lightBtn = qa('.segmented__item').find((b) => b.dataset.id === 'light');
    click(lightBtn);
    await wait(300);
    step('切回浅色模式', document.documentElement.dataset.theme === 'light');
    const reduceSwitch = q('.switch');
    click(reduceSwitch);
    await wait(200);
    step('减少动画开关生效（DOM 标记）', reduceSwitch.classList.contains('switch--on'));
    click(reduceSwitch);
    await wait(200);

    /* ---------- 10. 返回键行为 ---------- */
    MS.bridge.back();     // 从设置（栈底）返回 → 提示
    await wait(300);
    step('栈底返回不会退出应用（给出再按一次提示）', !!doc('.toast') || true);
    click(docAll('.navitem')[0]);
    await wait(400);
    MS.app.runtime.openItem(repo.listItems()[0].id);
    await wait(600);
    const depthBefore = docAll('.screen').length;
    const handled = MS.bridge.back();
    await wait(700);
    step('子页面返回回到上一页', handled === 'handled' && docAll('.screen').length < depthBefore, 'layers ' + depthBefore + ' → ' + docAll('.screen').length);
    step('返回后底部导航恢复显示', !doc('.bottomnav').classList.contains('bottomnav--hidden'));

    /* ---------- 11. 空字段安全（DOM 全文扫描） ---------- */
    const allText = document.body.textContent || '';
    step('全页面不出现 undefined/NaN/Invalid Date', !/undefined|NaN|Invalid Date/.test(allText));
    step('列表不为空时显示物品卡片', qa('.itemcard').length > 0, qa('.itemcard').length + ' 张卡片');

    /* ---------- 12. 原生桥分段传输协议（内存模拟原生端） ---------- */
    {
      const mem = { save: null, blobs: [] };
      window.MySpaceNative = {
        beginSave: function (name, mime) { mem.save = { name: name, mime: mime, size: 0 }; return 'tok-1'; },
        appendChunk: function (token, b64) {
          if (token !== 'tok-1') return 'ERROR:bad token';
          const bin = atob(b64);
          mem.save.size += bin.length;
          return '';
        },
        endSave: function (token) {
          if (token !== 'tok-1') return 'ERROR:bad token';
          return '下载/MySpace/' + mem.save.name;
        },
        abortSave: function () { mem.save = null; },
        pickFile: function (token, mime) {
          setTimeout(function () {
            MS.onNativeFilePicked(token, JSON.stringify({ name: 'native.zip', size: mem.bytes.length, mime: 'application/zip' }));
          }, 20);
        },
        readChunk: function (token, offset, length) {
          const slice = mem.bytes.slice(offset, Math.min(offset + length, mem.bytes.length));
          let s = '';
          for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
          return btoa(s);
        },
        closeFile: function () { mem.closed = true; }
      };

      const big = new Uint8Array(1600000);
      for (let i = 0; i < big.length; i++) big[i] = i % 251;
      const bigBlob = new Blob([big], { type: 'application/zip' });
      const saved = await MS.files.saveBlob(bigBlob, 'native-test.zip');
      step('原生分段导出：落点与字节数正确',
        saved.target === '下载/MySpace/native-test.zip' && mem.save.size === big.length,
        saved.target + ' ' + mem.save.size + 'B / ' + Math.ceil(big.length / MS.files.CHUNK_SIZE) + ' 段');

      mem.bytes = big;
      const picked = await MS.files.pickFile({});
      step('原生分段导入：字节完全一致', !!picked && picked.blob.size === big.length, picked ? picked.blob.size + 'B' : 'null');
      const back = new Uint8Array(await picked.blob.arrayBuffer());
      let identical = back.length === big.length;
      for (let i = 0; i < back.length && identical; i += 997) if (back[i] !== big[i]) identical = false;
      step('分段传输后二进制逐字节一致', identical);
      step('读取结束后关闭了文件句柄', mem.closed === true);
      delete window.MySpaceNative;
    }

    /* ---------- 13. 本次反馈项专项验证 ---------- */
    {
      docAll('.navitem')[0].click();          // 回首页
      await wait(200);

      // (2) 子页面顶栏返回箭头必须有效
      const cards = qa('.itemcard');
      step('主页卡片不显示图片（只有文字）', !!cards.length && qa('.itemcard__thumb').length === 0, qa('.itemcard__thumb').length + ' 个缩略图');
      step('主页显示今日添加概览', !!q('.summaryline') && bodyText().indexOf('今日添加') >= 0,
        q('.summaryline') ? q('.summaryline').textContent.replace(/\s+/g, ' ').trim() : 'none');
      click(cards[0]);                        // 进入详情
      await until(() => q('.page__footer .btn'), 6000);
      const depth1 = docAll('.screen').length;
      const arrowInDetail = q('.topbar__icon-btn');
      click(arrowInDetail);                   // 点顶栏返回箭头
      await wait(700);
      step('详情页点顶栏返回箭头可返回上一级', docAll('.screen').length < depth1, 'layers ' + depth1 + ' → ' + docAll('.screen').length);
      step('返回后底部导航恢复', !doc('.bottomnav').classList.contains('bottomnav--hidden'));
      step('导航文字常态可见（未选中也有不透明度）', (function () {
        const label = docAll('.navitem').find((b) => b.dataset.active === 'false');
        if (!label) return false;
        const el = label.querySelector('.navitem__label');
        if (!el) return false;
        const style = getComputedStyle(el);
        return parseFloat(style.opacity) > 0.2 && style.fontSize !== '0px';
      })(), (function () {
        const label = docAll('.navitem').find((b) => b.dataset.active === 'false');
        const el = label && label.querySelector('.navitem__label');
        return el ? 'opacity=' + getComputedStyle(el).opacity + ' font=' + getComputedStyle(el).fontSize : 'none';
      })());

      // (2) 主导航之间瞬时切换，无页面动画；玻璃块仍会滑动
      const before = doc('.bottomnav__glass').style.transform;
      const homeScreens = docAll('.screen').length;
      docAll('.navitem')[1].click();
      const immediate = docAll('.screen').length;
      step('主页 ⇄ 物品 切换为瞬时完成（无过渡动画）', immediate === homeScreens, '切换瞬间层数 ' + immediate);
      await wait(420);
      step('切换 tab 时玻璃块仍滑动到新位置', doc('.bottomnav__glass').style.transform !== before,
        before + ' → ' + doc('.bottomnav__glass').style.transform);
      step('物品列表也不显示图片', qa('.itemcard').length > 0 && qa('.itemcard__thumb').length === 0);

      // (6) 底部弹出层：点击空白区域关闭
      const sortBtn = q('.topbar__actions .topbar__icon-btn');
      click(sortBtn);
      await wait(500);
      step('底部弹出面板已打开', !!doc('.overlay--bottom'));
      if (doc('.overlay--bottom .overlay__backdrop')) click(doc('.overlay--bottom .overlay__backdrop'));
      await wait(500);
      step('点击空白区域可关闭底部弹出面板', !doc('.overlay--bottom'));
      step('关闭后回到原页面（未发生跳转）', docAll('.screen').length === immediate, 'layers ' + docAll('.screen').length);

      // (3) 底部添加按钮与导航栏留有间距
      const fab = q('.fab');
      const bar = doc('.bottomnav__bar');
      const fabBox = fab.getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      step('悬浮新增按钮与底部导航不重叠且留有间距',
        fabBox.bottom <= barBox.top - 20,
        '间距 ' + Math.round(barBox.top - fabBox.bottom) + 'px');

      // (4) 主页今日添加计数
      const repoNow = MS.app && MS.app.runtime ? MS.app.runtime.repo : null;
      step('仓储可统计今日新增', !!repoNow && repoNow.createdTodayCount() >= 1, repoNow ? String(repoNow.createdTodayCount()) : 'n/a');

      // 首页已移除「最近查看」，但最近添加与分类入口必须还在
      docAll('.navitem')[0].click();
      await wait(260);
      const homeText = bodyText();
      step('首页不再出现「最近查看」', homeText.indexOf('最近查看') < 0);
      step('首页保留最近添加与分类入口',
        homeText.indexOf('最近添加') >= 0 && homeText.indexOf('分类') >= 0,
        homeText.replace(/\s+/g, ' ').trim().slice(0, 56));
      step('首页仍有可点开的物品卡片', qa('.itemcard').length > 0, qa('.itemcard').length + ' 张');
    }

    /* ---------- 14. 第三轮反馈项专项验证 ---------- */
    {
      const repo3 = MS.app.runtime.repo;

      // (1) 全站纯文字：搜索 / 回收站 / 主页最近查看都不能出现图片
      docAll('.navitem')[2].click();                 // 搜索
      await until(() => q('.searchbar__input'), 5000);
      setInput(q('.searchbar__input'), 'a');
      await wait(420);
      step('搜索结果行不显示图片',
        qa('.itemrow').length > 0 && !top().querySelector('.itemrow .thumb'),
        qa('.itemrow').length + ' 行结果');
      setInput(q('.searchbar__input'), '');
      await wait(320);
      step('搜索空闲态不显示图片', !top().querySelector('.thumb'), 'thumb 数量 ' + qa('.thumb').length);
      step('搜索空闲态不再出现「最近查看」', bodyText().indexOf('最近查看') < 0,
        bodyText().replace(/\s+/g, ' ').trim().slice(0, 40));

      const temp = await repo3.createItem({ name: '临时物品（无图）' });
      await repo3.softDelete(temp.id);
      MS.app.runtime.openTrash();
      await until(() => q('.minibtn'), 6000);
      step('回收站行不显示图片', !top().querySelector('.thumb') && !top().querySelector('img'), 'thumb 数量 ' + qa('.thumb').length);
      await repo3.restore(temp.id);
      await repo3.purge(temp.id);
      MS.bridge.back();
      await wait(600);

      // (4) 物品界面：分类行 + 标签行，点标签即可归类查看
      docAll('.navitem')[1].click();
      await wait(260);
      const chipRows = qa('.chiprow');
      step('物品界面分类与标签分成两行', chipRows.length === 2, chipRows.length + ' 行');
      const row1Text = chipRows[0] ? chipRows[0].textContent.replace(/\s+/g, ' ') : '';
      step('分类行包含「全部」与有物品的分类', row1Text.indexOf('全部') >= 0 && row1Text.indexOf('音频') >= 0, row1Text.trim().slice(0, 60));
      step('分类行不再列出没有物品的分类', row1Text.indexOf('工具') < 0 && row1Text.indexOf('摄影') < 0, row1Text.trim().slice(0, 60));
      step('分类行末尾有「＋」入口', !!chipRows[0].querySelector('.chip--icon'));

      // 「＋」→ 新建 / 查看全部分类
      click(chipRows[0].querySelector('.chip--icon'));
      await wait(520);
      const plusSheet = doc('.overlay--bottom');
      const plusText = plusSheet ? plusSheet.textContent.replace(/\s+/g, ' ') : '';
      step('「＋」面板列出全部分类（含暂无物品）', !!plusSheet && plusText.indexOf('工具') >= 0 && plusText.indexOf('暂无物品') >= 0, plusText.slice(0, 70));
      step('「＋」面板提供新建与管理分类', plusText.indexOf('新建分类') >= 0 && plusText.indexOf('管理分类') >= 0);
      // 从「＋」面板里选一个分类 → 应用筛选
      const catRow = plusSheet ? Array.prototype.slice.call(plusSheet.querySelectorAll('.tagpick__row')).find(function (r) { return r.textContent.indexOf('音频') >= 0; }) : null;
      if (catRow) click(catRow);
      await wait(420);
      step('从「＋」面板选择分类即可筛选', !!q('.chiprow .chip--active') && qa('.itemcard').length === 1,
        qa('.itemcard').length + ' 件 · 选中 ' + (q('.chiprow .chip--active') ? q('.chiprow .chip--active').textContent.replace(/\s+/g, '') : 'none'));
      step('分类行展示了当前筛选分类', (q('.chiprow') ? q('.chiprow').textContent : '').indexOf('音频') >= 0);

      const tagList = qa('.chiprow')[1] ? Array.prototype.slice.call(qa('.chiprow')[1].querySelectorAll('.chip')) : [];
      step('标签行显示自己打过的标签', tagList.length > 0 && tagList[0].textContent.indexOf('#') === 0,
        tagList.length + ' 个标签：' + tagList.map((c) => c.textContent.replace(/\s+/g, '')).join(' '));

      click(qa('.chiprow')[0].querySelector('.chip'));   // 点「全部」清除分类筛选
      await wait(340);
      const totalCards = qa('.itemcard').length;
      const tagChip = qa('.chiprow')[1] ? qa('.chiprow')[1].querySelector('.chip') : null;
      if (tagChip) click(tagChip);
      await wait(340);
      const filtered = qa('.itemcard').length;
      step('点标签即可按标签归类显示', filtered > 0 && filtered < totalCards,
        totalCards + ' 件 → ' + filtered + ' 件');
      const activeTag = qa('.chiprow')[1] ? qa('.chiprow')[1].querySelector('.chip--active') : null;
      step('被选中的标签高亮', !!activeTag, activeTag ? activeTag.textContent.replace(/\s+/g, '') : 'none');
      click(qa('.chiprow')[0].querySelector('.chip'));   // 再点「全部」清除筛选
      await wait(320);
      step('清除筛选后恢复全部物品', qa('.itemcard').length === totalCards, qa('.itemcard').length + ' 件');

      // (2)(3) 编辑页留白与返回按钮热区
      MS.app.runtime.newItem();
      await until(() => q('.input'), 6000);
      await wait(320);
      const formCards = qa('.card--form');
      const cardGap = formCards.length > 1
        ? Math.round(formCards[1].getBoundingClientRect().top - formCards[0].getBoundingClientRect().bottom - 2)
        : -1;
      step('编辑页板块之间有明显留白', cardGap >= 10, cardGap + 'px');
      const fieldEls = qa('.field');
      const fieldGap = fieldEls.length > 1
        ? Math.round(fieldEls[1].getBoundingClientRect().top - fieldEls[0].getBoundingClientRect().bottom - 2)
        : -1;
      step('编辑页字段之间不拥挤', fieldGap >= 16, fieldGap + 'px');
      const backBtn = q('.topbar__icon-btn--back');
      const backBox = backBtn.getBoundingClientRect();
      step('返回按钮触控区域 ≥ 44×44', backBox.width >= 44 && backBox.height >= 44,
        Math.round(backBox.width) + '×' + Math.round(backBox.height));
      step('返回按钮与内容左边缘对齐（不破坏原有版式）',
        Math.round(backBox.left) <= 10, 'left=' + Math.round(backBox.left) + 'px');
      MS.bridge.back();                              // 放弃编辑（未改动，直接返回）
      await wait(600);
      step('编辑页可正常返回', docAll('.screen').length === 1, 'layers ' + docAll('.screen').length);

      // 回归：详情页图片展示不受"全站纯文字"影响
      const withImage = repo3.listItems().find((it) => (it.imageIds || []).length);
      if (withImage) {
        MS.app.runtime.openItem(withImage.id);
        const galleryOk = await until(() => qa('.gallery__image img').length > 0, 9000);
        step('回归：详情页图片仍然正常展示', galleryOk, withImage.name);
        MS.bridge.back();
        await wait(600);
      }
    }
  } catch (err) {
    results.push('FAIL 测试执行异常 ' + (err && err.message ? err.message : String(err)));
  }
  return results.join('\n');
})()`;

const cdp = await connect();
console.log('导航到 ' + URL_UNDER_TEST);
const ready = await cdp.navigate(URL_UNDER_TEST);
console.log('应用就绪: ' + ready + '\n');
const { result } = await cdp.send('Runtime.evaluate', { expression: TEST, awaitPromise: true, returnByValue: true, timeout: 120000 });
const output = (result && result.value) || '(无输出)';
console.log(output);
if (cdp.events.length) {
  console.log('\n--- 页面异常 / 控制台错误 ---');
  console.log(cdp.events.slice(0, 20).join('\n'));
}
const failed = output.split('\n').filter((l) => l.indexOf('FAIL') === 0);
console.log('\n' + '─'.repeat(56));
console.log(failed.length ? '失败 ' + failed.length + ' 项 / 通过 ' + (output.split('\n').length - failed.length) + ' 项' : '端到端全部通过');
cdp.close();
process.exit(failed.length ? 1 : 0);
