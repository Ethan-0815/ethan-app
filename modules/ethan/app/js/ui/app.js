/* ETHAN V0.1 — app.js
 * 启动、路由、底部导航、悬浮新建、自动锁定。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  var TABS = [
    { id: 'home', label: '首页', icon: 'home' },
    { id: 'secrets', label: '全部', icon: 'lock' }
  ];
  // 注：ETHAN Super App 整合后，「设置」由统一设置中心负责，不再出现在底部导航。
  // 设置视图（Views.settings）仍保留，供统一设置中心通过 ?view=settings 深链进入。

  var App = {
    current: 'home',
    tabOpts: {},
    autoTimer: null,
    lastActive: Date.now(),
    started: false
  };

  /* ---------------- 启动 ---------------- */
  function start() {
    var app = document.getElementById('app');
    applyTheme();

    DB_READY().then(function () {
      return S.init();
    }).then(function () {
      App.started = true;
      if (!S.isInitialized()) showLock('setup');
      else showLock('unlock');
      bindGlobal();
    }).catch(function (e) {
      showFatal(app, e && e.message ? e.message : '未知错误');
    });
  }

  function DB_READY() {
    return root.Ethan.DB.isAvailable().then(function (ok) {
      if (!ok) throw new Error('此浏览器环境不支持本地数据库（IndexedDB），ETHAN 无法保存数据。请更换浏览器，或通过本地 HTTP 服务打开。');
      return true;
    });
  }

  function showFatal(app, msg) {
    app.innerHTML = '<div class="fatal"><h2>无法启动</h2><p>' + U.escapeHtml(msg) + '</p>' +
      '<button class="btn" onclick="location.reload()">重新尝试</button></div>';
  }

  /* ---------------- 锁定 / 主界面切换 ---------------- */
  function inShell() {
    try { return !!(window.parent && window.parent !== window); } catch (e) { return false; }
  }

  /** Super App 顶栏返回键：根页面直接通知外壳关闭模块；其余层级走内部返回 */
  function esaUiBack() {
    var busy = document.querySelectorAll('#panels .panel:not(.is-closing)').length ||
               document.querySelectorAll('.sheet-mask').length;
    if (!busy && !App.search && App.current === 'home') {
      try { window.parent.postMessage({ type: 'esa:exit-module', module: 'ethan' }, '*'); return; } catch (e) {}
    }
    if (window.__esaModule && typeof window.__esaModule.back === 'function') window.__esaModule.back();
  }

  function showLock(mode) {
    UI.closeAllPanels();
    // 安全修复：锁定时必须隐藏新建 FAB，否则未解锁也能打开「新建」弹层
    var fab = document.getElementById('fab');
    if (fab) fab.hidden = true;
    document.getElementById('main').hidden = true;
    var lock = document.getElementById('lock');
    lock.hidden = false;
    root.Ethan.Lock.render(lock, {
      mode: mode,
      onDone: function () {
        lock.hidden = true;
        showMain();
      }
    });
    // Super App：锁定屏左上角返回主页
    if (inShell() && !document.getElementById('esa-lock-back')) {
      var b = document.createElement('button');
      b.id = 'esa-lock-back';
      b.className = 'esa-back-btn';
      b.setAttribute('aria-label', '返回主页');
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
      b.addEventListener('click', function () {
        try { window.parent.postMessage({ type: 'esa:exit-module', module: 'ethan' }, '*'); } catch (e) {}
      });
      lock.appendChild(b);
    }
  }

  function showMain() {
    var prefs = S.getPrefs();
    renderTabbar();
    // Super App 深链：?view=settings 解锁后直达设置视图
    var deepView = null;
    try {
      var v = new URLSearchParams(window.location.search).get('view');
      if (v && root.Ethan.Views[v]) deepView = v;
    } catch (e) { /* ignore */ }
    go(deepView || (prefs.lastTab && root.Ethan.Views[prefs.lastTab] ? prefs.lastTab : 'home'));
    armAutoLock();
  }

  function lockNow() {
    if (!S.isUnlocked()) return;
    UI.closeAllPanels();
    Array.prototype.forEach.call(document.querySelectorAll('.sheet-mask'), function (m) {
      if (m.parentNode) m.parentNode.removeChild(m);
    });
    document.getElementById('main').hidden = true;
    S.lock();
    showLock('unlock');
  }

  /* ---------------- 导航 ---------------- */
  function go(tab, opts) {
    if (!root.Ethan.Views[tab]) tab = 'home';
    App.current = tab;
    App.tabOpts = opts || {};
    // 切换主 Tab 时退出搜索状态
    App.search = null;
    if (root.Ethan.Views.secrets) root.Ethan.Views.secrets.setQuery('');
    S.setPrefs({ lastTab: tab });
    renderTabbar();
    renderCurrent(opts);
  }

  /* ---------- 外观主题（浅色 / 深色 / 跟随系统） ---------- */
  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme() {
    var mode = S.getPrefs().theme || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && systemPrefersDark());
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0e1012' : '#f2f3f5');
  }

  function renderCurrent(opts) {
    opts = opts || App.tabOpts || {};
    var view = root.Ethan.Views[App.current];
    var main = document.getElementById('main');
    main.hidden = false;

    renderTopbar(view);
    renderView(view, opts);
    armAutoLock();
  }

  /* ---------- 顶栏 / 搜索态 ---------- */
  function searchQuery() {
    return (root.Ethan.Views.secrets && root.Ethan.Views.secrets._state.query) || '';
  }

  function renderTopbar(view) {
    var topbar = document.getElementById('topbar');
    var searching = !!(App.search && App.search.active);
    var q = searchQuery();

    if (searching) {
      topbar.className = 'searchbar';
      topbar.innerHTML =
        '<button class="iconbtn" id="tb-back" aria-label="返回">' + I.svg('back', 20) + '</button>' +
        '<div class="search" style="flex:1">' +
        '<span class="search__icon">' + I.svg('search', 17) + '</span>' +
        '<input id="sec-q" type="search" autocomplete="off" placeholder="搜索账号、密钥、文本…" value="' + UI.esc(q) + '" aria-label="搜索">' +
        (q ? '<button class="search__clear" id="tb-clear" aria-label="清除">×</button>' : '') +
        '</div>' +
        '<button class="textbtn" id="tb-cancel">取消</button>';

      topbar.querySelector('#tb-back').addEventListener('click', exitSearch);
      topbar.querySelector('#tb-cancel').addEventListener('click', exitSearch);
      var cl = topbar.querySelector('#tb-clear');
      if (cl) cl.addEventListener('click', function () { setSearchQuery(''); });
      bindSearchInput(topbar.querySelector('#sec-q'), true);
      return;
    }

    topbar.className = 'topbar';
    var html = '';
    // Super App：左上角返回键（视觉与其他模块一致）
    var esaBackBtn = inShell()
      ? '<button class="iconbtn esa-back-btn" id="tb-esa-back" aria-label="返回主页">' + I.svg('back', 20) + '</button>'
      : '';
    if (view.brand) {
      html += esaBackBtn +
        '<div><h1 class="topbar__brand">密码</h1>' +
        '<div class="topbar__sub">个人信息</div></div>' +
        '<div class="topbar__actions">' +
        '<button class="iconbtn" id="tb-search" aria-label="搜索">' + I.svg('search', 19) + '</button>' +
        '</div>';
    } else if (view.hasSearch) {
      html += esaBackBtn +
        '<div class="search" style="flex:1">' +
        '<span class="search__icon">' + I.svg('search', 17) + '</span>' +
        '<input id="sec-q" type="search" autocomplete="off" placeholder="搜索账号、密钥、文本…" value="" aria-label="搜索">' +
        '</div>' +
        '<button class="iconbtn" id="tb-trash" aria-label="回收站">' + I.svg('trash', 19) + '</button>';
    } else {
      html += '<h1 class="topbar__title">' + UI.esc(view.title || '') + '</h1>';
      html += '<div class="topbar__actions"></div>';
    }
    topbar.innerHTML = html;

    var esaBack = document.getElementById('tb-esa-back');
    if (esaBack) esaBack.addEventListener('click', esaUiBack);
    var tb = document.getElementById('tb-trash');
    if (tb) tb.addEventListener('click', function () { root.Ethan.Trash.open(); });
    var sb = document.getElementById('tb-search');
    if (sb) sb.addEventListener('click', function () { enterSearch(App.current); });
    var input = topbar.querySelector('#sec-q');
    if (input) bindSearchInput(input, false);
  }

  function bindSearchInput(input, isSearching) {
    if (!input) return;
    input.addEventListener('focus', function () {
      if (!App.search || !App.search.active) enterSearch(App.current, true);
    });
    input.addEventListener('input', function () { setSearchQuery(input.value); });
    if (isSearching) {
      // 保持光标在末尾，避免重绘打断输入
      setTimeout(function () {
        try {
          if (document.activeElement !== input) input.focus();
          var v = input.value;
          input.setSelectionRange(v.length, v.length);
        } catch (e) { /* 部分浏览器不支持 setSelectionRange */ }
      }, 0);
    }
  }

  function setSearchQuery(value) {
    root.Ethan.Views.secrets.setQuery(value);
    if (!App.search || !App.search.active) {
      App.search = { active: true, from: App.current };
      renderTopbar(root.Ethan.Views[App.current]);
    }
    renderView(root.Ethan.Views[App.current], {});
    armAutoLock();
  }

  function enterSearch(from, keepCategory) {
    App.search = { active: true, from: from || App.current };
    if (App.current !== 'secrets') {
      App.current = 'secrets';
      renderTabbar();
    }
    renderTopbar(root.Ethan.Views.secrets);
    renderView(root.Ethan.Views.secrets, {});
    var input = document.getElementById('sec-q');
    if (input) setTimeout(function () { input.focus(); }, 30);
    armAutoLock();
  }

  function exitSearch() {
    var from = (App.search && App.search.from) || App.current;
    App.search = null;
    root.Ethan.Views.secrets.setQuery('');
    if (from !== App.current) {
      go(from);
    } else {
      renderTopbar(root.Ethan.Views[App.current]);
      renderView(root.Ethan.Views[App.current], {});
    }
    armAutoLock();
  }

  function renderView(view, opts) {
    var host = document.getElementById('view');
    view.render(host, opts);

    var fab = ensureFab();
    fab.hidden = !view.showFab || !!(App.search && App.search.active);
    fab.onclick = function () {
      openCreate(App.current === 'secrets' ? (root.Ethan.Views.secrets._state.category === 'all' ? null : root.Ethan.Views.secrets._state.category) : null);
    };
  }

  function renderTabbar() {
    var bar = document.getElementById('tabbar');
    var idx = 0;
    TABS.forEach(function (t, i) { if (t.id === App.current) idx = i; });

    // 滑动指示块：持久复用，切换时平滑滑动（不重建 DOM）
    var ind = bar.querySelector('.tab__ind');
    if (!ind) {
      ind = document.createElement('span');
      ind.className = 'tab__ind';
      bar.appendChild(ind);
    }
    ind.style.transform = 'translateX(' + (idx * 100) + '%)';

    // tab 按钮只在结构变化时重建，其余时候仅切换选中态
    var desired = TABS.map(function (t) { return t.id; }).join(',');
    if (bar.getAttribute('data-tabs') !== desired) {
      bar.setAttribute('data-tabs', desired);
      Array.prototype.forEach.call(bar.querySelectorAll('.tab'), function (b) {
        if (b.parentNode) b.parentNode.removeChild(b);
      });
      TABS.forEach(function (t) {
        var btn = document.createElement('button');
        btn.className = 'tab' + (t.id === App.current ? ' is-active' : '');
        btn.setAttribute('data-tab', t.id);
        btn.innerHTML = I.svg(t.icon, 21) + '<span class="tab__label">' + t.label + '</span>';
        btn.addEventListener('click', function () {
          if (t.id !== App.current) go(t.id);
        });
        bar.appendChild(btn);
      });
    } else {
      Array.prototype.forEach.call(bar.querySelectorAll('.tab'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-tab') === App.current);
      });
    }
  }

  function ensureFab() {
    var fab = document.getElementById('fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'fab';
      fab.className = 'fab';
      fab.setAttribute('aria-label', '新建');
      fab.innerHTML = I.svg('plus', 24);
      document.getElementById('app').appendChild(fab);
    }
    return fab;
  }

  /* ---------------- 新建 ---------------- */
  function openCreate(category) {
    // 安全加固：未解锁（或已锁定）时不得打开新建弹层
    if (!S.isUnlocked()) return;
    if (category) { root.Ethan.Item.openEditor(category); return; }
    UI.sheet({
      title: '新建',
      options: [
        { icon: 'key', title: '账号密码', onSelect: function () { root.Ethan.Item.openEditor('account'); } },
        { icon: 'token', title: '密钥 / Token', onSelect: function () { root.Ethan.Item.openEditor('secret'); } },
        { icon: 'text', title: '文本', onSelect: function () { root.Ethan.Item.openEditor('text'); } },
        { icon: 'dots', title: '其他', onSelect: function () { root.Ethan.Item.openEditor('other'); } }
      ]
    });
  }

  /* ---------------- 自动锁定 ---------------- */
  function lockMs() {
    var v = S.getPrefs().autoLock;
    if (v === 'never' || v === null || v === undefined) return null;
    if (v === 'immediately') return 0;
    var n = parseInt(v, 10);
    if (!n || n < 0) return null;
    return n * 60000;
  }

  function armAutoLock() {
    if (!S.isUnlocked()) return;
    App.lastActive = Date.now();
    if (App.autoTimer) { clearTimeout(App.autoTimer); App.autoTimer = null; }
    var ms = lockMs();
    if (ms === null || ms === 0) return;
    App.autoTimer = setTimeout(function () { lockNow(); }, ms);
  }

  function bindGlobal() {
    var act = U.debounce(function () { armAutoLock(); }, 400);
    ['pointerdown', 'keydown', 'input', 'scroll'].forEach(function (ev) {
      document.addEventListener(ev, act, { passive: true });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (S.isUnlocked() && S.getPrefs().autoLock === 'immediately') lockNow();
        else armAutoLock();
      } else {
        var ms = lockMs();
        if (S.isUnlocked() && ms !== null) {
          if (ms === 0 || Date.now() - App.lastActive >= ms) lockNow();
          else armAutoLock();
        }
      }
    });

    window.addEventListener('pagehide', function () {
      if (S.isUnlocked() && S.getPrefs().autoLock === 'immediately') S.lock();
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if ((S.getPrefs().theme || 'auto') === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var panels = document.querySelectorAll('#panels .panel:not(.is-closing)');
        if (panels.length) {
          var last = panels[panels.length - 1];
          var api = findPanelApi(last);
          if (api) api.close();
        }
      }
    });

    window.addEventListener('error', function (e) {
      // 避免静默失败：给用户一个可见反馈（不写入任何敏感信息）
      if (e && e.message) UI.toast('发生错误：' + e.message, 2600);
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      UI.toast('操作失败：' + ((r && r.message) || '未知原因'), 2600);
    });
  }

  function findPanelApi(node) {
    // 通过节点反查 close：面板由 openPanel 创建，这里触发其返回按钮
    var btn = node.querySelector('[data-act=back]');
    if (btn) { btn.click(); return { close: function () { } }; }
    return null;
  }

  App.start = start;
  App.go = go;
  App.renderCurrent = renderCurrent;
  App.openCreate = openCreate;
  App.lockNow = lockNow;
  App.armAutoLock = armAutoLock;
  App.showLock = showLock;
  App.applyTheme = applyTheme;
  App.enterSearch = enterSearch;
  App.exitSearch = exitSearch;

  root.Ethan.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
