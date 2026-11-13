package com.yk1z.yayamsg.nim

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** 注册云信 commonlink 协议原生模块（直播弹幕聊天室 + 成员房间 QChat） */
class PocketNimChatroomPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(
      PocketNimChatroomModule(reactContext),
      PocketNimQChatModule(reactContext),
    )

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
