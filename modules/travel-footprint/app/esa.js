/*!
 * ETHAN Super App · 模块桥（travel-footprint）
 * 主题同步 / 返回转发 / 统一设置请求 / 深链 ?flow=settings
 */
(function (root) {
  'use strict';

  function tf() { return root.TF || null; }
  function ui() { const t = tf(); return (t && t.ui) || null; }
  function router() { const t = tf(); return (t && t.app && t.app.router) || null; }

  const api = {
    back: function () {
      const u = ui();
      const r = router();
      if (!u || !r) return 'exit';
      // 键盘（原生环境）
      try {
        if (root.TF.native && root.TF.native.keyboardVisible && root.TF.native.keyboardVisible()) {
          root.TF.native.hideKeyboard();
          return 'stay';
        }
      } catch (e) { /* ignore */ }
      // 最上层弹层（sheet / dialog / viewer）
      try {
        if (u.parts && u.parts.hasOverlay && u.parts.hasOverlay()) {
          u.parts.closeTopOverlay();
          return 'stay';
        }
      } catch (e) { /* ignore */ }
      // 页面栈
      if (typeof r.depth === 'function' && r.depth() > 1) { r.back(); return 'stay'; }
      return 'exit';
    },
    theme: function (pref) {
      const t = tf();
      if (t && t.theme && typeof t.theme.set === 'function') {
        t.theme.set(pref === 'dark' || pref === 'light' ? pref : 'system');
      }
    },
    motion: function () { /* 旅行足迹无独立动画偏好 */ },
    requestSettings: function () {
      try { root.parent.postMessage({ type: 'esa:open-settings', module: 'travel-footprint' }, '*'); } catch (e) { /* ignore */ }
    },
    onShow: function () {},
    onHide: function () {}
  };

  root.__esaModule = api;

  /* ---- 各 tab 页共用的左上角返回键（仅外壳内显示；根页面通知外壳关闭模块） ---- */
  try {
    root.TF.ui.esaBackChip = function () {
      let inShell = false;
      try { inShell = !!(root.parent && root.parent !== root); } catch (e) { inShell = false; }
      if (!inShell) return null;
      const b = document.createElement('button');
      b.className = 'esa-back-btn';
      b.type = 'button';
      b.setAttribute('aria-label', '返回主页');
      b.innerHTML = '<span class="esa-back-btn__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg></span>';
      b.addEventListener('click', function () {
        try {
          if (root.TF.ui.backHandler && typeof root.TF.ui.backHandler.backArrow === 'function') root.TF.ui.backHandler.backArrow();
        } catch (e) { /* ignore */ }
      });
      return b;
    };
  } catch (e) { /* TF.ui 未就绪时忽略 */ }

  /* ---- 根页面返回 → 回到超级 App 首页（接管模块自身的“退出确认”对话框） ---- */
  function exitToShell() {
    try { root.parent.postMessage({ type: 'esa:exit-module', module: 'travel-footprint' }, '*'); } catch (e) { /* ignore */ }
  }
  function wrapBack() {
    const u = ui();
    const r = router();
    if (!u || !u.backHandler || !r || u.backHandler.__esaWrapped) return false;
    u.backHandler.__esaWrapped = true;
    const bh = u.backHandler;
    const atRoot = function () {
      let kb = false;
      try { kb = !!(root.TF.native && root.TF.native.keyboardVisible && root.TF.native.keyboardVisible()); } catch (e) { kb = false; }
      let overlay = false;
      try { overlay = !!(u.parts && u.parts.hasOverlay && u.parts.hasOverlay()); } catch (e) { overlay = false; }
      return !kb && !overlay && typeof r.depth === 'function' && r.depth() === 1;
    };
    const origHandle = bh.handle.bind(bh);
    const origArrow = bh.backArrow.bind(bh);
    bh.handle = function (opts) {
      if (atRoot()) { exitToShell(); return 'exit'; }
      return origHandle(opts);
    };
    bh.backArrow = function () {
      if (atRoot()) { exitToShell(); return 'exit'; }
      return origArrow();
    };
    return true;
  }
  (function pollWrap() { if (!wrapBack()) setTimeout(pollWrap, 120); })();

  root.addEventListener('message', function (event) {
    if (event.source !== root.parent) return;
    const data = event.data || {};
    if (data.type === 'esa:theme' && data.pref) api.theme(data.pref);
  });

  /* 深链：?flow=settings 启动后自动打开设置 sheet（供统一设置中心调用） */
  function deepLink() {
    try {
      const flow = new URLSearchParams(root.location.search).get('flow');
      if (flow !== 'settings') return;
      let tries = 0;
      const timer = setInterval(function () {
        tries += 1;
        const u = ui();
        if (u && u.flows && typeof u.flows.openSettings === 'function' && root.TF.app && root.TF.app.repo) {
          clearInterval(timer);
          u.flows.openSettings();
        } else if (tries > 100) {
          clearInterval(timer);
        }
      }, 100);
    } catch (e) { /* ignore */ }
  }
  deepLink();

  function ready() {
    try { root.parent.postMessage({ type: 'esa:ready', module: 'travel-footprint' }, '*'); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'complete') setTimeout(ready, 0);
  else root.addEventListener('load', function () { setTimeout(ready, 0); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
