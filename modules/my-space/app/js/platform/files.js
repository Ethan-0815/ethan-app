/*!
 * 我的空间 · 文件能力
 *
 * 浏览器环境：用 <a download> 保存、用 <input type=file> 读取。
 * Android 环境：走原生桥（window.MySpaceNative），并且全程"分段"传输，
 *              备份文件再大也不会因为一个超长 base64 字符串而爆内存。
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const CHUNK_SIZE = 384 * 1024;   // 每段 384KB

  function native() {
    return root.MySpaceNative || null;
  }

  function hasNative() {
    return !!native();
  }

  function isAndroidWebView() {
    return /Android/i.test(root.navigator ? root.navigator.userAgent : '');
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.onload = function () {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBytes(b64) {
    const bin = root.atob ? root.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function base64ToBlob(b64, mime) {
    return new Blob([base64ToBytes(b64)], { type: mime || 'application/octet-stream' });
  }

  function isError(value) {
    return String(value || '').indexOf('ERROR') === 0;
  }

  function errorText(value) {
    return String(value || '').replace(/^ERROR:?/, '') || '操作未能完成';
  }

  function idle() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /**
   * 保存文件（导出备份）
   * @returns {Promise<{target:string}>} target 用于告诉用户文件存到哪里
   */
  async function saveBlob(blob, fileName) {
    const bridge = native();

    // 1) 分段写入（推荐）
    if (bridge && typeof bridge.beginSave === 'function' &&
        typeof bridge.appendChunk === 'function' && typeof bridge.endSave === 'function') {
      const token = String(bridge.beginSave(fileName, blob.type || 'application/zip') || '');
      if (isError(token)) throw new Error(errorText(token));
      try {
        for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
          const part = blob.slice(offset, Math.min(offset + CHUNK_SIZE, blob.size));
          const b64 = await blobToBase64(part);
          const feedback = String(bridge.appendChunk(token, b64) || '');
          if (isError(feedback)) throw new Error(errorText(feedback));
          await idle();      // 让出主线程，保持界面不卡
        }
        const result = String(bridge.endSave(token) || '');
        if (isError(result)) throw new Error(errorText(result));
        return { target: result };
      } catch (e) {
        try { bridge.abortSave(token); } catch (e2) { /* ignore */ }
        throw e;
      }
    }

    // 2) 一次性写入（兼容旧实现）
    if (bridge && typeof bridge.saveFile === 'function') {
      const b64 = await blobToBase64(blob);
      const result = String(bridge.saveFile(b64, fileName, blob.type || 'application/zip') || '');
      if (isError(result)) throw new Error(errorText(result));
      return { target: result };
    }

    // 3) 浏览器下载
    if (root.navigator && root.navigator.msSaveBlob) {
      root.navigator.msSaveBlob(blob, fileName);
      return { target: '浏览器下载目录' };
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { target: '浏览器下载目录' };
  }

  /**
   * 选择文件（导入备份）
   * @returns {Promise<{name:string, blob:Blob}|null>} 用户取消返回 null
   */
  function pickFile(opts) {
    const o = opts || {};
    const accept = o.accept || '.zip,application/zip';
    const bridge = native();

    if (bridge && typeof bridge.pickFile === 'function') {
      return new Promise(function (resolve) {
        const token = 'pick_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
        root.MS.pendingPicks = root.MS.pendingPicks || {};
        root.MS.pendingPicks[token] = async function (payload) {
          if (!payload || payload.cancelled) { resolve(null); return; }
          try {
            // 分段读取
            if (typeof bridge.readChunk === 'function' && payload.size > 0) {
              const parts = [];
              let offset = 0;
              let guard = 0;
              while (offset < payload.size && guard < 20000) {
                guard++;
                const b64 = String(bridge.readChunk(token, offset, CHUNK_SIZE) || '');
                if (!b64) break;
                const bytes = base64ToBytes(b64);
                if (!bytes.length) break;
                parts.push(bytes);
                offset += bytes.length;
                if (guard % 6 === 0) await idle();
              }
              try { bridge.closeFile(token); } catch (e) { /* ignore */ }
              resolve({
                name: payload.name || 'backup.zip',
                blob: new Blob(parts, { type: payload.mime || 'application/zip' })
              });
              return;
            }
            // 兼容：原生一次性返回 base64
            if (payload.data) {
              resolve({ name: payload.name || 'backup.zip', blob: base64ToBlob(payload.data, payload.mime) });
              return;
            }
            resolve(null);
          } catch (e) {
            resolve(null);
          }
        };
        try {
          bridge.pickFile(token, o.mime || 'application/zip');
        } catch (e) {
          resolve(null);
        }
      });
    }

    // 浏览器：使用隐藏的 file input
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      let settled = false;
      const done = function (value) {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(value);
      };
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        if (!file) { done(null); return; }
        done({ name: file.name, blob: file });
      });
      document.body.appendChild(input);
      input.click();
      root.addEventListener('focus', function onFocus() {
        root.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (!input.files || !input.files.length) done(null);
        }, 700);
      });
    });
  }

  /* ---------------------------------------------------------------- 原生回调入口 */

  root.MS = root.MS || {};
  root.MS.onNativeFilePicked = function (token, payloadJson) {
    const handlers = root.MS.pendingPicks || {};
    const handler = handlers[token];
    if (!handler) return;
    delete handlers[token];
    let payload = null;
    try { payload = JSON.parse(payloadJson); } catch (e) { payload = null; }
    handler(payload);
  };

  MS.files = {
    hasNative: hasNative,
    native: native,
    isAndroidWebView: isAndroidWebView,
    saveBlob: saveBlob,
    pickFile: pickFile,
    blobToBase64: blobToBase64,
    base64ToBlob: base64ToBlob,
    CHUNK_SIZE: CHUNK_SIZE
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
