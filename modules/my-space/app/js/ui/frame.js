/*!
 * 我的空间 · 页面骨架与列表动画
 * 统一 topbar / 滚动容器 / 底部操作区，保证所有页面视觉与交互一致。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const ui = MS.ui;

  /**
   * 默认返回行为：与系统返回键走同一条链路
   * （先收键盘 → 页面内部拦截 → 出栈），因此未保存提示、大图关闭等都照常生效
   */
  function requestBack() {
    if (typeof MS.backRequest === 'function') return MS.backRequest();
    const runtime = MS.app && MS.app.runtime;
    if (runtime && runtime.router) return runtime.router.back();
    return null;
  }

  /**
   * 顶栏
   * @param {{title:string, subtitle?:string, onBack?:function, showBack?:boolean, actions?:Array<{icon,label,onClick,primary?}>}} opts
   */
  function topbar(opts) {
    const o = opts || {};
    // ETHAN Super App：外壳内运行时，所有页面（含 tab 根页面）都在左上角提供返回键，
    // 根页面的返回由模块桥接管（回到超级 App 首页），保证四个模块视觉与行为一致。
    let inShell = false;
    try { inShell = !!(root.parent && root.parent !== root); } catch (e) { inShell = false; }
    const left = (!inShell && o.showBack === false) ? null : ui.h('button', {
      class: 'topbar__icon-btn topbar__icon-btn--back',
      type: 'button',
      'aria-label': '返回',
      onClick: function () {
        if (typeof o.onBack === 'function') o.onBack();
        else requestBack();
      }
    }, [ui.icon('back', { size: 23 })]);

    const titleWrap = ui.h('div', { class: 'topbar__titles' }, [
      ui.h('div', { class: 'topbar__title', text: o.title || '' }),
      o.subtitle ? ui.h('div', { class: 'topbar__subtitle', text: o.subtitle }) : null
    ]);

    const right = ui.h('div', { class: 'topbar__actions' });
    (o.actions || []).forEach(function (a) {
      right.appendChild(ui.h('button', {
        class: 'topbar__icon-btn' + (a.primary ? ' topbar__icon-btn--primary' : ''),
        type: 'button',
        'aria-label': a.label || '',
        onClick: a.onClick
      }, [ui.icon(a.icon, { size: 22 })]));
    });

    return ui.h('header', { class: 'topbar' + (o.large ? ' topbar--large' : '') }, [
      ui.h('div', { class: 'topbar__row' }, [left, titleWrap, right])
    ]);
  }

  /**
   * 页面框架
   * @returns {{el, topbar, body, footer, setTitle, setSubtitle}}
   */
  function frame(opts) {
    const o = opts || {};
    const el = ui.h('div', { class: 'page' + (o.className ? ' ' + o.className : '') });
    const header = o.title !== undefined ? topbar(o) : null;
    const body = ui.h('div', { class: 'page__body' + (o.pad === false ? ' page__body--flush' : '') });
    const footer = ui.h('div', { class: 'page__footer' + (o.footer ? '' : ' page__footer--empty') });
    if (header) el.appendChild(header);
    el.appendChild(body);
    el.appendChild(footer);
    return {
      el: el,
      topbar: header,
      body: body,
      footer: footer,
      setTitle: function (text) {
        const t = header && header.querySelector('.topbar__title');
        if (t) t.textContent = text;
      },
      setSubtitle: function (text) {
        const t = header && header.querySelector('.topbar__subtitle');
        if (t) t.textContent = text;
      }
    };
  }

  /** 区块标题 */
  function section(title, action) {
    return ui.h('div', { class: 'section' }, [
      ui.h('div', { class: 'section__title', text: title }),
      action ? ui.h('button', { class: 'section__action', type: 'button', text: action.label, onClick: action.onClick }) : null
    ]);
  }

  /** 列表行（设置页等） */
  function row(opts) {
    const o = opts || {};
    return ui.h('button', {
      class: 'listrow' + (o.tone ? ' listrow--' + o.tone : ''),
      type: 'button',
      onClick: o.onClick
    }, [
      o.icon ? ui.h('span', { class: 'listrow__icon' }, [ui.icon(o.icon, { size: 19 })]) : null,
      ui.h('span', { class: 'listrow__main' }, [
        ui.h('span', { class: 'listrow__label', text: o.label }),
        o.desc ? ui.h('span', { class: 'listrow__desc', text: o.desc }) : null
      ]),
      o.value ? ui.h('span', { class: 'listrow__value', text: o.value }) : null,
      o.chevron === false ? null : ui.h('span', { class: 'listrow__chevron' }, [ui.icon('chevron', { size: 17 })])
    ]);
  }

  /** 新卡片淡入 + 轻微上移 */
  function animateListAdd(el, opts) {
    const o = opts || {};
    return ui.anim.run(el, [
      { opacity: 0, transform: 'translateY(' + (o.distance || 10) + 'px)' },
      { opacity: 1, transform: 'none' }
    ], { duration: ui.anim.dur('list'), delay: o.delay || 0 });
  }

  /** 卡片轻微缩小 + 淡出，随后交由回调收拢列表 */
  function animateListRemove(el, done) {
    const a = ui.anim.run(el, [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(0.97)' }
    ], { duration: ui.anim.dur('list') });
    const finish = function () { if (typeof done === 'function') done(); };
    if (a) a.onfinish = finish; else finish();
  }

  /** 列表交错入场（最多交错 8 项，避免大量数据时拖沓） */
  function stagger(children) {
    const list = Array.prototype.slice.call(children || []);
    list.forEach(function (child, i) {
      animateListAdd(child, { delay: Math.min(i, 8) * 22 });
    });
  }

  MS.frame = { topbar: topbar, frame: frame, section: section, row: row };
  MS.ui.topbar = topbar;
  MS.ui.frame = frame;
  MS.ui.section = section;
  MS.ui.row = row;
  MS.ui.animateListAdd = animateListAdd;
  MS.ui.animateListRemove = animateListRemove;
  MS.ui.stagger = stagger;
})(typeof globalThis !== 'undefined' ? globalThis : this);
