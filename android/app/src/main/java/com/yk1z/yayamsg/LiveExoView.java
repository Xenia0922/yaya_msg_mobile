package com.yk1z.yayamsg;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.DefaultLoadControl;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.ext.rtmp.RtmpDataSource;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DataSource;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.video.VideoSize;

public class LiveExoView extends FrameLayout {
  private static final int MIN_BUFFER_MS = 500;
  private static final int MAX_BUFFER_MS = 1000;
  private static final int PLAYBACK_BUFFER_MS = 250;
  private static final int REBUFFER_MS = 500;
  private static final int MAX_RETRY = 5;
  private static final long RETRY_DELAY_MS = 1600L;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final TextureView textureView;
  private final TextView statusText;
  private ExoPlayer player;
  private String url = "";
  private int retryCount = 0;
  private int videoWidth = 0;
  private int videoHeight = 0;
  private float videoPixelRatio = 1f;
  private boolean released = false;

  public LiveExoView(Context context) {
    super(context);
    setBackgroundColor(Color.BLACK);
    textureView = new TextureView(context);
    addView(textureView, new LayoutParams(-1, -1, Gravity.CENTER));

    statusText = new TextView(context);
    statusText.setTextColor(0xffeeeeee);
    statusText.setTextSize(12);
    statusText.setGravity(Gravity.CENTER);
    statusText.setPadding(dp(10), dp(6), dp(10), dp(6));
    statusText.setBackgroundColor(0xaa000000);
    LayoutParams statusParams = new LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    statusParams.bottomMargin = dp(12);
    addView(statusText, statusParams);

    addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> applyAspectTransform());
  }

  public void setUrl(@Nullable String nextUrl) {
    String cleaned = nextUrl == null ? "" : nextUrl.trim();
    if (cleaned.equals(url)) return;
    url = cleaned;
    retryCount = 0;
    released = false;
    start();
  }

  public void stop() {
    released = true;
    handler.removeCallbacksAndMessages(null);
    releasePlayer();
  }

  private void start() {
    handler.removeCallbacksAndMessages(null);
    releasePlayer();
    if (url.isEmpty()) {
      setStatus("No live url");
      return;
    }
    setStatus("Connecting...");
    try {
      DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
          .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, PLAYBACK_BUFFER_MS, REBUFFER_MS)
          .setPrioritizeTimeOverSizeThresholds(true)
          .build();
      player = new ExoPlayer.Builder(getContext()).setLoadControl(loadControl).build();
      player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
      player.setVideoTextureView(textureView);
      DataSource.Factory factory = isRtmp(url)
          ? new RtmpDataSource.Factory()
          : new DefaultDataSource.Factory(getContext());
      player.setMediaSource(new ProgressiveMediaSource.Factory(factory)
          .createMediaSource(MediaItem.fromUri(Uri.parse(url))));
      player.setPlayWhenReady(true);
      player.addListener(new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
          if (state == Player.STATE_READY) {
            retryCount = 0;
            setStatus("Playing");
          } else if (state == Player.STATE_BUFFERING) {
            setStatus("Buffering...");
          } else if (state == Player.STATE_ENDED) {
            scheduleRetry("Stream ended");
          }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
          scheduleRetry("Playback failed");
        }

        @Override
        public void onVideoSizeChanged(VideoSize videoSize) {
          videoWidth = videoSize.width;
          videoHeight = videoSize.height;
          videoPixelRatio = videoSize.pixelWidthHeightRatio <= 0f ? 1f : videoSize.pixelWidthHeightRatio;
          applyAspectTransform();
        }
      });
      player.prepare();
    } catch (Throwable error) {
      scheduleRetry("Player init failed");
    }
  }

  private void scheduleRetry(String reason) {
    if (released) return;
    if (retryCount >= MAX_RETRY) {
      setStatus(reason);
      return;
    }
    retryCount += 1;
    setStatus(reason + ", retrying " + retryCount + "/" + MAX_RETRY);
    handler.postDelayed(this::start, RETRY_DELAY_MS);
  }

  private void releasePlayer() {
    try {
      if (player != null) {
        player.clearVideoTextureView(textureView);
        player.release();
      }
    } catch (Throwable ignored) {
    } finally {
      player = null;
    }
  }

  private void applyAspectTransform() {
    int hostW = getWidth();
    int hostH = getHeight();
    if (hostW <= 0 || hostH <= 0 || videoWidth <= 0 || videoHeight <= 0) return;
    float videoRatio = ((float) videoWidth * videoPixelRatio) / (float) videoHeight;
    float hostRatio = (float) hostW / (float) hostH;

    float scaleX = 1f;
    float scaleY = 1f;
    if (videoRatio > hostRatio) {
      scaleY = hostRatio / videoRatio;
    } else {
      scaleX = videoRatio / hostRatio;
    }

    Matrix matrix = new Matrix();
    matrix.setScale(scaleX, scaleY, hostW / 2f, hostH / 2f);
    textureView.setTransform(matrix);
  }

  private boolean isRtmp(String value) {
    return value.toLowerCase().startsWith("rtmp://");
  }

  private void setStatus(String text) {
    statusText.setText(text);
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
