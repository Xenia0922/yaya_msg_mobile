/**
 * ResumeModule · 最近播放（C4-S3）
 *
 * 纯展示：miniPlayer（musicPlayerStore）订阅/歌词逐行计算全部留在 HomeScreen，
 * 这里只接收当前曲目、歌词当前行、播放状态与回调。
 */
import React from 'react';
import { Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { NetworkImage } from '../../components/NetworkImage';
import { GlassCard } from '../../components/GlassCard';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { MarqueeText } from '../../components/MarqueeText';
import { SectionTitle } from '../../components/SectionTitle';
import { usePalette } from '../../theme';
import { typography } from '../../theme/typography';
import { useI18n } from '../../i18n';
import { AVATAR_THUMB_WIDTH } from '../../utils/imageThumb';
import type { PlaybackState, Track } from '../../store/musicPlayerStore';
import { styles } from './styles';

export interface ResumeModuleProps {
  currentTrack: Track | null;
  trackTitle: string;
  trackArtist: string;
  resumeLabel: string;
  lyricLine: string;
  playbackState: PlaybackState;
  onOpenLibrary: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  onStop: () => void;
}

export default function ResumeModule({
  currentTrack,
  trackTitle,
  trackArtist,
  resumeLabel,
  lyricLine,
  playbackState,
  onOpenLibrary,
  onPrev,
  onNext,
  onToggle,
  onStop,
}: ResumeModuleProps) {
  const { t } = useI18n();
  const palette = usePalette();

  if (!currentTrack || !trackTitle) return null;

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle icon="history" title={t('最近播放')} />
      <FadeInView delay={0} duration={320}>
        {/* 音乐 minibar：封面 + 标题 + 当前一句歌词 + 上一首/暂停/下一首，状态与正在播放的音乐同步 */}
        <GlassCard strong padding={12} radius={22}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ScalePressable onPress={onOpenLibrary} pressedScale={0.94} hitSlop={4}>
              <View style={[styles.musicCover, { backgroundColor: palette.tintSoft }]}>
                {currentTrack?.coverUrl || currentTrack?.cover ? (
                  <NetworkImage
                    source={{ uri: (currentTrack.coverUrl || currentTrack.cover || '') as string }}
                    style={styles.musicCover}
                    resizeMode="cover"
                    thumbnail={AVATAR_THUMB_WIDTH}
                  />
                ) : (
                  <MaterialCommunityIcons name="music-note" color={palette.tint} size={22} />
                )}
              </View>
            </ScalePressable>
            <ScalePressable
              onPress={onOpenLibrary}
              pressedScale={0.98}
              style={{ flex: 1, marginHorizontal: 8, minWidth: 0 }}
            >
              <Text
                style={[
                  { fontSize: 16, lineHeight: 21, fontWeight: '600' },
                  { color: palette.label },
                ]}
                numberOfLines={1}
              >
                {trackTitle}
              </Text>
              <Text
                style={[typography.footnote, { color: palette.labelSecondary, marginTop: 2 }]}
                numberOfLines={1}
              >
                {trackArtist || resumeLabel}
              </Text>
            </ScalePressable>
            {/* 控制区：主按钮（播放/暂停）实心高对比，切歌为次级描边，视觉层级分明 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ScalePressable
                onPress={onPrev}
                pressedScale={0.9}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={[styles.miniBtn, { backgroundColor: 'rgba(128,128,128,0.14)' }]}
              >
                <MaterialCommunityIcons name="skip-previous" color={palette.label} size={20} />
              </ScalePressable>
              <ScalePressable
                onPress={onToggle}
                pressedScale={0.9}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={[styles.miniBtn, { backgroundColor: palette.tint }]}
              >
                <MaterialCommunityIcons
                  name={
                    playbackState === 'playing'
                      ? 'pause'
                      : playbackState === 'loading'
                        ? 'dots-horizontal'
                        : 'play'
                  }
                  color={palette.onTint}
                  size={22}
                />
              </ScalePressable>
              <ScalePressable
                onPress={onNext}
                pressedScale={0.9}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={[styles.miniBtn, { backgroundColor: 'rgba(128,128,128,0.14)' }]}
              >
                <MaterialCommunityIcons name="skip-next" color={palette.label} size={20} />
              </ScalePressable>
              {playbackState === 'playing' || playbackState === 'paused' ? (
                <ScalePressable
                  onPress={onStop}
                  pressedScale={0.85}
                  hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  style={{ width: 16, height: 30, alignItems: 'center', justifyContent: 'center' }}
                >
                  <MaterialCommunityIcons name="close" color={palette.labelTertiary} size={15} />
                </ScalePressable>
              ) : null}
            </View>
          </View>
          {/* 歌词独占一行、整卡宽：窄列里跑马灯只能看到 7-9 个字，怎么滚都像被截断 */}
          <ScalePressable onPress={onOpenLibrary} pressedScale={0.99} style={{ marginTop: 6 }}>
            <MarqueeText
              text={lyricLine || t('暂无歌词')}
              style={[typography.footnote, { color: palette.labelSecondary }]}
              containerStyle={{ minHeight: 17 }}
              speed={22}
              pause={1400}
            />
          </ScalePressable>
        </GlassCard>
      </FadeInView>
    </View>
  );
}
