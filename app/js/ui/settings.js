/* ESA · 统一设置中心
 * 独立页面体系 + 独立 Bottom Bar（⚙ 通用 / 📦 我的空间 / 🗺️ 旅行足迹 / 🔐 ETHAN）
 * 主题在此统一控制，一次切换同步整个超级 App（含四个模块）。
 * 数据与备份：三个数据型 App 独立入口；工具箱无长期数据，不提供导出。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});
  const U = ESA.util;

  const TABS = [
    { id: 'general', label: '通用', icon: '⚙️' },
    { id: 'my-space', label: '我的空间', icon: '📦' },
    { id: 'travel-footprint', label: '旅行足迹', icon: '🗺️' },
    { id: 'ethan', label: '密码', icon: '🔐' }
  ];

  function switchRow(label, desc, value, onChange, disabled) {
    const track = U.h('button', {
      class: 'esa-switch' + (value ? ' is-on' : ''),
      role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': label,
      onClick: function () {
        if (disabled) return;
        const next = !track.classList.contains('is-on');
        track.classList.toggle('is-on', next);
        track.setAttribute('aria-checked', next ? 'true' : 'false');
        onChange(next);
      }
    });
    if (disabled) track.setAttribute('disabled', '');
    return U.h('div', { class: 'esa-row' }, [
      U.h('div', { class: 'esa-row__main' }, [
        U.h('div', { class: 'esa-row__title', text: label }),
        U.h('div', { class: 'esa-row__desc', text: desc })
      ]),
      track
    ]);
  }

  function row(icon, title, desc, onClick) {
    return U.h('button', { class: 'esa-row', onClick: onClick }, [
      U.h('span', { class: 'esa-row__icon', text: icon }),
      U.h('div', { class: 'esa-row__main' }, [
        U.h('div', { class: 'esa-row__title', text: title }),
        desc ? U.h('div', { class: 'esa-row__desc', text: desc }) : null
      ]),
      U.h('span', { class: 'esa-row__chev' }, [U.icon('chev')])
    ]);
  }

  function createSettings(host, ctx) {
    let activeTab = 'general';
    let autoLockRead = false;

    /* ---------------- 通用 ---------------- */
    function renderGeneral(page) {
      page.textContent = '';
      const prefs = ESA.prefs.get();

      /* 数据管理（全局唯一数据导入 / 导出入口） */
      page.appendChild(U.h('div', { class: 'section-label', text: '数据管理' }));
      const dmCard = U.h('div', { class: 'settings-card' }, [
        U.h('button', { class: 'dm-cell', onClick: function () { if (ESA.dataMgr && ESA.dataMgr.open) ESA.dataMgr.open(); } }, [
          U.h('span', { class: 'dm-cell__icon', text: '💾' }),
          U.h('span', { class: 'dm-cell__main' }, [
            U.h('span', { class: 'dm-cell__label', text: '数据管理' }),
            U.h('span', { class: 'dm-cell__desc', text: '备份与恢复全部个人数据' })
          ]),
          U.icon('chevron', { size: 14 })
        ])
      ]);
      page.appendChild(dmCard);

      /* 外观 */
      page.appendChild(U.h('div', { class: 'section-label', text: '外观' }));
      const seg = U.h('div', { class: 'theme-seg' });
      const segInd = U.h('span', { class: 'theme-seg__ind', 'aria-hidden': 'true' });
      seg.appendChild(segInd);
      const themeOpts = [
        { id: 'light', label: '浅色', sw: 'light' },
        { id: 'dark', label: '深色', sw: 'dark' },
        { id: 'system', label: '跟随系统', sw: 'system' }
      ];
      function moveSegInd(animate) {
        const active = seg.querySelector('.theme-seg__opt.is-active');
        if (!active) return;
        const a = active.getBoundingClientRect();
        const s = seg.getBoundingClientRect();
        segInd.style.height = a.height + 'px';
        segInd.style.width = a.width + 'px';
        segInd.style.transition = animate === false ? 'none' : '';
        segInd.style.transform = 'translate(' + (a.left - s.left) + 'px,' + (a.top - s.top) + 'px)';
        if (animate === false) {
          void segInd.offsetHeight;
          segInd.style.transition = '';
        }
      }
      themeOpts.forEach(function (opt) {
        seg.appendChild(U.h('button', {
          class: 'theme-seg__opt' + (prefs.theme === opt.id ? ' is-active' : ''),
          onClick: function () {
            ESA.prefs.setTheme(opt.id);
            seg.querySelectorAll('.theme-seg__opt').forEach(function (b) { b.classList.remove('is-active'); });
            this.classList.add('is-active');
            moveSegInd(true);
          }
        }, [
          U.h('span', { class: 'theme-swatch theme-swatch--' + opt.sw }),
          U.h('span', { text: opt.label })
        ]));
      });
      const themeCard = U.h('div', { class: 'settings-card' }, [seg]);
      page.appendChild(themeCard);
      requestAnimationFrame(function () { moveSegInd(false); });

      /* 界面 */
      page.appendChild(U.h('div', { class: 'section-label', text: '界面' }));
      const hapticsOk = ESA.prefs.hapticsSupported();
      const uiCard = U.h('div', { class: 'settings-card' }, [
        switchRow('动画效果', '卡片与过渡的轻微动效', prefs.animations, function (v) { ESA.prefs.setAnimations(v); }),
        switchRow('页面过渡', '页面切换时的柔和过渡', prefs.transitions, function (v) { ESA.prefs.setTransitions(v); }),
        switchRow('触觉反馈', hapticsOk ? '轻触时的轻微振动' : '当前环境不支持触觉反馈', prefs.haptics, function (v) { ESA.prefs.setHaptics(v); }, !hapticsOk)
      ]);
      page.appendChild(uiCard);

      /* 数据导入 / 导出唯一入口：上方「数据管理」 */

      page.appendChild(U.h('div', { class: 'settings-note',
        text: '全部数据（我的空间 · 旅行足迹 · 密码）通过「数据管理」统一导出为一个备份文件；ETHAN 敏感数据在备份中始终保持加密。' }));
    }

    /* ---------------- 我的空间 ---------------- */
    function renderMySpace(page) {
      page.textContent = '';
      page.appendChild(U.h('div', { class: 'section-label', text: '我的空间 · 数据' }));
      const card = U.h('div', { class: 'settings-card' }, [
        U.h('div', { class: 'ministat-row' }, [
          U.h('div', { class: 'ministat' }, [U.h('b', { text: '…' }), U.h('span', { text: '物品' })]),
          U.h('div', { class: 'ministat' }, [U.h('b', { text: '…' }), U.h('span', { text: '图片' })]),
          U.h('div', { class: 'ministat' }, [U.h('b', { text: '…' }), U.h('span', { text: '回收站' })])
        ])
      ]);
      page.appendChild(card);
      ESA.stats.mySpace().then(function (s) {
        try {
          // 图片数需要另开连接，这里复用只读统计的简化逻辑
        } catch (e) { /* ignore */ }
        const bs = card.querySelectorAll('.ministat b');
        bs[0].textContent = String(s.count);
        bs[1].textContent = '—';
        bs[2].textContent = '—';
      });
      page.appendChild(U.h('div', { class: 'section-label', text: '数据' }));
      page.appendChild(U.h('div', { class: 'settings-card' }, [
        row('🗑️', '回收站', '恢复或永久删除', function () { ctx.openApp('my-space', { page: 'settings' }); })
      ]));
      page.appendChild(U.h('div', { class: 'settings-note', text: '数据导出 / 导入已统一收口到「通用 → 数据管理」（含图片与附件完整备份）。' }));
    }

    /* ---------------- 旅行足迹 ---------------- */
    function renderTravel(page) {
      page.textContent = '';
      page.appendChild(U.h('div', { class: 'section-label', text: '旅行足迹 · 数据' }));
      const card = U.h('div', { class: 'settings-card' }, [
        U.h('div', { class: 'ministat-row' }, [
          U.h('div', { class: 'ministat' }, [U.h('b', { text: '…' }), U.h('span', { text: '城市' })]),
          U.h('div', { class: 'ministat' }, [U.h('b', { text: '…' }), U.h('span', { text: '旅行' })])
        ])
      ]);
      page.appendChild(card);
      page.appendChild(U.h('div', { class: 'section-label', text: '数据' }));
      page.appendChild(U.h('div', { class: 'settings-card' }, [
        row('🗑️', '回收站', '恢复或永久删除', function () { ctx.openApp('travel-footprint', { page: 'recycle' }); })
      ]));
      page.appendChild(U.h('div', { class: 'settings-note', text: '数据导出 / 导入已统一收口到「通用 → 数据管理」。旅行足迹保持纯离线定位，无在线地图、无云同步。' }));
    }

    /* ---------------- ETHAN ---------------- */
    function renderEthan(page) {
      page.textContent = '';
      page.appendChild(U.h('div', { class: 'section-label', text: 'ETHAN · 安全' }));
      page.appendChild(U.h('div', { class: 'settings-card' }, [
        row('🔑', 'PIN 与自动锁定', '修改 PIN / 自动锁定 / 立即锁定', function () { ctx.openApp('ethan', { view: 'settings' }); })
      ]));
      page.appendChild(U.h('div', { class: 'settings-note',
        text: '加密体系（PBKDF2 + AES-GCM、加密 IndexedDB）保持原有设计。备份 / 恢复已统一收口到「通用 → 数据管理」，ETHAN 数据在统一备份中保持加密状态。' }));
      // 非敏感自动锁定偏好展示
      try {
        const uiPrefs = JSON.parse(localStorage.getItem('ethan.ui') || '{}');
        if (uiPrefs.autoLock) {
          const labels = { immediately: '立即', 1: '1 分钟', 5: '5 分钟', 15: '15 分钟', never: '从不' };
          page.appendChild(U.h('div', { class: 'settings-note', text: '当前自动锁定：' + (labels[String(uiPrefs.autoLock)] || '5 分钟') }));
        }
      } catch (e) { /* ignore */ }
    }

    /* ---------------- Bottom Bar（滑动胶囊指示器） ---------------- */
    let indEl = null;

    function moveIndicator(animate) {
      if (!indEl) return;
      const active = host.querySelector('.settings-nav__item.is-active');
      const nav = host.querySelector('.settings-nav');
      if (!active || !nav) return;
      const aRect = active.getBoundingClientRect();
      const nRect = nav.getBoundingClientRect();
      indEl.style.height = (aRect.height + 2) + 'px';
      indEl.style.width = aRect.width + 'px';
      indEl.style.transition = animate === false ? 'none' : '';
      indEl.style.transform = 'translate(' + (aRect.left - nRect.left - 1) + 'px,' + (aRect.top - nRect.top - 1) + 'px)';
      if (animate === false) {
        void indEl.offsetHeight;
        indEl.style.transition = '';
      }
    }

    function renderNav(navHost) {
      navHost.textContent = '';
      indEl = U.h('span', { class: 'settings-nav__ind', 'aria-hidden': 'true' });
      navHost.appendChild(indEl);
      TABS.forEach(function (tab) {
        navHost.appendChild(U.h('button', {
          class: 'settings-nav__item' + (tab.id === activeTab ? ' is-active' : ''),
          'data-tab': tab.id,
          onClick: function () { switchTab(tab.id); }
        }, [
          U.h('span', { class: 'sn-icon', text: tab.icon }),
          U.h('span', { text: tab.label })
        ]));
      });
      requestAnimationFrame(function () { moveIndicator(false); });
    }

    function switchTab(id) {
      activeTab = id;
      const pages = host.querySelectorAll('.settings-page');
      pages.forEach(function (p) {
        p.classList.toggle('is-active', p.dataset.page === id);
      });
      host.querySelectorAll('.settings-nav__item').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-tab') === id);
      });
      moveIndicator(true);
      if (id === 'general') renderGeneral(host.querySelector('[data-page="general"]'));
      if (id === 'my-space') renderMySpace(host.querySelector('[data-page="my-space"]'));
      if (id === 'travel-footprint') renderTravel(host.querySelector('[data-page="travel-footprint"]'));
      if (id === 'ethan') renderEthan(host.querySelector('[data-page="ethan"]'));
      host.querySelector('.settings__body').scrollTop = 0;
    }

    function build() {
      host.textContent = '';
      const head = U.h('div', { class: 'settings__head' }, [
        U.h('button', { class: 'settings__back', 'aria-label': '返回', onClick: function () { ctx.closeSettings(); } }, [U.icon('back')]),
        U.h('div', { class: 'settings__title', text: '设置' })
      ]);
      const body = U.h('div', { class: 'settings__body' });
      TABS.forEach(function (tab) {
        body.appendChild(U.h('div', { class: 'settings-page' + (tab.id === 'general' ? ' is-active' : ''), 'data-page': tab.id }));
      });
      const nav = U.h('nav', { class: 'settings-nav', 'aria-label': '设置导航' });
      host.appendChild(head);
      host.appendChild(body);
      host.appendChild(nav);
      renderNav(nav);
      switchTab('general');
    }

    build();

    return {
      el: host,
      switchTab: switchTab,
      /** 返回：非通用 tab 先回通用，再由外壳关闭设置中心 */
      back: function () {
        if (activeTab !== 'general') { switchTab('general'); return 'stay'; }
        return 'exit';
      }
    };
  }

  ESA.settings = { create: createSettings };
})(typeof globalThis !== 'undefined' ? globalThis : this);
