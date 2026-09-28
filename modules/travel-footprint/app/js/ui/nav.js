/* ==========================================================================
   Travel Footprint — ui/nav.js
   Floating glass tab bar with a sliding selection capsule.

   Rules honoured here:
   - only a small area is blurred (never a full-screen backdrop-filter)
   - labels are ALWAYS visible (not opacity:0 when idle)
   - the capsule moves with a pure CSS transition; the element is absolutely
     positioned and only `transform` is animated
   - graceful fallback to translucent + shadow when backdrop-filter is absent
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var h = UI.dom.h;
  var icon = UI.dom.icon;

  function Nav(opts) {
    var o = opts || {};
    this.onSelect = o.onSelect || function () {};
    this.tabs = o.tabs || [];
    this.el = null;
    this.capsule = null;
    this.buttons = {};
    this.active = null;
  }

  Nav.prototype.mount = function (parent) {
    var self = this;

    this.el = h('nav.glass-nav', { role: 'tablist', 'aria-label': '主导航' });

    this.capsule = h('span.glass-nav__capsule', { 'aria-hidden': 'true' });

    this.inner = h('div.glass-nav__inner', [this.capsule]);

    this.tabs.forEach(function (tab) {
      var btn = h('button.glass-nav__tab', {
        type: 'button',
        role: 'tab',
        'aria-label': tab.label,
        dataset: { tab: tab.id },
        onClick: function () { self.onSelect(tab.id); }
      }, [
        h('span.glass-nav__icon', [icon(tab.icon, { size: 22, strokeWidth: 1.8 })]),
        h('span.glass-nav__label', tab.label)
      ]);

      self.buttons[tab.id] = btn;
      self.inner.appendChild(btn);
    });

    this.el.appendChild(this.inner);
    parent.appendChild(this.el);

    // position the capsule once fonts/layout settle
    requestAnimationFrame(function () {
      if (self.active) self.moveCapsule(self.active, true);
    });

    return this.el;
  };

  /**
   * Activate a tab.
   * `instant` skips the animation (used on first paint).
   */
  Nav.prototype.setActive = function (id, instant) {
    if (!this.buttons[id]) return;

    var previous = this.active;
    this.active = id;

    for (var key in this.buttons) {
      if (!Object.prototype.hasOwnProperty.call(this.buttons, key)) continue;
      var btn = this.buttons[key];
      var isActive = key === id;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }

    // icon pop — subtle, and unselected items settle rather than jump
    var activeBtn = this.buttons[id];
    var iconWrap = activeBtn.querySelector('.glass-nav__icon');
    if (iconWrap && !instant) {
      iconWrap.classList.remove('is-popping');
      // force reflow so the animation can retrigger
      void iconWrap.offsetWidth;
      iconWrap.classList.add('is-popping');
    }

    this.moveCapsule(id, instant || !previous);
  };

  /**
   * Slide the capsule to the active tab.
   * Pure CSS transition on transform — no WAAPI here, mixing the two on the
   * same property makes them fight each other.
   */
  Nav.prototype.moveCapsule = function (id, instant) {
    var btn = this.buttons[id];
    if (!btn || !this.capsule) return;

    var left = btn.offsetLeft;
    var width = btn.offsetWidth;
    if (!width) return;

    if (instant) {
      this.capsule.style.transition = 'none';
    }

    this.capsule.style.transform = 'translate3d(' + left + 'px, 0, 0)';
    this.capsule.style.width = width + 'px';

    if (instant) {
      void this.capsule.offsetWidth;
      this.capsule.style.transition = '';
    }
  };

  /** Hide when a pushed page covers the tab root. */
  Nav.prototype.setVisible = function (visible) {
    if (!this.el || this.hidden === !visible) {
      // still keep the flag in sync
      this.hidden = !visible;
      if (!this.el) return;
    }
    this.hidden = !visible;
    this.el.classList.toggle('is-hidden', !visible);
  };

  Nav.prototype.setBadge = function (id, count) {
    var btn = this.buttons[id];
    if (!btn) return;
    var existing = btn.querySelector('.glass-nav__badge');
    if (!count) {
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    if (!existing) {
      btn.appendChild(h('span.glass-nav__badge', String(count)));
    } else {
      existing.textContent = String(count);
    }
  };

  /** Detect whether real backdrop blur is usable; downgrade on weak devices. */
  function detectGlassLevel() {
    var supportsBlur = false;
    try {
      supportsBlur = typeof CSS !== 'undefined' && CSS.supports &&
        (CSS.supports('backdrop-filter', 'blur(8px)') ||
         CSS.supports('-webkit-backdrop-filter', 'blur(8px)'));
    } catch (e) { supportsBlur = false; }

    if (!supportsBlur) return 'flat';

    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    if (cores <= 2 || mem <= 1) return 'flat';

    return 'blur';
  }

  function applyGlassLevel() {
    var level = detectGlassLevel();
    document.documentElement.setAttribute('data-glass', level);
    return level;
  }

  UI.nav = {
    Nav: Nav,
    applyGlassLevel: applyGlassLevel,
    detectGlassLevel: detectGlassLevel
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
