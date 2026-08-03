package com.remixmc647.remixnexus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

/**
 * Keeps a Socket.io connection alive while the app is backgrounded so that
 * chat notifications keep arriving without Firebase/FCM. Runs as a
 * foreground service (required by Android for any long-running background
 * work), which means Android requires a persistent, low-priority
 * notification to stay visible the whole time this service is alive.
 *
 * Started/stopped from JS via ChatNotificationPlugin.
 */
public class ChatForegroundService extends Service {

    public static final String CHANNEL_ID_STATUS = "chat_service_status";
    public static final String CHANNEL_ID_MESSAGES = "chat_messages";
    private static final int STATUS_NOTIFICATION_ID = 1001;

    // Intent extras used when starting this service
    public static final String EXTRA_BACKEND_URL = "backendUrl";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_USER_ID = "userId";
    public static final String EXTRA_ROOMS = "rooms"; // JSON array of room id strings

    private Socket socket;
    private String myUserId;
    private int notificationIdCounter = 2000;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL);
        String token = intent.getStringExtra(EXTRA_TOKEN);
        myUserId = intent.getStringExtra(EXTRA_USER_ID);
        String roomsJson = intent.getStringExtra(EXTRA_ROOMS);

        startForeground(STATUS_NOTIFICATION_ID, buildStatusNotification("Connecting…"));
        connectSocket(backendUrl, token, roomsJson);

        // START_STICKY: if Android kills this service to reclaim memory, it
        // will try to restart it automatically (with a null Intent), rather
        // than leaving chat silently disconnected.
        return START_STICKY;
    }

    private void connectSocket(String backendUrl, String token, String roomsJson) {
        try {
            IO.Options options = new IO.Options();
            options.reconnection = true;
            options.reconnectionDelay = 2000;
            options.forceNew = true;

            Map<String, String> auth = new HashMap<>();
            if (token != null) auth.put("token", token);
            options.auth = auth;

            socket = IO.socket(backendUrl, options);

            socket.on(Socket.EVENT_CONNECT, args -> {
                updateStatusNotification("Live — listening for messages");
                subscribeToRooms(roomsJson);
            });

            socket.on(Socket.EVENT_DISCONNECT, args -> updateStatusNotification("Reconnecting…"));
            socket.on(Socket.EVENT_CONNECT_ERROR, args -> updateStatusNotification("Connection error — retrying…"));

            socket.on("chat:message", this::handleIncomingMessage);
            socket.on("dm:message", this::handleIncomingDmMessage);

            socket.connect();
        } catch (URISyntaxException e) {
            updateStatusNotification("Invalid backend URL");
        }
    }

    private void subscribeToRooms(String roomsJson) {
        if (socket == null || roomsJson == null) return;
        try {
            JSONArray rooms = new JSONArray(roomsJson);
            JSONObject payload = new JSONObject();
            payload.put("rooms", rooms);
            socket.emit("chat:subscribeRooms", payload);
        } catch (JSONException ignored) { }
    }

    private final Emitter.Listener handleIncomingMessage = args -> {
        if (args.length == 0) return;
        try {
            JSONObject data = (JSONObject) args[0];
            String room = data.optString("room", "");
            JSONObject message = data.optJSONObject("message");
            if (message == null) return;

            String authorId = message.optString("authorId", null);
            // Don't notify the sender about their own message.
            if (myUserId != null && authorId != null && authorId.equals(myUserId)) return;

            String author = message.optString("author", "Someone");
            String text = message.optString("text", "");
            String preview;
            if (!text.isEmpty()) {
                preview = text.length() > 100 ? text.substring(0, 100) + "…" : text;
            } else if (message.has("audio") && !message.isNull("audio")) {
                preview = "🎤 Voice note";
            } else if (message.has("media") && !message.isNull("media")) {
                JSONObject media = message.optJSONObject("media");
                preview = (media != null && "video".equals(media.optString("type"))) ? "🎬 Video" : "🖼️ Photo";
            } else {
                preview = "New message";
            }

            showMessageNotification(author, room, preview);
        } catch (Exception ignored) { }
    };

    private final Emitter.Listener handleIncomingDmMessage = args -> {
        if (args.length == 0) return;
        try {
            JSONObject payload = (JSONObject) args[0];

            String fromUserId = payload.optString("fromUserId", null);
            // Don't notify ourselves about DMs we sent from another device/tab.
            if (myUserId != null && fromUserId != null && fromUserId.equals(myUserId)) return;

            // Prefer a display name if the server includes one on the payload;
            // fall back gracefully if it doesn't.
            String sender = payload.optString("fromUsername", null);
            if (sender == null || sender.isEmpty()) sender = payload.optString("author", "New message");

            String text = payload.optString("text", "");
            String preview;
            if (!text.isEmpty()) {
                preview = text.length() > 100 ? text.substring(0, 100) + "…" : text;
            } else if (payload.has("audio") && !payload.isNull("audio")) {
                preview = "🎤 Voice note";
            } else if (payload.has("media") && !payload.isNull("media")) {
                JSONObject media = payload.optJSONObject("media");
                preview = (media != null && "video".equals(media.optString("type"))) ? "🎬 Video" : "🖼️ Photo";
            } else {
                preview = "New message";
            }

            showDmNotification(sender, fromUserId, preview);
        } catch (Exception ignored) { }
    };

    private void showDmNotification(String sender, String fromUserId, String preview) {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (openIntent != null) {
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pendingIntent = PendingIntent.getActivity(
                this, ("dm:" + fromUserId).hashCode(), openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_MESSAGES)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(sender)
            .setContentText(preview)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            // Groups by conversation so repeated DMs from the same person
            // replace/stack sensibly instead of flooding the notification shade.
            .setGroup("dm:" + fromUserId);

        if (pendingIntent != null) builder.setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notificationIdCounter++, builder.build());
        }
    }

    private void showMessageNotification(String author, String room, String preview) {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (openIntent != null) {
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pendingIntent = PendingIntent.getActivity(
                this, room.hashCode(), openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_MESSAGES)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(author)
            .setContentText(preview)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            // Groups by room so repeated messages in the same room replace/stack
            // sensibly instead of flooding the notification shade.
            .setGroup("room:" + room);

        if (pendingIntent != null) builder.setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notificationIdCounter++, builder.build());
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel statusChannel = new NotificationChannel(
            CHANNEL_ID_STATUS, "Chat connection status", NotificationManager.IMPORTANCE_MIN
        );
        statusChannel.setDescription("Keeps chat connected in the background");
        manager.createNotificationChannel(statusChannel);

        NotificationChannel messagesChannel = new NotificationChannel(
            CHANNEL_ID_MESSAGES, "New chat messages", NotificationManager.IMPORTANCE_HIGH
        );
        messagesChannel.setDescription("Alerts for new chat messages");
        manager.createNotificationChannel(messagesChannel);
    }

    private Notification buildStatusNotification(String statusText) {
        return new NotificationCompat.Builder(this, CHANNEL_ID_STATUS)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Remix Nexus")
            .setContentText(statusText)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build();
    }

    private void updateStatusNotification(String statusText) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(STATUS_NOTIFICATION_ID, buildStatusNotification(statusText));
        }
    }

    @Override
    public void onDestroy() {
        if (socket != null) {
            socket.disconnect();
            socket.off();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // not a bound service
    }
}
