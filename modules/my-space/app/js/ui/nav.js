/*!
 * 我的空间 · 底部悬浮毛玻璃导航
 * 重点：可滑动的毛玻璃选中块（不是瞬间变色），图标轻微缩放、文字淡入、弹性收尾
 * 性能：只有这块小区域使用 backdrop-filter；低端设备自动降级为半透明 + 阴影
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const ui = MS.ui;

  const TABS = [
    { id: 'home', label: '首页', icon: 'home' },
    { id: 'items', label: '物品', icon: 'box' },
    { id: 'search', label: '搜索', icon: 'search' }
  ];
  // 注：ETHAN Super App 整合后，「设置」由统一设置中心负责，不再出现在 Bottom Bar。
  // 设置页（MS.pages.settings）仍保留，供统一设置中心深链进入。

  function createNav(opts) {
    const o = opts || {};
    const tabs = o.tabs || TABS;
    let activeId = o.active || tabs[0].id;
    let lastPaintedId = null;
    let visible = true;
    let firstPaint = true;

    const glass = ui.h('div', { class: 'bottomnav__glass', 'aria-hidden': 'true' });
    const bar = ui.h('div', { class: 'bottomnav__bar' });
    bar.appendChild(glass);

    const buttons = tabs.map(function (tab) {
      const btn = ui.h('button', {
        class: 'navitem',
        type: 'button',
        dataset: { id: tab.id },
        'aria-label': tab.label,
        onClick: function () { select(tab.id); }
      }, [
        ui.h('span', { class: 'navitem__iconwrap' }, [ui.icon(tab.icon, { size: 21 })]),
        ui.h('span', { class: 'navitem__label', text: tab.label })
      ]);
      bar.appendChild(btn);
      return btn;
    });

    const el = ui.h('nav', { class: 'bottomnav', 'aria-label': '主导航' }, [bar]);

    function paint(animate) {
      const barRect = bar.getBoundingClientRect();
      buttons.forEach(function (btn) {
        const isActive = btn.dataset.id === activeId;
        btn.dataset.active = isActive ? 'true' : 'false';
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
      });
      const target = buttons.find(function (b) { return b.dataset.id === activeId; });
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width) return;
      const useAnim = !!animate && !firstPaint;
      // 玻璃块的滑动只使用 CSS 过渡（含轻微弹性收尾），保证与其它动画互不干扰
      glass.style.transition = useAnim
        ? 'transform ' + MS.anim.dur('nav') + 'ms cubic-bezier(0.3, 1.28, 0.6, 1), ' +
          'width ' + MS.anim.dur('nav') + 'ms cubic-bezier(0.3, 1.28, 0.6, 1), opacity 180ms ease'
        : 'opacity 220ms ease';
      glass.style.width = Math.round(rect.width) + 'px';
      glass.style.height = Math.round(rect.height) + 'px';
      glass.style.transform = 'translate3d(' + Math.round(rect.left - barRect.left) + 'px,' + Math.round(rect.top - barRect.top) + 'px,0)';
      if (firstPaint || rect.width) glass.style.opacity = '1';
      firstPaint = false;
      lastPaintedId = activeId;
    }

    function select(id, opts2) {
      const o2 = opts2 || {};
      if (activeId === id) {
        if (typeof o.onReselect === 'function') o.onReselect(id);
        return;
      }
      activeId = id;
      paint(true);
      if (typeof o.onSelect === 'function') o.onSelect(id);
    }

    function setActive(id, animate) {
      // 已对同一 id 完成过绘制时跳过：避免路由 syncChrome 的重复调用
      // 把 select() 刚设置的 transform 过渡覆盖成瞬时跳变（滑动动画失效的根因）
      if (activeId === id && lastPaintedId === id) return;
      activeId = id;
      paint(animate !== false);
    }

    function setVisible(next, animate) {
      const value = !!next;
      if (visible === value && el.dataset.ready === '1') return;
      visible = value;
      el.dataset.ready = '1';
      el.classList.toggle('bottomnav--hidden', !value);
      if (animate === false) {
        el.style.transition = 'none';
        void el.offsetHeight;
        el.style.transition = '';
      }
    }

    // 视口变化（旋转、键盘）后重新测量
    const remeasure = ui.debounce(function () { paint(false); }, 120);
    root.addEventListener('resize', remeasure);
    root.addEventListener('orientationchange', function () { setTimeout(function () { paint(false); }, 160); });
    if (root.visualViewport) root.visualViewport.addEventListener('resize', remeasure);

    return {
      el: el,
      select: select,
      setActive: setActive,
      setVisible: setVisible,
      getActive: function () { return activeId; },
      remeasure: function () { paint(false); },
      tabs: tabs
    };
  }

  MS.nav = { createNav: createNav, TABS: TABS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
