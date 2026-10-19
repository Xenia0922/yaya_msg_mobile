import React from 'react';
import { Image, View, StyleSheet, Text } from 'react-native';

/**
 * 用户身份装饰（官方 UserIconShowView 语义，按 2026-10-19 用户要求精简）：
 * - 成员（isStar/roleId 2-5）：只显示 teamLogo 队标（官方成员不带粉丝徽章）
 * - 普通用户：**只要「账号等级」+「头像框」**，不显示勋章行（badge[] 是勋章图，
 *   头像框是 pfUrl —— 两者语义不能互换；此前把 badge 当框、pfUrl 当勋章都渲染了，实测错位）
 * 官方 level → 图标映射见 android.os.hg.m13906（1-20 用 contributionlist_one…ershi，
 * 21-30 用 level21…level30，>30 封顶 level30）。
 */
export type UserDecor = {
  isStar?: boolean;
  roleId?: number | string;
  teamLogo?: string;
  pfUrl?: string;
  vip?: boolean;
  level?: number | string;
};

/** 相对路径按宿主拼（队标在 source.48.cn）——与 utils/data.normalizeUrl 同步 */
function absUrl(u: string): string {
  const raw = String(u || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://${/^(avatar|mediasource|backstage)\b/i.test(raw.slice(1)) ? 'source.48.cn' : 'source1.48.cn'}${raw}`;
  return raw;
}

/** 官方 1-30 级档位（超过 30 封顶 30）；0/非法不渲染 */
export function levelBadgeNumber(level?: number | string): number {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 30 ? 30 : n;
}

/**
 * 等级标识：tint 描边小胶囊 + 「Lv.N」—— 与官方 levelLogo 同槽位。
 * 不用官方 PNG 图（未随资源提出），文字胶囊风格与 App 一致。
 */
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
      <Text style={{ fontSize: size * 0.85, fontWeight: '800', color: '#ff6f91', lineHeight: size * 1.1 }}>Lv.{n}</Text>
    </View>
  );
}

/** 队标（成员）/ 等级胶囊（粉丝）。尺寸：队标 18 高；等级胶囊按 size 缩放 */
export function UserDecorRow({ decor, size = 14 }: { decor?: UserDecor | null; size?: number }) {
  if (!decor) return null;
  const isMember = !!decor.isStar || [2, 3, 4, 5].includes(Number(decor.roleId));
  const teamLogo = absUrl(String(decor.teamLogo || ''));
  if (isMember) {
    if (!teamLogo) return null;
    return (
      <View style={styles.row}>
        <Image source={{ uri: teamLogo }} style={{ width: size * 1.6, height: size }} resizeMode="contain" />
      </View>
    );
  }
  const n = levelBadgeNumber(decor.level);
  if (!n) return null;
  return (
    <View style={styles.row}>
      <LevelChip level={n} size={size} />
    </View>
  );
}

/**
 * 头像 + 头像框叠加（pfUrl）。头像框是覆盖在头像上的 PNG，
 * 尺寸比头像略大（官方 HeaderView 1.42x），contain 居中。
 */
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
  const frame = absUrl(String(frameUri || ''));
  return (
    <View style={{ width: size, height: size }}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: fallbackBg || 'rgba(128,128,128,0.25)' }]}>
          <Text style={{ color: fallbackColor || '#fff', fontWeight: '900', fontSize: size * 0.38 }}>{fallbackText || '?'}</Text>
        </View>
      )}
      {frame ? (
        <Image
          source={{ uri: frame }}
          style={{
            position: 'absolute',
            width: size * 1.42,
            height: size * 1.42,
            left: (size - size * 1.42) / 2,
            top: (size - size * 1.42) / 2,
          }}
          resizeMode="contain"
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
