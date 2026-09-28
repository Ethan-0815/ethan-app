/*!
 * 工具箱 · 时间戳转换
 * 双向：时间戳 → 日期时间、日期时间 → 时间戳。
 * 秒 / 毫秒由界面明确切换，默认使用设备当前时区并显示时区信息。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages.timestamp = function () {
    const view = F.frame({ title: '时间戳转换', footer: false });
    let unit = 's';

    const unitSeg = ui.segmented(TB.time.UNITS.map(function (u) {
      return { id: u.id, label: u.label };
    }), unit, function (id) {
      unit = id;
      runBoth();
    });

    /* ---------------- 时间戳 → 日期 ---------------- */

    const tsInput = ui.textInput({ inputmode: 'numeric', placeholder: '例如 1750000000', className: 'input--num input--mono' });
    const tsError = ui.h('div', { class: 'field__error' });
    const tsResultHost = ui.h('div', {});

    /* ---------------- 日期 → 时间戳 ---------------- */

    const dateInput = ui.h('input', { class: 'input', type: 'date', onChange: function () { runDate(); } });
    const timeInput = ui.h('input', { class: 'input', type: 'time', step: '1', onChange: function () { runDate(); } });
    const dateError = ui.h('div', { class: 'field__error' });
    const dateResultHost = ui.h('div', {});

    const nowParts = TB.time.nowParts();
    dateInput.value = nowParts.date;
    timeInput.value = nowParts.time;

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '时间戳单位' }),
        unitSeg,
        ui.h('div', { class: 'field__hint', text: unitFull() + ' · 时区：' + timezoneText() })
      ]),

      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '一、时间戳 → 日期时间' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: unitFull() })]),
          tsInput, tsError
        ]),
        ui.h('div', { class: 'btnrow btnrow--wrap', style: { gap: '8px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', dataset: { action: 'now' },
            onClick: function () {
              tsInput.value = String(unit === 'ms' ? Date.now() : Math.floor(Date.now() / 1000));
              ui.markInvalid(tsInput, false);
              tsError.textContent = '';
              runTimestamp();
            }
          }, [ui.icon('clock', { size: 17 }), ui.h('span', { text: '使用当前时间' })]),
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            onClick: function () { tsInput.value = ''; tsError.textContent = ''; ui.markInvalid(tsInput, false); renderTsIdle(); }
          }, [ui.h('span', { text: '清空' })])
        ])
      ]),
      tsResultHost,

      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '二、日期时间 → 时间戳' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '日期' })]),
          dateInput
        ]),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '时间（可留空，默认 00:00:00）' })]),
          timeInput,
          dateError
        ]),
        ui.h('div', { class: 'btnrow btnrow--wrap', style: { gap: '8px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', dataset: { action: 'now-date' },
            onClick: function () {
              const now = TB.time.nowParts();
              dateInput.value = now.date;
              timeInput.value = now.time;
              runDate();
            }
          }, [ui.icon('clock', { size: 17 }), ui.h('span', { text: '使用当前时间' })])
        ])
      ]),
      dateResultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    function unitFull() {
      return TB.time.unitInfo(unit).full;
    }

    function timezoneText() {
      const name = U.timezoneName();
      return U.timezoneLabel(new Date()) + (name ? ' · ' + name : '');
    }

    /* ---------------- 渲染 ---------------- */

    function renderTsIdle() {
      ui.clear(tsResultHost);
      tsResultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '提示' }),
        ui.h('div', { class: 'field__hint', text: '输入时间戳后会自动换算成日期时间；如果发现结果年份很离谱，多半是秒 / 毫秒选错了。' })
      ]));
    }

    function runTimestamp() {
      const raw = U.str(tsInput.value).trim();
      tsError.textContent = '';
      ui.markInvalid(tsInput, false);
      if (raw === '') { renderTsIdle(); return null; }

      const r = TB.time.timestampToDate(raw, unit);
      if (!r.ok) {
        tsError.textContent = r.message;
        ui.markInvalid(tsInput, true);
        renderTsIdle();
        return null;
      }

      ui.clear(tsResultHost);
      tsResultHost.appendChild(ui.h('div', { class: 'card', dataset: { result: 'ts-to-date' } }, [
        ui.h('div', { class: 'card__title', text: '换算结果' }),
        ui.h('div', { class: 'resultcard__label', text: '本地时间（' + U.timezoneLabel(new Date(r.ms)) + '）' }),
        ui.h('div', { class: 'bignum bignum--sm', text: r.local }),
        ui.h('div', { class: 'field__hint', text: r.dateCn }),
        ui.h('div', { class: 'rows', style: { marginTop: '14px' } }, [
          ui.rowItem('ISO 8601', r.iso),
          ui.rowItem('UTC', r.utc),
          ui.rowItem('所在时区', r.timezone),
          ui.rowItem('距今', r.relative)
        ]),
        r.hint ? ui.h('div', { style: { marginTop: '12px' } }, [ui.notice(r.hint, 'warn')]) : null,
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            onClick: function () { ui.copyWithFeedback(r.local, '时间已复制'); }
          }, [ui.icon('copy', { size: 17 }), ui.h('span', { text: '复制时间' })])
        ])
      ]));
      F.animateIn(tsResultHost, { distance: 6 });
      return r;
    }

    function renderDateIdle() {
      ui.clear(dateResultHost);
      dateResultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '提示' }),
        ui.h('div', { class: 'field__hint', text: '选择日期与时间后会同时给出秒与毫秒两种时间戳，复制任意一种即可。' })
      ]));
    }

    function runDate() {
      const date = U.str(dateInput.value).trim();
      const time = U.str(timeInput.value).trim();
      dateError.textContent = '';
      ui.markInvalid(timeInput, false);
      if (date === '') { renderDateIdle(); return null; }

      const r = TB.time.dateToTimestamp({ date: date, time: time, unit: unit });
      if (!r.ok) {
        dateError.textContent = r.message;
        ui.markInvalid(timeInput, /时间/.test(r.message));
        renderDateIdle();
        return null;
      }

      ui.clear(dateResultHost);
      dateResultHost.appendChild(ui.h('div', { class: 'card', dataset: { result: 'date-to-ts' } }, [
        ui.h('div', { class: 'card__title', text: '换算结果' }),
        ui.h('div', { class: 'resultcard__label', text: '本地时间（' + U.timezoneLabel(new Date(r.ms)) + '）' }),
        ui.h('div', { class: 'bignum bignum--sm', text: r.local }),
        ui.h('div', { class: 'field__hint', text: r.dateCn }),
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.resultCell('Unix 时间戳（秒）', String(r.unitSeconds), { copyLabel: '秒级时间戳已复制' }),
          ui.h('div', { style: { height: '10px' } }),
          ui.resultCell('Unix 时间戳（毫秒）', String(r.unitMillis), { copyLabel: '毫秒级时间戳已复制' })
        ]),
        ui.h('div', { class: 'field__hint', text: '换算基于设备当前时区 ' + r.timezone + '。' })
      ]));
      F.animateIn(dateResultHost, { distance: 6 });
      return r;
    }

    function runBoth() {
      ui.clear(tsResultHost);
      ui.clear(dateResultHost);
      if (U.str(tsInput.value).trim() !== '') runTimestamp(); else renderTsIdle();
      if (U.str(dateInput.value).trim() !== '') runDate(); else renderDateIdle();
    }

    tsInput.addEventListener('input', ui.debounce(function () { runTimestamp(); }, 140));

    return {
      el: view.el,
      onEnter: function () {
        renderTsIdle();
        if (dateInput.value) runDate(); else renderDateIdle();
      },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
