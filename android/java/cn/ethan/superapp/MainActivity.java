package cn.ethan.superapp;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * ETHAN Super App · Android 壳（零第三方依赖）
 *
 * 1. 自实现资源拦截：https://appassets.androidplatform.net/assets/ ← assets/
 *    secure context：IndexedDB / Web Crypto / Blob 全部可用（ETHAN 加密体系依赖它）。
 * 2. 无 INTERNET 权限 —— 整个超级 App 物理离线。
 * 3. 桥以四个名字注入（ESANative / MySpaceNative / ToolboxNative / TravelFootprintNative），
 *    四个子模块的原生文件能力零改动可用。
 * 4. 返回键统一交给 H5 的 window.ESA_back()；返回 'exit' 才真正退出。
 * 5. 任何启动异常写 crash.txt 并以对话框显示，便于离线排障。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";

    private WebView web;
    private boolean fatalShown = false;

    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private String pendingPickToken;
    private String pendingPickMime = "*/*";

    private static final int REQUEST_FILE_CHOOSER = 8101;
    private static final int REQUEST_PICK_DOCUMENT = 8102;
    private static final int REQUEST_LEGACY_STORAGE = 8103;

    private final NativeBridge bridge = new NativeBridge(this);

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            showFatal(t);
            return;
        }

        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try { saveCrash(e); } catch (Throwable ignored) {}
            if (prev != null) prev.uncaughtException(t, e);
        });

        try {
            WebView w = new WebView(this);
            web = w;
            setContentView(w);

            // 状态栏/导航栏区域空出来（内容不从状态栏下穿），颜色跟随 H5 深浅模式：
            // H5 侧 prefs.apply() 会调用 window.EthanTheme.apply('dark'|'light') 通知壳换色。
            // （Android WebView 不向页面下发 safe-area-inset，env() 恒为 0，故不采用沉浸式方案。）
            android.view.Window win = getWindow();
            win.setStatusBarColor(Color.parseColor("#f3f3f4"));
            win.setNavigationBarColor(Color.parseColor("#f3f3f4"));
            android.view.View decor = win.getDecorView();
            decor.setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

            WebSettings s = w.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(true); // content://（相机输出、文档读取）需要
            s.setCacheMode(WebSettings.LOAD_NO_CACHE);
            s.setMediaPlaybackRequiresUserGesture(true);
            s.setLoadWithOverviewMode(false);
            s.setSupportZoom(false);
            s.setBuiltInZoomControls(false);
            s.setTextZoom(100);
            s.setJavaScriptCanOpenWindowsAutomatically(false);
            s.setSupportMultipleWindows(false);
            s.setUserAgentString(s.getUserAgentString() + " ETHAN-SuperApp/0.1");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try { s.setForceDark(WebSettings.FORCE_DARK_OFF); } catch (Throwable ignored) {}
            }

            // 同一个桥实例以四个名字注入：子模块各自的全局名都能找到原生能力
            w.addJavascriptInterface(bridge, "ESANative");
            w.addJavascriptInterface(bridge, "MySpaceNative");
            w.addJavascriptInterface(bridge, "ToolboxNative");
            w.addJavascriptInterface(bridge, "TravelFootprintNative");
            w.addJavascriptInterface(new ThemeBridge(), "EthanTheme");

            w.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return serveAsset(request.getUrl().toString());
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String host = request.getUrl().getHost();
                    return host == null || !host.equals(HOST);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) {
                        runOnUiThread(() -> {
                            try {
                                String desc = error != null ? String.valueOf(error.getDescription()) : "未知错误";
                                new AlertDialog.Builder(MainActivity.this)
                                        .setTitle("页面加载失败")
                                        .setMessage(desc + "\n\n" + request.getUrl())
                                        .setPositiveButton("重试", null)
                                        .show();
                            } catch (Throwable ignored) {}
                        });
                    }
                }
            });

            w.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                    filePathCallback = callback;
                    String accept = params == null || params.getAcceptTypes() == null
                            ? "" : String.join(",", params.getAcceptTypes());
                    boolean wantsImage = accept.contains("image") || accept.isEmpty();
                    boolean wantCapture = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            && params != null && params.isCaptureEnabled();

                    Intent intent;
                    if (wantCapture && wantsImage) {
                        Uri uri = createCameraOutputUri();
                        if (uri == null) return false;
                        cameraOutputUri = uri;
                        intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } else {
                        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(wantsImage ? "image/*" : "*/*");
                        if (params != null) {
                            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                                    params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                        }
                    }
                    try {
                        startActivityForResult(Intent.createChooser(intent, getString(R.string.choose_file)), REQUEST_FILE_CHOOSER);
                        return true;
                    } catch (ActivityNotFoundException e) {
                        if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                        filePathCallback = null;
                        toast(getString(R.string.no_file_picker));
                        return false;
                    }
                }
            });

            w.setBackgroundColor(Color.TRANSPARENT);
            w.loadUrl("https://" + HOST + "/assets/index.html");
            requestLegacyStorageIfNeeded();
        } catch (Throwable t) {
            showFatal(t);
        }
    }

    /* ------------------------------------------------------------ 资源拦截 */

    private WebResourceResponse serveAsset(String url) {
        try {
            java.net.URI uri = java.net.URI.create(url);
            if (!HOST.equals(uri.getHost())) return notFound();
            String path = uri.getPath();
            if (path == null) return notFound();
            // /assets/index.html 下的相对路径 ../modules/... 会解析成 /modules/...（不带 /assets/ 前缀），
            // 因此除 /assets/ 前缀外，还要剥掉可能残留的前导斜杠，统一映射到 assets 根。
            String rel = path.replaceFirst("^/assets/", "");
            if (rel.startsWith("/")) rel = rel.substring(1);
            if (rel.isEmpty() || rel.contains("..")) return notFound();
            InputStream is = getAssets().open(rel);
            WebResourceResponse resp = new WebResourceResponse(mimeOf(rel), null, is);
            resp.setResponseHeaders(java.util.Collections.singletonMap("Access-Control-Allow-Origin", "*"));
            return resp;
        } catch (Throwable t) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8",
                new java.io.ByteArrayInputStream("Not Found".getBytes()));
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------ 文件选择 / 相机 */

    private Uri createCameraOutputUri() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
            return CameraContentProvider.cameraOutputUri(this, file.getName());
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private void requestLegacyStorageIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return;
        if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_LEGACY_STORAGE);
    }

    /** 由 NativeBridge 调用：打开系统文件选择器（导入备份） */
    void openDocumentPicker(String token, String mime) {
        pendingPickToken = token;
        pendingPickMime = mime == null || mime.isEmpty() ? "*/*" : mime;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if (pendingPickMime.contains("zip")) {
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/octet-stream", "application/x-zip-compressed"});
        } else {
            intent.setType(pendingPickMime);
        }
        try {
            startActivityForResult(intent, REQUEST_PICK_DOCUMENT);
        } catch (ActivityNotFoundException e) {
            pendingPickToken = null;
            bridge.notifyPickCancelled(token);
            toast(getString(R.string.no_file_picker));
        }
    }

    void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }

    public void evalJs(String script) {
        if (web != null) web.evaluateJavascript(script, null);
    }

    @Deprecated
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK) {
                if (data != null && data.getClipData() != null) {
                    android.content.ClipData clip = data.getClipData();
                    results = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) results[i] = clip.getItemAt(i).getUri();
                } else if (data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (cameraOutputUri != null) {
                    results = new Uri[]{cameraOutputUri};
                }
            }
            if (filePathCallback != null) filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            cameraOutputUri = null;
        } else if (requestCode == REQUEST_PICK_DOCUMENT) {
            String token = pendingPickToken;
            pendingPickToken = null;
            Uri uri = data != null ? data.getData() : null;
            if (resultCode == Activity.RESULT_OK && token != null && uri != null) {
                try {
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {}
                bridge.openPickSession(token, uri);
            } else if (token != null) {
                bridge.notifyPickCancelled(token);
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /* ------------------------------------------------------------ 返回键与生命周期 */

    @Override
    public void onBackPressed() {
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript("(window.ESA_back) ? String(window.ESA_back()) : 'exit'", value -> {
            String result = value == null ? "exit" : value.trim().replace("\"", "");
            if ("exit".equals(result)) finish();
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript(PAUSE_SCRIPT, null);
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (web != null) web.evaluateJavascript(RESUME_SCRIPT, null);
    }

    @Override
    protected void onDestroy() {
        bridge.releaseAll();
        if (web != null) {
            web.removeJavascriptInterface("ESANative");
            web.removeJavascriptInterface("MySpaceNative");
            web.removeJavascriptInterface("ToolboxNative");
            web.removeJavascriptInterface("TravelFootprintNative");
            web.destroy();
        }
        super.onDestroy();
    }

    /** 进入后台：遍历主文档与 iframe，让 ETHAN 按策略立即锁定（immediately） */
    private static final String PAUSE_SCRIPT =
            "(function(){try{" +
            " var ws=[window];try{for(var i=0;i<window.frames.length;i++)ws.push(window.frames[i]);}catch(e){}" +
            " ws.forEach(function(w){try{" +
            "  var E=w.Ethan; if(!E||!E.Store||!E.App)return;" +
            "  if(!E.Store.isUnlocked())return;" +
            "  if(E.Store.getPrefs().autoLock==='immediately')E.App.lockNow();" +
            " }catch(e){}});" +
            "}catch(e){}})()";

    private static final String RESUME_SCRIPT =
            "(function(){try{" +
            " var ws=[window];try{for(var i=0;i<window.frames.length;i++)ws.push(window.frames[i]);}catch(e){}" +
            " ws.forEach(function(w){try{if(w.Ethan&&w.Ethan.App&&w.Ethan.App.armAutoLock)w.Ethan.App.armAutoLock();}catch(e){}});" +
            "}catch(e){}})()";

    /* ------------------------------------------------------------ 崩溃兜底 */

    private void showFatal(Throwable t) {
        saveCrash(t);
        if (fatalShown) return;
        fatalShown = true;
        try {
            String msg = stackOf(t);
            if (msg.length() > 3500) msg = msg.substring(0, 3500) + "\n…（完整内容见 crash.txt）";
            new AlertDialog.Builder(this)
                    .setTitle("ETHAN 启动出错")
                    .setMessage(msg + "\n\n（已保存到 crash.txt）")
                    .setPositiveButton("关闭", null)
                    .show();
        } catch (Throwable ignored) {}
    }

    private void saveCrash(Throwable t) {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            if (dir == null) return;
            FileWriter fw = new FileWriter(new File(dir, "crash.txt"), true);
            fw.write("---- " + new java.util.Date() + " ----\n");
            fw.write(stackOf(t));
            fw.write("\n\n");
            fw.close();
        } catch (Throwable ignored) {}
    }

    private static String stackOf(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        StringBuilder sb = new StringBuilder(sw.toString());
        sb.append("\nBuild: Android ").append(Build.VERSION.SDK_INT)
                .append(" · ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL);
        return sb.toString();
    }

    /** H5 → 原生：状态栏/导航栏颜色跟随应用深浅模式（携带页面真实背景色，严格同色） */
    private class ThemeBridge {
        @android.webkit.JavascriptInterface
        public void apply(final String mode, final String color) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (isFinishing()) return;
                    boolean dark = "dark".equals(mode);
                    int bg;
                    try {
                        if (color != null && color.startsWith("#") && (color.length() == 7 || color.length() == 9)) {
                            bg = Color.parseColor(color);
                        } else {
                            bg = Color.parseColor(dark ? "#141416" : "#f3f3f4");
                        }
                    } catch (Exception e) {
                        bg = Color.parseColor(dark ? "#141416" : "#f3f3f4");
                    }
                    android.view.Window win = getWindow();
                    win.setStatusBarColor(bg);
                    win.setNavigationBarColor(bg);
                    android.view.View decor = win.getDecorView();
                    int vis = decor.getSystemUiVisibility();
                    if (dark) {
                        vis &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    } else {
                        vis |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    }
                    decor.setSystemUiVisibility(vis);
                }
            });
        }
    }
}
