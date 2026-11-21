package com.yk1z.yayamsg.nim

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

class PocketNimChatroomModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var client: NimChatroomClient? = null

  private val connectPromise = AtomicReference<Promise?>(null)

  private val sendPromises = mutableMapOf<String, Promise>()

  private val sendLock = Any()
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
          connectPromise.getAndSet(null)?.resolve(true)
        }
        "error" -> {
          connectPromise.getAndSet(null)?.reject("E_CONNECT", detail ?: "聊天室连接失败")
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
      val promise = synchronized(sendLock) { sendPromises.remove(idClient) }
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
      connectPromise.getAndSet(promise)?.reject("E_CANCELLED", "已重连")
      next.start()
    } catch (t: Throwable) {
      connectPromise.compareAndSet(promise, null)
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
    var registeredId: String? = null
    try {
      val custom = try {
        if (customJson.isBlank()) JSONObject() else JSONObject(customJson)
      } catch (_: Throwable) {
        JSONObject()
      }

      active.sendText(text, custom) { id ->
        registeredId = id
        synchronized(sendLock) { sendPromises[id] = promise }
      }
    } catch (t: Throwable) {
      registeredId?.let { id -> synchronized(sendLock) { sendPromises.remove(id) } }
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
    connectPromise.getAndSet(null)?.reject("E_CANCELLED", "已断开")
    val pending = synchronized(sendLock) {
      val list = sendPromises.values.toList()
      sendPromises.clear()
      list
    }
    for (promise in pending) promise.reject("E_CANCELLED", "已断开")
  }

  override fun invalidate() {
    disconnectInternal()
    super.invalidate()
  }
}
