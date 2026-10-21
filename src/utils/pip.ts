import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

/** 画中画（悬浮窗）控制器桥：NativeModules.PipController（Android 原生模块） */
const Pip = (NativeModules as any)?.PipController;

/**
 * 各播放源对「当前是否有媒体在播」的登记表。
 *
 * ⚠️ 必须**按来源分别登记、再 OR 汇总**下发给原生（2026-10-12 修复）：
 * 此前 5 个调用点各自往原生写**绝对布尔值**，会互相踩。实测两个方向都会坏：
 *  - 小窗正在播（置 true）→ 用户打开全屏播放器，`FullscreenManager` 因 `fullscreen` 置 **false**
 *    → 小窗还在播但标志已变 false → 按 Home **不弹**系统悬浮窗；
 *  - 反向：`FullscreenManager` 卸载时无条件置 false → 把**还在播的小窗**标志一起清掉。
 * 改成各写各的 bit 之后，任一路在播，原生标志就是 true。
 */
const pipSources = new Map<string, boolean>();

function syncPipPlaying() {
  if (Platform.OS !== 'android' || !Pip?.setVideoPlaying) return;
  const any = Array.from(pipSources.values()).some(Boolean);
  try {
    Pip.setVideoPlaying(any);
  } catch { /* ignore */ }
}

/** 标记当前是否有视频/音频在播：切后台时 MainActivity 据此自动进悬浮窗 */
export function setPipPlaying(playing: boolean, source = 'default') {
  if (playing) pipSources.set(source, true);
  else pipSources.delete(source);
  syncPipPlaying();
}

/**
 * 画中画（系统小窗）总开关：false 时 MainActivity.onUserLeaveHint 不会自动进 PiP
 * （用户没主动要小窗，切后台就不该弹出 App 外系统悬浮窗）。设置页开关同步调用。
 */
export function setPipEnabled(enabled: boolean) {
  if (Platform.OS !== 'android' || !Pip?.setPipEnabled) return;
  try {
    Pip.setPipEnabled(!!enabled);
  } catch { /* ignore */ }
}

/** 手动进入画中画悬浮窗（播放器"小窗"按钮） */
export function enterPipMode() {
  if (Platform.OS !== 'android' || !Pip?.enterPip) return;
  try {
    Pip.enterPip();
  } catch { /* ignore */ }
}

/**
 * 订阅「系统拒绝进入 PiP」事件。
 * reason：appops（ROM 关了画中画权限）/ enter-failed / timeout。
 * 有了它，「换不出系统小窗」不再是静默失败 —— 可以明确提示用户去系统设置开权限。
 * 返回退订函数。
 */
export function listenPipDenied(cb: (reason: string) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('PipDenied', (e: any) => {
    try {
      cb(String(e?.reason || 'unknown'));
    } catch {}
  });
  return () => sub.remove();
}

/**
 * 订阅系统 PiP 窗口 ⏯ 按钮点击（原生 RemoteAction → 广播 → 本事件）。
 * 回调里应切换"当前正在小窗里播的媒体"（应用内小窗 → 统一播放器）的播放/暂停。
 * 返回退订函数。
 */
export function listenPipToggle(cb: (payload: { playing?: boolean }) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('PipToggleCmd', (e: any) => {
    try {
      cb(e && typeof e === 'object' ? e : {});
    } catch {}
  });
  return () => sub.remove();
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
