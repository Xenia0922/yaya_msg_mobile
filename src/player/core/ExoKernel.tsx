import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { LiveExoView, onLiveFirstFrame, onLiveNativeError } from '../../native/LivePlayer';
import { usePlayerStore } from '../store/playerStore';
import { PlayerSource } from '../types';
import { logInfo } from '../../utils/runtimeLog';
import { setPipAspect, setPipAspectLive } from '../../utils/pip';

interface Props {
  source: PlayerSource;
  onError: (message: string) => void;
}

/**
 * 原生 ExoKernel（LiveExoView）：RTMP/http-flv 流专用。
 * - 原生侧自带 5 次自动重试（1.6s 间隔），重试耗尽经 onError 事件桥通知 JS；
 * - onSize（首帧画面尺寸）→ 置 playing：此前画面已在播但 state 一直 loading，
 *   导致「画面播放却永远转圈+加载时间较长」的误报；
 * - paused 从 store 同步 → 控制条播放/暂停真实控原生。
 */
export function ExoKernel({ source, onError }: Props) {
  /** 断流自动重连（2026-11-07 用户反馈「连麦断线后没自动重连」）：
   *  原生 5 次重试耗尽后，旧实现直接 onError 定格在错误页；这里在 JS 层继续重连：
   *  重建 LiveExoView（key=nonce）+ 指数退避 1s/2s/4s/8s…，最多 6 次；首帧成功即清零。 */
  const MAX_RECONNECT = 6;
  const attemptsRef = useRef(0);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFailure = useCallback((msg: string) => {
    if (attemptsRef.current >= MAX_RECONNECT) {
      try { logInfo(`[live] 自动重连已达上限(${MAX_RECONNECT})，报错终止 msg=${msg}`, 'player.exo'); } catch {}
      onError(msg);
      return;
    }
    const n = attemptsRef.current++;
    const delay = Math.min(8000, 1000 * Math.pow(2, n));
    try { logInfo(`[live] 断流，自动重连第 ${n + 1}/${MAX_RECONNECT} 次（${delay}ms 后）msg=${msg}`, 'player.exo'); } catch {}
    const st = usePlayerStore.getState();
    if (st.state !== 'idle') st.setState('loading');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNonce((v) => v + 1), delay);
  }, [onError]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // 诊断：直播内核每次开播/切源记录（runtimeLog → 设置可导出）
  useEffect(() => {
    try { logInfo(`[live] ExoKernel open url=${String(source.url).slice(0, 90)} audioOnly=${!!source.audioOnly}`, 'player.exo'); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  /**
   * 首帧兜底通道：新架构（bridgeless）下 LiveExoView 的 onSize View 事件会丢，
   * 原生侧同时经 NativeModule 发 LivePlayer:size（首帧 + 600ms + 2000ms 各一次）。
   * 这里按 url 过滤（同一时刻可能还有小窗的另一个 live 实例）。
   */
  useEffect(() => {
    const url = String(source.url || '');
    if (!url) return () => {};
    const offSize = onLiveFirstFrame((p) => {
      if (p.url && p.url !== url) return;
      if (p.width <= 0 || p.height <= 0) return;
      try { logInfo('[live] ExoKernel first frame (native event) → playing', 'player.exo'); } catch {}
      // ⚠️ 首帧事件可能在用户已点暂停之后才到（原生在首帧 + 600ms + 2000ms 各发一次）→
      // 无条件置 playing 会「自动恢复播放」覆盖用户暂停。仅在加载/空闲态才升级（2026-10-03 修复）。
      attemptsRef.current = 0; // 首帧成功：清零自动重连计数
      const cur = usePlayerStore.getState();
      if (cur.state === 'loading' || cur.state === 'idle') cur.setState('playing');
      // 直播（原生内核只跑直播/FLV）：按竖屏处理，避免横屏编码尺寸把小窗带横
      if (usePlayerStore.getState().source?.kind === 'live') setPipAspectLive(false);
      else setPipAspect(p.width, p.height);
    });
    const offError = onLiveNativeError((p) => {
      if (p.url && p.url !== url) return;
      if (!p.message) return;
      handleFailure(String(p.message).slice(0, 160));
    });
    return () => {
      offSize();
      offError();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url]);

  // ⚠️ 只在「用户显式暂停」(state==='paused') 时置原生暂停。
  // 此前写成 state!=='playing'：loading（首帧前）阶段 paused=true → 原生 playWhenReady=false
  // → 流根本不启动 → onSize 永不触发 → 永远 loading ——「大概率进不去、一进直播卡一帧」根因。
  // 现在 loading 期间 paused=false，Exo 自动起播；出帧后 onSize→playing；暂停/继续由控制条显式驱动。
  const paused = usePlayerStore((s) => s.state === 'paused');
  if (Platform.OS !== 'android' || !LiveExoView) {
    return null;
  }
  return (
    <LiveExoView
      key={`exo-${nonce}`}
      style={StyleSheet.absoluteFill}
      url={source.url}
      audioOnly={source.audioOnly}
      coverPortrait={source.coverPortrait}
      paused={paused}
      onSize={(e) => {
        // 首帧画面尺寸 = 已开始播放 → 结束 loading
        try { logInfo('[live] ExoKernel first frame (onSize) → playing', 'player.exo'); } catch {}
        // 同 onLiveFirstFrame：尺寸回调同样可能在暂停之后才到，不能无条件覆盖用户暂停
        attemptsRef.current = 0; // 首帧成功：清零自动重连计数
        const cur = usePlayerStore.getState();
        if (cur.state === 'loading' || cur.state === 'idle') cur.setState('playing');
        // 同步 PiP 窗口比例（成员直播多为竖屏；不跟则系统小窗按默认 16:9 裁边）
        const w = Number(e?.nativeEvent?.width) || 0;
        const h = Number(e?.nativeEvent?.height) || 0;
        if (w > 0 && h > 0) setPipAspect(w, h);
      }}
      onError={(e) => {
        handleFailure(String(e?.nativeEvent?.message || '').slice(0, 160) || '无法连接直播源');
      }}
    />
  );
}

export default ExoKernel;
