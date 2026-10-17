// The notification job. Runs every few minutes (GitHub schedule + an external timer) and sends whatever is due:
//  · the morning / evening nudges, at the times in push/schedule.json
//  · the app's own reminders plan (habits, tasks, birthdays, time to leave, habits at risk), read from the
//    `push-data` branch, sealed so only this job can read it (ECDH with the VAPID key pair)
//  · "remind me later" and "done" from notification buttons (push-data/inbox.json)
//  · a weather alert on unusual mornings, and a note when a new Design Digest issue is out
// What was already sent is kept on the `push-state` branch.
process.env.TZ = 'Asia/Jerusalem';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createECDH, hkdfSync, createDecipheriv } from 'node:crypto';

const here = p => new URL(p, import.meta.url);
const PUBLIC = readFileSync(here('../js/config.js'), 'utf8').match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1];
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const DRY = !!process.env.DRY_RUN;
if (!PRIVATE) { console.log('No VAPID_PRIVATE_KEY secret yet — skipping.'); process.exit(0); }

const readJson = (f, dflt) => { try { return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8') || 'null') ?? dflt : dflt; } catch { return dflt; } };
const schedule = readJson(here('./schedule.json'), {});
const stateFile = process.env.STATE_FILE;
const state = readJson(stateFile, {});
state.sent ||= {};
let changed = false;

const now = new Date(Number(process.env.NOW) || Date.now());
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(now);
const nowMin = now.getHours() * 60 + now.getMinutes();
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const LATE = 3 * 3600e3; // never send anything more than 3 hours late

// ---------- sealed plan ----------
function unseal(b) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(PRIVATE, 'base64url'));
  const shared = ecdh.computeSecret(Buffer.from(b.e, 'base64url'));
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(b.s, 'base64url'), Buffer.from('md-plan'), 32));
  const ct = Buffer.from(b.c, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.i, 'base64url'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
}
let plan = { items: [], made: 0, geo: null };
try { const f = readJson(process.env.PLAN_FILE, null); if (f?.blob) plan = unseal(f.blob); } catch (e) { console.error('plan unreadable:', e.message); }
const inbox = readJson(process.env.INBOX_FILE, []) || [];

const out = []; // [payload, onSent]

// ---------- 1. morning / evening ----------
const forced = ['morning', 'evening'].includes(process.env.KIND) ? process.env.KIND : null;
let kind = forced;
if (!kind) {
  for (const k of ['morning', 'evening']) {
    if (!schedule[k]) continue;
    const t = toMin(schedule[k]);
    if (nowMin >= t && nowMin < t + 180 && state[k] !== today) { kind = k; break; }
  }
}
if (kind) {
  const day = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(now);
  const tomorrow = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(+now + 864e5));
  out.push([kind === 'evening'
    ? { title: '🌙 סיכום ערב', body: `סוגרים את ${day} ומציצים על ${tomorrow}. דקה וזהו.`, url: './?wizard=evening', tag: 'evening' }
    : { title: `☀️ בוקר טוב! ${day} מתחיל`, body: 'שתי דקות לסדר את היום: אירועים, משימות ומיילים.', url: './?wizard=morning', tag: 'morning' },
  () => { state[kind] = today; }]);
}

// ---------- 2. the app's plan, plus "later" from the buttons ----------
const byId = new Map((plan.items || []).map(x => [x.id, x]));
const acks = inbox.filter(x => x.t === 'ack');
const skipped = it => it.skip && acks.some(a => a.at > (it.madeAt || plan.made) && (a.habits || []).some(h => it.skip.habits.includes(h))
  && (it.skip.scope === 'any' || a.day === it.skip.day));
const cands = (plan.items || []).filter(x => !x.past);
for (const s of inbox.filter(x => x.t === 'snooze')) {
  for (const id of s.ids || []) {
    const base = byId.get(String(id).split('~')[0]);
    if (base) cands.push({ ...base, id: `${base.id}~${s.until}`, at: s.until, madeAt: s.at, past: false });
  }
}
const due = cands.filter(it => it.at <= +now && it.at > +now - LATE && !state.sent[it.id] && !skipped(it));
const markSent = ids => () => { ids.forEach(id => { state.sent[id] = +now; }); };
const payload = it => ({ id: it.id, title: it.title, body: it.body, tag: it.tag, url: it.url, actions: it.actions, data: it.data });
const grouped = due.filter(x => x.group), single = due.filter(x => !x.group);
if (grouped.length > 1) {
  // several reminders at once → one notification
  out.push([{
    title: `🔔 ${grouped.length} תזכורות לעכשיו`, body: grouped.map(x => x.title).join('\n'), tag: 'group',
    url: grouped.every(x => x.kind === 'habit') ? './?habits=1' : './', ids: grouped.map(x => x.id),
    actions: [{ action: 'open', title: '📋 לפתוח' }, { action: 'later', title: '⏰ עוד שעה' }], data: { later: 60 },
  }, markSent(grouped.map(x => x.id))]);
} else single.push(...grouped);
for (const it of single) out.push([payload(it), markSent([it.id])]);

// ---------- 3. weather alert on unusual mornings ----------
async function weatherAlert() {
  if (!schedule.morning || state.weather === today) return;
  const t = toMin(schedule.morning);
  if (!(nowMin >= t && nowMin < t + 180)) return;
  const g = plan.geo || { lat: 32.0853, lon: 34.7818 };
  const q = `latitude=${g.lat}&longitude=${g.lon}&timezone=auto&past_days=1&forecast_days=2`;
  const fc = `https://api.open-meteo.com/v1/forecast?${q}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,snowfall_sum,apparent_temperature_max,apparent_temperature_min,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset`
    + '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility,uv_index';
  const aq = `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=dust,pm2_5,us_aqi`;
  const [j, a] = await Promise.all([fetch(fc).then(r => r.json()), fetch(aq).then(r => r.json()).catch(() => null)]);
  if (j.error) throw new Error(j.reason);
  const D = j.daily, H = j.hourly, A = a?.hourly, aqAt = {};
  (A?.time || []).forEach((t2, i) => { aqAt[t2] = { dust: A.dust?.[i], pm25: A.pm2_5?.[i], aqi: A.us_aqi?.[i] }; });
  const r0 = v => (v == null ? null : Math.round(v)), k = 1;
  const day = {
    date: D.time[k], code: D.weather_code[k], max: r0(D.temperature_2m_max[k]), min: r0(D.temperature_2m_min[k]),
    feelMax: r0(D.apparent_temperature_max?.[k]), feelMin: r0(D.apparent_temperature_min?.[k]),
    rain: D.precipitation_probability_max?.[k] ?? 0, rainMm: D.precipitation_sum?.[k] ?? 0, snow: D.snowfall_sum?.[k] ?? 0,
    uv: D.uv_index_max?.[k] ?? 0, wind: r0(D.wind_speed_10m_max?.[k]) ?? 0, gusts: r0(D.wind_gusts_10m_max?.[k]) ?? 0,
    sunrise: D.sunrise?.[k]?.slice(11, 16), sunset: D.sunset?.[k]?.slice(11, 16), prevMax: r0(D.temperature_2m_max[0]),
    hours: H.time.map((t2, i) => [t2, i]).filter(([t2]) => t2.startsWith(D.time[k])).map(([t2, i]) => ({
      h: Number(t2.slice(11, 13)), t: H.temperature_2m[i], feel: H.apparent_temperature[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
      pp: H.precipitation_probability[i] ?? 0, mm: H.precipitation[i] ?? 0, code: H.weather_code[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i],
      vis: H.visibility?.[i], uv: H.uv_index?.[i], ...(aqAt[t2] || {}),
    })),
  };
  // the app's own warnings bank (js/wear.js); copied to .mjs so Node reads it as a module
  writeFileSync('/tmp/wear.mjs', readFileSync(here('../js/wear.js'), 'utf8'));
  const { outfit } = await import('/tmp/wear.mjs');
  const o = outfit(day, { now, isToday: true });
  const serious = (o?.tips || []).filter(([e, , lvl]) => lvl === 'alert' || (lvl === 'warn' && e !== '🧴')); // UV is too common to ring for
  state.weather = today; changed = true;
  if (!serious.length) return;
  out.push([{ title: '⚠️ מזג האוויר היום', body: serious.map(([e, txt]) => `${e} ${txt}`).join('\n'), tag: 'weather', url: './' }, () => {}]);
}

// ---------- 4. a new Design Digest issue ----------
async function digestNote() {
  const idx = await fetch('https://noina-tv.github.io/design-digest/data/index.json', { cache: 'no-store' }).then(r => r.json());
  const top = idx.issues?.[0];
  if (!top) return;
  if (!state.digest) { state.digest = top.id; changed = true; return; } // first run: don't announce an old issue
  if (top.id === state.digest || now.getHours() < 8 || now.getHours() >= 22) return;
  out.push([{
    title: '¶ התלקיט של השבוע יצא', body: `גיליון ${top.he}: הדברים הכי טובים מהניוזלטרים על עיצוב ואנימציה.`, tag: 'digest',
    url: `https://noina-tv.github.io/design-digest/?issue=${top.id}`, actions: [{ action: 'open', title: '📖 לקריאה' }],
  }, () => { state.digest = top.id; }]);
}

await weatherAlert().catch(e => console.error('weather:', e.message));
await digestNote().catch(e => console.error('digest:', e.message));

// ---------- send ----------
if (!out.length) console.log(`Nothing due at ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}.`);
else {
  const subs = readJson(here('./subscriptions.json'), []);
  let webpush = null;
  if (!DRY) { webpush = (await import('web-push')).default; webpush.setVapidDetails('https://noina-tv.github.io/my-day-organizer/', PUBLIC, PRIVATE); }
  for (const [msg, onSent] of out) {
    let ok = 0;
    if (DRY) { console.log('WOULD SEND', JSON.stringify(msg)); ok = 1; }
    else for (const s of subs) {
      try { await webpush.sendNotification(s, JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'high' }); ok++; }
      catch (e) { console.error('failed', e.statusCode, e.body); }
    }
    console.log(`sent "${msg.title}" to ${ok}/${DRY ? 1 : subs.length}`);
    if (ok) { onSent(); changed = true; }
  }
}

// forget what was sent more than 3 days ago
for (const [id, t] of Object.entries(state.sent)) if (+now - t > 3 * 864e5) { delete state.sent[id]; changed = true; }
if (stateFile && changed) {
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync('/tmp/state.changed', '1');
}
