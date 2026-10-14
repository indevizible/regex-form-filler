import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as core from '../../outputs/regex-form-filler/core.js';
import { ruleFromDraft, ruleToDraft } from '../../outputs/regex-form-filler/rule-editor.js';
import { fakeIDB, fileRef, fileRule, testFile } from './file-test-helpers.mjs';
const path = new URL('../../outputs/regex-form-filler/file-store.js', import.meta.url);
const files = existsSync(path) ? await import(path) : {};

test('file: schema clones strict references and keeps exported JSON free of bytes', () => {
  const ref = fileRef();
  const rule = core.validateRules([fileRule(ref)])[0];
  assert.deepEqual(rule.value, ref); assert.notEqual(rule.value, ref);
  ref.name = 'mutated.pdf'; assert.equal(rule.value.name, 'TEST-ONLY.pdf');
  assert.deepEqual(core.parseRules(JSON.stringify([rule])), [rule]);
  assert.deepEqual(core.matchLabels([rule], ['Upload', 'Other']), [[0], []]);
  for (const extra of [{ fileId: 'path/to/file' }, { name: '../secret.pdf' }, { name: 'C:\\secret.pdf' }, { name: '' }, { name: 'x\n.pdf' }, { name: 'x'.repeat(256) }, { size: -1 }, { size: 1.5 }, { size: 10485761 }, { size: '4' }, { mime: 'text/plain\n' }, { mime: 'x'.repeat(256) }, { bytes: 'dGVzdA==' }]) {
    assert.throws(() => core.validateRules([fileRule(fileRef(extra))]));
  }
  const inherited = Object.create(fileRef());
  assert.throws(() => core.validateRules([fileRule(inherited)]));
  const symbol = fileRef(); symbol[Symbol('bytes')] = 'secret';
  assert.throws(() => core.validateRules([fileRule(symbol)]));
});

test('file: editor round-trips refs without placing objects/bytes in textareas', () => {
  const original = fileRule();
  const draft = ruleToDraft(original);
  assert.equal(draft.answerType, 'file'); assert.equal(draft.answer, '');
  assert.deepEqual(draft.file, original.value); assert.notEqual(draft.file, original.value);
  assert.deepEqual(ruleFromDraft(draft, original), original);
  draft.source = 'Changed';
  assert.deepEqual(ruleFromDraft(draft, original), { ...original, pattern: '^Changed$' });
  assert.throws(() => ruleFromDraft({ ...draft, file: null }));
});

test('file: saved copy loads only with matching record and actual Blob metadata', async () => {
  assert.equal(typeof files.storeFile, 'function');
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const ref = files.createFileReference(testFile());
  await files.storeFile(ref, testFile());
  assert.equal(await (await files.loadFile(ref)).text(), 'test');
  for (const altered of [{ name: 'other.pdf' }, { size: 5 }, { mime: 'image/png' }]) await assert.rejects(files.loadFile({ ...ref, ...altered }), /เลือกไฟล์ใหม่/);
  idb.records.set(ref.fileId, { ref, blob: testFile('TEST-ONLY.pdf', 'wrong bytes length') });
  await assert.rejects(files.loadFile(ref), /เลือกไฟล์ใหม่/);
  idb.records.clear(); await assert.rejects(files.loadFile(ref), /เลือกไฟล์ใหม่/);
  idb.unavailable = true; await assert.rejects(files.storeFile(ref, testFile()), /จัดเก็บ/);
});

test('file: staged save rollback keeps old/shared attachments; cleanup follows committed rules only', async () => {
  assert.equal(typeof files.saveRulesWithFiles, 'function');
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const old = fileRef(), replacement = files.createFileReference(testFile('replacement.pdf'));
  await files.storeFile(old, testFile());
  const previous = [fileRule(old), fileRule(old, '^Shared$')];
  const next = [fileRule(replacement), previous[1]];
  const staged = { ref: replacement, blob: testFile('replacement.pdf') };
  await assert.rejects(files.saveRulesWithFiles(previous, next, staged, async () => { throw new Error('storage failed'); }));
  assert.deepEqual([...idb.records.keys()], [old.fileId]);
  await files.saveRulesWithFiles(previous, next, staged, async rules => { assert.deepEqual(rules, next); assert.ok(idb.records.has(old.fileId)); });
  assert.equal(idb.records.size, 2);
  await files.saveRulesWithFiles(next, [next[0]], null, async () => {});
  assert.deepEqual([...idb.records.keys()], [replacement.fileId]);
  idb.failWrite = true;
  let writes = 0;
  const third = files.createFileReference(testFile('third.pdf'));
  await assert.rejects(files.saveRulesWithFiles([next[0]], [fileRule(third)], { ref: third, blob: testFile('third.pdf') }, async () => { writes++; }));
  assert.equal(writes, 0); assert.ok(idb.records.has(replacement.fileId));
});

test('file: actual apply deduplicates, bounds payload, and dry-run reads no bytes', async () => {
  assert.equal(typeof files.prepareFiles, 'function');
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const ref = fileRef(); await files.storeFile(ref, testFile());
  const jobs = [{ rules: [0], value: ref }, { rules: [1], value: { ...ref } }, { rules: [], value: fileRef({ fileId: crypto.randomUUID() }) }];
  assert.deepEqual(await files.prepareFiles(jobs, false), { [ref.fileId]: 'dGVzdA==' });
  assert.deepEqual(idb.reads, [ref.fileId]);
  const blob = idb.records.get(ref.fileId).blob;
  blob.arrayBuffer = () => { throw new Error('dry-run must not read bytes'); };
  assert.deepEqual(await files.prepareFiles(jobs, true), {});
  await assert.rejects(files.prepareFiles([{ rules: [0], value: ref }, { rules: [1], value: { ...ref, name: 'conflict.pdf' } }], true));
  idb.reads.length = 0;
  const big = [0, 1, 2].map(() => ({ rules: [0], value: fileRef({ size: 10485760, fileId: crypto.randomUUID() }) }));
  await assert.rejects(files.prepareFiles(big, false), /20 MiB/);
  assert.deepEqual(idb.reads, []);
});

test('file: chunk encoding preserves binary across boundaries and read failures reveal no filenames', async () => {
  const idb = fakeIDB(); globalThis.indexedDB = idb.api;
  const bytes = new Uint8Array(70001); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const file = testFile('private-name.pdf', bytes); const ref = files.createFileReference(file);
  await files.storeFile(ref, file);
  const jobs = [{ rules: [0], value: ref }];
  const encoded = await files.prepareFiles(jobs, false);
  assert.deepEqual(new Uint8Array(Buffer.from(encoded[ref.fileId], 'base64')), bytes);
  idb.records.get(ref.fileId).blob.arrayBuffer = () => { throw new Error('private-name.pdf'); };
  await assert.rejects(files.prepareFiles(jobs, false), error => !error.message.includes('private-name'));
});
