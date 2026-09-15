/**
 * 口袋48 云信（NIM）通道封装。
 *
 * 逆向自官方 口袋48 7.1.39（见各文件头注释）：
 *   直播弹幕（收/发） → 云信聊天室（Chatroom）
 *   私信/会话（收发） → 云信群组会话（NIM Team）
 *   房间消息         → 云信圈组（QChat，官方仅 Android/iOS SDK 支持，RN 侧需原生桥接）
 *
 * 唯一入口：本目录下的 LiveChatroom / 相关 helper。
 */

export * from './types';
export * from './codec';
export * from './runtime';
export * from './chatroom';
export * from './credentials';
export * from './qchat';
