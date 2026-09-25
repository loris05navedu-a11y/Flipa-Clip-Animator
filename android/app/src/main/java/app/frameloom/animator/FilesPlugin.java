package app.frameloom.animator;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Saves exported files where the user wants them, without any storage
 * permission:
 *  - saveAs: system "create document" picker (Storage Access Framework);
 *  - saveToGallery: MediaStore (Movies/Frameloom or Pictures/Frameloom),
 *    Android 10+ only.
 * The source is a file previously written by the web layer into the app cache.
 */
@CapacitorPlugin(name = "FrameloomFiles")
public class FilesPlugin extends Plugin {

    private File sourceFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) return null;
        Uri uri = Uri.parse(path);
        File f = new File(uri.getPath() != null ? uri.getPath() : path);
        // Only files from our own cache directory may be exported.
        try {
            String cache = getContext().getCacheDir().getCanonicalPath();
            if (!f.getCanonicalPath().startsWith(cache)) return null;
        } catch (IOException e) {
            return null;
        }
        return f.exists() ? f : null;
    }

    @PluginMethod
    public void saveAs(PluginCall call) {
        if (sourceFile(call) == null) {
            call.reject("missing-source");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "export"));
        startActivityForResult(call, intent, "onSaveAsResult");
    }

    @ActivityCallback
    private void onSaveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject r = new JSObject();
            r.put("saved", false);
            call.resolve(r);
            return;
        }
        final Uri dest = result.getData().getData();
        final File src = sourceFile(call);
        new Thread(() -> {
            try {
                copy(src, dest);
                src.delete();
                JSObject r = new JSObject();
                r.put("saved", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("write-failed", e);
            }
        }).start();
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("unsupported");
            return;
        }
        final File src = sourceFile(call);
        if (src == null) {
            call.reject("missing-source");
            return;
        }
        final String mime = call.getString("mime", "application/octet-stream");
        final String name = call.getString("name", "export");
        new Thread(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            boolean video = mime.startsWith("video/");
            Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Frameloom");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri item = null;
            try {
                item = resolver.insert(collection, values);
                if (item == null) throw new IOException("insert-failed");
                copy(src, item);
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(item, done, null, null);
                src.delete();
                JSObject r = new JSObject();
                r.put("saved", true);
                call.resolve(r);
            } catch (Exception e) {
                if (item != null) resolver.delete(item, null, null);
                call.reject("write-failed", e);
            }
        }).start();
    }

    private void copy(File src, Uri dest) throws IOException {
        try (InputStream in = new FileInputStream(src); OutputStream out = getContext().getContentResolver().openOutputStream(dest, "w")) {
            if (out == null) throw new IOException("no-output");
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }
}
