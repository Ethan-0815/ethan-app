/*!
 * 我的空间 · 全局搜索
 * 范围：名称 / 品牌 / 型号 / 序列号 / 分类 / 标签 / 位置 / 备注 / 购买渠道
 * 空查询 → 常用标签引导；无结果 → 明确空状态（不是白屏）
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.search = function (app) {
    const ui = MS.ui;
    const parts = MS.parts;
    const f = ui.frame({ className: 'page--search' });
    const pools = ui.poolBox();
    let unsubscribe = null;
    let query = '';

    const input = ui.h('input', {
      class: 'searchbar__input',
      type: 'search',
      inputmode: 'search',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: '搜索名称、品牌、型号、位置、标签……',
      'aria-label': '搜索物品'
    });

    const clearBtn = ui.h('button', {
      class: 'searchbar__clear',
      type: 'button',
      'aria-label': '清空',
      onClick: function () {
        input.value = '';
        query = '';
        render();
        input.focus();
      }
    }, [ui.icon('close', { size: 17 })]);

    const header = ui.h('header', { class: 'topbar topbar--search' }, [
      ui.h('div', { class: 'topbar__row' }, [
        // Super App：左上角返回主页（统一圆形返回键，与搜索框同一行）
        (function () {
          let inShell = false;
          try { inShell = !!(root.parent && root.parent !== root); } catch (e) { inShell = false; }
          if (!inShell) return null;
          return ui.h('button', {
            class: 'esa-back-btn',
            type: 'button',
            'aria-label': '返回主页',
            onClick: function () { if (typeof MS.backRequest === 'function') MS.backRequest(); }
          }, [ui.icon('back', { size: 18 })]);
        })(),
        ui.h('div', { class: 'searchbar', style: { flex: '1', minWidth: '0' } }, [
          ui.icon('search', { size: 18, class: 'searchbar__icon' }),
          input,
          clearBtn
        ])
      ])
    ]);
    f.el.insertBefore(header, f.body);

    const runSearch = ui.debounce(function () {
      query = input.value.trim();
      render();
    }, 130);

    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        query = input.value.trim();
        MS.keyboard.hide();
        render();
      }
    });

    function idleState() {
      const frag = ui.frag([]);

      const tags = app.repo.tagsWithCounts().slice(0, 8);
      if (tags.length) {
        frag.appendChild(ui.section('常用标签'));
        frag.appendChild(parts.chipsRow(tags.map(function (row) {
          return parts.chipEl('#' + row.tag.name, {
            count: row.count,
            onClick: function () { app.goTab('items', { tagId: row.tag.id }); }
          });
        })));
      } else {
        frag.appendChild(ui.emptyState({
          icon: 'search',
          title: '搜索你的空间',
          desc: '可以搜名称、品牌、型号、序列号、位置、标签或备注。'
        }));
      }
      frag.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));
      return frag;
    }

    function render() {
      const pool = pools.reset();
      ui.clear(f.body);
      clearBtn.style.display = input.value ? 'flex' : 'none';

      if (!query) {
        f.body.appendChild(idleState());
        return;
      }

      const results = app.repo.search(query);
      if (!results.length) {
        f.body.appendChild(parts.notFound(query));
        f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));
        return;
      }

      f.body.appendChild(ui.h('div', { class: 'resultcount', text: '找到 ' + results.length + ' 条结果' }));
      const wrap = ui.h('div', { class: 'cardlist cardlist--tight' });
      results.forEach(function (item) {
        wrap.appendChild(parts.itemRow(item, { app: app, pool: pool, query: query }));
      });
      f.body.appendChild(wrap);
      f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));
      ui.stagger(wrap.children);
    }

    return {
      el: f.el,
      tab: 2,
      showNav: true,
      showFab: true,
      fabLabel: '添加物品',
      onEnter: function (params) {
        if (params && params.query !== undefined && params.query !== query) {
          query = String(params.query || '');
          input.value = query;
        }
        render();
        if (!unsubscribe) {
          unsubscribe = app.repo.on('change', function (payload) {
            if (payload && payload.type === 'item:viewed') return;
            render();
          });
        }
        setTimeout(function () {
          input.focus();
          MS.keyboard.ensureVisible(input, 260);
        }, 220);
      },
      onLeave: function () {
        MS.keyboard.hide();
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      },
      onRepoChange: function (payload) {
        if (payload && payload.type === 'hard') render();
      },
      onReselect: function () {
        input.focus();
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
