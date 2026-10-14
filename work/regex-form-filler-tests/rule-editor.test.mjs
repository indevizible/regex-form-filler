import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { matchLabels } from '../../outputs/regex-form-filler/core.js';

const path = new URL('../../outputs/regex-form-filler/rule-editor.js', import.meta.url);
const editor = existsSync(path) ? await import(path) : {};
const draft = (source, mode = 'exact', answer = 'คำตอบ', answerType = 'single', flags = 'iu') => ({ source, mode, answer, answerType, flags });

test('literal exact and contains rules escape metacharacters and normalize Thai numbering', () => {
  assert.equal(typeof editor.ruleFromDraft, 'function', 'friendly conversion must exist');
  const exact = editor.ruleFromDraft(draft(' ๙) ชื่อ (จริง)+? * '));
  assert.deepEqual(exact, { pattern: '^ชื่อ \\(จริง\\)\\+\\?$', flags: 'iu', value: 'คำตอบ' });
  const contains = editor.ruleFromDraft(draft('ชื่อ (จริง)+?', 'contains'));
  assert.deepEqual(matchLabels([exact, contains], ['ชื่อ (จริง)+?', 'ชื่อ (จริง)+? เพิ่มเติม', 'ชื่อ จริง']), [[0, 1], [1], []]);
});

test('single answers preserve newlines; multiple answers ignore blank lines and reject duplicates', () => {
  assert.equal(typeof editor.ruleFromDraft, 'function');
  assert.equal(editor.ruleFromDraft(draft('ชื่อ', 'exact', 'บรรทัด 1\nบรรทัด 2')).value, 'บรรทัด 1\nบรรทัด 2');
  assert.deepEqual(editor.ruleFromDraft(draft('อาหาร', 'exact', ' ข้าว \r\n\nผัก', 'multiple')).value, ['ข้าว', 'ผัก']);
  assert.throws(() => editor.ruleFromDraft(draft('อาหาร', 'exact', 'ข้าว\nข้าว', 'multiple')), /ไม่ซ้ำ/);
  assert.throws(() => editor.ruleFromDraft(draft(' * ')), /ชื่อคำถาม/);
});

test('only reversible canonical patterns become friendly; complex regex and flags round-trip unchanged', () => {
  assert.equal(typeof editor.ruleToDraft, 'function');
  for (const [pattern, flags, mode] of [
    ['^ชื่อ \\(จริง\\)$', 'iu', 'exact'], ['เบอร์โทรศัพท์', 'iu', 'contains'],
    ['^(?!.*ฉุกเฉิน).*เบอร์โทรศัพท์.*$', 'mi', 'regex'], ['^ชื่อ$', '', 'regex'],
    ['^ชื่อ$', 'ui', 'regex'], ['^๙\\) ชื่อ$', 'iu', 'regex'], ['^a.*b$', 'iu', 'regex'],
    ['^a\\sb$', 'iu', 'regex'], ['^ชื่อ *$', 'iu', 'regex'], ['(?:ชื่อ)', 'iu', 'regex']
  ]) {
    const rule = { pattern, flags, value: 'เดิม' };
    const decoded = editor.ruleToDraft(rule);
    assert.equal(decoded.mode, mode, pattern);
    assert.deepEqual(editor.ruleFromDraft(decoded), rule);
    decoded.answer = 'ใหม่';
    assert.deepEqual(editor.ruleFromDraft(decoded), { ...rule, value: 'ใหม่' });
  }
});

test('editing only a match preserves imported array values that contain whitespace or newlines', () => {
  assert.equal(typeof editor.ruleToDraft, 'function');
  const rule = { pattern: '^อาหาร$', flags: 'iu', value: [' ข้าว ', 'ผัก\nผลไม้'] };
  const decoded = editor.ruleToDraft(rule);
  decoded.source = 'เมนู';
  assert.deepEqual(editor.ruleFromDraft(decoded, rule), { ...rule, pattern: '^เมนู$' });
});
