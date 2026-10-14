import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { matchWithTimeout } from '../../outputs/regex-form-filler/matcher.js';
import { fileRule } from './file-test-helpers.mjs';

let terminations = 0;
globalThis.Worker = class {
  constructor(url) {
    this.worker = new NodeWorker(new URL('./worker-harness.mjs', import.meta.url), { workerData: { module: url.href } });
    this.worker.on('message', data => this.onmessage({ data }));
    this.worker.on('error', () => this.onerror({ preventDefault() {} }));
  }
  postMessage(value) { this.worker.postMessage(value); }
  terminate() { terminations++; void this.worker.terminate(); }
};
test('bundled worker matches and is terminated after completion', async () => {
  assert.deepEqual(await matchWithTimeout([{ pattern: '^ชื่อจริง$', value: 'ทดสอบ' }], ['2. ชื่อจริง *']), [[0]]);
  assert.equal(terminations, 1);
});
test('catastrophic regex is terminated on a real worker thread; caller stays responsive', async () => {
  let ticks = 0;
  const clock = setInterval(() => ticks++, 20);
  try {
    await assert.rejects(matchWithTimeout([{ pattern: '(a+)+$', value: '' }], ['a'.repeat(1500) + '!']), /1\.5/);
    assert.ok(ticks > 5);
    assert.equal(terminations, 2);
    assert.deepEqual(await matchWithTimeout([{ pattern: '^ok$', value: '' }], ['ok']), [[0]]);
  } finally { clearInterval(clock); }
});

test('date: real worker validates and matches typed dates, rejects nonexistent dates', async () => {
  const rule = { pattern: '^วันเกิด$', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' } };
  assert.deepEqual(await matchWithTimeout([rule], ['วันเกิด', 'วันเกิด', 'อื่น']), [[0], [0], []]);
  await assert.rejects(matchWithTimeout([{ ...rule, value: { ...rule.value, iso: '1900-02-29' } }], ['วันเกิด']), /ตรวจ regex ไม่สำเร็จ/);
});

test('file: bundled worker matches metadata refs and rejects attached bytes', async () => {
  assert.deepEqual(await matchWithTimeout([fileRule()], ['Upload', 'Else']), [[0], []]);
  const rule = fileRule(); rule.value.bytes = 'dGVzdA==';
  await assert.rejects(matchWithTimeout([rule], ['Upload']), /ตรวจ regex ไม่สำเร็จ/);
});
