// Phone notifications with buttons.
// The app is the brain: it works out what should ring in the next days (habit and task reminders, birthdays,
// time to leave for an event, habits at risk) and saves that list, encrypted, to the repo's `push-data` branch.
// A GitHub job (every 5 minutes) sends whatever is due. The buttons on a notification are handled in sw.js;
// marks made there wait in IndexedDB and are applied here the next time the app opens.
import { VAPID_PUBLIC_KEY } from './config.js';
import { state, api, visibleCals, subscribe, toggleTask, toast } from './data.js';
import { H, sorted, shownOn, valueOn, status, modeOf, normShow, members, statusText, PERIODS, setValue, bump, habitById, targetDays } from './habits.js';
import { birthdayContact } from './bday.js';
import { store, startOfDay, addDays, ymd, fromYmd, hm } from './util.js';
import { setTaskReminder, deferTask } from './data.js';
import { pushInfo } from './push.js';
import { ghGet, ghPut, hasGh, ghToken } from './push.js';
import { kv } from './kv.js';

const BRANCH = 'push-data';
const DAYS = 10; // how far ahead the plan looks (the app refreshes it whenever it's opened)
const KEEP_PAST = 6 * 3600e3; // already-rung items stay in the plan this long, so "remind me later" can find them
const RISK_AT = '18:00', BDAY_AT = '10:00';
export const leaveLead = () => store.get('leaveLead') ?? 60; // minutes before a timed event; 0 = off
const morningAt = () => pushInfo.schedule?.morning || '09:00'; // habit notifications come with the morning wizard

// ---------- MacroDroid: the phone-side helper for things a web app can't do (open apps, Bluetooth, places) ----------
// Each action is a MacroDroid macro with a Webhook trigger; the notification button calls its URL.
export const mdId = () => store.get('mdId') || '';
export const mdUrl = (ident, q = '') => (mdId() ? `https://trigger.macrodroid.com/${mdId()}/${ident}${q ? `?q=${encodeURIComponent(q)}` : ''}` : '');

// the buttons a habit notification can have. Each builds { action, title } and adds what it needs to data.
const mapsTo = (loc, mode) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc)}&travelmode=${mode}`;
export const BUTTONS = {
  none: { label: 'בלי כפתור' },
  done: { label: '✅ עשיתי', make: h => ({ action: h.kind === 'count' ? 'plus' : 'done', title: h.kind === 'count' ? '➕ עוד אחד' : '✅ עשיתי' }) },
  later: { label: '⏰ עוד שעה', make: () => ({ action: 'later', title: '⏰ עוד שעה' }) },
  shop: { label: '🛒 רשימת קניות', make: () => ({ action: 'app', title: '🛒 רשימת קניות', app: './?shop=1' }) },
  recipes: { label: '📒 מתכונים', make: () => ({ action: 'url', title: '📒 מתכונים', url: 'https://keep.google.com/#label/' + encodeURIComponent('מתכונים') }) },
  music: { label: '🎧 מוזיקה', make: () => ({ action: 'md', title: '🎧 מוזיקה', md: mdUrl('md-music') }) },
  maccabi: { label: '🏥 מכבי', make: () => ({ action: 'md', title: '🏥 מכבי', md: mdUrl('md-maccabi') }) },
  walk: { label: '🧭 ניווט רגלי', make: (h, ev) => (ev?.location ? { action: 'url', title: '🧭 ניווט', url: mapsTo(ev.location, 'walking') } : null) },
  event: { label: '📍 פתיחת האירוע', make: (h, ev) => (ev?.id ? { action: 'app', title: '📍 לאירוע', app: `./?event=${encodeURIComponent(ev.id)}` } : null) },
  link: { label: '🔗 קישור…', make: (h, ev, n) => (n.url ? { action: 'url', title: n.urlTitle || '🔗 קישור', url: n.url } : null) },
  macro: { label: '📱 MacroDroid…', make: (h, ev, n) => (n.macro && mdId() ? { action: 'md', title: n.macroTitle || '📱 פעולה', md: mdUrl(n.macro) } : null) },
};
function habitButtons(h, ev) {
  const n = h.notify || { b1: 'done', b2: 'later' };
  const out = [], data = {};
  for (const k of [n.b1 || 'done', n.b2 || 'none']) {
    const b = BUTTONS[k]?.make?.(h, ev, n);
    if (!b) continue;
    const key = `b${out.length}`;
    out.push({ action: b.action === 'done' || b.action === 'plus' || b.action === 'later' ? b.action : `${b.action}:${key}`, title: b.title });
    if (b.app) data[key] = b.app; if (b.url) data[key] = b.url; if (b.md) data[key] = b.md;
  }
  return { actions: out, data };
}
// what's still missing for notifications to flow ('' = nothing)
export function pipelineMissing() {
  if (state.mode !== 'live') return 'צריך להתחבר לגוגל';
  if (!hasGh()) return 'צריך לחבר את גיטהאב (בהתראות למטה)';
  if (!store.get('pushSub')) return 'צריך ללחוץ ״חיבור״ כדי שהטלפון יקבל התראות';
  return '';
}
export const pipelineOn = () => !pipelineMissing();
// the phone may already be subscribed even if this copy of the app forgot it (e.g. after clearing data)
export async function recoverSub() {
  try {
    if (store.get('pushSub') || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const s = await reg.pushManager.getSubscription();
    if (s) store.set('pushSub', s.toJSON());
  } catch { /* no push here */ }
}

const at = (d, t) => { const [h, m] = t.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const LATER_HOUR = { action: 'later', title: '⏰ עוד שעה' };
const ONLINE = /^(https?:|www\.)|zoom\.|meet\.google|teams\.microsoft|webex|whereby/i;

// ---------- what should ring ----------
function habitItems(now, today) {
  const out = [];
  for (const h of sorted()) {
    const s = normShow(h.show);
    const anyScope = s.type === 'since' || s.type === 'until'; // once done, the next days' reminders are moot too
    const tap = `./?habits=1&h=${h.id}`;
    // 1. a fixed time on the days it shows ("בשעה קבועה")
    if (h.remind && s.type !== 'none') {
      for (let i = 0; i < DAYS; i++) {
        const d = addDays(today, i), t = at(d, h.remind);
        if (t < now - KEEP_PAST) continue;
        if (h.kind !== 'count' && valueOn(h, d) > 0) continue;
        if (!shownOn(h, d)) continue;
        const { actions, data } = habitButtons(h, null);
        out.push({
          id: `h:${h.id}:${ymd(d)}`, at: +t, kind: 'habit',
          title: `${h.emoji} ${h.name}`, body: statusText(h, d), tag: `h:${h.id}`, url: tap,
          actions, data: { ...data, habit: h.id, day: ymd(d), later: 60 },
          skip: { habits: [h.id], scope: anyScope ? 'any' : 'day', day: ymd(d) },
        });
      }
    }
    // 2. mornings relative to the habit's day (that morning, the one before, a week before)
    const when = h.notify?.when || [];
    if (when.length) {
      const span = Math.max(0, ...when.map(x => -x));
      for (const { day, ev } of targetDays(h, today, addDays(today, DAYS + span))) {
        if (h.kind !== 'count' && valueOn(h, day) > 0) continue;
        for (const off of when) {
          const d = addDays(day, off), t = at(d, morningAt());
          if (t < now - KEEP_PAST || d >= addDays(today, DAYS)) continue;
          const { actions, data } = habitButtons(h, ev);
          const lead = off === 0 ? (ev ? `היום: ${ev.title}` : 'היום') : off === -1 ? 'מחר' : `בעוד ${-off} ימים, ב־${day.getDate()}/${day.getMonth() + 1}`;
          out.push({
            id: `n:${h.id}:${ymd(day)}:${off}`, at: +t, kind: 'habit',
            title: `${h.emoji} ${h.name}`, body: `${lead} · ${statusText(h, d)}`, tag: `h:${h.id}`, url: tap,
            actions, data: { ...data, habit: h.id, day: ymd(day), later: 60 },
            skip: { habits: [h.id], scope: 'any' },
          });
        }
      }
    }
  }
  return out;
}

// arriving somewhere (MacroDroid tells the job "gym"): one ready-made notification per place, sent on demand
function placeTriggers(now, today) {
  const out = {};
  for (const h of sorted()) {
    const place = h.notify?.place;
    if (!place) continue;
    const { actions, data } = habitButtons(h, null);
    out[place] = {
      id: `p:${place}:${ymd(today)}`, kind: 'habit', title: `${h.emoji} הגעת ל${h.name}`, body: statusText(h, today), tag: `h:${h.id}`,
      url: `./?habits=1&h=${h.id}`, actions, data: { ...data, habit: h.id, day: ymd(today), later: 60 },
      doneToday: valueOn(h, today) > 0, habit: h.id,
    };
  }
  return out;
}

function taskItems(now, events, keep) {
  const out = [];
  const add = (t, when, idp) => {
    const id = `${idp}:${t?.id}:${+when}`;
    if (!t || t.status === 'completed' || (when < now - KEEP_PAST && !keep.has(id))) return;
    out.push({
      id, at: +when, kind: 'task', group: true,
      title: `⏰ ${t.title}`, body: t.listTitle ? `משימה · ${t.listTitle}` : 'משימה', tag: `t:${t.id}`, url: `./?task=${t.id}`,
      actions: [{ action: 'tdone', title: '✅ עשיתי' }, { action: 'tlater', title: '⏰ אחר כך' }],
      data: { task: t.id, list: t.listId, title: t.title, at: +when },
    });
  };
  for (const ev of events) if (ev.taskRef) add(state.tasks.find(t => t.id === ev.taskRef), ev.start, 't');
  for (const [id, iso] of Object.entries(state.snoozes || {})) add(state.tasks.find(t => t.id === id), new Date(iso), 's');
  return out;
}

async function birthdayItems(now, today, events) {
  const out = [];
  for (const ev of events.filter(e => e.birthday && e.allDay && e.start < addDays(today, DAYS))) {
    const t = at(startOfDay(ev.start), BDAY_AT);
    if (t < now - KEEP_PAST || ev.start < today) continue;
    const c = await birthdayContact(ev);
    out.push({
      id: `b:${ev.id}:${ymd(ev.start)}`, at: +t, kind: 'bday',
      title: `🎂 היום יום ההולדת של ${c.name}`, body: c.wa ? 'מלאאאן מזל טוב! שולחים ברכה?' : 'אין לי מספר בשבילו עדיין. אפשר להוסיף באפליקציה.', tag: `b:${ev.id}`,
      url: `./?bday=${encodeURIComponent(ev.id)}`,
      actions: c.wa ? [{ action: 'wa', title: '💬 וואטסאפ' }, { action: 'tel', title: '📞 שיחה' }] : [{ action: 'open', title: '📝 להוסיף מספר' }],
      data: c.wa ? { wa: c.wa, tel: c.phone } : {},
    });
  }
  return out;
}

function eventItems(now, events) {
  const lead = leaveLead();
  if (!lead) return [];
  return events.filter(e => !e.allDay && !e.taskRef && !e.habitRef && !e.snoozeFor && !e.birthday && e.start > now)
    .map(e => {
      const t = new Date(e.start - lead * 60000), loc = (e.location || '').trim();
      const physical = loc && !ONLINE.test(loc), join = e.meet || (ONLINE.test(loc) && /^https?:/.test(loc) ? loc : '');
      const actions = [], data = {};
      if (physical) {
        const egg = mdUrl('md-egg', loc);
        actions.push(egg ? { action: 'md:b0', title: '🚌 תחב״צ' } : { action: 'url:b0', title: '🚌 תחב״צ' });
        data.b0 = egg || mapsTo(loc, 'transit');
        actions.push({ action: 'url:b1', title: '🚗 וייז' });
        data.b1 = `https://waze.com/ul?q=${encodeURIComponent(loc)}&navigate=yes`;
      } else if (join) { actions.push({ action: 'url:b0', title: '🎥 להצטרף' }); data.b0 = join; }
      const mins = lead >= 60 ? (lead === 60 ? 'בעוד שעה' : `בעוד ${lead / 60} שעות`) : `בעוד ${lead} דק׳`;
      return {
        id: `l:${e.id}:${+e.start}`, at: +t, kind: 'event',
        title: `📅 ${e.title} · ${hm(e.start)}`, body: `${mins}${loc ? ` · ${loc}` : ''}`, tag: `l:${e.id}`,
        url: `./?event=${encodeURIComponent(e.id)}`, actions, data,
      };
    }).filter(x => x.at > now - KEEP_PAST);
}

// a goal that can only just be reached: as many marks still needed as days left
function riskItems(now, today) {
  const out = [], seen = new Set();
  for (const h of sorted()) {
    if (!h.times || !h.period || h.period === 'day' || modeOf(h) !== 'quota') continue;
    if (h.group) { if (seen.has(h.group)) continue; seen.add(h.group); }
    const ms = members(h);
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i), t = at(d, RISK_AT);
      if (t < now - KEEP_PAST) continue;
      const st = status(h, d);
      if (!st.need || st.need !== st.left) continue;
      const per = PERIODS[h.period].label.replace('ב', 'ה');
      const name = h.group || h.name;
      out.push({
        id: `r:${h.group || h.id}:${ymd(d)}`, at: +t, kind: 'risk',
        title: `🔥 ${name}: ${st.need === 1 ? `נשארה הזדמנות אחת ${per}` : `נשארו ${st.need} הזדמנויות ${per}`}`,
        body: st.need === 1 ? `היום היום האחרון כדי לעמוד ביעד (${st.count}/${st.times}).` : `צריך עוד ${st.need} ב־${st.left} הימים שנשארו.`,
        tag: `r:${h.group || h.id}`, url: `./?habits=1&h=${h.id}`,
        actions: h.group ? [{ action: 'open', title: '📋 לפתוח' }, LATER_HOUR] : [{ action: 'done', title: '✓ בוצע' }, LATER_HOUR],
        data: h.group ? { later: 60 } : { habit: h.id, day: ymd(d), later: 60 },
        skip: { habits: ms.map(m => m.id), scope: 'any' },
      });
      break; // one nudge per round is enough; the plan is rebuilt whenever the app opens
    }
  }
  return out;
}

// "תזכורת לדוגמה" in settings: one item a minute from when it was asked for
function testItem(now) {
  const t = store.get('testPush');
  if (!t || t < now - KEEP_PAST) return [];
  return [{ id: `x:${t}`, at: t, kind: 'test', title: '🔔 תזכורת לדוגמה', body: 'ככה תיראה תזכורת. הכפתורים פה עובדים, אבל לא מסמנים כלום.', tag: 'test', url: './',
    actions: [{ action: 'later', title: '⏰ עוד שעה' }, { action: 'open', title: '📋 לפתוח' }], data: { later: 60 } }];
}

let evCache = { at: 0, list: [] };
async function upcomingEvents(today) {
  if (Date.now() - evCache.at < 10 * 60000) return evCache.list;
  const list = await api().events(visibleCals(), addDays(today, -1), addDays(today, DAYS + 1));
  evCache = { at: Date.now(), list };
  return list;
}

// keep: ids that a pending "remind me tomorrow" still points at
export async function buildPlan(now = new Date(), keep = new Set()) {
  const today = startOfDay(now);
  const events = await upcomingEvents(today).catch(() => state.events);
  const items = [
    ...habitItems(now, today), ...taskItems(now, events, keep), ...await birthdayItems(now, today, events),
    ...eventItems(now, events), ...riskItems(now, today),
    ...testItem(now),
  ].map(x => (x.at <= +now ? { ...x, past: true } : x)).sort((a, b) => a.at - b.at);
  const g = store.get('geo');
  return { v: 1, made: Date.now(), geo: g ? { lat: g.lat, lon: g.lon } : null, items, triggers: placeTriggers(now, today),
    links: { weather: mdUrl('md-weather') || 'https://www.google.com/search?q=' + encodeURIComponent('מזג אוויר') } };
}

// ---------- sealing: only the GitHub job (it holds the VAPID private key) can read the plan ----------
const b64u = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ub64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + p), c => c.charCodeAt(0)); };
export async function seal(obj) {
  const C = crypto.subtle, curve = { name: 'ECDH', namedCurve: 'P-256' };
  const server = await C.importKey('raw', ub64(VAPID_PUBLIC_KEY), curve, false, []);
  const eph = await C.generateKey(curve, true, ['deriveBits']);
  const bits = await C.deriveBits({ name: 'ECDH', public: server }, eph.privateKey, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const hk = await C.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await C.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('md-plan') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await C.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { e: b64u(await C.exportKey('raw', eph.publicKey)), s: b64u(salt), i: b64u(iv), c: b64u(ct) };
}

// ---------- saving ----------
export const planInfo = { at: store.get('planAt') || 0, count: store.get('planCount') || 0, error: '' };
let timer = 0, writing = null;
export function schedulePlan(ms = 15000) { clearTimeout(timer); timer = setTimeout(() => writePlan().catch(() => {}), ms); }

const sigOf = (items, extra = {}) => JSON.stringify([items.filter(x => !x.past).map(x => [x.id, x.at, x.title, x.body, x.actions.map(a => a.action), x.data]), extra]);
export async function writePlan({ force = false } = {}) {
  await recoverSub();
  if (!pipelineOn()) return;
  if (writing) return writing;
  writing = (async () => {
    try {
      syncKeys();
      const box = await ghGet('inbox.json', BRANCH).catch(() => null);
      const keep = new Set((Array.isArray(box) ? box : []).filter(x => x.t === 'snooze' && x.until > Date.now()).flatMap(x => x.ids.map(i => String(i).split('~')[0])));
      const plan = await buildPlan(new Date(), keep);
      const sig = sigOf(plan.items, { t: plan.triggers, l: plan.links });
      if (!force && sig === store.get('planSig') && Date.now() - (store.get('planAt') || 0) < 6 * 3600e3) return;
      const blob = await seal(plan);
      for (let k = 0; ; k++) {
        try { await ghGet('plan.json', BRANCH); await ghPut('plan.json', { v: 1, made: plan.made, blob }, 'Reminders plan', BRANCH); break; }
        catch (e) { if (!e.conflict || k >= 2) throw e; }
      }
      store.set('planSig', sig); store.set('planAt', Date.now()); store.set('planCount', plan.items.filter(x => !x.past).length);
      Object.assign(planInfo, { at: Date.now(), count: store.get('planCount'), error: '' });
      pruneInbox().catch(() => {});
    } catch (e) { planInfo.error = e.message; console.warn('plan', e); }
    finally { writing = null; }
  })();
  return writing;
}

// what the notification buttons sent (acks, snoozes): drop entries older than two days
async function pruneInbox() {
  const box = await ghGet('inbox.json', BRANCH);
  if (!Array.isArray(box)) return;
  const keep = box.filter(x => Date.now() - (x.at || 0) < 2 * 864e5);
  if (keep.length !== box.length) await ghPut('inbox.json', keep, 'Inbox tidy', BRANCH);
}

// the service worker needs these when the app is closed
export function syncKeys() {
  kv.set('gh', ghToken() || '');
  kv.set('gtok', store.get('token') || null);
}

// ---------- marks made from a notification while the app was closed ----------
export async function drainQueue() {
  const q = (await kv.get('queue')) || [];
  if (!q.length) return;
  await kv.set('queue', []);
  const names = [];
  for (const x of q) {
    if (x.t === 'habit') {
      const h = habitById(x.id); if (!h) continue;
      const d = fromYmd(x.day);
      if (x.op === 'plus') bump(x.id, d, 1); else if (!valueOn(h, d)) setValue(x.id, d, 1);
      names.push(`${h.emoji} ${h.name}`);
    } else if (x.t === 'taskMove') {
      const t = state.tasks.find(y => y.id === x.id), d = new Date(x.until);
      if (!t || t.status === 'completed') continue;
      setTaskReminder(x.id, d);
      if (t.due && t.due !== ymd(d)) deferTask(x.id, ymd(d), '', { silent: true });
      names.push(`${t.title} ← ${hm(d)}`);
    } else if (x.t === 'task') {
      const t = state.tasks.find(y => y.id === x.id);
      if (t && t.status !== 'completed') toggleTask(x.id, { silent: true });
      if (t) names.push(t.title);
    }
  }
  if (names.length) toast(`סומן מההתראות: ${names.join(', ')}`);
}

// ---------- the move away from calendar reminders (once) ----------
// Habit helper events go; task helper events stay (they hold the task's time) but stop ringing; snooze events go.
export async function migrateCalendarReminders() {
  await recoverSub();
  if (!pipelineOn() || store.get('remMigrated')) return;
  try {
    const a = api(), today = startOfDay(new Date());
    const primary = state.cals.filter(c => c.primary);
    const evs = await a.events(primary, addDays(today, -2), addDays(today, 120));
    for (const ev of evs) {
      if (ev.habitRef || ev.snoozeFor) await a.deleteEvent(ev).catch(() => {});
      else if (ev.taskRef && ev.reminders?.length) await a.setReminders(ev, []).catch(() => {});
    }
    H.list.forEach(h => { h.remindEv = ''; });
    state.events = state.events.filter(e => !e.habitRef && !e.snoozeFor);
    store.set('remMigrated', 1);
  } catch (e) { console.warn('reminder migration', e); }
}

// ---------- the GitHub job: when did it last run? ----------
export async function lastServerRun() {
  try {
    const h = ghToken() ? { Authorization: `Bearer ${ghToken()}` } : {};
    const r = await fetch('https://api.github.com/repos/NOiNA-tv/my-day-organizer/actions/workflows/daily-push.yml/runs?per_page=1', { headers: h, cache: 'no-store' });
    const j = await r.json();
    const run = j.workflow_runs?.[0];
    return run ? new Date(run.run_started_at || run.created_at) : null;
  } catch { return null; }
}

export function startNotify() {
  syncKeys();
  subscribe(() => schedulePlan());
  setInterval(() => schedulePlan(0), 3 * 3600e3);
}
