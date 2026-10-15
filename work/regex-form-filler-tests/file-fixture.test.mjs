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

  get('scenario').value = 'removed-tombstone'; get('scenario').handlers.change();
  assert.equal(get('second-question').hidden, false);
  const removed = get('selected-second').children[0];
  assert.equal(removed.getAttribute('data-tooltip'), 'SECOND-ONLY.pdf');
  assert.equal(removed.getAttribute('jscontroller'), 'By0w6');
  assert.equal(removed.children.length, 0); assert.equal(removed.textContent, '');
});

function pickerFixture(t, mode, readyState = 'complete') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const nodes = new Map(), events = [], attachments = [];
  const node = () => ({ textContent: '', handlers: {}, files: [], removed: false,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    emit(type) { this.handlers[type]?.(); },
    cloneNode() { const fresh = node(); fresh.accept = this.accept; return fresh; },
    replaceWith(fresh) { this.removed = true; nodes.set('upload', fresh); },
    remove() { this.removed = true; }
  });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const document = { readyState, getElementById: get };
  const context = { document, Date, setTimeout, window: { frameElement: { closest: () => ({}) } },
    parent: { fileFixture: { mode, event: type => events.push(type), finish: name => attachments.push(name) } } };
  return { get, document, events, attachments,
    async start() { runInNewContext(await readFile(new URL('./file-picker.js', import.meta.url), 'utf8'), context); }
  };
}

test('file fixture: late input replacement discards the provisional upload without replaying it', async t => {
  const p = pickerFixture(t, 'settling-two'); await p.start();
  const initial = p.get('upload');
  t.mock.timers.tick(1200);
  initial.files = [new File(['TEST ONLY'], 'TEST-ONLY.pdf', { type: 'application/pdf' })];
  initial.emit('input'); initial.emit('change');
  assert.deepEqual(p.events, ['input', 'change']); assert.deepEqual(p.attachments, []);
  t.mock.timers.tick(600);
  const fresh = p.get('upload');
  assert.notEqual(fresh, initial); assert.equal(initial.removed, true); assert.deepEqual(fresh.files, []);
  t.mock.timers.tick(100);
  assert.deepEqual(p.attachments, [], 'completion from the provisional input must not attach or replay');
  fresh.files = [new File(['TEST ONLY'], 'TEST-ONLY.pdf', { type: 'application/pdf' })];
  fresh.emit('input'); fresh.emit('change'); t.mock.timers.tick(700);
  assert.deepEqual(p.attachments, ['TEST-ONLY.pdf']);
});

test('file fixture: parsed input precedes module handlers and initialization replaces it without replay', async t => {
  const html = await readFile(new URL('./file-picker.html', import.meta.url), 'utf8');
  const script = '<script type="module" src="/work/regex-form-filler-tests/file-picker.js"></script>';
  assert.ok(html.indexOf('id="upload"') >= 0 && html.indexOf(script) > html.indexOf('id="upload"'));
  const p = pickerFixture(t, 'success', 'interactive');
  const initial = p.get('upload'); initial.files = [new File(['TEST ONLY'], 'TEST-ONLY.pdf', { type: 'application/pdf' })];
  initial.emit('input'); initial.emit('change'); await p.start();
  assert.match(p.get('module-marker').textContent, /Module ready/);
  assert.deepEqual(p.events, []); assert.deepEqual(p.attachments, []);
  p.document.readyState = 'complete'; t.mock.timers.tick(600);
  const fresh = p.get('upload');
  assert.notEqual(fresh, initial); assert.equal(initial.removed, true); assert.deepEqual(fresh.files, []);
  assert.deepEqual(p.events, []); assert.deepEqual(p.attachments, []);
  fresh.files = [new File(['TEST ONLY'], 'TEST-ONLY.pdf', { type: 'application/pdf' })];
  fresh.emit('input'); fresh.emit('change');
  assert.deepEqual(p.events, ['input', 'change']); assert.match(p.get('progress').textContent, /Received actual File: TEST-ONLY.pdf/);
  t.mock.timers.tick(700); assert.deepEqual(p.attachments, ['TEST-ONLY.pdf']);
});

test('file fixture: sequence picker removes the initialized input before async completion', async t => {
  const p = pickerFixture(t, 'sequence-close-first'); await p.start(); t.mock.timers.tick(600);
  const input = p.get('upload');
  input.files = [new File(['different bytes'], 'SECOND-ONLY.pdf', { type: 'application/pdf' })];
  input.emit('input'); input.emit('change');
  assert.equal(input.removed, true); assert.deepEqual(p.events, ['input', 'change', 'removedInputs']); assert.deepEqual(p.attachments, []);
  t.mock.timers.tick(700); assert.deepEqual(p.attachments, ['SECOND-ONLY.pdf']);
});

test('file fixture: no-replacement scenario retains the initial input without synthetic events', async t => {
  const p = pickerFixture(t, 'no-replacement'); await p.start(); const input = p.get('upload');
  t.mock.timers.tick(60000);
  assert.equal(p.get('upload'), input); assert.equal(input.removed, false);
  assert.deepEqual(p.events, []); assert.deepEqual(p.attachments, []);
});
