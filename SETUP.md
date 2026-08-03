# Background Chat Notifications (no Firebase) — Setup Guide

This adds a foreground service that keeps your socket.io connection alive
while the app is backgrounded, and shows a local notification whenever a
new chat message arrives (skipping your own messages).

## 1. Place the Java files

Copy these two files into your Android project at:

```
android/app/src/main/java/com/remixmc647/remixnexus/ChatForegroundService.java
android/app/src/main/java/com/remixmc647/remixnexus/ChatNotificationPlugin.java
```

(That package path matches your `appId` in `capacitor.config.json`:
`com.remixmc647.remixnexus`. If your actual folder structure differs,
put the files in whatever folder your `MainActivity.java` already lives in.)

## 2. Add the Socket.io Java client dependency

Open `android/app/build.gradle` and add this inside `dependencies { }`:

```gradle
implementation 'io.socket:socket.io-client:2.1.0', {
    exclude group: 'org.json', module: 'json'
}
```

(The exclude avoids a known conflict with Android's built-in `org.json`.)

## 3. Register the plugin

Open `MainActivity.java` (in the same folder as above) and register the
plugin in `onCreate`, **before** `super.onCreate(...)` calls `load()`:

```java
import com.remixmc647.remixnexus.ChatNotificationPlugin;

// inside onCreate, before the existing super.onCreate line:
registerPlugin(ChatNotificationPlugin.class);
```

If your `MainActivity.java` uses the newer Capacitor `BridgeActivity`
pattern with a static plugin list, add `ChatNotificationPlugin.class` to
that list instead.

## 4. Update AndroidManifest.xml

Open `android/app/src/main/AndroidManifest.xml` and add these permissions
just above `<application ...>`:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.INTERNET" />
```

Then, **inside** the `<application>` tag, declare the service:

```xml
<service
    android:name=".ChatForegroundService"
    android:exported="false"
    android:foregroundServiceType="dataSync" />
```

## 5. Add the JS glue file to your web app

Copy `chat-notifications.js` into your project's root (alongside `config.js`,
`rooms.js`, etc.) and include it on every page that has `auth.js` loaded,
right after it:

```html
<script src="./config.js"></script>
<script src="./rooms.js"></script>
<script src="./auth.js"></script>
<script src="./chat-notifications.js"></script>
```

It automatically starts the service on page load if the user is logged in,
and does nothing at all on web/desktop — safe to include everywhere.

Call `stopChatNotifications()` in your logout handler so a signed-out
device stops listening.

## 6. Sync and rebuild

```
npx cap sync android
```

Then rebuild the APK from Android Studio (or your usual build command).

## 7. Test it

1. Install the new build, log in.
2. Send yourself a message from another account/browser.
3. Put the app in the background (press Home, don't kill it).
4. You should get a notification within a couple seconds.

If notifications don't show up:
- Check that you granted the notification permission when prompted
  (Android 13+ requires this explicitly).
- Some phones (Samsung, Xiaomi, Huawei especially) aggressively kill
  background services regardless of foreground-service status — the user
  may need to manually disable battery optimization for your app in
  Settings → Apps → Remix Nexus → Battery → Unrestricted.
- Use `chrome://inspect` or `adb logcat` to check for connection errors
  from the service.

## Known limitations of this approach (vs. FCM)

- Requires a persistent low-priority "Remix Nexus" notification while
  connected (Android requires this for any foreground service — it can't
  be hidden).
- Some OEMs' battery managers may still kill it after extended idle time.
- Slightly more battery use than true push notifications, since it holds
  an open connection rather than being woken on-demand.
