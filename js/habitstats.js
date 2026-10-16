// Habit statistics for the dashboard: how the habits break down — by habit, by weekday, by month, by member.
// Ideas from the research: no breaking chains (successful weeks, not days), habit strength that grows slowly
// (Loop-style score; ~66 days on average to become automatic), and plain dot calendars.
import { H, PERIODS, sorted, valueOn, members, periodWindow, modeOf } from './habits.js';
import { esc, ymd, fromYmd, addDays, startOfDay, daysBetween, MONTHS_SHORT } from './util.js';

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const today = () => startOfDay(new Date());

// every marked day per habit id
function datesOf(id) {
  const out = [];
  for (const [k, v] of Object.entries(H.log)) if (v && k.endsWith('|' + id)) out.push(k.slice(0, 10));
  return out.sort();
}
const firstMark = () => Object.keys(H.log).sort()[0]?.slice(0, 10) || null;
const goalHabits = () => sorted().filter(h => modeOf(h) !== 'tally');
const tallyHabits = () => sorted().filter(h => modeOf(h) === 'tally');

// success of one goal habit in its past periods since tracking began (0..1), or null
function successRate(h) {
  const start = firstMark(); if (!start) return null;
  const s = fromYmd(start);
  if (modeOf(h) === 'interval') {
    const d = [...new Set(members(h).flatMap(m => datesOf(m.id)))].sort().map(fromYmd);
    if (d.length < 2) return null;
    const per = PERIODS[h.period], ok = d.slice(1).filter((x, i) => daysBetween(d[i], x) <= per.days * 1.15).length;
    return ok / (d.length - 1);
  }
  let done = 0, n = 0, [a] = periodWindow(h.period, today());
  for (let i = 0; i < 12; i++) {
    const [ps, pe] = periodWindow(h.period, addDays(a, -1));
    if (pe <= s) break;
    let c = 0; for (const m of members(h)) for (let d = new Date(ps); d < pe; d = addDays(d, 1)) if (valueOn(m, d)) c++;
    n++; if (c >= h.times) done++;
    a = ps;
  }
  return n ? done / n : null;
}

// Loop Habit Tracker-style strength: exponential smoothing of daily check-ins, weighted by how often it's meant to happen
function strength(h) {
  if (modeOf(h) === 'tally') return null;
  const start = firstMark(); if (!start) return 0;
  const freq = Math.min(1, h.times / PERIODS[h.period].days);
  const m = Math.pow(0.5, Math.sqrt(freq) / 13);
  let score = 0;
  for (let d = fromYmd(start); d <= today(); d = addDays(d, 1)) {
    const done = members(h).some(x => valueOn(x, d));
    score = score * m + (done ? 1 : 0) * (1 - m);
  }
  // normalise: a habit done exactly at its target frequency converges to `freq`
  return Math.min(1, score / freq);
}

const tile = (label, value, sub = '') => `<div class="st-tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const card = (title, body, note = '') => `<div class="st-card"><h3>${title}</h3>${body}${note ? `<p class="st-note">${note}</p>` : ''}</div>`;
const hbar = (label, v, max, txt, cls = '') => `<div class="st-hbar ${cls}" title="${esc(label)}: ${txt}"><span class="st-lab">${label}</span><span class="st-track"><i style="--p:${max ? v / max : 0}"></i></span><b>${txt}</b></div>`;

function summary() {
  const t = today();
  let last30 = 0, prev30 = 0;
  for (const [k, v] of Object.entries(H.log)) {
    if (!v) continue;
    const n = daysBetween(fromYmd(k.slice(0, 10)), t);
    if (n >= 0 && n < 30) last30++; else if (n >= 30 && n < 60) prev30++;
  }
  const rates = goalHabits().filter((h, i, a) => !h.group || a.findIndex(x => x.group === h.group) === i).map(successRate).filter(r => r != null);
  const score = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 100) : null;
  const diff = last30 - prev30;
  const days = firstMark() ? daysBetween(fromYmd(firstMark()), t) + 1 : 0;
  return `<div class="st-tiles">
    ${tile('התמדה', score == null ? '—' : `${score}%`, score == null ? 'אחרי תקופה מלאה ראשונה' : 'תקופות שעמדו ביעד')}
    ${tile('סימונים, 30 יום', last30, prev30 || diff ? `${diff >= 0 ? '+' : ''}${diff} מהחודש שלפני` : '')}
    ${tile('ימי מעקב', days, days ? `מאז ${fromYmd(firstMark()).getDate()} ב${MONTHS_SHORT[fromYmd(firstMark()).getMonth()]}` : 'עוד לא התחיל')}
  </div>`;
}

// dot calendar: last 13 weeks, darker = more habits that day (one hue, light → dark)
function heatmap() {
  const t = today(), start = addDays(t, -t.getDay() - 7 * 12);
  const ids = goalHabits().map(h => h.id);
  const counts = [];
  for (let d = new Date(start); d <= t; d = addDays(d, 1)) counts.push([new Date(d), ids.filter(id => H.log[`${ymd(d)}|${id}`]).length]);
  const max = Math.max(1, ...counts.map(c => c[1]));
  const cols = [];
  for (let w = 0; w < 13; w++) cols.push(counts.slice(w * 7, w * 7 + 7));
  return `<div class="st-heat" role="img" aria-label="מפת ימים של 13 שבועות">
    <div class="st-heat-dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="st-heat-grid">${cols.map(col => `<div>${col.map(([d, c]) => `<i class="l${c ? Math.ceil(c / max * 4) : 0}" title="${d.getDate()} ב${MONTHS_SHORT[d.getMonth()]}: ${c} הרגלים"></i>`).join('')}</div>`).join('')}</div>
  </div>
  <div class="st-legend"><span>פחות</span>${[0, 1, 2, 3, 4].map(l => `<i class="l${l}"></i>`).join('')}<span>יותר</span></div>`;
}

// how many times each habit was done in the last 30 days, and how often it met its goal
function byHabit() {
  const t = today();
  const seen = new Set();
  const rows = goalHabits().filter(h => (h.group ? !seen.has(h.group) && seen.add(h.group) : true)).map(h => {
    let n = 0; for (let i = 0; i < 30; i++) for (const m of members(h)) if (valueOn(m, addDays(t, -i))) n++;
    return { h, n, r: successRate(h) };
  }).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map(r => r.n));
  const lab = h => (h.group ? `${members(h).map(m => m.emoji).join('')} ${esc(h.group)}` : `${h.emoji} ${esc(h.name)}`);
  return rows.map(({ h, n, r }) => hbar(lab(h), n, max, `${n}${r != null ? ` · ${Math.round(r * 100)}%` : ''}`)).join('');
}

function byWeekday() {
  const c = [0, 0, 0, 0, 0, 0, 0];
  const ids = new Set(goalHabits().map(h => h.id));
  for (const [k, v] of Object.entries(H.log)) if (v && ids.has(k.slice(11))) c[fromYmd(k.slice(0, 10)).getDay()]++;
  const max = Math.max(1, ...c), best = c.indexOf(Math.max(...c));
  return `<div class="st-cols">${c.map((n, i) => `<div class="st-col ${i === best && n ? 'top' : ''}" title="יום ${DOW[i]}: ${n} סימונים"><b>${n || ''}</b><span class="st-colbar"><i style="--p:${n / max}"></i></span><small>${DOW[i]}</small></div>`).join('')}</div>`;
}

function strengths() {
  const seen = new Set();
  const rows = goalHabits().filter(h => (h.group ? !seen.has(h.group) && seen.add(h.group) : true)).map(h => ({ h, s: strength(h) })).sort((a, b) => b.s - a.s);
  return rows.map(({ h, s }) => hbar(h.group ? `${members(h).map(m => m.emoji).join('')} ${esc(h.group)}` : `${h.emoji} ${esc(h.name)}`, s, 1, `${Math.round(s * 100)}%`, s >= .8 ? 'good' : '')).join('');
}

// once-every-X habits: the real gap between times vs the target
function rhythm() {
  const rows = goalHabits().filter(h => modeOf(h) === 'interval' && !h.group).map(h => {
    const d = datesOf(h.id).map(fromYmd);
    const gaps = d.slice(1).map((x, i) => daysBetween(d[i], x));
    return { h, avg: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null, target: PERIODS[h.period].days };
  });
  if (!rows.some(r => r.avg != null)) return '<p class="st-empty">אחרי שתי פעמים בכל הרגל יופיע כאן כל כמה זמן הוא קורה בפועל.</p>';
  const max = Math.max(...rows.map(r => Math.max(r.avg || 0, r.target)));
  return rows.map(({ h, avg, target }) => `<div class="st-rhythm" title="${esc(h.name)}: ${avg == null ? 'עוד אין נתון' : `בממוצע כל ${Math.round(avg)} ימים`} · יעד ${target}">
    <span class="st-lab">${h.emoji} ${esc(h.name)}</span>
    <span class="st-track">${avg != null ? `<i class="${avg > target * 1.15 ? 'late' : ''}" style="--p:${avg / max}"></i>` : ''}<em style="--p:${target / max}"></em></span>
    <b>${avg == null ? '—' : `${Math.round(avg)} ימים`}</b></div>`).join('') + '<div class="st-legend"><i class="tick"></i><span>היעד</span></div>';
}

// a group's goal, month by month, split by member
function groupMonths(h) {
  const ms = members(h), t = today(), out = [];
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(t.getFullYear(), t.getMonth() - i, 15);
    const [s, e] = periodWindow(h.period, ref);
    const per = ms.map(m => { let c = 0; for (let d = new Date(s); d < e; d = addDays(d, 1)) if (valueOn(m, d)) c++; return c; });
    out.push({ label: MONTHS_SHORT[s.getMonth()], per, total: per.reduce((a, b) => a + b, 0) });
  }
  const max = Math.max(Math.ceil(h.times * 1.4), ...out.map(o => o.total)); // headroom above the goal line
  const shades = ['s1', 's2', 's3', 's4', 's5'];
  return `<div class="st-cols stack">${out.map(o => `<div class="st-col" title="${o.label}: ${o.total} (${ms.map((m, j) => `${m.emoji}${o.per[j]}`).join(' ')})"><b>${o.total || ''}</b>
      <span class="st-colbar"><span class="st-goal" style="--p:${h.times / max}"></span>${o.per.map((c, j) => c ? `<i class="${shades[j % 5]}" style="--p:${c / max}"></i>` : '').join('')}</span><small>${o.label}</small></div>`).join('')}</div>
    <div class="st-legend">${ms.map((m, j) => `<i class="${shades[j % 5]}"></i><span>${m.emoji} ${esc(m.name)}</span>`).join('')}<i class="tick"></i><span>יעד ${h.times}</span></div>`;
}

// tally habits (no goal): 30 days, average, and days at zero
function tally(h) {
  const t = today(), vals = [];
  for (let i = 29; i >= 0; i--) vals.push([addDays(t, -i), valueOn(h, addDays(t, -i))]);
  let prev = 0; for (let i = 30; i < 60; i++) prev += valueOn(h, addDays(t, -i));
  const sum = vals.reduce((a, [, v]) => a + v, 0), max = Math.max(1, ...vals.map(([, v]) => v));
  const zero = vals.filter(([, v]) => !v).length, avg = sum / 30, pavg = prev / 30;
  return `<div class="st-tiles small">
      ${tile('ממוצע ליום', avg.toFixed(1), prev ? `${avg <= pavg ? '↓' : '↑'} ${Math.abs(avg - pavg).toFixed(1)} מהחודש שלפני` : '')}
      ${tile('סה״כ, 30 יום', sum)}${tile('ימים בלי', zero)}
    </div>
    <div class="st-spark">${vals.map(([d, v]) => `<i style="--p:${v / max}" title="${d.getDate()} ב${MONTHS_SHORT[d.getMonth()]}: ${v}"></i>`).join('')}</div>`;
}

export function statsSection() {
  if (!H.list.length) return '';
  const groups = [...new Map(goalHabits().filter(h => h.group).map(h => [h.group, h])).values()];
  const hasData = Object.keys(H.log).length > 0;
  return `
    <section class="sec habit-stats" aria-labelledby="h-hstats">
      <div class="sec-h"><h2 id="h-hstats">סטטיסטיקה</h2></div>
      ${!hasData ? '<p class="st-empty">הסטטיסטיקה תתמלא ככל שתסמן הרגלים.</p>' : ''}
      ${summary()}
      ${card('מפת ימים', heatmap(), 'בלי רצף שנשבר: כל נקודה היא יום, וכמה שהיא כהה יותר עשית בו יותר הרגלים.')}
      ${card('פילוח לפי הרגל', `<div class="st-bars">${byHabit()}</div>`, 'פעמים ב־30 הימים האחרונים · אחוז התקופות שעמדו ביעד.')}
      ${card('פילוח לפי יום בשבוע', byWeekday(), 'באילו ימים ההרגלים קורים בפועל. טוב לדעת כשקובעים מתי להופיע.')}
      ${card('חוזק ההרגל', `<div class="st-bars">${strengths()}</div>`, 'עולה לאט עם כל סימון ויורד לאט כשמפספסים, כך שפספוס אחד לא מוחק התקדמות. במחקר, הרגל נעשה אוטומטי אחרי 66 ימים בממוצע (בין 18 ל־254).')}
      ${card('קצב בפועל מול היעד', rhythm())}
      ${groups.map(g => card(`${esc(g.group)}: חודש אחרי חודש`, groupMonths(g))).join('')}
      ${tallyHabits().map(h => card(`${h.emoji} ${esc(h.name)}: 30 יום`, tally(h))).join('')}
    </section>`;
}
