/* ESA · 模块管理器
 * 以同源 iframe 承载四个子 App：
 *  - 首次点击才创建（首页零模块加载，保证秒开）
 *  - 创建后缓存复用；隐藏用 visibility + pointer-events，不销毁（保留各 App 内部状态）
 *  - 主题/动画偏好变化通过 postMessage 广播
 *  - 系统返回键直接调用 iframe 内 __esaModule.back()
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  const MODULES = {
    'my-space': { path: '../modules/my-space/app/index.html', label: '我的空间' },
    'toolbox': { path: '../modules/toolbox/app/index.html', label: '工具箱' },
    'travel-footprint': { path: '../modules/travel-footprint/app/index.html', label: '旅行足迹' },
    'ethan': { path: '../modules/ethan/app/index.html', label: 'ETHAN' }
  };

  const cache = {};   // id -> { iframe, loaded, ready, pendingQuery }
  let activeId = null;
  const listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function emit(evt) { listeners.forEach(function (fn) { try { fn(evt); } catch (e) { /* ignore */ } }); }

  function buildQuery(params) {
    if (!params) return '';
    const qs = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      if (params[k] !== null && params[k] !== undefined) qs.set(k, params[k]);
    });
    const s = qs.toString();
    return s ? '?' + s : '';
  }

  function ensure(id, params) {
    const def = MODULES[id];
    if (!def) return null;
    let entry = cache[id];
    if (!entry) {
      const iframe = document.createElement('iframe');
      iframe.className = 'module-frame';
      iframe.setAttribute('title', def.label);
      iframe.setAttribute('allow', 'clipboard-write');
      const host = document.getElementById('module-host');
      host.appendChild(iframe);
      entry = cache[id] = { iframe: iframe, loaded: false, ready: false, query: null };
    }
    // 深链参数：尚未加载 → 直接带参加载；已加载但参数变化 → 重新加载（回到模块初始态并直达目标页）
    const q = buildQuery(params);
    if (!entry.loaded) {
      entry.iframe.src = def.path + q;
      entry.loaded = true;
      entry.query = q;
    } else if (q && q !== entry.query) {
      entry.ready = false;
      entry.loaded = true;
      entry.query = q;
      entry.iframe.src = def.path + q;
    }
    return entry;
  }

  function show(id) {
    const entry = cache[id];
    if (!entry) return;
    activeId = id;
    Object.keys(cache).forEach(function (key) {
      cache[key].iframe.classList.toggle('is-active', key === id);
    });
    emit({ type: 'shown', id: id });
  }

  function hideActive() {
    const id = activeId;
    if (!id) return;
    activeId = null;
    Object.keys(cache).forEach(function (key) {
      cache[key].iframe.classList.remove('is-active');
    });
    try {
      const mod = cache[id].iframe.contentWindow && cache[id].iframe.contentWindow.__esaModule;
      if (mod && typeof mod.onHide === 'function') mod.onHide();
    } catch (e) { /* ignore */ }
    emit({ type: 'hidden', id: id });
  }

  function isActive(id) { return activeId === id; }
  function active() { return activeId; }
  function isLoaded(id) { return !!(cache[id] && cache[id].loaded); }
  function isReady(id) { return !!(cache[id] && cache[id].ready); }

  /** 返回键转发给活动模块；返回 'stay' | 'exit'（无活动模块时 'exit' 表示无模块） */
  function backActive() {
    if (!activeId) return 'none';
    try {
      const win = cache[activeId].iframe.contentWindow;
      if (win && win.__esaModule && typeof win.__esaModule.back === 'function') {
        return win.__esaModule.back();
      }
    } catch (e) { /* ignore */ }
    return 'exit';
  }

  /** 广播主题与动画偏好 */
  function broadcast() {
    const prefs = ESA.prefs.get();
    const message = { type: 'esa:theme', pref: prefs.theme, resolved: ESA.prefs.resolvedTheme() };
    Object.keys(cache).forEach(function (id) {
      try { cache[id].iframe.contentWindow.postMessage(message, '*'); } catch (e) { /* ignore */ }
      if (id === 'toolbox') {
        try {
          cache[id].iframe.contentWindow.postMessage({ type: 'esa:theme', resolved: ESA.prefs.resolvedTheme() }, '*');
        } catch (e) { /* ignore */ }
      }
    });
    Object.keys(cache).forEach(function (id) {
      try { cache[id].iframe.contentWindow.postMessage({ type: 'esa:motion', animations: prefs.animations }, '*'); } catch (e) { /* ignore */ }
    });
  }

  /** 模块 → 外壳 消息（esa:ready / esa:open-settings） */
  root.addEventListener('message', function (event) {
    const data = event.data || {};
    const id = Object.keys(cache).find(function (key) { return cache[key].iframe.contentWindow === event.source; });
    if (!id) return;
    if (data.type === 'esa:ready') {
      cache[id].ready = true;
      // 就绪后立即同步当前主题
      try {
        cache[id].iframe.contentWindow.postMessage({ type: 'esa:theme', pref: ESA.prefs.get().theme, resolved: ESA.prefs.resolvedTheme() }, '*');
        cache[id].iframe.contentWindow.postMessage({ type: 'esa:motion', animations: ESA.prefs.get().animations }, '*');
      } catch (e) { /* ignore */ }
      emit({ type: 'ready', id: id });
    } else if (data.type === 'esa:open-settings') {
      emit({ type: 'open-settings', id: id });
    } else if (data.type === 'esa:exit-module') {
      // 模块在自己的根页面按了返回 → 请求外壳关闭模块、回到上一层级
      emit({ type: 'exit-module', id: id });
    }
  });

  ESA.modules = {
    ensure: ensure,
    show: show,
    hideActive: hideActive,
    isActive: isActive,
    active: active,
    isLoaded: isLoaded,
    isReady: isReady,
    backActive: backActive,
    broadcast: broadcast,
    onChange: onChange,
    LABELS: MODULES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
