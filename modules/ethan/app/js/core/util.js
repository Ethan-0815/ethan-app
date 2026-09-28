/* ETHAN V0.1 — util.js
 * 纯离线工具函数。无任何网络依赖。
 * 同时可在浏览器（挂到 window.Ethan）与 Node（CommonJS require）中运行。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Ethan = root.Ethan || {};
  root.Ethan.Util = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : this;

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  function utf8(str) {
    if (enc) return enc.encode(str);
    // 极简兜底（浏览器与 Node 均有 TextEncoder，此分支仅防御）
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return new Uint8Array(out);
  }

  function utf8str(bytes) {
    if (dec) return dec.decode(bytes);
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function bytesToBase64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = '', i;
    for (i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function base64ToBytes(b64) {
    var s = atob(String(b64).replace(/\s+/g, ''));
    var arr = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr;
  }

  function bytesToHex(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = '', i, h;
    for (i = 0; i < arr.length; i++) {
      h = arr[i].toString(16);
      s += h.length === 1 ? '0' + h : h;
    }
    return s;
  }

  function uid() {
    var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!c || !c.getRandomValues) throw new Error('当前环境不支持安全随机数（crypto.getRandomValues）');
    var b = new Uint8Array(12);
    c.getRandomValues(b);
    var s = bytesToHex(b);
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
  }

  function now() { return Date.now(); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 2026.09.24
  function formatDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }

  // 刚刚 / x 分钟前 / x 小时前 / x 天前 / 2026.09.24
  function relativeTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var min = 60000, hour = 3600000, day = 86400000;
    if (diff < min) return '刚刚';
    if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 2 * day) return '昨天';
    if (diff < 30 * day) return Math.floor(diff / day) + ' 天前';
    return formatDate(ts);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function deepClone(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      var a = [], i;
      for (i = 0; i < obj.length; i++) a.push(deepClone(obj[i]));
      return a;
    }
    var o = {}, k;
    for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = deepClone(obj[k]);
    return o;
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    };
  }

  function normalizeUrl(url) {
    if (!url) return '';
    var s = String(url).trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    return 'https://' + s.replace(/^\/+/, '');
  }

  function hostOf(url) {
    try { return new URL(normalizeUrl(url)).host; } catch (e) { return url || ''; }
  }

  function mask(len) {
    var n = Math.max(6, Math.min(24, len || 12));
    return new Array(n + 1).join('•');
  }

  function downloadBlob(filename, text) {
    /* Android 壳：走原生桥分块写入（文件保存到系统下载目录）。
     * 原生桥以多个名字注入，任一可用即可（同一实例）。 */
    var bridge = root.TravelFootprintNative || root.MySpaceNative || root.ESANative || null;
    var canNative = bridge &&
      typeof bridge.beginSave === 'function' &&
      typeof bridge.appendChunk === 'function' &&
      typeof bridge.endSave === 'function';

    if (canNative) {
      try {
        var CHUNK = 384 * 1024;
        var token = String(bridge.beginSave(filename, 'application/octet-stream') || '');
        if (token && token.indexOf('ERROR') !== 0) {
          var enc = new TextEncoder();
          var bytes = enc.encode(text);
          var offset = 0;
          (function step() {
            if (offset >= bytes.length) {
              bridge.endSave(token);
              return;
            }
            var end = Math.min(offset + CHUNK, bytes.length);
            var part = bytes.subarray(offset, end);
            var b64 = '';
            for (var i = 0; i < part.length; i += 0x8000) {
              b64 += String.fromCharCode.apply(null, part.subarray(i, Math.min(i + 0x8000, part.length)));
            }
            bridge.appendChunk(token, root.btoa(b64));
            offset = end;
            setTimeout(step, 0);
          })();
          return;
        }
      } catch (e) {
        try { bridge.abortSave(token); } catch (e2) { /* ignore */ }
        /* 失败时落入浏览器下载 */
      }
    }

    var blob = new Blob([text], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('无法读取文件')); };
      fr.readAsText(file);
    });
  }

  // 简易事件总线
  function Emitter() {
    this._h = {};
  }
  Emitter.prototype.on = function (name, fn) {
    (this._h[name] = this._h[name] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function (name, fn) {
    var list = this._h[name] || [], i;
    for (i = list.length - 1; i >= 0; i--) if (list[i] === fn) list.splice(i, 1);
    return this;
  };
  Emitter.prototype.emit = function (name, payload) {
    var list = (this._h[name] || []).slice(), i;
    for (i = 0; i < list.length; i++) list[i](payload);
    return this;
  };

  return {
    utf8: utf8,
    utf8str: utf8str,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    bytesToHex: bytesToHex,
    uid: uid,
    now: now,
    formatDate: formatDate,
    relativeTime: relativeTime,
    escapeHtml: escapeHtml,
    deepClone: deepClone,
    debounce: debounce,
    normalizeUrl: normalizeUrl,
    hostOf: hostOf,
    mask: mask,
    downloadBlob: downloadBlob,
    readFileAsText: readFileAsText,
    Emitter: Emitter
  };
});
