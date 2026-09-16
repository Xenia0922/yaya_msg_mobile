package com.yk1z.yayamsg.nim

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** 归一化后的房间（圈组）消息，字段对齐桌面版 normalizeIncomingMessage */
data class NimQChatMessage(
  val serverId: String,
  val channelId: String,
  val fromAccount: String,
  val fromClientType: Int,
  val fromNick: String,
  val time: Long,
  /** 9: 0 = 文本，100 = 自定义 */
  val type: Int,
  val body: String,
  val attachment: String,
  val ext: String,
  val msgIdClient: String,
  val msgIdServer: String,
)

/**
 * 成员房间消息（云信 QChat / 圈组）—— commonlink 协议版。
 *
 * 移植自桌面版 `src/common/nim-commonlink-qchat.js`。两条连接：
 *   1) NIM 会话（LBS conf.jsp → TCP，登录包 2/2，鉴权属性 25 填白名单包名）
 *      → `24/1` 取 QChat 接入地址列表
 *   2) QChat 会话（地址列表首项，登录包 24/2）
 *      → 收消息 `24/11`、发消息 `24/10`
 *
 * 与直播弹幕（聊天室）共用 [NimCommonlinkSession] 传输层。
 */
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
  private var nimSession: NimCommonlinkSession? = null
  private var qchatSession: NimCommonlinkSession? = null

  @Volatile private var stopped = true

  private fun post(block: () -> Unit) = main.post(block)

  fun connect() {
    if (!stopped) return
    stopped = false
    nimSession = NimCommonlinkSession(
      host = "",
      port = 0,
      loginPacket = ByteArray(0),
      loginServiceId = NIM_LOGIN_SERVICE_ID,
      loginCommandId = NIM_LOGIN_COMMAND_ID,
      tag = "NIM",
      onConnected = { startQChat() },
      onPacket = { },
      onStatus = { state, detail -> post { listener.onStatus(state, detail) } },
    )
    // 地址要先请求出来，所以这里手动建会话（NimCommonlinkSession 需要 host/port）
    Thread({ bootstrap() }, "nim-qchat-boot").also { it.isDaemon = true; it.start() }
  }

  private fun bootstrap() {
    try {
      post { listener.onStatus("connecting", null) }
      val address = requestNimAddress()
      val deviceId = UUID.randomUUID().toString()
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
      nimSession = session
      session.connect()
    } catch (t: Throwable) {
      post { listener.onStatus("error", t.message ?: t.javaClass.simpleName) }
    }
  }

  /** NIM 登录完成后：24/1 取 QChat 地址 → 连 QChat */
  private fun startQChat() {
    if (stopped) return
    try {
      val session = nimSession ?: return
      val response = session.request(24, 1, NimProtocol.encodeProperties(mapOf(1 to 0)), 15_000)
      val addresses = decodeStringArray(response.body)
      if (addresses.isEmpty()) throw IllegalStateException("云信没有返回 QChat 连接地址")
      val (host, port) = parseAddress(addresses[0])
      val deviceId = UUID.randomUUID().toString()
      val qchat = NimCommonlinkSession(
        host = host,
        port = port,
        loginPacket = makeQChatLoginPacket(deviceId),
        loginServiceId = QCHAT_LOGIN_SERVICE_ID,
        loginCommandId = QCHAT_LOGIN_COMMAND_ID,
        tag = "QChat",
        onConnected = { post { listener.onStatus("connected", null) } },
        onPacket = { packet ->
          if (packet.serviceId == QCHAT_LOGIN_SERVICE_ID && packet.commandId == QCHAT_MSG_COMMAND_ID && packet.body.isNotEmpty()) {
            try {
              post { listener.onMessage(normalizeMessage(packet.body)) }
            } catch (_: Throwable) {
            }
          }
        },
        onStatus = { state, detail -> post { listener.onStatus(state, detail) } },
      )
      qchatSession = qchat
      qchat.connect()
    } catch (t: Throwable) {
      post { listener.onStatus("error", "QChat: ${t.message ?: t.javaClass.simpleName}") }
    }
  }

  /** 发送房间消息：24/10 */
  fun sendText(serverId: String, channelId: String, text: String, extJson: String): String {
    val session = qchatSession ?: throw IllegalStateException("成员房间尚未连接")
    if (!session.connected) throw IllegalStateException("成员房间尚未连接")
    val content = text.trim()
    require(content.isNotEmpty()) { "消息内容不能为空" }
    val msgIdClient = UUID.randomUUID().toString().replace("-", "")
    val properties = mutableMapOf<Int, Any?>(
      1 to serverId,
      2 to channelId,
      3 to account,
      9 to 0,
      10 to content,
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
    session.request(QCHAT_LOGIN_SERVICE_ID, 10, NimProtocol.encodeProperties(properties), 12_000)
    return msgIdClient
  }

  fun destroy() {
    stopped = true
    qchatSession?.destroy()
    nimSession?.destroy()
    qchatSession = null
    nimSession = null
    post { listener.onStatus("disconnected", null) }
  }

  // ---------------- 内部 ----------------

  private fun makeNimLoginPacket(deviceId: String): ByteArray = NimProtocol.makePacket(
    2, 2, 1,
    NimProtocol.encodeProperties(
      mapOf(
        3 to 1,
        4 to "8.0.0",
        6 to NimProtocol.ANDROID_SDK_VERSION,
        8 to 1,
        9 to 1,
        13 to deviceId,
        18 to appKey,
        19 to account,
        25 to NimProtocol.ANDROID_PACKAGE_NAME,
        40 to NimProtocol.ANDROID_SDK_HUMAN_VERSION,
        42 to "Native/9.17.1.13231",
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
        9 to 91701,
        10 to 1,
        11 to "Native/9.17.1.13231",
        14 to "9.17.1",
      )
    )
  )

  private fun requestNimAddress(): Pair<String, Int> {
    val url = URL("$lbsUrl?k=$appKey&id=$account&v=91701&tp=1&dt=0")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 15_000
      requestMethod = "GET"
    }
    val text = connection.inputStream.bufferedReader().use { it.readText() }
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

  /** varint(count) + 每项 varint(len)+bytes（桌面版 decodeStringArray） */
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
  }
}
