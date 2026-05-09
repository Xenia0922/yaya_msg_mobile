package com.yk1z.yayamsg;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.google.android.exoplayer2.DefaultLoadControl;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.ext.rtmp.RtmpDataSource;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DataSource;
import com.google.android.exoplayer2.upstream.DefaultDataSource;

import java.io.IOException;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

import tv.danmaku.ijk.media.player.IjkMediaPlayer;
import tv.danmaku.ijk.media.player.IMediaPlayer;

public class LivePlayerActivity extends Activity {
  public static final String EXTRA_URL = "url";
  public static final String EXTRA_URLS = "urls";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_LIVE_ID = "liveId";
  public static final String EXTRA_ACCEPT_USER_ID = "acceptUserId";

  private static final int MIN_BUFFER_MS = 500;
  private static final int MAX_BUFFER_MS = 1000;
  private static final int PLAYBACK_BUFFER_MS = 250;
  private static final int REBUFFER_MS = 500;
  private static final int MAX_RETRY = 5;
  private static final long RETRY_DELAY_MS = 2000L;
  private static final String TAG = "LivePlayerActivity";
  private static final AtomicBoolean IJK_READY = new AtomicBoolean(false);

  private final Handler handler = new Handler(Looper.getMainLooper());
  private FrameLayout playerHost;
  private TextView statusText;
  private TextView titleView;
  private SurfaceView exoSurfaceView;
  private ExoPlayer exoPlayer;
  private FrameLayout ijkSurfaceBox;
  private SurfaceView ijkSurfaceView;
  private SurfaceHolder.Callback ijkSurfaceCallback;
  private IjkMediaPlayer ijkPlayer;
  private String url = "";
  private ArrayList<String> urlCandidates = new ArrayList<>();
  private int urlIndex = 0;
  private String title = "";
  private String liveId = "";
  private String acceptUserId = "";
  private int retryCount = 0;
  private boolean released = false;
  private boolean releasing = false;
  private boolean isLandscape = false;
  private boolean triedExoForCurrentUrl = false;
  private boolean triedIjkForCurrentUrl = false;
  private int videoWidth = 0;
  private int videoHeight = 0;
  private int videoSarNum = 1;
  private int videoSarDen = 1;

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    url = clean(getIntent().getStringExtra(EXTRA_URL));
    ArrayList<String> incomingUrls = getIntent().getStringArrayListExtra(EXTRA_URLS);
    if (incomingUrls != null) {
      for (String candidate : incomingUrls) {
        String cleaned = clean(candidate);
        if (!cleaned.isEmpty() && !urlCandidates.contains(cleaned)) urlCandidates.add(cleaned);
      }
    }
    if (!url.isEmpty() && !urlCandidates.contains(url)) urlCandidates.add(0, url);
    if (!urlCandidates.isEmpty()) url = urlCandidates.get(0);
    title = clean(getIntent().getStringExtra(EXTRA_TITLE));
    liveId = clean(getIntent().getStringExtra(EXTRA_LIVE_ID));
    acceptUserId = clean(getIntent().getStringExtra(EXTRA_ACCEPT_USER_ID));
    if (title.isEmpty()) title = "Pocket48 Live";
    buildView();
    startPlayer();
  }

  private void buildView() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);

    playerHost = new FrameLayout(this);
    root.addView(playerHost, new FrameLayout.LayoutParams(-1, -1));

    LinearLayout top = new LinearLayout(this);
    top.setOrientation(LinearLayout.HORIZONTAL);
    top.setGravity(Gravity.CENTER_VERTICAL);
    top.setPadding(dp(12), dp(22), dp(12), dp(10));
    top.setBackgroundColor(0x88000000);

    TextView back = actionButton("返回");
    back.setOnClickListener(v -> finish());
    top.addView(back, new LinearLayout.LayoutParams(dp(64), dp(40)));

    titleView = new TextView(this);
    titleView.setText(title);
    titleView.setTextColor(Color.WHITE);
    titleView.setTextSize(16);
    titleView.setGravity(Gravity.CENTER_VERTICAL);
    titleView.setSingleLine(true);
    LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1f);
    titleParams.leftMargin = dp(10);
    titleParams.rightMargin = dp(10);
    top.addView(titleView, titleParams);

    TextView rotate = actionButton("横屏");
    rotate.setOnClickListener(v -> toggleOrientation());
    top.addView(rotate, new LinearLayout.LayoutParams(dp(64), dp(40)));

    TextView retry = actionButton("重连");
    retry.setOnClickListener(v -> manualRetry());
    LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(dp(64), dp(40));
    retryParams.leftMargin = dp(8);
    top.addView(retry, retryParams);

    TextView gift = actionButton("礼物");
    gift.setOnClickListener(v -> showGiftHint());
    LinearLayout.LayoutParams giftParams = new LinearLayout.LayoutParams(dp(64), dp(40));
    giftParams.leftMargin = dp(8);
    top.addView(gift, giftParams);

    root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

    statusText = new TextView(this);
    statusText.setTextColor(0xffeeeeee);
    statusText.setTextSize(13);
    statusText.setGravity(Gravity.CENTER);
    statusText.setPadding(dp(16), dp(10), dp(16), dp(10));
    statusText.setBackground(glassBackground(0xaa000000, dp(18)));
    FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    statusParams.leftMargin = dp(16);
    statusParams.rightMargin = dp(16);
    statusParams.bottomMargin = dp(26);
    root.addView(statusText, statusParams);

    setContentView(root);
  }

  private void startPlayer() {
    if (url.isEmpty()) {
      showFatal("Live url is empty");
      return;
    }
    released = false;
    releasing = false;
    handler.removeCallbacksAndMessages(null);
    setStatus("Connecting with ExoPlayer..." + candidateStatus());
    releasePlayers();
    if (isRtmp(url)) {
      triedExoForCurrentUrl = true;
      triedIjkForCurrentUrl = false;
      startExoPlayer(true);
    } else if (isRtmpOrFlv(url)) {
      triedExoForCurrentUrl = true;
      triedIjkForCurrentUrl = false;
      startExoPlayer(false);
    }
    else startExoPlayer(false);
  }

  private void startExoPlayer(boolean forceRtmpFactory) {
    try {
      exoSurfaceView = new SurfaceView(this);
      playerHost.addView(exoSurfaceView, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

      DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
          .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, PLAYBACK_BUFFER_MS, REBUFFER_MS)
          .setPrioritizeTimeOverSizeThresholds(true)
          .build();
      exoPlayer = new ExoPlayer.Builder(this).setLoadControl(loadControl).build();
      exoPlayer.setVideoSurfaceView(exoSurfaceView);
      DataSource.Factory dataSourceFactory = forceRtmpFactory
          ? new RtmpDataSource.Factory()
          : new DefaultDataSource.Factory(this);
      exoPlayer.setMediaSource(new ProgressiveMediaSource.Factory(dataSourceFactory)
          .createMediaSource(MediaItem.fromUri(Uri.parse(url))));
      exoPlayer.setPlayWhenReady(true);
      exoPlayer.addListener(new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
          if (state == Player.STATE_READY) {
            retryCount = 0;
            Log.i(TAG, "ExoPlayer ready for " + safeUrl(url));
            setStatus("Playing");
          } else if (state == Player.STATE_BUFFERING) {
            setStatus("Buffering with ExoPlayer...");
          } else if (state == Player.STATE_ENDED) {
            scheduleRetry("Stream ended");
          }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
          Log.e(TAG, "ExoPlayer playback failed for " + safeUrl(url), error);
          scheduleRetry("Playback failed: " + safeMessage(error));
        }
      });
      exoPlayer.prepare();
    } catch (Throwable error) {
      scheduleRetry("Player init failed: " + safeMessage(error));
    }
  }

  private void startIjkPlayer() {
    if (!ensureIjkReady()) {
      showFatal("RTMP engine is not available");
      return;
    }

    videoWidth = 0;
    videoHeight = 0;
    videoSarNum = 1;
    videoSarDen = 1;

    ijkSurfaceBox = new FrameLayout(this);
    playerHost.addView(ijkSurfaceBox, new FrameLayout.LayoutParams(-1, -1));

    ijkSurfaceView = new SurfaceView(this);
    ijkSurfaceBox.addView(ijkSurfaceView, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    ijkSurfaceBox.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> resizeIjkSurface());
    ijkSurfaceCallback = new SurfaceHolder.Callback() {
      @Override
      public void surfaceCreated(SurfaceHolder holder) {
        prepareIjk(holder);
      }

      @Override
      public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (ijkPlayer != null) ijkPlayer.setDisplay(holder);
      }

      @Override
      public void surfaceDestroyed(SurfaceHolder holder) {
        if (ijkPlayer != null) ijkPlayer.setDisplay(null);
      }
    };
    ijkSurfaceView.getHolder().addCallback(ijkSurfaceCallback);
  }

  private void prepareIjk(SurfaceHolder holder) {
    if (released || releasing || holder == null || !holder.getSurface().isValid()) return;
    try {
      releaseIjkPlayerOnly();
      if (released || releasing || holder == null || !holder.getSurface().isValid()) return;
      ijkPlayer = new IjkMediaPlayer();
      applyIjkOptions(ijkPlayer);
      ijkPlayer.setDisplay(holder);
      ijkPlayer.setDataSource(url);
      ijkPlayer.setOnPreparedListener(IMediaPlayer::start);
      ijkPlayer.setOnVideoSizeChangedListener((mp, width, height, sarNum, sarDen) -> {
        videoWidth = width;
        videoHeight = height;
        videoSarNum = sarNum <= 0 ? 1 : sarNum;
        videoSarDen = sarDen <= 0 ? 1 : sarDen;
        resizeIjkSurface();
      });
      ijkPlayer.setOnInfoListener((mp, what, extra) -> {
        if (what == IMediaPlayer.MEDIA_INFO_BUFFERING_START) setStatus("Buffering...");
        if (what == IMediaPlayer.MEDIA_INFO_BUFFERING_END) setStatus("Playing");
        if (what == IMediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
          retryCount = 0;
          setStatus("Playing");
        }
        return false;
      });
      ijkPlayer.setOnErrorListener((mp, what, extra) -> {
        scheduleRetry("RTMP playback failed: " + what + "/" + extra);
        return true;
      });
      ijkPlayer.setOnCompletionListener(mp -> scheduleRetry("Stream ended"));
      ijkPlayer.prepareAsync();
    } catch (IOException error) {
      scheduleRetry("Open stream failed: " + safeMessage(error));
    } catch (Throwable error) {
      scheduleRetry("RTMP player init failed: " + safeMessage(error));
    }
  }

  private void applyIjkOptions(IjkMediaPlayer player) {
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "start-on-prepared", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "packet-buffering", 0);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "framedrop", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec", 0);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "mediacodec-auto-rotate", 0);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "opensles", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_PLAYER, "infbuf", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "rtmp_live", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "reconnect", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "rw_timeout", 12000000);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "fflags", "nobuffer");
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "flush_packets", 1);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "probesize", 32768);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "analyzeduration", 100000);
    player.setOption(IjkMediaPlayer.OPT_CATEGORY_FORMAT, "max-buffer-size", 262144);
  }

  private void resizeIjkSurface() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      handler.post(this::resizeIjkSurface);
      return;
    }
    if (ijkSurfaceView == null || ijkSurfaceBox == null || videoWidth <= 0 || videoHeight <= 0) return;
    int boxWidth = ijkSurfaceBox.getWidth();
    int boxHeight = ijkSurfaceBox.getHeight();
    if (boxWidth <= 0 || boxHeight <= 0) return;

    float displayAspect = (float) boxWidth / (float) boxHeight;
    float videoAspect = ((float) videoWidth * (float) videoSarNum / (float) videoSarDen) / (float) videoHeight;
    int targetWidth = boxWidth;
    int targetHeight = boxHeight;
    if (videoAspect > displayAspect) {
      targetHeight = Math.max(1, Math.round(boxWidth / videoAspect));
    } else {
      targetWidth = Math.max(1, Math.round(boxHeight * videoAspect));
    }
    FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(targetWidth, targetHeight, Gravity.CENTER);
    ijkSurfaceView.setLayoutParams(params);
  }

  private void scheduleRetry(String reason) {
    if (released) return;
    if (tryNextCandidate(reason)) return;
    if (retryCount >= MAX_RETRY) {
      showFatal(reason + "\nRetried " + MAX_RETRY + " times and still failed.");
      return;
    }
    retryCount += 1;
    setStatus(reason + "\nRetrying in 2s (" + retryCount + "/" + MAX_RETRY + ")" + candidateStatus());
    handler.postDelayed(() -> {
      if (!released) startPlayer();
    }, RETRY_DELAY_MS);
  }

  private void manualRetry() {
    retryCount = 0;
    urlIndex = 0;
    triedExoForCurrentUrl = false;
    triedIjkForCurrentUrl = false;
    if (!urlCandidates.isEmpty()) url = urlCandidates.get(0);
    startPlayer();
  }

  private boolean tryNextCandidate(String reason) {
    if (urlCandidates.size() <= 1 || urlIndex >= urlCandidates.size() - 1) return false;
    urlIndex += 1;
    url = urlCandidates.get(urlIndex);
    retryCount = 0;
    triedExoForCurrentUrl = false;
    triedIjkForCurrentUrl = false;
    setStatus(reason + "\nSwitching stream " + (urlIndex + 1) + "/" + urlCandidates.size());
    handler.postDelayed(() -> {
      if (!released) startPlayer();
    }, 500L);
    return true;
  }

  private String candidateStatus() {
    return urlCandidates.size() > 1 ? "\nStream " + (urlIndex + 1) + "/" + urlCandidates.size() : "";
  }

  private void toggleOrientation() {
    isLandscape = !isLandscape;
    setRequestedOrientation(isLandscape
        ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
  }

  @Override
  protected void onResume() {
    super.onResume();
    released = false;
    try {
      if (exoPlayer != null) exoPlayer.play();
      if (ijkPlayer != null && !ijkPlayer.isPlaying()) ijkPlayer.start();
    } catch (Throwable ignored) {
    }
  }

  @Override
  protected void onPause() {
    try {
      if (!isFinishing()) {
        if (exoPlayer != null) exoPlayer.pause();
        if (ijkPlayer != null && ijkPlayer.isPlaying()) {
          try {
            ijkPlayer.pause();
          } catch (IllegalStateException ignored) {
          }
        }
      }
    } catch (Throwable ignored) {
    }
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    released = true;
    handler.removeCallbacksAndMessages(null);
    releasePlayers();
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    super.onDestroy();
  }

  private void releasePlayers() {
    releasing = true;
    releaseExo();
    releaseIjk();
    if (playerHost != null) playerHost.removeAllViews();
    releasing = false;
  }

  private void releaseExo() {
    try {
      if (exoPlayer != null) {
        if (exoSurfaceView != null) exoPlayer.clearVideoSurfaceView(exoSurfaceView);
        exoPlayer.release();
      }
    } catch (Throwable ignored) {
    } finally {
      exoPlayer = null;
      exoSurfaceView = null;
    }
  }

  private void releaseIjk() {
    try {
      if (ijkSurfaceView != null && ijkSurfaceCallback != null) {
        ijkSurfaceView.getHolder().removeCallback(ijkSurfaceCallback);
      }
      releaseIjkPlayerOnly();
    } catch (Throwable ignored) {
    } finally {
      ijkSurfaceView = null;
      ijkSurfaceCallback = null;
      ijkSurfaceBox = null;
    }
  }

  private void releaseIjkPlayerOnly() {
    try {
      if (ijkPlayer != null) {
        ijkPlayer.setDisplay(null);
        ijkPlayer.setOnPreparedListener(null);
        ijkPlayer.setOnInfoListener(null);
        ijkPlayer.setOnErrorListener(null);
        ijkPlayer.setOnCompletionListener(null);
        ijkPlayer.setOnVideoSizeChangedListener(null);
        try {
          ijkPlayer.stop();
        } catch (IllegalStateException ignored) {
        }
        ijkPlayer.release();
      }
    } catch (Throwable ignored) {
    } finally {
      ijkPlayer = null;
    }
  }

  private void showFatal(String message) {
    runOnUiThread(() -> {
      setStatusNow(message);
      if (isFinishing() || isDestroyed()) return;
      new AlertDialog.Builder(this)
          .setTitle("直播播放失败")
          .setMessage(message)
          .setPositiveButton("重试", (d, w) -> manualRetry())
          .setNegativeButton("关闭", (d, w) -> finish())
          .show();
    });
  }

  private void showGiftHint() {
    runOnUiThread(() -> {
      if (isFinishing() || isDestroyed()) return;
      if (liveId.isEmpty()) {
        new AlertDialog.Builder(this)
            .setTitle("????")
            .setMessage("?????? liveId??????????")
            .setPositiveButton("????", null)
            .show();
        return;
      }
      LivePlayerModule.requestGiftPanel(liveId, acceptUserId);
      finish();
    });
  }

  private boolean ensureIjkReady() {
    if (IJK_READY.get()) return true;
    try {
      IjkMediaPlayer.loadLibrariesOnce(null);
      IJK_READY.set(true);
      return true;
    } catch (Throwable error) {
      setStatus("RTMP engine init failed: " + safeMessage(error));
      return false;
    }
  }

  private boolean isRtmpOrFlv(String value) {
    String lower = value.toLowerCase();
    return lower.startsWith("rtmp://") || lower.contains(".flv");
  }

  private boolean isRtmp(String value) {
    return value != null && value.toLowerCase().startsWith("rtmp://");
  }

  private String safeUrl(String value) {
    if (value == null) return "";
    int queryIndex = value.indexOf('?');
    return queryIndex >= 0 ? value.substring(0, queryIndex) + "?..." : value;
  }

  private void setStatus(String text) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      setStatusNow(text);
    } else {
      handler.post(() -> setStatusNow(text));
    }
  }

  private void setStatusNow(String text) {
    if (statusText != null) statusText.setText(text == null ? "" : text);
  }

  private String clean(String value) {
    return value == null ? "" : value.trim();
  }

  private String safeMessage(Throwable error) {
    if (error == null) return "unknown";
    String message = error.getMessage();
    return message == null || message.trim().isEmpty() ? error.getClass().getSimpleName() : message;
  }

  private int dp(int value) {
    return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
  }

  private TextView actionButton(String text) {
    TextView button = new TextView(this);
    button.setText(text);
    button.setTextColor(Color.WHITE);
    button.setTextSize(14);
    button.setGravity(Gravity.CENTER);
    button.setBackground(glassBackground(0x33ffffff, dp(20)));
    return button;
  }

  private GradientDrawable glassBackground(int color, int radius) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(color);
    drawable.setCornerRadius(radius);
    drawable.setStroke(1, 0x55ffffff);
    return drawable;
  }
}
