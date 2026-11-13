package com.yk1z.yayamsg;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 原生诊断日志（不是崩溃）。
 *
 * 背景：release 包里 console.log 不落地，JS 侧拿不到原生信息；
 * 而 logcat 用户不会看、也不会导出。系统小窗（PiP）这类「静默失败」必须能远程定位，
 * 所以原生把关键节点写进 filesDir/diag/native-<ts>.log，
 * JS 侧（见 src/utils/crashLog.ts 的 syncNativeDiags）在下次启动时并入「运行日志」，
 * 用户用现成的「日志导出」就能把内容发出来。
 *
 * 写入全程 try/catch，绝不影响业务流程。
 */
public final class NativeDiag {

  private static final int MAX_FILES = 6;
  private static final String DIR_NAME = "diag";
  private static final String TAG = "YayaDiag";

  private NativeDiag() {}

  /** 日志目录（内部 filesDir，JS 侧可用 documentDirectory 直接读） */
  public static File dirOf(Context ctx) {
    return new File(ctx.getFilesDir(), DIR_NAME);
  }

  /**
   * 追加一条诊断。
   *
   * @param ctx   任意 Context（用 applicationContext）
   * @param level INFO / WARN / ERROR
   * @param tag   事件名，例如 "pip"
   * @param msg   内容
   */
  public static void log(Context ctx, String level, String tag, String msg) {
    try {
      if (ctx == null) return;
      Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
      File dir = dirOf(app);
      if (!dir.exists() && !dir.mkdirs()) return;

      // 文件名按**小时**级：同一条会话里的多条诊断追加进同一个文件，
      // 避免秒级切片产生一堆碎片（MAX_FILES 只有 6，碎片会把重要记录挤掉）。
      String ts = new SimpleDateFormat("yyyyMMdd-HH", Locale.US).format(new Date());
      File f = new File(dir, "native-" + ts + ".log");

      String line = "[" + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())
          + "] " + level + " [" + tag + "] " + msg + "\n";

      // 同时进 logcat，方便本机 adb logcat -s YayaDiag
      if ("ERROR".equals(level)) Log.e(TAG, "[" + tag + "] " + msg);
      else if ("WARN".equals(level)) Log.w(TAG, "[" + tag + "] " + msg);
      else Log.i(TAG, "[" + tag + "] " + msg);

      FileWriter w = null;
      try {
        w = new FileWriter(f, true); // 追加：同一秒多条也不互相覆盖
        w.write(line);
        w.flush();
      } catch (Throwable ignored) {
      } finally {
        if (w != null) {
          try { w.close(); } catch (Throwable ignored) {}
        }
      }
      trim(dir);
    } catch (Throwable ignored) {
      // 诊断失败绝不影响业务流程
    }
  }

  private static void trim(File dir) {
    File[] fs = dir.listFiles();
    if (fs == null || fs.length <= MAX_FILES) return;
    java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
    for (int i = 0; i < fs.length - MAX_FILES; i++) {
      try { fs[i].delete(); } catch (Throwable ignored) {}
    }
  }
}
