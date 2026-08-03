package com.remixmc647.remixnexus;
// match your actual package name

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Full-screen incoming call UI, launched via setFullScreenIntent() from
 * ChatForegroundService when a "call:invite" socket event arrives.
 *
 * Accept: brings MainActivity to the foreground with an intent extra so the
 * existing JS/WebRTC call layer (RemixCalls.init()) can pick up and answer
 * the call using the socket connection already live in the webview.
 *
 * Decline: handled natively — tells ChatForegroundService to emit
 * "call:decline" directly over its background socket, so this works even
 * if the app's webview isn't running yet.
 */
public class IncomingCallActivity extends AppCompatActivity {

    private String callId;
    private String callerUserId;
    private String callerName;
    private String callType;

    private final BroadcastReceiver callEndedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String endedCallId = intent.getStringExtra("callId");
            if (callId != null && callId.equals(endedCallId)) {
                // Caller hung up before we answered — close this screen.
                finish();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

        setContentView(R.layout.activity_incoming_call);

        callerName = getIntent().getStringExtra("callerName");
        callId = getIntent().getStringExtra("callId");
        callerUserId = getIntent().getStringExtra("callerUserId");
        callType = getIntent().getStringExtra("callType");

        TextView callerNameView = findViewById(R.id.callerName);
        callerNameView.setText(callerName != null ? callerName : "Unknown");

        TextView callStatusView = findViewById(R.id.callStatus);
        callStatusView.setText("video".equals(callType) ? "Remix Nexus video call" : "Remix Nexus voice call");

        findViewById(R.id.acceptButton).setOnClickListener(v -> acceptCall());
        findViewById(R.id.declineButton).setOnClickListener(v -> declineCall());

        // Register locally rather than sendBroadcast/registerReceiver globally,
        // since this only needs to hear from our own ChatForegroundService.
        LocalBroadcastManager.getInstance(this).registerReceiver(
                callEndedReceiver, new IntentFilter("com.remixmc647.remixnexus.CALL_ENDED")
        );
    }

    private void acceptCall() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent != null) {
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            launchIntent.putExtra("action", "accept_call");
            launchIntent.putExtra("callId", callId);
            launchIntent.putExtra("callerUserId", callerUserId);
            launchIntent.putExtra("callType", callType);
            startActivity(launchIntent);
        }
        finish();
    }

    private void declineCall() {
        Intent declineIntent = new Intent(this, ChatForegroundService.class);
        declineIntent.setAction(ChatForegroundService.ACTION_DECLINE_CALL);
        declineIntent.putExtra(ChatForegroundService.EXTRA_CALL_ID, callId);
        declineIntent.putExtra(ChatForegroundService.EXTRA_TO_USER_ID, callerUserId);
        startService(declineIntent);

        // Also tell MainActivity's webview (if it's alive in the background,
        // even just stopped rather than destroyed) to clear its own pending-
        // call state — without bringing the app to the foreground, since the
        // decline above already reached the server via the native socket.
        Intent syncIntent = new Intent("com.remixmc647.remixnexus.CALL_DECLINED_NATIVELY");
        syncIntent.putExtra("callId", callId);
        LocalBroadcastManager.getInstance(this).sendBroadcast(syncIntent);

        finish();
    }

    @Override
    protected void onDestroy() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(callEndedReceiver);
        super.onDestroy();
    }
}