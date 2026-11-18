/**
 * PerformancesModule · 公演直播（C4-S3）
 *
 * 纯展示：B站开播检测/轮询/缓存全部留在 HomeScreen，
 * 这里只接收是否成功、房间列表与房间信息，渲染区块。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { NetworkImage } from '../../components/NetworkImage';
import { GlassSurface } from '../../components/GlassSurface';
import { Button } from '../../components/Button';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { usePalette } from '../../theme';
import { makeShadows } from '../../theme/shadows';
import { useI18n } from '../../i18n';
import type { BilibiliLiveRoom } from '../../types';
import { styles } from './styles';

export interface PerformancesModuleProps {
  gongyanOk: boolean;
  gongyanError: string;
  liveRooms: BilibiliLiveRoom[];
  gongyanInfo: Record<string, { title: string; cover: string }>;
  onRetry: () => void;
  onPressAll: () => void;
  onPressRoom: (room: BilibiliLiveRoom) => void;
}

export default function PerformancesModule({
  gongyanOk,
  gongyanError,
  liveRooms,
  gongyanInfo,
  onRetry,
  onPressAll,
  onPressRoom,
}: PerformancesModuleProps) {
  const { t } = useI18n();
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle
        icon="calendar-star"
        title={t('公演直播')}
        actionLabel={t('全部')}
        onAction={onPressAll}
      />
      {!gongyanOk && !gongyanError ? null : gongyanError && !gongyanOk ? (
        <FadeInView delay={0} duration={300}>
          <GlassSurface
            radius={22}
            role="card"
            style={[
              styles.liveStateCard,
              { backgroundColor: 'transparent', borderColor: palette.hairline },
            ]}
          >
            <MaterialCommunityIcons name="wifi-off" size={20} color={palette.labelTertiary} />
            <Text
              style={[styles.liveStateText, { color: palette.labelSecondary }]}
              numberOfLines={2}
            >
              {t('公演直播加载失败')}
            </Text>
            <Button title={t('重试')} variant="tinted" size="sm" onPress={onRetry} />
          </GlassSurface>
        </FadeInView>
      ) : liveRooms.length === 0 ? (
        <FadeInView delay={0} duration={320}>
          <GlassSurface
            radius={22}
            role="card"
            style={[
              styles.liveStateCard,
              { backgroundColor: 'transparent', borderColor: palette.hairline },
            ]}
          >
            <MaterialCommunityIcons name="broadcast-off" size={20} color={palette.labelTertiary} />
            <Text style={[styles.liveStateText, { color: palette.labelSecondary }]}>
              {t('此时段暂无公演直播')}
            </Text>
          </GlassSurface>
        </FadeInView>
      ) : (
        <FadeInView delay={0} duration={320}>
          {liveRooms.map((room) => (
            <FadeInView key={room.roomId} delay={0} duration={160} distance={10}>
              <ScalePressable
                onPress={() => onPressRoom(room)}
                pressedScale={0.97}
                style={{ marginBottom: 8 }}
              >
                {/* ⚠️【性能】列表逐卡不要用 GlassSurface —— 每张卡一个 BlurView，
                    滚动时逐帧重算 RenderEffect 模糊，三星等模糊较慢的机型直接掉帧。
                    项目铁律：列表/网格用实底圆角 + 细描边（surfaceGlassStrong）。 */}
                <View
                  style={[
                    styles.liveRow,
                    shadows.xs,
                    {
                      backgroundColor: palette.surfaceGlassStrong,
                      borderColor: palette.hairline,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={[styles.liveRowThumb, { backgroundColor: palette.tintSoft }]}>
                    {gongyanInfo[room.roomId]?.cover ? (
                      <NetworkImage
                        source={{ uri: gongyanInfo[room.roomId].cover }}
                        style={styles.liveRowThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <MaterialCommunityIcons
                        name="television-classic"
                        color={palette.tint}
                        size={22}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                    <Text style={[styles.liveRowTitle, { color: palette.label }]} numberOfLines={1}>
                      {gongyanInfo[room.roomId]?.title ||
                        room.name ||
                        t('房间号：{id}', { id: room.roomId })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <View style={[styles.gongyanDotWrap, { backgroundColor: palette.success }]}>
                        <View style={[styles.gongyanDot, { backgroundColor: palette.success }]} />
                      </View>
                      <Text
                        style={[
                          styles.liveRowNick,
                          { color: palette.success, marginTop: 0, marginLeft: 5 },
                        ]}
                      >
                        {t('直播中')}
                      </Text>
                      {room.name ? (
                        <Text
                          style={[
                            styles.liveRowNick,
                            { color: palette.labelTertiary, marginTop: 0, marginLeft: 8 },
                          ]}
                          numberOfLines={1}
                        >
                          {room.name}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    color={palette.labelTertiary}
                    size={18}
                  />
                </View>
              </ScalePressable>
            </FadeInView>
          ))}
        </FadeInView>
      )}
    </View>
  );
}
