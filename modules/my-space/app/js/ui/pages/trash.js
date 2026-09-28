/*!
 * 我的空间 · 回收站
 * 软删除 → 可恢复；永久删除 → 二次确认后清理物品记录、图片与关联数据
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.trash = function (app) {
    const ui = MS.ui;
    const M = MS.models;
    const f = ui.frame({
      title: '回收站',
      showBack: true,
      actions: [{ icon: 'trash', label: '清空回收站', onClick: emptyAll }]
    });
    let unsubscribe = null;

    function emptyAll() {
      const list = app.repo.trashed();
      if (!list.length) { ui.toast('回收站已经是空的'); return; }
      ui.confirm({
        title: '确定清空回收站？',
        message: '将永久删除 ' + list.length + ' 件物品及其图片，这个操作无法撤销。',
        confirmText: '全部永久删除',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        return app.repo.purgeAllTrash().then(function () {
          ui.toast('回收站已清空', { icon: 'trash' });
        });
      }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
    }

    function row(item) {
      return ui.h('div', { class: 'card itemrow itemrow--static' }, [
        ui.h('div', { class: 'itemrow__body' }, [
          ui.h('div', { class: 'itemrow__title', text: item.name || '（未命名）' }),
          ui.h('div', { class: 'itemrow__meta', text: '删除于 ' + M.relativeTime(item.deletedAt) })
        ]),
        ui.h('div', { class: 'itemrow__actions' }, [
          ui.h('button', {
            class: 'minibtn', type: 'button',
            onClick: function () {
              app.repo.restore(item.id)
                .then(function () { ui.toast('已恢复到物品列表', { icon: 'restore' }); })
                .catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
            }
          }, [ui.icon('restore', { size: 15 }), ui.h('span', { text: '恢复' })]),
          ui.h('button', {
            class: 'minibtn minibtn--danger', type: 'button',
            onClick: function () { confirmPurge(item); }
          }, [ui.icon('trash', { size: 15 }), ui.h('span', { text: '删除' })])
        ])
      ]);
    }

    function confirmPurge(item) {
      const imageCount = app.repo.itemImages(item.id).length;
      ui.confirm({
        title: '永久删除「' + (item.name || '未命名') + '」？',
        message: '物品记录' + (imageCount ? '与 ' + imageCount + ' 张图片' : '') + '将被彻底清理，无法恢复。',
        confirmText: '永久删除',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        return app.repo.purge(item.id).then(function () {
          ui.toast('已永久删除', { icon: 'trash' });
        });
      }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
    }

    function render() {
      const list = app.repo.trashed().sort(function (a, b) {
        return M.str(b.deletedAt).localeCompare(M.str(a.deletedAt));
      });
      ui.clear(f.body);
      f.setSubtitle(list.length ? list.length + ' 件物品' : '');

      if (!list.length) {
        f.body.appendChild(ui.emptyState({
          icon: 'trash',
          title: '回收站是空的',
          desc: '被删除的物品会先放在这里，你可以随时恢复。'
        }));
        f.body.appendChild(ui.h('div', { class: 'page__spacer' }));
        return;
      }

      const wrap = ui.h('div', { class: 'cardlist' });
      list.forEach(function (item) { wrap.appendChild(row(item)); });
      f.body.appendChild(wrap);
      f.body.appendChild(ui.h('div', { class: 'trashnote', text: '提示：永久删除会同时清理关联图片，此操作无法撤销。' }));
      f.body.appendChild(ui.h('div', { class: 'page__spacer' }));
      ui.stagger(wrap.children);
    }

    return {
      el: f.el,
      tab: -1,
      showNav: false,
      onEnter: function () {
        render();
        if (!unsubscribe) {
          unsubscribe = app.repo.on('change', function () { render(); });
        }
      },
      onLeave: function () {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
