// Service worker: offline app shell + push notifications.
const VERSION = 'v45';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/data.js', 'js/demo.js', 'js/extras.js', 'js/google.js', 'js/icons.js',
  'js/overlay.js', 'js/push.js', 'js/sheets.js', 'js/ui.js', 'js/util.js', 'js/voice.js', 'js/wizard.js', 'js/timepicker.js', 'js/wear.js', 'js/datepicker.js', 'js/habits.js', 'js/habitui.js', 'js/emoji.js', 'js/habitstats.js', 'js/fx.js', 'js/bday.js', 'js/kv.js', 'js/notify.js', 'js/route.js',
  'icons/icon-192.png', 'icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first for our own files (always fresh when online), cache as fallback offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location).pathname)) return;
  e.respondWith(
    // no-cache: always revalidate with GitHub Pages so a new deploy shows up on the next open
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});

// ---------- notifications ----------
// The GitHub job (push/send.mjs) sends a JSON payload: title, body, tag, url, up to 2 buttons, and data for them.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() || {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'מה איתי היום?', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge.png', tag: d.tag || 'daily',
    data: { ...(d.data || {}), url: d.url || './', id: d.id, ids: d.ids, tag: d.tag || 'daily' },
    actions: (d.actions || []).slice(0, 2), dir: 'rtl', lang: 'he', renotify: true,
  }));
});

// a tiny key-value store, shared with the app (js/kv.js): keys for GitHub/Google, and marks waiting for the app
const db = () => new Promise((res, rej) => { const r = indexedDB.open('md', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
const kvGet = k => kv('readonly', s => s.get(k)).catch(() => undefined);
const kvSet = (k, v) => kv('readwrite', s => s.put(v, k)).catch(() => {});
async function enqueue(x) { const q = (await kvGet('queue')) || []; q.push({ ...x, at: Date.now() }); await kvSet('queue', q); }

// append to push-data/inbox.json in the repo, which the GitHub job reads (acks and "remind me later")
const API = 'https://api.github.com/repos/NOiNA-tv/my-day-organizer/contents/inbox.json';
const toB64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
async function inbox(entry) {
  const tok = await kvGet('gh');
  if (!tok) throw new Error('no key');
  const h = { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' };
  for (let k = 0; k < 3; k++) {
    const r = await fetch(API + '?ref=push-data', { headers: h, cache: 'no-store' });
    let list = [], sha;
    if (r.ok) { const j = await r.json(); sha = j.sha; try { list = JSON.parse(fromB64(j.content)); } catch { list = []; } }
    else if (r.status !== 404) throw new Error('GitHub ' + r.status);
    list.push({ ...entry, at: Date.now() });
    const w = await fetch(API, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'From a notification', branch: 'push-data', content: toB64(JSON.stringify(list, null, 1) + '\n'), ...(sha ? { sha } : {}) }) });
    if (w.ok) return;
    if (w.status !== 409 && w.status !== 422) throw new Error('GitHub ' + w.status);
  }
  throw new Error('busy');
}

// mark a Google task done right away when the last sign-in is still fresh; otherwise the app does it on open
async function completeTask(id, list) {
  const t = await kvGet('gtok');
  if (!t?.value || t.exp < Date.now() + 60000 || !id || !list) return false;
  const r = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list}/tasks/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
  return r.ok;
}

const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function confirmDone(d, title, msg) {
  const tag = d.tag || 'done';
  await self.registration.showNotification(title, { body: msg, tag, silent: true, renotify: false, icon: 'icons/icon-192.png', badge: 'icons/badge.png', dir: 'rtl', lang: 'he', data: { url: d.url || './', tag } });
  await new Promise(r => setTimeout(r, 4000));
  (await self.registration.getNotifications({ tag })).forEach(n => n.close());
}
async function focusOrOpen(target) {
  if (!target.startsWith(self.registration.scope)) return self.clients.openWindow(target); // e.g. the Digest site
  // the app is already open: tell it where to go (no reload, so the wizard/drawer opens right away)
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const w = wins.find(c => c.url.startsWith(self.registration.scope));
  if (w) {
    w.postMessage({ type: 'route', url: target });
    try { return await w.focus(); } catch { /* focus can be refused; open a window instead */ }
  }
  return self.clients.openWindow(target);
}

// "אחר כך" on a task: a second notification with the two likeliest times; a tap on it opens all the options
function laterChoices(now = new Date()) {
  const h = now.getHours(), at = (dd, hh) => { const x = new Date(now); x.setDate(x.getDate() + dd); x.setHours(hh, 0, 0, 0); return +x; };
  const ctx = h < 12 ? ['☀️ בצהריים', at(0, 13)] : h < 17 ? ['🌆 בערב', at(0, 19)] : h < 21 ? ['🌙 בלילה', at(0, 22)] : ['🌅 מחר בבוקר', at(1, 9)];
  return [['⏰ עוד שעה', +now + 3600e3], ctx];
}
async function fire(url) { try { await fetch(url, { mode: 'no-cors' }); return true; } catch { return false; } }

async function act(a, d, title) {
  const scope = self.registration.scope;
  const [kind, slot] = a.split(':');
  if (slot && d[slot]) {
    if (kind === 'md') { const ok = await fire(d[slot]); return ok ? undefined : confirmDone(d, title, 'MacroDroid לא ענה. כדאי לבדוק שהוא פועל.'); }
    if (kind === 'url') return self.clients.openWindow(d[slot]);
    if (kind === 'app') return focusOrOpen(new URL(d[slot], scope).href);
  }
  if (a === 'tlater') {
    const ch = laterChoices();
    return self.registration.showNotification(`⏰ מתי להזכיר? ${d.title || ''}`.trim(), {
      body: 'עוד אפשרויות (מחר, מחרתיים, שבוע הבא): לגעת כאן', tag: d.tag || 'later', renotify: false, silent: true,
      icon: 'icons/icon-192.png', badge: 'icons/badge.png', dir: 'rtl', lang: 'he',
      actions: ch.map(([label], i) => ({ action: 'snz' + i, title: label })),
      data: { ...d, choices: ch, url: `./?snooze=${encodeURIComponent(d.task)}&at=${d.at || Date.now()}` },
    });
  }
  if (a === 'snz0' || a === 'snz1') {
    const [label, until] = d.choices[Number(a.slice(3))];
    await enqueue({ t: 'taskMove', id: d.task, until });
    await inbox({ t: 'snooze', ids: [d.id], until }).catch(() => {});
    return confirmDone(d, (d.title || 'משימה'), `אזכיר ${label.replace(/^\S+\s/, '')}, בסביבות ${hhmm(until)}`);
  }
  if (!a && d.tapMd) { const ok = await fire(d.tapMd); if (ok) return; }
  if (a === 'done' || a === 'plus') {
    await enqueue({ t: 'habit', id: d.habit, day: d.day, op: a });
    await inbox({ t: 'ack', habits: [d.habit], day: d.day }).catch(() => {});
    return confirmDone(d, title, a === 'plus' ? 'נספר עוד אחד ➕' : 'סומן כבוצע ✓');
  }
  if (a === 'tdone') {
    const synced = await completeTask(d.task, d.list).catch(() => false);
    await enqueue({ t: 'task', id: d.task, synced });
    return confirmDone(d, title, 'סומן כבוצע ✓');
  }
  if (a === 'later') {
    const until = Date.now() + (d.later || 60) * 60000;
    const ok = await inbox({ t: 'snooze', ids: d.ids || [d.id], until }).then(() => true, () => false);
    return confirmDone(d, title, ok ? `אזכיר שוב ${(d.later || 60) >= 1440 ? 'מחר' : 'בעוד שעה'}, בסביבות ${hhmm(until)}` : 'לא הצלחתי לשמור את הדחייה. אפשר לנסות שוב מהאפליקציה.');
  }
  if (a === 'wa' && d.wa) return self.clients.openWindow(d.wa);
  if (a === 'tel' && d.tel) return focusOrOpen(new URL('./?tel=' + encodeURIComponent(d.tel), scope).href);
  if ((a === 'waze' || a === 'maps') && d[a]) return self.clients.openWindow(d[a]);
  return focusOrOpen(new URL(d.url || './', scope).href);
}

self.addEventListener('notificationclick', e => {
  const n = e.notification;
  n.close();
  e.waitUntil(act(e.action || '', n.data || {}, n.title));
});
