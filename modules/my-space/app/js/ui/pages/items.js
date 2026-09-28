/*!
 * 我的空间 · 物品列表
 * 分类筛选 / 标签筛选 / 排序 / 大量数据下的流畅滚动
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.items = function (app) {
    const ui = MS.ui;
    const parts = MS.parts;
    const M = MS.models;
    const f = ui.frame({
      title: '物品',
      showBack: false,
      large: true,
      actions: [{ icon: 'sort', label: '排序', onClick: openSort }]
    });
    const pools = ui.poolBox();
    const state = { categoryId: null, tagId: null, sort: 'updated' };
    let unsubscribe = null;

    function openSort() {
      ui.sheet({
        title: '排序方式',
        actions: M.SORT_OPTIONS.map(function (option) {
          return {
            label: option.label,
            icon: state.sort === option.id ? 'check' : null,
            onClick: function () {
              state.sort = option.id;
              render();
            }
          };
        })
      });
    }

    /**
     * 「＋」入口：新建分类 / 查看并选择全部分类
     */
    function openAllCategories() {
      const data = app.repo.categoriesWithCounts();
      const rows = ui.h('div', { class: 'catpick' }, data.list.map(function (row) {
        const active = state.categoryId === row.category.id;
        return ui.h('button', {
          class: 'tagpick__row' + (active ? ' tagpick__row--on' : ''),
          type: 'button',
          onClick: function () {
            handle.close();
            state.categoryId = active ? null : row.category.id;
            render();
          }
        }, [
          ui.h('span', { class: 'tagpick__name', text: row.category.name }),
          ui.h('span', { class: 'tagpick__count', text: row.count ? row.count + ' 件' : '暂无物品' }),
          ui.h('span', { class: 'tagpick__check' }, active ? [ui.icon('check', { size: 15 })] : [])
        ]);
      }));

      if (!data.list.length) {
        rows.appendChild(ui.h('div', { class: 'sheet__note', text: '还没有分类。新建一个，用来归类你的物品。' }));
      }

      const handle = ui.sheet({
        title: '分类',
        tall: data.list.length > 7,
        content: rows,
        actions: [
          {
            label: '新建分类…', icon: 'plus',
            onClick: function () {
              ui.prompt({ title: '新建分类', label: '分类名称', placeholder: '例如：露营 / 乐器 / 收藏品', confirmText: '创建' })
                .then(function (name) {
                  if (!name) return;
                  return app.repo.createCategory(name).then(function (cat) {
                    state.categoryId = cat.id;      // 新建后直接进入该分类，方便马上把物品归进去
                    render();
                    ui.toast('分类已创建', { icon: 'check' });
                  });
                })
                .catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
            }
          },
          { label: '管理分类', icon: 'folder', onClick: function () { app.openCategories(); } }
        ]
      });
    }

    /**
     * 筛选区：第一行只显示"有物品"的分类 + 「＋」入口，
     * 第二行是自己打过的标签，点一下即可按标签归类查看。
     */
    function filterChips() {
      const data = app.repo.categoriesWithCounts();
      const total = app.repo.stats().items;

      const categoryChips = [parts.chipEl('全部', {
        count: total,
        active: !state.categoryId && !state.tagId,
        onClick: function () { state.categoryId = null; state.tagId = null; render(); }
      })];

      // 只保留有物品的分类；当前正在筛选的分类即使变空也继续显示，避免"筛选状态看不见"
      data.list.filter(function (row) {
        return row.count > 0 || state.categoryId === row.category.id;
      }).sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.category.name.localeCompare(b.category.name, 'zh-Hans-CN');
      }).forEach(function (row) {
        categoryChips.push(parts.chipEl(row.category.name, {
          count: row.count,
          active: state.categoryId === row.category.id,
          onClick: function () {
            state.categoryId = state.categoryId === row.category.id ? null : row.category.id;
            render();
          }
        }));
      });

      if (data.uncategorized) {
        categoryChips.push(parts.chipEl('未分类', {
          count: data.uncategorized,
          active: state.categoryId === '__none__',
          onClick: function () {
            state.categoryId = state.categoryId === '__none__' ? null : '__none__';
            render();
          }
        }));
      }

      categoryChips.push(ui.h('button', {
        class: 'chip chip--icon',
        type: 'button',
        'aria-label': '新建分类或查看全部分类',
        onClick: openAllCategories
      }, [ui.icon('plus', { size: 16 })]));

      const groups = [parts.chipsRow(categoryChips)];

      const tags = app.repo.tagsWithCounts();
      if (tags.length) {
        groups.push(parts.chipsRow(tags.map(function (row) {
          return parts.chipEl('#' + row.tag.name, {
            count: row.count,
            active: state.tagId === row.tag.id,
            onClick: function () {
              state.tagId = state.tagId === row.tag.id ? null : row.tag.id;
              render();
            }
          });
        })));
      }

      return ui.frag(groups);
    }

    function render() {
      const pool = pools.reset();
      const stats = app.repo.stats();
      const all = app.repo.listItems();
      ui.clear(f.body);

      if (!stats.items) {
        f.setSubtitle('');
        f.body.appendChild(ui.emptyState({
          emoji: '📦',
          title: '还没有物品',
          desc: '记录一件东西只需要填一个名称。',
          actionLabel: '添加第一件物品',
          onAction: function () { app.newItem(); }
        }));
        return;
      }

      f.body.appendChild(filterChips());

      const categoryId = state.categoryId === '__none__' ? '__none__' : state.categoryId;
      let list = categoryId
        ? all.filter(function (item) {
          return categoryId === '__none__' ? !item.categoryId : item.categoryId === categoryId;
        })
        : all;
      if (state.tagId) list = list.filter(function (item) { return (item.tagIds || []).indexOf(state.tagId) >= 0; });
      if (state.sort !== 'updated') {
        const sorted = app.repo.listItems({ sort: state.sort });
        const order = new Map(sorted.map(function (item, i) { return [item.id, i]; }));
        list = list.slice().sort(function (a, b) { return (order.get(a.id) || 0) - (order.get(b.id) || 0); });
      }

      f.setSubtitle((list.length === stats.items ? stats.items + ' 件物品' : list.length + ' / ' + stats.items + ' 件物品'));

      if (!list.length) {
        f.body.appendChild(ui.emptyState({
          icon: 'filter',
          title: '这个筛选下没有物品',
          desc: '换一个分类或标签看看。',
          actionLabel: '清除筛选',
          onAction: function () { state.categoryId = null; state.tagId = null; render(); }
        }));
        return;
      }

      const wrap = ui.h('div', { class: 'cardlist' });
      list.forEach(function (item) {
        // 物品列表只显示文字，不显示照片
        wrap.appendChild(parts.itemCard(item, { app: app, pool: pool, noThumb: true }));
      });
      f.body.appendChild(wrap);
      f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));
      ui.stagger(wrap.children);
    }

    return {
      el: f.el,
      tab: 1,
      showNav: true,
      showFab: true,
      onEnter: function (params) {
        if (params && 'categoryId' in params) state.categoryId = params.categoryId;
        if (params && 'tagId' in params) state.tagId = params.tagId;
        render();
        if (!unsubscribe) {
          unsubscribe = app.repo.on('change', function (payload) {
            if (payload && payload.type === 'item:viewed') return;
            render();
          });
        }
      },
      onLeave: function () {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      },
      onRepoChange: function (payload) {
        if (payload && payload.type === 'hard') render();
      },
      onReselect: function () {
        f.el.scrollTo({ top: 0, behavior: ui.anim.prefersReduced() ? 'auto' : 'smooth' });
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
