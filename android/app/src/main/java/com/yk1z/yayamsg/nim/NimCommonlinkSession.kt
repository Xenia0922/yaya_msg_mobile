package com.yk1z.yayamsg.nim

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.math.min

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
  private val embedLoginInHandshake: Boolean = true,
  private val endpoints: List<Pair<String, Int>> = listOf(host to port),
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
    val w = worker
    worker = null
    try { w?.interrupt() } catch (_: Throwable) {}
    synchronized(lock) {
      try { socket?.close() } catch (_: Throwable) {}
      socket = null
      output = null
    }
    rejectPending(IllegalStateException("云信连接已关闭"))
  }

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

  private fun buildTargets(): List<Pair<String, Int>> {
    val raw = endpoints.ifEmpty { listOf(host to port) }.distinct()
    val ordered = ArrayList<Pair<String, Int>>(raw.size * 2)
    val seen = HashSet<String>()
    fun addUnique(h: String, p: Int) {
      val key = "$h:$p"
      if (h.isNotEmpty() && p in 1..65535 && seen.add(key)) ordered.add(h to p)
    }
    for ((epHost, epPort) in raw) {
      val sysIp = try {
        InetAddress.getAllByName(epHost).firstOrNull()?.hostAddress ?: ""
      } catch (_: Throwable) {
        ""
      }
      val synthetic = sysIp.isNotEmpty() && NimProtocol.isSyntheticOrBogonIpv4(sysIp)
      if (synthetic || sysIp.isEmpty()) {
        val realIp = NimProtocol.resolveRealIpv4(epHost)
        if (!realIp.isNullOrEmpty()) {
          Log.i("NimCommonlink", "[$tag] DNS $epHost sys=$sysIp -> DoH real=$realIp")
          addUnique(realIp, epPort)
        }
        addUnique(epHost, epPort)
      } else {
        addUnique(epHost, epPort)
        val realIp = NimProtocol.resolveRealIpv4(epHost)
        if (!realIp.isNullOrEmpty() && realIp != sysIp) addUnique(realIp, epPort)
      }
    }
    return ordered
  }

  private fun runLoop() {
    while (!stopped) {
      val targets = buildTargets()
      var roundError: Throwable? = null
      var hadSession = false
      for ((idx, target) in targets.withIndex()) {
        if (stopped) break
        loggedIn = false
        try {
          if (idx == 0) post { onStatus("connecting", null) }
          val established = openConnection(target.first, target.second)
          if (established) hadSession = true
          roundError = null
          break
        } catch (t: Throwable) {
          val wasLoggedIn = loggedIn
          loggedIn = false
          roundError = t
          if (stopped) break
          if (wasLoggedIn) {
            hadSession = true
            break
          }
          Log.w("NimCommonlink", "[$tag] candidate ${target.first}:${target.second} failed: ${t.message}")
        }
      }
      if (stopped) break
      loggedIn = false
      roundError?.let { t ->
        post { onStatus("error", "$tag: ${t.message ?: t.javaClass.simpleName}") }
      }
      rejectPending(IllegalStateException("$tag 连接已断开"))
      post { onStatus("reconnecting", null) }
      if (hadSession) reconnectAttempt = 0
      val delay = min(30_000L, 1000L * (1 shl min(reconnectAttempt, 5)))
      reconnectAttempt += 1
      try { Thread.sleep(delay) } catch (_: InterruptedException) { break }
    }
    post { onStatus("disconnected", null) }
  }

  private fun openConnection(targetHost: String, targetPort: Int): Boolean {
    val rc4Key = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
    val handshake = makeHandshake(rc4Key)
    encryptor = NimProtocol.Rc4Stream(rc4Key)
    decryptor = NimProtocol.Rc4Stream(rc4Key)
    var becameLoggedIn = false

    val sock = Socket()
    try {
      sock.tcpNoDelay = true
      sock.keepAlive = true
      sock.connect(InetSocketAddress(targetHost, targetPort), 12_000)
      sock.soTimeout = 1_000
      if (stopped) return false
      Log.i("NimCommonlink", "[$tag] tcp connected $targetHost:$targetPort (${sock.remoteSocketAddress})")
      synchronized(lock) {
        socket = sock
        output = sock.getOutputStream()
      }
      val out = output!!
      out.write(handshake)
      out.flush()
      Log.i("NimCommonlink", "[$tag] handshake sent (${handshake.size}B)")

      val input = BufferedInputStream(sock.getInputStream())
      var buffer = ByteArray(0)
      var loginSent = false
      var totalRead = 0L
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

        val read = try {
          input.read(chunk)
        } catch (_: java.net.SocketTimeoutException) {
          0
        }
        if (read < 0) {
          Log.w("NimCommonlink", "[$tag] EOF read=-1 totalRead=$totalRead loginSent=$loginSent loggedIn=$loggedIn buf=${buffer.size}")
          throw IllegalStateException("$tag 连接已断开")
        }
        if (read == 0) continue
        totalRead += read
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
          Log.i("NimCommonlink", "[$tag] rx ${packet.serviceId}/${packet.commandId} code=${packet.resultCode} serial=${packet.serial} len=${packet.body.size}")

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
                becameLoggedIn = true
                reconnectAttempt = 0

                post { onConnected() }
              }
            }
            else -> {

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
    } finally {
      try { sock.close() } catch (_: Throwable) {}
      synchronized(lock) {
        if (socket === sock) {
          socket = null
          output = null
        }
      }
    }
    return becameLoggedIn
  }

  private fun makeHandshake(rc4Key: ByteArray): ByteArray {
    val payload = if (embedLoginInHandshake) {
      NimProtocol.concat(NimProtocol.encodeBytes(rc4Key), loginPacket)
    } else {
      NimProtocol.encodeBytes(rc4Key)
    }
    val body = NimProtocol.concat(
      NimProtocol.littleEndianInt32(NimProtocol.rsaKeyVersion()),
      NimProtocol.encryptHandshakePayload(payload),
    )
    return NimProtocol.makePacket(1, 1, 0, body)
  }
}
