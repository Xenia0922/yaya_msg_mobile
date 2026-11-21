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
import android.util.Base64;
import android.util.Log;
import android.os.PowerManager;
import android.widget.RemoteViews;

import androidx.annotation.Nullable;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RadioForegroundService extends Service {

  private static final String CHANNEL_ID = "yaya_radio_v2";

  private static final int NOTIFICATION_ID = 2025;

  private PowerManager.WakeLock wakeLock;
  private MediaSession mediaSession;
  private String title = "";
  private String artist = "";
  private String album = "";
  private String lyric = "";
  private String coverUrl = "";
  private Bitmap coverBitmap = null;
  private Bitmap appIconBitmap = null;
  private boolean isPlaying = false;
  private long position = 0;
  private long duration = 0;
  private final ExecutorService coverLoader = Executors.newSingleThreadExecutor();

  private final Handler progressHandler = new Handler(Looper.getMainLooper());
  private boolean tickerRunning = false;
  private long lastNotifyMs = 0;
  private long lastWakeRenewMs = 0;
  private final Runnable progressTicker = new Runnable() {
    @Override
    public void run() {
      if (isPlaying) {
        position += 500;
        pushSessionState();
        long now = System.currentTimeMillis();

        if (wakeLock != null && wakeLock.isHeld() && now - lastWakeRenewMs >= 60000) {
          try {
            wakeLock.acquire(10 * 60 * 1000L);
            lastWakeRenewMs = now;
          } catch (Throwable ignored) {
          }
        }

        if (now - lastNotifyMs >= 1000) {
          lastNotifyMs = now;
          try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            Notification n = buildNotification();
            if (nm != null && n != null) nm.notify(NOTIFICATION_ID, n);
          } catch (Throwable ignored) {
          }
        }
      }
      if (isPlaying) progressHandler.postDelayed(this, 500);
      else tickerRunning = false;
    }
  };

  private void startTicker() {
    if (tickerRunning) return;
    tickerRunning = true;
    progressHandler.removeCallbacks(progressTicker);
    progressHandler.postDelayed(progressTicker, 1000);
  }

  private void stopTicker() {
    tickerRunning = false;
    progressHandler.removeCallbacks(progressTicker);
  }

  private void pushSessionState() {
    if (mediaSession == null) return;
    try {
      long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
          | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
          | (duration > 0 ? PlaybackState.ACTION_SEEK_TO : 0);
      PlaybackState state = new PlaybackState.Builder()
          .setActions(actions)

          .addCustomAction(new PlaybackState.CustomAction.Builder("favorite",
              com.yk1z.yayamsg.RadioServiceModule.isFavoriteState() ? "已收藏" : "收藏",
              com.yk1z.yayamsg.RadioServiceModule.isFavoriteState() ? R.drawable.ic_heart : R.drawable.ic_heart_outline).build())
          .addCustomAction(new PlaybackState.CustomAction.Builder("playlist", "播放列表", R.drawable.ic_playlist).build())

          .setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
              position, isPlaying ? 1.0f : 0f, android.os.SystemClock.elapsedRealtime())
          .build();
      mediaSession.setPlaybackState(state);
      mediaSession.setActive(true);
    } catch (Throwable ignored) {
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();

    ensureChannel();
    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
    if (pm != null) {
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yaya:radio");
      wakeLock.setReferenceCounted(false);
    }
    try {
      appIconBitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
    } catch (Throwable ignored) {
    }
    mediaSession = new MediaSession(this, "yaya-radio");
    mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    if (Build.VERSION.SDK_INT >= 21) {
      mediaSession.setPlaybackToLocal(new android.media.AudioAttributes.Builder()
          .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
          .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
          .build());
    }
    mediaSession.setCallback(new MediaSession.Callback() {
      @Override
      public void onPlay() {
        RadioServiceModule.emitControl(getApplicationContext(), "play");
      }
      @Override
      public void onPause() {
        RadioServiceModule.emitControl(getApplicationContext(), "pause");
      }
      @Override
      public void onSkipToNext() {
        RadioServiceModule.emitControl(getApplicationContext(), "next");
      }
      @Override
      public void onSkipToPrevious() {
        RadioServiceModule.emitControl(getApplicationContext(), "prev");
      }
      @Override
      public void onSeekTo(long pos) {

        RadioServiceModule.emitControlWithValue(getApplicationContext(), "seek", (double) pos);
      }
      @Override
      public void onCustomAction(String action, android.os.Bundle args) {
        if (action != null && !action.isEmpty()) RadioServiceModule.emitControl(getApplicationContext(), action);
      }
    });
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {

    if (intent != null && intent.getBooleanExtra("tickOnly", false)) {
      if (intent.hasExtra("position")) position = (long) (intent.getDoubleExtra("position", 0) * 1000);
      if (isPlaying) pushSessionState();
      return START_NOT_STICKY;
    }
    if (intent != null) {

      Notification placeholder = buildMinimalNotification();
      if (placeholder == null) {
        try { placeholder = buildNotification(); } catch (Throwable ignored) {}
      }
      if (placeholder != null) {
        try {
          if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, placeholder, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
          } else {
            startForeground(NOTIFICATION_ID, placeholder);
          }
        } catch (Throwable ignored) {}
      }
      if (intent.hasExtra("title")) title = intent.getStringExtra("title") == null ? "" : intent.getStringExtra("title");
      if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist") == null ? "" : intent.getStringExtra("artist");
      if (intent.hasExtra("album")) album = intent.getStringExtra("album") == null ? "" : intent.getStringExtra("album");
      if (intent.hasExtra("lyric")) lyric = intent.getStringExtra("lyric") == null ? "" : intent.getStringExtra("lyric");
      if (intent.hasExtra("isPlaying")) isPlaying = intent.getBooleanExtra("isPlaying", false);
      if (intent.hasExtra("position")) position = (long) (intent.getDoubleExtra("position", 0) * 1000);
      if (intent.hasExtra("duration")) duration = (long) (intent.getDoubleExtra("duration", 0) * 1000);
      if (intent.hasExtra("cover")) {
        String nextCover = intent.getStringExtra("cover") == null ? "" : intent.getStringExtra("cover");
        if (!nextCover.equals(coverUrl)) {
          coverUrl = nextCover;
          coverBitmap = null;

          if (!coverUrl.isEmpty()) loadCover(coverUrl);
        }
      }
    }
    Notification foreground = null;
    try { foreground = buildNotification(); } catch (Throwable ignored) {}
    if (foreground == null) foreground = buildMinimalNotification();
    if (foreground != null) {
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          startForeground(NOTIFICATION_ID, foreground, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
          startForeground(NOTIFICATION_ID, foreground);
        }
      } catch (Throwable ignored) {}
    }
    if (Build.VERSION.SDK_INT < 29) {
      Log.i("RadioFg", "start: play=" + isPlaying + " posMs=" + position + " durMs=" + duration
        + " cover=" + (coverUrl == null || coverUrl.isEmpty() ? "EMPTY" : coverUrl)
        + " title=" + title + " art=" + (coverBitmap != null ? "Y" : "N"));
    }

    if (wakeLock != null) {
      try {
        if (isPlaying) {

          wakeLock.acquire(10 * 60 * 1000L);
          lastWakeRenewMs = System.currentTimeMillis();
        } else {
          if (wakeLock.isHeld()) wakeLock.release();
        }
      } catch (RuntimeException ignored) {
      }
    }
    return START_NOT_STICKY;
  }

  private void ensureChannel() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {

          NotificationChannel channel = new NotificationChannel(
              CHANNEL_ID, "后台播放", NotificationManager.IMPORTANCE_DEFAULT);
          channel.setDescription("播放音乐/电台时保持后台运行");
          channel.setSound(null, null);
          channel.enableVibration(false);
          nm.createNotificationChannel(channel);
        }
      }
    } catch (Throwable ignored) {}
  }

  private Notification buildMinimalNotification() {
    try {
      Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          ? new Notification.Builder(this, CHANNEL_ID)
          : new Notification.Builder(this);
      b.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("牙牙消息")
          .setContentText("后台播放")
          .setCategory(Notification.CATEGORY_TRANSPORT)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .setOngoing(true)
          .setOnlyAlertOnce(true);
      return b.build();
    } catch (Throwable t) {

      try {
        return new Notification.Builder(this)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("牙牙消息").setContentText("后台播放").build();
      } catch (Throwable t2) {
        return null;
      }
    }
  }

  private void loadCover(final String url) {
    if (url == null || url.isEmpty()) return;
    try {
      coverLoader.execute(() -> {

        if (!url.equals(coverUrl)) return;

        if (url.startsWith("file://")) {
          Bitmap bmp = decodeSampledFile(url.substring("file://".length()));
          if (bmp != null) applyCover(url, bmp);
          return;
        }

        if (url.startsWith("data:image")) {
          Bitmap bmp = decodeDataUri(url);
          if (bmp != null) applyCover(url, bmp);
          return;
        }

        String[] tries = { url, variantResize(url, "160x160"), variantResize(url, "500x500") };
        java.util.LinkedHashSet<String> uniq = new java.util.LinkedHashSet<>();
        for (String t : tries) if (t != null && !t.isEmpty()) uniq.add(t);
        for (String t : uniq) {
          if (!url.equals(coverUrl)) return;
          if (tryLoadCoverOnce(t)) return;
        }
        Log.i("RadioFg", "cover ALL FAIL");
      });
    } catch (Throwable ignored) {}
  }

  private String variantResize(String u, String size) {
    try {
      java.net.URI uri = new java.net.URI(u);
      String host = uri.getHost();
      String path = uri.getPath() == null ? "" : uri.getPath();
      String cleaned = path.replaceAll("/resize_[0-9]+x[0-9]+", "");
      String newPath = (cleaned.startsWith("/") ? "" : "/") + "resize_" + size + (cleaned.startsWith("/") ? cleaned : "/" + cleaned);
      return "https://" + host + newPath;
    } catch (Throwable t) {
      return u;
    }
  }

  private Bitmap decodeDataUri(String u) {
    try {
      if (u == null || !u.startsWith("data:image")) return null;
      int comma = u.indexOf(',');
      String b64 = comma >= 0 ? u.substring(comma + 1) : u;
      byte[] bytes = null;
      int[] flags = { Base64.DEFAULT, Base64.NO_WRAP, Base64.NO_PADDING | Base64.NO_WRAP };
      for (int f : flags) {
        try {
          bytes = Base64.decode(b64, f);
          if (bytes != null && bytes.length > 0) break;
        } catch (Throwable ignored) {
        }
      }
      if (bytes == null || bytes.length == 0) return null;
      return decodeSampled(bytes, 1024);
    } catch (Throwable t) {
      return null;
    }
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

  private boolean isCurrentCover(String candidate) {
    String current = coverUrl;
    if (current == null || current.isEmpty() || candidate == null) return false;
    if (current.equals(candidate)) return true;
    return variantResize(current, "160x160").equals(candidate)
        || variantResize(current, "500x500").equals(candidate);
  }

  private void applyCover(final String requestUrl, final Bitmap bmp) {
    if (bmp == null) return;
    progressHandler.post(() -> {
      if (!isCurrentCover(requestUrl)) {
        bmp.recycle();
        return;
      }
      Bitmap old = coverBitmap;
      coverBitmap = bmp;
      if (old != null && old != bmp && !old.isRecycled()) {
        try { old.recycle(); } catch (Throwable ignored) {}
      }
      Log.i("RadioFg", "cover OK " + bmp.getWidth() + "x" + bmp.getHeight());
      renotify();
    });
  }

  private byte[] readAll(InputStream is) throws java.io.IOException {
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
    return out.toByteArray();
  }

  private boolean tryLoadCoverOnce(final String url) {
    HttpURLConnection conn = null;
    try {
      URL u = new URL(url);
      conn = (HttpURLConnection) u.openConnection();
      conn.setConnectTimeout(4000);
      conn.setReadTimeout(6000);
      conn.setRequestProperty("User-Agent", "PocketFans201807/7.0.41 (iPhone; iOS 16.3.1; Scale/2.00)");
      conn.setRequestProperty("Referer", "https://h5.48.cn/");
      conn.setInstanceFollowRedirects(true);
      conn.setRequestProperty("Accept", "image/*");
      int code = conn.getResponseCode();
      if (code / 100 != 2) {
        Log.i("RadioFg", "cover http " + code);
        return false;
      }

      if (!isCurrentCover(url)) return false;

      byte[] bytes = readAll(conn.getInputStream());
      if (bytes == null || bytes.length == 0) {
        Log.i("RadioFg", "cover empty body");
        return false;
      }
      if (!isCurrentCover(url)) return false;
      Bitmap bmp = decodeSampled(bytes, 1024);
      if (bmp == null) {
        Log.i("RadioFg", "cover decode null");
        return false;
      }
      applyCover(url, bmp);
      return true;
    } catch (Throwable t) {
      Log.i("RadioFg", "cover ERR");
      return false;
    } finally {
      if (conn != null) {
        try {
          conn.disconnect();
        } catch (Throwable ignored) {
        }
      }
    }
  }

  private void renotify() {
    try {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      Notification n = buildNotification();
      if (nm != null && n != null) nm.notify(NOTIFICATION_ID, n);
    } catch (Throwable ignored) {
    }
  }

  private Notification buildNotification() {
    ensureChannel();
    String subLine = String.format("%s%s%s",
        artist == null || artist.isEmpty() ? "" : artist,
        (artist != null && !artist.isEmpty() && album != null && !album.isEmpty()) ? " · " : "",
        album == null || album.isEmpty() ? "" : album).trim();
    String text = subLine.isEmpty() ? "牙牙消息" : subLine;

    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent contentPi = PendingIntent.getActivity(
        this, 0, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    PendingIntent favPi = mediaPi(RadioMediaReceiver.ACTION_FAVORITE, 13);
    PendingIntent listPi = mediaPi(RadioMediaReceiver.ACTION_PLAYLIST, 14);
    PendingIntent prevPi = mediaPi(RadioMediaReceiver.ACTION_PREV, 10);
    PendingIntent playPausePi = mediaPi(isPlaying ? RadioMediaReceiver.ACTION_PLAY_PAUSE : RadioMediaReceiver.ACTION_PLAY_PAUSE, 11);
    PendingIntent nextPi = mediaPi(RadioMediaReceiver.ACTION_NEXT, 12);
    PendingIntent stopPi = mediaPi(RadioMediaReceiver.ACTION_STOP, 15);

    try {
      MediaMetadata.Builder md = new MediaMetadata.Builder();
      md.putString(MediaMetadata.METADATA_KEY_TITLE, (title == null || title.isEmpty()) ? "牙牙消息" : title);
      md.putString(MediaMetadata.METADATA_KEY_ARTIST, artist == null ? "" : artist);
      md.putString(MediaMetadata.METADATA_KEY_ALBUM, album == null ? "" : album);
      if (duration > 0) md.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
      if (coverBitmap != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, coverBitmap);
      mediaSession.setMetadata(md.build());
    } catch (Throwable ignored) {
    }

    long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
        | (duration > 0 ? PlaybackState.ACTION_SEEK_TO : 0);
    PlaybackState playbackState = new PlaybackState.Builder()
        .setActions(actions)

        .setState(
            isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
            position, isPlaying ? 1.0f : 0f, android.os.SystemClock.elapsedRealtime())
        .build();
    mediaSession.setPlaybackState(playbackState);
    mediaSession.setActive(true);
    if (isPlaying) startTicker();
    else stopTicker();

    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL_ID)
        : new Notification.Builder(this);
    if (coverBitmap != null) {
      builder.setLargeIcon(coverBitmap);
    } else if (appIconBitmap != null) {
      builder.setLargeIcon(appIconBitmap);
    }
    builder.setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle((title == null || title.isEmpty()) ? "牙牙消息" : title)
        .setContentText(text)
        .setCategory(Notification.CATEGORY_TRANSPORT)

        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(contentPi)
        .setDeleteIntent(stopPi)

        .addAction(R.drawable.ic_heart, "收藏", favPi)
        .addAction(R.drawable.ic_playlist, "播放列表", listPi)
        .addAction(android.R.drawable.ic_media_previous, "上一首", prevPi)
        .addAction(isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, isPlaying ? "暂停" : "播放", playPausePi)
        .addAction(android.R.drawable.ic_media_next, "下一首", nextPi)
        .setStyle(new android.app.Notification.MediaStyle()
            .setMediaSession(mediaSession.getSessionToken())
            .setShowActionsInCompactView(2, 3, 4));

    boolean hasMusicMeta = (lyric != null && !lyric.isEmpty())
        || (subLine != null && !subLine.isEmpty() && !"牙牙消息".equals(subLine));
    if (hasMusicMeta) {
      try {
        RemoteViews big = new RemoteViews(getPackageName(), R.layout.notification_media);
        big.setTextViewText(R.id.mc_title, (title == null || title.isEmpty()) ? "牙牙消息" : title);
        big.setTextViewText(R.id.mc_sub, subLine);
        big.setTextViewText(R.id.mc_lyric, (lyric == null || lyric.isEmpty()) ? "♪" : "♪ " + lyric);
        if (coverBitmap != null) {
          big.setImageViewBitmap(R.id.mc_art, coverBitmap);
        } else {
          big.setViewVisibility(R.id.mc_art, android.view.View.GONE);
        }

        builder.setCustomBigContentView(big);
      } catch (Throwable ignored) {
      }
    }
    return builder.build();
  }

  private PendingIntent mediaPi(String action, int requestCode) {
    Intent i = new Intent(this, RadioMediaReceiver.class).setAction(action);
    return PendingIntent.getBroadcast(this, requestCode, i,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  @Override
  public void onDestroy() {
    stopTicker();
    if (mediaSession != null) {
      mediaSession.setActive(false);
      mediaSession.release();
    }
    coverLoader.shutdownNow();
    if (wakeLock != null && wakeLock.isHeld()) {
      try {
        wakeLock.release();
      } catch (Throwable ignored) {
      }
    }
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
