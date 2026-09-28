/*!
 * ETHAN Super App · 模块桥（my-space）
 * 由超级 App 外壳注入的轻量适配层：
 *  - 外壳通过 postMessage 同步统一主题 / 动画偏好
 *  - 外壳通过 window.__esaModule.back() 转发系统返回键
 *  - 不改动模块任何业务逻辑
 */
(function (root) {
  'use strict';

  function ms() { return root.MS || null; }
  function runtime() { return (ms() && ms().app && ms().app.runtime) || null; }

  function keyboardVisible() {
    const m = ms();
    return !!(m && m.keyboard && typeof m.keyboard.visible === 'function' && m.keyboard.visible());
  }

  function hideKeyboard() {
    const m = ms();
    if (m && m.keyboard && typeof m.keyboard.hide === 'function') m.keyboard.hide();
  }

  const api = {
    /** 返回：'stay' = 模块内部已处理；'exit' = 已在模块根页面，外壳应关闭模块 */
    back: function () {
      const app = runtime();
      if (!app || !app.router) return 'exit';
      if (keyboardVisible()) { hideKeyboard(); return 'stay'; }
      if (app.router.depth() > 1) { root.MS.backRequest(); return 'stay'; }
      // 已在 tab 层：先回到首页 tab，再一次返回交给外壳
      if (app.router.currentTabId && app.router.currentTabId() !== 'home') {
        app.router.goTab('home');
        return 'stay';
      }
      return 'exit';
    },
    /** 统一主题：pref = light | dark | system */
    theme: function (pref) {
      const app = runtime();
      if (app && app.prefs && typeof app.prefs.setTheme === 'function') {
        app.prefs.setTheme(pref === 'dark' || pref === 'light' ? pref : 'system');
      }
    },
    /** 统一动画开关 */
    motion: function (animationsOn) {
      const app = runtime();
      if (app && app.prefs && typeof app.prefs.setReducedMotion === 'function') {
        app.prefs.setReducedMotion(animationsOn === false);
      }
    },
    onShow: function () { /* 预留 */ },
    onHide: function () { /* 预留 */ }
  };

  root.__esaModule = api;

  /* ---- 根页面返回 → 回到超级 App 首页（接管模块自身的“再按一次退出”） ---- */
  function exitToShell() {
    try { root.parent.postMessage({ type: 'esa:exit-module', module: 'my-space' }, '*'); } catch (e) { /* ignore */ }
  }
  function wrapBack() {
    const app = runtime();
    if (!app || !app.router || typeof root.MS.backRequest !== 'function' || root.MS.__esaWrapped) return false;
    root.MS.__esaWrapped = true;
    const orig = root.MS.backRequest;
    root.MS.backRequest = function () {
      const r = app.router;
      if (!keyboardVisible() && typeof r.depth === 'function' && r.depth() === 1) {
        const tabId = typeof r.currentTabId === 'function' ? r.currentTabId() : 'home';
        if (tabId !== 'home') { r.goTab('home'); return 'stay'; }
        exitToShell();
        return 'exit';
      }
      return orig();
    };
    return true;
  }
  (function pollWrap() { if (!wrapBack()) setTimeout(pollWrap, 120); })();

  root.addEventListener('message', function (event) {
    if (event.source !== root.parent) return;
    const data = event.data || {};
    if (data.type === 'esa:theme' && data.pref) api.theme(data.pref);
    if (data.type === 'esa:motion' && typeof data.animations === 'boolean') api.motion(data.animations);
  });

  // 就绪通知：外壳据此推迟转场，避免白屏
  function ready() {
    try { root.parent.postMessage({ type: 'esa:ready', module: 'my-space' }, '*'); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'complete') setTimeout(ready, 0);
  else root.addEventListener('load', function () { setTimeout(ready, 0); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
