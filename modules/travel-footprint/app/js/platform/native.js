/* ==========================================================================
   Travel Footprint — platform/native.js
   Uniform façade over the Android WebView bridge.

   When running in the Android shell, window.TravelFootprintNative exists and
   file pick / save / share are delegated to it (content:// URIs, chunked
   transfer). In a plain browser everything degrades to <input type=file> +
   Blob download, so the exact same app code runs in both.

   Chunked transfer contract (avoids huge base64 strings blowing memory):
     export: beginSave(name, mime) → appendChunk(token, b64) × N → endSave(token)
     import: pickFile(token, mime) → onFilePicked(token, json) → readChunk(token, offset, len) × N → closeFile(token)
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  var CHUNK = 384 * 1024;        // JS-side slice size
  var B64_CHUNK = 48 * 1024;     // base64 string chunk size for large payloads

  function bridge() {
    return root.TravelFootprintNative || null;
  }

  function isNative() {
    var b = bridge();
    return !!(b && typeof b.isNative === 'function' && b.isNative());
  }

  function platform() {
    return isNative() ? 'android' : 'browser';
  }

  /**
   * Native reports the real system-bar insets as CSS variables.
   * The shell calls this on every inset change so a rotating device or a
   * keyboard opening re-lays-out instantly without a JS round-trip through
   * the bridge.
   */
  function applySafeArea(top, bottom, imeBottom) {
    var de = document.documentElement;
    var apply = function (key, v) {
      var n = Number(v);
      if (isFinite(n) && n >= 0) de.style.setProperty(key, n + 'px');
    };
    apply('--safe-t-native', top);
    apply('--safe-b-native', bottom);
    apply('--ime-b-native', imeBottom);

    // Keep the layout token in sync: the nav uses --safe-b everywhere.
    var b = Number(bottom);
    if (isFinite(b) && b >= 0) {
      // only override when the env() fallback would be 0 (older WebViews)
      var envOk = supportsEnvSafeArea();
      if (!envOk) de.style.setProperty('--safe-b', b + 'px');
    }
    // Let whatever is on screen adjust (e.g. the bottom sheet sitting above the IME)
    try {
      root.dispatchEvent(new CustomEvent('tf:safearea', {
        detail: { top: Number(top) || 0, bottom: Number(bottom) || 0, ime: Number(imeBottom) || 0 }
      }));
    } catch (e) { /* ignore */ }
  }

  var _envSafeArea = null;
  function supportsEnvSafeArea() {
    if (_envSafeArea !== null) return _envSafeArea;
    try {
      // A probe element: if env(safe-area-inset-bottom) resolves to a length
      // the browser understands it, this computes to a real px value (> 0 on
      // notched devices, 0 otherwise — either way it's not "" ).
      var probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);' +
        'width:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(probe);
      _envSafeArea = getComputedStyle(probe).height !== '';
      document.body.removeChild(probe);
    } catch (e) {
      _envSafeArea = false;
    }
    return _envSafeArea;
  }

  /* ------------------------------------------------------- bytes <-> b64 --- */

  function bytesToBase64(bytes) {
    var out = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      var sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      var s = '';
      for (var j = 0; j < sub.length; j++) s += String.fromCharCode(sub[j]);
      out += s;
    }
    return btoa(out);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* ------------------------------------------------------------ picking --- */

  var _pickSeq = 0;
  var _pickWaiters = {};

  /** Called by the Android side when a file picker returns. */
  function onFilePicked(token, jsonStr) {
    var waiter = _pickWaiters[token];
    if (!waiter) return;
    delete _pickWaiters[token];
    try {
      var info = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      waiter.resolve(info);
    } catch (e) {
      waiter.reject(new Error('无法解析所选文件信息'));
    }
  }

  function onFilePickCancelled(token) {
    var waiter = _pickWaiters[token];
    if (!waiter) return;
    delete _pickWaiters[token];
    waiter.resolve(null);
  }

  /**
   * Ask for one file. Returns:
   *   { name, size, mime, bytes }  on success
   *   null                         when the user cancels
   */
  function pickFile(opts) {
    var options = opts || {};
    var accept = options.accept || '*/*';

    if (isNative()) {
      var b = bridge();
      if (typeof b.pickFile !== 'function') {
        return Promise.reject(new Error('当前设备不支持选择文件'));
      }
      var token = 'pick-' + (++_pickSeq) + '-' + Date.now();
      return new Promise(function (resolve, reject) {
        _pickWaiters[token] = { resolve: resolve, reject: reject };
        try {
          b.pickFile(token, accept);
        } catch (e) {
          delete _pickWaiters[token];
          reject(new Error('无法打开文件选择器'));
        }
      }).then(function (info) {
        if (!info) return null;
        return readAllChunks(info);
      });
    }

    return pickViaInput(accept);
  }

  /** Native: pull the file in chunks so we never hold one giant base64 string. */
  function readAllChunks(info) {
    var b = bridge();
    var total = Number(info.size) || 0;
    if (!total) {
      closeQuietly(info.token);
      return Promise.resolve({ name: info.name, size: 0, mime: info.mime, bytes: new Uint8Array(0) });
    }

    var parts = [];
    var offset = 0;

    function step() {
      if (offset >= total) {
        var out = concat(parts, total);
        closeQuietly(info.token);
        return Promise.resolve({ name: info.name, size: total, mime: info.mime, bytes: out });
      }
      var len = Math.min(CHUNK, total - offset);
      var chunkB64 = b.readChunk(info.token, offset, len);
      offset += len;
      if (chunkB64) parts.push(base64ToBytes(chunkB64));
      // yield so the WebView stays responsive on large files
      return new Promise(function (r) { setTimeout(r, 0); }).then(step);
    }

    return step();
  }

  function closeQuietly(token) {
    try {
      if (token && bridge() && bridge().closeFile) bridge().closeFile(token);
    } catch (e) { /* ignore */ }
  }

  function concat(parts, total) {
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < parts.length; i++) {
      out.set(parts[i], pos);
      pos += parts[i].length;
    }
    return out.subarray(0, pos);
  }

  function pickViaInput(accept) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      var settled = false;

      function cleanup() {
        setTimeout(function () {
          if (input.parentNode) input.parentNode.removeChild(input);
        }, 500);
      }

      input.addEventListener('change', function () {
        settled = true;
        var file = input.files && input.files[0];
        cleanup();
        if (!file) { resolve(null); return; }
        var fr = new FileReader();
        fr.onload = function () {
          resolve({
            name: file.name || 'attachment',
            size: file.size,
            mime: file.type || 'application/octet-stream',
            bytes: new Uint8Array(fr.result)
          });
        };
        fr.onerror = function () { reject(new Error('读取文件失败')); };
        fr.readAsArrayBuffer(file);
      });

      // no reliable cancel event in browsers; clean up on window refocus
      root.addEventListener('focus', function onFocus() {
        root.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (!settled) {
            cleanup();
            resolve(null);
          }
        }, 800);
      });

      input.click();
    });
  }

  /** Pick multiple images at once (photos feature). */
  function pickImages(opts) {
    var options = opts || {};
    var max = options.max || 30;

    if (isNative()) {
      var b = bridge();
      if (typeof b.pickImages === 'function') {
        return pickManyNative(b, max);
      }
      // 原生桥未实现多选：回退到 WebView 文件选择器（MainActivity.onShowFileChooser
      // 会转交系统相册/文件选择器），而不是静默返回空。
      return pickImagesViaInput(max);
    }

    return pickImagesViaInput(max);
  }

  function pickManyNative(b, max) {
    var token = 'pickm-' + (++_pickSeq) + '-' + Date.now();
    return new Promise(function (resolve, reject) {
      _pickWaiters[token] = { resolve: resolve, reject: reject };
      try {
        b.pickImages(token, max);
      } catch (e) {
        delete _pickWaiters[token];
        reject(new Error('无法打开相册'));
      }
    }).then(function (info) {
      if (!info) return [];
      var list = Array.isArray(info) ? info : (info.files || []);
      var out = [];
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve(out);
        var item = list[i++];
        return readAllChunks(item).then(function (file) {
          out.push(file);
          return next();
        });
      }
      return next();
    });
  }

  function pickImagesViaInput(max) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      var settled = false;

      input.addEventListener('change', function () {
        settled = true;
        var files = Array.prototype.slice.call(input.files || []).slice(0, max);
        setTimeout(function () {
          if (input.parentNode) input.parentNode.removeChild(input);
        }, 500);
        resolve(files);
      });

      root.addEventListener('focus', function onFocus() {
        root.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (!settled) {
            if (input.parentNode) input.parentNode.removeChild(input);
            resolve([]);
          }
        }, 800);
      });

      input.click();
    });
  }

  /** Take a photo. Native uses ACTION_IMAGE_CAPTURE (no CAMERA permission needed). */
  function capturePhoto() {
    if (!isNative()) return Promise.resolve(null);
    var b = bridge();
    if (typeof b.capturePhoto !== 'function') return Promise.resolve(null);

    var token = 'cam-' + (++_pickSeq) + '-' + Date.now();
    return new Promise(function (resolve, reject) {
      _pickWaiters[token] = { resolve: resolve, reject: reject };
      try {
        b.capturePhoto(token);
      } catch (e) {
        delete _pickWaiters[token];
        reject(new Error('无法打开相机'));
      }
    }).then(function (info) {
      if (!info) return null;
      return readAllChunks(info);
    });
  }

  function canCapture() {
    var b = bridge();
    return !!(isNative() && b && typeof b.capturePhoto === 'function');
  }

  /* ------------------------------------------------------------- saving --- */

  /**
   * Save bytes to a user-visible location.
   * Native: chunked write into Downloads/TravelFootprint.
   * Browser: Blob + anchor download.
   * Returns a human-readable description of where it went.
   */
  function saveFile(name, bytes, mimeType) {
    if (isNative()) return saveNative(name, bytes, mimeType);
    return saveBrowser(name, bytes, mimeType);
  }

  function saveNative(name, bytes, mimeType) {
    var b = bridge();
    return new Promise(function (resolve, reject) {
      try {
        // 原生桥签名：beginSave(fileName, mime) → 返回原生会话 token。
        // （历史 bug：这里曾把自造 token 当首参传入，导致 append/end 全部"会话失效"。）
        var nativeToken = String(b.beginSave(name, mimeType || 'application/octet-stream') || '');
        if (!nativeToken || nativeToken.indexOf('ERROR') === 0) {
          reject(new Error(nativeToken ? nativeToken.replace(/^ERROR:?/, '') : '无法创建导出文件'));
          return;
        }

        var offset = 0;
        function step() {
          if (offset >= bytes.length) {
            var where = String(b.endSave(nativeToken) || '');
            if (where.indexOf('ERROR') === 0) {
              reject(new Error(where.replace(/^ERROR:?/, '')));
              return;
            }
            resolve(where || name);
            return;
          }
          var end = Math.min(offset + B64_CHUNK, bytes.length);
          var feedback = String(b.appendChunk(nativeToken, bytesToBase64(bytes.subarray(offset, end))) || '');
          if (feedback.indexOf('ERROR') === 0) {
            reject(new Error(feedback.replace(/^ERROR:?/, '')));
            return;
          }
          offset = end;
          Promise.resolve().then(step);
        }
        step();
      } catch (e) {
        reject(new Error('导出失败：' + (e && e.message ? e.message : '未知错误')));
      }
    });
  }

  function saveBrowser(name, bytes, mimeType) {
    return new Promise(function (resolve, reject) {
      try {
        var blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 2000);
        resolve(name);
      } catch (e) {
        reject(new Error('导出失败：浏览器不允许自动下载，请手动保存'));
      }
    });
  }

  /* -------------------------------------------------------- misc bridge --- */

  function vibrate(ms) {
    var b = bridge();
    if (isNative() && b && typeof b.vibrate === 'function') {
      try { b.vibrate(ms || 8); } catch (e) { /* ignore */ }
      return;
    }
    // Browsers reject navigator.vibrate() until the user has interacted with
    // the page, and log a console error when they do — harmless but noisy.
    // Only call it once we know a real gesture happened.
    if (!vibrate._armed) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (e) { /* ignore */ }
  }

  // Arm haptics on the first genuine user interaction.
  (function armHaptics() {
    if (typeof document === 'undefined') return;
    var once = function () {
      vibrate._armed = true;
      document.removeEventListener('pointerdown', once);
      document.removeEventListener('keydown', once);
      document.removeEventListener('touchstart', once);
    };
    document.addEventListener('pointerdown', once, { once: true, passive: true });
    document.addEventListener('keydown', once, { once: true });
    document.addEventListener('touchstart', once, { once: true, passive: true });
  })();

  function toast(message, isLong) {
    var b = bridge();
    if (isNative() && b && typeof b.toast === 'function') {
      try { b.toast(message, !!isLong); return true; } catch (e) { /* ignore */ }
    }
    return false;
  }

  /** Called by native back button → returns 'handled' or 'exit'. */
  function back() {
    if (TF.ui && TF.ui.backHandler && typeof TF.ui.backHandler.handle === 'function') {
      return TF.ui.backHandler.handle();
    }
    return 'exit';
  }

  function closeKeyboard() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function keyboardVisible() {
    return !!(document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
       document.activeElement.tagName === 'TEXTAREA' ||
       document.activeElement.isContentEditable));
  }

  function hideKeyboard() {
    closeKeyboard();
  }

  /** Safe-area inset bottom in px (native reports it reliably). */
  function safeAreaBottom() {
    var b = bridge();
    if (isNative() && b && typeof b.safeAreaBottom === 'function') {
      try {
        var v = Number(b.safeAreaBottom());
        if (isFinite(v) && v >= 0) return v;
      } catch (e) { /* ignore */ }
    }
    return 0;
  }

  /* ----------------------------------------------------------- detect --- */

  function capabilities() {
    var b = bridge();
    var version = null;
    try {
      version = b && (typeof b.getVersion === 'function' ? b.getVersion() : b.version);
    } catch (e) { version = null; }
    return {
      platform: platform(),
      native: isNative(),
      nativeVersion: version || null,
      canPickImages: true,
      canCapture: canCapture(),
      canExport: true,
      canImport: true,
      offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false
    };
  }

  TF.native = {
    bridge: bridge,
    isNative: isNative,
    platform: platform,
    pickFile: pickFile,
    pickImages: pickImages,
    capturePhoto: capturePhoto,
    canCapture: canCapture,
    saveFile: saveFile,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    onFilePicked: onFilePicked,
    onFilePickCancelled: onFilePickCancelled,
    vibrate: vibrate,
    toast: toast,
    back: back,
    keyboardVisible: keyboardVisible,
    hideKeyboard: hideKeyboard,
    safeAreaBottom: safeAreaBottom,
    capabilities: capabilities,
    // Android shell hook: pushes real system-bar insets down as CSS variables.
    __applySafeArea: applySafeArea,
    applySafeArea: applySafeArea
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
