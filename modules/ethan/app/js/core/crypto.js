/* ETHAN V0.1 — crypto.js
 * Web Crypto API 封装：PBKDF2-SHA256 密钥派生 + AES-GCM 加解密 + 安全随机密码生成。
 * 硬约束：
 *   - 不使用 Math.random 生成任何密钥 / 密码 / IV / salt
 *   - 不硬编码任何密钥
 *   - 每次加密使用新的随机 IV
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Ethan = root.Ethan || {};
  root.Ethan.Crypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : this;

  var U = (typeof module === 'object' && module.exports)
    ? require('./util.js')
    : root.Ethan.Util;

  var KDF_ITERATIONS = 250000;   // PBKDF2-HMAC-SHA256 迭代次数
  var SALT_BYTES = 16;
  var IV_BYTES = 12;             // AES-GCM 标准 nonce 长度
  var KEY_BITS = 256;

  var VERIFY_PLAINTEXT = 'ETHAN-VAULT-VERIFY-v1';

  function subtle() {
    var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!c || !c.subtle) throw new Error('当前环境不支持 Web Crypto API');
    return c.subtle;
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    (root.crypto || globalThis.crypto).getRandomValues(b);
    return b;
  }

  function genSalt() { return randomBytes(SALT_BYTES); }
  function genIV() { return randomBytes(IV_BYTES); }

  /* ---------- 密钥派生 ---------- */

  // PIN / 备份密码 → AES-GCM CryptoKey
  function deriveKey(password, salt, iterations) {
    var s = subtle();
    var iters = iterations || KDF_ITERATIONS;
    var saltBytes = typeof salt === 'string' ? U.base64ToBytes(salt) : salt;
    var baseKey;
    if (s.importKey.length >= 3) {
      // 浏览器：Promise 风格
      return s.importKey('raw', U.utf8(String(password)), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
        .then(function (bk) { baseKey = bk; return bk; })
        .then(function (bk) {
          return s.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
            bk,
            { name: 'AES-GCM', length: KEY_BITS },
            false,
            ['encrypt', 'decrypt']
          );
        });
    }
    throw new Error('不支持的 Web Crypto 实现');
  }

  // 生成随机数据加密密钥（DEK）的原始字节
  function generateDEK() {
    return randomBytes(KEY_BITS / 8);
  }

  /* ---------- AES-GCM ---------- */

  function encryptBytes(key, plainBytes) {
    var iv = genIV();
    return subtle().encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, key, plainBytes)
      .then(function (ct) {
        return { iv: U.bytesToBase64(iv), ct: U.bytesToBase64(new Uint8Array(ct)) };
      });
  }

  function decryptBytes(key, ivB64, ctB64) {
    return subtle().decrypt(
      { name: 'AES-GCM', iv: U.base64ToBytes(ivB64), tagLength: 128 },
      key,
      U.base64ToBytes(ctB64)
    ).then(function (plain) { return new Uint8Array(plain); });
  }

  function encryptJson(key, obj) {
    return encryptBytes(key, U.utf8(JSON.stringify(obj)));
  }

  function decryptJson(key, ivB64, ctB64) {
    return decryptBytes(key, ivB64, ctB64).then(function (bytes) {
      return JSON.parse(U.utf8str(bytes));
    });
  }

  /* ---------- Vault 主密钥流程 ----------
   * PIN →(PBKDF2 + 随机 salt)→ KEK
   * KEK → 加密包裹随机 DEK（wrappedDEK）
   * DEK → 加密 vault 数据
   * 校验：KEK 加密固定串得到 verifier；能解开 verifier 即 PIN 正确。
   * 修改 PIN：只需用新 KEK 重新包裹同一个 DEK，数据本身无需重新加密。
   */
  function createVaultKeys(pin) {
    var salt = genSalt();
    return deriveKey(pin, salt).then(function (kek) {
      var dekRaw = generateDEK();
      // extractable=true 仅用于「修改 PIN」时把同一个 DEK 用新 KEK 重新包裹，避免重新加密全部数据。
      // DEK 只存在于内存中，从不落盘为明文。
      return subtle().importKey('raw', dekRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
        .then(function (dek) {
          return encryptBytes(kek, dekRaw).then(function (wrapped) {
            return encryptBytes(kek, U.utf8(VERIFY_PLAINTEXT)).then(function (verifier) {
              return {
                salt: U.bytesToBase64(salt),
                iterations: KDF_ITERATIONS,
                wrappedDEK: wrapped,
                verifier: verifier,
                dek: dek,
                kek: kek
              };
            });
          });
        });
    });
  }

  // 返回 {kek, dek}；PIN 错误时抛出 Error('INVALID_PIN')
  function unlockVaultKeys(pin, meta) {
    return deriveKey(pin, meta.salt, meta.iterations).then(function (kek) {
      return decryptBytes(kek, meta.verifier.iv, meta.verifier.ct)
        .then(function (bytes) {
          if (U.utf8str(bytes) !== VERIFY_PLAINTEXT) throw new Error('INVALID_PIN');
          return decryptBytes(kek, meta.wrappedDEK.iv, meta.wrappedDEK.ct);
        })
        .then(function (dekRaw) {
          return subtle().importKey('raw', new Uint8Array(dekRaw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
            .then(function (dek) { return { kek: kek, dek: dek }; });
        })
        .catch(function (e) {
          if (e && e.message === 'INVALID_PIN') throw e;
          throw new Error('INVALID_PIN'); // AES-GCM 认证失败同样代表 PIN 错误
        });
    });
  }

  // 用新 PIN 重新包裹 DEK（数据无需重新加密）
  function rewrapDEK(dek, newPin) {
    var salt = genSalt();
    return deriveKey(newPin, salt).then(function (kek) {
      return subtle().exportKey('raw', dek).then(function (raw) {
        return encryptBytes(kek, new Uint8Array(raw)).then(function (wrapped) {
          return encryptBytes(kek, U.utf8(VERIFY_PLAINTEXT)).then(function (verifier) {
            return {
              salt: U.bytesToBase64(salt),
              iterations: KDF_ITERATIONS,
              wrappedDEK: wrapped,
              verifier: verifier
            };
          });
        });
      });
    });
  }

  /* ---------- 备份口令密钥 ---------- */
  // 备份使用独立 KDF（独立 salt），不复用 vault KEK
  function createBackupKeys(password) {
    var salt = genSalt();
    return deriveKey(password, salt).then(function (key) {
      return { salt: U.bytesToBase64(salt), iterations: KDF_ITERATIONS, key: key };
    });
  }

  function unlockBackupKeys(password, saltB64, iterations) {
    return deriveKey(password, saltB64, iterations);
  }

  /* ---------- 安全随机密码生成 ---------- */

  // 无偏随机索引（拒绝采样），避免取模偏差
  function randomIndex(max) {
    if (max <= 0) throw new Error('字符集为空');
    var limit = Math.floor(0x100000000 / max) * max;
    var buf = new Uint32Array(1);
    var x;
    do {
      (root.crypto || globalThis.crypto).getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % max;
  }

  var SETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?/'
  };

  function generatePassword(opts) {
    opts = opts || {};
    var length = parseInt(opts.length, 10);
    if (!(length >= 4)) length = 16;
    if (length > 128) length = 128;

    // 默认四类全开；显式传 false 时排除
    var keys = ['upper', 'lower', 'digits', 'symbols'];
    var selected = keys.filter(function (k) { return opts[k] !== false; });
    if (!selected.length) selected = ['lower'];

    var pool = selected.map(function (k) { return SETS[k]; }).join('');
    var chars = [], i;
    // 每个被选中的类别至少取一个
    for (i = 0; i < selected.length && chars.length < length; i++) {
      var set = SETS[selected[i]];
      chars.push(set.charAt(randomIndex(set.length)));
    }
    while (chars.length < length) chars.push(pool.charAt(randomIndex(pool.length)));

    // Fisher-Yates 洗牌（安全随机）
    for (i = chars.length - 1; i > 0; i--) {
      var j = randomIndex(i + 1);
      var t = chars[i]; chars[i] = chars[j]; chars[j] = t;
    }
    return chars.join('');
  }

  function passwordStrength(pwd) {
    if (!pwd) return { score: 0, label: '空' };
    var score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 14) score++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    var label = score >= 4 ? '强' : score >= 3 ? '中' : '弱';
    return { score: score, label: label };
  }

  return {
    KDF_ITERATIONS: KDF_ITERATIONS,
    SALT_BYTES: SALT_BYTES,
    IV_BYTES: IV_BYTES,
    randomBytes: randomBytes,
    genSalt: genSalt,
    genIV: genIV,
    deriveKey: deriveKey,
    generateDEK: generateDEK,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
    encryptJson: encryptJson,
    decryptJson: decryptJson,
    createVaultKeys: createVaultKeys,
    unlockVaultKeys: unlockVaultKeys,
    rewrapDEK: rewrapDEK,
    createBackupKeys: createBackupKeys,
    unlockBackupKeys: unlockBackupKeys,
    generatePassword: generatePassword,
    passwordStrength: passwordStrength,
    randomIndex: randomIndex,
    SETS: SETS
  };
});
