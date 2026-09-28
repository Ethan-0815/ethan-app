package cn.ethan.superapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.content.Context;

import java.io.File;

/**
 * 零依赖的相机输出 Provider（取代 androidx FileProvider）。
 * 相机 App 通过 content://cn.ethan.superapp.camera/camera/photo_xxx.jpg 写入照片，
 * 文件实际落在 cacheDir/camera/ 下。
 */
public class CameraContentProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fileFor(Uri uri) {
        // path 形如 /camera/photo_123.jpg
        String path = uri.getPath();
        if (path == null) return null;
        String rel = path.replaceFirst("^/", "");
        if (rel.isEmpty() || rel.contains("..")) return null;
        return new File(getContext().getCacheDir(), rel);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File file = fileFor(uri);
        if (file == null) throw new java.io.FileNotFoundException("bad uri");
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        int m = ParcelFileDescriptor.parseMode(mode);
        return ParcelFileDescriptor.open(file, m);
    }

    /** 预创建空文件，避免部分相机在写入前先查询大小失败 */
    @Override
    public Uri insert(Uri uri, ContentValues values) {
        File file = fileFor(uri);
        if (file == null) return null;
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        try {
            if (!file.exists()) file.createNewFile();
        } catch (Exception ignored) {}
        return uri;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        File file = fileFor(uri);
        if (file != null && file.exists() && file.delete()) return 1;
        return 0;
    }

    @Override
    public String getType(Uri uri) {
        String p = uri.getPath() == null ? "" : uri.getPath().toLowerCase();
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String[] getStreamTypes(Uri uri, String mimeTypeFilter) {
        return new String[]{getType(uri)};
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    /** 生成可交给相机 App 的输出 URI */
    public static Uri cameraOutputUri(Context context, String fileName) {
        return Uri.parse("content://" + context.getPackageName() + ".camera/camera/" + fileName);
    }
}
