import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeIDB, testFile, fileRule, fileRef } from './file-test-helpers.mjs';

let instance = 0;
async function popup(initial = [{ pattern: '^ชื่อจริง$', flags: 'iu', value: 'ทดสอบ' }], shortcutOptions) {
  const elements = new Map();
  let focused;
  function node(tagName = '') {
    return {
      tagName, value: '', textContent: '', disabled: false, hidden: false, files: [], children: [], listeners: new Map(),
      classList: { toggle() {} }, addEventListener(type, handler) { this.listeners.set(type, handler); },
      replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
      setAttribute() {}, focus() { focused = this; }, click() { return this.listeners.get('click')?.(); }
    };
  }
  const element = id => {
    if (!elements.has(id)) {
      const entry = node();
      // Textareas normalize CRLF on assignment; model that boundary rather than the app's conversion.
      if (id === 'rule-source' || id === 'rule-answer') {
        let value = '';
        Object.defineProperty(entry, 'value', { get: () => value, set: next => { value = next.replace(/\r\n?/g, '\n'); } });
      }
      elements.set(id, entry);
    }
    return elements.get(id);
  };
  const state = { options: structuredClone(shortcutOptions), updates: [], stored: structuredClone(initial), writes: 0, runs: 0, failStorage: false,
    report: { ok: false, error: 'synthetic response' } };
  globalThis.document = { getElementById: element, createElement: node };
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({ rules: state.stored, shortcutOptions: state.options }), set: async update => {
        if (state.failStorage) throw new Error('พื้นที่จัดเก็บไม่พร้อม');
        state.writes++; state.updates.push(structuredClone(update));
        if ('rules' in update) state.stored = structuredClone(update.rules);
        if ('shortcutOptions' in update) state.options = structuredClone(update.shortcutOptions);
      } },
      session: { get: async () => ({}) }, onChanged: { addListener() {} }
    },
    commands: { getAll: async () => [{ name: 'fill-form', shortcut: '' }] },
    tabs: { query: async () => [{ id: 7 }] },
    runtime: { getManifest: () => ({ version: '9.8.7' }), sendMessage: async command => { state.runs++; state.command = command; return state.report; } }
  };
  await import(`../../outputs/regex-form-filler/popup.js?test=${++instance}`);
  const fire = (id, event = 'click') => element(id).listeners.get(event)?.({ preventDefault() {} });
  const input = (id, value, event = 'input') => { element(id).value = value; return fire(id, event); };
  const rowAction = (index, name) => {
    const row = element('rule-list').children[index];
    const find = entry => entry.tagName === 'button' && entry.textContent === name ? entry : entry.children.map(find).find(Boolean);
    return row && find(row)?.click();
  };
  return { element, state, fire, input, rowAction, focused: () => focused };
}

test('popup displays actual unassigned shortcut and blocks unsaved runs', async () => {
  const { element, input, fire, state } = await popup();
  assert.equal(element('shortcut-warning').hidden, false);
  assert.equal(element('shortcut').textContent, 'ยังไม่ได้กำหนด');
  assert.equal(element('fill').disabled, false);
  input('rules', '[invalid');
  assert.equal(element('fill').disabled, true);
  assert.equal(element('inspect').disabled, true);
  await fire('fill');
  assert.equal(state.runs, 0);
});
test('invalid editor save/import is atomic; valid legacy import becomes canonical Unicode rules', async () => {
  const { input, fire, state, element } = await popup();
  const original = structuredClone(state.stored);
  input('rules', '[invalid');
  await fire('save');
  assert.equal(state.writes, 0);
  assert.deepEqual(state.stored, original);
  input('rules', '[{"pattern":"[","value":"x"}]');
  await fire('import-text');
  assert.equal(state.writes, 0);
  input('rules', '{"ชื่อ (ทดสอบ)":"ระบบ"}');
  await fire('import-text');
  assert.equal(state.writes, 1);
  assert.deepEqual(state.stored, [{ pattern: '^ชื่อ \\(ทดสอบ\\)$', flags: 'iu', value: 'ระบบ' }]);
  assert.equal(element('fill').disabled, false);
  assert.match(element('rules').value, /ระบบ/);
});
test('invalid/oversized file import preserves saved data and restores UI controls', async () => {
  const { element, fire, state } = await popup();
  const previous = structuredClone(state.stored);
  element('file').files = [{ size: 12, text: async () => '{broken' }];
  await fire('file', 'change');
  element('file').files = [{ size: 262145, text: async () => { throw new Error('must not read'); } }];
  await fire('file', 'change');
  assert.deepEqual(state.stored, previous);
  assert.equal(state.writes, 0);
  assert.equal(element('rules').disabled, false);
  assert.equal(element('fill').disabled, false);
});
test('builder adds and saves one rule, synchronizing JSON and rejecting new duplicate pairs', async () => {
  const { element, input, fire, state } = await popup([]);
  input('rule-source', ' ๙) ชื่อจริง * ');
  input('rule-answer', 'ทดสอบ\nบรรทัดสอง');
  assert.equal(state.writes, 0);
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [{ pattern: '^ชื่อจริง$', flags: 'iu', value: 'ทดสอบ\nบรรทัดสอง' }]);
  assert.deepEqual(JSON.parse(element('rules').value), state.stored);
  assert.equal(element('rule-source').value, '');
  input('rule-source', 'ชื่อจริง');
  input('rule-answer', 'ซ้ำ');
  await fire('rule-form', 'submit');
  assert.equal(state.writes, 1);
  assert.match(element('message').textContent, /ซ้ำ/);
  assert.equal(element('rule-answer').value, 'ซ้ำ');
});
test('editing an advanced regex changes only its answer; delete removes only the selected rule', async () => {
  const initial = [
    { pattern: '^ชื่อจริง$', flags: 'iu', value: 'เดิม' },
    { pattern: '^(?!.*ฉุกเฉิน).*เบอร์โทรศัพท์.*$', flags: 'mi', value: '0000000000' },
    { pattern: '^อาหาร$', flags: 'iu', value: ['ข้าว', 'ผัก'] }
  ];
  const { rowAction, input, fire, state, element } = await popup(initial);
  await rowAction(1, 'แก้ไข');
  assert.equal(element('rule-mode').value, 'regex');
  assert.equal(element('rule-flags').value, 'mi');
  input('rule-answer', '0000000001');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [initial[0], { ...initial[1], value: '0000000001' }, initial[2]]);
  await rowAction(0, 'ลบ');
  assert.deepEqual(state.stored, [{ ...initial[1], value: '0000000001' }, initial[2]]);
  assert.deepEqual(JSON.parse(element('rules').value), state.stored);
});
test('invalid builder input and storage failures keep prior rules and the draft available', async () => {
  const { rowAction, input, fire, state, element } = await popup();
  const original = structuredClone(state.stored);
  await rowAction(0, 'แก้ไข');
  input('rule-mode', 'regex', 'change');
  input('rule-source', '[');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, original);
  input('rule-source', '^ชื่อจริง$');
  input('rule-answer', 'ใหม่');
  state.failStorage = true;
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, original);
  assert.deepEqual(JSON.parse(element('rules').value), original);
  assert.equal(element('rule-answer').value, 'ใหม่');
  assert.equal(element('rule-cancel').disabled, false);
  state.failStorage = false;
  await fire('rule-form', 'submit');
  assert.equal(state.stored[0].value, 'ใหม่');
});
test('draft guards stop switching, deletion and import until explicit cancel; imported rows never reuse stale edit index', async () => {
  const { rowAction, input, fire, state, element } = await popup();
  await rowAction(0, 'แก้ไข');
  input('rule-answer', 'ร่าง');
  await rowAction(0, 'ลบ');
  await rowAction(0, 'แก้ไข');
  element('file').files = [{ size: 2, text: async () => '[]' }];
  await fire('file', 'change');
  await fire('save');
  assert.equal(state.writes, 0);
  assert.equal(element('rule-answer').value, 'ร่าง');
  assert.equal(element('rules').disabled, true);
  await fire('rule-cancel');
  input('rules', '{"อาหาร":"ข้าว"}');
  assert.equal(element('rule-source').disabled, true);
  await rowAction(0, 'แก้ไข');
  await fire('file', 'change');
  assert.equal(state.writes, 0);
  assert.equal(element('rule-source').value, '');
  await fire('save');
  input('rule-source', 'เบอร์โทรศัพท์');
  input('rule-answer', '0000000000');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [
    { pattern: '^อาหาร$', flags: 'iu', value: 'ข้าว' },
    { pattern: '^เบอร์โทรศัพท์$', flags: 'iu', value: '0000000000' }
  ]);
  input('rules', '{invalid');
  await fire('json-cancel');
  assert.deepEqual(JSON.parse(element('rules').value), state.stored);
  assert.equal(element('rule-source').disabled, false);
});
test('question picker uses the existing dry-run response and pre-fills a normalized exact name', async () => {
  const { state, fire, input, element, focused } = await popup([]);
  state.report = { ok: true, dryRun: true, time: 1, rows: [
    { label: '๙) เบอร์โทรศัพท์ *', rules: [], code: 'unmatched' },
    { label: 'เบอร์โทรศัพท์บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน', rules: [], code: 'unmatched' }
  ] };
  await fire('inspect');
  assert.deepEqual(state.command, { type: 'run', dryRun: true });
  const options = element('question-select').children;
  assert.ok(options.some(option => option.value === 'เบอร์โทรศัพท์'));
  input('question-select', 'เบอร์โทรศัพท์', 'change');
  assert.equal(element('rule-source').value, 'เบอร์โทรศัพท์');
  assert.equal(element('rule-mode').value, 'exact');
  assert.equal(focused(), element('rule-answer'));
  input('rule-answer', '0000000000');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [{ pattern: '^เบอร์โทรศัพท์$', flags: 'iu', value: '0000000000' }]);
});
test('old imports with duplicate pairs remain editable without creating new duplicate pairs', async () => {
  const { rowAction, input, fire, state } = await popup([
    { pattern: '^ชื่อ$', flags: 'iu', value: 'a' }, { pattern: '^ชื่อ$', flags: 'iu', value: 'b' }
  ]);
  await rowAction(1, 'แก้ไข');
  input('rule-answer', 'c');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored.map(rule => rule.value), ['a', 'c']);
});

test('answer-only edits preserve raw regex line endings, and match-only edits preserve raw answer line endings', async () => {
  const original = { pattern: '^(?=a\r\nb)a\\s+b$', flags: 'msu', value: 'แรก\r\nสอง' };
  const { rowAction, input, fire, state } = await popup([original]);
  await rowAction(0, 'แก้ไข');
  input('rule-answer', 'ใหม่');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [{ ...original, value: 'ใหม่' }]);
  input('rules', JSON.stringify([original]));
  await fire('save');
  await rowAction(0, 'แก้ไข');
  input('rule-source', '^ชื่อ$');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [{ ...original, pattern: '^ชื่อ$' }]);
});

test('date: popup adds Buddhist date with live preview and edits date/output year without losing regex', async () => {
  const { input, fire, state, element, rowAction } = await popup([]);
  input('rule-source', 'วันเกิด');
  input('answer-type', 'date', 'change');
  assert.equal(element('date-fields').hidden, false);
  assert.equal(element('answer-field').hidden, true);
  assert.equal(element('date-input-calendar').value, 'buddhist');
  assert.equal(element('date-text-calendar').value, 'buddhist');
  input('rule-date', '29/2/2543');
  assert.match(element('date-preview').textContent, /2000-02-29/);
  assert.match(element('date-preview').textContent, /29\/02\/2543/);
  await fire('rule-form', 'submit');
  const value = { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' };
  assert.deepEqual(state.stored, [{ pattern: '^วันเกิด$', flags: 'iu', value }]);
  const summary = element('rule-list').children[0].children[0].children[1].textContent;
  assert.match(summary, /2000-02-29.*29\/02\/2543/);
  assert.doesNotMatch(summary, /object Object/);
  assert.equal(element('rule-date').value, '');
  const raw = { pattern: '^(?=a\r\nb)a\\s+b$', flags: 'msu', value };
  input('rules', JSON.stringify([raw]));
  await fire('save');
  await rowAction(0, 'แก้ไข');
  assert.equal(element('rule-date').value, '29/02/2543');
  input('date-text-calendar', 'gregorian', 'change');
  assert.match(element('date-preview').textContent, /29\/02\/2000/);
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, [{ ...raw, value: { ...value, textCalendar: 'gregorian' } }]);
  await rowAction(0, 'แก้ไข');
  input('date-input-calendar', 'gregorian', 'change');
  input('rule-date', '2/1/2024');
  await fire('rule-form', 'submit');
  assert.equal(state.stored[0].value.iso, '2024-01-02');
});

test('date: invalid days/storage errors retain draft and saved data; all fields participate in dirty guards', async () => {
  const original = [{ pattern: '^วันเกิด$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' } }];
  const { input, fire, state, element, rowAction } = await popup(original);
  await rowAction(0, 'แก้ไข');
  input('rule-date', '29/2/2566');
  assert.match(element('date-preview').textContent, /วันที่/);
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, original);
  assert.equal(element('rule-date').value, '29/2/2566');
  assert.equal(element('rules').disabled, true);
  await rowAction(0, 'ลบ');
  await fire('inspect');
  await fire('save');
  assert.equal(state.writes, 0);
  assert.equal(state.runs, 0);
  input('answer-type', 'single', 'change');
  input('rule-answer', 'literal');
  input('answer-type', 'date', 'change');
  assert.equal(element('rule-date').value, '29/2/2566');
  input('answer-type', 'single', 'change');
  assert.equal(element('rule-answer').value, 'literal');
  input('answer-type', 'date', 'change');
  input('rule-date', '1/1/2543');
  state.failStorage = true;
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, original);
  assert.equal(element('rule-date').value, '1/1/2543');
  await fire('rule-cancel');
  assert.equal(element('rule-date').value, '');
  assert.equal(element('date-text-calendar').value, 'buddhist');
  assert.deepEqual(state.stored, original);
  for (const [id, value] of [['rule-date', '1/1/2543'], ['date-input-calendar', 'gregorian'], ['date-text-calendar', 'gregorian']]) {
    input(id, value, id === 'rule-date' ? 'input' : 'change');
    assert.equal(element('fill').disabled, true, id);
    await fire('rule-cancel');
    assert.equal(element('fill').disabled, false);
  }
});

test('date: file/JSON import and export preserve typed dates; invalid imports remain atomic', async () => {
  const rules = [{ pattern: '^วันเกิด$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'gregorian' } }];
  const { input, fire, state, element, rowAction } = await popup([]);
  element('file').files = [{ size: 200, text: async () => JSON.stringify(rules) }];
  await fire('file', 'change');
  assert.deepEqual(state.stored, rules);
  await rowAction(0, 'แก้ไข');
  input('rule-date', '1/1/2543');
  let exported;
  const create = URL.createObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:date-test'; };
  try { await fire('export'); } finally { URL.createObjectURL = create; }
  assert.deepEqual(JSON.parse(await exported.text()), rules, 'export uses saved date while draft is dirty');
  await fire('rule-cancel');
  input('rules', JSON.stringify([{ ...rules[0], value: { ...rules[0].value, iso: '1900-02-29' } }]));
  const invalid = element('rules').value;
  await fire('import-text');
  assert.deepEqual(state.stored, rules);
  assert.equal(element('rules').value, invalid);
  assert.equal(element('rule-date').disabled, true);
  await fire('json-cancel');
  input('rules', await exported.text());
  await fire('import-text');
  assert.deepEqual(state.stored, rules);
});

test('thai-format: popup creates and edits Thai output with live previews and numeric date input', async () => {
  const { input, fire, state, element, rowAction } = await popup([]);
  assert.equal(element('date-text-format').value, 'numeric');
  input('rule-source', 'วันเกิด');
  input('answer-type', 'date', 'change');
  input('rule-date', '18/4/2533');
  input('date-text-format', 'thai-long', 'change');
  assert.match(element('date-preview').textContent, /1990-04-18.*18 เมษายน 2533/);
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored[0].value, { type: 'date', iso: '1990-04-18', textCalendar: 'buddhist', textFormat: 'thai-long' });
  assert.match(element('rule-list').children[0].children[0].children[1].textContent, /18 เมษายน 2533/);
  assert.equal(element('date-text-format').value, 'numeric', 'successful save resets the builder');
  await rowAction(0, 'แก้ไข');
  assert.equal(element('rule-date').value, '18/04/2533');
  assert.equal(element('date-text-format').value, 'thai-long');
  input('date-text-format', 'thai-short', 'change');
  input('date-text-calendar', 'gregorian', 'change');
  assert.match(element('date-preview').textContent, /1990-04-18.*18 เม.ย. 1990/);
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored[0].value, { type: 'date', iso: '1990-04-18', textCalendar: 'gregorian', textFormat: 'thai-short' });
  assert.deepEqual(JSON.parse(element('rules').value), state.stored);
});

test('thai-format: format changes guard drafts, cancellation and storage failures without losing saved data', async () => {
  const { input, fire, state, element, rowAction } = await popup();
  const original = structuredClone(state.stored);
  input('date-text-format', 'thai-long', 'change');
  for (const id of ['fill', 'inspect', 'save', 'import-text', 'import-file', 'rules']) assert.equal(element(id).disabled, true, id);
  await fire('fill'); await fire('inspect'); await fire('save'); await rowAction(0, 'ลบ'); await rowAction(0, 'แก้ไข');
  element('file').files = [{ size: 2, text: async () => '[]' }];
  await fire('file', 'change');
  assert.equal(state.runs, 0); assert.equal(state.writes, 0);
  assert.equal(element('date-text-format').value, 'thai-long');
  await fire('rule-cancel');
  assert.equal(element('date-text-format').value, 'numeric');
  assert.equal(element('fill').disabled, false);
  input('rules', '[invalid');
  assert.equal(element('date-text-format').disabled, true);
  await fire('json-cancel');
  await rowAction(0, 'แก้ไข');
  input('answer-type', 'date', 'change');
  input('rule-date', '29/2/2543');
  input('date-text-format', 'thai-short', 'change');
  input('answer-type', 'single', 'change');
  input('answer-type', 'date', 'change');
  assert.equal(element('date-text-format').value, 'thai-short');
  state.failStorage = true;
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored, original);
  assert.deepEqual(JSON.parse(element('rules').value), original);
  assert.equal(element('rule-date').value, '29/2/2543');
  assert.equal(element('date-text-format').value, 'thai-short');
  assert.equal(element('rule-cancel').disabled, false);
  state.failStorage = false;
  await fire('rule-form', 'submit');
  assert.equal(state.stored[0].value.textFormat, 'thai-short');
});

test('thai-format: file/JSON import, unchanged edit and export preserve optional and explicit formats', async () => {
  const rules = [undefined, 'numeric', 'thai-long', 'thai-short'].map((textFormat, index) => ({
    pattern: `^วันที่ ${index}$`, flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist',
      ...(textFormat === undefined ? {} : { textFormat }) }
  }));
  const { input, fire, state, element, rowAction } = await popup([]);
  element('file').files = [{ size: 1000, text: async () => JSON.stringify(rules) }];
  await fire('file', 'change');
  assert.deepEqual(state.stored, rules);
  for (let index = 0; index < rules.length; index++) {
    await rowAction(index, 'แก้ไข');
    assert.equal(element('rule-date').value, '29/02/2543');
    assert.equal(element('date-text-format').value, rules[index].value.textFormat ?? 'numeric');
    await fire('rule-form', 'submit');
    assert.deepEqual(state.stored, rules);
  }
  await rowAction(2, 'แก้ไข');
  input('date-text-format', 'thai-short', 'change');
  let exported;
  const create = URL.createObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:thai-format-test'; };
  try { await fire('export'); } finally { URL.createObjectURL = create; }
  assert.deepEqual(JSON.parse(await exported.text()), rules, 'export uses saved format during a dirty edit');
  await fire('rule-cancel');
  for (const textFormat of [null, 'unknown']) {
    input('rules', JSON.stringify([{ ...rules[0], value: { ...rules[0].value, textFormat } }]));
    await fire('import-text');
    assert.deepEqual(state.stored, rules);
    assert.match(element('message').textContent, /textFormat/);
    await fire('json-cancel');
  }
  input('rules', await exported.text());
  await fire('import-text');
  assert.deepEqual(state.stored, rules);
});


test('shortcut-next: settings default off, normalize malformed values and restore on reopen', async () => {
  for (const options of [undefined, null, [], 'true', { autoNext: 'true', allowIncomplete: 1 }]) {
    const { element, state } = await popup(undefined, options);
    assert.equal(element('auto-next').checked, false);
    assert.equal(element('allow-incomplete').checked, false);
    assert.equal(element('allow-incomplete').disabled, true);
    assert.equal(state.writes, 0);
  }
  const { element } = await popup(undefined, { autoNext: false, allowIncomplete: true });
  assert.equal(element('allow-incomplete').checked, true);
  assert.equal(element('allow-incomplete').disabled, true);
  const reopened = await popup(undefined, { autoNext: true, allowIncomplete: true });
  assert.equal(reopened.element('auto-next').checked, true);
  assert.equal(reopened.element('allow-incomplete').disabled, false);
});

test('shortcut-next: settings save atomically without committing or discarding builder/JSON drafts', async () => {
  const { element, state, input, fire } = await popup();
  const original = structuredClone(state.stored);
  input('rule-source', 'unfinished rule');
  input('rule-answer', 'private draft');
  element('auto-next').checked = true;
  await fire('auto-next', 'change');
  assert.deepEqual(state.updates, [{ shortcutOptions: { autoNext: true, allowIncomplete: false } }]);
  assert.equal(element('allow-incomplete').disabled, false);
  assert.match(element('shortcut-status').textContent, /บันทึก/);
  assert.equal(element('rule-answer').value, 'private draft');
  assert.equal(element('fill').disabled, true);
  assert.deepEqual(state.stored, original);
  await fire('rule-cancel');
  input('rules', '[unfinished JSON');
  element('allow-incomplete').checked = true;
  await fire('allow-incomplete', 'change');
  assert.equal(element('rules').value, '[unfinished JSON');
  assert.equal(element('rule-save').disabled, true);
  assert.deepEqual(state.stored, original);
  assert.deepEqual(state.options, { autoNext: true, allowIncomplete: true });
  await fire('json-cancel');
  let exported;
  const create = URL.createObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:shortcut-test'; };
  try { await fire('export'); } finally { URL.createObjectURL = create; }
  assert.deepEqual(JSON.parse(await exported.text()), original);
  input('rules', JSON.stringify([{ pattern: '^changed$', flags: 'iu', value: 'synthetic' }]));
  await fire('import-text');
  assert.deepEqual(state.options, { autoNext: true, allowIncomplete: true });
});

test('shortcut-next: failed settings save restores both checkboxes and dependent state', async () => {
  const { element, state, fire } = await popup(undefined, { autoNext: true, allowIncomplete: true });
  const original = structuredClone(state.stored);
  state.failStorage = true;
  element('auto-next').checked = false;
  await fire('auto-next', 'change');
  assert.equal(element('auto-next').checked, true);
  assert.equal(element('allow-incomplete').checked, true);
  assert.equal(element('allow-incomplete').disabled, false);
  assert.match(element('shortcut-status').textContent, /ไม่|ล้มเหลว/);
  assert.deepEqual(state.stored, original);
  assert.equal(state.writes, 0);
});

test('shortcut-next: popup report keeps navigation separate from fill rows and never claims advancement', async () => {
  const { element, state, fire } = await popup(undefined, { autoNext: true, allowIncomplete: true });
  state.report = { ok: true, rows: [{ label: 'Question', rules: [], code: 'unmatched' }], navigation: { code: 'attempted' } };
  await fire('fill');
  assert.deepEqual(state.command, { type: 'run', dryRun: false });
  assert.equal(element('results').children.length, 1);
  assert.match(element('navigation-result').textContent, /ลองกด Next/);
  assert.match(element('navigation-result').textContent, /ฟอร์ม/);
});

test('file diagnostics: popup shows Thai reason, stable code, loaded version and dated run; ignores unknown and legacy reasons', async () => {
  const { element, state, fire } = await popup();
  assert.match(element('extension-version').textContent, /9\.8\.7/);
  const time = Date.UTC(2026, 9, 14, 3, 4, 5);
  state.report = { ok: true, version: '1.5.3', time, rows: [
    { label: 'Upload', rules: [0], code: 'pending', diagnostic: 'picker-document-changed' },
    { label: 'Second', rules: [1], code: 'pending', diagnostic: 'previous-unconfirmed' },
    ...['<img src=x onerror=PRIVATE>', 'constructor', ['overall-timeout'], undefined].map(diagnostic => ({ label: 'Legacy', rules: [], code: 'pending', diagnostic }))
  ] };
  await fire('fill');
  const details = element('results').children.map(item => item.children[1]);
  assert.match(details[0].textContent, /เอกสาร.*picker.*เปลี่ยน.*\(picker-document-changed\)/);
  assert.match(details[1].textContent, /ไฟล์ก่อนหน้า.*\(previous-unconfirmed\)/);
  assert.equal(details[0].children.length, 0);
  assert.ok(details.slice(2).every(detail => detail.textContent === details.at(-1).textContent));
  assert.match(element('run-time').textContent, /1\.5\.3/);
  assert.ok(element('run-time').textContent.includes(new Date(time).toLocaleString('th-TH')));
  state.report = { ok: true, rows: [{ label: 'Legacy', rules: [], code: 'pending' }] };
  await fire('fill');
  assert.equal(element('results').children[0].children[1].textContent, details.at(-1).textContent);
  assert.equal(element('run-time').textContent, '');
  assert.match(element('extension-version').textContent, /9\.8\.7/);
  assert.equal(state.writes, 0);
});

test('file: chooser stays in draft, cancel writes nothing, save keeps a copy, edits retain reference', async () => {
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const { input, element, fire, state, rowAction } = await popup([]);
  input('rule-source', 'Upload'); input('answer-type', 'file', 'change');
  assert.equal(element('file-fields').hidden, false);
  element('rule-file').files = [testFile()]; await fire('rule-file', 'change');
  assert.match(element('file-summary').textContent, /TEST-ONLY.pdf/);
  assert.equal(element('fill').disabled, true);
  assert.equal(idb.records.size, 0); assert.equal(state.writes, 0);
  await fire('rule-cancel'); assert.equal(idb.records.size, 0);
  input('rule-source', 'Upload'); input('answer-type', 'file', 'change');
  element('rule-file').files = [testFile()]; await fire('rule-file', 'change');
  await fire('rule-form', 'submit');
  assert.equal(state.stored[0]?.value?.type, 'file'); assert.equal(idb.records.size, 1);
  const saved = structuredClone(state.stored[0].value);
  assert.equal(JSON.stringify(saved).includes('dGVzdA=='), false);
  await rowAction(0, 'แก้ไข');
  input('rule-source', 'Other upload');
  await fire('rule-form', 'submit');
  assert.deepEqual(state.stored[0].value, saved);
  await rowAction(0, 'แก้ไข');
  element('rule-file').files = [testFile('replacement.pdf')]; await fire('rule-file', 'change');
  state.failStorage = true; await fire('rule-form', 'submit');
  assert.deepEqual(state.stored[0].value, saved); assert.deepEqual([...idb.records.keys()], [saved.fileId]);
  assert.match(element('file-summary').textContent, /replacement.pdf/);
  state.failStorage = false; await fire('rule-form', 'submit');
  assert.equal(state.stored[0].value.name, 'replacement.pdf'); assert.equal(idb.records.size, 1);
  let exported; const create = URL.createObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:file-test'; };
  try { await fire('export'); } finally { URL.createObjectURL = create; }
  assert.deepEqual(JSON.parse(await exported.text()), state.stored);
  await rowAction(0, 'ลบ'); assert.equal(idb.records.size, 0);
});

test('file: missing imported reference requests reselection; bad chooser and IDB errors preserve draft', async () => {
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const { input, element, fire, state, rowAction } = await popup([fileRule()]);
  await rowAction(0, 'แก้ไข');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(element('file-status').textContent, /เลือกไฟล์ใหม่/);
  element('rule-file').files = [testFile('too-big.pdf', new Uint8Array(10485761))];
  await fire('rule-file', 'change');
  assert.match(element('message').textContent, /10 MiB/);
  assert.deepEqual(state.stored[0].value, fileRef());
  element('rule-file').files = [testFile()]; await fire('rule-file', 'change');
  idb.failWrite = true; await fire('rule-form', 'submit');
  assert.equal(state.writes, 0); assert.equal(idb.records.size, 0);
  assert.equal(element('rule-cancel').disabled, false);
  input('rule-source', 'New heading');
  assert.match(element('file-summary').textContent, /TEST-ONLY/);
});
