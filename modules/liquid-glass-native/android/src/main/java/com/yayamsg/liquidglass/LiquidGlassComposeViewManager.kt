package com.yayamsg.liquidglass

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * Compose 版液态玻璃的 ViewManager（ViewGroup：玻璃是底层，RN 子视图叠在上面当内容）。
 *
 * 参数名与 shufajiaok/LiquidGlass 的 [com.jiale.liquidglass.GlassParams] 对齐，
 * 方便对着它的「玻璃实验台」调数值。
 */
class LiquidGlassComposeViewManager : ViewGroupManager<LiquidGlassComposeView>() {

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): LiquidGlassComposeView =
    LiquidGlassComposeView(reactContext)

  /** 圆角（dp） */
  @ReactProp(name = "cornerRadius", defaultFloat = 16f)
  fun setCornerRadius(view: LiquidGlassComposeView, value: Float) = view.setCornerRadius(value)

  /** 模糊半径（dp）。经验：**不要接近控件高度**，否则玻璃里只剩一团均匀色块 */
  @ReactProp(name = "blurRadius", defaultFloat = 12f)
  fun setBlurRadius(view: LiquidGlassComposeView, value: Float) = view.setBlurRadius(value)

  /** 边缘光带宽（dp）；不传/传 -1 用 GlassParams 里的全局值。小控件要单独给小值 */
  @ReactProp(name = "edgeWidth", defaultFloat = -1f)
  fun setEdgeWidth(view: LiquidGlassComposeView, value: Float) = view.setEdgeWidth(value)

  /** 通透度 0..1：越大膜层越薄越透（默认 0.38） */
  @ReactProp(name = "transparency", defaultFloat = 0.38f)
  fun setTransparency(view: LiquidGlassComposeView, value: Float) = view.setTransparency(value)

  /** 折射位移量（dp，轮廓处）；0 关闭折射 */
  @ReactProp(name = "refractDp", defaultFloat = 5f)
  fun setRefractDp(view: LiquidGlassComposeView, value: Float) = view.setRefractDp(value)

  /** 折射做法："scale"（整体放大，省）/ "field"（边缘折射，中心不动） */
  @ReactProp(name = "refractMode")
  fun setRefractMode(view: LiquidGlassComposeView, value: String?) = view.setRefractMode(value)

  /** 色散强度 0..1：贴边一条带上的 RGB 错位（彩边） */
  @ReactProp(name = "dispersion", defaultFloat = 0.35f)
  fun setDispersion(view: LiquidGlassComposeView, value: Float) = view.setDispersion(value)

  /** 边缘光亮度倍率；1 = 自动（越宽越淡） */
  @ReactProp(name = "edgeGlow", defaultFloat = 1f)
  fun setEdgeGlow(view: LiquidGlassComposeView, value: Float) = view.setEdgeGlow(value)

  /** 背景层 nativeID：抓它当玻璃背板 */
  @ReactProp(name = "targetId")
  fun setTargetId(view: LiquidGlassComposeView, value: String?) = view.setTargetId(value)

  /** 背板来源：0 = targetId 那一层（省）/ 1 = 整个内容视图（透出玻璃背后的内容，底栏用） */
  @ReactProp(name = "backdropMode", defaultFloat = 0f)
  fun setBackdropMode(view: LiquidGlassComposeView, value: Float) = view.setBackdropMode(value)

  /** 膜层颜色（#AARRGGBB）：覆盖引擎默认的 MaterialTheme.surface 膜色 */
  @ReactProp(name = "filmColor")
  fun setFilmColor(view: LiquidGlassComposeView, value: String?) = view.setFilmColor(value)

  /** 抓图缩放：2 = 半分辨率抓（默认，省一半像素） */
  @ReactProp(name = "bitmapScale", defaultFloat = 2f)
  fun setBitmapScale(view: LiquidGlassComposeView, value: Float) = view.setBitmapScale(value)

  /** 重抓间隔（ms）：0 = 只抓一次（静态背景）；列表从玻璃下滚过时给 100~200 */
  @ReactProp(name = "captureRefreshMs", defaultFloat = 0f)
  fun setCaptureRefreshMs(view: LiquidGlassComposeView, value: Float) = view.setCaptureRefreshMs(value)

  companion object {
    const val REACT_CLASS = "LiquidGlassComposeView"
  }
}
