import React, { useMemo, useState } from 'react';
import { PerfFlatList } from './PerfFlatList';
import { CenterSpinner } from './Loaders';

import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMemberStore } from '../store';
import { Member } from '../types';
import { normalizeMember, memberSearchText } from '../utils/members';
import { useI18n } from '../i18n';
import { usePalette, radii, spacing } from '../theme';
import { typography } from '../theme/typography';
import { Pill } from './Pill';

interface MemberPickerProps {
  selectedMember: Member | null;
  onSelect: (member: Member) => void;
  placeholder?: string;
  limit?: number;
}

function memberShortName(member: Member): string {
  return member.ownerName.split('-').pop() || member.ownerName;
}

export default function MemberPicker({
  selectedMember,
  onSelect,
  placeholder = '搜索成员...',
  limit = 80,
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
    const list = members.filter((member) => memberSearchText(member).includes(q));
    return list.slice(0, limit);
  }, [members, query, limit]);

  return (
    <View style={[styles.wrapper, { paddingHorizontal: spacing.md }]}>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: palette.surfaceGlassStrong,
            borderColor: palette.innerStroke,
            color: palette.label,
            borderRadius: radii.md,
          },
        ]}
        placeholder={ph}
        placeholderTextColor={palette.labelTertiary}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />
      {selectedMember ? (
        <Text style={[typography.footnote, { color: palette.tint, fontWeight: '600' }]}>
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
                onPress={() => onSelect(normalizeMember(item))}
                style={styles.chip}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={[typography.footnote, { color: palette.labelTertiary, paddingVertical: spacing.xs }]}>
            {query.trim() ? (membersLoaded ? t('没有匹配成员') : t('暂无成员数据')) : ph}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  input: {
    padding: 10,
    borderWidth: 1,
  },
  list: { maxHeight: 58 },
  chip: {
    minWidth: 72,
    paddingHorizontal: 12,
  },
});
