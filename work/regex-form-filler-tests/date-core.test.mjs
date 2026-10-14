import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../outputs/regex-form-filler/core.js';
import { ruleFromDraft, ruleToDraft } from '../../outputs/regex-form-filler/rule-editor.js';

const date = (iso = '2000-02-29', textCalendar = 'buddhist') => ({ type: 'date', iso, textCalendar });
const rule = value => ({ pattern: '^วันเกิด$', flags: 'iu', value });

test('date: Buddhist and Gregorian input produce the same ISO and explicit text calendar', () => {
  assert.equal(typeof core.parseDateAnswer, 'function');
  assert.deepEqual(core.parseDateAnswer('29/02/2543', 'buddhist', 'buddhist'), date());
  assert.deepEqual(core.parseDateAnswer('29/2/2000', 'gregorian', 'buddhist'), date());
  assert.deepEqual(core.parseDateAnswer('2/1/2543', 'buddhist', 'gregorian'), date('2000-01-02', 'gregorian'));
  assert.equal(core.formatDateAnswer(date()), '29/02/2543');
  assert.equal(core.formatDateAnswer(date('2000-02-29', 'gregorian')), '29/02/2000');
});

test('date: validate real leap days and four-digit bounds without the Date 0–99 year trap', () => {
  for (const iso of ['2000-02-29', '2024-02-29', '0001-01-01', '0004-02-29', '0099-12-31', '9456-12-31']) {
    assert.deepEqual(core.validateRules([rule(date(iso))]), [rule(date(iso))]);
  }
  for (const iso of ['1900-02-29', '2023-02-29', '2000-04-31', '2000-02-30', '2000-00-10', '2000-13-10',
    '2000-01-00', '2000-01-32', '0000-01-01', '9457-01-01', '10000-01-01', '2000-2-29', ' 2000-02-29', '2000-02-29T00:00:00Z']) {
    assert.throws(() => core.validateRules([rule(date(iso))]), /วันที่|ปี|ISO/, iso);
  }
  assert.equal(core.formatDateAnswer(date('0001-01-01')), '01/01/0544');
  assert.equal(core.formatDateAnswer(date('9456-12-31')), '31/12/9999');
});

test('date: strict object keys, types, calendars and input format reject invalid data', () => {
  for (const value of [{}, null, { ...date(), extra: true }, { type: 'date', iso: '2000-02-29' },
    { ...date(), [Symbol('unknown')]: true }, Object.defineProperty(date(), 'hidden', { value: true }),
    { ...date(), type: 'birthday' }, { ...date(), iso: 20000229 }, { ...date(), textCalendar: 'thai' },
    { ...date(), textCalendar: null }, { ...date(), textCalendar: true }]) assert.throws(() => core.validateRules([rule(value)]));
  assert.equal(typeof core.parseDateAnswer, 'function');
  for (const input of ['29/02/2443', '29/02/2566', '31/04/2543', '0/1/2543', '1/13/2543', '1/1/0543',
    '1/1/543', '2000-02-29', '29-02-2543', '๒๙/๐๒/๒๕๔๓', '1/1/10000', '', ' 1/1/2543', '1/1/2543\n']) {
    assert.throws(() => core.parseDateAnswer(input, 'buddhist', 'buddhist'), /วันที่|ปี|DD\/MM\/YYYY/, input);
  }
  assert.throws(() => core.parseDateAnswer('29/2/2000', 'guess', 'buddhist'), /ปี/);
  assert.throws(() => core.parseDateAnswer('29/2/2000', 'gregorian', 'guess'), /textCalendar/);
});

test('date: clones typed values and preserves old literal strings/arrays through JSON and matching', () => {
  const original = [rule(date()), { ...rule('29/02/2543'), pattern: '^เก่า$' }, { ...rule([' A ', 'B\nC']), pattern: '^เลือก$' }];
  const validated = core.validateRules(original);
  assert.deepEqual(validated, original);
  assert.notEqual(validated[0].value, original[0].value);
  validated[0].value.iso = '2024-01-01';
  assert.equal(original[0].value.iso, '2000-02-29');
  assert.deepEqual(core.parseRules(JSON.stringify(original)), original);
  assert.deepEqual(core.matchLabels(original, ['วันเกิด', 'เก่า', 'เลือก']), [[0], [1], [2]]);
});

test('date: editor round-trips date/output calendar and keeps raw regex, old answers literal', () => {
  const draft = { mode: 'exact', source: 'วันเกิด', flags: 'iu', answerType: 'date', answer: 'ignored',
    date: '29/2/2543', inputCalendar: 'buddhist', textCalendar: 'buddhist' };
  assert.deepEqual(ruleFromDraft(draft), rule(date()));
  const original = { pattern: '^(?=a\r\nb)a\\s+b$', flags: 'msu', value: date('0004-02-29', 'gregorian') };
  const decoded = ruleToDraft(original);
  assert.equal(decoded.answerType, 'date');
  assert.equal(decoded.date, '29/02/0547');
  assert.equal(decoded.inputCalendar, 'buddhist');
  assert.equal(decoded.textCalendar, 'gregorian');
  assert.deepEqual(ruleFromDraft(decoded, original), original);
  assert.equal(ruleToDraft(rule('29/02/2543')).answerType, 'single');
  assert.throws(() => ruleFromDraft({ ...draft, date: '29/2/2566' }), /วันที่/);
});

test('thai-format: requested April date supports three formats and independent calendars', () => {
  for (const [calendar, year] of [['buddhist', '2533'], ['gregorian', '1990']]) {
    for (const [textFormat, expected] of [['numeric', `18/04/${year}`], ['thai-long', `18 เมษายน ${year}`], ['thai-short', `18 เม.ย. ${year}`]]) {
      const value = { ...date('1990-04-18', calendar), textFormat };
      assert.deepEqual(core.parseDateAnswer('18/4/2533', 'buddhist', calendar, textFormat), value);
      assert.deepEqual(core.parseDateAnswer('18/4/1990', 'gregorian', calendar, textFormat), value);
      assert.equal(core.formatDateAnswer(value), expected);
    }
  }
});

test('thai-format: all twelve Thai months use unpadded days, ordinary spaces and Arabic numerals', () => {
  const months = [
    ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
    ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
    ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.']
  ];
  for (const [index, [long, short]] of months.entries()) {
    for (const [calendar, year] of [['buddhist', '2543'], ['gregorian', '2000']]) {
      const value = date(`2000-${String(index + 1).padStart(2, '0')}-02`, calendar);
      assert.equal(core.formatDateAnswer({ ...value, textFormat: 'thai-long' }), `2 ${long} ${year}`);
      assert.equal(core.formatDateAnswer({ ...value, textFormat: 'thai-short' }), `2 ${short} ${year}`);
    }
  }
});

test('thai-format: optional omission and explicit formats clone and round-trip without metadata changes', () => {
  for (const textFormat of [undefined, 'numeric', 'thai-long', 'thai-short']) {
    const value = { ...date(), ...(textFormat === undefined ? {} : { textFormat }) };
    const cloned = core.validateDateAnswer(value);
    assert.deepEqual(cloned, value);
    assert.notEqual(cloned, value);
    assert.deepEqual(core.parseRules(JSON.stringify([rule(value)])), [rule(value)]);
    assert.equal(Object.hasOwn(cloned, 'textFormat'), textFormat !== undefined);
  }
  assert.equal(core.formatDateAnswer(date('1990-04-18')), '18/04/2533');
  assert.equal(core.formatDateAnswer(date('1990-04-18', 'gregorian')), '18/04/1990');
});

test('thai-format: strict own keys reject invalid formats, missing required keys and named-month input', () => {
  for (const textFormat of ['thai', '', 'THAI-LONG', 'DD MMM YYYY', null, undefined, 1, true, [], {}, new String('numeric')]) {
    assert.throws(() => core.validateDateAnswer({ ...date(), textFormat }), /textFormat/);
    if (textFormat !== undefined) assert.throws(() => core.parseDateAnswer('29/2/2543', 'buddhist', 'buddhist', textFormat), /textFormat/);
  }
  for (const key of ['type', 'iso', 'textCalendar']) {
    const value = { ...date(), textFormat: 'numeric' };
    delete value[key];
    Object.setPrototypeOf(value, { [key]: date()[key] });
    assert.throws(() => core.validateDateAnswer(value), /วันที่/);
  }
  for (const value of [{ ...date(), textFormat: 'thai-long', extra: true },
    { ...date(), textFormat: 'thai-short', [Symbol('unknown')]: true },
    Object.defineProperty({ ...date(), textFormat: 'numeric' }, 'hidden', { value: true })]) {
    assert.throws(() => core.validateDateAnswer(value), /วันที่/);
  }
  assert.throws(() => core.parseDateAnswer('18 เมษายน 2533', 'buddhist', 'buddhist', 'thai-long'), /DD\/MM\/YYYY/);
});

test('thai-format: editor always reconstructs numeric input while preserving the selected output format', () => {
  for (const textFormat of [undefined, 'numeric', 'thai-long', 'thai-short']) {
    for (const calendar of ['buddhist', 'gregorian']) {
      const original = rule({ ...date('1990-04-18', calendar), ...(textFormat === undefined ? {} : { textFormat }) });
      const draft = ruleToDraft(original);
      assert.equal(draft.date, '18/04/2533');
      assert.equal(draft.textFormat, textFormat ?? 'numeric');
      assert.equal(draft.textCalendar, calendar);
      assert.deepEqual(ruleFromDraft(draft, original), original);
      assert.equal(ruleFromDraft({ ...draft, textFormat: 'thai-short' }, original).value.textFormat, 'thai-short');
    }
  }
  const draft = { mode: 'exact', source: 'วันเกิด', answerType: 'date', date: '29/2/2543',
    inputCalendar: 'buddhist', textCalendar: 'buddhist', textFormat: 'numeric' };
  assert.deepEqual(ruleFromDraft(draft), rule(date()), 'default numeric saves no unnecessary format key');
});
