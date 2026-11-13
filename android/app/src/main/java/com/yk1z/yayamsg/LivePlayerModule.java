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

/**
 * 直播相关原生能力（**注意：不再包含旧的全原生播放 Activity**）。
 *
 * 历史：本项目曾有一个完全脱离 RN 的原生直播页 `LivePlayerActivity`（自绘控制条/礼物/旋转），
 * 后来统一播放器（PlayerScreen + LiveExoView）接管了 rtmp/flv 直播，`openNativeLivePlayer`
 * 在 JS 侧已无任何调用者 → 整条 Activity 链路（约 445 行）是死代码，2026-11-07 删除。
 *
 * 保留的部分：
 *  - 静态事件通道 `emitLiveSize` / `emitLiveError`：`LiveExoView` 在 bridgeless 下靠它把
 *    「首帧尺寸 / 重试耗尽」回传给 JS（UIManagerModule 在新架构取不到，View 事件会被丢弃）；
 *  - `setImmersive`：统一播放器全屏时隐藏系统栏（多屏在用）。
 */
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

  /**
   * 直播首帧尺寸 → JS（事件名 LivePlayer:size，payload = {url,width,height}）。
   *
   * 为什么绕到 NativeModule 发事件：LiveExoView 原来经 UIManagerModule 发 View 事件，
   * 而 RN 0.83 只有新架构（bridgeless）时 UIManagerModule 取不到（返回 null）→ 事件静默丢弃，
   * 表现就是「画面已经在播、却一直停在『加载中…』」。
   * NativeModule 的 RCTDeviceEventEmitter 在 bridgeless 下依然可用。
   */
  public static void emitLiveSize(String url, int width, int height) {
    ReactApplicationContext context = contextRef == null ? null : contextRef.get();
    if (context == null) return;
    try {
      if (!context.hasActiveCatalystInstance()) return;
      WritableMap payload = Arguments.createMap();
      payload.putString("url", url == null ? "" : url);
      payload.putInt("width", width);
      payload.putInt("height", height);
      context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("LivePlayer:size", payload);
    } catch (Throwable ignored) {
    }
  }

  /** 直播内核重试耗尽 → JS（事件名 LivePlayer:error，payload = {url,message}） */
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

  /** 全屏时隐藏/恢复系统栏 */
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
