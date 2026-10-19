import React, { ReactNode, useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { usePlayerStore } from './store/playerStore';
import { useMiniPlayerStore } from '../store/miniPlayerStore';
import { PlayerCore } from './core/PlayerCore';
import { PlayerChrome } from './chrome/PlayerChrome';
import { FullscreenManager } from './chrome/FullscreenManager';
import { PlayerScreenProps } from './types';
import { logInfo } from '../utils/runtimeLog';

interface Props extends PlayerScreenProps {
  /** 弹幕 overlay 等附加层插槽（由页面挂 DanmakuOverlay） */
  children?: ReactNode;
  /** 页面是否常驻（false = 打开时挂载，关闭时卸载） */
  persistent?: boolean;
  /** 内嵌模式：容器透明由外部定高，Chrome 无顶栏；点全屏 → Modal 全屏呈现 */
  inline?: boolean;
  /** 视频实际尺寸回调（气泡/列表按内容比例自适应容器） */
  onVideoSize?: (w: number, h: number) => void;
  /** 外部续播位置（秒；如 MediaScreen 的 webResumeTime），优先于内部 position */
  resumeAt?: number;
  /** 错误重试回调（直播流地址时效：页面重新解析而非重播同 URL） */
  onRetry?: () => void;
  /** 直播弹幕输入条：渲染进播放器底部控制坞（随控制条自动隐藏/呼出） */
  barrageInput?: ReactNode;
}

/**
 * 统一播放器页（重写核心）：页面只声明「播什么、带哪些功能」，
 * 内核路由/控制层/全屏/续播/内核切换全部内部完成。
 *
 * 用法：
 * <PlayerScreen
 *   source={{ kind:'live'|'vod'|'audio', url, urls, liveId, needsNativeExo, headers, audioOnly }}
 *   meta={{ title, cover }}
 *   danmaku={{ type:'poll'|'lrc'|'ws'|'none', ... }}
 *   features={{ rate, danmaku, gift, rank, quality, resume, kernelSwitch }}
 *   extraActions={[{ key:'gift', icon:'gift', label:'礼物', onPress }]}
 *   onClose={() => ...}
 * />
 */
export function PlayerScreen({ source, meta, danmaku = { type: 'none' }, features = {}, extraActions = [], onClose, children, persistent = false, inline = false, onVideoSize, resumeAt, onRetry, barrageInput, chromeHidden = false }: Props) {
  // 播放错误自动重解析（假死/URL 失效场景）：RTMP 流 URL 带 wsSecret 且多为单次有效，
  // 原生重连同 URL 只会再拿一帧；有 onRetry（页面重新解析新地址）时自动触发，同源最多 2 次。
  const dbgState = usePlayerStore((s) => s.state);
  const autoRetryLeft = useRef(2);
  /** onRetry 的最新引用：不放进 effect 依赖（父组件内联箭头每次渲染都变 → 定时器被反复重排饿死） */
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  useEffect(() => {
    autoRetryLeft.current = 2; // 换源（新 url）重置自动重试额度
  }, [source.url]);
  useEffect(() => {
    if (dbgState !== 'error' || !onRetry) return;
    // 网页内核失败（CORS/容器兼容）重解析拿新地址也救不回来 → 不自动循环，保留错误卡手动重试
    if (usePlayerStore.getState().activeKernel === 'web') return;
    if (autoRetryLeft.current <= 0) return;
    autoRetryLeft.current -= 1;
    try { logInfo(`[player] error → auto re-resolve (fresh url), left=${autoRetryLeft.current}`, 'player.screen'); } catch {}
    const t = setTimeout(() => { try { onRetryRef.current?.(); } catch {} }, 900);
    return () => clearTimeout(t);
    // ⚠️ 依赖刻意不含 onRetry（2026-10-03 修复）：父组件每次渲染都新建 onRetry 内联箭头，
    // 之前 effect 会被反复 cleanup + 重排 → 900ms 定时器永远等不到触发，自动重解析失效。
  }, [dbgState]);
  // R4: 把页面 onClose 注册进 playerStore，硬件返回键经 FullscreenManager 调它（清理页面状态）
  useEffect(() => {
    if (!onClose) return;
    const prev = usePlayerStore.getState().onClose;
    usePlayerStore.getState().setOnClose(onClose);
    return () => {
      // 仅当自己仍是注册者时才清空（避免覆盖后续挂载的播放器）
      if (usePlayerStore.getState().onClose === onClose) {
        usePlayerStore.getState().setOnClose(prev);
      }
    };
  }, [onClose]);
  const openedFor = useRef('');
  /** 本页 open 时记录 store 的 openToken：区分「跨页顶替」与「同页内核换线」 */
  const openTokenAtOpen = useRef(0);
  const sourceUrl = source.url || '';
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const rotateDeg = usePlayerStore((s) => s.rotateDeg);
  const mirrorMode = usePlayerStore((s) => s.mirrorMode);
  const mediaTransform: any = [];
  if (mirrorMode === 'horizontal') mediaTransform.push({ scaleX: -1 });
  if (mirrorMode === 'vertical') mediaTransform.push({ scaleY: -1 });
  if (rotateDeg) mediaTransform.push({ rotate: `${rotateDeg}deg` });

  useEffect(() => {
    if (openedFor.current === sourceUrl) return;
    openedFor.current = sourceUrl;
    // 开大播放器前收起悬浮小窗（独立 store 无互斥 → 否则双路声音）
    const mp = useMiniPlayerStore.getState();
    if (mp && mp.visible) mp.close();
    usePlayerStore.getState().open(source, meta, danmaku);
    openTokenAtOpen.current = usePlayerStore.getState().openToken;
    try { logInfo(`[player] PlayerScreen open kind=${source.kind} url=${String(source.url).slice(0, 90)}`, 'player.screen'); } catch {}
    return () => {
      // 卸载时若全局播放器仍指向本页打开的源 → 关闭（persistent 页面关闭也应清干净，
      // 否则陈旧 source/state 残留可能干扰二次进入播放（首次能进、之后卡首帧））
      const st = usePlayerStore.getState();
      if (openedFor.current === sourceUrl && (!st.source || st.source.url === sourceUrl || !st.source.url)) {
        if (st.source && st.source.url === sourceUrl) st.close();
      }
      openedFor.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  // 跨页播放互斥：全局播放器同一时刻只播一路。本播放器打开的源被其它页面
  // 的新播放器顶替（store.url ≠ 本组件声明的源）→ 本页自动退出播放器
  //（如 Media tab 后台直播被房间点播顶掉，Media 页自动停止播放态）。
  const storeOpenToken = usePlayerStore((s) => s.openToken);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!sourceUrl || openedFor.current !== sourceUrl) return;
    // ⚠️ 判定「被别的页面顶替」必须用 openToken，不能用 source.url（2026-10-03 修复）：
    // 内核自动换线（nextCandidate）只改 source.url、不动 openToken，此前用 url 比较会把
    // 「同一页面内的换线」误判为跨页顶替 → 首条线路失败就关闭整个播放器、退回列表页。
    //
    // ⚠️ 必须用 getState() 读**实时** token，不能用 selector 捕获的 storeOpenToken（2026-10-03 二次修复）：
    // selector 给的是本次 render 时的快照 —— 上面 open effect 刚把 token 推进到 N+1，
    // 而这里仍拿着 render 期的 N → 首帧就判定「被顶替」→ **播放器刚打开就被自己关闭**
    //（实测：点回放录像，PlayerScreen 打开后立刻退回列表）。
    if (usePlayerStore.getState().openToken !== openTokenAtOpen.current && onCloseRef.current) {
      openedFor.current = '';
      onCloseRef.current();
    }
  }, [storeOpenToken, sourceUrl]);

  const content = (
    <View style={[styles.container, inline && !fullscreen ? styles.inline : null]}>
      {/* 画面层：旋转/镜像 transform 仅作用于视频（弹幕/控制层不转） */}
      <View style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { transform: mediaTransform }]}>
          <PlayerCore onVideoSize={onVideoSize} resumeAt={resumeAt} />
        </View>
      </View>
      {children}
      {!chromeHidden && <PlayerChrome features={features} extraActions={extraActions} onClose={onClose} inline={inline} onRetry={onRetry} barrageInput={barrageInput} />}
      <FullscreenManager />
    </View>
  );

  // 内嵌模式全屏：Modal 覆盖整个屏幕（保留横屏/沉浸管理）
  if (inline && fullscreen) {
    return (
      <Modal visible animationType="fade" onRequestClose={() => usePlayerStore.getState().setFullscreen(false)}>
        <View style={styles.container}>{content}</View>
      </Modal>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inline: { backgroundColor: 'transparent' },
});

export default PlayerScreen;
