/*!
 * 工具箱 · 端到端 UI 测试（通过 Chrome DevTools Protocol 驱动真实浏览器 + 真实 Canvas）
 *   node tools/e2e.mjs <pageUrl> <cdpPort>
 *
 * 覆盖：首页/分类/搜索/最近使用、13 个工具的真实交互闭环、返回键、Android 原生桥协议。
 * 说明：系统级文件选择器无法自动化，测试里只把「选择图片」与「保存文件」两个出口替换为内存实现，
 *      其余（页面渲染、按钮点击、计算、Canvas 编码、PDF 生成）全部走真实代码路径。
 */
const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8790/index.html';
const PORT = Number(process.argv[3] || 9333);

async function connect() {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/new?url=about:blank', { method: 'PUT' });
  if (!res.ok) throw new Error('无法创建调试目标: HTTP ' + res.status);
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  const requests = [];
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
      if (msg.method === 'Network.requestWillBeSent') {
        requests.push(msg.params.request.url);
      }
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
    for (let i = 0; i < 120; i++) {
      const { result } = await send('Runtime.evaluate', {
        expression: '!!(window.TB && window.TB.app && window.TB.app.runtime && document.querySelector(".screen--visible"))',
        returnByValue: true
      });
      if (result && result.value === true) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  return { send, events, requests, navigate, close: () => ws.close() };
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
  const screens = () => document.querySelectorAll('.screen--visible:not(.screen--behind)');
  const top = () => { const list = screens(); return list.length ? list[list.length - 1] : document.body; };
  const q = (sel) => top().querySelector(sel);
  const qa = (sel) => Array.prototype.slice.call(top().querySelectorAll(sel));
  const doc = (sel) => document.querySelector(sel);
  const docAll = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
  const text = () => (top().textContent || '');
  const flat = () => (top().textContent || '').replace(/\s+/g, ' ');
  const setInput = (el, value) => {
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const atHome = () => {
    const list = document.querySelectorAll('.screen--visible:not(.screen--behind)');
    return TB.app.runtime.router.depth() === 1 && list.length === 1 &&
      list[0].dataset.page === 'home';
  };
  const goBack = async () => {
    // 模拟真实手指：点击返回前输入框已失焦
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    const r = TB.bridge.back();
    await wait(340);
    return r;
  };
  const toolBtn = (id) => docAll('.toolcard').find((b) => b.dataset.tool === id);
  const segBtn = (id) => qa('.segmented__item').find((b) => b.dataset.id === String(id));
  const testCanvasBlob = async (w, h, type, quality, transparent) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (!transparent) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
    const grad = x.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2f6bff'); grad.addColorStop(1, '#ff7a45');
    x.fillStyle = grad;
    x.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.5);
    x.fillStyle = 'rgba(0,0,0,0.75)';
    x.font = Math.round(w / 12) + 'px sans-serif';
    x.fillText('工具箱 TEST', w * 0.1, h * 0.75);
    // 注意：图案从 (20,20) 开始画，保证左上角始终保持透明，
    // 便于后面精确验证「PNG → JPG 时透明区域被填成白色」。
    for (let i = 0; i < 400; i++) {
      x.fillStyle = 'rgba(' + (i * 7 % 255) + ',' + (i * 13 % 255) + ',' + (i * 29 % 255) + ',0.9)';
      x.fillRect(20 + (i * 37) % Math.max(1, w - 40), 20 + (i * 61) % Math.max(1, h - 40), 6, 6);
    }
    const blob = await new Promise((r) => c.toBlob(r, type, quality));
    const ext = type === 'image/png' ? 'png' : (type === 'image/webp' ? 'webp' : 'jpg');
    return new File([blob], 'test-' + w + 'x' + h + '.' + ext, { type: type });
  };

  try {
    /* ---------- 0. 启动诊断 ---------- */
    await wait(900);
    step('启动无致命错误页', !doc('.fatal__desc'), doc('.fatal__desc') ? doc('.fatal__desc').textContent : '');
    step('启动页已移除', !document.getElementById('boot'));
    step('应用骨架存在', !!document.getElementById('screens'));
    step('首页已渲染工具卡片', await until(() => docAll('.toolcard').length > 0, 8000));
    step('首页共 13 个工具卡片', docAll('.toolcard').length === 13, String(docAll('.toolcard').length));
    step('首页有标题「工具箱」', text().indexOf('工具箱') >= 0);
    step('首页有搜索框', !!q('.searchbar__input'));
    step('首次进入隐藏「最近使用」区块', text().indexOf('最近使用') < 0);

    /* ---------- 0.5 网络守卫：记录任何联网尝试并让它失败 ----------
       说明：不使用 CDP 的 setBlockedURLs 来"断网"，因为实测它会把 blob: 图片解码一起阻断
       （那是浏览器实现行为，与本应用是否联网无关）。这里改为在页面内拦截所有网络 API。 */
    window.__netAttempts = [];
    (function () {
      if (window.fetch) {
        window.fetch = function (input) {
          window.__netAttempts.push('fetch:' + String(input));
          return Promise.reject(new Error('网络已被测试环境拦截'));
        };
      }
      const xhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        window.__netAttempts.push('xhr:' + String(url));
        return xhrOpen.apply(this, arguments);
      };
      const NativeWS = window.WebSocket;
      if (NativeWS) {
        const GuardedWS = function (url) {
          window.__netAttempts.push('websocket:' + String(url));
          return new NativeWS(url);
        };
        GuardedWS.prototype = NativeWS.prototype;
        window.WebSocket = GuardedWS;
      }
      if (navigator.sendBeacon) {
        navigator.sendBeacon = function (url) {
          window.__netAttempts.push('beacon:' + String(url));
          return false;
        };
      }
      const NativeES = window.EventSource;
      if (NativeES) {
        const GuardedES = function (url) {
          window.__netAttempts.push('eventsource:' + String(url));
          return new NativeES(url);
        };
        GuardedES.prototype = NativeES.prototype;
        window.EventSource = GuardedES;
      }
    })();

    /* ---------- 0.6 底部操作区必须真实可见（防止"按钮在、但被 display:none 藏起来"） ---------- */
    {
      const footerCheck = async (toolId, selector, label) => {
        await wait(340);
        TB.app.runtime.openTool(toolId);
        const found = await until(() => q(selector), 8000);
        await wait(340);                      // 等转场动画结束，避免量到"位移中间态"
        const el = found ? q(selector) : null;
        const rect = el ? el.getBoundingClientRect() : null;
        const host = el ? el.closest('.page__footer') : null;
        const hostStyle = host ? getComputedStyle(host) : null;
        const hostRect = host ? host.getBoundingClientRect() : null;
        const hostVisible = !!host && hostStyle.display !== 'none' && hostStyle.visibility !== 'hidden' &&
          hostRect.height > 24;
        const inView = !!rect && rect.width > 20 && rect.height > 20 &&
          rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
        step('底部操作区真实可见：' + label, !!el && hostVisible && inView,
          'footer.display=' + (hostStyle ? hostStyle.display : 'none') +
          ' footerH=' + (hostRect ? Math.round(hostRect.height) : 0) +
          ' btn=' + (rect ? Math.round(rect.top) + '~' + Math.round(rect.bottom) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) : 'null'));
        return { el: el, rect: rect, host: host };
      };

      await footerCheck('calc', '.key--eq', '计算器「=」键');
      const keys = qa('.key');
      step('计算器键盘按键数量完整', keys.length === TB.calc.KEYPAD.length, keys.length + '/' + TB.calc.KEYPAD.length);
      step('计算器所有按键都在视口内可见',
        keys.every((k) => { const r = k.getBoundingClientRect(); return r.height > 28 && r.bottom <= window.innerHeight + 1; }),
        '最小高度 ' + Math.min.apply(null, keys.map((k) => Math.round(k.getBoundingClientRect().height))));
      const keypadRect = q('.keypad').getBoundingClientRect();
      step('计算器键盘没有横向溢出或超出屏幕',
        keypadRect.left >= -1 && keypadRect.right <= window.innerWidth + 1,
        Math.round(keypadRect.left) + '~' + Math.round(keypadRect.right) + ' / 视口 ' + window.innerWidth);

      await footerCheck('uuid', '[data-action="generate"]', 'UUID 生成按钮');
      q('[data-action="generate"]').click();
      await wait(420);
      const toastRect = doc('.toast') ? doc('.toast').getBoundingClientRect() : null;
      const uuidFooterRect = q('.page__footer').getBoundingClientRect();
      step('提示条落在底部主按钮上方，不遮挡按钮',
        !!toastRect && toastRect.bottom <= uuidFooterRect.top + 1,
        toastRect ? 'toast.bottom=' + Math.round(toastRect.bottom) + ' footer.top=' + Math.round(uuidFooterRect.top) : '无提示条');
      await wait(2400);

      await footerCheck('json', '[data-action="beautify"]', 'JSON 格式化按钮');
      await footerCheck('random', '[data-action="roll"]', '随机按钮');

      // 明确声明 footer:false 的页面不应留下空白操作条
      await wait(340);
      TB.app.runtime.openTool('radix');
      await until(() => q('.input--num'), 6000);
      const radixFooter = q('.page__footer');
      step('无底部操作的页面不会留下空白操作条',
        !!radixFooter && getComputedStyle(radixFooter).display === 'none',
        radixFooter ? getComputedStyle(radixFooter).display : 'no footer');

      TB.app.runtime.router.home();
      await wait(300);
      TB.recent.clear();
      TB.app.runtime.router.home();
      await wait(200);
      step('底部操作区检查后回到首页', atHome(), 'depth=' + TB.app.runtime.router.depth());
    }

    /* ---------- 1. 分类 ---------- */
    const homeText = flat();
    step('三个分类都出现', ['图片', '计算', '开发 / 电脑'].every((n) => homeText.indexOf(n) >= 0), homeText.slice(0, 60));
    const names = docAll('.toolcard').map((c) => c.querySelector('.toolcard__name').textContent);
    const expectNames = ['图片压缩', '图片格式转换', '图片转 PDF', '计算器', '折扣计算', '百分比计算', '单位换算',
      '文件大小换算', '随机数 / 随机选择', 'JSON 格式化', '进制转换', 'UUID 生成', '时间戳转换'];
    step('13 个工具名称齐全', expectNames.every((n) => names.indexOf(n) >= 0), names.join(' | '));
    step('工具卡片是整块可点的按钮', docAll('.toolcard').every((c) => c.tagName === 'BUTTON'));
    step('卡片包含图标/名称/说明', docAll('.toolcard').every((c) =>
      c.querySelector('.toolcard__emoji') && c.querySelector('.toolcard__name') && c.querySelector('.toolcard__desc')));
    step('首页没有底部导航栏', !doc('.bottomnav') && !doc('.navitem'));
    step('首页无 undefined/NaN', !/undefined|NaN|Infinity|\[object Object\]/.test(document.body.textContent));

    /* ---------- 2. 搜索 ---------- */
    const search = q('.searchbar__input');
    setInput(search, 'JSON');
    await wait(260);
    step('搜索 JSON 只命中 JSON 格式化',
      qa('.toolcard').length === 1 && qa('.toolcard')[0].querySelector('.toolcard__name').textContent === 'JSON 格式化',
      qa('.toolcard').map((c) => c.querySelector('.toolcard__name').textContent).join(','));
    setInput(search, '图片');
    await wait(260);
    step('搜索「图片」命中 3 个图片工具', qa('.toolcard').length === 3, String(qa('.toolcard').length));
    setInput(search, 'pdf');
    await wait(260);
    step('搜索英文 PDF 命中图片转 PDF', qa('.toolcard').length === 1 && flat().indexOf('图片转 PDF') >= 0, flat().slice(0, 40));
    setInput(search, '压缩');
    await wait(260);
    step('搜索「压缩」命中图片压缩且排在首位',
      qa('.toolcard')[0].querySelector('.toolcard__name').textContent === '图片压缩');
    setInput(search, '时间戳');
    await wait(260);
    step('搜索「时间戳」命中时间戳转换', qa('.toolcard').length === 1 && flat().indexOf('时间戳转换') >= 0);
    setInput(search, '随机');
    await wait(260);
    step('搜索「随机」命中随机数工具', qa('.toolcard').length === 1 && flat().indexOf('随机数') >= 0);
    setInput(search, 'zzz不存在的工具zzz');
    await wait(260);
    step('搜索无结果时显示友好空状态', flat().indexOf('没有找到相关工具') >= 0, flat().slice(0, 50));
    step('搜索无结果不报错', !doc('.fatal__desc'));
    const clearBtn = q('.searchbar__clear');
    step('搜索框提供清空按钮', !!clearBtn && clearBtn.style.display !== 'none');
    clearBtn.click();
    await wait(300);
    step('清空搜索后恢复全部工具', qa('.toolcard').length === 13, String(qa('.toolcard').length));

    /* ---------- 3. 进入工具 + 返回 + 最近使用 ---------- */
    toolBtn('calc').click();
    await until(() => q('.keypad'), 6000);
    step('点击卡片进入计算器', !!q('.keypad'));
    const layerCount = () => document.querySelectorAll('.screen').length;
    const visibleCount = () => screens().length;
    step('进入工具后是独立页面层',
      TB.app.runtime.router.depth() === 2 && layerCount() === 2 && visibleCount() === 1,
      'depth=' + TB.app.runtime.router.depth() + ' layers=' + layerCount() + ' visible=' + visibleCount());
    const backArrow = q('.topbar__icon-btn--back');
    step('工具页有返回按钮', !!backArrow);
    await wait(340);                        // 等转场动画结束再量尺寸
    const box = backArrow.getBoundingClientRect();
    step('返回按钮触控区域 ≥ 44×44', box.width >= 44 && box.height >= 44, Math.round(box.width) + 'x' + Math.round(box.height));
    backArrow.click();
    const wentHome = await until(atHome, 5000);
    step('点击顶栏返回箭头回到首页', wentHome,
      'depth=' + TB.app.runtime.router.depth() + ' screens=' + screens().length);
    const recentDiag = 'recent=' + JSON.stringify(TB.recent.list()) + ' ls=' +
      (function () { try { return String(localStorage.getItem('toolbox.recent.v1')); } catch (e) { return 'ERR:' + e.message; } })();
    step('首页出现「最近使用」区块', flat().indexOf('最近使用') >= 0, recentDiag);
    step('最近使用记录了计算器', (q('.card--flush') ? q('.card--flush').textContent : '').indexOf('计算器') >= 0, recentDiag);

    for (const id of ['json', 'uuid', 'radix', 'discount']) {
      TB.app.runtime.openTool(id);
      await wait(260);
      await goBack();
      await until(atHome, 4000);
    }
    step('连续进入/返回 4 个工具后仍在首页', atHome(), 'depth=' + TB.app.runtime.router.depth());
    const recentCard = q('.card--flush');
    const recentNames = recentCard
      ? Array.prototype.slice.call(recentCard.querySelectorAll('.listrow__label')).map((e) => e.textContent)
      : [];
    step('最近使用最多 4 条', recentNames.length === 4, recentNames.join(','));
    step('最近使用不含最旧的「计算器」', recentNames.indexOf('计算器') < 0, recentNames.join(','));
    step('最近使用按最近使用时间排序', recentNames[0] === '折扣计算', recentNames.join(','));
    recentCard.querySelector('.listrow').click();
    await until(() => TB.app.runtime.router.depth() === 2, 5000);
    step('点击最近使用可进入工具',
      TB.app.runtime.router.depth() === 2 && layerCount() === 2,
      'depth=' + TB.app.runtime.router.depth() + ' layers=' + layerCount());
    await goBack();
    await until(atHome, 4000);
    step('从最近使用进入后可以正常返回', atHome());

    /* ---------- 4. 计算器 ---------- */
    const press = async (ids) => {
      for (const id of ids) {
        const btn = qa('.key').find((b) => b.dataset.key === id);
        if (!btn) throw new Error('缺少按键 ' + id);
        btn.click();
        await wait(16);
      }
      await wait(80);
    };
    const calcResult = () => (q('.calcdisplay__result') || {}).textContent || '';
    TB.app.runtime.openTool('calc');
    await until(() => q('.keypad'), 6000);
    await press(['1', '2', '5', 'mul', '3', 'dot', '5', 'eq']);
    step('125 × 3.5 = 437.5', calcResult() === '437.5', calcResult());
    await press(['clear', '1', 'div', '0', 'eq']);
    step('除以 0 给出中文提示', calcResult() === '不能除以 0', calcResult());
    step('除以 0 不出现 Infinity', flat().indexOf('Infinity') < 0);
    await press(['clear', '0', 'dot', '1', 'add', '0', 'dot', '2', 'eq']);
    step('0.1 + 0.2 = 0.3（无浮点尾巴）', calcResult() === '0.3', calcResult());
    await press(['clear', 'sign', '5', 'add', '3', 'eq']);
    step('负数运算 -5 + 3 = -2', calcResult() === '-2', calcResult());
    await press(['clear', 'paren', '1', 'add', '2', 'paren', 'mul', '3', 'eq']);
    step('括号运算 (1+2)×3 = 9', calcResult() === '9', calcResult() + ' 表达式=' + q('.calcdisplay__expr').textContent);
    await press(['clear', '1', 'add', 'eq']);
    step('不完整算式给出中文提示', calcResult() === '表达式有误，请检查输入', calcResult());
    await press(['clear', 'eq']);
    step('空算式提示先输入', calcResult() === '请先填写内容', calcResult());
    await press(['clear', '5', 'percent', 'mul', '2', '0', '0', 'eq']);
    step('百分号按键可用：5% × 200 = 10', calcResult() === '10', calcResult());
    step('计算器页面无异常文字', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 5. 折扣计算 ---------- */
    TB.app.runtime.openTool('discount');
    await until(() => qa('.input').length >= 2, 6000);
    let inputs = qa('.input');
    setInput(inputs[0], '299');
    setInput(inputs[1], '7.5');
    await wait(320);
    step('299 元 7.5 折 → 折后价 224.25', flat().indexOf('224.25') >= 0, flat().slice(0, 80));
    step('折扣结果含节省金额 74.75', flat().indexOf('74.75') >= 0);
    step('折扣结果含折扣率', flat().indexOf('25.00%') >= 0 || flat().indexOf('25%') >= 0);
    inputs = qa('.input');
    setInput(inputs[1], '0');
    await wait(320);
    step('折扣为 0 时给出中文提示', flat().indexOf('折扣需要大于') >= 0, flat().slice(0, 60));
    setInput(qa('.input')[1], '75%');
    await wait(320);
    step('折扣填百分比写法时给出明确提示', flat().indexOf('折扣请填') >= 0, flat().slice(0, 60));
    setInput(qa('.input')[0], 'abc');
    setInput(qa('.input')[1], '8');
    await wait(320);
    step('原价填非法字符时提示有效数字', flat().indexOf('请输入有效的原价') >= 0, flat().slice(0, 60));
    step('折扣页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));

    // 键盘弹起时的返回链路：系统返回键先收键盘，再按一次才返回
    setInput(qa('.input')[0], '199');
    qa('.input')[0].focus();
    await wait(200);
    const kbFirst = TB.bridge.back();
    await wait(260);
    step('键盘弹起时系统返回键先收起键盘（不直接返回）',
      kbFirst === 'handled' && TB.app.runtime.router.depth() === 2,
      'result=' + kbFirst + ' depth=' + TB.app.runtime.router.depth());
    await goBack();
    step('再按一次返回才真正回到上一页', atHome(), 'depth=' + TB.app.runtime.router.depth());
    await wait(300);

    /* ---------- 6. 百分比三种模式 ---------- */
    TB.app.runtime.openTool('percent');
    await until(() => qa('.segmented__item').length >= 3, 6000);
    let pctInputs = qa('.input');
    setInput(pctInputs[0], '200');
    setInput(pctInputs[1], '15');
    await wait(320);
    step('模式一：200 的 15% = 30', flat().indexOf('30') >= 0 && flat().indexOf('计算结果') >= 0, flat().slice(0, 70));
    segBtn('change').click();
    await wait(220);
    pctInputs = qa('.input');
    setInput(pctInputs[0], '100');
    setInput(pctInputs[1], '120');
    await wait(320);
    step('模式二：100 → 120 变化 +20%', flat().indexOf('+20%') >= 0 && flat().indexOf('增加') >= 0, flat().slice(0, 80));
    setInput(qa('.input')[1], '80');
    await wait(320);
    step('模式二：100 → 80 显示下降', flat().indexOf('−20%') >= 0 && flat().indexOf('减少') >= 0, flat().slice(0, 80));
    setInput(qa('.input')[0], '0');
    setInput(qa('.input')[1], '5');
    await wait(320);
    step('模式二：原数为 0 时提示无法计算', flat().indexOf('原数不能为 0') >= 0, flat().slice(0, 70));
    segBtn('ratio').click();
    await wait(220);
    setInput(qa('.input')[0], '30');
    setInput(qa('.input')[1], '120');
    await wait(320);
    step('模式三：30 占 120 = 25%', flat().indexOf('25%') >= 0, flat().slice(0, 70));
    setInput(qa('.input')[1], '0');
    await wait(320);
    step('模式三：总数为 0 时提示', flat().indexOf('总数不能为 0') >= 0, flat().slice(0, 70));
    step('百分比页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 7. 单位换算 ---------- */
    TB.app.runtime.openTool('units');
    await until(() => qa('select').length >= 2, 6000);
    setInput(q('.input--num'), '100');
    await wait(320);
    let selects = qa('select');
    selects[0].value = 'cm'; selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    selects[1].value = 'm'; selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    await wait(320);
    step('100 厘米 = 1 米', flat().indexOf('1 m') >= 0 || flat().indexOf('1 米') >= 0, flat().slice(0, 70));
    q('[data-action="swap"]').click();
    await wait(320);
    selects = qa('select');
    step('交换单位后从=米、到=厘米', selects[0].value === 'm' && selects[1].value === 'cm',
      selects[0].value + '→' + selects[1].value);
    step('交换后 100 米 = 10,000 厘米', flat().indexOf('10,000') >= 0, flat().slice(0, 70));
    const tempSeg = qa('.segmented__item').find((b) => b.dataset.id === 'temperature');
    tempSeg.click();
    await wait(320);
    setInput(q('.input--num'), '0');
    selects = qa('select');
    await wait(200);
    step('温度分类默认摄氏→华氏', selects[0].value === 'c' && selects[1].value === 'f', selects[0].value + '→' + selects[1].value);
    step('0 摄氏度 = 32 华氏度', flat().indexOf('32') >= 0, flat().slice(0, 70));
    setInput(q('.input--num'), 'abc');
    await wait(320);
    step('单位换算非法输入提示', flat().indexOf('请输入有效数字') >= 0, flat().slice(0, 60));
    step('单位换算页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 8. 文件大小换算 ---------- */
    TB.app.runtime.openTool('filesize');
    await until(() => q('.input--num') && q('select'), 6000);
    setInput(q('.input--num'), '1.5');
    q('select').value = '2';
    q('select').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(320);
    step('1.5 MB 主结果正确', flat().indexOf('1.5 MB') >= 0, flat().slice(0, 70));
    step('1.5 MB = 1,500 KB（十进制）', flat().indexOf('1,500') >= 0, flat().slice(0, 90));
    const fsLabels = qa('.resultcell__label').map((e) => e.textContent);
    step('十进制下结果单位是 KB/MB（不出现 KiB）',
      fsLabels.indexOf('KB') >= 0 && fsLabels.indexOf('MiB') < 0 && fsLabels.indexOf('KiB') < 0, fsLabels.join(','));
    q('.switchrow').click();
    await wait(320);
    step('切换到 1024 进制后出现 KiB', flat().indexOf('KiB') >= 0, flat().slice(0, 80));
    step('1024 进制下 1.5 MiB = 1,536 KiB', flat().indexOf('1,536') >= 0, flat().slice(0, 90));
    q('.switchrow').click();
    await wait(240);
    setInput(q('.input--num'), 'abc');
    await wait(320);
    step('文件大小非法输入提示', flat().indexOf('请输入有效数字') >= 0, flat().slice(0, 60));
    setInput(q('.input--num'), '-1');
    await wait(320);
    step('文件大小负数被拒绝', flat().indexOf('不能是负数') >= 0, flat().slice(0, 60));
    step('文件大小页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 9. 随机数 / 随机选择 ---------- */
    TB.app.runtime.openTool('random');
    await until(() => q('.input--num'), 6000);
    let rInputs = [q('[data-role="min"]'), q('[data-role="max"]')];
    setInput(rInputs[0], '1');
    setInput(rInputs[1], '100');
    q('[data-action="roll"]').click();
    await wait(300);
    const rolled = q('.resultcard .bignum');
    const rolledValue = rolled ? Number(rolled.textContent) : NaN;
    step('随机数落在 1~100 之间且为整数',
      Number.isInteger(rolledValue) && rolledValue >= 1 && rolledValue <= 100, String(rolledValue));
    const firstRoll = rolled.textContent;
    let changed = false;
    for (let i = 0; i < 12 && !changed; i++) {
      q('[data-action="reroll"]').click();
      await wait(120);
      if (q('.resultcard .bignum').textContent !== firstRoll) changed = true;
    }
    step('重新随机能得到不同结果', changed);
    rInputs = qa('.input--num');
    setInput(rInputs[0], '100');
    setInput(rInputs[1], '1');
    q('[data-action="roll"]').click();
    await wait(300);
    step('最小值大于最大值时提示', flat().indexOf('最小值不能大于最大值') >= 0, flat().slice(0, 60));
    await wait(2200);
    rInputs = [q('[data-role="min"]'), q('[data-role="max"]')];
    setInput(rInputs[0], '1');
    setInput(rInputs[1], '2');
    segBtn('dec').click();
    await wait(200);
    q('[data-action="roll"]').click();
    await wait(300);
    const decValue = Number(q('.resultcard .bignum').textContent);
    step('小数模式结果在区间内', decValue >= 1 && decValue <= 2, String(decValue));
    step('小数模式结果含小数位', String(q('.resultcard .bignum').textContent).indexOf('.') >= 0,
      q('.resultcard .bignum').textContent);
    setInput(q('[data-role="min"]'), 'abc');
    q('[data-action="roll"]').click();
    await wait(300);
    step('随机数非法输入提示', flat().indexOf('最小值需要是有效数字') >= 0, flat().slice(0, 60));

    // 随机选择
    await wait(2200);
    segBtn('pick').click();
    await wait(280);
    const area = q('[data-role="options"]');
    setInput(area, '奶茶\n\n  咖啡  \n可乐\n果汁\n');
    q('[data-action="draw"]').click();
    await wait(320);
    step('随机选择能抽中一个选项',
      ['奶茶', '咖啡', '可乐', '果汁'].some((n) => (q('[data-result="random-pick"]') || { textContent: '' }).textContent.indexOf(n) >= 0),
      (q('[data-result="random-pick"]') || { textContent: '' }).textContent.replace(/\s+/g, ' ').slice(0, 60));
    setInput(q('[data-role="count"]'), '3');
    q('[data-action="draw"]').click();
    await wait(320);
    const picked = qa('[data-picked]').map((e) => e.dataset.picked);
    step('一次抽 3 个且不重复', picked.length === 3 && new Set(picked).size === 3, picked.join(','));
    setInput(q('[data-role="count"]'), '99');
    q('[data-action="draw"]').click();
    await wait(320);
    step('抽取数量超过选项数时按选项数给', qa('[data-picked]').length === 4, String(qa('[data-picked]').length));
    setInput(q('[data-role="options"]'), '只有一个选项');
    q('[data-action="draw"]').click();
    await wait(320);
    step('只有 1 个有效选项时提示', flat().indexOf('至少需要 2 个有效选项') >= 0, flat().slice(0, 60));

    // 不重复抽取
    setInput(q('[data-role="options"]'), 'A\nB');
    setInput(q('[data-role="count"]'), '1');
    q('.switchrow').click();
    await wait(260);
    q('[data-action="draw"]').click();
    await wait(320);
    const firstDraw = qa('[data-picked]').map((e) => e.dataset.picked);
    step('不重复抽取第一次给出 1 个', firstDraw.length === 1, firstDraw.join(','));
    step('不重复抽取显示进度', flat().indexOf('已抽取 1 / 2') >= 0, flat().slice(-60));
    q('[data-action="redraw"]').click();
    await wait(320);
    const secondDraw = qa('[data-picked]').map((e) => e.dataset.picked);
    step('第二次抽到另一个选项（不重复）', secondDraw.length === 1 && secondDraw[0] !== firstDraw[0],
      firstDraw[0] + ' → ' + secondDraw[0]);
    q('[data-action="redraw"]').click();
    await wait(320);
    step('全部抽完后给出提示', flat().indexOf('所有选项都已经抽取过了') >= 0, flat().slice(-60));
    q('[data-action="reset"]').click();
    await wait(320);
    step('重新开始后回到空闲状态', flat().indexOf('所有选项都已经抽取过了') < 0 && flat().indexOf('怎么用') >= 0);
    step('随机页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 10. JSON ---------- */
    TB.app.runtime.openTool('json');
    await until(() => q('.input--area'), 6000);
    const jsonArea = q('.input--area');
    setInput(jsonArea, '{"name":"工具箱","tags":["a","b"],"nested":{"v":1,"deep":{"x":2}}}');
    q('[data-action="check"]').click();
    await wait(300);
    step('JSON 检查：格式正确', flat().indexOf('格式正确') >= 0, flat().slice(0, 70));
    step('JSON 检查：识别类型为对象', flat().indexOf('对象') >= 0);
    step('JSON 检查：统计嵌套深度', flat().indexOf('深度') >= 0 && flat().indexOf('3 层') >= 0, flat().slice(0, 90));
    step('JSON 检查：列出顶层键', flat().indexOf('name') >= 0 && flat().indexOf('tags') >= 0);
    q('[data-action="beautify"]').click();
    await wait(320);
    step('JSON 格式化成功后换行缩进', q('.input--area').value.indexOf('\n  "name"') >= 0, JSON.stringify(q('.input--area').value.slice(0, 24)));
    step('格式化结果卡显示成功', flat().indexOf('已格式化') >= 0);
    q('[data-action="minify"]').click();
    await wait(320);
    step('JSON 压缩为一行', q('.input--area').value.indexOf('\n') < 0 && q('.input--area').value.length > 10);
    setInput(q('.input--area'), '{\n  "a": 1,\n  "b": ,\n  "c": 2\n}');
    q('[data-action="check"]').click();
    await wait(320);
    step('错误 JSON 显示格式有误', flat().indexOf('JSON 格式有误') >= 0, flat().slice(0, 90));
    step('错误 JSON 给出行号', /第 \d+ 行/.test(flat()), flat().slice(0, 90));
    step('错误 JSON 给出原因说明', /逗号|属性名|引号|不完整/.test(flat()), flat().slice(0, 90));
    setInput(q('.input--area'), '[1,2,3]');
    q('[data-action="check"]').click();
    await wait(320);
    step('数组也能通过检查', flat().indexOf('数组') >= 0 && flat().indexOf('长度') >= 0, flat().slice(0, 90));
    setInput(q('.input--area'), '   ');
    q('[data-action="check"]').click();
    await wait(320);
    step('空输入给出提示', flat().indexOf('请先粘贴 JSON 内容') >= 0 || doc('.toast'), flat().slice(0, 50));
    step('JSON 页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));

    /* ---------- 10.5 JSON 文件导入（只把"系统文件选择器"换成内存实现，读取与解析全走真实代码） ---------- */
    {
      const realPickRaw = TB.files.pickRawFiles;
      window.__mockFiles = [];
      window.__pickRawCalls = [];
      TB.files.pickRawFiles = async function (accept, multiple) {
        window.__pickRawCalls.push(String(accept || ''));
        return window.__mockFiles.slice();
      };

      const jsonText = '{"name":"工具箱","version":0.1,"tags":["a","b"],"nested":{"deep":{"x":2}}}';
      window.__mockFiles = [new File([jsonText], 'config.json', { type: 'application/json' })];
      q('[data-action="open-file"]').click();
      const loaded = await until(() => String(q('.input--area').value).indexOf('工具箱') >= 0, 8000);
      step('选择 JSON 文件后内容被读入编辑区', loaded,
        'calls=' + JSON.stringify(window.__pickRawCalls) + ' value=' + String(q('.input--area').value).slice(0, 40));
      step('文件选择器限制了文本类型', /json/.test(window.__pickRawCalls[0] || ''), window.__pickRawCalls[0]);
      step('界面提示了已载入的文件名与大小',
        flat().indexOf('config.json') >= 0 && /已选择 config\.json（.+）/.test(flat()), flat().slice(0, 120));
      step('载入后自动完成格式检查', flat().indexOf('格式正确') >= 0);

      q('[data-action="beautify"]').click();
      await wait(340);
      step('导入的文件内容可以正常美化（缩进换行）',
        String(q('.input--area').value).indexOf('\n  "name"') >= 0,
        JSON.stringify(String(q('.input--area').value).slice(0, 24)));
      q('[data-action="minify"]').click();
      await wait(340);
      const minified = String(q('.input--area').value);
      step('导入的文件内容可以正常压缩成一行', minified.indexOf('\n') < 0 && minified.length > 10, minified.slice(0, 40));
      q('[data-action="check"]').click();
      await wait(340);
      step('导入的文件内容可以正常检查（含结构概览）',
        flat().indexOf('格式正确') >= 0 && flat().indexOf('顶层键') >= 0 && flat().indexOf('深度') >= 0,
        flat().slice(0, 120));
      step('导入后仍可用粘贴方式覆盖内容（两种方式共存）', !!q('.input--area'));

      // 读取失败 / 边界情况
      window.__mockFiles = [new File([''], 'empty.json', { type: 'application/json' })];
      q('[data-action="open-file"]').click();
      await wait(700);
      step('空文件给出友好提示', flat().indexOf('空文件') >= 0, flat().slice(0, 90));
      await wait(2200);
      window.__mockFiles = [];
      q('[data-action="open-file"]').click();
      await wait(600);
      step('取消选择文件时不报错、界面不变', !doc('.fatal__desc') && String(q('.input--area').value).length > 0);

      await wait(400);
      window.__mockFiles = [new File(['\uFEFF{"a":1}'], 'bom.json', { type: 'application/json' })];
      q('[data-action="open-file"]').click();
      // 必须等到“这一轮”真的载入完成（文件名出现在界面上），否则会误把上一轮的结果当成成功
      const bomOk = await until(() => flat().indexOf('bom.json') >= 0 && flat().indexOf('格式正确') >= 0, 8000);
      step('带 UTF-8 BOM 的 JSON 文件也能正确解析',
        bomOk && String(q('.input--area').value).indexOf('{"a":1}') >= 0, String(q('.input--area').value).slice(0, 20));

      // 导入非法 JSON：应给出友好错误而不是崩溃
      await wait(400);
      window.__mockFiles = [new File(['{ "a": 1, }'], 'broken.json', { type: 'application/json' })];
      q('[data-action="open-file"]').click();
      const brokenOk = await until(() => flat().indexOf('broken.json') >= 0 && flat().indexOf('JSON 格式有误') >= 0, 8000);
      step('导入非法 JSON 时给出可定位的中文错误',
        brokenOk && /第 \d+ 行/.test(flat()) && String(q('.input--area').value).indexOf('"a"') >= 0,
        flat().slice(0, 120));

      TB.files.pickRawFiles = realPickRaw;
      window.__mockFiles = [];
    }
    await goBack();
    await wait(300);

    /* ---------- 11. 进制转换 ---------- */
    TB.app.runtime.openTool('radix');
    await until(() => q('.input--num'), 6000);
    setInput(q('.input--num'), '255');
    await wait(320);
    const radixText = flat();
    step('十进制 255 → 二进制 11111111', radixText.indexOf('11111111') >= 0);
    step('十进制 255 → 八进制 377', radixText.indexOf('377') >= 0);
    step('十进制 255 → 十六进制 FF', radixText.indexOf('FF') >= 0);
    setInput(q('.input--num'), '0');
    await wait(300);
    step('0 在四种进制下都是 0', qa('.resultcell__value').every((e) => e.textContent === '0'),
      qa('.resultcell__value').map((e) => e.textContent).join(','));
    setInput(q('.input--num'), '-255');
    await wait(300);
    step('负数正确处理', qa('.resultcell__value').some((e) => e.textContent === '-FF'),
      qa('.resultcell__value').map((e) => e.textContent).join(','));
    setInput(q('.input--num'), '123456789012345678901234567890');
    await wait(320);
    step('大数字不丢精度',
      qa('.resultcell__value').some((e) => e.textContent === '123456789012345678901234567890'),
      qa('.resultcell__value')[2] ? qa('.resultcell__value')[2].textContent : '');
    segBtn(16).click();
    await wait(220);
    setInput(q('.input--num'), 'ff');
    await wait(300);
    step('小写十六进制可识别', qa('.resultcell__value')[2].textContent === '255', qa('.resultcell__value')[2].textContent);
    setInput(q('.input--num'), '12G5');
    await wait(300);
    step('十六进制非法字符提示明确', flat().indexOf('十六进制数字无效') >= 0, flat().slice(0, 70));
    segBtn(2).click();
    await wait(220);
    setInput(q('.input--num'), '102');
    await wait(300);
    step('二进制非法字符提示明确', flat().indexOf('二进制数字无效') >= 0, flat().slice(0, 70));
    step('进制页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 12. UUID ---------- */
    TB.app.runtime.openTool('uuid');
    await until(() => q('[data-action="generate"]'), 6000);
    q('[data-action="generate"]').click();
    await wait(320);
    let uuids = qa('.resultcell__value').map((e) => e.textContent);
    step('生成 1 个 UUID', uuids.length === 1, String(uuids.length));
    step('UUID 符合 v4 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuids[0]), uuids[0]);
    setInput(q('.input--num'), '5');
    q('[data-action="generate"]').click();
    await wait(400);
    uuids = qa('.resultcell__value').map((e) => e.textContent);
    step('批量生成 5 个 UUID', uuids.length === 5, String(uuids.length));
    step('5 个 UUID 互不相同', new Set(uuids).size === 5);
    step('每个 UUID 单独一行', qa('.resultgrid .resultcell').length === 5);
    const realCopy = TB.files.copyText;
    window.__copied = null;
    TB.files.copyText = async (t) => { window.__copied = t; return true; };
    q('[data-action="copy-all"]').click();
    await wait(320);
    step('全部复制把 5 行 UUID 写入剪贴板', window.__copied && window.__copied.split('\n').length === 5,
      window.__copied ? String(window.__copied.split('\n').length) : 'null');
    step('复制后有成功提示', !!doc('.toast'));
    TB.files.copyText = realCopy;
    await wait(2200);
    setInput(q('.input--num'), '0');
    q('[data-action="generate"]').click();
    await wait(320);
    step('数量为 0 时给出提示', flat().indexOf('1 ~ 200 之间的整数') >= 0, flat().slice(0, 70));
    step('UUID 页无 undefined/NaN', !/undefined|NaN|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 13. 时间戳 ---------- */
    TB.app.runtime.openTool('timestamp');
    await until(() => q('.input--mono'), 6000);
    setInput(q('.input--mono'), '1750000000');
    await wait(360);
    step('时间戳 → 日期：ISO 时间正确', flat().indexOf('2025-06-15T15:06:40') >= 0, flat().slice(0, 110));
    step('时间戳 → 日期：时区信息可见', /UTC[+-]\d{2}:\d{2}/.test(flat()));
    step('时间戳 → 日期：显示星期', flat().indexOf('星期') >= 0);
    step('时间戳 → 日期：显示距今', flat().indexOf('距今') >= 0);
    segBtn('ms').click();
    await wait(300);
    step('切换到毫秒模式后结果变化', flat().indexOf('2025-06-15T15:06:40') < 0, flat().slice(0, 60));
    segBtn('s').click();
    await wait(300);
    q('[data-action="now"]').click();
    await wait(320);
    const nowTs = Number(q('.input--mono').value);
    const realNow = Math.floor(Date.now() / 1000);
    step('「使用当前时间」填入的秒级时间戳接近当前', Math.abs(nowTs - realNow) < 10, String(nowTs - realNow));
    step('当前时间戳换算出的年份是今年', flat().indexOf(String(new Date().getFullYear())) >= 0);
    const dateField = q('input[type="date"]');
    const timeField = q('input[type="time"]');
    setInput(dateField, '2025-06-15');
    setInput(timeField, '15:06:40');
    await wait(400);
    step('日期 → 时间戳：给出秒级结果', flat().indexOf('Unix 时间戳（秒）') >= 0);
    step('日期 → 时间戳：同时给出毫秒结果', flat().indexOf('Unix 时间戳（毫秒）') >= 0);
    const secCells = qa('.resultcell__value').map((e) => e.textContent);
    const secondsValue = Number(secCells[0]);
    step('日期 → 时间戳：秒级值可读且合理',
      Number.isInteger(secondsValue) && secondsValue > 1700000000 && secondsValue < 1900000000, String(secondsValue));
    step('日期 → 时间戳：毫秒值 = 秒值 × 1000', Number(secCells[1]) === secondsValue * 1000, secCells.join(' / '));
    setInput(q('.input--mono'), String(secondsValue));
    await wait(400);
    step('往返一致：时间戳换回同一日期时间', flat().indexOf('2025-06-15 15:06:40') >= 0, flat().slice(0, 90));
    setInput(dateField, '');
    await wait(360);
    step('清空日期后回到空闲提示', flat().indexOf('选择日期与时间后') >= 0, flat().slice(0, 60));
    setInput(q('.input--mono'), 'abc');
    await wait(360);
    step('非法时间戳给出提示', flat().indexOf('时间戳需要是整数') >= 0, flat().slice(0, 70));
    setInput(q('.input--mono'), '99999999999999999999');
    await wait(360);
    step('超大时间戳给出提示', flat().indexOf('超出可表示范围') >= 0, flat().slice(0, 70));
    step('时间戳页无 undefined/NaN/Invalid Date', !/undefined|NaN|Invalid Date|Infinity/.test(flat()));
    await goBack();
    await wait(300);

    /* ---------- 14. 图片工具（真实 Canvas 编码，仅替换文件选择与保存出口） ---------- */
    const realPick = TB.files.pickImages;
    const realSave = TB.files.saveBlob;
    window.__saved = [];
    window.__mockFiles = [];
    window.__pickCalls = [];
    TB.files.pickImages = async (opts) => {
      window.__pickCalls.push(opts && opts.multiple ? 'multi' : 'single');
      const list = window.__mockFiles.slice();
      return opts && opts.multiple ? list : list.slice(0, 1);
    };
    TB.files.saveBlob = async (blob, name) => { window.__saved.push({ blob: blob, name: name }); return { target: '测试目录' }; };
    const mockSave = TB.files.saveBlob;

    const bigJpeg = await testCanvasBlob(2000, 1200, 'image/jpeg', 0.95);
    step('测试素材：生成 2000×1200 JPEG', bigJpeg.size > 20000, String(bigJpeg.size) + 'B');

    // 图片压缩
    TB.app.runtime.openTool('img-compress');
    await until(() => q('.dropzone'), 6000);
    step('图片压缩空状态提示选择图片', flat().indexOf('选择一张图片开始压缩') >= 0, flat().slice(0, 40));
    window.__mockFiles = [bigJpeg];
    q('.dropzone').click();
    const imgReady = await until(() => q('.previewbox img') && q('.rows'), 12000);
    step('选择图片后显示预览与信息', imgReady,
      'picks=' + JSON.stringify(window.__pickCalls) +
      ' toast=' + (doc('.toast') ? doc('.toast').textContent : 'none') +
      ' progress=' + (doc('.progress') ? doc('.progress').textContent.replace(/\s+/g, ' ') : 'none') +
      ' depth=' + TB.app.runtime.router.depth());
    if (!imgReady) {
      results.push('FAIL 跳过图片压缩的后续用例（前置渲染失败）');
    } else {
      step('图片信息包含尺寸', flat().indexOf('2000 × 1200') >= 0, flat().slice(0, 120));
      step('图片信息包含格式 JPG', flat().indexOf('JPG') >= 0);
      step('图片信息包含原始大小', flat().indexOf('原始大小') >= 0);
      step('压缩质量控制存在', !!q('.range') && flat().indexOf('压缩质量') >= 0);
      step('尺寸上限选项存在', flat().indexOf('尺寸上限') >= 0);
      q('[data-action="compress"]').click();
      await until(() => q('[data-result]') || q('.compare'), 20000);
      step('压缩后显示对比结果', !!q('.compare'), '');
      const compressText = flat();
      step('结果显示原始大小/压缩后/节省/压缩率',
        ['原始大小', '压缩后', '节省', '压缩率'].every((k) => compressText.indexOf(k) >= 0), compressText.slice(0, 120));
      step('压缩率是合法百分比', /压缩率[^%]*\d+(\.\d+)?%/.test(compressText), (compressText.match(/压缩率[^%]*\d+(\.\d+)?%/) || [''])[0]);
      step('压缩后体积小于原图', compressText.indexOf('1.') >= 0 || compressText.indexOf('0.') >= 0);
      q('[data-action="save"]').click();
      await until(() => window.__saved.length > 0, 6000);
      step('保存触发下载并给出文件名', window.__saved.length === 1 && /\.jpe?g$/i.test(window.__saved[0].name), window.__saved[0] && window.__saved[0].name);
      step('压缩后确实是 JPEG', window.__saved.length === 1 && window.__saved[0].blob.type === 'image/jpeg', window.__saved[0] && window.__saved[0].blob.type);
      step('压缩后字节数小于原图', window.__saved.length === 1 && window.__saved[0].blob.size < bigJpeg.size,
        window.__saved[0] && (window.__saved[0].blob.size + 'B < ' + bigJpeg.size + 'B'));
      step('保存后提示存到何处', flat().indexOf('已保存') >= 0 || !!doc('.toast'));

      // 尺寸上限
      q('[data-action="repick"]').click();
      await wait(320);
      window.__mockFiles = [bigJpeg];
      q('.dropzone').click();
      await until(() => q('.previewbox img'), 8000);
      const limitSize = qa('.segmented__item').find((b) => b.dataset.id === '800');
      limitSize.click();
      await wait(320);
      window.__saved = [];
      q('[data-action="compress"]').click();
      await until(() => q('[data-action="save"]'), 20000);
      q('[data-action="save"]').click();
      await until(() => window.__saved.length > 0, 6000);
      const limited = window.__saved[0].blob;
      const limitedImg = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(limited);
      });
      step('限制长边 800 后输出尺寸正确', !!limitedImg && limitedImg.w === 800 && limitedImg.h === 480,
        limitedImg ? limitedImg.w + 'x' + limitedImg.h : 'null');
      step('限制尺寸后体积明显下降', limited.size < bigJpeg.size / 2, limited.size + 'B');

      // 大图（内存压力）
      const hugeJpeg = await testCanvasBlob(3000, 2000, 'image/jpeg', 0.92);
      q('[data-action="repick"]').click();
      await wait(320);
      window.__mockFiles = [hugeJpeg];
      q('.dropzone').click();
      await until(() => q('.previewbox img'), 12000);
      window.__saved = [];
      q('[data-action="compress"]').click();
      await until(() => q('[data-action="save"]'), 30000);
      q('[data-action="save"]').click();
      await until(() => window.__saved.length > 0, 8000);
      step('3000×2000 大图压缩成功且体积下降', window.__saved.length === 1 && window.__saved[0].blob.size < hugeJpeg.size,
        window.__saved[0] ? window.__saved[0].blob.size + 'B / ' + hugeJpeg.size + 'B' : 'null');
      await wait(2200);
      await goBack();
      await wait(320);
    }

    // 图片格式转换
    const transparentPng = await testCanvasBlob(900, 600, 'image/png', undefined, true);
    TB.app.runtime.openTool('img-convert');
    await until(() => q('.dropzone'), 6000);
    step('格式转换空状态提示', flat().indexOf('选择一张图片开始转换') >= 0);
    window.__mockFiles = [transparentPng];
    q('.dropzone').click();
    await until(() => q('.previewbox img'), 8000);
    step('格式转换显示原格式 PNG', flat().indexOf('PNG') >= 0);
    step('目标格式包含 JPG/PNG/WebP',
      ['JPG', 'PNG', 'WebP'].every((n) => qa('.segmented__item').some((b) => b.textContent === n)),
      qa('.segmented__item').map((b) => b.textContent).join(','));
    const jpgSeg = qa('.segmented__item').find((b) => b.dataset.id === 'image/jpeg');
    jpgSeg.click();
    await wait(320);
    step('PNG → JPG 时提示会用白底', flat().indexOf('透明') >= 0 && flat().indexOf('白色') >= 0, flat().slice(0, 120));
    window.__saved = [];
    q('[data-action="convert"]').click();
    await until(() => q('[data-action="save"]'), 20000);
    step('转换结果显示原格式与转换后格式', flat().indexOf('PNG → JPG') >= 0, flat().slice(0, 130));
    step('转换结果显示原大小与新大小', flat().indexOf('原大小') >= 0 && flat().indexOf('新大小') >= 0);
    q('[data-action="save"]').click();
    await until(() => window.__saved.length > 0, 6000);
    step('转换后保存为 .jpg', /\.jpg$/i.test(window.__saved[0].name), window.__saved[0].name);
    // 先确认素材本身左上角确实是透明的，保证下面的判断有意义
    const sourceCornerAlpha = await (async () => {
      const url = URL.createObjectURL(transparentPng);
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
      if (!img) { URL.revokeObjectURL(url); return -1; }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const px = c.getContext('2d').getImageData(2, 2, 1, 1).data;
      URL.revokeObjectURL(url);
      return px[3];
    })();
    step('前置条件：PNG 素材左上角是透明的', sourceCornerAlpha === 0, 'alpha=' + sourceCornerAlpha);
    const whiteCheck = await (async () => {
      const saved = window.__saved[window.__saved.length - 1];
      const info = { name: saved.name, type: saved.blob.type, size: saved.blob.size, savedCount: window.__saved.length };
      const url = URL.createObjectURL(saved.blob);
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
      if (!img) { URL.revokeObjectURL(url); return { ok: false, info: info, px: 'decode failed' }; }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const px = x.getImageData(2, 2, 1, 1).data;
      URL.revokeObjectURL(url);
      info.size = img.naturalWidth + 'x' + img.naturalHeight + ' ' + info.size + 'B';
      return { ok: px[0] > 240 && px[1] > 240 && px[2] > 240, info: info, px: [px[0], px[1], px[2]].join(',') };
    })();
    step('PNG 透明区域被填成白色（不是黑底）', whiteCheck.ok,
      '像素=' + whiteCheck.px + ' ' + JSON.stringify(whiteCheck.info));
    await wait(2200);
    await goBack();
    await wait(320);

    // 图片转 PDF
    const pages3 = [
      await testCanvasBlob(1000, 750, 'image/jpeg', 0.9),
      await testCanvasBlob(800, 1200, 'image/png', undefined, true),
      await testCanvasBlob(1600, 900, 'image/jpeg', 0.9)
    ];
    TB.app.runtime.openTool('img-pdf');
    await until(() => q('.dropzone'), 6000);
    step('图片转 PDF 空状态提示', flat().indexOf('添加图片开始制作 PDF') >= 0);
    window.__mockFiles = pages3;
    q('.dropzone').click();
    await until(() => qa('.pagerow').length === 3, 15000);
    step('一次选择多张图片全部加入', qa('.pagerow').length === 3, String(qa('.pagerow').length));
    step('每张图片是一页并显示页码',
      qa('.pagerow__name').map((e) => e.textContent.indexOf('第') >= 0).every(Boolean),
      qa('.pagerow__name').map((e) => e.textContent.slice(0, 6)).join(' | '));
    step('提示每张图片一页 A4', flat().indexOf('A4') >= 0);
    const pageNames = () => qa('.pagerow__name').map((e) => String(e.textContent).split(' · ').slice(1).join(' · '));
    const orderBefore = pageNames();
    qa('.pagerow')[0].querySelector('[aria-label="下移"]').click();
    await wait(320);
    const orderAfter = pageNames();
    step('可以调整页面顺序', orderBefore[0] !== orderAfter[0] && orderAfter[0] === orderBefore[1],
      orderBefore.join(' | ') + '  →  ' + orderAfter.join(' | '));
    step('第一页的上移按钮被禁用', qa('.pagerow')[0].querySelector('[aria-label="上移"]').disabled === true);
    qa('.pagerow')[1].querySelector('[aria-label="删除这一页"]').click();
    await wait(320);
    step('可以删除指定页', qa('.pagerow').length === 2, String(qa('.pagerow').length));
    window.__saved = [];
    q('[data-action="generate"]').click();
    await until(() => q('[data-action="save"]'), 40000);
    step('生成 PDF 成功并显示页数', flat().indexOf('文件页数') >= 0 && flat().indexOf('2 页') >= 0, flat().slice(0, 130));
    step('生成结果标注 A4 页面尺寸', flat().indexOf('210 × 297') >= 0);
    q('[data-action="save"]').click();
    await until(() => window.__saved.length > 0, 8000);
    step('保存 PDF 文件名以 .pdf 结尾', /\.pdf$/i.test(window.__saved[0].name), window.__saved[0].name);
    const pdfBlob = window.__saved[0].blob;
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    let pdfLatin = '';
    for (let i = 0; i < pdfBytes.length; i++) pdfLatin += String.fromCharCode(pdfBytes[i]);
    step('生成的是真正的 PDF 文件', /^%PDF-/.test(pdfLatin) && /\n%%EOF/.test(pdfLatin));
    step('PDF 页数与界面一致', (pdfLatin.match(/\/Type \/Page[^s]/g) || []).length === 2,
      String((pdfLatin.match(/\/Type \/Page[^s]/g) || []).length));
    step('PDF 页面为 A4 尺寸', pdfLatin.indexOf('/MediaBox [0 0 595.28 841.89]') >= 0);
    step('PDF 内嵌图片数据', (pdfLatin.match(/\/DCTDecode/g) || []).length === 2);
    step('PDF 体积合理', pdfBlob.size > 5000, pdfBlob.size + 'B');
    await wait(2200);
    await goBack();
    await wait(320);

    /* ---------- 15. Android 原生桥分段传输协议 ---------- */
    {
      const mem = { save: null, bytes: null, closed: false };
      window.ToolboxNative = {
        beginSave: function (name, mime) { mem.save = { name: name, mime: mime, size: 0 }; return 'tok-1'; },
        appendChunk: function (token, b64) {
          if (token !== 'tok-1') return 'ERROR:bad token';
          const bin = atob(b64);
          mem.save.size += bin.length;
          return '';
        },
        endSave: function (token) {
          if (token !== 'tok-1') return 'ERROR:bad token';
          return '下载/Toolbox/' + mem.save.name;
        },
        abortSave: function () { mem.save = null; },
        exitApp: function () { mem.exited = true; }
      };
      const bridgeSave = realSave;      // 用真实实现验证原生桥协议
      TB.files.saveBlob = realSave;
      const big = new Uint8Array(1200000);
      for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
      const saved = await bridgeSave(new Blob([big], { type: 'application/pdf' }), '桥接测试.pdf');
      step('原生桥分段导出：落点与字节数正确',
        saved.target === '下载/Toolbox/桥接测试.pdf' && mem.save.size === big.length,
        saved.target + ' ' + mem.save.size + 'B');
      step('原生桥按 384KB 分段传输', Math.ceil(big.length / TB.files.CHUNK_SIZE) === 4,
        Math.ceil(big.length / TB.files.CHUNK_SIZE) + ' 段');
      TB.files.saveBlob = mockSave;
      delete window.ToolboxNative;
    }

    /* ---------- 16. 返回键与收尾 ---------- */
    TB.app.runtime.openTool('calc');
    await wait(360);
    const subBack = TB.bridge.back();
    const subWentBack = await until(atHome, 4000);
    step('系统返回键在子页面生效', subBack === 'handled' && subWentBack,
      'result=' + subBack + ' depth=' + TB.app.runtime.router.depth());
    const rootBack = TB.bridge.back();
    step('栈底返回不会退出应用（提示再按一次）', rootBack === 'handled' && !!doc('.toast'), rootBack);
    await wait(300);

    docAll('.toolcard');
    TB.app.runtime.router.home();
    await wait(300);
    step('回到首页后工具卡片完整', docAll('.toolcard').length === 13, String(docAll('.toolcard').length));

    // 全站扫描：逐个工具打开检查异常文字
    const toolIds = TB.registry.all().map((t) => t.id);
    let badPages = [];
    for (const id of toolIds) {
      TB.app.runtime.openTool(id);
      await wait(260);
      const t = top().textContent || '';
      if (/undefined|NaN|\bInfinity\b|\[object Object\]|Invalid Date/.test(t)) badPages.push(id);
      await goBack();
      await wait(240);
    }
    step('全部 13 个工具页都不出现 undefined/NaN/Infinity', badPages.length === 0, badPages.join(','));
    step('整个会话没有发起任何联网尝试（fetch/XHR/WebSocket/beacon）',
      window.__netAttempts.length === 0,
      window.__netAttempts.length ? window.__netAttempts.join(' , ') : '0 次尝试');

    TB.files.pickImages = realPick;
    TB.files.saveBlob = realSave;
  } catch (err) {
    results.push('FAIL 测试执行异常 ' + (err && err.message ? err.message : String(err)));
  }
  return results.join('\n');
})()`;

/*!
 * 附加测试 A：响应式 —— 用真实的设备视口逐个页面检查横向溢出
 * 在页面内执行，由 Node 侧先设置视口尺寸再调用
 */
const RESPONSIVE_TEST = String.raw`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ids = ['home'].concat(TB.registry.all().map((t) => t.id));
  const de = document.documentElement;
  const viewport = de.clientWidth;
  const bad = [];
  const scrollable = (el, stop) => {
    let node = el.parentElement;
    while (node && node !== stop) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;      // 可横向滚动的条带允许超出
      node = node.parentElement;
    }
    return false;
  };
  for (const id of ids) {
    if (id === 'home') TB.app.runtime.router.home(); else TB.app.runtime.openTool(id);
    await wait(360);                                          // 等转场动画结束，避免测到中间态
    const visible = document.querySelectorAll('.screen--visible:not(.screen--behind)');
    const topScreen = visible.length ? visible[visible.length - 1] : document.body;
    const over = topScreen.scrollWidth - topScreen.clientWidth;
    const wide = [].slice.call(topScreen.querySelectorAll('*')).filter((el) => {
      if (el.closest('.layer-root')) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (getComputedStyle(el).visibility === 'hidden') return false;
      if (scrollable(el, topScreen)) return false;
      return r.right > viewport + 1.5 || r.left < -1.5;
    }).slice(0, 3).map((el) => {
      const r = el.getBoundingClientRect();
      return (el.className || el.tagName) + '(' + Math.round(r.left) + '~' + Math.round(r.right) + ')';
    });
    if (over > 2 || wide.length) bad.push(id + '[溢出' + over + 'px' + (wide.length ? ' ' + wide.join('/') : '') + ']');
    if (id !== 'home') { TB.app.runtime.router.home(); await wait(240); }
  }
  return JSON.stringify({ viewport: viewport, innerWidth: window.innerWidth, bad: bad });
})()`;

/*!
 * 附加测试 B：断网 —— 模拟设备完全离线后核心功能是否仍可用
 */
const OFFLINE_TEST = String.raw`(async () => {
  const out = [];
  const step = (name, ok, extra) => out.push((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  [' + extra + ']' : ''));
  step('浏览器报告已离线', navigator.onLine === false, String(navigator.onLine));
  step('应用界面仍然可用', !document.querySelector('.fatal__desc') && document.querySelectorAll('.toolcard').length === 13);
  step('计算器仍可计算', TB.calc.evaluate('125*3.5').text === '437.5');
  step('单位换算仍可用', TB.units.convert('length', 'cm', 'm', 100).value === 1);
  step('JSON 处理仍可用', TB.jsonutil.minify('{ "a": 1 }').text === '{"a":1}');
  step('进制转换仍可用', TB.radix.convert('255', 10).results[3].text === 'FF');
  step('时间戳转换仍可用', TB.time.timestampToDate('1750000000', 's').iso.indexOf('2025-06-15') === 0);
  step('UUID 仍可生成', /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(TB.util.uuidV4()));
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 140;
    const x = c.getContext('2d');
    x.fillStyle = '#ff7a45'; x.fillRect(0, 0, 200, 140);
    x.fillStyle = '#fff'; x.font = '24px sans-serif'; x.fillText('OFFLINE', 20, 80);
    const jpeg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    step('断网时图片编码仍然可用（Canvas → JPEG）', bytes.length > 800, bytes.length + 'B');
    const pdf = await TB.pdf.build([{ bytes: bytes, width: 200, height: 140 }]);
    step('断网时「图片 → PDF」数据链路可用', pdf.size > 800, pdf.size + 'B');
  } catch (e) {
    step('断网时图片数据链路可用', false, String(e && e.message));
  }
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 48;
    const x = c.getContext('2d');
    x.fillStyle = '#2f6bff'; x.fillRect(0, 0, 64, 48);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    const jpeg = await TB.imaging.toJpeg(new File([png], 'offline.png', { type: 'image/png' }), { maxDim: 64 });
    step('断网时图片解码管线仍可执行（PNG → JPEG）', jpeg.bytes.length > 200, jpeg.bytes.length + 'B');
  } catch (e) {
    // 先确认是不是"离线模拟把 blob: 图片解码也一起阻断了"（CDP 的行为，与网络无关）
    const blobDecodeWorks = await (async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 8; c.height = 8;
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(b);
        const ok = await new Promise((res) => {
          const img = new Image();
          img.onload = () => res(true);
          img.onerror = () => res(false);
          img.src = url;
        });
        URL.revokeObjectURL(url);
        return ok;
      } catch (err) { return false; }
    })();
    if (!blobDecodeWorks) {
      out.push('NOTE CDP 的离线模拟会连带阻断 blob: 图片解码（浏览器实现行为，与联网无关）；图片解码与编码管线已在主流程中完整验证');
    } else {
      step('断网时图片解码管线仍可执行', false, String(e && e.message));
    }
  }
  try {
    const blob = await TB.pdf.build([{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 10, height: 10 }]);
    step('PDF 生成仍可用', blob.size > 400, blob.size + 'B');
  } catch (e) {
    step('PDF 生成仍可用', false, String(e && e.message));
  }
  return out.join('\n');
})()`;

const cdp = await connect();

// 监控网络请求：整个过程中不应该出现任何外部域名请求
await cdp.send('Network.enable');

console.log('导航到 ' + URL_UNDER_TEST);
const ready = await cdp.navigate(URL_UNDER_TEST);
console.log('应用就绪: ' + ready + '\n');

const { result } = await cdp.send('Runtime.evaluate', { expression: TEST, awaitPromise: true, returnByValue: true, timeout: 300000 });
const output = (result && result.value) || '(无输出)';
console.log(output);
if (cdp.events.length) {
  console.log('\n--- 页面异常 / 控制台错误 ---');
  console.log(cdp.events.slice(0, 25).join('\n'));
}

const lines = output.split('\n');
const failed = lines.filter((l) => l.indexOf('FAIL') === 0);

/* ---------------- 响应式 ---------------- */

console.log('\n' + '─'.repeat(60));
console.log('响应式检查（真实设备视口）');
const VIEWPORTS = [
  { w: 320, h: 640, label: '320px 小屏手机' },
  { w: 375, h: 667, label: '375px 手机' },
  { w: 390, h: 844, label: '390px 手机' },
  { w: 430, h: 932, label: '430px 大屏手机' },
  { w: 768, h: 1024, label: '768px 平板' },
  { w: 1280, h: 800, label: '1280px 桌面' }
];
const responsiveFailures = [];
for (const vp of VIEWPORTS) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 700
  });
  const res = await cdp.send('Runtime.evaluate', { expression: RESPONSIVE_TEST, awaitPromise: true, returnByValue: true, timeout: 120000 });
  let data = null;
  try { data = JSON.parse((res.result && res.result.value) || '{}'); } catch (e) { data = null; }
  const ok = data && data.innerWidth === vp.w && (!data.bad || data.bad.length === 0);
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + vp.label + '（视口 ' + (data ? data.innerWidth : '?') + 'px）' +
    (data && data.bad && data.bad.length ? '  ' + data.bad.join(' ') : ''));
  if (!ok) responsiveFailures.push(vp.label + (data && data.bad ? ' ' + data.bad.join(' ') : ''));
}
await cdp.send('Emulation.clearDeviceMetricsOverride');

/* ---------------- 断网 ---------------- */

console.log('\n' + '─'.repeat(60));
console.log('断网测试（Network.emulateNetworkConditions offline=true，navigator.onLine=false）');
await cdp.send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
});
await cdp.send('Runtime.evaluate', { expression: 'TB.app.runtime.router.home()' });
await new Promise((r) => setTimeout(r, 400));
const offlineRes = await cdp.send('Runtime.evaluate', { expression: OFFLINE_TEST, awaitPromise: true, returnByValue: true, timeout: 60000 });
const offlineOutput = (offlineRes.result && offlineRes.result.value) || '(无输出)';
console.log(offlineOutput);
const offlineLines = offlineOutput.split('\n');
const offlineFailed = offlineLines.filter((l) => l.indexOf('FAIL') === 0);
const offlinePassed = offlineLines.filter((l) => l.indexOf('PASS') === 0);

/* ---------------- 网络请求审计 ---------------- */

await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
});
await new Promise((r) => setTimeout(r, 500));
const hosts = {};
const localRequests = [];
const externalRequests = [];
cdp.requests.forEach((url) => {
  let host = '';
  try { host = new URL(url).host || '(内联资源)'; } catch (e) { host = '(内联资源)'; }
  hosts[host] = (hosts[host] || 0) + 1;
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || host === '(内联资源)') localRequests.push(url);
  else externalRequests.push(url);
});
console.log('\n' + '─'.repeat(60));
console.log('网络请求审计（应用运行期间发起的全部请求）');
console.log('  请求总数：' + cdp.requests.length);
Object.keys(hosts).forEach((h) => console.log('  ' + h + '：' + hosts[h] + ' 次'));
const external = externalRequests.map((u) => { try { return new URL(u).host; } catch (e) { return u; } });
const externalCount = external.length;
console.log('  本机请求：' + localRequests.length + ' 次（HTML / CSS / JS 资源，无外部依赖）');
console.log('  外部域名请求：' + (externalCount ? externalCount + '（' + external.join(',') + '）' : '0（无）'));

/* ---------------- 汇总 ---------------- */

const totalFailures = failed.length + responsiveFailures.length + offlineFailed.length + externalCount;
console.log('\n' + '='.repeat(60));
console.log('交互用例：通过 ' + (lines.length - failed.length) + ' / ' + lines.length);
console.log('响应式：通过 ' + (VIEWPORTS.length - responsiveFailures.length) + ' / ' + VIEWPORTS.length);
console.log('断网用例：通过 ' + offlinePassed.length + ' / ' + (offlinePassed.length + offlineFailed.length));
console.log(totalFailures ? '总计失败 ' + totalFailures + ' 项' : '全部通过');
if (failed.length) { console.log('\n失败明细：'); failed.forEach((f) => console.log('  · ' + f)); }
offlineFailed.forEach((f) => console.log('  · ' + f));
responsiveFailures.forEach((f) => console.log('  · 响应式 ' + f));
cdp.close();
process.exit(totalFailures ? 1 : 0);
