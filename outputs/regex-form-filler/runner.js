import { matchWithTimeout } from './matcher.js';

const token = location.hash.slice(1);
try {
  const job = await chrome.runtime.sendMessage({ type: 'matcher-ready', token });
  if (!job?.ok) throw new Error('งานนี้หมดอายุแล้ว ปิดแท็บนี้ได้');
  let outcome;
  try { outcome = { matches: await matchWithTimeout(job.rules, job.labels) }; }
  catch (error) { outcome = { error: error.message }; }
  await chrome.runtime.sendMessage({ type: 'matcher-result', token, ...outcome });
} catch {
  document.getElementById('runner-status').textContent = 'งานนี้หมดอายุหรือถูกยกเลิกแล้ว ปิดแท็บนี้ได้';
}
