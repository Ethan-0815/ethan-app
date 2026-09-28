/*!
 * 工具箱 · 页面栈路由
 * 结构：首页 → 工具页（任意层级可再推入，例如 UUID 的结果页）
 * - 没有底部导航栏；子页面统一由顶栏返回按钮 + 系统返回键处理
 * - 与浏览器 history 同步，因此 Android 返回键 / 手势返回天然可用
 * - 页面可通过 onBack() 拦截返回（例如"再按一次放弃处理中任务"）
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const ui = TB.ui;

  function createRouter(opts) {
    const o = opts || {};
    const container = o.container;
    const app = o.app;
    const pages = o.pages;              // { id: factory(app) → page }
    const stack = [];                   // [{ id, page, screen, params }]
    const cache = new Map();            // 仅缓存首页，工具页每次进入都是新实例
    let navigating = false;

    function makePage(id, params) {
      const factory = pages[id];
      if (!factory) throw new Error('unknown page: ' + id);
      const page = factory(app);
      page.id = id;
      if (!page.el) page.el = ui.h('div', { class: 'page' });
      page.el.classList.add('page');
      page._params = params || {};
      return page;
    }

    function screenFor(page) {
      return ui.h('div', { class: 'screen', dataset: { page: page.id } }, [page.el]);
    }

    function pushHistory() {
      try { history.pushState({ tb: stack.length }, ''); } catch (e) { /* ignore */ }
    }

    function enterPage(page, params) {
      if (typeof page.onEnter === 'function') {
        try { page.onEnter(params || {}); } catch (e) { pageError(page, e); }
      }
    }

    function leavePage(page) {
      if (typeof page.onLeave === 'function') {
        try { page.onLeave(); } catch (e) { /* ignore */ }
      }
    }

    function pageError(page, error) {
      const box = ui.h('div', { class: 'fatal' }, [
        ui.icon('info', { size: 22 }),
        ui.h('div', { class: 'fatal__title', text: '这个工具出了点问题' }),
        ui.h('div', { class: 'fatal__desc', text: TB.friendly(error) }),
        ui.h('button', {
          class: 'btn btn--soft btn--sm',
          type: 'button',
          text: '返回',
          onClick: function () { back(true); }
        })
      ]);
      ui.clear(page.el).appendChild(box);
      if (root.console) console.warn('[toolbox] page error', error);
    }

    function start(id) {
      const page = makePage(id, {});
      cache.set(id, page);
      const entry = { id: id, page: page, screen: screenFor(page), params: {} };
      stack.push(entry);
      container.appendChild(entry.screen);
      entry.screen.classList.add('screen--visible');
      enterPage(page, {});
      try { history.replaceState({ tb: stack.length }, ''); } catch (e) { /* ignore */ }
      pushHistory();      // 哨兵状态，避免连续返回直接离开页面
    }

    /** 推入一个子页面 */
    function go(id, params) {
      if (navigating) return;
      navigating = true;
      // 转场期间挂起页面内部动画：只保留一路转场动画，避免"最后卡一下"
      ui.anim.suspend();
      let dur = ui.anim.dur('page');
      try {
        const page = makePage(id, params);
        const screen = screenFor(page);
        const from = stack[stack.length - 1];
        stack.push({ id: id, page: page, screen: screen, params: params || {} });
        container.appendChild(screen);
        page.el.scrollTop = 0;
        enterPage(page, params || {});
        // 统一的"最近使用"记录点：所有工具页都从这里进入
        if (TB.recent && TB.registry.get(id)) TB.recent.touch(id);
        dur = transitionPush(from, screen);
        pushHistory();
      } finally {
        setTimeout(function () {
          ui.anim.resume();
          navigating = false;
        }, dur + 30);
      }
    }

    /** 返回上一级；返回 false 表示已在栈底 */
    function back(silent) {
      const top = stack[stack.length - 1];
      if (top && typeof top.page.onBack === 'function') {
        let handled = false;
        try { handled = !!top.page.onBack(); } catch (e) { handled = false; }
        if (handled) return true;
      }
      if (stack.length <= 1) return false;

      const entry = stack.pop();
      const under = stack[stack.length - 1];
      leavePage(entry.page);
      under.screen.classList.remove('screen--behind');
      // 返回后让下层页面有机会刷新自身（例如首页更新"最近使用"）
      if (typeof under.page.onReenter === 'function') {
        try { under.page.onReenter({ from: 'back' }); } catch (e) { /* ignore */ }
      }
      if (typeof entry.page.onDispose === 'function') {
        try { entry.page.onDispose(); } catch (e) { /* ignore */ }
      }
      if (silent) {
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
        return true;
      }
      // 下层立刻恢复可见并保持静止，只让上层滑出：只有一路动画在跑
      const dur = ui.anim.dur('page');
      ui.anim.suspend();
      const a = ui.anim.run(entry.screen, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(16px)' }
      ], { duration: dur, fill: 'forwards', force: true });
      const cleanup = function () {
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
        ui.anim.resume();
      };
      if (a) a.onfinish = cleanup; else cleanup();
      return true;
    }

    /**
     * 页面推入转场：只有新页面做动画，下层页面立刻静止隐藏。
     * 这样每一帧只合成一个图层，转场结束也不会因为"两路动画同时收尾"而卡顿。
     * @returns {number} 动画时长（ms）
     */
    function transitionPush(from, toScreen) {
      const dur = ui.anim.dur('page');
      toScreen.classList.add('screen--visible');
      if (from) from.screen.classList.add('screen--behind');
      const a = ui.anim.run(toScreen, [
        { opacity: 0, transform: 'translateX(16px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: dur, fill: 'none', force: true });
      return a ? dur : 0;
    }

    /** 回到首页（栈底），并可选地刷新首页内容 */
    function home(params) {
      while (stack.length > 1) {
        const entry = stack.pop();
        leavePage(entry.page);
        if (typeof entry.page.onDispose === 'function') {
          try { entry.page.onDispose(); } catch (e) { /* ignore */ }
        }
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
      }
      const rootPage = stack[0];
      if (rootPage) {
        rootPage.screen.classList.remove('screen--behind');
        if (typeof rootPage.page.onReenter === 'function') {
          try { rootPage.page.onReenter(params || {}); } catch (e) { /* ignore */ }
        }
      }
    }

    function current() {
      const top = stack[stack.length - 1];
      return top ? top.page : null;
    }

    function depth() { return stack.length; }

    function exitHint() { ui.toast('再按一次返回退出'); }

    function replaceTop(id, params) {
      const top = stack[stack.length - 1];
      if (!top || stack.length <= 1) { go(id, params); return; }
      const page = makePage(id, params);
      const screen = screenFor(page);
      screen.classList.add('screen--visible');
      leavePage(top.page);
      stack[stack.length - 1] = { id: id, page: page, screen: screen, params: params || {} };
      container.appendChild(screen);
      enterPage(page, params || {});
      if (top.screen && top.screen.parentNode) top.screen.parentNode.removeChild(top.screen);
      ui.anim.run(screen, [{ opacity: 0 }, { opacity: 1 }], { duration: ui.anim.dur('page') });
      pushHistory();
    }

    return {
      start: start,
      go: go,
      back: back,
      home: home,
      current: current,
      depth: depth,
      exitHint: exitHint,
      replaceTop: replaceTop,
      stack: stack
    };
  }

  /**
   * 桥接层：Android 原生返回键 / 浏览器返回 / 顶栏返回箭头
   * 顺序：先收键盘 → 页面内部拦截 → 出栈 → 栈底二次确认后退出
   */
  TB.createBackHandler = function (opts) {
    const o = opts || {};
    const router = o.router;
    let lastRootBack = 0;

    function handleRoot() {
      const now = Date.now();
      if (now - lastRootBack < 2000) {
        if (typeof o.onExit === 'function') o.onExit();
        return 'exit';
      }
      lastRootBack = now;
      router.exitHint();
      return 'handled';
    }

    function handle(opts) {
      const o = opts || {};
      // 系统返回键：先收键盘（符合 Android 习惯）；顶栏箭头则直接返回，避免"点了没反应"
      if (!o.skipKeyboard && TB.keyboard.visible()) {
        TB.keyboard.hide();
        return 'handled';
      }
      const top = router.current();
      if (top && typeof top.onBack === 'function') {
        let handled = false;
        try { handled = !!top.onBack(); } catch (e) { handled = false; }
        if (handled) return 'handled';
      }
      if (router.depth() > 1) {
        router.back();
        return 'handled';
      }
      return handleRoot();
    }

    if (root.history && typeof root.history.pushState === 'function') {
      root.addEventListener('popstate', function () {
        if (router.depth() > 1) {
          router.back(true);
          return;
        }
        const result = handle();
        if (result !== 'exit') {
          try { root.history.pushState({ tb: router.depth() }, ''); } catch (e) { /* ignore */ }
        }
      });
    }

    return {
      handle: handle,
      /** 顶栏返回箭头专用：不受输入法键盘影响，点了必定有反应 */
      arrow: function () { return handle({ skipKeyboard: true }); }
    };
  };

  TB.createRouter = createRouter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
