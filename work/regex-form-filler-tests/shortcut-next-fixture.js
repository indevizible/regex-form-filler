import { validateRules, NAVIGATION_STATUS } from '../../outputs/regex-form-filler/core.js';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { matchWithTimeout } from '../../outputs/regex-form-filler/matcher.js';

const $ = id => document.getElementById(id);
const rules = validateRules([
  { pattern: '^Fill text$', value: 'synthetic fill' },
  { pattern: '^Date$', value: { type: 'date', iso: '2000-02-29', textCalendar: 'buddhist' } }
]);
const scenarios = [
  { name: 'ครบทุกข้อ รวมคำตอบเดิม ไม่มี rule และ list/หัวข้อส่วน', code: 'attempted', next: 1, advanced: 1 },
  { name: 'ข้อ optional ว่าง', blank: true, code: 'incomplete', next: 0, advanced: 0 },
  { name: 'ข้อ optional ว่าง + override', blank: true, override: true, code: 'attempted', next: 1, advanced: 1 },
  { name: 'native required ไม่ผ่าน + override', invalid: true, override: true, code: 'attempted', next: 1, advanced: 0 },
  { name: 'dry-run แม้ขอ advance', dryRun: true, code: 'stale', next: 0, advanced: 0 },
  { name: 'มีเฉพาะ Submit', onlySubmit: true, code: 'no-next', next: 0, advanced: 0 },
  { name: 'มี Next สองปุ่ม', duplicate: true, code: 'ambiguous', next: 0, advanced: 0 },
  { name: 'ใช้ token เดิมซ้ำ', replay: true, code: 'attempted', next: 1, advanced: 1 },
  { name: 'native Submit ตั้งชื่อ Next', misnamedSubmit: true, code: 'no-next', next: 0, advanced: 0 },
  { name: 'checkbox บังคับสองข้อ เลือกเพียงหนึ่ง', requiredChecks: true, code: 'incomplete', next: 0, advanced: 0 },
  { name: 'checkbox บังคับสองข้อ เลือกเพียงหนึ่ง + override', requiredChecks: true, override: true, code: 'attempted', next: 1, advanced: 0 }
];

$('run-scenarios').addEventListener('click', async () => {
  $('run-scenarios').disabled = true;
  $('scenario-results').replaceChildren();
  $('status').textContent = 'กำลังทดสอบ…';
  let passed = 0;
  for (const scenario of scenarios) {
    $('stage').replaceChildren($('questions').content.cloneNode(true));
    $('scenario').textContent = scenario.name;
    const form = $('synthetic-form');
    const counters = { next: 0, submit: 0, submitEvents: 0, advanced: 0 };
    const displayCounters = () => {
      $('next-count').textContent = counters.next;
      $('submit-count').textContent = counters.submit;
      $('submit-events').textContent = counters.submitEvents;
      $('advanced-count').textContent = counters.advanced;
    };
    displayCounters();
    const requiredChecks = [...form.querySelectorAll('input[name="native-checkbox"]')];
    if (scenario.requiredChecks) requiredChecks[1].checked = false;
    if (scenario.blank) form.elements.optional.value = '';
    if (scenario.invalid) { form.elements.manual.required = true; form.elements.manual.value = ''; }
    if (scenario.onlySubmit || scenario.misnamedSubmit) form.querySelector('[data-next]').remove();
    if (scenario.misnamedSubmit) form.querySelector('button[type="submit"]').textContent = 'Next';
    if (scenario.duplicate) $('navigation').prepend(form.querySelector('[data-next]').cloneNode(true));
    for (const next of form.querySelectorAll('[data-next]')) next.addEventListener('click', () => {
      counters.next++;
      // This simulates a page transition only after the browser accepts all native constraints.
      if (form.reportValidity()) counters.advanced++;
      displayCounters();
    });
    form.querySelector('button[type="submit"]').addEventListener('click', () => { counters.submit++; displayCounters(); });
    form.addEventListener('submit', event => { event.preventDefault(); counters.submitEvents++; displayCounters(); });
    for (const control of form.querySelectorAll('[role="radio"], [role="checkbox"]')) control.addEventListener('click', () => {
      const selected = control.getAttribute('aria-checked') === 'true';
      if (control.getAttribute('role') === 'radio') control.parentElement.querySelectorAll('[role="radio"]').forEach(option => option.setAttribute('aria-checked', 'false'));
      control.setAttribute('aria-checked', String(control.getAttribute('role') === 'radio' || !selected));
    });
    for (const option of form.querySelectorAll('[role="option"]')) option.addEventListener('click', () => {
      option.parentElement.querySelectorAll('[role="option"]').forEach(other => other.setAttribute('aria-selected', String(other === option)));
      option.parentElement.setAttribute('data-value', option.getAttribute('data-value'));
    });
    const url = location.href;
    const token = crypto.randomUUID();
    let resultText;
    try {
      const labels = await formDOM('collect', { url, token, allowAdvance: true });
      const matches = await matchWithTimeout(rules, labels);
      const jobs = matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) }));
      const rows = await formDOM('apply', { url, token, jobs, dryRun: scenario.dryRun === true });
      const navigation = await formDOM('advance', { url, token, allowIncomplete: scenario.override === true });
      if (!form.querySelector('[role="list"]') || !form.querySelector('[role="heading"][aria-level="2"]')) throw new Error('missing structural fixture nodes');
      if (requiredChecks.length !== 2 || !requiredChecks.every(input => input.required) || requiredChecks[1].checkValidity() === !!scenario.requiredChecks) throw new Error('native required checkbox constraints changed');
      if (navigation.code !== scenario.code) throw new Error(`navigation=${navigation.code}, expected=${scenario.code}`);
      if (scenario.replay && (await formDOM('advance', { url, token, allowIncomplete: true })).code !== 'stale') throw new Error('replayed token was accepted');
      if (counters.next !== scenario.next || counters.advanced !== scenario.advanced || counters.submit !== 0 || counters.submitEvents !== 0) throw new Error('unexpected navigation counters');
      if (rows.length !== 10 || rows[0].code !== (scenario.dryRun ? 'ready' : 'filled') || rows[1].code !== (scenario.dryRun ? 'ready' : 'filled') || rows[2].code !== 'unmatched') throw new Error('fill rows/matching changed');
      if (form.elements.text.value !== (scenario.dryRun ? '' : 'synthetic fill') || form.elements.date.value !== (scenario.dryRun ? '' : '2000-02-29')) throw new Error('shipping text/date fill or dry-run failed');
      if (!scenario.invalid && form.elements.manual.value !== 'synthetic manual answer') throw new Error('prefilled unmatched answer changed');
      if (scenario.invalid && (form.elements.manual.value !== '' || !form.elements.manual.required)) throw new Error('required constraint changed');
      if (JSON.stringify({ rows, navigation }).includes('synthetic manual answer')) throw new Error('report contains answer');
      passed++;
      resultText = `PASS · ${scenario.name} · ${NAVIGATION_STATUS[navigation.code]}`;
    } catch (error) { resultText = `FAIL · ${scenario.name} · ${error.message}`; }
    finally { await formDOM('release', { url }); }
    const item = document.createElement('li');
    item.textContent = `${resultText} · Next=${counters.next} · Submit=${counters.submit}/${counters.submitEvents} · Advanced (จำลอง)=${counters.advanced}`;
    $('scenario-results').append(item);
  }
  $('status').textContent = `${passed === scenarios.length ? 'PASS' : 'FAIL'} · ${passed}/${scenarios.length} assertions ผ่าน · DOM/Worker fixture เท่านั้น`;
  $('run-scenarios').disabled = false;
});
