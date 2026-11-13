const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 保留 wasm 资源扩展名支持
config.resolver.assetExts.push('wasm');

// 云信 RN SDK（src/third_party/nim/NIM_Web_SDK_rn.js）在模块顶层硬 require 了
// @react-native-community/push-notification-ios。牙牙是 Android-only 且不使用云信离线推送，
// 这里把它重定向到本地空实现，避免为此引入一个用不到的 iOS 原生依赖。
const pushNotificationIosStub = path.resolve(
  __dirname,
  'src/third_party/nim/push-notification-ios-stub.js'
);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@react-native-community/push-notification-ios') {
    return { filePath: pushNotificationIosStub, type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
