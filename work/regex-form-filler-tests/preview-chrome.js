/* Test-only API mock; injected by preview-server.py, never shipped in the extension. */
(() => {
  const key = 'regex-form-filler-synthetic-preview-v1.1';
  const settingsKey = 'regex-form-filler-synthetic-shortcut-options-v1.4';
  const labels = ['ชื่อจริง', 'เบอร์โทรศัพท์', 'เบอร์โทรศัพท์บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน', 'อาหาร', 'วันเกิด', 'Upload'];
  const listeners = [];
  const session = {};
  const readRules = () => JSON.parse(localStorage.getItem(key) || '[]');
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ rules: readRules(), shortcutOptions: JSON.parse(localStorage.getItem(settingsKey) || 'null') }),
        set: async update => {
          if (Object.hasOwn(update, 'rules')) localStorage.setItem(key, JSON.stringify(update.rules));
          if (Object.hasOwn(update, 'shortcutOptions')) localStorage.setItem(settingsKey, JSON.stringify(update.shortcutOptions));
        }
      },
      session: { get: async name => ({ [name]: session[name] }) },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    commands: { getAll: async () => [{ name: 'fill-form', shortcut: 'Option+Shift+F' }] },
    tabs: { query: async () => [{ id: 7 }] },
    runtime: { getManifest: () => ({ version: '1.5.6' }), sendMessage: async ({ type, dryRun }) => {
      if (type !== 'run') throw new Error('Preview supports only the existing run message');
      let report;
      try {
        const rules = readRules();
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
  reset.textContent = 'ล้างกฎ/การตั้งค่า preview (เก็บสำเนาไฟล์)';
  reset.style.cssText = 'display:block;margin-top:6px;padding:4px 8px;font-size:12px';
  reset.addEventListener('click', () => { localStorage.removeItem(key); localStorage.removeItem(settingsKey); location.reload(); });
  banner.append(reset);
  document.body.prepend(banner);
})();
