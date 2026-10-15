import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const legacyKey = 'regex-form-filler-synthetic-preview-v1.1';
const presetKey = 'regex-form-filler-synthetic-presets-v1.6';
async function preview(values) {
  const events = {};
  let reset;
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  };
  globalThis.addEventListener = (type, callback) => { events[type] = callback; };
  globalThis.location = { reload() {} };
  globalThis.document = { body: { prepend() {} }, createElement: () => ({
    style: {}, append() {}, addEventListener: (_, callback) => { reset = callback; }
  }) };
  delete require.cache[require.resolve('./preview-chrome.js')];
  require('./preview-chrome.js');
  return { api: chrome, events, reset: () => reset() };
}

globalThis.Worker = class {
  constructor(url) {
    this.worker = new NodeWorker(new URL('./worker-harness.mjs', import.meta.url), { workerData: { module: url.href } });
    this.worker.on('message', data => this.onmessage({ data }));
    this.worker.on('error', () => this.onerror({ preventDefault() {} }));
  }
  postMessage(value) { this.worker.postMessage(value); }
  terminate() { void this.worker.terminate(); }
};

test('presets preview: legacy fallback and persisted selection run with shared validation; reset is isolated', async () => {
  const legacy = [{ pattern: '^อาหาร$', value: 'legacy' }];
  const values = new Map([[legacyKey, JSON.stringify(legacy)], ['unrelated', 'keep']]);
  let p = await preview(values);
  assert.equal(Object.hasOwn(await p.api.storage.local.get(), 'presetState'), false);
  let report = await p.api.runtime.sendMessage({ type: 'run', dryRun: true });
  assert.equal(report.rows[3].code, 'ready');
  assert.equal(values.has(presetKey), false, 'reading legacy preview must not migrate eagerly');
  const presetState = { activeId: 'b', presets: [
    { id: 'a', name: 'A', rules: legacy },
    { id: 'b', name: 'B', rules: [{ pattern: '^Upload$', value: 'chosen' }] }
  ] };
  await p.api.storage.local.set({ presetState });
  p = await preview(values);
  assert.deepEqual((await p.api.storage.local.get()).presetState, presetState);
  report = await p.api.runtime.sendMessage({ type: 'run', dryRun: true });
  assert.equal(report.rows[3].code, 'unmatched');
  assert.equal(report.rows[5].code, 'ready');
  await p.api.storage.local.set({ presetState: { activeId: 'missing', presets: [] } });
  report = await p.api.runtime.sendMessage({ type: 'run', dryRun: true });
  assert.equal(report.ok, false, 'malformed state must not use legacy rules');
  p.reset();
  assert.deepEqual([...values], [['unrelated', 'keep']]);
});

test('presets preview: local writes and other-window storage events notify the popup stale guard', async () => {
  const values = new Map();
  const p = await preview(values);
  const changes = [];
  p.api.storage.onChanged.addListener((change, area) => changes.push({ change, area }));
  const presetState = { activeId: 'a', presets: [{ id: 'a', name: 'A', rules: [] }] };
  await p.api.storage.local.set({ presetState });
  assert.deepEqual(changes[0], { area: 'local', change: { presetState: { oldValue: undefined, newValue: presetState } } });
  const next = { ...presetState, presets: [{ ...presetState.presets[0], name: 'Renamed' }] };
  p.events.storage?.({ key: presetKey, storageArea: localStorage, oldValue: JSON.stringify(presetState), newValue: JSON.stringify(next) });
  assert.deepEqual(changes[1], { area: 'local', change: { presetState: { oldValue: presetState, newValue: next } } });
  p.events.storage?.({ key: null, storageArea: localStorage, oldValue: null, newValue: null });
  assert.equal(changes[2]?.area, 'local');
  assert.ok(Object.hasOwn(changes[2].change, 'presetState'), 'clear storage must invalidate other open popups');
});
