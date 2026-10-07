// Google OAuth via the browser redirect ("implicit") flow.
// No server, no popup: a full-page hop to Google and back with an access token in the URL hash.
// With prompt=none Google returns instantly when you're already signed in and consented.
import { CLIENT_ID, SCOPES, REDIRECT_URI } from './config.js';
import { store } from './util.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export const auth = {
  get configured() { return !!CLIENT_ID; },
  get token() {
    const t = store.get('token');
    return t && t.exp > Date.now() + 60_000 ? t.value : null;
  },
  get everConnected() { return !!store.get('connected'); },
  get email() { return store.get('email'); },

  // Call once on load, before anything else. Returns {returnTo} if we just came back from Google.
  handleRedirect() {
    if (!location.hash.includes('state=')) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const expected = sessionStorage.getItem('md:oauth-state');
    sessionStorage.removeItem('md:oauth-state');
    const [state, returnTo = ''] = (p.get('state') || '').split('|');
    if (!expected || state !== expected) return { error: 'state_mismatch' };
    if (p.get('error')) {
      store.set('silentFailedAt', Date.now());
      return { error: p.get('error'), returnTo };
    }
    store.set('token', { value: p.get('access_token'), exp: Date.now() + Number(p.get('expires_in') || 3600) * 1000 });
    store.set('connected', true);
    store.del('silentFailedAt');
    return { ok: true, returnTo };
  },

  // silent=true → prompt=none (no UI if already consented). Leaves the page.
  login({ silent = false, returnTo = '' } = {}) {
    const state = crypto.getRandomValues(new Uint32Array(2)).join('');
    sessionStorage.setItem('md:oauth-state', state);
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: SCOPES.join(' '),
      include_granted_scopes: 'true',
      state: `${state}|${returnTo}`,
      prompt: silent ? 'none' : 'consent',
    });
    if (this.email) q.set('login_hint', this.email);
    location.assign(`${AUTH_URL}?${q}`);
  },

  // Should we hop to Google silently right now? Avoids loops after a recent failure.
  shouldSilentRefresh() {
    if (!this.configured || !this.everConnected || this.token) return false;
    const failed = store.get('silentFailedAt');
    return !failed || Date.now() - failed > 10 * 60_000;
  },

  logout() {
    const t = store.get('token');
    if (t?.value) fetch(`https://oauth2.googleapis.com/revoke?token=${t.value}`, { method: 'POST' }).catch(() => {});
    ['token', 'connected', 'email', 'silentFailedAt', 'cache'].forEach(k => store.del(k));
  },
};
