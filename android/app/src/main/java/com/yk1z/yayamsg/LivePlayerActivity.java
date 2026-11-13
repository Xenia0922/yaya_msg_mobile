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
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
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

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

public class LivePlayerActivity extends Activity {
  public static final String EXTRA_URL = "url";
  public static final String EXTRA_URLS = "urls";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_LIVE_ID = "liveId";
  public static final String EXTRA_ACCEPT_USER_ID = "acceptUserId";
  public static final String EXTRA_LABELS = "labels";

  private static final int MIN_BUFFER_MS = 6000;
  private static final int MAX_BUFFER_MS = 20000;
  private static final int PLAYBACK_BUFFER_MS = 1500;
  private static final int REBUFFER_MS = 3000;
  private static final int MAX_RETRY = 5;
  private static final long RETRY_DELAY_MS = 2000L;
  private static final long STALL_TIMEOUT_MS = 8000L;
  private static final String TAG = "LivePlayerActivity";

  private final Handler handler = new Handler(Looper.getMainLooper());
  private FrameLayout playerHost;
  private TextView statusText;
  private TextView titleView;
  private SurfaceView exoSurfaceView;
  private ExoPlayer exoPlayer;
  private JSONObject labels = new JSONObject();
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
    String labelsRaw = clean(getIntent().getStringExtra(EXTRA_LABELS));
    if (!labelsRaw.isEmpty()) {
      try {
        labels = new JSONObject(labelsRaw);
      } catch (JSONException ignored) {
      }
    }
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

    TextView back = actionButton(L("back"));
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

    TextView rotate = actionButton(L("rotate"));
    rotate.setOnClickListener(v -> toggleOrientation());
    top.addView(rotate, new LinearLayout.LayoutParams(dp(64), dp(40)));

    TextView retry = actionButton(L("refresh"));
    retry.setOnClickListener(v -> manualRetry());
    retry.setBackground(glassBackground(0xccff6f91, dp(20)));
    LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(dp(72), dp(40));
    retryParams.leftMargin = dp(8);
    top.addView(retry, retryParams);

    TextView gift = actionButton(L("gift"));
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
    triedExoForCurrentUrl = true;
    startExoPlayer(isRtmp(url));
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
        private final Runnable stallCheck = new Runnable() {
          @Override public void run() {
            if (released || releasing) return;
            if (exoPlayer == null) return;
            int state = exoPlayer.getPlaybackState();
            if (state == Player.STATE_BUFFERING) {
              Log.w(TAG, "Stall timeout — player stuck buffering for " + safeUrl(url));
              scheduleRetry("Stream stalled");
            } else if (state == Player.STATE_IDLE) {
              scheduleRetry("Player idle");
            }
          }
        };

        @Override
        public void onPlaybackStateChanged(int state) {
          handler.removeCallbacks(stallCheck);
          if (state == Player.STATE_READY) {
            retryCount = 0;
            Log.i(TAG, "ExoPlayer ready for " + safeUrl(url));
            setStatus("Playing");
          } else if (state == Player.STATE_BUFFERING) {
            setStatus("Buffering...");
            handler.postDelayed(stallCheck, STALL_TIMEOUT_MS);
          } else if (state == Player.STATE_ENDED) {
            scheduleRetry("Stream ended");
          } else if (state == Player.STATE_IDLE) {
            handler.postDelayed(stallCheck, STALL_TIMEOUT_MS);
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
    if (!urlCandidates.isEmpty()) url = urlCandidates.get(0);
    startPlayer();
  }

  private boolean tryNextCandidate(String reason) {
    if (urlCandidates.size() <= 1 || urlIndex >= urlCandidates.size() - 1) return false;
    urlIndex += 1;
    url = urlCandidates.get(urlIndex);
    retryCount = 0;
    triedExoForCurrentUrl = false;
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
    } catch (Throwable ignored) {
    }
  }

  @Override
  protected void onPause() {
    try {
      if (!isFinishing()) {
        if (exoPlayer != null) exoPlayer.pause();
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

  private void showFatal(String message) {
    runOnUiThread(() -> {
      setStatusNow(message);
      if (isFinishing() || isDestroyed()) return;
      new AlertDialog.Builder(this)
          .setTitle(L("failTitle"))
          .setMessage(message)
          .setPositiveButton(L("retry"), (d, w) -> manualRetry())
          .setNegativeButton(L("close"), (d, w) -> finish())
          .show();
    });
  }

  private void showGiftHint() {
    runOnUiThread(() -> {
      if (isFinishing() || isDestroyed()) return;
      if (liveId.isEmpty()) {
        new AlertDialog.Builder(this)
            .setTitle(L("giftHintTitle"))
            .setMessage(L("giftHintMsg"))
            .setPositiveButton(L("giftOk"), null)
            .show();
        return;
      }
      LivePlayerModule.requestGiftPanel(liveId, acceptUserId);
      finish();
    });
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
    if (statusText == null) return;
    String value = text == null ? "" : text;
    String lower = value.toLowerCase();
    if (lower.contains("playing") || lower.contains("buffer")) {
      statusText.setVisibility(View.GONE);
      statusText.setText("");
      return;
    }
    statusText.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE);
    statusText.setText(value);
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

  private String L(String key) {
    String value = labels.optString(key, "");
    if (!value.isEmpty()) return value;
    switch (key) {
      case "back": return "返回";
      case "rotate": return "横屏";
      case "refresh": return "刷新";
      case "gift": return "礼物";
      case "failTitle": return "直播播放失败";
      case "retry": return "重试";
      case "close": return "关闭";
      case "giftHintTitle": return "提示";
      case "giftHintMsg": return "缺少 liveId，无法打开礼物面板";
      case "giftOk": return "确定";
      default: return key;
    }
  }
}