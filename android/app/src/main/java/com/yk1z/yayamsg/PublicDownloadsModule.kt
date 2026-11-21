package com.yk1z.yayamsg

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class PublicDownloadsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PublicDownloads"

  @ReactMethod
  fun saveToDownloads(sourceUri: String, filename: String, mimeType: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("PUBLIC_DOWNLOADS_UNSUPPORTED", "此 Android 版本无法安全写入系统下载目录")
      return
    }
    Thread {
      var destination: Uri? = null
      try {
        val safeName = sanitizeDownloadName(filename)
        val file = resolveAppPrivateFile(sourceUri)
        if (!file.isFile || file.length() <= 0L) throw IllegalStateException("下载文件不存在或为空")

        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
          put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
          put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/牙牙消息")
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = reactApplicationContext.contentResolver
        destination = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("无法创建系统下载文件")
        resolver.openOutputStream(destination!!, "w")?.use { output -> file.inputStream().use { it.copyTo(output) } }
          ?: throw IllegalStateException("无法写入系统下载文件")
        val ready = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        if (resolver.update(destination!!, ready, null, null) <= 0) throw IllegalStateException("无法完成系统下载文件")
        promise.resolve(destination.toString())
      } catch (error: Throwable) {
        destination?.let { reactApplicationContext.contentResolver.delete(it, null, null) }
        promise.reject("PUBLIC_DOWNLOADS_FAILED", error.message, error)
      }
    }.start()
  }

  private fun resolveAppPrivateFile(sourceUri: String): File {
    val source = Uri.parse(sourceUri)
    val file = when (source.scheme) {
      "file" -> File(source.path ?: throw IllegalArgumentException("下载文件路径无效"))
      null -> File(sourceUri)
      else -> throw IllegalArgumentException("下载文件尚未保存到本地")
    }.canonicalFile
    val roots = listOf(reactApplicationContext.filesDir.canonicalFile, reactApplicationContext.cacheDir.canonicalFile)
    val allowed = roots.any { root -> file.path == root.path || file.path.startsWith(root.path + File.separator) }
    if (!allowed) throw SecurityException("不允许导出 App 私有目录之外的文件")
    return file
  }

  private fun sanitizeDownloadName(value: String?): String {
    val name = value?.trim().orEmpty()
    if (name.isEmpty() || name.length > 128) throw IllegalArgumentException("文件名无效")
    if (name == "." || name == ".." || name.contains('/') || name.contains('\\') || name.contains('\u0000')) {
      throw IllegalArgumentException("文件名不能包含路径分隔符")
    }
    return name
  }

  private fun isOwnDownloadUri(uri: Uri): Boolean =
    uri.scheme == "content" && uri.toString().startsWith(MediaStore.Downloads.EXTERNAL_CONTENT_URI.toString())

  @ReactMethod
  fun deletePublicDownload(uri: String, promise: Promise) {
    Thread {
      try {
        val parsed = Uri.parse(uri)
        if (!isOwnDownloadUri(parsed)) {
          promise.reject("PUBLIC_DOWNLOAD_DELETE_FAILED", "只能删除本 App 导出的系统下载文件")
          return@Thread
        }
        val deleted = reactApplicationContext.contentResolver.delete(parsed, null, null)
        promise.resolve(deleted > 0)
      } catch (error: Throwable) {
        promise.reject("PUBLIC_DOWNLOAD_DELETE_FAILED", error.message, error)
      }
    }.start()
  }

  @ReactMethod
  fun openPublicDownload(uri: String, mimeType: String, promise: Promise) {
    try {
      val parsed = Uri.parse(uri)
      if (!isOwnDownloadUri(parsed)) {
        promise.reject("PUBLIC_DOWNLOAD_OPEN_FAILED", "只能打开本 App 导出的系统下载文件")
        return
      }
      val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(parsed, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(view, "打开下载文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(chooser)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("PUBLIC_DOWNLOAD_OPEN_FAILED", error.message, error)
    }
  }
}
