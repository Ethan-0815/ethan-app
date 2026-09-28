/*!
 * 我的空间 · 设置
 * 只保留真实存在的功能：数据管理（导入/导出/回收站/清空）、显示（外观/减少动画）、关于。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.settings = function (app) {
    const ui = MS.ui;
    const M = MS.models;
    const f = ui.frame({ title: '设置', showBack: false, large: true });
    let unsubscribe = null;

    /* ---------------------------------------------------------- 清空数据 */

    function clearAll() {
      const stats = app.repo.stats();
      ui.confirm({
        title: '清空所有本地数据？',
        message: '将删除本机的 ' + stats.items + ' 件物品与 ' + stats.images + ' 张图片。如需保留，请先在 Super App 统一设置 → 数据管理 中导出。',
        confirmText: '继续',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        return ui.confirm({
          title: '最后确认',
          message: '此操作无法撤销。是否确定要清空全部数据？',
          confirmText: '确定清空',
          danger: true
        });
      }).then(function (yes) {
        if (!yes) return;
        return app.repo.clearAll().then(function () {
          app.router.hardRefresh();
          ui.toast('本地数据已清空', { icon: 'trash' });
        });
      }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
    }

    /* ---------------------------------------------------------- 关于 */

    function openAbout() {
      ui.sheet({
        title: '关于「我的空间」',
        content: ui.h('div', { class: 'about' }, [
          ui.h('div', { class: 'about__logo' }, [ui.icon('box', { size: 26, weight: 1.5 })]),
          ui.h('div', { class: 'resultinfo__row' }, [ui.h('span', { text: '应用名称' }), ui.h('strong', { text: '我的空间' })]),
          ui.h('div', { class: 'resultinfo__row' }, [ui.h('span', { text: '版本' }), ui.h('strong', { text: MS.APP_VERSION })]),
          ui.h('div', { class: 'resultinfo__row' }, [ui.h('span', { text: '数据库' }), ui.h('strong', { text: 'IndexedDB（本机私有存储）' })]),
          ui.h('div', { class: 'resultinfo__note', text: '「我的空间」是一款完全离线的个人物品档案库。数据只保存在这台设备上，不联网、不上传、不含广告与统计 SDK。' }),
        ]),
        actions: [{ label: '知道了', icon: 'check' }]
      });
    }

    /* ---------------------------------------------------------- 渲染 */

    function appearanceControl() {
      const options = [
        { id: 'system', label: '跟随系统', icon: 'auto' },
        { id: 'light', label: '浅色', icon: 'sun' },
        { id: 'dark', label: '深色', icon: 'moon' }
      ];
      const current = app.prefs.get().theme;
      return ui.h('div', { class: 'segmented' }, options.map(function (option) {
        return ui.h('button', {
          class: 'segmented__item' + (current === option.id ? ' segmented__item--on' : ''),
          type: 'button',
          dataset: { id: option.id },
          onClick: function () {
            app.prefs.setTheme(option.id);
            const wrap = this.parentNode;
            wrap.querySelectorAll('.segmented__item').forEach(function (btn) {
              btn.classList.toggle('segmented__item--on', btn.dataset.id === option.id);
            });
          }
        }, [ui.icon(option.icon, { size: 16 }), ui.h('span', { text: option.label })]);
      }));
    }

    function switchRow(label, desc, value, onChange) {
      const knob = ui.h('span', { class: 'switch__knob' });
      const track = ui.h('button', {
        class: 'switch' + (value ? ' switch--on' : ''),
        type: 'button',
        role: 'switch',
        'aria-checked': value ? 'true' : 'false',
        'aria-label': label,
        onClick: function () {
          const next = !(track.classList.contains('switch--on'));
          track.classList.toggle('switch--on', next);
          track.setAttribute('aria-checked', next ? 'true' : 'false');
          onChange(next);
        }
      }, [knob]);
      return ui.h('div', { class: 'settingrow' }, [
        ui.h('div', { class: 'settingrow__main' }, [
          ui.h('div', { class: 'settingrow__label', text: label }),
          desc ? ui.h('div', { class: 'settingrow__desc', text: desc }) : null
        ]),
        track
      ]);
    }

    function render() {
      ui.clear(f.body);
      const stats = app.repo.stats();
      const prefs = app.prefs.get();

      /* 本机数据概览 */
      f.body.appendChild(ui.h('div', { class: 'card card--plain datacard' }, [
        ui.h('div', { class: 'datacard__title', text: '本机数据' }),
        ui.h('div', { class: 'datacard__grid' }, [
          ui.h('div', { class: 'datacard__item' }, [ui.h('strong', { text: String(stats.items) }), ui.h('span', { text: '物品' })]),
          ui.h('div', { class: 'datacard__item' }, [ui.h('strong', { text: String(stats.images) }), ui.h('span', { text: '图片' })]),
          ui.h('div', { class: 'datacard__item' }, [ui.h('strong', { text: String(stats.categories) }), ui.h('span', { text: '分类' })]),
          ui.h('div', { class: 'datacard__item' }, [ui.h('strong', { text: String(stats.tags) }), ui.h('span', { text: '标签' })]),
          ui.h('div', { class: 'datacard__item datacard__item--wide' }, [
            ui.h('strong', { text: '回收站 ' + stats.trashed + ' 件' }),
            ui.h('span', { text: '可随时恢复' })
          ])
        ]),
        ui.h('div', { class: 'datacard__usage', text: '正在统计占用空间…' })
      ]));

      /* 回收站（数据导入 / 导出已上收到 ETHAN Super App 统一设置 → 数据管理） */
      f.body.appendChild(ui.section('回收站与数据'));
      f.body.appendChild(ui.h('div', { class: 'card card--plain' }, [
        ui.row({
          icon: 'trash', label: '回收站',
          value: stats.trashed ? stats.trashed + ' 件' : '空',
          onClick: function () { app.openTrash(); }
        }),
        ui.row({ icon: 'close', label: '清空所有数据', desc: '删除本机全部记录与图片', tone: 'danger', onClick: clearAll })
      ]));

      /* 显示（外观/减少动画已上收到 ETHAN Super App 统一设置中心，这里不再重复提供） */

      /* 其他 */
      f.body.appendChild(ui.section('其他'));
      f.body.appendChild(ui.h('div', { class: 'card card--plain' }, [
        ui.row({ icon: 'info', label: '关于', value: 'v' + MS.APP_VERSION, onClick: openAbout })
      ]));

      f.body.appendChild(ui.h('div', {
        class: 'settingfoot',
        text: '所有数据都保存在本机，不会上传到任何服务器。'
      }));
      f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));

      /* 占用空间（浏览器支持时异步填充） */
      const usageEl = f.body.querySelector('.datacard__usage');
      app.repo.adapter.estimate().then(function (est) {
        if (!usageEl || !usageEl.parentNode) return;
        if (est && est.usage) {
          usageEl.textContent = '已占用约 ' + M.formatSize(est.usage) + (est.quota ? '（可用 ' + M.formatSize(est.quota) + '）' : '');
        } else {
          usageEl.textContent = '数据保存在本机私有存储中';
        }
      }).catch(function () {
        if (usageEl && usageEl.parentNode) usageEl.textContent = '数据保存在本机私有存储中';
      });
    }

    return {
      el: f.el,
      tab: 3,
      showNav: true,
      onEnter: function (params) {
        render();
        if (params && params.tab === 'data') {
          setTimeout(function () { f.el.scrollTo({ top: 0, behavior: 'auto' }); }, 0);
        }
        if (!unsubscribe) unsubscribe = app.repo.on('change', function () { render(); });
      },
      onLeave: function () {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      },
      onRepoChange: function (payload) {
        if (payload && payload.type === 'hard') render();
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
