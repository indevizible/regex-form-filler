import { validateRules, STATUS } from '../../outputs/regex-form-filler/core.js';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { matchWithTimeout } from '../../outputs/regex-form-filler/matcher.js';
import { checkDateFixture } from './date-fixture-checks.js';

const $ = id => document.getElementById(id);
const rules = validateRules([
  { pattern: '^วันเกิด$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' } },
  { pattern: '^วันเกิด ค\\.ศ\\.$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'gregorian' } },
  { pattern: '^วันเกิด เดือนเต็ม$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist', textFormat: 'thai-long' } },
  { pattern: '^วันเกิด เดือนย่อ$', flags: 'iu', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist', textFormat: 'thai-short' } },
  { pattern: '^วันเกิดเดิม$', flags: 'iu', value: '29/2/2543' }
]);
const controls = [...document.querySelectorAll('[data-expect]')];
const expected = Object.fromEntries(controls.map(control => [control.id, { value: control.dataset.expect, code: control.dataset.code }]));
const snapshot = () => Object.fromEntries(controls.map(control => [control.id,
  ['radio', 'checkbox'].includes(control.type) ? String(control.checked) : control.value ?? control.getAttribute('data-value')]));
const increment = id => { $(id).textContent = String(Number($(id).textContent) + 1); };
const count = name => Number($(`${name}-count`).textContent);
const events = () => ({ input: count('input'), change: count('change'), click: count('click') });
$('form').addEventListener('input', () => increment('input-count'));
$('form').addEventListener('change', () => increment('change-count'));
$('form').addEventListener('click', event => { if (event.target.closest('input[type="radio"], input[type="checkbox"], [role="listbox"]')) increment('click-count'); });
$('next').addEventListener('click', () => increment('next-count'));
$('form').addEventListener('submit', event => { event.preventDefault(); increment('submit-count'); });
let busy = false;
async function run(dryRun) {
  if (busy) return;
  busy = true;
  $('inspect').disabled = $('fill').disabled = true;
  $('assertions').textContent = '';
  $('results').replaceChildren();
  try {
    const before = snapshot();
    const beforeEvents = events();
    const url = location.href;
    const token = crypto.randomUUID();
    const labels = await formDOM('collect', { url, token });
    const matches = await matchWithTimeout(rules, labels);
    const jobs = matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) }));
    const report = await formDOM('apply', { url, token, jobs, dryRun });
    const rows = Object.fromEntries(report.map((row, index) => [controls[index]?.id ?? `unexpected-${index}`, row.code]));
    const after = snapshot();
    const delta = Object.fromEntries(Object.entries(events()).map(([name, value]) => [name, value - beforeEvents[name]]));
    const failures = checkDateFixture({ expected, before, after, rows, dryRun, counters: { next: count('next'), submit: count('submit') }, events: delta });
    $('assertions').textContent = failures.length ? `FAIL (${failures.length})\n${failures.join('\n')}` : `PASS — ${dryRun ? 'ตรวจอย่างเดียว ไม่เขียนค่า' : 'กรอกและอ่านค่ากลับ'} · Next=0 · Submit=0`;
    $('values').textContent = JSON.stringify(after, null, 2);
    for (const [index, row] of report.entries()) {
      const item = document.createElement('li');
      item.textContent = `${controls[index]?.id}: ${STATUS[row.code]} · กฎ ${row.rules.map(rule => rule + 1).join(', ')}`;
      $('results').append(item);
    }
    $('status').textContent = `${report.length} ข้อ · ใช้กฎและโค้ดจริง · ${dryRun ? 'ตรวจแล้ว' : 'กรอกแล้ว'}`;
  } catch (error) {
    $('assertions').textContent = `FAIL: ${error.message}`;
  } finally { busy = false; $('inspect').disabled = $('fill').disabled = false; }
}
$('inspect').addEventListener('click', () => run(true));
$('fill').addEventListener('click', () => run(false));
$('reset').addEventListener('click', () => location.reload());
$('values').textContent = JSON.stringify(snapshot(), null, 2);
