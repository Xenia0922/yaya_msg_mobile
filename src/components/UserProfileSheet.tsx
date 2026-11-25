import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetworkImage } from './NetworkImage';
import { ScalePressable } from './Motion';
import { Palettes, usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import { useSettingsStore, useUiStore } from '../store';
import { mutateFollowedIdShared } from '../services/pocketSharedData';
import { normalizeUrl, pickText, errorMessage } from '../utils/data';
import pocketApi from '../api/pocket48';

export interface UserProfileTarget {
  nick?: string;

  avatar?: string;

  userId?: string;

  memberId?: string;

  member?: any;

  missingIdMessage?: string;
}

export interface UserProfileSheetProps {
  visible: boolean;
  target: UserProfileTarget | null;
  onClose: () => void;

  onOpenChat?: (target: { id: string; name: string }) => void;

  onOpenMemberPage?: (target: {
    memberId: string;
    name: string;
    avatar: string;
    member?: any;
  }) => void;

  onFollowChanged?: (id: string, following: boolean) => void;
  appearance?: 'auto' | 'dark';
}

export function userCardFromUserRes(res: any) {
  const content = res?.content || res?.data?.content || res?.data || res || {};
  const userInfo = content?.userInfo || content?.user || content?.profile || content || {};
  const base = userInfo?.baseUserInfo || userInfo?.baseInfo || userInfo || {};
  const star = content?.starInfo || content?.memberInfo || userInfo?.starInfo || {};
  const objs = [base, userInfo, star, content];
  const pick = (keys: string[]) => {
    for (const obj of objs) {
      const value = pickText(obj, keys);
      if (value) return value;
    }
    return '';
  };
  const relationValue = String(
    pick([
      'relation',
      'relationType',
      'followStatus',
      'friendStatus',
      'isFollow',
      'followed',
      'isFriend',
      'relationship',
    ]) || '',
  )
    .trim()
    .toLowerCase();
  const mutual = ['mutual', 'both', 'friend', 'friends', '2', '3'].includes(relationValue);
  const following = mutual || ['true', 'followed', 'following', '1'].includes(relationValue);
  return {
    name: pick([
      'nickName',
      'nickname',
      'userName',
      'name',
      'starName',
      'realNickName',
      'baseUserInfo.nickName',
    ]),
    avatar: normalizeUrl(
      pick(['avatar', 'avatarUrl', 'faceImage', 'headImg', 'headUrl', 'starAvatar']),
    ),
    level: pick(['level', 'userLevel', 'grade', 'vipLevel', 'userLevelName']),
    signature: pick(['signature', 'sign', 'intro', 'description', 'userSignature']),
    team: pick(['starTeamName', 'teamName', 'team']),
    period: pick(['periodName', 'period']),
    isStar:
      !!(star && (star.starName || star.starId)) || base?.isStar === true || base?.star === true,
    following,
    mutual,
  };
}

interface CardState {
  id: string;
  name: string;
  avatar: string;
  loading: boolean;
  error: string;
  following: boolean;
  mutual: boolean;
  followBusy: boolean;
  isMember: boolean;
  detail: {
    name: string;
    avatar: string;
    level: string;
    signature: string;
    team: string;
    period: string;
    isStar: boolean;
  };
}

const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const profileCache = new Map<string, { detail: any; at: number }>();

function readProfileCache(id: string) {
  const hit = profileCache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > PROFILE_CACHE_TTL) {
    profileCache.delete(id);
    return null;
  }
  return hit.detail;
}

function writeProfileCache(id: string, detail: any) {
  if (!id) return;
  profileCache.set(id, { detail, at: Date.now() });
}

export function UserProfileSheet({
  visible,
  target,
  onClose,
  onOpenChat,
  onOpenMemberPage,
  onFollowChanged,
  appearance = 'auto',
}: UserProfileSheetProps) {
  const palette = usePalette();
  const p = appearance === 'dark' ? Palettes.dark : palette;
  const sheetBg = appearance === 'dark' ? 'rgba(24,24,30,0.96)' : palette.surfaceElevated;
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const [card, setCard] = useState<CardState | null>(null);

  const seqRef = useRef(0);

  const load = useCallback(
    (tg: UserProfileTarget) => {
      const m = tg.member;

      const candidates = Array.from(
        new Set(
          [tg.userId, m ? String(m.userId || '') : '', m?.id, tg.memberId]
            .map((v) => String(v ?? '').trim())
            .filter((v) => /^\d+$/.test(v) && v !== '0'),
        ),
      );
      const cardId = candidates[0] || String(tg.memberId || tg.userId || '').trim();
      const seq = ++seqRef.current;
      const apply = (patch: Partial<CardState>) =>
        setCard((c) => (c && seqRef.current === seq ? { ...c, ...patch } : c));

      setCard({
        id: cardId,
        name: tg.nick || m?.ownerName || '',
        avatar: tg.avatar || m?.avatar || '',
        loading: candidates.length > 0,
        error: '',
        following: false,
        mutual: false,
        followBusy: false,
        isMember: !!m,
        detail: {
          name: '',
          avatar: '',
          level: '',
          signature: '',
          team: m ? String(m.groupName || m.team || '') : '',
          period: '',
          isStar: !!m,
        },
      });

      if (!candidates.length) {
        apply({ loading: false, error: tg.missingIdMessage || t('该用户没有可加载的口袋48资料') });
        return;
      }

      const cachedHit = candidates
        .map((id) => ({ id, data: readProfileCache(id) }))
        .find((x) => x.data);
      if (cachedHit?.data) {
        const cached = cachedHit.data;
        const cachedId = cachedHit.id;
        setCard((c) =>
          c && seqRef.current === seq
            ? {
                ...c,
                id: cachedId,
                loading: false,
                error: '',
                following: !!cached.following,
                mutual: !!cached.mutual,
                detail: { ...c.detail, ...cached },
              }
            : c,
        );
        return;
      }

      void (async () => {
        for (const id of candidates) {
          try {
            const res = await pocketApi.getUserProfile(id);
            if (seqRef.current !== seq) return;
            const detail = userCardFromUserRes(res);
            writeProfileCache(id, detail);
            setCard((c) =>
              c && seqRef.current === seq
                ? {
                    ...c,
                    id,
                    loading: false,
                    error: '',
                    following: detail.following,
                    mutual: detail.mutual,
                    detail: { ...c.detail, ...detail },
                  }
                : c,
            );
            return;
          } catch {}
        }
        if (seqRef.current !== seq) return;
        apply({ loading: false, error: t('未获取到更多资料') });
      })();
    },
    [t],
  );

  useEffect(() => {
    if (!visible) {
      seqRef.current += 1;
      setCard(null);
      return;
    }
    if (target) load(target);
  }, [visible, target, load]);

  const toggleFollow = useCallback(async () => {
    if (!card) return;
    const id = String(card.id || '').trim();
    if (!/^\d+$/.test(id)) return;
    const next = !card.following;
    setCard((c) => (c && c.id === id ? { ...c, followBusy: true } : c));
    try {
      if (next) await pocketApi.followMember(id);
      else await pocketApi.unfollowMember(id);
      setCard((c) =>
        c && c.id === id
          ? { ...c, following: next, mutual: next ? c.mutual : false, followBusy: false }
          : c,
      );

      const cachedDetail = readProfileCache(id);
      if (cachedDetail)
        writeProfileCache(id, {
          ...cachedDetail,
          following: next,
          mutual: next ? cachedDetail.mutual : false,
        });
      mutateFollowedIdShared(useSettingsStore.getState().settings.p48Token, id, next);
      onFollowChanged?.(id, next);
    } catch (err) {
      setCard((c) => (c && c.id === id ? { ...c, followBusy: false } : c));
      showToast(t('操作失败：{msg}', { msg: errorMessage(err) }));
    }
  }, [card, onFollowChanged, showToast, t]);

  const cardAvatar = card?.detail?.avatar || card?.avatar || '';
  const cardName = card?.detail?.name || card?.name || t('未知用户');
  const canFollow = !!card?.id && /^\d+$/.test(card.id);
  const memberPageId = String(target?.member?.id || target?.memberId || card?.id || '').trim();
  const canOpenMemberPage =
    !!onOpenMemberPage &&
    /^\d+$/.test(memberPageId) &&
    !!(target?.member || target?.memberId || card?.isMember || card?.detail?.isStar);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.shade} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.wrap}>
          <View
            style={[
              styles.panel,
              {
                backgroundColor: sheetBg,
                borderTopColor: p.hairline,
                paddingBottom: Math.max(20, insets.bottom + 14),
              },
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: p.fill3 }]} />
            </View>

            <View style={styles.head}>
              {cardAvatar ? (
                <NetworkImage
                  source={{ uri: cardAvatar }}
                  style={[styles.avatar, { backgroundColor: p.fill2 }]}
                  fallbackIcon="account"
                  thumbnail={160}
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor: p.fill2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="account" size={30} color={p.labelTertiary} />
                </View>
              )}
              <View style={styles.titleWrap}>
                <Text style={[styles.name, { color: p.label }]} numberOfLines={1}>
                  {cardName}
                </Text>
                <Text style={[styles.meta, { color: p.labelSecondary }]} numberOfLines={1}>
                  {card?.id && /^\d+$/.test(card.id) ? `${t('用户 ID')}：${card.id}` : ''}
                  {card?.detail?.level
                    ? ` · ${t('等级 {level}', { level: card.detail.level })}`
                    : ''}
                </Text>
                {card?.isMember || card?.detail?.team || card?.detail?.period ? (
                  <Text style={[styles.meta, { color: p.tint }]} numberOfLines={1}>
                    {[
                      card?.isMember ? t('成员') : '',
                      card?.detail?.team || '',
                      card?.detail?.period || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
              <ScalePressable
                onPress={onClose}
                pressedScale={0.92}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('关闭')}
                style={[styles.closeBtn, { backgroundColor: p.fill2 }]}
              >
                <MaterialCommunityIcons name="close" size={18} color={p.labelSecondary} />
              </ScalePressable>
            </View>

            {card?.loading ? (
              <View style={styles.status}>
                <ActivityIndicator color={p.tint} />
                <Text style={[styles.tip, { color: p.labelSecondary }]}>
                  {t('正在加载用户资料…')}
                </Text>
              </View>
            ) : null}
            {card?.error ? (
              <View style={[styles.notice, { backgroundColor: p.fill2 }]}>
                <Text style={[styles.tip, { color: p.labelSecondary }]}>{card.error}</Text>
              </View>
            ) : null}
            {card?.detail?.signature ? (
              <View style={[styles.notice, { backgroundColor: p.fill2 }]}>
                <Text style={[styles.tip, { color: p.labelSecondary }]}>
                  {card.detail.signature}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <ScalePressable
                style={[
                  styles.btn,
                  {
                    backgroundColor: card?.following ? p.fill2 : p.tint,
                    opacity: canFollow ? 1 : 0.5,
                  },
                ]}
                pressedScale={0.95}
                activeOpacity={0.85}
                disabled={!card || card.followBusy || !canFollow}
                onPress={() => void toggleFollow()}
              >
                <MaterialCommunityIcons
                  name={card?.following ? 'account-check' : 'account-plus'}
                  size={15}
                  color={card?.following ? p.labelSecondary : p.onTint}
                />
                <Text
                  style={[styles.btnText, { color: card?.following ? p.labelSecondary : p.onTint }]}
                  numberOfLines={1}
                >
                  {card?.mutual ? t('互相关注') : card?.following ? t('已关注') : t('关注')}
                </Text>
              </ScalePressable>
              <ScalePressable
                style={[styles.btn, { backgroundColor: p.fill2, opacity: canFollow ? 1 : 0.5 }]}
                pressedScale={0.95}
                activeOpacity={0.85}
                disabled={!canFollow}
                onPress={() => card && canFollow && onOpenChat?.({ id: card.id, name: cardName })}
              >
                <MaterialCommunityIcons name="message-text-outline" size={15} color={p.tint} />
                <Text style={[styles.btnText, { color: p.tint }]} numberOfLines={1}>
                  {t('私信')}
                </Text>
              </ScalePressable>
              {canOpenMemberPage ? (
                <ScalePressable
                  style={[styles.btn, { backgroundColor: p.fill2 }]}
                  pressedScale={0.95}
                  activeOpacity={0.85}
                  onPress={() =>
                    onOpenMemberPage?.({
                      memberId: memberPageId,
                      name: cardName,
                      avatar: cardAvatar,
                      member: target?.member,
                    })
                  }
                >
                  <MaterialCommunityIcons
                    name="card-account-details-outline"
                    size={15}
                    color={p.label}
                  />
                  <Text style={[styles.btnText, { color: p.label }]} numberOfLines={1}>
                    {t('成员档案')}
                  </Text>
                </ScalePressable>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  wrap: { width: '100%' },
  panel: {
    width: '100%',
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  titleWrap: { flex: 1, minWidth: 0 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  name: { fontSize: 17, fontFamily: fontFamily.system, fontWeight: '800' },
  meta: { fontSize: 12, marginTop: 3 },
  status: { alignItems: 'center', paddingVertical: 14, gap: 8 },
  notice: { marginTop: 12, padding: 10, borderRadius: 12 },
  tip: { fontSize: 12, fontFamily: fontFamily.system, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  btn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  btnText: { fontSize: 13, fontFamily: fontFamily.system, fontWeight: '700' },
});
