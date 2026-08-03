package com.remixmc647.remixnexus;


import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
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