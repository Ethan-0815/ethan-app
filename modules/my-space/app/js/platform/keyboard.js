/*!
 * 我的空间 · 键盘与可视区域
 * 目标：输入时键盘不遮挡输入框、容器高度随键盘收缩、返回键先收键盘
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const THRESHOLD = 120;
  const listeners = [];

  function viewport() {
    return root.visualViewport || null;
  }

  function visible() {
    const vv = viewport();
    if (vv) {
      const shrunk = (root.innerHeight - vv.height) > THRESHOLD;
      if (shrunk) return true;
    }
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    // 没有 visualViewport 的环境（旧内核）：以焦点元素判断
    return !vv ? true : false;
  }

  function hide() {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  }

  function sync() {
    const vv = viewport();
    const doc = document.documentElement;
    if (vv && vv.height) {
      doc.style.setProperty('--app-height', Math.round(vv.height) + 'px');
      doc.style.setProperty('--kb-height', Math.max(0, Math.round(root.innerHeight - vv.height)) + 'px');
    }
    const kb = visible();
    if (kb) doc.classList.add('kb-open');
    else doc.classList.remove('kb-open');
    listeners.forEach(function (cb) { try { cb(kb); } catch (e) { /* ignore */ } });
  }

  /** 把焦点元素滚动到可视区域中间（延迟到键盘升起之后） */
  function ensureVisible(el, delay) {
    if (!el) return;
    setTimeout(function () {
      try {
        el.scrollIntoView({ block: 'center', behavior: MS.anim && MS.anim.prefersReduced() ? 'auto' : 'smooth' });
      } catch (e) {
        try { el.scrollIntoView(); } catch (e2) { /* ignore */ }
      }
    }, delay === undefined ? 220 : delay);
  }

  /** 输入框获得焦点时统一处理：滚动可见 */
  function bindInput(rootEl) {
    const handler = function (e) {
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
      ensureVisible(el);
    };
    rootEl.addEventListener('focusin', handler);
    return function () { rootEl.removeEventListener('focusin', handler); };
  }

  function init() {
    const vv = viewport();
    if (vv) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
    }
    root.addEventListener('resize', sync);
    root.addEventListener('orientationchange', function () { setTimeout(sync, 120); });
    document.addEventListener('focusout', function () { setTimeout(sync, 60); });
    sync();
  }

  function onChange(cb) {
    listeners.push(cb);
    return function () {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  MS.keyboard = {
    init: init,
    visible: visible,
    hide: hide,
    sync: sync,
    ensureVisible: ensureVisible,
    bindInput: bindInput,
    onChange: onChange
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
