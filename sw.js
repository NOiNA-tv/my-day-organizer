// Service worker: offline app shell + push notifications.
const VERSION = 'v14';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/data.js', 'js/demo.js', 'js/extras.js', 'js/google.js', 'js/icons.js',
  'js/overlay.js', 'js/push.js', 'js/sheets.js', 'js/ui.js', 'js/util.js', 'js/voice.js', 'js/wizard.js', 'js/timepicker.js',
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

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() || {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'מה איתי היום?', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge.png', tag: d.tag || 'daily',
    data: { url: d.url || './' }, dir: 'rtl', lang: 'he', renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.registration.scope));
    if (w) { await w.navigate(target); return w.focus(); }
    return self.clients.openWindow(target);
  })());
});
