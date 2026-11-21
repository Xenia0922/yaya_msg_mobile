import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { GlassSurface } from '../../components/GlassSurface';
import { radii, spacing, usePalette } from '../../theme';
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
            {toolChips.map((item) => (
              <ScalePressable
                key={item.title}
                onPress={() => onPressItem(item)}
                pressedScale={0.94}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={{ minWidth: Math.round(quickCellW * 0.8) }}
              >
                <GlassSurface
                  radius={radii.lg}
                  role="card"
                  frostedOnly
                  style={[
                    styles.chip,
                    styles.toolChip,
                    {
                      backgroundColor: 'transparent',
                      borderColor: palette.innerStroke,
                    },
                  ]}
                >
                  <View style={[styles.chipIcon, { backgroundColor: palette.tintSoft }]}>
                    <MaterialCommunityIcons name={item.icon} color={palette.tint} size={16} />
                  </View>
                  <Text style={[styles.chipText, { color: palette.label }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                </GlassSurface>
              </ScalePressable>
            ))}
          </ScrollView>
        </View>
      </FadeInView>
    </View>
  );
}
