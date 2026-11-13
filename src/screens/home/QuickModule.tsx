/**
 * QuickModule · 快捷入口（C4-S3）
 *
 * 纯展示：4 格胶囊；私信未读红点数值由 HomeScreen 传入。
 */
import React from 'react';
import { Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { FadeInView, ScalePressable } from '../../components/Motion';
import { SectionTitle } from '../../components/SectionTitle';
import { usePalette } from '../../theme';
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

export default function QuickModule({ quick, quickCellW, pmUnread, showPmBadge, onPressItem }: QuickModuleProps) {
  const { t } = useI18n();
  const palette = usePalette();

  return (
    <View style={styles.sectionOuter}>
      <SectionTitle icon="view-grid-outline" title={t('快捷入口')} />
      <View style={styles.quickRow}>
        {quick.map((item) => (
          <FadeInView key={item.title} delay={0} duration={160} distance={8} style={[styles.quickCell, { width: quickCellW }]}>
            <ScalePressable
              onPress={() => onPressItem(item)}
              pressedScale={0.94}
              style={styles.quickCellInner}
            >
              {/* 半透明底色让背景透出，避免为每个入口重复模糊。 */}
              <View
                style={[styles.chip, { backgroundColor: palette.name === 'dark' ? 'rgba(28,28,34,0.68)' : 'rgba(255,255,255,0.58)', borderColor: palette.name === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.66)' }]}
              >
                <View style={[styles.chipIcon, { backgroundColor: palette.tintSoft }]}>
                  <MaterialCommunityIcons name={item.icon} color={palette.tint} size={16} />
                </View>
                <Text style={[styles.chipText, { color: palette.label }]} numberOfLines={1}>{item.title}</Text>
                {/* 私信未读红点角标 */}
                {item.route === 'PrivateMessagesScreen' && pmUnread > 0 && showPmBadge ? (
                  <View style={{
                    position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9,
                    backgroundColor: palette.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
                  }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>{pmUnread > 99 ? '99+' : String(pmUnread)}</Text>
                  </View>
                ) : null}
              </View>
            </ScalePressable>
          </FadeInView>
        ))}
      </View>
    </View>
  );
}
