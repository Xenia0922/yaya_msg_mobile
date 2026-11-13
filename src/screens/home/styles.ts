/**
 * 首页共享样式（C4-S3）。
 *
 * 从 HomeScreen 原样搬迁而来，供 HomeScreen 与各 *Module 组件共用，
 * 保证抽模块后视觉零变化（同一套 styles.*）。
 */
import { StyleSheet } from 'react-native';
import { spacing } from '../../theme';

export const styles = StyleSheet.create({
  outer: { flex: 1 },
  /** 区块外层：统一水平留白 + 区块间距 16（v2.7 压缩，原 24 偏宽） */
  sectionOuter: {
    paddingHorizontal: spacing.md,
    marginBottom: 12,
  },
  loginBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  // 首页全宽直播 banner（16:9 沉浸）
  liveBanner: { width: '100%' },
  liveBannerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  liveBannerCover: { width: '100%', height: '100%' },
  liveBannerFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveBannerShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '66%' },
  liveBannerBadge: { top: 12, left: 12 },
  liveBannerInfo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12 },
  liveBannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 24, textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  liveBannerNick: { color: 'rgba(255,255,255,0.88)', fontSize: 12, marginTop: 3, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  bannerDots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
  /** 指示点等宽槽位：active 横条与小点中心距均匀（防止横条与相邻点视觉错位） */
  dotSlot: { width: 16, alignItems: 'center' },
  /** 直播行卡：surface + hairline 圆角 16 */
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  liveRowThumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveRowTitle: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  liveRowNick: { fontSize: 12, marginTop: 3, lineHeight: 16 },
  // 公演直播：呼吸状态点（直播中 success 呼吸）
  gongyanDotWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gongyanDot: { width: 8, height: 8, borderRadius: 4 },
  liveStateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  liveStateText: { flex: 1, fontSize: 13, lineHeight: 18 },
  // 快捷入口胶囊
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 46,
    paddingHorizontal: 4,
    gap: 4,
  },
  /** 工具 chip：左右留白更大 + 不压缩文字，保证「鸡腿榜 / 数据库」完整显示 */
  toolChip: { paddingHorizontal: 10, justifyContent: 'flex-start' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickCell: {},
  quickCellInner: { width: '100%' },
  chipIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chipText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
  miniBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  musicCover: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  toolChipsContent: {
    paddingRight: 8,
    gap: 8,
    paddingHorizontal: spacing.md,
    // 防横向 ScrollView 高度塌缩：显式 minHeight + 垂直居中，保证图标不被截断
    alignItems: 'center',
    minHeight: 46,
  },
});
