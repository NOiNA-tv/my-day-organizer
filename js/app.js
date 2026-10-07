// Boot: auth hop → data → render. Deep links: ?wizard=morning|evening|mail
import { auth } from './auth.js';
import { state, init, subscribe, refresh } from './data.js';
import { render, mountFabs, bindMain, setHandlers, view } from './ui.js';
import { mountSnackbar, sheetOpen } from './overlay.js';
import { applyTheme } from './sheets.js';
import { openWizard, wizardOpen } from './wizard.js';
import { weather, latestDigest, markDigestSeen } from './extras.js';
import { loadPushInfo } from './push.js';

const back = auth.handleRedirect();
const params = new URLSearchParams(location.search);
const wantWizard = params.get('wizard') || back?.returnTo || '';
if (params.has('wizard')) history.replaceState(null, '', location.pathname);

// Token expired but we've connected before → quick silent hop to Google (no UI when already consented).
if (auth.shouldSilentRefresh()) {
  auth.login({ silent: true, returnTo: wantWizard });
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

  if (back?.error && back.error !== 'state_mismatch' && auth.everConnected) {
    console.warn('google auth', back.error);
  }
  if (wantWizard && ['morning', 'evening', 'mail'].includes(wantWizard)) {
    setTimeout(() => openWizard(wantWizard, document.querySelector('.fab'), extras()), 250);
  }

  // keep "in 25 min", the now-line and the ring fresh; resync when coming back to the app
  setInterval(() => { if (!sheetOpen() && !wizardOpen()) render(); }, 60_000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt < 5 * 60_000) return;
    if (state.mode === 'live' && !auth.token) return auth.login({ silent: true });
    refresh(); loadWeather(false);
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}
