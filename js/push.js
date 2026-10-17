// Morning / evening push. The phone subscribes here; a scheduled GitHub Action sends the pushes.
import { VAPID_PUBLIC_KEY } from './config.js';
import { store, esc } from './util.js';
import { icon } from './icons.js';
import { paintSheet } from './overlay.js';
import { openTimePicker } from './timepicker.js';
import { leaveLead, planInfo, lastServerRun, schedulePlan, pipelineOn } from './notify.js';

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
        <summary>${icon('pencil')}כדי לשנות שעות מכאן: חיבור לגיטהאב (פעם אחת)</summary>
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
      ${connected ? `<button class="btn sm" data-push="test">${icon('bell')}דוגמה</button>` : perm !== 'denied' ? `<button class="btn sm primary" data-push="on" ${linked || sub ? '' : 'disabled'}>${icon('bellRing')}חיבור</button>` : ''}
    </div>
    <div class="set-row">
      <div class="grow"><b>🚗 התראת יציאה</b><small>לאירועים עם כתובת, עם כפתורי Waze ומפות</small></div>
      <select class="inp sm-sel" data-leave aria-label="כמה זמן לפני">${[[0, 'כבוי'], [20, '20 דק׳ לפני'], [30, 'חצי שעה לפני'], [45, '45 דק׳ לפני'], [60, 'שעה לפני'], [90, 'שעה וחצי לפני']].map(([v, l]) => `<option value="${v}" ${leaveLead() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${serverNote()}
    ${linked ? `<p class="small-print"><button class="link-btn" data-push="unlink">ניתוק גיטהאב מהטלפון</button></p>` : ''}`;
}

// is the GitHub job alive, and when was the reminders list last saved
function serverNote() {
  const run = pushInfo.lastRun, mins = run ? Math.round((Date.now() - run) / 60000) : null;
  const stale = mins != null && mins > 30;
  const plan = planInfo.at ? `${planInfo.count} התראות מתוכננות לימים הקרובים · עודכן ${new Date(planInfo.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<p class="push-msg ${stale ? 'warn' : ''}">${mins == null ? '' : stale ? `⚠️ שרת ההתראות לא רץ כבר ${mins >= 120 ? `${Math.round(mins / 60)} שעות` : `${mins} דק׳`}. התראות עלולות להתעכב.` : `שרת ההתראות פעיל · רץ לפני ${mins < 1 ? 'רגע' : `${mins} דק׳`}`}
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

async function registerDevice(sub) {
  const subs = await ghGet('push/subscriptions.json');
  if (!subs.some(x => x.endpoint === sub.endpoint)) { subs.push(sub); await ghPut('push/subscriptions.json', subs, 'Connect a phone for push'); }
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
    } else if (act === 'test') {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('☀️ בוקר טוב!', { body: 'שתי דקות לסדר את היום: אירועים, משימות ומיילים.', icon: 'icons/icon-192.png', badge: 'icons/badge.png', tag: 'test', data: { url: './?wizard=morning' }, dir: 'rtl', lang: 'he' });
      return;
    }
  } catch (err) { console.error(err); pushInfo.msg = 'לא הצליח: ' + err.message; }
  paintSheet();
});
