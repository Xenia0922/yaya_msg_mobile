package com.yk1z.yayamsg.nim

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.Inflater
import javax.crypto.Cipher
import org.json.JSONObject

object NimProtocol {

  const val ANDROID_SDK_VERSION = 92110
  const val ANDROID_SDK_HUMAN_VERSION = "9.21.10"
  const val ANDROID_USER_AGENT = "Native/9.21.10.14184"

  const val APP_VERSION_FIELD = "8.0.0"
  const val ANDROID_PACKAGE_NAME = "com.seine48.app"

  private const val RSA_KEY_VERSION = 0

  private const val RSA_PUBLIC_KEY_B64 =
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCBxLuL8+xpQSddSnSvPkvNOHdcr5Euqw+kkOSzO/buDMheCfFILRC/v5+nv8BsL7/YZWVpDA8sIBTxfNRqSCu0uLjlbJqT/sMnPT1xxdQrkb1HSnuSyTbZbqaInQ13tBE2SfcAhsQZJJ1hKQSE2QyKOMxQPhP583qcsIhDbdExvwIDAQAB"

  private val publicKey: PublicKey by lazy {
    val der = android.util.Base64.decode(RSA_PUBLIC_KEY_B64, android.util.Base64.DEFAULT)
    KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
  }

  fun encodeVarint(value: Long): ByteArray {
    var v = value
    val out = ByteArrayOutputStream(5)
    do {
      var byte = (v and 0x7f).toInt()
      v = v ushr 7
      if (v != 0L) byte = byte or 0x80
      out.write(byte)
    } while (v != 0L)
    return out.toByteArray()
  }

  class Varint(val value: Int, val size: Int)

  fun readVarint(buffer: ByteArray, offset: Int = 0, length: Int = buffer.size): Varint? {
    if (offset < 0 || length <= offset || offset >= buffer.size) return null
    var value = 0L
    var shift = 0
    var index = offset
    val end = minOf(buffer.size, length, offset + 5)
    while (index < end) {
      val byte = buffer[index].toInt() and 0xff
      value = value or ((byte and 0x7f).toLong() shl shift)
      if ((byte and 0x80) == 0) {

        if (value > Int.MAX_VALUE.toLong()) return null
        return Varint(value.toInt(), index - offset + 1)
      }
      shift += 7
      index += 1
    }
    return null
  }

  fun encodeBytes(value: ByteArray): ByteArray =
    concat(encodeVarint(value.size.toLong()), value)

  fun encodeBytes(value: String): ByteArray = encodeBytes(value.toByteArray(Charsets.UTF_8))

  fun encodeProperties(input: Map<Int, Any?>): ByteArray {
    val entries = input.entries
      .filter { it.value != null && it.value.toString().isNotEmpty() }
      .sortedBy { it.key }
    val out = ByteArrayOutputStream()
    out.write(encodeVarint(entries.size.toLong()))
    for ((key, value) in entries) {
      out.write(encodeVarint(key.toLong()))
      out.write(encodeBytes(value.toString()))
    }
    return out.toByteArray()
  }

  fun encodePropertyBytes(input: Map<Int, ByteArray?>): ByteArray {
    val entries = input.entries.filter { it.value != null }.sortedBy { it.key }
    val out = ByteArrayOutputStream()
    out.write(encodeVarint(entries.size.toLong()))
    for ((key, value) in entries) {
      out.write(encodeVarint(key.toLong()))
      out.write(encodeBytes(value!!))
    }
    return out.toByteArray()
  }

  fun decodeProperties(buffer: ByteArray): MutableMap<Int, String> {
    val properties = mutableMapOf<Int, String>()
    val count = readVarint(buffer, 0, buffer.size) ?: return properties
    if (count.value < 0 || count.value > 4096) return properties
    var offset = count.size
    for (i in 0 until count.value) {
      val key = readVarint(buffer, offset, buffer.size) ?: break
      if (key.value < 0) break
      offset += key.size
      val len = readVarint(buffer, offset, buffer.size) ?: break
      offset += len.size

      if (len.value < 0 || len.value > buffer.size || offset > buffer.size - len.value) break
      properties[key.value] = String(buffer, offset, len.value, Charsets.UTF_8)
      offset += len.value
    }
    return properties
  }

  fun makePacket(serviceId: Int, commandId: Int, serial: Int, body: ByteArray = ByteArray(0), tag: Int = 0): ByteArray {
    val header = ByteArray(5)
    header[0] = serviceId.toByte()
    header[1] = commandId.toByte()
    header[2] = (serial and 0xff).toByte()
    header[3] = ((serial shr 8) and 0xff).toByte()
    header[4] = tag.toByte()
    val payload = concat(header, body)
    return concat(encodeVarint(payload.size.toLong()), payload)
  }

  class Packet(
    val serviceId: Int,
    val commandId: Int,
    val serial: Int,
    val resultCode: Int,
    val body: ByteArray,

    val frameSize: Int,
  )

  fun decodePacket(raw: ByteArray, embedded: Boolean = false): Packet? {
    val frameLength = readVarint(raw, 0, raw.size) ?: return null
    if (frameLength.value < 0) return null
    if (!embedded) {
      if (frameLength.value < 5) return null
      if (frameLength.value > raw.size - frameLength.size) return null
    } else {
      if (raw.size - frameLength.size < 5) return null
    }

    var offset = frameLength.size
    val serviceId = raw[offset].toInt() and 0xff
    val commandId = raw[offset + 1].toInt() and 0xff
    val serial = ((raw[offset + 2].toInt() and 0xff) or ((raw[offset + 3].toInt() and 0xff) shl 8))
    val tag = raw[offset + 4].toInt() and 0xff
    offset += 5

    var resultCode = 200
    if (tag and 2 != 0) {
      if (offset + 2 > raw.size) return null
      resultCode = (raw[offset].toInt() and 0xff) or ((raw[offset + 1].toInt() and 0xff) shl 8)
      offset += 2
    }

    val declaredEnd = if (frameLength.value > raw.size - frameLength.size) raw.size else frameLength.size + frameLength.value
    val packetEnd = if (embedded) raw.size else minOf(raw.size, declaredEnd)
    if (offset > packetEnd) return null
    var body = raw.copyOfRange(offset, packetEnd)
    if (tag and 1 != 0) {
      if (body.size < 4) return null
      val expected = (body[0].toInt() and 0xff) or ((body[1].toInt() and 0xff) shl 8) or
        ((body[2].toInt() and 0xff) shl 16) or ((body[3].toInt() and 0xff) shl 24)
      body = inflate(body.copyOfRange(4, body.size)) ?: return null
      if (body.size != expected) return null
    }
    return Packet(serviceId, commandId, serial, resultCode, body, declaredEnd)
  }

  private fun inflate(data: ByteArray): ByteArray? {
    val maxOutput = 8 * 1024 * 1024
    var inflater: Inflater? = null
    try {
      inflater = Inflater()
      inflater.setInput(data)
      val initial = if (data.size > maxOutput / 4) maxOutput else data.size * 4
      val out = ByteArrayOutputStream(maxOf(initial, 64))
      val chunk = ByteArray(4096)
      var total = 0
      while (!inflater.finished()) {
        val n = inflater.inflate(chunk)
        if (n <= 0 && inflater.needsInput()) break
        if (n > 0) {
          total += n
          if (total > maxOutput) return null
          out.write(chunk, 0, n)
        }
      }
      return out.toByteArray()
    } catch (t: Throwable) {
      return null
    } finally {
      try { inflater?.end() } catch (_: Throwable) {}
    }
  }

  class Rc4Stream(key: ByteArray) {
    private val state = IntArray(256) { it }
    private var x = 0
    private var y = 0

    init {
      require(key.isNotEmpty()) { "聊天室加密密钥无效" }
      var cursor = 0
      for (index in 0 until 256) {
        cursor = (cursor + state[index] + (key[index % key.size].toInt() and 0xff)) and 0xff
        val tmp = state[index]; state[index] = state[cursor]; state[cursor] = tmp
      }
    }

    fun apply(input: ByteArray): ByteArray {
      val output = ByteArray(input.size)
      for (index in input.indices) {
        x = (x + 1) and 0xff
        y = (y + state[x]) and 0xff
        val tmp = state[x]; state[x] = state[y]; state[y] = tmp
        output[index] = (input[index].toInt() xor state[(state[x] + state[y]) and 0xff]).toByte()
      }
      return output
    }
  }

  fun encryptHandshakePayload(payload: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
    cipher.init(Cipher.ENCRYPT_MODE, publicKey)
    val out = ByteArrayOutputStream()
    var offset = 0
    while (offset < payload.size) {
      val size = minOf(117, payload.size - offset)
      out.write(cipher.doFinal(payload, offset, size))
      offset += size
    }
    return out.toByteArray()
  }

  fun littleEndianInt32(value: Int): ByteArray = byteArrayOf(
    (value and 0xff).toByte(),
    ((value shr 8) and 0xff).toByte(),
    ((value shr 16) and 0xff).toByte(),
    ((value shr 24) and 0xff).toByte(),
  )

  fun littleEndianInt64(value: Long): ByteArray = ByteArray(8) { index ->
    ((value ushr (index * 8)) and 0xffL).toByte()
  }

  fun rsaKeyVersion(): Int = RSA_KEY_VERSION

  fun concat(vararg chunks: ByteArray): ByteArray {
    val total = chunks.sumOf { it.size }
    val out = ByteArray(total)
    var offset = 0
    for (chunk in chunks) {
      System.arraycopy(chunk, 0, out, offset, chunk.size)
      offset += chunk.size
    }
    return out
  }

  private val dohCache = ConcurrentHashMap<String, Pair<String, Long>>()
  private const val DOH_TTL_MS = 5 * 60_000L

  fun isSyntheticOrBogonIpv4(ip: String): Boolean {
    val parts = ip.trim().split('.')
    if (parts.size != 4) return false
    val a = parts[0].toIntOrNull() ?: return false
    val b = parts[1].toIntOrNull() ?: return false
    val c = parts[2].toIntOrNull() ?: return false
    val d = parts[3].toIntOrNull() ?: return false
    if (a !in 0..255 || b !in 0..255 || c !in 0..255 || d !in 0..255) return false
    return a == 0 ||
      a == 10 ||
      a == 28 ||
      a == 127 ||
      (a == 100 && b in 64..127) ||
      (a == 169 && b == 254) ||
      (a == 172 && b in 16..31) ||
      (a == 192 && b == 168) ||
      (a == 198 && (b == 18 || b == 19)) ||
      a >= 224
  }

  fun isIpv4Literal(host: String): Boolean {
    val parts = host.trim().split('.')
    return parts.size == 4 && parts.all { p -> p.toIntOrNull()?.let { it in 0..255 } == true }
  }

  fun resolveRealIpv4(host: String): String? {
    val trimmed = host.trim()
    if (trimmed.isEmpty() || isIpv4Literal(trimmed)) return trimmed.ifEmpty { null }
    val now = System.currentTimeMillis()
    dohCache[trimmed]?.let { (ip, exp) ->
      if (now < exp) return ip
    }
    val urls = listOf(
      "https://dns.alidns.com/resolve?name=$trimmed&type=1",
      "https://doh.pub/dns-query?name=$trimmed&type=1",
    )
    for (dohUrl in urls) {
      try {
        val conn = (URL(dohUrl).openConnection() as HttpURLConnection).apply {
          connectTimeout = 4_000
          readTimeout = 4_000
          requestMethod = "GET"
          setRequestProperty("Accept", "application/dns-json")
        }
        val body = try {
          conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
          try { conn.disconnect() } catch (_: Throwable) {}
        }
        val answers = JSONObject(body).optJSONArray("Answer") ?: continue
        for (i in 0 until answers.length()) {
          val ans = answers.optJSONObject(i) ?: continue
          if (ans.optInt("type", 0) != 1) continue
          val ip = ans.optString("data", "").trim()
          if (isIpv4Literal(ip) && !isSyntheticOrBogonIpv4(ip)) {
            dohCache[trimmed] = ip to (now + DOH_TTL_MS)
            return ip
          }
        }
      } catch (_: Throwable) {
      }
    }
    return null
  }
}
