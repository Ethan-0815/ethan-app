/* ==========================================================================
   Travel Footprint — platform/image.js
   Downscale + compress picked images entirely on-device (canvas), plus
   thumbnail generation. No network, no external service.
   Gracefully degrades when OffscreenCanvas / createImageBitmap are missing.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});

  var FULL_MAX = 1600;      // longest edge of the stored image
  var THUMB_MAX = 420;      // longest edge of the grid thumbnail
  var FULL_QUALITY = 0.82;
  var THUMB_QUALITY = 0.74;

  /**
   * Decode a Blob/File into something drawable.
   * Prefers createImageBitmap (off main thread, respects EXIF orientation in
   * modern engines), falls back to an <img> + object URL.
   */
  function decode(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return createImageBitmap(blob, { imageOrientation: 'from-image' })
          .catch(function () {
            return createImageBitmap(blob);
          })
          .catch(function () { return decodeViaImg(blob); });
      } catch (e) { /* fall through */ }
    }
    return decodeViaImg(blob);
  }

  function decodeViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        // keep the URL alive until the caller is done drawing
        resolve({ img: img, width: img.naturalWidth, height: img.naturalHeight, _url: url, close: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('无法读取这张图片（格式可能不受支持）'));
      };
      img.src = url;
    });
  }

  /** Downscale a decoded source into a canvas of at most maxEdge. */
  function drawScaled(source, maxEdge) {
    var sw = source.width || source.naturalWidth;
    var sh = source.height || source.naturalHeight;
    if (!sw || !sh) throw new Error('图片尺寸无效');

    var scale = Math.min(1, maxEdge / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale));
    var h = Math.max(1, Math.round(sh * scale));

    var canvas = createCanvas(w, h);
    var ctx = canvas.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);

    return { canvas: canvas, width: w, height: h };
  }

  function createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        var off = new OffscreenCanvas(w, h);
        return { raw: off, ctx: off.getContext('2d'), width: w, height: h };
      } catch (e) { /* fall through */ }
    }
    var el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    return { raw: el, ctx: el.getContext('2d'), width: w, height: h };
  }

  function canvasToBlob(canvas, quality) {
    var raw = canvas.raw;
    if (raw.convertToBlob) {
      return raw.convertToBlob({ type: 'image/jpeg', quality: quality })
        .catch(function () { return canvasToBlobViaDataURL(canvas, quality); });
    }
    return new Promise(function (resolve) {
      raw.toBlob(function (blob) {
        if (blob) resolve(blob);
        else canvasToBlobViaDataURL(canvas, quality).then(resolve);
      }, 'image/jpeg', quality);
    });
  }

  function canvasToBlobViaDataURL(canvas, quality) {
    return new Promise(function (resolve, reject) {
      try {
        var dataUrl = canvas.raw.toDataURL('image/jpeg', quality);
        var base64 = dataUrl.split(',')[1];
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (e) {
        reject(new Error('图片压缩失败'));
      }
    });
  }

  function blobToBytes(blob) {
    if (blob.arrayBuffer) {
      return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(new Error('读取图片数据失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /**
   * Process one picked file into { full, thumb, width, height, bytes }.
   *  - full : Uint8Array (JPEG, longest edge ≤ FULL_MAX)
   *  - thumb: Uint8Array (JPEG, longest edge ≤ THUMB_MAX)
   */
  function processFile(file) {
    return decode(file).then(function (source) {
      try {
        var full = drawScaled(source, FULL_MAX);
        var thumb = drawScaled(source, THUMB_MAX);

        return Promise.all([
          canvasToBlob(full.canvas, FULL_QUALITY).then(blobToBytes),
          canvasToBlob(thumb.canvas, THUMB_QUALITY).then(blobToBytes)
        ]).then(function (res) {
          dispose(source);
          return {
            full: res[0],
            thumb: res[1],
            width: full.width,
            height: full.height,
            bytes: res[0].length,
            thumbBytes: res[1].length,
            originalBytes: file.size || 0
          };
        });
      } catch (e) {
        dispose(source);
        return Promise.reject(e);
      }
    });
  }

  function dispose(source) {
    try {
      if (source && typeof source.close === 'function') source.close();
      else if (source && source.close && typeof source.close === 'function') source.close();
      if (source && source._url) URL.revokeObjectURL(source._url);
    } catch (e) { /* ignore */ }
  }

  /**
   * Process many files with bounded concurrency so a 30-photo selection
   * doesn't exhaust memory or lock the UI.
   */
  function processFiles(files, opts) {
    var options = opts || {};
    var limit = options.concurrency || 3;
    var onProgress = options.onProgress || function () {};
    var list = Array.prototype.slice.call(files || []);
    var results = new Array(list.length);
    var index = 0;
    var done = 0;
    var firstError = null;

    if (!list.length) return Promise.resolve([]);

    function worker() {
      if (index >= list.length) return Promise.resolve();
      var i = index++;
      return processFile(list[i]).then(function (r) {
        results[i] = { ok: true, value: r, name: list[i].name };
        done++;
        onProgress(done, list.length, list[i]);
        return worker();
      }).catch(function (err) {
        results[i] = { ok: false, error: err, name: list[i].name };
        done++;
        if (!firstError) firstError = err;
        onProgress(done, list.length, list[i]);
        return worker();
      });
    }

    var workers = [];
    for (var w = 0; w < Math.min(limit, list.length); w++) workers.push(worker());

    return Promise.all(workers).then(function () {
      return { results: results, firstError: firstError };
    });
  }

  /** Cheap dimension probe without full decode (used for validation). */
  function isLikelyImage(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name || '');
  }

  TF.image = {
    FULL_MAX: FULL_MAX,
    THUMB_MAX: THUMB_MAX,
    processFile: processFile,
    processFiles: processFiles,
    blobToBytes: blobToBytes,
    decode: decode,
    isLikelyImage: isLikelyImage
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
