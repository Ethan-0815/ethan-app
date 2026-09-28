/*!
 * 我的空间 · 零依赖 ZIP 读写（浏览器 / Node 通用）
 * 写入：STORE 存储（不压缩，速度最快、兼容性最好；图片本身已是压缩格式，JSON 很小）
 * 读取：支持 STORE 与 DEFLATE（外部工具生成的 zip 也能读）
 * 完整支持 UTF-8 文件名（general purpose flag bit 11）
 */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
    };
  }

  function toBytes(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new Error('unsupported entry data');
  }

  /**
   * 生成 ZIP
   * @param {Array<{name:string, data:Uint8Array|string|Blob, dir?:boolean}>} entries
   * @returns {Promise<Blob>}
   */
  async function write(entries) {
    const enc = new TextEncoder();
    const list = Array.isArray(entries) ? entries : [];
    const parts = [];
    const central = [];
    let offset = 0;
    const stamp = dosDateTime(new Date());

    for (let i = 0; i < list.length; i++) {
      const e = list[i] || {};
      let name = String(e.name || '').replace(/\\/g, '/');
      if (!name) continue;
      const isDir = !!e.dir || name.endsWith('/');
      if (isDir && !name.endsWith('/')) name += '/';

      let data = new Uint8Array(0);
      if (!isDir) {
        if (e.data && typeof e.data.arrayBuffer === 'function') {
          data = new Uint8Array(await e.data.arrayBuffer());
        } else {
          data = toBytes(e.data);
        }
      }

      const nameBytes = enc.encode(name);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);        // version needed
      lv.setUint16(6, 0x0800, true);    // UTF-8 flag
      lv.setUint16(8, 0, true);         // method: store
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local);
      if (data.length) parts.push(data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);        // version made by
      cv.setUint16(6, 20, true);        // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(38, isDir ? 0x10 : 0, true);   // external attrs
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    }

    let cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const all = parts.concat(central);
    all.push(eocd);
    return new Blob(all, { type: 'application/zip' });
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw MS.appError('ZIP_BROKEN', 'no DecompressionStream');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * 读取 ZIP
   * @param {ArrayBuffer|Uint8Array|Blob} input
   * @returns {Promise<Array<{name:string, dir:boolean, data:Uint8Array}>>}
   */
  async function read(input) {
    let bytes;
    if (input && typeof input.arrayBuffer === 'function') bytes = new Uint8Array(await input.arrayBuffer());
    else bytes = toBytes(input);
    if (bytes.length < 22) throw MS.appError('ZIP_BROKEN', 'too small');

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const scanFrom = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= scanFrom; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw MS.appError('ZIP_BROKEN', 'no eocd');

    const count = view.getUint16(eocd + 10, true);
    let pointer = view.getUint32(eocd + 16, true);
    if (pointer === 0 || count === 0) throw MS.appError('ZIP_BROKEN', 'empty');
    if (count === 0xffff) throw MS.appError('ZIP_BROKEN', 'zip64 not supported');

    const dec = new TextDecoder('utf-8');
    const out = [];
    for (let i = 0; i < count; i++) {
      if (pointer + 46 > bytes.length) throw MS.appError('ZIP_BROKEN', 'cd overflow');
      if (view.getUint32(pointer, true) !== 0x02014b50) throw MS.appError('ZIP_BROKEN', 'bad cd header');
      const method = view.getUint16(pointer + 10, true);
      const compSize = view.getUint32(pointer + 20, true);
      const nameLen = view.getUint16(pointer + 28, true);
      const extraLen = view.getUint16(pointer + 30, true);
      const commentLen = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const name = dec.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
      pointer += 46 + nameLen + extraLen + commentLen;

      const isDir = name.endsWith('/');
      let data = new Uint8Array(0);
      if (!isDir && compSize > 0) {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw MS.appError('ZIP_BROKEN', 'bad local header');
        const lNameLen = view.getUint16(localOffset + 26, true);
        const lExtraLen = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(start, start + compSize);
        if (method === 0) data = raw.slice();
        else if (method === 8) data = await inflateRaw(raw);
        else throw MS.appError('ZIP_BROKEN', 'unsupported method ' + method);
      }
      out.push({ name: name, dir: isDir, data: data });
    }
    return out;
  }

  MS.zip = { crc32: crc32, write: write, read: read, inflateRaw: inflateRaw };
})(typeof globalThis !== 'undefined' ? globalThis : this);
