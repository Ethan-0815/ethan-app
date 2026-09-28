/*!
 * 我的空间 · 应用引导
 * 启动顺序：主题（避免闪屏）→ 数据库 → 仓储 → 导航 → 路由 → 返回键 → 键盘
 * 任何环节失败都给用户一句人话，不暴露技术异常。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const ui = MS.ui;

  const PREFS_KEY = 'my-space-prefs.v1';

  /* ---------------------------------------------------------------- 偏好设置 */

  function createPrefs() {
    const state = { theme: 'system', reducedMotion: null };
    try {
      const raw = root.localStorage && root.localStorage.getItem(PREFS_KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch (e) { /* 隐私模式下可能不可用，忽略 */ }

    function persist() {
      try {
        if (root.localStorage) root.localStorage.setItem(PREFS_KEY, JSON.stringify(state));
      } catch (e) { /* ignore */ }
    }

    function apply() {
      const dark = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolved = state.theme === 'dark' ? 'dark' : (state.theme === 'light' ? 'light' : (dark ? 'dark' : 'light'));
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePref = state.theme;
      MS.anim.setManualReduced(state.reducedMotion === null ? null : !!state.reducedMotion);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0f1113' : '#f7f8fa');
    }

    function setTheme(theme) {
      state.theme = theme === 'dark' || theme === 'light' ? theme : 'system';
      persist();
      apply();
    }

    function setReducedMotion(value) {
      state.reducedMotion = value === null ? null : !!value;
      persist();
      apply();
    }

    if (root.matchMedia) {
      try {
        root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          if (state.theme === 'system') apply();
        });
      } catch (e) { /* ignore */ }
    }

    return {
      get: function () { return Object.assign({}, state); },
      setTheme: setTheme,
      setReducedMotion: setReducedMotion,
      apply: apply,
      merge: function (saved) {
        if (!saved || typeof saved !== 'object') return;
        if (saved.theme) state.theme = saved.theme;
        if ('reducedMotion' in saved) state.reducedMotion = saved.reducedMotion;
        persist();
        apply();
      },
      snapshot: function () { return Object.assign({}, state); }
    };
  }

  /* ---------------------------------------------------------------- 性能档位与毛玻璃降级 */

  function detectPerf() {
    const nav = root.navigator || {};
    const cores = nav.hardwareConcurrency || 4;
    const mem = nav.deviceMemory || 4;
    let tier = 'high';
    if (cores <= 4 || mem <= 3) tier = 'mid';
    if (cores <= 2 || mem <= 1) tier = 'low';
    let supportsBlur = false;
    try {
      supportsBlur = !!(root.CSS && root.CSS.supports &&
        (root.CSS.supports('backdrop-filter', 'blur(8px)') || root.CSS.supports('-webkit-backdrop-filter', 'blur(8px)')));
    } catch (e) { supportsBlur = false; }
    const useBlur = supportsBlur && tier !== 'low';
    document.documentElement.dataset.perf = tier;
    document.documentElement.dataset.blur = useBlur ? 'on' : 'off';
    return { tier: tier, blur: useBlur };
  }

  /* ---------------------------------------------------------------- 致命错误页 */

  function fatal(message, detail) {
    const boot = document.getElementById('boot');
    if (boot) boot.parentNode.removeChild(boot);
    const host = document.getElementById('app') || document.body;
    ui.clear(host);
    host.appendChild(ui.h('div', { class: 'fatal fatal--full' }, [
      ui.icon('info', { size: 26 }),
      ui.h('div', { class: 'fatal__title', text: '「我的空间」暂时无法启动' }),
      ui.h('div', { class: 'fatal__desc', text: message }),
      detail ? ui.h('div', { class: 'fatal__detail', text: detail }) : null
    ]));
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    const prefs = createPrefs();
    prefs.apply();
    const perf = detectPerf();

    const container = document.getElementById('screens');
    const navMount = document.getElementById('nav-mount');

    const app = {
      prefs: prefs,
      perf: perf,
      useBlur: perf.blur
    };

    const adapter = MS.storage.createIdbAdapter();
    const repo = MS.createRepository(adapter);
    app.repo = repo;

    repo.init().then(function () {
      return adapter.meta.get('prefs');
    }).then(function (savedPrefs) {
      if (savedPrefs) prefs.merge(savedPrefs);
      startApp();
    }).catch(function (error) {
      console.warn('[my-space] init failed', error);
      fatal(
        MS.friendly(error),
        MS.files.isAndroidWebView()
          ? '如果问题持续出现，请尝试重新安装应用。'
          : '请通过本地服务器打开，或安装 Android 版本后再使用。'
      );
    });

    function startApp() {
      const nav = MS.nav.createNav({
        onSelect: function (id) { router.goTab(id); }
      });
      navMount.appendChild(nav.el);

      const router = MS.createRouter({
        container: container,
        nav: nav,
        app: app,
        pages: MS.pages
      });

      /* —— app 上的通用动作 —— */
      app.router = router;
      app.nav = nav;
      app.openItem = function (id) { router.go('detail', { id: id }); };
      app.editItem = function (id) { router.go('editor', { id: id }); };
      app.newItem = function () { router.go('editor', {}); };
      app.openTrash = function () { router.go('trash', {}); };
      app.openCategories = function () { router.go('categories', {}); };
      app.goTab = function (id, params) { router.goTab(id, params); };
      app.openSearch = function (query) {
        router.goTab('search', query ? { query: query } : {});
      };
      app.toast = ui.toast;
      // 暴露运行时对象，便于调试与自动化测试（也方便原生层读取状态）
      MS.app.runtime = app;

      router.start('home');
      nav.setActive('home', false);

      /* —— Super App 深链：?page=settings 直达设置页 —— */
      try {
        const qs = new URLSearchParams(root.location.search);
        const targetPage = qs.get('page');
        if (targetPage && targetPage !== 'home' && MS.pages[targetPage]) {
          router.goTab(targetPage);
        }
      } catch (e) { /* ignore */ }

      /* —— 返回键（Android 原生 & 浏览器）—— */
      const backHandler = MS.createBackHandler({
        router: router,
        onExit: function () {
          const bridge = MS.files.native();
          if (bridge && typeof bridge.exitApp === 'function') bridge.exitApp();
        }
      });
      MS.bridge = MS.bridge || {};
      MS.bridge.back = function () { return backHandler.handle(); };
      // 顶栏返回箭头与系统返回键共用同一条链路
      MS.backRequest = function () { return backHandler.handle(); };
      MS.bridge.onFilePicked = function (token, payload) {
        if (typeof MS.onNativeFilePicked === 'function') MS.onNativeFilePicked(token, payload);
      };

      /* —— 键盘 —— */
      MS.keyboard.init();
      MS.keyboard.bindInput(document.body);
      MS.keyboard.onChange(function (visible) {
        if (visible) nav.setVisible(false, false);
        else {
          const page = router.current();
          if (page) nav.setVisible(page.showNav !== false && page.tab >= 0, true);
        }
      });

      /* —— 偏好落库（供下次启动读取，与 localStorage 双保险）—— */
      function savePrefs() { adapter.meta.set('prefs', prefs.snapshot()); }
      const originalSetTheme = prefs.setTheme;
      prefs.setTheme = function (theme) { originalSetTheme(theme); savePrefs(); };
      const originalSetReduced = prefs.setReducedMotion;
      prefs.setReducedMotion = function (value) { originalSetReduced(value); savePrefs(); nav.remeasure(); };

      /* —— 移除启动页 —— */
      const bootEl = document.getElementById('boot');
      if (bootEl) {
        const a = ui.anim.run(bootEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fallback: false });
        const remove = function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); };
        if (a) a.onfinish = remove; else remove();
      }
      window.requestAnimationFrame(function () { nav.remeasure(); });
    }
  }

  MS.app = { boot: boot, createPrefs: createPrefs };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
