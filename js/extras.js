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
  const cached = store.get('weather');
  if (!force && cached && Date.now() - cached.at < 30 * 60_000) return cached;
  const g = await position();
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=2`;
  const r = await fetch(u);
  const j = await r.json();
  const w = {
    at: Date.now(), city: await cityName(g),
    now: Math.round(j.current.temperature_2m), code: j.current.weather_code, isDay: j.current.is_day,
    max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]),
    rain: j.daily.precipitation_probability_max[0],
    tomorrow: { max: Math.round(j.daily.temperature_2m_max[1]), min: Math.round(j.daily.temperature_2m_min[1]), code: j.daily.weather_code[1], rain: j.daily.precipitation_probability_max[1] },
  };
  store.set('weather', w);
  return w;
}

export const weatherLink = () => 'https://www.google.com/search?q=' + encodeURIComponent('מזג אוויר');

// Latest Design Digest issue (same origin → no CORS)
export async function latestDigest() {
  try {
    const idx = await (await fetch(`${DIGEST_URL}data/index.json`, { cache: 'no-cache' })).json();
    const latest = idx.issues?.[0];
    if (!latest) return null;
    const issue = await (await fetch(`${DIGEST_URL}data/${latest.id}.json`)).json();
    const top = (issue.items || []).filter(i => i.top).sort((a, b) => a.top - b.top).slice(0, 5);
    // cover: the most-mentioned of the top five that has a picture
    const score = i => (i.mentions || []).reduce((n, m) => n + (m.count || 1), 0);
    const cover = [...top].filter(i => i.image).sort((a, b) => score(b) - score(a) || a.top - b.top)[0]?.image || '';
    return {
      cover,
      id: latest.id, label: latest.he, intro: issue.intro?.he || issue.intro?.en || '',
      stats: issue.stats, url: DIGEST_URL, top: top.map(i => ({ title: i.title?.he || i.title?.en, image: i.image })),
      seen: store.get('digestSeen') === latest.id,
    };
  } catch { return null; }
}
export const markDigestSeen = id => store.set('digestSeen', id);
