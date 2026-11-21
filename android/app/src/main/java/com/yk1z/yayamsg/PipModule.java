package com.yk1z.yayamsg;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class PipModule extends ReactContextBaseJavaModule {

  private static final String TAG = "YayaPip";

  public static volatile boolean videoPlaying = false;

  public static volatile boolean pipEnabled = false;

  private static volatile boolean compactWindowMode = false;
  private static volatile boolean internalParamsUpdate = false;

  private static volatile float pipAspectW = 16f;
  private static volatile float pipAspectH = 9f;

  public static final String ACTION_PIP_TOGGLE = "yaya.pip.toggle";

  public static final String EVENT_PIP_TOGGLE = "PipToggleCmd";

  public static final String EVENT_PIP_DENIED = "PipDenied";

  private static volatile ReactApplicationContext savedReactContext;
  private static volatile Context savedAppContext;
  private static final Handler main = new Handler(Looper.getMainLooper());
  private final BroadcastReceiver toggleReceiver = new BroadcastReceiver() {
    @Override public void onReceive(Context context, Intent intent) {
      emitToggleToJs();
    }
  };

  public PipModule(ReactApplicationContext reactContext) {
    super(reactContext);
    savedReactContext = reactContext;
    savedAppContext = reactContext.getApplicationContext();
  }

  @NonNull
  @Override
  public String getName() {
    return "PipController";
  }

  @Override
  public void initialize() {
    super.initialize();
    try {
      IntentFilter f = new IntentFilter(ACTION_PIP_TOGGLE);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        savedAppContext.registerReceiver(toggleReceiver, f, Context.RECEIVER_NOT_EXPORTED);
      } else {
        savedAppContext.registerReceiver(toggleReceiver, f);
      }
    } catch (Throwable ignored) {

    }
  }

  @ReactMethod
  public void setVideoPlaying(boolean playing) {
    videoPlaying = playing;
    android.util.Log.i(TAG, "setVideoPlaying=" + playing + " pipEnabled=" + pipEnabled);
    diag("INFO", "setVideoPlaying=" + playing + " pipEnabled=" + pipEnabled);
    refreshPipActions();
  }

  @ReactMethod
  public void setPipEnabled(boolean enabled) {
    pipEnabled = enabled;
    android.util.Log.i(TAG, "setPipEnabled=" + enabled + " videoPlaying=" + videoPlaying);
    diag("INFO", "setPipEnabled=" + enabled + " videoPlaying=" + videoPlaying);
    refreshPipActions();
  }

  @ReactMethod
  public void getNavigationInset(Promise promise) {
    main.post(() -> {
      Activity activity = getCurrentActivity();
      if (activity == null) { promise.resolve(null); return; }
      android.view.WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();
      if (insets == null) { promise.resolve(null); return; }
      int pixels = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
          ? insets.getInsetsIgnoringVisibility(android.view.WindowInsets.Type.navigationBars()).bottom
          : insets.getSystemWindowInsetBottom();
      promise.resolve(pixels / activity.getResources().getDisplayMetrics().density);
    });
  }

  public static Activity getAppActivity() {
    return savedReactContext != null ? savedReactContext.getCurrentActivity() : null;
  }

  public static void setCompactWindowMode(boolean compact) {
    compactWindowMode = compact;
  }

  public static boolean isCompactWindowMode() {
    return compactWindowMode;
  }

  public static boolean isInternalParamsUpdate() {
    return internalParamsUpdate;
  }

  public static void setInternalParamsUpdate(boolean active) {
    internalParamsUpdate = active;
  }

  public static boolean isInPipMode() {
    if (savedReactContext != null) {
      Activity a = savedReactContext.getCurrentActivity();
      if (a != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        return a.isInPictureInPictureMode();
      }
    }
    return false;
  }

  public static boolean canUsePip(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
    try {
      android.app.AppOpsManager ops =
          (android.app.AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
      if (ops == null) return true;
      int mode = ops.checkOpNoThrow(
          android.app.AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
          android.os.Process.myUid(),
          ctx.getPackageName());
      return mode != android.app.AppOpsManager.MODE_IGNORED && mode != android.app.AppOpsManager.MODE_ERRORED;
    } catch (Throwable t) {

      return true;
    }
  }

  public static void diag(String level, String msg) {
    Context ctx = savedReactContext != null ? savedReactContext.getApplicationContext() : null;
    if (ctx != null) NativeDiag.log(ctx, level, "pip", msg);
  }

  public static void emitPipDenied(String reason) {
    android.util.Log.w(TAG, "emitPipDenied reason=" + reason);
    diag("WARN", "emitPipDenied reason=" + reason);
    if (savedReactContext == null) return;
    main.post(() -> {
      try {
        WritableMap m = Arguments.createMap();
        m.putString("reason", reason);
        savedReactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(EVENT_PIP_DENIED, m);
      } catch (Throwable ignored) {}
    });
  }

  @Override
  public void onCatalystInstanceDestroy() {
    try {
      if (savedAppContext != null) savedAppContext.unregisterReceiver(toggleReceiver);
    } catch (Throwable ignored) {}

    savedReactContext = null;
    savedAppContext = null;
    super.onCatalystInstanceDestroy();
  }

  @ReactMethod
  public void setAspectRatio(double w, double h) {
    if (w > 0 && h > 0) {
      float nextW = (float) w;
      float nextH = (float) h;
      if (Math.abs(pipAspectW - nextW) < 0.001f && Math.abs(pipAspectH - nextH) < 0.001f) {
        return;
      }
      pipAspectW = nextW;
      pipAspectH = nextH;
      refreshPipActions();
    }
  }

  @ReactMethod
  public void enterPip() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    main.post(() -> {
      Activity activity = getCurrentActivity();
      if (activity == null || activity.isDestroyed() || activity.isFinishing() || activity.isInPictureInPictureMode()) return;
      if (!canUsePip(activity)) { emitPipDenied("appops"); return; }
      PipOverlayController.setHidden(activity, true);
      emitPipChanged(true);
      try {
        internalParamsUpdate = true;
        try {
          if (activity.enterPictureInPictureMode(buildPipParams(false))) return;
        } finally {
          internalParamsUpdate = false;
        }
      } catch (Exception ignored) {}
      PipOverlayController.setHidden(activity, false);
      emitPipChanged(false);
      emitPipDenied("enter-failed");
    });
  }

  public static void refreshPipActions() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    if (savedReactContext == null) {
      android.util.Log.w(TAG, "refreshPip: savedReactContext=null");
      return;
    }
    final boolean vp = videoPlaying, pe = pipEnabled;
    main.post(() -> {
      try {
        Activity activity = savedReactContext.getCurrentActivity();
        if (activity == null || activity.isDestroyed()) {
          android.util.Log.w(TAG, "refreshPip: activity=" + activity);
          return;
        }
        PictureInPictureParams p = buildPipParams();
        internalParamsUpdate = true;
        try {
          activity.setPictureInPictureParams(p);
        } finally {
          internalParamsUpdate = false;
        }
        android.util.Log.i(TAG, "refreshPip ok autoEnter=" + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && p.isAutoEnterEnabled())
            + " vp=" + vp + " pe=" + pe + " ratio=" + p.getAspectRatio());
        diag("INFO", "refreshPip ok autoEnter=" + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && p.isAutoEnterEnabled())
            + " vp=" + vp + " pe=" + pe + " ratio=" + p.getAspectRatio());
      } catch (Throwable e) {
        android.util.Log.w(TAG, "refreshPip failed: " + e);
      }
    });
  }

  public static PictureInPictureParams buildPipParams() {
    return buildPipParams(videoPlaying && pipEnabled);
  }

  public static PictureInPictureParams buildPipParams(boolean autoEnter) {
    try {
      float ratio = Math.max(0.4185f, Math.min(2.39f, pipAspectW / pipAspectH));
      PictureInPictureParams.Builder b = new PictureInPictureParams.Builder()
          .setAspectRatio(new Rational(Math.round(ratio * 10000), 10000));
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        b.setAutoEnterEnabled(autoEnter);
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        RemoteAction action = buildToggleAction();
        if (action != null) b.setActions(java.util.Collections.singletonList(action));
      }
      return b.build();
    } catch (Exception e) {
      return new PictureInPictureParams.Builder().build();
    }
  }

  private static RemoteAction buildToggleAction() {
    if (savedAppContext == null) return null;
    try {
      int iconRes = videoPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
      String label = videoPlaying ? "pause" : "play";
      Intent intent = new Intent(ACTION_PIP_TOGGLE).setPackage(savedAppContext.getPackageName());
      int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
      PendingIntent pi = PendingIntent.getBroadcast(savedAppContext, 1001, intent, flags);
      return new RemoteAction(Icon.createWithResource(savedAppContext, iconRes), label, label, pi);
    } catch (Throwable t) {
      return null;
    }
  }

  private static void emitToggleToJs() {
    if (savedReactContext == null) return;
    main.post(() -> {
      try {
        WritableMap m = Arguments.createMap();
        m.putBoolean("playing", videoPlaying);
        savedReactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(EVENT_PIP_TOGGLE, m);
      } catch (Throwable ignored) {

      }
    });
  }

  public static final String EVENT_PIP_CHANGED = "PipEnteredChanged";

  public static void emitPipChanged(boolean entered) {
    if (savedReactContext == null) return;
    main.post(() -> {
      try {
        savedReactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(EVENT_PIP_CHANGED, entered);
      } catch (Throwable ignored) {}
    });
  }
}
