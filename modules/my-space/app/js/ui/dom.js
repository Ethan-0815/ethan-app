/*!
 * 我的空间 · UI 基础设施
 * DOM 构建、图标、空状态、Toast、确认框、底部面板、对象 URL 池、动画时长
 * 所有文本一律通过 textContent 输出，不使用 innerHTML 拼接用户数据。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const M = MS.models;

  /* ---------------------------------------------------------------- 元素构建 */

  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) {
      for (const key in props) {
        const value = props[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class' || key === 'className') el.className = value;
        else if (key === 'text') el.textContent = String(value);
        else if (key === 'html') el.innerHTML = value;                 // 仅用于内置图标
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'value') el.value = value;
        else if (key === 'checked' || key === 'disabled' || key === 'readOnly') el[key] = !!value;
        else el.setAttribute(key, String(value));
      }
    }
    append(el, children);
    return el;
  }

  function append(parent, children) {
    if (children === null || children === undefined || children === false) return parent;
    if (Array.isArray(children)) {
      children.forEach(function (child) { append(parent, child); });
      return parent;
    }
    if (children instanceof Node) { parent.appendChild(children); return parent; }
    parent.appendChild(document.createTextNode(String(children)));
    return parent;
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function frag(children) {
    const f = document.createDocumentFragment();
    append(f, children);
    return f;
  }

  function on(el, event, handler, opts) {
    el.addEventListener(event, handler, opts);
    return function () { el.removeEventListener(event, handler, opts); };
  }

  /* ---------------------------------------------------------------- 图标（自绘 SVG，24×24 线性风格） */

  const ICONS = {
    home: 'M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z M9.5 20.5v-6h5v6',
    box: 'M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z M4 8.2 12 12.4l8-4.2 M12 12.4V20',
    search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.8 15.8 20 20',
    settings: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z M19.2 12c0 .5-.05 1-.14 1.47l1.7 1.28-1.7 2.94-2-.82c-.75.6-1.6 1.06-2.53 1.34L14.2 20.5H9.8l-.33-2.29a7.3 7.3 0 0 1-2.53-1.34l-2 .82-1.7-2.94 1.7-1.28a7.5 7.5 0 0 1 0-2.94L3.24 9.25l1.7-2.94 2 .82c.75-.6 1.6-1.06 2.53-1.34L9.8 3.5h4.4l.33 2.29c.93.28 1.78.74 2.53 1.34l2-.82 1.7 2.94-1.7 1.28c.09.47.14.96.14 1.47z',
    plus: 'M12 5v14 M5 12h14',
    back: 'M14.5 5.5 8 12l6.5 6.5',
    close: 'M6 6l12 12 M18 6 6 18',
    camera: 'M4 8.5h3l1.4-2h7.2l1.4 2h3a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17v-7A1.5 1.5 0 0 1 4 8.5z M12 16.8a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z',
    gallery: 'M4 5.5h16A1.5 1.5 0 0 1 21.5 7v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z M2.9 15.4 8 11l4.2 3.6L15.6 12l5.5 4.6 M9.2 9.4a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z',
    trash: 'M5 7.5h14 M9.5 7.5V5.6A1.1 1.1 0 0 1 10.6 4.5h2.8a1.1 1.1 0 0 1 1.1 1.1v1.9 M7 7.5l.9 11a1.4 1.4 0 0 0 1.4 1.3h5.4a1.4 1.4 0 0 0 1.4-1.3l.9-11 M10.4 11v5.4 M13.6 11v5.4',
    restore: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5 M4.5 4.5V10H10',
    edit: 'M4.5 19.5h4L19 9a1.8 1.8 0 0 0 0-2.5l-1.5-1.5a1.8 1.8 0 0 0-2.5 0L4.5 15.5z M14 6.5 17.5 10',
    check: 'M5 12.8 9.4 17 19 7',
    chevron: 'M9.5 5.5 16 12l-6.5 6.5',
    chevronDown: 'M5.5 9.5 12 16l6.5-6.5',
    tag: 'M4.5 11.2V5.5A1 1 0 0 1 5.5 4.5h5.7a1 1 0 0 1 .7.3l7.3 7.3a1 1 0 0 1 0 1.4l-5.7 5.7a1 1 0 0 1-1.4 0L4.8 11.9a1 1 0 0 1-.3-.7z M8.2 8.2h.01',
    folder: 'M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.3l1.7 2h8.6a1.7 1.7 0 0 1 1.7 1.7v8.1a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z',
    info: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 11v5.2 M12 7.8h.01',
    export: 'M12 4.5v10 M8.2 7.6 12 4l3.8 3.6 M5 14.5v3.9a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6v-3.9',
    import: 'M12 15V5 M8.2 11.4 12 15l3.8-3.6 M5 15.5v2.9A1.6 1.6 0 0 0 6.6 20h10.8a1.6 1.6 0 0 0 1.6-1.6v-2.9',
    more: 'M6.2 12h.01 M12 12h.01 M17.8 12h.01',
    sort: 'M5.5 8h13 M5.5 12h9 M5.5 16h5',
    filter: 'M4.5 6.5h15 M7.5 12h9 M10.5 17.5h3',
    sun: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 3v1.8 M12 19.2V21 M3 12h1.8 M19.2 12H21 M5.6 5.6l1.3 1.3 M17.1 17.1l1.3 1.3 M18.4 5.6l-1.3 1.3 M6.9 17.1l-1.3 1.3',
    moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
    auto: 'M12 3.5v2 M12 18.5v2 M4.5 12h2 M17.5 12h2 M6.8 6.8l1.4 1.4 M15.8 15.8l1.4 1.4 M17.2 6.8l-1.4 1.4 M8.2 15.8l-1.4 1.4 M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
    spark: 'M12 4l1.7 4.6L18 10.3l-4.3 1.7L12 16.6l-1.7-4.6L6 10.3l4.3-1.7z',
    calendar: 'M4.5 8.5h15 M6.5 5.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z M8.5 4v3 M15.5 4v3',
    price: 'M12 4.5v15 M15.6 7.6c0-1.4-1.6-2.1-3.6-2.1s-3.6.7-3.6 2.1c0 3.6 7.4 1.6 7.4 5.2 0 1.4-1.7 2.1-3.8 2.1s-3.8-.7-3.8-2.1'
  };

  function icon(name, opts) {
    const o = opts || {};
    const size = o.size || 20;
    const path = ICONS[name] || ICONS.box;
    const span = document.createElement('span');
    span.className = 'icon' + (o.class ? ' ' + o.class : '');
    span.style.width = size + 'px';
    span.style.height = size + 'px';
    span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
      'stroke="currentColor" stroke-width="' + (o.weight || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' + path + '"/></svg>';
    return span;
  }

  /* ---------------------------------------------------------------- 动画时长 */
  /* 规范：普通页面 200~350ms；小交互 150~250ms；复杂页面 300~450ms */

  const anim = {
    _manual: null,    // 用户手动选择：true 精简 / false 完整 / null 跟随系统
    setManualReduced: function (value) { anim._manual = value; },
    getting: function () { return anim._manual; },
    prefersReduced: function () {
      if (anim._manual !== null) return !!anim._manual;
      try {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { return false; }
    },
    dur: function (kind) {
      const reduced = anim.prefersReduced();
      switch (kind) {
        case 'small': return reduced ? 90 : 200;
        case 'complex': return reduced ? 140 : 380;
        case 'nav': return reduced ? 0 : 320;
        case 'list': return reduced ? 90 : 260;
        case 'page':
        default: return reduced ? 120 : 280;
      }
    },
    /** Web Animations API 包装；减少动画时自动退化为极短淡入 */
    run: function (el, keyframes, options) {
      const o = options || {};
      const opts = {
        duration: o.duration === undefined ? anim.dur('page') : o.duration,
        easing: o.easing || 'cubic-bezier(0.22, 1, 0.36, 1)',
        delay: o.delay || 0,
        fill: o.fill || 'both'
      };
      let frames = keyframes;
      if (anim.prefersReduced() && o.fallback !== false) {
        frames = [{ opacity: 0 }, { opacity: 1 }];
        opts.duration = Math.min(opts.duration, 120);
        opts.easing = 'linear';
      }
      // 只取消本模块自己创建、且仍在同一元素上运行的动画，避免与 CSS 过渡互相干扰
      if (el._msAnims && el._msAnims.length) {
        el._msAnims.forEach(function (a) { try { a.cancel(); } catch (e) { /* ignore */ } });
      }
      try {
        const a = el.animate(frames, opts);
        el._msAnims = [a];
        a.onfinish = function () {
          if (el._msAnims && el._msAnims[0] === a) el._msAnims = [];
        };
        return a;
      } catch (e) {
        return null;
      }
    }
  };

  /* ---------------------------------------------------------------- 对象 URL 池 */

  function urlPool() {
    const urls = new Set();
    let closed = false;
    return {
      url: function (blob) {
        if (!blob || closed) return '';
        const u = URL.createObjectURL(blob);
        urls.add(u);
        return u;
      },
      release: function () {
        closed = true;
        urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
        urls.clear();
      },
      size: function () { return urls.size; },
      isClosed: function () { return closed; }
    };
  }

  /** 页面级对象 URL 池：每次重绘换一个池并释放旧池，避免内存持续增长 */
  function poolBox() {
    let current = urlPool();
    return {
      get: function () { return current; },
      reset: function () {
        const old = current;
        current = urlPool();
        old.release();
        return current;
      },
      release: function () { current.release(); }
    };
  }

  /** 悬浮新增按钮 */
  function fab(label, onClick, opts) {
    const o = opts || {};
    const el = h('button', {
      class: 'fab' + (o.extended ? ' fab--extended' : ''),
      type: 'button',
      'aria-label': label || '新增',
      onClick: onClick
    }, [icon('plus', { size: 24, weight: 1.9 })]);
    return el;
  }

  /* ---------------------------------------------------------------- 弹层宿主 */

  function layerRoot() {
    let el = document.getElementById('layer-root');
    if (!el) {
      el = h('div', { id: 'layer-root', class: 'layer-root' });
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, opts) {
    const o = opts || {};
    const rootEl = layerRoot();
    const el = h('div', { class: 'toast' + (o.tone ? ' toast--' + o.tone : '') }, [
      o.icon ? icon(o.icon, { size: 18 }) : null,
      h('span', { class: 'toast__text', text: message })
    ]);
    rootEl.appendChild(el);
    anim.run(el, [{ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
    const life = o.duration || 2200;
    setTimeout(function () {
      const a = anim.run(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration: anim.dur('small') });
      const finish = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (a) a.onfinish = finish; else finish();
    }, life);
    return el;
  }

  /** 确认对话框 */
  function confirmDialog(opts) {
    const o = opts || {};
    return new Promise(function (resolve) {
      const rootEl = layerRoot();
      let done = false;
      const finish = function (value) {
        if (done) return;
        done = true;
        const a = anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: anim.dur('small') });
        const remove = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        if (a) a.onfinish = remove; else remove();
        resolve(value);
      };
      const card = h('div', { class: 'dialog' }, [
        h('div', { class: 'dialog__title', text: o.title || '确认操作' }),
        o.message ? h('div', { class: 'dialog__message', text: o.message }) : null,
        h('div', { class: 'dialog__actions' }, [
          h('button', { class: 'btn btn--ghost', text: o.cancelText || '取消', onClick: function () { finish(false); } }),
          h('button', {
            class: 'btn ' + (o.danger ? 'btn--danger' : 'btn--primary'),
            text: o.confirmText || '确定',
            onClick: function () { finish(true); }
          })
        ])
      ]);
      const backdrop = h('div', {
        class: 'overlay__backdrop',
        onClick: function () { finish(false); }     // 点击空白区域 = 取消
      });
      const overlay = h('div', { class: 'overlay' }, [backdrop, card]);
      rootEl.appendChild(overlay);
      anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small'), fallback: false });
      anim.run(card, [{ opacity: 0, transform: 'scale(0.94) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
      const primary = card.querySelector('.btn--primary, .btn--danger');
      if (primary) primary.focus();
    });
  }

  /**
   * 底部面板
   * @param {{title?:string, content?:Node|string, actions?:Array, onClose?:function, tall?:boolean}} opts
   */
  function sheet(opts) {
    const o = opts || {};
    const rootEl = layerRoot();
    let closed = false;

    const panel = h('div', { class: 'sheet' + (o.tall ? ' sheet--tall' : '') });
    if (o.title) panel.appendChild(h('div', { class: 'sheet__title', text: o.title }));
    if (o.content) panel.appendChild(h('div', { class: 'sheet__content' }, o.content));
    if (o.actions && o.actions.length) {
      const list = h('div', { class: 'sheet__actions' });
      o.actions.forEach(function (action) {
        list.appendChild(h('button', {
          class: 'sheetrow' + (action.tone ? ' sheetrow--' + action.tone : ''),
          onClick: function () {
            close();
            if (typeof action.onClick === 'function') action.onClick();
          }
        }, [
          action.icon ? icon(action.icon, { size: 20, class: 'sheetrow__icon' }) : null,
          h('span', { class: 'sheetrow__label', text: action.label }),
          action.desc ? h('span', { class: 'sheetrow__desc', text: action.desc }) : null
        ]));
      });
      panel.appendChild(list);
    }
    panel.appendChild(h('button', { class: 'sheet__cancel', text: o.cancelText || '取消', onClick: function () { close(); } }));

    const backdrop = h('div', {
      class: 'overlay__backdrop',
      onClick: function () { close(); }             // 点击空白区域 = 关闭（返回上一级）
    });
    const overlay = h('div', { class: 'overlay overlay--bottom' }, [backdrop, panel]);

    function close() {
      if (closed) return;
      closed = true;
      const a1 = anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: anim.dur('small'), fallback: false });
      anim.run(panel, [{ transform: 'none' }, { transform: 'translateY(18px)' }], { duration: anim.dur('small') });
      const remove = function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (typeof o.onClose === 'function') o.onClose();
      };
      if (a1) a1.onfinish = remove; else remove();
    }

    rootEl.appendChild(overlay);
    anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small'), fallback: false });
    anim.run(panel, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: anim.dur('page') });
    return { close: close, panel: panel, overlay: overlay };
  }

  /** 输入框面板（新建/重命名分类、标签） */
  function promptDialog(opts) {
    const o = opts || {};
    return new Promise(function (resolve) {
      let settled = false;
      const input = h('input', {
        class: 'input',
        type: 'text',
        value: o.value || '',
        placeholder: o.placeholder || '',
        maxlength: o.maxlength || 40
      });
      const error = h('div', { class: 'field__error' });
      const submit = function () {
        const value = input.value.trim();
        if (!value) {
          error.textContent = o.requiredMessage || '请填写内容';
          anim.run(error, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small') });
          input.focus();
          return;
        }
        settled = true;
        handle.close();
        resolve(value);
      };
      const body = h('div', { class: 'prompt' }, [
        o.label ? h('div', { class: 'field__label', text: o.label }) : null,
        input,
        error
      ]);
      const handle = sheet({
        title: o.title || '输入内容',
        content: body,
        actions: [{ label: o.confirmText || '确定', icon: 'check', onClick: submit }],
        onClose: function () { if (!settled) resolve(null); }
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      setTimeout(function () { input.focus(); }, anim.dur('small'));
    });
  }

  /** 进度提示（导入 / 导出等较长操作） */
  function progress(opts) {
    const o = opts || {};
    const title = h('div', { class: 'progress__title', text: o.title || '处理中' });
    const text = h('div', { class: 'progress__text', text: o.text || '' });
    const fill = h('div', { class: 'progress__fill' });
    const bar = h('div', { class: 'progress__bar' }, [fill]);
    const panel = h('div', { class: 'progress' }, [
      h('div', { class: 'progress__spinner' }),
      title, text, bar
    ]);
    const overlay = h('div', { class: 'overlay overlay--center' }, [
      h('div', { class: 'overlay__backdrop' }),
      panel
    ]);
    layerRoot().appendChild(overlay);
    anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small'), fallback: false });
    anim.run(panel, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
    return {
      set: function (done, total, phase) {
        if (typeof done === 'string') { text.textContent = done; return; }
        const ratio = total ? Math.min(1, done / total) : 0;
        fill.style.width = Math.round(ratio * 100) + '%';
        if (phase) text.textContent = phase + ' ' + done + ' / ' + total;
      },
      setText: function (t) { text.textContent = t; },
      close: function () {
        const a = anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: anim.dur('small'), fallback: false });
        const done = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        if (a) a.onfinish = done; else done();
      }
    };
  }

  /* ---------------------------------------------------------------- 空状态 */

  function emptyState(opts) {
    const o = opts || {};
    return h('div', { class: 'empty' }, [
      h('div', { class: 'empty__badge' }, o.icon ? icon(o.icon, { size: 26, weight: 1.5 }) : h('span', { text: o.emoji || '📦' })),
      h('div', { class: 'empty__title', text: o.title || '暂无内容' }),
      o.desc ? h('div', { class: 'empty__desc', text: o.desc }) : null,
      o.actionLabel ? h('button', {
        class: 'btn btn--primary btn--inline',
        onClick: o.onAction
      }, [icon('plus', { size: 18 }), h('span', { text: o.actionLabel })]) : null
    ]);
  }

  function loadingState(text) {
    return h('div', { class: 'loading' }, [
      h('div', { class: 'loading__spinner' }),
      h('div', { class: 'loading__text', text: text || '正在读取本地数据……' })
    ]);
  }

  /* ---------------------------------------------------------------- 文本高亮 */

  function highlighted(text, query) {
    const segments = MS.search.highlight(text, query);
    const wrap = document.createDocumentFragment();
    segments.forEach(function (seg) {
      if (seg.hit) wrap.appendChild(h('mark', { class: 'hl', text: seg.text }));
      else wrap.appendChild(document.createTextNode(seg.text));
    });
    return wrap;
  }

  function debounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms === undefined ? 160 : ms);
    };
  }

  MS.ui = {
    h: h,
    append: append,
    clear: clear,
    frag: frag,
    on: on,
    icon: icon,
    ICONS: ICONS,
    anim: anim,
    urlPool: urlPool,
    poolBox: poolBox,
    fab: fab,
    toast: toast,
    confirm: confirmDialog,
    sheet: sheet,
    prompt: promptDialog,
    progress: progress,
    emptyState: emptyState,
    loadingState: loadingState,
    highlighted: highlighted,
    debounce: debounce,
    layerRoot: layerRoot
  };
  MS.anim = anim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
