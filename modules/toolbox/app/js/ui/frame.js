/*!
 * 工具箱 · 页面骨架
 * 统一顶栏 / 滚动容器 / 底部操作区 / 工具卡片，保证 13 个工具视觉与交互一致。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const ui = TB.ui;

  /** 默认返回行为：顶栏箭头走 backArrow（直接返回，不受键盘影响） */
  function requestBack() {
    if (typeof TB.backArrow === 'function') return TB.backArrow();
    if (typeof TB.backRequest === 'function') return TB.backRequest();
    const runtime = TB.app && TB.app.runtime;
    if (runtime && runtime.router) return runtime.router.back();
    return null;
  }

  function topbar(opts) {
    const o = opts || {};
    const left = o.showBack === false ? null : ui.h('button', {
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
        class: 'topbar__icon-btn',
        type: 'button',
        'aria-label': a.label || '',
        onClick: a.onClick
      }, [ui.icon(a.icon, { size: 21 })]));
    });

    return ui.h('header', { class: 'topbar' + (o.large ? ' topbar--large' : '') }, [
      ui.h('div', { class: 'topbar__row' }, [left, titleWrap, right])
    ]);
  }

  /**
   * 页面框架
   * 底部操作区**默认可见**（宁可在没有内容时留一条空白，
   * 也绝不能出现"按钮其实在、但被 display:none 藏起来"这种致命情况）。
   * 没有底部内容的页面显式传 footer:false。
   * @returns {{el, topbar, body, footer, setTitle, setSubtitle}}
   */
  function frame(opts) {
    const o = opts || {};
    const el = ui.h('div', { class: 'page' + (o.className ? ' ' + o.className : '') });
    const header = o.title !== undefined ? topbar(o) : null;
    const body = ui.h('div', { class: 'page__body' + (o.pad === false ? ' page__body--flush' : '') });
    const footer = ui.h('div', { class: 'page__footer' + (o.footer === false ? ' page__footer--empty' : '') });
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

  function section(title, action) {
    return ui.h('div', { class: 'section' }, [
      ui.h('div', { class: 'section__title', text: title }),
      action ? ui.h('button', { class: 'section__action', type: 'button', text: action.label, onClick: action.onClick }) : null
    ]);
  }

  /** 首页工具卡片：整张卡片可点击 */
  function toolCard(tool, onClick) {
    return ui.h('button', {
      class: 'toolcard',
      type: 'button',
      dataset: { tool: tool.id },
      onClick: onClick
    }, [
      ui.h('div', { class: 'toolcard__emoji', text: tool.emoji }),
      ui.h('div', { class: 'toolcard__name', text: tool.name }),
      ui.h('div', { class: 'toolcard__desc', text: tool.desc })
    ]);
  }

  /** 新内容淡入 + 轻微上移 */
  function animateIn(el, opts) {
    const o = opts || {};
    return ui.anim.run(el, [
      { opacity: 0, transform: 'translateY(' + (o.distance === undefined ? 8 : o.distance) + 'px)' },
      { opacity: 1, transform: 'none' }
    ], { duration: ui.anim.dur('list'), delay: o.delay || 0 });
  }

  TB.frame = { topbar: topbar, frame: frame, section: section, toolCard: toolCard, requestBack: requestBack, animateIn: animateIn };
})(typeof globalThis !== 'undefined' ? globalThis : this);
