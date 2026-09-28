/*!
 * 工具箱 · JSON 格式化
 * 三个核心动作：美化、压缩、检查。错误提示尽量给到「第几行第几列」与常见原因。
 * 内容来源两种：直接粘贴，或从本机选择 .json 文件读取 —— 都只在设备本地处理。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages.json = function () {
    const view = F.frame({
      title: 'JSON 格式化',
      actions: [
        { icon: 'file', label: '打开 JSON 文件', onClick: function () { openFile(); } },
        { icon: 'save', label: '粘贴', onClick: function () { paste(); } },
        { icon: 'trash', label: '清空', onClick: function () { clearAll(); } }
      ]
    });

    const area = ui.textArea({
      placeholder: '粘贴 JSON 内容\n或点下方「选择 JSON 文件」\n例如 {"name":"工具箱","v":1}',
      rows: 10,
      className: 'input--mono'
    });
    const statusHost = ui.h('div', {});
    const fileNote = ui.h('div', { class: 'field__hint', text: '还没有选择文件' });

    view.body.appendChild(ui.h('div', { class: 'page__body' }, [
      ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: 'JSON 内容' }),
        area,
        ui.h('div', { class: 'btnrow', style: { marginTop: '12px' } }, [
          ui.h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', dataset: { action: 'open-file' },
            onClick: function () { openFile(); }
          }, [ui.icon('file', { size: 17 }), ui.h('span', { text: '选择 JSON 文件' })])
        ]),
        fileNote,
        ui.h('div', { class: 'field__hint', text: '支持粘贴或从本机选择 .json 文件；两种方式都可以用，内容只在你的设备上处理。' })
      ]),
      statusHost,
      ui.h('div', { class: 'page__spacer' })
    ]));

    view.footer.appendChild(ui.h('div', { class: 'btnrow' }, [
      ui.h('button', {
        class: 'btn btn--ghost', type: 'button', dataset: { action: 'check' },
        onClick: function () { run('check'); }
      }, [ui.h('span', { text: '检查' })]),
      ui.h('button', {
        class: 'btn btn--ghost', type: 'button', dataset: { action: 'minify' },
        onClick: function () { run('minify'); }
      }, [ui.h('span', { text: '压缩' })]),
      ui.h('button', {
        class: 'btn btn--primary', type: 'button', dataset: { action: 'beautify' },
        onClick: function () { run('beautify'); }
      }, [ui.h('span', { text: '格式化' })])
    ]));

    /* ------------------------------------------------------------ 选择文件 */

    let reading = false;

    async function openFile() {
      if (reading) return;
      reading = true;
      const progress = ui.progress({ title: '正在读取文件…' });
      try {
        const picked = await TB.files.pickTextFile({ accept: '.json,application/json,text/plain' });
        if (!picked) return;                                   // 用户取消：什么都不做
        if (U.str(picked.text).trim() === '') {
          fileNote.textContent = '已选择 ' + picked.name + '（空文件）';
          ui.toast(U.ERROR_MESSAGES.FILE_EMPTY, { tone: 'danger' });
          return;
        }
        area.value = picked.text;
        ui.markInvalid(area, false);
        fileNote.textContent = '已选择 ' + picked.name + '（' + U.formatBytes(picked.size, false) + '）';
        run('check');
        ui.toast('已载入 ' + picked.name, { tone: 'ok', icon: 'check' });
      } catch (e) {
        fileNote.textContent = '文件读取失败，请换一个文件再试';
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3200 });
      } finally {
        progress.close();
        reading = false;
      }
    }

    /* ------------------------------------------------------------ 动作 */

    async function paste() {
      let text = '';
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.readText) {
          text = await root.navigator.clipboard.readText();
        }
      } catch (e) { text = ''; }
      if (!text) {
        ui.toast('无法自动读取剪贴板，请长按输入框手动粘贴', { tone: 'danger', duration: 3200 });
        return;
      }
      area.value = text;
      run('check');
    }

    function clearAll() {
      area.value = '';
      fileNote.textContent = '还没有选择文件';
      ui.clear(statusHost);
      renderIdle();
      ui.toast('已清空');
    }

    function run(action) {
      const text = area.value;
      if (U.str(text).trim() === '') {
        ui.clear(statusHost);
        renderIdle(true);
        ui.toast(U.ERROR_MESSAGES.JSON_EMPTY, { tone: 'danger' });
        return;
      }

      if (action === 'check') {
        const r = TB.jsonutil.validate(text);
        if (!r.ok) { renderError(r); return; }
        renderCheck(r);
        return;
      }

      const r = action === 'minify' ? TB.jsonutil.minify(text) : TB.jsonutil.beautify(text, 2);
      if (!r.ok) { renderError(r); return; }
      area.value = r.text;
      renderSuccess(action === 'minify' ? '已压缩为一行' : '已格式化', r.value, r.text);
    }

    /* ------------------------------------------------------------ 渲染 */

    function renderIdle(showError) {
      statusHost.appendChild(ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '常见问题' }),
        ui.h('div', { class: 'columns' }, [
          ui.rowItem('属性名必须双引号', '"name": "工具箱"'),
          ui.rowItem('字符串必须双引号', '"ok" 而不是 \'ok\''),
          ui.rowItem('最后一个属性后不能有逗号', '{ "a": 1 }'),
          ui.rowItem('常见报错含义', '第几行第几列出了问题会直接标出来')
        ]),
        ui.h('div', { class: 'field__hint', text: '还没有内容时，可以粘贴，也可以点上方「选择 JSON 文件」。' })
      ]));
    }

    function renderError(r) {
      ui.clear(statusHost);
      const children = [
        ui.h('div', { class: 'card__title', text: '发现格式问题' }),
        ui.notice(r.message, 'warn'),
        r.lineText ? ui.h('div', { style: { marginTop: '12px' } }, [
          ui.h('div', { class: 'field__label' }, [ui.h('span', { text: '出错位置附近' })]),
          ui.h('pre', { class: 'code code--wrap', text: r.lineText })
        ]) : null,
        r.line > 0 ? ui.h('div', { class: 'field__hint', text: '第 ' + r.line + ' 行，第 ' + r.column + ' 列' }) : null
      ];
      statusHost.appendChild(ui.h('div', { class: 'card', dataset: { status: 'error' } }, children));
      F.animateIn(statusHost, { distance: 6 });
    }

    function renderCheck(r) {
      ui.clear(statusHost);
      const s = r.summary;
      const children = [
        ui.h('div', { class: 'card__title', text: '格式检查' }),
        ui.h('div', { class: 'badgerow' }, [
          ui.h('span', { class: 'badge badge--ok', text: '格式正确' }),
          ui.h('span', { class: 'badge badge--soft', text: '类型：' + s.type })
        ]),
        ui.h('div', { class: 'rows', style: { marginTop: '12px' } }, [
          ui.rowItem('节点数量', U.formatNumber(s.nodes, 0) + ' 个'),
          ui.rowItem('键数量', U.formatNumber(s.keys, 0) + ' 个'),
          ui.rowItem('嵌套深度', s.depth + ' 层'),
          s.length === null ? null : ui.rowItem('数组长度', U.formatNumber(s.length, 0) + ' 项')
        ]),
        s.topKeys.length ? ui.h('div', { style: { marginTop: '12px' } }, [
          ui.h('div', { class: 'field__label' }, [ui.h('span', { text: '顶层键' })]),
          ui.h('div', { class: 'badgerow' }, s.topKeys.map(function (k) {
            return ui.h('span', { class: 'badge badge--soft', text: k });
          }))
        ]) : null
      ];
      statusHost.appendChild(ui.h('div', { class: 'card', dataset: { status: 'ok' } }, children));
      F.animateIn(statusHost, { distance: 6 });
    }

    function renderSuccess(title, value, text) {
      ui.clear(statusHost);
      const s = TB.jsonutil.describe(value);
      const preview = text.length > 4000 ? text.slice(0, 4000) + '\n…（已省略部分内容）' : text;
      statusHost.appendChild(ui.h('div', { class: 'card', dataset: { status: 'ok' } }, [
        ui.h('div', { class: 'card__title', text: title }),
        ui.h('div', { class: 'badgerow' }, [
          ui.h('span', { class: 'badge badge--ok', text: '成功' }),
          ui.h('span', { class: 'badge badge--soft', text: '类型：' + s.type }),
          ui.h('span', { class: 'badge badge--soft', text: '共 ' + U.formatNumber(s.nodes, 0) + ' 个节点' }),
          ui.h('span', { class: 'badge badge--soft', text: '深度 ' + s.depth })
        ]),
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.h('div', { class: 'field__label' }, [ui.h('span', { text: '结果预览' })]),
          ui.h('pre', { class: 'code', text: preview })
        ]),
        ui.h('div', { style: { marginTop: '14px' } }, [
          ui.h('div', { class: 'btnrow' }, [
            ui.h('button', {
              class: 'btn btn--ghost btn--sm', type: 'button',
              onClick: function () { ui.copyWithFeedback(text, 'JSON 已复制'); }
            }, [ui.icon('copy', { size: 17 }), ui.h('span', { text: '复制结果' })]),
            ui.h('button', {
              class: 'btn btn--ghost btn--sm', type: 'button',
              onClick: function () { area.focus(); area.setSelectionRange(0, area.value.length); }
            }, [ui.h('span', { text: '全选内容' })])
          ])
        ])
      ]));
      F.animateIn(statusHost, { distance: 6 });
    }

    return {
      el: view.el,
      onEnter: function () {
        renderIdle();
        if (U.str(area.value).trim() !== '') run('check');
      },
      onBack: function () { return false; }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
