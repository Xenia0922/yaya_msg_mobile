// 第三方类型补齐：react-native-vector-icons 的子路径（如 MaterialCommunityIcons）
// 在本工程 TS 配置下缺少 .d.ts 声明，触发 TS7016。声明为 any 即可消除，
// 不影响运行（图标库在运行时由 JS 正常加载）。
declare module 'react-native-vector-icons/MaterialCommunityIcons';
