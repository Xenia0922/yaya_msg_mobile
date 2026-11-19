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
const { normalizeImageHost, thumbUrl } = module.exports;

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
assert.equal(normalizeImageHost('https://mp4.48.cn/video.mp4'), 'https://mp4.48.cn/video.mp4');
assert.equal(
  thumbUrl('https://source2.48.cn/2020/a.jpg', 180),
  'https://source1.48.cn/resize_180x180/2020/a.jpg',
);
console.log('图片 CDN 域名回退测试通过');
