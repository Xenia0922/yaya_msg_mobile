package com.yayamsg.liquidglass

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.jiale.liquidglass.Backdrop
import com.jiale.liquidglass.GlassParams
import com.jiale.liquidglass.LiquidGlassSurface
import com.jiale.liquidglass.LocalBackdrop
import com.jiale.liquidglass.LocalGlassParams
import com.jiale.liquidglass.RefractMode
import kotlin.math.max

/**
 * 液态玻璃（Compose 版）—— 用 shufajiaok/LiquidGlass 的引擎渲染。
 *
 * 与旧的 [LiquidGlassNativeView]（手写 AGSL + RenderNode）的分工：
 *   - 旧实现把整块目标视图录进 RenderNode 再链式 RenderEffect，**实时**但要自己写着色器；
 *   - 本实现用 Compose 引擎：背板按 ContentScale.Crop 的同一套换算**重画 + BlurEffect**，
 *     只对贴边一条带做折射/色散，观感更接近 Apple 那块玻璃。
 *
 * ⚠️ 该引擎的背板是**静态位图**（上游文档原话：「要模糊滚动的内容就得换成图层捕获」）。
 * 所以这里把 RN 的背景层（nativeID = targetId）**抓成 Bitmap** 再喂给它：
 *   - 抓一次即可（默认）：背景图/渐变不动的页面 —— 卡片、底栏、页头
 *   - `captureRefreshMs > 0`：按间隔重抓（列表从玻璃下滚过时用，帧率换质量）
 *
 * 自引用防护：抓图期间本视图子树整体不参与绘制（`dispatchDraw` 早退），
 * 否则"抓自己 → 画自己 → 再抓"会在 libhwui 里无限递归（旧实现实测 SIGSEGV）。
 */
class LiquidGlassComposeView(context: Context) : FrameLayout(context) {

  // ---- 玻璃参数（Compose state：改属性即重组，不需要手动 invalidate）----
  private val cornerRadiusDp = mutableStateOf(16f)
  private val blurRadiusDp = mutableStateOf(12f)
  /** 边缘光带宽（dp）；< 0 表示交给 GlassParams.edgeWidthDp */
  private val edgeWidthDp = mutableStateOf(-1f)
  private val transparency = mutableStateOf(0.38f)
  private val refractDp = mutableStateOf(5f)
  private val refractMode = mutableStateOf(RefractMode.SCALE)
  private val dispersion = mutableStateOf(0.35f)
  private val edgeGlow = mutableStateOf(1.0f)

  // ---- 背板（抓取的位图 + 它在 root 坐标里的位置/尺寸）----
  private val backdropImage = mutableStateOf<ImageBitmap?>(null)
  private val backdropSize = mutableStateOf(IntSize.Zero)
  private val backdropOrigin = mutableStateOf(IntOffset.Zero)

  /** 背景层标识（RN nativeID）；未设置时退化为抓整个 content 视图 */
  private var targetId: String? = null
  /** 背板来源：0 = 按 targetId 找那一层（默认，省）；1 = 整个内容视图（能透出玻璃背后的内容） */
  private var backdropMode: Int = 0
  /** 膜层颜色（ARGB）：引擎默认拿 MaterialTheme.surface 当膜，偏白显得"实"；这里可覆盖成更中性的白 */
  private val filmColor = mutableStateOf(0)
  /** 抓图缩放：2 = 半分辨率（默认；玻璃里反正要模糊，省一半像素） */
  private var bitmapScale: Float = 2f
  /** 重抓间隔（ms）；0 = 只在目标变化/尺寸变化时抓一次 */
  private var captureRefreshMs: Long = 0L

  private val handler = Handler(Looper.getMainLooper())
  private var refreshRunnable: Runnable? = null
  private var layoutListener: View.OnLayoutChangeListener? = null
  private var lastCaptureW = 0
  private var lastCaptureH = 0
  /** 抓图进行中：整棵子树跳过绘制（防自引用递归） */
  @Volatile
  private var capturing = false

  private val composeView = ComposeView(context)

  init {
    setWillNotDraw(false)
    // 玻璃只负责"底"，RN 子视图（内容）叠在上面
    clipChildren = false
    addView(composeView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    composeView.setContent {
      val image = backdropImage.value
      val size = backdropSize.value
      val origin = backdropOrigin.value
      val backdrop = remember(image, size, origin) {
        Backdrop(
          image = image,
          size = size,
          origin = Offset(origin.x.toFloat(), origin.y.toFloat()),
          // 遮罩已经包含在抓到的位图里（抓的就是带遮罩的背景层），这里不要重复叠
          scrim = 0f,
        )
      }
      val params = GlassParams(
        transparency = transparency.value,
        refractDp = refractDp.value,
        refractMode = refractMode.value,
        edgeWidthDp = if (edgeWidthDp.value > 0f) edgeWidthDp.value else com.jiale.liquidglass.GlassDefaults.EDGE_DP,
        dispersion = dispersion.value,
        edgeGlow = edgeGlow.value,
      )
      val baseScheme = MaterialTheme.colorScheme
      val scheme = if (filmColor.value != 0) {
        baseScheme.copy(surface = androidx.compose.ui.graphics.Color(filmColor.value))
      } else {
        baseScheme
      }
      MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(
          LocalGlassParams provides params,
          LocalBackdrop provides backdrop,
        ) {
          LiquidGlassSurface(
            modifier = Modifier.fillMaxSize(),
            shape = RoundedCornerShape(cornerRadiusDp.value.dp),
            blurRadius = blurRadiusDp.value.dp,
            edgeWidth = if (edgeWidthDp.value > 0f) edgeWidthDp.value.dp else androidx.compose.ui.unit.Dp.Unspecified,
            enabled = true,
          ) {
            // 内容由 RN 子视图承担（本视图是玻璃底层，不是内容容器）
          }
        }
      }
    }
  }

  // ---------------- RN 属性 ----------------

  fun setCornerRadius(value: Float) { cornerRadiusDp.value = if (value > 0f) value else 0f }

  fun setBlurRadius(value: Float) { blurRadiusDp.value = if (value > 0f) value else 0f }

  fun setEdgeWidth(value: Float) { edgeWidthDp.value = value }

  fun setTransparency(value: Float) { transparency.value = value.coerceIn(0f, 1f) }

  fun setRefractDp(value: Float) { refractDp.value = value }

  fun setRefractMode(value: String?) {
    refractMode.value = if (value?.lowercase() == "field") RefractMode.FIELD else RefractMode.SCALE
  }

  fun setDispersion(value: Float) { dispersion.value = value.coerceIn(0f, 1f) }

  fun setEdgeGlow(value: Float) { edgeGlow.value = value }

  fun setBitmapScale(value: Float) { bitmapScale = if (value >= 1f) value else 1f }

  fun setBackdropMode(value: Float) { backdropMode = if (value >= 1f) 1 else 0 }

  fun setFilmColor(value: String?) {
    filmColor.value = if (value.isNullOrEmpty()) 0 else runCatching { android.graphics.Color.parseColor(value) }.getOrDefault(0)
  }

  fun setCaptureRefreshMs(value: Float) {
    val next = value.toLong().coerceAtLeast(0L)
    if (next == captureRefreshMs) return
    captureRefreshMs = next
    scheduleRefresh()
  }

  fun setTargetId(value: String?) {
    targetId = value?.takeIf { it.isNotEmpty() }
    attachLayoutListener()
    post { captureBackdrop() }
  }

  // ---------------- 抓图 ----------------

  private fun resolveRoot(): ViewGroup? {
    val activity = context as? Activity ?: (context as? com.facebook.react.bridge.ReactContext)?.currentActivity
    return activity?.window?.decorView?.findViewById<ViewGroup>(android.R.id.content)
  }

  private fun resolveTarget(): View? {
    val root = resolveRoot() ?: return null
    // 模式 1：抓整个内容视图 —— 玻璃里透出的是"背后真实的东西"（列表/卡片/图），
    // 而不是只有一层页面背景（那会让玻璃看起来就是一块白板）。
    if (backdropMode == 1) return root
    val id = targetId
    if (!id.isNullOrEmpty()) {
      // RN 的 nativeID 走的是**带 key 的 tag**（R.id.view_tag_native_id），
      // findViewWithTag 只认无 key 的 tag → 必须自己递归两种都查
      findByNativeId(root, id)?.let { return it }
      root.findViewWithTag<View>(id)?.let { return it }
    }
    return root
  }

  private fun findByNativeId(view: View, id: String): View? {
    val keyed = try {
      view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
    } catch (t: Throwable) {
      null
    }
    if (keyed == id || (view.tag as? String) == id) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findByNativeId(view.getChildAt(i), id)?.let { return it }
      }
    }
    return null
  }

  private fun attachLayoutListener() {
    val target = resolveTarget() ?: return
    val old = layoutListener
    if (old != null) return
    val listener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or_, ob ->
      if (l != ol || t != ot || r != or_ || b != ob) post { captureBackdrop() }
    }
    layoutListener = listener
    target.addOnLayoutChangeListener(listener)
  }

  private fun scheduleRefresh() {
    refreshRunnable?.let { handler.removeCallbacks(it) }
    refreshRunnable = null
    if (captureRefreshMs <= 0L) return
    val runnable = object : Runnable {
      override fun run() {
        if (!isAttachedToWindow) return
        captureBackdrop()
        handler.postDelayed(this, captureRefreshMs)
      }
    }
    refreshRunnable = runnable
    handler.postDelayed(runnable, captureRefreshMs)
  }

  /**
   * 抓一帧背景到 Bitmap（主线程，`target.draw`）。
   *
   * **全局共享**：同一个背景层 + 同尺寸 + 同缩放的结果只存一份，所有玻璃实例共用
   * （否则 N 个玻璃各存一张全屏位图 —— 半分辨率 1080p 就 ~2MB/个，一页几十个直接爆内存）。
   * 失效规则：`captureRefreshMs <= 0` 永不失效（静态背景，抓一次用到底）；
   * 大于 0 时按该间隔过期（列表从玻璃下滚过时用）。
   */
  fun captureBackdrop() {
    if (capturing) return
    val target = resolveTarget() ?: return
    val root = resolveRoot() ?: return
    val w = target.width
    val h = target.height
    if (w <= 0 || h <= 0) return
    val scale = bitmapScale.coerceAtLeast(1f)
    val key = (if (backdropMode == 1) "window" else (targetId ?: "root")) + "|" + w + "|" + h + "|" + scale
    val now = SystemClock.uptimeMillis()

    val cached = sharedBitmap
    val usable = cached != null && !cached.isRecycled && sharedKey == key &&
      (captureRefreshMs <= 0L || now - sharedAt < captureRefreshMs)
    val bitmap = if (usable) cached!! else {
      val bw = max(1, (w / scale).toInt())
      val bh = max(1, (h / scale).toInt())
      val fresh = try {
        Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
      } catch (t: Throwable) {
        return
      }
      val canvas = Canvas(fresh)
      canvas.scale(1f / scale, 1f / scale)
      capturing = true
      try {
        target.draw(canvas)
      } catch (t: Throwable) {
        capturing = false
        return
      } finally {
        capturing = false
      }
      sharedBitmap = fresh
      sharedKey = key
      sharedAt = now
      fresh
    }

    val tl = IntArray(2)
    target.getLocationInWindow(tl)
    val rl = IntArray(2)
    root.getLocationInWindow(rl)
    backdropOrigin.value = IntOffset(tl[0] - rl[0], tl[1] - rl[1])
    backdropSize.value = IntSize(w, h)
    // 共享同一 Bitmap 实例：ImageBitmap 包装是轻量的，各实例各持一份包装即可
    backdropImage.value = bitmap.asImageBitmap()
    lastCaptureW = w
    lastCaptureH = h
  }

  companion object {
    /** 共享的背景位图 + 它的标识与时间戳 */
    @Volatile
    private var sharedBitmap: Bitmap? = null
    @Volatile
    private var sharedKey: String? = null
    @Volatile
    private var sharedAt: Long = 0L

    /** 背景内容变了（换主题/换图）时显式失效，下次抓图重新抓 */
    @JvmStatic
    fun invalidateSharedBackdrop() {
      sharedBitmap = null
      sharedKey = null
    }
  }

  // ---------------- 绘制 ----------------

  override fun dispatchDraw(canvas: Canvas) {
    // 抓图期间整棵子树不画：否则"抓自己 → 画自己 → 再抓"无限递归
    if (capturing) return
    super.dispatchDraw(canvas)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { captureBackdrop() }
    scheduleRefresh()
  }

  override fun onDetachedFromWindow() {
    refreshRunnable?.let { handler.removeCallbacks(it) }
    refreshRunnable = null
    layoutListener?.let { listener ->
      resolveTarget()?.removeOnLayoutChangeListener(listener)
    }
    layoutListener = null
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (lastCaptureW == 0 || lastCaptureH == 0) post { captureBackdrop() }
  }
}
