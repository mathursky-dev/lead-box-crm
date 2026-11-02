package in.leadboxs.wacrm;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CallLog;
import android.provider.MediaStore;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Call tracking bridge for the Lead Box web app (window.Capacitor.Plugins.LeadBoxCalls).
 *
 * "full" build: reads the phone's call log and finds the phone recorder's file for each call.
 * "play" build: no call-log access. Calls started from the CRM (dial) are timed with the phone
 * state (off-hook to idle), so the duration includes ringing time. No recordings.
 *
 * Only call data is handed to the page; the server keeps calls whose number is a CRM customer.
 */
@CapacitorPlugin(
    name = "LeadBoxCalls",
    permissions = {
        @Permission(alias = "phone", strings = { Manifest.permission.READ_PHONE_STATE, Manifest.permission.CALL_PHONE }),
        @Permission(alias = "calllog", strings = { Manifest.permission.READ_CALL_LOG }),
        @Permission(alias = "audio", strings = { "android.permission.READ_MEDIA_AUDIO" }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class LeadBoxCallsPlugin extends Plugin {

    private static boolean isFull() {
        return "full".equals(BuildConfig.FLAVOR);
    }

    private String[] aliases() {
        if (!isFull()) return new String[] { "phone" };
        return new String[] { "phone", "calllog", Build.VERSION.SDK_INT >= 33 ? "audio" : "storage" };
    }

    /** granted only when everything needed for tracking is granted (recording access is optional). */
    private String permissionState() {
        String[] needed = isFull() ? new String[] { "phone", "calllog" } : new String[] { "phone" };
        boolean denied = false;
        for (String a : needed) {
            PermissionState s = getPermissionState(a);
            if (s != PermissionState.GRANTED) {
                if (s == PermissionState.DENIED) denied = true;
                else return "prompt";
            }
        }
        return denied ? "denied" : "granted";
    }

    @Override
    public void load() {
        CallStateTracker.get(getContext()).start();
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("flavor", isFull() ? "full" : "lite");
        r.put("version", BuildConfig.VERSION_NAME);
        r.put("permission", permissionState());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestPermissionForAliases(aliases(), call, "permsDone");
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        CallStateTracker.get(getContext()).start();
        JSObject r = new JSObject();
        r.put("permission", permissionState());
        call.resolve(r);
    }

    /** Places a call. In the play build this also starts timing it. */
    @PluginMethod
    public void dial(PluginCall call) {
        String number = call.getString("number", "");
        if (number == null || !number.matches("^\\+?[0-9]{6,16}$")) {
            call.reject("Invalid number");
            return;
        }
        CallStateTracker.get(getContext()).expect(number);
        boolean canCall = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
        Intent i = new Intent(canCall ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + number));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the dialer", e);
        }
    }

    /** Calls since {since} (epoch ms): [{key, number, direction, startedAt, duration, recording?}] */
    @PluginMethod
    public void getCalls(PluginCall call) {
        final long since = call.getLong("since", System.currentTimeMillis() - 48L * 3600_000L);
        getBridge().execute(() -> {
            try {
                JSArray out = isFull() ? fromCallLog(since) : CallStateTracker.get(getContext()).finishedSince(since);
                JSObject r = new JSObject();
                r.put("calls", out);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject("Call access not allowed", e);
            } catch (Exception e) {
                call.reject("Could not read calls", e);
            }
        });
    }

    private JSArray fromCallLog(long since) {
        JSArray out = new JSArray();
        if (getPermissionState("calllog") != PermissionState.GRANTED) return out;
        boolean media = getPermissionState(Build.VERSION.SDK_INT >= 33 ? "audio" : "storage") == PermissionState.GRANTED;
        List<Recording> recs = media ? recordings(since) : new ArrayList<>();
        ContentResolver cr = getContext().getContentResolver();
        String[] cols = { CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION };
        try (Cursor c = cr.query(CallLog.Calls.CONTENT_URI, cols, CallLog.Calls.DATE + " > ?",
                new String[] { String.valueOf(since) }, CallLog.Calls.DATE + " ASC")) {
            if (c == null) return out;
            int n = 0;
            while (c.moveToNext() && n < 1000) {
                String dir;
                switch (c.getInt(2)) {
                    case CallLog.Calls.OUTGOING_TYPE: dir = "outgoing"; break;
                    case CallLog.Calls.INCOMING_TYPE: dir = "incoming"; break;
                    case CallLog.Calls.MISSED_TYPE: dir = "missed"; break;
                    case CallLog.Calls.REJECTED_TYPE: dir = "rejected"; break;
                    default: continue; // voicemail, blocked, etc.
                }
                String number = c.getString(1);
                if (number == null || number.replaceAll("[^0-9]", "").length() < 6) continue;
                long date = c.getLong(3);
                long dur = c.getLong(4);
                JSObject o = new JSObject();
                o.put("key", "cl:" + c.getLong(0) + ":" + date);
                o.put("number", number);
                o.put("direction", dir);
                o.put("startedAt", date);
                o.put("duration", dur);
                if (dur > 0) {
                    Recording r = match(recs, number, date, dur);
                    if (r != null) {
                        JSObject ro = new JSObject();
                        ro.put("uri", r.uri);
                        ro.put("name", r.name);
                        ro.put("size", r.size);
                        o.put("recording", ro);
                        recs.remove(r);
                    }
                }
                out.put(o);
                n++;
            }
        }
        return out;
    }

    // ---- Recordings made by the phone's own call recorder -------------------------------------

    private static class Recording {
        String uri, name, path;
        long size, addedMs;
    }

    private List<Recording> recordings(long since) {
        List<Recording> list = new ArrayList<>();
        Uri base = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String pathCol = Build.VERSION.SDK_INT >= 29 ? MediaStore.MediaColumns.RELATIVE_PATH : MediaStore.MediaColumns.DATA;
        String[] cols = { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED, pathCol };
        try (Cursor c = getContext().getContentResolver().query(base, cols, MediaStore.MediaColumns.DATE_ADDED + " > ?",
                new String[] { String.valueOf(since / 1000 - 60) }, null)) {
            if (c == null) return list;
            while (c.moveToNext()) {
                Recording r = new Recording();
                r.name = c.getString(1);
                r.size = c.getLong(2);
                r.addedMs = c.getLong(3) * 1000L;
                r.path = c.getString(4) == null ? "" : c.getString(4);
                String hay = (r.path + "/" + r.name).toLowerCase(Locale.ROOT);
                if (!(hay.contains("call") || hay.contains("record"))) continue;
                if (r.size <= 0 || r.size > 50L * 1024 * 1024) continue;
                r.uri = Uri.withAppendedPath(base, String.valueOf(c.getLong(0))).toString();
                list.add(r);
            }
        } catch (Exception ignored) {
            // No media access or an OEM quirk: calls are still saved without recordings.
        }
        return list;
    }

    /** The recorder saves the file when the call ends: pick the closest one, preferring a name with the number. */
    private static Recording match(List<Recording> recs, String number, long start, long durSec) {
        String digits = number.replaceAll("[^0-9]", "");
        String tail = digits.length() > 7 ? digits.substring(digits.length() - 7) : digits;
        long end = start + durSec * 1000L;
        Recording best = null;
        long bestScore = Long.MAX_VALUE;
        for (Recording r : recs) {
            if (r.addedMs < start - 5_000L || r.addedMs > end + 10 * 60_000L) continue;
            long score = Math.abs(r.addedMs - end);
            if (r.name.replaceAll("[^0-9]", "").contains(tail)) score -= 60 * 60_000L; // strong hint
            if (score < bestScore) { bestScore = score; best = r; }
        }
        return best;
    }

    /** PUTs a recording (content:// uri) to a one-time signed upload URL from the CRM. */
    @PluginMethod
    public void uploadFile(PluginCall call) {
        final String uri = call.getString("uri");
        final String url = call.getString("url");
        if (uri == null || url == null || !url.startsWith("https://")) {
            call.reject("Bad upload request");
            return;
        }
        getBridge().execute(() -> {
            HttpURLConnection con = null;
            try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
                if (in == null) throw new IllegalStateException("File not readable");
                String type = getContext().getContentResolver().getType(Uri.parse(uri));
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setRequestMethod("PUT");
                con.setDoOutput(true);
                con.setChunkedStreamingMode(64 * 1024);
                con.setConnectTimeout(20_000);
                con.setReadTimeout(120_000);
                con.setRequestProperty("Content-Type", type != null ? type : "audio/mpeg");
                con.setRequestProperty("x-upsert", "true");
                try (OutputStream os = con.getOutputStream()) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                int status = con.getResponseCode();
                JSObject r = new JSObject();
                r.put("ok", status >= 200 && status < 300);
                r.put("status", status);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Upload failed", e);
            } finally {
                if (con != null) con.disconnect();
            }
        });
    }
}
