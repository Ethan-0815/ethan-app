/* ETHAN V0.1 — item.js
 * 详情页 / 编辑页 / 密码生成器。敏感字段默认隐藏，列表页不出现敏感内容。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var C = root.Ethan.Crypto;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  /* ==================== 密码生成器 ==================== */
  function openGenerator(onUse) {
    var opts = { length: 16, upper: true, lower: true, digits: true, symbols: true };
    var current = C.generatePassword(opts);

    UI.sheet({
      title: '生成密码',
      build: function (body, api) {
        body.innerHTML =
          '<div class="gen__len">' +
          '<input type="range" id="g-len" min="8" max="40" step="1" value="16">' +
          '<span class="gen__len_val" id="g-len-v">16</span></div>' +
          '<div id="g-opts">' +
          checkHtml('upper', '大写字母', true) +
          checkHtml('lower', '小写字母', true) +
          checkHtml('digits', '数字', true) +
          checkHtml('symbols', '特殊字符', true) +
          '</div>' +
          '<div class="gen__out" id="g-out">' + UI.esc(current) + '</div>' +
          '<div class="strength" id="g-strength"></div>';

        var len = body.querySelector('#g-len');
        var lenV = body.querySelector('#g-len-v');
        var out = body.querySelector('#g-out');

        function regen() {
          current = C.generatePassword(opts);
          out.textContent = current;
          renderStrength();
        }
        function renderStrength() {
          var st = C.passwordStrength(current);
          var box = body.querySelector('#g-strength');
          var pct = Math.min(100, (st.score / 5) * 100);
          var color = st.score >= 4 ? '#2f9e63' : st.score >= 3 ? '#d99b2b' : '#c25a5a';
          box.innerHTML = '<span class="strength__bar"><span class="strength__fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
            '<span class="strength__label">' + UI.esc(st.label) + '</span>';
        }

        len.addEventListener('input', function () {
          opts.length = parseInt(len.value, 10);
          lenV.textContent = opts.length;
          regen();
        });
        Array.prototype.forEach.call(body.querySelectorAll('#g-opts input'), function (inp) {
          inp.addEventListener('change', function () {
            opts[inp.value] = inp.checked;
            if (!opts.upper && !opts.lower && !opts.digits && !opts.symbols) {
              inp.checked = true;
              opts[inp.value] = true;
              UI.toast('至少需要一种字符类型');
              return;
            }
            regen();
          });
        });
        renderStrength();
      },
      actions: [
        { text: '重新生成', onClick: function (api) {
            current = C.generatePassword(opts);
            var out = api.el.querySelector('#g-out');
            if (out) out.textContent = current;
            var len = api.el.querySelector('#g-len');
            if (len) opts.length = parseInt(len.value, 10);
          } },
        { text: '使用这个密码', variant: 'accent', onClick: function (api) {
            var len = api.el.querySelector('#g-len');
            if (len) opts.length = parseInt(len.value, 10);
            if (onUse) onUse(current);
            api.close();
          } }
      ]
    });
  }

  function checkHtml(value, label, checked) {
    return '<label class="check"><input type="checkbox" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="check__box">' + I.svg('check', 13) + '</span><span>' + UI.esc(label) + '</span></label>';
  }

  /* ==================== 详情页 ==================== */
  function open(id) {
    var item = S.get(id);
    if (!item) { UI.toast('内容不存在'); return; }
    var revealed = {};
    S.touch(id);

    var panel = UI.openPanel({
      title: '',
      action: {
        label: '编辑',
        onClick: function (api) { api.close(); openEditor(id); }
      },
      build: function (body) { renderDetail(body, item, revealed); },
      footer: function (foot, api) {
        foot.innerHTML = '<button class="btn btn--danger btn--block" data-act="delete">删除</button>';
        foot.querySelector('[data-act=delete]').addEventListener('click', function () {
          UI.confirm({
            title: '删除「' + item.title + '」？',
            desc: '会先放入回收站，可在回收站中恢复。',
            okText: '删除', danger: true
          }).then(function (yes) {
            if (!yes) return;
            S.softDelete(id).then(function () {
              UI.toast('已放入回收站');
              api.close();
              root.Ethan.App.renderCurrent();
            }).catch(function (err) { UI.toast(err.message || '删除失败'); });
          });
        });
      }
    });
  }

  function renderDetail(body, item, revealed) {
    var html = '<div class="detail-head">' +
      '<div class="detail-head__title">' + UI.esc(item.title) + '</div>' +
      '<div class="detail-head__sub">' + UI.esc(UI.catLabel(item.category)) +
      (item.category === 'secret' ? ' · ' + UI.esc(item.type) : '') + '</div></div>';

    function secretRow(label, value, key, mono) {
      if (!value) return UI.field(label, '', { empty: true });
      var shown = !!revealed[key];
      var text = shown ? UI.esc(value) : UI.esc(U.mask(String(value).length));
      return UI.field(label, '<span data-v="' + key + '">' + text + '</span>', {
        mono: mono !== false,
        ops: UI.opBtn(shown ? 'eyeOff' : 'eye', shown ? '隐藏' : '显示', 'data-toggle="' + key + '"') +
             UI.opBtn('copy', '复制', 'data-copy="' + key + '"')
      });
    }

    html += '<div class="field-card">';

    if (item.category === 'account') {
      html += UI.field('用户名 / 邮箱', item.username ? UI.esc(item.username) : '', {
        empty: !item.username,
        ops: item.username ? UI.opBtn('copy', '复制', 'data-copy="username"') : ''
      });
      html += secretRow('密码', item.password, 'password');
      if (item.url) {
        html += UI.field('登录网址',
          '<span>' + UI.esc(item.url) + '</span>', {
            ops: UI.opBtn('external', '打开', 'data-open="url"') + UI.opBtn('copy', '复制', 'data-copy="url"')
          });
      }
      if (item.recoveryCodes && item.recoveryCodes.length) {
        var codes = '';
        item.recoveryCodes.forEach(function (c, i) {
          var k = 'rc-' + i;
          var shown = !!revealed[k];
          codes += '<div class="code-line"><span>' + UI.esc(shown ? c.value : U.mask(String(c.value).length)) + '</span>' +
            UI.opBtn(shown ? 'eyeOff' : 'eye', '显示 / 隐藏', 'data-toggle="' + k + '"') +
            UI.opBtn('copy', '复制', 'data-copy="' + k + '"') + '</div>';
        });
        html += '<div class="field"><div class="field__label">备用验证码（' + item.recoveryCodes.length + '）</div>' +
          '<div class="field__value"><div class="field__text"><div class="code-list">' + codes + '</div></div></div></div>';
      }
      html += UI.field('备注', item.note ? UI.esc(item.note) : '', { empty: !item.note });
    } else if (item.category === 'secret') {
      html += UI.field('类型', UI.esc(item.type));
      html += secretRow('密钥', item.value, 'value');
      html += UI.field('备注', item.note ? UI.esc(item.note) : '', { empty: !item.note });
    } else if (item.category === 'text') {
      html += UI.field('内容', UI.esc(item.content || ''), {
        empty: !item.content,
        ops: item.content ? UI.opBtn('copy', '复制', 'data-copy="content"') : ''
      });
    } else {
      if (item.fields && item.fields.length) {
        item.fields.forEach(function (f, i) {
          var k = 'f-' + i;
          if (f.secret) {
            html += secretRow(f.name || '字段 ' + (i + 1), f.value, k);
          } else {
            html += UI.field(f.name || '字段 ' + (i + 1), f.value ? UI.esc(f.value) : '', {
              empty: !f.value,
              ops: f.value ? UI.opBtn('copy', '复制', 'data-copy="' + k + '"') : ''
            });
          }
        });
      } else {
        html += UI.field('字段', '', { empty: true });
      }
      html += UI.field('备注', item.note ? UI.esc(item.note) : '', { empty: !item.note });
    }

    if (item.tags && item.tags.length) {
      html += '<div class="field"><div class="field__label">标签</div><div class="field__value"><div class="field__text"><div class="tags">' +
        item.tags.map(function (t) { return '<span class="tag">' + UI.esc(t) + '</span>'; }).join('') +
        '</div></div></div></div>';
    }

    html += '</div>';

    html += '<div class="meta-line"><span>最后修改</span><span>' + U.formatDate(item.updatedAt) + '</span></div>';

    body.innerHTML = html;

    function valOf(key) {
      if (key === 'username') return item.username;
      if (key === 'password') return item.password;
      if (key === 'url') return item.url;
      if (key === 'value') return item.value;
      if (key === 'content') return item.content;
      if (key.indexOf('rc-') === 0) return item.recoveryCodes[parseInt(key.slice(3), 10)].value;
      if (key.indexOf('f-') === 0) return item.fields[parseInt(key.slice(2), 10)].value;
      return '';
    }

    Array.prototype.forEach.call(body.querySelectorAll('[data-toggle]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-toggle');
        revealed[k] = !revealed[k];
        renderDetail(body, item, revealed);
      });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-copy]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-copy');
        UI.copy(valOf(k), '');
      });
    });
    var openBtn = body.querySelector('[data-open=url]');
    if (openBtn) openBtn.addEventListener('click', function () {
      window.open(U.normalizeUrl(item.url), '_blank', 'noopener,noreferrer');
    });
  }

  /* ==================== 编辑页 ==================== */
  function openEditor(idOrCategory) {
    var isNew = !S.get(idOrCategory);
    var item = isNew ? S.newItem(idOrCategory) : U.deepClone(S.get(idOrCategory));
    if (!item) { UI.toast('内容不存在'); return; }

    var panel = UI.openPanel({
      title: isNew ? '新建' + titleOf(item.category) : '编辑',
      build: function (body) { buildForm(body, item, isNew); },
      footer: function (foot, api) {
        foot.innerHTML = '<button class="btn btn--primary btn--block" data-act="save">保存</button>';
        foot.querySelector('[data-act=save]').addEventListener('click', function () {
          save(item, isNew, api, panel);
        });
      }
    });
  }

  function titleOf(c) {
    return c === 'account' ? '账号' : c === 'secret' ? '密钥' : c === 'text' ? '文本' : '其他';
  }

  function save(item, isNew, api, panel) {
    var body = api.el.querySelector('.panel__body');
    var errBox = body.querySelector('.form-error');
    var title = body.querySelector('#f-title');
    item.title = title ? title.value.trim() : item.title;

    if (item.category === 'account') {
      item.username = val(body, '#f-username');
      item.password = val(body, '#f-password');
      item.url = val(body, '#f-url');
      item.note = val(body, '#f-note');
    } else if (item.category === 'secret') {
      item.type = val(body, '#f-type');
      item.value = val(body, '#f-value');
      item.note = val(body, '#f-note');
    } else if (item.category === 'text') {
      item.content = val(body, '#f-content');
    } else {
      item.note = val(body, '#f-note');
      // 字段值读取（动态重绘的 input）
      Array.prototype.forEach.call(body.querySelectorAll('[data-fid]'), function (inp) {
        var fid = inp.getAttribute('data-fid');
        var kind = inp.getAttribute('data-kind');
        item.fields.forEach(function (f) {
          if (f.id === fid) f[kind] = inp.value;
        });
      });
    }

    var v = S.validate(item);
    if (!v.ok) {
      if (errBox) { errBox.textContent = v.message; errBox.hidden = false; }
      UI.toast(v.message);
      if (title) title.focus();
      return;
    }

    S.save(item).then(function () {
      UI.toast(isNew ? '已保存' : '已更新');
      panel.close();
      root.Ethan.App.renderCurrent();
      // 保存后回到详情页，展示最新内容
      root.Ethan.Item.open(item.id);
    }).catch(function (e) {
      UI.toast(e && e.message ? e.message : '保存失败');
    });
  }

  function val(body, sel) {
    var e = body.querySelector(sel);
    return e ? e.value : '';
  }

  function buildForm(body, item, isNew) {
    var html = '<div class="form"><div class="form-error error-text" hidden></div>';

    html += '<div class="form__group"><label class="label" for="f-title">' +
      (item.category === 'account' ? '账号名称' : item.category === 'text' || item.category === 'other' ? '标题' : '名称') + '</label>' +
      '<input class="input" id="f-title" type="text" placeholder="' +
      (item.category === 'account' ? '例如 Steam' : '名称') + '" value="' + UI.esc(item.title) + '"></div>';

    if (item.category === 'account') {
      html += group('用户名 / 邮箱', '<input class="input" id="f-username" type="text" autocomplete="off" placeholder="可选" value="' + UI.esc(item.username) + '">');
      html += group('密码',
        '<div class="input-wrap"><input class="input" id="f-password" type="password" autocomplete="new-password" placeholder="必填" value="' + UI.esc(item.password) + '">' +
        '<span class="input-wrap__ops">' +
        '<button class="minibtn" id="f-pw-eye" type="button" title="显示 / 隐藏">' + I.svg('eye', 17) + '</button>' +
        '<button class="minibtn" id="f-pw-gen" type="button" title="生成密码">' + I.svg('refresh', 17) + '</button>' +
        '</span></div>' +
        '<div class="strength" id="f-pw-strength"></div>');
      html += group('登录网址', '<input class="input" id="f-url" type="text" autocomplete="off" inputmode="url" placeholder="可选" value="' + UI.esc(item.url) + '">');
      html += '<div class="form__group"><label class="label">备用验证码</label>' +
        '<div id="f-codes"></div>' +
        '<button class="btn btn--sm btn--ghost" id="f-code-add" type="button" style="margin-top:6px">＋ 添加</button></div>';
      html += group('备注', '<textarea class="textarea" id="f-note" style="min-height:84px" placeholder="可选">' + UI.esc(item.note) + '</textarea>');
    } else if (item.category === 'secret') {
      html += group('类型', '<select class="select" id="f-type">' +
        S.SECRET_TYPES.map(function (t) {
          return '<option value="' + UI.esc(t) + '"' + (item.type === t ? ' selected' : '') + '>' + UI.esc(t) + '</option>';
        }).join('') + '</select>');
      html += group('密钥',
        '<div class="input-wrap"><input class="input" id="f-value" type="password" autocomplete="off" placeholder="必填" value="' + UI.esc(item.value) + '">' +
        '<span class="input-wrap__ops">' +
        '<button class="minibtn" id="f-val-eye" type="button" title="显示 / 隐藏">' + I.svg('eye', 17) + '</button>' +
        '</span></div>');
      html += group('备注', '<textarea class="textarea" id="f-note" style="min-height:84px" placeholder="可选">' + UI.esc(item.note) + '</textarea>');
    } else if (item.category === 'text') {
      html += group('内容', '<textarea class="textarea" id="f-content" placeholder="支持多行长文本">' + UI.esc(item.content) + '</textarea>');
    } else {
      html += '<div class="form__group"><label class="label">字段</label><div id="f-fields"></div>' +
        '<button class="btn btn--sm btn--ghost" id="f-field-add" type="button" style="margin-top:6px">＋ 添加字段</button></div>';
      html += group('备注', '<textarea class="textarea" id="f-note" style="min-height:78px" placeholder="可选">' + UI.esc(item.note) + '</textarea>');
    }

    html += '<div class="form__group"><label class="label">标签</label>' +
      '<input class="input" id="f-tag-input" type="text" placeholder="输入后回车添加" autocomplete="off">' +
      '<div class="chips" id="f-tags" style="margin-top:8px"></div></div>';

    html += '</div>';
    body.innerHTML = html;

    /* 标签 */
    var tagInput = body.querySelector('#f-tag-input');
    var tagBox = body.querySelector('#f-tags');
    function renderTags() {
      tagBox.innerHTML = item.tags.map(function (t, i) {
        return '<span class="chip"><span>' + UI.esc(t) + '</span>' +
          '<button class="chip__x" data-ti="' + i + '" aria-label="移除">×</button></span>';
      }).join('');
      Array.prototype.forEach.call(tagBox.querySelectorAll('[data-ti]'), function (b) {
        b.addEventListener('click', function () {
          item.tags.splice(parseInt(b.getAttribute('data-ti'), 10), 1);
          renderTags();
        });
      });
    }
    function addTag(t) {
      t = String(t || '').trim().replace(/[,，]$/, '');
      if (!t) return;
      if (item.tags.indexOf(t) >= 0) { UI.toast('标签已存在'); return; }
      if (item.tags.length >= 20) { UI.toast('标签过多'); return; }
      item.tags.push(t);
      renderTags();
    }
    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        addTag(tagInput.value);
        tagInput.value = '';
      }
    });
    tagInput.addEventListener('blur', function () {
      if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; }
    });
    renderTags();

    /* 密码显示 / 生成 */
    var pwEye = body.querySelector('#f-pw-eye');
    var pw = body.querySelector('#f-password');
    if (pwEye && pw) {
      pwEye.addEventListener('click', function () {
        pw.type = pw.type === 'password' ? 'text' : 'password';
        pwEye.innerHTML = I.svg(pw.type === 'password' ? 'eye' : 'eyeOff', 17);
      });
      var renderPwStrength = function () {
        var st = C.passwordStrength(pw.value);
        var box = body.querySelector('#f-pw-strength');
        if (!box) return;
        if (!pw.value) { box.innerHTML = ''; return; }
        var pct = Math.min(100, (st.score / 5) * 100);
        var color = st.score >= 4 ? '#2f9e63' : st.score >= 3 ? '#d99b2b' : '#c25a5a';
        box.innerHTML = '<span class="strength__bar"><span class="strength__fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
          '<span class="strength__label">' + UI.esc(st.label) + '</span>';
      };
      pw.addEventListener('input', renderPwStrength);
      renderPwStrength();
    }
    var pwGen = body.querySelector('#f-pw-gen');
    if (pwGen) pwGen.addEventListener('click', function () {
      openGenerator(function (pwd) {
        pw.value = pwd;
        pw.type = 'text';
        pwEye.innerHTML = I.svg('eyeOff', 17);
        renderPwStrength();
        UI.toast('已填入生成的密码');
      });
    });

    var valEye = body.querySelector('#f-val-eye');
    var valInp = body.querySelector('#f-value');
    if (valEye && valInp) valEye.addEventListener('click', function () {
      valInp.type = valInp.type === 'password' ? 'text' : 'password';
      valEye.innerHTML = I.svg(valInp.type === 'password' ? 'eye' : 'eyeOff', 17);
    });

    /* 备用验证码 */
    var codesBox = body.querySelector('#f-codes');
    if (codesBox) {
      function renderCodes() {
        if (!item.recoveryCodes.length) {
          codesBox.innerHTML = '<div class="hint">还没有备用验证码</div>';
          return;
        }
        codesBox.innerHTML = item.recoveryCodes.map(function (c, i) {
          return '<div class="kv-row">' +
            '<div class="kv-row__inputs">' +
            '<input class="input" data-cid="' + c.id + '" type="text" value="' + UI.esc(c.value) + '" placeholder="验证码">' +
            '</div>' +
            '<div class="kv-row__ops">' +
            '<button class="minibtn" data-ccopy="' + i + '" title="复制">' + I.svg('copy', 16) + '</button>' +
            '<button class="minibtn" data-cdel="' + i + '" title="删除">' + I.svg('x', 16) + '</button>' +
            '</div></div>';
        }).join('');
        Array.prototype.forEach.call(codesBox.querySelectorAll('[data-cid]'), function (inp) {
          inp.addEventListener('input', function () {
            var cid = inp.getAttribute('data-cid');
            item.recoveryCodes.forEach(function (c) { if (c.id === cid) c.value = inp.value; });
          });
        });
        Array.prototype.forEach.call(codesBox.querySelectorAll('[data-cdel]'), function (b) {
          b.addEventListener('click', function () {
            item.recoveryCodes.splice(parseInt(b.getAttribute('data-cdel'), 10), 1);
            renderCodes();
          });
        });
        Array.prototype.forEach.call(codesBox.querySelectorAll('[data-ccopy]'), function (b) {
          b.addEventListener('click', function () {
            UI.copy(item.recoveryCodes[parseInt(b.getAttribute('data-ccopy'), 10)].value, '');
          });
        });
      }
      body.querySelector('#f-code-add').addEventListener('click', function () {
        item.recoveryCodes.push({ id: U.uid(), value: '' });
        renderCodes();
        var last = codesBox.querySelector('.kv-row:last-child input');
        if (last) last.focus();
      });
      renderCodes();
    }

    /* 自定义字段 */
    var fieldsBox = body.querySelector('#f-fields');
    if (fieldsBox) {
      function renderFields() {
        if (!item.fields.length) {
          fieldsBox.innerHTML = '<div class="hint">还没有字段</div>';
          return;
        }
        fieldsBox.innerHTML = item.fields.map(function (f, i) {
          return '<div class="kv-row">' +
            '<div class="kv-row__inputs">' +
            '<input class="input" data-fid="' + f.id + '" data-kind="name" type="text" value="' + UI.esc(f.name) + '" placeholder="名称">' +
            '<input class="input" data-fid="' + f.id + '" data-kind="value" type="' + (f.secret ? 'password' : 'text') + '" value="' + UI.esc(f.value) + '" placeholder="内容">' +
            '</div>' +
            '<div class="kv-row__ops">' +
            '<button class="minibtn" data-fsecret="' + i + '" title="' + (f.secret ? '已隐藏，点击改为明文' : '明文，点击改为隐藏') + '">' + I.svg(f.secret ? 'eyeOff' : 'eye', 16) + '</button>' +
            '<button class="minibtn" data-fup="' + i + '" title="上移">' + I.svg('up', 16) + '</button>' +
            '<button class="minibtn" data-fdown="' + i + '" title="下移">' + I.svg('down', 16) + '</button>' +
            '<button class="minibtn" data-fdel="' + i + '" title="删除">' + I.svg('x', 16) + '</button>' +
            '</div></div>';
        }).join('');
        Array.prototype.forEach.call(fieldsBox.querySelectorAll('[data-fid]'), function (inp) {
          inp.addEventListener('input', function () {
            var fid = inp.getAttribute('data-fid');
            var kind = inp.getAttribute('data-kind');
            item.fields.forEach(function (f) { if (f.id === fid) f[kind] = inp.value; });
          });
        });
        Array.prototype.forEach.call(fieldsBox.querySelectorAll('[data-fsecret]'), function (b) {
          b.addEventListener('click', function () {
            var i = parseInt(b.getAttribute('data-fsecret'), 10);
            item.fields[i].secret = !item.fields[i].secret;
            renderFields();
          });
        });
        Array.prototype.forEach.call(fieldsBox.querySelectorAll('[data-fup]'), function (b) {
          b.addEventListener('click', function () {
            var i = parseInt(b.getAttribute('data-fup'), 10);
            if (i > 0) { var t = item.fields[i - 1]; item.fields[i - 1] = item.fields[i]; item.fields[i] = t; renderFields(); }
          });
        });
        Array.prototype.forEach.call(fieldsBox.querySelectorAll('[data-fdown]'), function (b) {
          b.addEventListener('click', function () {
            var i = parseInt(b.getAttribute('data-fdown'), 10);
            if (i < item.fields.length - 1) { var t = item.fields[i + 1]; item.fields[i + 1] = item.fields[i]; item.fields[i] = t; renderFields(); }
          });
        });
        Array.prototype.forEach.call(fieldsBox.querySelectorAll('[data-fdel]'), function (b) {
          b.addEventListener('click', function () {
            item.fields.splice(parseInt(b.getAttribute('data-fdel'), 10), 1);
            renderFields();
          });
        });
      }
      body.querySelector('#f-field-add').addEventListener('click', function () {
        item.fields.push({ id: U.uid(), name: '', value: '', secret: false });
        renderFields();
        var rows = fieldsBox.querySelectorAll('.kv-row');
        var last = rows[rows.length - 1];
        if (last) last.querySelector('input').focus();
      });
      renderFields();
    }

    var titleInput = body.querySelector('#f-title');
    if (titleInput && isNew) setTimeout(function () { titleInput.focus(); }, 120);
  }

  function group(label, inner) {
    return '<div class="form__group"><label class="label">' + UI.esc(label) + '</label>' + inner + '</div>';
  }

  root.Ethan.Item = { open: open, openEditor: openEditor, openGenerator: openGenerator };
})(typeof globalThis !== 'undefined' ? globalThis : this);
