package com.yk1z.yayamsg

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private var compactPlayerWindow = false
  private val compactWindowListener = android.view.View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
    val compact = isCompactPlayerWindow()
    if (compact != compactPlayerWindow) {
      compactPlayerWindow = compact
      PipOverlayController.setHidden(this, compact)
      PipModule.emitPipChanged(compact)
    } else if (compact) {
      // RN may mount a new overlay while the floating window is already visible.
      PipOverlayController.setHidden(this, true)
    }
  }

  private fun isCompactPlayerWindow(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode) return true
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    return try {
      val current = windowManager.currentWindowMetrics.bounds
      val maximum = windowManager.maximumWindowMetrics.bounds
      current.width() > 0 && current.height() > 0 && maximum.width() > 0 && maximum.height() > 0 &&
        current.width() * 100L < maximum.width() * 70L && current.height() * 100L < maximum.height() * 80L
    } catch (_: Throwable) { false }
  }
  private val reassertHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val delayedReassert = object : Runnable {
    override fun run() { reassertExoSession() }
  }
  /** onPause 后延迟窗口内的补发点（ms）：ColorOS SystemUI 构建媒体卡通常滞后于 Home 键瞬间 */
  private val reassertBackoff = longArrayOf(400, 1200, 3200)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    window.decorView.addOnLayoutChangeListener(compactWindowListener)
    requestMaxRefreshRate()
  }

  /**
   * 软件层强制最高刷新率（用户要求"直接定到满帧 120"）。
   *
   * Android 的刷新率是系统按内容/功耗动态切换的，应用侧只能在窗口层"请求"：
   *   1) 老的 preferredDisplayModeId：把窗口绑到该屏刷新率最高的 display mode（API 23+）
   *   2) API 30+ 再叠一层 setFrameRate(FIXED_SOURCE + ALWAYS)，告诉 SurfaceFlinger
   *      这个窗口的内容按该帧率生产，别为了省电降到 60。
   * 真机 120Hz 屏（如 OPPO PJZ110）生效；60Hz 屏/模拟器无副作用（取到的就是 60）。
   */
  private fun requestMaxRefreshRate() {
    try {
      val wm = getSystemService(WINDOW_SERVICE) as android.view.WindowManager
      val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        display
      } else {
        @Suppress("DEPRECATION")
        wm.defaultDisplay
      } ?: return
      val best = display.supportedModes.maxByOrNull { it.refreshRate } ?: return

      val attrs = window.attributes
      attrs.preferredDisplayModeId = best.modeId
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        attrs.preferredRefreshRate = best.refreshRate
      }
      window.attributes = attrs

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // 用反射调 Window.setFrameRate（避免依赖 compileSdk 的 API 30 符号）：
        // FRAME_RATE_COMPATIBILITY_FIXED_SOURCE = 1, CHANGE_FRAME_RATE_ALWAYS = 2
        try {
          val m = window.javaClass.getMethod(
            "setFrameRate",
            Float::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
          )
          m.invoke(window, best.refreshRate, 1, 2)
        } catch (_: Throwable) {
          // 个别 ROM 未实现该 API：上面的 preferredDisplayModeId 已经足够
        }
      }
    } catch (t: Throwable) {
      // 不支持则沿用系统默认，不影响启动
    }
  }

  override fun onPause() {
    super.onPause()
    // 视频（直播/录播/网页）在播并被系统小窗（PiP）接管时，绝不重声明音乐会话——
    // 否则 SystemUI 的 PiP/媒体控件会绑到音乐而非画面中的视频（用户反馈"控件控制的是音乐"根因之一）。
    // 仅无视频在播（听歌/一般页面切后台）才补发音乐会话重声明。
    if (PipModule.videoPlaying) {
      // 系统小窗开关关闭：切后台不自动进 PiP，视频将随 Activity 后台停止 —— 顺手停掉
      // "暂停残留"的音乐前台服务，避免 SystemUI 媒体卡残留 App 的（音乐）控件。
      if (!PipModule.pipEnabled) stopMusicIfIdle()
      return
    }
    // 离开前台（按 Home/切应用/进通知栏）前重声明 Exo 会话：
    // ColorOS 在「音乐页→App 首页→再切后台」路径上把媒体卡绑到过期会话状态 → 通知栏/锁屏控件失灵。
    // 关键点：此路径在切后台前没有 onResume（导航回首页不触发 resume），
    // 若只在 onResume 重声明，控件失灵的瞬间永远等不到修复 → 必须 onPause 也重声明一次。
    // ⚠️ 且 SystemUI 的媒体卡/胶囊构建通常滞后 Home 键数百 ms~数秒——一次 onPause 重声明不够，
    // 需要在退后台后的延迟窗口内再补发几次（覆盖 ColorOS 懒构建/懒绑定），直到前台恢复才停。
    reassertExoSession()
    reassertHandler.removeCallbacks(delayedReassert)
    for (d in reassertBackoff) {
      reassertHandler.postDelayed(delayedReassert, d)
    }
  }

  override fun onResume() {
    super.onResume()
    // 回前台：停掉后台补发窗口，然后立即重声明一次（覆盖回前台瞬间的会话刷新）
    reassertHandler.removeCallbacks(delayedReassert)
    reassertExoSession()
    // ⚠️ 补发 PiP 模式状态：用户从小窗展开回 App 时若 exit 事件丢失，
    // JS 侧「PiP 全屏盖层」(pipCover) 会卡在 true —— 主页被全屏视频盖住（用户实测截图）。
    // onResume 时 PiP 模式必已确定：在 PiP 中补 true，已展开补 false（盖层随之复位）。
    compactPlayerWindow = isCompactPlayerWindow()
    PipModule.emitPipChanged(compactPlayerWindow)
    PipOverlayController.setHidden(this, compactPlayerWindow)
    PipModule.refreshPipActions()
  }

  override fun onStop() {
    super.onStop()
  }

  override fun onStart() {
    super.onStart()
  }

  override fun onDestroy() {
    window.decorView.removeOnLayoutChangeListener(compactWindowListener)
    super.onDestroy()
  }

  /** 前台恢复即重声明 Exo 媒体会话（服务未在播时自灭，不留多余通知/卡片） */
  private fun reassertExoSession() {
    if (!YayaExoService.serviceAlive) return
    try {
      val i = android.content.Intent(this, YayaExoService::class.java)
          .setAction(YayaExoService.ACTION_REASSERT)
      startService(i)
    } catch (_: Throwable) { }
  }

  /**
   * 用户按 Home / 切到其他应用时：若设置了"画中画"开关且 RN 侧标记有视频在播，
   * 自动进入画中画悬浮窗；开关关闭则绝不弹 App 外系统小窗（用户没主动要小窗就不加载）。
   * （RN 侧在播放器 onLoad 时 setVideoPlaying(true)，onEnd/onError/暂停时置 false）
   */
  /**
   * 探针：AOSP 里 Activity.enterPictureInPictureMode 的第一道门是
   * `Window.setPictureInPictureParams(params)`（@hide，返回 boolean），
   * 它内部有 `if (!mIsFloating) return false` —— 失败时**不会走到 AMS，也不会有任何系统日志**，
   * 正好解释我们看到的「enterPictureInPictureMode 返回 false 且系统侧零日志」。
   * 这里用反射把 mIsFloating / Window.setPictureInPictureParams 的真实结果打出来。
   */
  private fun probeWindowPipGate(params: android.app.PictureInPictureParams) {
    try {
      val w = window
      val cls = w.javaClass
      var m: java.lang.reflect.Field? = null
      var c: Class<*>? = cls
      while (c != null) {
        try { m = c.getDeclaredField("mIsFloating"); break } catch (_: Throwable) { c = c.superclass }
      }
      if (m != null) {
        m.isAccessible = true
        PipModule.diag("INFO", "probe Window.mIsFloating=" + m.get(w))
      } else {
        PipModule.diag("INFO", "probe mIsFloating 字段未找到（可能被隐藏 API 限制）")
      }
      try {
        val method = cls.getMethod("setPictureInPictureParams", android.app.PictureInPictureParams::class.java)
        val r = method.invoke(w, params)
        PipModule.diag("INFO", "probe Window.setPictureInPictureParams=" + r)
      } catch (e: Throwable) {
        PipModule.diag("WARN", "probe Window.setPictureInPictureParams 调用失败: " + e)
      }
    } catch (e: Throwable) {
      PipModule.diag("WARN", "probe 失败: " + e)
    }
  }

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    android.util.Log.i(
      "YayaPip",
      "onUserLeaveHint vp=${PipModule.videoPlaying} pe=${PipModule.pipEnabled} " +
        "inPip=$isInPictureInPictureMode canUse=${PipModule.canUsePip(this)} sdk=${Build.VERSION.SDK_INT}"
    )
    PipModule.diag("INFO", "onUserLeaveHint vp=${PipModule.videoPlaying} pe=${PipModule.pipEnabled} inPip=$isInPictureInPictureMode canUse=${PipModule.canUsePip(this)} sdk=${Build.VERSION.SDK_INT}")
    if (!PipModule.videoPlaying || !PipModule.pipEnabled) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && !isInPictureInPictureMode) {
      // ColorOS/MIUI 把画中画当独立 AppOps 权限：被关时调用会静默失败 → 提前判定并回报 JS
      if (!PipModule.canUsePip(this)) {
        PipModule.diag("WARN", "appops 拒绝：系统未授予画中画权限")
        PipModule.emitPipDenied("appops")
        return
      }
      PipOverlayController.setHidden(this, true)
      // Android 12+ 手动进入 PiP 的正确姿势（真机 Android 15 / sdk 37 实测定位）：
      //
      // ⚠️ AOSP ActivityTaskManagerService.enterPictureInPictureMode 里有一条硬规则：
      //   if (fromClient && r.isState(PAUSING) && params.isAutoEnterEnabled()) {
      //       Slog.w(TAG, "Skip client enterPictureInPictureMode request while pausing," +
      //               " auto-enter-pip is enabled");
      //       return false;
      //   }
      // 按 Home 切后台的那一刻 activity 正是 PAUSING 状态，而我们的参数之前带着
      // autoEnter=true → 每次都被这条规则挡掉，enterPictureInPictureMode 恒返回 false，
      // 且系统侧没有任何其它日志（此前一直查不到原因就是这个）。
      //
      // 所以：**手动进入时参数必须 autoEnter=false**。
      // 常驻参数（setPictureInPictureParams）仍保留 autoEnter，供「启动别的 Activity
      // 时自动缩进小窗」那条路径（ActivityRecord.canAutoEnterPip）使用。
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PipModule.emitPipChanged(true)
        stopMusicIfIdle()
        try {
          if (!isInPictureInPictureMode && !isFinishing && !isDestroyed) {
            val params = PipModule.buildPipParams(false)
            PipModule.diag("INFO", "手动进入 PiP：autoEnter=false aspect=${params.aspectRatio}")
            if (!enterPictureInPictureMode(params)) {
              android.util.Log.w("YayaPip", "enterPictureInPictureMode(autoEnter=false) 返回 false")
              PipModule.diag("WARN", "enterPictureInPictureMode(autoEnter=false) 返回 false")
              // 重试策略：
              //  第 2 次(+150ms)：同参数再试 —— 可能是系统还没把
              //    supportsEnterPipOnTaskSwitch 置 true（启动器任务切前台是异步的）
              //  第 3 次(+450ms)：最小参数（去掉比例/actions）兜底
              android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                try {
                  if (isInPictureInPictureMode || isFinishing || isDestroyed) return@postDelayed
                  val retry = PipModule.buildPipParams(false)
                  val ok2 = enterPictureInPictureMode(retry)
                  android.util.Log.i("YayaPip", "第 2 次 enterPictureInPictureMode(+150ms)=$ok2")
                  PipModule.diag(if (ok2) "INFO" else "WARN", "第 2 次 enterPictureInPictureMode(+150ms)=$ok2")
                  if (ok2) return@postDelayed
                  android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try {
                      if (isInPictureInPictureMode || isFinishing || isDestroyed) return@postDelayed
                      val minimal = android.app.PictureInPictureParams.Builder().build()
                      val ok3 = enterPictureInPictureMode(minimal)
                      android.util.Log.i("YayaPip", "第 3 次（最小参数）enterPictureInPictureMode=$ok3")
                      PipModule.diag(if (ok3) "INFO" else "ERROR", "第 3 次（最小参数）enterPictureInPictureMode=$ok3")
                      if (!ok3) PipModule.emitPipDenied("enter-failed")
                    } catch (e: Exception) {
                      android.util.Log.w("YayaPip", "第 3 次 enterPictureInPictureMode 抛异常: " + e)
                      PipModule.emitPipDenied("enter-failed")
                    }
                  }, 300)
                } catch (e: Exception) {
                  android.util.Log.w("YayaPip", "第 2 次 enterPictureInPictureMode 抛异常: " + e)
                  PipModule.emitPipDenied("enter-failed")
                }
              }, 150)
            }
          }
        } catch (e: Exception) {
          android.util.Log.w("YayaPip", "enterPictureInPictureMode 抛异常: " + e)
          PipModule.emitPipDenied("enter-failed")
        }
        // 兜底回滚：若上面主动进入 + autoEnter 都没生效（ROM 静默拒绝），撤掉盖层
        reassertHandler.postDelayed({
          if (!isCompactPlayerWindow() && !isFinishing && !isDestroyed) {
            android.util.Log.w("YayaPip", "PiP 未生效（1.2s 后仍不在 PiP）→ 回滚盖层")
            PipModule.diag("ERROR", "PiP 未生效（1.2s 后仍不在 PiP）→ 回滚盖层")
            PipOverlayController.setHidden(this, false)
            PipModule.emitPipChanged(false)
            PipModule.emitPipDenied("timeout")
          }
        }, 1200)
        return
      }
      try {
        // ⚠️ 在 enterPictureInPictureMode 之前通知 RN，让 JS 提前把"应用内小窗"盖层
        // 全屏化（系统 PiP 内容 = 整窗快照，若不盖页面，悬浮窗里看到的是"列表+小窗"脏画面）
        PipModule.emitPipChanged(true)
        // 事件到 PiP 建立之间必须给 RN 一帧以上的时间把盖层画出来：
        // 原先同步调用 enterPictureInPictureMode，快照拍在盖层渲染前，
        // 小窗里先显示 1-2 秒 App 页面才切成视频（2026-10-18 用户反馈）。
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
          try {
            if (!isInPictureInPictureMode && !isFinishing && !isDestroyed) {
              enterPictureInPictureMode(PipModule.buildPipParams())
            }
          } catch (_: Exception) {
            // 部分 ROM 限制，静默
            PipModule.emitPipDenied("enter-failed")
          }
          // 兜底回滚：上面已提前 emitPipChanged(true)（让 JS 先把盖层画出来），
          // 若 ROM 静默拒绝（不抛异常也不真正进 PiP），必须撤掉盖层，
          // 否则 JS 的 pipCover 卡在 true → 页面被全屏视频层盖死（2026-10-21）。
          android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (!isCompactPlayerWindow()) {
              PipOverlayController.setHidden(this, false)
              PipModule.emitPipChanged(false)
              PipModule.emitPipDenied("timeout")
            }
          }, 900)
        }, PIP_ENTER_DELAY_MS)
      } catch (_: Exception) {
        // 部分 ROM 限制，静默
      }
      // 视频小窗接管媒体身份：音乐若只是"暂停/未起播"（服务与通知仍在）则彻底停掉，
      // 释放其 MediaSession，避免 SystemUI 把 PiP/通知卡控件绑到音乐上。
      // 音乐真正在放（playWhenReady，罕见双音场景）则不打断。
      stopMusicIfIdle()
    }
  }

  /** 音乐服务只是"暂停残留"（无真实播放）则彻底停掉：撤前台通知、释放 MediaSession */
  private fun stopMusicIfIdle() {
    if (!YayaExoService.serviceAlive || YayaExoService.musicActuallyPlaying) return
    try {
      startService(
        android.content.Intent(this, YayaExoService::class.java)
          .putExtra("cmd", "stop")
      )
    } catch (_: Throwable) { }
  }

  /** PiP 模式切换：通知 RN（用于"应用内小窗 → 系统 PiP"盖层切换）
   *  AppState 'background' 在 PiP 下不会触发，必须靠 native → JS 事件才能在 PiP 进入瞬间同步。 */
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    android.util.Log.i("YayaPip", "onPipModeChanged inPip=$isInPictureInPictureMode vp=${PipModule.videoPlaying} pe=${PipModule.pipEnabled}")
    PipModule.diag(if (isInPictureInPictureMode) "INFO" else "WARN", "onPipModeChanged inPip=$isInPictureInPictureMode")
    compactPlayerWindow = isInPictureInPictureMode || isCompactPlayerWindow()
    PipOverlayController.setHidden(this, compactPlayerWindow)
    PipModule.emitPipChanged(compactPlayerWindow)
  }

  override fun onPictureInPictureUiStateChanged(pipState: android.app.PictureInPictureUiState) {
    super.onPictureInPictureUiStateChanged(pipState)
    if (Build.VERSION.SDK_INT >= 35 && pipState.isTransitioningToPip) {
      PipOverlayController.setHidden(this, true)
      PipModule.emitPipChanged(true)
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}

/** 进系统 PiP 前等待 RN 渲染全屏盖层的时间（ms） */
private const val PIP_ENTER_DELAY_MS = 160L
