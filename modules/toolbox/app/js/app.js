/*!
 * 工具箱 · 应用引导
 * 启动顺序：能力检测（毛玻璃降级）→ 路由 → 返回键 → 移除启动页
 * 任何环节失败都给用户一句人话，不暴露技术异常。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const ui = TB.ui;

  /** 性能档位与毛玻璃降级：低端机改用实色，保证滑动流畅 */
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

  function fatal(message, detail) {
    const boot = document.getElementById('boot');
    if (boot) boot.parentNode.removeChild(boot);
    const host = document.getElementById('app') || document.body;
    ui.clear(host);
    host.appendChild(ui.h('div', { class: 'fatal fatal--full' }, [
      ui.icon('info', { size: 26 }),
      ui.h('div', { class: 'fatal__title', text: '「工具箱」暂时无法启动' }),
      ui.h('div', { class: 'fatal__desc', text: message }),
      detail ? ui.h('div', { class: 'fatal__detail', text: detail }) : null
    ]));
  }

  function boot() {
    const perf = detectPerf();
    const app = { perf: perf, useBlur: perf.blur };

    try {
      const container = document.getElementById('screens');
      if (!container) throw new Error('缺少 #screens 容器');

      const router = TB.createRouter({
        container: container,
        app: app,
        pages: TB.pages
      });
      app.router = router;
      app.openTool = function (id) { router.go(id, {}); };
      app.toast = ui.toast;
      TB.app.runtime = app;

      router.start('home');

      const backHandler = TB.createBackHandler({
        router: router,
        onExit: function () {
          const bridge = TB.files.native();
          if (bridge && typeof bridge.exitApp === 'function') bridge.exitApp();
        }
      });
      TB.bridge = TB.bridge || {};
      TB.bridge.back = function () { return backHandler.handle(); };
      TB.bridge.arrowBack = function () { return backHandler.arrow(); };
      // 系统返回键与浏览器返回：共用 handle（先收键盘）
      TB.backRequest = function () { return backHandler.handle(); };
      // 顶栏返回箭头：直接返回（跳过收键盘），确保"点了必定有反应"
      TB.backArrow = function () { return backHandler.arrow(); };

      const bootEl = document.getElementById('boot');
      if (bootEl) {
        const a = ui.anim.run(bootEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fallback: false });
        const remove = function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); };
        if (a) a.onfinish = remove; else remove();
      }
    } catch (error) {
      if (root.console) console.warn('[toolbox] boot failed', error);
      fatal(
        TB.friendly(error),
        TB.files.isAndroidWebView()
          ? '如果问题持续出现，请尝试重新安装应用。'
          : '请通过本地服务器打开（直接双击 HTML 文件时浏览器会限制部分功能）。'
      );
    }
  }

  /** 统一的异常兜底：把未捕获的错误转成一句提示，不弹技术堆栈 */
  function installGlobalHandlers() {
    root.addEventListener('unhandledrejection', function (event) {
      if (root.console) console.warn('[toolbox] unhandled rejection', event.reason);
      const reason = event.reason;
      if (reason && reason.code && TB.util.ERROR_MESSAGES[reason.code]) {
        ui.toast(TB.util.ERROR_MESSAGES[reason.code], { tone: 'danger' });
      }
      event.preventDefault();
    });
  }

  TB.app = { boot: boot };

  function ready() {
    installGlobalHandlers();
    boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})(typeof globalThis !== 'undefined' ? globalThis : this);
