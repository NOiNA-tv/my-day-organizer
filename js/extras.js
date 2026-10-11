// Weather (Open-Meteo, no key) and the Design Digest feed.
import { store } from './util.js';
import { DIGEST_URL } from './config.js';

// WMO weather codes → emoji + Hebrew label
const WMO = [
  [[0], '☀️', 'בהיר', '🌙'], [[1], '🌤️', 'בהיר ברובו', '🌙'], [[2], '⛅', 'מעונן חלקית', '☁️'], [[3], '☁️', 'מעונן'],
  [[45, 48], '🌫️', 'ערפל'], [[51, 53, 55, 56, 57], '🌦️', 'טפטוף'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'גשם'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'שלג'], [[95, 96, 99], '⛈️', 'סופת רעמים'],
];
export function wmo(code, isDay = 1) {
  const row = WMO.find(r => r[0].includes(code)) || WMO[3];
  return { icon: !isDay && row[3] ? row[3] : row[1], label: row[2] };
}

const FALLBACK = { lat: 32.0853, lon: 34.7818, city: 'תל אביב' };

function position() {
  const saved = store.get('geo');
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(saved || FALLBACK);
    navigator.geolocation.getCurrentPosition(
      p => { const g = { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }; store.set('geo', { ...saved, ...g }); resolve({ ...saved, ...g }); },
      () => resolve(saved || FALLBACK),
      { maximumAge: 30 * 60_000, timeout: 6000 },
    );
  });
}

async function cityName(g) {
  if (g.city && g.cityAt === `${g.lat},${g.lon}`) return g.city;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${g.lat}&longitude=${g.lon}&localityLanguage=he`);
    const j = await r.json();
    const city = j.city || j.locality || '';
    store.set('geo', { ...g, city, cityAt: `${g.lat},${g.lon}` });
    return city;
  } catch { return g.city || ''; }
}

export async function weather({ force = false } = {}) {
  const cached = store.get('weather3');
  if (!force && cached && Date.now() - cached.at < 30 * 60_000) return cached;
  const g = await position();
  const q = `latitude=${g.lat}&longitude=${g.lon}&timezone=auto&past_days=1&forecast_days=3`;
  const fc = `https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code,is_day`
    + '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,snowfall_sum,apparent_temperature_max,apparent_temperature_min,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset'
    + '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility,uv_index';
  const aq = `https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=dust,pm2_5,us_aqi`;
  const [j, a] = await Promise.all([fetch(fc).then(r => r.json()), fetch(aq).then(r => r.json()).catch(() => null)]);
  if (j.error) throw new Error(j.reason);
  const D = j.daily, H = j.hourly, A = a?.hourly;
  const aqAt = {};
  (A?.time || []).forEach((t, i) => { aqAt[t] = { dust: A.dust?.[i], pm25: A.pm2_5?.[i], aqi: A.us_aqi?.[i] }; });
  const r0 = v => (v == null ? null : Math.round(v));
  // one day = daily summary + its hours (index 0 = yesterday, 1 = today, 2 = tomorrow)
  const day = k => ({
    date: D.time[k], code: D.weather_code[k],
    max: r0(D.temperature_2m_max[k]), min: r0(D.temperature_2m_min[k]),
    feelMax: r0(D.apparent_temperature_max?.[k]), feelMin: r0(D.apparent_temperature_min?.[k]),
    rain: D.precipitation_probability_max?.[k] ?? 0, rainMm: D.precipitation_sum?.[k] ?? 0, snow: D.snowfall_sum?.[k] ?? 0,
    uv: D.uv_index_max?.[k] ?? 0, wind: r0(D.wind_speed_10m_max?.[k]) ?? 0, gusts: r0(D.wind_gusts_10m_max?.[k]) ?? 0,
    sunrise: D.sunrise?.[k]?.slice(11, 16), sunset: D.sunset?.[k]?.slice(11, 16),
    prevMax: k > 0 ? r0(D.temperature_2m_max[k - 1]) : null,
    hours: H.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(D.time[k])).map(([t, i]) => ({
      h: Number(t.slice(11, 13)), t: H.temperature_2m[i], feel: H.apparent_temperature[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
      pp: H.precipitation_probability[i] ?? 0, mm: H.precipitation[i] ?? 0, code: H.weather_code[i], wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i],
      vis: H.visibility?.[i], uv: H.uv_index?.[i], ...(aqAt[t] || {}),
    })),
  });
  const today = day(1), tomorrow = day(2);
  const w = {
    at: Date.now(), city: await cityName(g),
    now: Math.round(j.current.temperature_2m), code: j.current.weather_code, isDay: j.current.is_day,
    max: today.max, min: today.min, rain: today.rain,
    today, tomorrow,
  };
  store.set('weather3', w);
  return w;
}

export const weatherLink = () => 'https://www.google.com/search?q=' + encodeURIComponent('מזג אוויר');

// Latest Design Digest issue (same origin → no CORS)
// Issues by date (each issue's id is its Sunday, e.g. 2026-10-04)
let digestIdx = null;
const issueCache = new Map();
export async function digestIndex() {
  if (!digestIdx) digestIdx = fetch(`${DIGEST_URL}data/index.json`, { cache: 'no-cache' }).then(r => r.json()).then(j => (j.issues || []).map(x => ({ id: x.id, label: x.he }))).catch(() => []);
  return digestIdx;
}
export async function digestIssue(id) {
  if (issueCache.has(id)) return issueCache.get(id);
  const p = (async () => {
    const meta = (await digestIndex()).find(x => x.id === id);
    if (!meta) return null;
    const issue = await (await fetch(`${DIGEST_URL}data/${id}.json`)).json();
    const top = (issue.items || []).filter(i => i.top).sort((a, b) => a.top - b.top).slice(0, 5);
    // cover: the most-mentioned of the top five that has a picture
    const score = i => (i.mentions || []).reduce((n, m) => n + (m.count || 1), 0);
    const coverItem = [...top].filter(i => i.image).sort((a, b) => score(b) - score(a) || a.top - b.top)[0];
    const cover = coverItem?.image || '';
    // teaser: the headline behind the cover picture (or the #1 story)
    const lead = coverItem || top[0];
    const teaser = lead ? (lead.title?.he || lead.title?.en || '') : '';
    return {
      id, cover, teaser, more: Math.max(0, (issue.stats?.kept || (issue.items || []).length) - 1), label: meta.label, intro: issue.intro?.he || issue.intro?.en || '',
      stats: issue.stats, url: `${DIGEST_URL}?issue=${id}`, top: top.map(i => ({ title: i.title?.he || i.title?.en, image: i.image })),
      seen: (store.get('digestSeenAll') || []).includes(id) || store.get('digestSeen') === id,
    };
  })().catch(() => null);
  issueCache.set(id, p);
  return p;
}
export async function latestDigest() {
  const idx = await digestIndex();
  return idx[0] ? digestIssue(idx[0].id) : null;
}
export const markDigestSeen = id => { store.set('digestSeen', id); store.set('digestSeenAll', [...new Set([...(store.get('digestSeenAll') || []), id])]); };

export { outfit } from './wear.js';
