package com.yk1z.yayamsg;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * 画中画（悬浮窗）控制器。
 * RN 侧通过 NativeModules.PipController 调用：
 *  - setVideoPlaying(true/false)：标记当前是否有视频在播（MainActivity.onUserLeaveHint
 *    据此在用户切后台时自动进入画中画悬浮窗；没有视频在播则不打扰）
 *  - enterPip()：手动进入画中画（播放器控制条"小窗"按钮）
 * 传统桥模块（与 LivePlayerModule 同模式），New Architecture interop 下可用。
 */
public class PipModule extends ReactContextBaseJavaModule {
  /** RN 侧标记当前是否有视频在播：true 时切后台自动进 PiP */
  public static volatile boolean videoPlaying = false;

  public PipModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return "PipController";
  }

  @ReactMethod
  public void setVideoPlaying(boolean playing) {
    videoPlaying = playing;
  }

  /** 手动进入画中画（悬浮窗）：播放器控制条上的"小窗"按钮调用 */
  @ReactMethod
  public void enterPip() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    Activity activity = getCurrentActivity();
    if (activity == null || activity.isDestroyed() || activity.isInPictureInPictureMode()) return;
    try {
      PictureInPictureParams params = new PictureInPictureParams.Builder()
          .setAspectRatio(new Rational(16, 9))
          .build();
      activity.enterPictureInPictureMode(params);
    } catch (Exception ignored) {
      // 部分 ROM 在转场等特定时刻调用会抛异常，静默忽略
    }
  }
}
