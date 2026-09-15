package com.yayamsg.liquidglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 液态玻璃原生模块。
 *
 * 与 react-native-liquid-glassmorphism 的根本区别：
 *   旧库每帧用「软件 Canvas」把整个 root 重绘进 ARGB Bitmap（≈20ms/帧，实测 janky 10%）。
 *   本模块用 **RenderNode 硬件录制**抓目标内容，再走 **链式 RenderEffect**（blur → AGSL 透镜着色器），
 *   全程 GPU 管线（和 Dimezis BlurView 同路线，实测 janky 0%）。
 *
 * 着色器负责苹果真正的签名特征：**边缘透镜折射 + 色散（RGB 分离）**，中心区保持纯模糊。
 */
class LiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LiquidGlassNative")

    View(LiquidGlassNativeView::class) {
      Name("LiquidGlassNativeView")

      Prop("blurRadius") { view: LiquidGlassNativeView, value: Float ->
        view.blurRadius = value
      }
      Prop("lensWidth") { view: LiquidGlassNativeView, value: Float ->
        view.lensWidth = value
      }
      Prop("lensStrength") { view: LiquidGlassNativeView, value: Float ->
        view.lensStrength = value
      }
      Prop("dispersion") { view: LiquidGlassNativeView, value: Float ->
        view.dispersion = value
      }
      Prop("cornerRadius") { view: LiquidGlassNativeView, value: Float ->
        view.cornerRadius = value
      }
      Prop("rimStrength") { view: LiquidGlassNativeView, value: Float ->
        view.rimStrength = value
      }
      Prop("tintColor") { view: LiquidGlassNativeView, value: String? ->
        view.setTintFromString(value)
      }

      OnViewDidUpdateProps { view: LiquidGlassNativeView ->
        view.invalidate()
      }
    }
  }
}
