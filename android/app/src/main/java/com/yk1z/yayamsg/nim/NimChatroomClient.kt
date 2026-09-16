package com.yk1z.yayamsg.nim

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.UUID
import kotlin.math.min

/** 归一化后的聊天室消息（字段对齐桌面版 normalizeMessage） */
data class NimChatroomMessage(
  val uuid: String,
  /** 0 = 文本，100 = 自定义（弹幕/礼物/进场等走 remoteExtension） */
  val msgType: Int,
  val text: String,
  val fromNick: String,
  val fromAvatar: String,
  val fromAccount: String,
  val time: Long,
  val remoteExtension: JSONObject,
  /** 原始属性表（排查用） */
  val raw: Map<Int, String>,
)

/**
 * 云信聊天室客户端（commonlink 协议，移植自桌面版 yk1z/yaya_msg）。
 *
 * 与官方 SDK 的区别：**包名字段由我们自己填**（NimProtocol.ANDROID_PACKAGE_NAME），
 * 因此能通过口袋48 appKey 的客户端标识校验（官方 SDK 会用真实包名 → 414/403）。
 *
 * 线程模型：单条工作线程跑 socket 读写；回调统一 post 到主线程。
 */
class NimChatroomClient(
  private val appKey: String,
  private val account: String,
  private val token: String,
  private val roomId: String,
  private val listener: Listener,
  /** 聊天室 LBS（chat.jsp 是聊天室专用；IM 用 conf.jsp） */
  private val lbsUrl: String = "https://lbs.netease.im/lbs/chat.jsp",
) {

  interface Listener {
    /** connecting | connected | reconnecting | disconnected | error */
    fun onStatus(state: String, detail: String?)
    fun onMessage(message: NimChatroomMessage)
    fun onOnlineCount(count: Int)
    /** 弹幕发送结果（idClient 可对上发送时返回的） */
    fun onSendResult(idClient: String, ok: Boolean, detail: String?)
  }

  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()

  @Volatile private var stopped = true
  @Volatile private var connected = false
  private var serial = 1
  private var reconnectAttempt = 0
  private var reconnectAt = 0L
  private var socket: Socket? = null
  private var output: OutputStream? = null
  private var encryptor: NimProtocol.Rc4Stream? = null
  private var decryptor: NimProtocol.Rc4Stream? = null
  private val pending = mutableMapOf<Int, PendingSend>()
  private var worker: Thread? = null

  private class PendingSend(val idClient: String, val deadline: Long)

  private fun post(block: () -> Unit) {
    main.post(block)
  }

  private fun nextSerial(): Int {
    val value = serial
    serial = if (value >= 32767) 1 else value + 1
    return value
  }

  fun start() {
    if (!stopped) return
    stopped = false
    reconnectAttempt = 0
    worker = Thread({ runLoop() }, "nim-chatroom").also { it.isDaemon = true; it.start() }
  }

  fun stop() {
    stopped = true
    connected = false
    synchronized(lock) {
      try { socket?.close() } catch (_: Throwable) {}
      socket = null
      output = null
    }
    post { listener.onStatus("disconnected", null) }
  }

  /** 发弹幕；返回 idClient（发送结果经 [Listener.onSendResult] 回来） */
  fun sendText(text: String, custom: JSONObject): String {
    val out = output ?: throw IllegalStateException("聊天室尚未连接")
    val enc = encryptor ?: throw IllegalStateException("聊天室尚未连接")
    if (!connected) throw IllegalStateException("聊天室尚未连接")
    val content = text.trim()
    require(content.isNotEmpty()) { "弹幕内容不能为空" }
    require(content.length <= 100) { "弹幕最多 100 个字符" }

    val idClient = UUID.randomUUID().toString().replace("-", "")
    val body = NimProtocol.encodeProperties(
      mapOf(
        1 to idClient,
        2 to 0,
        3 to content,
        4 to custom.toString(),
        5 to 0,
        13 to content,
        20 to System.currentTimeMillis(),
        21 to account,
        22 to roomId,
        23 to 3,
      )
    )
    val packet = NimProtocol.makePacket(13, 6, nextSerial(), body)
    synchronized(lock) {
      pending[serialOf(packet)] = PendingSend(idClient, System.currentTimeMillis() + 12_000)
      out.write(enc.apply(packet))
      out.flush()
    }
    return idClient
  }

  private fun serialOf(packet: ByteArray): Int {
    val len = NimProtocol.readVarint(packet, 0, packet.size) ?: return 0
    val offset = len.size
    if (offset + 4 > packet.size) return 0
    return (packet[offset + 2].toInt() and 0xff) or ((packet[offset + 3].toInt() and 0xff) shl 8)
  }

  // ---------------- 主循环 ----------------

  private fun runLoop() {
    while (!stopped) {
      try {
        post { listener.onStatus("connecting", null) }
        openConnection()
        // openConnection 正常返回意味着连接已断开
      } catch (t: Throwable) {
        if (!stopped) post { listener.onStatus("error", t.message ?: t.javaClass.simpleName) }
      }
      if (stopped) break
      connected = false
      post { listener.onStatus("reconnecting", null) }
      val delay = min(30_000L, 1000L * (1 shl min(reconnectAttempt, 5)))
      reconnectAttempt += 1
      try { Thread.sleep(delay) } catch (_: InterruptedException) { break }
    }
    post { listener.onStatus("disconnected", null) }
  }

  private fun openConnection() {
    val (host, port) = requestAddress()
    val deviceId = UUID.randomUUID().toString()
    val rc4Key = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
    val enterPacket = makeEnterPacket(deviceId)
    val handshake = makeHandshake(rc4Key, enterPacket)
    encryptor = NimProtocol.Rc4Stream(rc4Key)
    decryptor = NimProtocol.Rc4Stream(rc4Key)

    val sock = Socket()
    sock.tcpNoDelay = true
    sock.keepAlive = true
    sock.connect(InetSocketAddress(host, port), 20_000)
    socket = sock
    val out = sock.getOutputStream()
    output = out
    out.write(handshake)
    out.flush()

    val input = BufferedInputStream(sock.getInputStream())
    var buffer = ByteArray(0)
    var enterSent = false
    val chunk = ByteArray(8192)
    reconnectAt = System.currentTimeMillis()
    var lastHeartbeat = System.currentTimeMillis()

    while (!stopped) {
      // 心跳（15s）：serviceId=1, commandId=2
      val now = System.currentTimeMillis()
      if (now - lastHeartbeat >= 15_000) {
        lastHeartbeat = now
        synchronized(lock) {
          out.write(encryptor!!.apply(NimProtocol.makePacket(1, 2, nextSerial())))
          out.flush()
        }
      }
      // 发送超时清理
      synchronized(lock) {
        val iterator = pending.entries.iterator()
        while (iterator.hasNext()) {
          val entry = iterator.next()
          if (entry.value.deadline < now) {
            val idClient = entry.value.idClient
            iterator.remove()
            post { listener.onSendResult(idClient, false, "发送弹幕超时") }
          }
        }
      }

      val available = input.available()
      if (available <= 0) {
        Thread.sleep(30)
        continue
      }
      val read = input.read(chunk)
      if (read <= 0) throw IllegalStateException("聊天室连接已断开")
      val decrypted = decryptor!!.apply(chunk.copyOfRange(0, read))
      buffer = NimProtocol.concat(buffer, decrypted)

      while (true) {
        val length = NimProtocol.readVarint(buffer, 0, buffer.size) ?: break
        val frameSize = length.size + length.value
        if (buffer.size < frameSize) break
        val raw = buffer.copyOfRange(0, frameSize)
        buffer = buffer.copyOfRange(frameSize, buffer.size)
        var packet = NimProtocol.decodePacket(raw) ?: continue

        // 4/{1,2,10,11} 是"内嵌包"，需要再解一层（前 8 字节是固定头）
        if (packet.serviceId == 4 && packet.commandId in intArrayOf(1, 2, 10, 11) && packet.body.size > 8) {
          val embedded = NimProtocol.decodePacket(packet.body.copyOfRange(8, packet.body.size), embedded = true) ?: continue
          packet = embedded
        }

        when {
          packet.serviceId == 1 && packet.commandId == 1 -> {
            if (packet.resultCode != 200) throw IllegalStateException("聊天室握手失败：${packet.resultCode}")
            if (!enterSent) {
              enterSent = true
              synchronized(lock) {
                out.write(encryptor!!.apply(enterPacket))
                out.flush()
              }
            }
          }
          packet.serviceId == 13 && packet.commandId == 2 -> {
            if (packet.resultCode != 200) throw IllegalStateException("进入直播聊天室失败：${packet.resultCode}")
            if (!connected) {
              connected = true
              reconnectAttempt = 0
              post { listener.onStatus("connected", null) }
            }
          }
          packet.serviceId == 13 && packet.commandId == 7 -> handleMessage(packet.body, out)
          packet.serviceId == 13 && packet.commandId == 6 -> handleSendResult(packet)
          packet.serviceId == 13 && packet.commandId == 13 -> handleOnlineCount(packet)
        }
      }
    }
  }

  private fun makeEnterPacket(deviceId: String): ByteArray {
    val login = NimProtocol.encodeProperties(
      mapOf(
        1 to appKey,
        2 to account,
        3 to deviceId,
        5 to roomId,
        8 to 1,
      )
    )
    val authentication = NimProtocol.encodeProperties(
      mapOf(
        3 to 1,
        4 to NimProtocol.ANDROID_SDK_HUMAN_VERSION,
        6 to NimProtocol.ANDROID_SDK_VERSION,
        9 to 1,
        13 to deviceId,
        18 to appKey,
        19 to account,
        // 关键：伪装的客户端包名（服务端标识校验看这一项）
        25 to NimProtocol.ANDROID_PACKAGE_NAME,
        1000 to token,
      )
    )
    val body = NimProtocol.concat(byteArrayOf(2), login, authentication)
    return NimProtocol.makePacket(13, 2, nextSerial(), body)
  }

  private fun makeHandshake(key: ByteArray, enterPacket: ByteArray): ByteArray {
    val payload = NimProtocol.concat(NimProtocol.encodeBytes(key), enterPacket)
    val body = NimProtocol.concat(
      NimProtocol.littleEndianInt32(NimProtocol.rsaKeyVersion()),
      NimProtocol.encryptHandshakePayload(payload),
    )
    return NimProtocol.makePacket(1, 1, 0, body)
  }

  private fun handleMessage(body: ByteArray, out: OutputStream) {
    val properties = NimProtocol.decodeProperties(body)
    val msgType = (properties[2] ?: "-1").toIntOrNull() ?: -1
    val attachment = properties[3] ?: ""
    val custom = properties[4] ?: ""
    val ext = try {
      if (custom.isBlank()) JSONObject() else JSONObject(custom)
    } catch (_: Throwable) {
      JSONObject()
    }
    val message = NimChatroomMessage(
      uuid = properties[1] ?: "",
      msgType = msgType,
      text = if (msgType == 0) attachment else (properties[13] ?: ""),
      fromNick = properties[7] ?: "",
      fromAvatar = properties[8] ?: "",
      fromAccount = properties[21] ?: "",
      time = (properties[20] ?: "").toLongOrNull() ?: System.currentTimeMillis(),
      remoteExtension = ext,
      raw = properties,
    )
    post { listener.onMessage(message) }

    // 属性 38 == "1" 时需要回 ack（服务端要求）
    if (properties[38] == "1" && message.uuid.isNotEmpty()) {
      val ack = NimProtocol.makePacket(
        13,
        35,
        nextSerial(),
        NimProtocol.encodeProperties(mapOf(1 to message.uuid, 2 to roomId)),
      )
      synchronized(lock) {
        out.write(encryptor!!.apply(ack))
        out.flush()
      }
    }
  }

  private fun handleSendResult(packet: NimProtocol.Packet) {
    val properties = NimProtocol.decodeProperties(packet.body)
    val idClient = properties[1] ?: ""
    var pendingSend: PendingSend? = null
    synchronized(lock) {
      val entry = pending.entries.firstOrNull { it.key == packet.serial }
      if (entry != null) {
        pendingSend = entry.value
        pending.remove(entry.key)
      }
    }
    val ok = packet.resultCode == 200
    val resolvedClient = pendingSend?.idClient ?: idClient
    post { listener.onSendResult(resolvedClient, ok, if (ok) null else "code=${packet.resultCode}") }
  }

  private fun handleOnlineCount(packet: NimProtocol.Packet) {
    val count = extractOnlineMemberNum(packet.body)
    if (count != null) post { listener.onOnlineCount(count) }
  }

  private fun requestAddress(): Pair<String, Int> {
    val url = URL(
      "$lbsUrl?k=$appKey&id=$account&rid=$roomId" +
        "&v=${NimProtocol.ANDROID_SDK_VERSION}&tp=1&dt=0&nt=2"
    )
    val connection = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 15_000
      readTimeout = 15_000
      requestMethod = "GET"
    }
    val text = connection.inputStream.bufferedReader().use { it.readText() }
    val link = try {
      JSONObject(text).optJSONArray("link")?.optString(0) ?: ""
    } catch (_: Throwable) {
      ""
    }
    val separator = link.lastIndexOf(':')
    val host = link.substring(0, separator.coerceAtLeast(0)).trim('[', ']')
    val port = link.substring(separator + 1).toIntOrNull() ?: 0
    if (host.isEmpty() || port !in 1..65535) throw IllegalStateException("云信没有返回有效的聊天室地址")
    return host to port
  }
}

/** 从聊天室信息包里挖在线人数（属性 101 或嵌套层） */
fun extractOnlineMemberNum(buffer: ByteArray, depth: Int = 0): Int? {
  if (buffer.isEmpty() || depth > 4) return null
  val properties = try {
    val out = mutableMapOf<Int, ByteArray>()
    val count = NimProtocol.readVarint(buffer, 0, buffer.size) ?: return null
    if (count.value > 1024) return null
    var offset = count.size
    for (i in 0 until count.value) {
      val key = NimProtocol.readVarint(buffer, offset, buffer.size) ?: return null
      offset += key.size
      val len = NimProtocol.readVarint(buffer, offset, buffer.size) ?: return null
      offset += len.size
      if (offset + len.value > buffer.size) return null
      out[key.value] = buffer.copyOfRange(offset, offset + len.value)
      offset += len.value
    }
    out
  } catch (_: Throwable) {
    return null
  }
  properties[101]?.let { value ->
    val text = String(value, Charsets.UTF_8).trim()
    if (text.matches(Regex("^\\d{1,10}$"))) return text.toInt()
  }
  for ((_, value) in properties) {
    extractOnlineMemberNum(value, depth + 1)?.let { return it }
  }
  return null
}
