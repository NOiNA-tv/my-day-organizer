// Morning / evening push. The phone subscribes here; a scheduled GitHub Action sends the pushes.
import { VAPID_PUBLIC_KEY } from './config.js';
import { store, esc } from './util.js';
import { icon } from './icons.js';
import { paintSheet } from './overlay.js';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function pushPanel() {
  if (!supported) return `<p class="sub">הדפדפן הזה לא תומך בהתראות. כדאי להתקין את האפליקציה למסך הבית ולנסות שוב.</p>`;
  if (!VAPID_PUBLIC_KEY) return `<p class="sub">עוד לא הופעל. זה יעבוד אחרי שהאפליקציה תעלה לאוויר.</p>`;
  const sub = store.get('pushSub');
  const perm = Notification.permission;
  if (perm === 'denied') return `<p class="sub">ההתראות חסומות. אפשר לשחרר בהגדרות האתר בדפדפן.</p>`;
  if (!sub) return `
    <div class="set-row"><div class="grow"><b>☀️ 07:30 ו־🌙 20:30</b><small>תזכורת לפתוח את אשף הבוקר ואת סיכום הערב</small></div>
    <button class="btn sm primary" data-push="on">${icon('bellRing')}הפעלה</button></div>`;
  return `
    <div class="set-row"><div class="grow"><b>ההתראות פעילות במכשיר הזה</b><small>כדי שיגיעו גם כשהאפליקציה סגורה, צריך לחבר את המכשיר פעם אחת: להעתיק את הקוד ולשלוח אותו ל־Claude.</small></div></div>
    <code class="copy">${esc(JSON.stringify(sub))}</code>
    <div class="actions" style="margin-top:10px">
      <button class="btn sm" data-push="copy">העתקת הקוד</button>
      <button class="btn sm" data-push="test">${icon('bell')}התראת ניסיון</button>
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
