/*!
 * 工具箱 · 图片压缩
 * 流程：选择图片 → 查看信息与预览 → 调整质量/尺寸上限 → 压缩 → 对比结果 → 保存
 * 全程本地完成，原图不会被修改。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const QUALITY_PRESETS = [
    { value: 0.9, label: '高质量（几乎看不出差别）' },
    { value: 0.8, label: '中等质量（推荐）' },
    { value: 0.6, label: '较小体积（细节略降）' }
  ];

  TB.pages['img-compress'] = function () {
    const view = F.frame({ title: '图片压缩' });
    let urls = [];
    let state = { file: null, info: null, result: null, url: null, resultUrl: null };
    let quality = 0.8;
    let maxDim = 0;          // 0 = 不限制
    let busy = false;

    function urlOf(blob) {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      return u;
    }

    function onDispose() {
      urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
      urls = [];
    }

    /* ------------------------------------------------------------ 选择图片 */

    async function choose(file) {
      if (busy) return;
      if (!file) return;
      busy = true;
      const progress = ui.progress({ title: '正在读取图片…' });
      try {
        onDispose();
        const info = await TB.imaging.readSize(file);
        state = {
          file: file,
          info: {
            name: file.name || 'image',
            size: file.size || 0,
            width: info.width,
            height: info.height,
            mime: file.type || ''
          },
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

    /* ------------------------------------------------------------ 压缩 */

    async function runCompress() {
      if (busy || !state.file) return;
      busy = true;
      const btn = view.footer.querySelector('[data-action="compress"]');
      if (btn) { btn.classList.add('is-busy'); btn.textContent = '正在压缩…'; }
      const progress = ui.progress({ title: '正在压缩…', text: '大图片可能需要几秒' });
      try {
        await new Promise(function (r) { setTimeout(r, 16); });   // 让遮罩先渲染出来
        const out = await TB.imaging.compress(state.file, {
          quality: quality,
          maxDim: maxDim || null
        });
        if (state.resultUrl) { try { URL.revokeObjectURL(state.resultUrl); } catch (e) { /* ignore */ } }
        state.resultUrl = urlOf(out.blob);
        state.result = {
          blob: out.blob,
          size: out.size,
          width: out.width,
          height: out.height,
          mime: out.mime,
          scaled: out.scaled,
          noGain: out.noGain,
          originalSize: state.info.size
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
      if (!state.result || busy) return;
      busy = true;
      const progress = ui.progress({ title: '正在保存…' });
      try {
        const ext = /png/.test(state.result.mime) ? 'png' : (/webp/.test(state.result.mime) ? 'webp' : 'jpg');
        const name = U.safeFileName(U.baseName(state.info.name) + '-压缩.' + ext, 'compressed.jpg');
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

    function infoCard() {
      const info = state.info;
      return ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '原图信息' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('文件名', info.name),
          ui.rowItem('原始大小', U.formatBytes(info.size, false) + '（' + U.formatNumber(info.size, 0) + ' 字节）'),
          ui.rowItem('图片尺寸', info.width + ' × ' + info.height + ' 像素'),
          ui.rowItem('图片格式', TB.imaging.formatLabel(info.mime || info.name))
        ])
      ]);
    }

    function controls() {
      const qualityLabel = ui.h('div', { class: 'field__unit', text: qualityLabelText() });
      const range = ui.h('input', {
        class: 'range',
        type: 'range',
        min: '40',
        max: '95',
        step: '5',
        value: String(Math.round(quality * 100)),
        onInput: function () {
          quality = Number(range.value) / 100;
          qualityLabel.textContent = qualityLabelText();
        }
      });
      const presets = ui.h('div', { class: 'btnrow btnrow--wrap', style: { marginTop: '10px', gap: '8px' } });
      QUALITY_PRESETS.forEach(function (p) {
        presets.appendChild(ui.h('button', {
          class: 'chip' + (Math.abs(p.value - quality) < 0.001 ? ' chip--active' : ''),
          type: 'button',
          text: p.label.split('（')[0],
          title: p.label,
          dataset: { preset: String(p.value) },
          onClick: function () {
            quality = p.value;
            range.value = String(Math.round(p.value * 100));
            qualityLabel.textContent = qualityLabelText();
            Array.prototype.forEach.call(presets.children, function (c) { c.classList.remove('chip--active'); });
            presets.querySelector('[data-preset="' + p.value + '"]').classList.add('chip--active');
          }
        }));
      });

      const sizeSeg = ui.segmented([
        { id: '0', label: '不限制' },
        { id: '2560', label: '2560px' },
        { id: '1920', label: '1920px' },
        { id: '1280', label: '1280px' },
        { id: '800', label: '800px' }
      ], String(maxDim), function (id) {
        maxDim = Number(id);
        render();
      });

      const bigWarning = (state.info.width * state.info.height > 60000000 && maxDim === 0)
        ? ui.notice('这张图片像素非常大，建议设置一个尺寸上限，避免手机内存不足。', 'warn')
        : null;

      return ui.h('div', {}, [
        ui.h('div', { class: 'card' }, [
          ui.h('div', { class: 'card__title', text: '压缩质量' }),
          range,
          ui.h('div', { class: 'range__scale' }, [
            ui.h('span', { text: '低（体积更小）' }),
            ui.h('span', { text: '高（画质更好）' })
          ]),
          qualityLabel,
          presets
        ]),
        ui.h('div', { class: 'card' }, [
          ui.h('div', { class: 'card__title', text: '尺寸上限' }),
          sizeSeg,
          ui.h('div', { class: 'field__hint', text: '限制长边尺寸是减小体积最有效的方式；原图小于该尺寸时不会放大。' })
        ]),
        bigWarning
      ]);
    }

    function qualityLabelText() {
      const pct = Math.round(quality * 100);
      if (pct >= 90) return '当前质量：' + pct + '%（高）';
      if (pct >= 75) return '当前质量：' + pct + '%（推荐）';
      return '当前质量：' + pct + '%（低）';
    }

    function compareCard() {
      const r = state.result;
      const savedRatio = r.originalSize > 0 ? (1 - r.size / r.originalSize) * 100 : 0;
      const rows = ui.h('div', { class: 'rows' }, [
        ui.rowItem('原始大小', U.formatBytes(r.originalSize, false)),
        ui.rowItem('压缩后', U.formatBytes(r.size, false)),
        ui.rowItem('节省', (r.originalSize - r.size > 0 ? U.formatBytes(r.originalSize - r.size, false) : '0 B')),
        ui.rowItem('压缩率', U.formatFixed(U.clamp(savedRatio, 0, 100), 1) + '%', { big: true })
      ]);

      const notes = [];
      if (r.noGain) notes.push('这张图已经很精简：再次压缩后体积反而更大，已保留原图。');
      if (r.scaled) notes.push('已按要求限制尺寸，新尺寸为 ' + r.width + ' × ' + r.height + ' 像素。');
      if (!r.noGain && savedRatio > 0) notes.push('体积减少了约 ' + U.formatFixed(savedRatio, 1) + '%。');

      return ui.h('div', {}, [
        ui.h('div', { class: 'card' }, [
          ui.h('div', { class: 'card__title', text: '压缩结果' }),
          rows,
          notes.length ? ui.h('div', { class: 'field__hint', text: notes.join(' ') }) : null
        ]),
        ui.h('div', { class: 'card' }, [
          ui.h('div', { class: 'card__title', text: '预览对比（左：原图　右：压缩后）' }),
          ui.h('div', { class: 'compare' }, [
            ui.h('div', { class: 'compare__cell' }, [
              ui.h('div', { class: 'previewbox' }, [ui.h('img', { src: state.url, alt: '原图预览' })]),
              ui.h('div', { class: 'compare__label', text: U.formatBytes(r.originalSize, false) })
            ]),
            ui.h('div', { class: 'compare__cell' }, [
              ui.h('div', { class: 'previewbox' }, [ui.h('img', { src: state.resultUrl, alt: '压缩后预览' })]),
              ui.h('div', { class: 'compare__label', text: U.formatBytes(r.size, false) })
            ])
          ])
        ])
      ]);
    }

    function dropzone() {
      return ui.h('div', { class: 'page__body' }, [
        ui.h('button', {
          class: 'dropzone',
          type: 'button',
          dataset: { action: 'pick' },
          onClick: pick
        }, [
          ui.h('div', { class: 'dropzone__emoji', text: '🗜️' }),
          ui.h('div', { class: 'dropzone__title', text: '选择一张图片开始压缩' }),
          ui.h('div', { class: 'dropzone__desc', text: '支持 JPG / PNG / WebP；图片只在你的设备上处理，不会上传' })
        ]),
        ui.notice('压缩后可以对比查看效果，再决定是否保存。原图不会被修改。'),
        ui.h('div', { class: 'page__spacer' })
      ]);
    }

    async function pick() {
      if (busy) return;
      const files = await TB.files.pickImages({ multiple: false });
      if (!files.length) return;
      const file = files[0];
      if (!TB.imaging.isImageFile(file)) {
        ui.toast('请选择图片文件', { tone: 'danger' });
        return;
      }
      choose(file);
    }

    function render() {
      ui.clear(view.body);
      if (!state.file) {
        view.body.appendChild(dropzone());
        renderFooter();
        return;
      }
      view.body.appendChild(ui.h('div', { class: 'page__body' }, [
        ui.h('div', { class: 'previewbox' + (/png|webp/.test(state.info.mime) ? ' previewbox--checker' : '') }, [
          ui.h('img', { src: state.url, alt: '图片预览' })
        ])
      ]));
      view.body.appendChild(ui.h('div', { class: 'page__body' }, [infoCard()]));
      if (state.result) {
        view.body.appendChild(ui.h('div', { class: 'page__body' }, [compareCard()]));
      } else {
        view.body.appendChild(ui.h('div', { class: 'page__body' }, [controls()]));
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
            class: 'btn btn--ghost',
            type: 'button',
            dataset: { action: 'repick' },
            text: '换一张',
            onClick: function () { onDispose(); state = { file: null, info: null, result: null, url: null, resultUrl: null }; render(); }
          }),
          ui.h('button', {
            class: 'btn btn--primary',
            type: 'button',
            dataset: { action: 'save' },
            onClick: saveResult
          }, [ui.icon('download', { size: 19 }), ui.h('span', { text: '保存图片' })])
        ]));
      } else {
        view.footer.appendChild(ui.h('button', {
          class: 'btn btn--primary btn--block',
          type: 'button',
          dataset: { action: 'compress' },
          onClick: runCompress
        }, [ui.icon('wand', { size: 19 }), ui.h('span', { text: '开始压缩' })]));
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
