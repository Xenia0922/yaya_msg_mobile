/**
 * 补丁：@kesha-antonov/react-native-chat 内部的 <SafeAreaProvider> → SafeAreaInsetsContext.Provider(零 insets)
 *
 * 背景：库的 Chat 自己包一层 react-native-safe-area-context 的 <SafeAreaProvider>
 * （lib/Chat/index.js，注释说明它刻意种零 insets，因为导航器已经为屏幕留过边距）。
 * 但本工程（RN 0.83 新架构）里 RNCSafeAreaProvider 这个原生视图**没有注册**，
 * 一渲染就 FATAL：Can't find ViewManager 'RNCSafeAreaProvider'。
 *
 * 解法：用纯 JS 的 SafeAreaInsetsContext 提供同样的零 insets —— 效果等价、不碰原生视图。
 *
 * 幂等：已在安装后（npm/expo install）重跑一次即可；`node scripts/patch-chat-safearea.js`
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(
  __dirname,
  '../node_modules/@kesha-antonov/react-native-chat/lib/Chat/index.js',
);
const MARK = '/* yymsg-patch: safearea */';

if (!fs.existsSync(FILE)) {
  console.log('[patch-chat-safearea] 目标文件不存在，跳过（未安装该库？）');
  process.exit(0);
}

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes(MARK)) {
  console.log('[patch-chat-safearea] 已打过补丁，跳过');
  process.exit(0);
}

// 1) 导入 SafeAreaInsetsContext（保留 SafeAreaProvider 的导入，避免影响其他引用）
if (!src.includes('SafeAreaInsetsContext')) {
  src = src.replace(
    /import \{ SafeAreaProvider, initialWindowMetrics \} from 'react-native-safe-area-context';/,
    `import { SafeAreaProvider, SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';`,
  );
}

// 2) 用 insets context 替换 provider
const providerRe = /<SafeAreaProvider initialMetrics=\{INITIAL_SAFE_AREA_METRICS\}>([\s\S]*?)<\/SafeAreaProvider>/;
if (!providerRe.test(src)) {
  console.log('[patch-chat-safearea] 未找到 SafeAreaProvider 用法（库版本可能变了），未修改');
  process.exit(1);
}

src = src.replace(
  providerRe,
  `${MARK} 用零 insets 的 context 替代原生 SafeAreaProvider（本工程该原生视图未注册）\n` +
    `    <SafeAreaInsetsContext.Provider value={ZERO_INSETS_YYMSG}>\n$1\n    </SafeAreaInsetsContext.Provider>`,
);

// 3) 定义常量
if (!src.includes('ZERO_INSETS_YYMSG')) {
  console.log('[patch-chat-safearea] 替换失败');
  process.exit(1);
}
src = src.replace(
  /const INITIAL_SAFE_AREA_METRICS = \{/,
  `const ZERO_INSETS_YYMSG = { top: 0, bottom: 0, left: 0, right: 0 };\nconst INITIAL_SAFE_AREA_METRICS = {`,
);

fs.writeFileSync(FILE, src);
console.log('[patch-chat-safearea] 补丁已应用 ✓');
