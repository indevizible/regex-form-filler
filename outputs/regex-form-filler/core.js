export const LIMITS = Object.freeze({ rules: 100, json: 262144, pattern: 512, value: 8192, labels: 200, label: 2000, file: 10 * 1024 * 1024, payload: 20 * 1024 * 1024 });

export function validateFileReference(value) {
  const keys = ['type', 'fileId', 'name', 'size', 'mime'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !keys.every(key => Object.hasOwn(value, key)) || Reflect.ownKeys(value).some(key => !keys.includes(key)) ||
      value.type !== 'file' || typeof value.fileId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.fileId) ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/u.test(value.name) || ['.', '..'].includes(value.name) ||
      !Number.isSafeInteger(value.size) || value.size < 0 || value.size > LIMITS.file ||
      typeof value.mime !== 'string' || value.mime.length > 127 ||
      value.mime !== '' && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value.mime)) {
    throw new Error('ข้อมูลไฟล์ไม่ถูกต้อง · หนึ่งไฟล์ไม่เกิน 10 MiB · เลือกไฟล์ใหม่');
  }
  return { type: 'file', fileId: value.fileId, name: value.name, size: value.size, mime: value.mime };
}

export function normalizeLabel(label) {
  return label.normalize('NFC').replace(/\s+/gu, ' ').trim()
    .replace(/\s*\*+$/u, '').trim()
    .replace(/^[0-9๐-๙]+[.)]\s+(?=\S)/u, '').trim();
}

export function isFormUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && !url.port &&
      /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+\/(?:viewform|formResponse|preview|previewResponse)\/?$/u.test(url.pathname);
  } catch { return false; }
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateDateAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['type', 'iso', 'textCalendar'].every(key => Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => !['type', 'iso', 'textCalendar', 'textFormat'].includes(key)) || value.type !== 'date' ||
      typeof value.iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.iso)) {
    throw new Error('วันที่ต้องมี type: "date", iso: "YYYY-MM-DD" (ค.ศ.) และ textCalendar โดยเพิ่มได้เฉพาะ textFormat');
  }
  if (!['buddhist', 'gregorian'].includes(value.textCalendar)) throw new Error('textCalendar ต้องเป็น buddhist (พ.ศ.) หรือ gregorian (ค.ศ.)');
  const hasFormat = Object.hasOwn(value, 'textFormat');
  if (hasFormat && !['numeric', 'thai-long', 'thai-short'].includes(value.textFormat)) throw new Error('textFormat ต้องเป็น numeric, thai-long หรือ thai-short');
  const [year, month, day] = value.iso.split('-').map(Number);
  if (year < 1 || year > 9456) throw new Error('ปีต้องอยู่ในช่วง ค.ศ. 0001–9456 (พ.ศ. 0544–9999)');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error('วันที่ไม่มีอยู่จริง โปรดตรวจวัน เดือน และปี');
  return { type: 'date', iso: value.iso, textCalendar: value.textCalendar, ...(hasFormat ? { textFormat: value.textFormat } : {}) };
}

export function parseDateAnswer(input, inputCalendar, textCalendar, textFormat) {
  if (!['buddhist', 'gregorian'].includes(inputCalendar)) throw new Error('เลือกปีที่ป้อนเป็น พ.ศ. หรือ ค.ศ.');
  if (typeof input !== 'string' || !/^\d{1,2}\/\d{1,2}\/\d{4}$/u.test(input)) throw new Error('กรอกวันที่ DD/MM/YYYY ด้วยเลข 0–9 เช่น 29/02/2543');
  const [day, month, enteredYear] = input.split('/').map(Number);
  const year = enteredYear - (inputCalendar === 'buddhist' ? 543 : 0);
  if (year < 1 || year > 9456) throw new Error('ปีต้องอยู่ในช่วง ค.ศ. 0001–9456 (พ.ศ. 0544–9999)');
  return validateDateAnswer({ type: 'date', iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, textCalendar,
    ...(textFormat === undefined ? {} : { textFormat }) });
}

export function formatDateAnswer(value) {
  const { iso, textCalendar, textFormat = 'numeric' } = validateDateAnswer(value);
  const [year, month, day] = iso.split('-');
  const textYear = Number(year) + (textCalendar === 'buddhist' ? 543 : 0);
  if (textFormat === 'numeric') return `${day}/${month}/${String(textYear).padStart(4, '0')}`;
  const months = textFormat === 'thai-long' ?
    ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'] :
    ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${Number(day)} ${months[Number(month) - 1]} ${textYear}`;
}

export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > LIMITS.rules) throw new Error('ต้องเป็นอาร์เรย์กฎ ไม่เกิน 100 กฎ');
  const result = rules.map((rule, index) => {
    const fail = message => { throw new Error(`กฎ ${index + 1}: ${message}`); };
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
        Object.keys(rule).some(key => !['pattern', 'flags', 'value'].includes(key))) fail('ใช้เฉพาะ pattern, flags และ value');
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim() || rule.pattern.length > LIMITS.pattern) fail('pattern ต้องเป็นข้อความ 1–512 ตัวอักษร');
    const flags = rule.flags === undefined ? 'iu' : rule.flags;
    if (typeof flags !== 'string' || !/^[imsu]*$/u.test(flags) || new Set(flags).size !== flags.length) fail('flags ใช้ i m s u อย่างละไม่เกินหนึ่งครั้ง (ไม่ใช้ g/y)');
    try { new RegExp(rule.pattern, flags); } catch { fail('รูปแบบ regex ไม่ถูกต้อง'); }
    const validValue = value => typeof value === 'string' && value.length <= LIMITS.value;
    let value = rule.value;
    if (Array.isArray(rule.value)) {
      if (!rule.value.length || rule.value.length > 50 || !rule.value.every(value => validValue(value) && value.trim()) ||
          new Set(rule.value).size !== rule.value.length) fail('checkbox ใช้อาร์เรย์ข้อความที่ไม่ว่างและไม่ซ้ำ สูงสุด 50 ตัวเลือก');
      value = [...rule.value];
    } else if (value && typeof value === 'object') {
      try { value = value.type === 'file' ? validateFileReference(value) : validateDateAnswer(value); } catch (error) { fail(error.message); }
    } else if (!validValue(value)) fail('value ต้องเป็นข้อความ ไม่เกิน 8192 ตัวอักษร อาร์เรย์สำหรับ checkbox หรือวันที่ {type, iso, textCalendar}');
    return { pattern: rule.pattern, flags, value };
  });
  if (JSON.stringify(result).length > LIMITS.json) throw new Error('ข้อมูลกฎใหญ่เกิน 256 KiB');
  return result;
}

export function parseRules(text) {
  if (typeof text !== 'string' || text.length > LIMITS.json) throw new Error('JSON ใหญ่เกิน 256 KiB');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('JSON ไม่ถูกต้อง ตรวจเครื่องหมายคำพูด จุลภาค และวงเล็บ'); }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = Object.entries(value).map(([keyword, answer]) => {
      const label = normalizeLabel(keyword);
      if (!label) throw new Error('ชื่อคำถามในข้อมูลแบบเก่าต้องไม่ว่าง');
      const suffix = label === 'โรคประจำตัว' ? '(?:\\s*\\([^\\r\\n]*\\))?' : '';
      return { pattern: `^${escapeRegex(label)}${suffix}$`, flags: 'iu', value: answer };
    });
  }
  return validateRules(value);
}

// Call only inside regex-worker.js: user regex must never execute on a DOM thread.
export function matchLabels(rules, labels) {
  if (!Array.isArray(labels) || labels.length > LIMITS.labels ||
      labels.some(label => typeof label !== 'string' || label.length > LIMITS.label)) throw new Error('ชื่อคำถามมีจำนวนหรือความยาวเกินขีดจำกัด');
  const compiled = validateRules(rules).map(rule => new RegExp(rule.pattern, rule.flags));
  return labels.map(label => {
    const normalized = normalizeLabel(label);
    return compiled.flatMap((regex, index) => regex.test(normalized) ? [index] : []);
  });
}

export const STATUS = Object.freeze({
  filled: 'กรอกและตรวจค่าแล้ว', ready: 'พร้อมกรอก', preserved: 'เก็บคำตอบเดิม',
  unmatched: 'ไม่มีกฎตรงกัน', ambiguous: 'หลายกฎตรงกัน — ข้าม', unsupported: 'ต้องกรอกเอง / ไม่รองรับ',
  blocked: 'ซ่อนอยู่ / ปิดใช้งาน / อ่านอย่างเดียว', missing: 'ไม่พบตัวเลือกที่ตรงกันเพียงหนึ่งตัว',
  invalid: 'ค่าไม่ตรงชนิดหรือเงื่อนไขของช่อง', mismatch: 'ตรวจค่าหลังกรอกไม่ผ่าน — ตรวจช่องนี้',
  stale: 'คำถามเปลี่ยนระหว่างทำงาน — ลองใหม่', error: 'กรอกไม่สำเร็จ — ตรวจช่องนี้',
  'file-missing': 'ไม่พบสำเนาไฟล์ที่ถูกต้อง — เลือกไฟล์ใหม่',
  'file-manual': 'อัปโหลดอัตโนมัติไม่ได้ — ตรวจและเลือกไฟล์เอง · ไม่กด Next',
  pending: 'ยังยืนยันไฟล์แนบไม่ได้ — ตรวจ picker/คำถามเองก่อนลองใหม่ · ไม่กด Next',
  timeout: 'หยุดเมื่อครบเวลาทำงาน — ตรวจช่องนี้ก่อนลองใหม่'
});

// Fixed codes only: never include page text, filenames, URLs or exception details.
export const FILE_DIAGNOSTICS = Object.freeze({
  'file-preflight': 'หยุดระหว่างตรวจคำถามก่อนเริ่มอัปโหลด',
  'file-data': 'หยุดระหว่างเตรียมสำเนาไฟล์',
  'picker-discovery': 'หยุดระหว่างเปิดหรือตรวจความพร้อมของ picker',
  'picker-discovery-timeout': 'ครบเวลาค้นหา picker ที่โหลดพร้อม — ยังไม่ได้ส่งไฟล์',
  'picker-settling-timeout': 'ครบเวลารอ picker นิ่งก่อนส่งไฟล์ — ยังไม่ได้ส่งไฟล์',
  'picker-initialization-not-observed': 'ไม่พบการเปลี่ยนช่องไฟล์ระหว่างเริ่ม picker ภายในเวลาที่กำหนด — ยังไม่ได้ส่งไฟล์ · เลือกไฟล์เอง',
  'file-handoff': 'หยุดระหว่างตรวจหรือส่งไฟล์ให้ picker',
  'upload-completion': 'เกิดข้อผิดพลาดระหว่างรอยืนยันไฟล์แนบ',
  'unexpected-ui': 'พบหน้าต่างหรือเฟรมอื่นระหว่างรอยืนยัน',
  'picker-document-changed': 'เอกสารของ picker เปลี่ยนหรือไม่พร้อม',
  'picker-ui-changed': 'หน้าต่าง picker เปลี่ยนหรือปิดไม่ครบ',
  'owner-form-changed': 'คำถามหรือฟอร์มเดิมเปลี่ยนหรือไม่พร้อม',
  'selection-not-exact': 'รายการแนบยังไม่ยืนยันชื่อไฟล์ตรงทั้งชื่อ',
  'close-grace-expired': 'ฟอร์มหรือไฟล์แนบยังไม่พร้อมภายใน 5 วินาทีหลังปิด picker',
  'overall-timeout': 'ครบเวลารอไฟล์หรือเวลาทำงานรวม',
  'previous-unconfirmed': 'ข้ามไฟล์นี้เพราะไฟล์ก่อนหน้ายังยืนยันไม่ได้'
});


export function normalizeShortcutOptions(value) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { autoNext: options.autoNext === true, allowIncomplete: options.allowIncomplete === true };
}

export const NAVIGATION_STATUS = Object.freeze({
  attempted: 'ลองกด Next แล้ว 1 ครั้ง · ฟอร์มอาจยังไม่เปลี่ยนหน้าหากตรวจคำตอบไม่ผ่าน',
  incomplete: 'ยังกรอกไม่ครบหรือมีช่องที่ตรวจไม่ได้ · ไม่กด Next',
  'no-next': 'ไม่พบปุ่ม Next / ถัดไปที่ใช้ได้ · ไม่กดส่ง',
  disabled: 'ปุ่ม Next ปิดใช้งาน · ไม่กด',
  ambiguous: 'พบปุ่ม Next หลายปุ่ม · ไม่กด',
  stale: 'หน้า/คำถามเปลี่ยนหรือการกรอกไม่สมบูรณ์ · ไม่กด Next โปรดลองใหม่',
  pending: 'มีหน้าต่างเลือกไฟล์หรือกำลังอัปโหลด · ไม่กด Next',
  error: 'ตรวจหรือกด Next ไม่สำเร็จ · ไม่ลองซ้ำ'
});
