/* ESA · 统一偏好：主题（浅色/深色/跟随系统）、动画、过渡、触觉反馈
 * 存储：esa.prefs.v1（完整偏好）+ esa.theme（各模块首绘守卫读取的镜像） */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  const KEY = 'esa.prefs.v1';
  const THEME_KEY = 'esa.theme';

  const listeners = [];

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) { return {}; }
  }

  const state = Object.assign({
    theme: 'system',        // light | dark | system
    animations: true,       // 动画效果
    transitions: true,      // 页面过渡
    haptics: false          // 触觉反馈
  }, read());

  function resolved() {
    if (state.theme === 'dark') return 'dark';
    if (state.theme === 'light') return 'light';
    try {
      return root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.setItem(THEME_KEY, state.theme);
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function apply() {
    const r = resolved();
    document.documentElement.setAttribute('data-theme', r);
    document.documentElement.setAttribute('data-motion', state.animations ? 'on' : 'off');
    let meta = document.querySelector('meta[name="theme-color"]');
    /* 读取当前主题的真实页面背景色，状态栏/导航栏与之严格同色 */
    let bg = '';
    try {
      bg = String(getComputedStyle(document.documentElement).getPropertyValue('--bg') || '').trim();
    } catch (e) { /* ignore */ }
    if (meta) meta.setAttribute('content', bg || (r === 'dark' ? '#141416' : '#f3f3f4'));
    /* Android 壳：状态栏/导航栏颜色跟随深浅模式（携带实际背景色） */
    try {
      if (root.EthanTheme && typeof root.EthanTheme.apply === 'function') root.EthanTheme.apply(r, bg);
    } catch (e) { /* 非 App 环境忽略 */ }
  }

  function changed() {
    persist();
    apply();
    listeners.forEach(function (fn) {
      try { fn(state, resolved()); } catch (e) { /* ignore */ }
    });
  }

  const prefs = {
    get: function () { return Object.assign({}, state); },
    resolvedTheme: resolved,
    onChange: function (fn) { listeners.push(fn); },
    setTheme: function (theme) {
      state.theme = theme === 'dark' || theme === 'light' ? theme : 'system';
      changed();
    },
    setAnimations: function (on) { state.animations = !!on; changed(); },
    setTransitions: function (on) { state.transitions = !!on; changed(); },
    setHaptics: function (on) {
      state.haptics = !!on;
      changed();
      if (on) prefs.pulse();
    },
    /** 触觉脉冲：仅在平台真实支持时触发，不伪造成功 */
    pulse: function () {
      try {
        if (state.haptics && navigator.vibrate) return navigator.vibrate(8);
      } catch (e) { /* ignore */ }
      return false;
    },
    hapticsSupported: function () { return !!navigator.vibrate; },
    apply: apply
  };

  // 跟随系统：监听系统深浅色变化
  try {
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (state.theme === 'system') changed();
    });
  } catch (e) { /* ignore */ }

  ESA.prefs = prefs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
