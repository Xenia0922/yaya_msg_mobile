package com.yk1z.yayamsg.nim

import java.io.ByteArrayOutputStream
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.zip.Inflater
import javax.crypto.Cipher

/**
 * 云信「commonlink」协议编解码（移植自桌面版 yk1z/yaya_msg 的
 * `src/common/nim-commonlink-chatroom.js`，字段/顺序保持一致）。
 *
 * 为什么要自己实现协议，而不是用官方 SDK：
 *   官方 Native/Web SDK 都会把「客户端标识」带上，口袋48 的 appKey 在服务端做了白名单校验，
 *   非官方包名一律 414/403；而这条协议里**包名字段（属性 25）是我们自己填的**，
 *   填白名单内的包名即可通过（桌面版就是这么做的）。
 *
 * 帧格式：varint(5 + bodyLen) | serviceId(1) | commandId(1) | serial(LE16) | tag(1) | body
 *   - tag & 2 → body 前 2 字节是 resultCode(LE16)
 *   - tag & 1 → body 前 4 字节是解压后长度(LE32)，其余是 zlib 压缩体
 * 属性表：varint(count) + 每项 {varint(key), varint(len) + bytes}
 */
object NimProtocol {

  /** 与桌面版一致：SDK 版本 / 伪装的官方包名（服务端白名单内） */
  const val ANDROID_SDK_VERSION = 92110
  const val ANDROID_PACKAGE_NAME = "com.seine48.app"
  const val ANDROID_SDK_HUMAN_VERSION = "8.0.0"

  private const val RSA_KEY_VERSION = 0

  /** 云信内置 RSA 公钥（桌面版里同一份，PKCS1 分块 117 字节） */
  private const val RSA_PUBLIC_KEY_B64 =
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCBxLuL8+xpQSddSnSvPkvNOHdcr5Euqw+kkOSzO/buDMheCfFILRC/v5+nv8BsL7/YZWVpDA8sIBTxfNRqSCu0uLjlbJqT/sMnPT1xxdQrkb1HSnuSyTbZbqaInQ13tBE2SfcAhsQZJJ1hKQSE2QyKOMxQPhP583qcsIhDbdExvwIDAQAB"

  private val publicKey: PublicKey by lazy {
    val der = android.util.Base64.decode(RSA_PUBLIC_KEY_B64, android.util.Base64.DEFAULT)
    KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
  }

  // ---------------- varint ----------------

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
    var value = 0L
    var scale = 1L
    var index = offset
    val end = minOf(length, offset + 5)
    while (index < end) {
      val byte = buffer[index].toInt() and 0xff
      value += (byte and 0x7f) * scale
      if ((byte and 0x80) == 0) return Varint(value.toInt(), index - offset + 1)
      scale *= 128
      index += 1
    }
    return null
  }

  fun encodeBytes(value: ByteArray): ByteArray =
    concat(encodeVarint(value.size.toLong()), value)

  fun encodeBytes(value: String): ByteArray = encodeBytes(value.toByteArray(Charsets.UTF_8))

  /** 属性表编码：数字 key 升序，值统一按 UTF-8 字符串写（与桌面版一致） */
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

  /** 通道（心跳/ack）用的重载：值是原始字节 */
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
    var offset = count.size
    for (i in 0 until count.value) {
      val key = readVarint(buffer, offset, buffer.size) ?: break
      offset += key.size
      val len = readVarint(buffer, offset, buffer.size) ?: break
      offset += len.size
      if (offset + len.value > buffer.size) break
      properties[key.value] = String(buffer, offset, len.value, Charsets.UTF_8)
      offset += len.value
    }
    return properties
  }

  // ---------------- 包 ----------------

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
    /** 整包长度（含 varint 头），用于流式拆包 */
    val frameSize: Int,
  )

  /** 从缓冲区头部解一个包；不足一包或非法时返回 null */
  fun decodePacket(raw: ByteArray, embedded: Boolean = false): Packet? {
    val frameLength = readVarint(raw, 0, raw.size) ?: return null
    if (!embedded && raw.size < frameLength.size + frameLength.value) return null
    if (!embedded && frameLength.value < 5) return null
    if (embedded && raw.size < frameLength.size + 5) return null

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

    val packetEnd = if (embedded) raw.size else minOf(raw.size, frameLength.size + frameLength.value)
    var body = raw.copyOfRange(offset, packetEnd)
    if (tag and 1 != 0) {
      if (body.size < 4) return null
      val expected = (body[0].toInt() and 0xff) or ((body[1].toInt() and 0xff) shl 8) or
        ((body[2].toInt() and 0xff) shl 16) or ((body[3].toInt() and 0xff) shl 24)
      body = inflate(body.copyOfRange(4, body.size)) ?: return null
      if (body.size != expected) return null
    }
    return Packet(serviceId, commandId, serial, resultCode, body, frameLength.size + frameLength.value)
  }

  private fun inflate(data: ByteArray): ByteArray? = try {
    val inflater = Inflater()
    inflater.setInput(data)
    val out = ByteArrayOutputStream(data.size * 4)
    val chunk = ByteArray(4096)
    while (!inflater.finished()) {
      val n = inflater.inflate(chunk)
      if (n <= 0 && inflater.needsInput()) break
      out.write(chunk, 0, n)
    }
    inflater.end()
    out.toByteArray()
  } catch (t: Throwable) {
    null
  }

  // ---------------- 握手加密 ----------------

  /** RC4 流（收发各一个实例，密钥相同） */
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

  /** RSA/PKCS1 分块加密（117 字节/块，与桌面版一致） */
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
}
