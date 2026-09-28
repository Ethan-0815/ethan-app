/* ==========================================================================
   Travel Footprint — ui/parts.js
   Shared UI primitives: buttons, ticket stub, cards, empty state, overlays.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var h = UI.dom.h;
  var svg = UI.dom.svg;
  var icon = UI.dom.icon;

  /* ---------------------------------------------------------- buttons --- */

  function primaryButton(label, onClick, opts) {
    var o = opts || {};
    return h('button', {
      class: 'btn btn--primary' + (o.block ? ' btn--block' : '') + (o.class ? ' ' + o.class : ''),
      type: 'button',
      onClick: onClick,
      disabled: o.disabled || false
    }, [
      o.icon ? icon(o.icon, { size: o.iconSize || 18 }) : null,
      h('span', { class: 'btn__label' }, label)
    ]);
  }

  function ghostButton(label, onClick, opts) {
    var o = opts || {};
    return h('button', {
      class: 'btn btn--ghost' + (o.block ? ' btn--block' : '') + (o.class ? ' ' + o.class : ''),
      type: 'button',
      onClick: onClick,
      disabled: o.disabled || false
    }, [
      o.icon ? icon(o.icon, { size: o.iconSize || 18 }) : null,
      h('span', { class: 'btn__label' }, label)
    ]);
  }

  function iconButton(name, onClick, opts) {
    var o = opts || {};
    return h('button', {
      class: 'icon-btn' + (o.class ? ' ' + o.class : ''),
      type: 'button',
      'aria-label': o.label || name,
      title: o.label || '',
      onClick: onClick
    }, icon(name, { size: o.size || 21, strokeWidth: o.strokeWidth }));
  }

  /* ----------------------------------------------------------- ticket --- */
  /**
   * The signature ticket-stub card.
   *   ┌──────────────────────────┐
   *   │ 桂林                2026 │
   *   │ 中国 · 广西         08.12 │
   *   │                          │
   *   │ 4 天                3 张 │
   *   │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
   *   │ TRAVEL FOOTPRINT   001   │
   *   └──────────────────────────┘
   */
  function ticket(entry, opts) {
    var o = opts || {};
    var trip = entry.trip || entry;
    var city = entry.city;
    var index = o.index || 1;

    var startKey = TF.model.tripSortKey(trip);
    var year = TF.util.yearOf(startKey);
    var startShort = TF.util.formatDot(startKey).slice(5) || '';
    var days = entry.days !== undefined ? entry.days : TF.util.daysBetween(trip.startDate, trip.endDate);
    var photoCount = entry.photoCount || 0;

    var cityLabel = city ? TF.model.cityName(city) : '未命名地点';
    var geo = city ? TF.model.geoLine(city) : '';

    var top = h('div.ticket__top', [
      h('div.ticket__headline', [
        h('h3.ticket__city', cityLabel),
        geo ? h('p.ticket__geo', geo) : null
      ]),
      h('div.ticket__stamp', [
        year ? h('span.ticket__year', String(year)) : null,
        h('span.ticket__date', startShort)
      ])
    ]);

    var metaBits = [
      h('span.ticket__meta-item', [
        h('strong', String(days)),
        h('span', ' 天')
      ])
    ];
    if (photoCount > 0) {
      metaBits.push(h('span.ticket__meta-dot'));
      metaBits.push(h('span.ticket__meta-item', [
        h('strong', String(photoCount)),
        h('span', ' 张照片')
      ]));
    }
    var attCount = entry.attachmentCount || 0;
    if (attCount > 0) {
      metaBits.push(h('span.ticket__meta-dot'));
      metaBits.push(h('span.ticket__meta-item', [
        h('strong', String(attCount)),
        h('span', ' 个附件')
      ]));
    }

    var body = h('div.ticket__body', [
      h('div.ticket__meta', metaBits),
      trip.note ? h('p.ticket__note.t-clamp-2', trip.note) : null
    ]);

    // perforation + footer
    var perf = h('div.ticket__perf', [
      h('span.ticket__notch.ticket__notch--l'),
      h('span.ticket__dash'),
      h('span.ticket__notch.ticket__notch--r')
    ]);

    var footer = h('div.ticket__foot', [
      h('span.ticket__brand', 'TRAVEL FOOTPRINT'),
      h('span.ticket__serial', TF.util.pad2(index % 1000 + (index === 1000 ? 0 : 0)).toString().padStart(3, '0'))
    ]);

    var el = h('article', {
      class: 'ticket' + (o.compact ? ' ticket--compact' : '') + (o.class ? ' ' + o.class : ''),
      onClick: o.onClick || null,
      role: o.onClick ? 'button' : null,
      tabindex: o.onClick ? '0' : null
    }, [top, body, perf, footer]);

    return el;
  }

  /* -------------------------------------------------------- city card --- */

  function cityCard(entry, opts) {
    var o = opts || {};
    var city = entry.city;
    var visits = entry.visitCount;

    return h('button.city-card.u-tap', {
      type: 'button',
      onClick: o.onClick || null
    }, [
      h('div.city-card__initial', TF.model.cityName(city).charAt(0)),
      h('div.city-card__info', [
        h('h3.city-card__name', TF.model.cityName(city)),
        h('p.city-card__geo', TF.model.geoLine(city) || '未填写地区')
      ]),
      h('div.city-card__side', [
        visits > 0
          ? h('span.city-card__visits', ['去过 ', h('strong', String(visits)), ' 次'])
          : h('span.city-card__visits.city-card__visits--none', '还没记录'),
        entry.lastVisit ? h('span.city-card__date', TF.util.formatDotMonth(entry.lastVisit)) : null
      ]),
      icon('chevron', { size: 16, class: 'city-card__chev' })
    ]);
  }

  /* ------------------------------------------------------ empty state --- */

  /**
   * Empty states are first-class: deliberate, illustrated, never looking like
   * a broken page. `glyph` picks a decorative mark.
   */
  function emptyState(opts) {
    var o = opts || {};
    return h('div.empty', { class: o.class || '' }, [
      h('div.empty__art', { class: 'empty__art--' + (o.glyph || 'compass') }, [
        decorative(o.glyph || 'compass')
      ]),
      h('h3.empty__title', o.title || '还没有内容'),
      o.message ? h('p.empty__message', o.message) : null,
      o.action ? h('div.empty__action', o.action) : null
    ]);
  }

  function decorative(glyph) {
    if (glyph === 'compass') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('circle', { cx: 38, cy: 38, r: 30, stroke: 'var(--sand-3)', 'stroke-width': 1.4 }),
        svg('circle', { cx: 38, cy: 38, r: 21, stroke: 'var(--sand-3)', 'stroke-width': 1, 'stroke-dasharray': '3 5' }),
        svg('path', { d: 'M38 16 L44 38 L38 60 L32 38 Z', fill: 'var(--accent-2)', opacity: 0.55 }),
        svg('path', { d: 'M16 38 L38 32 L60 38 L38 44 Z', fill: 'var(--accent-1)', opacity: 0.28 }),
        svg('circle', { cx: 38, cy: 38, r: 4, fill: 'var(--accent-0)' })
      ]);
    }
    if (glyph === 'timeline') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('path', { d: 'M26 14 V62', stroke: 'var(--sand-3)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        svg('circle', { cx: 26, cy: 24, r: 6.5, fill: 'none', stroke: 'var(--accent-1)', 'stroke-width': 1.8 }),
        svg('circle', { cx: 26, cy: 42, r: 4.5, fill: 'none', stroke: 'var(--teal)', 'stroke-width': 1.6, opacity: 0.7 }),
        svg('circle', { cx: 26, cy: 58, r: 3, fill: 'var(--sand-4)' }),
        svg('path', { d: 'M40 22 H62 M40 42 H54 M40 58 H48', stroke: 'var(--sand-3)', 'stroke-width': 1.6, 'stroke-linecap': 'round' })
      ]);
    }
    if (glyph === 'photos') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('rect', { x: 14, y: 20, width: 44, height: 36, rx: 5, stroke: 'var(--sand-3)', 'stroke-width': 1.5 }),
        svg('circle', { cx: 27, cy: 32, r: 4, fill: 'var(--accent-2)', opacity: 0.6 }),
        svg('path', { d: 'M18 50 L32 37 L42 46 L50 39 L56 45', stroke: 'var(--accent-1)', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.65 }),
        svg('path', { d: 'M22 26 L26 18 H50 L54 26', stroke: 'var(--sand-3)', 'stroke-width': 1.5, 'stroke-linecap': 'round' })
      ]);
    }
    if (glyph === 'search') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('circle', { cx: 34, cy: 34, r: 16, stroke: 'var(--sand-3)', 'stroke-width': 1.6 }),
        svg('path', { d: 'M46 46 L58 58', stroke: 'var(--accent-1)', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.6 }),
        svg('path', { d: 'M27 34 H41 M34 27 V41', stroke: 'var(--sand-4)', 'stroke-width': 1.4, 'stroke-linecap': 'round' })
      ]);
    }
    if (glyph === 'trash') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('path', { d: 'M24 26 H52 L49 62 H27 Z', stroke: 'var(--sand-3)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        svg('path', { d: 'M20 26 H56 M32 26 V19 H44 V26', stroke: 'var(--sand-3)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        svg('path', { d: 'M34 36 V53 M42 36 V53', stroke: 'var(--sand-4)', 'stroke-width': 1.4, 'stroke-linecap': 'round' })
      ]);
    }
    if (glyph === 'globe') {
      return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
        svg('circle', { cx: 38, cy: 38, r: 24, stroke: 'var(--sand-3)', 'stroke-width': 1.4 }),
        svg('ellipse', { cx: 38, cy: 38, rx: 10, ry: 24, stroke: 'var(--sand-3)', 'stroke-width': 1.1 }),
        svg('path', { d: 'M14 38 H62 M18 26 H58 M18 50 H58', stroke: 'var(--sand-3)', 'stroke-width': 1.1 }),
        svg('circle', { cx: 47, cy: 30, r: 3.4, fill: 'var(--accent-1)' }),
        svg('circle', { cx: 32, cy: 45, r: 2.4, fill: 'var(--teal)', opacity: 0.75 })
      ]);
    }
    // default: montage of simple travel marks
    return svg('svg', { width: 76, height: 76, viewBox: '0 0 76 76', fill: 'none' }, [
      svg('path', { d: 'M14 52 L28 30 L38 44 L48 32 L62 52 Z', stroke: 'var(--sand-3)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
      svg('circle', { cx: 24, cy: 22, r: 5, stroke: 'var(--accent-1)', 'stroke-width': 1.5, opacity: 0.6 })
    ]);
  }

  /* --------------------------------------------------------- overlays --- */

  var activeOverlays = [];

  /**
   * Modal overlay. The backdrop is a CHILD element with its own click handler
   * (checking e.target === overlay fails because the backdrop swallows clicks).
   */
  function overlay(contentNode, opts) {
    var o = opts || {};
    var root = document.getElementById('overlay-root') || document.body;

    var el = h('div.overlay', { class: o.class || '' });
    var backdrop = h('div.overlay__backdrop', {
      onClick: o.dismissible === false ? null : function () { close(); }
    });
    var panel = h('div.overlay__panel', { class: 'overlay__panel--' + (o.variant || 'center') }, [contentNode]);

    el.appendChild(backdrop);
    el.appendChild(panel);
    root.appendChild(el);

    var entry = { el: el, onClose: o.onClose || null };
    activeOverlays.push(entry);
    requestAnimationFrame(function () { el.classList.add('is-open'); });

    function close() {
      var i = activeOverlays.indexOf(entry);
      if (i !== -1) activeOverlays.splice(i, 1);
      el.classList.remove('is-open');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
      if (entry.onClose) entry.onClose();
    }

    entry.close = close;
    return entry;
  }

  function closeTopOverlay() {
    if (!activeOverlays.length) return false;
    activeOverlays[activeOverlays.length - 1].close();
    return true;
  }

  function hasOverlay() {
    return activeOverlays.length > 0;
  }

  // Desktop escape hatch: Esc dismisses the topmost overlay. Harmless on
  // mobile (no Esc key) and it makes mouse-driven review sessions much less
  // sticky when a sheet refuses to go away.
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (closeTopOverlay()) e.preventDefault();
    });
  }

  /** Bottom sheet — used for pickers, confirmations, actions. */
  function sheet(contentNode, opts) {
    return overlay(contentNode, Object.assign({}, opts, { variant: 'sheet' }));
  }

  /** Confirm dialog with a clear primary/secondary split. */
  function confirm(opts) {
    var o = opts || {};
    var body = h('div.dialog', [
      h('h3.dialog__title', o.title || '确认操作'),
      h('p.dialog__message', o.message || ''),
      o.detail ? h('p.dialog__detail', o.detail) : null,
      h('div.dialog__actions', [
        ghostButton(o.cancelLabel || '取消', function () { ref.close(); }, { block: true }),
        primaryButton(o.confirmLabel || '确定', function () {
          ref.close();
          if (o.onConfirm) o.onConfirm();
        }, { block: true, class: o.danger ? 'btn--danger' : '' })
      ])
    ]);

    var ref = overlay(body, {
      variant: 'center',
      dismissible: o.dismissible !== false,
      onClose: o.onCancel || null
    });

    return ref;
  }

  /** Simple prompt with one or more text fields. */
  function prompt(opts) {
    var o = opts || {};
    var inputs = [];
    var fields = h('div.dialog__fields');

    (o.fields || [{ name: 'value', label: '', placeholder: '', value: '', multiline: false }])
      .forEach(function (f) {
        var input = f.multiline
          ? h('textarea.field__input', { rows: f.rows || 3, placeholder: f.placeholder || '' })
          : h('input.field__input', { type: f.type || 'text', placeholder: f.placeholder || '' });
        input.value = f.value || '';
        if (f.name) inputs.push({ name: f.name, el: input });
        fields.appendChild(h('label.field', [
          f.label ? h('span.field__label', f.label) : null,
          input
        ]));
      });

    var body = h('div.dialog', [
      o.title ? h('h3.dialog__title', o.title) : null,
      fields,
      h('div.dialog__actions', [
        ghostButton(o.cancelLabel || '取消', function () { ref.close(); }, { block: true }),
        primaryButton(o.confirmLabel || '确定', function () {
          var values = {};
          inputs.forEach(function (i) { values[i.name] = i.el.value; });
          ref.close();
          if (o.onConfirm) o.onConfirm(values);
        }, { block: true })
      ])
    ]);

    var ref = overlay(body, { variant: 'center', onClose: o.onCancel || null });
    setTimeout(function () {
      var first = fields.querySelector('input, textarea');
      if (first) first.focus();
    }, 260);
    return ref;
  }

  /* ------------------------------------------------------------ toast --- */

  var toastEl = null;
  var toastTimer = null;

  function toast(message, opts) {
    var o = opts || {};
    var root = document.getElementById('toast-root') || document.body;

    // native Toast on Android keeps the platform feel
    if (TF.native && TF.native.toast && TF.native.toast(message, o.long)) return;

    if (toastEl && toastEl.parentNode) {
      toastEl.parentNode.removeChild(toastEl);
      toastEl = null;
    }
    clearTimeout(toastTimer);

    toastEl = h('div.toast', { class: o.tone ? 'toast--' + o.tone : '' }, [
      o.icon ? icon(o.icon, { size: 17 }) : null,
      h('span.toast__text', message)
    ]);
    root.appendChild(toastEl);

    requestAnimationFrame(function () { toastEl.classList.add('is-open'); });

    toastTimer = setTimeout(function () {
      if (!toastEl) return;
      toastEl.classList.remove('is-open');
      var el = toastEl;
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 240);
      toastEl = null;
    }, o.duration || 2200);
  }

  /* ------------------------------------------------------ page header --- */

  function pageHeader(opts) {
    var o = opts || {};
    var left = o.showBack
      ? iconButton('back', function () {
          if (o.onBack) o.onBack();
          else if (UI.backHandler) UI.backHandler.backArrow();
        }, { label: '返回' })
      : (o.left || h('div.header__spacer'));

    return h('header.page-header', { class: o.class || '' }, [
      h('div.page-header__side', [left]),
      h('div.page-header__title', [
        h('h1.page-header__heading', o.title || ''),
        o.subtitle ? h('p.page-header__sub', o.subtitle) : null
      ]),
      h('div.page-header__side.page-header__side--right', o.right ? [o.right] : [h('div.header__spacer')])
    ]);
  }

  /* -------------------------------------------------------- progress --- */

  function progressBar(value, total) {
    var pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
    var fill = h('span.progress__fill', { style: { width: pct + '%' } });
    return h('div.progress', [
      h('div.progress__track', [fill]),
      h('span.progress__label', value + ' / ' + total)
    ]);
  }

  UI.parts = {
    primaryButton: primaryButton,
    ghostButton: ghostButton,
    iconButton: iconButton,
    ticket: ticket,
    cityCard: cityCard,
    emptyState: emptyState,
    decorative: decorative,
    overlay: overlay,
    sheet: sheet,
    confirm: confirm,
    prompt: prompt,
    toast: toast,
    closeTopOverlay: closeTopOverlay,
    hasOverlay: hasOverlay,
    pageHeader: pageHeader,
    progressBar: progressBar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
