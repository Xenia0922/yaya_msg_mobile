/**
 * 内置云信 Web/RN SDK（@yxim/nim-web-sdk 9.21.14 · dist/SDK/NIM_Web_SDK_rn.js）
 * 是 CommonJS 产物（module.exports = { NIM, Chatroom, ... }），此处仅声明类型为 any，
 * 避免 TS 对 vendor 文件做类型推导。
 */
declare module '*/NIM_Web_SDK_rn.js' {
  const SDK: any;
  export default SDK;
}
