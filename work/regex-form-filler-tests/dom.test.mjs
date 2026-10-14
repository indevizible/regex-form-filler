import test from 'node:test';
import assert from 'node:assert/strict';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { runInThisContext } from 'node:vm';
import * as core from '../../outputs/regex-form-filler/core.js';

const url = 'https://docs.google.com/forms/d/e/synthetic/viewform';
class Input {
  constructor(type = 'text', value = '') {
    Object.assign(this, { type, tagName: 'INPUT', stored: value, isConnected: true, attrs: {}, events: [], hidden: false, maxLength: -1, minLength: -1, checked: false });
  }
  get value() { return this.stored; }
  set value(value) { this.stored = value; }
  get ownerDocument() { return { defaultView: { HTMLInputElement: Input, HTMLTextAreaElement: Input, HTMLSelectElement: Input, Event } }; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  closest(selector) { return selector === '[role="listitem"]' ? this.card : null; }
  matches(selector) {
    return selector.split(',').some(part => {
      const term = part.trim();
      if (term === ':disabled') return !!this.disabled;
      if (term === 'input') return this.tagName === 'INPUT';
      if (term === 'button') return this.tagName === 'BUTTON';
      if (term === 'textarea') return this.tagName === 'TEXTAREA';
      if (term === 'select') return this.tagName === 'SELECT';
      if (term.startsWith('input[type=')) return this.tagName === 'INPUT' && term === `input[type="${this.type}"]`;
      return term === `[role="${this.attrs.role}"]`;
    });
  }
  cloneNode() { return Object.assign(new Input(this.type), this, { events: [] }); }
  checkValidity() {
    return (!this.required || !!this.value) && (!this.pattern || new RegExp(`^(?:${this.pattern})$`, 'u').test(this.value)) &&
      (this.type !== 'date' || (!this.min || this.value >= this.min) && (!this.max || this.value <= this.max));
  }
  dispatchEvent(event) { this.events.push(event.type); if (this.rejectWrite) this.value = ''; }
  click() {
    this.clicks = (this.clicks || 0) + 1;
    if (this.rejectWrite) return;
    if (this.tagName === 'INPUT') this.checked = !this.checked;
    else {
      if (this.attrs.role === 'radio') this.card.controls.forEach(control => { control.attrs['aria-checked'] = 'false'; });
      this.attrs['aria-checked'] = this.attrs['aria-checked'] === 'true' ? 'false' : 'true';
    }
  }
}
const choice = (role, label, checked = false) => {
  const control = new Input();
  control.tagName = 'DIV';
  control.attrs = { role, 'aria-label': label, 'aria-checked': String(checked) };
  return control;
};
function card(raw, controls = [], extra = {}) {
  const result = { controls, isConnected: true, hidden: false, ...extra };
  const heading = { isConnected: true, closest: () => result, cloneNode: () => ({ textContent: raw, querySelectorAll: () => [] }) };
  result.getClientRects = () => result.hidden ? [] : [{}];
  result.closest = () => null;
  result.querySelector = () => result.grid ? {} : null;
  result.querySelectorAll = selector => selector.includes('Selected files') ? [] : selector.includes('aria-level="3"') ? (result.section ? [] : [heading]) :
    selector === '[role="radiogroup"]' ? Array(result.groups || 0).fill({}) : controls;
  controls.forEach(control => { control.card = result; });
  return result;
}
async function run(cards, values, dryRun = false) {
  globalThis.location = { href: url };
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  globalThis.document = { querySelectorAll: selector => selector === '[role="listitem"]' ? cards : [], querySelector: () => null };
  const injected = runInThisContext(`(${formDOM.toString()})`);
  const labels = await injected('collect', { url, token: 'test' });
  const jobs = values.map(value => value?.rules ? value : { rules: [0], value });
  const rows = await injected('apply', { url, token: 'test', jobs, dryRun });
  return { labels, rows, codes: rows.map(row => row.code) };
}
test('collection uses question titles, excludes section headings, and dry run writes nothing', async () => {
  const input = new Input();
  const result = await run([card('Section description', [], { section: true }), card('2. ชื่อจริง', [input])], ['ทดสอบ'], true);
  assert.deepEqual(result.labels, ['2. ชื่อจริง']);
  assert.deepEqual(result.codes, ['ready']);
  assert.equal(input.value, '');
  assert.deepEqual(input.events, []);
});
test('native writes use setter/events and preserve any existing answer', async () => {
  const empty = new Input();
  const filled = new Input('text', 'เดิม');
  const result = await run([card('ใหม่', [empty]), card('เดิม', [filled])], ['ทดสอบ', 'เปลี่ยน']);
  assert.deepEqual(result.codes, ['filled', 'preserved']);
  assert.equal(empty.value, 'ทดสอบ');
  assert.deepEqual(empty.events, ['input', 'change']);
  assert.equal(filled.value, 'เดิม');
  assert.deepEqual(filled.events, []);
});
test('ambiguous rules, unsupported fields, hidden/disabled/readonly, grids and multi-control cards never write', async () => {
  const inputs = [new Input(), new Input('file'), new Input('password'), new Input(), new Input(), new Input(), new Input(), new Input(), new Input()];
  inputs[3].hidden = true; inputs[4].disabled = true; inputs[5].readOnly = true;
  const cards = inputs.map((input, index) => card(String(index), [input], index === 6 ? { grid: true } : {}));
  cards[7].controls.push(new Input());
  cards[7].controls[1].card = cards[7];
  const result = await run(cards, [{ rules: [0, 1], value: 'x' }, ...Array(8).fill('x')]);
  assert.deepEqual(result.codes, ['ambiguous', 'unsupported', 'unsupported', 'blocked', 'blocked', 'blocked', 'unsupported', 'unsupported', 'filled']);
  inputs.slice(0, 8).forEach(input => assert.equal(input.value, ''));
});
test('native read-back detects rejected values; array values and non-ISO dates are rejected', async () => {
  const reject = new Input(); reject.rejectWrite = true;
  assert.deepEqual((await run([card('reject', [reject]), card('text', [new Input()]), card('date', [new Input('date')])], ['x', ['x'], '2/1/2000'])).codes, ['mismatch', 'invalid', 'invalid']);
});
test('choice preflight prevents partial clicks for missing/duplicate options; preserves selections', async () => {
  const good = choice('checkbox', 'A');
  const selected = choice('radio', 'A', true);
  const result = await run([
    card('missing', [good, choice('checkbox', 'B')]), card('duplicate', [choice('radio', 'A'), choice('radio', 'A')]),
    card('prefilled', [selected, choice('radio', 'B')])
  ], [['A', 'missing'], 'A', 'B']);
  assert.deepEqual(result.codes, ['missing', 'missing', 'preserved']);
  assert.equal(good.clicks, undefined);
  assert.equal(selected.attrs['aria-checked'], 'true');
});
test('custom choices click exact labels and require aria read-back', async () => {
  const selected = choice('radio', 'ทดสอบ');
  const failing = choice('checkbox', 'A'); failing.rejectWrite = true;
  const result = await run([card('radio', [choice('radio', 'อื่น'), selected]), card('bad', [failing])], ['ทดสอบ', ['A']]);
  assert.deepEqual(result.codes, ['filled', 'mismatch']);
  assert.equal(selected.attrs['aria-checked'], 'true');
});
test('navigation between collection and apply aborts before changing fields', async () => {
  const input = new Input();
  await run([card('name', [input])], ['x'], true);
  await formDOM('collect', { url, token: 'fresh' });
  globalThis.location.href = url + '?changed';
  await assert.rejects(formDOM('apply', { url, token: 'fresh', jobs: [{ rules: [0], value: 'x' }] }), /เปลี่ยน/);
  assert.equal(input.value, '');
});

const dateValue = (textCalendar = 'buddhist', iso = '2000-02-29') => ({ type: 'date', iso, textCalendar });
test('date: serialized formDOM adapts ONE typed value to date/text/textarea and calendar override', async () => {
  const inputs = [new Input('date'), new Input(), new Input(), new Input()];
  inputs[2].tagName = 'TEXTAREA';
  const values = [dateValue(), dateValue(), dateValue(), dateValue('gregorian')];
  const result = await run(inputs.map(input => card('วันเกิด', [input])), values);
  assert.deepEqual(result.codes, Array(4).fill('filled'));
  assert.deepEqual(inputs.map(input => input.value), ['2000-02-29', '29/02/2543', '29/02/2543', '29/02/2000']);
  for (const input of inputs) assert.deepEqual(input.events, ['input', 'change']);
});

test('date: dry run is write-free; existing date/text remain untouched; failed readback is detected', async () => {
  const inputs = [new Input('date'), new Input(), new Input('date', '1999-01-02'), new Input('text', 'เดิม')];
  const cards = inputs.map(input => card('วันเกิด', [input]));
  assert.deepEqual((await run(cards, inputs.map(() => dateValue()), true)).codes, ['ready', 'ready', 'preserved', 'preserved']);
  assert.deepEqual(inputs.map(input => input.value), ['', '', '1999-01-02', 'เดิม']);
  inputs.forEach(input => assert.deepEqual(input.events, []));
  assert.deepEqual((await run(cards, inputs.map(() => dateValue()))).codes, ['filled', 'filled', 'preserved', 'preserved']);
  assert.equal(inputs[2].value, '1999-01-02');
  assert.equal(inputs[3].value, 'เดิม');
  const reject = new Input('date'); reject.rejectWrite = true;
  assert.deepEqual((await run([card('วันเกิด', [reject])], [dateValue()])).codes, ['mismatch']);
});

test('date: unrelated native and custom controls skip without coercion, throws, events or clicks', async () => {
  const inputs = ['number', 'email', 'tel', 'url', 'time', 'month', 'file', 'password', 'radio', 'checkbox'].map(type => new Input(type));
  inputs[8].name = 'radio';
  const select = new Input(); select.tagName = 'SELECT';
  const custom = new Input(); custom.tagName = 'DIV'; custom.attrs.role = 'listbox';
  const combobox = new Input(); combobox.attrs.role = 'combobox';
  inputs.push(select, custom, combobox, choice('radio', 'A'), choice('checkbox', 'A'));
  for (const dry of [true, false]) {
    const result = await run(inputs.map(input => card('วันเกิด', [input])), inputs.map(() => dateValue()), dry);
    assert.ok(result.codes.every(code => ['unsupported', 'invalid'].includes(code)), JSON.stringify(result.codes));
    inputs.forEach(input => { assert.equal(input.value, ''); assert.deepEqual(input.events, []); assert.equal(input.clicks, undefined); });
  }
});

test('date: formatted string is used for length/pattern/date min-max probes in dry and fill modes', async () => {
  const inputs = [new Input(), new Input(), new Input(), new Input(), new Input('date'), new Input('date'), new Input('date')];
  inputs[0].maxLength = 9;
  inputs[1].minLength = 11;
  inputs[2].pattern = '\\d{2}/\\d{2}/2000';
  inputs[3].maxLength = 10; inputs[3].minLength = 10; inputs[3].pattern = '\\d{2}/\\d{2}/2543';
  inputs[4].min = '2000-03-01';
  inputs[5].max = '2000-02-28';
  inputs[6].min = inputs[6].max = '2000-02-29';
  const cards = inputs.map(input => card('วันเกิด', [input]));
  const values = inputs.map(() => dateValue());
  assert.deepEqual((await run(cards, values, true)).codes, ['invalid', 'invalid', 'invalid', 'ready', 'invalid', 'invalid', 'ready']);
  inputs.forEach(input => assert.equal(input.value, ''));
  assert.deepEqual((await run(cards, values)).codes, ['invalid', 'invalid', 'invalid', 'filled', 'invalid', 'invalid', 'filled']);
  assert.deepEqual(inputs.map(input => input.value), ['', '', '', '29/02/2543', '', '', '2000-02-29']);
});

test('date: standalone formatter matches core across early years and upper bounds; old dates stay literal', async () => {
  for (const iso of ['0001-01-01', '0004-02-29', '0099-12-31', '2000-02-29', '9456-12-31']) {
    for (const calendar of ['buddhist', 'gregorian']) {
      const value = core.validateRules([{ pattern: 'วันเกิด', value: dateValue(calendar, iso) }])[0].value;
      const input = new Input();
      assert.deepEqual((await run([card('วันเกิด', [input])], [value])).codes, ['filled']);
      assert.equal(input.value, core.formatDateAnswer(value));
    }
  }
  const input = new Input();
  await run([card('วันเกิด', [input])], ['29/2/2543']);
  assert.equal(input.value, '29/2/2543');
});

test('thai-format: serialized DOM fills requested April text/textarea but keeps native dates Gregorian ISO', async () => {
  const inputs = [], values = [], expected = [];
  for (const [calendar, year] of [['buddhist', '2533'], ['gregorian', '1990']]) {
    for (const [textFormat, output] of [['numeric', `18/04/${year}`], ['thai-long', `18 เมษายน ${year}`], ['thai-short', `18 เม.ย. ${year}`]]) {
      for (const type of ['date', 'text', 'textarea']) {
        const input = new Input(type === 'textarea' ? 'text' : type);
        if (type === 'textarea') input.tagName = 'TEXTAREA';
        inputs.push(input);
        values.push({ ...dateValue(calendar, '1990-04-18'), textFormat });
        expected.push(type === 'date' ? '1990-04-18' : output);
      }
    }
  }
  const cards = inputs.map(input => card('วันเกิด', [input]));
  assert.deepEqual((await run(cards, values, true)).codes, inputs.map(() => 'ready'));
  inputs.forEach(input => { assert.equal(input.value, ''); assert.deepEqual(input.events, []); });
  assert.deepEqual((await run(cards, values)).codes, inputs.map(() => 'filled'));
  assert.deepEqual(inputs.map(input => input.value), expected);
  inputs.forEach(input => assert.deepEqual(input.events, ['input', 'change']));
});

test('thai-format: core and standalone DOM agree for every Thai month and calendar', async () => {
  const inputs = [], values = [];
  for (let month = 1; month <= 12; month++) {
    for (const calendar of ['buddhist', 'gregorian']) {
      for (const textFormat of ['thai-long', 'thai-short']) {
        inputs.push(new Input());
        values.push({ ...dateValue(calendar, `2000-${String(month).padStart(2, '0')}-02`), textFormat });
      }
    }
  }
  assert.deepEqual((await run(inputs.map(input => card('วันเกิด', [input])), values)).codes, inputs.map(() => 'filled'));
  assert.deepEqual(inputs.map(input => input.value), values.map(core.formatDateAnswer));
});

test('thai-format: Thai output length, pattern, probe and readback govern validity; existing answers survive', async () => {
  for (const [textFormat, wanted] of [['thai-long', '29 กุมภาพันธ์ 2543'], ['thai-short', '29 ก.พ. 2543']]) {
    const inputs = Array.from({ length: 6 }, () => new Input());
    inputs[0].maxLength = wanted.length - 1;
    inputs[1].minLength = wanted.length + 1;
    inputs[2].pattern = '[0-9]{2}/[0-9]{2}/2543';
    inputs[3].minLength = inputs[3].maxLength = wanted.length;
    inputs[3].pattern = wanted.replaceAll('.', '\\.');
    inputs[4].rejectWrite = true;
    inputs[5].value = 'ค่าเดิม';
    const cards = inputs.map(input => card('วันเกิด', [input]));
    const values = inputs.map(() => ({ ...dateValue(), textFormat }));
    assert.deepEqual((await run(cards, values, true)).codes, ['invalid', 'invalid', 'invalid', 'ready', 'ready', 'preserved']);
    inputs.forEach(input => assert.deepEqual(input.events, []));
    assert.deepEqual((await run(cards, values)).codes, ['invalid', 'invalid', 'invalid', 'filled', 'mismatch', 'preserved']);
    assert.deepEqual(inputs.map(input => input.value), ['', '', '', wanted, '', 'ค่าเดิม']);
    assert.deepEqual(inputs[5].events, []);
  }
});

// These doubles exercise the serialized boundary; native validity is checked in the browser fixture.
function navigationPage(cards, buttons = [{ name: 'Next' }]) {
  globalThis.location = { href: url };
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  const form = { isConnected: true };
  const nexts = buttons.map(({ name, tag = 'DIV', type, disabled = false, outside = false, inCard = false, hidden = false }) => {
    const button = new Input(type || (tag === 'BUTTON' ? 'submit' : 'button'));
    Object.assign(button, { tagName: tag, textContent: name, disabled, hidden, clicks: 0 });
    button.attrs = { role: 'button', ...(type ? { type } : {}) };
    button.closest = selector => selector === 'form' ? (outside ? {} : form) : selector === '[role="listitem"]' ? (inCard ? cards[0] : null) : null;
    button.click = () => { button.clicks++; };
    return button;
  });
  const controls = () => cards.flatMap(card => card.controls);
  const setup = control => {
    control.hasAttribute = name => Object.hasOwn(control.attrs, name);
    control.closest = selector => selector === 'form' ? form : selector === '[role="listitem"]' ? control.card :
      selector.includes('aria-invalid') && control.attrs['aria-invalid'] && control.attrs['aria-invalid'] !== 'false' ? control : null;
    control.querySelectorAll = () => control.options || [];
    control.querySelector = () => null;
    control.options?.forEach(option => { if (option.attrs) setup(option); });
  };
  cards.forEach(card => {
    card.closest = selector => selector === 'form' ? form : null;
    card.getAttribute = () => null;
    card.matches = () => false;
    card.querySelector = selector => selector.includes('grid') && card.grid ? {} : null;
    card.controls.forEach(setup);
  });
  form.querySelectorAll = selector => selector === '[role="listitem"]' ? cards :
    selector.startsWith('button,') ? nexts : controls();
  globalThis.document = { querySelectorAll: selector => selector === '[role="listitem"]' ? cards : [], querySelector: () => null };
  const injected = runInThisContext(`(${formDOM.toString()})`);
  let token = 0;
  const call = (operation, payload = {}) => injected(operation, { url, token: String(token), ...payload });
  return { form, cards, nexts, controls, call, async apply({ dryRun = false, jobs } = {}) {
    token++;
    const labels = await call('collect', { allowAdvance: true });
    return call('apply', { dryRun, jobs: jobs || labels.map(() => ({ rules: [] })) });
  } };
}
const filledCard = () => card('Question', [new Input('text', 'private pre-existing answer')]);

test('shortcut-next: completion reads filled, manual, unmatched and optional native answers', async () => {
  const blank = new Input();
  const textarea = new Input('text', 'manual'); textarea.tagName = 'TEXTAREA';
  const select = new Input('text', 'chosen'); select.tagName = 'SELECT';
  select.options = [{ value: 'chosen', selected: true, disabled: false }];
  const page = navigationPage([card('Matched', [blank]), filledCard(), card('Optional', [textarea]), card('Select', [select]), card('Date', [new Input('date', '2000-02-29')])]);
  const rows = await page.apply({ jobs: [{ rules: [0], value: 'synthetic fill' }, ...Array(4).fill({ rules: [] })] });
  assert.equal(rows[0].code, 'filled');
  const result = await page.call('advance');
  assert.equal(result.code, 'attempted');
  assert.equal(page.nexts[0].clicks, 1);
  assert.equal(JSON.stringify({ rows, result }).includes('private pre-existing answer'), false);
});

test('shortcut-next: blank optional/whitespace, invalid values and unknown questions prevent normal advance', async () => {
  const invalid = new Input('text', 'bad'); invalid.pattern = '[0-9]+';
  const ariaInvalid = new Input('text', 'answered'); ariaInvalid.attrs['aria-invalid'] = 'true';
  const file = new Input('file', 'chosen');
  for (const question of [card('Optional', [new Input()]), card('Whitespace', [new Input('text', '  \n ')]), card('Invalid', [invalid]),
    card('Aria invalid', [ariaInvalid]), card('Upload', [file]), card('Grid', [new Input('text', 'x')], { grid: true }),
    card('No controls'), card('Unknown heading', [new Input('text', 'x')], { section: true }),
    card('Ambiguous', [new Input('text', 'x'), new Input('text', 'y')])]) {
    const page = navigationPage([filledCard(), question]);
    await page.apply();
    assert.equal((await page.call('advance')).code, 'incomplete');
    assert.equal(page.nexts[0].clicks, 0);
  }
});

test('shortcut-next: a valid selected native/custom choice answers the question, not every option', async () => {
  for (const type of ['radio', 'checkbox']) {
    const native = [new Input(type), new Input(type)];
    native.forEach(input => { input.name = 'choice'; }); native[0].checked = true;
    for (const choices of [native, [choice(type, 'A', true), choice(type, 'B')]]) {
      const page = navigationPage([card('Choice', choices)]);
      await page.apply();
      assert.equal((await page.call('advance')).code, 'attempted');
      assert.equal(page.nexts[0].clicks, 1);
    }
  }
  const listbox = choice('listbox', 'Dropdown');
  listbox.attrs = { role: 'listbox', 'data-value': 'A' };
  const option = choice('option', 'A'); option.attrs = { role: 'option', 'data-value': 'A', 'aria-selected': 'true' };
  listbox.options = [option];
  const page = navigationPage([card('Dropdown', [listbox])]);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'attempted');
});

test('shortcut-next: ambiguous/invalid custom selections remain incomplete', async () => {
  for (const choices of [[choice('radio', 'A', true), choice('radio', 'B', true)], [choice('checkbox', 'A')], [choice('combobox', 'A')]]) {
    const page = navigationPage([card('Choice', choices)]);
    await page.apply();
    assert.equal((await page.call('advance')).code, 'incomplete');
  }
});

test('shortcut-next: override attempts once while native/form validation can still block advancement', async () => {
  const input = new Input(); input.required = true;
  const page = navigationPage([card('Required', [input])]);
  let advanced = 0;
  page.nexts[0].click = () => { page.nexts[0].clicks++; if (input.checkValidity()) advanced++; };
  await page.apply();
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(page.nexts[0].clicks, 1);
  assert.equal(advanced, 0);
  assert.equal(input.required, true);
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
  assert.equal(page.nexts[0].clicks, 1);
});

test('shortcut-next: only one exact enabled non-submit Next outside cards in the same form can click', async () => {
  const cases = [
    [[], 'no-next'], [[{ name: 'Submit' }], 'no-next'], [[{ name: 'ส่ง' }, { name: 'Back' }, { name: 'ย้อนกลับ' }], 'no-next'],
    [[{ name: 'Next', disabled: true }], 'disabled'], [[{ name: 'Next' }, { name: 'ถัดไป' }], 'ambiguous'],
    [[{ name: 'Next', disabled: true }, { name: 'Next' }], 'ambiguous'],
    [[{ name: 'Next', tag: 'BUTTON', type: 'submit' }], 'no-next'], [[{ name: 'Next', tag: 'BUTTON' }], 'no-next'],
    [[{ name: 'Next', tag: 'INPUT', type: 'submit' }], 'no-next'], [[{ name: 'Next plus other text' }], 'no-next'],
    [[{ name: 'Next', outside: true }], 'no-next'], [[{ name: 'Next', inCard: true }], 'no-next'], [[{ name: 'Next', hidden: true }], 'no-next'],
    [[{ name: 'ถัดไป', tag: 'BUTTON', type: 'button' }], 'attempted']
  ];
  for (const [buttons, code] of cases) {
    const page = navigationPage([filledCard()], buttons);
    await page.apply();
    assert.equal((await page.call('advance')).code, code, JSON.stringify(buttons));
    assert.equal(page.nexts.reduce((sum, button) => sum + button.clicks, 0), code === 'attempted' ? 1 : 0);
  }
});

test('shortcut-next: changed cards/control set, URL/document, tokens and release deny even override', async () => {
  const mutations = [
    page => { page.cards.push(filledCard()); }, page => { page.cards[0].controls.push(new Input('text', 'new')); },
    page => { page.cards[0].hidden = true; }, page => { page.cards[0].isConnected = false; },
    () => { location.href += '?changed'; }, () => { document = { ...document }; }
  ];
  for (const mutate of mutations) {
    const page = navigationPage([filledCard()]);
    await page.apply(); mutate(page);
    assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
    assert.equal(page.nexts[0].clicks, 0);
  }
  for (const operation of ['release', 'dry', 'wrong-token', 'no-authority']) {
    const page = navigationPage([filledCard()]);
    if (operation === 'no-authority') {
      await page.call('collect');
      await page.call('apply', { jobs: [{ rules: [] }] });
    } else await page.apply({ dryRun: operation === 'dry' });
    if (operation === 'release') await page.call('release');
    assert.equal((await page.call('advance', { allowIncomplete: true, ...(operation === 'wrong-token' ? { token: 'forged' } : {}) })).code, 'stale');
    assert.equal(page.nexts[0].clicks, 0);
  }
});

test('shortcut-next: unexpected controls cannot hide behind structural roles or card ownership changes', async () => {
  const extra = new Input('file', 'synthetic'); extra.attrs.role = 'presentation';
  let page = navigationPage([card('Question', [new Input('text', 'filled'), extra])]);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'incomplete');
  const first = filledCard(), second = filledCard();
  page = navigationPage([first, second]);
  await page.apply();
  const moved = first.controls.pop(); moved.card = second; second.controls.unshift(moved);
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
  assert.equal(page.nexts[0].clicks, 0);
});

test('shortcut-next: custom dropdown ambiguity and conflicting Next names do not click', async () => {
  const box = choice('listbox', 'Dropdown'); box.attrs = { role: 'listbox', 'data-value': 'A' };
  box.options = [true, false].map(selected => {
    const option = choice('option', 'A'); option.attrs = { role: 'option', 'data-value': 'A', 'aria-selected': String(selected) }; return option;
  });
  let page = navigationPage([card('Dropdown', [box])]);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'incomplete');
  page = navigationPage([filledCard()], [{ name: 'Submit' }]);
  page.nexts[0].attrs['aria-label'] = 'Next';
  await page.apply();
  assert.equal((await page.call('advance')).code, 'no-next');
  assert.equal(page.nexts[0].clicks, 0);
});

test('shortcut-next: authority is consumed on rejected or throwing attempts and never revives', async () => {
  for (const mode of ['wrong-token', 'incomplete', 'click-throws', 'duplicate-apply']) {
    const input = new Input('text', mode === 'incomplete' ? '' : 'synthetic');
    const page = navigationPage([card('Question', [input])]);
    await page.apply();
    if (mode === 'click-throws') {
      page.nexts[0].click = () => { page.nexts[0].clicks++; throw new Error('synthetic handler'); };
      await assert.rejects(page.call('advance'), /synthetic handler/);
    } else if (mode === 'duplicate-apply') {
      await assert.rejects(page.call('apply', { jobs: [{ rules: [] }] }), /หมดอายุ/);
    } else {
      assert.equal((await page.call('advance', mode === 'wrong-token' ? { token: 'wrong' } : {})).code, mode === 'incomplete' ? 'incomplete' : 'stale');
    }
    assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale', mode);
    assert.equal(page.nexts[0].clicks, mode === 'click-throws' ? 1 : 0);
  }
});

test('shortcut-next: page changes during fill, row exceptions and stale/timeout rows deny override', async () => {
  const input = new Input();
  const page = navigationPage([card('Question', [input])]);
  input.dispatchEvent = () => { page.cards.push(filledCard()); };
  await page.apply({ jobs: [{ rules: [0], value: 'synthetic' }] });
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
  for (const mode of ['error', 'stale', 'timeout']) {
    const next = navigationPage([card('Question', [new Input()])]);
    await next.call('collect', { allowAdvance: true });
    const originalNow = Date.now;
    if (mode === 'error') next.cards[0].controls[0].dispatchEvent = () => { throw new Error('synthetic'); };
    if (mode === 'stale') next.cards[0].isConnected = false;
    if (mode === 'timeout') { let time = 0; Date.now = () => (time += 16000); }
    let rows;
    try { rows = await next.call('apply', { jobs: [{ rules: [0], value: 'synthetic' }] }); }
    finally { Date.now = originalNow; }
    assert.equal(rows[0].code, mode);
    assert.equal((await next.call('advance', { allowIncomplete: true })).code, 'stale');
    assert.equal(next.nexts[0].clicks, 0);
  }
});

test('shortcut-next: unrecognized visible cards stay incomplete and new question headings invalidate override', async () => {
  const unknown = card('Unknown widget', [], { section: true });
  let page = navigationPage([filledCard(), unknown]);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'incomplete');
  page = navigationPage([filledCard()]);
  await page.apply();
  const originalQuery = page.cards[0].querySelectorAll;
  const newHeading = { closest: () => page.cards[0], cloneNode: () => ({ textContent: 'New question', querySelectorAll: () => [] }) };
  page.cards[0].querySelectorAll = selector => selector.includes('aria-level="3"') ? [...originalQuery(selector), newHeading] : originalQuery(selector);
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
  assert.equal(page.nexts[0].clicks, 0);
});

function addListWrapper(page) {
  const wrapper = new Input(); wrapper.tagName = 'DIV'; wrapper.attrs = { role: 'list' };
  wrapper.closest = selector => selector === 'form' ? page.form : null;
  const query = page.form.querySelectorAll;
  page.form.querySelectorAll = selector => selector.startsWith('input:not') ? [wrapper, ...query(selector)] : query(selector);
  return wrapper;
}
function staticSection(level = '2', controls = []) {
  const section = card('Static section', controls, { section: true });
  const heading = { isConnected: true, getClientRects: () => [{}],
    closest: selector => selector === '[role="listitem"]' ? section : null,
    cloneNode: () => ({ textContent: 'Static section', querySelectorAll: () => [] }) };
  const query = section.querySelectorAll;
  section.querySelectorAll = selector => selector.includes(`aria-level="${level}"`) ? [heading] : query(selector);
  return section;
}

test('shortcut-next review: structural list wrapper allows completion but unexpected interactive controls do not', async () => {
  const page = navigationPage([filledCard()]);
  const wrapper = addListWrapper(page);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'attempted');
  assert.equal(page.nexts[0].clicks, 1);
  wrapper.attrs.role = 'slider';
  await page.apply();
  assert.equal((await page.call('advance')).code, 'incomplete');
  assert.equal(page.nexts[0].clicks, 1);
});

test('shortcut-next review: every enabled native required checkbox must be valid, even when another is selected', async () => {
  const checks = [true, false].map(checked => {
    const input = new Input('checkbox', 'on');
    input.required = true; input.checked = checked;
    input.checkValidity = () => input.disabled || !input.required || input.checked;
    return input;
  });
  const page = navigationPage([card('Required agreements', checks)]);
  let advanced = 0;
  page.nexts[0].click = () => { page.nexts[0].clicks++; if (checks.every(input => input.checkValidity())) advanced++; };
  await page.apply();
  assert.equal((await page.call('advance')).code, 'incomplete');
  assert.equal(page.nexts[0].clicks, 0);
  await page.apply();
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(page.nexts[0].clicks, 1);
  assert.equal(advanced, 0);
  assert.ok(checks.every(input => input.required));
  checks[1].disabled = true;
  await page.apply();
  assert.equal((await page.call('advance')).code, 'attempted', 'disabled unselected alternative must not block');
  assert.equal(advanced, 1);
});

test('shortcut-next review: static level-1/2 section cards are not unanswered questions', async () => {
  for (const level of ['1', '2']) {
    const page = navigationPage([staticSection(level), filledCard()]);
    await page.apply();
    assert.equal((await page.call('advance')).code, 'attempted');
    assert.equal(page.nexts[0].clicks, 1);
  }
});

test('shortcut-next review: complete questions with a list wrapper and static section advance; changed cards stay stale', async () => {
  const page = navigationPage([staticSection(), filledCard()]);
  addListWrapper(page);
  await page.apply();
  assert.equal((await page.call('advance')).code, 'attempted');
  assert.equal(page.nexts[0].clicks, 1);
  await page.apply();
  page.cards.splice(0, 1);
  assert.equal((await page.call('advance', { allowIncomplete: true })).code, 'stale');
  assert.equal(page.nexts[0].clicks, 1);
});

test('shortcut-next review: sections with visible answer controls or question headings are not static exemptions', async () => {
  const interactive = new Input(); interactive.tagName = 'DIV'; interactive.attrs.role = 'slider';
  const sectionWithQuestion = staticSection();
  const question = card('Question heading');
  const query = sectionWithQuestion.querySelectorAll;
  const questionHeading = { ...question.querySelectorAll('[role="heading"][aria-level="3"]')[0], closest: () => sectionWithQuestion };
  sectionWithQuestion.querySelectorAll = selector => selector.includes('aria-level="3"') ? [questionHeading] : query(selector);
  for (const section of [staticSection('2', [new Input()]), staticSection('2', [interactive]), sectionWithQuestion]) {
    const page = navigationPage([section, filledCard()]);
    await page.apply();
    assert.equal((await page.call('advance')).code, 'incomplete');
    assert.equal(page.nexts[0].clicks, 0);
  }
});
