/*!
 * 我的空间 · 首页
 * 结构：搜索入口 → 今日概览 → 最近添加 → 分类入口；新用户显示空状态。
 * 不做复杂 Dashboard，只把"快速找到"和"快速记录"两件事做到位。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.home = function (app) {
    const ui = MS.ui;
    const parts = MS.parts;
    const f = ui.frame({
      title: '我的空间',
      subtitle: '你的个人物品与资料',
      showBack: false,
      large: true
    });
    const pools = ui.poolBox();
    let unsubscribe = null;

    function searchEntry() {
      return ui.h('button', {
        class: 'searchentry',
        type: 'button',
        onClick: function () { app.openSearch(); }
      }, [
        ui.icon('search', { size: 19, class: 'searchentry__icon' }),
        ui.h('span', { class: 'searchentry__text', text: '搜索物品、资料、位置……' })
      ]);
    }

    function sectionHeader(title, actionLabel, action) {
      return ui.h('div', { class: 'section' }, [
        ui.h('div', { class: 'section__title', text: title }),
        action ? ui.h('button', { class: 'section__action', type: 'button', text: actionLabel, onClick: action }) : null
      ]);
    }

    function cardList(items) {
      const wrap = ui.h('div', { class: 'cardlist' });
      items.forEach(function (item) {
        // 主页列表只显示文字，不显示照片
        wrap.appendChild(parts.itemCard(item, { app: app, pool: pools.get(), noThumb: true }));
      });
      return wrap;
    }

    /** 今日添加情况 + 总量概览 */
    function summaryLine(stats) {
      const today = app.repo.createdTodayCount();
      return ui.h('div', { class: 'summaryline' }, [
        ui.h('span', { class: 'summaryline__today' + (today > 0 ? ' summaryline__today--on' : '') }, [
          ui.icon('spark', { size: 14 }),
          ui.h('span', { text: today > 0 ? ('今日添加 ' + today + ' 件') : '今日还没有添加' })
        ]),
        ui.h('span', {
          class: 'summaryline__total',
          text: '共 ' + stats.items + ' 件' + (stats.images ? ' · ' + stats.images + ' 张图片' : '')
        })
      ]);
    }

    function categoryChips() {
      const data = app.repo.categoriesWithCounts();
      const used = data.list.filter(function (row) { return row.count > 0; });
      if (!used.length && !data.uncategorized) return null;
      const row = parts.chipsRow([
        used.map(function (row2) {
          return parts.chipEl(row2.category.name, {
            count: row2.count,
            onClick: function () { app.goTab('items', { categoryId: row2.category.id }); }
          });
        }),
        data.uncategorized ? parts.chipEl('未分类', {
          count: data.uncategorized,
          onClick: function () { app.goTab('items', { categoryId: '__none__' }); }
        }) : null
      ]);
      return ui.frag([sectionHeader('分类', '管理', function () { app.openCategories(); }), row]);
    }

    function render() {
      pools.reset();
      const stats = app.repo.stats();
      ui.clear(f.body);
      f.body.appendChild(searchEntry());

      if (!stats.items) {
        f.body.appendChild(ui.emptyState({
          emoji: '📦',
          title: '还没有物品',
          desc: '把生活中的东西记录下来，以后需要的时候可以快速找到。',
          actionLabel: '添加第一件物品',
          onAction: function () { app.newItem(); }
        }));
        return;
      }

      f.body.appendChild(summaryLine(stats));

      const recent = app.repo.recentAdded(6);
      if (recent.length) {
        f.body.appendChild(sectionHeader('最近添加', stats.items > recent.length ? '查看全部' : null, function () { app.goTab('items'); }));
        f.body.appendChild(cardList(recent));
      }

      const chips = categoryChips();
      if (chips && stats.items >= 3) f.body.appendChild(chips);

      f.body.appendChild(ui.h('div', { class: 'page__spacer' }));
    }

    return {
      el: f.el,
      tab: 0,
      showNav: true,
      showFab: true,
      onEnter: function (params) {
        render();
        if (params && params.categoryId) app.goTab('items', { categoryId: params.categoryId });
        if (!unsubscribe) {
          unsubscribe = app.repo.on('change', function (payload) {
            if (payload && payload.type === 'item:viewed') return;   // 浏览不重排首页，避免视觉跳动
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
