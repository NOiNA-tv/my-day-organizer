// Morning / evening push. The phone subscribes here; a scheduled GitHub Action sends the pushes.
import { VAPID_PUBLIC_KEY } from './config.js';
import { store, esc } from './util.js';
import { icon } from './icons.js';
import { paintSheet } from './overlay.js';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// times + which devices are connected live in the repo (push/*.json); the Action reads them
export const pushInfo = { schedule: null, endpoints: [] };
export async function loadPushInfo() {
  try {
    const [sch, subs] = await Promise.all([fetch('push/schedule.json', { cache: 'no-cache' }).then(r => r.json()), fetch('push/subscriptions.json', { cache: 'no-cache' }).then(r => r.json())]);
    pushInfo.schedule = sch; pushInfo.endpoints = subs.map(x => x.endpoint);
  } catch { /* offline */ }
}
const EDIT_TIMES = 'https://github.com/NOiNA-tv/my-day-organizer/edit/main/push/schedule.json';
const RUN_NOW = 'https://github.com/NOiNA-tv/my-day-organizer/actions/workflows/daily-push.yml';

export function pushPanel() {
  if (!supported) return `<p class="sub">הדפדפן הזה לא תומך בהתראות. כדאי להתקין את האפליקציה למסך הבית ולנסות שוב.</p>`;
  if (!VAPID_PUBLIC_KEY) return `<p class="sub">עוד לא הופעל.</p>`;
  const sub = store.get('pushSub');
  const perm = Notification.permission;
  const sch = pushInfo.schedule;
  const times = `
    <div class="set-row"><div class="grow"><b>☀️ ${sch?.morning || '07:30'} · 🌙 ${sch?.evening || '20:30'}</b><small>שעות התזכורת לאשף הבוקר ולסיכום הערב</small></div>
      <a class="btn sm" href="${EDIT_TIMES}" target="_blank" rel="noopener">${icon('pencil')}שינוי שעות</a></div>
    <p class="small-print" style="margin-top:4px">השינוי נעשה בקובץ קטן בגיטהאב: מחליפים את השעות ולוחצים Commit changes. ההתראה יכולה להגיע עד כרבע שעה אחרי השעה שנקבעה.</p>`;
  if (perm === 'denied') return `<p class="sub">ההתראות חסומות. אפשר לשחרר בהגדרות האתר בדפדפן.</p>`;
  if (!sub) return `${times}
    <div class="set-row"><div class="grow"><b>המכשיר הזה עוד לא מחובר</b><small>הפעלה ואז שליחת הקוד ל־Claude</small></div>
    <button class="btn sm primary" data-push="on">${icon('bellRing')}הפעלה</button></div>`;
  const connected = pushInfo.endpoints.includes(sub.endpoint);
  return `${times}
    <div class="set-row"><div class="grow"><b>${connected ? 'המכשיר מחובר ✓' : 'ממתין לחיבור'}</b><small>${connected ? 'התזכורות יגיעו גם כשהאפליקציה סגורה.' : 'צריך להעתיק את הקוד ולשלוח אותו ל־Claude.'}</small></div></div>
    ${connected ? '' : `<code class="copy">${esc(JSON.stringify(sub))}</code>`}
    <div class="actions" style="margin-top:10px">
      ${connected ? `<a class="btn sm" href="${RUN_NOW}" target="_blank" rel="noopener">${icon('bell')}שליחה עכשיו (Run workflow)</a>` : `<button class="btn sm" data-push="copy">העתקת הקוד</button>`}
      <button class="btn sm" data-push="test">${icon('bell')}איך זה ייראה</button>
      <button class="btn sm danger" data-push="off">כיבוי</button>
    </div>`;
}

const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-push]'); if (!b) return;
  const reg = await navigator.serviceWorker.ready;
  const act = b.dataset.push;
  try {
    if (act === 'on') {
      if (await Notification.requestPermission() !== 'granted') return paintSheet();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
      store.set('pushSub', sub.toJSON());
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(JSON.stringify(store.get('pushSub')));
      b.textContent = 'הועתק ✓';
      return;
    } else if (act === 'test') {
      reg.showNotification('☀️ בוקר טוב!', { body: 'יש לך 3 אירועים ו־4 משימות היום. 2 דקות לסדר אותם?', icon: 'icons/icon-192.png', badge: 'icons/badge.png', tag: 'test', data: { url: './?wizard=morning' }, dir: 'rtl', lang: 'he' });
      return;
    } else if (act === 'off') {
      (await reg.pushManager.getSubscription())?.unsubscribe();
      store.del('pushSub');
    }
  } catch (err) { console.error(err); alert('ההתראות לא הופעלו: ' + err.message); }
  paintSheet();
});
