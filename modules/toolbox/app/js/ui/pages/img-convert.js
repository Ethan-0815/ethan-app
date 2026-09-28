/*!
 * 工具箱 · 图片格式转换
 * JPG / PNG / WebP 互转。PNG → JPG 会自动补白底，避免出现黑色背景。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  TB.pages['img-convert'] = function () {
    const view = F.frame({ title: '图片格式转换' });
    const formats = TB.imaging.outputFormats();
    let target = formats[0].mime;
    let quality = 0.92;
    let busy = false;
    let urls = [];
    let state = { file: null, info: null, result: null, url: null, resultUrl: null };

    function urlOf(blob) {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      return u;
    }

    function onDispose() {
      urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      urls = [];
    }

    function targetInfo() {
      for (let i = 0; i < formats.length; i++) if (formats[i].mime === target) return formats[i];
      return formats[0];
    }

    function needsQuality() {
      return targetInfo().lossy === true;
    }

    /* ------------------------------------------------------------ 选择 */

    async function choose(file) {
      if (busy || !file) return;
      busy = true;
      const progress = ui.progress({ title: '正在读取图片…' });
      try {
        onDispose();
        const info = await TB.imaging.readSize(file);
        state = {
          file: file,
          info: { name: file.name || 'image', size: file.size || 0, width: info.width, height: info.height, mime: file.type || '' },
          result: null,
          url: urlOf(file),
          resultUrl: null
        };
        render();
        F.animateIn(view.body, { distance: 6 });
      } catch (e) {
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3000 });
      } finally {
        progress.close();
        busy = false;
      }
    }

    async function pick() {
      if (busy) return;
      const files = await TB.files.pickImages({ multiple: false });
      if (!files.length) return;
      const file = files[0];
      if (!TB.imaging.isImageFile(file)) { ui.toast('请选择图片文件', { tone: 'danger' }); return; }
      choose(file);
    }

    /* ------------------------------------------------------------ 转换 */

    async function runConvert() {
      if (busy || !state.file) return;
      busy = true;
      const progress = ui.progress({ title: '正在转换…', text: '格式：' + targetInfo().label });
      try {
        await new Promise(function (r) { setTimeout(r, 16); });
        const out = await TB.imaging.convert(state.file, { mime: target, quality: quality });
        if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e) { /* ignore */ } }
        state.resultUrl = urlOf(out.blob);
        state.result = {
          blob: out.blob, size: out.size, mime: out.mime,
          width: out.width, height: out.height, originalSize: out.originalSize
        };
        render();
        F.animateIn(view.body, { distance: 6 });
      } catch (e) {
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3200 });
      } finally {
        progress.close();
        busy = false;
        renderFooter();
      }
    }

    async function saveResult() {
      if (busy || !state.result) return;
      busy = true;
      const progress = ui.progress({ title: '正在保存…' });
      try {
        const info = targetInfo();
        const name = U.safeFileName(U.baseName(state.info.name) + '.' + info.ext, 'converted.' + info.ext);
        const saved = await TB.files.saveBlob(state.result.blob, name);
        ui.toast('已保存到' + saved.target, { tone: 'ok', icon: 'check', duration: 3000 });
      } catch (e) {
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3200 });
      } finally {
        progress.close();
        busy = false;
      }
    }

    /* ------------------------------------------------------------ 渲染 */

    function sourceCard() {
      return ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '原图' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('文件名', state.info.name),
          ui.rowItem('原格式', TB.imaging.formatLabel(state.info.mime || state.info.name)),
          ui.rowItem('原大小', U.formatBytes(state.info.size, false)),
          ui.rowItem('尺寸', state.info.width + ' × ' + state.info.height + ' 像素')
        ])
      ]);
    }

    function formatCard() {
      const seg = ui.segmented(formats.map(function (f) {
        return { id: f.mime, label: f.label };
      }), target, function (id) {
        if (id === target) return;
        target = id;
        // 目标格式变了，旧的转换结果不再有意义
        if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e) { /* ignore */ } }
        state.result = null;
        state.resultUrl = null;
        render();
      });

      const children = [
        ui.h('div', { class: 'card__title', text: '目标格式' }),
        seg
      ];

      if (needsQuality()) {
        const label = ui.h('div', { class: 'field__unit', text: '质量：' + Math.round(quality * 100) + '%' });
        const range = ui.h('input', {
          class: 'range', type: 'range', min: '40', max: '98', step: '2',
          value: String(Math.round(quality * 100)),
          onInput: function () {
            quality = Number(range.value) / 100;
            label.textContent = '质量：' + range.value + '%';
          }
        });
        children.push(ui.h('div', { style: { marginTop: '14px' } }, [range, label]));
      } else {
        children.push(ui.h('div', { class: 'field__hint', text: 'PNG 是无损格式，不需要额外的质量设置。' }));
      }

      if (/jpe?g/.test(target) && /png|webp/i.test(U.str(state.info.mime))) {
        children.push(ui.h('div', { style: { marginTop: '12px' } }, [
          ui.notice('目标格式 JPG 不支持透明背景，透明区域会自动填充为白色。')
        ]));
      }

      return ui.h('div', { class: 'card' }, children);
    }

    function resultCard() {
      const r = state.result;
      const info = targetInfo();
      const diff = r.size - r.originalSize;
      const notes = [];
      if (diff < 0) notes.push('新文件比原来小了 ' + U.formatBytes(Math.abs(diff), false) + '。');
      else if (diff > 0) notes.push('新文件比原来大了 ' + U.formatBytes(diff, false) + '，这是格式特性导致的正常现象。');
      if (/jpe?g/.test(r.mime) && /png|webp/i.test(U.str(state.info.mime))) notes.push('透明区域已填充为白色。');

      return ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '转换结果' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('原格式 → 新格式', TB.imaging.formatLabel(state.info.mime) + ' → ' + info.label),
          ui.rowItem('原大小', U.formatBytes(r.originalSize, false)),
          ui.rowItem('新大小', U.formatBytes(r.size, false)),
          ui.rowItem('尺寸', r.width + ' × ' + r.height + ' 像素')
        ]),
        notes.length ? ui.h('div', { class: 'field__hint', text: notes.join(' ') }) : null
      ]);
    }

    function dropzone() {
      return ui.h('div', { class: 'page__body' }, [
        ui.h('button', { class: 'dropzone', type: 'button', dataset: { action: 'pick' }, onClick: pick }, [
          ui.h('div', { class: 'dropzone__emoji', text: '🔄' }),
          ui.h('div', { class: 'dropzone__title', text: '选择一张图片开始转换' }),
          ui.h('div', { class: 'dropzone__desc', text: '支持 JPG / PNG / WebP；如果你要转成 PDF，请使用「图片转 PDF」' })
        ]),
        ui.h('div', { class: 'page__spacer' })
      ]);
    }

    function render() {
      ui.clear(view.body);
      if (!state.file) {
        view.body.appendChild(dropzone());
        renderFooter();
        return;
      }
      view.body.appendChild(ui.h('div', { class: 'page__body' }, [
        ui.h('div', { class: 'previewbox' + (/png|webp/i.test(U.str(state.info.mime)) ? ' previewbox--checker' : '') }, [
          ui.h('img', { src: state.url, alt: '原图预览' })
        ])
      ]));
      view.body.appendChild(ui.h('div', { class: 'page__body' }, [sourceCard(), formatCard()]));
      if (state.result) {
        view.body.appendChild(ui.h('div', { class: 'page__body' }, [
          resultCard(),
          ui.h('div', { class: 'card' }, [
            ui.h('div', { class: 'card__title', text: '转换后预览' }),
            ui.h('div', { class: 'previewbox' + (/png|webp/i.test(state.result.mime) ? ' previewbox--checker' : '') }, [
              ui.h('img', { src: state.resultUrl, alt: '转换后预览' })
            ])
          ])
        ]));
      }
      view.body.appendChild(ui.h('div', { class: 'page__spacer' }));
      renderFooter();
    }

    function renderFooter() {
      ui.clear(view.footer);
      view.footer.classList.remove('page__footer--empty');
      if (!state.file) {
        view.footer.classList.add('page__footer--empty');
        return;
      }
      if (state.result) {
        view.footer.appendChild(ui.h('div', { class: 'btnrow' }, [
          ui.h('button', {
            class: 'btn btn--ghost', type: 'button', text: '重新转换',
            onClick: runConvert
          }),
          ui.h('button', {
            class: 'btn btn--primary', type: 'button', dataset: { action: 'save' },
            onClick: saveResult
          }, [ui.icon('download', { size: 19 }), ui.h('span', { text: '保存图片' })])
        ]));
      } else {
        view.footer.appendChild(ui.h('button', {
          class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'convert' },
          onClick: runConvert
        }, [ui.icon('wand', { size: 19 }), ui.h('span', { text: '转换为 ' + targetInfo().label })]));
      }
    }

    return {
      el: view.el,
      onEnter: function () { render(); },
      onBack: function () { return false; },
      onDispose: onDispose
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
