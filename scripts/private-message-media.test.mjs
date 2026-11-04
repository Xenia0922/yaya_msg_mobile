import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/utils/mediaUrl.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { normalizePrivateMediaUrl, deepFindImageUrl, isImageLikeUrl } = sandbox.exports;

// 绝对地址：原样（http 升级 https）
assert.equal(normalizePrivateMediaUrl('https://source.48.cn/a/b.jpg', 'source'), 'https://source.48.cn/a/b.jpg');
assert.equal(normalizePrivateMediaUrl('http://source.48.cn/a/b.jpg', 'source'), 'https://source.48.cn/a/b.jpg');
// 相对路径：图片走 source，音视频走 mp4（与桌面版一致）
assert.equal(normalizePrivateMediaUrl('/filesystem/upload/x.jpg', 'source'), 'https://source.48.cn/filesystem/upload/x.jpg');
assert.equal(normalizePrivateMediaUrl('2026/11/pic.jpg', 'source'), 'https://source.48.cn/2026/11/pic.jpg');
assert.equal(normalizePrivateMediaUrl('/mediasource/a.webp', 'mp4'), 'https://source.48.cn/mediasource/a.webp');
assert.equal(normalizePrivateMediaUrl('voice/a.mp3', 'mp4'), 'https://mp4.48.cn/voice/a.mp3');

// imgUrl 是私信图片的实际字段名（桌面版优先读它）
const message = { messageType: 'IMAGE', imgUrl: '/filesystem/upload/2026/11/03/abc.jpg', imgWidth: 1080, imgHeight: 1440 };
assert.ok(isImageLikeUrl(message.imgUrl));
assert.equal(deepFindImageUrl(message), message.imgUrl, '必须能从 imgUrl 取到图片地址');
// 包在 imageInfo / pictureInfo 里的也能找到
assert.equal(
  deepFindImageUrl({ messageType: 'IMAGE', content: { imageInfo: JSON.stringify({ imgUrl: 'https://source.48.cn/x.png' }) } }),
  'https://source.48.cn/x.png',
);
assert.equal(deepFindImageUrl({ bodys: JSON.stringify({ picUrl: 'https://source.48.cn/y.png' }) }), 'https://source.48.cn/y.png');
assert.equal(deepFindImageUrl({ text: 'hello' }), '', '没有图片地址时返回空串');
// 头像/徽章不是本条消息的媒体：纯文字私信不能被渲染成对方头像
assert.equal(
  deepFindImageUrl({ messageType: 'TEXT', text: '在吗', user: { avatar: 'https://source.48.cn/avatar/u1.jpg' } }),
  '',
  '用户头像不能被当成消息图片',
);
assert.equal(
  deepFindImageUrl({ messageType: 'TEXT', text: '在吗', starInfo: { headImg: 'https://source.48.cn/avatar/u2.jpg' } }),
  '',
  '成员头像不能被当成消息图片',
);
// 带 query 的地址仍能按扩展名识别
assert.ok(isImageLikeUrl('https://source.48.cn/a.jpg?x=1'));
assert.ok(!isImageLikeUrl('https://source.48.cn/a.mp4'));
console.log('私信图片解析（imgUrl / imageInfo / source 域名）测试通过');
