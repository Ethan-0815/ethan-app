/*!
 * 我的空间 · 复用组件（物品卡片 / 列表行 / 标签 / 缩略图懒加载）
 * 缩略图使用 IntersectionObserver 懒加载，列表只取缩略图，详情页才取原图。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const ui = MS.ui;
  const M = MS.models;

  /* ---------------------------------------------------------------- 缩略图 */

  let io = null;
  const pending = new WeakMap();

  function observer() {
    if (io) return io;
    if (typeof IntersectionObserver === 'undefined') return null;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const task = pending.get(entry.target);
        pending.delete(entry.target);
        io.unobserve(entry.target);
        if (typeof task === 'function') task();
      });
    }, { rootMargin: '320px 0px' });
    return io;
  }

  function fillImage(box, imageId, app, pool, variant) {
    app.repo.imageData(imageId).then(function (data) {
      if (!data) return;
      const blob = variant === 'full' ? (data.blob || data.thumb) : (data.thumb || data.blob);
      if (!blob) return;
      const url = pool.url(blob);
      const img = document.createElement('img');
      img.className = 'thumb__img';
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      img.addEventListener('load', function () {
        ui.anim.run(img, [{ opacity: 0 }, { opacity: 1 }], { duration: ui.anim.dur('small'), fallback: false });
      });
      box.dataset.loaded = '1';
      box.appendChild(img);
    }).catch(function () { /* 图片读取失败：保留占位图标，不影响列表 */ });
  }

  /** 带懒加载的图片容器 */
  function thumb(imageId, app, pool, opts) {
    const o = opts || {};
    const box = ui.h('div', { class: 'thumb' + (o.class ? ' ' + o.class : '') + (o.round ? ' thumb--round' : '') }, [
      ui.h('div', { class: 'thumb__placeholder' }, [ui.icon(o.placeholderIcon || 'gallery', { size: o.iconSize || 22, weight: 1.4 })])
    ]);
    if (!imageId) { box.dataset.empty = '1'; return box; }
    const load = function () { fillImage(box, imageId, app, pool, o.variant || 'thumb'); };
    const ob = observer();
    if (ob) {
      pending.set(box, load);
      ob.observe(box);
    } else {
      load();
    }
    return box;
  }

  /* ---------------------------------------------------------------- 标签 / 分类 */

  function tagEl(name, opts) {
    const o = opts || {};
    return ui.h('span', { class: 'tag' + (o.tone ? ' tag--' + o.tone : '') + (o.small ? ' tag--small' : '') }, [
      o.icon ? ui.icon(o.icon, { size: 13 }) : null,
      ui.h('span', { text: name })
    ]);
  }

  function chipEl(label, opts) {
    const o = opts || {};
    return ui.h('button', {
      class: 'chip' + (o.active ? ' chip--active' : ''),
      type: 'button',
      onClick: o.onClick
    }, [
      o.icon ? ui.icon(o.icon, { size: 15 }) : null,
      ui.h('span', { text: label }),
      o.count !== undefined && o.count !== null ? ui.h('span', { class: 'chip__count', text: String(o.count) }) : null
    ]);
  }

  function chipsRow(children) {
    return ui.h('div', { class: 'chiprow' }, children);
  }

  /* ---------------------------------------------------------------- 物品卡片 */

  function metaText(item, app) {
    const parts = [];
    const loc = M.trimOrNull(item.location);
    if (loc) parts.push(loc);
    const cat = app.repo.categoryName(item.categoryId);
    if (cat) parts.push(cat);
    if (!parts.length) {
      const t = M.relativeTime(item.createdAt);
      if (t) parts.push(t);
    }
    return parts.join(' · ');
  }

  function tagsOf(item, app, max) {
    const names = app.repo.tagNames(item.tagIds);
    const shown = names.slice(0, max || 2);
    const rest = names.length - shown.length;
    return ui.h('div', { class: 'cardtags' }, shown.map(function (n) { return tagEl(n, { small: true }); })
      .concat(rest > 0 ? [tagEl('+' + rest, { small: true, tone: 'muted' })] : []));
  }

  /**
   * 物品卡片
   * @param {object} item
   * @param {{query?:string, app:object, pool:object, showTags?:boolean, noThumb?:boolean, onOpen?:function}} opts
   */
  function itemCard(item, opts) {
    const o = opts || {};
    const app = o.app;
    const pool = o.pool;
    const firstImage = (item.imageIds || [])[0];
    const title = ui.h('div', { class: 'itemcard__title' });
    if (o.query) title.appendChild(ui.highlighted(item.name, o.query));
    else title.textContent = item.name || '（未命名）';

    const children = [];
    // noThumb：主页 / 物品列表只显示文字，不显示照片
    if (!o.noThumb) {
      children.push(thumb(firstImage, app, pool, { class: 'itemcard__thumb', iconSize: 24 }));
    }
    children.push(ui.h('div', { class: 'itemcard__body' }, [
      title,
      metaText(item, app) ? ui.h('div', { class: 'itemcard__meta', text: metaText(item, app) }) : null,
      o.showTags === false ? null : tagsOf(item, app, 2)
    ]));
    children.push(ui.h('span', { class: 'itemcard__chevron' }, [ui.icon('chevron', { size: 16 })]));

    const card = ui.h('button', {
      class: 'card itemcard' + (o.noThumb ? ' itemcard--text' : ''),
      type: 'button',
      dataset: { id: item.id },
      onClick: function () {
        if (typeof o.onOpen === 'function') o.onOpen(item);
        else app.openItem(item.id);
      }
    }, children);
    return card;
  }

  /** 紧凑行（搜索 / 回收站）：全站统一为纯文字，不显示缩略图 */
  function itemRow(item, opts) {
    const o = opts || {};
    const app = o.app;
    const title = ui.h('div', { class: 'itemrow__title' });
    if (o.query) title.appendChild(ui.highlighted(item.name, o.query));
    else title.textContent = item.name || '（未命名）';

    const right = o.right ? ui.h('div', { class: 'itemrow__right' }, o.right) : null;

    const row = ui.h('button', {
      class: 'card itemrow',
      type: 'button',
      dataset: { id: item.id },
      onClick: function () {
        if (typeof o.onClick === 'function') o.onClick(item);
        else app.openItem(item.id);
      }
    }, [
      ui.h('div', { class: 'itemrow__body' }, [
        title,
        o.subtitle !== false
          ? ui.h('div', { class: 'itemrow__meta', text: o.metaText || metaText(item, app) })
          : null,
        o.query && item.notes && String(item.notes).toLowerCase().indexOf(String(o.query).toLowerCase()) >= 0
          ? ui.h('div', { class: 'itemrow__hint' }, ui.highlighted(String(item.notes).slice(0, 60), o.query))
          : null
      ]),
      right,
      o.chevron === false ? null : ui.h('span', { class: 'itemrow__chevron' }, [ui.icon('chevron', { size: 16 })])
    ]);
    return row;
  }

  /** 空列表占位（保持与卡片一致的节奏） */
  function notFound(query) {
    return ui.emptyState({
      icon: 'search',
      title: '没有找到相关内容',
      desc: query ? '换个关键词试试，或者检查一下有没有写错字。' : '试试其他关键词。'
    });
  }

  MS.parts = {
    thumb: thumb,
    fillImage: fillImage,
    tagEl: tagEl,
    chipEl: chipEl,
    chipsRow: chipsRow,
    itemCard: itemCard,
    itemRow: itemRow,
    tagsOf: tagsOf,
    metaText: metaText,
    notFound: notFound
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
