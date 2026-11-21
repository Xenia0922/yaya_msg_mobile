package com.yk1z.yayamsg;

import android.media.MediaMetadataRetriever;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaProbeModule extends ReactContextBaseJavaModule {
  private static final String NAME = "MediaProbe";

  private final ExecutorService io = Executors.newFixedThreadPool(2);

  public MediaProbeModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getDurationSeconds(String url, ReadableMap headers, Promise promise) {
    final Map<String, String> h = new HashMap<>();
    if (headers != null) {
      try {
        ReadableMapKeySetIterator it = headers.keySetIterator();
        while (it.hasNextKey()) {
          String k = it.nextKey();
          String v = headers.getString(k);
          if (k != null && v != null) h.put(k, v);
        }
      } catch (Throwable ignored) {
      }
    }
    if (url == null || url.isEmpty()) {
      promise.resolve(0d);
      return;
    }
    io.execute(() -> {
      MediaMetadataRetriever retriever = new MediaMetadataRetriever();
      try {
        if (h.isEmpty()) {
          retriever.setDataSource(url);
        } else {
          retriever.setDataSource(url, h);
        }
        String ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
        double seconds = 0d;
        if (ms != null && !ms.isEmpty()) {
          try {
            seconds = Long.parseLong(ms) / 1000d;
          } catch (NumberFormatException ignored) {
          }
        }
        promise.resolve(seconds);
      } catch (Throwable t) {
        promise.reject("EPROBE", t.getMessage() == null ? "probe failed" : t.getMessage());
      } finally {
        try {
          retriever.release();
        } catch (Throwable ignored) {
        }
      }
    });
  }

  @ReactMethod
  public void addListener(String eventName) {
  }

  @ReactMethod
  public void removeListeners(double count) {
  }
}
