package com.remixmc647.remixnexus;


import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.BridgeActivity;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

public class MainActivity extends BridgeActivity {

    private final BroadcastReceiver callDeclinedNativelyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Just syncs calls.js's local state — the actual "call:decline"
            // was already emitted straight to the server from
            // ChatForegroundService, so this must NOT re-emit anything.
            bridge.getWebView().post(() ->
                    bridge.getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('nativeDeclineCall'));", null
                    )
            );
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerPlugin(ChatNotificationPlugin.class);

        LocalBroadcastManager.getInstance(this).registerReceiver(
                callDeclinedNativelyReceiver,
                new IntentFilter("com.remixmc647.remixnexus.CALL_DECLINED_NATIVELY")
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    "incoming_calls",
                    "Incoming Calls",
                    NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("Alerts for incoming voice/video calls");
            channel.enableVibration(true);

            getSystemService(NotificationManager.class)
                    .createNotificationChannel(channel);
        }

        requestIgnoreBatteryOptimizations();
        requestFullScreenIntentPermissionIfNeeded();
    }

    /**
     * Without this, Android's Doze mode can suspend ChatForegroundService's
     * socket connection after the screen has been off for a while, meaning
     * "call:invite" never even reaches the device — the full-screen popup
     * code never gets a chance to run because it never fires. This asks the
     * user to exempt the app once; if they decline, calls may not wake a
     * long-locked device reliably.
     */
    private void requestIgnoreBatteryOptimizations() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception ignored) {
                // Some OEM ROMs block this intent; nothing more we can do here.
            }
        }
    }

    /**
     * Android 14+ (API 34) requires explicit user opt-in for apps to use
     * setFullScreenIntent(), separate from declaring the manifest permission.
     * Without this, incoming-call notifications silently downgrade to a
     * normal heads-up notification instead of popping the full-screen UI
     * over the lock screen.
     */
    private void requestFullScreenIntentPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 34) return; // UPSIDE_DOWN_CAKE
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && !manager.canUseFullScreenIntent()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception ignored) {
                // Some OEM ROMs may not expose this settings screen.
            }
        }
    }

    @Override
    public void onDestroy() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(callDeclinedNativelyReceiver);
        super.onDestroy();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        handleCallIntent(getIntent());
    }

    /**
     * Catches the "accept_call" extra sent by IncomingCallActivity when the
     * user taps Accept on the full-screen call notification, and forwards
     * a bare "nativeAcceptCall" CustomEvent into the webview. calls.js
     * already tracks the pending call itself (its own socket connection
     * receives "call:invite" independently), so acceptCurrentIncoming()
     * resolves whichever call is currently pending — no call details need
     * to be passed through this native layer.
     */
    private void handleCallIntent(Intent intent) {
        if (intent == null || !"accept_call".equals(intent.getStringExtra("action"))) return;

        bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('nativeAcceptCall'));", null
                )
        );

        // Clear the extra so it doesn't refire on rotation/resume.
        intent.removeExtra("action");
    }
}
