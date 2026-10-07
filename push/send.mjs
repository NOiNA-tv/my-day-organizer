// Sends the morning / evening nudge to every device in push/subscriptions.json,
// at the times set in push/schedule.json (Jerusalem time), once per day each.
import webpush from 'web-push';
import { readFileSync, writeFileSync } from 'node:fs';

const here = p => new URL(p, import.meta.url);
const PUBLIC = readFileSync(here('../js/config.js'), 'utf8').match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1];
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!PRIVATE) { console.log('No VAPID_PRIVATE_KEY secret yet — skipping.'); process.exit(0); }

const schedule = JSON.parse(readFileSync(here('./schedule.json'), 'utf8'));
const stateFile = process.env.STATE_FILE;
const state = stateFile ? JSON.parse(readFileSync(stateFile, 'utf8') || '{}') : {};

// Jerusalem wall-clock now
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date()).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

let kind = process.env.KIND || null;
if (!kind) {
  for (const k of ['morning', 'evening']) {
    if (!schedule[k]) continue;
    const t = toMin(schedule[k]);
    // due, not yet sent today, and not more than 2 hours late (GitHub's scheduler can lag)
    if (nowMin >= t && nowMin < t + 120 && state[k] !== today) { kind = k; break; }
  }
}
if (!kind) { console.log(`Nothing due at ${parts.hour}:${parts.minute}.`); process.exit(0); }

const day = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(new Date(Date.now() + 864e5));
const msg = kind === 'evening'
  ? { title: '🌙 סיכום ערב', body: `סוגרים את ${day} ומציצים על ${tomorrow}. דקה וזהו.`, url: './?wizard=evening', tag: 'evening' }
  : { title: `☀️ בוקר טוב! ${day} מתחיל`, body: 'שתי דקות לסדר את היום: אירועים, משימות ומיילים.', url: './?wizard=morning', tag: 'morning' };

webpush.setVapidDetails('https://noina-tv.github.io/my-day-organizer/', PUBLIC, PRIVATE);
const subs = JSON.parse(readFileSync(here('./subscriptions.json'), 'utf8'));
let ok = 0;
for (const s of subs) {
  try { await webpush.sendNotification(s, JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'high' }); ok++; }
  catch (e) { console.error('failed', e.statusCode, e.body); }
}
console.log(`sent ${kind} to ${ok}/${subs.length}`);
if (!process.env.KIND && stateFile) {
  state[kind] = today;
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync('/tmp/state.changed', '1');
}
