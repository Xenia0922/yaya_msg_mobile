/**
 * ToolsModule · 工具 chips（C4-S3）
 *
 * 纯展示：单行横向滚动 chips；是否显示由 HomeScreen 的模块隐藏配置决定。
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { spacing, usePalette } from '../../theme';
import { useI18n } from '../../i18n';
import { styles } from './styles';
import type { NavItem } from './types';

export interface ToolsModuleProps {
  toolChips: NavItem[];
  quickCellW: number;
  onPressItem: (item: NavItem) => void;
}

export default function ToolsModule({ toolChips, quickCellW, onPressItem }: ToolsModuleProps) {
  const { t } = useI18n();
  const palette = usePalette();

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle icon="tools" title={t('工具')} />
      <FadeInView delay={0} duration={320}>
        <View style={{ position: 'relative' }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolChipsContent}
            style={{ marginHorizontal: -spacing.md }}
          >
            {/* ⚠️ 工具 chip 不能用快捷入口的固定格宽（quickCellW）：
              360dp 屏 quickCellW=76，扣掉图标 28 + gap 4 + 上下左右 padding 8 只剩 36dp，
              而 12px 中文三字正好 36dp —— 零余量，实测「鸡腿榜 / 数据库」会被 ellipsize 成「鸡腿…」。
              宽度改为内容自适应 + 最小宽度，横排本来就可滚动，宽一点不影响布局。 */}
            {toolChips.map((item) => (
              <ScalePressable
                key={item.title}
                onPress={() => onPressItem(item)}
                pressedScale={0.94}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={{ minWidth: Math.round(quickCellW * 0.8) }}
              >
                <View
                  style={[
                    styles.chip,
                    styles.toolChip,
                    {
                      backgroundColor:
                        palette.name === 'dark' ? 'rgba(28,28,34,0.68)' : 'rgba(255,255,255,0.58)',
                      borderColor:
                        palette.name === 'dark'
                          ? 'rgba(255,255,255,0.10)'
                          : 'rgba(255,255,255,0.66)',
                    },
                  ]}
                >
                  <View style={[styles.chipIcon, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name={item.icon} color={palette.tint} size={16} />
                  </View>
                  <Text style={[styles.chipText, { color: palette.label }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              </ScalePressable>
            ))}
          </ScrollView>
          <LinearGradient
            pointerEvents="none"
            colors={
              palette.name === 'dark'
                ? ['rgba(11,11,15,0)', 'rgba(11,11,15,0.88)']
                : ['rgba(236,237,241,0)', 'rgba(236,237,241,0.9)']
            }
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 }}
          />
        </View>
      </FadeInView>
    </View>
  );
}
