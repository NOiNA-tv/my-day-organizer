// What to wear + weather heads-ups, from one day of weather() (daily summary + hourly data).
// Returns { wear, shoes, tips: [[emoji, text, level]] }; level: alert > warn > info > good.
// Only the waking hours that are still ahead count (07:00–22:00; for today, from now on).

const RANK = { alert: 0, warn: 1, info: 2, good: 3 };
const MAX_TIPS = 6;
const hh = h => `${String(h).padStart(2, '0')}:00`;
const r = Math.round;
const any = (hrs, f) => hrs.some(f);
const top = (hrs, k) => Math.max(...hrs.map(x => x[k] ?? -Infinity));
const low = (hrs, k) => Math.min(...hrs.map(x => x[k] ?? Infinity));
const THUNDER = [95, 96, 99], HAIL = [96, 99], SNOW = [71, 73, 75, 77, 85, 86], FOG = [45, 48];
const DRIZZLE = [51, 53, 55, 56, 57], FREEZING = [56, 57, 66, 67];

export function outfit(d, { now = new Date(), isToday = true } = {}) {
  if (!d?.hours?.length) return null;
  const from = isToday ? Math.max(7, now.getHours()) : 7;
  let hrs = d.hours.filter(x => x.h >= from && x.h <= 22);
  if (!hrs.length) hrs = d.hours.filter(x => x.h >= now.getHours()); // late at night: what's left
  if (!hrs.length) return null;

  const hi = r(top(hrs, 'feel')), lo = r(low(hrs, 'feel'));
  const tHi = r(top(hrs, 't'));
  const coldest = hrs.find(x => r(x.feel) === lo);
  const gust = r(top(hrs, 'gust')), wind = r(top(hrs, 'wind'));
  const pp = top(hrs, 'pp'), mm = hrs.reduce((n, x) => n + (x.mm || 0), 0);
  const uv = top(hrs, 'uv');
  const rhMin = low(hrs, 'rh'), dewMax = top(hrs, 'dew');
  const dust = top(hrs, 'dust'), aqi = top(hrs, 'aqi');
  const codes = new Set(hrs.map(x => x.code));
  const has = list => list.some(c => codes.has(c));
  const tips = [];
  const add = (e, t, level = 'info') => tips.push([e, t, level]);

  // ---------- base outfit, by how it feels at the warmest point ----------
  const wear =
    hi >= 36 ? 'בגדים קלילים ובהירים מבד נושם (כותנה, פשתן) וכובע' :
    hi >= 31 ? 'חולצה קצרה ובהירה, מכנס קצר או שמלה קלילה' :
    hi >= 27 ? 'חולצה קצרה ומכנס קליל' :
    hi >= 23 ? 'חולצה קצרה, אפשר מכנס ארוך דק' :
    hi >= 19 ? 'חולצה ארוכה דקה, או קצרה עם שכבה דקה עליה' :
    hi >= 15 ? 'חולצה ארוכה וסוודר או ז׳קט קל' :
    hi >= 11 ? 'סוודר ומעיל קל' :
    hi >= 6 ? 'מעיל חם, סוודר ושכבות' :
    'מעיל חורף, כובע גרב, צעיף וכפפות';

  const snowy = has(SNOW) || d.snow > 0;
  const wetDay = !snowy && (pp >= 50 || mm >= 1);
  const shoes =
    snowy ? 'נעליים חמות עם סוליה אוחזת' :
    mm >= 8 ? 'נעליים סגורות ועמידות למים' :
    wetDay ? 'נעליים סגורות, לא בד' :
    hi >= 28 ? 'סנדלים או נעליים מאווררות' : '';

  // ---------- storms, rain, snow ----------
  if (has(THUNDER)) add('⛈️', 'סופות רעמים: להתרחק משטחים פתוחים, מהים ומעמודי חשמל', 'alert');
  if (has(HAIL)) add('🧊', 'סיכוי לברד: עדיף חניה מקורה לרכב', 'alert');
  if (snowy) add('🌨️', 'שלג: נעליים עם אחיזה, ולבדוק סגירות כבישים לפני שיוצאים', 'alert');
  if (has(FREEZING)) add('🧊', 'גשם קופא: משטחים חלקים, ללכת ולנסוע לאט', 'alert');
  if (mm >= 15) add('🌧️', `גשם חזק (כ־${r(mm)} מ״מ): הצפות אפשריות, לתכנן יותר זמן לנסיעות`, 'alert');
  const wetFrom = hrs.find(x => x.pp >= 50);
  const dryAgain = wetFrom && hrs.filter(x => x.h > wetFrom.h).find(x => x.pp < 30);
  const when = wetFrom ? ` (${wetFrom.h <= from ? 'כבר מהבוקר' : `בערך מ־${hh(wetFrom.h)}`}${dryAgain ? `, מתבהר לקראת ${hh(dryAgain.h)}` : ''})` : '';
  if (wetDay && gust >= 45) add('🧥', `גשם עם רוח חזקה: מעיל גשם עם כובע עדיף על מטריה${when}`, 'warn');
  else if (wetDay && has(DRIZZLE) && mm < 1) add('🌦️', `טפטוף קל${when}: ז׳קט עם כובע יספיק`, 'info');
  else if (wetDay) add('☂️', `לקחת מטריה: ${r(pp)}% סיכוי לגשם${when}`, 'warn');
  else if (!snowy && pp >= 30) add('🌂', `אולי מטריה קטנה בתיק: ${r(pp)}% סיכוי לגשם`, 'info');

  // ---------- wind ----------
  if (gust >= 70) add('🌪️', `רוח סערה, משבים עד ${gust} קמ״ש: להתרחק מעצים ופיגומים ולקבע חפצים במרפסת`, 'alert');
  else if (gust >= 50) add('🌬️', `רוחות חזקות, משבים עד ${gust} קמ״ש: עליון שנסגר עד למעלה, מטריה לא תחזיק`, 'warn');
  else if (gust >= 38 && hi < 24) add('🌬️', `רוח ערה (עד ${gust} קמ״ש): עליון דק שחוסם רוח`, 'info');
  if (gust >= 40 && hi < 16) add('🥶', 'הרוח תגרום לקור להרגיש חזק יותר: שכבה חיצונית שחוסמת רוח', 'warn');

  // ---------- heat ----------
  if (hi >= 38) add('🥵', 'עומס חום כבד: להימנע משמש ישירה בין 11:00 ל־16:00 ולשתות כל שעה', 'alert');
  else if (hi >= 33) add('💧', 'חם מאוד: בקבוק מים בתיק וצל בשעות הצהריים', 'warn');
  if (tHi >= 30 && rhMin <= 25) add('🏜️', 'שרב: חם ויבש, לשתות הרבה, קרם לחות ושפתון, בלי מאמץ בחוץ', 'warn');
  else if (dewMax >= 22 && hi >= 27) add('💦', 'לח ומעיק: בדים נושמים, ואולי חולצה להחלפה', 'info');
  if (d.min >= 25) add('🌙', 'לילה חם: לילה של מזגן או מאוורר', 'info');

  // ---------- cold & swings ----------
  if (d.min <= 0) add('❄️', 'קרה בלילה ובבוקר: כביש חלק וצמחים רגישים, לכסות', 'warn');
  if (lo <= 3) add('🧤', 'קר מאוד בשעות הקרירות: כפפות וכובע', 'warn');
  else if (lo <= 7 && hi > lo + 3) add('🧤', 'בוקר קפוא: כפפות יעזרו', 'info');
  if (hi - lo >= 8 && lo < 20) {
    const part = coldest && coldest.h < 12 ? 'בבוקר' : 'בערב';
    add('🧥', `שכבה נוספת ${part}: מרגיש כמו ${lo}°`, 'info');
  } else {
    const eve = hrs.filter(x => x.h >= 19);
    if (eve.length && hi >= 22 && low(eve, 'feel') <= 17) add('🌙', `ערב קריר (${r(low(eve, 'feel'))}°): ז׳קט לחזרה הביתה`, 'info');
  }
  if (d.prevMax != null && isToday) {
    const diff = d.max - d.prevMax;
    if (diff >= 6) add('🌡️', `חם ב־${diff}° מאתמול: להתלבש קליל יותר`, 'warn');
    if (diff <= -6) add('🌡️', `קר ב־${-diff}° מאתמול: לא להתלבש כמו אתמול`, 'warn');
  }

  // ---------- sun ----------
  const clear = any(hrs.filter(x => x.h >= 10 && x.h <= 15), x => x.code <= 2);
  if (uv >= 11) add('🧴', `UV קיצוני (${r(uv)}): קרם הגנה כל שעתיים, כובע, משקפי שמש וצל בצהריים`, 'alert');
  else if (uv >= 8) add('🧴', `UV גבוה מאוד (${r(uv)}): קרם הגנה, כובע ומשקפי שמש`, 'warn');
  else if (uv >= 6) add('🧴', `UV גבוה (${r(uv)}): כדאי להימרח בקרם הגנה${clear ? ' ולקחת משקפי שמש' : ''}`, 'warn');
  else if (uv >= 3 && clear && hi >= 22) add('😎', `UV בינוני (${r(uv)}): קרם הגנה אם יוצאים בצהריים`, 'info');

  // ---------- air & visibility ----------
  if (dust >= 200 || aqi >= 150) add('😷', 'אובך כבד: להישאר בפנים ככל האפשר, חלונות סגורים, מסכה בחוץ', 'alert');
  else if (dust >= 80 || aqi >= 100) add('😷', 'אובך או זיהום אוויר: להימנע ממאמץ בחוץ, במיוחד לרגישים', 'warn');
  const foggy = hrs.filter(x => x.h <= 10 && (FOG.includes(x.code) || (x.vis != null && x.vis < 1000)));
  if (foggy.length) add('🌫️', 'ערפל בבוקר: זהירות בנהיגה, אורות דלוקים ומרחק מהרכב שלפנים', 'warn');

  // ---------- good news (only on a calm day) ----------
  const calm = !tips.some(t => t[2] === 'alert' || t[2] === 'warn');
  const weekend = [5, 6].includes(new Date(d.date + 'T12:00').getDay());
  if (calm && pp < 20 && gust < 35) {
    if (weekend && tHi >= 27 && tHi <= 33) add('🏖️', 'יום טוב לים', 'good');
    else if (hi >= 18 && hi <= 27) add('🌿', 'מזג אוויר נעים: יום טוב להליכה בחוץ', 'good');
  }
  if (pp < 10 && rhMin < 60 && hi >= 20 && !has(FOG) && dust < 80) add('🧺', 'יום טוב לייבש כביסה בחוץ', 'good');

  tips.sort((a, b) => RANK[a[2]] - RANK[b[2]]);
  return { wear, shoes, tips: tips.slice(0, MAX_TIPS) };
}
