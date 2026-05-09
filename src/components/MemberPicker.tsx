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
import { normalizeMember } from '../utils/members';

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
    const list = q
      ? members.filter((member) => {
          const short = memberShortName(member).toLowerCase();
          return (
            member.ownerName.toLowerCase().includes(q) ||
            short.includes(q) ||
            (member.pinyin || '').toLowerCase().includes(q) ||
            (member.team || '').toLowerCase().includes(q) ||
            (member.groupName || '').toLowerCase().includes(q) ||
            String(member.id).includes(q)
          );
        })
      : members;

    return list.slice(0, limit);
  }, [members, query, limit]);

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={[styles.input, isDark && styles.inputDark]}
        placeholder={placeholder}
        placeholderTextColor="#5a5a5a"
        value={query}
        onChangeText={setQuery}
      />
      {selectedMember ? <Text style={styles.selected}>已选择：{selectedMember.ownerName}</Text> : null}
      {!membersLoaded ? <Text style={styles.hint}>成员数据加载中...</Text> : null}
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
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect(normalizeMember(item))}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {memberShortName(item)}
              </Text>
              {item.team ? <Text style={[styles.team, active && styles.teamActive]}>{item.team}</Text> : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.hint}>{membersLoaded ? '没有匹配成员' : '暂无成员数据'}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  input: {
    padding: 12,
    borderRadius: 18,
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
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 12, color: '#444', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  team: { fontSize: 9, color: '#333333', marginTop: 2 },
  teamActive: { color: '#ffe8ef' },
  hint: { color: '#333333', fontSize: 12, paddingVertical: 8 },
});
