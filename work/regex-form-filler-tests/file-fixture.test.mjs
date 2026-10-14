import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fakeIDB } from './file-test-helpers.mjs';

test('file fixture: explicit generated drafts use shipping save and never auto-preload or use the chooser', async t => {
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const nodes = new Map();
  const node = () => ({ value: '', textContent: '', disabled: false, hidden: false, style: {}, children: [], handlers: {}, attrs: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    setAttribute(key, value) { this.attrs[key] = value; }, getAttribute(key) { return this.attrs[key] ?? null; },
    hasAttribute(key) { return Object.hasOwn(this.attrs, key); }, removeAttribute(key) { delete this.attrs[key]; }, remove() {}, querySelectorAll() { return []; },
    content: { cloneNode() { return node(); } } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  globalThis.window = {};
  globalThis.document = { body: node(), getElementById: get, createElement: node, querySelectorAll: () => [] };
  get('scenario').value = 'success';
  const fixture = await import('./file-fixture.js?synthetic-draft-test');
  assert.equal(values.size, 0); assert.equal(idb.records.size, 0);
  get('add-file').handlers.click();
  assert.equal(get('form-background').getAttribute('aria-hidden'), 'true');
  assert.equal(JSON.parse(get('counters').textContent).masks, 1);
  window.fileFixture.close();
  assert.equal(get('form-background').getAttribute('aria-hidden'), null);
  assert.equal(JSON.parse(get('counters').textContent).restorations, 1);
  assert.equal(typeof get('create-synthetic').handlers.click, 'function');
  await get('create-synthetic').handlers.click();
  assert.equal(idb.records.size, 0); assert.equal(values.size, 0);
  assert.equal(get('local-file').value, '');
  assert.equal(get('save-file').disabled, false);
  await get('save-file').handlers.click();
  assert.equal(idb.records.size, 1);
  const record = [...idb.records.values()][0];
  assert.equal(record.ref.name, 'TEST-ONLY.pdf'); assert.equal(record.blob instanceof File, true);
  assert.match(await record.blob.text(), /TEST ONLY/);
  const saved = JSON.parse([...values.values()][0]);
  assert.deepEqual(saved[0].value, record.ref); assert.equal('bytes' in saved[0].value, false);
  assert.match(get('file-info').textContent, /synthetic/i);
  assert.equal(typeof fixture.readPickerDiagnostics, 'function');
  const styles = { display: 'block', visibility: 'visible', opacity: '1' };
  globalThis.getComputedStyle = () => styles;
  const inner = {
    URL: 'http://127.0.0.1:8774/picker?do-not-display=query', readyState: 'complete', visibilityState: 'visible',
    defaultView: { getComputedStyle: () => styles, File, DataTransfer: function Transfer() {} },
    getElementById: () => ({ textContent: 'module ready; ticks=2' })
  };
  const visible = { getClientRects: () => [{ width: 400, height: 300 }], checkVisibility: () => true, closest: () => null,
    ownerDocument: inner, getAttribute: name => name === 'aria-label' ? 'Insert file' : null };
  const hiddenInput = { ...visible, getClientRects: () => [], checkVisibility: () => false, disabled: false, multiple: false, files: [] };
  inner.querySelectorAll = selector => selector.includes('input') ? [hiddenInput] : [visible];
  const frame = { ...visible, src: inner.URL, contentDocument: inner };
  const report = fixture.readPickerDiagnostics(frame);
  assert.equal(report.contentDocument, true); assert.equal(report.actualURL, 'http://127.0.0.1:8774/picker');
  assert.equal(report.dialogs[0].name, 'Insert file'); assert.equal(report.dialogs[0].shippingVisible, true);
  assert.equal(report.inputs[0].files, 0); assert.equal(report.inputs[0].disabled, false);
  assert.equal(report.inputs[0].shippingVisible, false); assert.match(report.module, /ticks=2/);
  assert.equal(JSON.stringify(report).includes('do-not-display'), false);
  const denied = { ...frame, get contentDocument() { throw new Error('blocked'); } };
  assert.equal(fixture.readPickerDiagnostics(denied).contentDocument, 'denied');

  await get('save-pair').handlers.click();
  const pair = JSON.parse([...values.values()][0]);
  assert.deepEqual(pair.map(rule => rule.pattern), ['^Upload$', '^Upload 2$']);
  assert.deepEqual(pair.map(rule => rule.value.name), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.equal(new Set(pair.map(rule => rule.value.fileId)).size, 2); assert.equal(idb.records.size, 2);
  const { prepareFiles } = await import('../../outputs/regex-form-filler/file-store.js');
  const bytes = await prepareFiles(pair.map((rule, i) => ({ rules: [i], value: rule.value })), false);
  assert.deepEqual(pair.map(rule => atob(bytes[rule.value.fileId])), ['TEST ONLY - first synthetic file.\n', 'TEST ONLY - distinct second synthetic bytes.\n']);
  assert.equal(get('local-file').value, '');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['sequence-name-first', 'sequence-close-first']) {
    get('scenario').value = mode; get('scenario').handlers.change();
    assert.equal(get('second-question').hidden, false);
    get('add-file').handlers.click(); window.fileFixture.finish('TEST-ONLY.pdf');
    assert.equal(get('form-background').getAttribute('aria-hidden'), 'true');
    assert.equal(JSON.parse(get('counters').textContent).attached, mode === 'sequence-name-first' ? 1 : 0);
    t.mock.timers.tick(700);
    assert.equal(JSON.parse(get('counters').textContent).attached, 1);
    assert.equal(get('form-background').getAttribute('aria-hidden'), 'true');
    t.mock.timers.tick(1000);
    assert.equal(get('form-background').getAttribute('aria-hidden'), null);
    assert.equal(JSON.parse(get('counters').textContent).restorations, 1);
  }
});

test('file fixture: parsed input precedes deferred module handlers and missed events are never replayed', async () => {
  const html = await readFile(new URL('./file-picker.html', import.meta.url), 'utf8');
  const script = '<script type="module" src="/work/regex-form-filler-tests/file-picker.js"></script>';
  assert.ok(html.indexOf('id="upload"') >= 0 && html.indexOf(script) > html.indexOf('id="upload"'));
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', handlers: {}, files: [],
      addEventListener(type, handler) { this.handlers[type] = handler; },
      emit(type) { this.handlers[type]?.(); } });
    return nodes.get(id);
  };
  const input = get('upload');
  input.files = [new File(['TEST ONLY'], 'TEST-ONLY.pdf', { type: 'application/pdf' })];
  input.emit('input'); input.emit('change');
  const events = [], attachments = [], timers = [];
  const doc = { readyState: 'interactive', getElementById: get };
  const context = { document: doc, window: { frameElement: { closest: () => ({}) } },
    parent: { fileFixture: { mode: 'success', event: type => events.push(type), finish: name => attachments.push(name) } },
    setTimeout: (callback, ms) => timers.push({ callback, ms }) };
  runInNewContext(await readFile(new URL('./file-picker.js', import.meta.url), 'utf8'), context);
  assert.match(get('module-marker').textContent, /Module ready/);
  assert.deepEqual(events, []); assert.deepEqual(attachments, []);
  doc.readyState = 'complete';
  input.emit('input'); input.emit('change');
  assert.deepEqual(events, ['input', 'change']);
  assert.match(get('progress').textContent, /Received actual File: TEST-ONLY.pdf/);
  timers.find(timer => timer.ms === 700).callback();
  assert.deepEqual(attachments, ['TEST-ONLY.pdf']);
});

test('file fixture: sequence picker removes the handed-off input before async completion', async () => {
  const nodes = new Map(), events = [], attached = [], timers = [];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { handlers: {}, files: [], removed: false,
      addEventListener(type, handler) { this.handlers[type] = handler; }, remove() { this.removed = true; } });
    return nodes.get(id);
  };
  const context = { document: { getElementById: get }, window: { frameElement: { closest: () => ({}) } },
    parent: { fileFixture: { mode: 'sequence-close-first', event: type => events.push(type), finish: name => attached.push(name) } },
    setTimeout: (callback, ms) => timers.push({ callback, ms }) };
  runInNewContext(await readFile(new URL('./file-picker.js', import.meta.url), 'utf8'), context);
  get('upload').files = [new File(['different bytes'], 'SECOND-ONLY.pdf', { type: 'application/pdf' })];
  get('upload').handlers.input(); get('upload').handlers.change();
  assert.equal(get('upload').removed, true); assert.deepEqual(events, ['input', 'change', 'removedInputs']); assert.deepEqual(attached, []);
  timers.find(timer => timer.ms === 700).callback();
  assert.deepEqual(attached, ['SECOND-ONLY.pdf']);
});
