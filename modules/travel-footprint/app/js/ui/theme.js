/* ==========================================================================
   Travel Footprint — ui/theme.js
   Appearance: light / dark / follow-system. Persisted in localStorage,
   applied to <html data-theme="…"> before the app boots so there is no
   flash of the wrong theme. Pure decision logic (resolve) is testable
   without a DOM; every DOM/matchMedia touch is guarded.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  var KEY = 'tf-theme';
  var MODES = ['light', 'dark', 'system'];

  var listeners = [];

  /** Whether the OS currently prefers dark. Safe without a window. */
  function systemDark() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  }

  /** Stored preference; unknown or missing values mean "system". */
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  /** preference → effective theme. Pure and unit-testable. */
  function resolve(preference) {
    if (preference === 'dark') return 'dark';
    if (preference === 'light') return 'light';
    return systemDark() ? 'dark' : 'light';
  }

  /** Paint the current effective theme onto <html> + theme-color meta. */
  function apply() {
    if (typeof document === 'undefined') return 'light';
    var eff = resolve(stored());
    document.documentElement.setAttribute('data-theme', eff);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', eff === 'dark' ? '#121418' : '#ffffff');
    return eff;
  }

  function get() {
    return stored();
  }

  function set(mode) {
    if (MODES.indexOf(mode) < 0) mode = 'system';
    try {
      localStorage.setItem(KEY, mode);
    } catch (e) { /* private mode etc. — theme still applies for this session */ }
    var eff = apply();
    notify();
    return eff;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function notify() {
    var pref = get();
    var eff = resolve(pref);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](pref, eff); } catch (e) { /* listener errors must not break theme */ }
    }
  }

  // Follow OS changes while in "system" mode.
  if (typeof window !== 'undefined' && window.matchMedia) {
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    var onSysChange = function () {
      if (stored() === 'system') {
        apply();
        notify();
      }
    };
    if (mql.addEventListener) mql.addEventListener('change', onSysChange);
    else if (mql.addListener) mql.addListener(onSysChange);
  }

  // Apply immediately at script load — before the app renders.
  apply();

  TF.theme = {
    MODES: MODES,
    get: get,
    set: set,
    resolve: resolve,
    onChange: onChange
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
