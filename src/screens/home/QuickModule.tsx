import React from 'react';
import { Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { GlassSurface } from '../../components/GlassSurface';
import { usePalette, fontFamily, radii } from '../../theme';
import { useI18n } from '../../i18n';
import { styles } from './styles';
import type { NavItem } from './types';

export interface QuickModuleProps {
  quick: NavItem[];
  quickCellW: number;
  pmUnread: number;
  showPmBadge: boolean;
  onPressItem: (item: NavItem) => void;
}

export default function QuickModule({
  quick,
  quickCellW,
  pmUnread,
  showPmBadge,
  onPressItem,
}: QuickModuleProps) {
  const { t } = useI18n();
  const palette = usePalette();

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle icon="view-grid-outline" title={t('快捷入口')} />
      <View style={styles.quickRow}>
        {quick.map((item) => (
          <FadeInView
            key={item.title}
            delay={0}
            duration={160}
            distance={8}
            style={[styles.quickCell, { width: quickCellW }]}
          >
            <ScalePressable
              onPress={() => onPressItem(item)}
              pressedScale={0.94}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={styles.quickCellInner}
            >
              <GlassSurface
                radius={radii.lg}
                role="card"
                frostedOnly
                style={[
                  styles.chip,
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

              {item.route === 'PrivateMessagesScreen' && pmUnread > 0 && showPmBadge ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 17,
                    height: 17,
                    borderRadius: 9,
                    backgroundColor: palette.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 10,
                      fontFamily: fontFamily.system,
                      fontWeight: '800',
                    }}
                  >
                    {pmUnread > 99 ? '99+' : String(pmUnread)}
                  </Text>
                </View>
              ) : null}
            </ScalePressable>
          </FadeInView>
        ))}
      </View>
    </View>
  );
}
