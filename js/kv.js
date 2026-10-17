// A tiny key-value store in IndexedDB, shared with the service worker (sw.js has the same few lines).
// Used for what the notification buttons need while the app is closed: keys, and a queue of marks.
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('md', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', mode), st = t.objectStore('kv');
    const req = fn(st);
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}
export const kv = {
  get: k => tx('readonly', st => st.get(k)).catch(() => undefined),
  set: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => {}),
  del: k => tx('readwrite', st => st.delete(k)).catch(() => {}),
};
