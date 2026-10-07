// App state, derived views and actions (optimistic, with undo).
import { auth } from './auth.js';
import { google, AuthError } from './google.js';
import { demo } from './demo.js';
import { store, startOfDay, addDays, ymd, sameDay, uid } from './util.js';

export const APP_PALETTE = ['#3cc4dc', '#5b8def', '#8f6ee8', '#d16bd4', '#ec5f8b', '#f28b38', '#e3b324', '#8cc63f', '#36b37e', '#1f9e9a', '#7d8f99'];

const DEFAULT_SETTINGS = {
  theme: 'system', marker: 'bar', colorSource: 'google', calColors: {}, hiddenCals: [],
  gmailEnabled: true, gmailQuery: 'in:inbox is:unread category:primary newer_than:7d',
  digestEnabled: true, defaultList: null, defaultCal: null, wizardEmails: true, reminderOptions: [2880, 1440, 60, 15, 5], hiddenLabels: ['עבודה/נטקראפט', 'עבודה/פרומותאוס', 'עבודה/קידו', 'עבודה/וימאו'], v: 3,
};

function migrate(s) {
  if ((s.v || 0) < 3) { s.reminderOptions = DEFAULT_SETTINGS.reminderOptions; s.hiddenLabels = DEFAULT_SETTINGS.hiddenLabels; s.v = 3; }
  return s;
}

export const state = {
  settings: migrate({ ...DEFAULT_SETTINGS, ...store.get('settings', {}) }),
  day: startOfDay(new Date()),
  cals: [], lists: [], events: [], tasks: [], emails: [], labels: [],
  snoozes: store.get('snoozes', {}), profile: null, loading: true, error: null, mode: 'demo', lastSync: null,
};

const subs = new Set();
export const subscribe = fn => (subs.add(fn), () => subs.delete(fn));
export const emit = () => subs.forEach(fn => fn(state));

export const api = () => (state.mode === 'live' ? google : demo);

export function saveSettings(patch) {
  Object.assign(state.settings, patch);
  store.set('settings', state.settings);
  emit();
}

// ---------- toasts / undo (UI subscribes) ----------
export const toasts = { current: null, listeners: new Set() };
export function toast(text, { undo, commit, ms = 5000 } = {}) {
  const prev = toasts.current;
  if (prev?.commit && !prev.done) { prev.done = true; prev.commit(); }
  const t = { id: uid(), text, undo, commit, done: false };
  toasts.current = t;
  toasts.listeners.forEach(fn => fn(t));
  setTimeout(() => {
    if (toasts.current === t) { toasts.current = null; toasts.listeners.forEach(fn => fn(null)); }
    if (!t.done && t.commit) { t.done = true; t.commit(); }
  }, ms);
  return t;
}
export function undoToast() {
  const t = toasts.current;
  if (!t || t.done) return;
  t.done = true;
  t.undo?.();
  toasts.current = null;
  toasts.listeners.forEach(fn => fn(null));
}

function fail(err) {
  console.error(err);
  if (err instanceof AuthError) { auth.login({ silent: true }); return; }
  toast(`הפעולה לא נשמרה בגוגל: ${err.message}`);
  refresh();
}

// ---------- loading ----------
export function calColor(cal) {
  if (!cal) return '#7d8f99';
  const s = state.settings;
  if (s.calColors[cal.id]) return s.calColors[cal.id];
  if (s.colorSource === 'app') {
    const i = state.cals.findIndex(c => c.id === cal.id);
    return APP_PALETTE[i % APP_PALETTE.length];
  }
  return cal.color;
}
export const calById = id => state.cals.find(c => c.id === id);
export const visibleCals = () => state.cals.filter(c => !state.settings.hiddenCals.includes(c.id));

export async function init() {
  state.mode = auth.configured && auth.token ? 'live' : 'demo';
  const cache = state.mode === 'live' ? store.get('cache') : null;
  if (cache) hydrate(cache);
  await refresh();
}

function hydrate(c) {
  state.cals = c.cals; state.lists = c.lists; state.profile = c.profile;
  state.events = c.events.map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  state.tasks = c.tasks; state.emails = c.emails.map(e => ({ ...e, date: new Date(e.date) }));
  state.loading = false;
  emit();
}

let inflight = null;
export function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    state.error = null; emit();
    try {
      const a = api();
      const [cals, lists, profile] = await Promise.all([a.calendars(), a.taskLists(), state.profile && state.mode === 'live' ? state.profile : a.profile()]);
      state.cals = cals; state.lists = lists; state.profile = profile;
      if (profile?.email && a.live) store.set('email', profile.email);
      const from = addDays(state.day, -1), to = addDays(state.day, 9);
      if (state.settings.gmailEnabled) a.labels().then(l => { state.labels = l; emit(); }).catch(e => console.warn('labels', e));
      const [events, tasks, emails] = await Promise.all([
        a.events(visibleCals(), from, to),
        a.tasks(lists),
        state.settings.gmailEnabled ? a.emails(state.settings.gmailQuery).catch(e => { if (e instanceof AuthError) throw e; console.warn(e); return []; }) : [],
      ]);
      state.events = events; state.tasks = tasks; state.emails = emails; state.range = { from, to };
      cleanupSnoozes(a);
      state.loading = false; state.lastSync = new Date();
      if (a.live) store.set('cache', { cals, lists, profile, events, tasks, emails });
    } catch (err) {
      state.loading = false;
      if (err instanceof AuthError) { auth.login({ silent: true }); return; }
      state.error = err.message;
      console.error(err);
    } finally { inflight = null; emit(); }
  })();
  return inflight;
}

export function setDay(d) {
  state.day = startOfDay(d);
  emit();
  // events are fetched for day-1…day+3; refetch when the selected day (and its next day) falls outside
  const r = state.range;
  if (!r || state.day < r.from || addDays(state.day, 8) > r.to) refresh();
}

// ---------- derived ----------
export const isToday = () => sameDay(state.day, new Date());

export function eventsOn(day) {
  const s = startOfDay(day), e = addDays(s, 1);
  const hidden = new Set(state.settings.hiddenCals);
  return state.events
    .filter(ev => !hidden.has(ev.calId) && !ev.snoozeFor && ev.start < e && ev.end > s)
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
}

function tree(list) {
  const byId = new Map(list.map(t => [t.id, { ...t, subtasks: [] }]));
  const roots = [];
  for (const t of byId.values()) {
    if (t.parent && byId.has(t.parent)) byId.get(t.parent).subtasks.push(t);
    else if (!t.parent) roots.push(t);
  }
  for (const t of byId.values()) t.subtasks.sort((a, b) => String(a.position).localeCompare(String(b.position)));
  return roots;
}
export const allTaskRoots = () => tree(state.tasks);

export function taskGroups(day = state.day) {
  const d = ymd(day), today = isTodayDate(day);
  const roots = allTaskRoots();
  const open = roots.filter(t => t.status !== 'completed');
  const dueNow = open.filter(t => t.due && (today ? t.due <= d : t.due === d))
    .sort((a, b) => a.due.localeCompare(b.due) || String(a.position).localeCompare(String(b.position)));
  const doneToday = today ? roots.filter(t => t.status === 'completed') : [];
  const horizon = ymd(addDays(day, 30));
  const upcoming = open.filter(t => t.due && t.due > d && t.due <= horizon).sort((a, b) => a.due.localeCompare(b.due));
  const noDate = open.filter(t => !t.due);
  return { dueNow, doneToday, upcoming, noDate };
}
const isTodayDate = d => sameDay(d, new Date());

export function progress() {
  const now = new Date();
  const evs = eventsOn(now).filter(e => !e.allDay);
  const { dueNow, doneToday } = taskGroups(startOfDay(now));
  const done = evs.filter(e => e.end <= now).length + doneToday.length;
  const total = evs.length + dueNow.length + doneToday.length;
  return { done, total, pct: total ? done / total : 0, events: evs.length, tasks: dueNow.length + doneToday.length };
}

export function nextUp() {
  const now = new Date();
  const ev = state.events.filter(e => !e.allDay && !e.snoozeFor && e.end > now && !state.settings.hiddenCals.includes(e.calId))
    .sort((a, b) => a.start - b.start)[0];
  return ev || null;
}

// ---------- actions ----------
const findTask = id => state.tasks.find(t => t.id === id);

export function toggleTask(id, { silent = false } = {}) {
  const t = findTask(id); if (!t) return;
  const to = t.status === 'completed' ? 'needsAction' : 'completed';
  const prev = { status: t.status, completed: t.completed };
  t.status = to; t.completed = to === 'completed' ? new Date().toISOString() : null;
  emit();
  api().patchTask(t, { status: to }).catch(fail);
  if (!silent && to === 'completed' && !t.parent) {
    toast(`סומן כבוצע: ${t.title}`, { undo: () => { Object.assign(t, prev); emit(); api().patchTask(t, { status: prev.status }).catch(fail); } });
  }
}

// ---------- snooze for an hour or two ----------
// Google Tasks has no time of day, so a short snooze lives here (the task is hidden until then)
// plus a tiny calendar event at that time, so the phone rings when it's back.
export const snoozedUntil = id => { const t = state.snoozes[id]; return t && new Date(t) > new Date() ? new Date(t) : null; };

export async function snoozeTask(id, minutes, { silent = false } = {}) {
  const t = findTask(id); if (!t) return;
  const until = new Date(Date.now() + minutes * 60000);
  state.snoozes[id] = until.toISOString(); store.set('snoozes', state.snoozes); emit();
  const calId = state.cals.find(c => c.primary)?.id;
  let evId = null;
  try {
    const ev = await api().createEvent({ calId, title: `⏰ ${t.title}`, start: until, end: new Date(until.getTime() + 10 * 60000), allDay: false, location: '', description: 'תזכורת ממה איתי היום? — המשימה חוזרת לרשימה עכשיו.', reminder: [0], snoozeFor: id });
    evId = ev?.id || null;
  } catch (e) { console.warn('snooze reminder', e); }
  const undo = () => {
    delete state.snoozes[id]; store.set('snoozes', state.snoozes); emit();
    if (evId) api().deleteEvent({ id: evId, calId }).catch(() => {});
  };
  if (!silent) toast(`יחזור ב־${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`, { undo });
  return undo;
}

function cleanupSnoozes(a) {
  const now = new Date();
  for (const [id, t] of Object.entries(state.snoozes)) if (new Date(t) <= now) delete state.snoozes[id];
  store.set('snoozes', state.snoozes);
  // remove reminder events that already rang
  state.events.filter(e => e.snoozeFor && e.end < new Date(now - 30 * 60000)).forEach(e => a.deleteEvent(e).catch(() => {}));
}

export function deferTask(id, dueYmd, label, { silent = false } = {}) {
  const t = findTask(id); if (!t) return;
  const prev = t.due;
  t.due = dueYmd; emit();
  api().patchTask(t, { due: dueYmd }).catch(fail);
  if (silent) return prev;
  toast(`נדחה ל${label}`, { undo: () => { t.due = prev; emit(); api().patchTask(t, { due: prev }).catch(fail); } });
}

export function updateTask(id, fields) {
  const t = findTask(id); if (!t) return;
  Object.assign(t, fields); emit();
  api().patchTask(t, fields).catch(fail);
}

export async function addTask({ title, notes = '', due = null, listId, parent = null }) {
  listId = listId || state.settings.defaultList || state.lists[0]?.id;
  const tmp = { id: 'tmp-' + uid(), listId, listTitle: state.lists.find(l => l.id === listId)?.title, title, notes, due, status: 'needsAction', completed: null, parent, position: 'zzz' + Date.now(), webLink: 'https://tasks.google.com/', subtasks: [] };
  state.tasks.push(tmp); emit();
  try {
    const realId = await api().createTask({ listId, title, notes, due, parent });
    tmp.id = realId || tmp.id; emit();
  } catch (e) { fail(e); }
  return tmp;
}

export function deleteTask(id) {
  const t = findTask(id); if (!t) return;
  const removed = state.tasks.filter(x => x.id === id || x.parent === id);
  state.tasks = state.tasks.filter(x => !removed.includes(x));
  emit();
  toast(t.parent ? 'תת־המשימה נמחקה' : `נמחק: ${t.title}`, {
    undo: () => { state.tasks.push(...removed); emit(); },
    commit: () => api().deleteTask(t).catch(fail),
  });
}

// value: 'default' | 'none' | minutes (toggles that time on/off; several can be on together)
export function setReminder(evId, value) {
  const ev = state.events.find(e => e.id === evId); if (!ev) return;
  let list;
  if (value === 'default') {
    ev.reminderIsDefault = true;
    ev.reminders = (calById(ev.calId)?.defaultReminders || []).filter(r => r.method === 'popup').map(r => r.minutes);
    list = 'default';
  } else {
    const cur = ev.reminderIsDefault ? [] : [...(ev.reminders || [])];
    list = value === 'none' ? [] : cur.includes(value) ? cur.filter(m => m !== value) : [...cur, value].slice(-5);
    ev.reminders = list.sort((a, b) => b - a); ev.reminderIsDefault = false;
  }
  ev.reminder = ev.reminders.length ? Math.min(...ev.reminders) : null;
  emit();
  api().setReminders(ev, list).catch(fail);
}

export function deleteEvent(evId, { silent = false } = {}) {
  const ev = state.events.find(e => e.id === evId); if (!ev) return;
  state.events = state.events.filter(e => e !== ev); emit();
  if (silent) {
    // the wizard keeps its own undo: commit after a grace period unless restored
    const timer = setTimeout(() => api().deleteEvent(ev).catch(fail), 6000);
    return () => { clearTimeout(timer); state.events.push(ev); emit(); };
  }
  toast(`האירוע נמחק: ${ev.title}`, {
    undo: () => { state.events.push(ev); emit(); },
    commit: () => api().deleteEvent(ev).catch(fail),
  });
}

export async function addEvent(o) {
  o.calId = o.calId || state.settings.defaultCal || state.cals.find(c => c.primary)?.id;
  try { await api().createEvent(o); toast('האירוע נוסף ליומן'); await refresh(); } catch (e) { fail(e); }
}

export function archiveEmail(id, { silent = false, label = null } = {}) {
  const e = state.emails.find(x => x.id === id); if (!e) return;
  state.emails = state.emails.filter(x => x !== e); emit();
  const commit = () => api().modifyEmail(e, { add: label ? [label] : [], remove: ['INBOX', 'UNREAD'] }).catch(fail);
  if (silent) return commit();
  toast('המייל הועבר לארכיון', { undo: () => { state.emails.push(e); state.emails.sort((a, b) => b.date - a.date); emit(); }, commit });
}

export function trashEmail(id, { silent = false } = {}) {
  const e = state.emails.find(x => x.id === id); if (!e) return;
  state.emails = state.emails.filter(x => x !== e); emit();
  const restore = () => { state.emails.push(e); state.emails.sort((a, b) => b.date - a.date); emit(); };
  if (silent) { api().trashEmail(e).catch(fail); return () => { restore(); api().untrashEmail(e).catch(fail); }; }
  toast('המייל הועבר לאשפה', { undo: restore, commit: () => api().trashEmail(e).catch(fail) });
}

export const userLabels = e => (e.labelIds || []).map(id => state.labels.find(l => l.id === id)).filter(Boolean);

export function unarchiveEmail(e) {
  if (!state.emails.includes(e)) { state.emails.push(e); state.emails.sort((a, b) => b.date - a.date); }
  emit();
  api().modifyEmail(e, { add: ['INBOX', 'UNREAD'] }).catch(fail);
}

export function markEmailRead(id) {
  const e = state.emails.find(x => x.id === id); if (!e) return;
  e.unread = false;
  api().modifyEmail(e, { remove: ['UNREAD'] }).catch(fail);
}

export async function emailToTask(id, due, { silent = false, title, notes, listId, archive = true } = {}) {
  const e = state.emails.find(x => x.id === id); if (!e) return null;
  if (archive) archiveEmail(id, { silent: true });
  const t = await addTask({ title: title || e.subject, notes: notes ?? `${e.from}\n${e.link}`, due, listId });
  if (!silent) toast('נוצרה משימה מהמייל והמייל הועבר לארכיון');
  return t;
}

// Remove a task without the undo snackbar (used by the wizard's own undo).
export function dropTask(id) {
  const t = findTask(id); if (!t) return;
  state.tasks = state.tasks.filter(x => x.id !== id && x.parent !== id); emit();
  api().deleteTask(t).catch(fail);
}
