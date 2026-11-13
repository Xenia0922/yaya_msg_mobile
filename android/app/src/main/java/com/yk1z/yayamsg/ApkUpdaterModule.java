package com.yk1z.yayamsg;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 应用内更新：下载对应 ABI 的 APK 并拉起系统安装器。
 *
 * 设计要点：
 * - 下载走原生（60MB+ 大文件，避免 JS 侧 blob/文件 IO 的额外拷贝与内存峰值）；
 *   进度用 DeviceEventEmitter 推给 JS（ApkUpdaterProgress）。
 * - GitHub release 的下载链接会 302 到 objects.githubusercontent.com，HttpURLConnection
 *   默认跟随同协议重定向；仍显式处理一次以兼容新域名。
 * - 下载完成后用 PackageManager.getPackageArchiveInfo 校验包名，防止装到错误/损坏的文件。
 * - Android 8+ 需要「安装未知应用」权限（canRequestPackageInstalls）；没授权时
 *   直接抛 NEED_PERMISSION，由 JS 引导用户去系统设置授权，避免静默失败。
 * - APK 落在 cacheDir/updates，通过 FileProvider 暴露 content:// 给安装器。
 */
public class ApkUpdaterModule extends ReactContextBaseJavaModule {
  private static final String NAME = "ApkUpdater";
  private static final String EVENT = "ApkUpdaterProgress";

  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final AtomicBoolean cancelled = new AtomicBoolean(false);

  public ApkUpdaterModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  /** 设备首选 ABI，如 arm64-v8a / armeabi-v7a / x86_64 */
  @ReactMethod
  public void getDeviceAbi(Promise promise) {
    try {
      String[] abis = Build.SUPPORTED_ABIS;
      promise.resolve(abis != null && abis.length > 0 ? abis[0] : "");
    } catch (Throwable t) {
      promise.resolve("");
    }
  }

  /** 是否已获得「安装未知应用」权限（Android 8 以下恒为 true） */
  @ReactMethod
  public void canInstall(Promise promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        promise.resolve(getReactApplicationContext().getPackageManager().canRequestPackageInstalls());
      } else {
        promise.resolve(true);
      }
    } catch (Throwable t) {
      promise.resolve(false);
    }
  }

  /** 跳转「安装未知应用」授权页 */
  @ReactMethod
  public void openInstallPermissionSettings() {
    ReactApplicationContext ctx = getReactApplicationContext();
    try {
      Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + ctx.getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(i);
    } catch (Throwable ignored) {
      // 部分 ROM 没有该页面：退到应用详情
      try {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
      } catch (Throwable ignored2) {
      }
    }
  }

  @ReactMethod
  public void cancelDownload() {
    cancelled.set(true);
  }

  /**
   * 下载 APK 到 cacheDir/updates，完成后 resolve 绝对路径（不自动安装）。
   *
   * @param url         首选 APK 直链（对应设备 ABI 的分包）
   * @param fallbackUrl 首选 404/失败时的兜底直链（universal 包），可为空
   * @param fileName    落地文件名
   */
  @ReactMethod
  public void download(String url, String fallbackUrl, String fileName, Promise promise) {
    cancelled.set(false);
    ReactApplicationContext ctx = getReactApplicationContext();
    File dir = new File(ctx.getCacheDir(), "updates");
    if (!dir.exists() && !dir.mkdirs()) {
      promise.reject("EIO", "无法创建下载目录");
      return;
    }
    final File out = new File(dir, fileName);

    io.execute(() -> {
      try {
        if (out.exists()) {
          //noinspection ResultOfMethodCallIgnored
          out.delete();
        }
        boolean ok = false;
        Exception last = null;
        try {
          ok = downloadToFile(url, out);
        } catch (Exception e) {
          last = e;
        }
        if (!ok && fallbackUrl != null && !fallbackUrl.isEmpty()) {
          try {
            ok = downloadToFile(fallbackUrl, out);
            last = null;
          } catch (Exception e) {
            last = e;
          }
        }
        if (cancelled.get()) {
          if (out.exists()) out.delete();
          promise.reject("ECANCEL", "已取消下载");
          return;
        }
        if (!ok) {
          throw last != null ? last : new Exception("下载失败");
        }

        // 校验：必须是本应用的安装包，防止装错包 / 下载到错误页
        PackageManager pm = ctx.getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
        if (info == null || !ctx.getPackageName().equals(info.packageName)) {
          if (out.exists()) out.delete();
          promise.reject("EBADAPK", "安装包校验失败（不是本应用的安装包）");
          return;
        }
        promise.resolve(out.getAbsolutePath());
      } catch (Exception e) {
        try {
          if (out.exists()) out.delete();
        } catch (Throwable ignored) {
        }
        promise.reject("EDOWNLOAD", e.getMessage() != null ? e.getMessage() : "下载失败");
      }
    });
  }

  /** 直接安装已下载的 APK（不重新下载） */
  @ReactMethod
  public void installFile(String path, Promise promise) {
    try {
      File f = new File(path);
      if (!f.exists()) {
        promise.reject("ENOENT", "安装包不存在");
        return;
      }
      install(getReactApplicationContext(), f);
      promise.resolve(true);
    } catch (InstallPermissionException pe) {
      promise.reject("NEED_PERMISSION", "需要「安装未知应用」权限");
    } catch (Exception e) {
      promise.reject("EINSTALL", e.getMessage() != null ? e.getMessage() : "无法启动安装器");
    }
  }

  // ---------------------------------------------------------------- internals

  private boolean downloadToFile(String url, File out) throws Exception {
    HttpURLConnection conn = null;
    InputStream in = null;
    FileOutputStream fos = null;
    try {
      String current = url;
      for (int hop = 0; hop < 5; hop++) {
        conn = (HttpURLConnection) new URL(current).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("User-Agent", "yaya-msg-updater");
        conn.setRequestProperty("Accept", "application/octet-stream");
        conn.connect();
        int code = conn.getResponseCode();
        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
          String loc = conn.getHeaderField("Location");
          conn.disconnect();
          conn = null;
          if (loc == null || loc.isEmpty()) throw new Exception("重定向地址缺失");
          current = loc.startsWith("http") ? loc : new URL(new URL(current), loc).toString();
          continue;
        }
        if (code != 200) throw new Exception("HTTP " + code);
        break;
      }
      if (conn == null) throw new Exception("下载失败");

      long total = conn.getContentLengthLong();
      in = conn.getInputStream();
      fos = new FileOutputStream(out);
      byte[] buf = new byte[64 * 1024];
      long received = 0;
      long lastEmit = 0;
      int n;
      while ((n = in.read(buf)) > 0) {
        if (cancelled.get()) throw new Exception("已取消下载");
        fos.write(buf, 0, n);
        received += n;
        long now = System.currentTimeMillis();
        if (now - lastEmit > 200) {
          lastEmit = now;
          emitProgress(received, total);
        }
      }
      fos.flush();
      emitProgress(received, total > 0 ? total : received);
      return received > 0;
    } finally {
      if (fos != null) try { fos.close(); } catch (Throwable ignored) {}
      if (in != null) try { in.close(); } catch (Throwable ignored) {}
      if (conn != null) try { conn.disconnect(); } catch (Throwable ignored) {}
    }
  }

  private void emitProgress(long received, long total) {
    ReactApplicationContext ctx = getReactApplicationContext();
    try {
      if (!ctx.hasActiveCatalystInstance()) return;
      WritableMap payload = Arguments.createMap();
      payload.putDouble("received", received);
      payload.putDouble("total", total);
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(EVENT, payload);
    } catch (Throwable ignored) {
    }
  }

  private void install(ReactApplicationContext ctx, File file) throws Exception {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && !ctx.getPackageManager().canRequestPackageInstalls()) {
      throw new InstallPermissionException();
    }
    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(uri, "application/vnd.android.package-archive");
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    ctx.startActivity(intent);
  }

  /** 专用异常：JS 侧据此引导去系统设置授权 */
  private static class InstallPermissionException extends Exception {
    InstallPermissionException() {
      super("NEED_PERMISSION");
    }
  }
}
