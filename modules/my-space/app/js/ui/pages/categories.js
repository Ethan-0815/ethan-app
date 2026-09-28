/*!
 * 我的空间 · 分类管理
 * 创建 / 重命名 / 删除；删除分类绝不删除物品，只把它们变为未分类。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.categories = function (app) {
    const ui = MS.ui;
    const f = ui.frame({
      title: '分类',
      showBack: true,
      actions: [{ icon: 'plus', label: '新建分类', onClick: createCategory }]
    });
    let unsubscribe = null;

    function createCategory() {
      ui.prompt({ title: '新建分类', label: '分类名称', placeholder: '例如：露营 / 乐器 / 收藏品', confirmText: '创建' })
        .then(function (name) {
          if (!name) return;
          return app.repo.createCategory(name).then(function () {
            ui.toast('分类已创建', { icon: 'check' });
          });
        })
        .catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
    }

    function openActions(row) {
      ui.sheet({
        title: row.category.name,
        actions: [
          {
            label: '重命名', icon: 'edit',
            onClick: function () {
              ui.prompt({
                title: '重命名分类', label: '分类名称', value: row.category.name, confirmText: '保存'
              }).then(function (name) {
                if (!name) return;
                return app.repo.renameCategory(row.category.id, name).then(function () {
                  ui.toast('已重命名', { icon: 'check' });
                });
              }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
            }
          },
          {
            label: '删除分类', icon: 'trash', tone: 'danger',
            desc: row.count ? row.count + ' 件物品会变为未分类' : '该分类下没有物品',
            onClick: function () { confirmDelete(row); }
          }
        ]
      });
    }

    function confirmDelete(row) {
      ui.confirm({
        title: '删除分类「' + row.category.name + '」？',
        message: row.count
          ? '分类下的 ' + row.count + ' 件物品不会被删除，它们会变成「未分类」。'
          : '该分类下没有物品，可以放心删除。',
        confirmText: '删除分类',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        return app.repo.deleteCategory(row.category.id).then(function (result) {
          ui.toast(result.affected ? ('分类已删除，' + result.affected + ' 件物品变为未分类') : '分类已删除', { icon: 'check', duration: 2600 });
        });
      }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
    }

    function render() {
      const data = app.repo.categoriesWithCounts();
      ui.clear(f.body);

      const wrap = ui.h('div', { class: 'cardlist' });
      data.list.forEach(function (row) {
        wrap.appendChild(ui.h('button', {
          class: 'card catrow',
          type: 'button',
          onClick: function () { openActions(row); }
        }, [
          ui.h('span', { class: 'catrow__icon' }, [ui.icon('folder', { size: 19 })]),
          ui.h('span', { class: 'catrow__body' }, [
            ui.h('span', { class: 'catrow__name', text: row.category.name }),
            ui.h('span', { class: 'catrow__meta', text: row.count ? row.count + ' 件物品' : '暂无物品' })
          ]),
          ui.h('span', { class: 'listrow__chevron' }, [ui.icon('chevron', { size: 17 })])
        ]));
      });

      if (data.uncategorized) {
        wrap.appendChild(ui.h('div', { class: 'card catrow catrow--plain' }, [
          ui.h('span', { class: 'catrow__icon' }, [ui.icon('box', { size: 19 })]),
          ui.h('span', { class: 'catrow__body' }, [
            ui.h('span', { class: 'catrow__name', text: '未分类' }),
            ui.h('span', { class: 'catrow__meta', text: data.uncategorized + ' 件物品' })
          ])
        ]));
      }

      f.body.appendChild(wrap);
      f.body.appendChild(ui.h('div', {
        class: 'trashnote',
        text: '删除分类只会解除分类关系，其中的物品会变为未分类，不会被删除。'
      }));
      f.body.appendChild(ui.h('div', { class: 'page__spacer' }));
    }

    return {
      el: f.el,
      tab: -1,
      showNav: false,
      onEnter: function () {
        render();
        if (!unsubscribe) unsubscribe = app.repo.on('change', function () { render(); });
      },
      onLeave: function () {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
