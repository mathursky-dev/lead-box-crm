package in.leadboxs.wacrm;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Times calls that the user started from the CRM (play build; no call-log access).
 * dial() -> expect(number); OFFHOOK = call placed; IDLE = call ended. The duration therefore
 * includes ringing time, and a call that was not answered still shows its ringing time.
 * Finished calls are kept in SharedPreferences (last 50) until the page reads them.
 */
public class CallStateTracker {
    private static final String PREFS = "lb_calls";
    private static final long EXPECT_WINDOW_MS = 2 * 60_000L;
    private static CallStateTracker instance;

    private final Context ctx;
    private final SharedPreferences prefs;
    private boolean listening = false;

    private CallStateTracker(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.prefs = this.ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized CallStateTracker get(Context ctx) {
        if (instance == null) instance = new CallStateTracker(ctx);
        return instance;
    }

    /** Remember the number the user is about to call. */
    public synchronized void expect(String number) {
        prefs.edit().putString("pending_number", number).putLong("pending_at", System.currentTimeMillis()).remove("offhook_at").apply();
        start();
    }

    /** Starts listening to call state (needs READ_PHONE_STATE on Android 12+). */
    public synchronized void start() {
        if (listening) return;
        TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
        if (tm == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return;
                tm.registerTelephonyCallback(ContextCompat.getMainExecutor(ctx), new StateCallback());
            } else {
                tm.listen(new LegacyListener(), PhoneStateListener.LISTEN_CALL_STATE);
            }
            listening = true;
        } catch (SecurityException ignored) {
            // Permission not granted yet; start() runs again after the user allows it.
        }
    }

    private class StateCallback extends TelephonyCallback implements TelephonyCallback.CallStateListener {
        @Override public void onCallStateChanged(int state) { onState(state); }
    }

    @SuppressWarnings("deprecation")
    private class LegacyListener extends PhoneStateListener {
        @Override public void onCallStateChanged(int state, String phoneNumber) { onState(state); }
    }

    private synchronized void onState(int state) {
        String number = prefs.getString("pending_number", null);
        long pendingAt = prefs.getLong("pending_at", 0);
        if (number == null) return;
        long now = System.currentTimeMillis();
        if (state == TelephonyManager.CALL_STATE_OFFHOOK) {
            if (!prefs.contains("offhook_at") && now - pendingAt < EXPECT_WINDOW_MS) prefs.edit().putLong("offhook_at", now).apply();
        } else if (state == TelephonyManager.CALL_STATE_IDLE) {
            long offhook = prefs.getLong("offhook_at", 0);
            if (offhook > 0) save(number, offhook, (now - offhook) / 1000L);
            if (offhook > 0 || now - pendingAt > EXPECT_WINDOW_MS) {
                prefs.edit().remove("pending_number").remove("pending_at").remove("offhook_at").apply();
            }
        }
    }

    private void save(String number, long startedAt, long durationSec) {
        try {
            JSONArray list = new JSONArray(prefs.getString("finished", "[]"));
            JSONObject o = new JSONObject();
            o.put("key", "lite:" + startedAt);
            o.put("number", number);
            o.put("direction", "outgoing");
            o.put("startedAt", startedAt);
            o.put("duration", Math.max(0, durationSec));
            list.put(o);
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, list.length() - 50); i < list.length(); i++) trimmed.put(list.get(i));
            prefs.edit().putString("finished", trimmed.toString()).apply();
        } catch (Exception ignored) { }
    }

    public synchronized JSArray finishedSince(long since) {
        JSArray out = new JSArray();
        try {
            JSONArray list = new JSONArray(prefs.getString("finished", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                if (o.getLong("startedAt") > since) out.put(JSObject.fromJSONObject(o));
            }
        } catch (Exception ignored) { }
        return out;
    }
}
