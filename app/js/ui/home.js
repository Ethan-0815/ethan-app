/* ESA · 首页
 * 第一层品牌 → 第二层艺术化时间 → 第三层四个核心 App（2×2）→ 最近使用
 * 所有数字来自真实数据；无 Bottom Bar；右上角唯一设置齿轮。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});
  const U = ESA.util;

  const APPS = [
    { id: 'my-space', cls: 'ms', icon: '📦', name: '我的空间' },
    { id: 'toolbox', cls: 'tb', icon: '🧰', name: '工具箱' },
    { id: 'travel-footprint', cls: 'tf', icon: '🗺️', name: '旅行足迹' },
    { id: 'ethan', cls: 'eth', icon: '🔐', name: '密码' }
  ];

  function weekdayDate(d) {
    try {
      const wd = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const day = String(d.getDate()).padStart(2, '0');
      return wd + ' · ' + mon + ' ' + day;
    } catch (e) {
      return '';
    }
  }

  function createHome(host, ctx) {
    function renderStatic() {
      U.h; // noop
      const top = U.h('div', { class: 'home__top' }, [
        U.h('div', { class: 'home__brand', text: 'ETHAN' }),
        U.h('button', {
          class: 'home__gear', 'aria-label': '设置',
          onClick: function () { ctx.openSettings(); }
        }, [U.icon('gear')])
      ]);

      const clock = U.h('div', { class: 'home__clock' }, [
        U.h('div', { class: 'home__time', 'aria-label': '当前时间' }, [
          U.h('span', { class: 'hh', text: '--' }),
          U.h('span', { class: 'colon', text: ':' }),
          U.h('span', { class: 'mm', text: '--' })
        ]),
        U.h('div', { class: 'home__date', text: '' })
      ]);

      const apps = U.h('div', { class: 'home__apps' });
      APPS.forEach(function (app) {
        apps.appendChild(U.h('button', {
          class: 'appcard appcard--' + app.cls,
          onClick: function () {
            ESA.prefs.pulse();
            ctx.openApp(app.id);
          }
        }, [
          U.h('div', { class: 'appcard__icon', text: app.icon }),
          U.h('span', { class: 'appcard__dot' }),
          U.h('div', { class: 'appcard__name', text: app.name }),
          U.h('div', { class: 'appcard__stat', text: '…' }),
          U.h('div', { class: 'appcard__sub', text: '' })
        ]));
      });

      const recentLabel = U.h('div', { class: 'section-label', text: '最近使用' });
      const recent = U.h('div', { class: 'home__recent' });

      host.appendChild(top);
      host.appendChild(clock);
      host.appendChild(apps);
      host.appendChild(recentLabel);
      host.appendChild(recent);
    }

    /* ---- 时钟：真实系统时间，每 10 秒刷新 ---- */
    let clockTimer = null;
    function tickClock() {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const time = host.querySelector('.home__time');
      if (time) {
        time.querySelector('.hh').textContent = hh;
        time.querySelector('.mm').textContent = mm;
      }
      const date = host.querySelector('.home__date');
      if (date) date.textContent = weekdayDate(d);
    }

    /* ---- 卡片真实数据 ---- */
    function fillCards() {
      ESA.stats.all().then(function (s) {
        const cards = host.querySelectorAll('.appcard');
        if (!cards.length) return;
        /* 顺序与 APPS 一致：ms / tb / tf / eth */
        const msStat = cards[0].querySelector('.appcard__stat');
        msStat.textContent = s.mySpace.count + ' 件物品';
        cards[0].querySelector('.appcard__sub').textContent =
          s.mySpace.recentName ? '刚收纳了「' + s.mySpace.recentName + '」' : '还没有收纳物品';

        cards[1].querySelector('.appcard__stat').textContent = s.toolbox.count + ' 个工具';
        let tbSub = '打开即用 · 离线可用';
        try {
          const raw = JSON.parse(localStorage.getItem('toolbox.recent.v1') || '[]') || [];
          if (raw.length && root.TB && root.TB.registry) {
            const t = root.TB.registry.get(raw[0].id);
            if (t) tbSub = ESA.util.relTime(raw[0].at) + '用过「' + t.name + '」';
          }
        } catch (e) { /* ignore */ }
        cards[1].querySelector('.appcard__sub').textContent = tbSub;

        cards[2].querySelector('.appcard__stat').textContent = s.travel.cityCount + ' 个城市';
        cards[2].querySelector('.appcard__sub').textContent =
          s.travel.latestCity ? '最近一次 · ' + s.travel.latestCity : '还没有旅行记录';

        if (s.ethan.count === null) {
          cards[3].querySelector('.appcard__stat').textContent = '已加密保护';
          cards[3].querySelector('.appcard__sub').textContent = '解锁后显示统计';
        } else {
          cards[3].querySelector('.appcard__stat').textContent = s.ethan.count + ' 条信息';
          cards[3].querySelector('.appcard__sub').textContent = '全部已加密保存';
        }

        fillRecent(s.mySpace, s.travel);
      });
    }

    function fillRecent(mySpace, travel) {
      const wrap = host.querySelector('.home__recent');
      if (!wrap) return;
      wrap.textContent = '';
      const base = ESA.recents.list(5);
      const items = ESA.recents.mergeDynamic(base, mySpace, travel);
      if (!items.length) {
        wrap.appendChild(U.h('div', { class: 'home__empty', text: '还没有使用记录' }));
        return;
      }
      items.forEach(function (item) {
        wrap.appendChild(U.h('button', {
          class: 'recent-pill',
          onClick: function () {
            if (item.app) ctx.openApp(item.app);
          }
        }, [
          U.h('span', { class: 'recent-pill__icon', text: item.icon }),
          U.h('div', {}, [
            U.h('div', { class: 'recent-pill__name', text: item.name }),
            U.h('div', { class: 'recent-pill__time', text: item.sub ? item.sub + ' · ' + U.relTime(item.at) : U.relTime(item.at) })
          ])
        ]));
      });
    }

    function refresh() {
      fillCards();
    }

    /** 仅刷新卡片统计与最近使用（返回首页时调用） */
    function refreshStats() {
      fillCards();
    }

    renderStatic();
    tickClock();
    clockTimer = setInterval(tickClock, 10000);
    refresh();

    return {
      el: host,
      refresh: refresh,
      refreshStats: refreshStats,
      destroy: function () { if (clockTimer) clearInterval(clockTimer); }
    };
  }

  ESA.home = { create: createHome };
})(typeof globalThis !== 'undefined' ? globalThis : this);
