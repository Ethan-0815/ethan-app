/*!
 * 工具箱 · 文件能力
 *
 * 浏览器环境：<input type=file> 选图、<a download> 保存、剪贴板 API 复制。
 * Android 环境：保存走原生桥（window.ToolboxNative），并且分段传输，
 *              避免把几十 MB 的内容拼成一个超长 base64 字符串。
 *              （选图仍使用标准 input[type=file]，由壳里的 onShowFileChooser 接管）
 */
(function (root) {
  'use strict';
  const TB = (root.TB = root.TB || {});
  const U = TB.util;

  const CHUNK_SIZE = 384 * 1024;   // 每段 384KB

  function native() {
    return root.ToolboxNative || null;
  }

  function hasNative() {
    return !!native();
  }

  function isAndroidWebView() {
    return /Android/i.test(root.navigator ? root.navigator.userAgent : '');
  }

  function idle() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(U.appError('SAVE_FAIL')); };
      reader.onload = function () {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  function isError(value) {
    return String(value || '').indexOf('ERROR') === 0;
  }

  function errorText(value) {
    return String(value || '').replace(/^ERROR:?/, '') || U.ERROR_MESSAGES.SAVE_FAIL;
  }

  /**
   * 保存文件
   * @returns {Promise<{target:string}>} target 用于告诉用户存到哪里
   */
  async function saveBlob(blob, fileName) {
    const name = U.safeFileName(fileName, 'toolbox-output');
    const mime = blob.type || 'application/octet-stream';
    const bridge = native();

    // 1) 分段写入（Android 推荐路径）
    if (bridge && typeof bridge.beginSave === 'function' &&
      typeof bridge.appendChunk === 'function' && typeof bridge.endSave === 'function') {
      const token = String(bridge.beginSave(name, mime) || '');
      if (isError(token)) throw U.appError('SAVE_FAIL', errorText(token));
      try {
        for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
          const part = blob.slice(offset, Math.min(offset + CHUNK_SIZE, blob.size));
          const b64 = await blobToBase64(part);
          const feedback = String(bridge.appendChunk(token, b64) || '');
          if (isError(feedback)) throw U.appError('SAVE_FAIL', errorText(feedback));
          await idle();
        }
        const result = String(bridge.endSave(token) || '');
        if (isError(result)) throw U.appError('SAVE_FAIL', errorText(result));
        return { target: result || '下载目录' };
      } catch (e) {
        try { bridge.abortSave(token); } catch (e2) { /* ignore */ }
        throw e;
      }
    }

    // 2) 一次性写入（兼容旧壳）
    if (bridge && typeof bridge.saveFile === 'function') {
      const b64 = await blobToBase64(blob);
      const result = String(bridge.saveFile(b64, name, mime) || '');
      if (isError(result)) throw U.appError('SAVE_FAIL', errorText(result));
      return { target: result || '下载目录' };
    }

    // 3) 浏览器下载
    if (root.navigator && root.navigator.msSaveBlob) {
      root.navigator.msSaveBlob(blob, name);
      return { target: '浏览器下载目录' };
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { target: '浏览器下载目录' };
  }

  /**
   * 打开系统文件选择器（这是唯一需要"原生对话框"的出口，自动化测试会替换它）
   * @returns {Promise<File[]>} 用户取消返回空数组
   */
  function pickRawFiles(accept, multiple) {
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      if (multiple) input.multiple = true;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.top = '0';
      input.style.opacity = '0';
      let settled = false;
      const finish = function (files) {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(files || []);
      };
      input.addEventListener('change', function () {
        const list = input.files ? Array.prototype.slice.call(input.files) : [];
        finish(list);
      });
      document.body.appendChild(input);
      try {
        input.click();
      } catch (e) {
        finish([]);
        return;
      }
      // 用户直接取消（多数内核不触发 change）：借助窗口重新获得焦点判断
      root.addEventListener('focus', function onFocus() {
        root.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (!input.files || !input.files.length) finish([]);
        }, 800);
      });
    });
  }

  /**
   * 选择图片
   * 注意：这里刻意通过 TB.files.pickRawFiles 调用（而不是直接调闭包里的函数），
   * 让"系统文件选择器"成为一个可替换的出口——自动化测试只替换它，
   * 后面的读取、解码、处理流程仍然全部走真实代码。
   * @param {{multiple?:boolean}} opts
   * @returns {Promise<File[]>} 用户取消返回空数组
   */
  function pickImages(opts) {
    const o = opts || {};
    return TB.files.pickRawFiles('image/*', !!o.multiple);
  }

  /** 读取文本文件（本地 FileReader，不经过任何网络） */
  function readTextFile(file, opts) {
    const o = opts || {};
    const maxBytes = Number.isFinite(o.maxBytes) ? o.maxBytes : 5 * 1024 * 1024;
    return new Promise(function (resolve, reject) {
      if (!file) { reject(U.appError('FILE_READ_FAIL')); return; }
      if (Number.isFinite(file.size) && file.size > maxBytes) {
        reject(U.appError('FILE_TOO_BIG'));
        return;
      }
      let reader;
      try {
        reader = new FileReader();
      } catch (e) {
        reject(U.appError('FILE_READ_FAIL'));
        return;
      }
      reader.onerror = function () { reject(U.appError('FILE_READ_FAIL')); };
      reader.onabort = function () { reject(U.appError('FILE_READ_FAIL')); };
      reader.onload = function () {
        let text = String(reader.result === null || reader.result === undefined ? '' : reader.result);
        if (text.charAt(0) === '\uFEFF') text = text.slice(1);      // 去掉 UTF-8 BOM，否则 JSON.parse 会失败
        resolve({
          name: U.safeFileName(file.name, 'data.json'),
          size: Number.isFinite(file.size) ? file.size : text.length,
          text: text
        });
      };
      try {
        reader.readAsText(file, 'utf-8');
      } catch (e) {
        reject(U.appError('FILE_READ_FAIL'));
      }
    });
  }

  /**
   * 选择一个文本文件并读出内容
   * 同样通过 TB.files.pickRawFiles 走"可替换出口"，读取逻辑保持真实。
   * @returns {Promise<{name:string,size:number,text:string}|null>} 用户取消返回 null
   */
  async function pickTextFile(opts) {
    const o = opts || {};
    const files = await TB.files.pickRawFiles(o.accept || '.json,application/json,text/plain', false);
    if (!files || !files.length) return null;
    return readTextFile(files[0], { maxBytes: o.maxBytes });
  }

  /** 复制文本到剪贴板；成功返回 true */
  async function copyText(text) {
    const s = U.str(text);
    if (s === '') return false;
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        await root.navigator.clipboard.writeText(s);
        return true;
      }
    } catch (e) { /* 降级 */ }
    try {
      const area = document.createElement('textarea');
      area.value = s;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      area.style.top = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, s.length);
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(area);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  TB.files = {
    native: native,
    hasNative: hasNative,
    isAndroidWebView: isAndroidWebView,
    saveBlob: saveBlob,
    pickRawFiles: pickRawFiles,
    pickImages: pickImages,
    pickTextFile: pickTextFile,
    readTextFile: readTextFile,
    copyText: copyText,
    blobToBase64: blobToBase64,
    CHUNK_SIZE: CHUNK_SIZE,
    MAX_TEXT_BYTES: 5 * 1024 * 1024
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
