import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  GestureResponderEvent,
  Image,
  Linking,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePlayerStore } from '../store/playerStore';
import { isRtmpUrl } from '../resolve/streamResolver';
import { PlayerFeatures, PocketComment, PocketPlayerInfo } from '../types';
import { useI18n } from '../../i18n';
import { usePalette, fontFamily } from '../../theme';
import { formatPlayTime } from './FullscreenManager';
import { useSafeAreaInsets } from '../../hooks/useSafeAreaInsets';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { enqueueDownload } from '../../services/downloads';
import { useUiStore } from '../../store';
import { errorMessage, pickText, unwrapList } from '../../utils/data';
import { logWarn } from '../../utils/runtimeLog';
import pocketApi from '../../api/pocket48';
import { clearGiftEffectQueue } from '../../services/giftEffect';
import { useDanmakuSettings } from '../../store/danmakuSettings';
import { replayDanmakuCount } from '../../utils/danmaku';
import { getLiveUserAvatar, normalizeLiveAvatar } from '../../services/liveAvatarCache';

interface Props {
  pocket?: PocketPlayerInfo;
  features?: PlayerFeatures;
  extraActions?: Array<{
    key: string;
    icon: string;
    label: string;
    active?: boolean;
    onPress: () => void;
  }>;
  onClose?: () => void;

  inline?: boolean;

  onRetry?: () => void;

  barrageInput?: React.ReactNode;
}

const CONTROLS_HIDE_MS = 3500;

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const TINT = '#ff6f91';

function RankAvatar({ uri, overlap }: { uri: string; overlap: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const style = [styles.pocketRankAvatar, overlap && { marginLeft: -9 }];
  return failed || !uri ? (
    <View style={[style, styles.pocketRankAvatarFallback]}>
      <MaterialCommunityIcons name="account" size={18} color="rgba(255,255,255,0.85)" />
    </View>
  ) : (
    <Image source={{ uri }} resizeMode="cover" onError={() => setFailed(true)} style={style} />
  );
}

function CommentAvatar({ uri, userId }: { uri?: string; userId?: string | number }) {
  const normalized = normalizeLiveAvatar(uri);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState('');
  const fallbackAttempted = useRef(false);
  useEffect(() => {
    fallbackAttempted.current = false;
    setFailed(false);
    setResolved('');
  }, [normalized, userId]);
  useEffect(() => {
    let active = true;
    const id = String(userId || '');
    if ((!normalized || failed) && !fallbackAttempted.current && /^\d+$/.test(id) && id !== '0') {
      fallbackAttempted.current = true;
      void getLiveUserAvatar(id, true).then((url) => {
        if (active && url && url !== normalized) {
          setResolved(url);
          setFailed(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [normalized, userId, failed]);
  const url = resolved || normalized;
  return url && !failed ? (
    <Image
      source={{ uri: url }}
      onError={() => setFailed(true)}
      style={styles.pocketCommentAvatar}
    />
  ) : (
    <View style={styles.pocketCommentAvatarFallback}>
      <MaterialCommunityIcons name="account" size={13} color="rgba(255,255,255,0.85)" />
    </View>
  );
}

function PocketCommentFeed({
  comments,
  onCommentPress,
  hideEnter,
  fontSize,
  opacity,
  bottom,
}: {
  comments: PocketComment[];
  onCommentPress?: (comment: PocketComment) => void;
  hideEnter: boolean;
  fontSize: number;
  opacity: number;
  bottom: number;
}) {
  const visible = useMemo(
    () => comments.filter((item) => !hideEnter || item.kind !== 'enter'),
    [comments, hideEnter],
  );
  const listRef = useRef<FlatList<PocketComment>>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const latestId = visible.length ? visible[visible.length - 1]?.id : '';
  const scrollScheduledRef = useRef(false);
  const draggingRef = useRef(false);

  const scrollToLatest = useCallback(() => {
    if (!atBottomRef.current) return;
    if (scrollScheduledRef.current) return;
    scrollScheduledRef.current = true;
    requestAnimationFrame(() => {
      scrollScheduledRef.current = false;
      listRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  useEffect(() => {
    if (!visible.length) {
      atBottomRef.current = true;
      setAtBottom(true);
      setUserScrolledUp(false);
      return;
    }
    scrollToLatest();
  }, [visible.length, latestId, scrollToLatest]);

  const updateScrollStickiness = useCallback((e: any) => {
    const native = e?.nativeEvent;
    if (!native) return;
    const { contentOffset, contentSize, layoutMeasurement } = native;
    const contentH = Number(contentSize?.height) || 0;
    const viewH = Number(layoutMeasurement?.height) || 0;
    const offsetY = Number(contentOffset?.y) || 0;
    const fitsViewport = contentH <= viewH + 8;
    const distanceToEnd = contentH - viewH - offsetY;
    if (fitsViewport || distanceToEnd <= 32) {
      if (!atBottomRef.current) {
        atBottomRef.current = true;
        setAtBottom(true);
      }
      setUserScrolledUp(false);
    } else if (draggingRef.current && distanceToEnd > 48) {
      if (atBottomRef.current) {
        atBottomRef.current = false;
        setAtBottom(false);
      }
      setUserScrolledUp(true);
    }
  }, []);

  const handleScrollBegin = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback((e: any) => {
    draggingRef.current = false;
    const native = e?.nativeEvent;
    if (!native) return;
    const { contentOffset, contentSize, layoutMeasurement } = native;
    const contentH = Number(contentSize?.height) || 0;
    const viewH = Number(layoutMeasurement?.height) || 0;
    const offsetY = Number(contentOffset?.y) || 0;
    const distanceToEnd = contentH - viewH - offsetY;
    if (contentH <= viewH + 8 || distanceToEnd <= 32) {
      atBottomRef.current = true;
      setAtBottom(true);
      setUserScrolledUp(false);
    } else {
      atBottomRef.current = false;
      setAtBottom(false);
      setUserScrolledUp(true);
    }
  }, []);
  const renderComment = (item: PocketComment) => (
    <TouchableOpacity
      disabled={!onCommentPress || (!item.userId && !item.nick)}
      onPress={() => onCommentPress?.(item)}
      activeOpacity={0.8}
      style={[
        styles.pocketComment,
        (item.kind === 'member' || item.kind === 'superman') && styles.pocketCommentHighlight,
      ]}
    >
      <CommentAvatar uri={item.avatar} userId={item.userId} />
      {Number(item.level) > 0 && item.kind !== 'gift' && item.kind !== 'enter' ? (
        <View style={styles.pocketCommentLevel}>
          <Text allowFontScaling={false} style={styles.pocketCommentLevelText}>
            Lv.{Math.floor(Number(item.level))}
          </Text>
        </View>
      ) : null}
      {(() => {
        const commentFontSize = Math.max(10, Math.min(15, fontSize - 3));
        return (
          <Text
            allowFontScaling={false}
            numberOfLines={2}
            ellipsizeMode="tail"
            style={[
              styles.pocketCommentText,
              {
                fontSize: commentFontSize,
                lineHeight: Math.round(commentFontSize * 1.35),
              },
            ]}
          >
            {item.nick && item.kind !== 'gift' && item.kind !== 'enter' ? `${item.nick}：` : ''}
            {item.text}
          </Text>
        );
      })()}
    </TouchableOpacity>
  );
  return (
    <View style={[styles.pocketComments, { opacity, bottom }]} pointerEvents="box-none">
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderComment(item)}
        style={styles.pocketHistoryList}
        contentContainerStyle={[
          styles.pocketHistoryContent,
          { flexGrow: 1, justifyContent: 'flex-end' },
        ]}
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={5}
        scrollEventThrottle={100}
        onScroll={updateScrollStickiness}
        onContentSizeChange={scrollToLatest}
        onScrollBeginDrag={handleScrollBegin}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
      />
      {!atBottom && userScrolledUp ? (
        <TouchableOpacity
          style={styles.pocketScrollBottom}
          onPress={() => {
            draggingRef.current = false;
            atBottomRef.current = true;
            setAtBottom(true);
            setUserScrolledUp(false);
            listRef.current?.scrollToEnd({ animated: true });
          }}
          activeOpacity={0.85}
          accessibilityLabel="回到底部"
        >
          <MaterialCommunityIcons name="chevron-down" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function PlayerChrome({
  pocket,
  features = {},
  extraActions = [],
  onClose,
  inline = false,
  onRetry,
  barrageInput,
}: Props) {
  const { t } = useI18n();
  const palette = usePalette();
  const meta = usePlayerStore((s) => s.meta);
  const state = usePlayerStore((s) => s.state);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const error = usePlayerStore((s) => s.error);
  const controlsVisible = usePlayerStore((s) => s.controlsVisible);
  const cleanScreen = usePlayerStore((s) => s.cleanScreen);
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const source = usePlayerStore((s) => s.source);
  const useWebKernel = usePlayerStore((s) => s.useWebKernel);
  const danmakuOn = usePlayerStore((s) => s.danmakuOn);
  const danmakuEnabled = useDanmakuSettings((s) => s.enabled);
  const danmakuOpacity = useDanmakuSettings((s) => s.opacity);
  const danmakuFontSize = useDanmakuSettings((s) => s.fontSize);
  const hideEnter = usePlayerStore((s) => s.hideEnter);
  const hideEffects = usePlayerStore((s) => s.hideEffects);
  const rate = usePlayerStore((s) => s.rate);
  const rotateDeg = usePlayerStore((s) => s.rotateDeg);
  const mirrorMode = usePlayerStore((s) => s.mirrorMode);
  const [moreVisible, setMoreVisible] = useState(false);
  const [rateSheetVisible, setRateSheetVisible] = useState(false);
  const [rankAvatars, setRankAvatars] = useState<string[]>([]);
  const [rankRefreshNonce, setRankRefreshNonce] = useState(0);
  const pocketRef = useRef(pocket);
  pocketRef.current = pocket;
  useEffect(() => {
    let active = true;
    setRankAvatars([]);
    const liveId = pocketRef.current?.liveId;
    if (liveId && pocketRef.current?.onRankPress) {
      pocketApi
        .getLiveRank(liveId)
        .then((res: any) => {
          const rows = unwrapList(res, [
            'content.rankList',
            'content.userRankList',
            'content.userRankingList',
            'content.contributionList',
            'content.list',
            'content.data',
            'content.data.list',
            'content.data.rankList',
            'data.rankList',
            'data.userRankList',
            'data.userRankingList',
            'data.contributionList',
            'data.list',
            'rankList',
            'userRankList',
            'userRankingList',
            'contributionList',
            'list',
          ]);
          const avatars = rows.slice(0, 3).map((row: any) => {
            const avatar = pickText(row, [
              'avatar',
              'userAvatar',
              'headImg',
              'picPath',
              'userInfo.avatar',
              'userInfo.userAvatar',
              'user.avatar',
              'user.userAvatar',
              'memberInfo.avatar',
            ]);
            return normalizeLiveAvatar(avatar);
          });
          if (active) setRankAvatars(avatars);
          rows.slice(0, 3).forEach((row: any, index: number) => {
            if (avatars[index]) return;
            const userId = pickText(row, [
              'userId',
              'uid',
              'id',
              'userInfo.userId',
              'user.userId',
              'memberInfo.userId',
            ]);
            if (!userId || !active) return;
            void getLiveUserAvatar(userId).then((url) => {
              if (active && url)
                setRankAvatars((prev) => prev.map((value, i) => (i === index ? url : value)));
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [pocket?.liveId, rankRefreshNonce]);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const hasPocket = !!pocket;
  const [navigationInset, setNavigationInset] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (hasPocket && Platform.OS === 'android') {
      NativeModules.PipController?.getNavigationInset?.()
        .then((value: unknown) => {
          if (active && typeof value === 'number' && value >= 0) setNavigationInset(value);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [hasPocket, screenW, screenH]);

  const dockScale = Math.max(0.82, Math.min(1, screenH / 820));

  const insets = useSafeAreaInsets();

  const kbHeight = useKeyboardHeight(Platform.OS === 'android');
  const kbLift = kbHeight > 0 ? kbHeight + 6 : 0;

  const kbVisibleRef = useRef(false);

  const showControlsRef = useRef<(() => void) | null>(null);
  const tapRef = useRef<{ t: number; side: 'l' | 'r' } | null>(null);
  const [seekFlash, setSeekFlash] = useState<number | null>(null);
  const seekFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controlsOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible, controlsOpacity]);

  const progTrackRef = useRef<View>(null);
  const progW = useRef(0);
  const progX = useRef(0);
  const dragRatioRef = useRef<number | null>(null);

  const dragLockRef = useRef(false);

  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const progCtl = useRef<{ down: (x: number) => void; move: (x: number) => void; up: () => void }>({
    down: () => {},
    move: () => {},
    up: () => {},
  });
  const progPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        try {
          dragLockRef.current = true;
          progCtl.current.down(e.nativeEvent.pageX);
        } catch (err) {
          logWarn(`[PlayerChrome] prog grant err ${String(err)}`, 'player.chrome');
        }
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        try {
          progCtl.current.move(e.nativeEvent.pageX);
        } catch (err) {
          logWarn(`[PlayerChrome] prog move err ${String(err)}`, 'player.chrome');
        }
      },
      onPanResponderRelease: () => {
        try {
          dragLockRef.current = false;
          progCtl.current.up();
        } catch (err) {
          logWarn(`[PlayerChrome] prog up err ${String(err)}`, 'player.chrome');
        }
      },
      onPanResponderTerminate: () => {
        try {
          dragLockRef.current = false;
          progCtl.current.up();
        } catch (err) {
          logWarn(`[PlayerChrome] prog terminate err ${String(err)}`, 'player.chrome');
        }
      },
    }),
  ).current;

  const showControls = useCallback(() => {
    usePlayerStore.getState().toggleControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (kbVisibleRef.current) {
        showControls();
        return;
      }

      if (dragLockRef.current) {
        showControls();
        return;
      }
      const s = usePlayerStore.getState();
      if (s.state === 'playing' && !(pocketRef.current && s.source?.kind === 'live'))
        s.toggleControls(false);
    }, CONTROLS_HIDE_MS);
  }, []);
  showControlsRef.current = showControls;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (kbHeight > 0) {
      kbVisibleRef.current = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      usePlayerStore.getState().toggleControls(true);
    } else if (kbVisibleRef.current) {
      kbVisibleRef.current = false;
      showControlsRef.current?.();
    }
  }, [kbHeight]);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);

      if (seekFlashTimer.current) clearTimeout(seekFlashTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (progRaf.current) cancelAnimationFrame(progRaf.current);
    };
  }, [showControls, source?.url]);

  const onVideoTap = useCallback(
    (side: 'l' | 'r') => {
      const now = Date.now();
      const prev = tapRef.current;
      if (prev && now - prev.t < 320 && prev.side === side) {
        tapRef.current = null;
        const s = usePlayerStore.getState();
        if (
          s.source?.kind !== 'live' &&
          s.duration > 0 &&
          (s.state === 'playing' || s.state === 'paused')
        ) {
          const delta = side === 'r' ? 10 : -10;
          const base = s.position;
          const target = Math.max(0, Math.min(s.duration - 0.3, base + delta));

          s.setPosition(target);
          s.setSeekTarget(target);
          setSeekFlash(delta);
          if (seekFlashTimer.current) clearTimeout(seekFlashTimer.current);
          seekFlashTimer.current = setTimeout(() => setSeekFlash(null), 900);
        }
        return;
      }
      tapRef.current = { t: now, side };
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => {
        if (tapRef.current && tapRef.current.t === now) {
          tapRef.current = null;
          showControls();
        }
      }, 320);
    },
    [showControls],
  );

  const showToast = useUiStore((s) => s.showToast);
  const runDownload = useCallback(async () => {
    const s = usePlayerStore.getState();
    const u = String(s.source?.url || '');
    if (!u || /\.m3u8/i.test(u)) {
      showToast(t('该流暂不支持直接下载'));
      return;
    }
    try {
      await enqueueDownload({ url: u, type: 'replay', name: String(s.meta?.title || '视频') });
      showToast(t('已加入下载队列'));
    } catch (e: any) {
      showToast(t('下载失败：{msg}', { msg: errorMessage(e) }));
    }
    showControls();
  }, [showToast, t, showControls]);

  const downloadAvailable =
    !!source &&
    source.kind !== 'live' &&
    !isRtmpUrl(String(source.url || '')) &&
    /^https?:/i.test(source.url) &&
    !/\.m3u8/i.test(source.url);
  const moreActions = useMemo(() => {
    const actions = pocket
      ? extraActions.filter(
          (action) => action.key !== 'gift' && !(action.key === 'rank' && pocket.onRankPress),
        )
      : extraActions;
    if (!downloadAvailable) return actions;
    return [
      { key: 'download', icon: 'download', label: t('下载'), onPress: runDownload } as any,
      ...actions,
    ];
  }, [downloadAvailable, extraActions, runDownload, t, pocket]);

  const progRaf = useRef(0);
  const pendingRatio = useRef(0);
  const replayItems = pocket?.replayComments;
  const replayCount = replayItems ? replayDanmakuCount(replayItems, position) : 0;

  const replayComments = useMemo(
    () =>
      replayItems?.slice(Math.max(0, replayCount - 200), replayCount).map((item, index) => ({
        id: `${item.time}-${Math.max(0, replayCount - 200) + index}`,
        text: item.text,
        nick: item.nick,
        userId: item.userId,
        avatar: item.avatar,
        level: item.level,
      })),
    [replayItems, replayCount],
  );

  if (!source) return null;

  const playing = state === 'playing';

  const _u = String((source && source.url) || '').toLowerCase();
  const isLive =
    source.kind === 'live' || (source.kind !== 'vod' && (isRtmpUrl(_u) || _u.includes('.flv')));

  const cardMode = inline && !fullscreen;
  const progRatio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  const shownRatio = dragRatio != null ? dragRatio : progRatio;
  const shownPos = dragRatio != null && duration > 0 ? dragRatio * duration : position;
  let pocketComments = pocket?.comments || [];
  if (replayComments) pocketComments = replayComments;

  const togglePlay = () => {
    const s = usePlayerStore.getState();
    if (s.state === 'playing') s.setState('paused');
    else if (s.state === 'paused' || s.state === 'error') s.setState('playing');
    showControls();
  };

  const toggleFullscreen = () => {
    usePlayerStore.getState().setFullscreen(!fullscreen);
    showControls();
  };

  const pickRate = (r: number) => {
    usePlayerStore.getState().setRate(r);
    setRateSheetVisible(false);
    showControls();
  };

  const toggleDanmaku = () => {
    if (pocket && !danmakuEnabled) {
      useDanmakuSettings.getState().set({ enabled: true });
      if (!danmakuOn) usePlayerStore.getState().toggleDanmaku();
    } else {
      usePlayerStore.getState().toggleDanmaku();
    }
    showControls();
  };

  const seekTo = (t: number) => {
    if (isLive) return;
    const s = usePlayerStore.getState();
    s.setPosition(t);

    s.setSeekTarget(t);
    showControls();
  };

  const ratioFromX = (pageX: number): number | null => {
    if (!progW.current || progW.current < 2) return null;
    return Math.max(0, Math.min(1, (pageX - progX.current) / progW.current));
  };
  const onProgDown = (pageX: number) => {
    const st = usePlayerStore.getState();
    if (st.source?.kind === 'live' || st.duration <= 0) return;
    if (st.state !== 'playing' && st.state !== 'paused') return;
    const r = ratioFromX(pageX);
    if (r == null) return;
    if (progRaf.current) {
      cancelAnimationFrame(progRaf.current);
      progRaf.current = 0;
    }
    dragRatioRef.current = r;
    setDragRatio(r);
  };

  const onProgMove = (pageX: number) => {
    if (dragRatioRef.current == null) return;
    const r = ratioFromX(pageX);
    if (r == null) return;
    pendingRatio.current = r;
    if (progRaf.current) return;
    progRaf.current = requestAnimationFrame(() => {
      progRaf.current = 0;
      const nr = pendingRatio.current;
      const base = dragRatioRef.current;
      if (base != null && Math.abs(nr - base) < 0.004) return;
      dragRatioRef.current = nr;
      setDragRatio(nr);
    });
  };
  const onProgUp = () => {
    if (progRaf.current) {
      cancelAnimationFrame(progRaf.current);
      progRaf.current = 0;
    }
    const r = dragRatioRef.current;
    dragRatioRef.current = null;
    setDragRatio(null);
    if (r != null) {
      const st = usePlayerStore.getState();
      if (st.duration > 0 && (st.state === 'playing' || st.state === 'paused'))
        seekTo(r * st.duration);
    }
  };

  progCtl.current = { down: onProgDown, move: onProgMove, up: onProgUp };

  if (pocket && cleanScreen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('退出清屏')}
        style={StyleSheet.absoluteFill}
        onPress={() => {
          usePlayerStore.getState().setCleanScreen(false);
          showControls();
        }}
      />
    );
  }

  return (
    <>
      {pocket && (!inline || fullscreen) ? (
        <Animated.View
          style={[styles.pocketTop, { opacity: controlsOpacity, top: insets.top + 4 }]}
          pointerEvents={controlsVisible ? 'box-none' : 'none'}
        >
          <TouchableOpacity
            activeOpacity={pocket.onHostPress ? 0.78 : 1}
            disabled={!pocket.onHostPress}
            onPress={pocket.onHostPress}
            accessibilityRole={pocket.onHostPress ? 'button' : undefined}
            accessibilityLabel={pocket.onHostPress ? pocket.name || meta.title : undefined}
            style={styles.pocketIdentity}
          >
            {pocket.avatar ? (
              <Image source={{ uri: pocket.avatar }} style={styles.pocketAvatar} />
            ) : (
              <View style={styles.pocketAvatarFallback}>
                <MaterialCommunityIcons name="account" size={18} color="#fff" />
              </View>
            )}
            <Text
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={styles.pocketName}
              numberOfLines={1}
            >
              {pocket.name || meta.title}
            </Text>
            {pocket.onHostPress ? (
              <MaterialCommunityIcons
                name="chevron-right"
                size={15}
                color="rgba(255,255,255,0.78)"
                style={{ marginLeft: 1, marginRight: -2 }}
              />
            ) : null}
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {pocket.audience ? (
            <View style={styles.pocketAudience}>
              <MaterialCommunityIcons name="account-group-outline" size={16} color="#fff" />
              <Text allowFontScaling={false} numberOfLines={1} style={styles.pocketAudienceText}>
                {pocket.audience}
              </Text>
            </View>
          ) : null}
          {pocket.onRankPress ? (
            <TouchableOpacity
              accessibilityLabel={t('贡献榜')}
              onPress={() => {
                setRankRefreshNonce((n) => n + 1);
                pocket.onRankPress?.();
              }}
              style={styles.pocketRank}
            >
              {(pocket.rankAvatars?.length ? pocket.rankAvatars : rankAvatars).some(Boolean) ? (
                (pocket.rankAvatars?.length ? pocket.rankAvatars : rankAvatars)
                  .filter(Boolean)
                  .map((avatar, index) => (
                    <RankAvatar
                      key={`${avatar}-${index}`}
                      uri={normalizeLiveAvatar(avatar)}
                      overlap={index > 0}
                    />
                  ))
              ) : (
                <View style={styles.pocketRankFallback}>
                  <MaterialCommunityIcons name="trophy-outline" size={20} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityLabel={t('关闭')}
            style={[styles.pocketCircle, styles.pocketClose]}
            onPress={() => {
              if (inline && fullscreen) usePlayerStore.getState().setFullscreen(false);
              else {
                if (fullscreen) usePlayerStore.getState().setFullscreen(false);
                if (onClose) onClose();
                else usePlayerStore.getState().close();
              }
            }}
          >
            <MaterialCommunityIcons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      ) : !inline || fullscreen ? (
        <Animated.View
          style={[styles.topWrap, { opacity: controlsOpacity, paddingTop: insets.top + 6 }]}
          pointerEvents={controlsVisible ? 'auto' : 'none'}
        >
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity
            style={styles.topBtn}
            onPress={() => {
              if (inline && fullscreen) usePlayerStore.getState().setFullscreen(false);
              else {
                if (fullscreen) usePlayerStore.getState().setFullscreen(false);
                if (onClose) onClose();
                else usePlayerStore.getState().close();
              }
            }}
          >
            <MaterialCommunityIcons
              name={inline ? 'chevron-down' : 'chevron-down'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.titleText} numberOfLines={1}>
              {meta.title}
            </Text>
          </View>
          <TouchableOpacity style={styles.topBtn} onPress={() => setMoreVisible(true)}>
            <MaterialCommunityIcons name="dots-horizontal" size={22} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      {error ? (
        <View style={styles.errorWrap} pointerEvents="box-none">
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.errorBtn}
            onPress={() => {
              if (onRetry) onRetry();
              else usePlayerStore.getState().requestKernelRebuild();
              showControls();
            }}
          >
            <Text style={styles.errorBtnText}>{t('重试')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {state === 'loading' && !error ? <LoadingHint /> : null}

      {!error && !isLive && state !== 'playing' && state !== 'loading' ? (
        <Pressable
          style={styles.centerPlayWrap}
          onPress={() => {
            if (cardMode && source.kind !== 'audio' && !source.audioOnly) {
              usePlayerStore.getState().setFullscreen(true);
            } else {
              togglePlay();
            }
          }}
        >
          <View
            style={[
              styles.centerPlayBtn,
              source.kind === 'audio' || source.audioOnly ? styles.centerPlayBtnSm : null,
            ]}
          >
            <MaterialCommunityIcons
              name="play"
              size={26}
              color="#16181c"
              style={{ marginLeft: 4 }}
            />
          </View>
        </Pressable>
      ) : null}

      {seekFlash != null ? (
        <View style={styles.seekFlashWrap} pointerEvents="none">
          <MaterialCommunityIcons
            name={seekFlash > 0 ? 'fast-forward' : 'rewind'}
            size={22}
            color="#fff"
          />
          <Text style={styles.seekFlashText}>
            {seekFlash > 0 ? `+${seekFlash}s` : `${seekFlash}s`}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => {
          if (inline && !fullscreen) {
            if (source.kind === 'audio' || source.audioOnly) {
              togglePlay();
              return;
            }

            usePlayerStore.getState().setFullscreen(true);
            return;
          }
          if (inline) {
            showControls();
            return;
          }
          const x = e.nativeEvent.locationX ?? 0;
          onVideoTap(x < screenW / 2 ? 'l' : 'r');
        }}
      />
      {pocket && danmakuOn && danmakuEnabled && !cardMode && pocketComments.length ? (
        <PocketCommentFeed
          key={source.liveId || source.url}
          comments={pocketComments}
          onCommentPress={pocket.onCommentPress}
          hideEnter={hideEnter}
          fontSize={danmakuFontSize}
          opacity={danmakuOpacity}
          bottom={
            Math.max(navigationInset ?? insets.bottom, 10) +
            (controlsVisible ? (isLive ? 56 : 120) : 16) +
            kbLift
          }
        />
      ) : null}
      {!cardMode ? (
        <View style={StyleSheet.absoluteFill} pointerEvents={controlsVisible ? 'box-none' : 'none'}>
          <Animated.View pointerEvents="none" style={{ opacity: controlsOpacity }}>
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.68)']}
              style={styles.bottomShade}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.dockWrap,
              {
                opacity: controlsOpacity,
                paddingBottom:
                  Math.max(
                    pocket ? (navigationInset ?? insets.bottom) : insets.bottom,
                    Math.round(10 * dockScale),
                  ) +
                  Math.round(4 * dockScale) +
                  kbLift,
              },
            ]}
            pointerEvents="box-none"
          >
            {!isLive ? (
              <View style={styles.progressRow}>
                <Text style={styles.timeText}>{formatPlayTime(shownPos)}</Text>
                <View
                  ref={progTrackRef}
                  style={styles.progressTouch}
                  onLayout={(e) => {
                    progW.current = e.nativeEvent.layout.width;
                    progTrackRef.current?.measureInWindow?.((x) => {
                      progX.current = x;
                    });
                  }}
                  {...progPan.panHandlers}
                >
                  <View style={styles.progressTrackBg}>
                    <View style={[styles.progressFill, { width: `${shownRatio * 100}%` }]} />
                  </View>
                  <View style={[styles.progressThumb, { left: `${shownRatio * 100}%` }]} />
                </View>
                <Text style={styles.timeText}>{formatPlayTime(duration)}</Text>
              </View>
            ) : null}

            {!pocket && barrageInput ? (
              <View style={[styles.dockBarrageRow, { marginBottom: Math.round(8 * dockScale) }]}>
                {barrageInput}
              </View>
            ) : null}

            {pocket ? (
              <View style={styles.pocketBottomRow}>
                {isLive && barrageInput ? (
                  <View style={styles.pocketInputWrap}>{barrageInput}</View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.pocketCircle}
                      onPress={togglePlay}
                      accessibilityLabel={playing ? t('暂停') : t('播放')}
                    >
                      <MaterialCommunityIcons
                        name={playing ? 'pause' : 'play'}
                        size={23}
                        color="#fff"
                      />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                  </>
                )}
                <TouchableOpacity
                  style={styles.pocketCircle}
                  onPress={() => setMoreVisible(true)}
                  accessibilityLabel={t('更多')}
                >
                  <MaterialCommunityIcons name="dots-vertical" size={24} color="#fff" />
                </TouchableOpacity>
                {isLive && extraActions.find((action) => action.key === 'gift') ? (
                  <TouchableOpacity
                    style={styles.pocketCircle}
                    onPress={() => extraActions.find((action) => action.key === 'gift')?.onPress()}
                    accessibilityLabel={t('礼物')}
                  >
                    <MaterialCommunityIcons name="gift-outline" size={24} color="#fff" />
                  </TouchableOpacity>
                ) : !isLive ? (
                  <TouchableOpacity
                    style={styles.pocketCircle}
                    onPress={() => {
                      clearGiftEffectQueue();
                      usePlayerStore.getState().setCleanScreen(true);
                    }}
                    accessibilityLabel={t('清屏播放')}
                  >
                    <MaterialCommunityIcons name="eye-off-outline" size={23} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View style={styles.ctrlRow}>
                <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.85}>
                  <MaterialCommunityIcons
                    name={playing ? 'pause' : 'play'}
                    size={24}
                    color="#16181c"
                    style={!playing ? { marginLeft: 3 } : undefined}
                  />
                </TouchableOpacity>
                <Text style={styles.ctrlHintText} numberOfLines={1}>
                  {source.audioOnly ? t('纯音频') : ''}
                </Text>
                <View style={{ flex: 1 }} />
                {features.rate && !isLive && !useWebKernel ? (
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={() => setRateSheetVisible(true)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.rateText, rate !== 1 && { color: TINT }]}>{rate}x</Text>
                  </TouchableOpacity>
                ) : null}
                {features.danmaku && !useWebKernel ? (
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={toggleDanmaku}
                    activeOpacity={0.75}
                  >
                    <MaterialCommunityIcons
                      name={danmakuOn ? 'comment-text-multiple' : 'comment-text-multiple-outline'}
                      size={20}
                      color={danmakuOn ? TINT : 'rgba(255,255,255,0.9)'}
                    />
                  </TouchableOpacity>
                ) : null}

                {(() => {
                  const pipAction = extraActions.find((a) => a.key === 'pip');
                  if (!pipAction) return null;
                  return (
                    <TouchableOpacity
                      style={styles.ctrlBtn}
                      onPress={() => {
                        pipAction.onPress();
                        showControls();
                      }}
                      activeOpacity={0.75}
                    >
                      <MaterialCommunityIcons
                        name="picture-in-picture-bottom-right-outline"
                        size={20}
                        color="rgba(255,255,255,0.92)"
                      />
                    </TouchableOpacity>
                  );
                })()}
                {!inline || fullscreen ? (
                  <TouchableOpacity
                    style={styles.ctrlBtn}
                    onPress={toggleFullscreen}
                    activeOpacity={0.75}
                  >
                    <MaterialCommunityIcons
                      name={fullscreen ? 'fullscreen-exit' : 'fullscreen'}
                      size={21}
                      color="rgba(255,255,255,0.92)"
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </Animated.View>
        </View>
      ) : null}

      <Modal
        visible={rateSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRateSheetVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.rateMask}
          onPress={() => setRateSheetVisible(false)}
        >
          <View style={[styles.rateSheet, { backgroundColor: palette.surface }]}>
            <Text style={[styles.rateSheetTitle, { color: palette.labelSecondary }]}>
              {t('播放速度')}
            </Text>
            <View style={styles.rateGrid}>
              {RATES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.rateChip,
                    {
                      backgroundColor: rate === r ? palette.tintSoft : palette.fill2,
                      borderColor: rate === r ? palette.tint : 'transparent',
                    },
                  ]}
                  onPress={() => pickRate(r)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.rateChipText,
                      { color: rate === r ? palette.tint : palette.label },
                    ]}
                  >
                    {r}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={moreVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMoreVisible(false)}
      >
        <View style={styles.modalShade}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreVisible(false)} />
          <View
            style={[
              styles.morePanel,
              { backgroundColor: pocket ? '#181923' : palette.surface },
              pocket && { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            {!pocket && (
              <View style={styles.moreHeader}>
                <Text style={[styles.moreTitle, { color: palette.label }]}>{t('播放器功能')}</Text>
                <TouchableOpacity
                  onPress={() => setMoreVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons name="close" size={20} color={palette.labelSecondary} />
                </TouchableOpacity>
              </View>
            )}
            <ScrollView style={{ maxHeight: screenH * 0.6 }}>
              <View style={styles.moreGrid}>
                {pocket && features.danmaku ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      toggleDanmaku();
                      setMoreVisible(false);
                    }}
                  >
                    <MaterialCommunityIcons
                      name={
                        danmakuOn && danmakuEnabled ? 'comment-off-outline' : 'comment-text-outline'
                      }
                      size={28}
                      color={danmakuOn && danmakuEnabled ? '#fff' : '#9294a0'}
                    />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t(danmakuOn && danmakuEnabled ? '屏蔽弹幕' : '显示弹幕')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && isLive ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      usePlayerStore.getState().toggleEnter();
                      setMoreVisible(false);
                    }}
                  >
                    <MaterialCommunityIcons
                      name="account-arrow-right-outline"
                      size={28}
                      color={hideEnter ? '#9294a0' : '#fff'}
                    />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t(hideEnter ? '显示进场' : '屏蔽进场')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && isLive ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      if (!hideEffects) clearGiftEffectQueue();
                      usePlayerStore.getState().toggleEffects();
                      setMoreVisible(false);
                    }}
                  >
                    <MaterialCommunityIcons
                      name="creation"
                      size={28}
                      color={hideEffects ? '#9294a0' : '#fff'}
                    />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t(hideEffects ? '显示特效' : '屏蔽特效')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && Platform.OS === 'android' ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      Linking.sendIntent('android.settings.CAST_SETTINGS')
                        .catch(() => Linking.sendIntent('android.settings.WIFI_DISPLAY_SETTINGS'))
                        .catch(() => showToast(t('当前设备无法打开系统投屏')));
                    }}
                  >
                    <MaterialCommunityIcons name="cast" size={28} color="#fff" />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>{t('投屏')}</Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && isLive ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      togglePlay();
                    }}
                  >
                    <MaterialCommunityIcons
                      name={playing ? 'pause' : 'play'}
                      size={28}
                      color="#fff"
                    />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t(playing ? '暂停' : '播放')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && (!inline || fullscreen) ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      toggleFullscreen();
                    }}
                  >
                    <MaterialCommunityIcons
                      name={fullscreen ? 'fullscreen-exit' : 'fullscreen'}
                      size={28}
                      color={fullscreen ? palette.tint : '#fff'}
                    />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t(fullscreen ? '退出全屏' : '横屏')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && isLive ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      clearGiftEffectQueue();
                      usePlayerStore.getState().setCleanScreen(true);
                    }}
                  >
                    <MaterialCommunityIcons name="eye-off-outline" size={28} color="#fff" />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>{t('清屏播放')}</Text>
                  </TouchableOpacity>
                ) : null}
                {pocket && features.rate && !isLive && !useWebKernel ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      setRateSheetVisible(true);
                    }}
                  >
                    <MaterialCommunityIcons name="speedometer" size={28} color="#fff" />
                    <Text style={[styles.moreLabel, styles.pocketMoreLabel]}>
                      {t('播放速度')} {rate}x
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.moreItem}
                  onPress={() => {
                    const st = usePlayerStore.getState();
                    st.setRotateDeg((st.rotateDeg + 90) % 360);
                    setMoreVisible(false);
                    showControls();
                  }}
                >
                  <MaterialCommunityIcons
                    name="sync"
                    size={pocket ? 28 : 22}
                    color={pocket ? '#fff' : palette.labelSecondary}
                  />
                  <Text
                    style={[styles.moreLabel, { color: pocket ? '#fff' : palette.labelSecondary }]}
                  >
                    {rotateDeg ? t('旋转 {deg}°', { deg: rotateDeg }) : t('旋转')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreItem}
                  onPress={() => {
                    const st = usePlayerStore.getState();
                    const next =
                      st.mirrorMode === 'none'
                        ? 'horizontal'
                        : st.mirrorMode === 'horizontal'
                          ? 'vertical'
                          : 'none';
                    st.setMirrorMode(next);
                    setMoreVisible(false);
                    showControls();
                  }}
                >
                  <MaterialCommunityIcons
                    name="flip-horizontal"
                    size={pocket ? 28 : 22}
                    color={pocket ? '#fff' : palette.labelSecondary}
                  />
                  <Text
                    style={[styles.moreLabel, { color: pocket ? '#fff' : palette.labelSecondary }]}
                  >
                    {mirrorMode === 'none'
                      ? t('镜像')
                      : mirrorMode === 'horizontal'
                        ? t('水平镜像')
                        : t('垂直镜像')}
                  </Text>
                </TouchableOpacity>
                {moreActions.map((action) => (
                  <TouchableOpacity
                    key={action.key}
                    style={styles.moreItem}
                    onPress={() => {
                      setMoreVisible(false);
                      action.onPress();
                    }}
                  >
                    <MaterialCommunityIcons
                      name={action.icon as any}
                      size={pocket ? 28 : 22}
                      color={
                        action.active ? palette.tint : pocket ? '#fff' : palette.labelSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.moreLabel,
                        {
                          color: action.active
                            ? palette.tint
                            : pocket
                              ? '#fff'
                              : palette.labelSecondary,
                        },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                {features.kernelSwitch && (!isRtmpUrl(source.url) || useWebKernel) ? (
                  <TouchableOpacity
                    style={styles.moreItem}
                    onPress={() => {
                      const s = usePlayerStore.getState();
                      s.setUseWebKernel(!s.useWebKernel);
                      s.clearError();
                      setMoreVisible(false);
                    }}
                  >
                    <MaterialCommunityIcons
                      name="monitor"
                      size={pocket ? 28 : 22}
                      color={pocket ? '#fff' : palette.labelSecondary}
                    />
                    <Text
                      style={[
                        styles.moreLabel,
                        { color: pocket ? '#fff' : palette.labelSecondary },
                      ]}
                    >
                      {useWebKernel ? t('切回原生播放器') : t('切换网页播放器')}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function LoadingHint() {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.loadingWrap} pointerEvents="none">
      <ActivityIndicator size="large" color="#fff" />
      <Text style={styles.loadingText}>
        {slow ? t('加载时间较长，若仍未出画面请点「重试」或切换网页播放器') : t('加载中…')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pocketTop: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pocketIdentity: {
    maxWidth: '50%',
    minWidth: 0,
    flexShrink: 1,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingRight: 8,
    backgroundColor: 'rgba(20,20,24,0.42)',
  },
  pocketAvatar: { flexShrink: 0, width: 32, height: 32, borderRadius: 16, marginRight: 4 },
  pocketAvatarFallback: {
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pocketName: { color: '#fff', fontSize: 12, fontFamily: fontFamily.system, flexShrink: 1 },
  pocketAudience: {
    flexShrink: 0,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(20,20,24,0.42)',
  },
  pocketAudienceText: { color: '#fff', fontSize: 12, fontFamily: fontFamily.system, flexShrink: 0 },
  pocketRank: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', minHeight: 34 },
  pocketRankAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  pocketRankAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.5)',
  },
  pocketRankFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.42)',
  },
  pocketCircle: {
    flexShrink: 0,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.45)',
  },
  pocketClose: { width: 36, height: 36, borderRadius: 18 },
  pocketBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pocketInputWrap: { flex: 1, minWidth: 0 },
  pocketComments: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 25,
    alignItems: 'flex-start',
    gap: 5,
  },
  pocketHistoryList: { height: 160, width: '100%' },
  pocketScrollBottom: {
    position: 'absolute',
    right: 0,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,30,36,0.78)',
    elevation: 4,
  },
  pocketHistoryContent: {
    alignItems: 'flex-start',
    gap: 5,
  },
  pocketComment: {
    maxWidth: '100%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    backgroundColor: 'rgba(18,18,22,0.32)',
  },
  pocketCommentHighlight: { backgroundColor: 'rgba(103,73,187,0.58)' },
  pocketCommentAvatar: { width: 20, height: 20, borderRadius: 10, marginRight: 4 },
  pocketCommentAvatarFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pocketCommentLevel: {
    minHeight: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    marginRight: 4,
    marginTop: 2,
    justifyContent: 'center',
    backgroundColor: 'rgba(205,151,81,0.85)',
  },
  pocketCommentLevelText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    includeFontPadding: false,
  },
  pocketCommentText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fontFamily.system,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  pocketMoreLabel: { color: '#fff', fontSize: 12, marginTop: 8 },
  topWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 24,
    paddingHorizontal: 8,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.34)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
  },
  titleWrap: {
    flex: 1,
    marginHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  titleText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 200,
  },
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 31,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  dockBarrageRow: { marginBottom: 10 },
  progressRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontVariant: ['tabular-nums'],
    marginHorizontal: 8,
    minWidth: 34,
    textAlign: 'center',
  },

  progressTouch: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  progressTrackBg: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  progressThumb: {
    position: 'absolute',
    top: 16.5,
    width: 11,
    height: 11,
    borderRadius: 6,
    marginLeft: -5.5,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
  },
  ctrlHintText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontFamily: fontFamily.system,
    marginLeft: 8,
    flexShrink: 1,
  },
  ctrlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  centerPlayWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  centerPlayBtnSm: { width: 36, height: 36, borderRadius: 18, elevation: 0 },
  seekFlashWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    zIndex: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  seekFlashText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  loadingWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: { color: '#fff', fontSize: 12, fontFamily: fontFamily.system, opacity: 0.85 },
  rateMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  rateSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 30,
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  rateSheetTitle: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    textAlign: 'center',
    marginBottom: 10,
  },
  rateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  rateChip: {
    width: '30%',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  rateChipText: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '700' },
  errorWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '42%',
    zIndex: 40,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 12,
    padding: 14,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fontFamily.system,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorBtn: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: TINT,
  },
  errorBtnText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  morePanel: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    paddingTop: 14,
  },
  moreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  moreTitle: { fontSize: 16, fontFamily: fontFamily.system, fontWeight: '700' },
  moreGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  moreItem: { width: '25%', alignItems: 'center', paddingVertical: 12 },
  moreLabel: { fontSize: 11, marginTop: 5, textAlign: 'center' },
});

export default PlayerChrome;
