package com.yk1z.yayamsg;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.KeyEvent;

public class MediaButtonProxyReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    if (!Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) return;

    KeyEvent ev = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        ? intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class)
        : intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
    if (ev == null || ev.getAction() != KeyEvent.ACTION_DOWN) return;

    String cmd = null;
    switch (ev.getKeyCode()) {
      case KeyEvent.KEYCODE_MEDIA_PLAY:
        cmd = "resume";
        break;
      case KeyEvent.KEYCODE_MEDIA_PAUSE:
        cmd = "pause";
        break;
      case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
      case KeyEvent.KEYCODE_HEADSETHOOK:
        cmd = "play_pause";
        break;
      case KeyEvent.KEYCODE_MEDIA_NEXT:
        cmd = "next";
        break;
      case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
        cmd = "prev";
        break;
      case KeyEvent.KEYCODE_MEDIA_STOP:
        cmd = "stop";
        break;
      default:
        break;
    }

    if (cmd != null && YayaExoService.serviceAlive) {
      Intent svc = new Intent(context, YayaExoService.class).putExtra("cmd", cmd);
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(svc);
        } else {
          context.startService(svc);
        }
      } catch (Throwable ignored) {}
    }
  }
}
