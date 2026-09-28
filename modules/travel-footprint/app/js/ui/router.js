/* ==========================================================================
   Travel Footprint — ui/router.js
   Page-stack router + tab navigation.
   Tabs swap instantly (they are peers); pushed pages get a light transition.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var h = UI.dom.h;

  var TABS = [
    { id: 'home', label: '首页', icon: 'home' },
    { id: 'map', label: '地图', icon: 'map' },
    { id: 'timeline', label: '时间线', icon: 'clock' },
    { id: 'cities', label: '城市', icon: 'city' }
  ];

  function Router(opts) {
    var o = opts || {};
    this.viewport = o.viewport;             // element that holds page stacks
    this.pages = o.pages || {};             // id → { mount(ctx) -> element }
    this.stack = [];                        // [{ id, params, screen, scroll }]
    this.tab = null;
    this.size = 0;
  }

  /* ------------------------------------------------------------- tabs --- */

  Router.prototype.showTab = function (id, params) {
    if (!this.pages[id]) return null;

    // Leaving a tab tears down any pushed pages of the previous tab.
    var previous = this.tab;
    var isSameTab = previous === id;

    if (!isSameTab) {
      this._teardownPushStack();
    }

    this.tab = id;
    this._renderTabs(id);

    // Tabs are peers → swap content instantly (no transition). Users read a
    // slide animation between equal-rank tabs as lag, not polish.
    var screen = this._buildScreen(id, params);
    this._setRootScreen(screen);

    this.stack = [{ id: id, params: params || {}, screen: screen, isTab: true }];
    this._updateNavVisibility();
    return screen;
  };

  Router.prototype._teardownPushStack = function () {
    for (var i = 1; i < this.stack.length; i++) {
      if (this.stack[i].screen && this.stack[i].screen.parentNode) {
        this.stack[i].screen.parentNode.removeChild(this.stack[i].screen);
      }
    }
    this.stack = this.stack.slice(0, 1);
  };

  Router.prototype._buildScreen = function (id, params) {
    var page = this.pages[id];
    // Pages receive a context object `{ params }` — the same shape `refresh`
    // passes, so mount() and refresh() can share one implementation.
    var el = page.mount({ params: params || {} });
    el.classList.add('screen');
    el.dataset.page = id;
    return el;
  };

  Router.prototype._setRootScreen = function (screen) {
    // remove the previous root
    var old = this.viewport.querySelector('.screen--root');
    if (old && old !== screen) this.viewport.removeChild(old);
    screen.classList.add('screen--root', 'screen--visible');
    this.viewport.appendChild(screen);
    // gentle fade for the very first paint only
    screen.classList.add('screen--enter-tab');
    var self = this;
    setTimeout(function () {
      screen.classList.remove('screen--enter-tab');
    }, 260);
  };

  /* ------------------------------------------------------------ push --- */

  /**
   * Push a page onto the stack.
   * `provided` (optional) is a caller-built element — used by flows that need
   * to hand back a screen they manage themselves (e.g. the recycle bin, which
   * re-renders in place after a restore).
   */
  Router.prototype.push = function (id, params, provided) {
    if (!this.pages[id] && !provided) return null;

    var current = this.top();
    var screen = provided || this._buildScreen(id, params);
    if (provided) {
      screen.classList.add('screen');
      if (!screen.dataset.page) screen.dataset.page = id;
    }
    this.viewport.appendChild(screen);

    var entry = { id: id, params: params || {}, screen: screen, selfManaged: !!provided };
    this.stack.push(entry);

    // light transition: incoming slides up slightly + fades
    screen.classList.add('screen--pushing');
    requestAnimationFrame(function () {
      screen.classList.add('screen--visible');
      screen.classList.remove('screen--pushing');
    });

    if (current && current.screen) {
      var prev = current.screen;
      prev.classList.add('screen--leaving');
      setTimeout(function () {
        // Guard: if the user already returned during the transition, this
        // screen is the active one again — hiding it would blank the app.
        var top = self_top();
        if (!top || top.screen === prev) {
          prev.classList.remove('screen--leaving');
          return;
        }
        prev.classList.add('screen--behind');
        prev.classList.remove('screen--leaving');
      }, 220);
    }

    var self = this;
    function self_top() { return self.stack[self.stack.length - 1]; }

    this._updateNavVisibility();
    this.size = this.stack.length;
    return screen;
  };

  /* ------------------------------------------------------------- pop --- */

  Router.prototype.back = function () {
    if (this.stack.length <= 1) return false;

    var entry = this.stack.pop();
    var screen = entry.screen;
    var next = this.top();

    if (next && next.screen) {
      next.screen.classList.remove('screen--behind');
      next.screen.classList.add('screen--visible');
    }

    if (screen) {
      screen.classList.remove('screen--visible');
      screen.classList.add('screen--popping');
      setTimeout(function () {
        if (screen.parentNode) screen.parentNode.removeChild(screen);
      }, 210);
    }

    this._updateNavVisibility();
    this.size = this.stack.length;
    return true;
  };

  /** Return to the tab root, discarding every pushed page. */
  Router.prototype.popToRoot = function () {
    var guard = 0;
    while (this.stack.length > 1 && guard++ < 50) this.back();
    this._updateNavVisibility();
    return this.stack.length === 1;
  };

  Router.prototype.top = function () {
    return this.stack[this.stack.length - 1] || null;
  };

  Router.prototype.depth = function () {
    return this.stack.length;
  };

  Router.prototype.isRoot = function () {
    return this.stack.length === 1;
  };

  /** Current page params — used by pages that need to re-read their input. */
  Router.prototype.currentParams = function () {
    var t = this.top();
    return t ? t.params : {};
  };

  /** Refresh the active page in place (after a data change). */
  Router.prototype.refresh = function () {
    var t = this.top();
    if (!t) return;
    // A caller-managed screen (push with `provided`) refreshes itself.
    if (t.selfManaged) return;
    var page = this.pages[t.id];
    if (!page || typeof page.refresh !== 'function') return;

    var fresh = page.refresh(t.screen, t.params || {});
    if (!fresh || fresh === t.screen) return;

    // swap the node in place so scroll position of siblings is unaffected
    fresh.classList.add('screen', 'screen--visible');
    fresh.dataset.page = t.id;
    if (t.screen && t.screen.parentNode) {
      t.screen.parentNode.replaceChild(fresh, t.screen);
    } else {
      this.viewport.appendChild(fresh);
    }
    t.screen = fresh;
  };

  /** Refresh every visible page (data changed globally, e.g. after import). */
  Router.prototype.refreshAll = function () {
    for (var i = 0; i < this.stack.length; i++) {
      var entry = this.stack[i];
      if (entry.selfManaged) continue;
      var page = this.pages[entry.id];
      if (!page || typeof page.refresh !== 'function') continue;
      var fresh = page.refresh(entry.screen, entry.params || {});
      if (!fresh || fresh === entry.screen) continue;
      fresh.classList.add('screen', 'screen--visible');
      if (entry.screen && entry.screen.parentNode) {
        entry.screen.parentNode.replaceChild(fresh, entry.screen);
        if (i < this.stack.length - 1) fresh.classList.add('screen--behind');
      } else {
        this.viewport.appendChild(fresh);
      }
      entry.screen = fresh;
    }
    // re-render the tab bar (badge counts can change)
    this._renderTabs(this.tab);
  };

  /* -------------------------------------------------------- nav chrome --- */

  Router.prototype._renderTabs = function (activeId) {
    if (!UI.nav) return;
    UI.nav.setActive(activeId);
  };

  /** Hide the floating tab bar when a pushed page is on top. */
  Router.prototype._updateNavVisibility = function () {
    if (!UI.nav) return;
    var atRoot = this.stack.length === 1;
    UI.nav.setVisible(atRoot);
  };

  UI.router = {
    TABS: TABS,
    Router: Router
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
