// Small helpers: escaping, Hebrew dates, time math

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromYmd = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
export const sameDay = (a, b) => ymd(a) === ymd(b);
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
export const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const dayName = d => DAYS[d.getDay()];
export const longDate = d => `${d.getDate()} ב${MONTHS[d.getMonth()]}`;
export const shortDate = d => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

export function relDayLabel(d, base = new Date()) {
  const n = daysBetween(base, d);
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === 2) return 'מחרתיים';
  if (n === -1) return 'אתמול';
  if (n > 2 && n < 7) return `יום ${dayName(d)}`;
  return shortDate(d);
}

// "בעוד 25 דק׳", "בעוד שעה ו־10 דק׳"
export function countdown(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'עכשיו';
  if (m < 60) return `בעוד ${m} דק׳`;
  const h = Math.floor(m / 60), r = m % 60;
  const hs = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  return r ? `בעוד ${hs} ו־${r} דק׳` : `בעוד ${hs}`;
}

export function daysLeftLabel(n) {
  if (n < 0) return n === -1 ? 'באיחור של יום' : `באיחור ${-n} ימים`;
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === 2) return 'מחרתיים';
  return `בעוד ${n} ימים`;
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem('md:' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('md:' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('md:' + k); } catch { /* ignore */ } },
};

export const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

export const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
