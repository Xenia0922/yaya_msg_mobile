package com.yk1z.yayamsg.nim

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

/**
 * 云信聊天室（直播弹幕）原生模块 —— commonlink 协议版。
 *
 * 为什么不用 JS 侧现成的云信 Web SDK：它的登录包只能带浏览器/RN 客户端标识，
 * 会被口袋48 appKey 的服务端白名单拒掉（实测 403）；这条原生化实现里
 * **包名字段自己填**，所以能过（桌面版 yk1z/yaya_msg 同做法）。
 *
 * 事件：PocketNimChatroom:status / :message / :sendResult / :online
 */
class PocketNimChatroomModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var client: NimChatroomClient? = null
  /** 连接中的 promise（连上/失败后 resolve/reject） */
  private var connectPromise: Promise? = null
  /** 发送中的 promise 按 idClient 挂起（服务端回执后 resolve） */
  private val sendPromises = mutableMapOf<String, Promise>()
  private var lastStatus: String = "idle"
  private var lastStatusDetail: String? = null

  override fun getName(): String = "PocketNimChatroom"

  private fun emit(event: String, payload: Any?) {
    try {
      if (!reactContext.hasActiveReactInstance()) return
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
    } catch (_: Throwable) {
    }
  }

  private fun emitStatus(state: String, detail: String?) {
    lastStatus = state
    lastStatusDetail = detail
    emit("PocketNimChatroom:status", Arguments.createMap().apply {
      putString("state", state)
      putString("detail", detail ?: "")
    })
  }

  private val listener = object : NimChatroomClient.Listener {
    override fun onStatus(state: String, detail: String?) {
      when (state) {
        "connected" -> {
          connectPromise?.resolve(true)
          connectPromise = null
        }
        "error" -> {
          connectPromise?.reject("E_CONNECT", detail ?: "聊天室连接失败")
          connectPromise = null
        }
        else -> {}
      }
      emitStatus(state, detail)
    }

    override fun onMessage(message: NimChatroomMessage) {
      val payload: WritableMap = Arguments.createMap().apply {
        putString("uuid", message.uuid)
        putInt("msgType", message.msgType)
        putString("text", message.text)
        putString("fromNick", message.fromNick)
        putString("fromAvatar", message.fromAvatar)
        putString("fromAccount", message.fromAccount)
        putDouble("time", message.time.toDouble())
        putString("ext", message.remoteExtension.toString())
      }
      emit("PocketNimChatroom:message", payload)
    }

    override fun onOnlineCount(count: Int) {
      emit("PocketNimChatroom:online", Arguments.createMap().apply { putInt("count", count) })
    }

    override fun onSendResult(idClient: String, ok: Boolean, detail: String?) {
      val promise = sendPromises.remove(idClient)
      if (ok) promise?.resolve(idClient) else promise?.reject("E_SEND", detail ?: "发送弹幕失败")
      emit("PocketNimChatroom:sendResult", Arguments.createMap().apply {
        putString("idClient", idClient)
        putBoolean("ok", ok)
        putString("detail", detail ?: "")
      })
    }
  }

  @ReactMethod
  fun connect(appKey: String, account: String, token: String, roomId: String, promise: Promise) {
    try {
      disconnectInternal()
      if (appKey.isBlank() || account.isBlank() || token.isBlank() || !roomId.matches(Regex("^\\d{1,32}$"))) {
        promise.reject("E_PARAM", "缺少有效的 appKey/account/token/roomId")
        return
      }
      val next = NimChatroomClient(appKey, account, token, roomId, listener)
      client = next
      connectPromise = promise
      next.start()
    } catch (t: Throwable) {
      promise.reject("E_CONNECT", t)
    }
  }

  @ReactMethod
  fun send(text: String, customJson: String, promise: Promise) {
    val active = client
    if (active == null) {
      promise.reject("E_STATE", "聊天室尚未连接")
      return
    }
    try {
      val custom = try {
        if (customJson.isBlank()) JSONObject() else JSONObject(customJson)
      } catch (_: Throwable) {
        JSONObject()
      }
      val idClient = active.sendText(text, custom)
      sendPromises[idClient] = promise
    } catch (t: Throwable) {
      promise.reject("E_SEND", t)
    }
  }

  @ReactMethod
  fun disconnect() {
    disconnectInternal()
    emitStatus("disconnected", null)
  }

  @ReactMethod
  fun status(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("state", lastStatus)
      putString("detail", lastStatusDetail ?: "")
      putBoolean("connected", lastStatus == "connected")
    })
  }

  private fun disconnectInternal() {
    client?.stop()
    client = null
    connectPromise?.reject("E_CANCELLED", "已断开")
    connectPromise = null
    for (promise in sendPromises.values) promise.reject("E_CANCELLED", "已断开")
    sendPromises.clear()
  }

  override fun invalidate() {
    disconnectInternal()
    super.invalidate()
  }
}
