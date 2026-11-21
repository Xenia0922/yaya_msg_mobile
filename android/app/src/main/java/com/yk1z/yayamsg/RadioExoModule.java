package com.yk1z.yayamsg;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.lang.ref.WeakReference;
import java.util.Map;

public class RadioExoModule extends ReactContextBaseJavaModule {
  private static WeakReference<ReactApplicationContext> contextRef;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  public RadioExoModule(ReactApplicationContext reactContext) {
    super(reactContext);
    contextRef = new WeakReference<>(reactContext);
  }

  @NonNull @Override
  public String getName() { return "RadioExoModule"; }

  static boolean emitJs(Context ctx, String type, Map<String, Object> extra) {
    ReactApplicationContext rc = contextRef == null ? null : contextRef.get();
    if (rc == null || !rc.hasActiveCatalystInstance()) return false;
    WritableMap payload = Arguments.createMap();
    payload.putString("type", type);
    if (extra != null) {
      for (Map.Entry<String, Object> e : extra.entrySet()) {
        Object v = e.getValue();
        if (v instanceof String) payload.putString(e.getKey(), (String) v);
        else if (v instanceof Boolean) payload.putBoolean(e.getKey(), (Boolean) v);
        else if (v instanceof Integer) payload.putInt(e.getKey(), (Integer) v);
        else if (v instanceof Double) payload.putDouble(e.getKey(), (Double) v);
        else if (v instanceof Float) payload.putDouble(e.getKey(), ((Float) v).doubleValue());
        else if (v instanceof Long) payload.putDouble(e.getKey(), ((Long) v).doubleValue());
      }
    }
    try {
      rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("YayaExoEvent", payload);
      return true;
    } catch (Throwable ignored) {
      return false;
    }
  }

  private void send(Intent i) {
    ReactApplicationContext ctx = getReactApplicationContext();
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(i);
      } else {
        ctx.startService(i);
      }
    } catch (Throwable t) {

      android.util.Log.w("RadioExoModule", "start service failed action=" + i.getAction(), t);
    }
  }

  @ReactMethod
  public void playQueue(String queueJson, int index, double positionSec, boolean playing, String headersJson, double volume, int repeat) {
    Intent i = new Intent(getReactApplicationContext(), YayaExoService.class)
        .setAction(YayaExoService.ACTION_PLAY_QUEUE)
        .putExtra("queue", queueJson == null ? "[]" : queueJson)
        .putExtra("index", Math.max(0, index))
        .putExtra("position", positionSec)
        .putExtra("playing", playing)
        .putExtra("headers", headersJson == null ? "{}" : headersJson)
        .putExtra("volume", Math.max(0.0, Math.min(1.0, volume)))
        .putExtra("repeat", Math.max(0, repeat));
    send(i);
  }

  @ReactMethod
  public void control(String cmd, double positionSec) {
    Intent i = new Intent(getReactApplicationContext(), YayaExoService.class)
        .putExtra("cmd", cmd)
        .putExtra("position", positionSec);
    if ("repeat".equals(cmd)) i.putExtra("repeat", (int) positionSec);
    send(i);
  }

  @ReactMethod
  public void getPlaybackSnapshot(Promise promise) {
    mainHandler.post(() -> {
      try {
        Map<String, Object> snapshot = YayaExoService.getPlaybackSnapshot();
        WritableMap result = Arguments.createMap();
        for (Map.Entry<String, Object> e : snapshot.entrySet()) {
          Object v = e.getValue();
          if (v instanceof String) result.putString(e.getKey(), (String) v);
          else if (v instanceof Boolean) result.putBoolean(e.getKey(), (Boolean) v);
          else if (v instanceof Number) result.putDouble(e.getKey(), ((Number) v).doubleValue());
        }
        promise.resolve(result);
      } catch (Throwable t) {
        promise.reject("snapshot_error", t);
      }
    });
  }

  @ReactMethod
  public void setSkipHints(String nextJson, String prevJson) {
    Intent i = new Intent(getReactApplicationContext(), YayaExoService.class)
        .setAction(YayaExoService.ACTION_SET_HINTS)
        .putExtra("next", nextJson == null ? "null" : nextJson)
        .putExtra("prev", prevJson == null ? "null" : prevJson);
    send(i);
  }
}
