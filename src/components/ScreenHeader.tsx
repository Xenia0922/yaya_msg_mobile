import React, { useCallback } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../i18n';
import { usePalette } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
  /** 图片背景页（如直播间）传 true：返回键用玻璃胶囊，标题加轻阴影保证可读 */
  overlay?: boolean;
}

/**
 * 新式大标题页头（iOS 26 风格，主题化）
 *  - 左对齐大标题 + 玻璃圆形返回键，去霓虹发光
 *  - 三栏布局保留：左(返回) | 中(标题占满) | 右(操作位)
 *  - 兼容旧 props（title/onBack/right/style），全站调用点无需改动
 */
export default function ScreenHeader({ title, onBack, right, style, overlay }: Props) {
  const navigation = useNavigation();
  const { t } = useI18n();
  const palette = usePalette();
  const goBack = useCallback(onBack || (() => navigation.goBack()), [onBack, navigation]);
  const topPad = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 10;

  return (
    <View style={[styles.header, { paddingTop: topPad }, style]}>
      <View style={styles.sideLeft}>
        <TouchableOpacity
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('返回')}
          style={[
            styles.backBtn,
            {
              backgroundColor: overlay ? palette.surfaceGlassStrong : palette.fill2,
              borderColor: overlay ? palette.innerStroke : 'transparent',
            },
          ]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons name="chevron-left" color={palette.label} size={26} />
        </TouchableOpacity>
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.title,
          {
            color: palette.label,
            textShadowColor: overlay ? 'rgba(0,0,0,0.30)' : 'transparent',
          },
        ]}
      >
        {title}
      </Text>
      <View style={styles.sideRight}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    marginBottom: 2,
  },
  sideLeft: { width: 56, alignItems: 'flex-start', justifyContent: 'center' },
  sideRight: { width: 56, alignItems: 'flex-end', justifyContent: 'center' },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    textAlign: 'left',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.3,
    paddingHorizontal: 6,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
