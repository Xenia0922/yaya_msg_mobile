import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { NetworkImage } from '../../components/NetworkImage';
import { Skeleton } from '../../components/Skeleton';
import { GlassSurface } from '../../components/GlassSurface';
import { SquircleView } from '../../components/SquircleView';
import { Button } from '../../components/Button';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { radii, spacing, usePalette } from '../../theme';
import { useI18n } from '../../i18n';
import { styles } from './styles';
import type { LiveCardItem } from './types';

export interface LiveModuleProps {
  lives: LiveCardItem[];
  livesOk: boolean;
  livesError: string;
  bannerCount: number;
  safeBannerIndex: number;
  onRetry: () => void;
  onPressAll: () => void;
  onPressLive: (_item: LiveCardItem) => void;
  onSelectBanner: (_index: number) => void;
  onBannerDragChange?: (_dragging: boolean) => void;
}

function LiveBanner({ item, onPress }: { item: LiveCardItem; onPress: () => void }) {
  const { t } = useI18n();
  const palette = usePalette();
  const [broken, setBroken] = useState(false);
  const retriedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  const handleCoverError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      setBroken(true);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setBroken(false);
      }, 3000);
    } else {
      setBroken(true);
    }
  };
  return (
    <ScalePressable
      style={styles.liveBanner}
      onPress={onPress}
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={item.nickname ? `${item.nickname} ${item.title}` : item.title}
    >
      <SquircleView
        radius={radii.lg}
        style={[
          styles.liveBannerWrap,
          {
            backgroundColor: palette.fill3,
            borderColor: palette.innerStroke,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {!broken && item.cover ? (
          <NetworkImage
            source={{ uri: item.cover }}
            style={styles.liveBannerCover}
            resizeMode="cover"
            fallback={false}

            thumbnail={1080}
            onError={handleCoverError}
          />
        ) : (
          <View style={styles.liveBannerFallback}>
            <MaterialCommunityIcons name="video" color={palette.labelTertiary} size={44} />
          </View>
        )}

        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
          locations={[0, 0.5, 1]}
          style={styles.liveBannerShade}
        />
        <View style={[styles.liveBadge, styles.liveBannerBadge]}>
          <Text style={styles.liveBadgeText}>{t('直播中')}</Text>
        </View>
        <View style={styles.liveBannerInfo}>
          <Text style={styles.liveBannerTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.liveBannerNick} numberOfLines={1}>
            {item.nickname}
          </Text>
        </View>
      </SquircleView>
    </ScalePressable>
  );
}

function AnimatedDots({
  active,
  color,
  idle,
  onPress,
  label,
}: {
  active: boolean;
  color: string;
  idle: string;
  onPress?: () => void;
  label?: string;
}) {
  const w = useRef(new Animated.Value(active ? 16 : 6)).current;
  const c = useRef(new Animated.Value(active ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(w, { toValue: active ? 16 : 6, duration: 220, useNativeDriver: false }).start();

    c.setValue(active ? 1 : 0);
  }, [active, w, c]);
  return (
    <ScalePressable
      style={styles.dotSlot}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      pressedScale={0.85}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Animated.View
        style={{
          height: 6,
          borderRadius: 3,
          width: w,
          backgroundColor: c.interpolate({
            inputRange: [0, 1],
            outputRange: [idle, color],
          }),
        }}
      />
    </ScalePressable>
  );
}

export default function LiveModule({
  lives,
  livesOk,
  livesError,
  bannerCount,
  safeBannerIndex,
  onRetry,
  onPressAll,
  onPressLive,
  onSelectBanner,
  onBannerDragChange,
}: LiveModuleProps) {
  const { width: screenWidth } = useWindowDimensions();
  const bannerW = Math.max(200, Math.round(screenWidth - spacing.md * 2));
  const bannerSkeletonH = Math.round((bannerW * 9) / 16);
  const { t } = useI18n();
  const palette = usePalette();
  const bannerItems = lives.slice(0, bannerCount);
  const pagerRef = useRef<ScrollView | null>(null);
  const draggingRef = useRef(false);
  const prevBannerWRef = useRef(bannerW);
  const prevScrollIdxRef = useRef(safeBannerIndex);

  useEffect(() => {
    if (bannerCount <= 1) return;
    const widthChanged = Math.abs(prevBannerWRef.current - bannerW) > 1;
    const idxChanged = prevScrollIdxRef.current !== safeBannerIndex;
    prevBannerWRef.current = bannerW;
    prevScrollIdxRef.current = safeBannerIndex;
    if (!draggingRef.current && (widthChanged || idxChanged)) {
      pagerRef.current?.scrollTo({
        x: safeBannerIndex * bannerW,
        animated: !widthChanged,
      });
    }
  }, [bannerCount, bannerW, safeBannerIndex]);

  const handleSettle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      draggingRef.current = false;
      onBannerDragChange?.(false);
      if (bannerCount <= 1 || bannerW <= 0) return;
      const offsetX = e.nativeEvent?.contentOffset?.x ?? 0;
      const nextIdx = Math.min(bannerCount - 1, Math.max(0, Math.round(offsetX / bannerW)));
      prevScrollIdxRef.current = nextIdx;
      if (nextIdx !== safeBannerIndex) {
        onSelectBanner(nextIdx);
      }
    },
    [bannerCount, bannerW, onBannerDragChange, onSelectBanner, safeBannerIndex],
  );

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle
        icon="broadcast"
        title={t('成员直播')}
        actionLabel={t('全部')}
        onAction={onPressAll}
      />

      {!livesOk && !livesError ? (
        <Skeleton
          width="100%"
          height={bannerSkeletonH}
          radius={radii.lg}
          style={{ marginTop: 0 }}
        />
      ) : livesError && !livesOk ? (
        <GlassSurface
          radius={20}
          role="card"
          frostedOnly
          style={[
            styles.liveStateCard,
            { backgroundColor: 'transparent', borderColor: palette.innerStroke },
          ]}
        >
          <MaterialCommunityIcons name="wifi-off" size={20} color={palette.labelTertiary} />
          <Text style={[styles.liveStateText, { color: palette.labelSecondary }]} numberOfLines={2}>
            {t('直播列表加载失败')}
          </Text>
          <Button title={t('重试')} variant="tinted" size="sm" onPress={onRetry} />
        </GlassSurface>
      ) : livesOk && lives.length === 0 ? (
        <GlassSurface
          radius={20}
          role="card"
          frostedOnly
          style={[
            styles.liveStateCard,
            { backgroundColor: 'transparent', borderColor: palette.innerStroke },
          ]}
        >
          <MaterialCommunityIcons name="video-off" size={20} color={palette.labelTertiary} />
          <Text style={[styles.liveStateText, { color: palette.labelSecondary }]}>
            {t('此时段暂无成员直播')}
          </Text>
        </GlassSurface>
      ) : livesOk ? (
        <FadeInView delay={0} duration={320}>
          {bannerItems.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              <ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                nestedScrollEnabled
                scrollEnabled={bannerCount > 1}
                scrollEventThrottle={16}
                accessibilityHint={t('左右滑动切换直播')}
                onScrollBeginDrag={() => {
                  draggingRef.current = true;
                  onBannerDragChange?.(true);
                }}
                onScrollEndDrag={(e) => {
                  const vx = Math.abs(e.nativeEvent?.velocity?.x ?? 0);
                  if (vx < 0.08) handleSettle(e);
                }}
                onMomentumScrollEnd={handleSettle}
              >
                {bannerItems.map((live) => (
                  <View key={live.liveId} style={{ width: bannerW }}>
                    <LiveBanner item={live} onPress={() => onPressLive(live)} />
                  </View>
                ))}
              </ScrollView>
              {bannerCount > 1 ? (
                <View style={styles.bannerDots}>
                  {bannerItems.map((live, i) => (
                    <AnimatedDots
                      key={live.liveId}
                      active={i === safeBannerIndex}
                      color={palette.tint}
                      idle={palette.fill3}
                      onPress={() => onSelectBanner(i)}
                      label={`${t('成员直播')} ${i + 1}`}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </FadeInView>
      ) : null}
    </View>
  );
}
