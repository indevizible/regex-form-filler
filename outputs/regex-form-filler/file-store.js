import { LIMITS, validateFileReference, validateRules } from './core.js';

const storageError = () => new Error('พื้นที่จัดเก็บไฟล์ไม่พร้อมหรือเต็ม · กฎเดิมยังอยู่');
const missingError = () => new Error('ไม่พบสำเนาไฟล์ที่ตรงกับกฎ · เลือกไฟล์ใหม่');
const sameRef = (a, b) => ['type', 'fileId', 'name', 'size', 'mime'].every(key => a?.[key] === b[key]);
function checkBlob(ref, blob) {
  if (!(blob instanceof Blob) || blob.size !== ref.size || blob.type !== ref.mime ||
      typeof blob.name === 'string' && blob.name !== ref.name) throw missingError();
}

export function createFileReference(file) {
  if (!(file instanceof Blob)) throw missingError();
  return validateFileReference({ type: 'file', fileId: crypto.randomUUID(), name: file.name, size: file.size, mime: file.type });
}

async function transaction(mode, action) {
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('regex-form-filler-files', 1);
      let failed = false;
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onerror = request.onblocked = () => { failed = true; reject(storageError()); };
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    });
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const request = action(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = tx.onerror = () => reject(storageError());
    });
  } catch { throw storageError(); }
  finally { db?.close(); }
}

export async function storeFile(value, blob) {
  const ref = validateFileReference(value);
  checkBlob(ref, blob);
  // add, never put: a staged save must not overwrite a previously referenced record.
  await transaction('readwrite', store => store.add({ ref, blob }, ref.fileId));
}

export async function loadFile(value) {
  const ref = validateFileReference(value);
  const record = await transaction('readonly', store => store.get(ref.fileId));
  if (!record || !sameRef(record.ref, ref)) throw missingError();
  checkBlob(ref, record.blob);
  return record.blob;
}

export async function deleteFiles(ids) {
  if (ids.length) await transaction('readwrite', store => { for (const id of ids) store.delete(id); });
}

export async function saveRulesWithFiles(previous, input, staged, writeRules, retainedRules = []) {
  const rules = validateRules(input);
  const ids = list => new Set(list.filter(rule => rule.value?.type === 'file').map(rule => rule.value.fileId));
  const kept = ids([...rules, ...retainedRules]);
  if (staged && !ids(rules).has(staged.ref.fileId)) throw missingError();
  if (staged) await storeFile(staged.ref, staged.blob);
  try { await writeRules(rules); }
  catch {
    if (staged) { try { await deleteFiles([staged.ref.fileId]); } catch { /* Keep orphaned bytes rather than risk old data. */ } }
    throw new Error('บันทึกกฎไม่สำเร็จ · กฎและไฟล์เดิมยังอยู่');
  }
  let cleanupFailed = false;
  try { await deleteFiles([...ids(previous)].filter(id => !kept.has(id))); }
  catch { cleanupFailed = true; }
  return { rules, cleanupFailed };
}

export async function prepareFiles(jobs, dryRun) {
  const refs = new Map();
  let total = 0;
  for (const job of jobs) {
    if (job.rules.length !== 1 || job.value?.type !== 'file') continue;
    const ref = validateFileReference(job.value);
    if (refs.has(ref.fileId)) {
      if (!sameRef(refs.get(ref.fileId), ref)) throw missingError();
      continue;
    }
    total += ref.size;
    if (total > LIMITS.payload) throw new Error('ไฟล์รวมต่อครั้งเกิน 20 MiB · ยังไม่เริ่มกรอก');
    refs.set(ref.fileId, ref);
  }
  const files = {};
  for (const ref of refs.values()) {
    const blob = await loadFile(ref);
    if (dryRun) continue;
    let bytes;
    try { bytes = new Uint8Array(await blob.arrayBuffer()); }
    catch { throw new Error('อ่านสำเนาไฟล์ไม่สำเร็จ · เลือกไฟล์ใหม่'); }
    if (bytes.length !== ref.size) throw missingError();
    const parts = [];
    // Multiples of three allow independently encoded chunks without intermediate padding.
    for (let offset = 0; offset < bytes.length; offset += 32766) {
      let binary = '';
      for (let end = Math.min(offset + 32766, bytes.length), i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
      parts.push(btoa(binary));
    }
    files[ref.fileId] = parts.join('');
  }
  return files;
}
