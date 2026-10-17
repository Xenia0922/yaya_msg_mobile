/**
 * v3.0 成员选择面板（可复用）
 *
 * 旧版每个页面各自摆一套 MemberPicker（输入框 + chips 常驻两行），一屏被吃掉 88dp。
 * v3 统一为：工具条一个「当前成员 ▾」→ 点开底部面板 → 搜索（支持拼音）→ 选中即关。
 * 相册 / 照片 / 动态 / 档案 / 抓取 共用这一个。
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

import { useMemberStore } from '../../store';
import { useI18n } from '../../i18n';
import { usePalette } from '../../theme';
import { memberSearchText } from '../../utils/members';
import type { Member } from '../../types';

import { Divider } from '../layout/primitives';
import { GUTTER, R, SPACE, TYPE } from '../tokens';

/** 工具条上的触发器 */
export function MemberTrigger({ member, onPress, placeholder }: { member: Member | null; onPress: () => void; placeholder?: string }) {
  const palette = usePalette();
  const { t } = useI18n();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.trigger}>
      <Text style={[TYPE.secondary, { color: member ? palette.label : palette.labelTertiary }]} numberOfLines={1}>
        {member?.ownerName || placeholder || t('选择成员')}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={16} color={palette.labelTertiary} />
    </Pressable>
  );
}

export function MemberSheet({
  visible, onClose, onPick, title,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (m: Member) => void;
  title?: string;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((s) => s.members);
  const [query, setQuery] = useState('');

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Member[];
    return members.filter((m) => memberSearchText(m).includes(q)).slice(0, 40);
  }, [members, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: palette.surfaceElevated }]}>
        <View style={styles.handle} />
        <Text style={[TYPE.title, { color: palette.label, paddingHorizontal: GUTTER, paddingTop: SPACE.md }]}>
          {title || t('选择成员')}
        </Text>
        <View style={[styles.searchRow, { borderBottomColor: palette.hairline }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder={t('输入成员名，支持拼音')}
            placeholderTextColor={palette.labelTertiary}
            style={[TYPE.body, styles.input, { color: palette.label }]}
            autoCorrect={false}
          />
        </View>
        {query.trim() ? (
          hits.length ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: SPACE.lg }}>
              {hits.map((m, i) => (
                <View key={m.id}>
                  <Pressable
                    // ⚠️ 延迟 120ms 再关闭：Modal 若在抬手前卸载，这一次点击会**穿透**到下层的
                    // Pressable（实测点成员后跳到了首页工具区的「账号」）。这段时间弹层仍在，能吃掉 touch-up。
                    onPress={() => {
                      const picked = m;
                      setTimeout(() => { setQuery(''); onPick(picked); }, 120);
                    }}
                    style={styles.row}
                  >
                    <Text style={[TYPE.body, { flex: 1, color: palette.label }]} numberOfLines={1}>{m.ownerName}</Text>
                    <Text style={[TYPE.caption, { color: palette.labelTertiary }]} numberOfLines={1}>{String((m as any).team || '')}</Text>
                  </Pressable>
                  {i < hits.length - 1 ? <Divider inset={GUTTER} /> : null}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.hint}><Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>{t('没有匹配成员')}</Text></View>
          )
        ) : (
          <View style={styles.hint}><Text style={[TYPE.secondary, { color: palette.labelTertiary }]}>{t('输入成员名，支持拼音')}</Text></View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, maxWidth: 180 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.35)', marginTop: SPACE.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: GUTTER, height: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, padding: 0 },
  row: { height: 48, paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  hint: { padding: SPACE.xl },
});
