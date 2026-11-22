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
      PipModule.setCompactWindowMode(compact)
      PipOverlayController.setHidden(this, compact)
      PipModule.emitPipChanged(compact)
    } else if (compact) {

      PipModule.setCompactWindowMode(true)
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
        current.width() * 100L < maximum.width() * 85L && current.height() * 100L < maximum.height() * 85L
    } catch (_: Throwable) { false }
  }
  private val reassertHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val delayedReassert = object : Runnable {
    override fun run() { reassertExoSession() }
  }

  private val reassertBackoff = longArrayOf(400, 1200, 3200)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    window.decorView.addOnLayoutChangeListener(compactWindowListener)
    window.decorView.postDelayed({
      if (!isFinishing && !isDestroyed) {
        window.setBackgroundDrawableResource(R.color.splashscreen_background)
      }
    }, 650L)
    requestMaxRefreshRate()
  }

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

        try {
          val m = window.javaClass.getMethod(
            "setFrameRate",
            Float::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
          )
          m.invoke(window, best.refreshRate, 1, 2)
        } catch (_: Throwable) {

        }
      }
    } catch (t: Throwable) {

    }
  }

  override fun onPause() {
    super.onPause()

    if (PipModule.videoPlaying) {
      reassertHandler.removeCallbacks(delayedReassert)

      if (!PipModule.pipEnabled) stopMusicIfIdle()
      return
    }

    reassertExoSession()
    reassertHandler.removeCallbacks(delayedReassert)
    for (d in reassertBackoff) {
      reassertHandler.postDelayed(delayedReassert, d)
    }
  }

  override fun onResume() {
    super.onResume()

    reassertHandler.removeCallbacks(delayedReassert)
    if (!PipModule.videoPlaying) {
      reassertExoSession()
    }

    compactPlayerWindow = isCompactPlayerWindow()
    PipModule.setCompactWindowMode(compactPlayerWindow)
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

    reassertHandler.removeCallbacks(delayedReassert)
    reassertHandler.removeCallbacksAndMessages(null)
    window.decorView.removeOnLayoutChangeListener(compactWindowListener)
    super.onDestroy()
  }

  private fun reassertExoSession() {
    if (!YayaExoService.serviceAlive) return
    try {
      val i = android.content.Intent(this, YayaExoService::class.java)
          .setAction(YayaExoService.ACTION_REASSERT)
      startService(i)
    } catch (_: Throwable) { }
  }

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
    pruneThirdPartyPipListeners()
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

      if (!PipModule.canUsePip(this)) {
        PipModule.diag("WARN", "appops 拒绝：系统未授予画中画权限")
        PipModule.emitPipDenied("appops")
        return
      }
      PipOverlayController.setHidden(this, true)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PipModule.emitPipChanged(true)
        stopMusicIfIdle()
        try {
          if (!isInPictureInPictureMode && !isFinishing && !isDestroyed) {
            val params = PipModule.buildPipParams(false)
            PipModule.diag("INFO", "手动进入 PiP：autoEnter=false aspect=${params.aspectRatio}")
            if (!enterPipSafely(params)) {
              android.util.Log.w("YayaPip", "enterPictureInPictureMode(autoEnter=false) 返回 false")
              PipModule.diag("WARN", "enterPictureInPictureMode(autoEnter=false) 返回 false")

              android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                try {
                  if (isInPictureInPictureMode || isFinishing || isDestroyed) return@postDelayed
                  val retry = PipModule.buildPipParams(false)
                  val ok2 = enterPipSafely(retry)
                  android.util.Log.i("YayaPip", "第 2 次 enterPictureInPictureMode(+150ms)=$ok2")
                  PipModule.diag(if (ok2) "INFO" else "WARN", "第 2 次 enterPictureInPictureMode(+150ms)=$ok2")
                  if (ok2) return@postDelayed
                  android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try {
                      if (isInPictureInPictureMode || isFinishing || isDestroyed) return@postDelayed
                      val minimal = android.app.PictureInPictureParams.Builder().build()
                      val ok3 = enterPipSafely(minimal)
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

        reassertHandler.postDelayed({
          if (!isCompactPlayerWindow() && !isFinishing && !isDestroyed) {
            android.util.Log.w("YayaPip", "PiP 未生效（1.2s 后仍不在 PiP）→ 回滚盖层")
            PipModule.diag("ERROR", "PiP 未生效（1.2s 后仍不在 PiP）→ 回滚盖层")
            PipModule.setCompactWindowMode(false)
            PipOverlayController.setHidden(this, false)
            PipModule.emitPipChanged(false)
            PipModule.emitPipDenied("timeout")
          }
        }, 1200)
        return
      }
      try {

        PipModule.emitPipChanged(true)

        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
          try {
            if (!isInPictureInPictureMode && !isFinishing && !isDestroyed) {
              enterPipSafely(PipModule.buildPipParams())
            }
          } catch (_: Exception) {

            PipModule.emitPipDenied("enter-failed")
          }

          android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (!isCompactPlayerWindow()) {
              PipModule.setCompactWindowMode(false)
              PipOverlayController.setHidden(this, false)
              PipModule.emitPipChanged(false)
              PipModule.emitPipDenied("timeout")
            }
          }, 900)
        }, PIP_ENTER_DELAY_MS)
      } catch (_: Exception) {

      }

      stopMusicIfIdle()
    }
  }

  private fun stopMusicIfIdle() {
    if (!YayaExoService.serviceAlive || YayaExoService.musicActuallyPlaying) return
    try {
      startService(
        android.content.Intent(this, YayaExoService::class.java)
          .putExtra("cmd", "stop")
      )
    } catch (_: Throwable) { }
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
    pruneThirdPartyPipListeners()
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    android.util.Log.i("YayaPip", "onPipModeChanged inPip=$isInPictureInPictureMode vp=${PipModule.videoPlaying} pe=${PipModule.pipEnabled}")
    PipModule.diag(if (isInPictureInPictureMode) "INFO" else "WARN", "onPipModeChanged inPip=$isInPictureInPictureMode")
    compactPlayerWindow = isInPictureInPictureMode || isCompactPlayerWindow()
    PipModule.setCompactWindowMode(compactPlayerWindow)
    PipOverlayController.setHidden(this, compactPlayerWindow)
    PipModule.emitPipChanged(compactPlayerWindow)
    window.decorView.requestLayout()
    if (isInPictureInPictureMode) {
      window.decorView.postDelayed({
        window.decorView.requestLayout()
        window.decorView.invalidate()
      }, 160L)
    } else {
      window.decorView.postDelayed({
        val stillCompact = isCompactPlayerWindow()
        compactPlayerWindow = stillCompact
        PipModule.setCompactWindowMode(stillCompact)
        PipOverlayController.setHidden(this, stillCompact)
        PipModule.emitPipChanged(stillCompact)
        window.decorView.requestLayout()
      }, 300L)
    }
  }

  override fun onPictureInPictureUiStateChanged(pipState: android.app.PictureInPictureUiState) {
    pruneThirdPartyPipListeners()
    super.onPictureInPictureUiStateChanged(pipState)
    if (Build.VERSION.SDK_INT >= 35 && pipState.isTransitioningToPip) {
      PipModule.setCompactWindowMode(true)
      PipOverlayController.setHidden(this, true)
      PipModule.emitPipChanged(true)
    }
  }

  private fun pruneThirdPartyPipListeners() {
    try {
      var cls: Class<*>? = javaClass.superclass
      while (cls != null && cls != Any::class.java) {
        for (field in cls.declaredFields) {
          if (!java.util.Collection::class.java.isAssignableFrom(field.type)) continue
          field.isAccessible = true
          val list = field.get(this) as? java.util.concurrent.CopyOnWriteArrayList<*> ?: continue
          val toRemove = list.filter { item -> item != null && item.javaClass.name.startsWith("com.brentvatne.") }
          if (toRemove.isNotEmpty()) {
            @Suppress("UNCHECKED_CAST")
            (list as java.util.concurrent.CopyOnWriteArrayList<Any?>).removeAll(toRemove)
          }
        }
        cls = cls.superclass
      }
    } catch (_: Throwable) {
    }
  }

  override fun setPictureInPictureParams(params: android.app.PictureInPictureParams) {

    if (PipModule.isInternalParamsUpdate()) {
      super.setPictureInPictureParams(params)
    }
  }

  private fun enterPipSafely(params: android.app.PictureInPictureParams): Boolean {
    PipModule.setInternalParamsUpdate(true)
    return try {
      enterPictureInPictureMode(params)
    } finally {
      PipModule.setInternalParamsUpdate(false)
    }
  }

  override fun getMainComponentName(): String = "main"

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

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {

              super.invokeDefaultOnBackPressed()
          }
          return
      }

      super.invokeDefaultOnBackPressed()
  }
}

private const val PIP_ENTER_DELAY_MS = 160L
