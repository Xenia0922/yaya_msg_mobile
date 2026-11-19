package com.yk1z.yayamsg;

import android.app.Activity;
import android.content.Context;
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
  private static final int MAX_RETRY = 2;
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
  private boolean audioOnly = false;
  private boolean coverPortrait = false;
  /** JS 显式暂停（统一播放器控制条用；默认 false=自动播，等同 v2.7.3 行为） */
  private volatile boolean paused = false;
  private final com.facebook.react.uimanager.ThemedReactContext reactContext;
  private SurfaceTexture lastSurfaceTexture = null;
  private boolean lastInPip = false;

  public LiveExoView(Context context) {
    super(context);
    this.reactContext = (context instanceof com.facebook.react.uimanager.ThemedReactContext)
        ? (com.facebook.react.uimanager.ThemedReactContext) context : null;
    setBackgroundColor(Color.BLACK);
    setClipChildren(false);
    setClipToPadding(false);
    textureView = new TextureView(context);
    addView(textureView, new LayoutParams(-1, -1, Gravity.CENTER));
    // SurfaceTexture 在系统 PiP 进入/退出、Activity 重建、TextureView 重新挂载时
    // 可能被销毁并重新创建；只在 layout 回调里 setVideoTextureView 会漏掉
    // 「surface 已可用但 layout 未变化」的恢复路径，表现为切回全屏黑屏。
    textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
      @Override
      public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        lastSurfaceTexture = null;
        ensurePlayerSurface();
        applyAspectTransform();
      }

      @Override
      public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        applyAspectTransform();
      }

      @Override
      public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        lastSurfaceTexture = null;
        return true;
      }

      @Override
      public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        // no-op
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
          // 窗口尺寸变化（含 PiP 进入/退出/系统缩放）只触发本 View 的重新布局；
          // 不要再拿 decor 的 right-left 去 layout TextureView —— decor 在 PiP 下可能是全屏尺寸。
          requestLayout();
          ensurePlayerSurface();
          applyAspectTransform();
        });
      }
    };
  }

  /** 纯音频模式：不渲染视频画面，仅解码播放音频（上麦/电台流为声音，无需黑屏画面） */
  public void setAudioOnly(boolean audioOnly) {
    if (this.audioOnly == audioOnly) return;
    this.audioOnly = audioOnly;
    applyAudioOnlyPresentation();
    // 切换模式需重建播放器：挂载/卸载视频 surface、音频焦点与唤醒策略不同
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

  /** JS 暂停/恢复：控制条播放/暂停真实控原生（仅显式暂停；loading 阶段不设暂停=自动起播） */
  public void setPaused(boolean p) {
    paused = p;
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
        // 纯音频模式：不挂视频 surface（避免黑屏画面），仅解码音频；
        // 设置音频焦点 + 局部唤醒锁（WAKE_LOCK），切后台/锁屏后继续收音
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(), true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
      } else {
        player.setVideoTextureView(textureView);
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
          if (audioOnly) return; // 纯音频模式不渲染画面
          videoWidth = videoSize.width;
          videoHeight = videoSize.height;
          videoPixelRatio = videoSize.pixelWidthHeightRatio <= 0f ? 1f : videoSize.pixelWidthHeightRatio;
          applyAspectTransform();
          // 把视频实际尺寸发给 JS（小窗据此适配横竖屏容器比例）
          if (reactContext != null && videoWidth > 0 && videoHeight > 0) {
            try {
              com.facebook.react.uimanager.UIManagerModule uiManager = reactContext.getNativeModule(com.facebook.react.uimanager.UIManagerModule.class);
              if (uiManager != null) {
                uiManager.getEventDispatcher().dispatchEvent(new LiveSizeEvent(getId(), videoWidth, videoHeight));
              }
            } catch (Throwable ignored) {
            }
            // 关键兜底：新架构（bridgeless）下取不到 UIManagerModule，上面的 View 事件会被静默丢弃
            // → 画面在播但 JS 永远停在「加载中…」。改走 NativeModule 事件（bridgeless 可用），
            // 并在首帧后再补发两次，避免 JS 侧监听器尚未订阅就丢事件。
            final String sizeUrl = url;
            final int w = videoWidth;
            final int h = videoHeight;
            handler.post(() -> LivePlayerModule.emitLiveSize(sizeUrl, w, h));
            handler.postDelayed(() -> LivePlayerModule.emitLiveSize(sizeUrl, w, h), 600L);
            handler.postDelayed(() -> LivePlayerModule.emitLiveSize(sizeUrl, w, h), 2000L);
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
      // 重试耗尽：把失败原因交给 JS（显示重试/切换网页播放器入口）
      emitErrorToJs(reason);
      return;
    }
    retryCount += 1;
    setStatus(reason + ", retrying " + retryCount + "/" + MAX_RETRY);
    handler.postDelayed(this::start, RETRY_DELAY_MS);
  }

  /** 重试耗尽后把失败原因发给 JS（LiveExoViewManager 注册的 onError） */
  private void emitErrorToJs(String reason) {
    // 新架构下 UIManagerModule 事件会丢 → 同时走 NativeModule 事件（JS 侧两者都听）
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
      return a.isInPictureInPictureMode();
    }
    return PipModule.isInPipMode();
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
      if (st != null && (st != lastSurfaceTexture || inPip != lastInPip)) {
        lastSurfaceTexture = st;
        lastInPip = inPip;
        try {
          // 先解绑再绑定：系统 PiP 的 TextureView surface 在窗口尺寸切换时可能
          // 只换 buffer 不换 SurfaceTexture，直接重复 setVideoTextureView 不刷新画面。
          player.clearVideoTextureView(textureView);
          player.setVideoTextureView(textureView);
          player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
          textureView.postInvalidateOnAnimation();
          // PiP 返回全屏的首帧布局可能晚一两帧：补两次变换，避免黑屏/错位残留。
          handler.postDelayed(this::applyAspectTransform, 120L);
          handler.postDelayed(this::applyAspectTransform, 600L);
        } catch (Throwable ignored) {
        }
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
      // 系统 PiP 返回时窗口可见性会重新变为 VISIBLE；部分 ROM 此时不触发
      // TextureView 的 surfaceAvailable（只恢复旧 surface），必须在可见后主动补绑一次。
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
    // 系统 PiP 下 WindowMetrics 的 decor 尺寸可能仍是全屏尺寸（不同 ROM 行为不一致）；
    // 曾用 decor 尺寸强制 setMeasuredDimension，导致小窗内容按全屏比例放大、左右裁切。
    // 统一以父容器给 RN 视图的真实 MeasureSpec 为准；PiP 由系统把根视图缩到小窗尺寸。
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
    // 只使用本 View 的真实布局尺寸：系统 PiP 的 decor 尺寸在部分 ROM 上是全屏，
    // 用它 layout TextureView 会把画面放大后裁掉左右。
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

  private void applyAspectTransform() {
    if (audioOnly) return; // 纯音频模式下不渲染画面，无需适配
    // 以 TextureView 真实布局尺寸为容器尺寸。系统 PiP 的 decor/WindowMetrics
    // 在部分 ROM（含 ColorOS）上仍返回全屏，绝不能拿来算矩阵，否则小窗必裁切。
    int hostW = textureView.getWidth();
    int hostH = textureView.getHeight();
    if (hostW <= 0) hostW = getWidth();
    if (hostH <= 0) hostH = getHeight();
    if (hostW <= 0 || hostH <= 0 || videoWidth <= 0 || videoHeight <= 0) return;

    boolean inPip = isInPip();
    float videoRatio = ((float) videoWidth * videoPixelRatio) / (float) videoHeight;
    float hostRatio = (float) hostW / (float) hostH;

    float targetW;
    float targetH;

    if (coverPortrait && !inPip && videoRatio < 1f && hostRatio < 1f) {
      // 竖屏全屏模式下的铺满裁剪 (cover)
      if (videoRatio > hostRatio) {
        targetH = hostH;
        targetW = hostH * videoRatio;
      } else {
        targetW = hostW;
        targetH = hostW / videoRatio;
      }
    } else {
      // 小窗（PiP）模式下必须完整显示画面、严禁左右裁切（FIT_CENTER contain）
      if (videoRatio > hostRatio) {
        targetW = hostW;
        targetH = hostW / videoRatio;
      } else {
        targetH = hostH;
        targetW = hostH * videoRatio;
      }
    }

    int tw = textureView.getWidth();
    int th = textureView.getHeight();
    if (tw <= 0) tw = hostW;
    if (th <= 0) th = hostH;

    float sx = targetW / (float) tw;
    float sy = targetH / (float) th;
    float dx = (tw - targetW) / 2f;
    float dy = (th - targetH) / 2f;

    Matrix matrix = new Matrix();
    matrix.setScale(sx, sy);
    matrix.postTranslate(dx, dy);
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
