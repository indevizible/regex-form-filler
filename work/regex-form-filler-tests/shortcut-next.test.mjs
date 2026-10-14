import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as core from '../../outputs/regex-form-filler/core.js';

test('shortcut-next: shared normalization accepts only literal booleans and plain object options', () => {
  assert.equal(typeof core.normalizeShortcutOptions, 'function');
  for (const value of [undefined, null, false, 'true', [], { autoNext: 1, allowIncomplete: 'true' }]) {
    assert.deepEqual(core.normalizeShortcutOptions(value), { autoNext: false, allowIncomplete: false });
  }
  assert.deepEqual(core.normalizeShortcutOptions({ autoNext: true, allowIncomplete: true }), { autoNext: true, allowIncomplete: true });
});

test('shortcut-next: accessible popup describes keyboard scope, keeps 560px and separates navigation report', async () => {
  const html = await readFile('outputs/regex-form-filler/popup.html', 'utf8');
  const css = await readFile('outputs/regex-form-filler/popup.css', 'utf8');
  for (const [id, label] of [['auto-next', 'กด Next อัตโนมัติเมื่อกรอกครบ'], ['allow-incomplete', 'อนุญาต Next แม้ยังกรอกไม่ครบ']]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="checkbox"`));
    assert.ok(html.includes(label));
  }
  assert.match(html, /id="shortcut-status"[^>]*role="status"/);
  assert.match(html, /id="navigation-result"/);
  assert.match(css, /width: 560px/);
});

test('shortcut-next: preview settings merge without erasing legacy rules; reset removes only synthetic keys', async () => {
  const values = new Map([['regex-form-filler-synthetic-preview-v1.1', '[{"pattern":"x","value":"synthetic"}]'], ['unrelated', 'keep']]);
  let reset;
  const context = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    location: { reload() {} }, document: { body: { prepend() {} }, createElement: () => ({ style: {}, append() {}, addEventListener: (_, fn) => { reset = fn; } }) } };
  runInNewContext(await readFile('work/regex-form-filler-tests/preview-chrome.js', 'utf8'), context);
  assert.equal(context.chrome.runtime.getManifest().version, JSON.parse(await readFile('outputs/regex-form-filler/manifest.json', 'utf8')).version);
  const before = (await context.chrome.storage.local.get()).rules;
  await context.chrome.storage.local.set({ shortcutOptions: { autoNext: true, allowIncomplete: true } });
  const stored = await context.chrome.storage.local.get();
  assert.deepEqual(stored.rules, before);
  assert.equal(stored.shortcutOptions.autoNext, true);
  await context.chrome.storage.local.set({ rules: [] });
  assert.equal((await context.chrome.storage.local.get()).shortcutOptions.autoNext, true);
  reset();
  assert.deepEqual([...values], [['unrelated', 'keep']]);
});
