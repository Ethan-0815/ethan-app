package cn.ethan.superapp;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ETHAN Super App · 原生桥
 *
 * 同一个桥实例以四个名字注入 WebView：
 *   ESANative / MySpaceNative / ToolboxNative / TravelFootprintNative
 * 这样四个子模块的原生调用（文件分段导出导入、振动等）零改动可用。
 * 移植自 my-space NativeBridge.kt，并补充 TF 需要的 vibrate / isNative / getVersion / safeAreaBottom。
 * 所有方法返回字符串，出错以 ERROR: 开头。
 */
public class NativeBridge {

    private static final String APP_VERSION = "0.1.0";

    private static class SaveSession {
        final File file;
        final FileOutputStream stream;
        final String fileName;
        final String mime;
        long bytes = 0;
        SaveSession(File file, FileOutputStream stream, String fileName, String mime) {
            this.file = file; this.stream = stream; this.fileName = fileName; this.mime = mime;
        }
    }

    private static class PickSession {
        final Uri uri;
        final String name;
        final long size;
        final String mime;
        InputStream stream;
        long position = 0;
        PickSession(Uri uri, String name, long size, String mime) {
            this.uri = uri; this.name = name; this.size = size; this.mime = mime;
        }
    }

    private final MainActivity activity;
    private final ConcurrentHashMap<String, SaveSession> saveSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, PickSession> pickSessions = new ConcurrentHashMap<>();

    public NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    /* ------------------------------------------------------------ 保存文件（导出） */

    @JavascriptInterface
    public String saveFile(String base64, String fileName, String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(activity.getCacheDir(), "export");
            if (!dir.exists()) dir.mkdirs();
            File temp = new File(dir, FileSaver.sanitize(fileName));
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(bytes);
            }
            String result = FileSaver.publishToDownloads(activity, temp, FileSaver.sanitize(fileName), mime);
            temp.delete();
            return result;
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "保存失败");
        } catch (OutOfMemoryError e) {
            return "ERROR:文件太大，内存不足";
        }
    }

    @JavascriptInterface
    public String beginSave(String fileName, String mime) {
        try {
            File dir = new File(activity.getCacheDir(), "export");
            if (!dir.exists()) dir.mkdirs();
            String safeName = FileSaver.sanitize(fileName);
            File file = new File(dir, safeName);
            String token = "s" + System.currentTimeMillis() + "_" + (1000 + (int) (Math.random() * 9000));
            saveSessions.put(token, new SaveSession(file, new FileOutputStream(file), safeName, mime));
            return token;
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "无法创建文件");
        }
    }

    @JavascriptInterface
    public String appendChunk(String token, String base64) {
        SaveSession session = saveSessions.get(token);
        if (session == null) return "ERROR:写入会话已失效，请重试";
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            synchronized (session) {
                session.stream.write(bytes);
                session.bytes += bytes.length;
            }
            return "";
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "写入失败");
        }
    }

    @JavascriptInterface
    public String endSave(String token) {
        SaveSession session = saveSessions.remove(token);
        if (session == null) return "ERROR:写入会话已失效，请重试";
        try {
            session.stream.flush();
            session.stream.close();
            return FileSaver.publishToDownloads(activity, session.file, session.fileName, session.mime);
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "保存失败");
        } finally {
            session.file.delete();
        }
    }

    @JavascriptInterface
    public void abortSave(String token) {
        SaveSession session = saveSessions.remove(token);
        if (session == null) return;
        try { session.stream.close(); } catch (Exception ignored) {}
        session.file.delete();
    }

    /* ------------------------------------------------------------ 读取文件（导入） */

    /** 打开系统文件选择器；选定后回调到 JS（广播到所有 frame） */
    @JavascriptInterface
    public void pickFile(String token, String mime) {
        activity.runOnUiThread(() -> activity.openDocumentPicker(token, mime));
    }

    /** 由 Activity 在用户选定文件后调用 */
    public void openPickSession(String token, Uri uri) {
        try {
            ContentResolver resolver = activity.getContentResolver();
            String name = "backup";
            long size = 0L;
            String mime = "application/octet-stream";
            try (CursorLike cursor = query(resolver, uri)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (nameIndex >= 0) {
                        String n = cursor.getString(nameIndex);
                        if (n != null) name = n;
                    }
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex);
                }
            }
            String t = resolver.getType(uri);
            if (t != null) mime = t;
            pickSessions.put(token, new PickSession(uri, name, size, mime));
            String payload = new JSONObject()
                    .put("name", name)
                    .put("size", size)
                    .put("mime", mime)
                    .toString();
            callJs(token, payload);
        } catch (Exception e) {
            notifyPickCancelled(token);
        }
    }

    private interface CursorLike extends AutoCloseable {
        boolean moveToFirst();
        int getColumnIndex(String name);
        String getString(int index);
        long getLong(int index);
        boolean isNull(int index);
        void close();
    }

    private CursorLike query(final ContentResolver resolver, final Uri uri) {
        final android.database.Cursor c = resolver.query(uri, null, null, null, null);
        if (c == null) return null;
        return new CursorLike() {
            @Override public boolean moveToFirst() { return c.moveToFirst(); }
            @Override public int getColumnIndex(String name) { return c.getColumnIndex(name); }
            @Override public String getString(int index) { return c.getString(index); }
            @Override public long getLong(int index) { return c.getLong(index); }
            @Override public boolean isNull(int index) { return c.isNull(index); }
            @Override public void close() { c.close(); }
        };
    }

    public void notifyPickCancelled(String token) {
        callJs(token, "{\"cancelled\":true}");
    }

    @JavascriptInterface
    public String readChunk(String token, int offset, int length) {
        PickSession session = pickSessions.get(token);
        if (session == null) return "";
        try {
            ContentResolver resolver = activity.getContentResolver();
            if (session.stream == null) {
                session.stream = resolver.openInputStream(session.uri);
                session.position = 0;
            }
            InputStream stream = session.stream;
            if (stream == null) return "";
            if (session.position != offset) {
                try { stream.close(); } catch (Exception ignored) {}
                stream = resolver.openInputStream(session.uri);
                if (stream == null) return "";
                session.stream = stream;
                session.position = 0;
                long remain = offset;
                while (remain > 0) {
                    long skipped = stream.skip(remain);
                    if (skipped <= 0) break;
                    remain -= skipped;
                }
                session.position = offset;
            }
            byte[] buffer = new byte[length];
            int read = stream.read(buffer);
            if (read <= 0) return "";
            session.position += read;
            return Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public void closeFile(String token) {
        PickSession session = pickSessions.remove(token);
        if (session == null) return;
        try {
            if (session.stream != null) session.stream.close();
        } catch (Exception ignored) {}
    }

    /* ------------------------------------------------------------ 其它 */

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(activity::finish);
    }

    @JavascriptInterface
    public void toast(String message) {
        activity.toast(message);
    }

    @JavascriptInterface
    public String appVersion() {
        return APP_VERSION;
    }

    @JavascriptInterface
    public String getVersion() {
        return APP_VERSION;
    }

    @JavascriptInterface
    public boolean isNative() {
        return true;
    }

    @JavascriptInterface
    public int safeAreaBottom() {
        return 0; // 手势导航的 bottom inset 由 H5 的 env(safe-area-inset-bottom) 处理
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(Math.max(1, ms));
            }
        } catch (Exception ignored) {}
    }

    public void releaseAll() {
        for (SaveSession s : saveSessions.values()) {
            try { s.stream.close(); } catch (Exception ignored) {}
            s.file.delete();
        }
        saveSessions.clear();
        for (PickSession s : pickSessions.values()) {
            try { if (s.stream != null) s.stream.close(); } catch (Exception ignored) {}
        }
        pickSessions.clear();
    }

    /**
     * 选中文件后广播到主文档与所有同源 iframe：
     * 各模块按自己的回调约定接收（MS.onNativeFilePicked / TF…）。
     */
    private void callJs(String token, String payloadJson) {
        String script =
            "(function(t,p){" +
            " var frames=[window];" +
            " try{for(var i=0;i<window.frames.length;i++)frames.push(window.frames[i]);}catch(e){}" +
            " frames.forEach(function(w){" +
            "  try{" +
            "   if(w.MS && typeof w.MS.onNativeFilePicked==='function') w.MS.onNativeFilePicked(t,p);" +
            "   if(w.MS && w.MS.bridge && typeof w.MS.bridge.onFilePicked==='function') w.MS.bridge.onFilePicked(t,p);" +
            "   if(w.TB && w.TB.files && typeof w.TB.files.onNativeFilePicked==='function') w.TB.files.onNativeFilePicked(t,p);" +
            "   if(w.TravelFootprintBoot && typeof w.TravelFootprintBoot.onFilePicked==='function') w.TravelFootprintBoot.onFilePicked(t,p);" +
            "   if(w.__esaOnFilePicked && typeof w.__esaOnFilePicked==='function') w.__esaOnFilePicked(t,p);" +
            "  }catch(e){}" +
            " });" +
            "})(" + JSONObject.quote(token) + ", " + JSONObject.quote(payloadJson) + ");";
        activity.runOnUiThread(() -> activity.evalJs(script));
    }
}
