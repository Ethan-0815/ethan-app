/*!
 * 工具箱 · 百分比计算
 * 三个模式：求一个数的百分之多少 / 求百分比变化 / 求一个数占另一个数的百分比。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const MODES = [
    { id: 'of', label: '求百分之多少' },
    { id: 'change', label: '求变化' },
    { id: 'ratio', label: '求占比' }
  ];

  const LABELS = {
    of: { a: '数字', b: '百分比', ah: '例如 200', bh: '例如 15', bu: '%' },
    change: { a: '原数', b: '新数', ah: '例如 100', bh: '例如 120' },
    ratio: { a: '部分值', b: '总数值', ah: '例如 30', bh: '例如 120' }
  };

  TB.pages.percent = function () {
    const view = F.frame({ title: '百分比计算', footer: false });
    let mode = 'of';

    const modeSeg = ui.segmented(MODES, mode, function (id) {
      mode = id;
      applyLabels();
      run();
    });

    const inputA = ui.textInput({ numeric: true, className: 'input--num' });
    const inputB = ui.textInput({ numeric: true, className: 'input--num' });
    const labelA = ui.h('span', { text: '' });
    const labelB = ui.h('span', { text: '' });
    const unitB = ui.h('span', { class: 'field__unit', text: '' });
    const errorA = ui.h('div', { class: 'field__error' });
    const errorB = ui.h('div', { class: 'field__error' });
    const resultHost = ui.h('div', {});

    const fieldA = ui.h('div', { class: 'field' }, [
      ui.h('label', { class: 'field__label' }, [labelA]),
      inputA, errorA
    ]);
    const fieldB = ui.h('div', { class: 'field' }, [
      ui.h('label', { class: 'field__label' }, [labelB, unitB]),
      inputB, errorB
    ]);

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '计算方式' }),
        modeSeg
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '填写数值' }),
        fieldA, fieldB
      ]),
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    function applyLabels() {
      const l = LABELS[mode];
      labelA.textContent = l.a;
      labelB.textContent = l.b;
      inputA.placeholder = l.ah;
      inputB.placeholder = l.bh;
      unitB.textContent = l.u || '';
      unitB.style.display = l.u ? 'inline' : 'none';
      setError('a', '');
      setError('b', '');
    }

    function setError(which, message) {
      if (which === 'a') { errorA.textContent = message || ''; ui.markInvalid(inputA, !!message); }
      else { errorB.textContent = message || ''; ui.markInvalid(inputB, !!message); }
    }

    function run() {
      setError('a', '');
      setError('b', '');
      const a = U.str(inputA.value).trim();
      const b = U.str(inputB.value).trim();

      if (a === '' || b === '') { renderIdle(); return; }

      if (mode === 'of') {
        const r = TB.numbers.percentOf(a, b);
        if (!r.ok) { routeError(r, a, b); return; }
        renderResult(
          '计算结果',
          U.formatNumber(r.value, 6),
          [
            [r.number + ' 的 ' + U.formatNumber(r.percent, 6) + '%', '= ' + U.formatNumber(r.value, 6)],
            ['等价写法', r.number + ' × ' + U.formatNumber(r.percent, 6) + '%']
          ],
          'of'
        );
        return;
      }

      if (mode === 'change') {
        const r = TB.numbers.percentChange(a, b);
        if (!r.ok) { routeError(r, a, b); return; }
        const up = r.direction === 'up';
        const same = r.direction === 'same';
        const prefix = same ? '' : (up ? '+' : '−');
        renderResult(
          '变化比例',
          prefix + U.formatNumber(Math.abs(r.value), 4) + '%',
          [
            ['变化方向', same ? '没有变化' : (up ? '增加 ↑' : '减少 ↓')],
            ['变化量', (same ? '' : (up ? '+' : '−')) + U.formatNumber(Math.abs(r.diff), 6)],
            ['计算方式', '(' + r.now + ' − ' + r.old + ') ÷ |' + r.old + '|']
          ],
          'change',
          same ? null : (up ? 'ok' : 'warn')
        );
        return;
      }

      const r = TB.numbers.percentRatio(a, b);
      if (!r.ok) { routeError(r, a, b); return; }
      renderResult(
        '占比',
        U.formatNumber(r.value, 4) + '%',
        [
          [r.part + ' 占 ' + r.whole + ' 的比例', U.formatNumber(r.value, 4) + '%'],
          ['等价写法', r.part + ' ÷ ' + r.whole + ' × 100%']
        ],
        'ratio'
      );
    }

    function routeError(r, a, b) {
      if (r.code === 'DIV_ZERO') {
        setError('b', r.message);
      } else if (U.parseNum(a) === null) {
        setError('a', r.message);
      } else {
        setError('b', r.message);
      }
      renderIdle();
    }

    function renderResult(title, bigText, rows, kind, tone) {
      ui.clear(resultHost);
      const rowsEl = ui.h('div', { class: 'rows', style: { marginTop: '14px' } });
      rows.forEach(function (pair) { rowsEl.appendChild(ui.rowItem(pair[0], pair[1])); });
      resultHost.appendChild(ui.h('div', { class: 'resultcard', dataset: { result: kind } }, [
        ui.h('div', { class: 'resultcard__label', text: title }),
        ui.h('div', { class: 'bignum', text: bigText }),
        rowsEl,
        tone ? ui.h('div', { style: { marginTop: '10px' } }, [
          ui.h('div', { class: 'badgerow' }, [
            ui.h('span', { class: 'badge badge--' + (tone === 'ok' ? 'ok' : 'warn'), text: tone === 'ok' ? '结果是上升' : '结果是下降' })
          ])
        ]) : null
      ]));
      F.animateIn(resultHost, { distance: 6 });
    }

    function renderIdle() {
      ui.clear(resultHost);
      resultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '例子' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('求百分之多少', '200 的 15% → 30'),
          ui.rowItem('求变化', '100 → 120，变化 +20%'),
          ui.rowItem('求占比', '30 占 120 的 → 25%')
        ]),
        ui.h('div', { class: 'field__hint', text: '两个数值都填好后会自动计算结果。' })
      ]));
    }

    [inputA, inputB].forEach(function (input) {
      input.addEventListener('input', ui.debounce(run, 120));
    });

    return {
      el: view.el,
      onEnter: function () { applyLabels(); renderIdle(); },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
