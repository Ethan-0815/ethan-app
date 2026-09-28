/*!
 * ETHAN Super App · 模块桥（toolbox）
 * 工具箱无设置、无 Bottom Bar；外壳只负责：主题同步 + 返回转发 + 就绪通知。
 */
(function (root) {
  'use strict';

  function tb() { return root.TB || null; }
  function keyboardVisible() {
    const t = tb();
    return !!(t && t.keyboard && typeof t.keyboard.visible === 'function' && t.keyboard.visible());
  }

  const api = {
    back: function () {
      const t = tb();
      if (!t || !t.app || !t.app.runtime || !t.app.runtime.router) return 'exit';
      if (keyboardVisible() && typeof t.keyboard.hide === 'function') { t.keyboard.hide(); return 'stay'; }
      const router = t.app.runtime.router;
      if (typeof router.depth === 'function' && router.depth() > 1) {
        if (typeof t.backRequest === 'function') t.backRequest();
        return 'stay';
      }
      return 'exit';
    },
    theme: function () { /* 主题由首绘内联脚本 + data-theme 处理；深链刷新时由外壳重写 storage */ },
    motion: function () { /* 工具箱无动画偏好持久化 */ },
    onShow: function () {},
    onHide: function () {}
  };

  root.__esaModule = api;

  /* ---- 根页面返回 → 回到超级 App 首页（接管模块自身的“再按一次退出”） ---- */
  function exitToShell() {
    try { root.parent.postMessage({ type: 'esa:exit-module', module: 'toolbox' }, '*'); } catch (e) { /* ignore */ }
  }
  function wrapBack() {
    const t = tb();
    if (!t || !t.app || !t.app.runtime || typeof t.backRequest !== 'function' || t.__esaWrapped) return false;
    t.__esaWrapped = true;
    const router = t.app.runtime.router;
    const atRoot = function () {
      return !keyboardVisible() && typeof router.depth === 'function' && router.depth() === 1;
    };
    const origRequest = t.backRequest;
    t.backRequest = function () {
      if (atRoot()) { exitToShell(); return 'exit'; }
      return origRequest();
    };
    if (typeof t.backArrow === 'function') {
      const origArrow = t.backArrow;
      t.backArrow = function () {
        if (atRoot()) { exitToShell(); return 'exit'; }
        return origArrow();
      };
    }
    return true;
  }
  (function pollWrap() { if (!wrapBack()) setTimeout(pollWrap, 120); })();

  root.addEventListener('message', function (event) {
    if (event.source !== root.parent) return;
    const data = event.data || {};
    if (data.type === 'esa:theme' && data.resolved) {
      document.documentElement.dataset.theme = data.resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', data.resolved === 'dark' ? '#15171b' : '#f5f6f8');
    }
  });

  function ready() {
    try { root.parent.postMessage({ type: 'esa:ready', module: 'toolbox' }, '*'); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'complete') setTimeout(ready, 0);
  else root.addEventListener('load', function () { setTimeout(ready, 0); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
