#!/usr/bin/env node
/* ETHAN Super App · E2E 冒烟测试（CDP 直连真实浏览器）
 * 用法：node tools/e2e.mjs [port=8923] [cdpPort=9335]
 * 前置：node tools/serve.mjs 8923 已在运行；本脚本自行启动/关闭 Edge headless。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_PORT = process.argv[2] || '8923';
const CDP_PORT = process.argv[3] || '9335';
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let passed = 0, failed = 0;
const notes = [];
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function note(s) { notes.push(s); console.log('  · ' + s); }

/* ---------- 极简 CDP 客户端 ---------- */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res2, rej2) => {
          const mid = ++id;
          pending.set(mid, { res2, rej2 });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      on(fn) { handlers.push(fn); },
      close() { try { ws.close(); } catch (e) {} }
    });
    ws.onerror = (e) => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej2(new Error(msg.error.message)); else p.res2(msg.result);
      } else if (msg.method) {
        handlers.forEach((fn) => fn(msg));
      }
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-e2e-'));
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server',
    '--headless=new', '--disable-gpu', '--window-size=390,844',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    // 等调试端口
    let target = null;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* retry */ }
    }
    if (!target) throw new Error('无法连接 Edge CDP');

    const cdp = await connect(target.webSocketDebuggerUrl);
    const externalRequests = [];
    const consoleErrors = [];
    cdp.on((msg) => {
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params.request.url;
        if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
          externalRequests.push(url);
        }
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails.text || 'exception');
      }
    });
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.text || ''));
      return r.result.value;
    };

    /* ================= 1. 首页 ================= */
    console.log('\n[1] 首页结构');
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(1600);
    const brand = await evalJs(`!!document.querySelector('.home__brand') && document.querySelector('.home__brand').textContent === 'ETHAN'`);
    ok(brand, '品牌 ETHAN 显示');
    const gear = await evalJs(`!!document.querySelector('.home__gear')`);
    ok(gear, '右上角设置齿轮存在');
    const cards = await evalJs(`document.querySelectorAll('.appcard').length`);
    ok(cards === 4, '四个核心 App 卡片（2×2）');
    const noBottomBar = await evalJs(`!document.querySelector('.bottomnav') && !document.querySelector('#home-screen .settings-nav')`);
    ok(noBottomBar, '首页没有 Bottom Bar');
    const timeTxt = await evalJs(`document.querySelector('.home__time .hh').textContent + ':' + document.querySelector('.home__time .mm').textContent`);
    const now = new Date();
    const expect = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    ok(timeTxt === expect, `时间为真实系统时间（${timeTxt}）`);
    const dateTxt = await evalJs(`document.querySelector('.home__date').textContent`);
    ok(/[A-Z]+ · [A-Z]{3} \d{2}/.test(dateTxt), `日期格式（${dateTxt}）`);

    /* ================= 2. 真实统计 ================= */
    console.log('\n[2] 首页动态数据');
    await sleep(600);
    const tbStat = await evalJs(`document.querySelectorAll('.appcard')[1].querySelector('.appcard__stat').textContent`);
    ok(tbStat.includes('13 个工具'), `工具箱卡片为真实工具数（${tbStat}）`);
    const msStat = await evalJs(`document.querySelectorAll('.appcard')[0].querySelector('.appcard__stat').textContent`);
    ok(/^\d+ 件物品$/.test(msStat), `我的空间卡片为真实物品数（${msStat}）`);
    const ethStat = await evalJs(`document.querySelectorAll('.appcard')[3].querySelector('.appcard__stat').textContent`);
    ok(ethStat === '已加密保护' || /^\d+ 条信息$/.test(ethStat), `ETHAN 卡片非敏感状态（${ethStat}）`);

    /* ================= 3. 设置中心 ================= */
    console.log('\n[3] 统一设置中心');
    await evalJs(`document.querySelector('.home__gear').click()`);
    await sleep(500);
    const settingsVisible = await evalJs(`document.getElementById('settings-screen').classList.contains('is-active')`);
    ok(settingsVisible, '齿轮 → 打开设置中心');
    const navItems = await evalJs(`Array.from(document.querySelectorAll('.settings-nav__item')).map(b => b.textContent.trim())`);
    ok(navItems.length === 4 && navItems[0].includes('通用') && navItems[1].includes('我的空间') && navItems[2].includes('旅行足迹') && navItems[3].includes('密码'),
      '设置 Bottom Bar：通用/我的空间/旅行足迹/ETHAN');
    const themeOptions = await evalJs(`document.querySelectorAll('.theme-seg__opt').length`);
    ok(themeOptions === 3, '外观三选一存在');
    const switchCount = await evalJs(`document.querySelectorAll('#settings-screen .esa-switch').length`);
    ok(switchCount === 3, '界面三项开关（动画/过渡/触觉）');

    // 主题切换同步
    await evalJs(`document.querySelectorAll('.theme-seg__opt')[1].click()`);
    await sleep(300);
    const dark = await evalJs(`document.documentElement.getAttribute('data-theme')`);
    ok(dark === 'dark', '切换深色立即生效');
    const stored = await evalJs(`localStorage.getItem('esa.theme')`);
    ok(stored === 'dark', '主题偏好已持久化');

    // 设置内 tab 切换不退出设置中心
    await evalJs(`document.querySelectorAll('.settings-nav__item')[3].click()`);
    await sleep(200);
    const stillSettings = await evalJs(`document.getElementById('settings-screen').classList.contains('is-active') && document.querySelector('[data-page="ethan"]').classList.contains('is-active')`);
    ok(stillSettings, '设置内切换到 ETHAN 页签不退出');
    await evalJs(`document.querySelectorAll('.settings-nav__item')[0].click()`);
    await sleep(200);

    /* ================= 4. 模块打开与返回 ================= */
    console.log('\n[4] 模块接入');
    await evalJs(`document.getElementById('settings-screen').querySelector('.settings__back').click()`);
    await sleep(400);
    await evalJs(`document.querySelectorAll('.appcard')[1].click()`); // 工具箱
    await sleep(2200);
    const tbReady = await evalJs(`window.ESA && ESA.modules.isReady('toolbox')`);
    ok(tbReady, '工具箱 iframe 加载并就绪');
    const tbHasNav = await evalJs(`(() => { const f = document.querySelector('.module-frame.is-active'); const d = f.contentDocument; return !d.querySelector('.bottomnav') && !!d.querySelector('.toolcard, .home-section, #screens'); })()`);
    ok(tbHasNav, '工具箱无 Bottom Bar（打开即用）');
    const tbTools = await evalJs(`(() => { const f = document.querySelector('.module-frame.is-active'); return f.contentWindow.TB.registry.count(); })()`);
    ok(tbTools === 13, `工具箱 13 个工具全部在（${tbTools}）`);

    // 模块内进入工具 → 返回 → 模块根 → 再返回 → 回首页
    await evalJs(`(() => { const f = document.querySelector('.module-frame.is-active'); const d = f.contentDocument; const btns = Array.from(d.querySelectorAll('button, .toolcard, .listrow')); const card = btns.find(b => (b.textContent || '').includes('计算器')); if (card) card.click(); return !!card; })()`);
    await sleep(500);
    const depthAfter = await evalJs(`(() => { const f = document.querySelector('.module-frame.is-active'); return f.contentWindow.TB.app.runtime.router.depth(); })()`);
    ok(depthAfter === 2, '工具箱内部页面可进入');
    const r1 = await evalJs(`window.ESA_back()`);
    ok(r1 === 'stay', '模块内返回 → stay');
    const r2 = await evalJs(`window.ESA_back()`);
    ok(r2 === 'stay', '模块根第一次返回 → 关闭模块回首页');
    await sleep(300);
    const backHome = await evalJs(`document.getElementById('home-screen').classList.contains('is-active') && !ESA.modules.active()`);
    ok(backHome, '已回到超级 App 首页');

    /* ================= 5. 主题同步进模块 ================= */
    console.log('\n[5] 主题同步');
    const tbTheme = await evalJs(`(() => { const f = document.querySelector('.module-frame'); return f.contentDocument.documentElement.getAttribute('data-theme'); })()`);
    ok(tbTheme === 'dark', '统一深色已同步进模块（toolbox data-theme=dark）');

    /* ================= 6. 其余三个模块逐个接入验证 ================= */
    console.log('\n[6] my-space / travel-footprint / ethan 接入');

    // 我的空间
    await evalJs(`ESA.app.openApp('my-space')`);
    await sleep(2600);
    ok(await evalJs(`ESA.modules.isReady('my-space')`), '我的空间 iframe 就绪');
    const msTabs = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return Array.from(d.querySelectorAll('.navitem')).map(b => b.getAttribute('aria-label')); })()`);
    ok(msTabs.length === 3 && !msTabs.includes('设置'), `我的空间 Bottom Bar 无设置（${msTabs.join('/')}）`);
    const msTheme = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return d.documentElement.getAttribute('data-theme'); })()`);
    ok(msTheme === 'dark', '统一深色同步进我的空间');
    const msBack = await evalJs(`window.ESA_back()`);
    ok(msBack === 'stay', '我的空间根返回 → 关闭模块');
    await sleep(300);

    // 深链：设置页
    await evalJs(`ESA.app.openApp('my-space', { page: 'settings' })`);
    await sleep(1200);
    const msSettings = await evalJs(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const id = w.MS.app.runtime.router.currentTabId ? w.MS.app.runtime.router.currentTabId() : ''; return id; })()`);
    ok(msSettings === 'settings', '深链 ?page=settings 直达我的空间设置');
    const msNoAppearance = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return !Array.from(d.querySelectorAll('.settingrow__label')).find(el => el.textContent === '外观'); })()`);
    ok(msNoAppearance, '我的空间设置页已无外观项（主题上收）');
    await evalJs(`window.ESA_back()`); await sleep(200);
    await evalJs(`window.ESA_back()`); await sleep(400);

    // 旅行足迹
    await evalJs(`ESA.app.openApp('travel-footprint')`);
    await sleep(3200);
    ok(await evalJs(`ESA.modules.isReady('travel-footprint')`), '旅行足迹 iframe 就绪');
    const tfTabs = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return Array.from(d.querySelectorAll('.glass-nav__tab, [class*=glass-nav] button')).length; })()`);
    ok(tfTabs === 4, `旅行足迹 Bottom Bar 4 tab`);
    const tfTheme = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return d.documentElement.getAttribute('data-theme'); })()`);
    ok(tfTheme === 'dark', '统一深色同步进旅行足迹');
    // 页面左上角返回键真实点击 → 回超级 App 首页
    const tfChip = await evalJs(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const b = w.document.querySelector('.esa-back-btn'); if (!b) return 'nobtn'; b.click(); return 'clicked'; })()`);
    await sleep(500);
    ok(tfChip === 'clicked' && await evalJs(`!ESA.modules.active()`), '旅行足迹左上角返回键 → 回到超级 App 首页');
    await evalJs(`ESA.app.openApp('travel-footprint')`);
    await sleep(2600);
    const tfBack = await evalJs(`window.ESA_back()`);
    ok(tfBack === 'stay', '旅行足迹根返回 → 关闭模块');
    await sleep(300);

    // ETHAN
    await evalJs(`ESA.app.openApp('ethan')`);
    await sleep(2600);
    ok(await evalJs(`ESA.modules.isReady('ethan')`), 'ETHAN iframe 就绪');
    const ethLocked = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return !d.getElementById('lock').hidden; })()`);
    ok(ethLocked, 'ETHAN 显示锁定屏（PIN 保护完好）');
    const ethFabHidden = await evalJs(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; const fab = w.document.getElementById('fab'); return !fab || fab.hidden || w.getComputedStyle(fab).display === 'none'; })()`);
    ok(ethFabHidden, 'ETHAN 锁定屏不显示新建 FAB（未解锁不可新建）');
    const ethTheme = await evalJs(`(() => { const d = document.querySelector('.module-frame.is-active').contentDocument; return d.documentElement.getAttribute('data-theme'); })()`);
    ok(ethTheme === 'dark', '统一深色同步进 ETHAN');
    const ethTabs = await evalJs(`(() => { const w = document.querySelector('.module-frame.is-active').contentWindow; return w.Ethan.App && w.document.querySelectorAll('#tabbar .tab').length; })()`);
    ok(ethTabs === 2 || ethTabs === 0, `ETHAN 底部导航不含设置（锁定态 tab=${ethTabs}）`);
    const ethBack = await evalJs(`window.ESA_back()`);
    ok(ethBack === 'exit' || ethBack === 'stay', 'ETHAN 锁定屏返回交给外壳');
    await evalJs(`if (window.__lastBack !== 'stay') {}`);
    await sleep(300);
    const ethClosed = await evalJs(`!ESA.modules.active()`);
    ok(ethClosed, 'ETHAN 返回后回到首页');

    /* ================= 7. 网络与控制台 ================= */
    /* ---- [6b] 导出 / 导入桥接回归（假原生桥验证调用序列与内容） ---- */
    console.log('\n[6b] 导出 / 导入桥接回归');

    // 我的空间：saveBlob → beginSave(name, mime) 分块
    await evalJs(`ESA.app.openApp('my-space')`);
    await sleep(2600);
    const msExp = await evalJs(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const calls = [];
      w.MySpaceNative = {
        beginSave: (name, mime) => { calls.push(['begin', name, mime]); return 'tok1'; },
        appendChunk: (t, b64) => { calls.push(['chunk', t, b64]); return ''; },
        endSave: (t) => { calls.push(['end', t]); return '/Download/ms.zip'; },
        abortSave: () => {}
      };
      const blob = new Blob(['hello-ms'], { type: 'application/zip' });
      const r = await w.MS.files.saveBlob(blob, 'ms-backup.zip');
      const b64 = calls.filter(c => c[0] === 'chunk').map(c => c[2]).join('');
      return JSON.stringify({ target: r.target, begin: calls[0], content: decodeURIComponent(escape(atob(b64))) });
    })()`);
    const msObj = JSON.parse(msExp);
    ok(msObj.begin[1] === 'ms-backup.zip' && msObj.content === 'hello-ms', '我的空间导出：原生分块桥参数与内容正确');

    // 旅行足迹：saveFile → beginSave(name, mime)（回归：不得把自造 token 当文件名）
    await evalJs(`window.ESA_back()`);
    await sleep(500);
    await evalJs(`ESA.app.openApp('travel-footprint')`);
    await sleep(2600);
    const tfExp = await evalJs(`(async () => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      const calls = [];
      w.TravelFootprintNative = {
        isNative: () => true,
        beginSave: (name, mime) => { calls.push(['begin', name, mime]); return 'tok2'; },
        appendChunk: (t, b64) => { calls.push(['chunk', t, b64]); return ''; },
        endSave: (t) => { calls.push(['end', t]); return '/Download/tf.zip'; }
      };
      const bytes = new TextEncoder().encode('hello-tf');
      const where = await w.TF.native.saveFile('tf-backup.zip', bytes, 'application/zip');
      const b64 = calls.filter(c => c[0] === 'chunk').map(c => c[2]).join('');
      return JSON.stringify({ where, begin: calls[0], content: decodeURIComponent(escape(atob(b64))) });
    })()`);
    const tfObj = JSON.parse(tfExp);
    ok(tfObj.begin[1] === 'tf-backup.zip' && tfObj.content === 'hello-tf', '旅行足迹导出：beginSave 签名与内容正确');

    // ETHAN：downloadBlob → 原生分块（锁定屏下也可用）
    await evalJs(`window.ESA_back()`);
    await sleep(500);
    await evalJs(`ESA.app.openApp('ethan')`);
    await sleep(2600);
    const ethExp = await evalJs(`(() => {
      const w = document.querySelector('.module-frame.is-active').contentWindow;
      return new Promise((resolve) => {
        const calls = [];
        w.TravelFootprintNative = {
          beginSave: (name, mime) => { calls.push(['begin', name, mime]); return 'tok3'; },
          appendChunk: (t, b64) => { calls.push(['chunk', t, b64]); return ''; },
          endSave: (t) => { calls.push(['end', t]); return '/Download/ethan.bak'; }
        };
        w.Ethan.Util.downloadBlob('ethan-backup.etbak', 'hello-ethan');
        setTimeout(() => {
          const chunks = calls.filter(c => c[0] === 'chunk').map(c => c[2]).join('');
          resolve(JSON.stringify({ begin: calls[0], content: decodeURIComponent(escape(atob(chunks))) }));
        }, 600);
      });
    })()`);
    const ethObj = JSON.parse(ethExp);
    ok(ethObj.begin[1] === 'ethan-backup.etbak' && ethObj.content === 'hello-ethan', 'ETHAN 加密备份导出：原生分块桥参数与内容正确');

    console.log('\n[6] 网络审计 / Console');
    ok(externalRequests.length === 0, `无外部网络请求（${externalRequests.length}）`);
    if (externalRequests.length) note('外部请求：' + externalRequests.slice(0, 3).join(', '));
    ok(consoleErrors.length === 0, `无 Console 错误（${consoleErrors.length}）`);
    if (consoleErrors.length) note('错误：' + consoleErrors.slice(0, 5).join(' | '));

    /* ================= 恢复主题 ================= */
    await evalJs(`localStorage.clear()`);
  } finally {
    try { edge.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n===== 冒烟结果：通过 ${passed} / 失败 ${failed} =====`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E 运行失败:', e.message); process.exit(2); });
