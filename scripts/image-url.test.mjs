import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/utils/imageThumb.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports });
const { normalizeImageHost, thumbUrl, buildImageFallbackCandidates } = module.exports;

assert.equal(
  normalizeImageHost('https://source2.48.cn/2020/a.jpg'),
  'https://source1.48.cn/2020/a.jpg',
);
assert.equal(
  normalizeImageHost('http://source3.48.cn/2020/b.png'),
  'https://source1.48.cn/2020/b.png',
);
assert.equal(
  normalizeImageHost('https://source.48.cn/2020/c.jpg'),
  'https://source.48.cn/2020/c.jpg',
);
assert.equal(
  normalizeImageHost('http://source.48.cn/2020/d.jpg'),
  'https://source.48.cn/2020/d.jpg',
);
assert.equal(
  normalizeImageHost('http:\\/\\/kd48-nosdn.yunxinsvr.com\\/abc.jpg'),
  'https://kd48-nosdn.yunxinsvr.com/abc.jpg',
);
assert.equal(
  normalizeImageHost('http://nim-nosdn.netease.im/foo/bar.png'),
  'https://nim-nosdn.netease.im/foo/bar.png',
);
assert.equal(normalizeImageHost('https://mp4.48.cn/video.mp4'), 'https://mp4.48.cn/video.mp4');
assert.equal(
  thumbUrl('https://source2.48.cn/2020/a.jpg', 180),
  'https://source1.48.cn/resize_180x180/2020/a.jpg',
);
assert.equal(
  thumbUrl('http://kd48-nosdn.yunxinsvr.com/img/a.jpg', 360),
  'https://kd48-nosdn.yunxinsvr.com/img/a.jpg?imageView&thumbnail=360x0',
);
assert.equal(
  thumbUrl('https://nim-nosdn.netease.im/img/a.jpg?Signature=abc&Expires=123', 360),
  'https://nim-nosdn.netease.im/img/a.jpg?Signature=abc&Expires=123',
);

const pocketCandidates = buildImageFallbackCandidates('https://source.48.cn/2026/01/pic.jpg');
assert.equal(pocketCandidates[0].uri, 'https://source.48.cn/2026/01/pic.jpg');
assert.equal(pocketCandidates[0].headerMode, 'pocket');
assert.equal(pocketCandidates[1].uri, 'https://source1.48.cn/2026/01/pic.jpg');
assert.equal(pocketCandidates[1].headerMode, 'pocket');
assert.equal(pocketCandidates[2].uri, 'https://source1.48.cn/resize_1600x1600/2026/01/pic.jpg');
assert.equal(pocketCandidates[3].uri, 'https://source1.48.cn/resize_800x800/2026/01/pic.jpg');
assert.equal(
  pocketCandidates.some(
    (c) => c.uri === 'https://source.48.cn/2026/01/pic.jpg' && c.headerMode === 'none',
  ),
  true,
);

const nosCandidates = buildImageFallbackCandidates('http://kd48-nosdn.yunxinsvr.com/obj/123');
assert.equal(nosCandidates[0].uri, 'https://kd48-nosdn.yunxinsvr.com/obj/123');
assert.equal(nosCandidates[0].headerMode, 'ua');
assert.equal(
  nosCandidates.some(
    (c) => c.uri === 'https://kd48-nosdn.yunxinsvr.com/obj/123?imageView&thumbnail=1600x0&type=jpg',
  ),
  true,
);
assert.equal(
  nosCandidates.some(
    (c) => c.uri === 'http://kd48-nosdn.yunxinsvr.com/obj/123' && c.headerMode === 'none',
  ),
  true,
);
console.log('图片 CDN 域名回退测试通过');
