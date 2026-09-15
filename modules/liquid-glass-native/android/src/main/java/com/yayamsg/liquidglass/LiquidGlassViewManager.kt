package com.yayamsg.liquidglass

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * 液态玻璃视图的 RN ViewManager（标准 react-native 机制，不走 Expo Module）。
 *
 * 为什么不用 ExpoModule：本工程的 Expo Modules autolinking 没在 app 构建里生效
 * （ExpoModulesPackageList 从未生成），`requireNativeView` 永远解析失败 →
 * 原生 AGSL 玻璃一直不可用。改成标准 ViewManager + 手动 include（与
 * react-native-safe-area-context 同一套做法）才能稳定注册。
 */
class LiquidGlassViewManager : SimpleViewManager<LiquidGlassNativeView>() {

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): LiquidGlassNativeView =
    LiquidGlassNativeView(reactContext)

  @ReactProp(name = "blurRadius")
  fun setBlurRadius(view: LiquidGlassNativeView, value: Float) {
    view.blurRadius = value
  }

  @ReactProp(name = "lensWidth")
  fun setLensWidth(view: LiquidGlassNativeView, value: Float) {
    view.lensWidth = value
  }

  @ReactProp(name = "lensStrength")
  fun setLensStrength(view: LiquidGlassNativeView, value: Float) {
    view.lensStrength = value
  }

  @ReactProp(name = "dispersion")
  fun setDispersion(view: LiquidGlassNativeView, value: Float) {
    view.dispersion = value
  }

  @ReactProp(name = "rimStrength")
  fun setRimStrength(view: LiquidGlassNativeView, value: Float) {
    view.rimStrength = value
  }

  @ReactProp(name = "cornerRadius")
  fun setCornerRadius(view: LiquidGlassNativeView, value: Float) {
    view.cornerRadius = value
  }

  @ReactProp(name = "tintColor")
  fun setTintColor(view: LiquidGlassNativeView, value: String?) {
    view.setTintFromString(value)
  }

  /** 只录制这一层（RN nativeID）：避免把页面里的 BlurView 一起录进去造成嵌套爆栈 */
  @ReactProp(name = "targetId")
  fun setTargetId(view: LiquidGlassNativeView, value: String?) {
    view.targetId = value
  }

  companion object {
    const val REACT_CLASS = "LiquidGlassNativeView"
  }
}
