package com.yayamsg.liquidglass

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** 把一个原生视图注册进 RN（与 react-native-safe-area-context 同一套手动链接做法） */
class LiquidGlassPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(
      // 旧：手写 AGSL + RenderNode（实时录制，保留做对照/降级）
      LiquidGlassViewManager(),
      // 新：shufajiaok/LiquidGlass 的 Compose 引擎（真折射 + 色散 + 边缘光）
      LiquidGlassComposeViewManager(),
    )
}
