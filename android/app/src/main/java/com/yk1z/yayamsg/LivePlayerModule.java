package com.yk1z.yayamsg;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.lang.ref.WeakReference;

public class LivePlayerModule extends ReactContextBaseJavaModule {
  private static WeakReference<ReactApplicationContext> contextRef;

  public LivePlayerModule(ReactApplicationContext reactContext) {
    super(reactContext);
    contextRef = new WeakReference<>(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "LivePlayerModule";
  }

  public static void emitLiveSize(String url, int width, int height) {
    emitLiveSize(url, width, height, width, height, width > height, false);
  }

  public static void emitLiveSize(
      String url,
      int width,
      int height,
      int visualWidth,
      int visualHeight,
      boolean isLandscape,
      boolean isPillarboxed) {
    ReactApplicationContext context = contextRef == null ? null : contextRef.get();
    if (context == null) return;
    try {
      if (!context.hasActiveCatalystInstance()) return;
      WritableMap payload = Arguments.createMap();
      payload.putString("url", url == null ? "" : url);
      payload.putInt("width", width);
      payload.putInt("height", height);
      payload.putInt("visualWidth", visualWidth > 0 ? visualWidth : width);
      payload.putInt("visualHeight", visualHeight > 0 ? visualHeight : height);
      payload.putBoolean("isLandscape", isLandscape);
      payload.putBoolean("isPillarboxed", isPillarboxed);
      context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("LivePlayer:size", payload);
    } catch (Throwable ignored) {
    }
  }

  public static void emitLiveError(String url, String message) {
    ReactApplicationContext context = contextRef == null ? null : contextRef.get();
    if (context == null) return;
    try {
      if (!context.hasActiveCatalystInstance()) return;
      WritableMap payload = Arguments.createMap();
      payload.putString("url", url == null ? "" : url);
      payload.putString("message", message == null ? "" : message);
      context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("LivePlayer:error", payload);
    } catch (Throwable ignored) {
    }
  }

  @ReactMethod
  public void setImmersive(boolean enabled) {
    Activity activity = getCurrentActivity();
    if (activity == null) return;
    activity.runOnUiThread(() -> {
      Window window = activity.getWindow();
      if (enabled) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          WindowInsetsController controller = window.getInsetsController();
          if (controller != null) {
            controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
          }
        } else {
          window.getDecorView().setSystemUiVisibility(
              View.SYSTEM_UI_FLAG_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                  | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
      } else {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          WindowInsetsController controller = window.getInsetsController();
          if (controller != null) {
            controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
          }
        } else {
          window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
      }
    });
  }
}
