/**
 * `@react-native-community/push-notification-ios` 的空实现。
 *
 * 内置的云信 RN SDK（NIM_Web_SDK_rn.js）在模块顶层硬 require 这个 iOS 推送库，
 * 但牙牙是 Android-only 工程、也不使用云信离线推送，因此用本文件替换掉，
 * 避免为了一个未使用的 iOS 依赖引入原生包（映射见 metro.config.js）。
 */

const noop = () => undefined;

const pushNotificationIOS = {
  configure: noop,
  requestPermissions: () => Promise.resolve({ alert: false, badge: false, sound: false }),
  getInitialNotification: () => Promise.resolve(null),
  addEventListener: () => ({ remove: noop }),
  removeAllDeliveredNotifications: noop,
  removeDeliveredNotifications: noop,
  setApplicationIconBadgeNumber: noop,
  getApplicationIconBadgeNumber: () => Promise.resolve(0),
  cancelAllLocalNotifications: noop,
  cancelLocalNotifications: noop,
  getDeliveredNotifications: () => Promise.resolve([]),
  addNotificationRequest: noop,
  setNotificationCategories: noop,
  getNotificationCategories: () => Promise.resolve([]),
};

module.exports = pushNotificationIOS;
module.exports.default = pushNotificationIOS;
