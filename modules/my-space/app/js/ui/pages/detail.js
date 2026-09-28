/*!
 * 我的空间 · 物品详情
 * 严格按实际数据渲染：字段为空则整块不显示（不出现"—"或空白大块）。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  function copyText(text) {
    const value = String(text === null || text === undefined ? '' : text);
    if (!value) return Promise.resolve(false);
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return false; });
    }
    return new Promise(function (resolve) {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(!!ok);
      } catch (e) { resolve(false); }
    });
  }

  MS.pages.detail = function (app) {
    const ui = MS.ui;
    const parts = MS.parts;
    const M = MS.models;
    const f = ui.frame({
      title: '',
      showBack: true,
      actions: [
        { icon: 'edit', label: '编辑', onClick: function () { if (item) app.editItem(item.id); } },
        { icon: 'more', label: '更多', onClick: openMore }
      ]
    });
    const pools = ui.poolBox();
    let item = null;
    let viewer = null;
    let unsubscribe = null;

    function openMore() {
      if (!item) return;
      const imageCount = app.repo.itemImages(item.id).length;
      ui.sheet({
        title: '更多操作',
        actions: [
          { label: '添加图片', icon: 'camera', desc: '拍照或从相册选择', onClick: function () { pickImage(); } },
          { label: '复制名称', icon: 'check', desc: item.name || '', onClick: function () { doCopy(item.name, '名称'); } },
          {
            label: '移入回收站', icon: 'trash', tone: 'danger', desc: '可以在回收站中恢复',
            onClick: function () {
              ui.confirm({
                title: '确定移入回收站？',
                message: '「' + (item.name || '未命名') + '」将被移入回收站，之后可以恢复。' +
                  (imageCount ? '\n包含 ' + imageCount + ' 张图片。' : ''),
                confirmText: '移入回收站',
                danger: true
              }).then(function (yes) {
                if (!yes) return;
                app.repo.softDelete(item.id).then(function () {
                  ui.toast('已移入回收站', { icon: 'trash' });
                  app.router.back();
                }).catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
              });
            }
          }
        ]
      });
    }

    function doCopy(text, label) {
      copyText(text).then(function (ok) {
        ui.toast(ok ? (label + '已复制') : '复制失败，可以长按手动选择');
      });
    }

    function pickImage() {
      ui.sheet({
        title: '添加图片',
        actions: [
          { label: '拍照', icon: 'camera', onClick: function () { chooseFile(true); } },
          { label: '从相册选择', icon: 'gallery', onClick: function () { chooseFile(false); } }
        ]
      });
    }

    function chooseFile(camera) {
      const input = ui.h('input', {
        type: 'file',
        accept: 'image/*',
        style: { position: 'fixed', left: '-9999px' }
      });
      if (camera) input.setAttribute('capture', 'environment');
      else input.setAttribute('multiple', 'multiple');
      input.addEventListener('change', function () {
        const files = Array.prototype.slice.call(input.files || []);
        if (!files.length) { if (input.parentNode) input.parentNode.removeChild(input); return; }
        ui.toast('正在处理图片…', { duration: 1200 });
        Promise.all(files.map(function (file) {
          return MS.imaging.prepareImage(file).catch(function () { return null; });
        })).then(function (results) {
          const list = results.filter(Boolean);
          if (!list.length) { ui.toast(MS.ERROR_MESSAGES.IMAGE_BROKEN, { tone: 'danger' }); return; }
          return app.repo.addImages(item.id, list).then(function () {
            ui.toast('已添加 ' + list.length + ' 张图片', { icon: 'check' });
          });
        }).catch(function (e) {
          ui.toast(MS.friendly(e), { tone: 'danger' });
        }).then(function () {
          if (input.parentNode) input.parentNode.removeChild(input);
        });
      });
      document.body.appendChild(input);
      input.click();
    }

    function openViewer(index) {
      const images = app.repo.itemImages(item.id);
      if (!images.length) return;
      const slides = ui.h('div', { class: 'viewer__slides' });
      const counter = ui.h('div', { class: 'viewer__counter', text: (index + 1) + ' / ' + images.length });
      const pool = ui.urlPool();

      images.forEach(function (meta) {
        const slide = ui.h('div', { class: 'viewer__slide' });
        const box = ui.h('div', { class: 'viewer__image' });
        parts.fillImage(box, meta.id, app, pool, 'full');
        slide.appendChild(box);
        slides.appendChild(slide);
      });

      const overlay = ui.h('div', { class: 'viewer' }, [
        ui.h('div', { class: 'viewer__bar' }, [
          counter,
          ui.h('button', {
            class: 'viewer__close', type: 'button', 'aria-label': '关闭',
            onClick: function () { closeViewer(); }
          }, [ui.icon('close', { size: 20 })])
        ]),
        slides
      ]);

      // 点击图片以外的空白区域 → 返回上一级
      overlay.addEventListener('click', function (e) {
        const el = e.target;
        if (!el || !el.tagName) return;
        if (el.tagName === 'IMG') return;                                  // 点在图片上：不关闭
        if (el.closest && el.closest('.viewer__close')) return;            // 关闭按钮自己处理
        closeViewer();
      });

      const sync = function () {
        const w = slides.clientWidth || 1;
        const i = Math.round(slides.scrollLeft / w);
        counter.textContent = (i + 1) + ' / ' + images.length;
      };
      slides.addEventListener('scroll', ui.debounce(sync, 60));

      function closeViewer() {
        const a = ui.anim.run(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: ui.anim.dur('small') });
        const done = function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          pool.release();
          viewer = null;
        };
        if (a) a.onfinish = done; else done();
      }

      ui.layerRoot().appendChild(overlay);
      ui.anim.run(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: ui.anim.dur('small'), fallback: false });
      viewer = { close: closeViewer, next: function () { slides.scrollBy({ left: slides.clientWidth, behavior: 'smooth' }); } };
      requestAnimationFrame(function () {
        slides.scrollLeft = index * slides.clientWidth;
      });
    }

    /* -------------------------------------------------------------- 渲染 */

    function infoRow(label, value, opts) {
      const o = opts || {};
      const row = ui.h('div', { class: 'inforow' + (o.copyable ? ' inforow--copyable' : '') }, [
        ui.h('div', { class: 'inforow__label', text: label }),
        ui.h('div', { class: 'inforow__value' + (o.mono ? ' inforow__value--mono' : '') , text: value })
      ]);
      if (o.copyable) {
        row.addEventListener('click', function () { doCopy(value, label); });
        row.appendChild(ui.h('span', { class: 'inforow__hint', text: '轻点复制' }));
      }
      return row;
    }

    function render() {
      const pool = pools.reset();
      ui.clear(f.body);
      ui.clear(f.footer);
      if (!item) {
        f.body.appendChild(ui.emptyState({
          icon: 'info',
          title: '找不到这条记录',
          desc: '它可能已经被永久删除。',
          actionLabel: '返回',
          onAction: function () { app.router.back(); }
        }));
        return;
      }

      f.setTitle(item.name || '未命名');

      const images = app.repo.itemImages(item.id);

      /* 图片区（没有图片就完全不显示，不留空白） */
      if (images.length) {
        const gallery = ui.h('div', { class: 'gallery' });
        const dots = ui.h('div', { class: 'gallery__dots' });
        images.forEach(function (meta, index) {
          const slide = ui.h('div', { class: 'gallery__slide' });
          const box = ui.h('div', { class: 'gallery__image' });
          parts.fillImage(box, meta.id, app, pool, 'thumb');
          slide.appendChild(box);
          slide.addEventListener('click', function () { openViewer(index); });
          gallery.appendChild(slide);
          if (index < 6) dots.appendChild(ui.h('span', { class: 'gallery__dot' }));
        });
        const syncDots = function () {
          const w = gallery.clientWidth || 1;
          const i = Math.round(gallery.scrollLeft / w);
          dots.querySelectorAll('.gallery__dot').forEach(function (d, di) {
            d.classList.toggle('gallery__dot--active', di === i);
          });
        };
        gallery.addEventListener('scroll', ui.debounce(syncDots, 60));
        setTimeout(syncDots, 60);
        f.body.appendChild(ui.h('div', { class: 'gallerywrap' }, [gallery, images.length > 1 ? dots : null]));
      }

      /* 标题区 */
      const chips = ui.h('div', { class: 'detailchips' });
      const catName = app.repo.categoryName(item.categoryId);
      if (catName) chips.appendChild(parts.tagEl(catName, { icon: 'folder' }));
      app.repo.tagNames(item.tagIds).forEach(function (name) {
        chips.appendChild(parts.tagEl('#' + name, { tone: 'soft' }));
      });
      if (chips.childNodes.length) f.body.appendChild(chips);

      /* 基本信息：只显示有值的字段 */
      const rows = [];
      const text = M.displayText;
      if (text(item.brand)) rows.push(infoRow(M.ITEM_LABELS.brand, text(item.brand)));
      if (text(item.model)) rows.push(infoRow(M.ITEM_LABELS.model, text(item.model)));
      if (item.purchaseDate) rows.push(infoRow(M.ITEM_LABELS.purchaseDate, M.displayDate(item.purchaseDate)));
      if (item.purchasePrice !== null && item.purchasePrice !== undefined) {
        rows.push(infoRow(M.ITEM_LABELS.purchasePrice, M.displayPrice(item.purchasePrice)));
      }
      if (text(item.purchaseChannel)) rows.push(infoRow(M.ITEM_LABELS.purchaseChannel, text(item.purchaseChannel)));
      if (text(item.serialNumber)) rows.push(infoRow(M.ITEM_LABELS.serialNumber, text(item.serialNumber), { copyable: true, mono: true }));
      if (text(item.location)) rows.push(infoRow(M.ITEM_LABELS.location, text(item.location), { copyable: true }));

      if (rows.length) {
        f.body.appendChild(ui.section('基本信息'));
        f.body.appendChild(ui.h('div', { class: 'card card--plain infolist' }, rows));
      }

      if (text(item.notes)) {
        f.body.appendChild(ui.section('备注'));
        f.body.appendChild(ui.h('div', { class: 'card card--plain noteblock', text: text(item.notes) }));
      }

      /* 图片管理入口（无图片时也提供添加入口，但不占大块空间） */
      f.body.appendChild(ui.h('div', { class: 'inlinelinks' }, [
        ui.h('button', {
          class: 'linkbtn', type: 'button',
          onClick: function () { pickImage(); }
        }, [ui.icon('plus', { size: 16 }), ui.h('span', { text: images.length ? '添加更多图片' : '添加图片' })])
      ]));

      /* 时间信息 */
      const meta = [];
      if (M.isIsoLike(item.createdAt)) meta.push('添加于 ' + M.displayDateTime(item.createdAt));
      if (M.isIsoLike(item.updatedAt) && item.updatedAt !== item.createdAt) meta.push('更新于 ' + M.displayDateTime(item.updatedAt));
      f.body.appendChild(ui.h('div', { class: 'detailmeta', text: meta.join(' · ') }));
      f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));

      /* 底部主操作 */
      const editBtn = ui.h('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        onClick: function () { app.editItem(item.id); }
      }, [ui.icon('edit', { size: 18 }), ui.h('span', { text: '编辑物品' })]);
      f.footer.appendChild(editBtn);
      f.footer.classList.remove('page__footer--empty');
    }

    return {
      el: f.el,
      tab: -1,
      showNav: false,
      onEnter: function (params) {
        const id = params && params.id;
        item = id ? app.repo.getItem(id) : null;
        render();
        if (!unsubscribe) {
          unsubscribe = app.repo.on('change', function (payload) {
            if (!item) return;
            if (payload && (payload.type === 'hard')) { item = app.repo.getItem(item.id); render(); return; }
            const touching = payload && (
              (payload.item && payload.item.id === item.id) ||
              payload.itemId === item.id ||
              payload.id === item.id
            );
            if (!touching && payload && payload.type !== 'clear') return;
            item = app.repo.getItem(item.id);
            render();
          });
        }
      },
      onLeave: function () {
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (viewer) { viewer.close(); viewer = null; }
      },
      onBack: function () {
        if (viewer) { viewer.close(); viewer = null; return true; }
        return false;
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
