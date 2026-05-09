package com.yk1z.yayamsg;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.ArrayList;
import java.lang.ref.WeakReference;

public class LivePlayerModule extends ReactContextBaseJavaModule {
  private static long lastOpenAt = 0L;
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

  public static void requestGiftPanel(String liveId, String acceptUserId) {
    ReactApplicationContext context = contextRef == null ? null : contextRef.get();
    if (context == null || !context.hasActiveCatalystInstance()) return;
    WritableMap payload = Arguments.createMap();
    payload.putString("liveId", liveId == null ? "" : liveId);
    payload.putString("acceptUserId", acceptUserId == null ? "" : acceptUserId);
    context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit("LivePlayerGiftRequested", payload);
  }

  @ReactMethod
  public void open(String url, String title, ReadableMap options) {
    long now = android.os.SystemClock.elapsedRealtime();
    if (now - lastOpenAt < 800L) return;
    lastOpenAt = now;

    ReactApplicationContext context = getReactApplicationContext();
    Intent intent = new Intent(context, LivePlayerActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    intent.putExtra(LivePlayerActivity.EXTRA_URL, url == null ? "" : url.trim());
    intent.putExtra(LivePlayerActivity.EXTRA_TITLE, title == null ? "" : title);
    if (options != null) {
      if (options.hasKey("urls") && !options.isNull("urls")) {
        ReadableArray array = options.getArray("urls");
        ArrayList<String> urls = new ArrayList<>();
        if (array != null) {
          for (int i = 0; i < array.size(); i += 1) {
            String value = array.getString(i);
            if (value != null && !value.trim().isEmpty() && !urls.contains(value.trim())) {
              urls.add(value.trim());
            }
          }
        }
        if (!urls.isEmpty()) intent.putStringArrayListExtra(LivePlayerActivity.EXTRA_URLS, urls);
      }
      if (options.hasKey("liveId") && !options.isNull("liveId")) {
        intent.putExtra(LivePlayerActivity.EXTRA_LIVE_ID, options.getString("liveId"));
      }
      if (options.hasKey("acceptUserId") && !options.isNull("acceptUserId")) {
        intent.putExtra(LivePlayerActivity.EXTRA_ACCEPT_USER_ID, options.getString("acceptUserId"));
      }
    }
    Activity activity = getCurrentActivity();
    if (activity != null) {
      activity.startActivity(intent);
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
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
