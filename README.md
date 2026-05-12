# 牙牙消息 (Yaya Message)

基于 [yk1z/yaya_msg](https://github.com/yk1z/yaya_msg) 二次开发的 React Native 移动端客户端。

---

### 平台支持

| 平台 | 状态 |
|------|------|
| Android | 可用 |
| iOS | 开发中 |
| HarmonyOS | 开发中 |

---

### 功能

- 口袋48 关注房间 & 历史消息
- 私信会话 & 翻牌发送
- 直播播放 (ExoPlayer RTMP/HLS)
- 翻牌记录 & 统计分析
- 鸡腿余额查询 & 充值
- 成员档案 & 相册
- 电台 & 音乐库
- 自动签到

---

### 构建

```bash
cd yaya_msg-mobile
npm install
$env:JAVA_HOME = "path/to/jdk"
$env:ANDROID_HOME = "path/to/android/sdk"
cd android
.\gradlew.bat assembleRelease
```

APK 输出在 `android/app/build/outputs/apk/release/`

---

### 致谢

感谢 [OpenAI](https://openai.com) 及 [DeepSeek](https://deepseek.com) 的技术支持。

---

### 说明

本项目仍在开发中，可能存在未修复的 Bug，敬请谅解。

**presented by Xenia**
