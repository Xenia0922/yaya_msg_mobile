// 极简 PNG 解码：仅解析 IHDR/IDAT，inflate + 反滤波，采样指定点像素
// 用法: node png-sample.js <file.png> <x1,y1,x2,y2,...>
const fs = require('fs');
const zlib = require('zlib');

const buf = fs.readFileSync(process.argv[2]);
if (buf.readUInt32BE(0) !== 0x89504e47) { console.log('not png'); process.exit(1); }
let pos = 8;
let w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.slice(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0); h = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9];
  } else if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
const stride = w * ch;
const px = Buffer.alloc(h * stride);
let prev = Buffer.alloc(stride);
let off = 0;
for (let y = 0; y < h; y++) {
  const filter = raw[off++];
  const line = raw.slice(off, off + stride);
  off += stride;
  const out = px.slice(y * stride, (y + 1) * stride);
  for (let i = 0; i < stride; i++) {
    const a = i >= ch ? out[i - ch] : 0;
    const b = prev[i];
    const c = i >= ch ? prev[i - ch] : 0;
    let v = line[i];
    if (filter === 1) v = (v + a) & 0xff;
    else if (filter === 2) v = (v + b) & 0xff;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    out[i] = v;
  }
  prev = out;
}
const sample = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return 'out';
  const i = y * stride + x * ch;
  return `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`;
};
console.log(`PNG ${w}x${h} ch=${ch} bit=${bitDepth}`);
const pts = (process.argv[3] || '').split(';').filter(Boolean);
for (const p of pts) {
  const [x, y] = p.split(',').map(Number);
  console.log(`(${x},${y}) -> ${sample(x, y)}`);
}
