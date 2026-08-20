import { NativeModules, Platform } from 'react-native';

/** 画中画（悬浮窗）控制器桥：NativeModules.PipController（Android 原生模块） */
const Pip = (NativeModules as any)?.PipController;

/** 标记当前是否有视频/音频在播：切后台时 MainActivity 据此自动进悬浮窗 */
export function setPipPlaying(playing: boolean) {
  if (Platform.OS !== 'android' || !Pip?.setVideoPlaying) return;
  try {
    Pip.setVideoPlaying(!!playing);
  } catch { /* ignore */ }
}

/** 手动进入画中画悬浮窗（播放器"小窗"按钮） */
export function enterPipMode() {
  if (Platform.OS !== 'android' || !Pip?.enterPip) return;
  try {
    Pip.enterPip();
  } catch { /* ignore */ }
}

/** 更新 PiP 窗口比例（跟随视频内容 naturalSize，竖屏视频悬浮窗也是竖的） */
export function setPipAspect(w: number | string, h: number | string) {
  if (Platform.OS !== 'android' || !Pip?.setAspectRatio) return;
  const nw = Number(w) || 0;
  const nh = Number(h) || 0;
  if (nw > 0 && nh > 0) {
    try {
      Pip.setAspectRatio(nw, nh);
    } catch { /* ignore */ }
  }
}
