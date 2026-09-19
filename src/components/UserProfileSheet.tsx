/**
 * UserProfileSheet · 通用「用户资料卡」底部弹层（成员 / 非成员共用）
 *
 * 来源：从 FollowedRoomsScreen 的房间消息头像资料卡抽出，供多个入口复用：
 *   - 房间消息点发送者头像
 *   - 播放器「弹幕列表」点发送者昵称
 *
 * 行为：
 *   - 打开时展示已知道的昵称/头像（先上屏），再异步拉 `user/api/v1/user/info/home` 补详情
 *   - id 候选逐个试（口袋 userId → 成员库 id → 消息里的发送者字段）——
 *     消息里的 10 位 id 常是云信 accid，查不到就自动换下一个
 *   - 底部三按钮：关注/取消关注、私信、关闭
 *   - **非成员（粉丝）不显示翻牌条**（翻牌是成员专属玩法）
 *
 * 私信跳转：调用方传 onOpenChat，由调用方决定导航方式（不同栈里路由名可能不同）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { ScalePressable } from './Motion';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import { useUiStore } from '../store';
import { normalizeUrl, pickText, errorMessage } from '../utils/data';
import pocketApi from '../api/pocket48';

export interface UserProfileTarget {
  /** 已知昵称 */
  nick?: string;
  /** 已知头像 */
  avatar?: string;
  /** 口袋 userId（数字字符串）*/
  userId?: string;
  /** 成员库 id（命中成员时为非空） */
  memberId?: string;
  /** 已命中的成员记录（有则展示「成员 · 队伍」） */
  member?: any;
}

export interface UserProfileSheetProps {
  visible: boolean;
  target: UserProfileTarget | null;
  onClose: () => void;
  /** 点「私信」：调用方负责导航到私信页 */
  onOpenChat?: (target: { id: string; name: string }) => void;
  /** 关注态变化后回调（调用方可用于刷新关注列表） */
  onFollowChanged?: (id: string, following: boolean) => void;
}

/** 从接口响应里解析用户资料（字段多态，逐个兜底） */
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
    pick(['relation', 'relationType', 'followStatus', 'friendStatus', 'isFollow', 'followed', 'isFriend', 'relationship']) || '',
  )
    .trim()
    .toLowerCase();
  const mutual = ['mutual', 'both', 'friend', 'friends', '2', '3'].includes(relationValue);
  const following = mutual || ['true', 'followed', 'following', '1'].includes(relationValue);
  return {
    name: pick(['nickName', 'nickname', 'userName', 'name', 'starName', 'realNickName', 'baseUserInfo.nickName']),
    avatar: normalizeUrl(pick(['avatar', 'avatarUrl', 'faceImage', 'headImg', 'headUrl', 'starAvatar'])),
    level: pick(['level', 'userLevel', 'grade', 'vipLevel', 'userLevelName']),
    signature: pick(['signature', 'sign', 'intro', 'description', 'userSignature']),
    team: pick(['starTeamName', 'teamName', 'team']),
    period: pick(['periodName', 'period']),
    isStar: !!(star && (star.starName || star.starId)) || base?.isStar === true || base?.star === true,
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
  detail: { name: string; avatar: string; level: string; signature: string; team: string; period: string; isStar: boolean };
}

export function UserProfileSheet({ visible, target, onClose, onOpenChat, onFollowChanged }: UserProfileSheetProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((state) => state.showToast);
  const [card, setCard] = useState<CardState | null>(null);
  /** 请求序号：连点不同用户时丢弃旧响应（避免慢响应覆盖新卡） */
  const seqRef = useRef(0);

  const load = useCallback(
    (tg: UserProfileTarget) => {
      const m = tg.member;
      // 候选 id 顺序：口袋 userId → 成员库 userId/id → 调用方给的 id
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
        apply({ loading: false, error: t('该用户没有可加载的口袋48资料') });
        return;
      }

      void (async () => {
        for (const id of candidates) {
          try {
            const res = await pocketApi.getUserProfile(id);
            if (seqRef.current !== seq) return;
            const detail = userCardFromUserRes(res);
            setCard((c) =>
              c && seqRef.current === seq
                ? { ...c, id, loading: false, error: '', following: detail.following, mutual: detail.mutual, detail: { ...c.detail, ...detail } }
                : c,
            );
            return;
          } catch {
            // 该 id 查不到（如非口袋 userId）→ 试下一个
          }
        }
        if (seqRef.current !== seq) return;
        apply({ loading: false, error: t('未获取到更多资料') });
      })();
    },
    [t],
  );

  useEffect(() => {
    if (!visible) {
      seqRef.current += 1; // 关闭即作废在途请求
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
      setCard((c) => (c && c.id === id ? { ...c, following: next, mutual: next ? c.mutual : false, followBusy: false } : c));
      onFollowChanged?.(id, next);
    } catch (err) {
      setCard((c) => (c && c.id === id ? { ...c, followBusy: false } : c));
      showToast(t('操作失败：{msg}', { msg: errorMessage(err) }));
    }
  }, [card, onFollowChanged, showToast, t]);

  const cardAvatar = card?.detail?.avatar || card?.avatar || '';
  const cardName = card?.detail?.name || card?.name || t('未知用户');
  const canFollow = !!card?.id && /^\d+$/.test(card.id);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.shade} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.wrap}>
          <GlassSurface radius={22} role="card" style={styles.panel}>
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: palette.fill3 }]} />
            </View>

            <View style={styles.head}>
              {cardAvatar ? (
                <Image source={{ uri: cardAvatar }} style={[styles.avatar, { backgroundColor: palette.fill2 }]} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: palette.fill2, alignItems: 'center', justifyContent: 'center' }]}>
                  <MaterialCommunityIcons name="account" size={30} color={palette.labelTertiary} />
                </View>
              )}
              <View style={styles.titleWrap}>
                <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>{cardName}</Text>
                <Text style={[styles.meta, { color: palette.labelSecondary }]} numberOfLines={1}>
                  {/* 只在拿到「数字 userId」时展示 ID 行：云信 accid 等内部 id 不露给用户看 */}
                  {card?.id && /^\d+$/.test(card.id) ? `${t('用户 ID')}：${card.id}` : ''}
                  {card?.detail?.level ? ` · ${t('等级 {level}', { level: card.detail.level })}` : ''}
                </Text>
                {card?.isMember || card?.detail?.team || card?.detail?.period ? (
                  <Text style={[styles.meta, { color: palette.tint }]} numberOfLines={1}>
                    {[card?.isMember ? t('成员') : '', card?.detail?.team || '', card?.detail?.period || ''].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>

            {card?.loading ? (
              <View style={styles.status}>
                <ActivityIndicator color={palette.tint} />
                <Text style={[styles.tip, { color: palette.labelSecondary }]}>{t('正在加载用户资料…')}</Text>
              </View>
            ) : null}
            {card?.error ? (
              <View style={[styles.notice, { backgroundColor: palette.fill2 }]}>
                <Text style={[styles.tip, { color: palette.labelSecondary }]}>{card.error}</Text>
              </View>
            ) : null}
            {card?.detail?.signature ? (
              <View style={[styles.notice, { backgroundColor: palette.fill2 }]}>
                <Text style={[styles.tip, { color: palette.labelSecondary }]}>{card.detail.signature}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <ScalePressable
                style={[styles.btn, { backgroundColor: card?.following ? palette.fill2 : palette.tint, opacity: canFollow ? 1 : 0.5 }]}
                pressedScale={0.95}
                activeOpacity={0.85}
                disabled={!card || card.followBusy || !canFollow}
                onPress={() => void toggleFollow()}
              >
                <MaterialCommunityIcons
                  name={card?.following ? 'account-check' : 'account-plus'}
                  size={14}
                  color={card?.following ? palette.labelSecondary : palette.onTint}
                />
                <Text style={[styles.btnText, { color: card?.following ? palette.labelSecondary : palette.onTint }]}>
                  {card?.mutual ? t('互相关注') : card?.following ? t('已关注') : t('关注')}
                </Text>
              </ScalePressable>
              <ScalePressable
                style={[styles.btn, { backgroundColor: palette.fill2, opacity: canFollow || card?.id ? 1 : 0.5 }]}
                pressedScale={0.95}
                activeOpacity={0.85}
                disabled={!card?.id}
                onPress={() => card && onOpenChat?.({ id: card.id, name: cardName })}
              >
                <MaterialCommunityIcons name="message-text-outline" size={14} color={palette.tint} />
                <Text style={[styles.btnText, { color: palette.tint }]}>{t('私信')}</Text>
              </ScalePressable>
              <Pressable style={[styles.ghost, { borderColor: palette.hairline }]} onPress={onClose}>
                <Text style={[styles.btnText, { color: palette.labelSecondary }]}>{t('关闭')}</Text>
              </Pressable>
            </View>
          </GlassSurface>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  wrap: { paddingHorizontal: 12, paddingBottom: 20 },
  panel: { paddingHorizontal: 18, paddingBottom: 18, overflow: 'hidden' },
  handleWrap: { alignItems: 'center', paddingVertical: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  titleWrap: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 12, marginTop: 3 },
  status: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  notice: { marginTop: 12, padding: 10, borderRadius: 12 },
  tip: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 999,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  ghost: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
