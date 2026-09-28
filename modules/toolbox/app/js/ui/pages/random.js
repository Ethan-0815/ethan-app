/*!
 * 工具箱 · 随机数 / 随机选择
 * 一个页面两个功能，用分段控件切换：
 *   1) 随机数：整数或小数，可指定小数位数
 *   2) 随机选择：从多行选项里抽取，支持一次抽多个、不重复抽取
 * 随机源优先使用浏览器的安全随机（crypto.getRandomValues）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const FUNCS = [
    { id: 'number', label: '随机数' },
    { id: 'pick', label: '随机选择' }
  ];

  TB.pages.random = function () {
    const view = F.frame({ title: '随机数 / 随机选择' });
    let func = 'number';

    /* ------------------------------------------------------------ 随机数 */

    const minInput = ui.textInput({ numeric: true, className: 'input--num', value: '1', dataset: { role: 'min' } });
    const maxInput = ui.textInput({ numeric: true, className: 'input--num', value: '100', dataset: { role: 'max' } });
    const minError = ui.h('div', { class: 'field__error' });
    const maxError = ui.h('div', { class: 'field__error' });
    let integerMode = true;
    let decimals = 2;

    const modeSeg = ui.segmented([
      { id: 'int', label: '整数' },
      { id: 'dec', label: '小数' }
    ], 'int', function (id) {
      integerMode = id === 'int';
      decWrap.style.display = integerMode ? 'none' : 'block';
      numberResultHost && ui.clear(numberResultHost);
      setNumberError('min', '');
      setNumberError('max', '');
    });

    const decSeg = ui.segmented([
      { id: '1', label: '1 位' },
      { id: '2', label: '2 位' },
      { id: '3', label: '3 位' },
      { id: '4', label: '4 位' }
    ], '2', function (id) { decimals = Number(id); });

    const decWrap = ui.h('div', { class: 'field', style: { display: 'none' } }, [
      ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '小数位数' })]),
      decSeg
    ]);

    const numberResultHost = ui.h('div', {});

    /* ------------------------------------------------------------ 随机选择 */

    const optionsArea = ui.textArea({
      placeholder: '一行一个选项，例如：\n奶茶\n咖啡\n可乐\n果汁',
      rows: 6,
      dataset: { role: 'options' }
    });
    const countInput = ui.textInput({ numeric: true, type: 'number', value: '1', className: 'input--num', dataset: { role: 'count' } });
    const optionsError = ui.h('div', { class: 'field__error' });
    let noRepeat = false;
    let drawn = [];                    // 不重复抽取模式下已经抽过的下标
    const pickResultHost = ui.h('div', {});

    const noRepeatSwitch = ui.switchRow(
      '不重复抽取',
      '开启后，已经抽到过的选项不会再次被抽到，直到全部抽完',
      false,
      function (on) {
        noRepeat = on;
        drawn = [];
        pickResultHost && ui.clear(pickResultHost);
        renderPickIdle();
      }
    );

    /* ------------------------------------------------------------ 组装页面 */

    const numberSection = ui.h('div', {}, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '范围' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '最小值' })]),
          minInput, minError
        ]),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '最大值' })]),
          maxInput, maxError
        ]),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '类型' })]),
          modeSeg
        ]),
        decWrap
      ]),
      numberResultHost,
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'field__hint', text: '最小值不能大于最大值；小数模式下会在区间内随机取值。' })
      ])
    ]);

    const pickSection = ui.h('div', {}, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '选项（一行一个）' }),
        optionsArea,
        optionsError,
        ui.h('div', { class: 'field__hint', text: '会自动忽略空行并去掉首尾空格；至少需要 2 个有效选项。' })
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '抽取设置' }),
        ui.h('div', { class: 'field' }, [
          ui.h('label', { class: 'field__label' }, [ui.h('span', { text: '抽取数量' })]),
          countInput
        ]),
        noRepeatSwitch
      ]),
      pickResultHost
    ]);

    const funcSeg = ui.segmented(FUNCS, func, function (id) {
      func = id;
      numberSection.style.display = func === 'number' ? 'block' : 'none';
      pickSection.style.display = func === 'pick' ? 'block' : 'none';
      renderFooter();
    });

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '功能' }),
        funcSeg
      ]),
      numberSection,
      pickSection,
      ui.h('div', { class: 'page__spacer' })
    ]));

    /* ------------------------------------------------------------ 逻辑：随机数 */

    function setNumberError(which, message) {
      if (which === 'min') { minError.textContent = message || ''; ui.markInvalid(minInput, !!message); }
      else { maxError.textContent = message || ''; ui.markInvalid(maxInput, !!message); }
    }

    function roll() {
      setNumberError('min', '');
      setNumberError('max', '');
      const r = TB.numbers.randomNumber({
        min: minInput.value,
        max: maxInput.value,
        integer: integerMode,
        decimals: decimals
      });
      if (!r.ok) {
        if (r.code === 'EMPTY_INPUT') {
          if (U.str(minInput.value).trim() === '') setNumberError('min', '请输入最小值');
          else setNumberError('max', '请输入最大值');
        } else if (r.code === 'RANGE_INVALID') {
          setNumberError('min', r.message);
          setNumberError('max', r.message);
        } else if (U.parseNum(minInput.value) === null) {
          setNumberError('min', r.message);
        } else {
          setNumberError('max', r.message);
        }
        ui.toast(r.message, { tone: 'danger' });
        return;
      }

      ui.clear(numberResultHost);
      numberResultHost.appendChild(ui.h('div', { class: 'resultcard', dataset: { result: 'random-number' } }, [
        ui.h('div', { class: 'resultcard__label', text: '随机结果' }),
        ui.h('div', { class: 'bignum', text: r.text }),
        ui.h('div', { class: 'field__hint', text: '范围：' + U.formatNumber(U.parseNum(minInput.value), 6) + ' ~ ' +
          U.formatNumber(U.parseNum(maxInput.value), 6) + (integerMode ? '（整数）' : '（' + decimals + ' 位小数）') }),
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.h('div', { class: 'btnrow' }, [
            ui.h('button', {
              class: 'btn btn--ghost', type: 'button', dataset: { action: 'reroll' },
              onClick: roll
            }, [ui.icon('refresh', { size: 18 }), ui.h('span', { text: '重新随机' })]),
            ui.h('button', {
              class: 'btn btn--primary', type: 'button',
              onClick: function () { ui.copyWithFeedback(r.text, '随机数已复制'); }
            }, [ui.icon('copy', { size: 18 }), ui.h('span', { text: '复制' })])
          ])
        ])
      ]));
      F.animateIn(numberResultHost, { distance: 6 });
    }

    /* ------------------------------------------------------------ 逻辑：随机选择 */

    function draw() {
      optionsError.textContent = '';
      ui.markInvalid(optionsArea, false);
      const parsed = TB.numbers.parseOptions(optionsArea.value);

      if (parsed.length < 2) {
        const msg = parsed.length === 0 ? '请先输入选项（一行一个）' : U.ERROR_MESSAGES.OPTIONS_TOO_FEW;
        optionsError.textContent = msg;
        ui.markInvalid(optionsArea, parsed.length > 0);
        ui.toast(msg, { tone: 'danger' });
        return;
      }

      const r = TB.numbers.pick({
        options: parsed,
        count: countInput.value,
        exclude: noRepeat ? drawn : []
      });
      if (!r.ok) {
        ui.toast(r.message, { tone: 'danger' });
        return;
      }

      if (noRepeat) {
        drawn = drawn.concat(r.indices);
      }

      const total = parsed.length;
      const remaining = noRepeat ? total - drawn.length : total;

      ui.clear(pickResultHost);
      const box = ui.h('div', { class: 'resultcard', dataset: { result: 'random-pick' } }, [
        ui.h('div', { class: 'resultcard__label', text: r.items.length > 1 ? '抽中的 ' + r.items.length + ' 个选项' : '抽中的选项' }),
        ui.h('div', {}, r.items.map(function (item) {
          return ui.h('div', { class: 'bignum', dataset: { picked: item.text }, text: item.text });
        }))
      ]);

      if (noRepeat) {
        box.appendChild(ui.h('div', { class: 'field__hint', text: '已抽取 ' + drawn.length + ' / ' + total + ' 个选项' }));
        if (remaining <= 0) {
          box.appendChild(ui.h('div', { style: { marginTop: '12px' } }, [
            ui.notice('所有选项都已经抽取过了', 'warn', 'check')
          ]));
        }
      }

      box.appendChild(ui.h('div', { style: { marginTop: '14px' } }, [
        ui.h('div', { class: 'btnrow' }, [
          ui.h('button', {
            class: 'btn btn--ghost', type: 'button', dataset: { action: 'redraw' },
            onClick: draw
          }, [ui.icon('refresh', { size: 18 }), ui.h('span', { text: '再抽一次' })]),
          ui.h('button', {
            class: 'btn btn--soft', type: 'button',
            onClick: function () { ui.copyWithFeedback(r.items.map(function (i) { return i.text; }).join('\n'), '结果已复制'); }
          }, [ui.icon('copy', { size: 18 }), ui.h('span', { text: '复制' })])
        ])
      ]));

      if (noRepeat) {
        box.appendChild(ui.h('div', { style: { marginTop: '10px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--block btn--sm', type: 'button', dataset: { action: 'reset' },
            onClick: function () {
              drawn = [];
              ui.clear(pickResultHost);
              renderPickIdle();
              ui.toast('已重新开始，所有选项都可以再次被抽到');
            }
          }, [ui.icon('refresh', { size: 17 }), ui.h('span', { text: '重新开始' })])
        ]));
      }

      pickResultHost.appendChild(box);
      F.animateIn(pickResultHost, { distance: 6 });
      renderFooter();
    }

    function renderPickIdle() {
      if (pickResultHost.childNodes.length) return;
      pickResultHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '怎么用' }),
        ui.h('div', { class: 'columns' }, [
          ui.rowItem('第一步', '每行填一个选项'),
          ui.rowItem('第二步', '设置抽取数量（默认 1 个）'),
          ui.rowItem('第三步', '点下方「开始随机选择」')
        ]),
        ui.h('div', { class: 'field__hint', text: '开启「不重复抽取」后，抽过的选项不会再次出现。' })
      ]));
    }

    /* ------------------------------------------------------------ 底部按钮 */

    function renderFooter() {
      ui.clear(view.footer);
      view.footer.classList.remove('page__footer--empty');
      if (func === 'number') {
        view.footer.appendChild(ui.h('button', {
          class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'roll' },
          onClick: roll
        }, [ui.icon('refresh', { size: 19 }), ui.h('span', { text: '随机' })]));
      } else {
        view.footer.appendChild(ui.h('button', {
          class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'draw' },
          onClick: draw
        }, [ui.icon('refresh', { size: 19 }), ui.h('span', { text: '开始随机选择' })]));
      }
    }

    return {
      el: view.el,
      onEnter: function () {
        pickSection.style.display = 'none';
        renderPickIdle();
        renderFooter();
      },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
