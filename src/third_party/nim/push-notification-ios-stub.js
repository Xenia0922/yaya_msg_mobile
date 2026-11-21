

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
