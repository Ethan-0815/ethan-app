/*!
 * ETHAN Super App · 模块桥（ethan）
 * 安全边界：本桥不接触任何明文条目、不读取 vault 内容、不持有密钥。
 * 只做：主题同步 / 返回转发 / 锁定状态查询。
 */
(function (root) {
  'use strict';

  function E() { return root.Ethan || null; }
  function locked() {
    const e = E();
    return !(e && e.Store && e.Store.isUnlocked && e.Store.isUnlocked());
  }

  const api = {
    back: function () {
      const e = E();
      if (!e || !e.App) return 'exit';
      // 锁定屏：返回交给外壳（回到超级 App 首页）
      var lockEl = document.getElementById('lock');
      if (lockEl && !lockEl.hidden) return 'exit';
      // 全屏面板 → 逐层关闭
      var panels = document.querySelectorAll('#panels .panel:not(.is-closing)');
      if (panels.length) {
        var btn = panels[panels.length - 1].querySelector('[data-act=back]');
        if (btn) { btn.click(); return 'stay'; }
      }
      // 底部弹层
      var masks = document.querySelectorAll('.sheet-mask');
      if (masks.length) {
        var last = masks[masks.length - 1];
        var closeBtn = last.querySelector('[data-act=close]');
        if (closeBtn) closeBtn.click();
        else if (last.parentNode) last.parentNode.removeChild(last);
        return 'stay';
      }
      // 搜索态 → 退出搜索
      if (e.App.search && e.App.search.active) { e.App.exitSearch(); return 'stay'; }
      // 非首页 tab → 回首页
      if (e.App.current && e.App.current !== 'home') { e.App.go('home'); return 'stay'; }
      return 'exit';
    },
    theme: function (pref) {
      const e = E();
      if (!e || !e.Store || !e.App) return;
      // ETHAN 的「跟随系统」叫 auto
      e.Store.setPrefs({ theme: pref === 'dark' || pref === 'light' ? pref : 'auto' });
      e.App.applyTheme();
    },
    motion: function () { /* ETHAN 无独立动画偏好 */ },
    requestSettings: function () {
      try { root.parent.postMessage({ type: 'esa:open-settings', module: 'ethan' }, '*'); } catch (e) { /* ignore */ }
    },
    onShow: function () {
      const e = E();
      if (e && e.App && typeof e.App.armAutoLock === 'function') e.App.armAutoLock();
    },
    onHide: function () { /* 保持原自动锁定策略，不额外加锁 */ },
    isLocked: locked
  };

  root.__esaModule = api;

  root.addEventListener('message', function (event) {
    if (event.source !== root.parent) return;
    const data = event.data || {};
    if (data.type === 'esa:theme' && data.pref) api.theme(data.pref);
  });

  function ready() {
    try { root.parent.postMessage({ type: 'esa:ready', module: 'ethan' }, '*'); } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'complete') setTimeout(ready, 0);
  else root.addEventListener('load', function () { setTimeout(ready, 0); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
