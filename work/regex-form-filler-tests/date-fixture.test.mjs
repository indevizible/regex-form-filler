import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const path = new URL('./date-fixture-checks.js', import.meta.url);
const fixture = existsSync(path) ? await import(path) : {};
const expected = {
  date: { value: '2000-02-29', code: 'filled' }, text: { value: '29/02/2543', code: 'filled' },
  saved: { value: 'เดิม', code: 'preserved' }, invalid: { value: '', code: 'invalid' }, other: { value: '', code: 'unsupported' }
};
const before = { date: '', text: '', saved: 'เดิม', invalid: '', other: '' };
const sample = dryRun => ({ expected, before, dryRun,
  after: dryRun ? { ...before } : Object.fromEntries(Object.entries(expected).map(([id, spec]) => [id, spec.value])),
  rows: Object.fromEntries(Object.entries(expected).map(([id, spec]) => [id, dryRun && spec.code === 'filled' ? 'ready' : spec.code])),
  counters: { next: 0, submit: 0 }, events: { input: dryRun ? 0 : 2, change: dryRun ? 0 : 2, click: 0 }
});
test('date fixture: assertion harness accepts correct dry/fill/repeat outcomes', () => {
  assert.equal(typeof fixture.checkDateFixture, 'function');
  for (const dryRun of [true, false]) assert.deepEqual(fixture.checkDateFixture(sample(dryRun)), []);
  const repeat = sample(false);
  repeat.before = { ...repeat.after };
  repeat.rows.date = repeat.rows.text = 'preserved';
  repeat.events.input = repeat.events.change = 0;
  assert.deepEqual(fixture.checkDateFixture(repeat), []);
});
test('date fixture: assertion harness detects bad values, missing rows, dry writes/events and navigation', () => {
  assert.equal(typeof fixture.checkDateFixture, 'function');
  for (const mutate of [
    state => { state.after.text = '[object Object]'; },
    state => { state.after.saved = 'overwritten'; },
    state => { state.after.other = 'date'; },
    state => { delete state.rows.date; },
    state => { state.rows.date = 'invalid'; },
    state => { state.counters.next++; },
    state => { state.counters.submit++; },
    state => { state.events.input++; },
    state => { state.events.change++; },
    state => { state.events.click++; }
  ]) {
    for (const dryRun of [true, false]) {
      const state = sample(dryRun); mutate(state);
      assert.ok(fixture.checkDateFixture(state).length, mutate.toString());
    }
  }
  const dry = sample(true); dry.after.date = '2000-02-29';
  assert.ok(fixture.checkDateFixture(dry).length, 'dry run cannot write even the correct answer');
});
