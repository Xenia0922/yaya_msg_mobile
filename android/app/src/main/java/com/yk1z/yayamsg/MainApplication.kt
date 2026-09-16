package com.yk1z.yayamsg

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.yayamsg.liquidglass.LiquidGlassPackage
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider

import okhttp3.Interceptor

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

/** 与 src/api/bilibili.ts biliHeaders 一致的桌面 Chrome UA（B站风控按 UA 分端） */
private const val BILI_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"

class MainApplication : Application(), ReactApplication {

  /** 手动注册的包（autolink 覆盖不到的）——reactNativeHost 与 reactHost 共用同一份 */
  private fun buildPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
      add(LiquidGlassPackage())
      // Packages that cannot be autolinked yet can be added manually here, for example:
      add(LivePlayerPackage())
      add(PipPackage())
      // 口袋48 云信消息通道（房间消息 = 云信圈组 QChat，仅原生 SDK 支持）
      add(PocketImPackage())
      // 云信 commonlink 协议（直播弹幕聊天室 + 成员房间 QChat）：登录包里包名由自己填
      // （com.seine48.app，白名单内）→ 过服务端客户端标识校验
      add(com.yk1z.yayamsg.nim.PocketNimChatroomPackage())
      // 自动链接漏掉 react-native-safe-area-context，这里补上（聊天库依赖其原生 Provider）
      add(com.th3rdwave.safeareacontext.SafeAreaContextPackage())
    }

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> = buildPackages()

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }

  /**
   * Expo SDK 55 已移除 `ReactNativeHostWrapper`（RN 0.83 只支持新架构），改用 `ExpoReactHostFactory`。
   * 它内部会挂上 ExpoModulesPackage 的 host handlers（网络/生命周期链路），
   * Expo 各模块本身由 autolink 生成在 PackageList 里，这里整份传进去即可。
   */
  override val reactHost: ReactHost
    get() = ExpoReactHostFactory.getDefaultReactHost(applicationContext, buildPackages())

  override fun onCreate() {
    // 最先安装：RN 网络模块的 OkHttp 客户端在 JS 首次发请求时才经 createClient(context) 构建，
    // 若先有别的请求把默认 client 缓存进 OkHttpClientProvider 就来不及了。
    installDesktopUaForBilibili()
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  /**
   * B站登录拿不到 cookie 的根因修复：Android RN 的 JS fetch 无法可靠携带自定义 User-Agent 头
   * （RN/OkHttp 路径会覆盖），B站 因此把扫码登录 poll 当移动端处理 → 不返回带 SESSDATA 的
   * crossDomain url（桌面浏览器正常）。这里在 OkHttp 层对 *.bilibili.com 请求强制覆写桌面 UA。
   */
  private fun installDesktopUaForBilibili() {
    OkHttpClientProvider.setOkHttpClientFactory(
      OkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder(applicationContext)
          .addInterceptor(
            Interceptor { chain ->
              val request = chain.request()
              val host = request.url.host
              val isBiliHost = host == "bilibili.com" || host.endsWith(".bilibili.com")
              if (isBiliHost && request.header("User-Agent") != BILI_DESKTOP_UA) {
                chain.proceed(request.newBuilder().header("User-Agent", BILI_DESKTOP_UA).build())
              } else {
                chain.proceed(request)
              }
            }
          )
          .build()
      }
    )
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
