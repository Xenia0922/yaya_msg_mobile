import React, { useEffect, useId, useLayoutEffect, useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { fontFamily, usePalette } from '../theme';
import { removeTopDockEntry, setTopDockEntry } from './DockPortal';
import { GlassSurface } from './GlassSurface';
import { ScalePressable } from './Motion';

export const FLOATING_BAR_HEIGHT = 44;

export function getFloatingHeaderOffset(insetTop: number): number {
  return insetTop + 62;
}

interface FloatingTabHeaderProps {
  left?: React.ReactNode;

  onLeftPress?: () => void;
  leftAccessibilityLabel?: string;

  leftIsland?: React.ReactNode;

  right?: React.ReactNode;
  frostedOnly?: boolean;
  hidden?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const FloatingTabHeader = React.memo(function FloatingTabHeader({
  left,
  onLeftPress,
  leftAccessibilityLabel,
  leftIsland,
  right,
  frostedOnly = false,
  hidden = false,
  style,
}: FloatingTabHeaderProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const portalId = useId();
  const useFrosted = frostedOnly || !isFocused;
  const isDark = palette.name === 'dark';

  const scrimColors: [string, string, string] = isDark
    ? ['rgba(12,12,16,0.92)', 'rgba(12,12,16,0.55)', 'rgba(12,12,16,0)']
    : ['rgba(242,243,248,0.92)', 'rgba(242,243,248,0.55)', 'rgba(242,243,248,0)'];

  const visible = isFocused && !hidden;

  const headerNode = visible ? (
    <View pointerEvents="box-none" style={[styles.overlay, { height: insets.top + 68 }, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={scrimColors}
        locations={[0, 0.58, 1]}
        style={[styles.scrim, { height: insets.top + 18 }]}
      />
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + 8 }]}>
        {leftIsland ? (
          <View style={styles.islandShadow}>{leftIsland}</View>
        ) : left ? (
          onLeftPress ? (
            <ScalePressable
              onPress={onLeftPress}
              pressedScale={0.96}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={leftAccessibilityLabel}
              style={[styles.leftPressWrap, styles.islandShadow]}
            >
              <GlassSurface
                role="bar"
                radius={FLOATING_BAR_HEIGHT / 2}
                frostedOnly={useFrosted}
                style={styles.leftGlass}
              >
                {left}
              </GlassSurface>
            </ScalePressable>
          ) : (
            <GlassSurface
              role="bar"
              radius={FLOATING_BAR_HEIGHT / 2}
              frostedOnly={useFrosted}
              style={[styles.leftGlass, styles.islandShadow]}
            >
              {left}
            </GlassSurface>
          )
        ) : (
          <View />
        )}

        {right ? (
          <GlassSurface
            role="bar"
            radius={FLOATING_BAR_HEIGHT / 2}
            frostedOnly={useFrosted}
            style={[styles.rightGlass, styles.islandShadow]}
          >
            {right}
          </GlassSurface>
        ) : null}
      </View>
    </View>
  ) : null;

  useLayoutEffect(() => {
    if (visible && headerNode) {
      setTopDockEntry(portalId, headerNode);
    } else {
      removeTopDockEntry(portalId);
    }
  });

  useLayoutEffect(() => () => removeTopDockEntry(portalId), [portalId]);

  return null;
});

interface FloatingHeaderActionProps {
  icon: string;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;

  badge?: number | boolean;
  iconColor?: string;

  avatarUri?: string;
}

export const FloatingHeaderAction = React.memo(function FloatingHeaderAction({
  icon,
  onPress,
  accessibilityLabel,
  active = false,
  badge,
  iconColor,
  avatarUri,
}: FloatingHeaderActionProps) {
  const palette = usePalette();
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUri]);
  const showNumber = typeof badge === 'number' && badge > 0;
  const showDot = badge === true;
  const showAvatar = !!avatarUri && !avatarFailed;

  return (
    <ScalePressable
      onPress={onPress}
      pressedScale={0.9}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={[
        styles.actionBtn,
        {
          backgroundColor: active
            ? palette.tint
            : palette.name === 'light'
              ? 'rgba(255,255,255,0.72)'
              : 'rgba(255,255,255,0.12)',
        },
      ]}
    >
      {showAvatar ? (
        <Image
          source={{ uri: avatarUri }}
          style={[styles.actionAvatar, { borderColor: active ? palette.onTint : palette.tint }]}
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <MaterialCommunityIcons
          name={icon}
          size={19}
          color={active ? palette.onTint : (iconColor ?? palette.label)}
        />
      )}
      {showNumber ? (
        <View style={[styles.badgePill, { backgroundColor: palette.danger }]}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : String(badge)}</Text>
        </View>
      ) : showDot ? (
        <View
          style={[
            styles.badgeDot,
            { backgroundColor: palette.tint, borderColor: palette.surfaceElevated },
          ]}
        />
      ) : null}
    </ScalePressable>
  );
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 10,
  },
  islandShadow: {
    borderRadius: FLOATING_BAR_HEIGHT / 2,
    borderCurve: 'continuous',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: null,
      default: null,
    }),
  },
  leftPressWrap: {
    flexShrink: 1,
    maxWidth: '72%',
  },
  leftGlass: {
    height: FLOATING_BAR_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  rightGlass: {
    height: FLOATING_BAR_HEIGHT,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  badgeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  badgePill: {
    position: 'absolute',
    top: -1,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: fontFamily.system,
    fontWeight: '800',
    includeFontPadding: false,
  },
});
