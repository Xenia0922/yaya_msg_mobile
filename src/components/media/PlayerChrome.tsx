import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../../i18n';

/**
 * 真正的哔哩哔哩风格播放器外壳：
 *  - 顶部沉浸栏：返回/退出全屏（圆形按钮）+ 标题 + 更多(⋮)
 *  - 底部控制坞：单排「播放/暂停 · 时间 · 进度条 · 时间 · 弹幕 · 倍速 · 更多」
 *  - 更多面板：底部弹出网格，收纳口袋直播/录播专属功能（礼物/贡献榜/刷新/公告…）
 * 由 MediaScreen（口袋直播/录播）与 BilibiliLiveScreen 复用，保证视觉统一。
 */
export const BILI_PINK = '#fb7299';
export const BILI_PINK_SOFT = '#fc8bab';

export const chromeStyles = StyleSheet.create({
  // ===== 顶部沉浸栏 =====
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 44, paddingBottom: 14, paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  navBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  titleWrap: { flex: 1, marginHorizontal: 10, justifyContent: 'center' },
  titleText: {
    color: '#fff', fontSize: 16, fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 2,
  },
  subtitleText: {
    color: 'rgba(255,255,255,0.80)', fontSize: 11, marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 2,
  },

  // ===== 底部悬浮玻璃坞（B站新风格：圆角胶囊 + 阴影） =====
  bottomDock: {
    position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 30,
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 6, paddingBottom: 6, paddingHorizontal: 6,
    borderRadius: 22,
    backgroundColor: 'rgba(16,16,18,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  dockIconBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  timeText: { color: '#fff', fontSize: 10, minWidth: 30, textAlign: 'center', marginHorizontal: 1 },
  // 进度条：外层 24px 触控区，内层 4px 视觉条（可拖动跟手）；压缩两侧元素后轨道更长
  ctrlTrack: { flex: 1, height: 24, justifyContent: 'center', marginHorizontal: 6, position: 'relative' },
  ctrlBar: { position: 'relative', height: 4, width: '100%', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.32)' },
  ctrlFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: BILI_PINK },
  ctrlKnob: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginLeft: -5 },
  // 直播标识（替代进度条）：红色圆点 + 已播时长（还原用户偏好，不用文字）
  liveChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 6,
  },
  liveDot: {
    width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#ff4d4f', marginRight: 6,
  },
  liveChipTime: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
  // 工具按钮（弹幕 / 画质 / 倍速 / 更多）——紧凑尺寸，给进度条让位
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6, height: 32, borderRadius: 16, minWidth: 38,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginLeft: 3,
  },
  toolText: { color: '#fff', fontSize: 11, fontWeight: '700', marginLeft: 3 },
  toolTextOn: { color: BILI_PINK },

  // ===== 更多面板 =====
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingTop: 8, paddingBottom: 26, paddingHorizontal: 12,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center', marginBottom: 14 },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  sheetItem: {
    width: '25%', alignItems: 'center', paddingVertical: 12,
  },
  sheetIconWrap: {
    width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 6,
  },
  sheetIconOn: { backgroundColor: 'rgba(251,114,153,0.18)' },
  sheetLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },
  sheetLabelOn: { color: BILI_PINK },
});

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const r = s % 60;
  const mm = h > 0 ? m % 60 : m;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${pad(mm)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export interface MoreItem {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
}

/** 顶部沉浸栏：返回 / 标题 / 刷新 / 更多（哔哩哔哩风格） */
export function PlayerTopBar({
  onBack,
  title,
  subtitle,
  onMore,
  onRefresh,
  onMini,
  showMore = true,
}: {
  onBack: () => void;
  title: string;
  subtitle?: string;
  onMore?: () => void;
  onRefresh?: () => void;
  /** 小窗按钮（应用内悬浮窗）；不传则不显示 */
  onMini?: () => void;
  showMore?: boolean;
}) {
  return (
    <View style={chromeStyles.topBar} pointerEvents="box-none">
      <TouchableOpacity style={chromeStyles.navBtn} onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
      </TouchableOpacity>
      <View style={chromeStyles.titleWrap}>
        <Text style={chromeStyles.titleText} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={chromeStyles.subtitleText} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onRefresh ? (
        <TouchableOpacity style={chromeStyles.navBtn} onPress={onRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name="refresh" size={20} color="#fff" />
        </TouchableOpacity>
      ) : null}
      {onMini ? (
        <TouchableOpacity style={chromeStyles.navBtn} onPress={onMini} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name="picture-in-picture-bottom-right-outline" size={20} color="#fff" />
        </TouchableOpacity>
      ) : null}
      {showMore && onMore ? (
        <TouchableOpacity style={chromeStyles.navBtn} onPress={onMore} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      ) : <View style={{ width: 38, height: 38 }} />}
    </View>
  );
}

/** 底部控制坞：单排「播放 · 时间 · 进度条 · 时间 · 弹幕 · 倍速 · 更多」（哔哩哔哩风格） */
export function PlayerBottomBar({
  isLive,
  paused,
  currentTime,
  duration,
  elapsed,
  showDanmaku = false,
  danmakuOn = true,
  onToggleDanmaku,
  showRate = false,
  rate = 1,
  onCycleRate,
  onTogglePlay,
  onSeek,
  onMore,
  onRotate,
  qualityLabel,
  onPickQuality,
  hideLiveChip = false,
}: {
  isLive: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  elapsed?: number;
  showDanmaku?: boolean;
  danmakuOn?: boolean;
  onToggleDanmaku?: () => void;
  showRate?: boolean;
  rate?: number;
  onCycleRate?: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  /** 「更多」面板入口；不传则不显示该按钮（默认收进顶栏右上角） */
  onMore?: () => void;
  /** 横屏/竖屏切换（仅旋转，不影响沉浸）；不传则不显示该按钮 */
  onRotate?: () => void;
  /** 画质文字按钮（如「原画」）；不传则不显示 */
  qualityLabel?: string;
  onPickQuality?: () => void;
  /** 直播时不显示红点+时长占位（B站直播不需要，避免被误认作进度条预览） */
  hideLiveChip?: boolean;
}) {
  const { t } = useI18n();
  const trackWidth = useRef(0);
  const trackX = useRef(0); // 进度轨道在屏幕上的绝对 X
  const trackRef = useRef<View>(null);
  const dragRatioRef = useRef(0);
  // 手势有效性守卫：只有「按下时轨道宽度已测到」才算一次有效拖拽。
  // 否则（控件刚出现 / 旋转后首帧布局未就绪，trackWidth 仍为 0）ratioFromX 会回退到缓存的 0，
  // 松手时 onSeek(0) 误把进度弹回开头 —— 这正是「拖动进度条有概率乱跳 / 回跳开头」的真因。
  const gestureActive = useRef(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  // 松手后保持目标进度，直到播放器上报的 currentTime 追上目标值附近，避免「松手后回跳再前跳」的乱跳
  const [heldTime, setHeldTime] = useState<number | null>(null);
  // 宽度未知时返回 null（而非回退到 0），让 grant/move/release 直接忽略本次手势，绝不会误 seek 到 0。
  // 用 pageX - 轨道起点换算：locationX 在 Android 上相对「事件目标视图」，滑出轨道会突变导致闪回 0。
  const ratioFromX = (pageX: number): number | null => {
    const w = trackWidth.current;
    if (!w || w < 2) return null;
    return Math.max(0, Math.min(1, (pageX - trackX.current) / w));
  };
  const onTrackGrant = (e: any) => {
    const r = ratioFromX(e.nativeEvent.pageX);
    if (r == null) { gestureActive.current = false; return; }
    gestureActive.current = true;
    dragRatioRef.current = r; setHeldTime(null); setDragTime(r * duration);
  };
  const onTrackMove = (e: any) => {
    const r = ratioFromX(e.nativeEvent.pageX);
    if (r == null) return;
    dragRatioRef.current = r; setDragTime(r * duration);
  };
  const onTrackRelease = () => {
    const r = dragRatioRef.current;
    // 仅当本次手势有效（按下时宽度已知）才真正 seek；无效手势不碰进度，杜绝误跳开头
    if (gestureActive.current && duration > 0) onSeek(r * duration);
    gestureActive.current = false;
    dragRatioRef.current = 0; setDragTime(null);
    // 有效手势且松手位置明确：保持目标进度直到播放器上报追上，消除松手回跳
    setHeldTime(r > 0 ? r * duration : null);
  };
  useEffect(() => {
    if (heldTime != null && !dragTime && Math.abs(currentTime - heldTime) < 1.5) setHeldTime(null);
  }, [currentTime, heldTime, dragTime]);
  const displayTime = dragTime ?? heldTime ?? currentTime;
  const pct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

  return (
    <View style={chromeStyles.bottomDock} pointerEvents="box-none">
      <TouchableOpacity style={chromeStyles.dockIconBtn} onPress={onTogglePlay} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialCommunityIcons name={paused ? 'play' : 'pause'} size={22} color="#fff" />
      </TouchableOpacity>

      {isLive ? (
        hideLiveChip ? (
          <View style={{ flex: 1 }} />
        ) : (
          <View style={chromeStyles.liveChip}>
            <View style={chromeStyles.liveDot} />
            {typeof elapsed === 'number' ? <Text style={chromeStyles.liveChipTime}>{fmtTime(elapsed)}</Text> : null}
          </View>
        )
      ) : (
        <>
          <Text style={chromeStyles.timeText}>{fmtTime(displayTime)}</Text>
          <View
            ref={trackRef}
            style={chromeStyles.ctrlTrack}
            onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; trackRef.current?.measureInWindow?.((x: number) => { trackX.current = x; }); }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={onTrackGrant}
            onResponderMove={onTrackMove}
            onResponderRelease={onTrackRelease}
            onResponderTerminate={onTrackRelease}
          >
            <View style={chromeStyles.ctrlBar}>
              <View style={[chromeStyles.ctrlFill, { width: `${pct}%` }]} />
              <View style={[chromeStyles.ctrlKnob, { left: `${pct}%` }]} />
            </View>
          </View>
          <Text style={chromeStyles.timeText}>{fmtTime(duration)}</Text>
        </>
      )}

      {showDanmaku && onToggleDanmaku ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onToggleDanmaku} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name={danmakuOn ? 'comment-text' : 'comment-text-outline'} size={20} color={danmakuOn ? BILI_PINK : '#fff'} />
          <Text style={[chromeStyles.toolText, danmakuOn && chromeStyles.toolTextOn]}>{t('弹幕')}</Text>
        </TouchableOpacity>
      ) : null}

      {qualityLabel && onPickQuality ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onPickQuality} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="high-definition-box" size={20} color={BILI_PINK} />
          <Text style={[chromeStyles.toolText, chromeStyles.toolTextOn]}>{qualityLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {showRate && onCycleRate ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onCycleRate} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Text style={chromeStyles.toolText}>{rate}x</Text>
        </TouchableOpacity>
      ) : null}

      {onRotate ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onRotate} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="screen-rotation" size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {onMore ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onMore} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="dots-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** 更多面板：底部弹出网格，收纳口袋直播/录播专属功能（哔哩哔哩「更多」风格） */
export function PlayerMorePanel({
  visible,
  onClose,
  title,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  items: MoreItem[];
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={chromeStyles.sheetBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={chromeStyles.sheet} onStartShouldSetResponder={() => true}>
          <View style={chromeStyles.sheetHandle} />
          {title ? <Text style={chromeStyles.sheetTitle}>{title}</Text> : null}
          <View style={chromeStyles.sheetGrid}>
            {items.map((it) => (
              <TouchableOpacity
                key={it.key}
                style={chromeStyles.sheetItem}
                onPress={() => { onClose(); it.onPress(); }}
              >
                <View style={[chromeStyles.sheetIconWrap, it.active && chromeStyles.sheetIconOn]}>
                  <MaterialCommunityIcons name={it.icon as any} size={24} color={it.active ? BILI_PINK : '#fff'} />
                </View>
                <Text style={[chromeStyles.sheetLabel, it.active && chromeStyles.sheetLabelOn]}>{it.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
