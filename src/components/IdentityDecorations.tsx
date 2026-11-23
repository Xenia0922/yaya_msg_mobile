import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NetworkImage } from './NetworkImage';
import pocketApi from '../api/pocket48';
import { useMemberStore } from '../store';
import { OFFICIAL_TEAM_LOGOS } from '../utils/members';
import { usePalette, fontFamily } from '../theme';
import { useI18n } from '../i18n';
import { errorMessage, normalizeUrl } from '../utils/data';
import {
  ALLOW_CUSTOM_SENDER_PROFILE,
  ALLOW_CUSTOM_TEAM_LOGO,
  VIP_FEATURE_NOTICE,
} from '../constants/identityFeatures';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { getOfficialRoomBubbles, type OfficialRoomBubble } from '../services/roomBubbles';
import { getLiveBubbles, getLiveEffects, type LiveDecoration } from '../services/liveDecorations';

type Option = {
  id: string;
  name: string;
  url: string;
  vip?: boolean;
  owned?: boolean;
  greyUrl?: string;
};
type BubbleOption = OfficialRoomBubble;

function pickList(source: any, keys: string[]): any[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  for (const key of keys) if (Array.isArray(source[key])) return source[key];
  for (const key of keys) {
    const nested = source[key];
    if (nested && typeof nested === 'object') {
      const found = pickList(nested, keys);
      if (found.length) return found;
    }
  }
  return [];
}
const TEAM_LOGOS = OFFICIAL_TEAM_LOGOS;

export default function IdentityDecorations({
  accountKey,
  frame,
  teamLogo,
  badges,
  bubbleId,
  isStar,
  liveEffectId,
  liveEffectName,
  liveBubbleId,
  liveBubbleName,
  onChange,
  part = 'all',
}: {
  accountKey: string;
  frame: string;
  teamLogo: string;
  badges: string;
  bubbleId: string;
  isStar: string;
  liveEffectId: string;
  liveEffectName: string;
  liveBubbleId: string;
  liveBubbleName: string;
  onChange: (patch: Record<string, string>) => void;

  part?: 'all' | 'team' | 'profile';
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const members = useMemberStore((state) => state.members);
  const [frames, setFrames] = useState<Option[]>([]);
  const [badgeOptions, setBadgeOptions] = useState<Option[]>([]);
  const [bubbleOptions, setBubbleOptions] = useState<BubbleOption[]>([]);
  const [effectOptions, setEffectOptions] = useState<LiveDecoration[]>([]);
  const [liveBubbleOptions, setLiveBubbleOptions] = useState<LiveDecoration[]>([]);
  const [catalogTeams, setCatalogTeams] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [bubblesFailed, setBubblesFailed] = useState(false);
  const [accountFrame, setAccountFrame] = useState('');
  const [settingAccount, setSettingAccount] = useState(false);
  const [settingBubble, setSettingBubble] = useState(false);
  const [settingLive, setSettingLive] = useState(false);
  const [reload, setReload] = useState(0);

  const manualRefreshRef = useRef(false);

  const lastAccountRef = useRef('');
  const [picker, setPicker] = useState<
    'team' | 'frame' | 'badge' | 'bubble' | 'liveEffect' | 'liveBubble' | null
  >(null);
  const [pendingBadges, setPendingBadges] = useState<string[]>([]);

  useEffect(() => {
    if (part === 'profile' || !ALLOW_CUSTOM_TEAM_LOGO) return;
    let active = true;
    pocketApi
      .getGroupTeamStar()
      .then((response) => {
        const content = response?.content || response?.data || {};
        const list = [content.teamInfo, content.teamList, content.teams].flatMap((value) =>
          Array.isArray(value) ? value : [],
        );
        const options = list
          .map((item: any) => ({
            id: String(item.teamId ?? item.id ?? ''),
            name: String(item.teamName || item.name || t('队标')),
            url: String(item.teamLogo || item.teamLogoUrl || item.logo || ''),
          }))
          .filter((item: Option) => !!item.url);
        if (active) setCatalogTeams(options);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [part, t]);

  useEffect(() => {
    if (part === 'team') {
      setLoading(false);
      return;
    }
    let active = true;
    const accountChanged = lastAccountRef.current !== accountKey;
    lastAccountRef.current = accountKey;
    if (accountChanged) {
      setFrames([]);
      setBadgeOptions([]);
      setBubbleOptions([]);
      setEffectOptions([]);
      setLiveBubbleOptions([]);
      setAccountFrame('');
    }
    setBubblesFailed(false);
    setStatus(manualRefreshRef.current ? '正在刷新装扮…' : '');
    setLoading(true);
    const framesRequest = accountKey ? pocketApi.getUserPictureFrames() : Promise.resolve(null);
    const badgesRequest = accountKey ? pocketApi.getUserBadges() : Promise.resolve(null);
    const bubblesRequest = accountKey ? getOfficialRoomBubbles(true) : Promise.resolve(null);
    const effectsRequest = accountKey ? getLiveEffects(true) : Promise.resolve(null);
    const liveBubblesRequest = accountKey ? getLiveBubbles(true) : Promise.resolve(null);
    Promise.allSettled([
      framesRequest,
      badgesRequest,
      bubblesRequest,
      effectsRequest,
      liveBubblesRequest,
    ])
      .then(([frameResult, badgeResult, bubbleResult, effectResult, liveBubbleResult]) => {
        if (!active) return;
        const failed: string[] = [];
        if (accountKey && frameResult.status === 'fulfilled') {
          const content =
            frameResult.value?.content ?? frameResult.value?.data ?? frameResult.value ?? {};
          const list = pickList(content, [
            'pictureFrames',
            'frames',
            'frameList',
            'list',
            'records',
          ]);
          setFrames(
            list
              .map((item: any) => ({
                id: String(item.pfId ?? item.frameId ?? ''),
                name: String(item.pfName || item.frameName || t('头像框')),
                url: String(item.pfUrl || item.frameUrl || ''),
                vip: item.forVip === true || item.forVip === 1,
              }))
              .filter((item: Option) => !!item.url),
          );
          setAccountFrame(String(content.pfId ?? ''));
        } else if (accountKey) failed.push('头像框');
        if (accountKey && badgeResult.status === 'fulfilled') {
          const content =
            badgeResult.value?.content ?? badgeResult.value?.data ?? badgeResult.value ?? {};
          const list = [
            ...pickList(content.levelBadge, ['badges', 'list']),
            ...pickList(content.achievementBadge, ['badges', 'list']),
          ];
          const options = list
            .map((item: any) => ({
              id: String(item.badgeId ?? ''),
              name: String(item.badgeName || '勋章'),
              url: String(item.smallPic || item.bigPic || ''),
              greyUrl: String(item.greyPic || ''),

              owned:
                item.userHas === undefined
                  ? true
                  : item.userHas === true || item.userHas === 1 || String(item.userHas) === '1',
            }))
            .filter((item: Option) => !!item.url);

          setBadgeOptions(
            options.sort((a: Option, b: Option) => Number(b.owned) - Number(a.owned)),
          );
        } else if (accountKey) failed.push('勋章');
        if (bubbleResult.status === 'fulfilled' && bubbleResult.value) {
          setBubbleOptions(bubbleResult.value);
          setBubblesFailed(false);
        } else if (accountKey) {
          setBubblesFailed(true);
          failed.push('官方气泡');
        }
        if (effectResult.status === 'fulfilled' && effectResult.value) {
          setEffectOptions(effectResult.value as LiveDecoration[]);
        } else if (accountKey) failed.push('直播进场特效');
        if (liveBubbleResult.status === 'fulfilled' && liveBubbleResult.value) {
          setLiveBubbleOptions(liveBubbleResult.value as LiveDecoration[]);
        } else if (accountKey) failed.push('直播弹幕气泡');
        if (failed.length) setStatus(`${failed.join('、')}加载失败，请重试`);
        else if (manualRefreshRef.current) setStatus('装扮已刷新');
        manualRefreshRef.current = false;
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountKey, reload, part, t]);

  const teams = useMemo<Option[]>(() => {
    const seen = new Set(TEAM_LOGOS.map(([, url]) => normalizeUrl(url)));
    const known = TEAM_LOGOS.map(([name, url]) => ({ id: url, name, url }));
    const dynamic = catalogTeams.filter((item) => {
      const url = normalizeUrl(item.url);
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return known.concat(
      dynamic,
      members.flatMap((member) => {
        const url = String(member.teamLogo || '').trim();
        if (!url || seen.has(normalizeUrl(url))) return [];
        seen.add(normalizeUrl(url));
        return [
          {
            id: url,
            url,
            name: [member.groupName, member.team].filter(Boolean).join(' · ') || t('队标'),
          },
        ];
      }),
    );
  }, [members, catalogTeams, t]);
  const chosenBadges = badges
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const selectedFrame = frames.find((item) => normalizeUrl(item.url) === normalizeUrl(frame));
  const selectedBubble = bubbleOptions.find((item) => item.id === bubbleId);
  const writeAccountFrame = async () => {
    if (!selectedFrame || settingAccount) return;
    const pfId = Number(selectedFrame.id);
    if (!Number.isSafeInteger(pfId) || pfId <= 0) {
      setStatus('头像框编号无效');
      return;
    }
    setSettingAccount(true);
    setStatus('正在设置口袋账号头像框…');
    try {
      await pocketApi.setUserPictureFrame(pfId);
      setAccountFrame(selectedFrame.id);
      setStatus('口袋账号头像框设置成功');
    } catch (err) {
      setStatus(`口袋账号设置失败：${errorMessage(err)}`);
    } finally {
      setSettingAccount(false);
    }
  };
  const selectOfficialBubble = async (option: BubbleOption) => {
    if (option.id === bubbleId || settingBubble) return;
    onChange({ yaya_send_bubble_id: option.id });
    setPicker(null);
    setSettingBubble(true);
    setStatus(`正在同步口袋官方气泡「${option.name}」…`);
    try {
      await pocketApi.setRoomBubble(option.serverId || option.id);
      setStatus(`已同步口袋官方气泡「${option.name}」`);
    } catch (err) {
      setStatus(`已保存发言气泡编号；口袋官方设置同步失败：${errorMessage(err)}`);
    } finally {
      setSettingBubble(false);
    }
  };

  const restoreBubble = async () => {
    if (settingBubble) return;
    const fallback = bubbleOptions.find((option) => option.isDefault);
    onChange({ yaya_send_bubble_id: '0' });
    setPicker(null);
    setSettingBubble(true);
    setStatus('已恢复默认气泡');
    try {
      await pocketApi.setRoomBubble(fallback?.serverId || '0');
    } catch (err) {
      setStatus(`已恢复默认气泡；口袋账号同步失败：${errorMessage(err)}`);
    } finally {
      setSettingBubble(false);
    }
  };

  const applyLiveDecoration = async (kind: 'effect' | 'bubble', option: LiveDecoration | null) => {
    if (settingLive) return;
    const isEffect = kind === 'effect';
    onChange(
      isEffect
        ? { yaya_live_effect_id: option?.id || '', yaya_live_effect_name: option?.name || '' }
        : { yaya_live_bubble_id: option?.id || '', yaya_live_bubble_name: option?.name || '' },
    );
    setPicker(null);
    setSettingLive(true);
    const label = isEffect ? '直播进场特效' : '直播弹幕气泡';
    setStatus(option ? `正在同步${label}「${option.name}」…` : `正在关闭${label}…`);
    try {
      if (isEffect) await pocketApi.setLiveSpecialEffect(option?.id || liveEffectId, !!option);
      else {
        const fallbackBubble = liveBubbleOptions.find((item) => /默认/.test(item.name));
        await pocketApi.setLiveBubble(option?.id || fallbackBubble?.id || '0');
      }
      setStatus(option ? `已同步${label}「${option.name}」` : `已关闭${label}`);
    } catch (err) {
      setStatus(`已保存本机设置；口袋账号同步失败：${errorMessage(err)}`);
    } finally {
      setSettingLive(false);
    }
  };

  const renderLiveOptions = (
    options: LiveDecoration[],
    selectedId: string,
    onPick: (option: LiveDecoration) => void,
  ) => (
    <View style={styles.options}>
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <TouchableOpacity
            key={option.id}
            onPress={() => onPick(option)}
            style={[
              styles.option,
              {
                borderColor: selected ? palette.tint : palette.hairline,
                backgroundColor: palette.fill2,
              },
            ]}
          >
            {option.preview ? (
              <NetworkImage
                source={{ uri: normalizeUrl(option.preview) }}
                style={styles.image}
                resizeMode="contain"
                fallback={false}
              />
            ) : (
              <MaterialCommunityIcons
                name="star-four-points-outline"
                size={25}
                color={palette.tint}
              />
            )}
            <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
              {option.name}
            </Text>
            {selected ? (
              <Text style={[styles.vip, { color: palette.tint }]}>{t('已选')}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
  const renderOptions = (
    options: Option[],
    selected: (option: Option) => boolean,
    choose: (option: Option) => void,
  ) => (
    <View style={styles.options}>
      {options.map((option, index) => {
        const locked = option.owned === false;
        const uri = normalizeUrl(locked && option.greyUrl ? option.greyUrl : option.url);
        return (
          <TouchableOpacity
            key={`${option.id}-${index}`}
            onPress={() => choose(option)}
            style={[
              styles.option,
              {
                borderColor: selected(option) ? palette.tint : palette.hairline,
                backgroundColor: palette.fill2,
                opacity: locked ? 0.55 : 1,
              },
            ]}
          >
            <NetworkImage
              source={{ uri }}
              style={styles.image}
              resizeMode="contain"
              fallback={false}
            />
            <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
              {option.name}
            </Text>
            {locked ? (
              <MaterialCommunityIcons name="lock" size={10} color={palette.labelTertiary} />
            ) : option.vip ? (
              <Text style={[styles.vip, { color: palette.tint }]}>VIP</Text>
            ) : null}
            {selected(option) ? (
              <Text style={[styles.vip, { color: palette.tint }]}>{t('已选')}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const decorationRow = (
    title: string,
    subtitle: string,
    icon: string,
    preview: string | undefined,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.decorationRow,
        { backgroundColor: palette.fill2, borderColor: palette.hairline },
      ]}
    >
      <View style={[styles.decorationIcon, { backgroundColor: palette.tintSoft }]}>
        {preview ? (
          <NetworkImage
            source={{ uri: normalizeUrl(preview) }}
            style={styles.image}
            resizeMode="contain"
            fallback={false}
          />
        ) : (
          <MaterialCommunityIcons name={icon} size={25} color={palette.tint} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.decorationTitle, { color: palette.label }]}>{title}</Text>
        <Text
          style={[styles.decorationSubtitle, { color: palette.labelSecondary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={palette.labelTertiary} />
    </TouchableOpacity>
  );
  const actionButton = (label: string, icon: string, onPress: () => void, disabled = false) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionButton,
        {
          backgroundColor: palette.fill2,
          borderColor: palette.hairline,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={15} color={palette.tint} />
      <Text style={[styles.actionButtonText, { color: palette.label }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      {part !== 'profile' && ALLOW_CUSTOM_TEAM_LOGO ? (
        <>
          <Text style={[styles.section, { color: palette.label }]}>{t('队伍标识')}</Text>
          {decorationRow(
            t('队标'),
            teams.find((item) => normalizeUrl(item.url) === normalizeUrl(teamLogo))?.name ||
              t('跟随账号 · 点击选择'),
            'shield-star-outline',
            teamLogo,
            () => setPicker('team'),
          )}
          {!teams.length ? (
            <Text style={[styles.hint, { color: palette.labelTertiary }]}>
              {t('成员数据暂未提供队标图片')}
            </Text>
          ) : null}
          {teamLogo ? (
            <View style={styles.actions}>
              {actionButton(t('恢复账号队标'), 'restore', () =>
                onChange({ yaya_send_teamlogo: '' }),
              )}
            </View>
          ) : null}
          {teamLogo ? (
            <TouchableOpacity
              onPress={() => onChange({ yaya_send_is_star: isStar === 'on' ? '' : 'on' })}
              activeOpacity={0.8}
              style={[
                styles.decorationRow,
                { backgroundColor: palette.fill2, borderColor: palette.hairline },
              ]}
            >
              <MaterialCommunityIcons
                name={isStar === 'on' ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={20}
                color={palette.tint}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.decorationTitle, { color: palette.label }]}>
                  {t('在官方客户端也显示队标')}
                </Text>
                <Text
                  style={[styles.decorationSubtitle, { color: palette.labelSecondary }]}
                  numberOfLines={2}
                >
                  {t('开启后以成员身份（isStar）发送；官方可能校验，风险自担')}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {part !== 'team' ? (
        <>
          {ALLOW_CUSTOM_SENDER_PROFILE ? (
            <View style={styles.sectionRow}>
              <Text style={[styles.section, styles.sectionInline, { color: palette.label }]}>
                {t('个性装扮')}
              </Text>

              {accountKey
                ? actionButton(
                    loading ? t('刷新中…') : t('刷新装扮'),
                    'refresh',
                    () => {
                      manualRefreshRef.current = true;
                      setReload((value) => value + 1);
                    },
                    loading,
                  )
                : null}
            </View>
          ) : null}
          {!accountKey ? (
            <Text style={[styles.hint, { color: palette.labelTertiary }]}>
              {t('登录口袋账号后加载头像框、勋章和官方气泡')}
            </Text>
          ) : null}
          {loading && !frames.length ? (
            <ActivityIndicator size="small" color={palette.tint} />
          ) : null}
          {decorationRow(
            t('头像框'),
            selectedFrame?.name || (frame ? t('自定义头像框') : t('跟随账号 · 点击选择')),
            'account-circle-outline',
            frame,
            () => setPicker('frame'),
          )}
          {frame || selectedFrame ? (
            <View style={styles.actions}>
              {frame
                ? actionButton(t('恢复账号头像框'), 'restore', () =>
                    onChange({ yaya_send_pfurl: '' }),
                  )
                : null}
              {selectedFrame
                ? actionButton(
                    accountFrame === selectedFrame.id ? t('账号当前头像框') : t('设置到口袋账号'),
                    'account-check-outline',
                    writeAccountFrame,
                    settingAccount || accountFrame === selectedFrame.id,
                  )
                : null}
            </View>
          ) : null}
          {decorationRow(
            t('勋章'),
            chosenBadges.length
              ? t('已选 {n} 枚 · 可多选', { n: chosenBadges.length })
              : t('跟随账号 · 可多选'),
            'medal-outline',
            chosenBadges[0],
            () => {
              setPendingBadges(chosenBadges);
              setPicker('badge');
            },
          )}
          {chosenBadges.length ? (
            <View style={styles.actions}>
              {actionButton(t('恢复账号勋章'), 'restore', () => onChange({ yaya_send_badge: '' }))}
            </View>
          ) : null}
          {decorationRow(
            t('消息气泡'),
            selectedBubble?.name ||
              (bubbleId === '0'
                ? t('默认气泡 · 选择口袋官方装扮')
                : t('气泡 {id}', { id: bubbleId })),
            'message-text-outline',
            selectedBubble?.previewPath,
            () => setPicker('bubble'),
          )}
          {bubbleId && bubbleId !== '0' ? (
            <View style={styles.actions}>
              {actionButton(t('恢复默认气泡'), 'restore', restoreBubble, settingBubble)}
            </View>
          ) : null}
          {decorationRow(
            t('直播进场特效'),
            liveEffectId ? liveEffectName || t('已开启') : t('未开启 · 点击选择'),
            'star-four-points-outline',
            effectOptions.find((option) => option.id === liveEffectId)?.preview,
            () => setPicker('liveEffect'),
          )}
          {liveEffectId ? (
            <View style={styles.actions}>
              {actionButton(
                t('关闭进场特效'),
                'close-circle-outline',
                () => applyLiveDecoration('effect', null),
                settingLive,
              )}
            </View>
          ) : null}
          {decorationRow(
            t('直播弹幕气泡'),
            liveBubbleId ? liveBubbleName || t('已选择') : t('跟随账号 · 点击选择'),
            'comment-processing-outline',
            liveBubbleOptions.find((option) => option.id === liveBubbleId)?.preview,
            () => setPicker('liveBubble'),
          )}
          {liveBubbleId ? (
            <View style={styles.actions}>
              {actionButton(
                t('清除直播气泡'),
                'close-circle-outline',
                () => applyLiveDecoration('bubble', null),
                settingLive,
              )}
            </View>
          ) : null}
          <View style={[styles.notice, { backgroundColor: palette.fill2 }]}>
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={palette.labelSecondary}
            />
            <Text style={[styles.noticeText, { color: palette.labelSecondary }]}>
              {t('免责声明：')}
              {VIP_FEATURE_NOTICE}
            </Text>
          </View>
          {status ? (
            <Text style={[styles.hint, { color: palette.labelSecondary }]}>{status}</Text>
          ) : null}
        </>
      ) : null}
      <Modal
        visible={picker !== null}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPicker(null)}
      >
        <View style={styles.shade}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: palette.surface,
                paddingBottom: Math.max(18, insets.bottom + 12),
              },
            ]}
          >
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: palette.fill3,
                alignSelf: 'center',
                marginBottom: 10,
              }}
            />
            <View style={styles.sheetHeader}>
              <Text style={[styles.section, { color: palette.label, marginTop: 0 }]}>
                {picker === 'team'
                  ? t('选择队标')
                  : picker === 'frame'
                    ? t('选择头像框')
                    : picker === 'badge'
                      ? t('选择勋章（已选 {n}）', { n: pendingBadges.length })
                      : picker === 'liveEffect'
                        ? t('直播进场特效')
                        : picker === 'liveBubble'
                          ? t('直播弹幕气泡')
                          : t('口袋官方消息气泡')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (picker === 'badge') onChange({ yaya_send_badge: pendingBadges.join(',') });
                  setPicker(null);
                }}
              >
                <Text style={[styles.action, { color: palette.tint }]}>{t('完成')}</Text>
              </TouchableOpacity>
            </View>
            {picker === 'badge' ? (
              <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                {t('可多选，再次点击取消选择。')}
              </Text>
            ) : null}
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {picker === 'team'
                ? renderOptions(
                    teams,
                    (option) => normalizeUrl(option.url) === normalizeUrl(teamLogo),
                    (option) => {
                      onChange({ yaya_send_teamlogo: option.url });
                      setPicker(null);
                    },
                  )
                : null}
              {picker === 'frame'
                ? renderOptions(
                    frames,
                    (option) => normalizeUrl(option.url) === normalizeUrl(frame),
                    (option) => {
                      onChange({ yaya_send_pfurl: option.url });
                      setPicker(null);
                    },
                  )
                : null}
              {picker === 'badge'
                ? renderOptions(
                    badgeOptions,
                    (option) =>
                      pendingBadges.some((url) => normalizeUrl(url) === normalizeUrl(option.url)),
                    (option) =>
                      setPendingBadges((current) =>
                        current.some((url) => normalizeUrl(url) === normalizeUrl(option.url))
                          ? current.filter((url) => normalizeUrl(url) !== normalizeUrl(option.url))
                          : [...current, option.url],
                      ),
                  )
                : null}
              {picker === 'bubble' ? (
                <>
                  {bubbleOptions.length ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('共 {n} 款 · 已拥有 {m} 款', {
                        n: bubbleOptions.length,
                        m: bubbleOptions.filter((option) => option.owned).length,
                      })}
                    </Text>
                  ) : null}
                  {bubbleOptions.length ? (
                    <View style={styles.options}>
                      {bubbleOptions.map((option, index) => {
                        const selected = option.id === bubbleId;
                        return (
                          <TouchableOpacity
                            key={`${option.id}-${index}`}
                            onPress={() => selectOfficialBubble(option)}
                            style={[
                              styles.option,
                              {
                                borderColor: selected ? palette.tint : palette.hairline,
                                backgroundColor: palette.fill2,
                                opacity: option.owned ? 1 : 0.55,
                              },
                            ]}
                          >
                            {option.previewPath ? (
                              <NetworkImage
                                source={{ uri: normalizeUrl(option.previewPath) }}
                                style={styles.image}
                                resizeMode="contain"
                                fallback={false}
                              />
                            ) : (
                              <MaterialCommunityIcons
                                name="message-text-outline"
                                size={25}
                                color={palette.tint}
                              />
                            )}
                            <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>
                              {option.name}
                            </Text>
                            {selected ? (
                              <Text style={[styles.vip, { color: palette.tint }]}>{t('已选')}</Text>
                            ) : option.inUse ? (
                              <Text style={[styles.vip, { color: palette.labelTertiary }]}>
                                {t('使用中')}
                              </Text>
                            ) : !option.owned ? (
                              <MaterialCommunityIcons
                                name="lock"
                                size={10}
                                color={palette.labelTertiary}
                              />
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : !loading && bubblesFailed ? (
                    <TouchableOpacity onPress={() => setReload((value) => value + 1)}>
                      <Text style={[styles.hint, { color: palette.tint }]}>
                        {t('官方气泡加载失败，点击重试')}
                      </Text>
                    </TouchableOpacity>
                  ) : !loading ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('暂无官方气泡')}
                    </Text>
                  ) : null}
                  {status && !bubblesFailed ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>{status}</Text>
                  ) : null}
                  {loading ? <ActivityIndicator size="small" color={palette.tint} /> : null}
                  <Text style={[styles.hint, { color: palette.labelTertiary }]}>
                    {t(
                      '带锁的气泡账号未拥有，仍可发送；对方客户端是否渲染取决于官方校验。选择后同步到口袋账号，发言消息也携带气泡 ID。',
                    )}
                  </Text>
                </>
              ) : null}
              {picker === 'liveEffect' ? (
                <>
                  {effectOptions.length ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('共 {n} 款', { n: effectOptions.length })}
                    </Text>
                  ) : null}
                  {effectOptions.length ? (
                    renderLiveOptions(effectOptions, liveEffectId, (option) =>
                      applyLiveDecoration('effect', option),
                    )
                  ) : !loading ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('暂无直播进场特效')}
                    </Text>
                  ) : null}
                  {loading ? <ActivityIndicator size="small" color={palette.tint} /> : null}
                  <Text style={[styles.hint, { color: palette.labelTertiary }]}>
                    {t(
                      '选中后同步到口袋账号，进入直播间时官方客户端会播放该进场动画。官方对未拥有/已过期的特效会返回「特效已过期」，此时只记住本机选择。',
                    )}
                  </Text>
                </>
              ) : null}
              {picker === 'liveBubble' ? (
                <>
                  {liveBubbleOptions.length ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('共 {n} 款', { n: liveBubbleOptions.length })}
                    </Text>
                  ) : null}
                  {liveBubbleOptions.length ? (
                    renderLiveOptions(liveBubbleOptions, liveBubbleId, (option) =>
                      applyLiveDecoration('bubble', option),
                    )
                  ) : !loading ? (
                    <Text style={[styles.hint, { color: palette.labelSecondary }]}>
                      {t('暂无直播弹幕气泡')}
                    </Text>
                  ) : null}
                  {loading ? <ActivityIndicator size="small" color={palette.tint} /> : null}
                  <Text style={[styles.hint, { color: palette.labelTertiary }]}>
                    {t(
                      '直播弹幕气泡作用在直播间发言上，选中即同步到口袋账号；未拥有/已下架的气泡官方会返回「无权限设置该气泡」。',
                    )}
                  </Text>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '700', marginTop: 16 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  sectionInline: { marginTop: 0 },
  hint: { fontSize: 11, fontFamily: fontFamily.system, lineHeight: 17, marginTop: 5 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  option: {
    width: 76,
    minHeight: 78,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  image: { width: 42, height: 42 },
  name: { fontSize: 10, fontFamily: fontFamily.system, marginTop: 3 },
  vip: { fontSize: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: { fontSize: 12, paddingVertical: 6 },
  actionButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonText: { fontSize: 12, fontFamily: fontFamily.system, fontWeight: '600' },
  decorationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 9,
    marginTop: 8,
  },
  decorationIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decorationTitle: { fontSize: 14, fontFamily: fontFamily.system, fontWeight: '700' },
  decorationSubtitle: { fontSize: 11, marginTop: 3 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  noticeText: { flex: 1, fontSize: 11, fontFamily: fontFamily.system, lineHeight: 16 },
  shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '75%',
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
