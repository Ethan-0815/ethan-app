/*!
 * 工具箱 · 单位换算
 * 只保留常见单位（长度 / 重量 / 温度 / 面积 / 容量 / 速度）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages.units = function () {
    const view = F.frame({ title: '单位换算', footer: false });
    const cats = TB.units.CATEGORIES;
    let catIndex = 0;
    let fromId = cats[0].units[0].id;
    let toId = cats[0].units[1] ? cats[0].units[1].id : cats[0].units[0].id;

    const valueInput = ui.textInput({ numeric: true, className: 'input--num', placeholder: '输入数值，例如 100' });
    const valueError = ui.h('div', { class: 'field__error' });
    const resultHost = ui.h('div', {});

    const catSeg = ui.segmented(cats.map(function (c) {
      return { id: c.id, label: c.emoji + ' ' + c.label };
    }), cats[0].id, function (id) {
      catIndex = cats.map(function (c) { return c.id; }).indexOf(id);
      const cat = cats[catIndex];
      fromId = cat.units[0].id;
      toId = cat.units[1] ? cat.units[1].id : cat.units[0].id;
      renderSelects();
      run();
    });

    const fromSelect = ui.h('select', { class: 'input', onChange: function () { fromId = fromSelect.value; run(); } });
    const toSelect = ui.h('select', { class: 'input', onChange: function () { toId = toSelect.value; run(); } });

    function renderSelects() {
      const cat = cats[catIndex];
      [fromSelect, toSelect].forEach(function (sel) {
        ui.clear(sel);
        cat.units.forEach(function (unit) {
          sel.appendChild(ui.h('option', { value: unit.id, text: unit.label + '（' + unit.short + '）' }));
        });
      });
      fromSelect.value = fromId;
      toSelect.value = toId;
    }

    function swapUnits() {
      const a = fromId;
      fromId = toId;
      toId = a;
      renderSelects();
      run();
    }

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '换算类型' }),
        catSeg
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '数值' }),
        valueInput,
        valueError
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '单位' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '从' })]),
          fromSelect
        ]),
        ui.h('div', { style: { display: 'flex', justifyContent: 'center', margin: '-6px 0 12px' } }, [
          ui.h('button', {
            class: 'btn btn--soft btn--sm', type: 'button', dataset: { action: 'swap' },
            onClick: swapUnits
          }, [ui.icon('swap', { size: 18 }), ui.h('span', { text: '交换单位' })])
        ]),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '转换为' })]),
          toSelect
        ])
      ]),
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    function run() {
      valueError.textContent = '';
      ui.markInvalid(valueInput, false);
      const cat = cats[catIndex];
      const raw = U.str(valueInput.value).trim();

      if (raw === '') { renderIdle(); return; }

      const r = TB.units.convert(cat.id, fromId, toId, raw);
      if (!r.ok) {
        valueError.textContent = r.message;
        ui.markInvalid(valueInput, true);
        renderIdle();
        return;
      }

      const fromUnit = TB.units.unitOf(cat, fromId);
      const toUnit = TB.units.unitOf(cat, toId);
      const value = U.parseNum(raw);

      const table = ui.h('div', { class: 'rows', style: { marginTop: '14px' } });
      cat.units.forEach(function (unit) {
        const one = TB.units.convert(cat.id, fromUnit.id, unit.id, String(value));
        if (one.ok) table.appendChild(ui.rowItem(unit.label + '（' + unit.short + '）', one.text + ' ' + unit.short));
      });

      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'resultcard', dataset: { result: 'units' } }, [
        ui.h('div', { class: 'resultcard__label', text: U.formatNumber(value, 6) + ' ' + fromUnit.short + ' =' }),
        ui.h('div', { class: 'bignum' }, [
          ui.h('span', { text: r.text }),
          ui.h('span', { class: 'bignum__unit', text: r.unit })
        ]),
        ui.h('div', { class: 'field__hint', text: fromUnit.label + ' → ' + toUnit.label }),
        table
      ]));
      F.animateIn(resultHost, { distance: 6 });
    }

    function renderIdle() {
      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '小提示' }),
        ui.h('div', { class: 'columns' }, [
          ui.rowItem('长度', '毫米 · 厘米 · 米 · 千米'),
          ui.rowItem('重量', '克 · 千克 · 吨'),
          ui.rowItem('温度', '摄氏度 ⇄ 华氏度'),
          ui.rowItem('面积', '平方厘米 · 平方米 · 平方千米'),
          ui.rowItem('容量', '毫升 · 升'),
          ui.rowItem('速度', '米/秒 · 千米/小时')
        ])
      ]));
    }

    valueInput.addEventListener('input', ui.debounce(run, 120));

    return {
      el: view.el,
      onEnter: function () { renderSelects(); renderIdle(); },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
