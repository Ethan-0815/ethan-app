/*!
 * 工具箱 · UUID 生成
 * 默认 UUID v4，优先使用浏览器的安全随机能力；一次可生成多个，支持复制。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const MAX_COUNT = 200;

  TB.pages.uuid = function () {
    const view = F.frame({ title: 'UUID 生成', subtitle: '版本 v4' });
    let count = 1;
    let list = [];

    const countInput = ui.textInput({ type: 'number', inputmode: 'numeric', value: '1', className: 'input--num' });
    const countError = ui.h('div', { class: 'field__error' });
    const resultHost = ui.h('div', {});

    const quick = ui.h('div', { class: 'chiprow chiprow--wrap', style: { padding: '10px 0 0' } });
    [1, 5, 10, 20, 50].forEach(function (n) {
      quick.appendChild(ui.h('button', {
        class: 'chip', type: 'button', text: n + ' 个',
        onClick: function () { countInput.value = String(n); ui.markInvalid(countInput, false); countError.textContent = ''; }
      }));
    });

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '生成数量' }),
        countInput,
        countError,
        quick,
        ui.h('div', { class: 'field__hint', text: '一次最多生成 ' + MAX_COUNT + ' 个，每个 UUID 单独一行。' })
      ]),
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '随机来源' }),
        ui.h('div', { class: 'badgerow' }, [
          U.hasSecureRandom()
            ? ui.h('span', { class: 'badge badge--ok', text: '使用设备安全随机数' })
            : ui.h('span', { class: 'badge badge--warn', text: '当前环境不支持安全随机，已使用兼容实现' })
        ]),
        ui.h('div', { class: 'field__hint', text: 'UUID 完全在本机生成，不会上传到任何服务器。' })
      ]),
      resultHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    view.footer.appendChild(ui.h('button', {
      class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'generate' },
      onClick: generate
    }, [ui.icon('refresh', { size: 19 }), ui.h('span', { text: '生成 UUID' })]));

    function readCount() {
      const n = U.parseNum(countInput.value);
      if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
        countError.textContent = '请输入 1 ~ ' + MAX_COUNT + ' 之间的整数';
        ui.markInvalid(countInput, true);
        ui.toast('请输入 1 ~ ' + MAX_COUNT + ' 之间的整数', { tone: 'danger' });
        return null;
      }
      countError.textContent = '';
      ui.markInvalid(countInput, false);
      return n;
    }

    function generate() {
      const n = readCount();
      if (n === null) return;
      count = n;
      list = [];
      for (let i = 0; i < n; i++) list.push(U.uuidV4());
      render();
      F.animateIn(resultHost, { distance: 6 });
      ui.toast('已生成 ' + n + ' 个 UUID', { tone: 'ok', icon: 'check', duration: 1600 });
    }

    function render() {
      ui.clear(resultHost);
      if (!list.length) {
        resultHost.appendChild(ui.h('div', { class: 'card' }, [
          ui.h('div', { class: 'card__title', text: '什么是 UUID' }),
          ui.h('div', { class: 'columns' }, [
            ui.rowItem('用途', '给数据生成不会重复的编号'),
            ui.rowItem('格式', '8-4-4-4-12，共 36 个字符'),
            ui.rowItem('示例', '550e8400-e29b-41d4-a716-446655440000')
          ])
        ]));
        return;
      }

      const rows = ui.h('div', { class: 'resultgrid' });
      list.forEach(function (value, index) {
        rows.appendChild(ui.resultCell((index + 1) + ' / ' + list.length, value, { copyLabel: 'UUID 已复制' }));
      });

      resultHost.appendChild(ui.h('div', { class: 'card', dataset: { result: 'uuid' } }, [
        ui.h('div', { class: 'card__title', text: '生成结果（共 ' + list.length + ' 个）' }),
        ui.h('div', { style: { marginBottom: '12px' } }, [
          ui.h('div', { class: 'btnrow' }, [
            ui.h('button', {
              class: 'btn btn--primary btn--sm', type: 'button', dataset: { action: 'copy-all' },
              onClick: function () { ui.copyWithFeedback(list.join('\n'), '已复制 ' + list.length + ' 个 UUID'); }
            }, [ui.icon('copy', { size: 17 }), ui.h('span', { text: '全部复制' })]),
            ui.h('button', {
              class: 'btn btn--ghost btn--sm', type: 'button', dataset: { action: 'regen' },
              onClick: generate
            }, [ui.icon('refresh', { size: 17 }), ui.h('span', { text: '再生成一次' })])
          ])
        ]),
        rows
      ]));
    }

    function onEnter() {
      if (countInput.value !== String(count)) countInput.value = String(count);
      render();
    }

    return {
      el: view.el,
      onEnter: onEnter,
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
