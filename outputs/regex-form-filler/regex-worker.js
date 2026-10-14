import { matchLabels } from './core.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ matches: matchLabels(data.rules, data.labels) }); }
  catch { self.postMessage({ error: 'ตรวจ regex ไม่สำเร็จ โปรดตรวจรูปแบบกฎและจำนวนคำถาม' }); }
};
