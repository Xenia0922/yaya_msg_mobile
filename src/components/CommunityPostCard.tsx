/**
 * CommunityPostCard · 社区帖子卡片（feed 与详情页共用）
 *
 * 布局（自上而下）：
 *   作者行（头像 + 昵称 + 时间）→ 标题 → 正文预览（numberOfLines 可配）→ 图片九宫格 → 数据行（浏览/点赞/评论）
 * 主题化：surface / hairline / label / labelSecondary / labelTertiary / tint 全部走 usePalette，
 * 与全站 iOS 26 卡片语言一致。
 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { NetworkImage } from './NetworkImage';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import { formatCount, formatTimestamp } from '../utils/format';
import { CommunityPost } from '../utils/community';

interface Props {
  post: CommunityPost;
  /** 正文最大行数；详情页传 0 表示不截断 */
  textLines?: number;
  onPress?: () => void;
  onImagePress?: (url: string) => void;
}

export default function CommunityPostCard({ post, textLines = 6, onPress, onImagePress }: Props) {
  const palette = usePalette();
  const { t } = useI18n();

  const body = (
    <>
      {/* 作者行 */}
      <View style={styles.headRow}>
        {post.avatar ? (
          <Image source={{ uri: post.avatar }} style={[styles.avatar, { backgroundColor: palette.fill3 }]} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: palette.fill3, alignItems: 'center', justifyContent: 'center' }]}>
            <MaterialCommunityIcons name="account" size={18} color={palette.labelTertiary} />
          </View>
        )}
        <Text style={[styles.name, { color: palette.label }]} numberOfLines={1}>{post.name}</Text>
        {post.time > 0 ? (
          <Text style={[styles.time, { color: palette.labelTertiary }]}>{formatTimestamp(post.time)}</Text>
        ) : null}
      </View>

      {post.title ? (
        <Text style={[styles.title, { color: palette.label }]} numberOfLines={textLines === 0 ? undefined : 3}>
          {post.title}
        </Text>
      ) : null}

      {post.text ? (
        <Text
          style={[styles.text, { color: palette.labelSecondary }]}
          numberOfLines={textLines === 0 ? undefined : textLines}
        >
          {post.text}
        </Text>
      ) : null}

      {post.images.length > 0 ? (
        <View style={[styles.imageGrid, post.images.length === 1 && styles.imageGridSingle]}>
          {post.images.map((url, idx) => (
            <TouchableOpacity
              key={`${post.postId}-img-${idx}`}
              activeOpacity={0.85}
              style={[styles.gridItem, post.images.length === 1 && styles.gridItemSingle]}
              onPress={() => onImagePress?.(url)}
            >
              <NetworkImage source={{ uri: url }} style={styles.gridImage} resizeMode="cover" />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {(post.viewCount > 0 || post.likeCount > 0 || post.commentCount > 0) ? (
        <View style={styles.statsRow}>
          {post.viewCount > 0 ? (
            <View style={styles.statItem}>
              <MaterialCommunityIcons name="eye-outline" size={13} color={palette.labelTertiary} />
              <Text style={[styles.statText, { color: palette.labelTertiary }]}>{formatCount(post.viewCount)}</Text>
            </View>
          ) : null}
          {post.likeCount > 0 ? (
            <View style={styles.statItem}>
              <MaterialCommunityIcons name="heart-outline" size={13} color={palette.labelTertiary} />
              <Text style={[styles.statText, { color: palette.labelTertiary }]}>{formatCount(post.likeCount)}</Text>
            </View>
          ) : null}
          {post.commentCount > 0 ? (
            <View style={styles.statItem}>
              <MaterialCommunityIcons name="comment-outline" size={13} color={palette.labelTertiary} />
              <Text style={[styles.statText, { color: palette.labelTertiary }]}>{t('评论')} {formatCount(post.commentCount)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    marginVertical: 4,
    marginHorizontal: 4,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, marginRight: 9, overflow: 'hidden' },
  name: { flex: 1, fontSize: 13, fontWeight: '700' },
  time: { fontSize: 11, marginLeft: 8 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 21, marginBottom: 5 },
  text: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  imageGridSingle: { flexDirection: 'row' },
  gridItem: { flexBasis: '31%', flexGrow: 1, aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  gridItemSingle: { flexBasis: '58%', flexGrow: 0, aspectRatio: 16 / 10 },
  gridImage: { width: '100%', height: '100%' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 11 },
});
