import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useMemberStore, useSettingsStore, useUiStore } from '../store';
import { FadeInView } from '../components/Motion';
import { formatTimestamp } from '../utils/format';
import { errorMessage, messagePayload, messageText, normalizeUrl, parseMaybeJson, pickText, unwrapList } from '../utils/data';
import pocketApi from '../api/pocket48';

function convTargetId(conv: any): string {
  return String(conv?.targetUserId || conv?.user?.userId || conv?.userId || '');
}
function convName(conv: any): string {
  return pickText(conv, ['user.nickname', 'user.nickName', 'user.starName', 'user.realNickName', 'nickname', 'starName'], convTargetId(conv) || '私信');
}
function msgId(msg: any, index: number): string {
  return String(msg.messageId || msg.msgId || msg.id || msg.clientMsgId || index);
}
function msgTimeNumber(msg: any): number {
  const v = Number(msg.timestamp || msg.msgTime || msg.ctime || msg.time || msg.createTime || msg.sendTime || 0);
  return Number.isFinite(v) ? v : 0;
}
function msgFromId(msg: any): string {
  return String(msg.user?.userId || msg.user?.id || msg.fromUserId || msg.senderUserId || msg.senderId || msg.userId || msg.fromAccount || '');
}
function msgToId(msg: any): string {
  return String(msg.toUserId || msg.targetUserId || msg.receiverUserId || msg.receiveUserId || '');
}
function isMineMessage(msg: any, targetId: string, currentUserId = ''): boolean {
  if (msg.isSelf === true || msg.self === true || msg.isMe === true) return true;
  if (msg.isSelf === false || msg.self === false || msg.isMe === false) return false;
  if (targetId && String(msg.user?.userId || msg.user?.id || '') === String(targetId)) return false;
  const from = msgFromId(msg);
  const to = msgToId(msg);
  if (currentUserId && from === currentUserId) return true;
  if (currentUserId && to === currentUserId) return false;
  if (from && targetId && from === targetId) return false;
  if (to && targetId && to === targetId) return true;
  const d = String(msg.direct || msg.direction || msg.messageDirection || '').toLowerCase();
  if (['out', 'outgoing', 'send', 'sent', '1'].includes(d)) return true;
  if (['in', 'incoming', 'receive', 'received', '0'].includes(d)) return false;
  return false;
}

function privateMessageText(msg: any): string {
  const payload = messagePayload(msg);
  const text = messageText(msg) || pickText(msg, ['content.text', 'text', 'message', 'msg'])
    || pickText(payload, ['text', 'content', 'message.text', 'msg.text']) || '';

  const flipKeys = ['flipCardInfo', 'filpCardInfo', 'flipCardAudioInfo', 'filpCardAudioInfo', 'flipCardVideoInfo', 'filpCardVideoInfo'];
  for (const key of flipKeys) {
    const fi = payload?.[key] || msg?.[key] || msg?.content?.[key];
    if (fi) {
      const parsed = typeof fi === 'string' ? parseMaybeJson(fi) : fi;
      if (parsed) {
        const q = parsed.question || parsed.answerQuestion || '';
        const a = (typeof parsed.answer === 'string') ? parseMaybeJson(parsed.answer) : parsed.answer;
        const answerText = (a && typeof a === 'object') ? (a.text || a.content || '') : (typeof parsed.answer === 'string' ? parsed.answer : '');
        if (q && answerText) return `问：${q}\n答：${answerText}`;
        if (q) return `问：${q}`;
        if (answerText) return `答：${answerText}`;
        if (a && typeof a === 'object') {
          const au = pickText(a, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
          if (au) {
            const at = answerTypeFromContext(msg) || answerTypeFromContext(parsed);
            if (at === 2 || looksLikeAudioUrl(au)) return q ? `问：${q}\n答：[语音消息]` : '[语音消息]';
            if (at === 3 || looksLikeVideoUrl(au)) return q ? `问：${q}\n答：[视频消息]` : '[视频消息]';
            if (looksLikeImageUrl(au)) return q ? `问：${q}\n答：[图片消息]` : '[图片消息]';
          }
        }
      }
    }
  }

  const answerRaw = payload?.answer || payload?.answerContent || msg?.answer || msg?.answerContent || '';
  if (answerRaw) {
    const parsed = typeof answerRaw === 'string' ? parseMaybeJson(answerRaw) : answerRaw;
    if (parsed && typeof parsed === 'object') {
      const at = parsed.text || parsed.content || parsed.answer || '';
      if (at) {
        const qtext = payload?.question || msg?.question || '';
        if (qtext) return `问：${qtext}\n答：${at}`;
      }
    } else if (typeof parsed === 'string' && parsed.trim()) {
      return parsed;
    }
  }

  const t = String(text).trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    const json = parseMaybeJson(t);
    if (json && typeof json === 'object') {
      const url = pickText(json, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
      if (url) {
        if (looksLikeAudioUrl(url) || answerTypeFromContext(msg) === 2) return '[语音消息]';
        if (looksLikeVideoUrl(url) || answerTypeFromContext(msg) === 3) return '[视频消息]';
        if (looksLikeImageUrl(url)) return '[图片消息]';
    }
  }
    const p = payload && typeof payload === 'object' ? payload : {};
    const url = pickText(p, ['url', 'mediaUrl', 'audioUrl', 'videoUrl']);
    if (url) {
      const type = String(msg.msgType || p?.msgType || p?.type || '').toUpperCase();
      if (type.includes('AUDIO') || looksLikeAudioUrl(url)) return '[语音消息]';
      if (type.includes('VIDEO') || looksLikeVideoUrl(url)) return '[视频消息]';
      if (type.includes('IMAGE') || looksLikeImageUrl(url)) return '[图片消息]';
    }
  }
  return text || '[空消息]';
}

type MediaInfo = { url: string; type: 'audio' | 'video' | 'image'; title: string; duration?: number } | null;

function looksLikeAudioUrl(url: string): boolean { return /\.(mp3|m4a|aac|amr|wav|ogg)(\?|$)/i.test(url.toLowerCase()); }
function looksLikeVideoUrl(url: string): boolean { return /\.(mp4|mov|m4v|3gp|webm)(\?|$)/i.test(url.toLowerCase()) || url.includes('.m3u8') || url.includes('.flv'); }
function looksLikeImageUrl(url: string): boolean { return /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url.toLowerCase()); }
function answerTypeFromContext(source: any): number {
  return Number(source?.answerType || source?.answerTypeConfig || source?.type || 0);
}

function extractDuration(source: any): number {
  const v = Number(source?.duration || source?.time || source?.second || source?.audioTime || source?.length || source?.playTime || source?.videoTime || 0);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function formatDur(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function collectPrivateMessageMediaCandidates(msg: any): any[] {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const candidates: any[] = [];

  const flipKeys = ['flipCardInfo', 'filpCardInfo', 'flipCardAudioInfo', 'filpCardAudioInfo', 'flipCardVideoInfo', 'filpCardVideoInfo'];

  function pushBody(source: any) {
    if (!source || typeof source !== 'object') return;
    candidates.push(source);
    for (const key of flipKeys) { if (source[key]) candidates.push(parseMaybeJson(source[key])); }
    for (const k of ['text', 'messageText', 'body', 'content']) {
      if (typeof source[k] === 'string') { const p = parseMaybeJson(source[k]); if (p && typeof p === 'object') candidates.push(p); }
    }
    if (Array.isArray(source.bodys)) {
      for (const b of source.bodys) { const parsed = typeof b === 'string' ? parseMaybeJson(b) : b; if (parsed) pushBody(parsed); }
    } else if (source.bodys && typeof source.bodys === 'object') {
      pushBody(source.bodys);
    }
    if (source.body && typeof source.body === 'object') pushBody(source.body);
    if (source.content && typeof source.content === 'object') pushBody(source.content);
  }

  if (content && typeof content === 'object') pushBody(content);
  if (msg && typeof msg === 'object') pushBody(msg);
  if (payload && typeof payload === 'object') pushBody(payload);

  const bodyRawCandidates = [];
  if (typeof msg?.bodys === 'string') bodyRawCandidates.push(msg.bodys);
  if (typeof content?.bodys === 'string') bodyRawCandidates.push(content.bodys);
  if (typeof msg?.body === 'string') bodyRawCandidates.push(msg.body);
  if (typeof content?.body === 'string') bodyRawCandidates.push(content.body);
  if (typeof msg?.content === 'string') bodyRawCandidates.push(msg.content);
  if (typeof msg?.msgContent === 'string') bodyRawCandidates.push(msg.msgContent);
  if (typeof msg?.message === 'string') bodyRawCandidates.push(msg.message);
  for (const raw of bodyRawCandidates) {
    const parsed = parseMaybeJson(raw);
    if (parsed) pushBody(parsed);
  }

  return candidates.filter(Boolean);
}

function makeMedia(url: string, type: 'audio' | 'video' | 'image', durSources: any[] = []): MediaInfo {
  const d = durSources.reduce((best, src) => best || extractDuration(src), 0);
  const titleMap: Record<string, string> = { audio: '语音消息', video: '视频消息', image: '图片消息' };
  return { url, type, title: titleMap[type] || '媒体消息', ...(d > 0 ? { duration: d } : {}) };
}

function privateMessageMedia(msg: any): MediaInfo {
  const content = msg?.content || {};
  const payload = messagePayload(msg) || {};
  const p = payload && typeof payload === 'object' ? payload : {};
  const candidates = collectPrivateMessageMediaCandidates(msg);

  for (const item of candidates) {
    let rawUrl = pickText(item, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'imageUrl', 'voiceUrl', 'mp4Url', 'playUrl', 'path', 'message.url', 'msg.url']);
    if (rawUrl) {
      const answerType = answerTypeFromContext(item);
      let url = normalizeUrl(rawUrl);
      if (!/^https?:\/\//i.test(url)) url = `${looksLikeImageUrl(url) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${url.replace(/^\//, '')}`;
      if (looksLikeAudioUrl(url) || (answerType === 2 && !looksLikeVideoUrl(url) && !looksLikeImageUrl(url))) return makeMedia(url, 'audio', [item, msg, content]);
      if (looksLikeVideoUrl(url) || (answerType === 3 && !looksLikeAudioUrl(url) && !looksLikeImageUrl(url))) return makeMedia(url, 'video', [item, msg, content]);
      if (looksLikeImageUrl(url)) return makeMedia(url, 'image', [item]);
      const type = String(msg.msgType || item?.msgType || item?.type || p?.msgType || p?.type || '').toUpperCase();
      if (type.includes('AUDIO') || type.includes('VOICE')) return makeMedia(url, 'audio', [item, msg]);
      if (type.includes('VIDEO')) return makeMedia(url, 'video', [item, msg]);
      if (type.includes('IMAGE')) return makeMedia(url, 'image', [item]);
      return makeMedia(url, 'image', []);
    }

    const answerRaw = item.answer || item.answerContent || '';
    if (answerRaw) {
      const parsed = typeof answerRaw === 'string' ? parseMaybeJson(answerRaw) : answerRaw;
      if (parsed && typeof parsed === 'object') {
        rawUrl = pickText(parsed, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
        if (rawUrl) {
          const answerType = answerTypeFromContext(item) || answerTypeFromContext(parsed) || answerTypeFromContext(content) || answerTypeFromContext(msg);
          let url2 = normalizeUrl(rawUrl);
          if (!/^https?:\/\//i.test(url2)) url2 = `${looksLikeImageUrl(url2) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${url2.replace(/^\//, '')}`;
          if (answerType === 2 || looksLikeAudioUrl(url2)) return makeMedia(url2, 'audio', [parsed, item, msg]);
          if (answerType === 3 || looksLikeVideoUrl(url2)) return makeMedia(url2, 'video', [parsed, item, msg]);
          if (looksLikeImageUrl(url2)) return makeMedia(url2, 'image', [parsed]);
          return makeMedia(url2, 'image', [parsed]);
        }
      }
    }
  }

  const rawText = String(msg?.body || msg?.bodys || msg?.msgContent || msg?.content || msg?.message || '');
  const urlMatch = rawText.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    const url3 = urlMatch[0];
    if (looksLikeAudioUrl(url3)) return makeMedia(url3, 'audio', [msg]);
    if (looksLikeVideoUrl(url3)) return makeMedia(url3, 'video', [msg]);
    if (looksLikeImageUrl(url3)) return makeMedia(url3, 'image', []);
  }

  const directAnswers = [
    payload?.answer, payload?.answerContent,
    content?.answer, content?.answerContent,
    msg?.answer, msg?.answerContent,
  ];
  for (const ans of directAnswers) {
    const pda = typeof ans === 'string' ? parseMaybeJson(ans) : ans;
    if (pda && typeof pda === 'object') {
      const daUrl = pickText(pda, ['url', 'mediaUrl', 'audioUrl', 'videoUrl', 'voiceUrl', 'mp4Url']);
      if (daUrl) {
        const daAt = answerTypeFromContext(pda) || answerTypeFromContext(msg) || answerTypeFromContext(content);
        let daNorm = normalizeUrl(daUrl);
        if (!/^https?:\/\//i.test(daNorm)) daNorm = `${looksLikeImageUrl(daNorm) ? 'https://source3.48.cn' : 'https://mp4.48.cn'}/${daNorm.replace(/^\//, '')}`;
        if (daAt === 2 || looksLikeAudioUrl(daNorm)) return makeMedia(daNorm, 'audio', [pda, msg]);
        if (daAt === 3 || looksLikeVideoUrl(daNorm)) return makeMedia(daNorm, 'video', [pda, msg]);
        if (looksLikeImageUrl(daNorm)) return makeMedia(daNorm, 'image', [pda]);
        return makeMedia(daNorm, 'image', [pda]);
      }
    }
  }

  return null;
}

function oldestFirst<T>(list: T[], timeOf: (item: T) => number): T[] { return list.slice().sort((a, b) => timeOf(a) - timeOf(b)); }

function flipTypeName(value: any) { const id = Number(value); if (id === 1) return '文字'; if (id === 2) return '语音'; if (id === 3) return '视频'; return `类型${value || ''}`; }
function lowestPrice(item: any) { return Math.min(...[item.normalCost, item.privateCost, item.anonymityCost].map(Number).filter((v: number) => isFinite(v) && v >= 0)); }

export default function PrivateMessagesScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const [convs, setConvs] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [uid, setUid] = useState('');
  const [prices, setPrices] = useState<any[]>([]);
  const [money, setMoney] = useState('');
  const [flipType, setFlipType] = useState(0);
  const [loading, setLoading] = useState(false);
  const [nextTime, setNextTime] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const [playUrl, setPlayUrl] = useState('');

  const member = useMemo(() => {
    if (!sel) return null;
    const id = convTargetId(sel);
    return members.find((m: any) => String(m.id) === id || String(m.userId) === id || String(m.memberId) === id) || null;
  }, [members, sel]);

  useEffect(() => { loadConvs(); }, []);

  useEffect(() => {
    if (!member) { setPrices([]); setMoney(''); return; }
    let a = true;
    (async () => {
      try {
        const [pr, mr] = await Promise.all([pocketApi.getFlipPrices(String(member.id)), pocketApi.getUserMoney().catch(() => null)]);
        if (!a) return;
        const list = unwrapList(pr, ['content.customs', 'content.list', 'data.customs', 'customs', 'list']);
        setPrices(list || []);
        setMoney(pickText(mr, ['content.moneyTotal', 'content.total', 'content.money', 'content.balance', 'data.moneyTotal', 'data.money', 'money', 'balance']) || '');
      } catch { if (a) setPrices([]); }
    })();
    return () => { a = false; };
  }, [member]);

  const loadConvs = async () => {
    setLoading(true);
    try {
      let cursor = Date.now();
      let all: any[] = [];
      let loops = 0;
      while (loops < 60) {
        const res = await pocketApi.getPrivateMessageList(cursor);
        const list = unwrapList(res, ['content.userMessageList', 'content.list', 'content.data', 'data.userMessageList', 'userMessageList', 'list']);
        const incoming = Array.isArray(list) ? list : [];
        all = all.concat(incoming.filter((it: any) => !all.find((a: any) => (convTargetId(a) || a.userMessageId) === (convTargetId(it) || it.userMessageId))));
        const nextCursor = Number(res?.content?.lastTime || res?.data?.lastTime || 0);
        if (!nextCursor || !incoming.length) break;
        cursor = nextCursor;
        loops += 1;
      }
      setConvs(all.slice().sort((a: any, b: any) => Number(b.lastTime || b.msgTime || 0) - Number(a.lastTime || a.msgTime || 0)));
    } catch (e) { showToast(`加载失败：${errorMessage(e)}`); }
    finally { setLoading(false); }
  };

  const openConv = async (c: any) => {
    setSel(c); setMsgs([]); setNextTime(0); setHasMore(false); setFlipType(0); setPlayUrl('');
    setLoading(true);
    try {
      if (!uid) {
        const info = await pocketApi.getNimLoginInfo().catch(() => null);
        const id = pickText(info, ['content.userInfo.userId', 'content.userId', 'id', 'userId']);
        if (id) setUid(String(id));
      }
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(c));
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'messageList', 'list']);
      const sorted = oldestFirst(list, msgTimeNumber);
      setMsgs(sorted);
      setNextTime(Number(res?.content?.nextTime || res?.data?.nextTime || 0));
      setHasMore(sorted.length > 0);
      setTimeout(() => flatRef.current?.scrollToEnd?.({ animated: false }), 150);
    } catch (e) { showToast(`加载失败：${errorMessage(e)}`); }
    finally { setLoading(false); }
  };

  const loadMore = async () => {
    if (!sel || loading || !hasMore || !nextTime) return;
    setLoading(true);
    try {
      const res = await pocketApi.getPrivateMessageDetail(convTargetId(sel), nextTime);
      const list = unwrapList(res, ['content.messageList', 'content.messages', 'content.list', 'messageList', 'list']);
      if (!list.length) { setHasMore(false); return; }
      const older = oldestFirst(list, msgTimeNumber);
      setMsgs((prev) => {
        const seen = new Set(prev.map((m, i) => msgId(m, i)));
        const dedupedOlder = older.filter((m, i) => !seen.has(msgId(m, i)));
        return oldestFirst([...dedupedOlder, ...prev], msgTimeNumber);
      });
      setNextTime(Number(res?.content?.nextTime || res?.data?.nextTime || 0));
      setHasMore(list.length > 0);
    } catch (e) { showToast(`历史加载失败：${errorMessage(e)}`); }
    finally { setLoading(false); }
  };

  const doSend = async () => {
    const txt = text.trim();
    if (!txt || !sel) return;
    setLoading(true);
    try {
      if (flipType && member) {
        const p = prices.find((x) => x.answerType === flipType);
        const cost = p ? (p.privateCost || p.normalCost || lowestPrice(p)) : 0;
        await pocketApi.sendFlipQuestion({
          memberId: parseInt(member.id, 10),
          content: txt,
          type: 2,
          cost,
          answerType: flipType,
        });
        showToast('翻牌已提交');
      } else {
        await pocketApi.sendPrivateMessageReply(convTargetId(sel), txt);
        showToast('已发送');
        await openConv(sel);
      }
      setText('');
    } catch (e) { showToast(`发送失败：${errorMessage(e)}`); }
    finally { setLoading(false); }
  };

  if (sel) {
    const targetId = convTargetId(sel);
    return (
      <View style={[styles.screen, isDark && styles.screenDark]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setSel(null)}><Text style={styles.back}>返回</Text></TouchableOpacity>
          <Text style={[styles.title, isDark && styles.light]} numberOfLines={1}>{convName(sel)}</Text>
          <View style={{ width: 54 }} />
        </View>
        <FlatList
          ref={flatRef}
          data={msgs}
          keyExtractor={(item, i) => msgId(item, i)}
          contentContainerStyle={styles.msgList}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          renderItem={({ item, index }) => {
            const mine = isMineMessage(item, targetId, uid);
            const media = privateMessageMedia(item);
            const txt = privateMessageText(item);
            const hasText = txt && !/^\[(语音|视频|图片|媒体|链接)消息\]$/.test(txt) && txt !== '[空消息]';
            const mediaLabel = media ? (formatDur(media.duration || 0) || (media.type === 'audio' ? '语音' : '视频')) : '';
            return (
              <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
                <View style={[styles.msgRow, mine && styles.msgRowMine]}>
                  <View style={[styles.bubble, mine && styles.bubbleMine, isDark && !mine && styles.bubbleDark]}>
                    {hasText ? <Text style={[styles.msgText, mine && styles.msgTextMine, isDark && !mine && styles.light]}>{txt}</Text> : null}
                    {media ? (
                      media.type === 'image' ? (
                        <Image source={{ uri: media.url }} style={styles.inlineImg} resizeMode="cover" />
                      ) : (
                        <TouchableOpacity style={styles.mediaBtn} onPress={() => setPlayUrl((p) => p === media.url ? '' : media.url)}>
                          <Text style={[styles.mediaBtnText, mine && styles.msgTextMine]}>{playUrl === media.url ? '收起' : `▶ ${mediaLabel}`}</Text>
                        </TouchableOpacity>
                      )
                    ) : !hasText ? <Text style={[styles.msgText, mine && styles.msgTextMine, isDark && !mine && styles.light]}>[空消息]</Text> : null}
                    {playUrl === media?.url ? (
                      <Video source={{ uri: media!.url }} style={media!.type === 'audio' ? styles.audio : styles.video} controls paused={false} resizeMode="contain" ignoreSilentSwitch="ignore" />
                    ) : null}
                    <Text style={[styles.msgTime, mine && styles.msgTimeMine, isDark && !mine && styles.light]}>{formatTimestamp(msgTimeNumber(item))}</Text>
                  </View>
                </View>
              </FadeInView>
            );
          }}
          ListEmptyComponent={<Text style={[styles.empty, isDark && styles.light]}>{loading ? '加载中...' : '暂无消息'}</Text>}
        />
        {member ? (
          <View style={[styles.flipBar, isDark && styles.flipBarDark]}>
            <Text style={[styles.flipName, isDark && styles.light]}>{member.ownerName} 翻牌</Text>
            <View style={styles.flipRow}>
              {prices.slice(0, 3).map((p) => (
                <TouchableOpacity key={p.answerType} style={[styles.flipChip, flipType === p.answerType && styles.flipChipOn]} onPress={() => setFlipType((v) => v === p.answerType ? 0 : p.answerType)}>
                  <Text style={[styles.flipChipT, flipType === p.answerType && styles.flipChipTOn, isDark && flipType !== p.answerType && styles.light]}>{flipTypeName(p.answerType)}·{lowestPrice(p)}</Text>
                </TouchableOpacity>
              ))}
              <View style={styles.flipSpacer} />
              {money ? <Text style={[styles.flipMoney, isDark && styles.light]}>余额 {money}</Text> : null}
              <TouchableOpacity style={styles.flipRechargeBtn} onPress={() => navigation.navigate('RechargeScreen')}>
                <Text style={styles.flipRechargeT}>充值</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <View style={[styles.inputBar, isDark && styles.inputBarDark]}>
          {flipType > 0 ? <Text style={styles.flipLabel}>私密翻牌·{flipTypeName(flipType)}</Text> : null}
          <View style={styles.inputRow}>
            <TextInput style={[styles.input, isDark && styles.inputDark]} placeholder="输入内容..." placeholderTextColor={isDark ? '#aaa' : '#999'} value={text} onChangeText={setText} multiline />
            <TouchableOpacity style={styles.sendBtn} onPress={doSend} disabled={loading || !text.trim()}>
              <Text style={styles.sendT}>{loading ? '..' : flipType ? '翻牌' : '发送'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>返回</Text></TouchableOpacity>
        <Text style={[styles.title, isDark && styles.light]}>私信列表</Text>
        <TouchableOpacity onPress={loadConvs}><Text style={styles.refreshBtn}>刷新</Text></TouchableOpacity>
      </View>
      <FadeInView delay={80} duration={300} style={{ flex: 1 }}>
        <FlatList
          data={convs}
          keyExtractor={(item, i) => String(convTargetId(item) || i)}
          renderItem={({ item, index }) => (
            <FadeInView delay={index < 12 ? 80 + index * 30 : 0} duration={300}>
              <TouchableOpacity style={[styles.convItem, isDark && styles.convItemDark]} onPress={() => openConv(item)}>
                <View style={styles.convInfo}>
                  <Text style={[styles.convName, isDark && styles.light]}>{convName(item)}</Text>
                  <Text style={[styles.convPrev, isDark && styles.light]} numberOfLines={1}>{item.newestMessage || '点击查看'}</Text>
                </View>
                {Number(item.noreadNum) > 0 ? <View style={styles.badge}><Text style={styles.badgeT}>{item.noreadNum}</Text></View> : null}
              </TouchableOpacity>
            </FadeInView>
          )}
          ListEmptyComponent={<Text style={[styles.empty, isDark && styles.light]}>{loading ? '加载中...' : '暂无私信'}</Text>}
        />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  screenDark: { backgroundColor: 'transparent' },
  topBar: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { color: '#ff6f91', fontSize: 14 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#ff6f91' },
  refreshBtn: { color: '#ff6f91', fontSize: 13 },
  light: { color: '#eee' },
  convItem: { padding: 14, backgroundColor: 'rgba(255,255,255,0.46)', marginHorizontal: 14, marginVertical: 3, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
  convItemDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  convInfo: { flex: 1 },
  convName: { fontSize: 15, fontWeight: '700', color: '#333' },
  convPrev: { fontSize: 12, color: '#555', marginTop: 4 },
  badge: { backgroundColor: '#ff4444', borderRadius: 16, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '700' },
  msgList: { paddingHorizontal: 8, paddingBottom: 8 },
  msgRow: { marginVertical: 2, alignItems: 'flex-start' },
  msgRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', padding: 10, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18 },
  bubbleMine: { backgroundColor: '#ff6f91' },
  bubbleDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  msgText: { fontSize: 14, color: '#333', lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  msgTime: { fontSize: 10, color: '#777', marginTop: 4 },
  msgTimeMine: { color: '#b35d6e' },
  mediaBtn: { marginTop: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.08)', alignSelf: 'flex-start' },
  mediaBtnText: { fontSize: 12, fontWeight: '800', color: '#ff6f91' },
  inlineImg: { width: 200, height: 200, marginTop: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.1)' },
  audio: { height: 48, minWidth: 200, marginTop: 4, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 10 },
  video: { height: 150, minWidth: 200, marginTop: 4, backgroundColor: '#000', borderRadius: 10 },
  flipBar: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.72)', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  flipBarDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderTopColor: 'rgba(255,255,255,0.08)' },
  flipName: { fontSize: 11, color: '#555', fontWeight: '700', marginBottom: 4 },
  flipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flipChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.06)' },
  flipChipOn: { backgroundColor: '#ff6f91' },
  flipChipT: { fontSize: 11, color: '#555', fontWeight: '700' },
  flipChipTOn: { color: '#fff' },
  flipSpacer: { flex: 1 },
  flipMoney: { fontSize: 11, color: '#ff6f91', fontWeight: '700' },
  flipRechargeBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#ff6f91' },
  flipRechargeT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  flipLabel: { fontSize: 10, color: '#ff6f91', fontWeight: '800', marginBottom: 2 },
  inputBar: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.72)', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  inputBarDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderTopColor: 'rgba(255,255,255,0.08)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, padding: 10, borderRadius: 18, borderWidth: 1, borderColor: '#ddd', color: '#333', fontSize: 14, maxHeight: 80 },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eee' },
  sendBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18, backgroundColor: '#ff6f91' },
  sendT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  empty: { textAlign: 'center', color: '#777', marginTop: 60, fontSize: 14 },
});
