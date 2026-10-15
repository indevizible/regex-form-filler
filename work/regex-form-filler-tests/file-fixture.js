import { formDOM } from '../../outputs/regex-form-filler/form-dom.js';
import { matchWithTimeout } from '../../outputs/regex-form-filler/matcher.js';
import { createFileReference, loadFile, prepareFiles, saveRulesWithFiles } from '../../outputs/regex-form-filler/file-store.js';
import { validateRules } from '../../outputs/regex-form-filler/core.js';

const $ = id => document.getElementById(id);
const key = 'regex-form-filler-synthetic-file-fixture-v1.5';
let rules = validateRules(JSON.parse(localStorage.getItem(key) || '[]'));
let draft, activeList, restoreTimer, running = false;
const twoQuestions = () => ['two-files', 'inner-progress-two', 'settling-two', 'removed-tombstone'].includes($('scenario').value) || $('scenario').value.startsWith('sequence-');
let lastFrame, diagnosticTimer, diagnosticStart, diagnosticTick, diagnosticPolls = 0, diagnosticGap = 0, fixturePhase = 'idle';
// Fixture-only observations of our own iframe DOM; never read file contents or picker query parameters.
export function readPickerDiagnostics(frame) {
  if (!frame) return { iframe: 'not created' };
  const base = value => { const url = new URL(value); return url.origin + url.pathname; };
  const describe = node => {
    const rects = [...node.getClientRects()];
    const parentCSS = getComputedStyle(node);
    const ownCSS = node.ownerDocument.defaultView.getComputedStyle(node);
    const checked = node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? null;
    const hiddenAncestor = !!node.closest('[hidden], [aria-hidden="true"], [inert]');
    return { rects: rects.length, size: rects.length ? `${Math.round(rects[0].width)}x${Math.round(rects[0].height)}` : '0x0',
      checkVisibility: checked, hiddenAncestor,
      parentCSS: `${parentCSS.display}/${parentCSS.visibility}/${parentCSS.opacity}`,
      ownCSS: `${ownCSS.display}/${ownCSS.visibility}/${ownCSS.opacity}`,
      shippingVisible: !!rects.length && checked !== false && !hiddenAncestor && !['hidden', 'collapse'].includes(parentCSS.visibility) && parentCSS.display !== 'none' };
  };
  const report = { sourceURL: base(frame.src), frame: describe(frame) };
  try {
    const doc = frame.contentDocument;
    report.contentDocument = !!doc;
    if (!doc) return report;
    Object.assign(report, { actualURL: base(doc.URL), readyState: doc.readyState, visibilityState: doc.visibilityState,
      module: doc.getElementById('module-marker')?.textContent || 'marker absent',
      File: typeof doc.defaultView?.File, DataTransfer: typeof doc.defaultView?.DataTransfer });
    report.dialogs = [...doc.querySelectorAll('[role="dialog"]')].map(node => ({ name: node.getAttribute('aria-label') ||
      (node.getAttribute('aria-labelledby') || '').split(/\s+/u).map(id => doc.getElementById(id)?.textContent || '').join(' '), ...describe(node) }));
    report.inputs = [...doc.querySelectorAll('input[type="file"]')].map(node => ({ disabled: node.disabled, multiple: node.multiple, files: node.files?.length, ...describe(node) }));
  } catch { report.contentDocument = 'denied'; }
  return report;
}
function showDiagnostics() {
  const now = Date.now();
  diagnosticPolls++;
  diagnosticGap = Math.max(diagnosticGap, now - diagnosticTick);
  diagnosticTick = now;
  $('picker-diagnostics').textContent = JSON.stringify({ fixturePhase, elapsedMs: now - diagnosticStart,
    outerVisibility: document.visibilityState, outerFocused: document.hasFocus(), callbacks: diagnosticPolls, maxCallbackGapMs: diagnosticGap,
    formMask: $('form-background').getAttribute('aria-hidden'), formConnected: $('mG61Hd').isConnected,
    picker: readPickerDiagnostics(lastFrame) }, null, 2);
}
const counters = { add: 0, input: 0, change: 0, removedInputs: 0, progressDialogs: 0, progressClosures: 0, next: 0, submit: 0, submitEvents: 0, attached: 0, masks: 0, restorations: 0 };
const display = () => { $('counters').textContent = JSON.stringify({ ...counters,
  formMask: $('form-background')?.getAttribute('aria-hidden'), retainedHiddenPickers: document.querySelectorAll('[data-old-picker]').length }, null, 2); };
const persist = async next => { localStorage.setItem(key, JSON.stringify(next)); };
const setRunning = value => {
  running = value;
  for (const id of ['dry', 'fill-file', 'keyboard', 'reset-page', 'scenario', 'local-file', 'create-synthetic', 'save-file', 'save-pair', 'delete-copy']) $(id).disabled = value;
  $('save-file').disabled = value || !draft;
};
function closePicker() {
  const modal = $('picker-modal');
  if (modal) { modal.hidden = true; modal.removeAttribute('id'); modal.setAttribute('data-old-picker', ''); }
  const background = $('form-background');
  const restore = () => {
    if (background?.getAttribute('aria-hidden') === 'true') { background.removeAttribute('aria-hidden'); counters.restorations++; }
    display();
  };
  if (modal && $('scenario').value.startsWith('sequence-')) restoreTimer = setTimeout(restore, 1000);
  else restore();
  $('complete').disabled = $('cancel-picker').disabled = true;
  display();
}
function attach(name, list = activeList || $('selected-files')) {
  const row = document.createElement('div'); row.setAttribute('role', 'listitem');
  const filename = document.createElement('span'); filename.textContent = name; filename.title = name;
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove file';
  remove.addEventListener('click', () => row.remove());
  row.append(filename, remove); list.append(row);
  counters.attached++; display();
}
function resetPage() {
  closePicker();
  clearTimeout(restoreTimer);
  $('stage').replaceChildren($('questions').content.cloneNode(true));
  activeList = $('selected-files');
  $('second-question').hidden = !twoQuestions();
  Object.keys(counters).forEach(key => { counters[key] = 0; });
  if (['prefilled', 'sequence-preserved', 'removed-tombstone'].includes($('scenario').value)) attach('already-attached.pdf');
  if ($('scenario').value === 'removed-tombstone') {
    const removed = document.createElement('div');
    for (const [key, value] of Object.entries({ jscontroller: 'By0w6', jsaction: 'mouseover:eGiyHb; click:eGiyHb; focus:eGiyHb; touchstart:eGiyHb;',
      'data-tooltip': 'SECOND-ONLY.pdf', role: 'listitem', 'data-vertical-offset': '-22', class: 'yP1fJf' })) removed.setAttribute(key, value);
    $('selected-second').append(removed);
  }
  for (const [buttonId, listId] of [['add-file', 'selected-files'], ['add-second', 'selected-second']]) $(buttonId).addEventListener('click', () => {
    activeList = $(listId);
    $('form-background').setAttribute('aria-hidden', 'true'); counters.masks++;
    counters.add++; display();
    const modal = document.createElement('div'); modal.id = 'picker-modal'; modal.setAttribute('role', 'dialog');
    const title = document.createElement('h2'); title.id = `picker-title-${crypto.randomUUID()}`; title.textContent = 'Insert file';
    modal.setAttribute('aria-labelledby', title.id); modal.append(title);
    modal.style.cssText = 'position:fixed;left:3%;top:12%;width:48%;height:420px;background:white;border:3px solid #176654;z-index:10';
    const frame = document.createElement('iframe'); frame.title = 'Synthetic Insert file';
    lastFrame = frame;
    frame.src = $('scenario').value === 'unknown' ? '/work/regex-form-filler-tests/file-picker.html' : '/picker';
    frame.style.cssText = 'width:100%;height:85%;border:0'; modal.append(frame); document.body.append(modal);
    const overlay = document.createElement('iframe'); overlay.src = 'about:blank'; overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'; document.body.append(overlay);
    $('cancel-picker').disabled = false;
  });
  $('next').addEventListener('click', () => { counters.next++; display(); });
  $('submit').addEventListener('click', () => { counters.submit++; display(); });
  $('mG61Hd').addEventListener('submit', event => { event.preventDefault(); counters.submitEvents++; display(); });
  $('status').textContent = 'Not run'; $('assertions').replaceChildren(); $('report').textContent = ''; display();
}

// Test-only communication between the observed outer-list shape and same-origin synthetic picker.
window.fileFixture = {
  get mode() { return $('scenario').value; },
  event(type) { counters[type]++; display(); },
  close: closePicker,
  finish(name) {
    const mode = $('scenario').value, list = activeList;
    if (['hide-first', 'inner-progress-two', 'sequence-close-first', 'sequence-preserved'].includes(mode)) { closePicker(); setTimeout(() => attach(name, list), 700); }
    else {
      if (!list.children.length || mode === 'removed-tombstone' && list === $('selected-second')) attach(name, list);
      if (['name-first', 'sequence-name-first'].includes(mode)) setTimeout(closePicker, 700);
      else if (mode !== 'name-open') closePicker();
    }
  },
  waiting() { $('complete').disabled = false; }
};
$('complete').addEventListener('click', () => $('picker-modal')?.querySelector('iframe').contentWindow.completeSyntheticUpload());
$('cancel-picker').addEventListener('click', closePicker);
$('scenario').addEventListener('change', resetPage);
$('reset-page').addEventListener('click', resetPage);
function setFileDraft(file, synthetic = false) {
  try {
    draft = { ref: createFileReference(file), blob: file };
    $('file-info').textContent = `${draft.ref.name} · ${draft.ref.size} bytes · ${synthetic ? 'synthetic File, not chooser coverage' : 'native chooser'} · draft only`;
    $('save-file').disabled = false;
  } catch (error) { $('storage-status').textContent = error.message; }
}
$('local-file').addEventListener('change', () => {
  const file = $('local-file').files[0]; if (file) setFileDraft(file);
});
$('create-synthetic').addEventListener('click', () => {
  if (running) return;
  setFileDraft(new File(['TEST ONLY - synthetic browser fixture bytes; not a real PDF document.\n'], 'TEST-ONLY.pdf', { type: 'application/pdf' }), true);
});
$('save-file').addEventListener('click', async () => {
  if (!draft || running) return;
  setRunning(true);
  try {
    const next = [{ pattern: '^Upload(?: 2)?$', flags: 'iu', value: draft.ref }];
    const result = await saveRulesWithFiles(rules, next, draft, persist); rules = result.rules; draft = null;
    $('local-file').value = '';
    $('storage-status').textContent = 'Saved a real IndexedDB copy for Upload and Upload 2. Reload retains it. JSON contains a reference only.';
  } catch (error) { $('storage-status').textContent = error.message; }
  finally { setRunning(false); }
});
$('save-pair').addEventListener('click', async () => {
  if (running) return;
  setRunning(true);
  try {
    for (const [index, name, contents] of [[0, 'TEST-ONLY.pdf', 'TEST ONLY - first synthetic file.\n'],
      [1, 'SECOND-ONLY.pdf', 'TEST ONLY - distinct second synthetic bytes.\n']]) {
      const blob = new File([contents], name, { type: 'application/pdf' }), ref = createFileReference(blob);
      const next = [...(index ? rules : []), { pattern: index ? '^Upload 2$' : '^Upload$', flags: 'iu', value: ref }];
      rules = (await saveRulesWithFiles(rules, next, { ref, blob }, persist)).rules;
    }
    draft = null; $('local-file').value = '';
    $('file-info').textContent = 'TEST-ONLY.pdf + SECOND-ONLY.pdf · distinct synthetic bytes and saved references';
    $('storage-status').textContent = 'Two synthetic copies saved in IndexedDB. No chooser or disk reads.';
  } catch (error) { $('storage-status').textContent = `Pair setup incomplete: ${error.message}`; }
  finally { setRunning(false); }
});
$('delete-copy').addEventListener('click', async () => {
  if (running) return;
  try { await saveRulesWithFiles(rules, [], null, persist); rules = []; $('storage-status').textContent = 'Fixture rule/copy deleted (shared-origin popup rules are separate).'; }
  catch (error) { $('storage-status').textContent = error.message; }
});

async function run(dryRun, keyboard) {
  if (running) return;
  setRunning(true); $('assertions').replaceChildren(); $('status').textContent = 'Running; Next must remain 0 while upload is pending.';
  const mode = $('scenario').value, url = location.href, token = crypto.randomUUID();
  const before = { ...counters };
  const lists = [$('selected-files'), $('selected-second')].slice(0, twoQuestions() ? 2 : 1);
  const previous = lists.map(list => [...list.children]);
  diagnosticStart = diagnosticTick = Date.now(); diagnosticPolls = diagnosticGap = 0; lastFrame = null; fixturePhase = 'collect';
  diagnosticTimer = setInterval(showDiagnostics, 250);
  try {
    if (!rules.length) throw new Error('Create and save synthetic files first.');
    if (twoQuestions() && (rules.length !== 2 || rules[0].value.fileId === rules[1].value.fileId || rules[0].value.name === rules[1].value.name)) throw new Error('Use Save two distinct synthetic files first.');
    const labels = await formDOM('collect', { url, token, allowAdvance: keyboard });
    fixturePhase = 'match';
    const matches = await matchWithTimeout(rules, labels);
    const jobs = matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) }));
    fixturePhase = 'load saved copy';
    const files = await prepareFiles(jobs, dryRun);
    fixturePhase = 'apply';
    const rows = await formDOM('apply', { url, token, jobs, files, dryRun });
    fixturePhase = `apply returned: ${rows[0]?.code}`;
    const navigation = keyboard ? await formDOM('advance', { url, token, allowIncomplete: true }) : null;
    $('report').textContent = JSON.stringify({ rows, navigation }, null, 2);
    const expected = previous.map((items, i) => items.length && !(mode === 'removed-tombstone' && i === 1 && items.length === 1) ? 'preserved' : dryRun ? 'ready' :
      ['success', 'two-files', 'inner-progress-two', 'settling-two', 'removed-tombstone', 'confirm', 'hide-first', 'name-first'].includes(mode) || mode.startsWith('sequence-') ? 'filled' : ['reject', 'unknown'].includes(mode) ? 'file-manual' : mode === 'wrong' ? 'pending' : null);
    const check = (ok, label) => {
      const li = document.createElement('li'); li.textContent = `${ok ? 'PASS' : 'FAIL'} · ${label}`; $('assertions').append(li);
      if (!ok) throw new Error(label);
    };
    const count = lists.length, filled = expected.filter(code => code === 'filled').length;
    check(labels.length === count && rows.length === count, 'Only file questions counted: wrapper, static section and nested attachment rows excluded');
    check(rows.every((row, i) => expected[i] ? row.code === expected[i] : ['filled', 'pending', 'timeout'].includes(row.code)), 'Expected attachment status for every question');
    check(rows.every((row, i) => row.code !== 'filled' || lists[i].children.length === previous[i].length + 1 && lists[i].querySelector('span')?.textContent === jobs[i].value.name), 'Each new attachment has its own matched exact filename');
    check(previous.every((items, i) => items.every((item, j) => lists[i].children[j] === item)), 'Existing attachments keep their original nodes');
    check(!rows.some(row => row.code === 'filled') || !$('picker-modal') && !$('form-background').hasAttribute('aria-hidden'), 'Filled requires picker closed, background restored and exact outer filename');
    check(counters.submit === 0 && counters.submitEvents === 0, 'No Submit click or form submit event');
    if (dryRun || expected.every(code => code === 'preserved')) check(counters.add === before.add && counters.input === before.input && counters.change === before.change && counters.attached === before.attached, 'Dry-run/preserve: no picker, events or attachment writes');
    if (filled) check(counters.add - before.add === filled && counters.input - before.input === filled && counters.change - before.change === filled && counters.attached - before.attached === filled &&
      counters.masks - before.masks === filled && counters.restorations - before.restorations === filled, 'One real picker assignment/event pair per empty question, each background restored');
    if (filled && mode.startsWith('sequence-')) check(counters.removedInputs - before.removedInputs === filled, 'Each handed-off input was removed before upload completion');
    if (filled && mode === 'inner-progress-two') check(counters.progressDialogs - before.progressDialogs === filled && counters.progressClosures - before.progressClosures === filled &&
      counters.removedInputs === before.removedInputs, 'Each sibling progress dialog masked/restored the original inner wrapper; inputs retained');
    const verified = rows.every(row => ['filled', 'preserved'].includes(row.code));
    check(counters.next - before.next === (keyboard && verified && !$('picker-modal') ? 1 : 0), 'Next only after a verified attachment and closed picker');
    check(rules.every(rule => !JSON.stringify({ rows, navigation }).includes(rule.value.name)), 'Reports contain no filename');
    $('status').textContent = 'PASS · Synthetic scenario assertions only';
  } catch (error) { $('status').textContent = `FAIL / setup needed · ${error.message}`; }
  finally { clearInterval(diagnosticTimer); showDiagnostics(); await formDOM('release', { url }); setRunning(false); display(); }
}
$('dry').addEventListener('click', () => run(true, false));
$('fill-file').addEventListener('click', () => run(false, false));
$('keyboard').addEventListener('click', () => run(false, true));
resetPage();
if (rules[0]?.value?.type === 'file') {
  $('file-info').textContent = `${rules[0].value.name} · ${rules[0].value.size} bytes · saved reference`;
  loadFile(rules[0].value).then(() => { $('storage-status').textContent = 'Saved copy available in real IndexedDB'; }, () => { $('storage-status').textContent = 'เลือกไฟล์ใหม่ · Saved reference has no usable copy'; });
}
