import React, { useMemo, useState } from 'react';
import { PerfFlatList } from './PerfFlatList';
import { CenterSpinner } from './Loaders';

import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useMemberStore } from '../store';
import { Member } from '../types';
import { normalizeMember, memberSearchText, isRoomMember } from '../utils/members';
import { useI18n } from '../i18n';
import { usePalette, radii, spacing } from '../theme';
import { typography } from '../theme/typography';
import { Pill } from './Pill';

interface MemberPickerProps {
  selectedMember: Member | null;
  onSelect: (_member: Member) => void;
  placeholder?: string;
  limit?: number;
  activeOnly?: boolean;
}

function memberShortName(member: Member): string {
  return member.ownerName.split('-').pop() || member.ownerName;
}

export default function MemberPicker({
  selectedMember,
  onSelect,
  placeholder = '搜索成员...',
  limit = 80,
  activeOnly = false,
}: MemberPickerProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const members = useMemberStore((state) => state.members);
  const membersLoaded = useMemberStore((state) => state.membersLoaded);
  const [query, setQuery] = useState('');
  const ph = placeholder === '搜索成员...' ? t('搜索成员...') : placeholder;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const list = members.filter(
      (member) => (!activeOnly || isRoomMember(member)) && memberSearchText(member).includes(q),
    );
    return list.slice(0, limit);
  }, [members, query, limit, activeOnly]);

  const select = (member: Member) => {
    onSelect(normalizeMember(member));
    Keyboard.dismiss();
  };

  return (
    <View style={[styles.wrapper, { paddingHorizontal: spacing.md }]}>
      <View
        style={[
          styles.search,
          {
            backgroundColor: palette.surfaceGlassStrong,
            borderColor: palette.innerStroke,
            borderRadius: radii.md,
          },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={18} color={palette.labelTertiary} />
        <TextInput
          style={[styles.input, { color: palette.label }]}
          placeholder={ph}
          placeholderTextColor={palette.labelTertiary}
          accessibilityLabel={ph}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity
            onPress={() => {
              setQuery('');
              Keyboard.dismiss();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('清除搜索')}
          >
            <MaterialCommunityIcons name="close-circle" size={16} color={palette.labelTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {selectedMember ? (
        <Text
          style={[typography.footnote, { color: palette.tint, fontWeight: '600' }]}
          numberOfLines={1}
        >
          {t('已选择：{name}', { name: selectedMember.ownerName })}
        </Text>
      ) : null}
      {!membersLoaded ? <CenterSpinner /> : null}
      <PerfFlatList
        data={filtered}
        horizontal
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        style={styles.list}
        renderItem={({ item }) => {
          const active = selectedMember?.id === item.id;
          return (
            <View style={{ marginRight: spacing.xs }}>
              <Pill
                label={`${memberShortName(item)}${item.team ? ` · ${item.team}` : ''}`}
                selected={active}
                onPress={() => select(item)}
                style={styles.chip}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          /* ⚠️ 查询为空时不渲染任何文字（修复）：
             此前这里回退成 placeholder 原文 → 输入框的占位符 + 下方空态文字**一模一样**，
             同一句话在一屏出现两遍（鸡腿榜「成员贡献」页实测截图）。 */
          query.trim() ? (
            <Text
              style={[
                typography.footnote,
                { color: palette.labelTertiary, paddingVertical: spacing.xs },
              ]}
            >
              {membersLoaded ? t('没有匹配成员') : t('暂无成员数据')}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 15, padding: 0, minHeight: 42 },
  list: { maxHeight: 58 },
  chip: {
    minWidth: 72,
    paddingHorizontal: 12,
  },
});
