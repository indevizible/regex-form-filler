export function checkDateFixture({ expected, before, after, rows, dryRun, counters, events }) {
  const failures = [];
  const check = (condition, name) => { if (!condition) failures.push(name); };
  check(Object.keys(rows).length === Object.keys(expected).length, 'จำนวนคำถามไม่ตรง');
  let fills = 0;
  for (const [id, spec] of Object.entries(expected)) {
    const code = spec.code === 'filled' ? before[id] !== '' ? 'preserved' : dryRun ? 'ready' : 'filled' : spec.code;
    if (code === 'filled') fills++;
    check(rows[id] === code, `${id}: คาดว่า ${code}, ได้ ${rows[id]}`);
    check(after[id] === (dryRun ? before[id] : spec.value), `${id}: ค่าไม่ตรง / ถูกเปลี่ยนระหว่างตรวจ`);
  }
  check(counters.next === 0 && counters.submit === 0, 'ต้องไม่กด Next / Submit');
  check(events.input === fills && events.change === fills, 'จำนวน input/change ไม่ตรง (ตรวจอย่างเดียวต้องเป็น 0)');
  check(events.click === 0, 'ต้องไม่คลิกตัวเลือก');
  return failures;
}
