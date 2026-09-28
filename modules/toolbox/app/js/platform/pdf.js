/*!
 * 工具箱 · 极简 PDF 生成器（纯 JS，零依赖）
 * 只做一件事：把若干张 JPEG 图片按 A4 页面装订成一个 PDF，全程本地完成。
 * 采用 PDF 标准的 /DCTDecode 过滤器直接内嵌 JPEG 原始字节，不需要重新编码图像。
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  // A4：210mm × 297mm → 595.28pt × 841.89pt（1pt = 1/72 inch）
  const A4 = { width: 595.28, height: 841.89 };
  const MARGIN = 0;

  let encoder = null;
  function bytesOfText(text) {
    if (typeof TextEncoder === 'function') {
      if (!encoder) encoder = new TextEncoder();
      return encoder.encode(text);
    }
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  /**
   * 读取 JPEG 头部信息：宽、高、颜色分量数
   * 用于判断 PDF 里该声明 DeviceGray 还是 DeviceRGB，避免出现反色或花屏。
   */
  function readJpegInfo(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i < bytes.length - 1) {
      if (bytes[i] !== 0xff) { i++; continue; }
      let marker = bytes[i + 1];
      i += 2;
      while (marker === 0xff && i < bytes.length) { marker = bytes[i++]; }   // 填充字节
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (i + 1 >= bytes.length) break;
      const length = (bytes[i] << 8) | bytes[i + 1];
      const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        if (i + 7 >= bytes.length) return null;
        return {
          height: (bytes[i + 3] << 8) | bytes[i + 4],
          width: (bytes[i + 5] << 8) | bytes[i + 6],
          components: bytes[i + 7]
        };
      }
      i += length;
    }
    return null;
  }

  function num(v) {
    const n = Number.isFinite(v) ? v : 0;
    return (Math.round(n * 100) / 100).toString();
  }

  /**
   * 生成 PDF
   * @param {Array<{bytes:Uint8Array,width:number,height:number}>} pages
   * @returns {Promise<Blob>}
   */
  function build(pages) {
    return new Promise(function (resolve, reject) {
      try {
        const list = (pages || []).filter(function (p) { return p && p.bytes && p.bytes.length; });
        if (!list.length) { reject(U.appError('PDF_EMPTY')); return; }

        const chunks = [];
        let length = 0;
        const push = function (u8) { chunks.push(u8); length += u8.length; };
        const text = function (s) { push(bytesOfText(s)); };

        const count = list.length;
        const totalObjects = 2 + count * 3;
        const offsets = new Array(totalObjects + 1).fill(0);

        push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]));  // %PDF-1.4
        push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));                    // 二进制标记

        // 1：目录
        offsets[1] = length;
        text('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

        // 2：页面树
        const kids = [];
        for (let i = 0; i < count; i++) kids.push((3 + i * 3) + ' 0 R');
        offsets[2] = length;
        text('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + count + ' >>\nendobj\n');

        for (let i = 0; i < count; i++) {
          const page = list[i];
          const pageObj = 3 + i * 3;
          const imageObj = 4 + i * 3;
          const contentObj = 5 + i * 3;

          const info = readJpegInfo(page.bytes) || {};
          const imgW = page.width || info.width || 1;
          const imgH = page.height || info.height || 1;
          const components = info.components || 3;
          const colorSpace = components === 1 ? '/DeviceGray' : (components === 4 ? '/DeviceCMYK' : '/DeviceRGB');

          // 等比缩放到页面内，居中放置（不拉伸）
          const scale = Math.min(
            (A4.width - MARGIN * 2) / imgW,
            (A4.height - MARGIN * 2) / imgH
          );
          const w = imgW * scale;
          const h = imgH * scale;
          const x = (A4.width - w) / 2;
          const y = (A4.height - h) / 2;

          const content = 'q\n' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(y) + ' cm\n/Im0 Do\nQ\n';
          const contentBytes = bytesOfText(content);

          // 页面
          offsets[pageObj] = length;
          text(pageObj + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
            num(A4.width) + ' ' + num(A4.height) + '] ' +
            '/Resources << /XObject << /Im0 ' + imageObj + ' 0 R >> /ProcSet [/PDF /ImageC] >> ' +
            '/Contents ' + contentObj + ' 0 R >>\nendobj\n');

          // 图像（直接内嵌 JPEG 字节）
          offsets[imageObj] = length;
          text(imageObj + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imgW +
            ' /Height ' + imgH + ' /ColorSpace ' + colorSpace +
            ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length + ' >>\nstream\n');
          push(page.bytes);
          text('\nendstream\nendobj\n');

          // 内容流
          offsets[contentObj] = length;
          text(contentObj + ' 0 obj\n<< /Length ' + contentBytes.length + ' >>\nstream\n');
          push(contentBytes);
          text('endstream\nendobj\n');
        }

        // 交叉引用表
        const xrefOffset = length;
        text('xref\n0 ' + (totalObjects + 1) + '\n');
        text('0000000000 65535 f \n');
        for (let i = 1; i <= totalObjects; i++) {
          text(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
        }
        text('trailer\n<< /Size ' + (totalObjects + 1) + ' /Root 1 0 R >>\n');
        text('startxref\n' + xrefOffset + '\n%%EOF\n');

        resolve(new Blob(chunks, { type: 'application/pdf' }));
      } catch (e) {
        reject(U.appError('PDF_FAIL', e && e.message));
      }
    });
  }

  TB.pdf = {
    A4: A4,
    readJpegInfo: readJpegInfo,
    build: build
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
