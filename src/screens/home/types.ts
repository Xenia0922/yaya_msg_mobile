/**
 * 首页模块共享展示类型（C4-S3）。
 * 仅类型定义，无运行时代码；供 HomeScreen 与各 *Module 组件共用。
 */

/** 首页快捷入口 / 工具 chips 的条目（title 已翻译） */
export interface NavItem {
  title: string;
  desc: string;
  route: string;
  params?: any;
  icon: string;
}

/** 成员直播卡数据（由 HomeScreen 的 normalizeLiveList 归一化后传入） */
export interface LiveCardItem {
  liveId: string;
  title: string;
  nickname: string;
  cover: string;
  /** 主播用户 id（用于关注/置顶优先排序；接口字段多态） */
  userId: string;
}
