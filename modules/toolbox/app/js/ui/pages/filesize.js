/*!
 * 工具箱 · 文件大小换算
 * 默认十进制（1 KB = 1000 B），可切换到 1024 进制（1 KiB = 1024 B）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const PREF_KEY = 'filesize.binary';

  TB.pages.filesize = function () {
    const view = F.frame({ title: '文件大小换算', footer: false });
    let binary = TB.recent.getPref(PREF_KEY, false) === true;
    let unitIndex = 2;                 // 默认 MB

    const valueInput = ui.textInput({ numeric: true, className: 'input--num', placeholder: '输入数值，例如 1.5' });
    const valueError = ui.h('div', { class: 'field__error' });
    const unitSelect = ui.h('select', { class: 'input', onChange: function () { unitIndex = Number(unitSelect.value); run(); } });
    const resultHost = ui.h('div', {});

    const binarySwitch = ui.switchRow(
      '使用 1024 进制',
      '开启后按 1 KiB = 1024 B 计算（系统里的文件大小通常这样显示）',
      binary,
      function (on) {
        binary = on;
        TB.recent.setPref(PREF_KEY, on);
        renderUnits();
        run();
      }
    );

    function renderUnits() {
      const units = binary ? U.BYTE_UNITS_BIN : U.BYTE_UNITS_DEC;
      ui.clear(unitSelect);
      units.forEach(function (label, index) {
        const hint = index === 0 ? '（字节）' : (binary ? '（1024 ' + units[index - 1] + '）' : '（1000 ' + units[index - 1] + '）');
        unitSelect.appendChild(ui.h('option', { value: String(index), text: label + ' ' + hint }));
      });
      unitSelect.value = String(U.clamp(unitIndex, 0, units.length - 1));
      unitIndex = Number(unitSelect.value);
    }

    const switchCard = ui.h('div', { class: 'card' }, [
      ui.h('div', { class: 'card__title', text: '进制方式' }),
      binarySwitch,
      ui.h('div', { class: 'field__hint', text: '默认十进制：1 KB = 1000 B；开启 1024 进制后单位写作 KiB / MiB。' })
    ]);

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '数值与单位' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '数值' })]),
          valueInput, valueError
        ]),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '单位' })]),
          unitSelect
        ])
      ]),
      switchCard,
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    function run() {
      valueError.textContent = '';
      ui.markInvalid(valueInput, false);
      const raw = U.str(valueInput.value).trim();
      if (raw === '') { renderIdle(); return; }

      const r = TB.numbers.convertBytes(raw, unitIndex, binary);
      if (!r.ok) {
        valueError.textContent = r.message;
        ui.markInvalid(valueInput, true);
        renderIdle();
        return;
      }

      const units = binary ? U.BYTE_UNITS_BIN : U.BYTE_UNITS_DEC;
      const rows = ui.h('div', { class: 'rows', style: { marginTop: '14px' } });
      r.results.forEach(function (item) {
        rows.appendChild(ui.resultCell(item.label, item.text, {
          copyLabel: item.label + ' 已复制'
        }));
      });

      const lines = r.results.map(function (item) { return item.label + ': ' + item.text; }).join('\n');

      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'resultcard', dataset: { result: 'filesize' } }, [
        ui.h('div', { class: 'resultcard__label', text: U.formatNumber(U.parseNum(raw), 8) + ' ' + units[unitIndex] + ' =' }),
        ui.h('div', { class: 'bignum', text: r.bytesText }),
        ui.h('div', { class: 'field__hint', text: '共 ' + U.formatNumber(r.bytes, 0) + ' 字节（' + (binary ? '1024' : '1000') + ' 进制）' }),
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            onClick: function () { ui.copyWithFeedback(lines, '全部结果已复制'); }
          }, [ui.icon('copy', { size: 17 }), ui.h('span', { text: '复制全部结果' })])
        ]),
        rows
      ]));
      F.animateIn(resultHost, { distance: 6 });
    }

    function renderIdle() {
      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '常见换算' }),
        ui.h('div', { class: 'rows' }, (binary ? [
          ['1 KiB', '1,024 B'],
          ['1 MiB', '1,024 KiB'],
          ['1 GiB', '1,024 MiB'],
          ['1 TiB', '1,024 GiB']
        ] : [
          ['1 KB', '1,000 B'],
          ['1 MB', '1,000 KB'],
          ['1 GB', '1,000 MB'],
          ['1 TB', '1,000 GB']
        ]).map(function (pair) { return ui.rowItem(pair[0], pair[1]); }))
      ]));
    }

    valueInput.addEventListener('input', ui.debounce(run, 120));

    return {
      el: view.el,
      onEnter: function () { renderUnits(); renderIdle(); },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
