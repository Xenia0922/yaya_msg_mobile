import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import pocketApi from '../api/pocket48';
import type { RoomSticker } from '../services/pocketNim/qchat';
import { usePalette } from '../theme';
import { errorMessage, normalizeUrl, pickText, unwrapList } from '../utils/data';
import emojiAssets from '../utils/emojiAssets';
import { ALLOW_VIP_STICKERS, VIP_FEATURE_NOTICE } from '../constants/identityFeatures';

type Group = { name: string; vip: boolean; stickers: RoomSticker[] };
type Item = { key: string; emoji?: string; sticker?: RoomSticker };

export default function RoomStickerPanel({ channelId, ownerId, onEmoji, onSticker, disabled }: {
  channelId: string; ownerId: string; onEmoji: (tag: string) => void;
  onSticker: (sticker: RoomSticker) => void; disabled: boolean;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const tabHeight = Math.max(44, Math.ceil(12 * fontScale * 2 + 20));
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setGroups([]); setSelected(0); setLoading(true); setError('');
    (async () => {
      const room = await pocketApi.getRoomInfo(channelId).catch(() => null);
      const owner = pickText(room, ['content.channelInfo.ownerId', 'content.ownerId', 'data.channelInfo.ownerId'], ownerId);
      const serverTypeValue = Number(pickText(room, ['content.groupServer.serverType', 'content.channelInfo.serverType', 'content.serverType', 'data.groupServer.serverType', 'data.channelInfo.serverType'], '1'));
      const serverType = Number.isFinite(serverTypeValue) ? serverTypeValue : 1;
      const res = await pocketApi.getRoomExpressionList(owner, serverType);
      const next = unwrapList(res, ['content', 'content.list', 'data.content', 'data.list', 'list']).map((group: any): Group => {
        const vip = Number(group?.vipStatus) === 1;
        const items = Array.isArray(group?.expressionSourceResp) ? group.expressionSourceResp : [];
        return {
          name: String(group?.typeName || '表情包'), vip,
          stickers: items.map((item: any) => ({ sourceName: String(item?.sourceName || ''), sourcePath: String(item?.sourcePath || ''), width: Number(item?.width) || 0, height: Number(item?.height) || 0, vip })).filter((item: RoomSticker) => !!item.sourcePath),
        };
      }).filter((group: Group) => group.stickers.length > 0 && (!group.vip || ALLOW_VIP_STICKERS));
      if (alive) setGroups(next);
    })().catch((err) => { if (alive) setError(errorMessage(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [channelId, ownerId]);

  const items = useMemo<Item[]>(() => selected === 0
    ? Object.keys(emojiAssets).map((emoji) => ({ key: emoji, emoji }))
    : (groups[selected - 1]?.stickers || []).map((sticker, i) => ({ key: `${i}-${sticker.sourcePath}`, sticker })), [groups, selected]);
  return (
    <View style={[styles.panel, { height: 166 + tabHeight }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabs, { height: tabHeight }]} contentContainerStyle={styles.tabContent}>
        {['基础表情', ...groups.map((g) => `${g.name}${g.vip ? ' · VIP' : ''}`)].map((name, i) => (
          <TouchableOpacity key={`${i}-${name}`} onPress={() => setSelected(i)} style={[styles.tab, { backgroundColor: selected === i ? palette.tint : palette.fill3 }]}>
            <Text style={{ color: selected === i ? palette.onTint : palette.label, fontSize: 12 }} numberOfLines={1}>{name}</Text>
          </TouchableOpacity>
        ))}
        {loading ? <ActivityIndicator size="small" color={palette.tint} /> : null}
      </ScrollView>
      {error ? <Text style={{ color: palette.labelSecondary, fontSize: 11, marginHorizontal: 12 }} numberOfLines={1}>表情包加载失败：{error}</Text> : null}
      {selected > 0 && groups[selected - 1]?.vip ? <Text style={{ color: palette.labelSecondary, fontSize: 10, marginHorizontal: 4 }}>免责声明：{VIP_FEATURE_NOTICE}</Text> : null}
      <FlatList
        key={selected === 0 ? 'emoji' : 'stickers'} data={items} numColumns={5} keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="always" nestedScrollEnabled initialNumToRender={20} windowSize={3}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.cell} disabled={disabled} onPress={() => item.emoji ? onEmoji(item.emoji) : item.sticker && onSticker(item.sticker)} accessibilityLabel={item.emoji || item.sticker?.sourceName || '发送表情包'}>
            <Image source={item.emoji ? emojiAssets[item.emoji] : { uri: normalizeUrl(item.sticker?.sourcePath) }} style={selected === 0 ? styles.emoji : styles.sticker} resizeMode="contain" />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12 },
  tabs: { flexGrow: 0, flexShrink: 0 }, tabContent: { alignItems: 'center', gap: 6, paddingVertical: 5 },
  tab: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  cell: { width: '20%', height: 62, alignItems: 'center', justifyContent: 'center' },
  emoji: { width: 32, height: 32 }, sticker: { width: 52, height: 52 },
});
