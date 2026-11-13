# 牙牙消息 · ProGuard/R8 keep 规则
# 说明：R8/minify 目前未开启（enableMinifyInReleaseBuilds=false）。
# 本文件是开启 R8 前的安全网，任何库级 keep 规则缺失会在开启后导致运行期崩溃。
# 规则来源：React Native / Hermes / react-native-vector-icons 官方建议 + 本项目原生模块。

# ---- React Native 通用 ----
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# Hermes 调试与字节码
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.** { *; }

# React Native 桥接模块（autolinking 原生模块）
-keep class com.facebook.react.bridge.** { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }
-keepclassmembers class * extends com.facebook.react.bridge.BaseJavaModule { *; }

# ---- react-native-vector-icons（字体资源通过 assets 引用，需 keep 以防混淆破坏） ----
-keep class com.oblador.vectoricons.** { *; }

# ---- 本项目原生模块：直播播放器（LivePlayerActivity / LiveExoView 等） ----
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }
-keep class * extends com.facebook.react.uimanager.ReactShadowNode { *; }
-keep class * implements com.facebook.react.bridge.NativeModule { *; }

# 兜底：保留所有带 @ReactMethod / @ReactModule 注解的成员（Expo 模块通用）
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
    @com.facebook.react.bridge.ReactModule *;
}
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# ---- expo / react-native-webview 等第三方库常见 keep（官方模板默认） ----
-keep class expo.modules.** { *; }
-keep class com.facebook.react.modules.** { *; }
