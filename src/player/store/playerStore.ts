import { create } from 'zustand';
import { PlayerSource, PlayerMeta, DanmakuSource } from '../types';
// 播放互斥（单向）：playerStore 开播(直播/录播/视频/电台经此)时暂停后台音乐；
// 反向（音乐开播停 playerStore 媒体）在 MusicEngine.playTrack/resume 内处理。
import { useMusicPlayerStore } from '../../store/musicPlayerStore';

/**
 * 全局播放器单例状态（重写核心）：
 * 统一管理 播放源/元数据/播放状态/进度/控制条显隐/全屏/内核切换，
 * 替代现状散落在 MediaScreen/BilibiliLiveScreen/FollowedRoomsScreen 的 local state。
 */
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  // 源与元数据
  source: PlayerSource | null;
  meta: PlayerMeta;
  danmaku: DanmakuSource;
  /** 候选线路（播放失败时按序自动切换，source.url 指向当前线路） */
  candidateUrls: string[];
  candidateIndex: number;
  // 播放状态
  state: PlaybackState;
  position: number;
  duration: number;
  error: string;
  // 控制条 / 全屏 / 内核
  controlsVisible: boolean;
  fullscreen: boolean;
  useWebKernel: boolean;
  /** 本次开播是否因「公演默认网页」自动进入 web：web 失败时回退原生一次（防整场看不了） */
  forceWebOnce: boolean;
  // 渲染内核（由 PlayerCore 上报）
  activeKernel: 'native' | 'exo' | 'web';
  // 画质（B站）
  qualityQn: number | null;
  /** 播放倍速（回放可用；live 恒 1） */
  rate: number;
  
  rotateDeg: number;
  /** 镜像模式：none/horizontal/vertical */
  mirrorMode: 'none' | 'horizontal' | 'vertical';
  /** seek 指令：UI 写入，PlayerCore 消费后清零（与音乐 store seekTarget 同模式） */
  seekTarget: number;
  /** seek 指令序号（自增）。0 不再是「无指令」哨兵，使 seek 到 0 合法 */
  seekNonce: number;
  /** 每次 open 自增：区分「跨页顶替」与「同页内核换线」（换线不改它） */
  openToken: number;
  /** 进度粘滞守卫：seek 下发后至 stickyUntil 前，丢弃内核上报的旧进度（防进度条回弹） */
  stickyTarget: number;
  stickyFrom: number;
  stickyUntil: number;
  /** 内核重建请求（无 onRetry 时的「重试」按钮用）：自增后 PlayerCore 重建内核重新拉流 */
  rebuildNonce: number;
  /** 弹幕开关 */
  danmakuOn: boolean;

  // Actions
  open: (source: PlayerSource, meta?: PlayerMeta, danmaku?: DanmakuSource) => void;
  close: () => void;
  setState: (state: PlaybackState) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
  setError: (e: string) => void;
  clearError: () => void;
  toggleControls: (visible?: boolean) => void;
  setFullscreen: (v: boolean) => void;
  setUseWebKernel: (v: boolean) => void;
  setForceWebOnce: (v: boolean) => void;
  setActiveKernel: (k: PlayerState['activeKernel']) => void;
  setQualityQn: (qn: number | null) => void;
  setRate: (r: number) => void;
  setRotateDeg: (deg: number) => void;
  setMirrorMode: (m: 'none' | 'horizontal' | 'vertical') => void;
  setSeekTarget: (t: number) => void;
  /** 清除 seek 指令（早退分支用）：不递增 seekNonce，避免消费 effect 重入 */
  clearSeekTarget: () => void;
  
  markSeekIssued: (target: number) => void;
  /** 请求重建内核（重试同一个 URL） */
  requestKernelRebuild: () => void;
  toggleDanmaku: () => void;
  /** 播放失败时切到下一候选线路；返回是否切换成功（无候选/已到末尾 → false） */
  nextCandidate: () => boolean;
  /** 页面级 onClose 回调（PlayerScreen 挂载时注册；返回键/关闭时先调用它清理页面状态） */
  onClose: (() => void) | null;
  setOnClose: (fn: (() => void) | null) => void;
}

/**
 * rtmp/rtmps/.flv 是 Exo(LiveExoView) 专属流：即使页面漏传 needsNativeExo 也必须走 exo，
 * 否则误进 RNV vod 内核 → 直播卡首帧 + 拖动进度条 seek 直播流 → 原生闪退。
 */
function kernelForSource(source: PlayerSource): 'exo' | 'native' {
  const u = String((source && source.url) || '').toLowerCase();
  if (source?.needsNativeExo) return 'exo';
  if (u.startsWith('rtmp://') || u.startsWith('rtmps://')) return 'exo';
  if (u.includes('.flv')) return 'exo';
  return 'native';
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  onClose: null,
  setOnClose: (fn) => set({ onClose: fn }),
  source: null,
  meta: { title: '' },
  danmaku: { type: 'none' },
  candidateUrls: [],
  candidateIndex: 0,
  state: 'idle',
  position: 0,
  duration: 0,
  error: '',
  controlsVisible: true,
  fullscreen: false,
  useWebKernel: false,
  forceWebOnce: false,
  activeKernel: 'native',
  qualityQn: null,
  rate: 1,
  rotateDeg: 0,
  mirrorMode: 'none' as const,
  seekTarget: 0,
  seekNonce: 0,
  openToken: 0,
  stickyTarget: 0,
  stickyFrom: 0,
  stickyUntil: 0,
  rebuildNonce: 0,
  danmakuOn: true,

  open: (source, meta = { title: '' }, danmaku = { type: 'none' }) => {
    // 播放互斥：后播者胜 —— 直播/录播/电台/视频开播时，后台音乐自动暂停（可再点回播放）
    try {
      const mst = useMusicPlayerStore.getState();
      if (mst.queue.length && (mst.playbackState === 'playing' || mst.playbackState === 'paused')) {
        mst.setPlaybackState('paused'); // → MusicLibrary 351 effect exoControl pause + 通知转暂停
      }
    } catch {}
    return set((s) => {
      const urls = (source.urls && source.urls.length ? source.urls : [source.url]).filter(Boolean);
      return {
        source,
        meta,
        danmaku,
        state: source.url ? 'loading' : 'idle',
        position: 0,
        duration: 0,
        error: '',
        controlsVisible: true,
        fullscreen: false,
        useWebKernel: false,
        forceWebOnce: false,
        activeKernel: kernelForSource(source),
        qualityQn: null,
        rate: 1,
        rotateDeg: 0,
        mirrorMode: 'none' as const,
        seekTarget: 0,
        danmakuOn: true,
        openToken: s.openToken + 1,
        candidateUrls: urls,
        candidateIndex: 0,
        ...(urls[0] && urls[0] !== source.url ? { source: { ...source, url: urls[0] } } : {}),
      };
    });
  },

  close: () =>
    set({
      source: null,
      meta: { title: '' },
      danmaku: { type: 'none' },
      state: 'idle',
      position: 0,
      duration: 0,
      error: '',
      fullscreen: false,
    }),

  setState: (state) => set({ state }),
  setPosition: (position) => set((s) => {
    // seek 粘滞守卫（2026-10-03 修「进度条松手回弹」）：seek 下发后内核仍可能上报旧位置，
    // 直接覆盖会让进度条先跳到目标再弹回。窗口内只接受「比出发时更接近目标」的上报。
    if (s.stickyUntil > Date.now()) {
      const dNow = Math.abs(position - s.stickyTarget);
      const dFrom = Math.abs(s.stickyFrom - s.stickyTarget) + 0.3;
      if (dNow > dFrom) return {};
    }
    return { position };
  }),
  setDuration: (duration) => set({ duration }),
  setError: (error) => set({ error, state: 'error' }),
  clearError: () => set({ error: '', state: 'loading' }),
  toggleControls: (visible) => set((s) => ({ controlsVisible: visible === undefined ? !s.controlsVisible : visible })),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setUseWebKernel: (useWebKernel) => set({ useWebKernel }),
  setForceWebOnce: (forceWebOnce) => set({ forceWebOnce }),
  setActiveKernel: (activeKernel) => set({ activeKernel }),
  setQualityQn: (qualityQn) => set({ qualityQn }),
  setRate: (rate) => set({ rate }),
  setRotateDeg: (rotateDeg) => set({ rotateDeg: ((rotateDeg % 360) + 360) % 360 }),
  setMirrorMode: (mirrorMode) => set({ mirrorMode }),
  // seek 指令：递增 seekNonce（使「seek 到 0」也能被消费，不再用 0 当哨兵），并开粘滞窗口
  setSeekTarget: (seekTarget) => set((s) => ({
    seekTarget,
    seekNonce: s.seekNonce + 1,
    stickyFrom: s.position,
    stickyTarget: seekTarget,
    stickyUntil: Date.now() + 1500,
  })),
  // 清除指令（直播流/非有限时长等早退分支）：不动 seekNonce，避免消费 effect 重入
  clearSeekTarget: () => set({ seekTarget: 0 }),
  markSeekIssued: (target) => set((s) => ({
    position: target,
    seekTarget: 0,
    stickyTarget: target,
    stickyFrom: s.position,
    stickyUntil: Date.now() + 1500,
  })),
  requestKernelRebuild: () => set((s) => ({ rebuildNonce: s.rebuildNonce + 1 })),
  toggleDanmaku: () => set((s) => ({ danmakuOn: !s.danmakuOn })),
  nextCandidate: () => {
    let switched = false;
    set((s) => {
      if (!s.source || s.candidateIndex + 1 >= s.candidateUrls.length) return {};
      const nextIdx = s.candidateIndex + 1;
      switched = true;
      return {
        candidateIndex: nextIdx,
        source: { ...s.source, url: s.candidateUrls[nextIdx] },
        state: 'loading',
        error: '',
        position: 0,
        duration: 0,
      };
    });
    return switched;
  },
}));

export default usePlayerStore;
