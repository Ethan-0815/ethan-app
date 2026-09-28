/* ESA · 平台桥（Android WebView / H5）
 * Android 壳通过 evaluateJavascript 调用 root.ESA_back()；返回：
 *   'exit'   —— 已在超级 App 首页根态（壳可退出）
 *   'stay'   —— 已在内部处理
 * H5 浏览器环境无壳，靠 history/popstate 自然返回。
 */
(function (root) {
  'use strict';
  const ESA = (root.ESA = root.ESA || {});

  function isNative() {
    return !!(root.ESANative);
  }

  ESA.platform = {
    isNative: isNative,
    appVersion: function () {
      try { return root.ESANative && root.ESANative.appVersion ? root.ESANative.appVersion() : ''; }
      catch (e) { return ''; }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
