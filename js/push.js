// Morning / evening push. The phone subscribes here; a scheduled GitHub Action sends the pushes.
import { VAPID_PUBLIC_KEY, APP_VERSION } from './config.js';
import { store, esc } from './util.js';
import { icon } from './icons.js';
import { paintSheet } from './overlay.js';
import { openTimePicker } from './timepicker.js';
import { leaveLead, planInfo, lastServerRun, schedulePlan, pipelineOn, pipelineMissing, recoverSub, writePlan } from './notify.js';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Morning/evening times and the list of connected phones live in the repo (push/*.json); a GitHub Action reads them.
// With a GitHub key saved on this phone, the app edits those files itself — no trips to GitHub.
const REPO = 'NOiNA-tv/my-day-organizer';
const API = `https://api.github.com/repos/${REPO}/contents/`;
export const pushInfo = { schedule: null, endpoints: [], shas: {}, saving: false, msg: '' };
export const ghToken = () => store.get('ghToken');
const utf8b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64utf8 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));

// branch: 'main' for the schedule and the phone list; 'push-data' for the reminders plan (no Pages rebuilds)
export async function ghGet(path, branch = 'main') {
  const r = await fetch(API + path + `?ref=${branch}`, { headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (r.status === 404 && branch !== 'main') { delete pushInfo.shas[branch + ':' + path]; return null; }
  if (!r.ok) throw new Error(r.status === 401 ? 'המפתח לא תקין' : r.status === 404 ? 'אין גישה לקובץ (בדוק את הרשאת Contents)' : `GitHub ${r.status}`);
  const j = await r.json();
  pushInfo.shas[branch + ':' + path] = j.sha;
  return JSON.parse(b64utf8(j.content));
}
export async function ghPut(path, data, message, branch = 'main') {
  const body = { message, content: utf8b64(JSON.stringify(data, null, 2) + '\n'), branch };
  const sha = pushInfo.shas[branch + ':' + path]; if (sha) body.sha = sha;
  const r = await fetch(API + path, { method: 'PUT', headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error(r.status === 403 ? 'למפתח אין הרשאת כתיבה (Contents: Read and write)' : `GitHub ${r.status}`);
  pushInfo.shas[branch + ':' + path] = (await r.json()).content.sha;
}
export const hasGh = () => !!ghToken();

export async function loadPushInfo() {
  lastServerRun().then(d => { pushInfo.lastRun = d; });
  try {
    if (ghToken()) {
      const [sch, subs] = await Promise.all([ghGet('push/schedule.json'), ghGet('push/subscriptions.json')]);
      pushInfo.schedule = sch; pushInfo.endpoints = subs.map(x => x.endpoint); pushInfo.subs = subs;
    } else {
      const [sch, subs] = await Promise.all([fetch('push/schedule.json', { cache: 'no-store' }).then(r => r.json()), fetch('push/subscriptions.json', { cache: 'no-store' }).then(r => r.json())]);
      pushInfo.schedule = sch; pushInfo.endpoints = subs.map(x => x.endpoint);
    }
  } catch (e) { pushInfo.msg = e.message; }
  await ensureSub().catch(e => console.warn('push address', e));
  report().catch(() => {});
}

// ---------- the phone's push address ----------
// Browsers expire and renew these; a stale one gets "410 Gone" from Google and nothing arrives.
// Keep the stored copy and the server's list in step with the real one. Every step is logged for the check below.
const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('שירות הרקע לא עלה')), 8000))]);
const log = [];
const step = (ok, label, detail = '') => { log.push({ ok, label, detail, at: Date.now() }); return ok; };
export async function ensureSub({ fresh = false } = {}) {
  log.length = 0;
  if (!supported) { step(false, 'הדפדפן לא תומך בהתראות'); return null; }
  step(Notification.permission === 'granted', 'הרשאת התראות', Notification.permission);
  if (Notification.permission !== 'granted') return null;
  const reg = await swReady();
  step(!!reg.active, 'שירות הרקע (service worker) פעיל', reg.active?.scriptURL?.split('/').pop() || '');
  let s = await reg.pushManager.getSubscription();
  step(!!s, 'כתובת התראות קיימת בטלפון', s ? '…' + s.endpoint.slice(-12) : 'אין');
  const diag = ghToken() ? await ghGet('state.json', 'push-state').then(x => x?.diag).catch(() => null) : null;
  pushInfo.diag = diag;
  const dead = diag?.sendErr && /^(404|410)/.test(diag.sendErr) && diag.sendAt > (store.get('subRenewedAt') || 0);
  if (s && (fresh || dead)) {
    step(true, dead ? 'השרת דיווח שהכתובת פגה: מחדש' : 'מחדש כתובת', diag?.sendErr || '');
    await s.unsubscribe().catch(e => step(false, 'ביטול הכתובת הישנה', e.message));
    s = null; store.set('subRenewedAt', Date.now());
  }
  if (!s) {
    try { s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) }); step(true, 'נוצרה כתובת חדשה', '…' + s.endpoint.slice(-12)); }
    catch (e) { step(false, 'יצירת כתובת חדשה נכשלה', e.message); return null; }
  }
  const live = s.toJSON();
  store.set('pushSub', live);
  if (!ghToken()) { step(false, 'אין חיבור לגיטהאב בטלפון'); return live; }
  if (!pushInfo.subs) { try { pushInfo.subs = await ghGet('push/subscriptions.json'); pushInfo.endpoints = pushInfo.subs.map(x => x.endpoint); } catch (e) { step(false, 'קריאת רשימת הטלפונים', e.message); return live; } }
  if (!pushInfo.endpoints.includes(live.endpoint) || pushInfo.endpoints.length > 1) {
    try { await registerDevice(live); step(true, 'הכתובת נרשמה בשרת'); }
    catch (e) { step(false, 'רישום הכתובת בשרת נכשל', e.message); return live; }
  }
  step(pushInfo.endpoints.includes(live.endpoint), 'השרת שולח לכתובת הנוכחית');
  return live;
}

// what this phone sees, saved to push-data/device.json so problems can be read from outside
async function report(extra = {}) {
  if (!ghToken()) return;
  const data = { at: new Date().toISOString(), ver: APP_VERSION, ua: navigator.userAgent.slice(0, 160), standalone: matchMedia('(display-mode: standalone)').matches,
    perm: supported ? Notification.permission : 'unsupported', endpoint: store.get('pushSub')?.endpoint?.slice(-16) || '', steps: log.map(x => [x.ok ? '✓' : '✗', x.label, x.detail]), ...extra };
  for (let k = 0; k < 2; k++) {
    try { await ghGet('device.json', 'push-data'); await ghPut('device.json', data, 'Device report', 'push-data'); return; }
    catch (e) { if (!e.conflict) return; }
  }
}

// the full check in settings: each step on screen, ✓ or ✗
export const checkState = { running: false, rows: [] };
async function fullCheck() {
  checkState.running = true; checkState.rows = []; paintSheet();
  const live = await ensureSub({ fresh: true }).catch(e => { step(false, 'שגיאה', e.message); return null; });
  // a notification shown by the phone itself, no server: proves the phone can display them
  try {
    const reg = await swReady();
    await reg.showNotification('🔔 בדיקה מקומית', { body: 'אם רואים את זה, הטלפון מציג התראות של האפליקציה.', tag: 'local-check', icon: 'icons/icon-192.png', badge: 'icons/badge.png', dir: 'rtl', lang: 'he' });
    step(true, 'התראה מקומית נשלחה (אמורה להופיע עכשיו)');
  } catch (e) { step(false, 'התראה מקומית נכשלה', e.message); }
  const run = await lastServerRun();
  const mins = run ? Math.round((Date.now() - run) / 60000) : null;
  step(mins != null && mins <= 15, 'שרת ההתראות רץ', mins == null ? 'לא ידוע' : `לפני ${mins} דק׳`);
  if (live && ghToken()) {
    store.set('testPush', Date.now() + 60000);
    await writePlan({ force: true });
    step(!planInfo.error, 'תזכורת לדוגמה נשמרה לשליחה', planInfo.error || 'תגיע תוך כמה דקות');
  }
  checkState.rows = [...log];
  checkState.running = false;
  await report({ check: true });
  paintSheet();
}

export function pushPanel() {
  if (!supported) return `<p class="sub">הדפדפן הזה לא תומך בהתראות. כדאי להתקין את האפליקציה למסך הבית ולנסות שוב.</p>`;
  const sch = pushInfo.schedule || { morning: '07:30', evening: '20:30' };
  const linked = !!ghToken();
  const sub = store.get('pushSub');
  const connected = sub && pushInfo.endpoints.includes(sub.endpoint);
  const perm = Notification.permission;
  return `
    <div class="push-times">
      <label><span>☀️ אשף הבוקר</span><button class="inp time-btn" data-push-pick="morning" ${linked ? '' : 'disabled'}>${sch.morning}</button></label>
      <label><span>🌙 סיכום ערב</span><button class="inp time-btn" data-push-pick="evening" ${linked ? '' : 'disabled'}>${sch.evening}</button></label>
    </div>
    ${pushInfo.msg ? `<p class="push-msg">${esc(pushInfo.msg)}</p>` : ''}
    ${linked ? '' : `
      <details class="gh-setup">
        <summary>${icon('pencil')}חיבור לגיטהאב (פעם אחת): נדרש לתזכורות ולשינוי השעות</summary>
        <ol>
          <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">פתיחת יצירת מפתח בגיטהאב</a></li>
          <li>Token name: <code>my-day-organizer</code> · Expiration: <b>No expiration</b></li>
          <li>Repository access: <b>Only select repositories</b> ← <code>my-day-organizer</code></li>
          <li>Permissions ← Repository permissions ← <b>Contents: Read and write</b></li>
          <li><b>Generate token</b>, להעתיק ולהדביק כאן:</li>
        </ol>
        <div class="rem-row"><input class="inp" data-gh-token placeholder="github_pat_…" dir="ltr" autocomplete="off"><button class="btn sm primary" data-push="link">שמירה</button></div>
        <p class="small-print">המפתח נשמר רק בטלפון הזה ומאפשר לשנות רק את המאגר של האפליקציה.</p>
      </details>`}
    <div class="set-row">
      <div class="grow"><b>${connected ? 'הטלפון הזה מקבל התראות ✓' : perm === 'denied' ? 'ההתראות חסומות בדפדפן' : 'הטלפון הזה לא מחובר להתראות'}</b>
        <small>${connected ? 'גם כשהאפליקציה סגורה. התראות מגיעות בדרך כלל עד כמה דקות אחרי השעה שנקבעה.' : linked ? 'לחיצה אחת מחברת אותו.' : 'אחרי החיבור לגיטהאב זה נעשה בלחיצה אחת.'}</small></div>
      ${connected ? `<button class="btn sm" data-push="sample">${icon('bell')}דוגמה</button>` : perm !== 'denied' ? `<button class="btn sm primary" data-push="on" ${linked || sub ? '' : 'disabled'}>${icon('bellRing')}חיבור</button>` : ''}
    </div>
    <div class="set-row">
      <div class="grow"><b>🚗 התראת יציאה</b><small>לאירועים עם כתובת, עם כפתורי Waze ומפות</small></div>
      <select class="inp sm-sel" data-leave aria-label="כמה זמן לפני">${[[0, 'כבוי'], [20, '20 דק׳ לפני'], [30, 'חצי שעה לפני'], [45, '45 דק׳ לפני'], [60, 'שעה לפני'], [90, 'שעה וחצי לפני']].map(([v, l]) => `<option value="${v}" ${leaveLead() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="set-row">
      <div class="grow"><b>בדיקת התראות</b><small>בודקת כל שלב, מחדשת את הכתובת של הטלפון ושולחת תזכורת לדוגמה</small></div>
      <button class="btn sm ${checkState.running ? 'busy' : ''}" data-push="check" ${checkState.running ? 'disabled' : ''}>${checkState.running ? 'בודק…' : 'בדיקה'}</button>
    </div>
    ${checkState.rows.length ? `<ul class="push-check">${checkState.rows.map(r => `<li class="${r.ok ? 'ok' : 'bad'}"><span>${r.ok ? '✓' : '✗'}</span><b>${esc(r.label)}</b>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${serverNote()}
    ${linked ? `<p class="small-print"><button class="link-btn" data-push="unlink">ניתוק גיטהאב מהטלפון</button></p>` : ''}`;
}

// is the GitHub job alive, and when was the reminders list last saved
function serverNote() {
  const run = pushInfo.lastRun, mins = run ? Math.round((Date.now() - run) / 60000) : null;
  const stale = mins != null && mins > 30;
  const plan = planInfo.at ? `${planInfo.count} התראות מתוכננות לימים הקרובים · עודכן ${new Date(planInfo.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<p class="push-msg ${stale ? 'warn' : ''}">${mins == null ? '' : stale ? `⚠️ שרת ההתראות לא רץ כבר ${mins >= 120 ? `${Math.round(mins / 60)} שעות` : `${mins} דק׳`}. התראות עלולות להתעכב.` : `שרת ההתראות פעיל · רץ לפני ${mins < 1 ? 'רגע' : `${mins} דק׳`}`}
    ${pushInfo.diag?.okAt ? `<br>התראה נשלחה בהצלחה לאחרונה: ${new Date(pushInfo.diag.okAt).toLocaleString('he-IL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}${pushInfo.diag?.sendErr && pushInfo.diag.sendAt > (pushInfo.diag.okAt || 0) ? `<br>⚠️ שליחה אחרונה נכשלה: ${esc(pushInfo.diag.sendErr)}` : ''}
    ${plan ? `<br>${plan}` : pipelineOn() ? '<br>רשימת ההתראות תישמר בעוד רגע.' : ''}${planInfo.error ? `<br>שמירת ההתראות נכשלה: ${esc(planInfo.error)}` : ''}</p>`;
}

async function saveTimes(kind, value) {
  pushInfo.saving = true; pushInfo.msg = 'שומר…'; paintSheet();
  try {
    const sch = await ghGet('push/schedule.json');
    sch[kind] = value;
    await ghPut('push/schedule.json', sch, `Push time: ${kind} ${value}`);
    pushInfo.schedule = sch; pushInfo.msg = `נשמר ✓ ${kind === 'morning' ? 'אשף הבוקר' : 'סיכום הערב'} ב־${value}`;
  } catch (e) { pushInfo.msg = 'לא נשמר: ' + e.message; }
  pushInfo.saving = false; paintSheet();
}

// one person, one phone: the list is just this phone's current address (old, expired ones only cause 410s)
async function registerDevice(sub) {
  await ghGet('push/subscriptions.json');
  const subs = [sub];
  await ghPut('push/subscriptions.json', subs, 'Connect a phone for push');
  pushInfo.endpoints = subs.map(x => x.endpoint);
}

document.addEventListener('change', e => {
  if (e.target.matches('[data-leave]')) { store.set('leaveLead', Number(e.target.value)); schedulePlan(0); return; }
  const t = e.target.closest('[data-push-time]');
  if (t && t.value) saveTimes(t.dataset.pushTime, t.value);
});

const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };

document.addEventListener('click', async e => {
  const pk = e.target.closest('[data-push-pick]');
  if (pk) { const k = pk.dataset.pushPick; openTimePicker({ value: pk.textContent.trim(), title: k === 'morning' ? 'אשף הבוקר' : 'סיכום ערב', onSave: v => saveTimes(k, v) }); return; }
  const b = e.target.closest('[data-push]'); if (!b) return;
  const act = b.dataset.push;
  try {
    if (act === 'link') {
      const v = document.querySelector('[data-gh-token]')?.value.trim();
      if (!v) return;
      store.set('ghToken', v); pushInfo.msg = 'בודק…'; paintSheet();
      try { await loadPushInfo(); pushInfo.msg = pushInfo.msg === 'בודק…' ? 'גיטהאב מחובר ✓ אפשר לשנות שעות.' : pushInfo.msg; }
      catch (err) { store.del('ghToken'); pushInfo.msg = err.message; }
      if (pushInfo.msg && !pushInfo.msg.includes('✓')) store.del('ghToken');
    } else if (act === 'unlink') { store.del('ghToken'); pushInfo.msg = ''; }
    else if (act === 'on') {
      const reg = await navigator.serviceWorker.ready;
      if (await Notification.requestPermission() !== 'granted') return paintSheet();
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
      store.set('pushSub', sub.toJSON());
      if (ghToken()) { pushInfo.msg = 'מחבר…'; paintSheet(); await registerDevice(sub.toJSON()); pushInfo.msg = 'הטלפון מחובר ✓'; }
    } else if (act === 'check') { await fullCheck(); return;
    } else if (act === 'sample') {
      // all the way through: saved in the plan, sent by the job in a few minutes, with buttons
      await ensureSub().catch(() => {});
      const miss = pipelineMissing();
      if (miss) { pushInfo.msg = miss; return paintSheet(); }
      b.disabled = true; b.classList.add('busy'); b.textContent = 'שולח…';
      store.set('testPush', Date.now() + 60000);
      await writePlan({ force: true });
      const ok = !planInfo.error;
      b.classList.remove('busy'); b.textContent = ok ? 'נשלח ✓' : 'נכשל';
      pushInfo.msg = ok ? `תזכורת לדוגמה תגיע בסביבות ${new Date(Date.now() + 60000).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}, עד כמה דקות אחרי.` : 'לא נשמר: ' + planInfo.error;
      setTimeout(paintSheet, 1600);
      return;
    }
  } catch (err) { console.error(err); pushInfo.msg = 'לא הצליח: ' + err.message; }
  paintSheet();
});
