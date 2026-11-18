import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier/flat';

/**
 * ESLint flat config（ESLint 9 + TypeScript 5.9）。
 *
 * 设计原则：先建立可落地的门禁，历史噪声大的规则降级为 warn/off，
 * 不要求一次性修复存量代码。业务代码（src/）只通过 lint 检查，不做全量 --fix。
 */
export default tseslint.config(
  {
    // 与本次质量门禁无关的目录不参与 lint（lint 脚本限定 src/，这里再兜底）
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'docs/**',
      'assets/**',
      'APK/**',
      'member-db/**',
      'scratch/**',
      '_internal/**',
      '.expo/**',
      'scripts/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // --- 任务要求必须启用的规则 ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript 使用 @typescript-eslint/no-unused-vars；基础 no-unused-vars
      // 会把类型签名里的参数名误报成未使用变量（本项目存量约 200 条噪声）。
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-undef': 'off', // TypeScript 编译器负责未定义检查
      // `smart` 允许有意为之的 `== null`（同时匹配 null/undefined），其余比较必须严格。
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',

      // --- 历史噪声大的规则先放宽，避免门禁不可落地 ---
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'warn',
      // 以下规则在存量代码中大量命中（require 静态资源、空 catch、正则转义等），
      // 一次性修复风险高且不属于本次范围，先关闭，后续按目录逐步启用。
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-constant-binary-expression': 'off',
      'no-extra-boolean-cast': 'off',

      // --- React 基础规则：仅保留 JSX 变量使用标记，其余关闭 ---
      'react/jsx-uses-react': 'off', // React 17+ 自动 JSX runtime
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-vars': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    // runtimeLog 本体就是日志落盘/转发实现，内部 console 是设计的一部分（不能递归写回自己）。
    files: ['src/utils/runtimeLog.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // 登录/签名器先于 runtimeLog 初始化，且调试输出受 __DEV__ 控制；
    // 这里允许其直接使用 console，避免低层鉴权模块反向依赖应用日志模块。
    files: ['src/auth/**/*.{ts,tsx}'],
    rules: { 'no-console': 'off' },
  },
  // eslint-config-prettier 必须放最后，关闭与 Prettier 冲突的格式类规则
  prettierConfig,
);
