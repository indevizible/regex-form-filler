import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { fileRef } from './file-test-helpers.mjs';

// Small DOM boundary double; the browser fixture is the File/DataTransfer integration check.
class Element {
  constructor(tag = 'div', attrs = {}, text = '') { Object.assign(this, { tagName: tag.toUpperCase(), attrs, ownText: text, children: [], hidden: false, clicks: 0, events: [], disabled: false, type: attrs.type || '', files: [], multiple: false }); }
  changed() { for (let node = this; node; node = node.parentElement) for (const observer of node.observers || []) observer.records.push({ target: this }); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } this.changed(); }
  get childNodes() { return this.ownText ? [{ textContent: this.ownText }, ...this.children] : this.children; }
  getAttributeNames() { return Object.keys(this.attrs); }
  remove() { this.changed(); if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
  get isConnected() { return this.root === true || !!this.parentElement?.isConnected; }
  get textContent() { return this.ownText + this.children.map(x => x.textContent).join(''); }
  set textContent(value) { this.ownText = value; this.children = []; this.changed(); }
  get ownerDocument() { return this.doc || this.parentElement?.ownerDocument; }
  get src() { return this.attrs.src || ''; }
  get accept() { return this.attrs.accept || ''; }
  getClientRects() { for (let node = this; node; node = node.parentElement) if (node.hidden) return []; return [{}]; }
  checkVisibility() { for (let node = this; node; node = node.parentElement) if (node.css?.display === 'none' || node.css?.opacity === '0' || ['hidden', 'collapse'].includes(node.css?.visibility)) return false; return true; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  setAttribute(name, value) { this.attrs[name] = value; this.changed(); }
  matches(selector) {
    return selector.split(',').some(part => {
      let term = part.trim();
      if (term === ':disabled') return this.disabled;
      let denied = false;
      term = term.replace(/:not\(([^)]+)\)/g, (_, inner) => { if (this.matches(inner)) denied = true; return ''; });
      if (denied) return false;
      const tag = term.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return [...term.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) => value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value);
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  contains(other) { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelectorAll('*').find(node => node.getAttribute('id') === id) || null; }
  cloneNode() { return new Element('div', {}, this.textContent); }
  click() { this.clicks++; this.onClick?.(); }
  dispatchEvent(event) { this.events.push(event.type); this.onEvent?.(event); }
  checkValidity() { return true; }
}

function page(mode = 'success', options = {}) {
  const url = 'https://docs.google.com/forms/d/e/synthetic/formResponse';
  const document = new Element(); document.root = true; document.doc = document; document.URL = url;
  const background = new Element('div', { class: 'Uc2NEf' }); document.append(background);
  const form = new Element('form', { id: 'mG61Hd' }); background.append(form);
  const wrapper = new Element('div', { role: 'list' }); form.append(wrapper);
  const section = new Element('div', { role: 'listitem' }); section.append(new Element('div', { role: 'heading', 'aria-level': '2' }, 'Section')); wrapper.append(section);
  const card = new Element('div', { role: 'listitem' }); wrapper.append(card);
  const heading = new Element('div', { role: 'heading', 'aria-level': '3' }, 'Upload'); card.append(heading);
  const selected = new Element('div', { role: 'list', 'aria-label': 'Selected files' }); card.append(selected);
  const add = new Element('div', { role: 'button', 'aria-label': 'Add file' }, 'Add file'); card.append(add);
  const questions = [{ card, heading, selected, add }];
  for (let i = 1; i < (options.fileCount ?? (options.twoFiles ? 2 : 1)); i++) {
    const second = { card: new Element('div', { role: 'listitem' }), heading: new Element('div', { role: 'heading', 'aria-level': '3' }, i === 1 ? 'Second' : `Upload ${i + 1}`),
      selected: new Element('div', { role: 'list', 'aria-label': 'Selected files' }), add: new Element('div', { role: 'button' }, 'Add file') };
    second.card.append(second.heading, second.selected, second.add); wrapper.append(second.card); questions.push(second);
  }
  let active = questions[0];
  const mask = options.mask === 'form' ? form : background;
  if (options.labelledAdd) add.attrs['aria-labelledby'] = 'i1 i4';
  const next = new Element('div', { role: 'button' }, 'Next'); form.append(next);
  const submit = new Element('button', { type: 'submit' }, 'Submit'); form.append(submit);
  let clock = 0, ticks = 0, uploadTicks, closedTick, iframe, dialog, inner, input, confirm, handedFile, replaceInput, initializePicker;
  const assignmentStates = [], eventStates = [], assignmentMasks = [], inputs = [], openStates = [], progresses = [];
  const refs = [fileRef(), fileRef({ fileId: '07687bdb-d884-49fe-9b25-3f7d0309ae09', name: 'SECOND-ONLY.pdf', size: 6 })];
  const oldFrame = new Element('iframe', { src: 'https://docs.google.com/picker?old=1' });
  oldFrame.hidden = true;
  if (options.retainedPicker) {
    const oldDialog = new Element('div', { role: 'dialog', 'aria-label': 'Insert file' }); oldDialog.hidden = true;
    oldDialog.append(oldFrame); document.append(oldDialog);
  }
  const close = (remove = false) => {
    if (remove) dialog.remove(); else dialog.hidden = true;
    if (closedTick === undefined) {
      closedTick = ticks;
      options.onClose?.({ background, form, ...active, dialog, iframe, inner, input, document });
    }
    if (!options.keepMask && !options.restoreAfterTicks) delete mask.attrs['aria-hidden'];
  };
  const attach = name => {
    const row = new Element('div', { role: 'listitem' });
    row.append(new Element('span', {}, name), new Element('button', { type: 'button' }, 'Remove file'));
    active.selected.append(row);
  };
  if (mode === 'prefilled' || options.preexisting) attach('existing.pdf');
  const open = (question = questions[0]) => {
    openStates.push({ mask: mask.getAttribute('aria-hidden'), attachments: questions.map(q => q.selected.children.length), next: next.clicks });
    active = question; uploadTicks = closedTick = undefined;
    if (options.mask) mask.attrs['aria-hidden'] = 'true';
    dialog = new Element('div', { role: 'dialog', 'aria-labelledby': `picker-title-${inputs.length}` });
    dialog.append(new Element('h2', { id: `picker-title-${inputs.length}` }, 'Insert file')); document.append(dialog);
    if (options.mask) {
      const overlay = new Element('iframe', { src: 'about:blank', 'aria-hidden': 'true' }); overlay.css = { opacity: '0' }; document.append(overlay);
    }
    iframe = new Element('iframe', { src: mode === 'unknown' ? 'https://other.example/picker' : 'https://docs.google.com/picker?ignored=1' }); dialog.append(iframe);
    inner = new Element(); inner.root = true; inner.doc = inner; inner.URL = iframe.src;
    inner.readyState = options.initialReadyState ?? 'complete';
    const innerWrapper = options.innerProgress ? new Element() : inner;
    if (innerWrapper !== inner) inner.append(innerWrapper);
    const openedAt = clock;
    const innerDialog = new Element('div', { role: 'dialog', 'aria-label': 'Insert file' }); innerWrapper.append(innerDialog);
    if (mode === 'labelled-dialog') {
      delete innerDialog.attrs['aria-label']; innerDialog.attrs['aria-labelledby'] = 'picker-title';
      innerDialog.append(new Element('h2', { id: 'picker-title' }, 'Insert file'));
    }
    input = new Element('input', { type: 'file', accept: options.accept ?? (mode === 'reject' ? 'image/png' : 'application/pdf') });
    input.hidden = options.hiddenInput === true;
    inputs.push(input);
    const browse = new Element('button', { type: 'button' }, 'Browse');
    innerDialog.append(browse, input);
    class Transfer { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } }
    class Observer {
      constructor() { this.records = []; this.targets = []; }
      observe(target) { (target.observers ||= new Set()).add(this); this.targets.push(target); }
      takeRecords() { return this.records.splice(0); }
      disconnect() { this.targets.forEach(target => target.observers.delete(this)); }
    }
    inner.documentElement = inner;
    inner.defaultView = { File, DataTransfer: Transfer, Event, MutationObserver: Observer, HTMLInputElement: class {} };
    Object.defineProperty(inner.defaultView.HTMLInputElement.prototype, 'files', { set(files) {
      assignmentStates.push(inner.readyState); assignmentMasks.push(mask.getAttribute('aria-hidden')); this.files = files;
      if (mode === 'reload-before-input') inner.readyState = 'loading';
      options.onAssign?.({ input: this, inner, iframe, replaceInput });
    } });
    iframe.contentDocument = inner; iframe.contentWindow = inner.defaultView;
    if (mode === 'denied') Object.defineProperty(iframe, 'contentDocument', { get() { throw new Error('denied'); } });
    if (mode === 'multiple-input') innerDialog.append(new Element('input', { type: 'file' }));
    if (mode === 'multiple') input.multiple = true;
    if (mode === 'confirm') {
      confirm = new Element('button', { type: 'button' }, 'Insert 1 item');
      innerDialog.append(confirm);
      confirm.onClick = () => { attach(handedFile.name); close(); };
    }
    input.onEvent = event => {
      eventStates.push([event.type, inner.readyState]);
      if (inner.readyState !== 'complete') return; // Deferred module handlers have not bound yet.
      if (event.type === 'input') options.onInput?.({ input, inner, iframe, replaceInput });
      if (mode === 'reload-before-change' && event.type === 'input') inner.readyState = 'loading';
      if (event.type !== 'change' || clock - openedAt < (options.handlersAfterMs || 0)) return;
      uploadTicks = ticks; handedFile = input.files[0];
      if (options.innerProgress) {
        const progress = new Element('div', { role: 'dialog', 'aria-label': 'Uploading' });
        inner.append(progress); innerWrapper.attrs['aria-hidden'] = 'true';
        const insert = new Element('button', { type: 'button' }, 'Insert 1 item');
        progress.append(new Element('div', { role: 'option', 'aria-selected': 'true' }, handedFile.name), insert);
        progresses.push({ wrapper: innerWrapper, progress, insert, innerDialog, inner, iframe, polls: 0 });
      }
      if (options.removeInput) input.remove();
      if (options.resetInput) input.files = [];
      options.afterChange?.({ background, form, ...active, dialog, iframe, inner, input, document });
      if (mode === 'confirm') {
        const item = new Element('div', { role: 'option', 'aria-selected': 'true' });
        item.append(new Element('span', {}, handedFile.name)); innerDialog.append(item);
      }
    };
    replaceInput = () => {
      const old = input;
      input = new Element('input', { ...old.attrs }); input.hidden = old.hidden; input.onEvent = old.onEvent;
      input.multiple = old.multiple; input.disabled = old.disabled;
      old.parentElement.append(input); old.remove(); inputs.push(input);
      return input;
    };
    let readyAt;
    initializePicker = () => {
      if (options.initializeAfterMs === false || inner.readyState !== 'complete' || inner.URL !== iframe.src || !input.isConnected) return;
      readyAt ??= clock;
      if (clock - readyAt >= (options.initializeAfterMs ?? 600)) { replaceInput(); initializePicker = undefined; }
    };
    options.onOpen?.({ background, form, ...active, dialog, iframe, inner, input, browse, document });
  };
  questions.forEach(question => { question.add.onClick = () => open(question); });
  if (mode === 'already-open') open();
  const context = {
    document, location: { href: url, origin: 'https://docs.google.com' }, URL, Uint8Array, atob, File, Blob,
    getComputedStyle: node => ({ visibility: 'visible', display: 'block', ...node.css }),
    Date: { now: () => clock }, clearTimeout() {},
    setTimeout(callback, ms) {
      clock += closedTick !== undefined && options.closurePollGap ? options.closurePollGap : options.fastClock && input?.events.includes('change') ? 20000 : ms; ticks++;
      if (inner && ticks >= options.completeAfterTicks) inner.readyState = 'complete';
      initializePicker?.();
      if (ticks === options.changeHeadingAtTick) heading.textContent = 'Changed';
      const progress = progresses.at(-1);
      if (progress?.progress.isConnected) {
        progress.polls++;
        if (!options.persistProgress && ticks >= uploadTicks + 4) {
          progress.progress.remove(); delete progress.wrapper.attrs['aria-hidden'];
        }
      }
      if (uploadTicks !== undefined && ticks > uploadTicks + 1) {
        if (mode === 'stale') heading.textContent = 'Changed';
        else if (mode === 'inner-progress' && !progress.progress.isConnected) {
          close();
          if (ticks > closedTick && !active.selected.children.length) attach(handedFile.name);
        }
        else if (mode === 'cancel') close(true);
        else if (['name-open', 'name-first', 'hide-first', 'removed-first', 'other-modal', 'progress'].includes(mode)) {
          if (mode === 'hide-first') close();
          if (mode === 'removed-first') close(true);
          if (!active.selected.children.length && (!['hide-first', 'removed-first'].includes(mode) || ticks > uploadTicks + 4)) attach(handedFile.name);
          if (mode === 'name-first' && ticks > uploadTicks + 4) close();
          if (mode === 'other-modal') {
            close();
            if (!document.querySelector('[aria-label="User modal"]')) document.append(new Element('div', { role: 'dialog', 'aria-label': 'User modal' }));
          }
          if (mode === 'progress') {
            close();
            if (!document.querySelector('[role="progressbar"]')) document.append(new Element('div', { role: 'progressbar' }));
          }
        }
        else if (['success', 'wrong', 'labelled-dialog'].includes(mode) && !active.selected.querySelector('span')) { attach(mode === 'wrong' ? 'prefix-TEST-ONLY.pdf' : handedFile.name); close(); }
      }
      if (closedTick !== undefined && !options.keepMask && ticks >= closedTick + options.restoreAfterTicks) delete mask.attrs['aria-hidden'];
      options.onTick?.({ background, form, ...active, dialog, iframe, inner, input, document, closedTick, ticks, clock, replaceInput });
      Promise.resolve().then(callback); return ticks;
    }
  };
  const injected = runInNewContext(`(${formDOM.toString()})`, context);
  const call = (operation, data = {}) => injected(operation, { url, token: 'file-test', ...data });
  return { add, selected, next, submit, card, heading, background, form, questions, context, call, oldFrame, inputs, openStates, assignmentStates, assignmentMasks, eventStates, progresses, get elapsed() { return clock; }, get input() { return input; }, get confirm() { return confirm; },
    async run(dryRun = false, extra = {}) {
      const labels = await call('collect', { allowAdvance: true });
      assert.deepEqual(Array.from(labels), questions.map(q => q.heading.textContent));
      return call('apply', { dryRun, jobs: questions.map((_, i) => ({ rules: [i], value: refs[i % refs.length] })), files: dryRun ? {} : { [refs[0].fileId]: 'dGVzdA==', [refs[1].fileId]: 'c2Vjb25k' }, ...extra });
    } };
}

test('file DOM: serialized success verifies outer attachment, ignores nested rows and permits one Next', async () => {
  const p = page(); const rows = await p.run();
  assert.equal(rows[0].code, 'filled'); assert.equal(p.add.clicks, 1);
  assert.equal(p.input.files[0].name, 'TEST-ONLY.pdf'); assert.equal(await p.input.files[0].text(), 'test');
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.next.clicks, 1);
  assert.equal((await p.call('advance', { allowIncomplete: true })).code, 'stale'); assert.equal(p.submit.clicks, 0);
  assert.equal(JSON.stringify(rows).includes('TEST-ONLY'), false);
});

test('file DOM: dry-run and existing selections never open or write the picker', async () => {
  const dry = page(); assert.equal((await dry.run(true))[0].code, 'ready'); assert.equal(dry.add.clicks, 0);
  const existing = page('prefilled'); assert.equal((await existing.run())[0].code, 'preserved'); assert.equal(existing.add.clicks, 0);
  assert.equal((await existing.call('advance')).code, 'attempted');
});

test('file DOM: reject unknown/open/denied/ambiguous pickers, MIME and single-file mismatches without assignment', async () => {
  for (const mode of ['already-open', 'unknown', 'denied', 'multiple-input', 'multiple', 'reject']) {
    const p = page(mode, { fastClock: true });
    const rows = await p.run();
    assert.notEqual(rows[0].code, 'filled', mode); assert.notEqual(rows[0].code, 'ready', mode);
    assert.equal(rows[0].diagnostic, mode === 'already-open' ? 'file-preflight' : ['multiple', 'reject'].includes(mode) ? 'file-handoff' : 'picker-discovery', mode);
    assert.equal(p.input?.events.length || 0, 0, mode);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', mode);
    assert.equal(p.next.clicks + p.submit.clicks, 0);
    if (mode === 'already-open') assert.equal(p.add.clicks, 0);
  }
});

test('file DOM: wrong filename, changed heading, cancel and timeout never authorize Next or retry', async () => {
  for (const mode of ['wrong', 'stale', 'cancel', 'timeout']) {
    const p = page(mode, { fastClock: mode === 'timeout' });
    const rows = await p.run();
    assert.ok(['pending', 'timeout', 'stale', 'file-manual'].includes(rows[0].code), `${mode}: ${rows[0].code}`);
    assert.equal(rows[0].diagnostic, { wrong: 'selection-not-exact', stale: 'owner-form-changed', cancel: 'close-grace-expired', timeout: 'overall-timeout' }[mode]);
    assert.equal(p.add.clicks, 1); assert.equal(p.input.events.filter(x => x === 'change').length, 1);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file DOM: missing bytes/string paths and changed list identity do not upload', async () => {
  const missing = page(); const [row] = await missing.run(false, { files: {} });
  assert.equal(row.code, 'file-missing'); assert.equal(row.diagnostic, 'file-data'); assert.equal(missing.add.clicks, 0);
  const path = page(); assert.equal((await path.run(false, { jobs: [{ rules: [0], value: '/tmp/file.pdf' }] }))[0].code, 'unsupported'); assert.equal(path.add.clicks, 0);
  const stale = page(); await stale.call('collect', { allowAdvance: true }); stale.selected.remove();
  assert.notEqual((await stale.call('apply', { jobs: [{ rules: [0], value: fileRef() }], files: { [fileRef().fileId]: 'dGVzdA==' } }))[0].code, 'filled');
  assert.equal(stale.add.clicks, 0);
});

test('file DOM: accepts extension tokens and narrowly confirms one selected filename', async () => {
  for (const [mode, accept] of [['success', '.pdf'], ['confirm', 'application/*']]) {
    const p = page(mode, { accept }); assert.equal((await p.run())[0].code, 'filled');
    if (mode === 'confirm') assert.equal(p.confirm.clicks, 1);
    assert.equal(p.submit.clicks, 0);
  }
});

test('file DOM: ten MiB boundary decodes without regex stack overflow or partial writes', async () => {
  const p = page(); const ref = fileRef({ size: 10485760 });
  const rows = await p.run(false, { jobs: [{ rules: [0], value: ref }], files: { [ref.fileId]: Buffer.alloc(ref.size, 65).toString('base64') } });
  assert.equal(rows[0].code, 'filled'); assert.equal(p.input.files[0].size, 10485760);
});

test('file DOM: successful upload with a newly opened unrelated modal cannot advance', async () => {
  const p = page(); assert.equal((await p.run())[0].code, 'filled');
  p.context.document.append(new Element('div', { role: 'dialog' }, 'User selection'));
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted'); assert.equal(p.next.clicks, 0);
});

test('file DOM: named dialog through aria-labelledby works', async () => {
  const labelled = page('labelled-dialog'); assert.equal((await labelled.run())[0].code, 'filled');
});

test('file DOM: visible text outside an attachment row is not proof, even with Next override', async () => {
  const unknown = page(); unknown.selected.append(new Element('div', {}, 'Still uploading'));
  assert.equal((await unknown.run())[0].code, 'preserved');
  assert.notEqual((await unknown.call('advance', { allowIncomplete: true })).code, 'attempted');
});

test('file DOM: uncertain first upload stops remaining file jobs even with Next override', async () => {
  const p = page('wrong');
  const card = new Element('div', { role: 'listitem' });
  const add = new Element('div', { role: 'button', 'aria-label': 'Add file' }, 'Add file');
  card.append(new Element('div', { role: 'heading', 'aria-level': '3' }, 'Second'), new Element('div', { role: 'list', 'aria-label': 'Selected files' }), add);
  p.card.parentElement.append(card);
  await p.call('collect', { allowAdvance: true });
  const rows = await p.call('apply', { jobs: [0, 1].map(i => ({ rules: [i], value: fileRef() })), files: { [fileRef().fileId]: 'dGVzdA==' } });
  assert.deepEqual(Array.from(rows, row => row.code), ['pending', 'pending']);
  assert.deepEqual(Array.from(rows, row => row.diagnostic), ['selection-not-exact', 'previous-unconfirmed']);
  assert.equal(add.clicks, 0); assert.equal(p.add.clicks, 1);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
});

test('file review: exact Add file allows question aria-labelledby but independent Next still rejects it', async () => {
  const p = page('success', { labelledAdd: true });
  assert.equal((await p.run())[0].code, 'filled'); assert.equal(p.add.clicks, 1);
  p.next.attrs['aria-labelledby'] = 'i1 i4';
  assert.equal((await p.call('advance', { allowIncomplete: true })).code, 'no-next');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file review: outer exact filename while owned picker remains open must wait to timeout', async () => {
  const p = page('name-open');
  assert.equal((await p.run())[0].code, 'timeout');
  assert.ok(p.elapsed >= 60000 && p.elapsed < 60200);
  assert.equal(p.add.clicks, 1); assert.equal(p.input.events.filter(x => x === 'change').length, 1);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
});

test('file review: outer filename and picker hiding/removal can settle in either order', async () => {
  for (const mode of ['name-first', 'hide-first', 'removed-first']) {
    const p = page(mode);
    assert.equal((await p.run())[0].code, 'filled', mode);
    assert.ok(p.elapsed >= 1000, mode);
    assert.equal((await p.call('advance')).code, 'attempted', mode);
    assert.equal(p.add.clicks, 1); assert.equal(p.submit.clicks, 0);
  }
});

test('file review: no success with another modal or outer upload progress after exact filename appears', async () => {
  for (const mode of ['other-modal', 'progress']) {
    const p = page(mode, { fastClock: true });
    assert.notEqual((await p.run())[0].code, 'filled', mode);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file review: hidden native file input in new visible picker works with old hidden iframe retained', async () => {
  const p = page('success', { hiddenInput: true, retainedPicker: true });
  assert.equal((await p.run())[0].code, 'filled');
  assert.equal(p.input.hidden, true); assert.equal(p.input.files[0].name, 'TEST-ONLY.pdf');
  assert.equal(p.oldFrame.isConnected, true); assert.equal(p.oldFrame.hidden, true);
  assert.equal((await p.call('advance')).code, 'attempted');
});

test('file readiness: interactive input waits for complete before assignment and dispatch to module handlers', async () => {
  const p = page('success', { initialReadyState: 'interactive', completeAfterTicks: 4, hiddenInput: true, retainedPicker: true });
  assert.equal((await p.run())[0].code, 'filled');
  assert.deepEqual(p.assignmentStates, ['complete']);
  assert.deepEqual(p.eventStates, [['input', 'complete'], ['change', 'complete']]);
  assert.equal(p.add.clicks, 1); assert.equal(p.selected.children.length, 1);
  assert.equal((await p.call('advance')).code, 'attempted');
  assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
});

for (const [name, delays] of [
  ['one picker initializes after twelve seconds', [12000]],
  ['two delayed pickers upload strictly in order', [12000, 13500]],
  ['discovery near the old deadline leaves time for settling', [9600]]
]) test(`file discovery budget: ${name}`, async () => {
  let openedAt, current, earlyAdvance;
  const handedAt = [];
  const p = page('success', { mask: 'ancestor', restoreAfterTicks: 3, twoFiles: delays.length === 2,
    initialReadyState: 'loading', hiddenInput: true,
    onOpen: state => {
      openedAt = p.elapsed; current = state;
      state.inner.URL = 'about:blank'; state.browse.remove(); state.input.remove();
    },
    onTick: state => {
      if (!earlyAdvance) earlyAdvance = p.call('advance', { allowIncomplete: true });
      assert.equal(p.next.clicks, 0);
      if (!p.questions[0].selected.children.length || p.background.getAttribute('aria-hidden') === 'true' && p.openStates.length === 1) {
        assert.equal(p.questions[1]?.add.clicks || 0, 0);
      }
      if (state.clock - openedAt >= delays[p.openStates.length - 1] && state.inner.readyState !== 'complete') {
        state.inner.URL = state.iframe.src; state.inner.readyState = 'complete';
        state.inner.querySelector('[role="dialog"]').append(current.browse, current.input);
      }
    },
    onAssign: () => handedAt.push(p.elapsed - openedAt)
  });
  assert.deepEqual(Array.from(await p.run(), row => row.code), delays.map(() => 'filled'));
  assert.notEqual((await earlyAdvance).code, 'attempted');
  assert.deepEqual(p.assignmentStates, delays.map(() => 'complete'));
  assert.deepEqual(p.inputs.map(input => input.events), delays.flatMap(() => [[], ['input', 'change']]));
  assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf'].slice(0, delays.length));
  assert.deepEqual(p.inputs.map(input => input.files[0]?.name), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf'].slice(0, delays.length).flatMap(name => [undefined, name]));
  assert.ok(handedAt.every((time, i) => time >= delays[i] + 1000 && time < 60000));
  assert.deepEqual(p.questions.map(q => q.add.clicks), delays.map(() => 1));
  assert.deepEqual(p.openStates, delays.length === 2 ? [
    { mask: null, attachments: [0, 0], next: 0 }, { mask: null, attachments: [1, 0], next: 0 }
  ] : [{ mask: null, attachments: [0], next: 0 }]);
  assert.equal((await p.call('advance')).code, 'attempted');
  assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
});

test('file readiness: loading, interactive or ready-at-expiry picker exhausts the file budget without assignment or Next', async () => {
  for (const options of [{ initialReadyState: 'loading' }, { initialReadyState: 'interactive' }, { initialReadyState: 'loading', completeAfterTicks: 400 }]) {
    const p = page('success', options);
    const [row] = await p.run();
    assert.equal(row.code, 'timeout'); assert.equal(row.diagnostic, 'picker-discovery-timeout');
    assert.ok(p.elapsed >= 60000 && p.elapsed < 60200);
    assert.deepEqual(p.assignmentStates, []); assert.deepEqual(p.input.events, []);
    assert.equal(p.input.files.length, 0); assert.equal(p.add.clicks, 1);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file discovery budget: cancellation or owner drift while the document is still blank stops at the next poll', async () => {
  for (const change of [
    state => state.dialog.remove(),
    state => { state.heading.textContent = 'Changed'; },
    state => { state.iframe.remove(); state.dialog.append(new Element('iframe', { src: state.iframe.src })); },
    state => {
      const replacement = new Element('div', { role: 'dialog', 'aria-label': 'Insert file' });
      state.iframe.remove(); state.dialog.remove(); replacement.append(state.iframe); state.document.append(replacement);
    }
  ]) {
    const p = page('success', { twoFiles: true, onOpen: state => { state.inner.URL = 'about:blank'; },
      onTick: state => { if (state.clock === 1200) change(state); }
    });
    const rows = await p.run();
    assert.equal(rows[0].code, 'stale'); assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
    assert.equal(p.elapsed, 1200); assert.deepEqual(p.assignmentStates, []); assert.deepEqual(p.input.events, []);
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file discovery budget: the whole-run deadline caps both discovery and settling of later files', async () => {
  for (const phase of ['discovery', 'settling']) {
    let openedAt;
    const p = page('success', { fileCount: 4, initialReadyState: 'loading',
      onOpen: state => { openedAt = p.elapsed; if (phase === 'settling' && p.openStates.length === 4) state.browse.disabled = true; },
      onTick: state => {
        const delay = p.openStates.length < 4 ? 57000 : phase === 'discovery' ? 12000 : 0;
        if (state.clock - openedAt >= delay) state.inner.readyState = 'complete';
      }
    });
    const rows = await p.run();
    assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled', 'filled', 'timeout'], phase);
    assert.equal(rows[3].diagnostic, 'overall-timeout', phase);
    assert.ok(p.elapsed >= 180000 && p.elapsed < 180200, `${phase}: ${p.elapsed}`);
    assert.equal(p.assignmentStates.length, 3);
    assert.deepEqual(p.inputs.map(input => input.events), [[], ['input', 'change'], [], ['input', 'change'], [], ['input', 'change'], [], ...(phase === 'settling' ? [[]] : [])]);
    assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf', 'TEST-ONLY.pdf', undefined]);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file readiness: reload before input or change aborts dispatch without a second assignment', async () => {
  for (const mode of ['reload-before-input', 'reload-before-change']) {
    const p = page(mode);
    assert.equal((await p.run())[0].code, 'pending');
    assert.deepEqual(p.input.events, mode === 'reload-before-input' ? [] : ['input']);
    assert.deepEqual(p.assignmentStates, ['complete']); assert.equal(p.add.clicks, 1);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file readiness: changed heading while waiting remains stale with no file assignment', async () => {
  const p = page('success', { initialReadyState: 'interactive', completeAfterTicks: 4, changeHeadingAtTick: 2 });
  assert.equal((await p.run())[0].code, 'stale');
  assert.deepEqual(p.assignmentStates, []); assert.deepEqual(p.input.events, []);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file settling: complete picker drops an early handoff; both first handoffs wait for initialization', async () => {
  const p = page('success', { mask: 'ancestor', twoFiles: true, hiddenInput: true, handlersAfterMs: 1000 });
  const rows = await p.run();
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled']);
  assert.deepEqual(p.inputs.map(input => input.events), [[], ['input', 'change'], [], ['input', 'change']]);
  assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.equal(p.assignmentStates.length, 2);
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
});

test('file settling: Browse with omitted type and native submit default permits one handoff without a click', async () => {
  let browse;
  const p = page('success', { onOpen: state => {
    browse = state.browse; delete browse.attrs.type; browse.type = 'submit';
  } });
  assert.equal((await p.run())[0].code, 'filled');
  assert.equal(p.assignmentStates.length, 1); assert.deepEqual(p.input.events, ['input', 'change']);
  assert.equal(p.selected.querySelector('span').textContent, 'TEST-ONLY.pdf');
  assert.equal(browse.clicks + p.submit.clicks, 0);
});

test('file settling: owned UI mutation restarts the idle period before the one handoff', async () => {
  let handedAt;
  const p = page('success', { handlersAfterMs: 1800,
    onTick: p => { if (p.clock === 750) p.inner.querySelector('button').textContent = 'Browse'; },
    onInput: () => { handedAt = p.elapsed; }
  });
  assert.equal((await p.run())[0].code, 'filled');
  assert.ok(handedAt >= 1750, `handoff at ${handedAt}`);
  assert.equal(p.assignmentStates.length, 1); assert.deepEqual(p.input.events, ['input', 'change']);
});

test('file settling: busy or unavailable Browse exhausts the file budget without events', async () => {
  for (const onOpen of [
    p => p.inner.append(new Element('div', { role: 'progressbar' })),
    p => p.inner.querySelector('[role="dialog"]').setAttribute('aria-busy', 'true'),
    p => { p.browse.disabled = true; }, p => { p.browse.hidden = true; }, p => p.browse.remove()
  ]) {
    const p = page('success', { twoFiles: true, onOpen });
    const rows = await p.run();
    assert.equal(rows[0].code, 'timeout');
    assert.deepEqual(Array.from(rows, row => row.diagnostic), ['picker-settling-timeout', 'previous-unconfirmed']);
    assert.ok(p.elapsed >= 60000 && p.elapsed < 60200, `elapsed=${p.elapsed}`);
    assert.deepEqual(p.assignmentStates, []); assert.deepEqual(p.input.events, []);
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file settling: perpetual UI churn or readiness near file expiry cannot extend the file budget', async () => {
  for (const options of [
    { onTick: p => { if (p.inner) p.inner.querySelector('button').textContent = 'Browse'; } },
    { initialReadyState: 'interactive', completeAfterTicks: 394 }
  ]) {
    const p = page('success', { twoFiles: true, ...options });
    const rows = await p.run();
    assert.equal(rows[0].code, 'timeout');
    assert.deepEqual(Array.from(rows, row => row.diagnostic), ['picker-settling-timeout', 'previous-unconfirmed']);
    assert.ok(p.elapsed >= 60000 && p.elapsed < 60200, `elapsed=${p.elapsed}`);
    assert.deepEqual(p.assignmentStates, []); assert.deepEqual(p.input.events, []);
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
});

test('file settling: transient busy UI requires a fresh idle period', async () => {
  let handedAt;
  const p = page('success', {
    onTick: p => {
      const dialog = p.inner.querySelector('[role="dialog"]');
      if (p.clock === 750) dialog.setAttribute('aria-busy', 'true');
      if (p.clock === 1050) dialog.setAttribute('aria-busy', 'false');
    }, onInput: () => { handedAt = p.elapsed; }
  });
  assert.equal((await p.run())[0].code, 'filled');
  assert.ok(handedAt >= 2050, `handoff at ${handedAt}`);
  assert.equal(p.assignmentStates.length, 1);
});

test('file settling: replaced input in the same owned picker settles before each single fresh handoff', async () => {
  let openedAt;
  const stale = [], fresh = [], replacedAt = [], handedAt = [];
  const p = page('success', { mask: 'ancestor', twoFiles: true, hiddenInput: true, initializeAfterMs: false,
    onOpen: ({ input }) => { stale.push(input); openedAt = p.elapsed; },
    onTick: state => { if (state.clock === openedAt + 600) { fresh.push(state.replaceInput()); replacedAt.push(state.clock); } },
    onInput: () => { handedAt.push(p.elapsed); }
  });
  assert.deepEqual(Array.from(await p.run(), row => row.code), ['filled', 'filled']);
  assert.equal(p.assignmentStates.length, 2);
  assert.deepEqual(stale.map(input => [input.files.length, input.events]), [[0, []], [0, []]]);
  assert.deepEqual(fresh.map(input => input.events), [['input', 'change'], ['input', 'change']]);
  assert.deepEqual(fresh.map(input => input.files[0].name), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.ok(handedAt.every((time, i) => time - replacedAt[i] >= 1000));
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
});

for (const delay of [600, 1800]) test(`file initialization: observed replacement after ${delay}ms gates both single handoffs`, async () => {
  let openedAt;
  const initial = [], fresh = [], handedAt = [];
  const p = page('success', { mask: 'ancestor', twoFiles: true, initializeAfterMs: false,
    onOpen: ({ input }) => { initial.push(input); openedAt = p.elapsed; },
    onTick: state => { if (state.clock === openedAt + delay) fresh.push(state.replaceInput()); },
    onAssign: () => handedAt.push(p.elapsed - openedAt)
  });
  const rows = await p.run();
  assert.ok(handedAt.every(time => time >= delay + 1000), `premature assignment: ${handedAt}`);
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled']);
  assert.deepEqual(initial.map(input => [input.files.length, input.events]), [[0, []], [0, []]]);
  assert.deepEqual(fresh.map(input => input.events), [['input', 'change'], ['input', 'change']]);
  assert.deepEqual(fresh.map(input => input.files[0].name), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.equal(p.assignmentStates.length, 2);
  assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.deepEqual(p.openStates, [
    { mask: null, attachments: [0, 0], next: 0 }, { mask: null, attachments: [1, 0], next: 0 }
  ]);
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
});

for (const replacementAt of [450, 750]) test(`file loading observation: replacement at ${replacementAt}ms survives discovery until complete`, async () => {
  let openedAt;
  const initial = [], fresh = [], handedAt = [];
  const p = page('success', { mask: 'ancestor', twoFiles: true, initialReadyState: 'loading', initializeAfterMs: false,
    onOpen: ({ input }) => { initial.push(input); openedAt = p.elapsed; },
    onTick: state => {
      const elapsed = state.clock - openedAt;
      if (elapsed === 300) state.inner.readyState = 'interactive';
      if (elapsed === replacementAt) fresh.push(state.replaceInput());
      if (elapsed === 750) state.inner.readyState = 'complete';
    },
    onAssign: () => handedAt.push(p.elapsed - openedAt)
  });
  const rows = await p.run();
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled']);
  assert.deepEqual(p.assignmentStates, ['complete', 'complete']);
  assert.deepEqual(p.eventStates, [['input', 'complete'], ['change', 'complete'], ['input', 'complete'], ['change', 'complete']]);
  assert.ok(handedAt.every(time => time >= 1750), `handoff before complete + idle: ${handedAt}`);
  assert.deepEqual(initial.map(input => [input.files.length, input.events]), [[0, []], [0, []]]);
  assert.deepEqual(fresh.map(input => input.events), [['input', 'change'], ['input', 'change']]);
  assert.deepEqual(fresh.map(input => input.files[0].name), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.deepEqual(p.openStates, [
    { mask: null, attachments: [0, 0], next: 0 }, { mask: null, attachments: [1, 0], next: 0 }
  ]);
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
});

for (const drift of ['document', 'dialog', 'actual-url', 'cancel', 'missing-input']) test(`file loading observation: ${drift} cannot transfer generation ownership`, async () => {
  const p = page('success', { twoFiles: true, initialReadyState: 'loading', initializeAfterMs: false,
    onTick: state => {
      if (state.clock !== 450) return;
      if (drift === 'document') {
        const replacement = new Element(); replacement.root = true; replacement.doc = replacement;
        replacement.URL = state.inner.URL; replacement.readyState = 'loading'; replacement.defaultView = state.inner.defaultView;
        const dialog = state.input.parentElement; dialog.remove(); replacement.append(dialog);
        state.iframe.contentDocument = replacement;
      } else if (drift === 'dialog') {
        const old = state.input.parentElement, replacement = new Element('div', { ...old.attrs });
        state.input.remove(); replacement.append(state.input); old.remove(); state.inner.append(replacement);
      } else if (drift === 'actual-url') state.inner.URL = 'about:blank';
      else if (drift === 'cancel') state.dialog.remove();
      else state.input.remove();
    }
  });
  const rows = await p.run();
  assert.equal(p.elapsed, 450, 'observed picker drift must stop promptly, even while loading');
  assert.equal(rows[0].code, drift === 'missing-input' ? 'file-manual' : 'stale');
  assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
  assert.deepEqual(p.assignmentStates, []); assert.ok(p.inputs.every(input => !input.files.length && !input.events.length));
  assert.deepEqual(p.questions.map(q => q.add.clicks), [1, 0]);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

for (const initializeAfterMs of [false, 0]) test(`file initialization: ${initializeAfterMs === false ? 'absent' : 'missed'} replacement never assigns and reports the missing transition`, async () => {
  const p = page('success', { twoFiles: true, initializeAfterMs });
  const rows = await p.run();
  assert.deepEqual(p.assignmentStates, []);
  assert.equal(rows[0].code, 'timeout');
  assert.deepEqual(Array.from(rows, row => row.diagnostic), ['picker-initialization-not-observed', 'previous-unconfirmed']);
  assert.ok(p.elapsed >= 60000 && p.elapsed < 60200);
  assert.deepEqual(p.input.events, []); assert.equal(p.input.files.length, 0);
  assert.deepEqual(p.questions.map(q => q.add.clicks), [1, 0]);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file initialization: selected or ineligible replacements and an original input moved elsewhere cannot authorize handoff', async () => {
  for (const change of [
    state => { const old = state.input; state.replaceInput(); state.document.append(old); },
    state => { state.replaceInput().files = [{}]; },
    state => { state.input.files = [{}]; state.replaceInput(); },
    state => { state.replaceInput().multiple = true; },
    state => { state.replaceInput().disabled = true; },
    state => { state.replaceInput().attrs.accept = 'image/png'; }
  ]) {
    const p = page('success', { twoFiles: true, initializeAfterMs: false,
      onTick: state => { if (state.clock === 600) change(state); }
    });
    const rows = await p.run();
    assert.deepEqual(p.assignmentStates, []); assert.ok(p.inputs.every(input => input.events.length === 0));
    assert.notEqual(rows[0].code, 'filled'); assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file initialization: a confirmed first file cannot authorize an unobserved second generation', async () => {
  let openedAt;
  const p = page('success', { twoFiles: true, initializeAfterMs: false,
    onOpen: () => { openedAt = p.elapsed; },
    onTick: state => { if (p.openStates.length === 1 && state.clock === openedAt + 600) state.replaceInput(); }
  });
  const rows = await p.run();
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'timeout']);
  assert.equal(rows[1].diagnostic, 'picker-initialization-not-observed');
  assert.equal(p.assignmentStates.length, 1); assert.deepEqual(p.input.events, []);
  assert.deepEqual(p.questions.map(q => q.selected.querySelector('span')?.textContent), ['TEST-ONLY.pdf', undefined]);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file settling: repeated input replacement cannot extend the file deadline', async () => {
  const p = page('success', { twoFiles: true, initializeAfterMs: false, onTick: state => { if (state.clock % 450 === 0) state.replaceInput(); } });
  const [row] = await p.run();
  assert.equal(row.code, 'timeout'); assert.equal(row.diagnostic, 'picker-settling-timeout');
  assert.ok(p.elapsed >= 60000 && p.elapsed < 60200);
  assert.deepEqual(p.assignmentStates, []); assert.ok(p.inputs.every(input => !input.events.length && !input.files.length));
  assert.equal(p.questions[1].add.clicks, 0);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
});

test('file settling: missing, multiple or outside-dialog replacement inputs remain unassigned', async () => {
  for (const change of [
    state => state.input.remove(),
    state => state.input.parentElement.append(new Element('input', { type: 'file' })),
    state => { const replacement = state.replaceInput(); replacement.remove(); state.inner.append(replacement); }
  ]) {
    const p = page('success', { twoFiles: true, onTick: state => { if (state.clock === 600) change(state); } });
    assert.notEqual((await p.run())[0].code, 'filled');
    assert.deepEqual(p.assignmentStates, []); assert.ok(p.inputs.every(input => !input.events.length));
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
});

test('file handoff: input replacement after assignment never reacquires or retries', async () => {
  for (const phase of ['onAssign', 'onInput']) {
    const p = page('success', { twoFiles: true, [phase]: state => state.replaceInput() });
    assert.equal((await p.run())[0].code, 'pending', phase);
    assert.equal(p.assignmentStates.length, 1, phase);
    assert.deepEqual(p.inputs[0].events, [], phase); assert.equal(p.inputs[0].files.length, 0, phase);
    assert.deepEqual(p.inputs[1].events, phase === 'onAssign' ? [] : ['input'], phase);
    assert.equal(p.inputs[1].files.length, 1, phase);
    assert.deepEqual(p.inputs[2].events, [], phase); assert.equal(p.inputs[2].files.length, 0, phase);
    assert.equal(p.questions[1].add.clicks, 0, phase);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', phase);
    assert.equal(p.next.clicks + p.submit.clicks, 0, phase);
  }
});

test('file settling: cancellation and replaced owners or dialogs abort before assignment', async () => {
  const changes = {
    cancel: p => p.dialog.remove(), hidden: p => { p.dialog.hidden = true; },
    heading: p => { p.heading.textContent = 'Changed'; },
    form: p => { p.form.remove(); p.document.append(p.form); },
    frame: p => { p.iframe.remove(); p.dialog.append(new Element('iframe', { src: p.iframe.src })); },
    document: p => { p.iframe.contentDocument = new Element(); },
    dialog: p => { p.inner.querySelector('[role="dialog"]').remove(); p.inner.append(new Element('div', { role: 'dialog', 'aria-label': 'Insert file' })); }
  };
  for (const [name, change] of Object.entries(changes)) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, onTick: p => { if (p.clock === 600) change(p); } });
    assert.equal((await p.run())[0].code, 'stale', name);
    assert.deepEqual(p.assignmentStates, [], name); assert.deepEqual(p.input.events, [], name);
    assert.equal(p.questions[1].add.clicks, 0, name);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', name);
    assert.equal(p.next.clicks + p.submit.clicks, 0, name);
  }
});

const tombstone = () => new Element('div', { jscontroller: 'By0w6', jsaction: 'mouseover:eGiyHb; click:eGiyHb; focus:eGiyHb; touchstart:eGiyHb;',
  'data-tooltip': 'TEST-ONLY.pdf', role: 'listitem', 'data-vertical-offset': '-22', class: 'yP1fJf' });

test('file tombstone: removed empty item permits a new upload without altering the leaf or earlier attachment', async () => {
  const p = page('success', { twoFiles: true, preexisting: true });
  const removed = tombstone(), existing = p.selected.children[0];
  p.questions[1].selected.append(removed);
  assert.deepEqual(Array.from(await p.run(), row => row.code), ['preserved', 'filled']);
  assert.equal(p.selected.children[0], existing); assert.equal(p.add.clicks, 0);
  assert.equal(p.questions[1].selected.children[0], removed); assert.equal(removed.childNodes.length, 0);
  assert.equal(p.questions[1].selected.querySelector('span').textContent, 'SECOND-ONLY.pdf');
  assert.equal(p.assignmentStates.length, 1); assert.deepEqual(p.input.events, ['input', 'change']);
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
});

test('file tombstone: dry run is ready, while the empty question cannot advance normally', async () => {
  const p = page(); p.selected.append(tombstone());
  assert.equal((await p.run(true))[0].code, 'ready'); assert.equal(p.add.clicks, 0);
  await p.call('collect', { allowAdvance: true });
  await p.call('apply', { jobs: [{ rules: [] }] });
  assert.equal((await p.call('advance')).code, 'incomplete'); assert.equal(p.next.clicks, 0);
});

test('file tombstone: nonempty, interactive, busy and unknown items remain preserved', async () => {
  for (const change of [
    item => { item.textContent = ' '; }, item => item.append(new Element('span')),
    item => Object.defineProperty(item, 'childNodes', { value: [{ textContent: '' }] }),
    item => item.append(new Element('button', { type: 'button' }, 'Remove file')),
    item => item.setAttribute('tabindex', '0'), item => item.setAttribute('contenteditable', 'true'),
    item => item.setAttribute('aria-label', 'TEST-ONLY.pdf'), item => item.setAttribute('aria-busy', 'true'),
    item => item.setAttribute('jscontroller', 'Unknown'), item => item.setAttribute('jsaction', 'click:unknown'),
    item => { delete item.attrs['data-tooltip']; },
    item => item.append(new Element('div', { role: 'progressbar' }))
  ]) {
    const p = page(), item = tombstone(); change(item); p.selected.append(item);
    assert.equal((await p.run())[0].code, 'preserved'); assert.equal(p.add.clicks, 0);
    assert.equal(p.selected.children[0], item);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
  const p = page(); p.selected.append(tombstone()); p.selected.setAttribute('aria-busy', 'true');
  assert.equal((await p.run())[0].code, 'preserved'); assert.equal(p.add.clicks, 0);
});

test('file mask: unchanged whole form survives its own picker mask, including two consecutive uploads', async () => {
  for (const mask of ['ancestor', 'form']) {
    const p = page('success', { mask, twoFiles: true, hiddenInput: true, retainedPicker: true,
      initialReadyState: 'interactive', completeAfterTicks: 4 });
    const rows = await p.run();
    assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled'], mask);
    assert.deepEqual(p.assignmentMasks, ['true', 'true'], mask);
    assert.deepEqual(p.assignmentStates, ['complete', 'complete']);
    assert.deepEqual(p.inputs.map(input => input.events), [[], ['input', 'change'], [], ['input', 'change']]);
    assert.deepEqual(p.questions.map(question => question.add.clicks), [1, 1]);
    assert.deepEqual(p.questions.map(question => question.selected.children.length), [1, 1]);
    assert.equal(p.background.getAttribute('aria-hidden'), null); assert.equal(p.form.getAttribute('aria-hidden'), null);
    assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
  }
});

test('file mask: filename before picker hides, close before filename and confirmation all settle safely', async () => {
  for (const mode of ['name-first', 'hide-first', 'removed-first', 'confirm']) {
    const p = page(mode, { mask: 'ancestor', hiddenInput: true, retainedPicker: true });
    assert.equal((await p.run())[0].code, 'filled', mode);
    assert.deepEqual(p.assignmentMasks, ['true']);
    assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.submit.clicks, 0);
  }
});

test('file mask: native/CSS hiding and nested aria-hidden never become upload permission', async () => {
  const mutations = {
    hidden: p => { p.background.hidden = true; },
    inert: p => { p.background.attrs.inert = ''; },
    display: p => { p.background.css = { display: 'none' }; },
    visibility: p => { p.form.css = { visibility: 'hidden' }; },
    opacity: p => { p.background.css = { opacity: '0' }; },
    card: p => { p.card.attrs['aria-hidden'] = 'true'; },
    control: p => { p.selected.attrs['aria-hidden'] = 'true'; },
    heading: p => { p.heading.textContent = 'Changed'; },
    removed: p => p.card.remove(),
    replaced: p => { p.selected.remove(); p.card.append(new Element('div', { role: 'list', 'aria-label': 'Selected files' })); },
    reparented: p => { p.form.remove(); p.document.append(p.form); }
  };
  for (const [name, onOpen] of Object.entries(mutations)) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, onOpen });
    assert.notEqual((await p.run())[0].code, 'filled', name);
    assert.deepEqual(p.assignmentStates, [], name);
    assert.equal(p.questions[1].add.clicks, 0, name);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', name);
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
});

test('file mask: foreign, ambiguous or renamed picker never receives a file', async () => {
  const mutations = {
    renamed: p => { p.dialog.children[0].textContent = 'User modal'; },
    innerRenamed: p => { p.inner.children[0].attrs['aria-label'] = 'User modal'; },
    unrelated: p => p.document.append(new Element('div', { role: 'dialog', 'aria-label': 'User modal' })),
    extraFrame: p => p.dialog.append(new Element('iframe', { src: 'https://docs.google.com/picker' })),
    foreign: p => { p.iframe.attrs.src = 'https://other.example/picker'; },
    sandbox: p => { p.iframe.attrs.sandbox = ''; },
    actualForeign: p => { p.inner.URL = 'https://other.example/picker'; },
    navigating: p => { p.inner.readyState = 'loading'; }
  };
  for (const [name, onOpen] of Object.entries(mutations)) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, onOpen });
    assert.notEqual((await p.run())[0].code, 'filled', name);
    assert.deepEqual(p.assignmentStates, [], name);
    assert.equal(p.questions[1].add.clicks, 0, name);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', name);
  }
});

test('file mask: late replacement or unrelated modal blocks remaining uploads and Next', async () => {
  for (const afterChange of [p => { p.heading.textContent = 'Changed'; },
    p => { p.selected.remove(); p.card.append(new Element('div', { role: 'list', 'aria-label': 'Selected files' })); },
    p => p.document.append(new Element('div', { role: 'dialog', 'aria-label': 'User modal' }))]) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, afterChange });
    assert.notEqual((await p.run())[0].code, 'filled');
    assert.deepEqual(p.assignmentStates, ['complete']); assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
});

test('file mask: open picker or unrestored background never authorizes later upload or Next', async () => {
  for (const options of [{ mode: 'name-open', fastClock: true }, { mode: 'success', keepMask: true }]) {
    const p = page(options.mode, { mask: 'ancestor', twoFiles: true, ...options });
    assert.notEqual((await p.run())[0].code, 'filled');
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
  const p = page('success', { mask: 'ancestor' });
  assert.equal((await p.run())[0].code, 'filled');
  p.background.attrs['aria-hidden'] = 'true';
  assert.equal((await p.call('advance', { allowIncomplete: true })).code, 'stale');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

for (const [name, mode, options] of [
  ['removed upload input', 'success', { removeInput: true }],
  ['reset upload input', 'success', { resetInput: true }],
  ['filename then close then ARIA restoration', 'name-first', { restoreAfterTicks: 3 }],
  ['close then filename then ARIA restoration', 'hide-first', { restoreAfterTicks: 5 }],
  ['close then ARIA restoration then filename', 'hide-first', { restoreAfterTicks: 1 }],
  ['removed input and close before filename', 'hide-first', { removeInput: true, restoreAfterTicks: 5 }],
  ['removed input and filename before close', 'name-first', { removeInput: true, restoreAfterTicks: 3 }],
  ['removed input before explicit confirmation', 'confirm', { removeInput: true, restoreAfterTicks: 3 }]
]) test(`file sequence: ${name} completes two distinct uploads in one run`, async () => {
  const p = page(mode, { mask: 'ancestor', twoFiles: true, retainedPicker: true, ...options });
  const rows = await p.run();
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled']);
  assert.deepEqual(p.openStates, [
    { mask: null, attachments: [0, 0], next: 0 },
    { mask: null, attachments: [1, 0], next: 0 }
  ]);
  assert.deepEqual(p.questions.map(q => q.selected.children[0]?.children[0].textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  if (!options.resetInput) {
    assert.deepEqual(p.inputs.map(i => i.files[0]?.name), [undefined, 'TEST-ONLY.pdf', undefined, 'SECOND-ONLY.pdf']);
    assert.deepEqual(await Promise.all(p.inputs.map(i => i.files[0]?.text())), [undefined, 'test', undefined, 'second']);
  }
  assert.deepEqual(p.assignmentStates, ['complete', 'complete']);
  assert.deepEqual(p.inputs.map(i => i.events), [[], ['input', 'change'], [], ['input', 'change']]);
  assert.deepEqual(p.questions.map(q => q.add.clicks), [1, 1]);
  assert.equal(p.background.getAttribute('aria-hidden'), null);
  assert.equal((await p.call('advance')).code, 'attempted');
  assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
});

test('file progress: observed sibling dialog and inner mask complete two distinct uploads in one invocation', async t => {
  const p = page('inner-progress', { mask: 'ancestor', twoFiles: true, innerProgress: true, retainedPicker: true });
  const rows = await p.run();
  t.diagnostic(JSON.stringify({ rows, add: p.questions.map(q => q.add.clicks), assignments: p.assignmentStates.length }));
  assert.deepEqual(Array.from(rows, row => row.code), ['filled', 'filled']);
  assert.deepEqual(p.openStates, [
    { mask: null, attachments: [0, 0], next: 0 },
    { mask: null, attachments: [1, 0], next: 0 }
  ]);
  assert.deepEqual(p.inputs.map(input => input.files[0]?.name), [undefined, 'TEST-ONLY.pdf', undefined, 'SECOND-ONLY.pdf']);
  assert.deepEqual(await Promise.all(p.inputs.map(input => input.files[0]?.text())), [undefined, 'test', undefined, 'second']);
  assert.deepEqual(p.inputs.map(input => input.events), [[], ['input', 'change'], [], ['input', 'change']]);
  assert.deepEqual(p.questions.map(q => q.selected.children[0]?.children[0].textContent), ['TEST-ONLY.pdf', 'SECOND-ONLY.pdf']);
  assert.deepEqual(p.assignmentStates, ['complete', 'complete']);
  for (const progress of p.progresses) {
    assert.equal(progress.polls, 4); // 800ms spans multiple completion polls.
    assert.equal(progress.iframe.contentDocument, progress.inner);
    assert.equal(progress.iframe.isConnected && progress.innerDialog.isConnected, true);
    assert.equal(progress.wrapper.getAttribute('aria-hidden'), null);
    assert.equal(progress.progress.isConnected, false); assert.equal(progress.insert.clicks, 0);
  }
  assert.equal((await p.call('advance')).code, 'attempted');
  assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
});

test('file progress: original Insert waits for strict inner UI restoration', async () => {
  const p = page('confirm', { mask: 'ancestor', innerProgress: true });
  assert.equal((await p.run())[0].code, 'filled');
  assert.equal(p.progresses[0].polls, 4);
  assert.equal(p.progresses[0].insert.clicks, 0); assert.equal(p.confirm.clicks, 1);
  assert.deepEqual(p.input.events, ['input', 'change']); assert.equal(p.assignmentStates.length, 1);
});

for (const ui of ['masked', 'unmasked', 'replaced']) test(`file progress: persistent ${ui} inner dialog times out without Insert, next upload or navigation`, async () => {
  const p = page('confirm', { mask: 'ancestor', twoFiles: true, innerProgress: true, persistProgress: true,
    afterChange: ({ input }) => {
      if (ui === 'unmasked') delete input.parentElement.parentElement.attrs['aria-hidden'];
      if (ui === 'replaced') input.parentElement.parentElement.remove();
    } });
  const rows = await p.run();
  assert.equal(rows[0].code, 'timeout');
  assert.deepEqual(Array.from(rows, row => row.diagnostic), ['overall-timeout', 'previous-unconfirmed']);
  assert.ok(p.elapsed >= 60000 && p.elapsed < 60200);
  assert.deepEqual(p.questions.map(q => q.add.clicks), [1, 0]);
  assert.equal(p.confirm.clicks, 0); assert.equal(p.progresses[0].insert.clicks, 0);
  assert.equal(p.assignmentStates.length, 1); assert.deepEqual(p.input.events, ['input', 'change']);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file sequence: preserve the first existing attachment and upload only the distinct second file', async () => {
  const p = page('hide-first', { mask: 'ancestor', twoFiles: true, preexisting: true, removeInput: true, restoreAfterTicks: 5 });
  const original = p.selected.children[0];
  assert.deepEqual(Array.from(await p.run(), row => row.code), ['preserved', 'filled']);
  assert.equal(p.selected.children[0], original); assert.equal(p.selected.textContent, 'existing.pdfRemove file');
  assert.deepEqual(p.questions.map(q => q.add.clicks), [0, 1]);
  assert.equal(p.inputs.length, 2); assert.deepEqual(p.inputs[0].events, []); assert.equal(p.inputs[0].files.length, 0);
  assert.equal(p.input.files[0].name, 'SECOND-ONLY.pdf');
  assert.equal(await p.input.files[0].text(), 'second'); assert.deepEqual(p.input.events, ['input', 'change']);
  assert.equal((await p.call('advance')).code, 'attempted'); assert.equal(p.next.clicks, 1); assert.equal(p.submit.clicks, 0);
});

test('file sequence: changed input identity before change still blocks handoff', async () => {
  for (const onInput of [p => p.input.remove(), p => p.input.parentElement.append(new Element('input', { type: 'file' }))]) {
    const p = page('success', { twoFiles: true, mask: 'ancestor', onInput });
    assert.notEqual((await p.run())[0].code, 'filled');
    assert.deepEqual(p.input.events, ['input']); assert.equal(p.assignmentStates.length, 1);
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  }
});

test('file sequence: removed input never relaxes picker document, frame or outer dialog identity', async () => {
  const mutations = {
    reload: p => { p.inner.readyState = 'loading'; },
    document: p => { p.iframe.contentDocument = new Element(); },
    source: p => { p.iframe.attrs.src = 'https://other.example/picker'; },
    url: p => { p.inner.URL = 'https://other.example/picker'; },
    sandbox: p => { p.iframe.attrs.sandbox = ''; },
    outerDialog: p => { p.dialog.children[0].textContent = 'Other dialog'; },
    partialClose: p => { p.iframe.hidden = true; },
    extraFrame: p => p.dialog.append(new Element('iframe', { src: 'https://docs.google.com/picker' })),
    extraModal: p => p.document.append(new Element('div', { role: 'dialog', 'aria-label': 'Insert file' }))
  };
  for (const [name, afterChange] of Object.entries(mutations)) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, removeInput: true, afterChange });
    const rows = await p.run();
    assert.notEqual(rows[0].code, 'filled', name);
    assert.equal(rows[0].diagnostic, ['extraFrame', 'extraModal'].includes(name) ? 'unexpected-ui' : ['outerDialog', 'partialClose'].includes(name) ? 'picker-ui-changed' : 'picker-document-changed', name);
    assert.equal(rows[1].diagnostic, 'previous-unconfirmed', name);
    assert.equal(p.questions[1].add.clicks, 0, name);
    assert.deepEqual(p.input.events, ['input', 'change'], name);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', name);
    assert.equal(p.next.clicks + p.submit.clicks, 0, name);
  }
});

test('file sequence: closure settling rejects hidden, changed or replaced original owners and foreign UI', async () => {
  const mutations = {
    hidden: p => { p.background.hidden = true; },
    inert: p => { p.background.attrs.inert = ''; },
    css: p => { p.background.css = { display: 'none' }; },
    nestedAria: p => { p.card.attrs['aria-hidden'] = 'true'; },
    heading: p => { p.heading.textContent = 'Changed'; },
    control: p => { p.selected.remove(); p.card.append(new Element('div', { role: 'list', 'aria-label': 'Selected files' })); },
    form: p => { p.form.remove(); p.document.append(p.form); },
    document: p => { p.iframe.contentDocument = new Element(); },
    foreign: p => p.document.append(new Element('div', { role: 'dialog', 'aria-label': 'Other modal' })),
    frame: p => p.document.append(new Element('iframe', { src: 'https://docs.google.com/picker' }))
  };
  for (const [name, onClose] of Object.entries(mutations)) {
    const p = page('success', { mask: 'ancestor', twoFiles: true, restoreAfterTicks: 3, onClose });
    assert.notEqual((await p.run())[0].code, 'filled', name);
    assert.equal(p.questions[1].add.clicks, 0, name);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', name);
    assert.equal(p.next.clicks + p.submit.clicks, 0, name);
  }
});

test('file sequence: permanent ARIA mask has a bounded five-second closure wait', async () => {
  let closedAt;
  const p = page('success', { mask: 'ancestor', twoFiles: true, keepMask: true, onClose: () => { closedAt = p.elapsed; } });
  const rows = await p.run();
  assert.equal(rows[0].code, 'pending'); assert.equal(rows[0].diagnostic, 'close-grace-expired');
  assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
  assert.ok(p.elapsed - closedAt >= 5000 && p.elapsed - closedAt < 5200, `closure wait=${p.elapsed - closedAt}`);
  assert.equal(p.questions[1].add.clicks, 0);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
});

test('file sequence: late ARIA restoration after a delayed poll cannot overrun the closure window', async () => {
  const p = page('success', { mask: 'ancestor', twoFiles: true, restoreAfterTicks: 1, closurePollGap: 6000 });
  assert.equal((await p.run())[0].code, 'pending');
  assert.equal(p.background.getAttribute('aria-hidden'), null);
  assert.equal(p.questions[1].add.clicks, 0);
  assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
  assert.equal(p.next.clicks + p.submit.clicks, 0);
});

test('file sequence: removed input with cancellation, wrong name, progress or timeout stops remaining work', async () => {
  for (const mode of ['cancel', 'wrong', 'progress', 'timeout', 'name-open']) {
    const p = page(mode, { mask: 'ancestor', twoFiles: true, removeInput: true, restoreAfterTicks: 2 });
    const rows = await p.run();
    assert.notEqual(rows[0].code, 'filled', mode);
    assert.equal(rows[0].diagnostic, { cancel: 'close-grace-expired', wrong: 'selection-not-exact', progress: 'close-grace-expired', timeout: 'overall-timeout', 'name-open': 'overall-timeout' }[mode]);
    assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
    assert.equal(p.questions[1].add.clicks, 0, mode); assert.equal(p.assignmentStates.length, 1, mode);
    assert.deepEqual(p.input.events, ['input', 'change']);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted', mode);
    assert.equal(p.next.clicks + p.submit.clicks, 0, mode);
  }
});

test('file diagnostics: exceptions retain only the current phase and never permit a second upload or Next', async () => {
  const fail = () => { throw new Error('PRIVATE filename.pdf https://example.test/?auth=secret'); };
  for (const [phase, options] of [
    ['file-preflight', { setup: p => { p.selected.getClientRects = fail; } }],
    ['file-data', { setup: p => { p.context.Uint8Array = fail; } }],
    ['picker-discovery', { onOpen: fail }],
    ['file-handoff', { onInput: fail }],
    ['upload-completion', { onTick: p => { if (p.input?.events.includes('change')) fail(); } }]
  ]) {
    const p = page('success', { twoFiles: true, ...options });
    await p.call('collect', { allowAdvance: true }); options.setup?.(p);
    const rows = await p.call('apply', { jobs: [0, 1].map(i => ({ rules: [i], value: fileRef() })), files: { [fileRef().fileId]: 'dGVzdA==' } });
    assert.equal(rows[0].code, 'error', phase); assert.equal(rows[0].diagnostic, phase);
    assert.equal(rows[1].diagnostic, 'previous-unconfirmed');
    assert.equal(JSON.stringify(rows).includes('PRIVATE'), false);
    assert.equal(p.questions[1].add.clicks, 0);
    assert.notEqual((await p.call('advance', { allowIncomplete: true })).code, 'attempted');
    assert.equal(p.next.clicks + p.submit.clicks, 0);
  }
  for (const mode of ['success', 'prefilled']) assert.equal(Object.hasOwn((await page(mode).run())[0], 'diagnostic'), false);
  assert.equal(Object.hasOwn((await page().run(true))[0], 'diagnostic'), false);
});
