import { FILE_DIAGNOSTICS, formatDateAnswer, LIMITS, normalizeLabel, normalizeShortcutOptions, NAVIGATION_STATUS, parseDateAnswer, parseRules, STATUS, validateRules } from './core.js';
import { activePreset, readPresetState, validatePresetName, validatePresetState } from './presets.js';
import { ruleFromDraft, ruleToDraft } from './rule-editor.js';
import { createFileReference, loadFile, saveRulesWithFiles } from './file-store.js';

const $ = id => document.getElementById(id);
$('extension-version').textContent = `เวอร์ชัน ${chrome.runtime.getManifest().version}`;
const builderFields = ['rule-mode', 'rule-source', 'rule-flags', 'answer-type', 'rule-answer', 'rule-date', 'date-input-calendar', 'date-text-calendar', 'date-text-format'];
const matchNames = { exact: 'ตรงกับชื่อคำถาม', contains: 'มีคำนี้ในชื่อคำถาม', regex: 'Regex' };
let savedText = '[]';
let savedRules = [];
let presetState;
let pendingState;
let pendingDeleteId = null;
let migrated = false;
let stale = false;
let shortcutOptions = normalizeShortcutOptions();
let loaded = false;
let busy = false;
let tabId;
let editingIndex = null;
let builderBaseline;
let rowButtons = [];
let questionCount = 0;
let draftFile = null;
let stagedFile = null;
const jsonDirty = () => $('rules').value !== savedText;
const readDraft = () => ({ mode: $('rule-mode').value, source: $('rule-source').value,
  flags: $('rule-flags').value, answerType: $('answer-type').value, answer: $('rule-answer').value,
  date: $('rule-date').value, inputCalendar: $('date-input-calendar').value, textCalendar: $('date-text-calendar').value,
  textFormat: $('date-text-format').value, file: draftFile });
const builderActive = () => editingIndex !== null || JSON.stringify(readDraft()) !== builderBaseline;
const canSwitch = () => loaded && !busy && pendingDeleteId === null && !stale && !jsonDirty() && !builderActive();

function resetBuilder() {
  editingIndex = null;
  setDraft({ mode: 'exact', source: '', flags: 'iu', answerType: 'single', answer: '' });
  $('question-select').value = '';
}
function setDraft(draft) {
  draftFile = draft.file ?? null;
  stagedFile = null;
  $('rule-file').value = '';
  $('file-status').textContent = '';
  if (draftFile) {
    const ref = draftFile;
    $('file-status').textContent = 'กำลังตรวจสำเนาไฟล์…';
    loadFile(ref).then(() => {
      if (draftFile === ref) $('file-status').textContent = 'มีสำเนาที่บันทึกแล้ว';
    }, () => {
      if (draftFile === ref) $('file-status').textContent = 'ไม่พบสำเนาที่ใช้ได้ · เลือกไฟล์ใหม่';
    });
  }
  for (const [id, key] of [['rule-mode', 'mode'], ['rule-source', 'source'], ['rule-flags', 'flags'], ['answer-type', 'answerType'], ['rule-answer', 'answer']]) $(id).value = draft[key];
  $('rule-date').value = draft.date ?? '';
  $('date-input-calendar').value = draft.inputCalendar ?? 'buddhist';
  $('date-text-calendar').value = draft.textCalendar ?? 'buddhist';
  $('date-text-format').value = draft.textFormat ?? 'numeric';
  builderBaseline = JSON.stringify(readDraft());
}
function updateState() {
  const builder = builderActive();
  const json = jsonDirty();
  const unavailable = !loaded || busy || pendingDeleteId !== null;
  $('preset-delete-confirmation').hidden = pendingDeleteId === null;
  $('preset-delete-confirm').disabled = pendingDeleteId === null || busy || stale || builder || json;
  $('preset-delete-cancel').disabled = pendingDeleteId === null;
  if (pendingDeleteId === null) $('preset-delete-warning').textContent = '';
  for (const id of ['preset-select', 'preset-name', 'preset-save', 'preset-rename', 'preset-delete']) $(id).disabled = unavailable || stale || builder || json;
  $('preset-delete').disabled ||= !presetState || presetState.presets.length <= 1;
  if (presetState) $('preset-select').value = presetState.activeId;
  $('auto-next').disabled = unavailable;
  $('allow-incomplete').disabled = unavailable || !$('auto-next').checked;
  $('saved-state').textContent = !loaded ? 'ยังไม่พร้อม' : builder || json ? 'ยังไม่บันทึก · ปิดแล้วจะหาย' : `บันทึกแล้ว · ${savedRules.length} กฎ`;
  $('saved-state').classList.toggle('dirty', builder || json);
  for (const id of ['save', 'import-text']) $(id).disabled = unavailable || stale || builder;
  $('rules').disabled = unavailable || builder;
  $('import-file').disabled = unavailable || stale || builder || json;
  $('export').disabled = unavailable;
  $('json-cancel').disabled = unavailable || !json;
  for (const id of [...builderFields, 'rule-file', 'rule-save']) $(id).disabled = unavailable || json;
  $('rule-save').disabled ||= stale;
  $('rule-cancel').disabled = unavailable || !builder;
  for (const id of ['inspect', 'fill']) $(id).disabled = unavailable || stale || builder || json;
  $('question-select').disabled = unavailable || stale || builder || json || !questionCount;
  for (const button of rowButtons) button.disabled = unavailable || stale || builder || json;
  $('builder-title').textContent = editingIndex === null ? 'เพิ่มกฎ' : `แก้ไขกฎ #${editingIndex + 1}`;
  $('rule-save').textContent = editingIndex === null ? 'เพิ่มและบันทึกกฎ' : 'บันทึกการแก้ไขกฎนี้';
  $('rule-cancel').textContent = editingIndex === null ? 'ยกเลิกร่าง' : 'ยกเลิกการแก้ไข';
  const regex = $('rule-mode').value === 'regex';
  $('flags-field').hidden = !regex;
  $('source-label').textContent = regex ? 'Regex source' : 'ชื่อคำถามหรือคำที่ต้องการจับคู่';
  $('source-help').textContent = regex ? 'ใส่ regex โดยไม่ใส่ / ครอบ · กฎนำเข้าเดิมจะคง source และ flags ไว้' :
    $('rule-mode').value === 'contains' ? 'พิมพ์คำธรรมดา · คำนี้อาจตรงหลายข้อ เช่น เบอร์โทรศัพท์อาจรวมเบอร์ฉุกเฉิน' :
      'พิมพ์ชื่อทั้งข้อได้เลย ไม่ต้องใส่เลขข้อหรือ * · เครื่องหมายพิเศษถือเป็นข้อความธรรมดา';
  $('answer-help').textContent = $('answer-type').value === 'multiple' ? 'สำหรับ checkbox: หนึ่งตัวเลือกต่อบรรทัด ข้ามบรรทัดว่าง และห้ามซ้ำ' : 'ข้อความตามที่พิมพ์ รวมการขึ้นบรรทัดใหม่ได้ · ตัวเลือกให้พิมพ์ตรงกับฟอร์ม · หากต้องการแปลงปี ให้เลือก “วันเกิด / วันที่”';
  const date = $('answer-type').value === 'date';
  const file = $('answer-type').value === 'file';
  $('answer-field').hidden = date || file;
  $('date-fields').hidden = !date;
  $('file-fields').hidden = !file;
  $('file-summary').textContent = draftFile ? `${draftFile.name} · ${draftFile.size.toLocaleString()} bytes${stagedFile ? ' · ยังไม่บันทึก' : ''}` : 'ยังไม่ได้เลือกไฟล์';
  $('date-preview').textContent = '';
  $('date-preview').classList.toggle('error', false);
  if (date) {
    try {
      const value = parseDateAnswer($('rule-date').value, $('date-input-calendar').value, $('date-text-calendar').value, $('date-text-format').value);
      $('date-preview').textContent = dateSummary(value);
    } catch (error) {
      $('date-preview').textContent = error.message;
      $('date-preview').classList.toggle('error', true);
    }
  }
  $('draft-help').textContent = builder ? 'บันทึกกฎนี้หรือกดยกเลิกก่อนเลือกกฎอื่น จัดการชุดกฎ อ่าน/กรอกฟอร์ม หรือแก้ JSON · คีย์ลัดยังใช้กฎที่บันทึกไว้' :
    json ? 'บันทึก JSON หรือกด “ยกเลิกแก้ JSON” ก่อนจัดการชุดกฎ ใช้ตัวช่วย หรือนำเข้าไฟล์ · คีย์ลัดยังใช้กฎที่บันทึกไว้' : '';
}
function message(value, error = false, id = 'message') {
  $(id).textContent = value;
  $(id).classList.toggle('error', error);
}
function dateSummary(value) {
  return `ช่องวันที่ → ${value.iso} (ค.ศ. ISO) · ช่องข้อความ → ${formatDateAnswer(value)} (${value.textCalendar === 'buddhist' ? 'พ.ศ.' : 'ค.ศ.'})`;
}
function renderRules() {
  $('rule-list').replaceChildren();
  rowButtons = [];
  $('empty-rules').hidden = savedRules.length !== 0;
  savedRules.forEach((rule, index) => {
    const draft = ruleToDraft(rule);
    const item = document.createElement('li');
    const description = document.createElement('div');
    description.className = 'rule-description';
    const condition = document.createElement('strong');
    condition.textContent = `#${index + 1} · ${matchNames[draft.mode]}: ${draft.source}${draft.mode === 'regex' ? ` (flags: ${rule.flags || 'ว่าง'})` : ''}`;
    const value = document.createElement('span');
    const preview = rule.value?.type === 'file' ? `${rule.value.name} · ${rule.value.size.toLocaleString()} bytes · สำเนาในเครื่อง` : rule.value?.type === 'date' ? dateSummary(rule.value) : Array.isArray(rule.value) ? rule.value.join(' · ') : rule.value;
    value.textContent = preview ? `${Array.isArray(rule.value) ? `${rule.value.length} ตัวเลือก: ` : 'คำตอบ: '}${preview.slice(0, 160)}${preview.length > 160 ? '…' : ''}` : 'คำตอบ: (ข้อความว่าง)';
    if (rule.value?.type === 'file') void loadFile(rule.value).catch(() => { value.textContent += ' · เลือกไฟล์ใหม่'; });
    description.append(condition, value);
    const edit = document.createElement('button');
    edit.textContent = 'แก้ไข';
    edit.setAttribute('aria-label', `แก้ไขกฎ ${index + 1}`);
    edit.addEventListener('click', () => {
      if (!canSwitch()) return;
      editingIndex = index;
      setDraft(ruleToDraft(savedRules[index]));
      updateState();
      message('แก้ไขแล้วกด “บันทึกการแก้ไขกฎนี้”');
      $('rule-source').focus();
    });
    const remove = document.createElement('button');
    remove.textContent = 'ลบ';
    remove.setAttribute('aria-label', `ลบกฎ ${index + 1}`);
    remove.addEventListener('click', async () => {
      if (!canSwitch()) return;
      try {
        const cleanupFailed = await commit(savedRules.filter((_, position) => position !== index));
        message(`ลบกฎ #${index + 1} แล้ว กฎอื่นยังอยู่${cleanupFailed ? ' · ลบสำเนาเก่าไม่ได้ ยังเก็บไว้ในเครื่อง' : ''}`);
        $('rule-source').focus();
      } catch (error) { message(`${error.message} · กฎเดิมยังอยู่`, true); }
    });
    rowButtons.push(edit, remove);
    item.append(description, edit, remove);
    $('rule-list').append(item);
  });
}
function showPreset() {
  savedRules = activePreset(presetState).rules;
  savedText = JSON.stringify(savedRules, null, 2);
  $('rules').value = savedText;
  $('preset-select').replaceChildren();
  for (const preset of presetState.presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    $('preset-select').append(option);
  }
  $('preset-select').value = presetState.activeId;
  $('preset-name').value = activePreset(presetState).name;
  resetBuilder();
  renderRules();
}
function markStale() {
  stale = true;
  pendingDeleteId = null;
  message('ชุดกฎเปลี่ยนจากหน้าต่างอื่น · ร่างในหน้านี้ยังอยู่ คัดลอกร่างที่ต้องการเก็บก่อนเปิด popup ใหม่เพื่อโหลดข้อมูลล่าสุด', true, 'preset-status');
  updateState();
}
async function checkFresh() {
  const stored = await chrome.storage.local.get(['presetState', 'rules']);
  let current;
  try { current = readPresetState(stored); }
  catch (error) { markStale(); throw error; }
  if (stale || JSON.stringify(current) !== JSON.stringify(presetState)) {
    markStale();
    throw new Error('ชุดกฎเปลี่ยนจากหน้าต่างอื่น · เปิด popup ใหม่ก่อนบันทึก');
  }
}
async function persistPreset(input, staged, statusId) {
  const next = validatePresetState(input);
  busy = true;
  updateState();
  try {
    // Serialize the re-read, write and blob cleanup across popup windows on this origin.
    return await navigator.locks.request('regex-form-filler-presets', async () => {
      await checkFresh();
      pendingState = next;
      const { cleanupFailed } = await saveRulesWithFiles(
        presetState.presets.flatMap(preset => preset.rules), activePreset(next).rules, staged,
        () => chrome.storage.local.set({ presetState: next }),
        next.presets.filter(preset => preset.id !== next.activeId).flatMap(preset => preset.rules));
      presetState = next;
      migrated = true;
      showPreset();
      if (!stale || statusId === 'message') message(`บันทึกแล้ว ปุ่มและคีย์ลัดจะใช้ชุด “${activePreset(next).name}”${cleanupFailed ? ' · ลบสำเนาเก่าไม่ได้ ยังเก็บไว้ในเครื่อง' : ''}`, false, statusId);
      return cleanupFailed;
    });
  } finally { pendingState = undefined; busy = false; updateState(); }
}
async function commit(input, staged = null) {
  const rules = validateRules(input);
  return persistPreset({ ...presetState, presets: presetState.presets.map(preset =>
    preset.id === presetState.activeId ? { ...preset, rules } : preset) }, staged, 'message');
}
async function changePreset(action) {
  const selectedId = $('preset-select').value;
  if (action === 'confirm-delete') {
    if (pendingDeleteId === null || pendingDeleteId !== presetState?.activeId || busy) return;
    pendingDeleteId = null;
  }
  if (!canSwitch()) { updateState(); return; }
  try {
    const next = structuredClone(presetState);
    const current = activePreset(next);
    if (action === 'select') next.activeId = selectedId;
    else if (action === 'delete' || action === 'confirm-delete') {
      if (next.presets.length <= 1) return;
      if (action === 'delete') {
        pendingDeleteId = current.id;
        message('', false, 'preset-status');
        $('preset-delete-warning').textContent = `ลบชุด “${current.name}” และกฎทั้งหมดในชุดนี้? สำเนาไฟล์ที่ไม่มีชุดอื่นใช้จะถูกลบด้วย · ย้อนกลับไม่ได้`;
        updateState();
        $('preset-delete-cancel').focus();
        return;
      }
      next.presets = next.presets.filter(preset => preset.id !== current.id);
      next.activeId = next.presets[0].id;
    } else {
      const name = validatePresetName($('preset-name').value);
      if (action === 'rename') current.name = name;
      else {
        next.activeId = crypto.randomUUID();
        next.presets.push({ id: next.activeId, name, rules: current.rules });
      }
    }
    await persistPreset(next, null, 'preset-status');
    if (action === 'confirm-delete' && !stale) $('preset-select').focus();
  } catch (error) {
    if (!stale) message(`${error.message} · ชุดกฎเดิมยังอยู่`, true, 'preset-status');
  }
  finally { updateState(); }
}
$('preset-select').addEventListener('change', () => changePreset('select'));
for (const [id, action] of [['preset-save', 'save'], ['preset-rename', 'rename'], ['preset-delete', 'delete'], ['preset-delete-confirm', 'confirm-delete']]) {
  $(id).addEventListener('click', () => changePreset(action));
}
$('preset-delete-cancel').addEventListener('click', () => {
  if (pendingDeleteId === null) return;
  pendingDeleteId = null;
  updateState();
  $('preset-delete').focus();
});
async function saveEditor() {
  if (!loaded || busy || pendingDeleteId !== null || stale || builderActive()) return;
  try { await commit(parseRules($('rules').value)); }
  catch (error) { message(`${error.message} · กฎเดิมยังอยู่`, true); }
}
function renderReport(report) {
  if (!report) return;
  $('results').replaceChildren();
  $('navigation-result').textContent = report.navigation ? NAVIGATION_STATUS[report.navigation.code] || NAVIGATION_STATUS.error : '';
  $('run-time').textContent = [report.time ? new Date(report.time).toLocaleString('th-TH') : '', report.version ? `เวอร์ชันที่รัน ${report.version}` : ''].filter(Boolean).join(' · ');
  $('summary').classList.toggle('error', !report.ok);
  if (!report.ok) { $('summary').textContent = report.error; return; }
  const count = report.rows.filter(row => row.code === (report.dryRun ? 'ready' : 'filled')).length;
  $('summary').textContent = `${report.dryRun ? 'ตรวจอย่างเดียว — พร้อมกรอก' : 'กรอกและตรวจค่าแล้ว'} ${count}/${report.rows.length} ข้อ${report.dryRun ? ' · ยังไม่เปลี่ยนคำตอบ' : ''}`;
  for (const row of report.rows) {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const detail = document.createElement('span');
    label.textContent = row.label;
    detail.textContent = `${row.rules.length ? `กฎ ${row.rules.map(index => `#${index + 1}`).join(', ')}` : '—'} · ${STATUS[row.code] || row.code}`;
    if (typeof row.diagnostic === 'string' && Object.hasOwn(FILE_DIAGNOSTICS, row.diagnostic)) detail.textContent += ` · ${FILE_DIAGNOSTICS[row.diagnostic]} (${row.diagnostic})`;
    if (!['filled', 'ready', 'preserved', 'unmatched'].includes(row.code)) detail.className = 'attention';
    item.append(label, detail);
    $('results').append(item);
  }
}
function showQuestions(report) {
  const labels = report.ok ? [...new Set(report.rows.map(row => normalizeLabel(row.label)).filter(Boolean))] : [];
  questionCount = labels.length;
  $('question-select').replaceChildren();
  for (const label of ['', ...labels]) {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label || (labels.length ? 'เลือกคำถามเพื่อเพิ่มกฎ…' : 'ยังอ่านคำถามไม่ได้ — พิมพ์ชื่อด้านล่างได้');
    $('question-select').append(option);
  }
  $('question-select').value = '';
  $('question-help').textContent = labels.length ? `อ่านได้ ${labels.length} ชื่อจากหน้าปัจจุบัน · เปลี่ยนหน้าหรือส่วนของฟอร์มแล้วให้อ่านใหม่` : 'ไม่พบคำถามที่อ่านได้ในหน้านี้ ให้พิมพ์ชื่อเอง หรือเปิดหน้าสำหรับตอบ Google Forms แล้วอ่านใหม่';
}
async function run(dryRun) {
  if (!canSwitch()) return;
  busy = true;
  updateState();
  message(dryRun ? 'กำลังอ่านและตรวจชื่อคำถาม…' : 'กำลังตรวจและกรอก…');
  try {
    await checkFresh();
    const report = await chrome.runtime.sendMessage({ type: 'run', dryRun });
    renderReport(report);
    if (dryRun) showQuestions(report);
    message(report.ok ? dryRun ? 'อ่านแล้ว เลือกคำถามเพื่อเพิ่มกฎ หรือดูผลการจับคู่ด้านล่าง' : 'ดูผลแต่ละข้อด้านล่าง' : report.error, !report.ok);
  } catch (error) {
    if (dryRun) showQuestions({ ok: false });
    message(stale ? error.message : 'ติดต่อส่วนขยายไม่ได้ โปรดเปิดหน้าต่างนี้ใหม่ หรือพิมพ์ชื่อคำถามเอง', true);
  } finally { busy = false; updateState(); }
}

for (const id of ['auto-next', 'allow-incomplete']) $(id).addEventListener('change', async () => {
  if (!loaded || busy || pendingDeleteId !== null || id === 'allow-incomplete' && !shortcutOptions.autoNext) return;
  const next = normalizeShortcutOptions({ autoNext: $('auto-next').checked, allowIncomplete: $('allow-incomplete').checked });
  busy = true;
  updateState();
  try {
    await chrome.storage.local.set({ shortcutOptions: next });
    shortcutOptions = next;
    $('shortcut-status').textContent = 'บันทึกการตั้งค่าคีย์ลัดแล้ว';
    $('shortcut-status').classList.toggle('error', false);
  } catch {
    $('shortcut-status').textContent = 'บันทึกการตั้งค่าไม่สำเร็จ · คืนค่าเดิมแล้ว';
    $('shortcut-status').classList.toggle('error', true);
  } finally {
    $('auto-next').checked = shortcutOptions.autoNext;
    $('allow-incomplete').checked = shortcutOptions.allowIncomplete;
    busy = false;
    updateState();
  }
});

for (const id of builderFields) $(id).addEventListener(['rule-mode', 'answer-type', 'date-input-calendar', 'date-text-calendar', 'date-text-format'].includes(id) ? 'change' : 'input', () => { updateState(); message(''); });
$('rule-file').addEventListener('change', () => {
  if (!loaded || busy || pendingDeleteId !== null || jsonDirty()) return;
  const file = $('rule-file').files[0];
  if (!file) return; // Cancelling the native chooser retains the current draft/reference.
  try {
    const ref = createFileReference(file);
    draftFile = ref;
    stagedFile = { ref, blob: file };
    $('file-status').textContent = 'บันทึกกฎเพื่อเก็บสำเนาไฟล์';
    updateState(); message('');
  } catch (error) { message(error.message, true); }
  finally { $('rule-file').value = ''; }
});
$('rule-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!loaded || busy || pendingDeleteId !== null || stale || jsonDirty()) return;
  try {
    const original = editingIndex === null ? undefined : savedRules[editingIndex];
    const draft = readDraft();
    const baseline = JSON.parse(builderBaseline);
    // Textareas normalize line endings; unchanged fields must retain their stored bytes.
    if (original && ['mode', 'source', 'flags'].every(key => draft[key] === baseline[key])) {
      draft.mode = 'regex'; draft.source = original.pattern; draft.flags = original.flags;
    }
    if (original && draft.answerType === baseline.answerType && draft.answer === baseline.answer) draft.answer = ruleToDraft(original).answer;
    const rule = ruleFromDraft(draft, original);
    const changedMatch = !original || original.pattern !== rule.pattern || original.flags !== rule.flags;
    if (changedMatch && savedRules.some((other, index) => index !== editingIndex && other.pattern === rule.pattern && other.flags === rule.flags)) throw new Error('มีกฎชื่อ/รูปแบบและ flags นี้ซ้ำแล้ว ให้แก้ไขกฎเดิม');
    const next = [...savedRules];
    if (editingIndex === null) next.push(rule);
    else next[editingIndex] = rule;
    await commit(next, draft.answerType === 'file' ? stagedFile : null);
    $('rule-source').focus();
  } catch (error) { message(`${error.message} · กฎเดิมยังอยู่`, true); }
});
$('rule-cancel').addEventListener('click', () => {
  if (!loaded || busy || pendingDeleteId !== null) return;
  resetBuilder(); updateState(); message('ยกเลิกร่างแล้ว กฎที่บันทึกยังอยู่'); $('rule-source').focus();
});
$('question-select').addEventListener('change', () => {
  if (!canSwitch() || !$('question-select').value) return;
  $('rule-source').value = normalizeLabel($('question-select').value);
  $('rule-mode').value = 'exact';
  updateState(); message('ใส่คำตอบ แล้วกด “เพิ่มและบันทึกกฎ”'); $('rule-answer').focus();
});
$('rules').addEventListener('input', () => { updateState(); message(jsonDirty() ? 'มี JSON ที่ยังไม่บันทึก คีย์ลัดยังใช้กฎเดิม' : ''); });
$('json-cancel').addEventListener('click', () => {
  if (!loaded || busy || pendingDeleteId !== null || builderActive()) return;
  $('rules').value = savedText; updateState(); message('ยกเลิกแก้ JSON แล้ว'); $('rules').focus();
});
$('save').addEventListener('click', saveEditor);
$('import-text').addEventListener('click', saveEditor);
$('import-file').addEventListener('click', () => { if (canSwitch()) $('file').click(); });
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file || !canSwitch()) { $('file').value = ''; return; }
  busy = true;
  updateState();
  try {
    if (file.size > LIMITS.json) throw new Error('ไฟล์ใหญ่เกิน 256 KiB');
    await commit(parseRules(await file.text()));
  } catch (error) { message(`${error.message} · กฎเดิมยังอยู่`, true); }
  finally { $('file').value = ''; busy = false; updateState(); }
});
$('export').addEventListener('click', () => {
  if (!loaded || busy || pendingDeleteId !== null) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedRules, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'regex-form-filler-rules.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('ส่งออกกฎที่บันทึกของชุดที่เลือกแล้ว ไฟล์นี้มีคำตอบ โปรดเก็บอย่างเหมาะสม');
});
$('inspect').addEventListener('click', () => run(true));
$('fill').addEventListener('click', () => run(false));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && loaded && (changes.presetState || !migrated && changes.rules)) {
    try {
      const current = readPresetState(changes.presetState ? { presetState: changes.presetState.newValue } : { rules: changes.rules.newValue });
      if (![presetState, pendingState].some(state => state && JSON.stringify(state) === JSON.stringify(current))) markStale();
    } catch { markStale(); }
  }
  if (area === 'session' && changes[`report-${tabId}`]) renderReport(changes[`report-${tabId}`].newValue);
});

resetBuilder();
updateState();
try {
  const [stored, commands, tabs] = await Promise.all([
    chrome.storage.local.get(['presetState', 'rules', 'shortcutOptions']), chrome.commands.getAll(), chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  presetState = readPresetState(stored);
  migrated = Object.hasOwn(stored, 'presetState');
  shortcutOptions = normalizeShortcutOptions(stored.shortcutOptions);
  $('auto-next').checked = shortcutOptions.autoNext;
  $('allow-incomplete').checked = shortcutOptions.allowIncomplete;
  tabId = tabs[0]?.id;
  const shortcut = commands.find(command => command.name === 'fill-form')?.shortcut;
  $('shortcut').textContent = shortcut || 'ยังไม่ได้กำหนด';
  $('shortcut-warning').hidden = !!shortcut;
  showPreset();
  loaded = true;
  updateState();
  if (tabId) renderReport((await chrome.storage.session.get(`report-${tabId}`))[`report-${tabId}`]);
} catch (error) { message(`โหลดข้อมูลส่วนขยายไม่ได้ · ${error.message} · ยังไม่เขียนทับข้อมูลเดิม โปรดลองเปิดใหม่`, true); }
