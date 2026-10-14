// IndexedDB boundary double for Node only. Browser fixtures use real IndexedDB.
export function fakeIDB() {
  const records = new Map(), reads = [];
  const state = { records, reads, failWrite: false, failRead: false, failDelete: false, unavailable: false };
  const defer = fn => setTimeout(fn, 0);
  const db = {
    createObjectStore() {}, close() {},
    transaction(name, mode) {
      if (name !== 'files') throw new Error('unexpected store');
      const tx = { error: null, objectStore: () => store };
      const pending = new Map(records);
      let scheduled = false;
      const request = (kind, key, value) => {
        const req = {};
        defer(() => {
          if (kind === 'get') reads.push(key);
          if (state.failRead && kind === 'get' || state.failWrite && kind === 'add' || state.failDelete && kind === 'delete' || kind === 'add' && pending.has(key)) {
            tx.error = new Error('synthetic IDB failure'); req.error = tx.error;
            req.onerror?.(); tx.onabort?.(); return;
          }
          if (kind === 'get') req.result = pending.get(key);
          if (kind === 'add') pending.set(key, value);
          if (kind === 'delete') pending.delete(key);
          req.onsuccess?.();
          if (!scheduled) {
            scheduled = true;
            defer(() => {
              if (tx.error) return;
              if (mode === 'readwrite') { records.clear(); pending.forEach((v, k) => records.set(k, v)); }
              tx.oncomplete?.();
            });
          }
        });
        return req;
      };
      const store = { get: id => request('get', id), add: (record, id) => request('add', id, record), delete: id => request('delete', id) };
      return tx;
    }
  };
  state.api = { open() {
    const req = {};
    defer(() => {
      if (state.unavailable) { req.onerror?.(); return; }
      req.result = db; req.onupgradeneeded?.(); req.onsuccess?.();
    });
    return req;
  } };
  return state;
}
export const fileRef = (extra = {}) => ({ type: 'file', fileId: 'b0c51dee-4347-4f82-85de-a070a975db82', name: 'TEST-ONLY.pdf', size: 4, mime: 'application/pdf', ...extra });
export const fileRule = (value = fileRef(), pattern = '^Upload$') => ({ pattern, flags: 'iu', value });
export const testFile = (name = 'TEST-ONLY.pdf', body = 'test', type = 'application/pdf') => new File([body], name, { type });
