package com.yk1z.yayamsg.nim

import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

data class NimQChatMessage(
  val serverId: String,
  val channelId: String,
  val fromAccount: String,
  val fromClientType: Int,
  val fromNick: String,
  val time: Long,

  val type: Int,
  val body: String,
  val attachment: String,
  val ext: String,
  val msgIdClient: String,
  val msgIdServer: String,
)

class NimQChatClient(
  private val appKey: String,
  private val account: String,
  private val token: String,
  private val listener: Listener,
  private val lbsUrl: String = "https://lbs.netease.im/lbs/conf.jsp",
) {

  interface Listener {
    fun onStatus(state: String, detail: String?)
    fun onMessage(message: NimQChatMessage)
  }

  private val main = Handler(Looper.getMainLooper())
  private val stateLock = Any()
  private val subscribedServerIds = mutableSetOf<Long>()
  private val deviceId = UUID.randomUUID().toString()
  private var nimSession: NimCommonlinkSession? = null
  private var qchatSession: NimCommonlinkSession? = null

  @Volatile private var stopped = true

  private fun post(block: () -> Unit) = main.post(block)

  fun connect() {
    synchronized(stateLock) {
      if (!stopped) return
      stopped = false
    }

    Thread({ bootstrap() }, "nim-qchat-boot").also { it.isDaemon = true; it.start() }
  }

  private fun bootstrap() {
    try {
      post { listener.onStatus("connecting", null) }
      val address = requestNimAddress()
      val session = NimCommonlinkSession(
        host = address.first,
        port = address.second,
        loginPacket = makeNimLoginPacket(deviceId),
        loginServiceId = NIM_LOGIN_SERVICE_ID,
        loginCommandId = NIM_LOGIN_COMMAND_ID,
        tag = "NIM",
        onConnected = { startQChat() },
        onPacket = { },
        onStatus = { state, detail -> if (state == "error" || state == "reconnecting") post { listener.onStatus(state, detail) } },
      )
      synchronized(stateLock) {
        if (stopped) return
        val oldNim = nimSession
        nimSession = session
        if (oldNim != null && oldNim !== session) {
          try { oldNim.destroy() } catch (_: Throwable) {}
        }
      }
      session.connect()
    } catch (t: Throwable) {
      if (!stopped) {
        post { listener.onStatus("error", t.message ?: t.javaClass.simpleName) }
      }
    }
  }

  private fun startQChat() {
    if (stopped) return
    Thread({ startQChatBlocking() }, "nim-qchat-link").also { it.isDaemon = true; it.start() }
  }

  private fun startQChatBlocking() {
    if (stopped) return
    try {
      val session = synchronized(stateLock) { nimSession } ?: return
      val response = session.request(24, 1, NimProtocol.encodeProperties(mapOf(1 to 0)), 15_000)
      if (stopped) return
      val addresses = decodeStringArray(response.body)
      Log.i("NimCommonlink", "[QChat] 24/1 code=${response.resultCode} addrs=$addresses")
      if (addresses.isEmpty()) throw IllegalStateException("云信没有返回 QChat 连接地址")
      val parsedEndpoints = addresses.mapNotNull { runCatching { parseAddress(it) }.getOrNull() }
      if (parsedEndpoints.isEmpty()) throw IllegalStateException("云信返回的 QChat 连接地址无效")
      val (host, port) = parsedEndpoints[0]
      val qchat = NimCommonlinkSession(
        host = host,
        port = port,
        loginPacket = makeQChatLoginPacket(deviceId),
        loginServiceId = QCHAT_LOGIN_SERVICE_ID,
        loginCommandId = QCHAT_LOGIN_COMMAND_ID,
        tag = "QChat",
        onConnected = {
          val sids = synchronized(subscribedServerIds) { subscribedServerIds.toList() }
          if (sids.isNotEmpty() && !stopped) {
            Thread({
              try {
                val active = synchronized(stateLock) { qchatSession }
                if (active != null && active.connected && !stopped) {
                  sendSubscribe(active, sids)
                }
              } catch (_: Throwable) {
              }
            }, "nim-qchat-resub").also { it.isDaemon = true; it.start() }
          }
          post { listener.onStatus("connected", null) }
        },
        onPacket = { packet ->
          if (packet.serviceId == QCHAT_LOGIN_SERVICE_ID && packet.commandId == QCHAT_MSG_COMMAND_ID && packet.body.isNotEmpty()) {
            try {
              post { listener.onMessage(normalizeMessage(packet.body)) }
            } catch (_: Throwable) {
            }
          }
        },
        onStatus = { state, detail -> post { listener.onStatus(state, detail) } },
        embedLoginInHandshake = false,
        endpoints = parsedEndpoints,
      )

      val oldQChat: NimCommonlinkSession?
      synchronized(stateLock) {
        if (stopped) return
        oldQChat = qchatSession
        qchatSession = qchat
      }
      if (oldQChat != null && oldQChat !== qchat) {
        try { oldQChat.destroy() } catch (_: Throwable) {
        }
      }
      qchat.connect()
    } catch (t: Throwable) {
      if (!stopped) {
        post { listener.onStatus("error", "QChat: ${t.message ?: t.javaClass.simpleName}") }
      }
    }
  }

  fun subscribeServer(serverId: String): Boolean {
    return subscribeServers(listOf(serverId))
  }

  fun subscribeServers(serverIds: List<String>): Boolean {
    val validIds = serverIds.mapNotNull { it.trim().toLongOrNull() }.filter { it > 0L }.distinct()
    if (validIds.isEmpty()) return false
    val newIds: List<Long>
    synchronized(subscribedServerIds) {
      newIds = validIds.filter { subscribedServerIds.add(it) }
    }
    val toSend = if (newIds.isNotEmpty()) newIds else validIds
    val session = synchronized(stateLock) { qchatSession }
    if (stopped || session == null || !session.connected) return false
    return try {
      sendSubscribe(session, toSend)
    } catch (_: Throwable) {
      false
    }
  }

  private fun sendSubscribe(session: NimCommonlinkSession, serverIds: List<Long>): Boolean {
    if (serverIds.isEmpty()) return false
    val bodyParts = ArrayList<ByteArray>(2 + serverIds.size)

    bodyParts.add(NimProtocol.littleEndianInt32(1))
    bodyParts.add(NimProtocol.encodeVarint(serverIds.size.toLong()))
    for (sid in serverIds) {
      bodyParts.add(NimProtocol.littleEndianInt64(sid))
    }
    val body = NimProtocol.concat(*bodyParts.toTypedArray())
    val response = session.request(QCHAT_SUBSCRIBE_SERVICE_ID, QCHAT_SUBSCRIBE_ALL_COMMAND_ID, body, 10_000)
    Log.i("NimCommonlink", "[QChat] 25/7 subscribe count=${serverIds.size} code=${response.resultCode}")
    return response.resultCode == 200 || response.resultCode == 0
  }

  fun sendText(serverId: String, channelId: String, text: String, extJson: String): String {
    return sendMessage(serverId, channelId, text, extJson, null)
  }

  fun sendCustom(serverId: String, channelId: String, attachment: String, extJson: String): String {
    return sendMessage(serverId, channelId, "", extJson, attachment)
  }

  private fun sendMessage(serverId: String, channelId: String, text: String, extJson: String, attachment: String?): String {
    val session = qchatSession ?: throw IllegalStateException("成员房间尚未连接")
    if (!session.connected) throw IllegalStateException("成员房间尚未连接")
    val content = text.trim()
    require(content.isNotEmpty() || !attachment.isNullOrBlank()) { "消息内容不能为空" }
    val msgIdClient = UUID.randomUUID().toString().replace("-", "")
    val properties = mutableMapOf<Int, Any?>(
      1 to serverId,
      2 to channelId,
      3 to account,
      9 to if (attachment == null) 0 else 100,
      12 to (extJson ?: ""),
      13 to msgIdClient,
      20 to 0,
      21 to "QChat",
      100 to 1,
      101 to 1,
      102 to 1,
      103 to 1,
      105 to 1,
    )
    if (content.isNotEmpty()) properties[10] = content
    if (!attachment.isNullOrBlank()) properties[11] = attachment
    val response = session.request(QCHAT_LOGIN_SERVICE_ID, 10, NimProtocol.encodeProperties(properties), 12_000)
    if (response.resultCode != 200) {
      throw IllegalStateException("房间消息发送失败（${response.resultCode}）")
    }
    return msgIdClient
  }

  fun destroy() {
    val qchat: NimCommonlinkSession?
    val nim: NimCommonlinkSession?
    synchronized(stateLock) {
      stopped = true
      subscribedServerIds.clear()
      qchat = qchatSession
      nim = nimSession
      qchatSession = null
      nimSession = null
    }
    qchat?.destroy()
    nim?.destroy()
    post { listener.onStatus("disconnected", null) }
  }

  private fun makeNimLoginPacket(deviceId: String): ByteArray = NimProtocol.makePacket(
    2, 2, 1,
    NimProtocol.encodeProperties(
      mapOf(
        3 to 1,
        4 to NimProtocol.APP_VERSION_FIELD,
        6 to NimProtocol.ANDROID_SDK_VERSION,
        8 to 1,
        9 to 1,
        13 to deviceId,
        18 to appKey,
        19 to account,
        25 to NimProtocol.ANDROID_PACKAGE_NAME,
        40 to NimProtocol.ANDROID_SDK_HUMAN_VERSION,
        42 to NimProtocol.ANDROID_USER_AGENT,
        1000 to token,
      )
    )
  )

  private fun makeQChatLoginPacket(deviceId: String): ByteArray = NimProtocol.makePacket(
    24, 2, 1,
    NimProtocol.encodeProperties(
      mapOf(
        1 to appKey,
        2 to account,
        3 to 0,
        4 to token,
        6 to 1,
        8 to deviceId,
        9 to NimProtocol.ANDROID_SDK_VERSION,
        10 to 1,
        11 to NimProtocol.ANDROID_USER_AGENT,
        14 to NimProtocol.ANDROID_SDK_HUMAN_VERSION,

        32 to NimProtocol.ANDROID_PACKAGE_NAME,
      )
    )
  )

  private fun requestNimAddress(): Pair<String, Int> {
    val url = URL("$lbsUrl?k=$appKey&id=$account&v=${NimProtocol.ANDROID_SDK_VERSION}&tp=1&dt=0")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 15_000
      requestMethod = "GET"
    }
    val text = try {
      connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
      try { connection.disconnect() } catch (_: Throwable) {}
    }
    val link = try {
      JSONObject(text).optJSONObject("common")?.optJSONArray("link")?.optString(0) ?: ""
    } catch (_: Throwable) {
      ""
    }
    if (link.isEmpty()) throw IllegalStateException("云信没有返回 NIM 连接地址")
    return parseAddress(link)
  }

  private fun parseAddress(value: String): Pair<String, Int> {
    val separator = value.lastIndexOf(':')
    val host = value.substring(0, separator.coerceAtLeast(0)).trim('[', ']')
    val port = value.substring(separator + 1).toIntOrNull() ?: 0
    if (host.isEmpty() || port !in 1..65535) throw IllegalStateException("云信返回的连接地址无效：$value")
    return host to port
  }

  private fun normalizeMessage(body: ByteArray): NimQChatMessage {
    val properties = NimProtocol.decodeProperties(body)
    return NimQChatMessage(
      serverId = properties[1] ?: "",
      channelId = properties[2] ?: "",
      fromAccount = properties[3] ?: "",
      fromClientType = (properties[4] ?: "0").toIntOrNull() ?: 0,
      fromNick = properties[6] ?: "",
      time = (properties[7] ?: "0").toLongOrNull() ?: 0L,
      type = (properties[9] ?: "0").toIntOrNull() ?: 0,
      body = properties[10] ?: "",
      attachment = properties[11] ?: "",
      ext = properties[12] ?: "",
      msgIdClient = properties[13] ?: "",
      msgIdServer = properties[14] ?: "",
    )
  }

  private fun decodeStringArray(buffer: ByteArray): List<String> {
    val out = mutableListOf<String>()
    val count = NimProtocol.readVarint(buffer, 0, buffer.size) ?: return out
    var offset = count.size
    for (i in 0 until count.value) {
      val len = NimProtocol.readVarint(buffer, offset, buffer.size) ?: break
      offset += len.size
      if (offset + len.value > buffer.size) break
      out.add(String(buffer, offset, len.value, Charsets.UTF_8))
      offset += len.value
    }
    return out
  }

  companion object {
    private const val NIM_LOGIN_SERVICE_ID = 2
    private const val NIM_LOGIN_COMMAND_ID = 2
    private const val QCHAT_LOGIN_SERVICE_ID = 24
    private const val QCHAT_LOGIN_COMMAND_ID = 2
    private const val QCHAT_MSG_COMMAND_ID = 11
    private const val QCHAT_SUBSCRIBE_SERVICE_ID = 25
    private const val QCHAT_SUBSCRIBE_ALL_COMMAND_ID = 7
  }
}
