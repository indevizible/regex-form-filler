/* Test-only API mock; injected by preview-server.py, never shipped in the extension. */
(() => {
  const key = 'regex-form-filler-synthetic-preview-v1.1';
  const settingsKey = 'regex-form-filler-synthetic-shortcut-options-v1.4';
  const presetKey = 'regex-form-filler-synthetic-presets-v1.6';
  const keys = { rules: key, shortcutOptions: settingsKey, presetState: presetKey };
  const labels = ['ชื่อจริง', 'เบอร์โทรศัพท์', 'เบอร์โทรศัพท์บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน', 'อาหาร', 'วันเกิด', 'Upload'];
  const listeners = [];
  const session = {};
  const readStored = () => Object.fromEntries(Object.entries(keys).flatMap(([name, storageKey]) => {
    const value = localStorage.getItem(storageKey);
    return value == null ? [] : [[name, JSON.parse(value)]];
  }));
  const notify = changes => { for (const listener of listeners) listener(changes, 'local'); };
  globalThis.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    const changes = {};
    for (const [name, storageKey] of Object.entries(keys)) {
      if (event.key !== null && event.key !== storageKey) continue;
      try {
        changes[name] = { oldValue: event.oldValue == null ? undefined : JSON.parse(event.oldValue), newValue: event.newValue == null ? undefined : JSON.parse(event.newValue) };
      } catch { changes[name] = { newValue: null }; }
    }
    if (Object.keys(changes).length) notify(changes);
  });
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => readStored(),
        set: async update => {
          const previous = readStored();
          const changes = {};
          for (const [name, storageKey] of Object.entries(keys)) {
            if (!Object.hasOwn(update, name)) continue;
            localStorage.setItem(storageKey, JSON.stringify(update[name]));
            changes[name] = { oldValue: previous[name], newValue: update[name] };
          }
          notify(changes);
        }
      },
      session: { get: async name => ({ [name]: session[name] }) },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    commands: { getAll: async () => [{ name: 'fill-form', shortcut: 'Option+Shift+F' }] },
    tabs: { query: async () => [{ id: 7 }] },
    runtime: { getManifest: () => ({ version: '1.6.0' }), sendMessage: async ({ type, dryRun }) => {
      if (type !== 'run') throw new Error('Preview supports only the existing run message');
      let report;
      try {
        const stored = readStored();
        const { activePreset, readPresetState } = await import('../../outputs/regex-form-filler/presets.js');
        const rules = activePreset(readPresetState(stored)).rules;
        if (!rules.length && !dryRun) throw new Error('ยังไม่มีกฎที่บันทึกไว้ เปิดส่วนขยายแล้วบันทึกกฎก่อน');
        const { matchWithTimeout } = await import('../../outputs/regex-form-filler/matcher.js');
        const matches = rules.length ? await matchWithTimeout(rules, labels) : labels.map(() => []);
        const { prepareFiles } = await import('../../outputs/regex-form-filler/file-store.js');
        await prepareFiles(matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) })), true);
        // shortcut: fill reports are simulated; use the installed extension to verify actual form filling.
        report = { ok: true, dryRun, time: Date.now(), rows: labels.map((label, index) => ({
          label, rules: matches[index], code: !matches[index].length ? 'unmatched' : matches[index].length > 1 ? 'ambiguous' : dryRun ? 'ready' : rules[matches[index][0]].value?.type === 'file' ? 'file-manual' : 'filled',
          ...(!dryRun && matches[index].length === 1 && rules[matches[index][0]].value?.type === 'file' ? { diagnostic: 'file-preflight' } : {})
        })) };
      } catch (error) { report = { ok: false, dryRun, time: Date.now(), error: error.message, rows: [] }; }
      report.version = chrome.runtime.getManifest().version;
      session['report-7'] = report;
      for (const listener of listeners) listener({ 'report-7': { newValue: report } }, 'session');
      return report;
    } }
  };
  const banner = document.createElement('aside');
  banner.style.cssText = 'padding:10px 14px;background:#fff0bc;color:#533c00;font:12px/1.6 system-ui;border-bottom:1px solid #c4a04b';
  banner.textContent = 'TEST PREVIEW · UI และ IndexedDB จริงใน origin นี้ / Chrome API จำลอง · ใช้ TEST-ONLY.pdf เท่านั้น · การกรอกและคีย์ลัดจำลอง ไม่อัปโหลดไฟล์';
  const reset = document.createElement('button');
  reset.textContent = 'ล้างชุดกฎ/การตั้งค่า preview (เก็บสำเนาไฟล์)';
  reset.style.cssText = 'display:block;margin-top:6px;padding:4px 8px;font-size:12px';
  reset.addEventListener('click', () => { for (const storageKey of Object.values(keys)) localStorage.removeItem(storageKey); location.reload(); });
  banner.append(reset);
  document.body.prepend(banner);
})();
