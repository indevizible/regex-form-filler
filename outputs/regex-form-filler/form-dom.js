// Self-contained so scripting.executeScript can serialize this function into the isolated world.
export async function formDOM(operation, payload) {
  const state = globalThis.__regexFormFillerState ||= {};
  if (location.href !== payload.url) {
    delete state.snapshot; delete state.advance;
    if (operation === 'advance') return { code: 'stale' };
    throw new Error('หน้าแบบฟอร์มเปลี่ยนแล้ว โปรดลองใหม่');
  }
  const text = value => (value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const rendered = element => !!element.getClientRects().length &&
    element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false &&
    !element.closest('[hidden], [inert]') &&
    !['hidden', 'collapse'].includes(getComputedStyle(element).visibility) && getComputedStyle(element).display !== 'none';
  const visible = element => rendered(element) && !element.closest('[aria-hidden="true"]');
  const blocked = element => !visible(element) || element.disabled || element.readOnly ||
    element.matches(':disabled') || !!element.closest('[aria-disabled="true"], [aria-readonly="true"]');
  const title = heading => {
    const copy = heading.cloneNode(true);
    copy.querySelectorAll('[aria-label="Required question"]').forEach(node => node.remove());
    return copy.textContent.trim();
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const verify = async predicate => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await pause(60);
      if (predicate()) return true;
    }
    return false;
  };

  if (operation === 'notice') {
    clearTimeout(state.noticeTimer);
    state.notice?.remove();
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.textContent = `Regex Form Filler · ${payload.message}`;
    Object.assign(notice.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647', maxWidth: 'min(420px, 85vw)',
      padding: '14px 18px', borderRadius: '12px', color: '#fff', background: '#174e44',
      font: '14px/1.6 system-ui, sans-serif', boxShadow: '0 6px 24px #0003', pointerEvents: 'none'
    });
    document.documentElement.append(notice);
    state.notice = notice;
    state.noticeTimer = setTimeout(() => { notice.remove(); delete state.notice; }, 5500);
    return;
  }
  if (operation === 'release') { delete state.snapshot; delete state.advance; return; }
  const fileListSelector = '[role="list"][aria-label="Selected files"], [role="list"][aria-label="ไฟล์ที่เลือก"]';
  const modalSelector = '[role="dialog"], dialog, [aria-modal="true"]';
  const modals = () => [...document.querySelectorAll(modalSelector)].filter(visible);
  const namedInsertDialog = node => {
    const name = node.getAttribute('aria-label');
    if (name) return text(name) === 'Insert file';
    const ids = (node.getAttribute('aria-labelledby') || '').trim().split(/\s+/u);
    return ids.length <= 5 && text(ids.map(id => node.ownerDocument.getElementById(id)?.textContent || '').join(' ')) === 'Insert file';
  };
  const fileList = (card, isVisible = visible) => {
    const lists = [...card.querySelectorAll(fileListSelector)].filter(list => list.closest('[role="listitem"]') === card && isVisible(list));
    return lists.length === 1 ? lists[0] : null;
  };
  const addFileButton = button => button.matches('button, [role="button"]') &&
    ['Add file', 'เพิ่มไฟล์'].includes(text(button.textContent)) &&
    (!button.getAttribute('aria-label') || text(button.getAttribute('aria-label')) === text(button.textContent)) &&
    !(button.matches('button') && button.type !== 'button');
  const hasSelection = list => !!list.children.length || !!text(list.textContent);
  const attachmentItems = (list, isVisible = visible) => [...list.querySelectorAll('[role="listitem"]')].filter(item => item.closest(fileListSelector) === list && isVisible(item) &&
    !item.closest('[aria-busy="true"]') && !item.querySelector('[role="progressbar"], [aria-busy="true"]'));
  const exactFilename = (item, name, isVisible = visible) => [item, ...item.querySelectorAll('*')].some(node => isVisible(node) &&
    !node.matches('button, input, [role="button"], [role="progressbar"]') &&
    (node.textContent === name || node.getAttribute('title') === name || node.getAttribute('aria-label') === name));
  const attached = (list, name, isVisible = visible) => attachmentItems(list, isVisible).some(item => exactFilename(item, name, isVisible));
  const uploading = () => [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible);
  // Keep a bounded census independent of matched rules, including unfamiliar answer widgets.
  const pageCards = (isVisible = visible) => [...document.querySelectorAll('[role="listitem"]')].filter(card => isVisible(card) && !card.closest(fileListSelector) && !card.closest(modalSelector));
  const answerControls = (form, isVisible = visible) => [...form.querySelectorAll('input:not([type="hidden"]), textarea, select, button, [role], [contenteditable]')]
    .filter(element => {
      if (!isVisible(element) || element.closest(modalSelector)) return false;
      const list = element.closest(fileListSelector);
      if (list) return element === list;
      const card = element.closest('[role="listitem"]');
      if (card && fileList(card, isVisible) && addFileButton(element)) return false;
      return (element.matches('input, textarea, select, button, [contenteditable]') || !['list', 'listitem', 'heading', 'group', 'radiogroup', 'option', 'presentation', 'none', 'alert', 'status'].includes(element.getAttribute('role'))) &&
        !(element.matches('button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]') && !card);
    });
  const questionHeadings = cards => cards.flatMap(card => [...card.querySelectorAll('[role="heading"][aria-level="3"]')].filter(heading => heading.closest('[role="listitem"]') === card));
  const isStaticSection = card => !answerControls(card).length && !questionHeadings([card]).length &&
    [...card.querySelectorAll('[role="heading"][aria-level="1"], [role="heading"][aria-level="2"]')]
      .filter(heading => heading.closest('[role="listitem"]') === card && visible(heading) && text(title(heading))).length === 1;
  const same = (before, after) => before.length === after.length && before.every((node, index) => node === after[index]);
  const currentPage = (snapshot, isVisible = visible) => snapshot.document === document && snapshot.url === location.href && snapshot.form?.isConnected &&
    same(snapshot.cards, pageCards(isVisible)) && same(snapshot.controls, answerControls(snapshot.form, isVisible)) &&
    same(snapshot.headings, questionHeadings(snapshot.cards)) && snapshot.headings.every((heading, index) => title(heading) === snapshot.titles[index]) &&
    snapshot.controls.every((control, index) => control.closest('[role="listitem"]') === snapshot.owners[index]) &&
    snapshot.entries.every(entry => entry.card.isConnected && entry.heading.isConnected && entry.card.closest('form') === snapshot.form && entry.heading.closest('[role="listitem"]') === entry.card && title(entry.heading) === entry.raw);
  const valid = element => !element.disabled && !element.matches(':disabled') &&
    !element.closest('[aria-disabled="true"], [aria-invalid]:not([aria-invalid="false"])') &&
    (!element.matches('input, textarea, select') || element.checkValidity());
  const answered = (card, controls) => {
    const list = fileList(card);
    if (list) return controls.length === 1 && controls[0] === list && valid(list) &&
      attachmentItems(list).some(item => [...item.querySelectorAll('*')].some(node => visible(node) &&
        !node.children.length && !node.matches('button, input, [role="button"], [role="progressbar"], [role="status"], [role="alert"]') && !!text(node.textContent)));
    if (!controls.length || controls.length > 200 || card.querySelector('[role="grid"], [role="row"], table') ||
        card.querySelectorAll('[role="radiogroup"]').length > 1) return false;
    const radios = controls.filter(element => element.matches('input[type="radio"], [role="radio"]'));
    const checks = controls.filter(element => element.matches('input[type="checkbox"], [role="checkbox"]'));
    const choices = radios.length ? radios : checks;
    if (choices.length) {
      if (choices.length !== controls.length || radios.length && checks.length) return false;
      if (radios.some(element => element.matches('input')) &&
          (new Set(radios.map(element => element.name)).size !== 1 || !radios[0].name)) return false;
      if (choices.some(element => !element.matches('input') && !['true', 'false'].includes(element.getAttribute('aria-checked')))) return false;
      if (choices.some(element => element.matches('input') && !element.checkValidity())) return false;
      const selected = choices.filter(element => element.matches('input') ? element.checked : element.getAttribute('aria-checked') === 'true');
      return selected.length > 0 && (!radios.length || selected.length === 1) && selected.every(valid);
    }
    if (controls.length !== 1) return false;
    const control = controls[0];
    if (!valid(control)) return false;
    if (control.matches('input, textarea, select')) {
      if (control.matches('input') && !['text', 'email', 'tel', 'number', 'url', 'date'].includes(control.type)) return false;
      if (!text(control.value)) return false;
      if (control.tagName === 'SELECT') {
        const selected = [...control.options].filter(option => option.selected);
        return !control.multiple && selected.length === 1 && !selected[0].disabled && !selected[0].parentElement?.disabled;
      }
      return !(control.maxLength >= 0 && control.value.length > control.maxLength ||
        control.minLength > 0 && control.value.length < control.minLength);
    }
    // shortcut: only the existing local-options listbox shape is verified; unknown widgets need override/manual Next.
    if (control.getAttribute('role') !== 'listbox' || control.getAttribute('aria-multiselectable') === 'true') return false;
    const options = [...control.querySelectorAll('[role="option"]')];
    if (!options.length || options.length > 200 || options.some(option => !option.hasAttribute('data-value'))) return false;
    const selected = options.filter(option => option.getAttribute('aria-selected') === 'true');
    const value = control.getAttribute('data-value');
    const chosen = selected.length ? selected : options.filter(option => text(value) && option.getAttribute('data-value') === value);
    return chosen.length === 1 && !!text(chosen[0].getAttribute('data-value')) && valid(chosen[0]) &&
      options.filter(option => option.getAttribute('data-value') === chosen[0].getAttribute('data-value')).length === 1 &&
      (!text(value) || value === chosen[0].getAttribute('data-value'));
  };
  if (operation === 'advance') {
    const snapshot = state.advance;
    delete state.advance; // Consume before any validation/click; failures cannot be replayed.
    if (!snapshot || snapshot.token !== payload.token || !currentPage(snapshot)) return { code: 'stale' };
    if (modals().length || uploading()) return { code: 'pending' };
    const { form, entries, cards, controls } = snapshot;
    if (entries.some(entry => {
      const list = fileList(entry.card);
      return list && hasSelection(list) && !answered(entry.card, controls.filter(control => control.closest('[role="listitem"]') === entry.card));
    })) return { code: 'pending' };
    const complete = controls.length > 0 && controls.length <= 1000 &&
      controls.every(control => entries.some(entry => control.closest('[role="listitem"]') === entry.card)) &&
      cards.every(card => entries.some(entry => entry.card === card) || card.closest('form') === form && isStaticSection(card)) &&
      entries.every(entry => answered(entry.card, controls.filter(control => control.closest('[role="listitem"]') === entry.card)));
    if (!complete && payload.allowIncomplete !== true) return { code: 'incomplete' };
    const candidates = [...form.querySelectorAll('button, input[type="button"], [role="button"]')].filter(button =>
      visible(button) && button.closest('form') === form && !button.closest('[role="listitem"]') &&
      !(button.matches('button, input') && button.type !== 'button') &&
      ['Next', 'ถัดไป'].includes(text(button.matches('input') ? button.value : button.textContent)) &&
      (!button.getAttribute('aria-label') || text(button.getAttribute('aria-label')) === text(button.matches('input') ? button.value : button.textContent)) &&
      !button.getAttribute('aria-labelledby'));
    if (!candidates.length) return { code: 'no-next' };
    if (candidates.length !== 1) return { code: 'ambiguous' };
    if (blocked(candidates[0])) return { code: 'disabled' };
    if (!currentPage(snapshot)) return { code: 'stale' };
    candidates[0].click();
    return { code: 'attempted' };
  }
  if (operation === 'collect') {
    delete state.snapshot; delete state.advance;
    const entries = [];
    for (const card of pageCards()) {
      if (!visible(card)) continue;
      const headings = [...card.querySelectorAll('[role="heading"][aria-level="3"]')]
        .filter(heading => heading.closest('[role="listitem"]') === card);
      if (headings.length !== 1) continue;
      const raw = title(headings[0]);
      if (!raw) continue;
      if (raw.length > 2000 || entries.length >= 200) throw new Error('จำนวนหรือความยาวคำถามเกินขีดจำกัด');
      entries.push({ card, heading: headings[0], raw });
    }
    state.snapshot = { token: payload.token, entries, allowAdvance: payload.allowAdvance === true };
    {
      const form = entries[0]?.card.closest('form');
      const cards = pageCards();
      const controls = form ? answerControls(form) : [];
      if (form && cards.length <= 200 && controls.length <= 1000 && entries.every(entry => entry.card.closest('form') === form)) {
        const headings = questionHeadings(cards);
        Object.assign(state.snapshot, { document, url: location.href, form, cards, controls, headings, titles: headings.map(title), owners: controls.map(control => control.closest('[role="listitem"]')) });
      }
    }
    return entries.map(entry => entry.raw);
  }
  delete state.advance;
  if (operation !== 'apply' || state.snapshot?.token !== payload.token) throw new Error('ข้อมูลคำถามหมดอายุ โปรดลองใหม่');
  const snapshot = state.snapshot;
  const { entries } = snapshot;
  delete state.snapshot;
  const hasFiles = payload.jobs.some(job => job.rules.length === 1 && job.value?.type === 'file');
  const deadline = Date.now() + (hasFiles ? 180000 : 15000);
  let uncertainFile = false;

  const fillFile = async (entry, value, dryRun, row) => {
    const fail = (code, diagnostic) => { row.diagnostic = diagnostic; return code; };
    const { card } = entry;
    const list = fileList(card);
    const ancestors = () => {
      const nodes = [];
      for (let node = snapshot.form; node; node = node.parentElement) nodes.push(node);
      return nodes;
    };
    const originalAncestors = ancestors();
    // Google masks the background with ARIA while its picker is open; layout hiding still invalidates it.
    const pickerVisible = element => {
      if (!rendered(element)) return false;
      for (let node = element; node; node = node.parentElement) {
        if (node.getAttribute('aria-hidden') === 'true' && !originalAncestors.includes(node)) return false;
      }
      return true;
    };
    const stable = (isVisible = visible) => snapshot.form && same(originalAncestors, ancestors()) && currentPage(snapshot, isVisible) &&
      fileList(card, isVisible) === list && isVisible(card) && isVisible(list);
    if (!list) return 'file-manual';
    if (!stable()) return fail('stale', 'owner-form-changed');
    if (hasSelection(list)) return 'preserved';
    if (modals().length || uploading()) return 'file-manual';
    const buttons = [...card.querySelectorAll('button, [role="button"]')].filter(button =>
      button.closest('[role="listitem"]') === card && addFileButton(button) && visible(button));
    if (buttons.length !== 1 || blocked(buttons[0]) ||
        !same(answerControls(card), [list])) return 'file-manual';
    if (dryRun) return 'ready';
    row.diagnostic = 'file-data';
    const base64 = payload.files?.[value.fileId];
    if (typeof base64 !== 'string' || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 10485760 ||
        base64.length !== Math.ceil(value.size / 3) * 4 || /[^A-Za-z0-9+/=]/u.test(base64) ||
        base64.slice(0, -2).includes('=') || !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64.slice(-2))) return 'file-missing';
    const bytes = new Uint8Array(value.size);
    let offset = 0;
    try {
      for (let i = 0; i < base64.length; i += 32768) {
        const part = atob(base64.slice(i, i + 32768));
        for (let j = 0; j < part.length; j++) bytes[offset++] = part.charCodeAt(j);
      }
    } catch { return 'file-missing'; }
    if (offset !== value.size) return 'file-missing';
    row.diagnostic = 'picker-discovery';
    const oldFrames = [...document.querySelectorAll('iframe')];
    const oldDialogs = [...document.querySelectorAll(modalSelector)];
    const oldVisibleFrames = oldFrames.filter(visible);
    const end = Math.min(deadline, Date.now() + 60000);
    const pickerEnd = Math.min(end, Date.now() + 10000);
    if (!stable() || hasSelection(list)) return 'stale';
    buttons[0].click();
    let frame, picker, win, input, pickerDialog, outerDialog;
    while (Date.now() < pickerEnd) {
      await pause(150);
      if (Date.now() >= end) return 'timeout';
      if (Date.now() >= pickerEnd) return 'file-manual';
      if (hasSelection(list)) return 'pending';
      const dialogs = modals();
      const frames = [...document.querySelectorAll('iframe')].filter(node => visible(node) && !oldFrames.includes(node));
      if (frames.length > 1 || dialogs.length > 1) return 'file-manual';
      if (!frames.length || !dialogs.length) {
        if (!stable()) return 'stale';
        continue;
      }
      if (oldDialogs.includes(dialogs[0]) || !namedInsertDialog(dialogs[0]) || !dialogs[0].contains(frames[0]) ||
          [...document.querySelectorAll('iframe')].some(node => visible(node) && node !== frames[0] && !oldVisibleFrames.includes(node))) return 'file-manual';
      frame = frames[0];
      outerDialog = dialogs[0];
      try {
        // The background restricts the outer page to docs.google.com; never inspect picker query/auth data.
        const source = new URL(frame.src);
        if (source.origin !== location.origin || source.pathname !== '/picker' || frame.hasAttribute('sandbox')) return 'file-manual';
        picker = frame.contentDocument;
        win = picker?.defaultView;
        if (!picker || !win) return 'file-manual';
        const actual = new URL(picker.URL);
        if (actual.origin !== location.origin || actual.pathname !== '/picker') continue;
        if (!stable(pickerVisible)) return 'stale';
        if (picker.readyState !== 'complete') continue; // Parsed inputs can precede deferred module handlers.
        const dialogsInside = [...picker.querySelectorAll('[role="dialog"]')].filter(visible);
        if (!dialogsInside.length) continue;
        if (dialogsInside.length !== 1 || !namedInsertDialog(dialogsInside[0])) return 'file-manual';
        pickerDialog = dialogsInside[0];
        const inputs = [...picker.querySelectorAll('input[type="file"]')];
        if (!inputs.length) continue;
        if (inputs.length !== 1) return 'file-manual';
        input = inputs[0];
        if (!pickerDialog.contains(input)) return 'file-manual';
        break;
      } catch { return 'file-manual'; }
    }
    if (!input) return 'file-manual';
    const pickerDocumentStable = () => (!frame.isConnected || frame.contentDocument === picker) && picker.readyState === 'complete' &&
      new URL(frame.src).origin === location.origin && new URL(frame.src).pathname === '/picker' &&
      new URL(picker.URL).origin === location.origin && new URL(picker.URL).pathname === '/picker' &&
      !frame.hasAttribute('sandbox');
    const pickerShellStable = () => frame.isConnected && visible(frame) && pickerDocumentStable() &&
      namedInsertDialog(outerDialog) && same(modals(), [outerDialog]) && outerDialog.contains(frame) &&
      ![...document.querySelectorAll('iframe')].some(node => visible(node) && node !== frame && !oldVisibleFrames.includes(node));
    const pickerStable = (requireInput = true) => pickerShellStable() &&
      pickerDialog.isConnected && namedInsertDialog(pickerDialog) &&
      same([...picker.querySelectorAll('[role="dialog"]')].filter(visible), [pickerDialog]) &&
      (!requireInput || input.isConnected && pickerDialog.contains(input) && same([...picker.querySelectorAll('input[type="file"]')], [input]));
    row.diagnostic = 'file-handoff';
    const accept = input.accept.split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
    const accepted = !accept.length || accept.some(token => token.startsWith('.') ? value.name.toLowerCase().endsWith(token) :
      token.endsWith('/*') ? !!value.mime && value.mime.startsWith(token.slice(0, -1)) : token === value.mime);
    if (!pickerStable() || !stable(pickerVisible) || hasSelection(list)) return 'stale';
    if (Date.now() >= end) return 'timeout';
    if (!accepted || input.multiple || input.disabled || input.matches(':disabled') ||
        input.closest('[aria-disabled="true"]') || input.files?.length || !win.File || !win.DataTransfer) return 'file-manual';
    const transfer = new win.DataTransfer();
    transfer.items.add(new win.File([bytes], value.name, { type: value.mime }));
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'files').set.call(input, transfer.files);
    if (!pickerStable() || !stable(pickerVisible) || hasSelection(list)) return 'pending';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    if (!pickerStable() || !stable(pickerVisible) || hasSelection(list)) return 'pending';
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    row.diagnostic = 'upload-completion';
    let confirmed = false;
    let closedAt;
    while (Date.now() < end) {
      await pause(200);
      if (Date.now() >= end) return 'timeout';
      const openModals = modals();
      if (openModals.some(node => node !== outerDialog) ||
          [...document.querySelectorAll('iframe')].some(node => visible(node) && node !== frame && !oldVisibleFrames.includes(node))) return fail('pending', 'unexpected-ui');
      if (!pickerDocumentStable()) return fail('pending', 'picker-document-changed');
      const closed = (!frame.isConnected || !visible(frame)) && (!outerDialog.isConnected || !visible(outerDialog));
      // Google masks/replaces the inner dialog during upload; only passively wait in the owned shell.
      if (!closed && (closedAt !== undefined || !pickerShellStable())) return fail('pending', 'picker-ui-changed');
      if (!stable(pickerVisible)) return fail('stale', 'owner-form-changed');
      const found = attached(list, value.name, pickerVisible);
      if (hasSelection(list) && !found) return fail('pending', 'selection-not-exact');
      if (closed) {
        closedAt ??= Date.now();
        // Closure can precede the outer attachment or original ancestry's ARIA restoration.
        if (Date.now() - closedAt >= 5000) return fail('pending', 'close-grace-expired');
        if (stable() && found && !openModals.length && !uploading()) return 'filled';
        continue;
      }
      if (found || !pickerStable(false)) continue;
      // shortcut: only a selected filename + exact English Insert is recognized; other picker layouts stay manual.
      const selected = [...pickerDialog.querySelectorAll('[aria-selected="true"]')].filter(node => visible(node) && !node.matches('[role="tab"]'));
      const confirms = [...pickerDialog.querySelectorAll('button, [role="button"]')].filter(button => visible(button) &&
        ['Insert', 'Insert 1 item'].includes(text(button.textContent)) &&
        (!button.getAttribute('aria-label') || text(button.getAttribute('aria-label')) === text(button.textContent)) &&
        !button.getAttribute('aria-labelledby') && !(button.matches('button') && button.type !== 'button'));
      if (!confirmed && selected.length === 1 && exactFilename(selected[0], value.name) && confirms.length === 1 && !blocked(confirms[0])) {
        if (!pickerStable(false)) continue;
        if (!stable(pickerVisible)) return fail('stale', 'owner-form-changed');
        confirmed = true;
        confirms[0].click();
      }
    }
    return 'timeout';
  };

  const optionName = element => text(element.getAttribute('aria-label') || element.getAttribute('data-value') ||
    (element.labels?.length ? [...element.labels].map(label => label.textContent).join(' ') : element.textContent));
  const isSelected = element => element.matches('input') ? element.checked : element.getAttribute('aria-checked') === 'true';
  const setterFor = element => {
    const win = element.ownerDocument.defaultView;
    const proto = element.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype :
      element.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  };
  const fill = async (card, value, dryRun) => {
    const date = value?.type === 'date';
    if (card.querySelector('[role="grid"], [role="row"], table') || card.querySelectorAll('[role="radiogroup"]').length > 1) return 'unsupported';
    const controls = [...card.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="radio"], [role="checkbox"], [role="listbox"], [role="combobox"]')]
      .filter(element => element.closest('[role="listitem"]') === card);
    const radios = controls.filter(element => element.matches('input[type="radio"], [role="radio"]'));
    const checks = controls.filter(element => element.matches('input[type="checkbox"], [role="checkbox"]'));
    const choices = radios.length ? radios : checks;
    if (choices.length) {
      if (radios.length && checks.length || controls.length !== choices.length) return 'unsupported';
      if (radios.length > 1 && radios.some(element => element.matches('input')) &&
          (new Set(radios.map(element => element.name)).size !== 1 || !radios[0].name)) return 'unsupported';
      if (choices.some(element => isSelected(element) || element.getAttribute('aria-checked') === 'mixed')) return 'preserved';
      if (date) return 'unsupported';
      if (choices.some(element => !element.matches('input') && element.getAttribute('aria-checked') !== 'false')) return 'unsupported';
      if (radios.length && Array.isArray(value)) return 'invalid';
      const wanted = (Array.isArray(value) ? value : [value]).map(text);
      if (new Set(wanted).size !== wanted.length || wanted.some(label => !label)) return 'invalid';
      const targets = [];
      for (const label of wanted) {
        const options = choices.filter(element => optionName(element) === label);
        if (options.length !== 1) return 'missing';
        if (blocked(options[0])) return 'blocked';
        targets.push(options[0]);
      }
      if (dryRun) return 'ready';
      for (const target of targets) {
        if (Date.now() > deadline) return 'timeout';
        if (!target.isConnected || blocked(target)) return 'stale';
        target.click();
        if (!await verify(() => target.isConnected && isSelected(target))) return 'mismatch';
      }
      return choices.every(element => isSelected(element) === targets.includes(element)) ? 'filled' : 'mismatch';
    }
    if (controls.length !== 1) return 'unsupported';
    const control = controls[0];
    if (blocked(control)) return 'blocked';
    if (Array.isArray(value)) return 'invalid';
    if (control.matches('input, textarea, select')) {
      if (control.matches('input') && !['text', 'email', 'tel', 'number', 'url', 'date'].includes(control.type)) return 'unsupported';
      if (control.tagName === 'SELECT' && control.multiple) return 'unsupported';
      if (control.value !== '') return 'preserved';
      let wanted = value;
      if (date) {
        if (control.matches('[role="combobox"], [role="listbox"]')) return 'unsupported';
        if (control.tagName !== 'TEXTAREA' && !(control.tagName === 'INPUT' && ['date', 'text'].includes(control.type))) return 'unsupported';
        // Values are validated before injection; keep this formatter inside the serialized function.
        const [year, month, day] = value.iso.split('-');
        const textYear = Number(year) + (value.textCalendar === 'buddhist' ? 543 : 0);
        if (control.type === 'date') wanted = value.iso;
        else if (!value.textFormat || value.textFormat === 'numeric') wanted = `${day}/${month}/${String(textYear).padStart(4, '0')}`;
        else {
          const months = value.textFormat === 'thai-long' ?
            ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'] :
            ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
          wanted = `${Number(day)} ${months[Number(month) - 1]} ${textYear}`;
        }
      }
      if (control.tagName === 'SELECT') {
        const options = [...control.options].filter(option => text(option.label) === text(value));
        if (options.length !== 1) return 'missing';
        if (options[0].disabled || options[0].parentElement?.disabled) return 'blocked';
        wanted = options[0].value;
        if ([...control.options].filter(option => option.value === wanted).length !== 1) return 'unsupported';
        if (control.required && wanted === '') return 'invalid';
      }
      if (control.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(wanted)) return 'invalid';
      const set = setterFor(control);
      if (control.tagName !== 'SELECT') {
        const probe = control.cloneNode(false);
        set.call(probe, wanted);
        if (probe.value !== wanted || !probe.checkValidity() ||
            control.maxLength >= 0 && wanted.length > control.maxLength ||
            control.minLength > 0 && wanted.length > 0 && wanted.length < control.minLength) return 'invalid';
      }
      if (dryRun) return 'ready';
      set.call(control, wanted);
      const win = control.ownerDocument.defaultView;
      control.dispatchEvent(new win.Event('input', { bubbles: true }));
      control.dispatchEvent(new win.Event('change', { bubbles: true }));
      await pause(80);
      return control.isConnected && control.value === wanted && control.checkValidity() ? 'filled' : 'mismatch';
    }
    if (date) return 'unsupported';
    // shortcut: custom dropdowns need local options with data-value; other widgets stay manual until their DOM is verified.
    if (control.getAttribute('role') !== 'listbox' || control.getAttribute('aria-multiselectable') === 'true') return 'unsupported';
    const options = [...control.querySelectorAll('[role="option"]')];
    if (!options.length || options.some(option => !option.hasAttribute('data-value'))) return 'unsupported';
    if (options.some(option => option.getAttribute('aria-selected') === 'true' && option.getAttribute('data-value') !== '')) return 'preserved';
    const selectedValue = control.getAttribute('data-value');
    if (selectedValue) return 'preserved';
    if (!options.some(option => option.getAttribute('aria-selected') === 'true' && option.getAttribute('data-value') === '') && selectedValue !== '') return 'unsupported';
    const targets = options.filter(option => text(option.getAttribute('data-value')) === text(value));
    if (targets.length !== 1 || !text(value)) return 'missing';
    const target = targets[0];
    if (target.getAttribute('aria-disabled') === 'true') return 'blocked';
    if (dryRun) return 'ready';
    control.click();
    if (!await verify(() => visible(target))) return 'mismatch';
    if (blocked(target)) return 'blocked';
    target.click();
    const matched = await verify(() => {
      if (!control.isConnected || !target.isConnected) return false;
      const selected = options.filter(option => option.getAttribute('aria-selected') === 'true');
      return selected.length === 1 && selected[0] === target ||
        selected.length === 0 && control.getAttribute('data-value') === target.getAttribute('data-value');
    });
    return matched ? 'filled' : 'mismatch';
  };

  const results = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const job = payload.jobs[index];
    const row = { label: entry.raw, rules: job?.rules || [] };
    if (job?.value?.type === 'file') row.diagnostic = 'file-preflight';
    let code;
    if (!entry.card.isConnected || !entry.heading.isConnected || location.href !== payload.url ||
        title(entry.heading) !== entry.raw) code = 'stale';
    else if (!job || !job.rules.length) code = 'unmatched';
    else if (job.rules.length > 1) code = 'ambiguous';
    else if (!visible(entry.card)) code = 'blocked';
    else if (Date.now() > deadline) code = 'timeout';
    else if (job.value?.type === 'file' && uncertainFile) code = 'pending';
    else {
      try { code = job.value?.type === 'file' ? await fillFile(entry, job.value, payload.dryRun, row) : await fill(entry.card, job.value, payload.dryRun); }
      catch { code = 'error'; }
    }
    if (job?.value?.type === 'file' && !['filled', 'preserved', 'ready'].includes(code)) {
      if (uncertainFile) row.diagnostic = 'previous-unconfirmed';
      else if (code === 'timeout') row.diagnostic = 'overall-timeout';
      uncertainFile = true;
    } else delete row.diagnostic;
    row.code = code;
    results.push(row);
  }
  if (!payload.dryRun && snapshot.allowAdvance && snapshot.form && !uncertainFile && !results.some(row => ['stale', 'error', 'timeout'].includes(row.code)) && currentPage(snapshot)) state.advance = snapshot;
  return results;
}
