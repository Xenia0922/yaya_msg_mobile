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

/**
 * 媒体时长探测（房间语音/视频消息）。
 *
 * 为什么不用隐藏 Video 探测：每条语音都要起一个 ExoPlayer 实例，同屏几条就会互相抢资源/
 * 半路释放，表现为「有的能显示 7s、有的一直是播放」，而且探测本身有解码开销。
 * 这里直接用 MediaMetadataRetriever 读元数据：单线程池、无解码、失败即是真失败。
 *
 * 服务端语音消息只有 msgTime（实测 candidates={"msgTime":...}），时长只能由客户端解析，
 * 因此这个探测结果需要 JS 侧按 url 缓存复用。
 */
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

  /**
   * 读取媒体时长（秒，浮点；读不到返回 0）。
   * headers 可选（防盗链的 UA/Referer/Origin），与播放器保持一致。
   */
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

  // 供 JS 侧 addListener/removeListeners 契约使用（本模块不发事件）
  @ReactMethod
  public void addListener(String eventName) {
  }

  @ReactMethod
  public void removeListeners(double count) {
  }
}
