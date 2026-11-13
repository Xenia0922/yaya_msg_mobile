const forge = require('node-forge');

// 口袋客户端密码协议使用的公开兼容常量，账号密码不会存入本地设置。
const PROTOCOL_KEY = '7yy4tjcw12aipo2c';

export function validateRegistrationPassword(password: string, confirmation: string): string {
  if (password.length < 6) return '密码至少需要 6 位';
  if (password.length > 1024) return '密码过长';
  if (password !== confirmation) return '两次输入的密码不一致';
  return '';
}

export function encryptPocketPassword(password: string): string {
  const error = validateRegistrationPassword(password, password);
  if (error) throw new Error(error);
  const cipher = forge.cipher.createCipher('AES-ECB', forge.util.createBuffer(PROTOCOL_KEY, 'utf8'));
  cipher.start();
  cipher.update(forge.util.createBuffer(password, 'utf8'));
  if (!cipher.finish()) throw new Error('密码处理失败');
  return forge.util.encode64(cipher.output.getBytes());
}
