package cn.ethan.superapp;

import android.content.Context;
import android.os.Build;
import android.os.Environment;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 把导出文件放进系统「下载」目录。
 * Android 10+ 走 MediaStore（无需存储权限）；9 及以下写公开下载目录（WRITE_EXTERNAL_STORAGE）。
 * 移植自 my-space FileSaver.kt。
 */
public final class FileSaver {

    private static final String FOLDER = "ETHAN";

    private FileSaver() {}

    public static String sanitize(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "ethan-backup.zip";
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    /** 成功返回可读位置（如 下载/ETHAN/xxx.zip），失败返回 ERROR: 开头 */
    public static String publishToDownloads(Context context, File source, String fileName, String mime) {
        String safeName = sanitize(fileName);
        String safeMime = (mime == null || mime.trim().isEmpty()) ? "application/zip" : mime;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return publishWithMediaStore(context, source, safeName, safeMime);
        }
        return publishToPublicFolder(source, safeName);
    }

    private static String publishWithMediaStore(Context context, File source, String fileName, String mime) {
        try {
            android.content.ContentResolver resolver = context.getContentResolver();
            android.content.ContentValues values = new android.content.ContentValues();
            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(android.provider.MediaStore.Downloads.MIME_TYPE, mime);
            values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
            values.put(android.provider.MediaStore.Downloads.IS_PENDING, 1);
            android.net.Uri uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return "ERROR:无法创建文件";
            try {
                try (OutputStream output = resolver.openOutputStream(uri)) {
                    if (output == null) return "ERROR:无法写入文件";
                    try (InputStream input = new FileInputStream(source)) {
                        copy(input, output);
                    }
                }
                values.clear();
                values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return "下载/" + FOLDER + "/" + fileName;
            } catch (Exception e) {
                try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
                return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "保存失败");
            }
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "保存失败");
        }
    }

    @SuppressWarnings("deprecation")
    private static String publishToPublicFolder(File source, String fileName) {
        try {
            File root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File dir = new File(root, FOLDER);
            if (!dir.exists() && !dir.mkdirs()) return "ERROR:无法创建下载目录";
            File target = new File(dir, fileName);
            if (target.exists()) {
                int dot = fileName.lastIndexOf('.');
                String base = dot > 0 ? fileName.substring(0, dot) : fileName;
                String ext = dot > 0 ? fileName.substring(dot) : "";
                target = new File(dir, base + "-" + System.currentTimeMillis() + ext);
            }
            try (InputStream input = new FileInputStream(source)) {
                try (OutputStream output = new FileOutputStream(target)) {
                    copy(input, output);
                }
            }
            return "下载/" + FOLDER + "/" + target.getName();
        } catch (Exception e) {
            return "ERROR:" + (e.getMessage() != null ? e.getMessage() : "保存失败");
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}
