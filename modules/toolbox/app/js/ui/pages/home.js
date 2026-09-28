/*!
 * 工具箱 · 首页（工具索引）
 * 顶部标题 + 搜索；下面是「最近使用」与三个分类。
 * 没有底部导航：首页即入口，进入工具后由顶栏返回。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const ui = TB.ui;
  const F = TB.frame;

  function createHomePage() {
    const el = ui.h('div', { class: 'page' });
    let query = '';

    /* ------------------------------------------------------------ 搜索栏 */

    const input = ui.h('input', {
      class: 'searchbar__input',
      type: 'search',
      placeholder: '搜索工具，例如：图片、JSON、随机',
      'aria-label': '搜索工具',
      autocomplete: 'off',
      spellcheck: 'false'
    });
    const clearBtn = ui.h('button', {
      class: 'searchbar__clear',
      type: 'button',
      'aria-label': '清空搜索',
      onClick: function () {
        setQuery('');
        input.focus();
      }
    }, [ui.icon('close', { size: 14 })]);
    clearBtn.style.display = 'none';

    const onInput = ui.debounce(function () {
      setQuery(input.value);
    }, 90);
    input.addEventListener('input', onInput);
    input.addEventListener('search', onInput);

    function setQuery(value) {
      query = String(value || '');
      if (input.value !== query) input.value = query;
      clearBtn.style.display = query.trim() === '' ? 'none' : 'flex';
      renderBody();
    }

    const head = ui.h('div', { class: 'homehead' }, [
      ui.h('div', { class: 'homehead__row', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        // ETHAN Super App：外壳内运行时提供左上角返回键（回超级 App 首页）
        (function () {
          let inShell = false;
          try { inShell = !!(root.parent && root.parent !== root); } catch (e) { inShell = false; }
          if (!inShell) return null;
          return ui.h('button', {
            class: 'esa-back-btn',
            type: 'button',
            'aria-label': '返回主页',
            onClick: function () {
              if (typeof TB.backRequest === 'function') TB.backRequest();
            }
          }, [ui.icon('back', { size: 20 })]);
        })(),
        ui.h('div', { class: 'homehead__title', text: '工具箱' })
      ]),
      ui.h('div', { class: 'searchbar', style: { marginTop: '14px' } }, [
        ui.h('span', { class: 'searchbar__icon' }, [ui.icon('search', { size: 18 })]),
        input,
        clearBtn
      ])
    ]);

    const body = ui.h('div', {});
    el.appendChild(head);
    el.appendChild(body);

    /* ------------------------------------------------------------ 内容块 */

    function recentBlock() {
      const list = TB.recent.list();
      if (!list.length) return null;      // 从未使用过工具 → 整块隐藏，不显示空占位

      const card = ui.h('div', { class: 'card card--flush' });
      list.forEach(function (item) {
        const tool = TB.registry.get(item.id);
        if (!tool) return;
        card.appendChild(ui.h('button', {
          class: 'listrow',
          type: 'button',
          dataset: { recent: tool.id },
          onClick: function () { TB.app.runtime.openTool(tool.id); }
        }, [
          ui.h('span', { class: 'listrow__icon', text: tool.emoji }),
          ui.h('span', { class: 'listrow__main' }, [
            ui.h('span', { class: 'listrow__label', text: tool.name }),
            ui.h('span', { class: 'listrow__desc', text: tool.desc })
          ]),
          ui.h('span', { class: 'listrow__chevron' }, [ui.icon('chevron', { size: 16 })])
        ]));
      });

      return ui.h('div', {}, [
        F.section('最近使用'),
        ui.h('div', { class: 'page__body' }, [card])
      ]);
    }

    function toolGrid(tools) {
      const grid = ui.h('div', { class: 'toolgrid' });
      tools.forEach(function (tool) {
        grid.appendChild(F.toolCard(tool, function () { TB.app.runtime.openTool(tool.id); }));
      });
      return grid;
    }

    function categoryBlock(cat) {
      const tools = TB.registry.byCategory(cat.id);
      return ui.h('div', {}, [
        ui.h('div', { class: 'section' }, [
          ui.h('div', { class: 'section__title', text: cat.emoji + ' ' + cat.label }),
          ui.h('div', { class: 'section__action', text: tools.length + ' 个工具' })
        ]),
        ui.h('div', { class: 'page__body' }, [toolGrid(tools)])
      ]);
    }

    function resultsBlock() {
      const found = TB.registry.search(query);
      if (!found.length) {
        return ui.h('div', { class: 'page__body' }, [
          ui.emptyState({
            emoji: '🔍',
            title: '没有找到相关工具',
            desc: '换个关键词试试，例如「图片」「JSON」「随机」「时间戳」',
            actionLabel: '清空搜索',
            onAction: function () { setQuery(''); }
          })
        ]);
      }
      return ui.h('div', {}, [
        ui.h('div', { class: 'section' }, [
          ui.h('div', { class: 'section__title', text: '搜索结果' }),
          ui.h('div', { class: 'section__action', text: '找到 ' + found.length + ' 个工具' })
        ]),
        ui.h('div', { class: 'page__body' }, [toolGrid(found)])
      ]);
    }

    function renderBody() {
      const scrollTop = el.scrollTop;
      ui.clear(body);
      if (query.trim() !== '') {
        body.appendChild(resultsBlock());
      } else {
        const recents = recentBlock();
        if (recents) body.appendChild(recents);
        TB.registry.CATEGORIES.forEach(function (cat) { body.appendChild(categoryBlock(cat)); });
      }
      body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--tall' }));
      F.animateIn(body, { distance: 6 });
      el.scrollTop = scrollTop;
    }

    return {
      el: el,
      onEnter: function () { renderBody(); },
      onReenter: function () { renderBody(); },
      onBack: function () { return false; }
    };
  }

  TB.pages = TB.pages || {};
  TB.pages.home = createHomePage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
