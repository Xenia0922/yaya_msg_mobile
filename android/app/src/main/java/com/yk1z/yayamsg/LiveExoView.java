package com.yk1z.yayamsg;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.DefaultLoadControl;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.audio.AudioAttributes;
import com.google.android.exoplayer2.ext.rtmp.RtmpDataSource;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DataSource;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.video.VideoSize;

public class LiveExoView extends FrameLayout {
  private static final int MIN_BUFFER_MS = 6000;
  private static final int MAX_BUFFER_MS = 20000;
  private static final int PLAYBACK_BUFFER_MS = 1500;
  private static final int REBUFFER_MS = 3000;
  private static final int MAX_RETRY = 3;
  private static final long RETRY_DELAY_MS = 1000L;
  private static final long BUFFERING_STALL_MS = 6000L;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final TextureView textureView;
  private final TextView statusText;
  private ExoPlayer player;
  private String url = "";
  private int retryCount = 0;
  private int videoWidth = 0;
  private int videoHeight = 0;
  private float videoPixelRatio = 1f;
  private int videoUnappliedRotation = 0;
  private boolean detectedLandscape = false;
  private boolean detectedPillarboxed = false;
  private float detectedInnerRatio = 0f;
  private boolean released = false;
  private boolean audioOnly = false;
  private boolean coverPortrait = false;

  private volatile boolean paused = false;
  private final com.facebook.react.uimanager.ThemedReactContext reactContext;
  private SurfaceTexture lastSurfaceTexture = null;
  private boolean lastInPip = false;
  private final Runnable bufferingStallRunnable = () -> {
    if (released || paused || player == null) return;
    if (player.getPlaybackState() == Player.STATE_BUFFERING) {
      scheduleRetry("Buffering timeout");
    }
  };

  public LiveExoView(Context context) {
    super(context);
    this.reactContext = (context instanceof com.facebook.react.uimanager.ThemedReactContext)
        ? (com.facebook.react.uimanager.ThemedReactContext) context : null;
    setBackgroundColor(Color.BLACK);
    setClipChildren(false);
    setClipToPadding(false);
    textureView = new TextureView(context);
    addView(textureView, new LayoutParams(-1, -1, Gravity.CENTER));

    textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
      @Override
      public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        lastSurfaceTexture = null;
        ensurePlayerSurface();
        applyAspectTransform();
      }

      @Override
      public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        applyAspectTransform(width, height);
        post(() -> applyAspectTransform());
      }

      @Override
      public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        lastSurfaceTexture = null;
        if (player != null) {
          try {
            player.clearVideoTextureView(textureView);
          } catch (Throwable ignored) {
          }
        }
        return true;
      }

      @Override
      public void onSurfaceTextureUpdated(SurfaceTexture surface) {

      }
    });
    applyAudioOnlyPresentation();

    statusText = new TextView(context);
    statusText.setTextColor(0xffeeeeee);
    statusText.setTextSize(12);
    statusText.setGravity(Gravity.CENTER);
    statusText.setPadding(dp(10), dp(6), dp(10), dp(6));
    statusText.setBackgroundColor(0xaa000000);
    LayoutParams statusParams = new LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    statusParams.bottomMargin = dp(12);
    addView(statusText, statusParams);

    addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
      ensurePlayerSurface();
      applyAspectTransform();
    });

    this.decorLayoutListener = (v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
      if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
        post(() -> {

          requestLayout();
          ensurePlayerSurface();
          applyAspectTransform();
        });
      }
    };
  }

  public void setAudioOnly(boolean audioOnly) {
    if (this.audioOnly == audioOnly) return;
    this.audioOnly = audioOnly;
    applyAudioOnlyPresentation();

    if (!url.isEmpty()) {
      start();
    }
  }

  private void applyAudioOnlyPresentation() {
    if (audioOnly) {
      setBackgroundColor(Color.TRANSPARENT);
      textureView.setVisibility(View.GONE);
    } else {
      setBackgroundColor(Color.BLACK);
      textureView.setVisibility(View.VISIBLE);
    }
  }

  public void setPaused(boolean p) {
    paused = p;
    if (p) {
      handler.removeCallbacks(bufferingStallRunnable);
    } else if (!released && player != null && player.getPlaybackState() == Player.STATE_BUFFERING) {
      handler.removeCallbacks(bufferingStallRunnable);
      handler.postDelayed(bufferingStallRunnable, BUFFERING_STALL_MS);
    }
    if (player != null) {
      try {
        player.setPlayWhenReady(!p);
      } catch (Throwable ignored) {
      }
    }
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
    videoWidth = 0;
    videoHeight = 0;
    videoPixelRatio = 1f;
    videoUnappliedRotation = 0;
    detectedLandscape = false;
    detectedPillarboxed = false;
    detectedInnerRatio = 0f;
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
      if (audioOnly) {

        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(), true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
      } else {
        player.setVideoTextureView(textureView);
        lastSurfaceTexture = textureView.isAvailable() ? textureView.getSurfaceTexture() : null;
        lastInPip = isInPip();
      }
      DataSource.Factory factory = isRtmp(url)
          ? new RtmpDataSource.Factory()
          : new DefaultDataSource.Factory(getContext());
      player.setMediaSource(new ProgressiveMediaSource.Factory(factory)
          .createMediaSource(MediaItem.fromUri(Uri.parse(url))));
      player.setPlayWhenReady(!paused);
      player.addListener(new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
          if (state == Player.STATE_READY) {
            handler.removeCallbacks(bufferingStallRunnable);
            retryCount = 0;
            setStatus("Playing");
            handler.postDelayed(() -> probeOrientationAndEmit(false), 250L);
            handler.postDelayed(() -> probeOrientationAndEmit(false), 900L);
          } else if (state == Player.STATE_BUFFERING) {
            setStatus("Buffering...");
            handler.removeCallbacks(bufferingStallRunnable);
            if (!paused && !released) {

              handler.postDelayed(bufferingStallRunnable, BUFFERING_STALL_MS);
            }
          } else if (state == Player.STATE_ENDED) {
            handler.removeCallbacks(bufferingStallRunnable);
            scheduleRetry("Stream ended");
          }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
          handler.removeCallbacks(bufferingStallRunnable);
          scheduleRetry("Playback failed");
        }

        @Override
        public void onVideoSizeChanged(VideoSize videoSize) {
          if (audioOnly) return;
          videoWidth = videoSize.width;
          videoHeight = videoSize.height;
          videoPixelRatio = videoSize.pixelWidthHeightRatio <= 0f ? 1f : videoSize.pixelWidthHeightRatio;
          videoUnappliedRotation = ((videoSize.unappliedRotationDegrees % 360) + 360) % 360;
          detectedLandscape = false;
          detectedPillarboxed = false;
          detectedInnerRatio = 0f;
          applyAspectTransform();
          if (videoWidth > 0 && videoHeight > 0) {
            final String sizeUrl = url;
            probeOrientationAndEmit(true);
            handler.postDelayed(() -> {
              if (sizeUrl.equals(url)) probeOrientationAndEmit(false);
            }, 350L);
            handler.postDelayed(() -> {
              if (sizeUrl.equals(url)) probeOrientationAndEmit(false);
            }, 1000L);
            handler.postDelayed(() -> {
              if (sizeUrl.equals(url)) probeOrientationAndEmit(false);
            }, 2000L);
          }
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

      emitErrorToJs(reason);
      return;
    }
    retryCount += 1;
    setStatus(reason + ", retrying " + retryCount + "/" + MAX_RETRY);
    handler.postDelayed(this::start, RETRY_DELAY_MS);
  }

  private void emitErrorToJs(String reason) {

    LivePlayerModule.emitLiveError(url, reason);
    if (reactContext == null) return;
    try {
      com.facebook.react.uimanager.UIManagerModule uiManager =
          reactContext.getNativeModule(com.facebook.react.uimanager.UIManagerModule.class);
      if (uiManager != null) {
        uiManager.getEventDispatcher().dispatchEvent(new LiveExoErrorEvent(getId(), reason));
      }
    } catch (Throwable ignored) {
    }
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

  private Activity getActivity() {
    Context ctx = getContext();
    if (ctx instanceof com.facebook.react.uimanager.ThemedReactContext) {
      return ((com.facebook.react.uimanager.ThemedReactContext) ctx).getCurrentActivity();
    }
    while (ctx instanceof android.content.ContextWrapper) {
      if (ctx instanceof Activity) return (Activity) ctx;
      ctx = ((android.content.ContextWrapper) ctx).getBaseContext();
    }
    return null;
  }

  private boolean isInPip() {
    Activity a = getActivity();
    if (a != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      return a.isInPictureInPictureMode() || PipModule.isCompactWindowMode();
    }
    return PipModule.isInPipMode() || PipModule.isCompactWindowMode();
  }

  private int getRealWindowWidth() {
    Activity a = getActivity();
    if (a == null) {
      a = PipModule.getAppActivity();
    }
    if (a != null && a.getWindow() != null) {
      View decor = a.getWindow().getDecorView();
      if (decor != null && decor.getWidth() > 0) {
        return decor.getWidth();
      }
    }
    return getWidth();
  }

  private int getRealWindowHeight() {
    Activity a = getActivity();
    if (a == null) {
      a = PipModule.getAppActivity();
    }
    if (a != null && a.getWindow() != null) {
      View decor = a.getWindow().getDecorView();
      if (decor != null && decor.getHeight() > 0) {
        return decor.getHeight();
      }
    }
    return getHeight();
  }

  private void ensurePlayerSurface() {
    if (player != null && !audioOnly && textureView != null && textureView.isAvailable()) {
      SurfaceTexture st = textureView.getSurfaceTexture();
      boolean inPip = isInPip();
      if (st != null && st != lastSurfaceTexture) {
        lastSurfaceTexture = st;
        lastInPip = inPip;
        try {

          player.setVideoTextureView(textureView);
          player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
          textureView.postInvalidateOnAnimation();
          handler.postDelayed(this::applyAspectTransform, 120L);
          handler.postDelayed(this::applyAspectTransform, 400L);
        } catch (Throwable ignored) {
        }
      } else if (st != null && inPip != lastInPip) {
        lastInPip = inPip;
        requestLayout();
        invalidate();
        textureView.requestLayout();
        applyAspectTransform();
        textureView.invalidate();
        textureView.postInvalidateOnAnimation();
        handler.postDelayed(() -> {
          if (released || player == null || audioOnly || !textureView.isAvailable()) return;

          if (isInPip() == lastInPip && textureView.getSurfaceTexture() == lastSurfaceTexture) {
            try {
              player.clearVideoTextureView(textureView);
              player.setVideoTextureView(textureView);
              player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
            } catch (Throwable ignored) {
            }
          }
          textureView.requestLayout();
          applyAspectTransform();
          textureView.invalidate();
          textureView.postInvalidateOnAnimation();
        }, 140L);
        handler.postDelayed(() -> {
          ensurePlayerSurface();
          applyAspectTransform();
          textureView.postInvalidateOnAnimation();
        }, 360L);
      }
    }
  }

  private View.OnLayoutChangeListener decorLayoutListener;

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    Activity a = getActivity();
    if (a == null) {
      a = PipModule.getAppActivity();
    }
    if (a != null && a.getWindow() != null) {
      a.getWindow().getDecorView().addOnLayoutChangeListener(decorLayoutListener);
    }
    ensurePlayerSurface();
  }

  @Override
  protected void onDetachedFromWindow() {
    Activity a = getActivity();
    if (a == null) {
      a = PipModule.getAppActivity();
    }
    if (a != null && a.getWindow() != null) {
      a.getWindow().getDecorView().removeOnLayoutChangeListener(decorLayoutListener);
    }
    super.onDetachedFromWindow();
  }

  @Override
  protected void onWindowVisibilityChanged(int visibility) {
    super.onWindowVisibilityChanged(visibility);
    if (visibility == View.VISIBLE) {

      handler.postDelayed(this::ensurePlayerSurface, 80L);
      handler.postDelayed(this::applyAspectTransform, 140L);
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasWindowFocus) {
    super.onWindowFocusChanged(hasWindowFocus);
    if (hasWindowFocus) {
      handler.postDelayed(this::ensurePlayerSurface, 80L);
    }
  }

  @Override
  protected void onConfigurationChanged(android.content.res.Configuration newConfig) {
    super.onConfigurationChanged(newConfig);
    post(() -> {
      ensurePlayerSurface();
      requestLayout();
      applyAspectTransform();
    });
  }

  @Override
  protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {

    super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    int w = getMeasuredWidth();
    int h = getMeasuredHeight();
    if (w > 0 && h > 0) {
      textureView.measure(
          MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY));
    }
  }

  @Override
  protected void onLayout(boolean changed, int left, int top, int right, int bottom) {

    int w = Math.max(0, right - left);
    int h = Math.max(0, bottom - top);
    textureView.layout(0, 0, w, h);
    if (statusText.getVisibility() != View.GONE) {
      int tw = statusText.getMeasuredWidth();
      int th = statusText.getMeasuredHeight();
      int sx = (w - tw) / 2;
      int sy = h - th - dp(12);
      statusText.layout(sx, sy, sx + tw, sy + th);
    }
    ensurePlayerSurface();
    applyAspectTransform();
  }

  public void setCoverPortrait(boolean coverPortrait) {
    this.coverPortrait = coverPortrait;
    applyAspectTransform();
  }

  private void probeOrientationAndEmit(boolean allowUnsettledEmit) {
    if (audioOnly || videoWidth <= 0 || videoHeight <= 0 || released) return;
    boolean rotated = videoUnappliedRotation == 90 || videoUnappliedRotation == 270;
    int effW = rotated ? videoHeight : videoWidth;
    int effH = rotated ? videoWidth : videoHeight;
    if (effW <= 0 || effH <= 0) return;

    int visualW = effW;
    int visualH = effH;
    boolean nextLandscape = false;
    boolean nextPillarboxed = false;
    boolean settled = true;

    float nextInnerRatio = 0f;

    if (effW > effH) {
      Bitmap bmp = null;
      try {
        if (textureView.isAvailable() && textureView.getWidth() > 0 && textureView.getHeight() > 0) {
          bmp = textureView.getBitmap(32, 18);
        }
      } catch (Throwable ignored) {
      }
      if (bmp == null) {
        settled = false;
      } else {
        try {
          int[] colMax = new int[32];
          int[] colMin = new int[32];
          int globalMax = 0;
          for (int x = 0; x < 32; x++) {
            colMax[x] = 0;
            colMin[x] = 255;
            for (int y = 3; y <= 14; y++) {
              int c = bmp.getPixel(x, y);
              int r = (c >> 16) & 0xff;
              int g = (c >> 8) & 0xff;
              int b = c & 0xff;
              int luma = (r * 299 + g * 587 + b * 114) / 1000;
              if (luma > colMax[x]) colMax[x] = luma;
              if (luma < colMin[x]) colMin[x] = luma;
            }
            if (x >= 1 && x <= 30 && colMax[x] > globalMax) globalMax = colMax[x];
          }
          int firstLit = -1;
          int lastLit = -1;
          for (int x = 1; x <= 30; x++) {
            boolean isBlackCol = colMax[x] <= 20 && (colMax[x] - colMin[x]) <= 12;
            if (!isBlackCol) {
              if (firstLit < 0) firstLit = x;
              lastLit = x;
            }
          }
          if (globalMax < 20) {
            settled = false;
          } else if (firstLit >= 5 && lastLit <= 26 && (lastLit - firstLit + 1) <= 22) {

            float activeFrac = (float) (lastLit - firstLit + 1) / 32f;
            float baseRatio = ((float) effW * videoPixelRatio) / (float) effH;
            nextInnerRatio = Math.max(0.45f, Math.min(0.85f, baseRatio * activeFrac));
            nextPillarboxed = true;
            nextLandscape = false;
            visualW = Math.max(1, Math.round(effH * nextInnerRatio));
          } else {
            nextPillarboxed = false;
            nextLandscape = true;
          }
        } finally {
          bmp.recycle();
        }
      }
    }

    if (!settled) {
      if (!allowUnsettledEmit) return;
      visualW = Math.max(1, Math.round(effH * 9f / 16f));
      visualH = effH;
      nextLandscape = false;
      nextPillarboxed = false;
    } else {
      boolean changed = (nextLandscape != detectedLandscape)
          || (nextPillarboxed != detectedPillarboxed)
          || Math.abs(nextInnerRatio - detectedInnerRatio) > 0.04f;
      detectedLandscape = nextLandscape;
      detectedPillarboxed = nextPillarboxed;
      detectedInnerRatio = nextInnerRatio;
      if (changed) {
        applyAspectTransform();
      }
    }

    dispatchSizeToJs(videoWidth, videoHeight, visualW, visualH, detectedLandscape, detectedPillarboxed);
  }

  private void dispatchSizeToJs(
      int w,
      int h,
      int visualW,
      int visualH,
      boolean isLandscape,
      boolean isPillarboxed) {
    if (reactContext == null || w <= 0 || h <= 0) return;
    try {
      com.facebook.react.uimanager.UIManagerModule uiManager =
          reactContext.getNativeModule(com.facebook.react.uimanager.UIManagerModule.class);
      if (uiManager != null) {
        uiManager.getEventDispatcher().dispatchEvent(
            new LiveSizeEvent(getId(), w, h, visualW, visualH, isLandscape, isPillarboxed));
      }
    } catch (Throwable ignored) {
    }
    final String sizeUrl = url;
    handler.post(() ->
        LivePlayerModule.emitLiveSize(sizeUrl, w, h, visualW, visualH, isLandscape, isPillarboxed));
  }

  private void applyAspectTransform() {
    applyAspectTransform(0, 0);
  }

  private void applyAspectTransform(int explicitW, int explicitH) {
    if (audioOnly) return;

    int hostW = explicitW > 0 ? explicitW : textureView.getWidth();
    int hostH = explicitH > 0 ? explicitH : textureView.getHeight();
    if (hostW <= 0) hostW = getWidth();
    if (hostH <= 0) hostH = getHeight();
    if (hostW <= 0 || hostH <= 0 || videoWidth <= 0 || videoHeight <= 0) return;

    boolean inPip = isInPip();
    boolean rotated = videoUnappliedRotation == 90 || videoUnappliedRotation == 270;
    float effW = rotated ? (float) videoHeight : (float) videoWidth;
    float effH = rotated ? (float) videoWidth : (float) videoHeight;
    float videoRatio = (effW * videoPixelRatio) / effH;
    float hostRatio = (float) hostW / (float) hostH;

    float targetW;
    float targetH;

    if (detectedPillarboxed && !inPip && coverPortrait && hostRatio < 1f && videoRatio > 1.05f) {

      float innerRatio = (detectedInnerRatio > 0.4f && detectedInnerRatio < 0.9f)
          ? detectedInnerRatio
          : (9f / 16f);
      float innerW = innerRatio > hostRatio ? hostW : hostH * innerRatio;
      targetW = innerW * (videoRatio / innerRatio);
      targetH = targetW / videoRatio;
    } else if (detectedPillarboxed && inPip && hostRatio < 0.85f && videoRatio > 1.05f) {

      float innerRatio = (detectedInnerRatio > 0.4f && detectedInnerRatio < 0.9f)
          ? detectedInnerRatio
          : (9f / 16f);
      float contentScale = Math.min((float) hostW / innerRatio, (float) hostH);
      float innerW = contentScale * innerRatio;
      targetW = innerW * (videoRatio / innerRatio);
      targetH = targetW / videoRatio;
    } else if (coverPortrait && !inPip && videoRatio < 1f && hostRatio < 1f) {

      if (videoRatio > hostRatio) {
        targetH = hostH;
        targetW = hostH * videoRatio;
      } else {
        targetW = hostW;
        targetH = hostW / videoRatio;
      }
    } else {

      if (videoRatio > hostRatio) {
        targetW = hostW;
        targetH = hostW / videoRatio;
      } else {
        targetH = hostH;
        targetW = hostH * videoRatio;
      }
    }

    int tw = explicitW > 0 ? explicitW : textureView.getWidth();
    int th = explicitH > 0 ? explicitH : textureView.getHeight();
    if (tw <= 0) tw = hostW;
    if (th <= 0) th = hostH;

    float preW = rotated ? targetH : targetW;
    float preH = rotated ? targetW : targetH;
    float sx = preW / (float) tw;
    float sy = preH / (float) th;

    Matrix matrix = new Matrix();
    matrix.setScale(sx, sy, tw / 2f, th / 2f);
    if (videoUnappliedRotation != 0) {
      matrix.postRotate(videoUnappliedRotation, tw / 2f, th / 2f);
    }
    textureView.setTransform(matrix);
  }

  private boolean isRtmp(String value) {
    if (value == null) return false;
    String lower = value.toLowerCase();
    return lower.startsWith("rtmp://") || lower.startsWith("rtmps://");
  }

  private void setStatus(String text) {
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

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
