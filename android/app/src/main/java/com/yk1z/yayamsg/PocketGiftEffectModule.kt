package com.yk1z.yayamsg

import android.app.Activity
import android.graphics.Color
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream
import org.libpag.PAGView

/**
 * 礼物全屏特效播放（libpag）。
 *
 * 链路与服务端广播消息一致：直播间 PRESENT_FULLSCREEN(_TWO) 的 giftInfo.zipPath
 * （如 /backstage/2023/1020/xxx.zip）+ zipMd5 → `https://source.48.cn{zipPath}` 下载
 * → 校验 MD5 → 解压出 `giftpag.pag` → 缓存（cacheDir/pag_effects）→ PAGView 全屏播放。
 *
 * 串行队列，最多排 3 条；同一礼物 30s 内不重复播（重连补发 / 发送者自己也收到回投）。
 * PAGView 内部是 TextureView，可直接叠在 RN 界面之上，无需独立窗口。
 */
class PocketGiftEffectModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor()

  private data class Effect(val key: String, val zipUrl: String, val zipMd5: String)

  private val queue = ArrayDeque<Effect>()
  private val recentKeys = LinkedHashMap<String, Long>()
  private var playing = false

  override fun getName(): String = NAME

  @ReactMethod
  fun playEffect(options: ReadableMap, promise: Promise) {
    try {
      val zipPath = options.getString("zipPath") ?: ""
      val zipMd5 = (options.getString("zipMd5") ?: "").lowercase()
      if (zipPath.isEmpty()) {
        promise.resolve(false)
        return
      }
      val url = if (zipPath.startsWith("http")) zipPath else HOST + zipPath
      val key = zipMd5.ifEmpty { zipPath }
      synchronized(this) {
        val now = System.currentTimeMillis()
        if (recentKeys.entries.any { it.key == key && now - it.value < 30_000L }) {
          promise.resolve(false)
          return
        }
        recentKeys[key] = now
        while (recentKeys.size > 64) {
          val it = recentKeys.entries.iterator()
          if (it.hasNext()) { it.next(); it.remove() } else break
        }
        if (playing || queue.size >= MAX_QUEUE) {
          promise.resolve(false)
          return
        }
        queue.addLast(Effect(key, url, zipMd5))
      }
      drain()
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("E_PLAY", t.message ?: t.javaClass.simpleName)
    }
  }

  /** 退出直播间/切房时清空待播队列 */
  @ReactMethod
  fun clearQueue(promise: Promise) {
    synchronized(this) { queue.clear() }
    promise.resolve(true)
  }

  private fun drain() {
    val next: Effect
    synchronized(this) {
      if (playing) return
      val item = queue.pollFirst() ?: return
      playing = true
      next = item
    }
    io.execute {
      val file = try { prepare(next) } catch (_: Throwable) { null }
      val activity = reactApplicationContext.currentActivity
      if (file == null || !file.exists() || file.length() <= 1024 ||
          activity == null || activity.isFinishing || activity.isDestroyed
      ) {
        finish()
        return@execute
      }
      activity.runOnUiThread { play(activity, file) }
    }
  }

  private fun play(activity: Activity, file: File) {
    val root = activity.window?.decorView as? FrameLayout ?: run { finish(); return }
    val view = PAGView(activity)
    view.setBackgroundColor(Color.TRANSPARENT)
    // 不挡交互：不吃触摸（无 onClick 的 View 默认不消费，这里再显式关掉可点/可聚焦），
    // 底部留出输入条高度，避免全屏特效压住弹幕输入框。
    view.isClickable = false
    view.isFocusable = false
    view.isFocusableInTouchMode = false
    val bottomInset = (activity.resources.displayMetrics.density * BOTTOM_INSET_DP).toInt()
    root.addView(
        view,
        FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER,
        ).apply { bottomMargin = bottomInset },
    )
    val stop: () -> Unit = {
      try {
        if (view.isAttachedToWindow) root.removeView(view)
        view.stop()
      } catch (_: Throwable) {
      }
      finish()
    }
    view.addListener(object : PAGView.PAGViewListener {
      override fun onAnimationStart(pagView: PAGView?) {}
      override fun onAnimationEnd(pagView: PAGView?) = stop()
      override fun onAnimationCancel(pagView: PAGView?) {}
      override fun onAnimationRepeat(pagView: PAGView?) {}
      override fun onAnimationUpdate(pagView: PAGView?) {}
    })
    view.setPath(file.absolutePath)
    view.play()
    // 兜底：onAnimationEnd 偶发不回调，最多 15s
    root.postDelayed({ if (view.isAttachedToWindow) stop() }, 15_000L)
  }

  private fun finish() {
    synchronized(this) { playing = false }
    drain()
  }

  private fun prepare(effect: Effect): File? {
    val dir = File(reactApplicationContext.cacheDir, "pag_effects")
    if (!dir.exists()) dir.mkdirs()
    val cached = File(dir, "${effect.key}.pag")
    if (cached.exists() && cached.length() > 1024) return cached

    val zipBytes = download(effect.zipUrl) ?: return null
    if (effect.zipMd5.isNotEmpty() && !md5Hex(zipBytes).equals(effect.zipMd5, ignoreCase = true)) return null
    val pagBytes = unzipFirstPag(zipBytes) ?: return null
    val tmp = File(dir, "${effect.key}.pag.tmp")
    FileOutputStream(tmp).use { it.write(pagBytes) }
    if (!tmp.renameTo(cached)) {
      tmp.copyTo(cached, overwrite = true)
      tmp.delete()
    }
    return cached
  }

  private fun download(url: String): ByteArray? {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", UA)
      }
      if (conn.responseCode !in 200..299) null else conn.inputStream.use { it.readBytes() }
    } catch (_: Throwable) {
      null
    } finally {
      try { conn?.disconnect() } catch (_: Throwable) {}
    }
  }

  private fun unzipFirstPag(zip: ByteArray): ByteArray? {
    ZipInputStream(zip.inputStream()).use { zis ->
      var entry = zis.nextEntry
      while (entry != null) {
        val name = entry.name ?: ""
        if (!entry.isDirectory && name.endsWith(".pag", ignoreCase = true) && !name.startsWith("__MACOSX")) {
          return zis.readBytes()
        }
        entry = zis.nextEntry
      }
    }
    return null
  }

  private fun md5Hex(bytes: ByteArray): String =
      MessageDigest.getInstance("MD5").digest(bytes).joinToString("") { "%02x".format(it) }

  companion object {
    const val NAME = "PocketGiftEffect"
    private const val HOST = "https://source.48.cn"
    private const val UA = "PocketFans201807/7.1.43 (Android)"
    private const val MAX_QUEUE = 3
    /** 底部避让高度（dp）：弹幕输入条 + 安全区，特效不压住输入框 */
    private const val BOTTOM_INSET_DP = 96f
  }
}
