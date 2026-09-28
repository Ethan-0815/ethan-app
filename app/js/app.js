/* ESA · 超级 App 引导
 * 屏幕体系：首页（无 Bottom Bar）→ 统一设置（独立 Bottom Bar）→ 模块 iframe（各 App 自己的导航）
 * 返回链路：Android 壳 → ESA_back()；H5 浏览器 → history/popstate；两条路收敛到同一套逻辑。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});
  const U = ESA.util;

  /* ------------------------------------------------------------ 状态 */
  let home = null;
  let settings = null;
  let settingsOpen = false;
  let moduleReturn = 'home';          // 模块关闭后回到 'home' | 'settings'
  let lastRootBack = 0;
  let suppressPop = false;            // 内部 history.back() 时防止重复处理

  /* ------------------------------------------------------------ 屏幕 */
  function showScreen(name) {
    document.getElementById('home-screen').classList.toggle('is-active', name === 'home');
    document.getElementById('settings-screen').classList.toggle('is-active', name === 'settings');
  }

  /* ------------------------------------------------------------ 模块 */
  function openApp(id, params) {
    ESA.recents.touchApp(id);
    moduleReturn = settingsOpen ? 'settings' : 'home';
    ESA.modules.ensure(id, params || null);
    ESA.modules.show(id);
    try { root.history.pushState({ esa: 'module', id: id }, ''); } catch (e) { /* ignore */ }
  }

  function closeModule() {
    ESA.modules.hideActive();
    if (moduleReturn === 'settings' && settingsOpen) {
      showScreen('settings');
    } else {
      settingsOpen = false;
      showScreen('home');
      if (home) home.refreshStats();
    }
    moduleReturn = 'home';
    goBackHistory(); // 弹出打开模块时压入的 history 记录
  }

  /* ------------------------------------------------------------ 设置 */
  function openSettings(focusTab) {
    settingsOpen = true;
    ESA.modules.hideActive();
    showScreen('settings');
    if (focusTab && typeof settings.switchTab === 'function') settings.switchTab(focusTab);
    try { root.history.pushState({ esa: 'settings' }, ''); } catch (e) { /* ignore */ }
  }

  function closeSettings() {
    settingsOpen = false;
    showScreen('home');
    if (home) home.refreshStats();
    goBackHistory();
  }

  function goBackHistory() {
    suppressPop = true;
    try { root.history.back(); } catch (e) { suppressPop = false; }
    setTimeout(function () { suppressPop = false; }, 350);
  }

  /* ------------------------------------------------------------ 返回链路 */
  function back() {
    // 1) 模块打开 → 转发进模块
    if (ESA.modules.active()) {
      const r = ESA.modules.backActive();
      if (r === 'stay') return 'stay';
      closeModule();
      return 'stay';
    }
    // 2) 设置中心 → 内部 tab 先回「通用」，再关闭
    if (settingsOpen) {
      const r = settings.back();
      if (r === 'stay') return 'stay';
      closeSettings();
      return 'stay';
    }
    // 3) 首页根态：2 秒内二次返回才退出
    const now = Date.now();
    if (now - lastRootBack < 2000) return 'exit';
    lastRootBack = now;
    U.toast('再按一次返回退出');
    return 'stay';
  }

  // Android 壳入口
  root.ESA_back = back;

  // H5 浏览器返回：popstate 统一收口（模块/设置的 pushState 在打开时完成）
  root.addEventListener('popstate', function () {
    if (suppressPop) return;
    if (ESA.modules.active()) { ESA.modules.hideActive(); }
    if (settingsOpen) { settingsOpen = false; }
    showScreen('home');
    if (home) home.refreshStats();
  });

  /* ------------------------------------------------------------ 模块事件 */
  ESA.modules.onChange(function (evt) {
    if (evt.type === 'open-settings') {
      const tabMap = { 'my-space': 'my-space', 'travel-footprint': 'travel-footprint', 'ethan': 'ethan', 'toolbox': 'general' };
      openSettings(tabMap[evt.id] || 'general');
    } else if (evt.type === 'exit-module') {
      // 模块根页面返回 → 关闭模块（moduleReturn 决定回首页还是回设置）
      closeModule();
    }
  });

  /* ------------------------------------------------------------ 主题广播 */
  ESA.prefs.onChange(function () {
    ESA.modules.broadcast();
  });

  /* ------------------------------------------------------------ 启动 */
  function boot() {
    ESA.prefs.apply();

    home = ESA.home.create(document.getElementById('home-screen'), {
      openApp: openApp,
      openSettings: function () { openSettings('general'); }
    });
    settings = ESA.settings.create(document.getElementById('settings-screen'), {
      closeSettings: closeSettings,
      openApp: openApp
    });

    showScreen('home');

    // 主题跟随系统时的实时广播 + 首次同步
    ESA.modules.broadcast();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  ESA.app = {
    openApp: openApp,
    openSettings: openSettings,
    closeSettings: closeSettings,
    back: back
  };

  /** 统一数据管理导入完成后刷新首页卡片 */
  ESA.refreshHome = function () {
    if (home) home.refreshStats();
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
