/* ==========================================================================
   Travel Footprint — app.js
   Bootstrap: storage selection, router, nav, back handling, boot screen.
   ========================================================================== */
(function (root) {
  'use strict';

  var TF = (root.TF = root.TF || {});
  var UI = (TF.ui = TF.ui || {});
  var h = UI.dom.h;
  var icon = UI.dom.icon;
  var U = TF.util;

  var App = {
    repo: null,
    router: null,
    nav: null,
    storage: 'idb',
    _urlCache: {}
  };
  TF.app = App;

  /* --------------------------------------------------------- storage --- */

  function createRepo() {
    var useIdb = TF.idb.isAvailable();
    var blobAdapter;

    if (useIdb) {
      return TF.idb.openDb().then(function (db) {
        db.close();
        var r = new TF.repo.Repo({
          cities: new TF.idb.IdbAdapter('cities'),
          trips: new TF.idb.IdbAdapter('trips'),
          photos: new TF.idb.IdbAdapter('photos'),
          attachments: new TF.idb.IdbAdapter('attachments'),
          blobs: new TF.idb.IdbBlobStore()
        });
        App.storage = 'idb';
        return r.init();
      }).catch(function () {
        // private mode / quota / blocked → fall back to in-memory so the app
        // still opens, and tell the user once.
        App.storage = 'memory';
        var r = new TF.repo.Repo({
          cities: new TF.adapter.MemoryAdapter('cities'),
          trips: new TF.adapter.MemoryAdapter('trips'),
          photos: new TF.adapter.MemoryAdapter('photos'),
          attachments: new TF.adapter.MemoryAdapter('attachments'),
          blobs: new TF.adapter.MemoryBlobStore()
        });
        return r.init();
      });
    }

    App.storage = 'memory';
    return Promise.resolve(new TF.repo.Repo({
      cities: new TF.adapter.MemoryAdapter('cities'),
      trips: new TF.adapter.MemoryAdapter('trips'),
      photos: new TF.adapter.MemoryAdapter('photos'),
      attachments: new TF.adapter.MemoryAdapter('attachments'),
      blobs: new TF.adapter.MemoryBlobStore()
    }).init());
  }

  /* ------------------------------------------------------ blob helpers --- */

  /** Resolve a blob id to a fresh object URL (cached + revoked by caller). */
  App.resolveBlobUrl = function (blobId) {
    if (App._urlCache[blobId]) return Promise.resolve(App._urlCache[blobId]);
    return App.repo.getBlob(blobId).then(function (blob) {
      if (!blob) throw new Error('内容不存在');
      var url = URL.createObjectURL(new Blob([blob.bytes], { type: blob.mimeType || 'application/octet-stream' }));
      App._urlCache[blobId] = url;
      return url;
    });
  };

  /** Attach a thumbnail to an <img>, preferring the stored thumb blob. */
  App.attachThumb = function (imgEl, blobId) {
    var thumbId = 'thumb-' + blobId;
    App.resolveBlobUrl(thumbId).then(function (url) {
      imgEl.src = url;
    }).catch(function () {
      // no thumbnail stored (older record / attachment image) → use the full blob
      App.resolveBlobUrl(blobId).then(function (url) {
        imgEl.src = url;
      }).catch(function () {
        imgEl.classList.add('is-broken');
      });
    });
  };

  App.invalidateUrl = function (blobId) {
    delete App._urlCache['thumb-' + blobId];
    delete App._urlCache[blobId];
  };

  /* ---------------------------------------------------------- feedback --- */

  App.flash = function (message) {
    UI.parts.toast(message);
  };

  App.haptic = function (ms) {
    TF.native.vibrate(ms || 8);
  };

  /* ------------------------------------------------------- back handler --- */

  var backHandler = {
    /** Bottom sheet / dialog / viewer open → close the topmost one. */
    _handleOverlays: function () {
      if (UI.parts.hasOverlay()) {
        UI.parts.closeTopOverlay();
        return 'handled';
      }
      return null;
    },

    /** Deeper than the tab root → pop a page. */
    _handleStack: function () {
      if (App.router.depth() > 1) {
        App.router.back();
        return 'handled';
      }
      return null;
    },

    /**
     * System back button.
     * Order: dismiss keyboard → close overlay → pop page → confirm exit.
     * Returns 'handled' or 'exit' (native finishes the Activity on 'exit').
     */
    handle: function (opts) {
      var skipKeyboard = opts && opts.skipKeyboard;
      if (!skipKeyboard && TF.native.keyboardVisible()) {
        TF.native.hideKeyboard();
        return 'handled';
      }

      var overlayResult = backHandler._handleOverlays();
      if (overlayResult) return overlayResult;

      var stackResult = backHandler._handleStack();
      if (stackResult) return stackResult;

      // at the tab root — ask before leaving the app
      backHandler._confirmExit();
      return 'handled';
    },

    /**
     * Top-bar back arrow: always navigates immediately.
     * Sharing the "dismiss keyboard first" step with the system button makes
     * the first tap look unresponsive on device.
     */
    backArrow: function () {
      return backHandler.handle({ skipKeyboard: true });
    },

    _confirmExit: function () {
      if (backHandler._exitAsked) return;
      backHandler._exitAsked = true;

      UI.parts.confirm({
        title: '退出「旅行足迹」？',
        message: '你的数据已经保存在本机，随时可以回来。',
        confirmLabel: '退出',
        cancelLabel: '再看看',
        onConfirm: function () {
          backHandler._exitAsked = false;
          if (TF.native.isNative()) {
            var b = TF.native.bridge();
            if (b && b.exitApp) b.exitApp();
          }
        },
        onCancel: function () {
          backHandler._exitAsked = false;
        }
      });
    }
  };

  UI.backHandler = backHandler;

  /* ------------------------------------------------------------- boot --- */

  function buildBootScreen() {
    return h('div.boot', [
      h('div.boot__mark', [
        icon('compass', { size: 34, strokeWidth: 1.5 })
      ]),
      h('div.boot__title', '旅行足迹'),
      h('div.boot__sub', '记录我走过的地方'),
      h('div.boot__bar', [h('span.boot__fill')])
    ]);
  }

  function fail(error) {
    var viewport = document.getElementById('viewport');
    UI.dom.mount(viewport, h('div.boot.boot--error', [
      h('div.boot__mark', [icon('info', { size: 30 })]),
      h('div.boot__title', '启动失败'),
      h('div.boot__sub', (error && error.message) || '未知错误'),
      h('div.boot__actions', [
        UI.parts.primaryButton('重新加载', function () { location.reload(); })
      ])
    ]));
  }

  function start() {
    var viewport = document.getElementById('viewport');
    var overlayRoot = document.getElementById('overlay-root');

    UI.nav.applyGlassLevel();

    // apply the native safe-area value when provided (WebView env() can be 0)
    var nativeSafe = TF.native.safeAreaBottom();
    if (nativeSafe > 0) {
      document.documentElement.style.setProperty('--safe-b', nativeSafe + 'px');
    }

    UI.dom.mount(viewport, buildBootScreen());

    createRepo().then(function (repo) {
      App.repo = repo;

      // ask the browser to keep our data (best-effort, ignored if unsupported)
      if (App.storage === 'idb') TF.idb.requestPersistence().catch(function () {});

      var nav = new UI.nav.Nav({
        tabs: UI.router.TABS,
        onSelect: function (id) {
          if (App.router.tab === id && App.router.depth() === 1) {
            // tapping the active tab scrolls its list back to the top
            var top = App.router.top();
            if (top && top.screen) {
              var sc = top.screen.querySelector('.scroll');
              if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
            }
            return;
          }
          // selecting a tab always returns to that tab's root
          App.router.showTab(id);
          App.haptic(6);
        }
      });

      UI.nav = nav;

      var router = new UI.router.Router({
        viewport: viewport,
        pages: {
          home: UI.pages.home,
          map: UI.pages.map,
          timeline: UI.pages.timeline,
          cities: UI.pages.cities,
          city: UI.pages.city,
          bin: { mount: function () { return h('section.screen-bin'); } }
        }
      });

      App.router = router;

      // the nav needs to exist before the first tab renders
      var navHost = document.getElementById('nav-root');
      nav.mount(navHost);

      // replace the boot screen with the real app shell
      UI.dom.clear(viewport);

      router.showTab('home');
      nav.setActive('home', true);

      /* —— Super App 深链：?page=recycle 直达回收站 —— */
      try {
        var qs = new URLSearchParams(root.location.search);
        var targetPage = qs.get('page');
        if (targetPage === 'recycle' && typeof UI.flows.openRecycleBin === 'function') {
          setTimeout(function () { UI.flows.openRecycleBin(); }, 350);
        }
      } catch (e) { /* ignore */ }

      // repo changes → refresh the visible pages
      repo.onChange(U.debounce(function () {
        router.refreshAll();
      }, 60));

      if (App.storage === 'memory') {
        setTimeout(function () {
          UI.parts.toast('当前环境不支持本地数据库，数据不会被保存', { long: false, duration: 3600 });
        }, 900);
      }

      // keep object URLs from leaking across a long session
      root.addEventListener('pagehide', function () {
        for (var k in App._urlCache) {
          if (Object.prototype.hasOwnProperty.call(App._urlCache, k)) {
            try { URL.revokeObjectURL(App._urlCache[k]); } catch (e) { /* ignore */ }
          }
        }
        App._urlCache = {};
      });

      root.addEventListener('online', function () { /* deliberately ignored: offline by design */ });
    }).catch(fail);
  }

  /* --------------------------------------------------------- native hooks --- */

  // Called from the Android shell.
  root.TravelFootprintBoot = {
    start: start,
    onFilePicked: function (token, json) {
      TF.native.onFilePicked(token, json);
    },
    onFilePickCancelled: function (token) {
      TF.native.onFilePickCancelled(token);
    },
    back: function () {
      return UI.backHandler.handle();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
