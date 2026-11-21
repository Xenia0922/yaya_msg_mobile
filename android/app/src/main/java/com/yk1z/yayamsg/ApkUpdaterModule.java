package com.yk1z.yayamsg;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.util.Log;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
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
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

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

  @ReactMethod
  public void getDeviceAbi(Promise promise) {
    try {
      String[] abis = Build.SUPPORTED_ABIS;
      promise.resolve(abis != null && abis.length > 0 ? abis[0] : "");
    } catch (Throwable t) {
      promise.resolve("");
    }
  }

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

  @ReactMethod
  public void openInstallPermissionSettings() {
    ReactApplicationContext ctx = getReactApplicationContext();
    try {
      Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + ctx.getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(i);
    } catch (Throwable ignored) {

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

  @ReactMethod
  public void download(String url, String fallbackUrl, String fileName, Promise promise) {
    cancelled.set(false);
    ReactApplicationContext ctx = getReactApplicationContext();
    File dir = new File(ctx.getCacheDir(), "updates");
    if (!dir.exists() && !dir.mkdirs()) {
      promise.reject("EIO", "无法创建下载目录");
      return;
    }
    final String safeName = safeUpdateFileName(fileName);
    if (safeName == null) {
      promise.reject("EINVAL", "下载文件名不合法");
      return;
    }
    final File out = new File(dir, safeName);

    io.execute(() -> {
      try {
        if (out.exists()) {

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

        PackageManager pm = ctx.getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
        if (info == null || !ctx.getPackageName().equals(info.packageName)) {
          if (out.exists()) out.delete();
          promise.reject("EBADAPK", "安装包校验失败（不是本应用的安装包）");
          return;
        }

        if (isDowngradeApk(pm, ctx.getPackageName(), info)) {
          if (out.exists()) out.delete();
          promise.reject("EDOWNGRADE", "安装包版本低于当前版本，已拒绝降级安装");
          return;
        }

        if (!verifyApkSigner(ctx, out)) {
          if (out.exists()) out.delete();
          promise.reject("EBADSIGN", "安装包签名校验失败（签名与本应用不一致，已拒绝安装）");
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

  @ReactMethod
  public void installFile(String path, Promise promise) {
    try {
      File f = new File(path);
      if (!f.exists()) {
        promise.reject("ENOENT", "安装包不存在");
        return;
      }

      PackageManager pm = getReactApplicationContext().getPackageManager();
      PackageInfo info = pm.getPackageArchiveInfo(f.getAbsolutePath(), 0);
      if (info == null || !getReactApplicationContext().getPackageName().equals(info.packageName)) {
        promise.reject("EBADAPK", "安装包校验失败（不是本应用的安装包）");
        return;
      }
      if (isDowngradeApk(pm, getReactApplicationContext().getPackageName(), info)) {
        promise.reject("EDOWNGRADE", "安装包版本低于当前版本，已拒绝降级安装");
        return;
      }
      if (!verifyApkSigner(getReactApplicationContext(), f)) {
        promise.reject("EBADSIGN", "安装包签名校验失败（签名与本应用不一致，已拒绝安装）");
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

  private static Set<String> installedSignerDigests(PackageManager pm, String pkg) {
    Set<String> out = new HashSet<>();
    try {
      PackageInfo pi;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
        if (pi == null || pi.signingInfo == null) return out;
        Signature[] sigs = pi.signingInfo.hasMultipleSigners()
            ? pi.signingInfo.getApkContentsSigners()
            : pi.signingInfo.getSigningCertificateHistory();
        if (sigs != null) for (Signature s : sigs) out.add(sha256Hex(s.toByteArray()));
      } else {
        pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
        if (pi == null || pi.signatures == null) return out;
        for (Signature s : pi.signatures) out.add(sha256Hex(s.toByteArray()));
      }
    } catch (Throwable t) {
      Log.w("ApkUpdaterModule", "读取已安装应用签名失败 pkg=" + pkg, t);
    }
    return out;
  }

  private static Set<String> apkSignerDigests(PackageManager pm, String apkPath) {
    Set<String> out = new HashSet<>();
    try {
      PackageInfo pi;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pi = pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNING_CERTIFICATES);
        if (pi == null || pi.signingInfo == null) return out;
        Signature[] sigs = pi.signingInfo.hasMultipleSigners()
            ? pi.signingInfo.getApkContentsSigners()
            : pi.signingInfo.getSigningCertificateHistory();
        if (sigs != null) for (Signature s : sigs) out.add(sha256Hex(s.toByteArray()));
      } else {
        pi = pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES);
        if (pi == null || pi.signatures == null) return out;
        for (Signature s : pi.signatures) out.add(sha256Hex(s.toByteArray()));
      }
    } catch (Throwable t) {
      Log.w("ApkUpdaterModule", "读取 APK 签名失败 path=" + apkPath, t);
    }
    return out;
  }

  private static long versionCodeOf(PackageInfo pi) {
    if (pi == null) return -1L;
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
  }

  private static boolean isDowngradeApk(PackageManager pm, String pkg, PackageInfo apkInfo) {
    try {
      PackageInfo installed = pm.getPackageInfo(pkg, 0);
      long mine = versionCodeOf(installed);
      long theirs = versionCodeOf(apkInfo);
      return mine > 0 && theirs > 0 && theirs < mine;
    } catch (Throwable ignored) {
      return false;
    }
  }

  private boolean verifyApkSigner(ReactApplicationContext ctx, File apk) {
    PackageManager pm = ctx.getPackageManager();
    Set<String> mine = installedSignerDigests(pm, ctx.getPackageName());
    Set<String> theirs = apkSignerDigests(pm, apk.getAbsolutePath());
    if (mine.isEmpty() || theirs.isEmpty()) {

      Log.w("ApkUpdaterModule", "签名校验失败：证书集合为空 installed=" + mine.size() + " apk=" + theirs.size());
      return false;
    }
    if (!mine.equals(theirs)) {

      Log.w("ApkUpdaterModule", "签名校验失败：证书集合不一致 installed=" + mine.size() + " apk=" + theirs.size());
      return false;
    }
    return true;
  }

  private static String safeUpdateFileName(String raw) {
    if (raw == null) return null;
    String name = raw.trim();
    if (name.isEmpty() || name.length() > 128) return null;
    if (name.equals(".") || name.equals("..") || name.contains("..")) return null;
    if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('\0') >= 0) return null;
    for (int i = 0; i < name.length(); i++) {
      if (name.charAt(i) < 0x20 || name.charAt(i) == 0x7f) return null;
    }
    if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk")) return null;
    return name;
  }

  private static String sha256Hex(byte[] data) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] d = md.digest(data);
      StringBuilder sb = new StringBuilder(d.length * 2);
      for (byte b : d) sb.append(String.format("%02x", b));
      return sb.toString();
    } catch (Exception e) {
      return "";
    }
  }

  private boolean downloadToFile(String url, File out) throws Exception {
    HttpURLConnection conn = null;
    InputStream in = null;
    FileOutputStream fos = null;
    try {
      String current = url;
      for (int hop = 0; hop < 5; hop++) {
        URL parsed = new URL(current);
        if (!"https".equalsIgnoreCase(parsed.getProtocol())) {
          throw new Exception("更新下载仅允许 HTTPS 协议");
        }
        conn = (HttpURLConnection) parsed.openConnection();
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
          current = loc.startsWith("http") ? loc : new URL(parsed, loc).toString();
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
      if (!ctx.hasActiveReactInstance()) return;
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

  private static class InstallPermissionException extends Exception {
    InstallPermissionException() {
      super("NEED_PERMISSION");
    }
  }
}
