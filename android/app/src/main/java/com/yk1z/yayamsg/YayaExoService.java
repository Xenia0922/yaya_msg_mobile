package com.yk1z.yayamsg;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.core.app.ServiceCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@OptIn(markerClass = UnstableApi.class)
public class YayaExoService extends Service {
  public static final String ACTION_PLAY_QUEUE = "yaya.exo.play_queue";
  public static final String ACTION_REASSERT = "yaya.exo.reassert";
  public static final String ACTION_SET_HINTS = "yaya.exo.set_hints";
  public static final String ACTION_UPDATE_ART = "yaya.exo.update_art";

  public static volatile boolean serviceAlive = false;
  private static volatile YayaExoService runningInstance;
  public static volatile boolean musicActuallyPlaying = false;

  private static final String CHANNEL_ID = "yaya_radio_v3";
  private static final int NOTIFICATION_ID = 2024;
  private static final int ART_MAX_DIM = 512;
  private static final Handler h = new Handler(Looper.getMainLooper());

  private final Map<String, String> currentHeaders = new HashMap<>();
  private ExoPlayer exo;
  private MediaSession session;
  private boolean pollRunning = false;
  private boolean isForegroundStarted = false;
  private int currentRepeat = Player.REPEAT_MODE_OFF;
  private float currentSpeed = 1.0f;
  private int currentQueueIndex = -1;

  private long lastEmitPosMs = Long.MIN_VALUE;
  private long lastEmitBufferedMs = Long.MIN_VALUE;
  private long lastEmitDurationMs = Long.MIN_VALUE;
  private boolean lastEmitPlaying = false;
  private boolean lastEmitBuffering = false;
  private int lastEmitIndex = Integer.MIN_VALUE;
  private float lastEmitSpeed = -1f;

  private String title = "";
  private String lastTrackUrl = "";
  private String lastTrackId = "";
  private String artist = "";
  private String album = "";
  private String artPath = "";
  private Bitmap artBitmap;
  private int artGeneration = 0;

  private final ExecutorService artLoader = Executors.newSingleThreadExecutor();
  private volatile String artRequestUrl = "";

  private final Map<String, TrackMeta> queueMeta = new HashMap<>();
  private String lastMetaSig = "";
  private String lastNotifySig = "";
  private long lastPushStateTimeMs = 0L;
  private int lastPushedState = -1;
  private PendingIntent cachedContentPi;

  private String nextUrl = "", nextTrackId = "", nextTitle = "", nextArtist = "", nextAlbum = "", nextArt = "";
  private String prevUrl = "", prevTrackId = "", prevTitle = "", prevArtist = "", prevAlbum = "", prevArt = "";
  private int nextIndexHint = -1, prevIndexHint = -1;

  private static class TrackMeta {
    final String url;
    final String trackId;
    final String title;
    final String artist;
    final String album;
    final String art;
    final int queueIndex;
    final float volume;

    TrackMeta(
        String url,
        String trackId,
        String title,
        String artist,
        String album,
        String art,
        int queueIndex,
        float volume) {
      this.url = url == null ? "" : url;
      this.trackId = trackId == null ? "" : trackId;
      this.title = title == null ? "" : title;
      this.artist = artist == null ? "" : artist;
      this.album = album == null ? "" : album;
      this.art = art == null ? "" : art;
      this.queueIndex = queueIndex;
      this.volume = volume > 0f && volume <= 1.0f ? volume : 1.0f;
    }

    String mediaKey() {
      return trackId + "|" + queueIndex;
    }
  }

  private final Runnable progressPoller = new Runnable() {
    @Override
    public void run() {
      if (exo == null) {
        pollRunning = false;
        return;
      }
      boolean playing = isPlaying();
      boolean buffering = exo.getPlaybackState() == Player.STATE_BUFFERING;
      emitProgress();
      long now = android.os.SystemClock.elapsedRealtime();
      if (playing || buffering || now - lastPushStateTimeMs >= 1500L) {
        pushState();
      }
      h.postDelayed(this, (playing || buffering) ? 500L : 1500L);
    }
  };

  private final Player.Listener playerListener = new Player.Listener() {
    @Override
    public void onPlaybackStateChanged(int state) {
      if (state == Player.STATE_ENDED) {
        musicActuallyPlaying = false;
        RadioExoModule.emitJs(getApplicationContext(), "ended", null);
      } else {
        musicActuallyPlaying = isPlaying();
      }
      emitProgress();
      pushState();
      if (state == Player.STATE_READY || state == Player.STATE_ENDED) {
        updateNotification(false);
        if (state == Player.STATE_READY) {
          precacheNextInPlayer();
        }
      }
    }

    @Override
    public void onMediaItemTransition(@Nullable MediaItem m, int reason) {
      TrackMeta meta = metaForMediaItem(m);
      if (meta != null) {
        applyTrackMeta(meta);
        if (exo != null) {
          exo.setVolume(meta.volume);
        }
      } else {
        String url = currentMediaUrl();
        if (url != null) {
          lastTrackUrl = url;
          lastTrackId = "";
        }
      }
      precacheNextInPlayer();
      emitProgress();
      pushState();
      updateNotification(true);

      if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
        Map<String, Object> ev = new HashMap<>();
        ev.put("reason", reason);
        ev.put("index", currentQueueIndex);
        ev.put("url", lastTrackUrl);
        ev.put("trackId", lastTrackId);
        ev.put("title", title);
        ev.put("artist", artist);
        ev.put("album", album);
        RadioExoModule.emitJs(getApplicationContext(), "track_changed", ev);
      }
    }

    @Override
    public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
      musicActuallyPlaying = playWhenReady && exo != null && exo.getPlaybackState() != Player.STATE_ENDED;
      emitProgress();
      pushState();
      updateNotification(true);
    }

    @Override
    public void onPlayerError(PlaybackException error) {
      musicActuallyPlaying = false;
      Map<String, Object> extra = new HashMap<>();
      extra.put("message", String.valueOf(error.getMessage()));
      extra.put("errorCode", error.errorCode);
      extra.put("trackId", lastTrackId);
      extra.put("url", lastTrackUrl);
      extra.put("index", currentQueueIndex);
      RadioExoModule.emitJs(getApplicationContext(), "track_error", extra);
      emitProgress();
      pushState();
      updateNotification(false);
    }
  };

  @Nullable
  private TrackMeta metaForMediaItem(@Nullable MediaItem m) {
    if (m != null && m.localConfiguration != null && m.localConfiguration.tag instanceof TrackMeta) {
      return (TrackMeta) m.localConfiguration.tag;
    }
    String url = mediaUrlOf(m);
    return url == null ? null : queueMeta.get(url);
  }

  private void precacheNextInPlayer() {
    if (exo == null || currentRepeat == Player.REPEAT_MODE_ONE) return;
    if (!exo.hasNextMediaItem()) return;
    int nextIdx = exo.getNextMediaItemIndex();
    if (nextIdx < 0 || nextIdx >= exo.getMediaItemCount()) return;
    String nextUri = mediaUrlOf(exo.getMediaItemAt(nextIdx));
    if (nextUri != null && !nextUri.isEmpty()) {
      MusicCacheManager.precacheHeadAsync(getApplicationContext(), nextUri, currentHeaders);
    }
  }

  private void stopServiceCleanly() {
    stopPolling();
    MusicCacheManager.cancelPrecache();
    musicActuallyPlaying = false;
    isForegroundStarted = false;
    destroySession();
    if (exo != null) {
      try { exo.stop(); exo.clearMediaItems(); } catch (Throwable ignored) {}
      try { exo.release(); } catch (Throwable ignored) {}
      exo = null;
    }
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (Throwable ignored) {}
    try { stopSelf(); } catch (Throwable ignored) {}
  }

  private static boolean needsPocketReferer(String url) {
    if (url == null || url.isEmpty()) return false;
    try {
      String host = android.net.Uri.parse(url).getHost();
      if (host == null) return false;
      String lower = host.toLowerCase(java.util.Locale.ROOT);
      return lower.endsWith(".48.cn") || "snh48.com".equals(lower) || lower.endsWith(".snh48.com");
    } catch (Throwable ignored) {
      return false;
    }
  }

  @Nullable
  private static byte[] fetchImageBytes(String urlStr, boolean sendReferer) {
    String current = urlStr;
    for (int hops = 0; hops < 4 && current != null && !current.isEmpty(); hops++) {
      java.net.HttpURLConnection conn = null;
      try {
        java.net.URL u = new java.net.URL(current);
        conn = (java.net.HttpURLConnection) u.openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setRequestProperty("User-Agent", "PocketFans201807/7.1.43 (Android)");
        if (sendReferer) {
          conn.setRequestProperty("Referer", "https://h5.48.cn/");
        }
        int code = conn.getResponseCode();
        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
          String loc = conn.getHeaderField("Location");
          if (loc == null || loc.isEmpty()) return null;
          current = new java.net.URL(u, loc).toString();
          continue;
        }
        if (code / 100 != 2) {
          Log.w("YayaExo", "downloadArt HTTP " + code + " url=" + current);
          return null;
        }
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        java.io.InputStream in = conn.getInputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        byte[] data = bos.toByteArray();
        return data.length > 0 ? data : null;
      } catch (Throwable t) {
        Log.w("YayaExo", "downloadArt error url=" + current + " msg=" + t.getMessage());
        return null;
      } finally {
        try { if (conn != null) conn.disconnect(); } catch (Throwable ignored) {}
      }
    }
    return null;
  }

  private void downloadArt(final String url) {
    if (url == null || url.isEmpty()) return;
    artRequestUrl = url;
    try {
      artLoader.execute(() -> {
        if (!url.equals(artRequestUrl) || !url.equals(artPath)) return;
        boolean useRef = needsPocketReferer(url);
        byte[] data = fetchImageBytes(url, useRef);
        if (data == null && useRef) {
          data = fetchImageBytes(url, false);
        }
        if (data == null) {
          Log.w("YayaExo", "downloadArt failed url=" + url);
          return;
        }
        if (!url.equals(artRequestUrl) || !url.equals(artPath)) return;
        final Bitmap bmp = decodeSampled(data, ART_MAX_DIM);
        if (bmp == null) {
          Log.w("YayaExo", "downloadArt decode null url=" + url);
          return;
        }
        h.post(() -> {
          if (!url.equals(artPath) || !url.equals(artRequestUrl)) {
            return;
          }
          artBitmap = bmp;
          artGeneration += 1;
          lastMetaSig = "";
          pushState();
          updateNotification(true);
        });
      });
    } catch (Throwable ignored) {}
  }

  private Bitmap decodeSampledFile(String path) {
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(path, bounds);
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inSampleSize = calcInSampleSize(bounds.outWidth, bounds.outHeight, ART_MAX_DIM);
      return BitmapFactory.decodeFile(path, opts);
    } catch (Throwable t) {
      return null;
    }
  }

  private static Bitmap decodeSampled(byte[] data, int maxDim) {
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inSampleSize = calcInSampleSize(bounds.outWidth, bounds.outHeight, maxDim);
      return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
    } catch (Throwable t) {
      return null;
    }
  }

  private static int calcInSampleSize(int width, int height, int maxDim) {
    int sample = 1;
    int longest = Math.max(width, height);
    while (longest / sample > maxDim) sample *= 2;
    return sample;
  }

  private void applyTrackMeta(TrackMeta meta) {
    if (meta == null) return;
    boolean trackChanged = !meta.url.equals(lastTrackUrl) || !meta.trackId.equals(lastTrackId);
    title = meta.title;
    artist = meta.artist;
    album = meta.album;
    lastTrackUrl = meta.url;
    lastTrackId = meta.trackId;
    if (meta.queueIndex >= 0) {
      currentQueueIndex = meta.queueIndex;
    }
    if (!meta.art.isEmpty()) {
      if (!meta.art.equals(artPath)) {
        artPath = meta.art;
        artRequestUrl = "";
        clearArt();
        if (artPath.startsWith("file://")) {
          artBitmap = decodeSampledFile(artPath.substring("file://".length()));
          artGeneration += 1;
          lastMetaSig = "";
        } else if (artPath.startsWith("http")) {
          downloadArt(artPath);
        }
      }
    } else if (trackChanged && !artPath.isEmpty()) {
      artPath = "";
      artRequestUrl = "";
      clearArt();
      lastMetaSig = "";
    }
  }

  private void clearArt() {
    artBitmap = null;
    artGeneration += 1;
  }

  private static Map<String, Object> mapOf(String k, String v) {
    Map<String, Object> m = new HashMap<>();
    m.put(k, v);
    return m;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    serviceAlive = true;
    runningInstance = this;
    ensureChannel();
  }

  public static void refreshSessionState() {
    h.post(() -> {
      YayaExoService s = runningInstance;
      if (s == null || s.exo == null) return;
      s.pushState();
      s.updateNotification(true);
    });
  }

  public static Map<String, Object> getPlaybackSnapshot() {
    Map<String, Object> result = new HashMap<>();
    YayaExoService s = runningInstance;
    boolean active = s != null && s.exo != null && s.exo.getCurrentMediaItem() != null;
    result.put("active", active);
    if (!active) return result;
    String curUrl = s.currentMediaUrl();
    result.put("url", curUrl == null ? "" : curUrl);
    result.put("trackId", s.lastTrackId == null ? "" : s.lastTrackId);
    result.put("title", s.title == null ? "" : s.title);
    result.put("artist", s.artist == null ? "" : s.artist);
    result.put("album", s.album == null ? "" : s.album);
    result.put("position", Math.max(0L, s.exo.getCurrentPosition()) / 1000.0);
    result.put("buffered", Math.max(0L, s.exo.getBufferedPosition()) / 1000.0);
    result.put("buffering", s.exo.getPlaybackState() == Player.STATE_BUFFERING);
    long duration = s.exo.getDuration();
    result.put("duration", duration > 0 ? duration / 1000.0 : 0.0);
    result.put("playing", s.exo.getPlayWhenReady() && s.exo.getPlaybackState() != Player.STATE_ENDED);
    result.put("speed", (double) s.currentSpeed);
    result.put("queueIndex", s.currentQueueIndex >= 0 ? s.currentQueueIndex : s.exo.getCurrentMediaItemIndex());
    return result;
  }

  private void ensureChannel() {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
      NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "后台播放", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("播放音乐/电台时保持后台运行");
      ch.setSound(null, null);
      ch.enableVibration(false);
      getSystemService(NotificationManager.class).createNotificationChannel(ch);
    } catch (Throwable ignored) {}
  }

  private boolean ensurePlayer(Map<String, String> headers) {
    if (headers != null && headers.equals(currentHeaders) && exo != null) return true;
    stopPolling();
    destroySession();
    if (exo != null) {
      try { exo.release(); } catch (Throwable ignored) {}
      exo = null;
    }
    currentHeaders.clear();
    if (headers != null) currentHeaders.putAll(headers);

    try {
      DataSource.Factory ds = MusicCacheManager.buildCacheDataSourceFactory(this, currentHeaders);
      DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
          .setConstantBitrateSeekingEnabled(true)
          .setConstantBitrateSeekingAlwaysEnabled(true);
      exo = new ExoPlayer.Builder(this, new DefaultMediaSourceFactory(ds, extractors))
          .setRenderersFactory(new DefaultRenderersFactory(this)
              .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER))
          .setAudioAttributes(new AudioAttributes.Builder()
              .setUsage(C.USAGE_MEDIA)
              .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
              .build(), true)
          .setWakeMode(C.WAKE_MODE_NETWORK)
          .build();
      exo.setHandleAudioBecomingNoisy(true);
      exo.setPlaybackSpeed(currentSpeed);
      exo.addListener(playerListener);

      session = new MediaSession(this, "yaya-music");
      session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
      session.setMediaButtonReceiver(
          PendingIntent.getBroadcast(this, 200,
              new Intent(this, MediaButtonProxyReceiver.class).setAction(Intent.ACTION_MEDIA_BUTTON),
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
      session.setCallback(new MediaSession.Callback() {
        @Override
        public void onPlay() {
          if (exo != null) {
            if (exo.getPlaybackState() == Player.STATE_ENDED) {
              exo.seekTo(0);
            }
            if (exo.getPlaybackState() == Player.STATE_IDLE || exo.getPlaybackState() == Player.STATE_ENDED) {
              exo.prepare();
            }
            exo.play();
            startPolling();
            pushState();
            updateNotification(true);
          }
        }

        @Override
        public void onPause() {
          if (exo != null) {
            exo.pause();
            pushState();
            updateNotification(true);
          }
        }

        @Override
        public void onSkipToNext() {
          skipNextOrFallback();
        }

        @Override
        public void onSkipToPrevious() {
          skipPrevOrFallback();
        }

        @Override
        public void onSeekTo(long pos) {
          if (exo != null) {
            exo.seekTo(Math.max(0L, pos));
            emitProgress();
            pushState();
          }
        }

        @Override
        public void onStop() {
          if (exo != null) {
            exo.pause();
            pushState();
            updateNotification(true);
          }
        }

        @Override
        public void onCustomAction(String action, android.os.Bundle args) {
          handleCustom(action);
        }
      });
      session.setActive(true);

      if (artPath != null && artPath.startsWith("file://")) {
        clearArt();
        artBitmap = decodeSampledFile(artPath.substring("file://".length()));
      }
      lastEmitPosMs = Long.MIN_VALUE;
      lastEmitBufferedMs = Long.MIN_VALUE;
      lastEmitDurationMs = Long.MIN_VALUE;
      lastEmitPlaying = false;
      lastEmitBuffering = false;
      lastEmitIndex = Integer.MIN_VALUE;
      lastEmitSpeed = -1f;
      pushState();
      return true;
    } catch (Throwable t) {
      Map<String, Object> extra = new HashMap<>();
      extra.put("message", "engine init err " + t.getMessage());
      RadioExoModule.emitJs(getApplicationContext(), "error", extra);
      stopServiceCleanly();
      return false;
    }
  }

  private void skipNextOrFallback() {
    if (exo == null) return;
    if (exo.hasNextMediaItem()) {
      exo.seekToNextMediaItem();
      exo.play();
      startPolling();
      return;
    }
    localSkip(true);
  }

  private void skipPrevOrFallback() {
    if (exo == null) return;
    if (exo.hasPreviousMediaItem()) {
      exo.seekToPreviousMediaItem();
      exo.play();
      startPolling();
      return;
    }
    localSkip(false);
  }

  private void handleCustom(String action) {
    Log.i("YayaExo", "CMD custom " + action);
    if (action == null || action.isEmpty()) return;
    RadioServiceModule.emitControl(getApplicationContext(), action);
  }

  private void destroySession() {
    if (session != null) {
      try { session.setActive(false); } catch (Throwable ignored) {}
      try { session.release(); } catch (Throwable ignored) {}
      session = null;
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) return START_NOT_STICKY;

    ensureChannel();
    if (!isForegroundStarted || exo == null) {
      try {
        Notification fg = exo != null && !title.isEmpty() ? buildNotification() : minimalFg();
        if (fg == null) fg = minimalFg();
        if (fg != null) {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, fg, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
          isForegroundStarted = true;
        }
      } catch (Throwable ignored) {}
    }

    String action = intent.getAction();
    if (ACTION_PLAY_QUEUE.equals(action)) {
      try {
        String hJson = intent.getStringExtra("headers");
        Map<String, String> nh = new HashMap<>();
        if (hJson != null && !hJson.isEmpty()) {
          JSONObject jo = new JSONObject(hJson);
          java.util.Iterator<String> it = jo.keys();
          while (it.hasNext()) {
            String k = it.next();
            nh.put(k, jo.optString(k, ""));
          }
        }
        if (!ensurePlayer(nh)) return START_NOT_STICKY;

        String queueJson = intent.getStringExtra("queue");
        int index = Math.max(0, intent.getIntExtra("index", 0));
        long posMs = (long) (intent.getDoubleExtra("position", 0) * 1000);
        boolean playing = intent.getBooleanExtra("playing", true);
        boolean forceReload = intent.getBooleanExtra("forceReload", false);
        JSONArray arr = new JSONArray(queueJson == null ? "[]" : queueJson);
        List<MediaItem> items = new ArrayList<>();
        List<TrackMeta> metas = new ArrayList<>();
        queueMeta.clear();

        double defaultVol = intent.getDoubleExtra("volume", 1.0);
        for (int i = 0; i < arr.length(); i++) {
          JSONObject o = arr.getJSONObject(i);
          String url = o.optString("url", "");
          if (url.isEmpty()) continue;
          String tId = o.optString("trackId", "");
          int qIdx = o.has("queueIndex") ? o.optInt("queueIndex", i) : i;
          float itemVol = o.has("volume") ? (float) o.optDouble("volume", defaultVol) : (float) defaultVol;
          TrackMeta meta = new TrackMeta(
              url,
              tId,
              o.optString("title", ""),
              o.optString("artist", ""),
              o.optString("album", ""),
              o.optString("art", ""),
              qIdx,
              itemVol);
          queueMeta.put(url, meta);
          metas.add(meta);
          items.add(new MediaItem.Builder()
              .setUri(url)
              .setMediaId(meta.mediaKey())
              .setTag(meta)
              .build());
        }
        if (items.isEmpty()) throw new IllegalStateException("empty queue");

        int safeIndex = Math.max(0, Math.min(index, items.size() - 1));
        TrackMeta targetMeta = metas.get(safeIndex);

        if (intent.hasExtra("speed")) {
          float sp = (float) intent.getDoubleExtra("speed", currentSpeed);
          sp = Math.max(0.5f, Math.min(2.0f, sp));
          if (Math.abs(sp - currentSpeed) > 0.01f) {
            currentSpeed = sp;
            exo.setPlaybackSpeed(currentSpeed);
          }
        }

        int rep = intent.getIntExtra("repeat", 0);
        applyRepeatMode(rep);

        boolean sameTrack = !forceReload
            && exo.getCurrentMediaItem() != null
            && exo.getPlaybackState() != Player.STATE_ENDED
            && exo.getPlaybackState() != Player.STATE_IDLE
            && targetMeta.url.equals(lastTrackUrl)
            && targetMeta.trackId.equals(lastTrackId);

        applyTrackMeta(targetMeta);
        exo.setVolume(targetMeta.volume);

        if (sameTrack) {
          if (posMs > 0) exo.seekTo(posMs);
          if (playing) {
            if (!exo.getPlayWhenReady()) exo.play();
          } else if (exo.getPlayWhenReady()) {
            exo.pause();
          }
          syncSurroundingMediaItems(items, safeIndex);
          lastEmitPosMs = Long.MIN_VALUE;
          emitProgress();
        } else {
          Log.i("YayaExo", "SET-QUEUE count=" + items.size() + " safeIndex=" + safeIndex + " posMs=" + posMs);
          exo.setMediaItems(items, safeIndex, Math.max(0L, posMs));
          exo.prepare();
          if (playing) exo.play();
        }

        startPolling();
        pushState();
        updateNotification(true);
        precacheNextInPlayer();
      } catch (Throwable t) {
        Map<String, Object> extra = new HashMap<>();
        extra.put("message", "queue err " + t.getMessage());
        extra.put("trackId", lastTrackId);
        extra.put("url", lastTrackUrl);
        extra.put("index", currentQueueIndex);
        RadioExoModule.emitJs(getApplicationContext(), "track_error", extra);
      }
    } else if (ACTION_REASSERT.equals(action)) {
      if (exo == null) {
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      try { if (session != null) session.setActive(true); } catch (Throwable ignored) {}
      pushState();
      updateNotification(true);
      return START_NOT_STICKY;
    } else if (ACTION_SET_HINTS.equals(action)) {
      applySkipHints(intent.getStringExtra("next"), intent.getStringExtra("prev"));
      if (exo == null) {
        stopServiceCleanly();
      }
      return START_NOT_STICKY;
    } else if (ACTION_UPDATE_ART.equals(action)) {
      if (exo == null) {
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      final String tId = intent.getStringExtra("trackId");
      final String art = intent.getStringExtra("art");
      if (art == null || art.isEmpty()) return START_NOT_STICKY;
      if (tId != null && !tId.isEmpty() && !tId.equals(lastTrackId)) {
        return START_NOT_STICKY;
      }
      if (art.equals(artPath) && artBitmap != null && !artBitmap.isRecycled()) {
        return START_NOT_STICKY;
      }
      if (art.startsWith("file://")) {
        artRequestUrl = "";
        final String filePath = art.substring("file://".length());
        try {
          artLoader.execute(() -> {
            final Bitmap bmp = decodeSampledFile(filePath);
            if (bmp == null) return;
            h.post(() -> {
              if (exo == null) return;
              if (tId != null && !tId.isEmpty() && !tId.equals(lastTrackId)) return;
              artPath = art;
              artRequestUrl = "";
              artBitmap = bmp;
              artGeneration += 1;
              lastMetaSig = "";
              pushState();
              updateNotification(true);
            });
          });
        } catch (Throwable ignored) {}
      }
      return START_NOT_STICKY;
    } else {
      String cmd = intent.getStringExtra("cmd");
      if ("stop".equals(cmd)) {
        if (exo != null) {
          try { exo.stop(); exo.clearMediaItems(); } catch (Throwable ignored) {}
        }
        musicActuallyPlaying = false;
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      if ("favorite".equals(cmd) || "playlist".equals(cmd)) {
        handleCustom(cmd);
        return START_NOT_STICKY;
      }
      if (exo == null) {
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      if ("pause".equals(cmd)) {
        exo.pause();
        pushState();
        updateNotification(true);
      } else if ("resume".equals(cmd) || "play".equals(cmd)) {
        if (exo.getPlaybackState() == Player.STATE_ENDED) exo.seekTo(0);
        if (exo.getPlaybackState() == Player.STATE_IDLE) exo.prepare();
        exo.play();
        startPolling();
        pushState();
        updateNotification(true);
      } else if ("next".equals(cmd)) {
        skipNextOrFallback();
      } else if ("prev".equals(cmd)) {
        skipPrevOrFallback();
      } else if ("play_pause".equals(cmd)) {
        if (isPlaying()) {
          exo.pause();
        } else {
          if (exo.getPlaybackState() == Player.STATE_ENDED) exo.seekTo(0);
          if (exo.getPlaybackState() == Player.STATE_IDLE) exo.prepare();
          exo.play();
          startPolling();
        }
        pushState();
        updateNotification(true);
      } else if ("seek".equals(cmd)) {
        exo.seekTo(Math.max(0L, (long) (intent.getDoubleExtra("position", 0) * 1000)));
        emitProgress();
        pushState();
      } else if ("repeat".equals(cmd)) {
        int rep = intent.hasExtra("repeat") ? intent.getIntExtra("repeat", 0) : (int) intent.getDoubleExtra("position", 0);
        applyRepeatMode(rep);
        precacheNextInPlayer();
      } else if ("speed".equals(cmd)) {
        float sp = (float) intent.getDoubleExtra("speed", intent.getDoubleExtra("position", 1.0));
        sp = Math.max(0.5f, Math.min(2.0f, sp));
        currentSpeed = sp;
        exo.setPlaybackSpeed(currentSpeed);
        emitProgress();
        pushState();
      } else if ("volume".equals(cmd)) {
        float vol = (float) intent.getDoubleExtra("volume", intent.getDoubleExtra("position", 1.0));
        exo.setVolume(Math.max(0f, Math.min(1.0f, vol)));
      }
    }
    return START_NOT_STICKY;
  }

  private void syncSurroundingMediaItems(List<MediaItem> items, int safeIndex) {
    if (exo == null || items.isEmpty()) return;
    int curIdx = exo.getCurrentMediaItemIndex();
    if (curIdx < 0 || curIdx >= exo.getMediaItemCount()) return;
    if (curIdx > 0) {
      exo.removeMediaItems(0, curIdx);
    }
    if (safeIndex > 0) {
      exo.addMediaItems(0, items.subList(0, safeIndex));
    }
    int newCur = safeIndex;
    if (exo.getMediaItemCount() > newCur + 1) {
      exo.removeMediaItems(newCur + 1, exo.getMediaItemCount());
    }
    if (safeIndex + 1 < items.size()) {
      exo.addMediaItems(items.subList(safeIndex + 1, items.size()));
    }
  }

  private void applyRepeatMode(int rep) {
    int mapped = rep == 1 ? Player.REPEAT_MODE_ONE : rep == 2 ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF;
    if (mapped != currentRepeat) {
      currentRepeat = mapped;
      if (exo != null) {
        exo.setRepeatMode(mapped);
      }
    }
  }

  private boolean isPlaying() {
    return exo != null && exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;
  }

  private void applySkipHints(String nextJson, String prevJson) {
    try {
      if (nextJson != null && nextJson.startsWith("{")) {
        JSONObject o = new JSONObject(nextJson);
        setNextHint(o.optString("url", ""), o.optString("trackId", ""), o.optString("title", ""),
            o.optString("artist", ""), o.optString("album", ""), o.optString("art", ""),
            o.has("index") ? o.optInt("index", -1) : -1);
      } else {
        clearNextHint();
      }
    } catch (Throwable t) { clearNextHint(); }
    try {
      if (prevJson != null && prevJson.startsWith("{")) {
        JSONObject o = new JSONObject(prevJson);
        setPrevHint(o.optString("url", ""), o.optString("trackId", ""), o.optString("title", ""),
            o.optString("artist", ""), o.optString("album", ""), o.optString("art", ""),
            o.has("index") ? o.optInt("index", -1) : -1);
      } else {
        clearPrevHint();
      }
    } catch (Throwable t) { clearPrevHint(); }
  }

  private void setNextHint(String u, String id, String t, String a, String al, String art, int idx) {
    nextUrl = u == null ? "" : u; nextTrackId = id == null ? "" : id; nextTitle = t == null ? "" : t;
    nextArtist = a == null ? "" : a; nextAlbum = al == null ? "" : al;
    nextArt = art == null ? "" : art; nextIndexHint = idx;
  }

  private void setPrevHint(String u, String id, String t, String a, String al, String art, int idx) {
    prevUrl = u == null ? "" : u; prevTrackId = id == null ? "" : id; prevTitle = t == null ? "" : t;
    prevArtist = a == null ? "" : a; prevAlbum = al == null ? "" : al;
    prevArt = art == null ? "" : art; prevIndexHint = idx;
  }

  private void clearNextHint() { setNextHint("", "", "", "", "", "", -1); }
  private void clearPrevHint() { setPrevHint("", "", "", "", "", "", -1); }

  @Nullable
  private static String mediaUrlOf(@Nullable MediaItem item) {
    if (item == null) return null;
    if (item.localConfiguration != null && item.localConfiguration.uri != null) {
      return item.localConfiguration.uri.toString();
    }
    if (item.mediaId != null && item.mediaId.startsWith("http")) return item.mediaId;
    return null;
  }

  @Nullable
  private String currentMediaUrl() {
    return exo == null ? null : mediaUrlOf(exo.getCurrentMediaItem());
  }

  private void localSkip(boolean isNext) {
    if (exo == null) return;
    String u = isNext ? nextUrl : prevUrl;
    if (u.isEmpty()) {
      RadioExoModule.emitJs(getApplicationContext(), "cmd", mapOf("cmd", isNext ? "next" : "prev"));
      return;
    }
    String nTrackId = isNext ? nextTrackId : prevTrackId;
    String nTitle = isNext ? nextTitle : prevTitle;
    String nArtist = isNext ? nextArtist : prevArtist;
    String nAlbum = isNext ? nextAlbum : prevAlbum;
    String nArt = isNext ? nextArt : prevArt;
    int nIndex = isNext ? nextIndexHint : prevIndexHint;

    if (isNext) {
      setPrevHint(lastTrackUrl, lastTrackId, title, artist, album, artPath, currentQueueIndex);
      clearNextHint();
    } else {
      setNextHint(lastTrackUrl, lastTrackId, title, artist, album, artPath, currentQueueIndex);
      clearPrevHint();
    }
    TrackMeta meta = new TrackMeta(u, nTrackId, nTitle, nArtist, nAlbum, nArt, nIndex, 1.0f);
    applyTrackMeta(meta);
    try {
      String curU = currentMediaUrl();
      if (curU != null && curU.equals(u)) {
        exo.seekTo(0);
      } else {
        MediaItem item = new MediaItem.Builder().setUri(u).setMediaId(meta.mediaKey()).setTag(meta).build();
        exo.setMediaItems(java.util.Collections.singletonList(item), 0, 0);
        exo.prepare();
      }
      exo.play();
    } catch (Throwable t) {
      Map<String, Object> extra = new HashMap<>();
      extra.put("message", "localSkip err " + t.getMessage());
      extra.put("trackId", nTrackId);
      extra.put("url", u);
      extra.put("index", nIndex);
      RadioExoModule.emitJs(getApplicationContext(), "track_error", extra);
      return;
    }
    pushState();
    updateNotification(true);

    Map<String, Object> ev = new HashMap<>();
    ev.put("cmd", isNext ? "next" : "prev");
    ev.put("url", u);
    ev.put("trackId", nTrackId);
    ev.put("title", nTitle);
    ev.put("artist", nArtist);
    ev.put("album", nAlbum);
    if (nIndex >= 0) ev.put("index", (double) nIndex);
    RadioExoModule.emitJs(getApplicationContext(), "skipped", ev);
  }

  private Notification minimalFg() {
    try {
      Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          ? new Notification.Builder(this, CHANNEL_ID)
          : new Notification.Builder(this);
      return b.setSmallIcon(R.drawable.ic_stat_music)
          .setContentTitle("牙牙消息")
          .setContentText("正在准备播放")
          .setCategory(Notification.CATEGORY_TRANSPORT)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .build();
    } catch (Throwable t) {
      return null;
    }
  }

  private void startPolling() {
    if (pollRunning) return;
    pollRunning = true;
    h.removeCallbacks(progressPoller);
    h.postDelayed(progressPoller, 500L);
  }

  private void stopPolling() {
    pollRunning = false;
    h.removeCallbacks(progressPoller);
  }

  private void emitProgress() {
    if (exo == null) return;
    try {
      long posMs = Math.max(0L, exo.getCurrentPosition());
      long bufferedMs = Math.max(0L, exo.getBufferedPosition());
      long rawDur = exo.getDuration();
      long durMs = rawDur > 0 && rawDur != C.TIME_UNSET ? rawDur : 0L;
      boolean playing = exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;
      boolean buffering = exo.getPlaybackState() == Player.STATE_BUFFERING;
      int idx = currentQueueIndex >= 0 ? currentQueueIndex : exo.getCurrentMediaItemIndex();
      boolean bufferedChanged = Math.abs(bufferedMs - lastEmitBufferedMs) >= 500L;
      boolean durChanged = durMs > 0 && Math.abs(durMs - lastEmitDurationMs) >= 500L;
      if (posMs == lastEmitPosMs
          && playing == lastEmitPlaying
          && buffering == lastEmitBuffering
          && idx == lastEmitIndex
          && Math.abs(currentSpeed - lastEmitSpeed) < 0.01f
          && !bufferedChanged
          && !durChanged) {
        return;
      }
      lastEmitPosMs = posMs;
      lastEmitBufferedMs = bufferedMs;
      lastEmitDurationMs = durMs;
      lastEmitPlaying = playing;
      lastEmitBuffering = buffering;
      lastEmitIndex = idx;
      lastEmitSpeed = currentSpeed;
      Map<String, Object> extra = new HashMap<>();
      extra.put("position", posMs / 1000.0);
      extra.put("buffered", bufferedMs / 1000.0);
      extra.put("buffering", buffering);
      extra.put("speed", (double) currentSpeed);
      extra.put("duration", durMs / 1000.0);
      extra.put("playing", playing);
      extra.put("index", idx);
      extra.put("url", lastTrackUrl);
      extra.put("trackId", lastTrackId);
      extra.put("title", title);
      extra.put("artist", artist);
      extra.put("album", album);
      RadioExoModule.emitJs(getApplicationContext(), "progress", extra);
    } catch (Throwable ignored) {}
  }

  private void pushState() {
    if (session == null || exo == null) return;
    try {
      long actions = PlaybackState.ACTION_PLAY
          | PlaybackState.ACTION_PAUSE
          | PlaybackState.ACTION_PLAY_PAUSE
          | PlaybackState.ACTION_STOP
          | PlaybackState.ACTION_SKIP_TO_NEXT
          | PlaybackState.ACTION_SKIP_TO_PREVIOUS
          | PlaybackState.ACTION_SEEK_TO;
      boolean playing = exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;
      boolean buffering = exo.getPlaybackState() == Player.STATE_BUFFERING && exo.getPlayWhenReady();
      int pbState = buffering
          ? PlaybackState.STATE_BUFFERING
          : (playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED);
      boolean fav = RadioServiceModule.isFavoriteState();

      PlaybackState ps = new PlaybackState.Builder()
          .setActions(actions)
          .setBufferedPosition(Math.max(0L, exo.getBufferedPosition()))
          .addCustomAction(new PlaybackState.CustomAction.Builder(
              "favorite",
              fav ? "已收藏" : "收藏",
              fav ? R.drawable.ic_heart : R.drawable.ic_heart_outline).build())
          .addCustomAction(new PlaybackState.CustomAction.Builder(
              "playlist",
              "播放列表",
              R.drawable.ic_playlist).build())
          .setState(
              pbState,
              Math.max(0L, exo.getCurrentPosition()),
              playing ? currentSpeed : 0f,
              android.os.SystemClock.elapsedRealtime())
          .build();
      session.setPlaybackState(ps);
      lastPushStateTimeMs = android.os.SystemClock.elapsedRealtime();
      lastPushedState = pbState;

      long dur = exo.getDuration();
      String sig = title + "|" + artist + "|" + album + "|" + artPath + "|" + artGeneration + "|" + (dur > 0 ? dur : 0);
      if (sig.equals(lastMetaSig)) return;
      lastMetaSig = sig;
      MediaMetadata.Builder b = new MediaMetadata.Builder();
      b.putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "牙牙消息" : title);
      b.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
      b.putString(MediaMetadata.METADATA_KEY_ALBUM, album);
      if (dur > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
      if (artBitmap != null && !artBitmap.isRecycled()) {
        b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap);
        b.putBitmap(MediaMetadata.METADATA_KEY_ART, artBitmap);
        b.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artBitmap);
      }
      session.setMetadata(b.build());
    } catch (Throwable ignored) {}
  }

  private void updateNotification(boolean force) {
    if (exo == null) return;
    boolean playing = isPlaying();
    boolean fav = RadioServiceModule.isFavoriteState();
    String sig = title + "|" + artist + "|" + album + "|" + playing + "|" + fav + "|" + artGeneration;
    if (!force && sig.equals(lastNotifySig)) return;
    lastNotifySig = sig;
    try {
      Notification n = buildNotification();
      if (n == null) return;
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (nm != null) {
        if (!isForegroundStarted) {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
          isForegroundStarted = true;
        } else {
          nm.notify(NOTIFICATION_ID, n);
        }
      }
    } catch (Throwable ignored) {}
  }

  private Notification.Action makeAction(int iconRes, String label, String cmd) {
    return new Notification.Action.Builder(
        Icon.createWithResource(this, iconRes),
        label,
        cmdPi(cmd))
        .build();
  }

  private Notification buildNotification() {
    try {
      String sub = artist.isEmpty() ? "牙牙消息" : artist + (album.isEmpty() ? "" : " · " + album);
      if (cachedContentPi == null) {
        Intent open = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("openFullScreenMusic", true);
        cachedContentPi = PendingIntent.getActivity(this, 100, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      }
      Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          ? new Notification.Builder(this, CHANNEL_ID)
          : new Notification.Builder(this);
      if (artBitmap != null && !artBitmap.isRecycled()) {
        builder.setLargeIcon(artBitmap);
      }

      boolean playing = isPlaying();
      boolean fav = RadioServiceModule.isFavoriteState();
      builder.setSmallIcon(R.drawable.ic_stat_music)
          .setContentTitle(title.isEmpty() ? "牙牙消息" : title)
          .setContentText(sub)
          .setCategory(Notification.CATEGORY_TRANSPORT)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .setOngoing(playing)
          .setOnlyAlertOnce(true)
          .setContentIntent(cachedContentPi)
          .addAction(makeAction(fav ? R.drawable.ic_heart : R.drawable.ic_heart_outline, fav ? "已收藏" : "收藏", "favorite"))
          .addAction(makeAction(R.drawable.ic_skip_previous, "上一首", "prev"))
          .addAction(makeAction(playing ? R.drawable.ic_pause : R.drawable.ic_play_arrow, playing ? "暂停" : "播放", "play_pause"))
          .addAction(makeAction(R.drawable.ic_skip_next, "下一首", "next"))
          .addAction(makeAction(R.drawable.ic_playlist, "播放列表", "playlist"))
          .setStyle(new Notification.MediaStyle()
              .setMediaSession(session == null ? null : session.getSessionToken())
              .setShowActionsInCompactView(1, 2, 3));
      return builder.build();
    } catch (Throwable ignored) {
      return null;
    }
  }

  private PendingIntent cmdPi(String cmd) {
    Intent i = new Intent(this, YayaExoService.class).putExtra("cmd", cmd);
    int rc = "prev".equals(cmd) ? 30
        : "play_pause".equals(cmd) ? 31
        : "next".equals(cmd) ? 32
        : "favorite".equals(cmd) ? 33
        : 34;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      return PendingIntent.getForegroundService(this, rc, i,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    return PendingIntent.getService(this, rc, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    super.onTaskRemoved(rootIntent);
  }

  @Override
  public void onDestroy() {
    serviceAlive = false;
    if (runningInstance == this) runningInstance = null;
    musicActuallyPlaying = false;
    isForegroundStarted = false;
    stopPolling();
    MusicCacheManager.cancelPrecache();
    try { artLoader.shutdownNow(); } catch (Throwable ignored) {}
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (Throwable ignored) {}
    destroySession();
    clearArt();
    if (exo != null) {
      try { exo.release(); } catch (Throwable ignored) {}
      exo = null;
    }
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
