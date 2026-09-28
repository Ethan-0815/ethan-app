/*!
 * 我的空间 · 图片处理（压缩 / 缩略图 / 解码降级）
 * 原则：原图只压缩到"看得清"的程度，不追求极限压缩；
 *      文字、序列号、铭牌必须保持可辨认。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});
  const M = MS.models;

  const MAIN_MAX = 1600;      // 长边上限
  const THUMB_MAX = 420;      // 列表缩略图长边
  const QUALITY_MAIN = 0.86;
  const QUALITY_THUMB = 0.72;

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  async function decode(blob) {
    if (root.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        return { source: bmp, width: bmp.width, height: bmp.height, release: function () { if (bmp.close) bmp.close(); } };
      } catch (e) { /* 降级到 <img> */ }
    }
    const loaded = await loadImage(blob);
    return {
      source: loaded.img,
      width: loaded.img.naturalWidth || loaded.img.width,
      height: loaded.img.naturalHeight || loaded.img.height,
      release: function () { URL.revokeObjectURL(loaded.url); }
    };
  }

  function fitSize(w, h, max) {
    if (w <= max && h <= max) return { width: w, height: h, scaled: false };
    const ratio = Math.min(max / w, max / h);
    return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)), scaled: true };
  }

  function drawTo(decoded, size) {
    const w = size.width;
    const h = size.height;
    if (root.OffscreenCanvas) {
      try {
        const canvas = new root.OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(decoded.source, 0, 0, w, h);
        return canvas;
      } catch (e) { /* 降级 */ }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, w, h);
    return canvas;
  }

  function encode(canvas, mime, quality) {
    return new Promise(function (resolve) {
      if (canvas.convertToBlob) {
        canvas.convertToBlob({ type: mime, quality: quality }).then(resolve).catch(function () { resolve(null); });
        return;
      }
      try {
        canvas.toBlob(function (blob) { resolve(blob); }, mime, quality);
      } catch (e) { resolve(null); }
    });
  }

  function isImage(mime, name) {
    if (mime && /^image\//i.test(mime)) return true;
    return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(String(name || ''));
  }

  /** 由图片 Blob 生成缩略图（导入外部备份时使用；失败返回 null，不影响主流程） */
  async function makeThumbFromBlob(blob) {
    try {
      const decoded = await decode(blob);
      const size = fitSize(decoded.width, decoded.height, THUMB_MAX);
      const canvas = drawTo(decoded, size);
      const out = await encode(canvas, 'image/jpeg', QUALITY_THUMB);
      decoded.release();
      return out;
    } catch (e) {
      return null;
    }
  }

  /**
   * 处理用户选择的图片文件
   * @returns {Promise<{meta:object, blob:Blob, thumb:Blob|null, degraded:boolean}>}
   */
  async function prepareImage(file) {
    if (!file) throw MS.appError('IMAGE_BROKEN');
    const mime = M.str(file.type);
    const name = M.safeFileName(file.name, 'photo.jpg');
    if (!isImage(mime, name)) throw MS.appError('IMAGE_BROKEN');

    let decoded = null;
    try {
      decoded = await decode(file);
    } catch (e) {
      // 无法解码（例如 HEIC）：原样保存，不阻塞用户
      return {
        degraded: true,
        meta: M.normalizeImageMeta({
          name: name, mime: mime || 'application/octet-stream',
          size: file.size || 0, width: null, height: null
        }),
        blob: file,
        thumb: null
      };
    }

    // 一次解码同时产出主图与缩略图（避免重复解码带来的性能损耗）
    const size = fitSize(decoded.width, decoded.height, MAIN_MAX);
    const thumbSize = fitSize(size.width, size.height, THUMB_MAX);
    const canvas = drawTo(decoded, size);
    const thumbCanvas = drawTo(decoded, thumbSize);
    decoded.release();

    const isPng = /png/i.test(mime);
    let blob = await encode(canvas, 'image/jpeg', QUALITY_MAIN);
    if (isPng && size.scaled === false && (file.size || 0) < 6 * 1024 * 1024) {
      // 截图类 PNG（含文字、线框图）保留 PNG 往往更清晰也更小，两者取小者
      const pngBlob = await encode(canvas, 'image/png');
      if (pngBlob && (!blob || pngBlob.size < blob.size * 1.15)) blob = pngBlob;
    }
    if (!blob) blob = file;                    // 编码失败 → 退化为原图

    let thumb = await encode(thumbCanvas, 'image/jpeg', QUALITY_THUMB);
    if (!thumb) thumb = blob;                  // 缩略图失败 → 列表退化为使用主图

    return {
      degraded: false,
      meta: M.normalizeImageMeta({
        name: name,
        mime: blob.type || 'image/jpeg',
        size: blob.size,
        width: size.width,
        height: size.height
      }),
      blob: blob,
      thumb: thumb
    };
  }

  MS.imaging = {
    MAIN_MAX: MAIN_MAX,
    THUMB_MAX: THUMB_MAX,
    prepareImage: prepareImage,
    makeThumbFromBlob: makeThumbFromBlob,
    isImage: isImage,
    fitSize: fitSize
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
