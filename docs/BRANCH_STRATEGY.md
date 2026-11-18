# 分支策略

## 分支职责

### `public`

应用正式源码与发布分支。

- 完整 App 源码（`src/`、`android/`、`App.tsx` 等）
- `android-apk.yml` / `quality.yml`
- Release tag 与 GitHub Release 发布包
- 日常开发、CI、打包均在此分支

### `main`

数据分支，只保留旧客户端仍会访问的成员库与相关 workflow。

建议保留：

```text
member-db/**
.github/workflows/member-db-sync.yml
.github/workflows/official-members.yml
README.md          # 简短说明这是数据分支
LICENSE
```

删除：

```text
src/
android/
App.tsx
app.json
index.ts
assets/（仅 App 使用的资源）
其他 App 构建文件
```

保留 `member-db/dist/members.json` 的原因：v2.7.7 及更早客户端将成员库地址硬编码为 `@main`，删除会导致旧客户端成员库 404。

## 发布

- App 新版本继续在 `public` 分支开发、打 tag、上传 GitHub Release。
- App 内更新检查读取 GitHub Releases，不依赖 `main` 的 App 源码。
- `main` 的成员库更新继续由 `member-db-sync.yml` / `official-members.yml` 负责。

## 自动更新说明

当前两个成员库 workflow 的 GitHub Actions 定时任务已停用：Actions 出口 IP 会被上游数据源 WAF 拦截。需要真正自动更新时，应由境内 relay 或本地环境定时执行，GitHub Actions 只保留手动触发与提交入口。

## 迁移步骤

1. 确认 `public` 是 GitHub 默认分支，避免访客进入数据分支。
2. 从 `main` 移除 App 源码，只保留成员库、数据 workflow、README/License。
3. 保护 `main` 只允许成员库相关提交；保护 `public` 作为发布分支。
4. 保留 `v2.7.7` 及之前旧客户端的 `@main/member-db/dist/members.json` 路径不变。
