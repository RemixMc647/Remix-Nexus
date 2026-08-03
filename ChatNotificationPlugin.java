package com.remixmc647.remixnexus;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-facing bridge for ChatForegroundService. Call from the web app right
 * after login (and again whenever the room list changes) to keep chat
 * notifications flowing while the app is backgrounded or the screen is off.
 *
 * JS usage:
 *   const { ChatNotifications } = Capacitor.Plugins;
 *   await ChatNotifications.start({
 *     backendUrl: BACKEND_URL,
 *     token: AUTH.getToken(),
 *     userId: AUTH.getUser().id,
 *     rooms: DEFAULT_ROOMS.map(r => r.id)
 *   });
 *   // on logout:
 *   await ChatNotifications.stop();
 */
@CapacitorPlugin(name = "ChatNotifications")
public class ChatNotificationPlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 9001;

    @PluginMethod
    public void start(PluginCall call) {
        String backendUrl = call.getString("backendUrl");
        String token = call.getString("token");
        String userId = call.getString("userId");

        if (backendUrl == null || token == null) {
            call.reject("backendUrl and token are required");
            return;
        }

        // Android 13+ requires runtime permission to show any notification
        // at all, including the required foreground-service status one.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST_CODE
                );
            }
        }

        Intent intent = new Intent(getContext(), ChatForegroundService.class);
        intent.putExtra(ChatForegroundService.EXTRA_BACKEND_URL, backendUrl);
        intent.putExtra(ChatForegroundService.EXTRA_TOKEN, token);
        intent.putExtra(ChatForegroundService.EXTRA_USER_ID, userId);
        intent.putExtra(ChatForegroundService.EXTRA_ROOMS, call.getString("rooms", "[]"));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), ChatForegroundService.class);
        getContext().stopService(intent);

        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }
}
