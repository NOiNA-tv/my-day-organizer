// Boot: auth hop → data → render. Deep links: ?wizard=morning|evening|mail
import { auth } from './auth.js';
import { state, init, subscribe, refresh } from './data.js';
import { render, mountFabs, bindMain, setHandlers, view } from './ui.js';
import { mountSnackbar, sheetOpen } from './overlay.js';
import { applyTheme } from './sheets.js';
import { openWizard, wizardOpen } from './wizard.js';
import { weather, latestDigest, markDigestSeen } from './extras.js';
import { loadPushInfo } from './push.js';
import { loadHabits } from './habits.js';
import { startNotify, schedulePlan, drainQueue, migrateCalendarReminders } from './notify.js';
import { openTask, openEvent } from './sheets.js';
import { editBirthday, birthdayById } from './bday.js';
import { routeExtras } from './route.js';
import { store } from './util.js';

const back = auth.handleRedirect();
const params = new URLSearchParams(location.search);
// deep links (from notifications): wizard, digest, event, task, snooze, habits(&h), shop, bday, tel, weather.
// Kept across the quick sign-in hop to Google, which would otherwise drop them.
const ROUTE_KEYS = ['wizard', 'digest', 'event', 'task', 'snooze', 'later', 'habits', 'shop', 'bday', 'tel', 'weather'];
let pending = [...params.keys()].some(k => ROUTE_KEYS.includes(k)) ? location.search : (sessionStorage.getItem('route') || '');
if (back?.returnTo && !pending) pending = `?wizard=${back.returnTo}`;
sessionStorage.removeItem('route');
if (location.search) history.replaceState(null, '', location.pathname);
const tel = new URLSearchParams(pending).get('tel');
if (tel) { location.href = 'tel:' + tel.replace(/[^\d+]/g, ''); pending = ''; }

// Token expired but we've connected before → quick silent hop to Google (no UI when already consented).
if (auth.shouldSilentRefresh()) {
  if (pending) sessionStorage.setItem('route', pending);
  auth.login({ silent: true });
} else {
  boot();
}

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  mountFabs();
  mountSnackbar();
  bindMain();

  const loadWeather = async force => { try { view.weather = await weather({ force }); render(); } catch (e) { console.warn('weather', e); } };
  const extras = () => ({ weather: view.weather, digest: view.digest, onDigest: id => { markDigestSeen(id); if (view.digest) view.digest.seen = true; render(); } });

  setHandlers({
    login: () => auth.login({ silent: false }),
    weather: loadWeather,
    wizard: (mode, origin) => openWizard(mode, origin, extras()),
    digestSeen: id => { markDigestSeen(id); if (view.digest?.id === id) view.digest.seen = true; if (view.issues?.[id]) view.issues[id].seen = true; },
  });

  let raf = 0;
  subscribe(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
  render();
  document.querySelector('.splash')?.remove();

  await Promise.all([init(), loadWeather(false), latestDigest().then(d => { view.digest = d; }), loadPushInfo()]);
  render();
  if (pending) setTimeout(() => route(pending), 200);
  // the service worker asks an already-open app to go somewhere (no reload)
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'route') route(new URL(e.data.url).search); });
  loadHabits().then(async () => {
    await drainQueue();
    await migrateCalendarReminders();
    startNotify();
    schedulePlan(3000);
  });

  if (back?.error && back.error !== 'state_mismatch' && auth.everConnected) {
    console.warn('google auth', back.error);
  }
  async function route(search) {
    const q = new URLSearchParams(search);
    const wz = q.get('wizard');
    if (wz && ['morning', 'evening', 'mail'].includes(wz)) { if (!wizardOpen()) openWizard(wz, document.querySelector('.fab'), extras()); return; }
    if (q.get('tel')) { location.href = 'tel:' + q.get('tel').replace(/[^\d+]/g, ''); return; }
    if (q.has('habits')) { view.habitsOpen = true; render(); routeExtras.highlightHabit(q.get('h')); return; }
    if (q.get('event')) { if (!state.events.some(e => e.id === q.get('event'))) await refresh(); openEvent(q.get('event')); return; }
    if (q.get('task')) { if (!state.tasks.some(t => t.id === q.get('task'))) await refresh(); openTask(q.get('task')); return; }
    if (q.get('snooze')) { routeExtras.snoozeSheet(q.get('snooze'), Number(q.get('at')) || Date.now()); return; }
    if (q.get('later')) {
      if (q.get('task')) routeExtras.snoozeSheet(q.get('task'), Number(q.get('at')) || Date.now());
      else routeExtras.laterSheet(q.get('later').split(','), Number(q.get('at')) || Date.now(), q.get('title') || '');
      return;
    }
    if (q.has('shop')) { routeExtras.shoppingList(); return; }
    if (q.get('bday')) { const ev = birthdayById(q.get('bday')); if (ev) editBirthday(ev); return; }
    if (q.get('digest')) { routeExtras.openDigest(q.get('digest')); return; }
    if (q.has('weather')) { routeExtras.weather(); return; }
  }

  // keep "in 25 min", the now-line and the ring fresh; resync when coming back to the app
  setInterval(() => { if (!sheetOpen() && !wizardOpen()) render(); }, 60_000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drainQueue(); }); // marks from notification buttons
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt < 5 * 60_000) return;
    if (state.mode === 'live' && !auth.token) return auth.login({ silent: true });
    refresh().then(loadHabits).then(drainQueue).then(() => schedulePlan(2000)); loadWeather(false);
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}
