/* ETHAN V0.1 — trash.js
 * 回收站：恢复 / 永久删除（二次确认）。回收站中的数据同样保持加密存储。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  function open() {
    var panel = UI.openPanel({
      title: '回收站',
      build: function (body) { render(body, panel); }
    });
  }

  function render(body, panel) {
    var items = S.trash().sort(function (a, b) { return b.deletedAt - a.deletedAt; });

    if (!items.length) {
      body.innerHTML = '<div class="empty"><div class="empty__icon">' + I.svg('trash', 24) + '</div>' +
        '<div class="empty__title">回收站是空的</div>' +
        '<div class="empty__hint">删除的内容会先放到这里</div></div>';
      return;
    }

    var html = '<div class="list">';
    items.forEach(function (it) {
      html += '<div class="row" data-id="' + it.id + '" style="cursor:default">' +
        '<span class="row__icon">' + UI.catIcon(it.category, 17) + '</span>' +
        '<span class="row__main">' +
        '<span class="row__title">' + UI.esc(it.title) + '</span>' +
        '<span class="row__sub">' + UI.esc(UI.catLabel(it.category)) +
        '<span class="row__dot"></span>' + U.formatDate(it.deletedAt) + '</span>' +
        '</span>' +
        '<span class="row__ops" style="display:flex;gap:2px">' +
        '<button class="minibtn" data-restore="' + it.id + '" title="恢复">' + I.svg('restore', 17) + '</button>' +
        '<button class="minibtn" data-purge="' + it.id + '" title="永久删除">' + I.svg('x', 17) + '</button>' +
        '</span></div>';
    });
    html += '</div>';
    html += '<button class="btn btn--danger btn--block" data-act="empty" style="margin-top:18px">清空回收站</button>';

    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll('[data-restore]'), function (b) {
      b.addEventListener('click', function () {
        S.restore(b.getAttribute('data-restore')).then(function () {
          UI.toast('已恢复');
          render(body, panel);
          root.Ethan.App.renderCurrent();
        }).catch(function (e) { UI.toast(e.message || '恢复失败'); });
      });
    });

    Array.prototype.forEach.call(body.querySelectorAll('[data-purge]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-purge');
        var it = S.get(id);
        UI.confirm({
          title: '永久删除？',
          desc: '「' + (it ? it.title : '') + '」将无法恢复。',
          okText: '永久删除', danger: true
        }).then(function (yes) {
          if (!yes) return;
          S.purge(id).then(function () {
            UI.toast('已永久删除');
            render(body, panel);
            root.Ethan.App.renderCurrent();
          }).catch(function (e) { UI.toast(e.message || '删除失败'); });
        });
      });
    });

    body.querySelector('[data-act=empty]').addEventListener('click', function () {
      UI.confirm({
        title: '清空回收站？',
        desc: '回收站中的 ' + items.length + ' 条内容将永久删除，无法恢复。',
        okText: '清空', danger: true
      }).then(function (yes) {
        if (!yes) return;
        S.emptyTrash().then(function () {
          UI.toast('回收站已清空');
          render(body, panel);
          root.Ethan.App.renderCurrent();
        }).catch(function (e) { UI.toast(e.message || '清空失败'); });
      });
    });
  }

  root.Ethan.Trash = { open: open };
})(typeof globalThis !== 'undefined' ? globalThis : this);
