// Demo backend: same interface as google.js, realistic data anchored to "now".
import { startOfDay, addDays, ymd, uid } from './util.js';

const today = startOfDay(new Date());
const at = (dayOffset, h, m = 0) => { const d = addDays(today, dayOffset); d.setHours(h, m, 0, 0); return d; };
const rel = (minutes) => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(Math.round((d.getMinutes() + minutes) / 5) * 5); return d; };

const cals = [
  { id: 'me', name: 'אישי', color: '#039be5', primary: true, accessRole: 'owner', defaultReminders: [{ method: 'popup', minutes: 30 }] },
  { id: 'work', name: 'עבודה', color: '#0b8043', primary: false, accessRole: 'owner', defaultReminders: [{ method: 'popup', minutes: 10 }] },
  { id: 'teach', name: 'הוראה', color: '#8e24aa', primary: false, accessRole: 'owner', defaultReminders: [] },
  { id: 'family', name: 'משפחה', color: '#f4511e', primary: false, accessRole: 'writer', defaultReminders: [] },
  { id: 'hol', name: 'חגים בישראל', color: '#616161', primary: false, accessRole: 'reader', defaultReminders: [] },
];

let events = [
  { calId: 'me', title: 'ריצה בפארק', start: rel(-150), end: rel(-105), location: 'פארק הירקון, תל אביב' },
  { calId: 'work', title: 'סקירת סטוריבורד — קליפ פתיחה ומעברים לסצנה 3', start: rel(55), end: rel(115), location: 'סטודיו, הרא״ה 12 גבעתיים', meet: 'https://meet.google.com/abc-defg-hij', description: 'לעבור על 12 הפריימים ולסגור צבעוניות לסצנה 3.' },
  { calId: 'teach', title: 'שיעור מושן — כיתה ב׳', start: rel(240), end: rel(390), location: 'שנקר, אנה פרנק 12 רמת גן', description: 'נושא: easing ו־anticipation. להביא את הדוגמאות מ־After Effects.' },
  { calId: 'family', title: 'ארוחת ערב אצל ההורים', start: rel(480), end: rel(600), location: 'הרצל 40, ראשון לציון' },
  { calId: 'hol', title: 'ערב חג', start: at(1, 0), end: at(2, 0), allDay: true },
  { calId: 'family', title: 'יום הולדת לנועה', start: at(0, 0), end: at(1, 0), allDay: true, birthday: true },
  { calId: 'work', title: 'מסירת אנימטיק ללקוח', start: at(1, 10), end: at(1, 11) },
  { calId: 'me', title: 'מספרה', start: at(1, 17, 30), end: at(1, 18, 15), location: 'דיזנגוף 150, תל אביב' },
].map(e => ({
  id: uid(), allDay: false, birthday: false, location: '', description: '', meet: '', snoozeFor: null,
  reminders: cals.find(c => c.id === e.calId).defaultReminders.map(r => r.minutes), reminder: cals.find(c => c.id === e.calId).defaultReminders[0]?.minutes ?? null,
  reminderIsDefault: true, canEdit: e.calId !== 'hol', htmlLink: 'https://calendar.google.com/', ...e,
}));

const lists = [{ id: 'main', title: 'המשימות שלי' }, { id: 'studio', title: 'סטודיו' }];
const t = (o) => ({ id: uid(), listId: 'main', listTitle: 'המשימות שלי', notes: '', status: 'needsAction', completed: null, parent: null, webLink: 'https://tasks.google.com/', links: [], ...o });
let tasks = [
  t({ title: 'לשלוח הצעת מחיר לסטודיו של רוני', due: ymd(today), notes: 'לצרף את הפורטפוליו: https://noina-tv.github.io', links: [{ type: 'email', description: 'עדכון לגבי הקליפ', link: 'https://mail.google.com/' }] }),
  t({ title: 'לייצא סטיקרים לוואטסאפ', due: ymd(today), listId: 'studio', listTitle: 'סטודיו', notes: 'webp, 512×512, עד 500KB' }),
  t({ title: 'לבדוק ציונים של פרויקט אמצע', due: ymd(addDays(today, -2)), listId: 'studio', listTitle: 'סטודיו' }),
  t({ title: 'לקנות מתנה לאמא', due: ymd(addDays(today, 3)) }),
  t({ title: 'לעדכן פורטפוליו Pirate TV', due: ymd(addDays(today, 6)), listId: 'studio', listTitle: 'סטודיו' }),
  t({ title: 'לחדש ביטוח רכב', due: ymd(addDays(today, 12)) }),
  t({ title: 'לקרוא על Rive state machines', due: null }),
  t({ title: 'להשקות את העציצים', due: ymd(today), status: 'completed', completed: new Date().toISOString() }),
];
const parentId = tasks[1].id;
tasks.push(
  t({ title: 'לחתוך את הלופים', parent: parentId, listId: 'studio', status: 'completed', completed: new Date().toISOString() }),
  t({ title: 'דחיסה ל־webp', parent: parentId, listId: 'studio' }),
  t({ title: 'להעלות ל־Sticker.ly', parent: parentId, listId: 'studio' }),
);

let emails = [
  { from: 'רוני לוי', subject: 'עדכון לגבי הקליפ — אפשר לדבר היום?', snippet: 'היי! ראיתי את הגרסה האחרונה, יש לי שתי הערות קטנות על המעבר בסצנה 4…', mins: 35 },
  { from: 'Behance', subject: 'Your project was featured in Motion Graphics', snippet: 'Congrats! Your project "Loop Studies" was added to the Motion Graphics gallery…', mins: 180 },
  { from: 'מזכירות שנקר', subject: 'שינוי חדר לשיעור ביום רביעי', snippet: 'שלום, השיעור יתקיים בחדר 2.14 במקום 3.02 עקב שיפוצים…', mins: 420 },
  { from: 'Google Calendar', subject: 'Invitation: Kickoff — Spring campaign', snippet: 'You have been invited to the following event. Kickoff — Spring campaign…', mins: 900 },
].map((e, i) => ({ id: uid(), threadId: uid(), unread: true, labelIds: [['INBOX', 'Label_1'], ['INBOX'], ['INBOX', 'Label_2'], ['INBOX']][i], starred: false, fromEmail: '', link: 'https://mail.google.com/', date: new Date(Date.now() - e.mins * 60000), ...e }));

const wait = (ms = 120) => new Promise(r => setTimeout(r, ms));

export const demo = {
  live: false,
  async profile() { return { email: 'demo@example.com', name: '' }; },
  async calendars() { await wait(); return cals.map(c => ({ ...c })); },
  async events(cs, from, to) {
    await wait();
    const ids = new Set(cs.map(c => c.id));
    return events.filter(e => ids.has(e.calId) && e.end > from && e.start < to).map(e => ({ ...e }));
  },
  async setReminders(ev, list) {
    const e = events.find(x => x.id === ev.id); if (!e) return;
    if (list === 'default') { e.reminders = cals.find(c => c.id === e.calId).defaultReminders.map(r => r.minutes); e.reminderIsDefault = true; }
    else { e.reminders = [...list]; e.reminderIsDefault = false; }
    e.reminder = e.reminders.length ? Math.min(...e.reminders) : null;
  },
  async deleteEvent(ev) { events = events.filter(e => e.id !== ev.id); },
  async createEvent(o) {
    const cal = cals.find(c => c.id === o.calId);
    const list = o.reminder === 'default' ? cal.defaultReminders.map(r => r.minutes) : o.reminder == null ? [] : [].concat(o.reminder);
    const ev = { id: uid(), meet: '', canEdit: true, htmlLink: 'https://calendar.google.com/', reminderIsDefault: o.reminder === 'default',
      birthday: false, ...o, snoozeFor: o.snoozeFor || null, reminders: list, reminder: list.length ? Math.min(...list) : null };
    events.push(ev);
    return ev;
  },
  async taskLists() { return lists; },
  async tasks() { await wait(); return tasks.map(x => ({ ...x, subtasks: [] })); },
  async createTask(o) { const n = t({ ...o, listTitle: lists.find(l => l.id === o.listId)?.title }); tasks.push(n); return n.id; },
  async patchTask(task, f) {
    const x = tasks.find(y => y.id === task.id); if (!x) return;
    Object.assign(x, f);
    if (f.status === 'completed') x.completed = new Date().toISOString();
    if (f.status === 'needsAction') x.completed = null;
  },
  async deleteTask(task) { tasks = tasks.filter(x => x.id !== task.id && x.parent !== task.id); },
  async emails() { await wait(); return emails.map(e => ({ ...e })); },
  async labels() { return [{ id: 'Label_1', name: 'לקוחות', color: '#16a765' }, { id: 'Label_2', name: 'שנקר', color: '#a479e2' }, { id: 'Label_3', name: 'חשבוניות', color: '#ffad47' }]; },
  async trashEmail(e) { emails = emails.filter(x => x.id !== e.id); },
  async untrashEmail(e) { if (!emails.some(x => x.id === e.id)) emails.push(e); },
  async modifyEmail(e, { remove = [] }) { if (remove.includes('INBOX')) emails = emails.filter(x => x.id !== e.id); else { const x = emails.find(y => y.id === e.id); if (x && remove.includes('UNREAD')) x.unread = false; } },
};
