package com.yk1z.yayamsg;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheEvictor;
import androidx.media3.datasource.cache.CacheSpan;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@OptIn(markerClass = UnstableApi.class)
public final class MusicCacheManager {
  private static final String PREFS_NAME = "yaya_music_prefs";
  private static final String KEY_LIMIT_MB = "cache_limit_mb";
  private static final String CACHE_DIR_NAME = "yaya_music_cache";
  private static final int DEFAULT_LIMIT_MB = 300;
  private static final int MIN_LIMIT_MB = 100;
  private static final int MAX_LIMIT_MB = 1024;
  private static final long PRECACHE_BYTES = 512L * 1024L;

  private static SimpleCache sCache;
  private static DynamicLruCacheEvictor sEvictor;
  private static final ExecutorService IO_EXECUTOR = Executors.newSingleThreadExecutor();
  private static final ExecutorService PRECACHE_EXECUTOR = Executors.newSingleThreadExecutor();
  private static volatile CacheWriter activePrecacheWriter;
  private static volatile String activePrecacheUrl = "";

  private MusicCacheManager() {}

  private static int clampMb(int mb) {
    if (mb < MIN_LIMIT_MB) return MIN_LIMIT_MB;
    if (mb > MAX_LIMIT_MB) return MAX_LIMIT_MB;
    return mb;
  }

  public static int getLimitMb(Context ctx) {
    try {
      SharedPreferences sp = ctx.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
      return clampMb(sp.getInt(KEY_LIMIT_MB, DEFAULT_LIMIT_MB));
    } catch (Throwable ignored) {
      return DEFAULT_LIMIT_MB;
    }
  }

  public static void setLimitMb(final Context ctx, int mb) {
    final int clamped = clampMb(mb);
    try {
      SharedPreferences sp = ctx.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
      sp.edit().putInt(KEY_LIMIT_MB, clamped).apply();
    } catch (Throwable ignored) {}
    final SimpleCache cache;
    final DynamicLruCacheEvictor evictor;
    synchronized (MusicCacheManager.class) {
      evictor = sEvictor;
      cache = sCache;
    }
    if (evictor != null) {
      evictor.setMaxBytes(clamped * 1024L * 1024L);
      if (cache != null) {
        IO_EXECUTOR.execute(() -> evictor.evictExternal(cache));
      }
    }
  }

  public static synchronized SimpleCache getCache(Context ctx) {
    Context appCtx = ctx.getApplicationContext();
    if (sCache == null) {
      File dir = new File(appCtx.getCacheDir(), CACHE_DIR_NAME);
      if (!dir.exists()) {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
      }
      long maxBytes = getLimitMb(appCtx) * 1024L * 1024L;
      sEvictor = new DynamicLruCacheEvictor(maxBytes);
      sCache = new SimpleCache(dir, sEvictor, new StandaloneDatabaseProvider(appCtx));
    }
    return sCache;
  }

  public static CacheDataSource.Factory buildCacheDataSourceFactory(
      Context ctx,
      Map<String, String> headers) {
    Map<String, String> safeHeaders = headers == null ? new HashMap<>() : new HashMap<>(headers);
    DefaultHttpDataSource.Factory upstream = new DefaultHttpDataSource.Factory()
        .setUserAgent("PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)")
        .setDefaultRequestProperties(safeHeaders)
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(10000)
        .setReadTimeoutMs(15000);
    return new CacheDataSource.Factory()
        .setCache(getCache(ctx))
        .setUpstreamDataSourceFactory(upstream)
        .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
  }

  public static long getUsedBytes(Context ctx) {
    try {
      SimpleCache cache;
      synchronized (MusicCacheManager.class) {
        cache = sCache;
      }
      if (cache != null) {
        return Math.max(0L, cache.getCacheSpace());
      }
      File dir = new File(ctx.getApplicationContext().getCacheDir(), CACHE_DIR_NAME);
      return dirSize(dir);
    } catch (Throwable ignored) {
      return 0L;
    }
  }

  public static long clearCache(Context ctx) {
    cancelPrecache();
    try {
      SimpleCache cache = getCache(ctx);
      ArrayList<String> keys = new ArrayList<>(cache.getKeys());
      for (String key : keys) {
        try {
          cache.removeResource(key);
        } catch (Throwable ignored) {}
      }
      return Math.max(0L, cache.getCacheSpace());
    } catch (Throwable ignored) {
      return getUsedBytes(ctx);
    }
  }

  public static void cancelPrecache() {
    CacheWriter writer = activePrecacheWriter;
    activePrecacheUrl = "";
    activePrecacheWriter = null;
    if (writer != null) {
      try {
        writer.cancel();
      } catch (Throwable ignored) {}
    }
  }

  public static void precacheHeadAsync(
      final Context ctx,
      final String url,
      final Map<String, String> headers) {
    if (url == null || (!url.startsWith("http://") && !url.startsWith("https://"))) return;
    if (url.equals(activePrecacheUrl) && activePrecacheWriter != null) return;
    cancelPrecache();
    final Context appCtx = ctx.getApplicationContext();
    final Map<String, String> copyHeaders = headers == null ? new HashMap<>() : new HashMap<>(headers);
    activePrecacheUrl = url;
    PRECACHE_EXECUTOR.execute(() -> {
      try {
        if (!url.equals(activePrecacheUrl)) return;
        SimpleCache cache = getCache(appCtx);
        long cachedHead = cache.getCachedBytes(url, 0L, PRECACHE_BYTES);
        if (cachedHead >= PRECACHE_BYTES / 2L) return;
        CacheDataSource cds = buildCacheDataSourceFactory(appCtx, copyHeaders).createDataSourceForDownloading();
        DataSpec spec = new DataSpec.Builder()
            .setUri(url)
            .setPosition(0L)
            .setLength(PRECACHE_BYTES)
            .build();
        CacheWriter writer = new CacheWriter(cds, spec, null, null);
        activePrecacheWriter = writer;
        writer.cache();
      } catch (Throwable ignored) {
      } finally {
        if (url.equals(activePrecacheUrl)) {
          activePrecacheWriter = null;
        }
      }
    });
  }

  private static long dirSize(File f) {
    if (f == null || !f.exists()) return 0L;
    if (f.isFile()) return f.length();
    File[] children = f.listFiles();
    if (children == null) return 0L;
    long sum = 0L;
    for (File child : children) {
      sum += dirSize(child);
    }
    return sum;
  }

  private static final class DynamicLruCacheEvictor implements CacheEvictor {
    private final TreeSet<CacheSpan> leastRecentlyUsed;
    private volatile long maxBytes;
    private long currentSize = 0L;

    DynamicLruCacheEvictor(long maxBytes) {
      this.maxBytes = Math.max(0L, maxBytes);
      this.leastRecentlyUsed = new TreeSet<>(DynamicLruCacheEvictor::compareSpans);
    }

    void setMaxBytes(long maxBytes) {
      this.maxBytes = Math.max(0L, maxBytes);
    }

    @Override
    public boolean requiresCacheSpanTouches() {
      return true;
    }

    @Override
    public void onCacheInitialized() {}

    @Override
    public void onStartFile(Cache cache, String key, long position, long length) {
      if (length != C.LENGTH_UNSET) {
        evictInternal(cache, length);
      }
    }

    @Override
    public void onSpanAdded(Cache cache, CacheSpan span) {
      synchronized (leastRecentlyUsed) {
        leastRecentlyUsed.add(span);
        currentSize += span.length;
      }
      evictInternal(cache, 0L);
    }

    @Override
    public void onSpanRemoved(Cache cache, CacheSpan span) {
      synchronized (leastRecentlyUsed) {
        leastRecentlyUsed.remove(span);
        currentSize -= span.length;
        if (currentSize < 0L) currentSize = 0L;
      }
    }

    @Override
    public void onSpanTouched(Cache cache, CacheSpan oldSpan, CacheSpan newSpan) {
      onSpanRemoved(cache, oldSpan);
      onSpanAdded(cache, newSpan);
    }

    void evictExternal(Cache cache) {
      int maxLoops;
      synchronized (leastRecentlyUsed) {
        maxLoops = leastRecentlyUsed.size() + 4;
      }
      for (int i = 0; i < maxLoops; i++) {
        CacheSpan victim;
        synchronized (leastRecentlyUsed) {
          if (currentSize <= maxBytes || leastRecentlyUsed.isEmpty()) return;
          victim = leastRecentlyUsed.first();
        }
        try {
          cache.removeSpan(victim);
        } catch (Throwable ignored) {
          return;
        }
      }
    }

    private void evictInternal(Cache cache, long requiredSpace) {
      int maxLoops;
      synchronized (leastRecentlyUsed) {
        maxLoops = leastRecentlyUsed.size() + 4;
      }
      for (int i = 0; i < maxLoops; i++) {
        CacheSpan victim;
        synchronized (leastRecentlyUsed) {
          if (currentSize + requiredSpace <= maxBytes || leastRecentlyUsed.isEmpty()) return;
          victim = leastRecentlyUsed.first();
        }
        cache.removeSpan(victim);
      }
    }

    private static int compareSpans(CacheSpan lhs, CacheSpan rhs) {
      long delta = lhs.lastTouchTimestamp - rhs.lastTouchTimestamp;
      if (delta == 0L) {
        return lhs.compareTo(rhs);
      }
      return delta < 0L ? -1 : 1;
    }
  }
}
