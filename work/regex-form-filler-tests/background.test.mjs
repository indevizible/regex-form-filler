import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLabels } from '../../outputs/regex-form-filler/core.js';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { fakeIDB, fileRef, testFile } from './file-test-helpers.mjs';

const extension = 'chrome-extension://synthetic/';
const currentTab = { id: 7, url: 'https://docs.google.com/forms/d/e/synthetic/viewform' };
const rules = [{ pattern: '^ชื่อจริง$', flags: 'iu', value: 'ทดสอบ' }];
let onMessage, onCommand, onRemoved, reportArrived;
let session = {};
const injections = [], removed = [], created = [], badges = [];
let matcherFailure, shortcutOptions, applyCode, applyDiagnostic, failOperation;
globalThis.chrome = {
  runtime: { id: 'synthetic', getManifest: () => ({ version: '9.8.7' }), getURL: path => extension + path, onMessage: { addListener: fn => { onMessage = fn; } } },
  commands: { onCommand: { addListener: fn => { onCommand = fn; } } },
  tabs: {
    query: async () => [currentTab], get: async () => currentTab,
    create: async properties => {
      created.push(properties);
      const tab = { id: 100 + created.length };
      setTimeout(async () => {
        const sender = { id: 'synthetic', url: properties.url, tab };
        const token = new URL(properties.url).hash.slice(1);
        const job = await send({ type: 'matcher-ready', token }, sender);
        if (job?.ok) await send(matcherFailure ? { type: 'matcher-result', token, error: matcherFailure } :
          { type: 'matcher-result', token, matches: matchLabels(job.rules, job.labels) }, sender);
      }, 0);
      return tab;
    },
    remove: async id => { removed.push(id); }, onRemoved: { addListener: fn => { onRemoved = fn; } }
  },
  storage: {
    local: { get: async () => ({ rules, shortcutOptions }) },
    session: {
      set: async value => { Object.assign(session, value); reportArrived?.(value); },
      remove: async key => { delete session[key]; }
    }
  },
  action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async value => { badges.push(value); }, setTitle: async () => {} },
  scripting: { executeScript: async request => {
    injections.push(request);
    assert.equal(request.func, formDOM);
    assert.equal(request.world, 'ISOLATED');
    const [operation, payload] = request.args;
    if (operation === failOperation) throw new Error('synthetic injection failure');
    const result = operation === 'collect' ? ['2. ชื่อจริง'] : operation === 'apply' ?
      [{ label: '2. ชื่อจริง', rules: payload.jobs[0].rules, code: applyCode || (payload.dryRun ? 'ready' : 'filled'), diagnostic: applyDiagnostic, privateDetail: 'PRIVATE answer.pdf' }] : operation === 'advance' ? { code: 'attempted' } : undefined;
    return [{ documentId: 'document-one', result }];
  } }
};
const { runCurrentTab } = await import('../../outputs/regex-form-filler/background.js');
function send(message, sender = { id: 'synthetic', url: extension + 'popup.html' }) {
  return new Promise(resolve => { if (onMessage(message, sender, resolve) !== true) resolve(undefined); });
}
function reset() { injections.length = removed.length = created.length = badges.length = 0; session = {}; matcherFailure = undefined; reportArrived = undefined; shortcutOptions = undefined; applyCode = undefined; applyDiagnostic = undefined; failOperation = undefined; }

test('popup and shortcut share saved-rule dispatch, isolated injection, worker host and sanitized reports', async () => {
  reset();
  const result = await send({ type: 'run', dryRun: false, rules: [{ pattern: '.*', value: 'ignored' }] });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].label, 'ชื่อจริง');
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.equal(removed.length, 1);
  const apply = injections.find(request => request.args[0] === 'apply');
  assert.deepEqual(apply.args[1].jobs, [{ rules: [0], value: 'ทดสอบ' }]);
  assert.deepEqual(apply.target, { tabId: 7, documentIds: ['document-one'] });
  assert.equal(JSON.stringify(session).includes('ทดสอบ'), false);
  assert.equal(badges.at(-1).text, '1');
  const before = injections.length;
  const arrived = new Promise(resolve => { reportArrived = resolve; });
  onCommand('fill-form', currentTab);
  await arrived;
  // Wait for the dispatch's badge/notice/release tail before starting another test.
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(injections.slice(before).some(request => request.args[0] === 'apply' && request.args[1].dryRun === false));
  assert.equal(removed.length, 2);
});
test('dry run reaches the same implementation; concurrent dispatch is rejected', async () => {
  reset();
  const first = runCurrentTab(true);
  const busy = await runCurrentTab(false);
  assert.equal(busy.ok, false);
  assert.match(busy.error, /กำลัง/);
  assert.equal((await first).dryRun, true);
  assert.equal(injections.find(request => request.args[0] === 'apply').args[1].dryRun, true);
  assert.equal(badges.at(-1).text, 'DRY');
});
test('worker failure closes its tab and prevents all writes', async () => {
  reset(); matcherFailure = 'regex timeout';
  const result = await runCurrentTab(false);
  assert.equal(result.ok, false);
  assert.equal(injections.some(request => request.args[0] === 'apply'), false);
  assert.equal(removed.length, 1);
  assert.equal(badges.at(-1).text, '!');
});
test('edit/result and unrelated URLs are rejected without injection', async () => {
  reset();
  const original = currentTab.url;
  for (const url of ['https://docs.google.com/forms/d/synthetic/edit', 'https://example.com']) {
    currentTab.url = url;
    assert.equal((await runCurrentTab(false)).ok, false);
  }
  currentTab.url = original;
  assert.equal(injections.length, 0);
  assert.equal(created.length, 0);
});
test('messages from pages/unrelated extension views are not run; closed-tab reports are removed', async () => {
  reset();
  assert.equal(await send({ type: 'run', dryRun: false }, { id: 'synthetic', url: currentTab.url }), undefined);
  assert.equal(await send({ type: 'run', dryRun: false }, { id: 'foreign', url: extension + 'popup.html' }), undefined);
  assert.equal(injections.length, 0);
  session['report-7'] = {};
  onRemoved(7);
  assert.equal(session['report-7'], undefined);
});

test('date: worker dispatch passes a validated cloned date unchanged and never logs its answer in reports', async () => {
  reset();
  const previous = rules[0].value;
  const value = { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' };
  rules[0].value = value;
  try {
    for (const dryRun of [true, false]) {
      reset();
      assert.equal((await runCurrentTab(dryRun)).ok, true);
      const job = injections.find(request => request.args[0] === 'apply').args[1].jobs[0];
      assert.deepEqual(job, { rules: [0], value });
      assert.notEqual(job.value, value);
      assert.equal(JSON.stringify(session).includes(value.iso), false);
      assert.equal(removed.length, 1);
    }
  } finally { rules[0].value = previous; }
});


async function shortcut() {
  const arrived = new Promise(resolve => { reportArrived = resolve; });
  onCommand('fill-form', currentTab);
  await arrived;
  await new Promise(resolve => setTimeout(resolve, 10));
  return session['report-7'];
}
const advances = () => injections.filter(request => request.args[0] === 'advance');
test('shortcut-next: only keyboard handler authorizes advance, including forged popup/source flags', async () => {
  reset(); shortcutOptions = { autoNext: true, allowIncomplete: true };
  for (const dryRun of [true, false]) {
    await send({ type: 'run', dryRun, advance: true, source: 'shortcut', options: shortcutOptions });
    await runCurrentTab(dryRun, currentTab);
  }
  assert.equal(advances().length, 0);
  const result = await shortcut();
  assert.equal(advances().length, 1);
  assert.equal(advances()[0].args[1].allowIncomplete, true);
  assert.deepEqual(advances()[0].target, { tabId: 7, documentIds: ['document-one'] });
  assert.equal(result.navigation.code, 'attempted');
  assert.equal(result.rows[0].code, 'filled');
  assert.equal(JSON.stringify(result).includes(rules[0].value), false);
  assert.match(injections.filter(x => x.args[0] === 'notice').at(-1).args[1].message, /Next/);
});
test('shortcut-next: options are reread for every shortcut; only literal true master enables advance', async () => {
  reset();
  for (const value of [undefined, null, [], { autoNext: 'true', allowIncomplete: true }, { autoNext: false, allowIncomplete: true }]) {
    shortcutOptions = value;
    await shortcut();
  }
  assert.equal(advances().length, 0);
  shortcutOptions = { autoNext: true, allowIncomplete: 'true' };
  await shortcut();
  assert.equal(advances().length, 1);
  assert.equal(advances()[0].args[1].allowIncomplete, false);
  shortcutOptions = { autoNext: false, allowIncomplete: true };
  await shortcut();
  assert.equal(advances().length, 1);
});
test('shortcut-next: matcher/fill failures and stale/error/timeout rows never authorize navigation', async () => {
  for (const code of ['stale', 'error', 'timeout']) {
    reset(); shortcutOptions = { autoNext: true, allowIncomplete: true }; applyCode = code;
    const result = await shortcut();
    assert.equal(advances().length, 0, code);
    assert.equal(result.navigation.code, 'stale');
  }
  for (const failure of ['matcher', 'apply']) {
    reset(); shortcutOptions = { autoNext: true, allowIncomplete: true };
    if (failure === 'matcher') matcherFailure = 'synthetic timeout';
    else failOperation = 'apply';
    const result = await shortcut();
    assert.equal(result.ok, false);
    assert.equal(advances().length, 0);
  }
});
test('shortcut-next: navigation injection failure preserves fill rows and does not retry', async () => {
  reset(); shortcutOptions = { autoNext: true }; failOperation = 'advance';
  const result = await shortcut();
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].code, 'filled');
  assert.equal(result.navigation.code, 'error');
  assert.equal(advances().length, 1);
  assert.equal(injections.filter(x => x.args[0] === 'apply').length, 1);
});

test('file: dispatch loads matched files only, sends bytes only for apply, reports no file metadata', async () => {
  reset(); const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const ref = fileRef(); idb.records.set(ref.fileId, { ref, blob: testFile() });
  const original = structuredClone(rules);
  rules[0].value = ref;
  rules.push({ pattern: '^unmatched$', value: fileRef({ fileId: crypto.randomUUID() }) });
  try {
    for (const dry of [true, false]) {
      reset(); idb.reads.length = 0;
      const result = await runCurrentTab(dry);
      assert.equal(result.ok, true);
      assert.deepEqual(idb.reads, [ref.fileId]);
      const apply = injections.find(x => x.args[0] === 'apply').args[1];
      assert.deepEqual(apply.files, dry ? {} : { [ref.fileId]: 'dGVzdA==' });
      assert.equal(JSON.stringify(session).includes(ref.name), false);
      assert.equal(JSON.stringify(session).includes(ref.fileId), false);
      assert.equal(JSON.stringify(session).includes('dGVzdA=='), false);
    }
    reset(); idb.records.clear();
    const result = await runCurrentTab(false);
    assert.equal(result.ok, false); assert.match(result.error, /เลือกไฟล์ใหม่/);
    assert.equal(injections.some(x => x.args[0] === 'apply'), false);
  } finally { rules.splice(0, rules.length, ...original); }
});

test('file: uncertain upload rows block shortcut Next even with incomplete override', async () => {
  for (const code of ['pending', 'file-manual', 'file-missing']) {
    reset(); shortcutOptions = { autoNext: true, allowIncomplete: true }; applyCode = code;
    const result = await shortcut();
    assert.equal(advances().length, 0, code); assert.equal(result.navigation.code, 'stale');
  }
});

test('file diagnostics: session retains only allowlisted strings and records runtime version and time', async () => {
  const allowed = ['file-preflight', 'file-data', 'picker-discovery', 'file-handoff', 'upload-completion', 'unexpected-ui', 'picker-document-changed', 'picker-ui-changed', 'owner-form-changed', 'selection-not-exact', 'close-grace-expired', 'overall-timeout', 'previous-unconfirmed'];
  for (const diagnostic of [...allowed, undefined, null, '', 'PRIVATE answer.pdf', 'https://example.test/?auth=PRIVATE', '__proto__', 'constructor', ['overall-timeout'], { reason: 'overall-timeout', answer: 'PRIVATE' }]) {
    reset(); applyCode = 'pending'; applyDiagnostic = diagnostic;
    const start = Date.now();
    const result = await runCurrentTab(false);
    assert.equal(result.ok, true);
    const expected = { label: 'ชื่อจริง', rules: [0], code: 'pending', ...(allowed.includes(diagnostic) ? { diagnostic } : {}) };
    assert.deepEqual(result.rows, [expected]); assert.deepEqual(session['report-7'], result);
    assert.equal(JSON.stringify(session).includes('PRIVATE'), false);
    assert.equal(result.version, '9.8.7'); assert.ok(result.time >= start && result.time <= Date.now());
  }
  reset(); failOperation = 'apply';
  const failed = await runCurrentTab(false);
  assert.equal(failed.ok, false); assert.equal(failed.version, '9.8.7'); assert.ok(Number.isFinite(failed.time));
});
