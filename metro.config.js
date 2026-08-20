const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 保留 wasm 资源扩展名支持
config.resolver.assetExts.push('wasm');

module.exports = config;
