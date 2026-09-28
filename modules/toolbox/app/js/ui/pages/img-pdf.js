/*!
 * 工具箱 · 图片转 PDF
 * 支持一张或多张图片，每张图片一页（默认 A4），可删除、可调整顺序。
 * 生成过程完全在本地完成，不上传任何图片。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;
  const ui = TB.ui;
  const F = TB.frame;

  const MAX_PAGES = 60;          // 单次生成的合理上限，避免内存压力

  TB.pages['img-pdf'] = function () {
    const view = F.frame({ title: '图片转 PDF', subtitle: '每张图片一页 · A4 版面' });
    let pages = [];              // { id, file, name, size, width, height, thumbUrl }
    let busy = false;
    let result = null;           // { blob, pageCount, size, name }
    let seq = 0;

    function revokeAll() {
      pages.forEach(function (p) {
        if (p.thumbUrl) { try { URL.revokeObjectURL(p.thumbUrl); } catch (e) { /* ignore */ } }
      });
    }

    function onDispose() {
      revokeAll();
      pages = [];
    }

    /* ------------------------------------------------------------ 添加图片 */

    async function addImages() {
      if (busy) return;
      if (pages.length >= MAX_PAGES) {
        ui.toast('一次最多添加 ' + MAX_PAGES + ' 张图片', { tone: 'danger' });
        return;
      }
      const files = await TB.files.pickImages({ multiple: true });
      if (!files.length) return;
      const accepted = [];
      files.forEach(function (file) {
        if (accepted.length + pages.length >= MAX_PAGES) return;
        if (TB.imaging.isImageFile(file)) accepted.push(file);
      });
      if (!accepted.length) {
        ui.toast('请选择图片文件', { tone: 'danger' });
        return;
      }

      busy = true;
      const progress = ui.progress({ title: '正在读取图片…', text: '共 ' + accepted.length + ' 张' });
      try {
        for (let i = 0; i < accepted.length; i++) {
          const file = accepted[i];
          progress.set(i, accepted.length, '正在读取图片');
          let size = { width: 0, height: 0 };
          try {
            size = await TB.imaging.readSize(file);
          } catch (e) {
            ui.toast('已跳过无法读取的图片：' + (file.name || ''), { tone: 'danger', duration: 3000 });
            continue;
          }
          const item = {
            id: 'p' + (++seq),
            file: file,
            name: file.name || ('图片 ' + (pages.length + 1)),
            size: file.size || 0,
            width: size.width,
            height: size.height,
            thumbUrl: null
          };
          pages.push(item);
        }
        progress.set(accepted.length, accepted.length, '正在读取图片');
        result = null;
        render();
        F.animateIn(view.body, { distance: 6 });
      } finally {
        progress.close();
        busy = false;
      }
      buildThumbs();
    }

    /** 缩略图按需生成：先渲染列表，再逐张补上 */
    async function buildThumbs() {
      const targets = pages.filter(function (p) { return !p.thumbUrl; });
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        if (pages.indexOf(item) < 0) continue;
        const blob = await TB.imaging.preview(item.file, 240);
        if (!blob) continue;
        item.thumbUrl = URL.createObjectURL(blob);
        const holder = view.body.querySelector('[data-thumb="' + item.id + '"]');
        if (holder) {
          ui.clear(holder);
          holder.appendChild(ui.h('img', { src: item.thumbUrl, alt: '第 ' + (pages.indexOf(item) + 1) + ' 页缩略图' }));
        }
      }
    }

    /* ------------------------------------------------------------ 排序 / 删除 */

    function move(index, delta) {
      const target = index + delta;
      if (target < 0 || target >= pages.length) return;
      const tmp = pages[index];
      pages[index] = pages[target];
      pages[target] = tmp;
      result = null;
      render();
    }

    function remove(index) {
      const item = pages[index];
      if (item && item.thumbUrl) { try { URL.revokeObjectURL(item.thumbUrl); } catch (e) { /* ignore */ } }
      pages.splice(index, 1);
      result = null;
      render();
    }

    /* ------------------------------------------------------------ 生成 PDF */

    async function generate() {
      if (busy) return;
      if (!pages.length) { ui.toast(U.ERROR_MESSAGES.PDF_EMPTY, { tone: 'danger' }); return; }
      busy = true;
      const progress = ui.progress({ title: '正在生成 PDF…', text: '共 ' + pages.length + ' 页' });
      try {
        await new Promise(function (r) { setTimeout(r, 16); });
        const list = [];
        for (let i = 0; i < pages.length; i++) {
          progress.set(i, pages.length, '正在处理图片');
          await new Promise(function (r) { setTimeout(r, 0); });
          const item = pages[i];
          const jpeg = await TB.imaging.toJpeg(item.file, { maxDim: 2400, quality: 0.9 });
          list.push({ bytes: jpeg.bytes, width: jpeg.width, height: jpeg.height });
        }
        progress.setText('正在装订 PDF…');
        const blob = await TB.pdf.build(list);
        const now = new Date();
        result = {
          blob: blob,
          pageCount: pages.length,
          size: blob.size,
          name: U.safeFileName('图片文档-' + now.getFullYear() + U.pad2(now.getMonth() + 1) + U.pad2(now.getDate()) +
            '-' + U.pad2(now.getHours()) + U.pad2(now.getMinutes()) + '.pdf', 'document.pdf')
        };
        render();
        F.animateIn(view.body, { distance: 6 });
        ui.toast('PDF 生成成功，共 ' + result.pageCount + ' 页', { tone: 'ok', icon: 'check', duration: 2600 });
      } catch (e) {
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3200 });
      } finally {
        progress.close();
        busy = false;
        renderFooter();
      }
    }

    async function save() {
      if (busy || !result) return;
      busy = true;
      const progress = ui.progress({ title: '正在保存…' });
      try {
        const saved = await TB.files.saveBlob(result.blob, result.name);
        ui.toast('已保存到' + saved.target, { tone: 'ok', icon: 'check', duration: 3000 });
      } catch (e) {
        ui.toast(TB.friendly(e), { tone: 'danger', duration: 3200 });
      } finally {
        progress.close();
        busy = false;
      }
    }

    /* ------------------------------------------------------------ 渲染 */

    function resultCard() {
      return ui.h('div', { class: 'card' }, [
        ui.h('div', { class: 'card__title', text: '生成完成' }),
        ui.h('div', { class: 'rows' }, [
          ui.rowItem('文件页数', result.pageCount + ' 页'),
          ui.rowItem('文件大小', U.formatBytes(result.size, false)),
          ui.rowItem('页面尺寸', 'A4（210 × 297 mm）'),
          ui.rowItem('文件名', result.name)
        ]),
        ui.h('div', { class: 'savedbox', style: { marginTop: '12px' } }, [
          ui.icon('check', { size: 18 }),
          ui.h('span', { text: '点击下方「保存 PDF」即可存到设备中' })
        ])
      ]);
    }

    function pageList() {
      const list = ui.h('div', { class: 'pagelist' });
      pages.forEach(function (item, index) {
        const thumb = ui.h('div', { class: 'pagerow__thumb', dataset: { thumb: item.id } }, [
          ui.h('span', { class: 'badge badge--soft', text: String(index + 1) })
        ]);
        if (item.thumbUrl) {
          ui.clear(thumb);
          thumb.appendChild(ui.h('img', { src: item.thumbUrl, alt: '缩略图' }));
        }
        const indexBadge = ui.h('div', { class: 'pagerow__index', text: String(index + 1) });

        list.appendChild(ui.h('div', { class: 'pagerow', dataset: { page: item.id } }, [
          indexBadge,
          thumb,
          ui.h('div', { class: 'pagerow__body' }, [
            ui.h('div', { class: 'pagerow__name', text: '第 ' + (index + 1) + ' 页 · ' + item.name }),
            ui.h('div', {
              class: 'pagerow__meta',
              text: item.width + ' × ' + item.height + ' 像素 · ' + U.formatBytes(item.size, false)
            })
          ]),
          ui.h('div', { class: 'pagerow__ops' }, [
            ui.h('button', {
              class: 'iconbtn', type: 'button', 'aria-label': '上移',
              disabled: index === 0,
              onClick: function () { move(index, -1); }
            }, [ui.icon('up', { size: 18 })]),
            ui.h('button', {
              class: 'iconbtn', type: 'button', 'aria-label': '下移',
              disabled: index === pages.length - 1,
              onClick: function () { move(index, 1); }
            }, [ui.icon('down', { size: 18 })]),
            ui.h('button', {
              class: 'iconbtn iconbtn--danger', type: 'button', 'aria-label': '删除这一页',
              onClick: function () { remove(index); }
            }, [ui.icon('trash', { size: 18 })])
          ])
        ]));
      });
      return list;
    }

    function emptyBlock() {
      return ui.h('div', { class: 'page__body' }, [
        ui.h('button', { class: 'dropzone', type: 'button', dataset: { action: 'add' }, onClick: addImages }, [
          ui.h('div', { class: 'dropzone__emoji', text: '📄' }),
          ui.h('div', { class: 'dropzone__title', text: '添加图片开始制作 PDF' }),
          ui.h('div', { class: 'dropzone__desc', text: '可一次选择多张；每张图片成为一页，顺序可以调整' })
        ]),
        ui.notice('生成前可自由删除和排序。整个过程在本机完成，图片不会离开你的设备。'),
        ui.h('div', { class: 'page__spacer' })
      ]);
    }

    function render() {
      ui.clear(view.body);
      if (!pages.length) {
        view.body.appendChild(emptyBlock());
        renderFooter();
        return;
      }
      view.body.appendChild(ui.h('div', { class: 'section section--inline' }, [
        ui.h('div', { class: 'section__title', text: '共 ' + pages.length + ' 页' }),
        ui.h('button', {
          class: 'section__action', type: 'button', text: '添加图片',
          onClick: addImages
        })
      ]));
      view.body.appendChild(ui.h('div', { class: 'page__body' }, [pageList()]));
      if (result) {
        view.body.appendChild(ui.h('div', { class: 'page__body', style: { marginTop: '16px' } }, [resultCard()]));
      }
      view.body.appendChild(ui.h('div', { class: 'page__spacer' }));
      renderFooter();
    }

    function renderFooter() {
      ui.clear(view.footer);
      view.footer.classList.remove('page__footer--empty');
      if (!pages.length) {
        view.footer.classList.add('page__footer--empty');
        return;
      }
      if (result) {
        view.footer.appendChild(ui.h('div', { class: 'btnrow' }, [
          ui.h('button', {
            class: 'btn btn--ghost', type: 'button', text: '重新生成',
            onClick: generate
          }),
          ui.h('button', {
            class: 'btn btn--primary', type: 'button', dataset: { action: 'save' },
            onClick: save
          }, [ui.icon('download', { size: 19 }), ui.h('span', { text: '保存 PDF' })])
        ]));
      } else {
        view.footer.appendChild(ui.h('button', {
          class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'generate' },
          onClick: generate
        }, [ui.icon('save', { size: 19 }), ui.h('span', { text: '生成 PDF（' + pages.length + ' 页）' })]));
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
