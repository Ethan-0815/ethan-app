/*!
 * 工具箱 · UI 基础设施
 * DOM 构建 / 图标 / 动画 / 提示 / 弹层 / 表单控件 / 结果展示
 * 所有文本一律通过 textContent 输出，不使用 innerHTML 拼接用户内容。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  /* ---------------------------------------------------------------- 元素构建 */

  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) {
      for (const key in props) {
        const value = props[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class' || key === 'className') el.className = value;
        else if (key === 'text') el.textContent = String(value);
        else if (key === 'html') el.innerHTML = value;              // 仅用于内置图标
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'value') el.value = value;
        else if (key === 'checked' || key === 'disabled' || key === 'readOnly' || key === 'multiple') el[key] = !!value;
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

  /* ---------------------------------------------------------------- 图标 */

  const ICONS = {
    back: 'M14.5 5.5 8 12l6.5 6.5',
    close: 'M6 6l12 12 M18 6 6 18',
    check: 'M5 12.8 9.4 17 19 7',
    copy: 'M9 9.5A1.5 1.5 0 0 1 10.5 8h7A1.5 1.5 0 0 1 19 9.5v7A1.5 1.5 0 0 1 17.5 18h-7A1.5 1.5 0 0 1 9 16.5z M15 8V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15H9',
    trash: 'M5 7.5h14 M9.5 7.5V5.6A1.1 1.1 0 0 1 10.6 4.5h2.8a1.1 1.1 0 0 1 1.1 1.1v1.9 M7 7.5l.9 11a1.4 1.4 0 0 0 1.4 1.3h5.4a1.4 1.4 0 0 0 1.4-1.3l.9-11 M10.4 11v5.4 M13.6 11v5.4',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    refresh: 'M4.8 12a7.2 7.2 0 1 0 2.3-5.3 M4.8 4.6V10h5.4',
    swap: 'M7.5 5.5 4.5 8.5l3 3 M4.5 8.5h11 M16.5 18.5l3-3-3-3 M19.5 15.5h-11',
    download: 'M12 4.5v10 M8.2 10.9 12 14.7l3.8-3.8 M5 16v2.4A1.6 1.6 0 0 0 6.6 20h10.8a1.6 1.6 0 0 0 1.6-1.6V16',
    info: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 11v5.2 M12 7.8h.01',
    image: 'M4 5.5h16A1.5 1.5 0 0 1 21.5 7v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z M2.9 15.4 8 11l4.2 3.6L15.6 12l5.5 4.6 M9.2 9.4a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z',
    calendar: 'M4.5 8.5h15 M6.5 5.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z M8.5 4v3 M15.5 4v3',
    clock: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 8v4.3l3 1.8',
    chevron: 'M9.5 5.5 16 12l-6.5 6.5',
    up: 'M12 19V6 M6.5 11.5 12 6l5.5 5.5',
    down: 'M12 5v13 M6.5 12.5 12 18l5.5-5.5',
    wand: 'M6 18 17.2 6.8 M14.5 4.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z M5 6.5h.01 M19 17h.01',
    save: 'M5.5 5.5h9.6L19.5 10v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z M8.5 5.5v5h6v-5 M8.5 19.5v-4.6h7v4.6',
    clock2: 'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 8.2V12l2.8 1.6',
    file: 'M13.5 4.5H7.4A1.9 1.9 0 0 0 5.5 6.4v11.2a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V9.3z M13.5 4.5v4.8h5 M8.6 13.2h6.8 M8.6 16.2h4.4'
  };

  function icon(name, opts) {
    const o = opts || {};
    const size = o.size || 20;
    const path = ICONS[name] || ICONS.info;
    const span = document.createElement('span');
    span.className = 'icon' + (o.class ? ' ' + o.class : '');
    span.style.width = size + 'px';
    span.style.height = size + 'px';
    span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
      'stroke="currentColor" stroke-width="' + (o.weight || 1.65) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' + path + '"/></svg>';
    return span;
  }

  /* ---------------------------------------------------------------- 动画 */

  const anim = {
    _manual: null,
    _suspend: 0,
    setManualReduced: function (value) { anim._manual = value; },
    /** 页面转场期间挂起页面内部动画：避免两路动画同时跑造成掉帧 */
    suspend: function () { anim._suspend++; },
    resume: function () { anim._suspend = Math.max(0, anim._suspend - 1); },
    isSuspended: function () { return anim._suspend > 0; },
    prefersReduced: function () {
      if (anim._manual !== null) return !!anim._manual;
      try {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { return false; }
    },
    dur: function (kind) {
      const reduced = anim.prefersReduced();
      switch (kind) {
        case 'small': return reduced ? 90 : 180;
        case 'list': return reduced ? 90 : 220;
        case 'page':
        default: return reduced ? 100 : 210;
      }
    },
    run: function (el, keyframes, options) {
      if (!el || typeof el.animate !== 'function') return null;
      const o = options || {};
      // 转场进行中：跳过页面内部动画（元素直接停在最终态），保证只有一路动画在跑
      if (anim._suspend > 0 && !o.force) return null;
      const opts = {
        duration: o.duration === undefined ? anim.dur('page') : o.duration,
        easing: o.easing || 'cubic-bezier(0.22, 1, 0.36, 1)',
        delay: o.delay || 0,
        fill: o.fill || 'both'
      };
      let frames = keyframes;
      if (anim.prefersReduced() && o.fallback !== false) {
        frames = [{ opacity: 0 }, { opacity: 1 }];
        opts.duration = Math.min(opts.duration, 110);
        opts.easing = 'linear';
      }
      // 只取消本模块自己创建、仍在同一元素上运行的动画，避免与 CSS 过渡互相干扰
      if (el._tbAnims && el._tbAnims.length) {
        el._tbAnims.forEach(function (a) { try { a.cancel(); } catch (e) { /* ignore */ } });
      }
      try {
        const a = el.animate(frames, opts);
        el._tbAnims = [a];
        a.onfinish = function () {
          if (el._tbAnims && el._tbAnims[0] === a) el._tbAnims = [];
        };
        return a;
      } catch (e) {
        return null;
      }
    }
  };

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
    const el = h('div', { class: 'toast' + (o.tone ? ' toast--' + o.tone : '') }, [
      o.icon ? icon(o.icon, { size: 18 }) : null,
      h('span', { class: 'toast__text', text: U.str(message) })
    ]);
    layerRoot().appendChild(el);
    anim.run(el, [{ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
    setTimeout(function () {
      const a = anim.run(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)' }], { duration: anim.dur('small') });
      const finish = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (a) a.onfinish = finish; else finish();
    }, o.duration || 2200);
    return el;
  }

  /** 复制文本并给出反馈 */
  async function copyWithFeedback(text, label) {
    const ok = await TB.files.copyText(text);
    if (ok) toast((label || '已复制') + '到剪贴板', { tone: 'ok', icon: 'check' });
    else toast(U.ERROR_MESSAGES.COPY_FAIL, { tone: 'danger' });
    return ok;
  }

  function confirmDialog(opts) {
    const o = opts || {};
    return new Promise(function (resolve) {
      const rootEl = layerRoot();
      let done = false;
      const overlay = h('div', { class: 'overlay' });
      const finish = function (value) {
        if (done) return;
        done = true;
        const a = anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: anim.dur('small'), fallback: false });
        const remove = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        if (a) a.onfinish = remove; else remove();
        resolve(value);
      };
      const card = h('div', { class: 'dialog' }, [
        h('div', { class: 'dialog__title', text: o.title || '确认操作' }),
        o.message ? h('div', { class: 'dialog__message', text: o.message }) : null,
        h('div', { class: 'dialog__actions' }, [
          h('button', { class: 'btn btn--ghost', type: 'button', text: o.cancelText || '取消', onClick: function () { finish(false); } }),
          h('button', {
            class: 'btn ' + (o.danger ? 'btn--danger' : 'btn--primary'),
            type: 'button',
            text: o.confirmText || '确定',
            onClick: function () { finish(true); }
          })
        ])
      ]);
      // 把"点击空白关闭"绑在真正的全屏 backdrop 上（子元素会吞掉父级点击）
      const backdrop = h('div', { class: 'overlay__backdrop', onClick: function () { finish(false); } });
      append(overlay, [backdrop, card]);
      rootEl.appendChild(overlay);
      anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small'), fallback: false });
      anim.run(card, [{ opacity: 0, transform: 'scale(0.94) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
      const primary = card.querySelector('.btn--primary, .btn--danger');
      if (primary) primary.focus();
    });
  }

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
          type: 'button',
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
    panel.appendChild(h('button', { class: 'sheet__cancel', type: 'button', text: o.cancelText || '取消', onClick: function () { close(); } }));

    const backdrop = h('div', { class: 'overlay__backdrop', onClick: function () { close(); } });
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

  /** 处理中遮罩：阻止重复点击，完成后必须 close */
  function progress(opts) {
    const o = opts || {};
    const title = h('div', { class: 'progress__title', text: o.title || '正在处理…' });
    const text = h('div', { class: 'progress__text', text: o.text || '' });
    const fill = h('div', { class: 'progress__fill' });
    const bar = h('div', { class: 'progress__bar' }, [fill]);
    const panel = h('div', { class: 'progress' }, [h('div', { class: 'progress__spinner' }), title, text, bar]);
    const overlay = h('div', { class: 'overlay' }, [h('div', { class: 'overlay__backdrop' }), panel]);
    layerRoot().appendChild(overlay);
    anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: anim.dur('small'), fallback: false });
    anim.run(panel, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: anim.dur('small') });
    return {
      set: function (done, total, phase) {
        if (typeof done === 'string') { text.textContent = done; return; }
        const ratio = total ? U.clamp(done / total, 0, 1) : 0;
        fill.style.width = Math.round(ratio * 100) + '%';
        if (phase) text.textContent = phase + ' ' + done + ' / ' + total;
      },
      setText: function (t) { text.textContent = U.str(t); },
      close: function () {
        const a = anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: anim.dur('small'), fallback: false });
        const done = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        if (a) a.onfinish = done; else done();
      }
    };
  }

  /* ---------------------------------------------------------------- 空状态 / 加载 */

  function emptyState(opts) {
    const o = opts || {};
    return h('div', { class: 'empty' }, [
      h('div', { class: 'empty__emoji', text: o.emoji || '🧰' }),
      h('div', { class: 'empty__title', text: o.title || '暂无内容' }),
      o.desc ? h('div', { class: 'empty__desc', text: o.desc }) : null,
      o.actionLabel ? h('button', {
        class: 'btn btn--soft btn--sm',
        type: 'button',
        text: o.actionLabel,
        onClick: o.onAction
      }) : null
    ]);
  }

  function loadingState(text) {
    return h('div', { class: 'loading' }, [
      h('div', { class: 'spinner' }),
      h('div', { class: 'loading__text', text: text || '正在处理…' })
    ]);
  }

  function notice(text, tone, iconName) {
    return h('div', { class: 'notice' + (tone ? ' notice--' + tone : '') }, [
      icon(iconName || 'info', { size: 17, class: 'notice__icon' }),
      h('div', { class: 'notice__body', text: text })
    ]);
  }

  /* ---------------------------------------------------------------- 表单控件 */

  function field(label, control, hint, unit) {
    return h('div', { class: 'field' }, [
      h('label', { class: 'field__label' }, [
        h('span', { text: label }),
        unit ? h('span', { class: 'field__unit', text: unit }) : null
      ]),
      control,
      hint ? h('div', { class: 'field__hint', text: hint }) : null
    ]);
  }

  function textInput(opts) {
    const o = opts || {};
    return h('input', {
      class: 'input' + (o.className ? ' ' + o.className : ''),
      type: o.type || 'text',
      inputmode: o.inputmode || (o.numeric ? 'decimal' : null),
      placeholder: o.placeholder || '',
      value: o.value === undefined || o.value === null ? '' : String(o.value),
      maxlength: o.maxlength || null,
      dataset: o.dataset || null,
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      onInput: o.onInput
    });
  }

  function textArea(opts) {
    const o = opts || {};
    return h('textarea', {
      class: 'input input--area' + (o.className ? ' ' + o.className : ''),
      placeholder: o.placeholder || '',
      rows: o.rows || 6,
      maxlength: o.maxlength || null,
      dataset: o.dataset || null,
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      value: o.value === undefined || o.value === null ? '' : String(o.value),
      onInput: o.onInput
    });
  }

  function segmented(items, value, onChange, opts) {
    const o = opts || {};
    const wrap = h('div', { class: 'segmented' });
    items.forEach(function (item) {
      wrap.appendChild(h('button', {
        class: 'segmented__item' + (item.id === value ? ' segmented__item--on' : ''),
        type: 'button',
        dataset: { id: item.id },
        onClick: function () {
          Array.prototype.forEach.call(wrap.children, function (child) { child.classList.remove('segmented__item--on'); });
          const btn = wrap.querySelector('[data-id="' + item.id + '"]');
          if (btn) btn.classList.add('segmented__item--on');
          if (typeof onChange === 'function') onChange(item.id);
        }
      }, item.label));
    });
    if (o.role) wrap.setAttribute('role', o.role);
    return wrap;
  }

  function switchRow(label, desc, value, onChange) {
    const knob = h('div', { class: 'switch__knob' });
    const sw = h('div', { class: 'switch' + (value ? ' switch--on' : '') }, [knob]);
    const row = h('button', {
      class: 'switchrow',
      type: 'button',
      onClick: function () {
        const on = !sw.classList.contains('switch--on');
        sw.classList.toggle('switch--on', on);
        row.setAttribute('aria-checked', on ? 'true' : 'false');
        if (typeof onChange === 'function') onChange(on);
      }
    }, [
      h('div', { class: 'switchrow__main' }, [
        h('div', { class: 'switchrow__label', text: label }),
        desc ? h('div', { class: 'switchrow__desc', text: desc }) : null
      ]),
      sw
    ]);
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', value ? 'true' : 'false');
    return row;
  }

  /** 结果行 */
  function rowItem(label, value, opts) {
    const o = opts || {};
    return h('div', { class: 'rowitem' + (o.big ? ' rowitem--big' : '') + (o.soft ? ' rowitem--soft' : '') }, [
      h('div', { class: 'rowitem__label', text: label }),
      h('div', { class: 'rowitem__value', text: U.str(value) })
    ]);
  }

  /** 可复制的结果单元格 */
  function resultCell(label, value, opts) {
    const o = opts || {};
    const valueText = U.str(value);
    return h('div', { class: 'resultcell' }, [
      h('div', { class: 'resultcell__body' }, [
        h('div', { class: 'resultcell__label', text: label }),
        h('div', { class: 'resultcell__value', text: valueText })
      ]),
      o.copy === false ? null : h('button', {
        class: 'copybtn',
        type: 'button',
        'aria-label': '复制',
        onClick: function () { copyWithFeedback(valueText, o.copyLabel || '已复制'); }
      }, [icon('copy', { size: 18 })])
    ]);
  }

  function debounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms === undefined ? 140 : ms);
    };
  }

  /** 输入框非法时的高亮标记 */
  function markInvalid(input, invalid) {
    if (!input) return;
    input.classList.toggle('input--invalid', !!invalid);
  }

  /** 绑定输入框：回车时触发回调 */
  function onSubmit(input, handler) {
    if (!input) return input;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handler();
      }
    });
    return input;
  }

  /* ---------------------------------------------------------------- 键盘 */

  const keyboard = {
    visible: function () {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    },
    hide: function () {
      const el = document.activeElement;
      if (el && typeof el.blur === 'function') el.blur();
    }
  };

  TB.ui = {
    h: h,
    append: append,
    clear: clear,
    icon: icon,
    ICONS: ICONS,
    anim: anim,
    toast: toast,
    copyWithFeedback: copyWithFeedback,
    confirm: confirmDialog,
    sheet: sheet,
    progress: progress,
    emptyState: emptyState,
    loadingState: loadingState,
    notice: notice,
    field: field,
    textInput: textInput,
    textArea: textArea,
    segmented: segmented,
    switchRow: switchRow,
    rowItem: rowItem,
    resultCell: resultCell,
    debounce: debounce,
    markInvalid: markInvalid,
    onSubmit: onSubmit,
    layerRoot: layerRoot,
    keyboard: keyboard
  };
  TB.anim = anim;
  TB.keyboard = keyboard;
})(typeof globalThis !== 'undefined' ? globalThis : this);
