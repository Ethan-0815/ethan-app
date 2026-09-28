/* ==========================================================================
   Travel Footprint — ui/dom.js
   Tiny DOM builder + icon set. No framework, no dependencies.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * h('div', { class:'x', onClick: fn }, child, child)
   * - tag supports 'div.cls.cls2' shorthand
   * - attrs: class/className, style (object or string), dataset, onClick…
   * - children: string | Node | array | null/false (skipped)
   */
  function h(tag, attrs, children) {
    var parts = String(tag).split('.');
    var name = parts[0] || 'div';
    var classes = parts.slice(1);

    var el = document.createElement(name);

    if (classes.length) el.className = classes.join(' ');

    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      children = attrs;
      attrs = null;
    }

    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var value = attrs[key];
        if (value === null || value === undefined || value === false) continue;

        if (key === 'class' || key === 'className') {
          el.className = el.className ? el.className + ' ' + value : String(value);
        } else if (key === 'style') {
          if (typeof value === 'string') el.setAttribute('style', value);
          else for (var s in value) {
            if (Object.prototype.hasOwnProperty.call(value, s)) {
              el.style.setProperty(hyphenate(s), value[s]);
            }
          }
        } else if (key === 'dataset') {
          for (var d in value) {
            if (Object.prototype.hasOwnProperty.call(value, d)) el.dataset[d] = value[d];
          }
        } else if (key.indexOf('on') === 0 && typeof value === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'html') {
          el.innerHTML = value;
        } else if (key === 'text') {
          el.textContent = value;
        } else if (key === 'value' && (name === 'input' || name === 'textarea' || name === 'select')) {
          el.value = value;
        } else if (value === true) {
          el.setAttribute(key, '');
        } else {
          el.setAttribute(key, String(value));
        }
      }
    }

    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined || children === false || children === true) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) append(el, children[i]);
      return;
    }
    if (children.nodeType) {
      el.appendChild(children);
      return;
    }
    el.appendChild(document.createTextNode(String(children)));
  }

  function hyphenate(s) {
    return s.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function svg(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var v = attrs[key];
        if (v === null || v === undefined || v === false) continue;
        if (key.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), v);
        } else {
          el.setAttribute(key, String(v));
        }
      }
    }
    if (children) {
      var list = Array.isArray(children) ? children : [children];
      for (var i = 0; i < list.length; i++) {
        if (!list[i]) continue;
        if (list[i].nodeType) el.appendChild(list[i]);
      }
    }
    return el;
  }

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function mount(parent, child) {
    clear(parent);
    if (child) parent.appendChild(child);
    return parent;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------- icons --- */

  var ICON_PATHS = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    map: 'M9 4 3.6 6.2A1 1 0 0 0 3 7.1V20l6-2.5 6 2.5 5.4-2.2a1 1 0 0 0 .6-.9V4l-6 2.5zM9 4l6 2.5M9 17.5v-13M15 6.5v13',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
    city: 'M3 21h18M5 21V8l6-4v17M11 21V11l8-3v13M8 9v.01M8 13v.01M8 17v.01M15 12v.01M15 16v.01',
    plus: 'M12 5v14M5 12h14',
    back: 'M15 19l-7-7 7-7',
    close: 'M6 6l12 12M18 6L6 18',
    chevron: 'M9 6l6 6-6 6',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    camera: 'M3 7.5h3.5L8 5h8l1.5 2.5H21v12H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    image: 'M4 5h16v14H4zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 16l5-5 4 4 3-3 4 4',
    trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
    restore: 'M4 10a8 8 0 1 1 2.3 6.3M4 5v5h5',
    download: 'M12 4v11M8 11l4 4 4-4M4 20h16',
    upload: 'M12 20V9M8 13l4-4 4 4M4 4h16',
    share: 'M12 4v11M8 8l4-4 4 4M6 14v6h12v-6',
    edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM15 6l3 3',
    pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    calendar: 'M4 6h16v14H4zM4 10h16M8 4v4M16 4v4',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    more: 'M6 12a1 1 0 1 0 0-.01M12 12a1 1 0 1 0 0-.01M18 12a1 1 0 1 0 0-.01',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 6.9 19.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 6.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.9 4.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8v.01',
    check: 'M20 6L9 17l-5-5',
    zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
    zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2.5v2M12 19.5v2M4.8 4.8l1.4 1.4M17.8 17.8l1.4 1.4M2.5 12h2M19.5 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4',
    moon: 'M20.6 14.6A8.6 8.6 0 0 1 9.4 3.4a8.6 8.6 0 1 0 11.2 11.2z',
    monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
    arrowRight: 'M5 12h14M13 6l6 6-6 6'
  };

  /** Inline SVG icon. Stroked, rounded, 1.6px — matches the app's light feel. */
  function icon(name, opts) {
    var options = opts || {};
    var size = options.size || 22;
    var sw = options.strokeWidth || 1.7;
    var path = ICON_PATHS[name] || ICON_PATHS.info;

    return svg('svg', {
      class: 'icon' + (options.class ? ' ' + options.class : ''),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': sw,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    }, path.split('M').filter(Boolean).map(function (seg) {
      return svg('path', { d: 'M' + seg });
    }));
  }

  UI.dom = {
    h: h,
    svg: svg,
    icon: icon,
    ICON_PATHS: ICON_PATHS,
    $: $,
    $$: $$,
    clear: clear,
    mount: mount,
    append: append,
    escapeHtml: escapeHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
