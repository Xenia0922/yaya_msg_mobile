package com.yk1z.yayamsg.nim

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 成员房间消息（云信 QChat / 圈组）原生模块 —— commonlink 协议版。
 *
 * 与官方 SDK 的区别同聊天室：登录鉴权属性里**包名自己填**（白名单包名），
 * 官方 SDK 只能带真实包名 → 必被服务端拒（实测 IM 登录 414）。
 *
 * 事件：PocketNimQChat:status / :message
 */
class PocketNimQChatModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var client: NimQChatClient? = null
  private var connectPromise: Promise? = null

  override fun getName(): String = "PocketNimQChat"

  private fun emit(event: String, payload: Any?) {
    try {
      if (!reactContext.hasActiveReactInstance()) return
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
    } catch (_: Throwable) {
    }
  }

  private val listener = object : NimQChatClient.Listener {
    override fun onStatus(state: String, detail: String?) {
      when (state) {
        "connected" -> {
          connectPromise?.resolve(true)
          connectPromise = null
        }
        "error" -> {
          connectPromise?.reject("E_CONNECT", detail ?: "成员房间连接失败")
          connectPromise = null
        }
        else -> {}
      }
      emit("PocketNimQChat:status", Arguments.createMap().apply {
        putString("state", state)
        putString("detail", detail ?: "")
      })
    }

    override fun onMessage(message: NimQChatMessage) {
      emit("PocketNimQChat:message", Arguments.createMap().apply {
        putString("serverId", message.serverId)
        putString("channelId", message.channelId)
        putString("fromAccount", message.fromAccount)
        putString("fromNick", message.fromNick)
        putDouble("time", message.time.toDouble())
        putInt("type", message.type)
        putString("body", message.body)
        putString("attachment", message.attachment)
        putString("ext", message.ext)
        putString("msgIdClient", message.msgIdClient)
        putString("msgIdServer", message.msgIdServer)
      })
    }
  }

  @ReactMethod
  fun connect(appKey: String, account: String, token: String, promise: Promise) {
    try {
      disconnectInternal()
      if (appKey.isBlank() || account.isBlank() || token.isBlank()) {
        promise.reject("E_PARAM", "缺少 appKey/account/token")
        return
      }
      val next = NimQChatClient(appKey, account, token, listener)
      client = next
      connectPromise = promise
      next.connect()
    } catch (t: Throwable) {
      promise.reject("E_CONNECT", t)
    }
  }

  @ReactMethod
  fun send(serverId: String, channelId: String, text: String, extJson: String, promise: Promise) {
    val active = client
    if (active == null) {
      promise.reject("E_STATE", "成员房间尚未连接")
      return
    }
    try {
      val msgIdClient = active.sendText(serverId, channelId, text, extJson)
      promise.resolve(msgIdClient)
    } catch (t: Throwable) {
      promise.reject("E_SEND", t)
    }
  }

  @ReactMethod
  fun disconnect() {
    disconnectInternal()
    emit("PocketNimQChat:status", Arguments.createMap().apply {
      putString("state", "disconnected")
      putString("detail", "")
    })
  }

  private fun disconnectInternal() {
    client?.destroy()
    client = null
    connectPromise?.reject("E_CANCELLED", "已断开")
    connectPromise = null
  }

  override fun invalidate() {
    disconnectInternal()
    super.invalidate()
  }
}
