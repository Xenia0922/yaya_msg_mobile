import React, { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

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
    paddingTop: 44, paddingBottom: 14, paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  navBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  titleWrap: { flex: 1, marginHorizontal: 8, justifyContent: 'center' },
  titleText: {
    color: '#fff', fontSize: 15, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 2,
  },
  subtitleText: {
    color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 2,
  },

  // ===== 底部控制坞 =====
  bottomDock: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 10, paddingBottom: 16, paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  dockIconBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  timeText: { color: '#fff', fontSize: 11, minWidth: 36, textAlign: 'center', marginHorizontal: 2 },
  // 进度条：外层 24px 触控区，内层 4px 视觉条（可拖动跟手）
  ctrlTrack: { flex: 1, height: 24, justifyContent: 'center', marginHorizontal: 8, position: 'relative' },
  ctrlBar: { position: 'relative', height: 4, width: '100%', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.32)' },
  ctrlFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: BILI_PINK },
  ctrlKnob: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginLeft: -5 },
  // 直播标识（替代进度条）：红色圆点 + 已播时长（还原用户偏好，不用文字）
  liveChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 8,
  },
  liveDot: {
    width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#ff4d4f', marginRight: 6,
  },
  liveChipTime: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  // 工具按钮（弹幕 / 倍速 / 更多）
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8, height: 36, borderRadius: 18, minWidth: 44,
  },
  toolText: { color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 4 },
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

/** 顶部沉浸栏：返回 / 标题 / 更多（哔哩哔哩风格） */
export function PlayerTopBar({
  onBack,
  title,
  subtitle,
  onMore,
  showMore = true,
}: {
  onBack: () => void;
  title: string;
  subtitle?: string;
  onMore?: () => void;
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
  onRefresh,
  onRotate,
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
  /** 刷新流/重连；不传则不显示该按钮 */
  onRefresh?: () => void;
  /** 横屏/竖屏切换（一次点击同时进入全屏沉浸）；不传则不显示该按钮 */
  onRotate?: () => void;
}) {
  const trackWidth = useRef(0);
  const dragRatioRef = useRef(0);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const ratioFromX = (x: number): number => {
    const w = trackWidth.current || 1;
    return Math.max(0, Math.min(1, x / w));
  };
  const onTrackGrant = (e: any) => { const r = ratioFromX(e.nativeEvent.locationX); dragRatioRef.current = r; setDragTime(r * duration); };
  const onTrackMove = (e: any) => { const r = ratioFromX(e.nativeEvent.locationX); dragRatioRef.current = r; setDragTime(r * duration); };
  const onTrackRelease = () => { const r = dragRatioRef.current; if (duration > 0) onSeek(r * duration); dragRatioRef.current = 0; setDragTime(null); };
  const displayTime = dragTime ?? currentTime;
  const pct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

  return (
    <View style={chromeStyles.bottomDock} pointerEvents="box-none">
      <TouchableOpacity style={chromeStyles.dockIconBtn} onPress={onTogglePlay} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialCommunityIcons name={paused ? 'play' : 'pause'} size={22} color="#fff" />
      </TouchableOpacity>

      {isLive ? (
        <View style={chromeStyles.liveChip}>
          <View style={chromeStyles.liveDot} />
          {typeof elapsed === 'number' ? <Text style={chromeStyles.liveChipTime}>{fmtTime(elapsed)}</Text> : null}
        </View>
      ) : (
        <>
          <Text style={chromeStyles.timeText}>{fmtTime(displayTime)}</Text>
          <View
            style={chromeStyles.ctrlTrack}
            onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={onTrackGrant}
            onResponderMove={onTrackMove}
            onResponderRelease={onTrackRelease}
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
          <Text style={[chromeStyles.toolText, danmakuOn && chromeStyles.toolTextOn]}>弹幕</Text>
        </TouchableOpacity>
      ) : null}

      {showRate && onCycleRate ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onCycleRate} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Text style={chromeStyles.toolText}>{rate}x</Text>
        </TouchableOpacity>
      ) : null}

      {onRefresh ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onRefresh} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {onRotate ? (
        <TouchableOpacity style={chromeStyles.toolBtn} onPress={onRotate} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <MaterialCommunityIcons name="fullscreen" size={22} color="#fff" />
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
