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
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.ServiceCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class YayaExoService extends Service {
  public static final String ACTION_PLAY_QUEUE = "yaya.exo.play_queue";

  public static final String ACTION_REASSERT = "yaya.exo.reassert";

  public static final String ACTION_SET_HINTS = "yaya.exo.set_hints";

  public static volatile boolean serviceAlive = false;
  private static volatile YayaExoService runningInstance;

  public static volatile boolean musicActuallyPlaying = false;
  private static final String CHANNEL_ID = "yaya_radio_v3";
  private static final int NOTIFICATION_ID = 2024;
  private static final Handler h = new Handler(Looper.getMainLooper());

  private final Map<String, String> currentHeaders = new HashMap<>();
  private ExoPlayer exo;
  private MediaSession session;
  private boolean pollRunning = false;
  private int currentRepeat = Player.REPEAT_MODE_OFF;
  private long lastNotifyMs = 0;

  private long lastEmitPosMs = Long.MIN_VALUE;
  private boolean lastEmitPlaying = false;

  private String title = "";
  private String lastTrackUrl = "";
  private String lastTrackId = "";
  private String artist = "";
  private String album = "";
  private String artPath = "";
  private Bitmap artBitmap;

  private final ExecutorService artLoader = Executors.newSingleThreadExecutor();

  private volatile String artRequestUrl = "";

  private final Map<String, TrackMeta> queueMeta = new HashMap<>();

  private static class TrackMeta {
    final String url;
    final String trackId;
    final String title;
    final String artist;
    final String album;
    final String art;

    TrackMeta(String url, String trackId, String title, String artist, String album, String art) {
      this.url = url == null ? "" : url;
      this.trackId = trackId == null ? "" : trackId;
      this.title = title == null ? "" : title;
      this.artist = artist == null ? "" : artist;
      this.album = album == null ? "" : album;
      this.art = art == null ? "" : art;
    }
  }

  private String lastMetaSig = "";

  private PendingIntent cachedContentPi;

  private String nextUrl = "", nextTrackId = "", nextTitle = "", nextArtist = "", nextAlbum = "", nextArt = "";
  private String prevUrl = "", prevTrackId = "", prevTitle = "", prevArtist = "", prevAlbum = "", prevArt = "";
  private int nextIndexHint = -1, prevIndexHint = -1;

  private final Runnable progressPoller = new Runnable() {
    @Override public void run() {
      boolean playing = isPlaying();
      emitProgress();
      pushState();

      if (playing) {
        long now = System.currentTimeMillis();
        if (now - lastNotifyMs >= 3000) {
          lastNotifyMs = now;
          try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            Notification n = buildNotification();
            if (nm != null && n != null) nm.notify(NOTIFICATION_ID, n);
          } catch (Throwable ignored) {}
        }
      }
      h.postDelayed(this, playing ? 500 : 3000);
    }
  };

  private final Player.Listener playerListener = new Player.Listener() {
    @Override public void onPlaybackStateChanged(int state) {
      if (state == Player.STATE_ENDED) {

        musicActuallyPlaying = false;

        RadioExoModule.emitJs(getApplicationContext(), "ended", null);
      }
      emitProgress();
      pushState();
    }
    @Override public void onMediaItemTransition(@Nullable MediaItem m, int reason) {

      String url = currentMediaUrl();
      TrackMeta meta = url == null ? null : queueMeta.get(url);
      if (meta != null) {
        applyTrackMeta(meta);
      } else if (url != null) {
        lastTrackUrl = url;
        lastTrackId = "";
      }
      emitProgress();
      pushState();
    }
    @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
      musicActuallyPlaying = playWhenReady && exo != null && exo.getPlaybackState() != Player.STATE_ENDED;
      emitProgress(); pushState();
    }
    @Override public void onPlayerError(PlaybackException error) {
      Map<String, Object> extra = new HashMap<>();
      extra.put("message", String.valueOf(error.getMessage()));
      RadioExoModule.emitJs(getApplicationContext(), "error", extra);

      stopServiceCleanly();
    }
  };

  private void stopServiceCleanly() {
    stopPolling();
    musicActuallyPlaying = false;
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

  private void downloadArt(final String url) {
    if (url == null || url.isEmpty()) return;
    artRequestUrl = url;
    try {
      artLoader.execute(new Runnable() {
        @Override public void run() {
          if (!url.equals(artRequestUrl) || !url.equals(artPath)) return;
          java.net.HttpURLConnection conn = null;
          try {
            conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", "PocketFans201807/7.1.43 (Android)");
            if (conn.getResponseCode() / 100 != 2) return;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            java.io.InputStream in = conn.getInputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            final byte[] data = bos.toByteArray();
            if (data.length == 0) return;

            if (!url.equals(artRequestUrl) || !url.equals(artPath)) return;
            final Bitmap bmp = decodeSampled(data, 1024);
            if (bmp == null) return;
            h.post(new Runnable() {
              @Override public void run() {
                if (!url.equals(artPath) || !url.equals(artRequestUrl)) {
                  bmp.recycle();
                  return;
                }
                recycleArt();
                artBitmap = bmp;
                lastMetaSig = null;
                pushState();
              }
            });
          } catch (Throwable ignored) {
          } finally {
            try { if (conn != null) conn.disconnect(); } catch (Throwable ignored) {}
          }
        }
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
      opts.inSampleSize = calcInSampleSize(bounds.outWidth, bounds.outHeight, 1024);
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
    title = meta.title;
    artist = meta.artist;
    album = meta.album;
    lastTrackUrl = meta.url;
    lastTrackId = meta.trackId;
    if (!meta.art.equals(artPath)) {
      artPath = meta.art;
      artRequestUrl = "";
      recycleArt();
      if (artPath.startsWith("file://")) {
        artBitmap = decodeSampledFile(artPath.substring("file://".length()));
      } else if (artPath.startsWith("http")) {
        downloadArt(artPath);
      }
    }
  }

  private void recycleArt() {
    if (artBitmap != null && !artBitmap.isRecycled()) {
      try { artBitmap.recycle(); } catch (Throwable ignored) {}
    }
    artBitmap = null;
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

  public static Map<String, Object> getPlaybackSnapshot() {
    Map<String, Object> result = new HashMap<>();
    YayaExoService s = runningInstance;
    boolean active = s != null && s.exo != null && s.exo.getCurrentMediaItem() != null;
    result.put("active", active);
    if (!active) return result;
    result.put("url", String.valueOf(s.currentMediaUrl() == null ? "" : s.currentMediaUrl()));
    result.put("trackId", s.lastTrackId == null ? "" : s.lastTrackId);
    result.put("title", s.title == null ? "" : s.title);
    result.put("artist", s.artist == null ? "" : s.artist);
    result.put("album", s.album == null ? "" : s.album);
    result.put("position", Math.max(0, s.exo.getCurrentPosition()) / 1000.0);
    long duration = s.exo.getDuration();
    result.put("duration", duration > 0 ? duration / 1000.0 : 0.0);
    result.put("playing", s.exo.getPlayWhenReady() && s.exo.getPlaybackState() != Player.STATE_ENDED);
    return result;
  }

  private void ensureChannel() {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
      NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "后台播放", NotificationManager.IMPORTANCE_DEFAULT);
      ch.setDescription("播放音乐/电台时保持后台运行");
      ch.setSound(null, null);
      ch.enableVibration(false);
      getSystemService(NotificationManager.class).createNotificationChannel(ch);
    } catch (Throwable ignored) {}
  }

  private void ensurePlayer(Map<String, String> headers) {
    if (headers != null && headers.equals(currentHeaders) && exo != null) return;
    stopPolling();
    destroySession();
    if (exo != null) { try { exo.release(); } catch (Throwable ignored) {} exo = null; }
    currentHeaders.clear();
    if (headers != null) currentHeaders.putAll(headers);

    DefaultHttpDataSource.Factory ds = new DefaultHttpDataSource.Factory()
        .setUserAgent("PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)")
        .setDefaultRequestProperties(currentHeaders)
        .setAllowCrossProtocolRedirects(true);

    exo = new ExoPlayer.Builder(this, new DefaultMediaSourceFactory(ds))
        .setRenderersFactory(new DefaultRenderersFactory(this).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER))
        .setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),  true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build();
    exo.setHandleAudioBecomingNoisy(true);
    exo.addListener(playerListener);

    session = new MediaSession(this, "yaya-music");
    session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);

    session.setMediaButtonReceiver(
        PendingIntent.getBroadcast(this, 200,
            new Intent(this, MediaButtonProxyReceiver.class).setAction(Intent.ACTION_MEDIA_BUTTON),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    session.setCallback(new MediaSession.Callback() {
      @Override public void onPlay() { Log.i("YayaExo", "CMD onPlay"); if (exo != null) { exo.play(); startPolling(); } }
      @Override public void onPause() { Log.i("YayaExo", "CMD onPause curPos=" + (exo == null ? -1 : exo.getCurrentPosition())); if (exo != null) exo.pause(); }
      @Override public void onSkipToNext() { Log.i("YayaExo", "CMD onSkipToNext"); localSkip(true); }
      @Override public void onSkipToPrevious() { Log.i("YayaExo", "CMD onSkipToPrevious"); localSkip(false); }
      @Override public void onSeekTo(long pos) { Log.i("YayaExo", "CMD onSeekTo pos=" + pos); if (exo != null) exo.seekTo(Math.max(0, pos)); }
      @Override public void onStop() { Log.i("YayaExo", "CMD onStop"); if (exo != null) exo.pause(); }
      @Override public void onCustomAction(String action, android.os.Bundle args) {
        handleCustom(action);
      }

    });
    session.setActive(true);

    if (artPath != null && artPath.startsWith("file://")) {
      recycleArt();
      artBitmap = decodeSampledFile(artPath.substring("file://".length()));
    }
    lastNotifyMs = 0;
    lastEmitPosMs = Long.MIN_VALUE;
    lastEmitPlaying = false;
    pushState();
  }

  private void handleCustom(String action) {
    Log.i("YayaExo", "CMD custom " + action);
    if (action == null || action.isEmpty()) return;
    com.yk1z.yayamsg.RadioServiceModule.emitControl(getApplicationContext(), action);
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
    if (exo == null || Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        Notification fg = exo != null && !title.isEmpty() ? buildNotification() : minimalFg();
        if (fg == null) fg = minimalFg();
        if (fg != null) {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, fg, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        }
      } catch (Throwable ignored) {}
    }
    String action = intent.getAction();
    if (ACTION_PLAY_QUEUE.equals(action)) {
      try {

        try {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, minimalFg(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } catch (Throwable ignored) {}
        String hJson = intent.getStringExtra("headers");
        Map<String, String> nh = new HashMap<>();
        if (hJson != null && !hJson.isEmpty()) {
          JSONObject jo = new JSONObject(hJson);
          java.util.Iterator<String> it = jo.keys();
          while (it.hasNext()) { String k = it.next(); nh.put(k, jo.optString(k, "")); }
        }
        ensurePlayer(nh);

        String queueJson = intent.getStringExtra("queue");
        int index = Math.max(0, intent.getIntExtra("index", 0));
        long posMs = (long) (intent.getDoubleExtra("position", 0) * 1000);
        boolean playing = intent.getBooleanExtra("playing", true);
        JSONArray arr = new JSONArray(queueJson == null ? "[]" : queueJson);
        List<MediaItem> items = new ArrayList<>();
        queueMeta.clear();
        for (int i = 0; i < arr.length(); i++) {
          JSONObject o = arr.getJSONObject(i);
          String url = o.optString("url", "");
          queueMeta.put(url, new TrackMeta(url, o.optString("trackId", ""), o.optString("title", ""),
              o.optString("artist", ""), o.optString("album", ""), o.optString("art", "")));
          items.add(new MediaItem.Builder().setUri(url).build());
        }
        if (items.isEmpty()) throw new IllegalStateException("empty queue");
        int safeIndex = Math.max(0, Math.min(index, items.size() - 1));
        String targetUrl = arr.getJSONObject(safeIndex).optString("url", "");

        applyTrackMeta(queueMeta.get(targetUrl));

        MediaItem cur = exo.getCurrentMediaItem();
        String curUrl = cur == null ? null
            : (cur.mediaId != null && !cur.mediaId.isEmpty() ? cur.mediaId
              : (cur.localConfiguration != null && cur.localConfiguration.uri != null
                 ? cur.localConfiguration.uri.toString() : null));
        boolean sameTrack = curUrl != null && curUrl.equals(targetUrl);
        double vol = intent.getDoubleExtra("volume", 1.0);
        exo.setVolume((float) Math.max(0, Math.min(1.0, vol)));
        int rep = intent.getIntExtra("repeat", 0);
        if (rep != currentRepeat) {
          currentRepeat = rep;
          exo.setRepeatMode(rep == 1 ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
        }
        if (sameTrack && exo.getPlaybackState() != Player.STATE_ENDED) {
          if (posMs > 0) exo.seekTo(posMs);
          if (playing) {
            if (!exo.getPlayWhenReady()) exo.play();
          } else if (exo.getPlayWhenReady()) {
            exo.pause();
          }

          lastEmitPosMs = Long.MIN_VALUE;
          emitProgress();
        } else {
          Log.i("YayaExo", "SET-ITEMS posMs=" + posMs + " sameTrack=" + sameTrack + " curState=" + (exo.getPlaybackState()));
          exo.setMediaItems(items, Math.max(0, Math.min(index, items.size() - 1)), posMs);
          exo.prepare();
          if (playing) exo.play();
        }
        startPolling();
        Notification foreground = buildNotification();
        if (foreground == null) foreground = minimalFg();
        if (foreground != null) {
          try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, foreground, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
          } catch (Throwable ignored) {}
        }
      } catch (Throwable t) {
        Map<String, Object> extra = new HashMap<>();
        extra.put("message", "queue err " + t.getMessage());
        RadioExoModule.emitJs(getApplicationContext(), "error", extra);
      }
    } else if (ACTION_REASSERT.equals(action)) {

      if (exo == null) {

        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      try { if (session != null) session.setActive(true); } catch (Throwable ignored) {}
      pushState();
      try {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification n = buildNotification();
        if (nm != null && n != null) nm.notify(NOTIFICATION_ID, n);
      } catch (Throwable ignored) {}
      return START_NOT_STICKY;
    } else if (ACTION_SET_HINTS.equals(action)) {

      applySkipHints(intent.getStringExtra("next"), intent.getStringExtra("prev"));
      if (exo == null) {

        stopServiceCleanly();
      }
      return START_NOT_STICKY;
    } else {
      String cmd = intent.getStringExtra("cmd");
      if ("stop".equals(cmd)) {

        if (exo != null) { try { exo.stop(); exo.clearMediaItems(); } catch (Throwable ignored) {} }
        musicActuallyPlaying = false;
        try {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, minimalFg(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } catch (Throwable ignored) {}
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      if (exo == null) {
        stopServiceCleanly();
        return START_NOT_STICKY;
      }
      if ("pause".equals(cmd)) { exo.pause(); pushState(); }
      else if ("resume".equals(cmd)) { exo.play(); pushState(); startPolling(); }
      else if ("next".equals(cmd)) { localSkip(true); }
      else if ("prev".equals(cmd)) { localSkip(false); }
      else if ("play_pause".equals(cmd)) {
        if (isPlaying()) { exo.pause(); } else { exo.play(); startPolling(); }
        pushState();
      } else if ("seek".equals(cmd)) {
        exo.seekTo(Math.max(0, (long) (intent.getDoubleExtra("position", 0) * 1000)));
      } else if ("repeat".equals(cmd)) {
        int rep = intent.getIntExtra("repeat", 0);
        currentRepeat = rep;
        exo.setRepeatMode(rep == 1 ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
      }
    }
    return START_NOT_STICKY;
  }

  private boolean isPlaying() {
    return exo != null && exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;
  }

  private void applySkipHints(String nextJson, String prevJson) {
    try {
      if (nextJson != null && nextJson.startsWith("{")) {
        JSONObject o = new JSONObject(nextJson);
        String u = o.optString("url", "");
        setNextHint(u, o.optString("trackId", ""), o.optString("title", ""), o.optString("artist", ""), o.optString("album", ""),
            o.optString("art", ""),
            o.has("index") ? o.optInt("index", -1) : -1);
      } else {
        clearNextHint();
      }
    } catch (Throwable t) { clearNextHint(); }
    try {
      if (prevJson != null && prevJson.startsWith("{")) {
        JSONObject o = new JSONObject(prevJson);
        String u = o.optString("url", "");
        setPrevHint(u, o.optString("trackId", ""), o.optString("title", ""), o.optString("artist", ""), o.optString("album", ""),
            o.optString("art", ""),
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

  private String currentMediaUrl() {
    MediaItem cur = exo == null ? null : exo.getCurrentMediaItem();
    if (cur == null) return null;
    if (cur.mediaId != null && !cur.mediaId.isEmpty()) return cur.mediaId;
    if (cur.localConfiguration != null && cur.localConfiguration.uri != null) return cur.localConfiguration.uri.toString();
    return null;
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

    if (isNext) { setPrevHint(lastTrackUrl, lastTrackId, title, artist, album, artPath, -1); clearNextHint(); }
    else { setNextHint(lastTrackUrl, lastTrackId, title, artist, album, artPath, -1); clearPrevHint(); }
    title = nTitle; artist = nArtist; album = nAlbum; lastTrackUrl = u; lastTrackId = nTrackId;
    String curU = currentMediaUrl();
    boolean same = curU != null && curU.equals(u);
    try {
      if (same) {
        exo.seekTo(0);
      } else {
        exo.setMediaItems(java.util.Collections.singletonList(new MediaItem.Builder().setUri(u).build()), 0, 0);
        exo.prepare();

        artPath = nArt;
        artRequestUrl = "";
        recycleArt();
        if (nArt.startsWith("file://")) {
          artBitmap = decodeSampledFile(nArt.substring("file://".length()));
        }
      }
      exo.play();
    } catch (Throwable t) {
      Map<String, Object> extra = new HashMap<>();
      extra.put("message", "localSkip err " + t.getMessage());
      RadioExoModule.emitJs(getApplicationContext(), "error", extra);
      return;
    }
    pushState();
    try {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      Notification n = buildNotification();
      if (nm != null && n != null) nm.notify(NOTIFICATION_ID, n);
    } catch (Throwable ignored) {}

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
      return b.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("牙牙消息")
          .setContentText("正在播放")
          .setCategory(Notification.CATEGORY_TRANSPORT)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .build();
    } catch (Throwable t) {
      try {
        return new Notification.Builder(this)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("牙牙消息").setContentText("正在播放").build();
      } catch (Throwable t2) {
        return null;
      }
    }
  }

  private void startPolling() {
    if (pollRunning) return;
    pollRunning = true;
    h.removeCallbacks(progressPoller);
    h.postDelayed(progressPoller, 500);
  }
  private void stopPolling() {
    pollRunning = false;
    h.removeCallbacks(progressPoller);
  }

  private void emitProgress() {
    if (exo == null) return;
    try {
      long posMs = exo.getCurrentPosition();
      boolean playing = exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;
      if (posMs == lastEmitPosMs && playing == lastEmitPlaying) return;
      lastEmitPosMs = posMs;
      lastEmitPlaying = playing;
      Map<String, Object> extra = new HashMap<>();
      extra.put("position", posMs / 1000.0);
      extra.put("duration", exo.getDuration() > 0 ? exo.getDuration() / 1000.0 : 0);
      extra.put("playing", playing);
      extra.put("index", exo.getCurrentMediaItemIndex());
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

      long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
          | PlaybackState.ACTION_PLAY_PAUSE
          | PlaybackState.ACTION_STOP
          | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
          | PlaybackState.ACTION_SEEK_TO;
      boolean playing = exo.getPlayWhenReady() && exo.getPlaybackState() != Player.STATE_ENDED;

      PlaybackState ps = new PlaybackState.Builder()
          .setActions(actions)

          .addCustomAction(new PlaybackState.CustomAction.Builder("favorite",
              com.yk1z.yayamsg.RadioServiceModule.isFavoriteState() ? "已收藏" : "收藏",
              com.yk1z.yayamsg.RadioServiceModule.isFavoriteState() ? R.drawable.ic_heart : R.drawable.ic_heart_outline).build())
          .addCustomAction(new PlaybackState.CustomAction.Builder("playlist", "播放列表", R.drawable.ic_playlist).build())
          .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
              exo.getCurrentPosition(), playing ? 1.0f : 0f, android.os.SystemClock.elapsedRealtime())
          .build();
      session.setPlaybackState(ps);

      long dur = exo.getDuration();
      String sig = title + "|" + artist + "|" + album + "|" + artPath + "|" + (dur > 0 ? dur : 0);
      if (sig.equals(lastMetaSig)) return;
      lastMetaSig = sig;
      MediaMetadata.Builder b = new MediaMetadata.Builder();
      b.putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "牙牙消息" : title);
      b.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
      b.putString(MediaMetadata.METADATA_KEY_ALBUM, album);
      if (dur > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
      if (artBitmap != null) b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap);
      session.setMetadata(b.build());
    } catch (Throwable ignored) {}
  }

  private Notification buildNotification() {
    try {
      String sub = artist.isEmpty() ? "牙牙消息" : artist + (album.isEmpty() ? "" : " · " + album);
      if (cachedContentPi == null) {

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
          cachedContentPi = PendingIntent.getActivity(this, 0, open,
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
      }
      Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          ? new Notification.Builder(this, CHANNEL_ID)
          : new Notification.Builder(this);
      if (artBitmap != null) builder.setLargeIcon(artBitmap);

      builder.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title.isEmpty() ? "牙牙消息" : title)
          .setContentText(sub)
          .setCategory(Notification.CATEGORY_TRANSPORT)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setContentIntent(cachedContentPi)
          .setStyle(new android.app.Notification.MediaStyle()
              .setMediaSession(session == null ? null : session.getSessionToken()));
      return builder.build();
    } catch (Throwable ignored) {
      return null;
    }
  }

  private PendingIntent cmdPi(String cmd) {
    Intent i = new Intent(this, YayaExoService.class).putExtra("cmd", cmd);
    int rc = "prev".equals(cmd) ? 30 : "next".equals(cmd) ? 32 : 31;
    return PendingIntent.getForegroundService(this, rc, i,
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
    stopPolling();
    try { artLoader.shutdownNow(); } catch (Throwable ignored) {}
    try {

      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (Throwable ignored) {}
    destroySession();
    recycleArt();
    if (exo != null) { try { exo.release(); } catch (Throwable ignored) {} exo = null; }
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
