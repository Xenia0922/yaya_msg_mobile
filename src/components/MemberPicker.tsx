import React, { useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMemberStore, useSettingsStore } from '../store';
import { Member } from '../types';
import { normalizeMember, memberSearchText } from '../utils/members';

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
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const members = useMemberStore((state) => state.members);
  const membersLoaded = useMemberStore((state) => state.membersLoaded);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const list = members.filter((member) => memberSearchText(member).includes(q));
    return list.slice(0, limit);
  }, [members, query, limit]);

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={placeholder}
        placeholderTextColor={isDark ? '#aaa' : '#5a5a5a'}
        value={query}
        onChangeText={setQuery}
      />
      {selectedMember ? <Text style={styles.selected}>已选择：{selectedMember.ownerName}</Text> : null}
      {!membersLoaded ? <Text style={[styles.hint, isDark && styles.hintDark]}>成员数据加载中...</Text> : null}
      <FlatList
        data={filtered}
        horizontal
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        style={styles.list}
        renderItem={({ item }) => {
          const active = selectedMember?.id === item.id;
          return (
            <TouchableOpacity
              style={[styles.chip, isDark && styles.chipDark, active && styles.chipActive]}
              onPress={() => onSelect(normalizeMember(item))}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, isDark && styles.chipTextDark, active && styles.chipTextActive]}>
                {memberShortName(item)}
              </Text>
              {item.team ? <Text style={[styles.team, isDark && styles.teamDark, active && styles.teamActive]}>{item.team}</Text> : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={[styles.hint, isDark && styles.hintDark]}>{query.trim() ? (membersLoaded ? '没有匹配成员' : '暂无成员数据') : '搜索成员...'}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8, paddingHorizontal: 14 },
  input: {
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: 'rgba(255,255,255,0.38)',
    color: '#333',
  },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: '#444', color: '#eeeeee' },
  selected: { fontSize: 13, color: '#ff6f91' },
  list: { maxHeight: 58 },
  chip: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(238,238,238,0.82)',
    marginRight: 8,
  },
  chipDark: { backgroundColor: 'rgba(42,42,42,0.52)' },
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 12, color: '#444', fontWeight: '600' },
  chipTextDark: { color: '#cccccc' },
  chipTextActive: { color: '#fff' },
  team: { fontSize: 9, color: '#333333', marginTop: 2 },
  teamDark: { color: '#cccccc' },
  teamActive: { color: '#d47082' },
  hint: { color: '#333333', fontSize: 12, paddingVertical: 8 },
  hintDark: { color: '#cccccc' },
});
