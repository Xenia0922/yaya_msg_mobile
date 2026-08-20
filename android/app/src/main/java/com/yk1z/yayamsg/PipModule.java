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
  /** PiP 窗口宽高比（跟随视频内容，默认 16:9；竖屏视频切后台悬浮窗也是竖的） */
  private static volatile float pipAspectW = 16f;
  private static volatile float pipAspectH = 9f;

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

  /** 更新 PiP 窗口比例（RN 侧 onLoad 拿 naturalSize 后传入，竖屏内容竖屏悬浮窗） */
  @ReactMethod
  public void setAspectRatio(double w, double h) {
    if (w > 0 && h > 0) {
      pipAspectW = (float) w;
      pipAspectH = (float) h;
    }
  }

  /** 构建 PiP 参数（比例跟随内容） */
  public static PictureInPictureParams buildPipParams() {
    try {
      return new PictureInPictureParams.Builder()
          .setAspectRatio(new Rational(Math.round(pipAspectW), Math.round(pipAspectH)))
          .build();
    } catch (Exception e) {
      return new PictureInPictureParams.Builder().build();
    }
  }

  /** 手动进入画中画（悬浮窗）：播放器控制条上的"小窗"按钮调用 */
  @ReactMethod
  public void enterPip() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    Activity activity = getCurrentActivity();
    if (activity == null || activity.isDestroyed() || activity.isInPictureInPictureMode()) return;
    try {
      activity.enterPictureInPictureMode(buildPipParams());
    } catch (Exception ignored) {
      // 部分 ROM 在转场等特定时刻调用会抛异常，静默忽略
    }
  }
}
