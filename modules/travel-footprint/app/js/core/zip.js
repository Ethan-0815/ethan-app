/* ==========================================================================
   Travel Footprint — core/zip.js
   Minimal ZIP writer (STORE) + reader (STORE + DEFLATE).
   No dependencies. Works on ArrayBuffer / Uint8Array.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var U = TF.util;

  /* --------------------------------------------------------- CRC32 --- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ------------------------------------------------------- encoding --- */

  var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

  function utf8Encode(str) {
    if (encoder) return encoder.encode(str);
    // manual fallback
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    if (decoder) return decoder.decode(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0xe0) {
        out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[++i] & 0x3f));
      } else if (c < 0xf0) {
        out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
      } else {
        var cp = ((c & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) |
                 ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === 'string') return utf8Encode(data);
    if (data === null || data === undefined) return new Uint8Array(0);
    throw new Error('zip: unsupported entry data');
  }

  /* -------------------------------------------------------- writer --- */

  function Writer() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
  }

  Writer.prototype._push = function (bytes) {
    this.parts.push(bytes);
    this.offset += bytes.length;
  };

  Writer.prototype.add = function (name, data, opts) {
    var options = opts || {};
    var nameBytes = utf8Encode(name);
    var raw = toBytes(data);
    var crc = crc32(raw);
    var size = raw.length;

    // Store uncompressed by default. Images/PDFs are already compressed,
    // and this keeps the writer tiny and deterministic.
    var method = options.deflate && typeof deflateRaw === 'function' ? 8 : 0;
    var payload = raw;
    if (method === 8) {
      payload = deflateRaw(raw);
      if (!payload) { method = 0; payload = raw; }
    }

    var dostime = dosDateTime(options.date || new Date());
    var headerOffset = this.offset;

    // local file header
    var lh = new Uint8Array(30 + nameBytes.length);
    var lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0x0800, true);        // UTF-8 flag
    lv.setUint16(8, method, true);
    lv.setUint16(10, dostime.time, true);
    lv.setUint16(12, dostime.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    this._push(lh);
    this._push(payload);

    this.central.push({
      name: nameBytes,
      method: method,
      crc: crc,
      compressed: payload.length,
      size: size,
      offset: headerOffset,
      time: dostime.time,
      date: dostime.date
    });

    return this;
  };

  Writer.prototype.addText = function (name, text, opts) {
    return this.add(name, utf8Encode(text), opts);
  };

  Writer.prototype.addJson = function (name, value, opts) {
    return this.addText(name, JSON.stringify(value, null, 2), opts);
  };

  Writer.prototype.finish = function () {
    var cdStart = this.offset;
    var i;

    for (i = 0; i < this.central.length; i++) {
      var e = this.central[i];
      var cd = new Uint8Array(46 + e.name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);           // version made by
      cv.setUint16(6, 20, true);           // version needed
      cv.setUint16(8, 0x0800, true);       // UTF-8
      cv.setUint16(10, e.method, true);
      cv.setUint16(12, e.time, true);
      cv.setUint16(14, e.date, true);
      cv.setUint32(16, e.crc, true);
      cv.setUint32(20, e.compressed, true);
      cv.setUint32(24, e.size, true);
      cv.setUint16(28, e.name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, e.offset, true);
      cd.set(e.name, 46);
      this._push(cd);
    }

    var cdSize = this.offset - cdStart;

    // end of central directory
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.central.length, true);
    ev.setUint16(10, this.central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);
    this._push(eocd);

    return concat(this.parts, this.offset);
  };

  function dosDateTime(d) {
    var year = d.getFullYear();
    if (year < 1980) year = 1980;
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function concat(parts, total) {
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < parts.length; i++) {
      out.set(parts[i], pos);
      pos += parts[i].length;
    }
    return out;
  }

  /* -------------------------------------------------------- reader --- */

  /**
   * Parse a ZIP into [{ name, bytes, method, size, crc }].
   * Supports STORE (0) and DEFLATE (8) via DecompressionStream when present.
   * Returns { entries: [...] } — entries are lazy for DEFLATE.
   */
  function read(buffer) {
    var bytes = toBytes(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocdPos = findEocd(view);
    if (eocdPos === -1) throw new Error('不是有效的 ZIP 文件（未找到目录结尾）');

    var entryCount = view.getUint16(eocdPos + 10, true);
    var cdOffset = view.getUint32(eocdPos + 16, true);

    if (cdOffset === 0xffffffff || entryCount === 0xffff) {
      var z64 = findZip64(view, eocdPos);
      if (z64 !== -1) {
        entryCount = Number(view.getBigUint64(z64 + 32, true));
        cdOffset = Number(view.getBigUint64(z64 + 48, true));
      }
    }

    var entries = [];
    var pos = cdOffset;

    for (var i = 0; i < entryCount; i++) {
      if (pos + 46 > bytes.length) break;
      if (view.getUint32(pos, true) !== 0x02014b50) break;

      var method = view.getUint16(pos + 10, true);
      var crc = view.getUint32(pos + 16, true);
      var compSize = view.getUint32(pos + 20, true);
      var rawSize = view.getUint32(pos + 24, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var localOffset = view.getUint32(pos + 42, true);

      var nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLen);
      var name = utf8Decode(nameBytes);

      // ZIP64 extra field
      if (compSize === 0xffffffff || rawSize === 0xffffffff || localOffset === 0xffffffff) {
        var ex = readZip64Extra(bytes, pos + 46 + nameLen, extraLen, rawSize, compSize, localOffset);
        rawSize = ex.size;
        compSize = ex.compressed;
        localOffset = ex.offset;
      }

      entries.push({
        name: name,
        method: method,
        crc: crc,
        compressedSize: compSize,
        size: rawSize,
        offset: localOffset
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }

    return { entries: entries, bytes: bytes, view: view };
  }

  function readZip64Extra(bytes, start, len, size, compressed, offset) {
    var end = start + len;
    var p = start;
    var out = { size: size, compressed: compressed, offset: offset };

    while (p + 4 <= end) {
      var id = bytes[p] | (bytes[p + 1] << 8);
      var sz = bytes[p + 2] | (bytes[p + 3] << 8);
      p += 4;
      if (id === 0x0001) {
        var q = p;
        if (size === 0xffffffff && q + 8 <= p + sz) { out.size = readU64(bytes, q); q += 8; }
        if (compressed === 0xffffffff && q + 8 <= p + sz) { out.compressed = readU64(bytes, q); q += 8; }
        if (offset === 0xffffffff && q + 8 <= p + sz) { out.offset = readU64(bytes, q); q += 8; }
        break;
      }
      p += sz;
    }
    return out;
  }

  function readU64(bytes, p) {
    var lo = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
    var hi = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
    return hi * 4294967296 + (lo >>> 0);
  }

  function findEocd(view) {
    var len = view.byteLength;
    var start = Math.max(0, len - 65557);
    for (var i = len - 22; i >= start; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function findZip64(view, eocdPos) {
    for (var i = eocdPos - 20; i >= 0 && i > eocdPos - 1024; i--) {
      if (view.getUint32(i, true) === 0x07064b50) return i;
    }
    return -1;
  }

  /** Extract raw (decompressed) bytes for one parsed entry. */
  async function extract(zip, entry) {
    var bytes = zip.bytes;
    var view = zip.view;
    var off = entry.offset;

    if (view.getUint32(off, true) !== 0x04034b50) {
      throw new Error('ZIP 条目损坏：' + entry.name);
    }

    var nameLen = view.getUint16(off + 26, true);
    var extraLen = view.getUint16(off + 28, true);
    var dataStart = off + 30 + nameLen + extraLen;
    var raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) {
      return copyBytes(raw);
    }

    if (entry.method === 8) {
      var inflated = await inflateRaw(raw);
      if (!inflated) throw new Error('无法解压 ZIP 条目（浏览器不支持 DEFLATE）：' + entry.name);
      return inflated;
    }

    throw new Error('不支持的 ZIP 压缩方式 (' + entry.method + ')：' + entry.name);
  }

  function copyBytes(sub) {
    var out = new Uint8Array(sub.length);
    out.set(sub);
    return out;
  }

  /** Decompress raw DEFLATE. Uses DecompressionStream when available. */
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([data]).stream().pipeThrough(ds);
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      try {
        // some engines only expose 'deflate' (zlib-wrapped)
        var ds2 = new DecompressionStream('deflate');
        var s2 = new Blob([data]).stream().pipeThrough(ds2);
        var b2 = await new Response(s2).arrayBuffer();
        return new Uint8Array(b2);
      } catch (e2) {
        return null;
      }
    }
  }

  /** Compress with DEFLATE. Returns null when unsupported. */
  function deflateRaw(data) {
    // CompressionStream is async; the writer is sync, so we stay on STORE.
    return null;
  }

  TF.zip = {
    Writer: Writer,
    write: function (entries, opts) {
      var w = new Writer();
      for (var i = 0; i < entries.length; i++) {
        w.add(entries[i].name, entries[i].data, opts);
      }
      return w.finish();
    },
    read: read,
    extract: extract,
    inflateRaw: inflateRaw,
    crc32: crc32,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    toBytes: toBytes
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
