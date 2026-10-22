// Where notification taps and buttons land inside the app.
import { state, setTaskReminder, deferTask, addTask, toast, allTaskRoots } from './data.js';
import { openSheet, closeSheet } from './overlay.js';
import { openTask } from './sheets.js';
import { weatherLink } from './extras.js';
import { esc, hm, ymd, dayName, haptic } from './util.js';
import { snoozeItems } from './notify.js';

const at = (base, dd, h, m = 0) => { const x = new Date(base); x.setDate(x.getDate() + dd); x.setHours(h, m, 0, 0); return x; };

// "אחר כך" on a task: the full set of times, suited to the time of day
export function laterOptions(orig, now = new Date()) {
  const h = now.getHours();
  const ctx = h < 12 ? ['☀️ בצהריים', at(now, 0, 13)] : h < 17 ? ['🌆 בערב', at(now, 0, 19)] : h < 21 ? ['🌙 בלילה', at(now, 0, 22)] : ['🌅 מחר בבוקר', at(now, 1, 9)];
  const same = d => at(now, d, orig.getHours(), orig.getMinutes());
  return [
    ['⏰ עוד שעה', new Date(+now + 3600e3)], ctx,
    ['📅 מחר', same(1)], ['📅 מחרתיים', same(2)], [`🗓️ שבוע הבא (${dayName(same(7))})`, same(7)],
  ];
}

function snoozeSheet(taskId, origAt) {
  const t = state.tasks.find(x => x.id === taskId);
  const opts = laterOptions(new Date(origAt));
  openSheet(() => `
    <h3>⏰ מתי להזכיר?</h3>
    ${t ? `<p class="sub">${esc(t.title)}</p>` : ''}
    <div class="later-opts">${opts.map(([label, d], i) => `<button class="btn grow" data-later="${i}"><b>${label}</b><small>${d.toDateString() === new Date().toDateString() ? '' : `יום ${dayName(d)}, `}${hm(d)}</small></button>`).join('')}</div>
    <p class="small-print">או לפתוח את המשימה ולבחור שעה אחרת:</p>
    <div class="actions"><button class="btn" data-later-open>פתיחת המשימה</button></div>`);
  const el = document.querySelector('.sheet');
  el.addEventListener('click', e => {
    if (e.target.closest('[data-later-open]')) { closeSheet(); setTimeout(() => openTask(taskId), 280); return; }
    const b = e.target.closest('[data-later]'); if (!b) return;
    const [label, d] = opts[Number(b.dataset.later)];
    haptic(8);
    setTaskReminder(taskId, d);
    if (t?.due && t.due !== ymd(d)) deferTask(taskId, ymd(d), '', { silent: true });
    closeSheet();
    toast(`אזכיר ${label.replace(/^\S+\s/, '')}, ב־${hm(d)}`);
  });
}

// "אחר כך" for a habit (or any non-task) notification: pick a time, the job sends it again then
function laterSheet(ids, origAt, title) {
  const opts = laterOptions(new Date(origAt));
  openSheet(() => `
    <h3>⏰ מתי להזכיר?</h3>
    ${title ? `<p class="sub">${esc(title)}</p>` : ''}
    <div class="later-opts">${opts.map(([label, d], i) => `<button class="btn grow" data-later="${i}"><b>${label}</b><small>${d.toDateString() === new Date().toDateString() ? '' : `יום ${dayName(d)}, `}${hm(d)}</small></button>`).join('')}</div>`);
  document.querySelector('.sheet').addEventListener('click', async e => {
    const b = e.target.closest('[data-later]'); if (!b) return;
    const [label, d] = opts[Number(b.dataset.later)];
    haptic(8); closeSheet();
    const ok = await snoozeItems(ids, +d);
    toast(ok ? `אזכיר ${label.replace(/^\S+\s/, '')}, ב־${hm(d)}` : 'לא הצלחתי לשמור. כדאי לבדוק את החיבור לגיטהאב בהגדרות.');
  });
}

// cooking day: open (or start) "רשימת קניות" with the cursor in a new sub-item
async function shoppingList() {
  const title = 'רשימת קניות';
  let t = allTaskRoots().find(x => x.status !== 'completed' && x.title.trim() === title);
  if (!t) t = await addTask({ title });
  openTask(t.id);
  setTimeout(() => { const i = document.querySelector('.sheet [data-key="newsub"]'); i?.focus(); i?.scrollIntoView({ block: 'center' }); }, 350);
}

// the habit a notification was about: at the top of the dashboard, with a short glow
function highlightHabit(id) {
  if (!id) return;
  setTimeout(() => {
    const el = document.querySelector(`.body [data-hedit="${CSS.escape(id)}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + scrollY - 90;
    scrollTo({ top, behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 3200);
  }, 450);
}

function openDigest() {
  const b = document.querySelector('[data-act="digest"]');
  if (b) b.click();
}

function weather() { location.href = weatherLink(); }

export const routeExtras = { laterSheet, snoozeSheet, shoppingList, highlightHabit, openDigest, weather };
