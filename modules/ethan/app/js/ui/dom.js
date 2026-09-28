/* ETHAN V0.1 — dom.js
 * 基础 UI 工具：元素、Toast、弹窗、确认框、剪贴板、全屏面板栈。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var I = root.Ethan.Icons;
  var S = root.Ethan.Store;

  /* ---------- 基础 ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function esc(s) { return U.escapeHtml(s); }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var box = $('#toast');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove('is-on'); }, ms || 1900);
  }

  /* ---------- 分类元信息 ---------- */
  var CATS = {
    account: { label: '账号密码', icon: 'key' },
    secret: { label: '密钥 / Token', icon: 'token' },
    text: { label: '文本', icon: 'text' },
    other: { label: '其他', icon: 'dots' }
  };
  function catLabel(c) { return (CATS[c] || CATS.other).label; }
  function catIcon(c, size) { return I.svg((CATS[c] || CATS.other).icon, size || 19); }

  /* ---------- 弹窗（轻量毛玻璃） ---------- */
  function sheet(opts) {
    opts = opts || {};
    var host = $('#sheets');
    var mask = el('div', 'sheet-mask' + (opts.center ? ' sheet--center' : ''));
    var box = el('div', 'sheet');
    var html = '';
    if (!opts.center) html += '<div class="sheet__grip"></div>';
    if (opts.title) html += '<div class="sheet__title">' + esc(opts.title) + '</div>';
    if (opts.desc) html += '<div class="sheet__desc">' + esc(opts.desc) + '</div>';
    box.innerHTML = html;

    if (typeof opts.build === 'function') {
      var body = el('div', 'sheet__body');
      box.appendChild(body);
      opts.build(body, api);
    } else if (opts.html) {
      box.insertAdjacentHTML('beforeend', opts.html);
    }

    if (opts.options && opts.options.length) {
      var list = el('div', 'sheet__opts');
      opts.options.forEach(function (o) {
        var b = el('button', 'opt');
        b.innerHTML =
          '<span class="opt__icon">' + I.svg(o.icon || 'dots', 18) + '</span>' +
          '<span class="opt__main"><span class="opt__title">' + esc(o.title) + '</span>' +
          (o.sub ? '<span class="opt__sub">' + esc(o.sub) + '</span>' : '') + '</span>' +
          (o.checked ? '<span class="opt__check">' + I.svg('check', 18) + '</span>' : '');
        b.addEventListener('click', function () {
          api.close();
          if (o.onSelect) o.onSelect();
        });
        list.appendChild(b);
      });
      box.appendChild(list);
    }

    if (opts.actions) {
      var foot = el('div', 'btn-group');
      foot.style.marginTop = '14px';
      opts.actions.forEach(function (a) {
        var b = el('button', 'btn ' + (a.variant ? 'btn--' + a.variant : ''));
        b.textContent = a.text;
        b.addEventListener('click', function () {
          if (a.onClick) a.onClick(api);
          else api.close();
        });
        foot.appendChild(b);
      });
      box.appendChild(foot);
    }

    mask.appendChild(box);
    host.appendChild(mask);

    var api = {
      el: box,
      mask: mask,
      close: function () {
        if (api._closed) return;
        api._closed = true;
        mask.classList.add('is-closing');
        setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 190);
        if (opts.onClose) opts.onClose();
      }
    };

    mask.addEventListener('click', function (e) {
      if (e.target === mask && opts.dismissible !== false) api.close();
    });

    requestAnimationFrame(function () {
      var f = box.querySelector('input, textarea, button');
      if (f && opts.autofocus !== false && opts.center !== true) f.focus();
    });

    return api;
  }

  /* ---------- 确认框 ---------- */
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var s = sheet({
        center: true,
        title: opts.title || '确认',
        desc: opts.desc || '',
        dismissible: opts.dismissible !== false,
        onClose: function () { if (!done) { done = true; resolve(false); } },
        actions: [
          { text: opts.cancelText || '取消', variant: 'ghost', onClick: function (a) { done = true; a.close(); resolve(false); } },
          {
            text: opts.okText || '确定',
            variant: opts.danger ? 'danger' : 'accent',
            onClick: function (a) { done = true; a.close(); resolve(true); }
          }
        ]
      });
      // 危险操作：确认按钮需要更明显
      if (opts.danger) {
        var btns = s.el.querySelectorAll('.btn');
        var ok = btns[btns.length - 1];
        if (ok) { ok.style.background = 'var(--danger)'; ok.style.borderColor = 'var(--danger)'; ok.style.color = '#fff'; }
      }
    });
  }

  /* ---------- 剪贴板 ---------- */
  var pendingClears = [];

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /**
   * 复制文本。成功时尝试在 30 秒后清除剪贴板；
   * 若当前环境无法可靠清除，则只提示已复制，不会假装已清除。
   */
  function copy(text, label) {
    if (text === '' || text == null) { toast('没有可复制的内容'); return Promise.resolve(false); }
    return writeClipboard(text).then(function (ok) {
      if (!ok) { toast('复制失败，请长按手动复制'); return false; }
      var canClear = !!(navigator.clipboard && navigator.clipboard.writeText);
      if (canClear) {
        var t = setTimeout(function () {
          navigator.clipboard.writeText('').catch(function () { /* 无法清除时静默 */ });
        }, 30000);
        pendingClears.push(t);
        toast((label ? label + '已复制' : '已复制') + ' · 30 秒后清除剪贴板');
      } else {
        toast((label ? label + '已复制' : '已复制') + '（当前环境无法自动清除）');
      }
      return true;
    });
  }

  /* ---------- 全屏面板栈 ---------- */
  var panels = [];

  function openPanel(opts) {
    opts = opts || {};
    var host = $('#panels');
    var node = el('div', 'panel');
    node.setAttribute('role', 'dialog');
    host.appendChild(node);

    var api = {
      el: node,
      setTitle: function (t) {
        var h = node.querySelector('.panel__title');
        if (h) h.textContent = t;
      },
      close: function () {
        if (api._closed) return;
        api._closed = true;
        node.classList.add('is-closing');
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 190);
        var i = panels.indexOf(api);
        if (i >= 0) panels.splice(i, 1);
        if (opts.onClose) opts.onClose();
      }
    };

    var right = '';
    if (opts.action) right = '<button class="textbtn" data-act="action">' + esc(opts.action.label) + '</button>';
    else if (opts.menu) right = '<button class="iconbtn" data-act="menu" aria-label="更多">' + I.svg('more', 20) + '</button>';
    else right = '<span style="width:38px"></span>';

    var head = el('div', 'panel__head');
    head.innerHTML =
      '<button class="iconbtn" data-act="back" aria-label="返回">' + I.svg('back', 20) + '</button>' +
      '<div class="panel__title">' + esc(opts.title || '') + '</div>' + right;
    head.querySelector('[data-act=back]').addEventListener('click', function () { api.close(); });
    if (opts.menu) head.querySelector('[data-act=menu]').addEventListener('click', function (e) { opts.menu(e, api); });
    if (opts.action) head.querySelector('[data-act=action]').addEventListener('click', function () { opts.action.onClick(api); });
    node.appendChild(head);

    var body = el('div', 'panel__body');
    node.appendChild(body);
    if (typeof opts.build === 'function') opts.build(body, api);

    if (opts.footer) {
      var foot = el('div', 'panel__foot');
      node.appendChild(foot);
      opts.footer(foot, api);
    }

    panels.push(api);
    return api;
  }

  function closeAllPanels() {
    panels.slice().forEach(function (p) { p.close(); });
  }

  function anyPanelOpen() { return panels.length > 0; }

  /* ---------- 小工具 ---------- */
  function field(label, valueHtml, opts) {
    opts = opts || {};
    return '<div class="field' + (opts.empty ? ' field--empty' : '') + '">' +
      '<div class="field__label">' + esc(label) + '</div>' +
      '<div class="field__value' + (opts.mono ? ' is-mono' : '') + '">' +
      '<div class="field__text">' + (opts.empty ? '<span style="color:var(--muted)">未填写</span>' : valueHtml) + '</div>' +
      (opts.ops ? '<div class="field__ops">' + opts.ops + '</div>' : '') +
      '</div></div>';
  }

  function opBtn(icon, label, dataAttr) {
    return '<button class="minibtn" title="' + esc(label) + '" aria-label="' + esc(label) + '" ' + dataAttr + '>' +
      I.svg(icon, 17) + '</button>';
  }

  function emptyState(opts) {
    return '<div class="empty">' +
      '<div class="empty__icon">' + I.svg(opts.icon || 'dots', 24) + '</div>' +
      '<div class="empty__title">' + esc(opts.title) + '</div>' +
      (opts.hint ? '<div class="empty__hint">' + esc(opts.hint) + '</div>' : '') +
      (opts.action ? '<button class="btn btn--sm" data-act="' + esc(opts.action) + '">' + esc(opts.actionText || '添加') + '</button>' : '') +
      '</div>';
  }

  root.Ethan.UI = {
    $: $, $$: $$, el: el, esc: esc, toast: toast,
    catLabel: catLabel, catIcon: catIcon, CATS: CATS,
    sheet: sheet, confirm: confirm, copy: copy, writeClipboard: writeClipboard,
    openPanel: openPanel, closeAllPanels: closeAllPanels, anyPanelOpen: anyPanelOpen,
    field: field, opBtn: opBtn, emptyState: emptyState
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
