package com.yk1z.yayamsg;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class NativeDiag {

  private static final int MAX_FILES = 6;
  private static final String DIR_NAME = "diag";
  private static final String TAG = "YayaDiag";

  private NativeDiag() {}

  public static File dirOf(Context ctx) {
    return new File(ctx.getFilesDir(), DIR_NAME);
  }

  public static void log(Context ctx, String level, String tag, String msg) {
    try {
      if (ctx == null) return;
      Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
      File dir = dirOf(app);
      if (!dir.exists() && !dir.mkdirs()) return;

      String ts = new SimpleDateFormat("yyyyMMdd-HH", Locale.US).format(new Date());
      File f = new File(dir, "native-" + ts + ".log");

      String line = "[" + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())
          + "] " + level + " [" + tag + "] " + msg + "\n";

      if ("ERROR".equals(level)) Log.e(TAG, "[" + tag + "] " + msg);
      else if ("WARN".equals(level)) Log.w(TAG, "[" + tag + "] " + msg);
      else Log.i(TAG, "[" + tag + "] " + msg);

      FileWriter w = null;
      try {
        w = new FileWriter(f, true);
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
