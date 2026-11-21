package com.yk1z.yayamsg

import android.app.Application
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.os.Build
import androidx.core.content.res.ResourcesCompat

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider

import okhttp3.Interceptor

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

private const val BILI_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"

class MainApplication : Application(), ReactApplication {

  private fun buildPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {

      add(LivePlayerPackage())
      add(PipPackage())

      add(PocketImPackage())

      add(GiftEffectPackage())

      add(ApkUpdaterPackage())

      add(SecureVaultPackage())

      add(MediaProbePackage())

      add(PublicDownloadsPackage())

      add(ContinuousCornerPackage())

      add(com.yk1z.yayamsg.nim.PocketNimChatroomPackage())

      add(com.th3rdwave.safeareacontext.SafeAreaContextPackage())
    }

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> = buildPackages()

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }

  override val reactHost: ReactHost
    get() = ExpoReactHostFactory.getDefaultReactHost(applicationContext, buildPackages())

  override fun onCreate() {

    installDesktopUaForBilibili()
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    registerAppFonts()
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  private fun registerAppFonts() {
    val typeface: Typeface? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        try {
          val latinFamily = FontFamily.Builder(
            Font.Builder(resources, R.font.google_sans_flex_regular).setWeight(400).build(),
          )
            .addFont(Font.Builder(resources, R.font.google_sans_flex_medium).setWeight(500).build())
            .addFont(Font.Builder(resources, R.font.google_sans_flex_semibold).setWeight(600).build())
            .addFont(Font.Builder(resources, R.font.google_sans_flex_bold).setWeight(700).build())
            .build()
          val cjkFamily = FontFamily.Builder(
            Font.Builder(resources, R.font.chiron_goround_regular).setWeight(400).build(),
          ).build()
          Typeface.CustomFallbackBuilder(latinFamily)
            .addCustomFallback(cjkFamily)
            .setSystemFallback("sans-serif")
            .build()
        } catch (_: Throwable) {
          ResourcesCompat.getFont(this, R.font.google_sans_flex)
        }
      } else {
        ResourcesCompat.getFont(this, R.font.chiron_goround_regular)
          ?: ResourcesCompat.getFont(this, R.font.google_sans_flex)
      }
    if (typeface != null) {
      ReactFontManager.getInstance().addCustomFont("GoogleSansFlex", typeface)
    } else {
      ReactFontManager.getInstance().addCustomFont(this, "GoogleSansFlex", R.font.google_sans_flex)
    }
  }

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
