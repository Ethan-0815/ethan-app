/* ETHAN — secrets.js（UI 2.0）
 * 机密页：搜索（顶栏常驻胶囊 / 搜索态）+ 分类筛选 + 列表层次 + 空状态。
 * 列表与搜索结果只展示非敏感元信息。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  root.Ethan.Views = root.Ethan.Views || {};

  var state = { query: '', category: 'all' };

  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'account', label: '账号密码' },
    { id: 'secret', label: '密钥 / Token' },
    { id: 'text', label: '文本' },
    { id: 'other', label: '其他' }
  ];

  var EMPTY = {
    account: { title: '还没有账号密码', hint: '保存你的第一条账号信息', action: '＋ 添加账号' },
    secret: { title: '还没有密钥 / Token', hint: '保存 API Key、Token 或 Secret', action: '＋ 添加' },
    text: { title: '还没有文本', hint: '保存需要长期保留的文本', action: '＋ 添加文本' },
    other: { title: '还没有其他信息', hint: '用自定义字段保存其它内容', action: '＋ 添加' }
  };

  root.Ethan.Views.secrets = {
    title: '机密',
    showFab: true,
    trashAction: true,
    hasSearch: true,

    setQuery: function (q) { state.query = q || ''; },
    setCategory: function (c) { state.category = c || 'all'; },

    render: function (host, opts) {
      opts = opts || {};
      if (opts.category) state.category = opts.category;

      var html = '';

      html += '<div class="chips" style="margin:2px 0 14px">';
      FILTERS.forEach(function (f) {
        html += '<button class="chip' + (state.category === f.id ? ' is-active' : '') + '" data-f="' + f.id + '">' +
          '<span>' + UI.esc(f.label) + '</span></button>';
      });
      html += '</div>';

      var items = S.list({ category: state.category, query: state.query });

      if (!items.length) {
        if (state.query) {
          html += '<div class="empty">' +
            '<div class="empty__icon">' + I.svg('search', 22) + '</div>' +
            '<div class="empty__title">没有找到相关内容</div>' +
            '<div class="empty__hint">试试其它关键词，或切换分类</div></div>';
        } else {
          var e = EMPTY[state.category] || { title: '还没有保存内容', hint: '添加你的第一条信息', action: '＋ 新建' };
          html += '<div class="empty">' +
            '<div class="empty__icon">' + I.svg(state.category === 'all' ? 'shield' : UI.CATS[state.category].icon, 22) + '</div>' +
            '<div class="empty__title">' + UI.esc(e.title) + '</div>' +
            '<div class="empty__hint">' + UI.esc(e.hint) + '</div>' +
            '<button class="btn btn--sm" data-act="new">' + UI.esc(e.action) + '</button></div>';
        }
      } else {
        html += '<div class="list">';
        items.forEach(function (it) {
          var sub = UI.catLabel(it.category);
          if (it.category === 'secret' && it.type) sub += ' · ' + it.type;
          if (it.category === 'account' && it.username) sub += ' · ' + it.username;
          html += '<button class="row" data-id="' + it.id + '">' +
            '<span class="row__icon row__icon--' + it.category + '">' + UI.catIcon(it.category, 17) + '</span>' +
            '<span class="row__main">' +
            '<span class="row__title">' + UI.esc(it.title) + '</span>' +
            '<span class="row__sub">' + UI.esc(sub) + '</span>' +
            '</span>' +
            '<span class="row__time">' + UI.esc(U.relativeTime(it.updatedAt)) + '</span>' +
            '<span class="row__arrow">' + I.svg('chevron', 16) + '</span>' +
            '</button>';
        });
        html += '</div>';
      }

      host.innerHTML = html;
      bind(host, opts);
    }
  };

  function bind(host, opts) {
    Array.prototype.forEach.call(host.querySelectorAll('.chip'), function (b) {
      b.addEventListener('click', function () {
        state.category = b.getAttribute('data-f');
        root.Ethan.App.renderCurrent();
      });
    });

    var nb = host.querySelector('[data-act=new]');
    if (nb) nb.addEventListener('click', function () {
      root.Ethan.App.openCreate(state.category === 'all' ? null : state.category);
    });

    Array.prototype.forEach.call(host.querySelectorAll('.row'), function (b) {
      b.addEventListener('click', function () { root.Ethan.Item.open(b.getAttribute('data-id')); });
    });
  }

  root.Ethan.Views.secrets._state = state;
})(typeof globalThis !== 'undefined' ? globalThis : this);
