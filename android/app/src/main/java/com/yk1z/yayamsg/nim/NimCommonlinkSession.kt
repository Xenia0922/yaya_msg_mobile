package com.yk1z.yayamsg.nim

import android.os.Handler
import android.os.Looper
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.math.min

/**
 * 云信 commonlink 传输层（TCP + RSA 握手 + RC4 流加密 + 分帧 + 请求/应答）。
 *
 * 移植自桌面版 yk1z/yaya_msg 的 `CommonlinkSession`：
 * 聊天室（loginServiceId=13/commandId=2）和 QChat（24/2）共用这一层，
 * 只是登录包与关注的包号不同。
 *
 * 线程模型：单条工作线程读写 socket；回调 post 到主线程。
 */
class NimCommonlinkSession(
  private val host: String,
  private val port: Int,
  private val loginPacket: ByteArray,
  private val loginServiceId: Int,
  private val loginCommandId: Int,
  private val tag: String,
  private val onConnected: () -> Unit,
  private val onPacket: (NimProtocol.Packet) -> Unit,
  private val onStatus: (state: String, detail: String?) -> Unit,
) {

  class Pending(val deadline: Long, val resolve: (NimProtocol.Packet) -> Unit, val reject: (Throwable) -> Unit)

  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()

  @Volatile private var stopped = true
  @Volatile private var loggedIn = false
  private var serial = 1
  private var socket: Socket? = null
  private var output: OutputStream? = null
  private var encryptor: NimProtocol.Rc4Stream? = null
  private var decryptor: NimProtocol.Rc4Stream? = null
  private val pending = mutableMapOf<Int, Pending>()
  private var worker: Thread? = null
  private var reconnectAttempt = 0

  private fun post(block: () -> Unit) = main.post(block)

  private fun nextSerial(): Int {
    val value = serial
    serial = if (value >= 32767) 1 else value + 1
    return value
  }

  val connected: Boolean get() = loggedIn

  fun connect() {
    if (!stopped) return
    stopped = false
    reconnectAttempt = 0
    worker = Thread({ runLoop() }, "nim-session-$tag").also { it.isDaemon = true; it.start() }
  }

  fun destroy() {
    stopped = true
    loggedIn = false
    synchronized(lock) {
      try { socket?.close() } catch (_: Throwable) {}
      socket = null
      output = null
    }
    rejectPending(IllegalStateException("云信连接已关闭"))
  }

  /** 发送一个请求并等应答（同样的 serviceId/commandId 回来时 resolve） */
  fun request(serviceId: Int, commandId: Int, body: ByteArray, timeoutMs: Long = 12_000): NimProtocol.Packet {
    val out = output ?: throw IllegalStateException("云信连接尚未就绪")
    val enc = encryptor ?: throw IllegalStateException("云信连接尚未就绪")
    if (!loggedIn) throw IllegalStateException("云信尚未登录完成")
    val packetSerial: Int
    val packet: ByteArray
    synchronized(lock) {
      packetSerial = nextSerial()
      packet = NimProtocol.makePacket(serviceId, commandId, packetSerial, body)
    }
    val block = java.util.concurrent.CountDownLatch(1)
    var result: NimProtocol.Packet? = null
    var failure: Throwable? = null
    synchronized(lock) {
      pending[packetSerial] = Pending(
        System.currentTimeMillis() + timeoutMs,
        { p -> result = p; block.countDown() },
        { e -> failure = e; block.countDown() },
      )
    }
    synchronized(lock) {
      out.write(enc.apply(packet))
      out.flush()
    }
    if (!block.await(timeoutMs + 500, java.util.concurrent.TimeUnit.MILLISECONDS)) {
      synchronized(lock) { pending.remove(packetSerial) }
      throw IllegalStateException("$tag 请求超时（$serviceId/$commandId）")
    }
    failure?.let { throw it }
    return result ?: throw IllegalStateException("$tag 请求无应答（$serviceId/$commandId）")
  }

  fun writeRaw(packet: ByteArray) {
    val out = output ?: return
    val enc = encryptor ?: return
    synchronized(lock) {
      out.write(enc.apply(packet))
      out.flush()
    }
  }

  private fun rejectPending(error: Throwable) {
    val snapshot: List<Pending>
    synchronized(lock) {
      snapshot = pending.values.toList()
      pending.clear()
    }
    snapshot.forEach { it.reject(error) }
  }

  private fun runLoop() {
    while (!stopped) {
      try {
        post { onStatus("connecting", null) }
        openConnection()
      } catch (t: Throwable) {
        loggedIn = false
        if (!stopped) post { onStatus("error", "$tag: ${t.message ?: t.javaClass.simpleName}") }
      }
      if (stopped) break
      loggedIn = false
      rejectPending(IllegalStateException("$tag 连接已断开"))
      post { onStatus("reconnecting", null) }
      val delay = min(30_000L, 1000L * (1 shl min(reconnectAttempt, 5)))
      reconnectAttempt += 1
      try { Thread.sleep(delay) } catch (_: InterruptedException) { break }
    }
    post { onStatus("disconnected", null) }
  }

  private fun openConnection() {
    val rc4Key = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
    val handshake = makeHandshake(rc4Key)
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
    var loginSent = false
    val chunk = ByteArray(8192)
    var lastHeartbeat = System.currentTimeMillis()

    while (!stopped) {
      val now = System.currentTimeMillis()
      if (loggedIn && now - lastHeartbeat >= 15_000) {
        lastHeartbeat = now
        synchronized(lock) {
          out.write(encryptor!!.apply(NimProtocol.makePacket(1, 2, nextSerial())))
          out.flush()
        }
      }
      synchronized(lock) {
        val iterator = pending.entries.iterator()
        while (iterator.hasNext()) {
          val entry = iterator.next()
          if (entry.value.deadline < now) {
            iterator.remove()
            entry.value.reject(IllegalStateException("$tag 请求超时"))
          }
        }
      }

      if (input.available() <= 0) {
        Thread.sleep(20)
        continue
      }
      val read = input.read(chunk)
      if (read <= 0) throw IllegalStateException("$tag 连接已断开")
      buffer = NimProtocol.concat(buffer, decryptor!!.apply(chunk.copyOfRange(0, read)))

      while (true) {
        val length = NimProtocol.readVarint(buffer, 0, buffer.size) ?: break
        val frameSize = length.size + length.value
        if (buffer.size < frameSize) break
        val raw = buffer.copyOfRange(0, frameSize)
        buffer = buffer.copyOfRange(frameSize, buffer.size)
        var packet = NimProtocol.decodePacket(raw) ?: continue

        if (packet.serviceId == 4 && packet.commandId in intArrayOf(1, 2, 10, 11) && packet.body.size > 8) {
          packet = NimProtocol.decodePacket(packet.body.copyOfRange(8, packet.body.size), embedded = true) ?: continue
        }

        when {
          packet.serviceId == 1 && packet.commandId == 1 -> {
            if (packet.resultCode != 200) throw IllegalStateException("$tag 握手失败：${packet.resultCode}")
            if (!loginSent) {
              loginSent = true
              synchronized(lock) {
                out.write(encryptor!!.apply(loginPacket))
                out.flush()
              }
            }
          }
          packet.serviceId == loginServiceId && packet.commandId == loginCommandId -> {
            if (packet.resultCode != 200) throw IllegalStateException("$tag 登录失败：${packet.resultCode}")
            if (!loggedIn) {
              loggedIn = true
              reconnectAttempt = 0
              // NIM 连接（serviceId 2）登录成功后补一个 24/1 之外的固定动作由调用方负责
              post { onConnected() }
            }
          }
          else -> {
            // 注意：`synchronized` 是 inline，里面的 break/continue 需要 Kotlin 2.2（本项目 2.1.20 编译不过），
            // 所以同步块只做取值，跳转放到外面。
            val waiting = synchronized(lock) { pending.remove(packet.serial) }
            if (waiting != null) {
              waiting.resolve(packet)
              continue
            }
            post { onPacket(packet) }
          }
        }
      }
    }
  }

  private fun makeHandshake(rc4Key: ByteArray): ByteArray {
    val payload = NimProtocol.concat(NimProtocol.encodeBytes(rc4Key), loginPacket)
    val body = NimProtocol.concat(
      NimProtocol.littleEndianInt32(NimProtocol.rsaKeyVersion()),
      NimProtocol.encryptHandshakePayload(payload),
    )
    return NimProtocol.makePacket(1, 1, 0, body)
  }
}
