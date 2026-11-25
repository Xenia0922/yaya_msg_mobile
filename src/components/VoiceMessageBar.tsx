import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { probeMediaDurationSeconds } from '../native/MediaProbe';
import { useVoicePlayerStore } from '../store/voicePlayerStore';
import { usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import {
  buildVoiceWaveform,
  computeSeekSeconds,
  computeVoiceBarWidth,
  formatVoiceTime,
} from '../utils/voiceBar';
import { ScalePressable } from './Motion';

export interface VoiceMessageBarProps {
  url: string;
  duration?: number;
  onTint?: boolean;
  solid?: boolean;
  fullWidth?: boolean;
  onLongPress?: () => void;
  onFallbackPlay?: () => void;
  trailingAction?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function VoiceMessageBar({
  url,
  duration = 0,
  onTint = false,
  solid = false,
  fullWidth = false,
  onLongPress,
  onFallbackPlay,
  trailingAction,
  style,
}: VoiceMessageBarProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const cleanUrl = String(url || '').trim();

  const isCurrent = useVoicePlayerStore((s) => !!cleanUrl && s.url === cleanUrl);
  const isPlaying = useVoicePlayerStore((s) => !!cleanUrl && s.url === cleanUrl && s.playing);
  const isBuffering = useVoicePlayerStore(
    (s) => !!cleanUrl && s.url === cleanUrl && s.playing && s.buffering,
  );
  const hasError = useVoicePlayerStore((s) => !!cleanUrl && s.url === cleanUrl && !!s.error);
  const currentPos = useVoicePlayerStore((s) =>
    !cleanUrl ? 0 : s.url === cleanUrl ? s.position : s.positionsByUrl[cleanUrl] || 0,
  );
  const activeDuration = useVoicePlayerStore((s) =>
    !!cleanUrl && s.url === cleanUrl ? s.duration : 0,
  );
  const rate = useVoicePlayerStore((s) => (!!cleanUrl && s.url === cleanUrl ? s.rate : 1));
  const cachedDuration = useVoicePlayerStore((s) =>
    cleanUrl ? s.durationsByUrl[cleanUrl] || 0 : 0,
  );
  const toggle = useVoicePlayerStore((s) => s.toggle);
  const seek = useVoicePlayerStore((s) => s.seek);
  const cycleRate = useVoicePlayerStore((s) => s.cycleRate);
  const rememberDuration = useVoicePlayerStore((s) => s.rememberDuration);

  const [trackWidth, setTrackWidth] = useState(0);
  const probedRef = useRef('');

  const hintedDuration =
    Number.isFinite(duration) && duration > 0 ? duration : cachedDuration > 0 ? cachedDuration : 0;

  useEffect(() => {
    if (!cleanUrl || hintedDuration > 0 || probedRef.current === cleanUrl) return;
    probedRef.current = cleanUrl;
    let alive = true;
    probeMediaDurationSeconds(cleanUrl)
      .then((sec) => {
        if (!alive || sec <= 0) return;
        rememberDuration(cleanUrl, Math.round(sec));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cleanUrl, hintedDuration, rememberDuration]);

  const effectiveDuration =
    (isCurrent && activeDuration > 0 ? activeDuration : 0) || hintedDuration;
  const showProgressControls = isPlaying || currentPos > 0.15;

  const waveform = useMemo(() => buildVoiceWaveform(cleanUrl, 24), [cleanUrl]);
  const baseWidth = useMemo(() => computeVoiceBarWidth(effectiveDuration), [effectiveDuration]);
  const dynamicWidth = showProgressControls ? Math.min(268, baseWidth + 46) : baseWidth;

  const progressRatio =
    effectiveDuration > 0 ? Math.max(0, Math.min(1, currentPos / effectiveDuration)) : 0;
  const activeBarsFloat = progressRatio * waveform.length;

  const timeLabel = useMemo(() => {
    if (showProgressControls) {
      return effectiveDuration > 0
        ? `${formatVoiceTime(currentPos)}/${formatVoiceTime(effectiveDuration)}`
        : formatVoiceTime(currentPos);
    }
    return effectiveDuration > 0 ? formatVoiceTime(effectiveDuration) : t('语音');
  }, [showProgressControls, currentPos, effectiveDuration, t]);

  const lightFg = onTint || solid;
  const pillBg = solid ? palette.tint : onTint ? 'rgba(255,255,255,0.22)' : palette.tintSoft;
  const pillBorder = solid
    ? 'transparent'
    : onTint
      ? 'rgba(255,255,255,0.3)'
      : palette.name === 'dark'
        ? 'rgba(255,92,152,0.28)'
        : 'rgba(255,77,141,0.18)';
  const btnBg = lightFg ? '#FFFFFF' : palette.tint;
  const btnIconColor = lightFg ? palette.tint : palette.onTint;
  const barColor = lightFg ? '#FFFFFF' : palette.tint;
  const timeColor = lightFg ? '#FFFFFF' : isPlaying ? palette.tint : palette.labelSecondary;
  const rateBg = solid
    ? 'rgba(255,255,255,0.24)'
    : onTint
      ? 'rgba(255,255,255,0.28)'
      : palette.surfaceGlassStrong;
  const rateTextColor = lightFg ? '#FFFFFF' : palette.tint;

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - trackWidth) > 1) setTrackWidth(w);
  };

  const handleTrackPress = (e: GestureResponderEvent) => {
    if (!cleanUrl || effectiveDuration <= 0 || trackWidth <= 0) {
      if (cleanUrl) toggle(cleanUrl, effectiveDuration);
      return;
    }
    const targetSec = computeSeekSeconds(e.nativeEvent.locationX, trackWidth, effectiveDuration);
    seek(cleanUrl, targetSec, effectiveDuration);
  };

  const barNode = (
    <Pressable
      onLongPress={onLongPress}
      onPress={() => {
        if (cleanUrl) toggle(cleanUrl, effectiveDuration);
      }}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? t('暂停') : t('语音')}
      style={[
        styles.pill,
        fullWidth ? styles.pillFull : { width: dynamicWidth },
        {
          backgroundColor: pillBg,
          borderColor: pillBorder,
        },
        !trailingAction ? style : null,
      ]}
    >
      <ScalePressable
        pressedScale={0.9}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
        onPress={() => {
          if (cleanUrl) toggle(cleanUrl, effectiveDuration);
        }}
        style={[styles.playBtn, { backgroundColor: btnBg }]}
      >
        {isBuffering ? (
          <ActivityIndicator size="small" color={btnIconColor} />
        ) : (
          <MaterialCommunityIcons
            name={hasError ? 'refresh' : isPlaying ? 'pause' : 'play'}
            size={16}
            color={btnIconColor}
            style={!isPlaying && !hasError ? styles.playIconOffset : undefined}
          />
        )}
      </ScalePressable>

      <Pressable
        onLayout={handleTrackLayout}
        onPress={handleTrackPress}
        onLongPress={onLongPress}
        hitSlop={{ top: 6, bottom: 6 }}
        style={styles.waveTrack}
      >
        {waveform.map((normH, idx) => {
          const isActiveBar = currentPos > 0.05 && idx <= activeBarsFloat;
          const opacity = currentPos > 0.05 ? (isActiveBar ? 1 : 0.28) : 0.45;
          const barHeight = Math.round(4 + normH * 17);
          return (
            <View
              key={idx}
              style={[
                styles.waveBar,
                {
                  height: barHeight,
                  backgroundColor: barColor,
                  opacity,
                },
              ]}
            />
          );
        })}
      </Pressable>

      <Text
        style={[styles.timeText, { color: timeColor }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {timeLabel}
      </Text>

      {showProgressControls && !hasError ? (
        <ScalePressable
          pressedScale={0.92}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          onPress={cycleRate}
          style={[
            styles.ratePill,
            {
              backgroundColor: rateBg,
              borderColor: lightFg ? 'rgba(255,255,255,0.22)' : palette.innerStroke,
            },
          ]}
        >
          <Text style={[styles.rateText, { color: rateTextColor }]} allowFontScaling={false}>
            {rate}x
          </Text>
        </ScalePressable>
      ) : null}

      {hasError && onFallbackPlay ? (
        <ScalePressable
          pressedScale={0.92}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          onPress={onFallbackPlay}
          accessibilityLabel={t('切回原生播放器')}
          style={[
            styles.fallbackBtn,
            {
              backgroundColor: rateBg,
              borderColor: lightFg ? 'rgba(255,255,255,0.22)' : palette.innerStroke,
            },
          ]}
        >
          <MaterialCommunityIcons name="swap-horizontal" size={14} color={rateTextColor} />
        </ScalePressable>
      ) : null}
    </Pressable>
  );

  if (!trailingAction) return barNode;

  return (
    <View style={[styles.rowWrap, style]}>
      <View style={styles.rowFlex}>{barNode}</View>
      {trailingAction}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowFlex: {
    flex: 1,
    minWidth: 0,
  },
  pill: {
    height: 44,
    maxWidth: '100%',
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillFull: {
    width: '100%',
  },
  playBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playIconOffset: {
    marginLeft: 1.5,
  },
  waveTrack: {
    flex: 1,
    minWidth: 52,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1.5,
  },
  waveBar: {
    flex: 1,
    maxWidth: 3.5,
    borderRadius: 2,
  },
  timeText: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    flexShrink: 0,
    paddingRight: 2,
  },
  ratePill: {
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rateText: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  fallbackBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
