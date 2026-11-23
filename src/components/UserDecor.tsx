import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { NetworkImage } from './NetworkImage';
import { AVATAR_THUMB_WIDTH, normalizeImageHost } from '../utils/imageThumb';

export type UserDecor = {
  isStar?: boolean;
  roleId?: number | string;
  teamLogo?: string;
  pfUrl?: string;
  vip?: boolean;
  level?: number | string;
};

export function absDecorUrl(u: string): string {
  const raw = String(u || '')
    .trim()
    .replace(/\\\//g, '/');
  if (!raw) return '';
  if (raw.startsWith('//')) return normalizeImageHost(`https:${raw}`);
  if (raw.startsWith('/')) {
    return normalizeImageHost(
      `https://${/^(avatar|mediasource|backstage)\b/i.test(raw.slice(1)) ? 'source.48.cn' : 'source1.48.cn'}${raw}`,
    );
  }
  return normalizeImageHost(raw);
}

export function levelBadgeNumber(level?: number | string): number {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 30 ? 30 : n;
}

function LevelChip({ level, size }: { level?: number | string; size: number }) {
  const n = levelBadgeNumber(level);
  if (!n) return null;
  return (
    <View
      style={{
        height: size * 1.35,
        paddingHorizontal: size * 0.5,
        borderRadius: size * 0.75,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,111,145,0.55)',
        backgroundColor: 'rgba(255,111,145,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: size * 0.85,
          fontWeight: '800',
          color: '#ff6f91',
          lineHeight: size * 1.1,
        }}
      >
        Lv.{n}
      </Text>
    </View>
  );
}

export function TeamLogoImage({
  uri,
  size,
  widthRatio = 1.6,
  fallback = null,
}: {
  uri?: string;
  size: number;
  widthRatio?: number;
  fallback?: React.ReactNode;
}) {
  const resolved = absDecorUrl(String(uri || ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);
  if (!resolved || failed) return <>{fallback}</>;
  return (
    <NetworkImage
      source={{ uri: resolved }}
      style={{ width: size * widthRatio, height: size }}
      resizeMode="contain"
      fallback={false}
      onError={() => setFailed(true)}
    />
  );
}

export function UserDecorRow({ decor, size = 14 }: { decor?: UserDecor | null; size?: number }) {
  if (!decor) return null;
  const isMember = !!decor.isStar || [2, 3, 4, 5].includes(Number(decor.roleId));
  const teamLogo = absDecorUrl(String(decor.teamLogo || ''));

  if (teamLogo) {
    return (
      <View style={styles.row}>
        <TeamLogoImage uri={teamLogo} size={size} />
      </View>
    );
  }
  if (isMember) return null;
  const n = levelBadgeNumber(decor.level);
  if (!n) return null;
  return (
    <View style={styles.row}>
      <LevelChip level={n} size={size} />
    </View>
  );
}

export function AvatarWithFrame({
  avatarUri,
  frameUri,
  size = 40,
  fallbackText,
  fallbackColor,
  fallbackBg,
}: {
  avatarUri?: string;
  frameUri?: string;
  size?: number;
  fallbackText?: string;
  fallbackColor?: string;
  fallbackBg?: string;
}) {
  const frame = absDecorUrl(String(frameUri || ''));
  const resolvedAvatar = absDecorUrl(String(avatarUri || ''));
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [resolvedAvatar]);
  return (
    <View style={{ width: size, height: size }}>
      {resolvedAvatar && !avatarFailed ? (
        <NetworkImage
          source={{ uri: resolvedAvatar }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          thumbnail={AVATAR_THUMB_WIDTH}
          fallback={false}
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: fallbackBg || 'rgba(128,128,128,0.25)',
            },
          ]}
        >
          <Text
            style={{ color: fallbackColor || '#fff', fontWeight: '900', fontSize: size * 0.38 }}
          >
            {fallbackText || '?'}
          </Text>
        </View>
      )}
      {frame ? (
        <NetworkImage
          source={{ uri: frame }}
          style={{
            position: 'absolute',
            width: size * 1.42,
            height: size * 1.42,
            left: (size - size * 1.42) / 2,
            top: (size - size * 1.42) / 2,
          }}
          resizeMode="contain"
          fallback={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
});

export default UserDecorRow;
