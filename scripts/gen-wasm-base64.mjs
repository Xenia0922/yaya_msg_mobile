// 从 assets/2.wasm 重新生成 src/auth/wasmBase64.ts，保证「原生通道」与「WebView 兜底」
// 两份 wasm 字节完全一致，杜绝双份漂移导致的偶发签名失败。
//
// 使用：node scripts/gen-wasm-base64.mjs
// 改完 assets/2.wasm 后必须重跑本脚本，并把打印出的 SHA256 钉进 src/auth/wasmHash.ts 的 WASM_SHA256。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = process.cwd();
const wasmPath = path.join(root, 'assets', '2.wasm');
const outPath = path.join(root, 'src', 'auth', 'wasmBase64.ts');

const wasm = fs.readFileSync(wasmPath);
const b64 = wasm.toString('base64');
const sha256 = crypto.createHash('sha256').update(wasm).digest('hex');

const content = `// AUTO-GENERATED from assets/2.wasm — DO NOT EDIT BY HAND.
// Regenerate with: node scripts/gen-wasm-base64.mjs
// Keep src/auth/wasmHash.ts WASM_SHA256 in sync with this file.
const wasmBase64 = '${b64}';

export default wasmBase64;
`;

fs.writeFileSync(outPath, content);
console.log('Wrote', outPath, `(${b64.length} base64 chars)`);
console.log('SHA256 =', sha256);
console.log('-> 把上面这行 SHA256 钉进 src/auth/wasmHash.ts 的 WASM_SHA256 常量');
