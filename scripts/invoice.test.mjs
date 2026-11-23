import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/utils/invoice.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports });
const { parseInvoiceFeeCents, sumSelectedInvoiceCents, formatInvoiceCents } = module.exports;

assert.equal(parseInvoiceFeeCents('68'), 6800);
assert.equal(parseInvoiceFeeCents('¥1,234.50'), 123450);
assert.equal(parseInvoiceFeeCents('￥0.1'), 10);
assert.equal(parseInvoiceFeeCents('-10'), 0);
assert.equal(parseInvoiceFeeCents('invalid'), 0);
assert.equal(parseInvoiceFeeCents(null), 0);

const orders = [
  { selected: true, totalFee: '0.1' },
  { selected: true, totalFee: '0.2' },
  { selected: false, totalFee: '999.00' },
  { selected: true, totalFee: '¥1,000.55' },
  { selected: true, totalFee: '' },
];
const totalCents = sumSelectedInvoiceCents(orders);
assert.equal(totalCents, 100085);
assert.equal(formatInvoiceCents(totalCents), '1000.85');
assert.equal(formatInvoiceCents(0), '0.00');
assert.equal(formatInvoiceCents(-5), '0.00');

console.log('发票累计金额计算测试通过');
