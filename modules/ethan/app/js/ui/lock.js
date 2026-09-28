/* ETHAN V0.1 — lock.js
 * 锁定屏：首次设置 PIN / 解锁。PIN 永不以明文落盘。
 */
(function (root) {
  'use strict';

  var U = root.Ethan.Util;
  var C = root.Ethan.Crypto;
  var S = root.Ethan.Store;
  var I = root.Ethan.Icons;
  var UI = root.Ethan.UI;

  var PIN_LEN = 6;

  function render(host, opts) {
    opts = opts || {};
    var mode = opts.mode || (S.isInitialized() ? 'unlock' : 'setup');
    var stage = mode === 'setup' ? 'set' : 'unlock';
    var buf = '';
    var first = '';
    var busy = false;
    var error = '';

    function sub() {
      if (error) return error;
      if (stage === 'set') return '设置 6 位 PIN';
      if (stage === 'confirm') return '再次输入以确认';
      return '欢迎回来';
    }

    function draw() {
      var dots = '';
      for (var i = 0; i < PIN_LEN; i++) {
        dots += '<span class="dot' + (i < buf.length ? ' is-on' : '') + '"></span>';
      }
      var keys = '';
      for (var n = 1; n <= 9; n++) keys += '<button class="key" data-k="' + n + '">' + n + '</button>';
      keys += '<button class="key key--fn" data-k="del" aria-label="删除">' + I.svg('back', 20) + '</button>';
      keys += '<button class="key" data-k="0">0</button>';
      keys += '<button class="key key--fn' + (buf.length === PIN_LEN ? ' key--go' : '') + '" data-k="go" aria-label="确认">' + I.svg('check', 20) + '</button>';

      host.innerHTML =
        '<div class="lock__mark">' + I.svg(mode === 'setup' ? 'shield' : 'lock', 24) + '</div>' +
        '<h1 class="lock__brand">密码</h1>' +
        '<div class="lock__sub' + (error ? ' lock__sub--error' : '') + '">' + U.escapeHtml(sub()) + '</div>' +
        '<div class="dots' + (error ? ' is-error' : '') + '">' + dots + '</div>' +
        '<div class="keypad">' + keys + '</div>' +
        '<div class="lock__foot">' + (busy ? '正在处理…' : (mode === 'setup' ? 'PIN 用于解锁「密码」，请牢记' : '')) + '</div>';

      Array.prototype.forEach.call(host.querySelectorAll('.key'), function (b) {
        b.addEventListener('click', function () { press(b.getAttribute('data-k')); });
      });
    }

    function setError(msg) {
      error = msg;
      buf = '';
      draw();
    }

    function press(k) {
      if (busy) return;
      if (error) { error = ''; }
      if (k === 'del') {
        buf = buf.slice(0, -1);
        draw();
        return;
      }
      if (k === 'go') {
        if (buf.length === PIN_LEN) submit();
        return;
      }
      if (buf.length >= PIN_LEN) return;
      buf += k;
      draw();
      if (buf.length === PIN_LEN) setTimeout(submit, 120);
    }

    function busyOn(msg) {
      busy = true;
      var foot = host.querySelector('.lock__foot');
      if (foot) foot.textContent = msg || '正在处理…';
      var sub2 = host.querySelector('.lock__sub');
      if (sub2) sub2.textContent = msg || '正在处理…';
    }

    function submit() {
      if (busy) return;
      var pin = buf;

      if (stage === 'set') {
        first = pin;
        stage = 'confirm';
        buf = '';
        error = '';
        draw();
        return;
      }

      if (stage === 'confirm') {
        if (pin !== first) {
          stage = 'set';
          first = '';
          setError('两次输入不一致，请重新设置');
          return;
        }
        busyOn('正在创建…');
        S.setup(pin).then(function () {
          if (opts.onDone) opts.onDone();
        }).catch(function (e) {
          busy = false;
          stage = 'set'; first = '';
          setError(e && e.message ? e.message : '创建失败，请重试');
        });
        return;
      }

      // unlock
      busyOn('正在解锁…');
      S.unlock(pin).then(function () {
        if (opts.onDone) opts.onDone();
      }).catch(function (e) {
        busy = false;
        var msg = (e && e.message === 'PIN 不正确') ? 'PIN 不正确' : (e && e.message) || '解锁失败';
        setError(msg);
      });
    }

    draw();

    return {
      refresh: function () {
        mode = S.isInitialized() ? 'unlock' : 'setup';
        stage = 'unlock';
        buf = ''; error = ''; busy = false;
        draw();
      }
    };
  }

  root.Ethan.Lock = { render: render, PIN_LEN: PIN_LEN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
