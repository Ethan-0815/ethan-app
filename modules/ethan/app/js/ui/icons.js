/* ETHAN V0.1 — icons.js
 * 全部为内联 SVG，无任何远程图标 / 图标字体。
 */
(function (root) {
  'use strict';

  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5"/>',
    key: '<circle cx="8" cy="15" r="3.2"/><path d="M10.3 12.7 19 4"/><path d="M16.5 6.5 18 8"/><path d="M19 4l1.5 1.5"/>',
    token: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h4"/><path d="M7 14h7"/><path d="M16.5 10.5h.01"/>',
    text: '<path d="M5 5h14"/><path d="M5 10h14"/><path d="M5 15h9"/><path d="M5 20h6"/>',
    dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.7 3.4"/><path d="M6.3 8.1A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.6-.7"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 15A2.5 2.5 0 0 1 3 12.5v-6A2.5 2.5 0 0 1 5.5 4h6A2.5 2.5 0 0 1 14 6.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
    restore: '<path d="M4 10a8 8 0 1 1 2.6 6.4"/><path d="M4 4v6h6"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-6"/><path d="M20 4v5h-5"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10" rx="3"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.6H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.4Z"/>',
    pin: '<rect x="4" y="10" width="16" height="10" rx="3"/><path d="M8 10V6.5a4 4 0 0 1 8 0V10"/><path d="M12 14.5v.01"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 15V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    edit: '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="M13.5 6.5 17.5 10.5"/>',
    up: '<path d="M12 19V6"/><path d="M6.5 11.5 12 6l5.5 5.5"/>',
    down: '<path d="M12 5v13"/><path d="M6.5 12.5 12 18l5.5-5.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    shield: '<path d="M12 3.5 19.5 6v6c0 4.5-3 7.5-7.5 9-4.5-1.5-7.5-4.5-7.5-9V6L12 3.5Z"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/>',
    tag: '<path d="M20.5 12.5 12 21l-9-9 8.5-8.5H20.5v8.5Z"/><path d="M16.5 7.5h.01"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    link: '<path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.5 6"/><path d="M14 11a4 4 0 0 0-5.7 0L5.7 13.6a4 4 0 1 0 5.7 5.7L12.5 18"/>',
    note: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    sort: '<path d="M7 4v16"/><path d="M4 17l3 3 3-3"/><path d="M17 20V4"/><path d="M14 7l3-3 3 3"/>',
    moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.8 6.8 0 0 0 9.7 9.7Z"/>'
  };

  function svg(name, size, extra) {
    var d = P[name] || '';
    var s = size || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' + (extra || '') + '>' + d + '</svg>';
  }

  root.Ethan = root.Ethan || {};
  root.Ethan.Icons = { svg: svg, paths: P };
})(typeof globalThis !== 'undefined' ? globalThis : this);
