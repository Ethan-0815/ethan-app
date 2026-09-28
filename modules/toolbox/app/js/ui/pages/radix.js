/*!
 * 工具箱 · 进制转换
 * 二进制 / 八进制 / 十进制 / 十六进制。使用 BigInt，大数字不丢精度。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const EXAMPLES = { 2: '1010', 8: '777', 10: '255', 16: 'FF' };

  TB.pages.radix = function () {
    const view = F.frame({ title: '进制转换', footer: false });
    let fromBase = 10;

    const baseSeg = ui.segmented(TB.radix.BASES.map(function (b) {
      return { id: String(b.base), label: b.label };
    }), String(fromBase), function (id) {
      fromBase = Number(id);
      renderHint();
      run();
    });

    const input = ui.textInput({ placeholder: '输入数字，例如 255', className: 'input--num input--mono' });
    const inputError = ui.h('div', { class: 'field__error' });
    const hint = ui.h('div', { class: 'field__hint' });
    const resultHost = ui.h('div', {});

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '输入进制' }),
        baseSeg
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '数字' }),
        input,
        inputError,
        hint
      ]),
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    /**
     * 描述随当前进制变化：把"该输什么、别的进制的数字该去哪儿"讲清楚。
     * compact=true 时只保留基本说明——因为报错信息里已经含了切换进制的指引，避免重复。
     */
    function renderHint(compact) {
      const info = TB.radix.baseInfo(fromBase);
      const example = EXAMPLES[info.base];
      input.placeholder = '输入' + info.label + '数字，例如 ' + example;
      const parts = ['当前按「' + info.label + '」解析：' + info.allow + '（例如 ' + example + '）'];
      if (info.prefix) parts.push('前缀 ' + info.prefix + ' 可以省略');
      if (!compact) {
        parts.push(info.base === 10
          ? '要输入 FF 这类十六进制数，请把上面改成「十六进制」'
          : '要输入 255 这类十进制数，请把上面改成「十进制」');
      }
      hint.textContent = parts.join('；') + '。';
    }

    function run() {
      inputError.textContent = '';
      ui.markInvalid(input, false);
      const raw = U.str(input.value).trim();
      if (raw === '') { renderIdle(); return; }

      const r = TB.radix.convert(raw, fromBase);
      if (!r.ok) {
        inputError.textContent = r.message;
        ui.markInvalid(input, true);
        renderHint(true);              // 报错里已有切换指引，这里不再重复
        renderIdle();
        return;
      }

      renderHint(false);
      const grid = ui.h('div', { class: 'resultgrid' });
      r.results.forEach(function (item) {
        grid.appendChild(ui.resultCell(item.label, item.text, {
          copyLabel: item.label + ' 已复制',
          highlight: item.base === 10
        }));
      });

      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card', dataset: { result: 'radix' } }, [
        ui.h('div', { class: 'card__title', text: '转换结果（点右侧按钮可复制）' }),
        grid,
        r.negative ? ui.h('div', { style: { marginTop: '12px' } }, [
          ui.notice('输入的负数已按同样进制换算，结果保留负号。')
        ]) : null
      ]));
      F.animateIn(resultHost, { distance: 6 });
    }

    function renderIdle() {
      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '试试看' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('十进制 255', '二进制 11111111'),
          ui.rowItem('十进制 255', '十六进制 FF'),
          ui.rowItem('十六进制 A0', '十进制 160'),
          ui.rowItem('负数 -10', '二进制 -1010'),
          ui.rowItem('0', '所有进制都是 0')
        ]),
        ui.h('div', { class: 'field__hint', text: '大小写十六进制都可以输入，0、负数与大数字同样支持。' })
      ]));
    }

    input.addEventListener('input', ui.debounce(run, 120));

    return {
      el: view.el,
      onEnter: function () { renderHint(); renderIdle(); },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
