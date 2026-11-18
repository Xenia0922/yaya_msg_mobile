/**
 * LiveModule · 成员直播（C4-S3）
 *
 * 纯展示：数据（lives/livesOk/livesError）与轮询/SWR 状态留在 HomeScreen，
 * banner 轮播动画值（fadeAnim/slideAnim）与下标由屏内驱动，本组件只渲染。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { NetworkImage } from '../../components/NetworkImage';
import { Skeleton } from '../../components/Skeleton';
import { GlassSurface } from '../../components/GlassSurface';
import { Button } from '../../components/Button';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { usePalette } from '../../theme';
import { useI18n } from '../../i18n';
import { styles } from './styles';
import type { LiveCardItem } from './types';

export interface LiveModuleProps {
  lives: LiveCardItem[];
  livesOk: boolean;
  livesError: string;
  bannerCount: number;
  safeBannerIndex: number;
  fadeAnim: Animated.Value;
  slideAnim: Animated.Value;
  onRetry: () => void;
  onPressAll: () => void;
  onPressLive: (_item: LiveCardItem) => void;
  onSelectBanner: (_index: number) => void;
}

/** 首页全宽沉浸直播 banner（16:9）：渐变 + 白字上浮 + 直播中红标 */
function LiveBanner({ item, onPress }: { item: LiveCardItem; onPress: () => void }) {
  const { t } = useI18n();
  const palette = usePalette();
  const [broken, setBroken] = useState(false);
  const retriedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 卸载清理重试定时器：否则 3s 后对已卸载组件 setState（RN 会告警，且可能误改新页面状态）
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );
  // B3 修复：封面失败 3s 后自动重试一次（封面 URL 偶发 403/超时），再次失败才保持兜底
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
      <View
        style={[
          styles.liveBannerWrap,
          {
            backgroundColor: palette.fill3,
            borderColor: palette.hairline,
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
            // 16:9 全宽横幅：显示约 1080×609px（480dpi），请求「装进 1080 盒子」即可
            // —— 服务端等比 contain，3:4 竖图会回 ~810×1080，不放大也不损失清晰度，
            // 体积却从原图 ~780KB 降到约 1/8（此前不传 thumbnail = 每张都下原图）
            thumbnail={1080}
            onError={handleCoverError}
          />
        ) : (
          <View style={styles.liveBannerFallback}>
            <MaterialCommunityIcons name="video" color={palette.labelTertiary} size={44} />
          </View>
        )}
        {/* 底部平滑渐变（顶部透明 → 底部 0.68 黑），替代多层色阶遮罩；0.68 保证浅色封面下白字可读 */}
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
      </View>
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
    // 颜色不逐帧动画（JS driver 开销），直接切换；宽度脉冲已提供动效反馈
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
  fadeAnim,
  slideAnim,
  onRetry,
  onPressAll,
  onPressLive,
  onSelectBanner,
}: LiveModuleProps) {
  const { width: screenWidth } = useWindowDimensions();
  const bannerSkeletonH = Math.round(((screenWidth - 32) * 9) / 16);
  const { t } = useI18n();
  const palette = usePalette();
  const banner = lives[safeBannerIndex];
  // 横向滑动切 banner；只在明显横向位移时接管，避免和页面纵向滚动冲突。
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, gesture) => {
          if (bannerCount <= 1) return;
          if (Math.abs(gesture.dx) < 40 && Math.abs(gesture.vx) < 0.35) return;
          const step = gesture.dx < 0 ? 1 : -1;
          onSelectBanner((safeBannerIndex + step + bannerCount) % bannerCount);
        },
      }),
    [bannerCount, onSelectBanner, safeBannerIndex],
  );

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle
        icon="broadcast"
        title={t('成员直播')}
        actionLabel={t('全部')}
        onAction={onPressAll}
      />

      {/* 加载中渲染骨架（此前是 null → 首屏该区块只有标题、下方空白，弱网下像坏了） */}
      {!livesOk && !livesError ? (
        <Skeleton width="100%" height={bannerSkeletonH} radius={22} style={{ marginTop: 0 }} />
      ) : livesError && !livesOk ? (
        <GlassSurface
          radius={22}
          role="card"
          style={[
            styles.liveStateCard,
            { backgroundColor: 'transparent', borderColor: palette.hairline },
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
          radius={22}
          role="card"
          style={[
            styles.liveStateCard,
            { backgroundColor: 'transparent', borderColor: palette.hairline },
          ]}
        >
          <MaterialCommunityIcons name="video-off" size={20} color={palette.labelTertiary} />
          <Text style={[styles.liveStateText, { color: palette.labelSecondary }]}>
            {t('此时段暂无成员直播')}
          </Text>
        </GlassSurface>
      ) : livesOk ? (
        <FadeInView delay={0} duration={320}>
          {banner ? (
            <View style={{ marginBottom: 12 }}>
              {/* crossfade + 位移动画包裹 banner；横向手势切上/下一条 */}
              <Animated.View
                {...panResponder.panHandlers}
                style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}
                accessibilityHint={t('左右滑动切换直播')}
              >
                <LiveBanner key={banner.liveId} item={banner} onPress={() => onPressLive(banner)} />
              </Animated.View>
              {bannerCount > 1 ? (
                <View style={styles.bannerDots}>
                  {lives.slice(0, bannerCount).map((live, i) => (
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
