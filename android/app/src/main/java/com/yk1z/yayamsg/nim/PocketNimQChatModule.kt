package com.yk1z.yayamsg.nim

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicReference

class PocketNimQChatModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var client: NimQChatClient? = null
  private val connectPromise = AtomicReference<Promise?>(null)

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
          connectPromise.getAndSet(null)?.resolve(true)
        }
        "error" -> {
          connectPromise.getAndSet(null)?.reject("E_CONNECT", detail ?: "成员房间连接失败")
        }
        else -> {}
      }
      emit("PocketNimQChat:status", Arguments.createMap().apply {
        putString("state", state)
        putString("detail", detail ?: "")
      })
    }

    override fun onMessage(message: NimQChatMessage) {
      val msgType = when (message.type) {
        0 -> "text"
        100 -> "qchatCustom"
        else -> message.type.toString()
      }
      emit("PocketNimQChat:message", Arguments.createMap().apply {
        putString("serverId", message.serverId)
        putString("channelId", message.channelId)
        putString("fromAccount", message.fromAccount)
        putString("fromNick", message.fromNick)
        putDouble("time", message.time.toDouble())
        putInt("type", message.type)
        putString("msgType", msgType)
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
      connectPromise.getAndSet(promise)?.reject("E_CANCELLED", "已重连")
      next.connect()
    } catch (t: Throwable) {
      connectPromise.compareAndSet(promise, null)
      promise.reject("E_CONNECT", t)
    }
  }

  @ReactMethod
  fun subscribe(serverId: String, promise: Promise) {
    val active = client
    if (active == null) {
      promise.resolve(false)
      return
    }
    Thread({
      try {
        promise.resolve(active.subscribeServer(serverId))
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }, "nim-qchat-sub").also { it.isDaemon = true; it.start() }
  }

  @ReactMethod
  fun subscribeBatch(serverIds: ReadableArray, promise: Promise) {
    val active = client
    if (active == null) {
      promise.resolve(false)
      return
    }
    val ids = ArrayList<String>(serverIds.size())
    for (i in 0 until serverIds.size()) {
      val s = serverIds.getString(i)?.trim().orEmpty()
      if (s.isNotEmpty()) ids.add(s)
    }
    if (ids.isEmpty()) {
      promise.resolve(false)
      return
    }
    Thread({
      try {
        promise.resolve(active.subscribeServers(ids))
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }, "nim-qchat-sub-batch").also { it.isDaemon = true; it.start() }
  }

  @ReactMethod
  fun send(serverId: String, channelId: String, text: String, extJson: String, promise: Promise) {
    val active = client
    if (active == null) {
      promise.reject("E_STATE", "成员房间尚未连接")
      return
    }

    Thread({
      try {
        val msgIdClient = active.sendText(serverId, channelId, text, extJson)
        promise.resolve(msgIdClient)
      } catch (t: Throwable) {
        promise.reject("E_SEND", t)
      }
    }, "nim-qchat-send").also { it.isDaemon = true; it.start() }
  }

  @ReactMethod
  fun sendCustom(serverId: String, channelId: String, attachment: String, extJson: String, promise: Promise) {
    val active = client
    if (active == null) { promise.reject("E_STATE", "成员房间尚未连接"); return }
    Thread({
      try { promise.resolve(active.sendCustom(serverId, channelId, attachment, extJson)) }
      catch (t: Throwable) { promise.reject("E_SEND", t) }
    }, "nim-qchat-sticker").also { it.isDaemon = true; it.start() }
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
    connectPromise.getAndSet(null)?.reject("E_CANCELLED", "已断开")
  }

  override fun invalidate() {
    disconnectInternal()
    super.invalidate()
  }
}
