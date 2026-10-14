import { FILE_DIAGNOSTICS, isFormUrl, normalizeLabel, normalizeShortcutOptions, NAVIGATION_STATUS, validateRules } from './core.js';
import { formDOM } from './form-dom.js';
import { prepareFiles } from './file-store.js';

const pendingMatchers = new Map();
const runningTabs = new Set();
const keyboardSource = Symbol('keyboard');
const runnerUrl = chrome.runtime.getURL('runner.html');
const popupUrl = chrome.runtime.getURL('popup.html');

async function timedMatch(rules, labels) {
  const token = crypto.randomUUID();
  const job = { rules, labels };
  const result = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  pendingMatchers.set(token, job);
  const timer = setTimeout(() => job.reject(new Error('ตัวตรวจ regex ไม่ตอบสนอง ยกเลิกแล้วโดยยังไม่กรอกข้อมูล')), 10000);
  job.created = chrome.tabs.create({ url: `${runnerUrl}#${token}`, active: false });
  job.created.catch(() => job.reject(new Error('เปิดตัวตรวจ regex ไม่สำเร็จ จึงยังไม่กรอกข้อมูล')));
  try { return await result; }
  finally {
    clearTimeout(timer);
    pendingMatchers.delete(token);
    try {
      const tab = await job.created;
      await chrome.tabs.remove(tab.id);
    } catch { /* The user may have closed the temporary tab. */ }
  }
}

async function matcherMessage(message, sender) {
  const job = pendingMatchers.get(message.token);
  if (!job || sender.id !== chrome.runtime.id || sender.url !== `${runnerUrl}#${message.token}`) return { ok: false };
  const tab = await job.created;
  if (sender.tab?.id !== tab.id) return { ok: false };
  if (message.type === 'matcher-ready') return { ok: true, rules: job.rules, labels: job.labels };
  if (message.error) job.reject(new Error(message.error));
  else if (Array.isArray(message.matches) && message.matches.length === job.labels.length &&
      message.matches.every(indices => Array.isArray(indices) && new Set(indices).size === indices.length &&
        indices.every(index => Number.isInteger(index) && index >= 0 && index < job.rules.length))) job.resolve(message.matches);
  else job.reject(new Error('ผลการตรวจ regex ไม่ถูกต้อง จึงยังไม่กรอกข้อมูล'));
  return { ok: true };
}

export async function runCurrentTab(dryRun = false, commandTab, source) {
  let tab;
  try {
    tab = commandTab?.id ? await chrome.tabs.get(commandTab.id) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  } catch { return { ok: false, error: 'อ่านแท็บปัจจุบันไม่ได้ โปรดเปิด Google Forms แล้วลองใหม่' }; }
  if (!tab?.id) return { ok: false, error: 'ไม่พบแท็บปัจจุบัน' };
  if (runningTabs.has(tab.id)) return { ok: false, error: 'กำลังตรวจหรือกรอกแท็บนี้อยู่ โปรดรอสักครู่' };
  runningTabs.add(tab.id);
  let report;
  let documentId;
  let keepAlive;
  const inject = async (operation, data = {}) => {
    const target = documentId ? { tabId: tab.id, documentIds: [documentId] } : { tabId: tab.id };
    const [response] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: formDOM, args: [operation, { ...data, url: tab.url }] });
    if (!response || response.error) throw new Error('เข้าถึงแบบฟอร์มไม่ได้ โปรดเปิดหน้าคำตอบแล้วกดส่วนขยายอีกครั้ง');
    documentId = response.documentId;
    return response.result;
  };
  try {
    if (!isFormUrl(tab.url)) throw new Error('ใช้ได้เฉพาะหน้า Google Forms สำหรับตอบหรือดูตัวอย่าง ไม่ใช่หน้าแก้ไขหรือผลลัพธ์');
    const { rules: saved = [], shortcutOptions } = await chrome.storage.local.get(['rules', 'shortcutOptions']);
    const options = normalizeShortcutOptions(shortcutOptions);
    const allowAdvance = source === keyboardSource && !dryRun && options.autoNext;
    const rules = validateRules(saved);
    if (!rules.length && !dryRun) throw new Error('ยังไม่มีกฎที่บันทึกไว้ เปิดส่วนขยายแล้วบันทึกกฎก่อน');
    const token = crypto.randomUUID();
    const labels = await inject('collect', { token, allowAdvance });
    if (!labels.length) throw new Error('ไม่พบคำถามที่รองรับในหน้านี้ กรุณารอแบบฟอร์มโหลดหรือเปิดส่วนคำถาม');
    const matches = rules.length ? await timedMatch(rules, labels) : labels.map(() => []);
    const jobs = matches.map(indices => ({ rules: indices, ...(indices.length === 1 ? { value: rules[indices[0]].value } : {}) }));
    // File jobs can exceed the service worker's idle window, including after the popup closes.
    if (jobs.some(job => job.value?.type === 'file')) keepAlive = setInterval(() => { void chrome.tabs.get(tab.id).catch(() => {}); }, 20000);
    const files = await prepareFiles(jobs, dryRun);
    const rows = await inject('apply', { token, jobs, dryRun, files });
    report = { ok: true, dryRun, time: Date.now(), rows: rows.map(row => ({ label: normalizeLabel(row.label), rules: row.rules, code: row.code,
      ...(typeof row.diagnostic === 'string' && Object.hasOwn(FILE_DIAGNOSTICS, row.diagnostic) ? { diagnostic: row.diagnostic } : {}) })) };
    if (allowAdvance) {
      if (rows.some(row => ['stale', 'error', 'timeout', 'pending', 'file-manual', 'file-missing'].includes(row.code))) report.navigation = { code: 'stale' };
      else {
        try { report.navigation = await inject('advance', { token, allowIncomplete: options.allowIncomplete }); }
        catch { report.navigation = { code: 'error' }; }
      }
    }
  } catch (error) {
    report = { ok: false, dryRun, time: Date.now(), error: error.message || 'ทำงานไม่สำเร็จ โปรดลองใหม่', rows: [] };
  }
  try {
    report.version = chrome.runtime.getManifest().version;
    await chrome.storage.session.set({ [`report-${tab.id}`]: report });
    const count = report.rows.filter(row => row.code === (dryRun ? 'ready' : 'filled')).length;
    const needsReview = !report.ok || report.rows.some(row => ['ambiguous', 'blocked', 'missing', 'invalid', 'mismatch', 'stale', 'error', 'timeout', 'pending', 'file-manual', 'file-missing'].includes(row.code));
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: needsReview ? '#9f4d11' : '#176654' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: report.ok ? (dryRun ? 'DRY' : String(count)) : '!' });
    const fillMessage = report.ok ? `${dryRun ? 'พร้อมกรอก' : 'กรอกแล้ว'} ${count}/${report.rows.length} ข้อ · ${needsReview ? 'มีข้อที่ต้องตรวจ · ' : ''}ดูรายละเอียดในส่วนขยาย` : report.error;
    const message = report.navigation ? `${fillMessage} · ${NAVIGATION_STATUS[report.navigation.code] || NAVIGATION_STATUS.error}` : fillMessage;
    await chrome.action.setTitle({ tabId: tab.id, title: `Regex Form Filler · ${message}` });
    if (isFormUrl(tab.url)) await inject('notice', { message });
  } catch { /* Reporting must not retry a fill or expose answers in the console. */ }
  finally {
    clearInterval(keepAlive);
    if (isFormUrl(tab.url)) { try { await inject('release'); } catch { /* A navigation may have removed the document. */ } }
    runningTabs.delete(tab.id);
  }
  return report;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'matcher-ready' || message?.type === 'matcher-result') {
    matcherMessage(message, sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === 'run' && sender.id === chrome.runtime.id && sender.url === popupUrl && typeof message.dryRun === 'boolean') {
    runCurrentTab(message.dryRun).then(sendResponse, () => sendResponse({ ok: false, error: 'ทำงานไม่สำเร็จ โปรดลองใหม่' }));
    return true;
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'fill-form') void runCurrentTab(false, tab, keyboardSource);
});
chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.remove(`report-${tabId}`).catch(() => {});
});
