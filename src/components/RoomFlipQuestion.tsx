import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePalette } from '../theme';
import { normalizeUrl } from '../utils/data';
import { getRoomFlipUser, type RoomFlipUser } from '../services/roomFlipUser';

export default function RoomFlipQuestion({ question, questionId, answerId, token, mine, onOpenProfile }: {
  question: string; questionId: string; answerId: string; token: string; mine: boolean;
  onOpenProfile: (user: { id: string; name: string; avatar: string }) => void;
}) {
  const palette = usePalette();
  const [user, setUser] = useState<RoomFlipUser | null>(null);
  useEffect(() => {
    let active = true;
    setUser(null);
    if (token && questionId && answerId) void getRoomFlipUser(token, questionId, answerId).then((value) => { if (active) setUser(value); });
    return () => { active = false; };
  }, [token, questionId, answerId]);
  const visible = user?.visibility === 'public' ? user : null;
  const name = user?.visibility === 'anonymous' ? '匿名用户' : visible?.name || '用户';
  const avatar = visible?.avatar ? normalizeUrl(visible.avatar) : '';
  return (
    <View style={[styles.card, { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : palette.fill2, borderLeftColor: mine ? palette.onTint : palette.tint }]}>
      <TouchableOpacity disabled={!visible?.userId} onPress={() => visible?.userId && onOpenProfile({ id: visible.userId, name, avatar })} style={styles.header}>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : null}
        <Text style={[styles.name, { color: mine ? palette.onTint : visible?.userId ? palette.tint : palette.labelSecondary }]}>{name} · 翻牌提问</Text>
      </TouchableOpacity>
      {question ? <Text style={[styles.question, { color: mine ? palette.onTint : palette.label }]}>{question}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 9, borderLeftWidth: 3, borderRadius: 9, marginBottom: 7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  avatar: { width: 20, height: 20, borderRadius: 10 },
  name: { fontSize: 12, fontWeight: '600' },
  question: { marginTop: 4, fontSize: 13, lineHeight: 18 },
});
