package com.yk1z.yayamsg;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.lang.ref.WeakReference;

public class RadioServiceModule extends ReactContextBaseJavaModule {
  private static WeakReference<ReactApplicationContext> contextRef;

  public RadioServiceModule(ReactApplicationContext reactContext) {
    super(reactContext);
    contextRef = new WeakReference<>(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "RadioServiceModule";
  }

  public static void emitStopRequested(Context context) {
    emitControl(context, "stop");
  }

  public static void emitControl(Context context, String action) {
    emitControlWithValue(context, action, 0);
  }

  public static void emitControlWithValue(Context context, String action, double value) {
    ReactApplicationContext reactContext = contextRef == null ? null : contextRef.get();
    if (reactContext == null || !reactContext.hasActiveCatalystInstance()) return;
    WritableMap payload = Arguments.createMap();
    payload.putString("action", action);
    payload.putDouble("value", value);
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit("RadioControlRequested", payload);
  }

  public static boolean favoriteState = false;
  private static java.lang.ref.WeakReference<RadioServiceModule> moduleRef;

  @Override
  public void initialize() {
    moduleRef = new java.lang.ref.WeakReference<>(this);
  }

  @androidx.annotation.Keep
  @ReactMethod
  public void setFavoriteState(boolean active) {
    favoriteState = !!active;
  }

  public static boolean isFavoriteState() {
    return favoriteState;
  }

  @ReactMethod
  public void syncPosition(double position) {
    ReactApplicationContext context = getReactApplicationContext();
    Intent intent = new Intent(context, RadioForegroundService.class);
    intent.putExtra("position", position);
    intent.putExtra("tickOnly", true);

    startServiceSafely(context, intent, false);
  }

  @ReactMethod
  public void updateMedia(String title, String cover, boolean isPlaying, double position, double duration) {
    updateMediaEx(title, cover, "", "", isPlaying, position, duration);
  }

  @ReactMethod
  public void updateMediaEx(String title, String cover, String artist, String album, boolean isPlaying, double position, double duration) {
    ReactApplicationContext context = getReactApplicationContext();
    Intent intent = new Intent(context, RadioForegroundService.class);
    intent.putExtra("title", title == null ? "" : title);
    intent.putExtra("cover", cover == null ? "" : cover);
    intent.putExtra("artist", artist == null ? "" : artist);
    intent.putExtra("album", album == null ? "" : album);
    intent.putExtra("isPlaying", isPlaying);
    intent.putExtra("position", position);
    intent.putExtra("duration", duration);
    startServiceSafely(context, intent, true);
  }

  @ReactMethod
  public void updateLyric(String text) {
    ReactApplicationContext context = getReactApplicationContext();
    Intent intent = new Intent(context, RadioForegroundService.class);
    intent.putExtra("lyric", text == null ? "" : text);
    startServiceSafely(context, intent, true);
  }

  @ReactMethod
  public void begin(String title) {
    updateMedia(title, "", false, 0, 0);
  }

  private static void startServiceSafely(ReactApplicationContext context, Intent intent, boolean foreground) {
    try {
      if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent);
      } else {
        context.startService(intent);
      }
    } catch (Throwable t) {
      android.util.Log.w("RadioServiceModule", "start service failed foreground=" + foreground, t);
    }
  }

  @ReactMethod
  public void end() {
    ReactApplicationContext context = getReactApplicationContext();
    try {
      context.stopService(new Intent(context, RadioForegroundService.class));
    } catch (Throwable t) {
      android.util.Log.w("RadioServiceModule", "stop service failed", t);
    }
  }
}
