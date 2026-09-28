/*!
 * 我的空间 · 添加 / 编辑物品
 * 规则：只有「名称」是必填；其余一律可以留空。
 * 清除：编辑页把内容删空 → 保存时以 '' 提交 → 仓储层归一为 null → 真正清除旧值。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  MS.pages = MS.pages || {};

  MS.pages.editor = function (app) {
    const ui = MS.ui;
    const parts = MS.parts;
    const M = MS.models;

    const f = ui.frame({
      title: '添加物品',
      showBack: true,
      actions: [{ icon: 'check', label: '保存', primary: true, onClick: function () { save(); } }]
    });
    const pools = ui.poolBox();      // 已保存图片
    const staged = ui.urlPool();     // 待保存的新图片
    const state = {
      id: null,
      pending: [],
      removed: [],
      tagIds: [],
      categoryId: null,
      dirty: false,
      saving: false,
      confirmed: false
    };
    const fields = {};
    const refs = {};

    function markDirty() { state.dirty = true; }

    /* ---------------------------------------------------------- 表单构建 */

    function makeInput(key, opts) {
      const o = opts || {};
      const tag = o.multiline ? 'textarea' : 'input';
      const input = ui.h(tag, {
        class: o.multiline ? 'input input--area' : 'input',
        type: o.multiline ? null : (o.type || 'text'),
        inputmode: o.inputmode || null,
        placeholder: o.placeholder || '',
        rows: o.multiline ? 4 : null,
        maxlength: o.maxlength || null,
        list: o.list || null,
        autocomplete: 'off'
      });
      input.addEventListener('input', markDirty);
      fields[key] = input;
      return input;
    }

    function fieldRow(label, node, opts) {
      const o = opts || {};
      return ui.h('div', { class: 'field' + (o.className ? ' ' + o.className : '') }, [
        ui.h('label', { class: 'field__label', text: label }),
        node,
        o.hint ? ui.h('div', { class: 'field__hint', text: o.hint }) : null
      ]);
    }

    function buildForm() {
      /* — 图片 — */
      const strip = ui.h('div', { class: 'imgstrip' });
      refs.strip = strip;
      const imagesBlock = ui.h('div', { class: 'imgblock' }, [
        ui.h('div', { class: 'imgblock__head' }, [
          ui.h('span', { class: 'field__label', text: '图片' }),
          ui.h('span', { class: 'imgblock__count' })
        ]),
        strip
      ]);
      refs.imageCount = imagesBlock.querySelector('.imgblock__count');
      f.body.appendChild(imagesBlock);

      /* — 名称 / 分类 / 标签 — */
      const nameInput = makeInput('name', { placeholder: '例如：Sony 耳机 / HDMI 线', maxlength: 80 });
      nameInput.setAttribute('enterkeyhint', 'next');
      refs.nameError = ui.h('div', { class: 'field__error' });
      const nameField = fieldRow('名称 *', ui.frag([nameInput, refs.nameError]));

      refs.categoryBtn = ui.h('button', {
        class: 'picker', type: 'button',
        onClick: openCategoryPicker
      }, [
        ui.h('span', { class: 'picker__value', text: '未分类' }),
        ui.icon('chevronDown', { size: 17, class: 'picker__caret' })
      ]);

      const tagArea = ui.h('div', { class: 'tagarea' });
      refs.tagArea = tagArea;

      f.body.appendChild(ui.h('div', { class: 'card card--form' }, [
        nameField,
        fieldRow('分类', refs.categoryBtn),
        fieldRow('标签', tagArea)
      ]));

      /* — 详细信息（全部可留空） — */
      const dateInput = makeInput('purchaseDate', { type: 'date' });
      const priceInput = makeInput('purchasePrice', { inputmode: 'decimal', placeholder: '例如：1299' });
      refs.priceError = ui.h('div', { class: 'field__error' });
      priceInput.addEventListener('blur', function () { validatePrice(); });

      const datalist = ui.h('datalist', { id: 'ms-locations' });
      refs.datalist = datalist;
      const locationInput = makeInput('location', { placeholder: '例如：储物箱 A / 卧室 > 衣柜', list: 'ms-locations', maxlength: 60 });

      f.body.appendChild(ui.h('div', { class: 'card card--form' }, [
        ui.h('div', { class: 'formnote', text: '以下内容都可以留空，随时回来补充。' }),
        fieldRow('品牌', makeInput('brand', { placeholder: '例如：Sony', maxlength: 40 })),
        fieldRow('型号', makeInput('model', { placeholder: '例如：WH-1000XM5', maxlength: 60 })),
        fieldRow('购买日期', dateInput, { hint: '点击选择日期，清空即可删除' }),
        fieldRow('购买价格', ui.frag([priceInput, refs.priceError]), { hint: '支持小数，留空表示不记录' }),
        fieldRow('购买渠道', makeInput('purchaseChannel', { placeholder: '例如：京东 / 线下门店', maxlength: 40 })),
        fieldRow('序列号', makeInput('serialNumber', { placeholder: '设备铭牌上的编号', maxlength: 60 })),
        fieldRow('存放位置', locationInput)
      ]));

      f.body.appendChild(ui.h('div', { class: 'card card--form' }, [
        fieldRow('备注', makeInput('notes', { multiline: true, placeholder: '任何想记下来的细节，例如“备用耳塞在盒子夹层”', maxlength: 2000 }))
      ]));

      f.body.appendChild(datalist);
      f.body.appendChild(ui.h('div', { class: 'page__spacer page__spacer--fab' }));

      const saveBtn = ui.h('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        onClick: function () { save(); }
      }, [ui.icon('check', { size: 18 }), ui.h('span', { text: '保存' })]);
      refs.saveBtn = saveBtn;
      f.footer.appendChild(saveBtn);
      f.footer.classList.remove('page__footer--empty');
    }

    function validatePrice() {
      const raw = fields.purchasePrice.value.trim();
      const el = refs.priceError;
      if (!raw) { el.textContent = ''; fields.purchasePrice.classList.remove('input--invalid'); return true; }
      const parsed = M.numOrNull(raw);
      if (parsed === null) {
        el.textContent = '价格格式不正确，这一项将不会被保存。';
        fields.purchasePrice.classList.add('input--invalid');
        return false;
      }
      el.textContent = '';
      fields.purchasePrice.classList.remove('input--invalid');
      return true;
    }

    /* ---------------------------------------------------------- 图片 */

    function addTile(thumbEl, onRemove, badge) {
      const tile = ui.h('div', { class: 'imgtile' }, [thumbEl]);
      if (badge) tile.appendChild(ui.h('span', { class: 'imgtile__badge', text: badge }));
      tile.appendChild(ui.h('button', {
        class: 'imgtile__remove', type: 'button', 'aria-label': '移除图片',
        onClick: onRemove
      }, [ui.icon('close', { size: 13 })]));
      return tile;
    }

    function renderImages() {
      const pool = pools.reset();
      const strip = refs.strip;
      ui.clear(strip);
      const existing = state.id
        ? app.repo.itemImages(state.id).filter(function (im) { return state.removed.indexOf(im.id) === -1; })
        : [];

      existing.forEach(function (meta) {
        strip.appendChild(addTile(
          parts.thumb(meta.id, app, pool, { class: 'imgtile__img', iconSize: 18 }),
          function () {
            state.removed.push(meta.id);
            markDirty();
            renderImages();
          }
        ));
      });

      state.pending.forEach(function (entry, index) {
        const box = ui.h('div', { class: 'thumb imgtile__img' });
        const url = staged.url(entry.thumb || entry.blob);
        if (url) {
          const img = document.createElement('img');
          img.className = 'thumb__img';
          img.alt = '';
          img.src = url;
          box.dataset.loaded = '1';
          box.appendChild(img);
        }
        strip.appendChild(addTile(box, function () {
          state.pending.splice(index, 1);
          markDirty();
          renderImages();
        }, '待保存'));
      });

      strip.appendChild(ui.h('button', {
        class: 'imgtile imgtile--add', type: 'button', 'aria-label': '添加图片',
        onClick: openImagePicker
      }, [ui.icon('plus', { size: 20 }), ui.h('span', { text: '添加图片' })]));

      refs.imageCount.textContent = (existing.length + state.pending.length) + ' 张';
    }

    function openImagePicker() {
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
        type: 'file', accept: 'image/*',
        style: { position: 'fixed', left: '-9999px' }
      });
      if (camera) input.setAttribute('capture', 'environment');
      else input.setAttribute('multiple', 'multiple');
      input.addEventListener('change', function () {
        const files = Array.prototype.slice.call(input.files || []);
        if (!files.length) { if (input.parentNode) input.parentNode.removeChild(input); return; }
        ui.toast('正在压缩图片…', { duration: 1400 });
        Promise.all(files.map(function (file) {
          return MS.imaging.prepareImage(file).catch(function () { return null; });
        })).then(function (results) {
          const list = results.filter(Boolean);
          if (!list.length) { ui.toast(MS.ERROR_MESSAGES.IMAGE_BROKEN, { tone: 'danger' }); return; }
          list.forEach(function (entry) { state.pending.push(entry); });
          markDirty();
          renderImages();
          ui.toast('已选择 ' + list.length + ' 张图片', { icon: 'gallery' });
        }).catch(function (e) {
          ui.toast(MS.friendly(e), { tone: 'danger' });
        }).then(function () {
          if (input.parentNode) input.parentNode.removeChild(input);
        });
      });
      document.body.appendChild(input);
      input.click();
    }

    /* ---------------------------------------------------------- 分类 */

    function setCategory(id) {
      state.categoryId = id;
      refs.categoryBtn.querySelector('.picker__value').textContent = id ? (app.repo.categoryName(id) || '未分类') : '未分类';
      markDirty();
    }

    function openCategoryPicker() {
      const cats = app.repo.listCategories();
      const counts = {};
      app.repo.categoriesWithCounts().list.forEach(function (row) { counts[row.category.id] = row.count; });
      ui.sheet({
        title: '选择分类',
        actions: [
          { label: '未分类', icon: state.categoryId ? 'folder' : 'check', onClick: function () { setCategory(null); } }
        ].concat(cats.map(function (cat) {
          return {
            label: cat.name,
            desc: counts[cat.id] ? counts[cat.id] + ' 件' : null,
            icon: state.categoryId === cat.id ? 'check' : 'folder',
            onClick: function () { setCategory(cat.id); }
          };
        })).concat([{
          label: '新建分类…',
          icon: 'plus',
          onClick: function () {
            ui.prompt({ title: '新建分类', label: '分类名称', placeholder: '例如：露营 / 乐器', confirmText: '创建' })
              .then(function (name) {
                if (!name) return;
                return app.repo.createCategory(name).then(function (cat) { setCategory(cat.id); });
              })
              .catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
          }
        }])
      });
    }

    /* ---------------------------------------------------------- 标签 */

    function renderTags() {
      ui.clear(refs.tagArea);
      const names = app.repo.tagNames(state.tagIds);
      names.forEach(function (name, index) {
        refs.tagArea.appendChild(ui.h('button', {
          class: 'tag tag--removable', type: 'button',
          onClick: function () {
            state.tagIds.splice(index, 1);
            markDirty();
            renderTags();
          }
        }, [ui.h('span', { text: '#' + name }), ui.icon('close', { size: 12 })]));
      });
      refs.tagArea.appendChild(ui.h('button', {
        class: 'tag tag--add', type: 'button',
        onClick: openTagPicker
      }, [ui.icon('plus', { size: 13 }), ui.h('span', { text: '添加标签' })]));
    }

    function openTagPicker() {
      const selected = state.tagIds.slice();
      const rows = ui.h('div', { class: 'tagpick' });
      const all = app.repo.tagsWithCounts();

      function rowFor(tag, count) {
        const check = ui.h('span', { class: 'tagpick__check' }, [
          selected.indexOf(tag.id) >= 0 ? ui.icon('check', { size: 15 }) : null
        ]);
        const row = ui.h('button', {
          class: 'tagpick__row' + (selected.indexOf(tag.id) >= 0 ? ' tagpick__row--on' : ''),
          type: 'button',
          onClick: function () {
            const i = selected.indexOf(tag.id);
            if (i >= 0) selected.splice(i, 1); else selected.push(tag.id);
            const on = selected.indexOf(tag.id) >= 0;
            row.classList.toggle('tagpick__row--on', on);
            ui.clear(check);
            if (on) check.appendChild(ui.icon('check', { size: 15 }));
          }
        }, [
          ui.h('span', { class: 'tagpick__name', text: '#' + tag.name }),
          count !== undefined ? ui.h('span', { class: 'tagpick__count', text: count + ' 件' }) : null,
          check
        ]);
        return row;
      }

      all.forEach(function (item) { rows.appendChild(rowFor(item.tag, item.count)); });
      if (!all.length) {
        rows.appendChild(ui.h('div', { class: 'sheet__note', text: '还没有标签。常用标签：常用、备用、重要、闲置、待维修、贵重。' }));
      }

      ui.sheet({
        title: '标签',
        tall: all.length > 6,
        content: rows,
        actions: [
          {
            label: '新建标签…', icon: 'plus',
            onClick: function () {
              ui.prompt({ title: '新建标签', label: '标签名称', placeholder: '例如：待维修', confirmText: '创建' })
                .then(function (name) {
                  if (!name) return;
                  return app.repo.ensureTag(name).then(function (tag) {
                    if (tag && selected.indexOf(tag.id) < 0) selected.push(tag.id);
                    applyTags(selected);
                  });
                })
                .catch(function (e) { ui.toast(MS.friendly(e), { tone: 'danger' }); });
            }
          },
          { label: '完成', icon: 'check', onClick: function () { applyTags(selected); } }
        ]
      });
    }

    function applyTags(ids) {
      state.tagIds = M.uniq(ids);
      markDirty();
      renderTags();
    }

    /* ---------------------------------------------------------- 存取 */

    function collect() {
      return {
        name: fields.name.value.trim(),
        categoryId: state.categoryId,
        tagIds: state.tagIds.slice(),
        brand: fields.brand.value,
        model: fields.model.value,
        purchaseDate: fields.purchaseDate.value,
        purchasePrice: fields.purchasePrice.value,
        purchaseChannel: fields.purchaseChannel.value,
        serialNumber: fields.serialNumber.value,
        location: fields.location.value,
        notes: fields.notes.value
      };
    }

    function setBusy(busy) {
      state.saving = busy;
      refs.saveBtn.disabled = busy;
      refs.saveBtn.querySelector('span').textContent = busy ? '保存中…' : '保存';
    }

    async function save() {
      if (state.saving) return;
      const name = fields.name.value.trim();
      if (!name) {
        refs.nameError.textContent = '名称是唯一必填项，请填写后再保存。';
        fields.name.classList.add('input--invalid');
        ui.anim.run(refs.nameError, [{ opacity: 0 }, { opacity: 1 }], { duration: ui.anim.dur('small') });
        MS.keyboard.ensureVisible(fields.name, 60);
        fields.name.focus();
        return;
      }
      refs.nameError.textContent = '';
      fields.name.classList.remove('input--invalid');
      validatePrice();

      setBusy(true);
      try {
        const payload = collect();
        const saved = state.id
          ? await app.repo.updateItem(state.id, payload)
          : await app.repo.createItem(payload);

        if (state.pending.length) await app.repo.addImages(saved.id, state.pending);
        for (let i = 0; i < state.removed.length; i++) await app.repo.removeImage(state.removed[i]);

        state.dirty = false;
        state.confirmed = true;
        state.pending = [];
        state.removed = [];
        MS.keyboard.hide();
        ui.toast(state.id ? '已保存修改' : '已添加到我的空间', { icon: 'check' });
        if (state.id) app.router.back();
        else app.router.replaceTop('detail', { id: saved.id });
      } catch (e) {
        ui.toast(MS.friendly(e), { tone: 'danger' });
      } finally {
        setBusy(false);
      }
    }

    function fillDatalist() {
      ui.clear(refs.datalist);
      app.repo.locations().slice(0, 40).forEach(function (loc) {
        refs.datalist.appendChild(ui.h('option', { value: loc }));
      });
    }

    function fill(item) {
      fields.name.value = item ? M.displayText(item.name) : '';
      fields.brand.value = item ? M.displayText(item.brand) : '';
      fields.model.value = item ? M.displayText(item.model) : '';
      fields.purchaseDate.value = item && item.purchaseDate ? item.purchaseDate : '';
      fields.purchasePrice.value = item && item.purchasePrice !== null && item.purchasePrice !== undefined
        ? M.formatAmount(item.purchasePrice) : '';
      fields.purchaseChannel.value = item ? M.displayText(item.purchaseChannel) : '';
      fields.serialNumber.value = item ? M.displayText(item.serialNumber) : '';
      fields.location.value = item ? M.displayText(item.location) : '';
      fields.notes.value = item ? M.displayText(item.notes) : '';
      refs.nameError.textContent = '';
      refs.priceError.textContent = '';
      fields.name.classList.remove('input--invalid');
      fields.purchasePrice.classList.remove('input--invalid');
    }

    buildForm();

    return {
      el: f.el,
      tab: -1,
      showNav: false,
      onEnter: function (params) {
        const item = params && params.id ? app.repo.getItem(params.id) : null;
        state.id = item ? item.id : null;
        state.item = item;
        state.pending = [];
        state.removed = [];
        state.tagIds = item ? (item.tagIds || []).slice() : [];
        state.categoryId = item ? item.categoryId : null;
        f.setTitle(item ? '编辑物品' : '添加物品');
        fill(item);
        fillDatalist();
        renderImages();
        setCategory(state.categoryId);
        renderTags();
        // 载入完成后才重置"已修改"标记（setCategory/renderTags 会标记 dirty）
        state.dirty = false;
        state.confirmed = false;
        f.el.scrollTop = 0;
        if (!item) {
          setTimeout(function () {
            try { fields.name.focus(); } catch (e) { /* ignore */ }
          }, MS.anim.dur('page'));
        }
      },
      onLeave: function () {
        staged.release();
        pools.release();
        MS.keyboard.hide();
      },
      onBack: function () {
        if (state.confirmed || !state.dirty) return false;
        ui.confirm({
          title: '是否放弃当前编辑？',
          message: '未保存的内容将会丢失。',
          confirmText: '放弃',
          cancelText: '继续编辑',
          danger: true
        }).then(function (yes) {
          if (!yes) return;
          state.dirty = false;
          state.confirmed = true;
          app.router.back();
        });
        return true;   // 先拦下返回，由对话框决定
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
