/* ETHAN V0.1 — settings.js
 * 设置：修改 PIN、自动锁定、立即锁定、加密备份、加密恢复、关于。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  var THEMES = [
    { v: 'auto', label: '跟随系统' },
    { v: 'light', label: '浅色' },
    { v: 'dark', label: '深色' }
  ];

  var AUTO_LOCK = [
    { v: 'immediately', label: '立即' },
    { v: 1, label: '1 分钟' },
    { v: 5, label: '5 分钟' },
    { v: 15, label: '15 分钟' },
    { v: 'never', label: '从不' }
  ];

  root.Ethan.Views = root.Ethan.Views || {};

  root.Ethan.Views.settings = {
    title: '设置',
    render: function (host) {
      var prefs = S.getPrefs();
      var lockLabel = '5 分钟';
      AUTO_LOCK.forEach(function (o) { if (String(o.v) === String(prefs.autoLock)) lockLabel = o.label; });
      var themeLabel = '跟随系统';
      THEMES.forEach(function (o) { if (o.v === prefs.theme) themeLabel = o.label; });

      var html = '';

      // 外观主题已上收至 ETHAN Super App 统一设置中心（esa:theme 消息同步），此处不再提供

      html += '<div class="group__title">安全</div><div class="group">' +
        cell('pin', '修改 PIN', '修改后原数据仍可正常解密', 'editPin', 'chevron') +
        cell('clock', '自动锁定', lockLabel, 'autoLock', 'chevron') +
        cell('bolt', '立即锁定', '', 'lockNow', '') +
        '</div>';


      html += '<div class="group__title">关于</div><div class="group">' +
        cell('info', '关于 ETHAN', '', 'about', 'chevron') +
        '</div>';

      html += '<div class="version">ETHAN <b>V0.1</b> · schema v' + S.SCHEMA_VERSION + ' · 完全离线</div>';

      host.innerHTML = html;

      Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-act');
          if (act === 'theme') openTheme(function () { root.Ethan.App.renderCurrent(); });
          else if (act === 'editPin') openChangePin();
          else if (act === 'autoLock') openAutoLock(function () { root.Ethan.App.renderCurrent(); });
          else if (act === 'lockNow') root.Ethan.App.lockNow();
          else if (act === 'about') openAbout();
        });
      });
    }
  };

  function cell(icon, title, sub, act, arrow) {
    return '<button class="cell" data-act="' + act + '">' +
      '<span class="cell__icon">' + I.svg(icon, 19) + '</span>' +
      '<span class="cell__main"><span class="cell__title">' + UI.esc(title) + '</span>' +
      (sub ? '<span class="cell__sub">' + UI.esc(sub) + '</span>' : '') + '</span>' +
      (arrow ? '<span class="cell__arrow">' + I.svg(arrow, 16) + '</span>' : '') +
      '</button>';
  }

  /* ---------------- 外观主题 ---------------- */
  function openTheme(onChange) {
    var prefs = S.getPrefs();
    UI.sheet({
      title: '主题',
      desc: '选择 ETHAN 的外观；「跟随系统」会随设备深浅色设置自动切换',
      options: THEMES.map(function (o) {
        return {
          icon: 'moon',
          title: o.label,
          checked: o.v === prefs.theme,
          onSelect: function () {
            S.setPrefs({ theme: o.v });
            root.Ethan.App.applyTheme();
            UI.toast('主题：' + o.label);
            if (onChange) onChange();
          }
        };
      })
    });
  }

  /* ---------------- 修改 PIN ---------------- */
  function openChangePin() {
    UI.openPanel({
      title: '修改 PIN',
      build: function (body) {
        body.innerHTML =
          '<div class="form">' +
          pinGroup('当前 PIN', 'cp1') +
          pinGroup('新 PIN', 'cp2') +
          pinGroup('确认新 PIN', 'cp3') +
          '<div class="error-text" id="cp-err" hidden></div>' +
          '<div class="hint">修改 PIN 不会重新加密数据，也不会影响已有内容。</div>' +
          '</div>';
      },
      footer: function (foot, api) {
        foot.innerHTML = '<button class="btn btn--primary btn--block" id="cp-go">保存</button>';
        foot.querySelector('#cp-go').addEventListener('click', function () {
          var body = api.el.querySelector('.panel__body');
          var err = body.querySelector('#cp-err');
          var a = body.querySelector('#cp1').value.trim();
          var b = body.querySelector('#cp2').value.trim();
          var c = body.querySelector('#cp3').value.trim();
          err.hidden = true;
          if (!/^\d{6}$/.test(a)) return showErr(err, '请输入 6 位当前 PIN');
          if (!/^\d{6}$/.test(b)) return showErr(err, '新 PIN 必须为 6 位数字');
          if (b !== c) return showErr(err, '两次输入的新 PIN 不一致');
          if (a === b) return showErr(err, '新 PIN 与当前 PIN 相同');

          var btn = foot.querySelector('#cp-go');
          btn.disabled = true; btn.textContent = '正在更新…';
          S.changePin(a, b).then(function () {
            UI.toast('PIN 已更新');
            api.close();
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = '保存';
            showErr(err, e && e.message ? e.message : '修改失败');
          });
        });
      }
    });
  }

  function showErr(box, msg) { box.textContent = msg; box.hidden = false; UI.toast(msg); }

  function pinGroup(label, id) {
    return '<div class="form__group"><label class="label" for="' + id + '">' + label + '</label>' +
      '<input class="input" id="' + id + '" type="password" inputmode="numeric" autocomplete="off" ' +
      'maxlength="6" pattern="\\d*" placeholder="6 位数字"></div>';
  }

  /* ---------------- 自动锁定 ---------------- */
  function openAutoLock(onChange) {
    var prefs = S.getPrefs();
    UI.sheet({
      title: '自动锁定',
      desc: '页面进入后台或长时间无操作时自动锁定',
      options: AUTO_LOCK.map(function (o) {
        return {
          icon: 'clock',
          title: o.label,
          checked: String(o.v) === String(prefs.autoLock),
          onSelect: function () {
            S.setPrefs({ autoLock: o.v });
            root.Ethan.App.armAutoLock();
            UI.toast('自动锁定：' + o.label);
            if (onChange) onChange();
          }
        };
      })
    });
  }

  /* ---------------- 关于 ---------------- */
  function openAbout() {
    UI.openPanel({
      title: '关于 ETHAN',
      build: function (body) {
        body.innerHTML =
          '<div class="about">' +
          '<div class="about__logo">E</div>' +
          '<div class="about__name">ETHAN</div>' +
          '<div class="about__ver">V0.1 · 数据结构 v' + S.SCHEMA_VERSION + '</div>' +
          '<div class="about__text">' +
          '<p>ETHAN 是一个完全离线的个人信息工具，用来保存账号密码、密钥 / Token、文本和其他需要长期保存的信息。</p>' +
          '<p>所有数据都保存在本机浏览器中：使用 Web Crypto API（PBKDF2-SHA256 派生密钥 + AES-GCM 加密）加密后写入 IndexedDB，全程不联网、不上传、不依赖任何服务器。</p>' +
          '<p>纯 Web 环境无法提供操作系统级的硬件安全能力（如 Android Keystore），因此请不要把它描述为绝对安全或专业级硬件密码管理器；PIN 强度、设备本身的安全状况同样重要。</p>' +
          '<p>请妥善保管 PIN，备份与恢复请使用 Super App 统一设置 → 数据管理（ETHAN 数据保持加密状态）。</p>' +
          '</div></div>';
      }
    });
  }

  root.Ethan.Settings = { openChangePin: openChangePin, openAutoLock: openAutoLock, openAbout: openAbout, openTheme: openTheme };
})(typeof globalThis !== 'undefined' ? globalThis : this);
