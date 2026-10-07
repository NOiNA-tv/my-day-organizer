// Sends the morning / evening nudge to every subscribed device in push/subscriptions.json.
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const PUBLIC = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8').match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1];
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!PRIVATE) { console.log('No VAPID_PRIVATE_KEY secret yet — skipping.'); process.exit(0); }

// Which nudge is this? Cron slots map to a Jerusalem time only when the current UTC offset matches.
const offset = (() => {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;
  return Number((s.match(/GMT([+-]\d+)/) || [, 2])[1]);
})();
const SLOTS = { '30 4 * * *': ['morning', 3], '30 5 * * *': ['morning', 2], '30 17 * * *': ['evening', 3], '30 18 * * *': ['evening', 2] };
let kind = process.env.KIND;
if (!kind) {
  const slot = SLOTS[process.env.SCHEDULE];
  if (!slot || slot[1] !== offset) { console.log(`Slot ${process.env.SCHEDULE} not active at UTC+${offset} — skipping.`); process.exit(0); }
  kind = slot[0];
}

const day = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' }).format(new Date(Date.now() + 864e5));
const msg = kind === 'evening'
  ? { title: '🌙 סיכום ערב', body: `סוגרים את ${day} ומציצים על ${tomorrow}. דקה וזהו.`, url: './?wizard=evening', tag: 'evening' }
  : { title: `☀️ בוקר טוב! ${day} מתחיל`, body: 'שתי דקות לסדר את היום: אירועים, משימות ומיילים.', url: './?wizard=morning', tag: 'morning' };

webpush.setVapidDetails('https://noina-tv.github.io/my-day-organizer/', PUBLIC, PRIVATE);
const subs = JSON.parse(readFileSync(new URL('./subscriptions.json', import.meta.url), 'utf8'));
for (const s of subs) {
  try { await webpush.sendNotification(s, JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'high' }); console.log('sent', kind); }
  catch (e) { console.error('failed', e.statusCode, e.body); }
}
