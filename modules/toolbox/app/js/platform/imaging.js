/*!
 * 工具箱 · 图片处理能力（浏览器本地完成，绝不上传）
 * 压缩 / 格式转换 / 为 PDF 生成 JPEG 字节。
 * 大图处理策略：先读尺寸 → 需要缩小时用 createImageBitmap 的 resize 选项"边解码边缩小"，
 *              避免先完整解码再缩放带来的内存峰值（移动端尤其重要）。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  /* ---------------------------------------------------------------- 能力探测 */

  function supportsMime(mime) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const url = canvas.toDataURL(mime);
      return url.indexOf('data:' + mime) === 0;
    } catch (e) { return false; }
  }

  function supportsWebp() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { return false; }
  }

  const HAS_OFFSCREEN = typeof root.OffscreenCanvas === 'function';
  const HAS_BITMAP = typeof root.createImageBitmap === 'function';

  /** 输出格式清单（按环境能力过滤） */
  function outputFormats() {
    const list = [
      { mime: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true },
      { mime: 'image/png', label: 'PNG', ext: 'png', lossy: false }
    ];
    if (supportsWebp()) list.splice(1, 0, { mime: 'image/webp', label: 'WebP', ext: 'webp', lossy: true });
    return list;
  }

  function formatLabel(mime) {
    const m = U.str(mime).toLowerCase();
    if (/jpe?g/.test(m)) return 'JPG';
    if (/png/.test(m)) return 'PNG';
    if (/webp/.test(m)) return 'WebP';
    if (/gif/.test(m)) return 'GIF';
    if (/bmp/.test(m)) return 'BMP';
    if (/heic|heif/.test(m)) return 'HEIC';
    if (/svg/.test(m)) return 'SVG';
    return m ? m.replace('image/', '').toUpperCase() : '未知';
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && /^image\//i.test(file.type)) return true;
    return /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(U.str(file.name));
  }

  /* ---------------------------------------------------------------- 解码 */

  function loadImageElement(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(U.appError('IMAGE_BROKEN'));
      };
      img.src = url;
    });
  }

  /**
   * 读取图片尺寸（不解码像素数据以外的处理）
   * @returns {Promise<{width:number,height:number}>}
   */
  async function readSize(blob) {
    const loaded = await loadImageElement(blob);
    const w = loaded.img.naturalWidth || loaded.img.width;
    const h = loaded.img.naturalHeight || loaded.img.height;
    URL.revokeObjectURL(loaded.url);
    if (!w || !h) throw U.appError('IMAGE_BROKEN');
    return { width: w, height: h };
  }

  /**
   * 解码图片，必要时在解码阶段就缩小
   * @param {Blob} blob
   * @param {number|null} maxDim 长边上限，null 表示不限制
   * @returns {Promise<{source:*, width:number, height:number, scaled:boolean, release:function}>}
   */
  async function decode(blob, maxDim) {
    const size = await readSize(blob);
    const target = fitInside(size.width, size.height, maxDim);

    if (HAS_BITMAP && target.scaled) {
      try {
        const bmp = await createImageBitmap(blob, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high'
        });
        return {
          source: bmp,
          width: bmp.width,
          height: bmp.height,
          scaled: true,
          release: function () { if (bmp.close) bmp.close(); }
        };
      } catch (e) { /* 降级到 <img> 全尺寸解码 */ }
    }

    const loaded = await loadImageElement(blob);
    return {
      source: loaded.img,
      width: size.width,
      height: size.height,
      scaled: false,
      release: function () { URL.revokeObjectURL(loaded.url); }
    };
  }

  function fitInside(w, h, maxDim) {
    if (!maxDim || maxDim <= 0 || (w <= maxDim && h <= maxDim)) {
      return { width: w, height: h, scaled: false };
    }
    const ratio = Math.min(maxDim / w, maxDim / h);
    return {
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio)),
      scaled: true
    };
  }

  /* ---------------------------------------------------------------- 绘制与编码 */

  function createCanvas(w, h) {
    if (HAS_OFFSCREEN) {
      try { return new root.OffscreenCanvas(w, h); } catch (e) { /* 降级 */ }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  /**
   * 把源图画到画布上
   * @param {*} source ImageBitmap / HTMLImageElement
   * @param {{width:number,height:number,background?:string}} opts
   */
  function draw(source, opts) {
    const o = opts || {};
    const canvas = createCanvas(o.width, o.height);
    const ctx = canvas.getContext('2d');
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, o.width, o.height);
    }
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, o.width, o.height);
    return canvas;
  }

  function encode(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      const done = function (blob) {
        if (blob && blob.size > 0) resolve(blob);
        else reject(U.appError('IMAGE_ENCODE_FAIL'));
      };
      if (canvas.convertToBlob) {
        canvas.convertToBlob({ type: mime, quality: quality }).then(done).catch(function () { reject(U.appError('IMAGE_ENCODE_FAIL')); });
        return;
      }
      try {
        canvas.toBlob(done, mime, quality);
      } catch (e) {
        reject(U.appError('IMAGE_ENCODE_FAIL'));
      }
    });
  }

  /* ---------------------------------------------------------------- 压缩 */

  /**
   * 压缩图片：保持原格式（PNG 仍输出 PNG，JPEG 输出 JPEG…），可选限制最大边长
   * @param {Blob} blob
   * @param {{quality?:number, maxDim?:number|null}} options
   * @returns {Promise<{blob:Blob, width:number, height:number, size:number, mime:string, scaled:boolean, noGain:boolean, originalSize:number}>}
   */
  async function compress(blob, options) {
    const o = options || {};
    const quality = U.clamp(Number.isFinite(o.quality) ? o.quality : 0.8, 0.1, 1);
    const maxDim = Number.isFinite(o.maxDim) && o.maxDim > 0 ? o.maxDim : null;
    const originalSize = blob.size || 0;

    // 输出格式：尽量保持原格式；不可编码时退化为 JPEG
    const srcMime = U.str(blob.type).toLowerCase();
    let outMime = /png/.test(srcMime) ? 'image/png'
      : /webp/.test(srcMime) ? 'image/webp'
        : 'image/jpeg';
    if (outMime === 'image/webp' && !supportsWebp()) outMime = 'image/jpeg';
    const lossy = outMime !== 'image/png';

    const decoded = await decode(blob, maxDim);
    let out;
    try {
      const canvas = draw(decoded.source, {
        width: decoded.width,
        height: decoded.height,
        background: /jpe?g/.test(outMime) ? '#ffffff' : null
      });
      out = await encode(canvas, outMime, lossy ? quality : undefined);
    } finally {
      decoded.release();
    }

    // 没有缩放且体积反而变大 → 保留原图，避免"越压越大"
    const noGain = !decoded.scaled && out.size >= originalSize;
    const finalBlob = noGain ? blob : out;

    return {
      blob: finalBlob,
      width: decoded.width,
      height: decoded.height,
      size: finalBlob.size,
      mime: noGain ? (srcMime || 'image/jpeg') : outMime,
      scaled: decoded.scaled,
      noGain: noGain,
      originalSize: originalSize
    };
  }

  /* ---------------------------------------------------------------- 格式转换 */

  /**
   * 格式转换
   * @param {Blob} blob
   * @param {{mime:string, quality?:number}} options
   */
  async function convert(blob, options) {
    const o = options || {};
    const target = U.str(o.mime) || 'image/jpeg';
    const lossy = target !== 'image/png';
    const quality = U.clamp(Number.isFinite(o.quality) ? o.quality : 0.92, 0.1, 1);
    if (target === 'image/webp' && !supportsWebp()) throw U.appError('IMAGE_ENCODE_FAIL');

    const decoded = await decode(blob, null);
    let out;
    try {
      const canvas = draw(decoded.source, {
        width: decoded.width,
        height: decoded.height,
        // 目标不支持透明（JPG）→ 使用白色背景，避免出现黑底
        background: /jpe?g/.test(target) ? '#ffffff' : null
      });
      out = await encode(canvas, target, lossy ? quality : undefined);
    } finally {
      decoded.release();
    }

    return {
      blob: out,
      width: decoded.width,
      height: decoded.height,
      size: out.size,
      mime: target,
      originalSize: blob.size || 0
    };
  }

  /* ---------------------------------------------------------------- PDF 素材 */

  /** 把任意图片转成 PDF 可嵌入的 JPEG 字节（含尺寸） */
  async function toJpeg(blob, options) {
    const o = options || {};
    const maxDim = Number.isFinite(o.maxDim) && o.maxDim > 0 ? o.maxDim : 2400;
    const quality = U.clamp(Number.isFinite(o.quality) ? o.quality : 0.9, 0.3, 1);

    // 源图已经是 JPEG 且尺寸合适 → 直接复用原始字节，零损失、零内存峰值
    if (/jpe?g/.test(U.str(blob.type).toLowerCase()) && !o.maxDim && TB.pdf) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const info = TB.pdf.readJpegInfo(buf);
      if (info) return { bytes: buf, width: info.width, height: info.height };
    }

    const decoded = await decode(blob, maxDim);
    let out;
    try {
      const canvas = draw(decoded.source, {
        width: decoded.width,
        height: decoded.height,
        background: '#ffffff'          // PDF 页面是白纸，透明区域补白
      });
      out = await encode(canvas, 'image/jpeg', quality);
    } finally {
      decoded.release();
    }
    const buf = new Uint8Array(await out.arrayBuffer());
    return { bytes: buf, width: decoded.width, height: decoded.height };
  }

  /* ---------------------------------------------------------------- 预览 */

  /** 生成较小的预览图，避免列表里挂一堆原图对象 URL */
  async function preview(blob, maxDim) {
    try {
      const decoded = await decode(blob, maxDim || 480);
      const canvas = draw(decoded.source, {
        width: decoded.width,
        height: decoded.height,
        background: null
      });
      decoded.release();
      return await encode(canvas, 'image/jpeg', 0.72);
    } catch (e) {
      return null;
    }
  }

  TB.imaging = {
    supportsMime: supportsMime,
    supportsWebp: supportsWebp,
    outputFormats: outputFormats,
    formatLabel: formatLabel,
    isImageFile: isImageFile,
    readSize: readSize,
    decode: decode,
    fitInside: fitInside,
    compress: compress,
    convert: convert,
    toJpeg: toJpeg,
    preview: preview,
    HAS_BITMAP: HAS_BITMAP
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
