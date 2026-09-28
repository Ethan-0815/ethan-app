/*!
 * 我的空间 · 导航路由
 * - 严格的页面栈：编辑 → 详情 → 物品 → 首页
 * - 子页面（新增/编辑/详情/回收站/分类）隐藏底部导航，返回时导航自然恢复
 * - 与浏览器 history 同步，因此 Android 返回键 / 手势返回天然可用
 * - 未保存内容的页面可通过 onBack() / canLeave() 拦截
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const ui = MS.ui;

  function createRouter(opts) {
    const o = opts || {};
    const container = o.container;
    const nav = o.nav;
    const app = o.app;
    const pages = o.pages;            // { id: factory(app) → page }
    const stack = [];                 // [{ id, page, screen }]
    const tabCache = new Map();       // tabId → page 实例（切换 tab 不重建）
    let currentTabId = null;
    let navigating = false;

    function makePage(id, params) {
      const factory = pages[id];
      if (!factory) throw new Error('unknown page: ' + id);
      const page = factory(app);
      page.id = id;
      if (!page.el) page.el = ui.h('div', { class: 'page' });
      page.el.classList.add('page');
      return page;
    }

    function screenFor(page) {
      const screen = ui.h('div', { class: 'screen', dataset: { page: page.id } }, [page.el]);
      if (page.showFab) {
        screen.appendChild(ui.fab(page.fabLabel || '添加物品', function () {
          if (typeof page.onFab === 'function') page.onFab();
          else if (app && app.newItem) app.newItem();
        }, { fabClass: page.fabClass }));
      }
      return screen;
    }

    function record(entry) {
      stack.push(entry);
      return entry;
    }

    function pushHistory() {
      try { history.pushState({ ms: stack.length }, ''); } catch (e) { /* ignore */ }
    }

    function restoreScroll(page) {
      if (page && page.el && typeof page._scrollTop === 'number') page.el.scrollTop = page._scrollTop;
    }

    function saveScroll(page) {
      if (page && page.el) page._scrollTop = page.el.scrollTop;
    }

    /* ------------------------------------------------------------ 页面栈操作 */

    function start(tabId) {
      const page = getTabPage(tabId);
      currentTabId = tabId;
      const entry = record({ id: tabId, page: page, screen: screenFor(page) });
      container.appendChild(entry.screen);
      entry.screen.classList.add('screen--visible');
      enterPage(page, {}, false);
      syncChrome(false);
      try { history.replaceState({ ms: stack.length }, ''); } catch (e) { /* ignore */ }
      // 哨兵状态：防止浏览器/系统在栈底直接退出页面
      pushHistory();
    }

    function getTabPage(tabId) {
      if (tabCache.has(tabId)) return tabCache.get(tabId);
      const page = makePage(tabId, {});
      tabCache.set(tabId, page);
      return page;
    }

    function enterPage(page, params, animate) {
      if (typeof page.onEnter === 'function') {
        try { page.onEnter(params || {}); } catch (e) { pageError(page, e); }
      }
      restoreScroll(page);
    }

    function leavePage(page) {
      saveScroll(page);
      if (typeof page.onLeave === 'function') {
        try { page.onLeave(); } catch (e) { /* ignore */ }
      }
    }

    function pageError(page, error) {
      const box = ui.h('div', { class: 'fatal' }, [
        ui.icon('info', { size: 22 }),
        ui.h('div', { class: 'fatal__title', text: '这个页面出了点问题' }),
        ui.h('div', { class: 'fatal__desc', text: MS.friendly(error) }),
        ui.h('button', {
          class: 'btn btn--ghost btn--inline',
          text: '返回',
          onClick: function () { back(true); }
        })
      ]);
      ui.clear(page.el).appendChild(box);
      console.warn('[my-space] page error', error);
    }

    /** 推入一个子页面 */
    function go(id, params) {
      if (navigating) return;
      const page = makePage(id, params);
      const screen = screenFor(page);
      const from = stack[stack.length - 1];
      record({ id: id, page: page, screen: screen });
      container.appendChild(screen);
      page.el.scrollTop = 0;
      enterPage(page, params || {}, true);
      syncChrome(true);
      transitionPush(from, { page: page, screen: screen });
      pushHistory();
    }

    /** 替换栈顶（例如：保存后从编辑页直接进入详情页） */
    function replaceTop(id, params) {
      const top = stack[stack.length - 1];
      if (!top || top.page.tab >= 0) { go(id, params); return; }
      const page = makePage(id, params);
      const screen = screenFor(page);
      screen.classList.add('screen--visible');
      const fromScreen = top.screen;
      leavePage(top.page);
      stack[stack.length - 1] = { id: id, page: page, screen: screen };
      container.appendChild(screen);
      enterPage(page, params || {}, true);
      syncChrome(true);
      if (fromScreen && fromScreen.parentNode) fromScreen.parentNode.removeChild(fromScreen);
      ui.anim.run(screen, [{ opacity: 0, transform: 'scale(0.99)' }, { opacity: 1, transform: 'none' }], { duration: ui.anim.dur('page') });
      pushHistory();
    }

    /** 切换底部导航 Tab */
    function goTab(tabId, params, opts2) {
      const target = getTabPage(tabId);
      if (currentTabId === tabId && stack.length === 1) {
        // 重复点击当前 tab → 回到顶部
        if (target.el.scrollTop > 0) {
          target.el.scrollTo({ top: 0, behavior: ui.anim.prefersReduced() ? 'auto' : 'smooth' });
        }
        if (typeof target.onReselect === 'function') target.onReselect();
        return;
      }

      // 清空栈（Tab 切换不保留子页面）
      while (stack.length > 1) {
        const entry = stack.pop();
        leavePage(entry.page);
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
      }
      const from = stack[stack.length - 1];
      if (from) leavePage(from.page);
      const screen = screenFor(target);
      stack[0] = { id: tabId, page: target, screen: screen };
      currentTabId = tabId;
      container.appendChild(screen);
      screen.classList.add('screen--visible');
      enterPage(target, params || {}, true);
      syncChrome(true, opts2);
      // 主导航之间的切换保持"瞬时"：不做页面动画，立即完成
      // （底部导航自身的玻璃块滑动动画不受影响，照常播放）
      if (from && from.screen !== screen && from.screen.parentNode) {
        from.screen.parentNode.removeChild(from.screen);
      }
    }

    /** 返回上一级；返回 false 表示已经到栈底（由 app 决定是否退出） */
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
      restoreScroll(under.page);
      syncChrome(true);
      if (silent) {
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
        return true;
      }
      const dur = ui.anim.dur('page');
      ui.anim.run(entry.screen, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(18px)' }
      ], { duration: dur });
      ui.anim.run(under.screen, [
        { opacity: 0.45, transform: 'translateX(-10px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: dur });
      setTimeout(function () {
        if (entry.screen.parentNode) entry.screen.parentNode.removeChild(entry.screen);
      }, dur + 20);
      return true;
    }

    function transitionPush(from, to) {
      const dur = ui.anim.dur('page');
      to.screen.classList.add('screen--visible');
      if (from) {
        ui.anim.run(from.screen, [
          { opacity: 1, transform: 'none' },
          { opacity: 0.35, transform: 'translateX(-8px)' }
        ], { duration: dur });
        setTimeout(function () { from.screen.classList.add('screen--behind'); }, dur - 20);
      }
      ui.anim.run(to.screen, [
        { opacity: 0, transform: 'translateX(18px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: dur });
    }

    /** 同步底部导航（显示/隐藏 + 高亮） */
    function syncChrome(animate, opts2) {
      const top = stack[stack.length - 1];
      if (!top) return;
      const page = top.page;
      const showNav = page.showNav !== false && page.tab >= 0;
      if (nav) {
        nav.setVisible(showNav, animate);
        const tabId = page.tab >= 0 ? top.id : currentTabId;
        if (tabId) nav.setActive(tabId, animate && !(opts2 && opts2.noNavAnim));
      }
    }

    /* ------------------------------------------------------------ 数据变化 */

    function notifyChange(payload) {
      const top = stack[stack.length - 1];
      if (!top) return;
      const page = top.page;
      if (typeof page.onRepoChange === 'function') {
        try { page.onRepoChange(payload || {}); } catch (e) { console.warn('[my-space] onRepoChange error', e); }
      }
    }

    /** 数据被整体替换（导入 / 清空）后强制刷新所有页面 */
    function hardRefresh() {
      tabCache.forEach(function (page) {
        if (typeof page.onRepoChange === 'function') {
          try { page.onRepoChange({ type: 'hard' }); } catch (e) { /* ignore */ }
        }
      });
      const top = stack[stack.length - 1];
      if (top && typeof top.page.onReenter === 'function') {
        try { top.page.onReenter(); } catch (e) { /* ignore */ }
      }
    }

    /** 刷新当前页面（重新进入一次） */
    function refresh() {
      const top = stack[stack.length - 1];
      if (!top) return;
      if (typeof top.page.onLeave === 'function') { try { top.page.onLeave(); } catch (e) { /* ignore */ } }
      enterPage(top.page, top.page._params || {}, false);
    }

    function current() {
      const top = stack[stack.length - 1];
      return top ? top.page : null;
    }

    function depth() { return stack.length; }

    function exitHint() {
      ui.toast('再按一次返回退出');
    }

    return {
      start: start,
      go: go,
      goTab: goTab,
      replaceTop: replaceTop,
      back: back,
      notifyChange: notifyChange,
      hardRefresh: hardRefresh,
      refresh: refresh,
      current: current,
      depth: depth,
      exitHint: exitHint,
      stack: stack,
      currentTabId: function () { return currentTabId; }
    };
  }

  /**
   * 桥接层：Android 原生返回键 / 浏览器返回
   * 顺序：先收键盘 → 页面内部拦截（如关闭大图）→ 出栈 → 栈底由 app 决定
   */
  MS.createBackHandler = function (opts) {
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

    function handle() {
      if (MS.keyboard.visible()) {
        MS.keyboard.hide();
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
          router.back();
          return;
        }
        const result = handle();
        if (result !== 'exit') {
          // 停留在栈底：补一个哨兵状态，避免连续返回直接离开应用
          try { root.history.pushState({ ms: router.depth() }, ''); } catch (e) { /* ignore */ }
        }
      });
    }

    return { handle: handle };
  };

  MS.createRouter = createRouter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
