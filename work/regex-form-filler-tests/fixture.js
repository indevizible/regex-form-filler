import { normalizeLabel, parseRules, STATUS } from '../../outputs/regex-form-filler/core.js';
import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { matchWithTimeout } from '../../outputs/regex-form-filler/matcher.js';

const $ = id => document.getElementById(id);
const rule = (pattern, value) => ({ pattern, flags: 'iu', value });
const rules = parseRules(JSON.stringify([
  rule('^คำนำหน้าชื่อ$', 'นาย'), rule('^ชื่อจริง$', 'ทดสอบ'), rule('^นามสกุล$', 'ระบบ'),
  rule('^วัน เดือน ปี เกิด$', '2000-01-02'), rule('^อายุ \\(ปีบริบูรณ์\\)$', '26'), rule('^สัญชาติ$', 'ไทย'),
  rule('^กิจกรรมทดสอบ$', ['อ่าน', 'เดิน']), rule('^Dropdown ทดสอบ$', 'ตัวเลือก ข'),
  rule('^(?!.*ฉุกเฉิน).*เบอร์โทรศัพท์.*$', '0000000000'), rule('^E-mail$', 'regex-test@example.com'),
  rule('^.*เบอร์โทรศัพท์.*ฉุกเฉิน.*$', '0000000001'), rule('^ซ้ำหลายกฎ$', 'A'), rule('ซ้ำหลาย', 'B'),
  rule('^อัปโหลดไฟล์$', 'synthetic.txt'), rule('^อ่านอย่างเดียว$', 'x'), rule('^ช่องซ่อน$', 'x'),
  rule('^ตัวเลขไม่ผ่าน$', '999'), rule('^หลายช่อง$', 'x'), rule('^ตาราง$', ['A']), rule('^ไม่ยอมเปลี่ยนค่า$', 'x'),
  rule('^คำตอบยาว$', 'ข้อมูลสมมติ\nสำหรับทดสอบ'), rule('^ตัวเลือกหาย$', ['A', 'ไม่อยู่ในรายการ']), rule('^เลือกไว้แล้ว$', ['B'])
]));
let lastReport;
let dryRun;
let busy = false;
const increment = id => { $(id).textContent = String(Number($(id).textContent) + 1); };
$('form').addEventListener('input', () => increment('input-count'));
$('form').addEventListener('change', () => increment('change-count'));
$('next').addEventListener('click', () => increment('next-count'));
$('form').addEventListener('submit', event => { event.preventDefault(); increment('submit-count'); });
$('reject-write').addEventListener('input', () => { $('reject-write').value = ''; });
document.querySelectorAll('[role="radio"], [role="checkbox"]').forEach(control => {
  control.addEventListener('click', () => {
    if (control.getAttribute('role') === 'radio') control.closest('[role="listitem"]').querySelectorAll('[role="radio"]').forEach(other => other.setAttribute('aria-checked', 'false'));
    control.setAttribute('aria-checked', String(control.getAttribute('aria-checked') !== 'true'));
  });
});
$('dropdown').addEventListener('click', event => {
  const option = event.target.closest('[role="option"]');
  const list = $('dropdown');
  if (option) {
    list.querySelectorAll('[role="option"]').forEach(item => { item.setAttribute('aria-selected', String(item === option)); item.hidden = true; });
    list.setAttribute('data-value', option.getAttribute('data-value'));
    $('dropdown-value').textContent = option.textContent;
    list.setAttribute('aria-expanded', 'false');
  } else {
    list.setAttribute('aria-expanded', 'true');
    list.querySelectorAll('[role="option"]').forEach(item => { item.hidden = false; });
  }
});
async function run(inspect) {
  if (busy) return;
  busy = true;
  $('inspect').disabled = $('fill').disabled = true;
  $('assertions').textContent = '';
  try {
    const url = location.href;
    const token = crypto.randomUUID();
    const labels = await formDOM('collect', { url, token });
    const matches = await matchWithTimeout(rules, labels);
    const jobs = matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) }));
    lastReport = await formDOM('apply', { url, token, jobs, dryRun: inspect });
    dryRun = inspect;
    $('results').replaceChildren();
    lastReport.forEach(row => {
      const item = document.createElement('li');
      item.textContent = `${normalizeLabel(row.label)} → ${row.code}: ${STATUS[row.code]} (rules ${row.rules.map(index => index + 1).join(', ') || '—'})`;
      $('results').append(item);
    });
    $('status').textContent = `${inspect ? 'ตรวจแล้ว (ไม่แก้คำตอบ)' : 'กรอกแล้ว'} · ${lastReport.length} คำถาม · ใช้โค้ด shipping จริง`;
    await formDOM('notice', { url, message: 'Fixture run complete — synthetic data only' });
  } catch (error) { $('status').textContent = `FAIL: ${error.message}`; }
  finally { busy = false; $('inspect').disabled = $('fill').disabled = false; }
}
function assertions() {
  const failures = [];
  const check = (condition, name) => { if (!condition) failures.push(name); };
  check(lastReport?.length === 23, 'Collect exactly 23 questions, no section heading');
  check($('next-count').textContent === '0' && $('submit-count').textContent === '0', 'Never click Next or Submit');
  check($('prefilled').value === 'ค่าเดิมทดสอบ', 'Preserve prefilled text');
  check($('preserved-choice').getAttribute('aria-checked') === 'true', 'Preserve checked answer');
  check($('agreement').getAttribute('aria-checked') === 'false', 'Do not accept unmatched agreement');
  for (const id of ['ambiguous', 'file', 'readonly', 'hidden-field', 'invalid-number', 'multi-a', 'multi-b', 'reject-write']) check($(id).value === '', `Leave ${id} empty`);
  check($('missing-choice').getAttribute('aria-checked') === 'false', 'Missing checkbox option prevents all clicks');
  const expected = ['filled', 'filled', 'preserved', 'filled', 'filled', 'filled', 'filled', 'filled', 'filled', 'filled', 'filled', 'ambiguous', 'unsupported', 'blocked', 'blocked', 'invalid', 'unsupported', 'unsupported', 'mismatch', 'filled', 'missing', 'preserved', 'unmatched'];
  if (dryRun) {
    expected.forEach((code, index) => { if (code === 'filled' || code === 'mismatch') expected[index] = 'ready'; });
    check($('input-count').textContent === '0' && $('change-count').textContent === '0', 'Dry run fires no input/change');
    check($('first').value === '' && $('date').value === '' && $('dropdown').getAttribute('data-value') === '', 'Dry run leaves controls untouched');
  } else {
    check($('first').value === 'ทดสอบ', 'Native text');
    check($('date').value === '2000-01-02', 'ISO date');
    check($('age').value === '26', 'Native number');
    check($('nationality').value === 'TH', 'Select by exact label, then native value');
    check($('dropdown').getAttribute('data-value') === 'ตัวเลือก ข', 'Custom dropdown read-back');
    check($('phone').value === '0000000000' && $('emergency').value === '0000000001', 'Own/emergency phones remain distinct');
    check($('email').value === 'regex-test@example.com', 'Email');
    check($('long-answer').value === 'ข้อมูลสมมติ\nสำหรับทดสอบ', 'Textarea');
  }
  expected.forEach((code, index) => check(lastReport?.[index]?.code === code, `Question ${index + 1} expected ${code}, got ${lastReport?.[index]?.code}`));
  $('assertions').textContent = failures.length ? `FAIL (${failures.length})\n${failures.join('\n')}` : `PASS — ${dryRun ? 'dry run' : 'fill'} assertions; Next=0; Submit=0`;
}
$('inspect').addEventListener('click', () => run(true));
$('fill').addEventListener('click', () => run(false));
$('assert').addEventListener('click', assertions);
$('reset').addEventListener('click', () => location.reload());
