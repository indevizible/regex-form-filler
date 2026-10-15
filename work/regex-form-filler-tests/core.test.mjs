import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLabel, parseRules, validateRules, matchLabels, isFormUrl, LIMITS } from '../../outputs/regex-form-filler/core.js';

const rule = (pattern, value = 'ทดสอบ', flags = 'iu') => ({ pattern, flags, value });
test('normalization handles Thai/Arabic numbering, whitespace, required marks and NFC', () => {
  assert.equal(normalizeLabel(' ๙)\u00a0 เบอร์โทรศัพท์ \n * '), 'เบอร์โทรศัพท์');
  assert.equal(normalizeLabel('9. เบอร์โทรศัพท์ *'), 'เบอร์โทรศัพท์');
  assert.equal(normalizeLabel('12) E-mail'), 'E-mail');
  assert.equal(normalizeLabel('10 ปีที่ผ่านมา'), '10 ปีที่ผ่านมา');
  assert.equal(normalizeLabel('3.14 คะแนน'), '3.14 คะแนน');
  assert.equal(normalizeLabel('1.5 ลิตร'), '1.5 ลิตร');
  assert.equal(normalizeLabel('Cafe\u0301'), 'Café');
});
test('strict schema rejects bad syntax/flags/values/unknown fields and enforces limits', () => {
  assert.deepEqual(validateRules([{ pattern: '^ชื่อจริง$', value: 'ทดสอบ' }]), [rule('^ชื่อจริง$')]);
  for (const input of [null, {}, [rule('')], [rule('[')], [rule('x', 'a', 'g')], [rule('x', 'a', 'y')],
    [rule('x', 'a', 'ii')], [rule('x', 12)], [rule('x', [])], [rule('x', ['a', 'a'])],
    [rule('x', [''])], [{ ...rule('x'), unexpected: true }], [rule('x'.repeat(513))],
    [rule('x', 'a'.repeat(8193))], Array.from({ length: 101 }, () => rule('x'))]) {
    assert.throws(() => validateRules(input));
  }
  assert.deepEqual(parseRules('[]'), []);
  assert.throws(() => parseRules('not json'));
  assert.throws(() => parseRules(' '.repeat(LIMITS.json + 1)));
  assert.throws(() => matchLabels([], ['a'.repeat(LIMITS.label + 1)]));
});
test('old objects escape literal keywords, anchor them, and only relax the health clarification', () => {
  const rules = parseRules(JSON.stringify({ ' 2. ชื่อ (จริง)+? * ': 'ทดสอบ', 'โรคประจำตัว': 'ข้อมูลสมมติ', 'เบอร์โทรศัพท์': '0000000000' }));
  assert.deepEqual(matchLabels(rules, ['ชื่อ (จริง)+?', 'ชื่อ จริง', 'ชื่อ (จริง)+? เพิ่มเติม', 'โรคประจำตัว (หากมี โปรดระบุ ...)', 'โรคประจำตัวอื่น', 'เบอร์โทรศัพท์ฉุกเฉิน']), [[0], [], [], [1], [], []]);
  assert.throws(() => parseRules('{" * ":"x"}'));
  assert.equal(parseRules('{"__proto__":"x"}')[0].pattern, '^__proto__$');
});
test('own and emergency phone rules are distinct; broad overlapping rules are reported', () => {
  const titles = ['9. เบอร์โทรศัพท์', '13. เบอร์โทรศัพท์บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน'];
  const rules = [rule('^(?!.*ฉุกเฉิน).*เบอร์โทรศัพท์.*$'), rule('^.*เบอร์โทรศัพท์.*ฉุกเฉิน.*$')];
  assert.deepEqual(matchLabels(rules, titles), [[0], [1]]);
  assert.deepEqual(matchLabels([...rules, rule('เบอร์โทรศัพท์')], titles), [[0, 2], [1, 2]]);
});
test('URL allowlist accepts response/preview paths and rejects edit/results/lookalikes', () => {
  for (const path of ['/forms/d/e/abc-123/viewform', '/forms/u/0/d/e/abc/viewform?usp=pp_url', '/forms/d/abc/preview', '/forms/u/2/d/abc/previewResponse', '/forms/d/e/abc/formResponse']) {
    assert.equal(isFormUrl(`https://docs.google.com${path}`), true, path);
  }
  for (const url of ['https://docs.google.com/forms/d/abc/edit', 'https://docs.google.com/forms/d/abc/edit#responses',
    'https://docs.google.com/forms/d/abc/viewanalytics', 'https://docs.google.com.evil.test/forms/d/a/viewform',
    'http://docs.google.com/forms/d/a/viewform', 'https://docs.google.com:444/forms/d/a/viewform',
    'https://docs.google.com/forms/d/a/edit/viewform', 'https://docs.google.com/forms/d/a/viewform/extra',
    'https://forms.google.com/forms/d/a/viewform', 'file:///forms/d/a/viewform', 'invalid']) assert.equal(isFormUrl(url), false, url);
});
test('manifest has release icons, only the three required permissions and valid synthetic examples', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../outputs/regex-form-filler/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '1.6.0');
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  for (const [size, path] of Object.entries(manifest.icons)) {
    assert.equal(path, `icons/icon-${size}.png`);
    const png = await readFile(new URL(`../../outputs/regex-form-filler/${path}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), Number(size), path);
    assert.equal(png.readUInt32BE(20), Number(size), path);
  }
  assert.deepEqual(manifest.action.default_icon, { '16': manifest.icons['16'], '32': manifest.icons['32'], '48': manifest.icons['48'] });
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.commands['fill-form'].suggested_key.mac, 'Option+Shift+F');
  assert.equal(manifest.commands['fill-form'].suggested_key.default, 'Alt+Shift+F');
  const examples = parseRules(await readFile(new URL('../../outputs/regex-form-filler/example-rules.json', import.meta.url), 'utf8'));
  assert.equal(examples.length, 13);
  assert.deepEqual(examples.filter(rule => rule.value?.type === 'date').map(rule => rule.value.textFormat), [undefined, 'thai-long', 'thai-short']);
});
