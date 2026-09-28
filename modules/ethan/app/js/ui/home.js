/* ETHAN — home.js（UI 2.0）
 * 首页：Hero + 真实统计 + 主信息卡 + 快速操作 + 最近使用（最多 5 条）。
 * 所有数字均来自 Store 实时计算，不使用任何写死的统计值。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  root.Ethan.Views = root.Ethan.Views || {};

  var CATS = [
    { id: 'account', desc: '账号、邮箱与登录信息' },
    { id: 'secret', desc: 'API Key、Token、Secret 等' },
    { id: 'text', desc: '需要长期保留的文本' },
    { id: 'other', desc: '其他自定义信息' }
  ];

  root.Ethan.Views.home = {
    brand: true,
    showFab: true,

    render: function (host) {
      var counts = S.counts();
      var total = counts.account + counts.secret + counts.text + counts.other;
      var kinds = ['account', 'secret', 'text', 'other'].filter(function (c) { return counts[c] > 0; }).length;
      var recents = S.recent(5);

      var html = '';

      // 大数字统计（实时）
      html += '<div class="stats">' +
        '<div class="stat-big"><span class="stat-big__n">' + total + '</span>' +
        '<span class="stat-big__l">条信息</span></div>' +
        '<span class="stats__sep"></span>' +
        '<div class="stat-big"><span class="stat-big__n">' + kinds + '</span>' +
        '<span class="stat-big__l">种类型</span></div>' +
        '</div>';

      // 主信息卡
      html += '<div class="card">';
      CATS.forEach(function (c) {
        html += '<button class="cat" data-cat="' + c.id + '">' +
          '<span class="cat__icon cat__icon--' + c.id + '">' + UI.catIcon(c.id, 17) + '</span>' +
          '<span class="cat__main">' +
          '<span class="cat__name">' + UI.esc(UI.catLabel(c.id)) + '</span>' +
          '<span class="cat__desc">' + UI.esc(c.desc) + '</span>' +
          '</span>' +
          '<span class="cat__count">' + counts[c.id] + '</span>' +
          '<span class="cat__arrow">' + I.svg('chevron', 15) + '</span>' +
          '</button>';
      });
      html += '</div>';

      // 快速操作
      html += '<div class="section-title">快速操作</div><div class="quick">';
      CATS.forEach(function (c) {
        html += '<button class="quick__item" data-new="' + c.id + '">' +
          I.svg('plus', 15) + '<span>' + UI.esc(UI.catLabel(c.id)) + '</span></button>';
      });
      html += '</div>';

      // 最近使用
      html += '<div class="section-title">最近使用</div>';
      if (recents.length) {
        html += '<div class="list">';
        recents.forEach(function (it) {
          html += '<button class="row" data-id="' + it.id + '">' +
            '<span class="row__icon row__icon--' + it.category + '">' + UI.catIcon(it.category, 17) + '</span>' +
            '<span class="row__main">' +
            '<span class="row__title">' + UI.esc(it.title) + '</span>' +
            '<span class="row__sub">' + UI.esc(UI.catLabel(it.category)) +
            '<span class="row__dot"></span>' + UI.esc(U.relativeTime(it.usedAt || it.updatedAt)) + '</span>' +
            '</span>' +
            '<span class="row__arrow">' + I.svg('chevron', 16) + '</span>' +
            '</button>';
        });
        html += '</div>';
      } else {
        html += '<div class="empty">' +
          '<div class="empty__icon">' + I.svg('clock', 22) + '</div>' +
          '<div class="empty__title">' + (total === 0 ? '还没有保存内容' : '还没有使用记录') + '</div>' +
          '<div class="empty__hint">' +
          (total === 0 ? '添加你的第一条信息' : '查看或复制任意信息后，这里会显示最近使用') + '</div>' +
          (total === 0 ? '<button class="btn btn--sm" data-act="new">＋ 新建</button>' : '') +
          '</div>';
      }

      host.innerHTML = html;
      bind(host);
    }
  };

  function bind(host) {
    var nb = host.querySelector('[data-act=new]');
    if (nb) nb.addEventListener('click', function () { root.Ethan.App.openCreate(); });

    Array.prototype.forEach.call(host.querySelectorAll('.cat'), function (b) {
      b.addEventListener('click', function () {
        root.Ethan.App.go('secrets', { category: b.getAttribute('data-cat') });
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-new]'), function (b) {
      b.addEventListener('click', function () {
        root.Ethan.Item.openEditor(b.getAttribute('data-new'));
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.row'), function (b) {
      b.addEventListener('click', function () {
        root.Ethan.Item.open(b.getAttribute('data-id'));
      });
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
