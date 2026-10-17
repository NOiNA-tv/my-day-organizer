// Habits: model, when each one shows up, how it's doing, and storage (Google Sheet + local copy).
import { state, emit, api, toast, visibleCals } from './data.js';
import { auth } from './auth.js';
import { AuthError } from './google.js';
import { store, ymd, fromYmd, addDays, addMonths, startOfDay, daysBetween, uid, sameDay } from './util.js';
import { textHasEmoji, suggestEmojis } from './emoji.js';

// ---------- vocab ----------
export const PERIODS = {
  day: { label: 'ביום', unit: 'יום', days: 1 },
  week: { label: 'בשבוע', unit: 'שבוע', days: 7 },
  '2weeks': { label: 'בשבועיים', unit: 'שבועיים', days: 14 },
  month: { label: 'בחודש', unit: 'חודש', months: 1, days: 30 },
  '2months': { label: 'בחודשיים', unit: 'חודשיים', months: 2, days: 61 },
  '3months': { label: 'בשלושה חודשים', unit: 'שלושה חודשים', months: 3, days: 91 },
  '6months': { label: 'בחצי שנה', unit: 'חצי שנה', months: 6, days: 182 },
  year: { label: 'בשנה', unit: 'שנה', months: 12, days: 365 },
};
// gaps for "show N after last time" / "show N before it's due"
export const DURS = {
  '0d': { label: 'ביום היעד', d: 0 }, '1d': { label: 'יום', d: 1 }, '2d': { label: 'יומיים', d: 2 },
  '1w': { label: 'שבוע', d: 7 }, '2w': { label: 'שבועיים', d: 14 }, '1m': { label: 'חודש', m: 1 }, '2m': { label: 'חודשיים', m: 2 },
  '3m': { label: 'שלושה חודשים', m: 3 }, '6m': { label: 'חצי שנה', m: 6 }, '1y': { label: 'שנה', m: 12 },
};
export const SHOW_TYPES = {
  daily: 'כל יום', fixed: 'יום קבוע במועד קבוע', since: 'כעבור תקופה מהמועד שעבר', until: 'כשמתקרב מועד היעד',
  none: 'רק לפי היומן', // offered only when the emoji switch is on
};
// "fixed": chosen weekdays, every week / 2 weeks, or the first such weekday of every N months
export const EVERY = {
  week: { label: 'כל שבוע' }, '2weeks': { label: 'כל שבועיים' }, month: { label: 'כל חודש', m: 1 }, '2months': { label: 'כל חודשיים', m: 2 },
  '3months': { label: 'כל 3 חודשים', m: 3 }, '6months': { label: 'כל חצי שנה', m: 6 }, year: { label: 'כל שנה', m: 12 },
};
// older shapes → current ones (weekday / biweek / emoji / wizard)
export function normShow(s) {
  s = { ...(s || { type: 'daily' }) };
  if (s.type === 'weekday') return { type: 'fixed', days: s.days || [], every: 'week', ...(s.emoji ? { emoji: true } : {}) };
  if (s.type === 'biweek') return { type: 'fixed', days: s.days || [], every: '2weeks', ...(s.anchor ? { anchor: s.anchor } : {}), ...(s.emoji ? { emoji: true } : {}) };
  if (s.type === 'emoji') return { type: 'none', emoji: true };
  if (s.type === 'wizard') return { type: 'none' };
  return s;
}
const monthIdx = d => d.getFullYear() * 12 + d.getMonth();
const ymIdx = s => { const [y, m] = String(s).split('-').map(Number); return y * 12 + m - 1; };
const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ANCHOR = new Date(2026, 0, 4); // a Sunday: two-week blocks count from here

const addDur = (d, key) => { const x = DURS[key] || { d: 0 }; return x.m ? addMonths(d, x.m) : addDays(d, x.d); };
const addPeriod = (d, key) => { const p = PERIODS[key]; return p.months ? addMonths(d, p.months) : addDays(d, p.days); };
const weekStart = d => addDays(startOfDay(d), -d.getDay());

// ---------- starting set (first run) ----------
const seed = () => {
  const h = (name, emoji, times, period, show, extra = {}) => ({ id: uid(), name, emoji, kind: 'toggle', times, period, group: '', show, remind: '', remindEv: '', ...extra });
  const social = { group: 'פנאי וחברה' };
  return [
    h('חדר כושר', '🏋️', 3, 'week', { type: 'daily' }),
    h('בישולים', '🍳', 1, 'week', { type: 'fixed', days: [5], every: 'week' }),
    h('גילוח', '🪒', 1, 'week', { type: 'fixed', days: [2], every: 'week' }),
    h('ניקיונות', '🧹', 1, '2weeks', { type: 'since', n: '2w' }),
    h('פסיליום', '🌾', 5, '2weeks', { type: 'daily' }),
    h('תספורת', '💈', 1, '2months', { type: 'until', n: '1w' }),
    h('בדיקות דם וחידוש מרשם', '🩸', 1, '3months', { type: 'until', n: '2w' }),
    h('שיננית', '🦷', 1, '6months', { type: 'none', emoji: true }),
    h('הצגה', '🎭', 3, 'month', { type: 'none', emoji: true }, social),
    h('מסיבה', '🪩', 3, 'month', { type: 'none', emoji: true }, social),
    h('הופעה', '🎤', 3, 'month', { type: 'none', emoji: true }, social),
    h('סרט', '🎬', 3, 'month', { type: 'none', emoji: true }, social),
    h('ישיבה', '🍻', 3, 'month', { type: 'none', emoji: true }, social),
    h('וויד', '🌿', null, null, { type: 'daily' }, { kind: 'count', sign: 'neg' }),
  ].map((x, i) => ({ ...x, order: i }));
};

// ---------- state ----------
const saved = store.get('habits');
export const H = {
  list: (saved?.list || seed()).map(h => ({ ...h, show: normShow(h.show) })),
  log: saved?.log || {}, // 'YYYY-MM-DD|id' → number (1 for a done toggle)
  pins: saved?.pins || {}, // 'YYYY-MM-DD' → [ids] picked in the wizard for that day
  contacts: saved?.contacts || {}, // birthday person key → { name, phone } (set or fixed by hand)
  groups: saved?.groups || {}, // group name → emoji
  updated: saved?.updated || 0,
  sheet: store.get('habitSheet') || null, // { id, webViewLink }
  sync: 'local', // local | ok | syncing | needs-consent | needs-api | error
  syncError: '',
  emojiEvents: [], // { title, start } from the calendars, ±months, for emoji-shown habits
};
const key = (d, id) => `${typeof d === 'string' ? d : ymd(d)}|${id}`;
export const habitById = id => H.list.find(h => h.id === id);
export const sorted = () => [...H.list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function persist({ remote = true } = {}) {
  H.updated = Date.now();
  store.set('habits', { list: H.list, log: H.log, pins: H.pins, contacts: H.contacts, groups: H.groups, updated: H.updated });
  emit();
  if (remote) queueWrite();
}

// ---------- values ----------
export const valueOn = (h, d) => H.log[key(d, h.id)] || 0;
export const members = h => (h.group ? H.list.filter(x => x.group === h.group) : [h]);
// last day (≤ ref) with any mark, across a group
export function lastDone(h, ref = new Date()) {
  const ids = new Set(members(h).map(x => x.id)), r = ymd(ref);
  let best = null;
  for (const [k, v] of Object.entries(H.log)) {
    if (!v) continue;
    const [d, id] = k.split('|');
    if (ids.has(id) && d <= r && (!best || d > best)) best = d;
  }
  return best ? fromYmd(best) : null;
}
const lastDoneBefore = (h, d) => lastDone(h, addDays(d, -1));

// calendar-aligned window that contains `d`
export function periodWindow(period, d) {
  const day = startOfDay(d), p = PERIODS[period];
  if (period === 'day') return [day, addDays(day, 1)];
  if (period === 'week') { const s = weekStart(day); return [s, addDays(s, 7)]; }
  if (period === '2weeks') { const w = weekStart(day), n = Math.floor(daysBetween(ANCHOR, w) / 14); const s = addDays(ANCHOR, n * 14); return [s, addDays(s, 14)]; }
  const m = p.months, start = new Date(day.getFullYear(), Math.floor(day.getMonth() / m) * m, 1);
  return [start, addMonths(start, m)];
}
function countIn(h, from, to) {
  let n = 0;
  for (const x of members(h)) for (let d = new Date(from); d < to; d = addDays(d, 1)) if (valueOn(x, d) > 0) n++;
  return n;
}

// mode: tally (just count, no goal) · interval (once per period: time since last) · quota (n times per period)
export const modeOf = h => (!h.times || !h.period ? 'tally' : h.times === 1 && h.period !== 'day' ? 'interval' : 'quota');

export function status(h, ref = new Date()) {
  const today = startOfDay(ref), mode = modeOf(h);
  if (mode === 'tally') {
    let sum = 0; for (let i = 0; i < 7; i++) sum += valueOn(h, addDays(today, -i));
    return { mode, today: valueOn(h, today), avg7: sum / 7, level: 'ok' };
  }
  const per = PERIODS[h.period];
  if (mode === 'interval') {
    const last = lastDone(h, today);
    const warn = Math.max(2, Math.round(per.days * 0.15));
    if (!last) return { mode, never: true, level: 'over', severity: 1 };
    const due = addPeriod(last, h.period), since = daysBetween(last, today), until = daysBetween(today, due);
    const level = until < 0 ? 'over' : until <= warn ? 'soon' : 'ok';
    // on time in the last few rounds
    const dates = [...new Set(Object.entries(H.log).filter(([k, v]) => v && members(h).some(x => k.endsWith('|' + x.id))).map(([k]) => k.slice(0, 10)))].sort();
    const gaps = dates.slice(1).map((d, i) => fromYmd(d) <= addDays(addPeriod(fromYmd(dates[i]), h.period), warn));
    return { mode, last, due, since, until, level, severity: -until / per.days, history: gaps.slice(-6) };
  }
  // quota
  const [s, e] = periodWindow(h.period, today);
  const count = countIn(h, s, e), need = Math.max(0, h.times - count), left = daysBetween(today, e);
  const level = need === 0 ? 'done' : need > left ? 'missed' : need * 2 >= left ? 'risk' : 'ok';
  const history = [];
  let ps = s;
  for (let i = 0; i < 8; i++) { const [a, b] = periodWindow(h.period, addDays(ps, -1)); history.unshift(countIn(h, a, b) >= h.times); ps = a; }
  let streak = 0; for (let i = history.length - 1; i >= 0 && history[i]; i--) streak++;
  if (need === 0) streak++;
  return { mode, count, times: h.times, need, left, level, window: [s, e], history, streak, severity: need / Math.max(1, left) };
}

// ---------- when a habit's button shows on the main screen ----------
export function emojiEventOn(h, d) {
  const all = [...state.events.filter(e => !e.taskRef && !e.habitRef && !e.snoozeFor), ...H.emojiEvents];
  return all.some(e => sameDay(e.start, d) && textHasEmoji(e.title, h.emoji));
}
export function nextEmojiEvent(h, from = new Date()) {
  const f = startOfDay(from);
  return H.emojiEvents.filter(e => e.start >= f && textHasEmoji(e.title, h.emoji)).sort((a, b) => a.start - b.start)[0] || null;
}
export const isPinned = (h, d) => (H.pins[ymd(d)] || []).includes(h.id);

export function shownOn(h, d) {
  if (valueOn(h, d) > 0 || isPinned(h, d)) return true;
  const s = normShow(h.show), dow = d.getDay();
  if (s.emoji && emojiEventOn(h, d)) return true;
  switch (s.type) {
    case 'daily': return true;
    case 'fixed': {
      if (!(s.days || []).includes(dow)) return false;
      const ev = s.every || 'week';
      if (ev === 'week') return true;
      if (ev === '2weeks') { const w = Math.floor(daysBetween(fromYmd(s.anchor || ymd(ANCHOR)), weekStart(d)) / 7); return ((w % 2) + 2) % 2 === 0; }
      const k = EVERY[ev]?.m || 1, diff = monthIdx(d) - (s.anchor ? ymIdx(s.anchor) : monthIdx(d));
      return d.getDate() <= 7 && ((diff % k) + k) % k === 0; // the first such weekday of the month
    }
    case 'monthday': { const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return d.getDate() === Math.min(s.day || 1, last); }
    case 'since': { const l = lastDoneBefore(h, d); return !l || startOfDay(d) >= addDur(l, s.n || '1w'); }
    case 'until': {
      if (!h.period) return true;
      const l = lastDoneBefore(h, d);
      return !l || daysBetween(d, addPeriod(l, h.period)) <= daysBetween(new Date(2000, 0, 1), addDur(new Date(2000, 0, 1), s.n || '1w'));
    }
    default: return false; // none: only by calendar emoji, or when picked in the wizard
  }
}
export const habitsOn = d => sorted().filter(h => shownOn(h, d));

// the big list (wizard / dashboard): today's first, then due soon, then most overdue, then most frequent
export function rankedRows(ref = new Date()) {
  const today = startOfDay(ref);
  const freq = h => (h.period ? PERIODS[h.period].days / (h.times || 1) : 1);
  const rows = sorted().map(h => {
    const st = status(h, today);
    const g = shownOn(h, today) ? 0 : st.level === 'soon' || st.level === 'risk' ? 1 : st.level === 'over' || st.level === 'missed' ? 2 : 3;
    return { h, st, g };
  });
  return rows.sort((a, b) => a.g - b.g || (a.g === 2 ? b.st.severity - a.st.severity : 0) || (a.g === 3 ? freq(a.h) - freq(b.h) : 0) || (a.h.order - b.h.order));
}

// one-line status, in words
export function statusText(h, ref = new Date()) {
  const st = status(h, ref);
  if (st.mode === 'tally') return `היום ${st.today} · ממוצע ${st.avg7.toFixed(1)} ליום השבוע`;
  if (st.mode === 'interval') {
    if (st.never) return 'עוד לא סומן';
    const ago = st.since === 0 ? 'סומן היום' : st.since === 1 ? 'לפני יום' : `לפני ${st.since} ימים`;
    const next = st.until < 0 ? `באיחור ${-st.until} ימים` : st.until === 0 ? 'היעד היום' : `עוד ${st.until} ימים ליעד`;
    return `${ago} · ${next}`;
  }
  const per = PERIODS[h.period];
  const tail = st.level === 'done' ? 'הושלם ✓' : st.level === 'missed' ? 'לא יספיק הפעם' : `עוד ${st.need}, נשארו ${st.left} ימים`;
  return `${st.count}/${st.times} ${per.label === 'ביום' ? 'היום' : per.label.replace('ב', 'ה')} · ${tail}`;
}
export const freqText = h => (!h.times ? 'ספירה יומית' : `${h.times === 1 ? 'פעם' : h.times === 2 ? 'פעמיים' : `${h.times} פעמים`} ${PERIODS[h.period].label}`);
export function showText(h) {
  const s = normShow(h.show);
  const em = s.emoji ? `ביום עם ${h.emoji} ביומן` : '';
  const days = (s.days || []).map(d => DAYS_SHORT[d]).join(', ');
  let t = '';
  if (s.type === 'fixed') {
    const ev = s.every || 'week';
    t = ev === 'week' ? `בימי ${days}` : ev === '2weeks' ? `ביום ${days}, פעם בשבועיים` : `ב־${days} הראשון, ${EVERY[ev].label}`;
  } else if (s.type === 'monthday') t = `ב־${s.day} לכל חודש`;
  else if (s.type === 'since') t = `כשעברו ${DURS[s.n]?.label} מהפעם האחרונה`;
  else if (s.type === 'until') t = s.n === '0d' ? 'ביום היעד ואילך' : `${DURS[s.n]?.label} לפני היעד ואילך`;
  else if (s.type === 'daily') t = 'כל יום';
  else return em || 'רק כשנבחר באשף';
  return em ? `${t}, וגם ${em}` : t;
}

// ---------- actions ----------
export function setValue(id, d, v) {
  const h = habitById(id); if (!h) return;
  const k = key(d, id), prev = H.log[k] || 0;
  if (v > 0) H.log[k] = v; else delete H.log[k];
  persist();
  if ((h.show?.type === 'since' || h.show?.type === 'until') && h.remind) members(h).forEach(syncReminder);
  return prev;
}
export function toggleHabit(id, d = new Date()) {
  const h = habitById(id);
  const was = valueOn(h, d);
  setValue(id, d, was ? 0 : 1);
  if (!was) {
    const st = status(h, d);
    if (st.mode === 'quota' && st.level === 'done' && st.count === st.times) toast(`${h.group || h.name}: היעד ${PERIODS[h.period].label.replace('ב', 'ל')} הושלם 🎉`);
  }
}
export const bump = (id, d, delta) => { const h = habitById(id); setValue(id, d, Math.max(0, valueOn(h, d) + delta)); };
export function togglePin(id, d) {
  const k = ymd(d), list = H.pins[k] || [];
  H.pins[k] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  if (!H.pins[k].length) delete H.pins[k];
  persist();
}
export function saveHabit(h) {
  const i = H.list.findIndex(x => x.id === h.id);
  const old = i >= 0 ? H.list[i] : null;
  if (i < 0) { h.id = h.id || uid(); h.order = Math.max(-1, ...H.list.map(x => x.order ?? 0)) + 1; H.list.push(h); } else H.list[i] = h;
  persist();
  // the reminder event only changes when its time or the habit's schedule does
  if (!old || old.remind !== h.remind || JSON.stringify(old.show) !== JSON.stringify(h.show) || old.name !== h.name || old.emoji !== h.emoji) syncReminder(h);
}
export function deleteHabit(id) {
  const h = habitById(id); if (!h) return;
  const i = H.list.indexOf(h);
  const logs = Object.fromEntries(Object.entries(H.log).filter(([k]) => k.endsWith('|' + id)));
  H.list.splice(i, 1);
  Object.keys(logs).forEach(k => delete H.log[k]);
  if (h.remindEv) dropReminderEvent(h);
  persist();
  toast(`ההרגל ״${h.name}״ נמחק`, { undo: () => { H.list.splice(i, 0, { ...h, remindEv: '' }); Object.assign(H.log, logs); persist(); syncReminder(h); } });
}

// ---------- reminders: a small helper event in the main calendar (hidden in the app) ----------
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function dropReminderEvent(h) {
  const ev = { id: h.remindEv, calId: state.cals.find(c => c.primary)?.id };
  h.remindEv = '';
  state.events = state.events.filter(e => e.habitRef !== h.id);
  if (ev.id && ev.calId) api().deleteEvent(ev).catch(() => {});
}
// first day on/after `from` when this habit would show
function nextShowDay(h, from) {
  for (let i = 0; i < 400; i++) { const d = addDays(from, i); if (shownOn({ ...h }, d) && !valueOn(h, d)) return d; }
  return null;
}
export async function syncReminder(h) {
  if (!h || !state.cals.length) return;
  if (h.remindEv) dropReminderEvent(h);
  const s = h.show || { type: 'daily' };
  if (!h.remind || s.type === 'none') { persist(); return; }
  const [hh, mm] = h.remind.split(':').map(Number);
  const now = new Date();
  let start = null, rrule = '';
  if (['daily', 'fixed', 'monthday'].includes(s.type)) {
    const rule = { ...h, show: { ...s, emoji: false } }; // the repeating reminder follows the fixed rule only
    start = nextShowDay(rule, startOfDay(now));
    if (start) { start.setHours(hh, mm, 0, 0); if (start < now) { start = nextShowDay(rule, addDays(startOfDay(now), 1)); start?.setHours(hh, mm, 0, 0); } }
    const ev = s.every || 'week', m = EVERY[ev]?.m;
    rrule = s.type === 'daily' ? 'FREQ=DAILY' : s.type === 'monthday' ? `FREQ=MONTHLY;BYMONTHDAY=${s.day || 1}`
      : m ? `FREQ=MONTHLY;${m > 1 ? `INTERVAL=${m};` : ''}BYDAY=${(s.days || []).map(d => '1' + RRULE_DAYS[d]).join(',')}`
      : `FREQ=WEEKLY;${ev === '2weeks' ? 'INTERVAL=2;' : ''}BYDAY=${(s.days || []).map(d => RRULE_DAYS[d]).join(',')}`;
  } else {
    start = nextShowDay(h, startOfDay(now));
    if (start) { start.setHours(hh, mm, 0, 0); if (start < now) { start = addDays(startOfDay(now), 1); start.setHours(hh, mm, 0, 0); } }
  }
  if (!start) { persist(); return; }
  const calId = state.cals.find(c => c.primary)?.id;
  const o = { calId, title: `${h.emoji} ${h.name}`, start, end: new Date(start.getTime() + 5 * 60000), allDay: false, location: '',
    description: 'תזכורת להרגל מ״מה איתי היום?״. השעה נקבעת באפליקציה.', reminder: [0], habitRef: h.id, rrule };
  try {
    const ev = await api().createEvent(o);
    h.remindEv = ev?.id || '';
    persist();
  } catch (e) { console.warn('habit reminder', e); }
}

// ---------- Google Sheet ----------
const SHEET_NAME = 'מה איתי היום – הרגלים';
const TABS = ['הרגלים', 'יומן', 'נבחרו באשף', 'מידע', 'אנשי קשר'];
const COLS = ['id', 'שם', 'אימוג׳י', 'סוג', 'פעמים', 'תקופה', 'קבוצה', 'הופעה', 'פרמטר', 'תזכורת', 'אירוע תזכורת', 'סדר'];

export function toRows() {
  const showParam = s => (s.type === 'fixed' ? `${(s.days || []).join(',')}|${s.every || 'week'}${s.anchor ? `@${s.anchor}` : ''}` : s.type === 'monthday' ? String(s.day || 1) : s.n || '');
  const showType = s => (s.type || 'daily') + (s.emoji ? '+emoji' : '');
  return {
    [TABS[0]]: [COLS, ...sorted().map(h => [h.id, h.name, h.emoji, h.kind + (h.kind === 'count' && h.sign === 'neg' ? ':neg' : ''), h.times ?? '', h.period ?? '', h.group || '', showType(h.show || {}), showParam(h.show || {}), h.remind || '', h.remindEv || '', h.order ?? 0])],
    [TABS[1]]: [['תאריך', 'id', 'הרגל', 'כמות'], ...Object.entries(H.log).sort().map(([k, v]) => { const [d, id] = k.split('|'); return [d, id, habitById(id)?.name || '', v]; })],
    [TABS[2]]: [['תאריך', 'id'], ...Object.entries(H.pins).flatMap(([d, ids]) => ids.map(id => [d, id]))],
    [TABS[4]]: [['מפתח', 'שם', 'טלפון'], ...Object.entries(H.contacts).map(([k, c]) => [k, c.name || '', c.phone || ''])],
    [TABS[3]]: [['עודכן', 'הערה'], [new Date(H.updated).toISOString(), 'הגיליון מתעדכן מהאפליקציה. אפשר לקרוא כאן, עדיף לערוך באפליקציה.'], ...Object.entries(H.groups).map(([g, e]) => [`קבוצה:${g}`, e])],
  };
}
export function fromRows(t) {
  const hab = (t[TABS[0]] || []).slice(1).filter(r => r[0]);
  if (!hab.length) return null;
  const list = hab.map(r => {
    const [id, name, emoji, kind, times, period, group, type, param, remind, remindEv, order] = r.map(x => x ?? '');
    const [base, flag] = String(type || 'daily').split('+');
    let show = { type: base };
    if (base === 'fixed') { const [days, rest = 'week'] = String(param).split('|'); const [every, anchor] = rest.split('@'); show.days = days ? days.split(',').map(Number) : []; show.every = every || 'week'; if (anchor) show.anchor = anchor; }
    else if (base === 'weekday' || base === 'biweek') { const [days, anchor] = String(param).split('@'); show.days = days ? days.split(',').map(Number) : []; if (anchor) show.anchor = anchor; }
    else if (base === 'monthday') show.day = Number(param) || 1;
    else if (param) show.n = String(param);
    if (flag === 'emoji') show.emoji = true;
    show = normShow(show);
    const [k0, sg] = String(kind || 'toggle').split(':');
    return { id, name, emoji, kind: k0, ...(sg === 'neg' ? { sign: 'neg' } : {}), times: times === '' ? null : Number(times), period: period || null, group, show, remind: String(remind || ''), remindEv: String(remindEv || ''), order: Number(order) || 0 };
  });
  const log = {};
  for (const [d, id, , v] of (t[TABS[1]] || []).slice(1)) if (d && id && Number(v)) log[`${d}|${id}`] = Number(v);
  const pins = {};
  for (const [d, id] of (t[TABS[2]] || []).slice(1)) if (d && id) (pins[d] ||= []).push(id);
  const updated = Date.parse((t[TABS[3]] || [])[1]?.[0] || '') || 0;
  const contacts = {};
  for (const [k, name, phone] of (t[TABS[4]] || []).slice(1)) if (k) contacts[k] = { name: name || '', phone: String(phone || '') };
  const groups = {};
  for (const [k, e] of (t[TABS[3]] || []).slice(2)) if (String(k).startsWith('קבוצה:') && e) groups[String(k).slice(6)] = e;
  return { list, log, pins, updated, contacts, groups };
}

let writeTimer = 0, writing = null;
function queueWrite() {
  if (!H.sheet || state.mode !== 'live') return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNow, 1200);
}
async function writeNow() {
  if (!H.sheet) return;
  if (writing) { await writing; }
  writing = (async () => {
    try { H.sync = 'syncing'; await api().writeSheet(H.sheet.id, toRows()); H.sync = 'ok'; }
    catch (e) { classify(e); }
    finally { writing = null; emit(); }
  })();
  return writing;
}
function classify(e) {
  const m = String(e?.message || e);
  if (e instanceof AuthError) { H.sync = 'error'; H.syncError = 'החיבור לגוגל פג'; return; }
  if (/insufficient|scope|403: Request had insufficient/i.test(m)) H.sync = 'needs-consent';
  else if (/has not been used|is disabled|not enabled|SERVICE_DISABLED|accessNotConfigured/i.test(m)) H.sync = 'needs-api';
  else H.sync = 'error';
  H.syncError = m;
  console.warn('habits sheet', m);
}

// Load: local copy first (instant), then the sheet (truth across devices). Newer side wins.
export async function loadHabits() {
  if (state.mode !== 'live') { H.sync = 'local'; emit(); loadEmojiEvents(); return; }
  try {
    H.sync = 'syncing'; emit();
    const a = api();
    if (!H.sheet) {
      H.sheet = await a.findSheet(SHEET_NAME) || await a.createSheet(SHEET_NAME, TABS);
      store.set('habitSheet', H.sheet);
    }
    await a.ensureTabs?.(H.sheet.id, TABS);
    let remote;
    try { remote = fromRows(await a.readSheet(H.sheet.id, TABS)); }
    catch (e) { if (/404|not found|Requested entity/i.test(e.message)) { store.del('habitSheet'); H.sheet = null; return loadHabits(); } throw e; }
    if (remote && remote.updated >= H.updated) {
      Object.assign(H, { list: remote.list, log: remote.log, pins: remote.pins, contacts: { ...H.contacts, ...remote.contacts }, groups: { ...H.groups, ...remote.groups }, updated: remote.updated });
      store.set('habits', { list: H.list, log: H.log, pins: H.pins, contacts: H.contacts, groups: H.groups, updated: H.updated });
      H.sync = 'ok';
    } else {
      await writeNow(); // empty sheet, or this device has newer changes
    }
  } catch (e) { classify(e); }
  migrateSigns();
  emit();
  loadEmojiEvents();
}
// once: the weed counter counts slips, not wins
function migrateSigns() {
  if (store.get('signsV')) return;
  const w = H.list.find(h => h.kind === 'count' && /וויד|ויד|גראס|weed/i.test(h.name));
  store.set('signsV', 1);
  if (w && !w.sign) { w.sign = 'neg'; persist(); }
}
export async function loadEmojiEvents() {
  if (!H.list.some(h => normShow(h.show).emoji)) return;
  try {
    const now = startOfDay(new Date());
    H.emojiEvents = await api().eventTitles(visibleCals(), addDays(now, -60), addMonths(now, 8));
    emit();
  } catch (e) { console.warn('emoji events', e); }
}
export const reconnectForHabits = () => auth.login({ silent: false });
export const rankedHabits = ref => rankedRows(ref).map(r => r.h);
// how many marks one member of a group has in the group's current period
export function memberCount(h, ref = new Date()) {
  if (!h.period) return 0;
  const [s, e] = periodWindow(h.period, ref);
  let n = 0; for (let d = new Date(s); d < e; d = addDays(d, 1)) if (valueOn(h, d) > 0) n++;
  return n;
}
// one emoji for a group: picked by hand, or a guess from its name
export function groupEmoji(g) {
  if (H.groups[g]) return H.groups[g];
  if (/חבר|פנאי|בילוי|יציא/.test(g)) return '🥳';
  return suggestEmojis(g)[0] || '✨';
}
export function setGroupEmoji(g, e) { H.groups[g] = e; persist(); }
export function setContact(key, c) { if (c) H.contacts[key] = c; else delete H.contacts[key]; persist(); }
