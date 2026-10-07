// Main screen.
import { icon } from './icons.js';
import {
  state, eventsOn, taskGroups, progress, nextUp, isToday, calById, calColor, setDay, refresh, toggleTask, APP_PALETTE, snoozedUntil,
  reminderOf, setTaskReminder, saveOrder, saveSettings,
} from './data.js';
import { reducedMotion, haptic, esc, hm, dayName, longDate, shortDate, addDays, ymd, fromYmd, daysBetween, daysLeftLabel, countdown, sameDay, startOfDay, relDayLabel } from './util.js';
import { openEvent, openTask, openAdd, openSettings, openDeferMenu, eventTimeText } from './sheets.js';
import { wmo, weatherLink, digestIssue } from './extras.js';
import { auth } from './auth.js';
import { openTimePicker } from './timepicker.js';
import { store } from './util.js';

export const view = { weather: null, digest: null, openDone: false, openNoDate: false };
let handlers = {};
export const setHandlers = h => { handlers = h; };

// ---------- header ----------
function ring(p) {
  const C = 2 * Math.PI * 40;
  return `
    <div class="ring" role="img" aria-label="הושלמו ${p.done} מתוך ${p.total} פריטים להיום">
      <svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="val" cx="46" cy="46" r="40" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p.pct)}" ${p.done ? '' : 'opacity="0"'}/></svg>
      <div class="ring-label"><span class="ring-num">${p.done}/${p.total}</span><span class="ring-sub">${p.total && p.done === p.total ? 'הכול בוצע' : 'בוצעו'}</span></div>
    </div>`;
}

function nextWidget() {
  const now = new Date();
  const ev = nextUp();
  if (ev && sameDay(ev.start, now) || ev && ev.start <= now) {
    const cal = calById(ev.calId);
    const live = ev.start <= now;
    const ms = ev.start - now;
    return `
      <button class="next" data-act="event" data-id="${ev.id}">
        <i class="next-mark" style="background:${calColor(cal)}"></i>
        <div class="next-body">
          <div class="next-k">${live ? `<b class="next-when">קורה עכשיו</b> · עד ${hm(ev.end)}` : `הבא בתור · ${hm(ev.start)} · <b class="next-when ${ms < 30 * 60000 ? 'soon' : ''}">${countdown(ms)}</b>`}</div>
          <div class="next-t">${esc(ev.title)}</div>
        </div>
        ${icon('chevL')}
      </button>`;
  }
  const { dueNow } = taskGroups(startOfDay(now));
  if (dueNow.length) {
    const t = dueNow[0];
    return `<button class="next" data-act="task" data-id="${t.id}"><i class="next-mark" style="background:var(--brand)"></i>
      <div class="next-body"><div class="next-k">אין עוד אירועים היום · משימה הבאה</div><div class="next-t">${esc(t.title)}</div></div>${icon('chevL')}</button>`;
  }
  return `<div class="next"><i class="next-mark" style="background:var(--ok)"></i><div class="next-body"><div class="next-k">אין עוד אירועים או משימות להיום</div><div class="next-t">היום שלך פנוי ✨</div></div></div>`;
}

// The digest ("התלקיט") shows up on Sundays that have an issue (today or any Sunday you swipe to)
function digestForDay() {
  if (!state.settings.digestEnabled) return null;
  const d = state.day;
  const id = ymd(d);
  if (d.getDay() !== 0 && !store.get('debugDigest')) return null;
  const want = store.get('debugDigest') && d.getDay() !== 0 ? view.digest?.id : id;
  if (!want) return null;
  const cached = view.issues?.[want];
  if (cached !== undefined) return cached;
  view.issues = view.issues || {};
  view.issues[want] = null;
  digestIssue(want).then(x => { view.issues[want] = x; if (x) render(); });
  return null;
}
function digestCard(dg) {
  return `
    <a class="dg-card ${dg.seen ? 'seen' : ''}" href="${dg.url}" data-act="digest" data-id="${dg.id}">
      ${dg.cover ? `<img class="dg-bg" src="${esc(dg.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="dg-ic" aria-hidden="true">¶</span>
      <div class="next-body">
        <div class="next-t">התלקיט</div>
        <div class="dg-s">${esc(dg.teaser || 'מה קרה השבוע בעיצוב ובאנימציה')}${dg.more ? ` <span class="dg-more">· ועוד ${dg.more}</span>` : ''}</div>
      </div>
      ${icon('chevL')}
    </a>`;
}

// Open the digest inside the app: the card grows into the screen, then the issue fades in.
function openDigest(card) {
  const r = card.getBoundingClientRect();
  const ov = document.createElement('div');
  ov.className = 'dg-view';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'התלקיט');
  const img = card.querySelector('.dg-bg')?.getAttribute('src');
  ov.innerHTML = `
    <div class="dg-hero">${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : ''}<span class="dg-ic">¶</span></div>
    <iframe title="התלקיט" src="${card.getAttribute('href')}"></iframe>
    <button class="dg-close" aria-label="סגירה">${icon('x')}</button>`;
  document.body.append(ov);
  document.documentElement.classList.add('wiz-open');
  const full = { top: 0, left: 0, width: innerWidth, height: innerHeight, radius: 0 };
  const from = { top: r.top, left: r.left, width: r.width, height: r.height, radius: 18 };
  const box = g => ({ top: g.top + 'px', left: g.left + 'px', width: g.width + 'px', height: g.height + 'px', borderRadius: g.radius + 'px' });
  // a rounded rectangle the shape of the card grows to fill the screen (corners straighten only at the very end)
  const frames = (a, b) => [box(a), { ...box({ ...b, radius: Math.max(a.radius, b.radius) * .6 }), offset: .85 }, box(b)];
  const iframe = ov.querySelector('iframe');
  const D = 640, EASE = 'cubic-bezier(.5, 0, .2, 1)';
  // the page cross-fades in while the panel is still growing (not after), so it reads as one move
  let loaded = false, early = false;
  const reveal = () => { if (loaded && early) ov.classList.add('ready'); };
  iframe.addEventListener('load', () => { loaded = true; reveal(); });
  setTimeout(() => { loaded = true; reveal(); }, 2500);
  setTimeout(() => { early = true; reveal(); }, reducedMotion() ? 0 : D * .3);
  Object.assign(ov.style, box(full));
  if (!reducedMotion()) {
    const f = frames(from, full);
    ov.animate(f, { duration: D, easing: EASE });
    // iframes ignore the parent's rounded clip on some phones: round the iframe itself in step
    iframe.animate(f.map(k => ({ borderRadius: k.borderRadius, offset: k.offset })), { duration: D, easing: EASE });
    // the card melts into the panel's background over the first part of the growth
    ov.animate([{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: 1 }], { duration: D, easing: 'ease-out' });
  }
  history.pushState({ digest: true }, '');
  const close = (fromPop = false) => {
    removeEventListener('popstate', onPop);
    if (!fromPop && history.state?.digest) history.back();
    ov.classList.remove('ready');
    ov.classList.add('closing'); // the page fades out while the panel is already shrinking
    const cr = card.isConnected ? card.getBoundingClientRect() : from;
    const rr = { top: cr.top, left: cr.left, width: cr.width, height: cr.height, radius: 18 };
    const done = () => { ov.remove(); document.documentElement.classList.remove('wiz-open'); };
    if (reducedMotion()) return done();
    const C = 640, CE = 'cubic-bezier(.45, 0, .2, 1)';
    const f = [box(full), { ...box({ ...full, radius: 18 }), offset: .15 }, box(rr)];
    iframe.animate(f.map(k => ({ borderRadius: k.borderRadius, offset: k.offset })), { duration: C, easing: CE, fill: 'forwards' });
    // ...and the panel's background melts back into the card at the end
    ov.animate([{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: C, easing: 'ease-in', fill: 'forwards' });
    ov.animate(f, { duration: C, easing: CE, fill: 'forwards' }).finished.then(done, done);
  };
  const onPop = () => close(true);
  addEventListener('popstate', onPop);
  ov.querySelector('.dg-close').addEventListener('click', () => close());
}

function hero() {
  const d = state.day, today = isToday(), w = view.weather;
  const wx = w ? wmo(w.code, w.isDay) : null;
  const dg = digestForDay();
  const widgets = (dg ? digestCard(dg) : '') + (today ? nextWidget() : '');
  return `
    <header class="hero ${widgets ? '' : 'bare'} ${view.slide ? 'sliding' : ''}" id="hero">
      <div class="topbar">
        ${w ? `<a class="chip-btn wx" href="${weatherLink()}" target="_blank" rel="noopener" aria-label="${wx.label}, ${w.now} מעלות${w.city ? ' ב' + esc(w.city) : ''}">
          <span class="wx-emoji">${wx.icon}</span><span>${w.now}°${w.city ? ` <span class="wx-city">${esc(w.city)}</span>` : ''}</span><span class="wx-range ltr">${w.min}°–${w.max}°</span></a>` : '<span class="chip-btn wx" aria-hidden="true" style="opacity:.4">…</span>'}
        <span class="topbar-gap"></span>
        <button class="icon-btn" data-act="refresh" aria-label="רענון">${icon('refresh', state.loading ? 'spin' : '')}</button>
        <button class="icon-btn" data-act="settings" aria-label="הגדרות">${icon('settings')}</button>
      </div>
      <div class="day-row ${view.slide || ''}">
        <h1 class="day-name">${dayName(d)}</h1>
        <div class="date-text">${longDate(d)}${today ? '' : ` · <span class="rel">${relLabel(d)}</span>`}</div>
        <div class="day-side">${today ? ring(progress()) : `<button class="back-today" data-act="today"><svg viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="40" fill="none" stroke-width="8" stroke-dasharray="3 13.755" stroke-linecap="round"/></svg><span class="bt-in">${icon(d < new Date() ? 'arrowL' : 'arrowR')}<span>חזרה<br>להיום</span></span></button>`}</div>
      </div>
      ${widgets}
    </header>`;
}

const relLabelShort = d => { const n = daysBetween(new Date(), d); return n === 1 ? 'מחר' : n === -1 ? 'אתמול' : `יום ${dayName(d)}`; };
const relLabel = d => { const n = daysBetween(new Date(), d); return n > 0 ? (n === 1 ? 'מחר' : `בעוד ${n} ימים`) : (n === -1 ? 'אתמול' : `לפני ${-n} ימים`); };

// ---------- events ----------
function eventRow(ev, now) {
  const cal = calById(ev.calId);
  const c = calColor(cal);
  const past = !ev.allDay && ev.end <= now;
  const live = !ev.allDay && ev.start <= now && ev.end > now;
  const ms = ev.start - now;
  const soon = !ev.allDay && ms > 0 && ms <= 2 * 3600e3;
  const startsToday = sameDay(ev.start, state.day);
  return `
    <button class="ev ${past ? 'past' : ''} ${live ? 'live' : ''}" style="--c:${c}" data-act="event" data-id="${ev.id}" data-fk="e${ev.id}" data-slot="event" data-start="${ev.start.toISOString()}" data-end="${ev.end.toISOString()}">
      <div class="ev-time">${startsToday ? hm(ev.start) : '00:00'}<small>${hm(ev.end)}</small></div>
      <div class="ev-main"><i class="ev-bar" style="background:${c}"></i>
        <div class="ev-text">
          <div class="ev-title">${esc(ev.title)}</div>
          <div class="ev-meta">
            <span>${ev.birthday ? '<span class="cake">🎂</span>' : `<i class="cal-dot" style="background:${c}"></i>`}${esc(cal?.name || '')}</span>
            ${ev.location ? `<span>${icon('pin')}${esc(ev.location.split(',')[0])}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="ev-side">
        ${live ? `<span class="soon-pill now-pill">עכשיו</span>` : soon ? `<span class="soon-pill">${countdown(ms)}</span>` : ''}
        <span class="mini-icons">${ev.reminder != null && !past ? icon('bell') : ''}${ev.meet ? icon('video') : ''}${ev.attachments?.length ? icon('paperclip') : ''}${guestCount(ev) ? `<span class="guests">${icon('users')}${guestCount(ev)}</span>` : ''}</span>
      </div>
    </button>`;
}

const guestCount = ev => (ev.guests || []).length > 1 ? ev.guests.length : 0;

const nowLine = now => `<div class="now" data-slot="now" role="separator" aria-label="השעה עכשיו ${hm(now)}"><b>${hm(now)}</b><i></i></div>`;

function eventsSection() {
  const evs = eventsOn(state.day);
  const allDay = evs.filter(e => e.allDay), timed = evs.filter(e => !e.allDay);
  const now = new Date();
  let rows = '', nowDrawn = !isToday();
  for (const ev of timed) {
    if (!nowDrawn && ev.start > now) { rows += nowLine(now); nowDrawn = true; }
    rows += eventRow(ev, now);
  }
  if (!nowDrawn && timed.length) rows += nowLine(now);
  return `
    <section class="sec" aria-labelledby="h-ev">
      <div class="sec-h"><h2 id="h-ev">ביומן ${isToday() ? 'להיום' : `ליום ${dayName(state.day)}`}</h2>${evs.length ? `<span class="count">${evs.length}</span>` : ''}
        <button class="icon-btn" data-act="add-event" aria-label="אירוע חדש">${icon('plus')}</button></div>
      <div class="group mk-${state.settings.marker}">
        ${allDay.length ? `<div class="allday">${allDay.map(e => `<button class="ad-chip" data-act="event" data-id="${e.id}">${e.birthday ? '<span class="cake">🎂</span>' : `<i style="background:${calColor(calById(e.calId))}"></i>`}${esc(e.title)}</button>`).join('')}</div>` : ''}
        ${rows || (allDay.length ? '' : `<div class="empty"><b>אין אירועים ${isToday() ? 'היום' : 'ביום הזה'}</b>מקום פנוי ביומן.</div>`)}
      </div>
    </section>`;
}

// ---------- combined day list: events fixed by time, tasks placed around them ----------
const viewToggle = () => `<button class="icon-btn view-toggle" data-act="view-mode" aria-label="${state.settings.viewMode === 'split' ? 'רשימה אחת' : 'יומן ומשימות בנפרד'}" title="החלפת תצוגה">${icon(state.settings.viewMode === 'split' ? 'list' : 'calendar')}</button>`;

function daySection() {
  const day = state.day, now = new Date(), today = isToday();
  const evs = eventsOn(day);
  const allDay = evs.filter(e => e.allDay), timedEv = evs.filter(e => !e.allDay);
  const { dueNow, doneToday } = taskGroups(day);
  const timedTasks = [], anyTasks = [];
  for (const t of dueNow) {
    const r = reminderOf(t.id);
    if (r && sameDay(r.time, day)) timedTasks.push({ t, time: r.time }); else anyTasks.push(t);
  }
  const ord = id => { const i = state.anyOrder.indexOf(id); return i < 0 ? 1e6 : i; };
  anyTasks.sort((a, b) => ord(a.id) - ord(b.id));
  const line = [...timedEv.map(e => ({ kind: 'ev', e, at: e.start })), ...timedTasks.map(x => ({ kind: 'task', t: x.t, at: x.time }))]
    .sort((a, b) => (a.at - b.at) || (a.kind === b.kind ? (state.tieOrder[a.t?.id] || 0) - (state.tieOrder[b.t?.id] || 0) : a.kind === 'task' ? -1 : 1));
  let rows = '', nowDrawn = !today;
  for (const it of line) {
    if (!nowDrawn && it.at > now) { rows += nowLine(now); nowDrawn = true; }
    rows += it.kind === 'ev' ? eventRow(it.e, now) : comboTaskRow(it.t, it.at);
  }
  if (!nowDrawn && line.length) rows += nowLine(now);
  const total = evs.length + dueNow.length;
  return `
    <section class="sec" aria-labelledby="h-day">
      <div class="sec-h"><h2 id="h-day">${today ? 'היום שלי' : `יום ${dayName(day)}`}</h2>${total ? `<span class="count">${total}</span>` : ''}
        <button class="icon-btn" data-act="add-menu" aria-label="הוספה">${icon('plus')}</button></div>
      <div class="group combo mk-${state.settings.marker}">
        ${allDay.length ? `<div class="allday">${allDay.map(e => `<button class="ad-chip" data-act="event" data-id="${e.id}">${e.birthday ? '<span class="cake">🎂</span>' : `<i style="background:${calColor(calById(e.calId))}"></i>`}${esc(e.title)}</button>`).join('')}</div>` : ''}
        <div class="zone-h ${anyTasks.length ? '' : 'empty'}" data-slot="anyhead">${icon('check')}משימות בלי שעה</div>
        ${anyTasks.map(t => comboTaskRow(t, null)).join('')}
        <div class="zone-h ${line.length ? '' : 'empty'}" data-slot="tlhead">${icon('calendar')}לפי שעה</div>
        ${rows}
        ${!total ? `<div class="empty"><b>${today ? 'היום פנוי' : 'היום הזה פנוי'}</b>אפשר להוסיף משימה או אירוע עם ה־+.</div>` : ''}
        ${doneToday.length ? `
          <button class="disclosure" data-act="toggle-done" aria-expanded="${view.openDone}">${icon('check')} בוצעו היום (${doneToday.length})${icon('chevD')}</button>
          ${view.openDone ? doneToday.map(t => taskRow(t)).join('') : ''}` : ''}
      </div>
      ${dueNow.length ? '<p class="dnd-tip">לחיצה ארוכה על משימה וגרירה ממקמת אותה בין האירועים, והמיקום קובע את שעת התזכורת. לחיצה על השעה משנה אותה.</p>' : ''}
    </section>`;
}

function comboTaskRow(t, time) {
  const n = t.due ? daysBetween(new Date(), fromYmd(t.due)) : null;
  const subsDone = t.subtasks.filter(x => x.status === 'completed').length;
  const meta = [];
  if (time) meta.push(`<span class="rem">${icon('bell')}תזכורת</span>`);
  if (n != null && n < 0) meta.push(`<span class="late">${daysLeftLabel(n)}</span>`);
  if (t.subtasks.length) meta.push(`<span>${icon('list')} ${subsDone}/${t.subtasks.length}</span>`);
  if (t.notes) meta.push(`<span>${icon('pencil')} פרטים</span>`);
  if (state.lists.length > 1) meta.push(`<span>${esc(t.listTitle || '')}</span>`);
  const past = time && time < new Date();
  return `
    <div class="task combo ${time ? '' : 'untimed'} ${past ? 'past' : ''}" data-task="${t.id}" data-fk="t${t.id}" data-slot="task" ${time ? `data-time="${time.toISOString()}"` : ''}>
      ${time ? `<button class="t-time" data-ttime="${t.id}" aria-label="שעת תזכורת ${hm(time)}, לשינוי">${hm(time)}</button>` : ''}
      <button class="check" data-act="toggle" data-id="${t.id}" aria-label="סימון כבוצע: ${esc(t.title)}"><span>${icon('check')}</span></button>
      <button class="task-main" data-act="task" data-id="${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </button>
    </div>`;
}

// ---------- FLIP: animate rows from where they were to where they land ----------
let flipSnap = null;
export function captureFlip() {
  flipSnap = new Map([...document.querySelectorAll('[data-fk]')].map(el => [el.dataset.fk, el.getBoundingClientRect().top]));
}
function playFlip() {
  if (!flipSnap) return;
  const snap = flipSnap; flipSnap = null;
  document.querySelectorAll('[data-fk]').forEach(el => {
    const was = snap.get(el.dataset.fk); if (was == null) return;
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}

// short tap on a task's time → native time picker; the task then glides to its new place
function pickTime(id, anchor) {
  const r = reminderOf(id);
  const inp = document.createElement('input');
  inp.type = 'time';
  inp.value = r ? hm(r.time) : '';
  inp.className = 'ghost-time';
  const box = anchor.getBoundingClientRect();
  inp.style.top = box.top + 'px'; inp.style.left = box.left + 'px';
  document.body.append(inp);
  const done = () => setTimeout(() => inp.remove(), 300);
  inp.addEventListener('change', () => {
    if (!inp.value) return done();
    const [h, m] = inp.value.split(':').map(Number);
    const d = new Date(state.day); d.setHours(h, m, 0, 0);
    captureFlip();
    state.tieOrder[id] = Date.now(); saveOrder();
    setTaskReminder(id, d, { quiet: false });
    done();
  });
  inp.addEventListener('blur', done);
  try { inp.showPicker(); } catch { inp.focus(); inp.click(); }
}

// ---------- long-press a task, then drag it: the list makes room; the spot sets its reminder ----------
let dragging = null, swallowClick = false;
function armLongPress(e) {
  const row = e.target.closest('.task.combo');
  if (!row || e.target.closest('.check') || e.button > 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let fired = false;
  const cancel = () => { clearTimeout(timer); removeEventListener('pointermove', mv); removeEventListener('pointerup', cancel); removeEventListener('pointercancel', cancel); };
  const mv = ev => { if (!fired && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel(); };
  const timer = setTimeout(() => { fired = true; cancel(); startDrag(row, x0, y0, e.pointerId); }, 380);
  addEventListener('pointermove', mv);
  addEventListener('pointerup', cancel);
  addEventListener('pointercancel', cancel);
}

function startDrag(row, x0, y0, pointerId) {
  const group = row.closest('.group.combo');
  if (!group) return;
  haptic(15);
  swallowClick = true;
  window.getSelection?.().removeAllRanges();
  const id = row.dataset.task;
  const topBefore = row.getBoundingClientRect().top;
  group.classList.add('dnd');
  row.classList.add('lifting');
  const offset = row.getBoundingClientRect().top - topBefore; // layout shift from revealing drop zones
  const all = [...group.querySelectorAll('[data-slot]')];
  const o = all.indexOf(row);
  const others = all.filter(el => el !== row);
  const h = row.offsetHeight;
  const sy0 = scrollY;
  const mids = others.map(el => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2; });
  let i = o, lastY = y0, raf = 0;
  const layout = () => {
    others.forEach((el, k) => {
      const shift = k >= i && k < o ? h : k < i && k >= o ? -h : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const move = ev => {
    if (ev.pointerId !== pointerId && ev.pointerId != null && pointerId != null) return;
    lastY = ev.clientY;
    row.style.transform = `translateY(${ev.clientY - y0 + (scrollY - sy0) - offset}px) scale(1.02)`;
    const docY = ev.clientY + scrollY;
    let k = mids.findIndex(m => docY < m);
    if (k < 0) k = others.length;
    if (k === 0 && others[0]?.dataset.slot === 'anyhead') k = 1;
    if (k !== i) { i = k; layout(); haptic(5); }
  };
  const scroller = () => {
    if (lastY < 100) scrollBy(0, -8); else if (lastY > innerHeight - 110) scrollBy(0, 8);
    raf = requestAnimationFrame(scroller);
  };
  raf = requestAnimationFrame(scroller);
  const blockScroll = ev => ev.preventDefault();
  const up = () => {
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    removeEventListener('touchmove', blockScroll);
    captureFlip(); // positions as they look right now, mid-drag
    group.classList.remove('dnd'); row.classList.remove('lifting');
    [row, ...others].forEach(el => { el.style.transform = ''; });
    dragging = null;
    setTimeout(() => { swallowClick = false; }, 50);
    placeTask(id, others, i);
  };
  dragging = { id };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  addEventListener('touchmove', blockScroll, { passive: false });
  layout();
  move({ clientY: y0, pointerId });
}

function placeTask(id, list, i) {
  const before = list.slice(0, i), after = list.slice(i);
  const zone = before.some(el => el.dataset.slot === 'tlhead') ? 'time' : 'any';
  if (zone === 'any') {
    const ids = [...before, { dataset: { slot: 'task', me: 1 } }, ...after]
      .filter(el => el.dataset.slot === 'task' && (el.dataset.me || !el.dataset.time))
      .map(el => el.dataset.me ? id : el.closest('[data-task]').dataset.task);
    state.anyOrder = ids; saveOrder();
    if (reminderOf(id)) setTaskReminder(id, null); else render();
    return;
  }
  const timeOf = el => el.dataset.time ? new Date(el.dataset.time) : null;
  const prev = [...before].reverse().find(el => el.dataset.slot === 'event' || el.dataset.time);
  const next = after.find(el => el.dataset.slot === 'event' || el.dataset.time);
  let at;
  if (prev) at = prev.dataset.slot === 'event' ? new Date(prev.dataset.end) : timeOf(prev);
  else if (next) at = new Date((next.dataset.slot === 'event' ? new Date(next.dataset.start) : timeOf(next)).getTime() - 15 * 60000);
  else { at = isToday() ? new Date() : new Date(state.day); if (!isToday()) at.setHours(9, 0, 0, 0); else at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0); }
  if (!sameDay(at, state.day)) { at = new Date(state.day); at.setHours(prev ? 23 : 0, prev ? 45 : 0, 0, 0); }
  state.tieOrder[id] = Date.now(); state.anyOrder = state.anyOrder.filter(x => x !== id); saveOrder();
  setTaskReminder(id, at, { quiet: false });
}

// ---------- tasks ----------
function taskRow(t, { showDue = false } = {}) {
  const done = t.status === 'completed';
  const n = t.due ? daysBetween(new Date(), fromYmd(t.due)) : null;
  const subsDone = t.subtasks.filter(s => s.status === 'completed').length;
  const meta = [];
  const sz = !done && snoozedUntil(t.id);
  if (sz) meta.push(`<span class="snz">⏰ חוזרת ב־${hm(sz)}</span>`);
  if (!done && n != null && n < 0) meta.push(`<span class="late">${daysLeftLabel(n)}</span>`);
  if (t.subtasks.length) meta.push(`<span>${icon('list')} ${subsDone}/${t.subtasks.length}</span>`);
  if (t.notes) meta.push(`<span>${icon('pencil')} הערות</span>`);
  if (state.lists.length > 1) meta.push(`<span>${esc(t.listTitle || '')}</span>`);
  const pill = showDue && n != null ? `<span class="due-pill ${n <= 2 ? 'hot' : n <= 5 ? 'warm' : ''}" title="${shortDate(fromYmd(t.due))}">${daysLeftLabel(n)}</span>` : '';
  return `
    <div class="task ${done ? 'done' : ''} ${sz ? 'snoozed' : ''}" data-task="${t.id}">
      <button class="check ${done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="${done ? 'החזרה לפתוחה' : 'סימון כבוצע'}: ${esc(t.title)}"><span>${icon('check')}</span></button>
      <button class="task-main" data-act="task" data-id="${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length || pill ? `<div class="task-meta">${pill}${meta.join('')}</div>` : ''}
      </button>
      ${done ? '' : `<button class="icon-btn" data-act="defer" data-id="${t.id}" aria-label="לדחות">${icon('snooze')}</button>`}
    </div>`;
}

function tasksSection({ withToday = true } = {}) {
  const g = taskGroups();
  const { doneToday, upcoming, noDate } = g;
  const dueNow = [...g.dueNow].sort((a, b) => !!snoozedUntil(a.id) - !!snoozedUntil(b.id)); // snoozed ones sink to the bottom
  const today = isToday();
  return `
    ${withToday ? `<section class="sec" aria-labelledby="h-t">
      <div class="sec-h"><h2 id="h-t">משימות ${today ? 'להיום' : `ליום ${dayName(state.day)}`}</h2>${dueNow.length ? `<span class="count">${dueNow.length}</span>` : ''}
        <button class="icon-btn" data-act="add-task" aria-label="משימה חדשה">${icon('plus')}</button></div>
      <div class="group">
        ${dueNow.map(t => taskRow(t)).join('') || (doneToday.length ? '' : `<div class="empty"><b>אין משימות ${today ? 'להיום' : 'ליום הזה'}</b>אפשר להוסיף עם ה־+ או בהכתבה.</div>`)}
        ${doneToday.length ? `
          <button class="disclosure" data-act="toggle-done" aria-expanded="${view.openDone}">${icon('check')} בוצעו היום (${doneToday.length})${icon('chevD')}</button>
          ${view.openDone ? doneToday.map(t => taskRow(t)).join('') : ''}` : ''}
      </div>
    </section>` : ''}
    ${aheadSection(upcoming, noDate)}`;
}

// "עוד השבוע": the next 7 days, events and tasks together, grouped by day
function aheadSection() {
  const open = state.tasks.filter(t => !t.parent && t.status !== 'completed' && t.due);
  let body = '';
  for (let k = 1; k <= 7; k++) {
    const d = addDays(state.day, k);
    const evs = eventsOn(d);
    const tasks = open.filter(t => t.due === ymd(d));
    if (!evs.length && !tasks.length) continue;
    const n = daysBetween(new Date(), d);
    body += `<div class="day-head"><b>${n === 1 ? 'מחר' : n === 2 ? 'מחרתיים' : `יום ${dayName(d)}`}</b><span>${n <= 2 ? `יום ${dayName(d)}, ` : ''}${longDate(d)}</span></div>`;
    body += evs.map(ev => weekRow(ev, d)).join('');
    body += tasks.map(t => weekTaskRow(t, d)).join('');
  }
  body ||= '<div class="empty">שבוע פנוי: אין אירועים או משימות בשבעת הימים הקרובים.</div>';
  return `
    <section class="sec" aria-labelledby="h-week">
      <div class="sec-h"><h2 id="h-week">עוד השבוע</h2><span class="count">עד ${longDate(addDays(state.day, 7))}</span></div>
      <div class="group mk-${state.settings.marker}">${body}</div>
    </section>`;
}

function weekTaskRow(t, d) {
  const r = reminderOf(t.id);
  return `
    <div class="task combo wk ${r && sameDay(r.time, d) ? '' : 'untimed'}">
      ${r && sameDay(r.time, d) ? `<span class="t-time static">${hm(r.time)}</span>` : ''}
      <button class="check" data-act="toggle" data-id="${t.id}" aria-label="סימון כבוצע: ${esc(t.title)}"><span>${icon('check')}</span></button>
      <button class="task-main" data-act="task" data-id="${t.id}"><div class="task-title">${esc(t.title)}</div>
        <div class="task-meta"><span>משימה${state.lists.length > 1 ? ` · ${esc(t.listTitle || '')}` : ''}</span></div></button>
    </div>`;
}

function weekRow(ev, d) {
  const cal = calById(ev.calId), c = calColor(cal);
  return `
    <button class="ev wk" style="--c:${c}" data-act="event" data-id="${ev.id}">
      <div class="ev-time">${ev.allDay ? '<small>כל היום</small>' : `${sameDay(ev.start, d) ? hm(ev.start) : '00:00'}<small>${hm(ev.end)}</small>`}</div>
      <div class="ev-main"><i class="ev-bar" style="background:${c}"></i>
        <div class="ev-text"><div class="ev-title">${esc(ev.title)}</div>
          <div class="ev-meta"><span>${ev.birthday ? '<span class="cake">🎂</span>' : `<i class="cal-dot" style="background:${c}"></i>`}${esc(cal?.name || '')}</span>${ev.location ? `<span>${icon('pin')}${esc(ev.location.split(',')[0])}</span>` : ''}</div>
        </div></div><div></div>
    </button>`;
}

// ---------- tiles ----------
const avatarColor = s => APP_PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % APP_PALETTE.length];

function tiles() {
  const out = [];
  const now = new Date();
  if (isToday() && now.getHours() >= 18) {
    const { dueNow } = taskGroups();
    const tmr = eventsOn(addDays(now, 1)).filter(e => !e.allDay).length;
    out.push(`<button class="tile evening" data-act="wizard-evening">
      <span class="tile-ic">${icon('moon')}</span>
      <span class="tile-body"><span class="tile-t">סיכום ערב</span><span class="tile-s" style="display:block">${dueNow.length ? `${dueNow.length} משימות פתוחות` : 'כל המשימות סגורות'} · ${tmr ? `${tmr} אירועים מחר` : 'מחר פנוי'}</span></span>
      <span class="go">${icon('chevL')}</span></button>`);
  }
  if (state.settings.gmailEnabled && state.emails.length) {
    const senders = [...new Set(state.emails.map(e => e.from))].slice(0, 5);
    out.push(`<button class="tile mail" data-act="wizard-mail">
      <span class="tile-ic">${icon('mail')}</span>
      <span class="tile-body"><span class="tile-t">${state.emails.length} מיילים לטיפול</span>
        <span class="tile-s" style="display:block">ארכוב או הפיכה למשימה, בהחלקה</span>
        <span class="avatars">${senders.map(s => `<i style="background:${avatarColor(s)}" title="${esc(s)}">${esc(s.trim()[0] || '?')}</i>`).join('')}</span></span>
      <span class="go">${icon('chevL')}</span></button>`);
  }
  return out.length ? `<div class="tiles">${out.join('')}</div>` : '';
}

function banners() {
  if (state.mode === 'demo') {
    return `<div class="banner">${icon('google')}<div><b>מצב הדגמה</b>${auth.configured ? 'הנתונים כאן לדוגמה. התחבר כדי לראות את היומן והמשימות שלך.' : 'חסר Client ID.'}</div>
      ${auth.configured ? `<button class="btn sm primary" data-act="login">התחברות</button>` : ''}</div>`;
  }
  if (state.error) return `<div class="banner err"><div><b>לא הצלחתי לטעון מגוגל</b>${esc(state.error)}</div><button class="btn sm" data-act="refresh">נסה שוב</button></div>`;
  return '';
}

// ---------- render ----------
export function render() {
  const app = document.getElementById('app');
  const y = scrollY;
  app.innerHTML = `
    ${hero()}
    <main class="body ${view.slide || ''}">
      ${banners()}
      ${daySection()}
      ${aheadSection()}
      ${tiles()}
    </main>
    <div class="minibar ${minibarShown ? 'show' : ''}" aria-hidden="true">
      <b>${dayName(state.day)}</b><span>${longDate(state.day)}</span>
      ${isToday() ? (p => `<span class="mini-progress">${p.done}/${p.total}</span>`)(progress()) : ''}
    </div>`;
  scrollTo(0, y);
  glideSheet();
  observeHero();
  playFlip();
}

let minibarShown = false, io = null;
function observeHero() {
  io?.disconnect();
  io = new IntersectionObserver(([e]) => {
    minibarShown = !e.isIntersecting;
    document.querySelector('.minibar')?.classList.toggle('show', minibarShown);
    document.querySelector('.fab')?.classList.toggle('small', minibarShown);
  }, { rootMargin: '-120px 0px 0px 0px' });
  const h = document.querySelector('.day-row');
  if (h) io.observe(h);
}

export function mountFabs() {
  const f = document.createElement('div');
  f.className = 'fabs';
  f.innerHTML = `
    <button class="fab" data-act="wizard" aria-label="אשף: לסדר את היום">${icon('sparkles')}<span class="fab-label">לסדר את היום</span></button>`;
  document.body.append(f);
}

export function bindMain() {
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.sheet, .wizard')) armLongPress(e); });
  document.addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', e => { if (e.target.closest('.task.combo')) e.preventDefault(); });
  // the time on a task is a real (invisible) time input over the label: a tap opens the phone's picker
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ttime]');
    if (!t || t.closest('.sheet')) return;
    e.stopPropagation();
    const id = t.dataset.ttime;
    const r = reminderOf(id);
    openTimePicker({
      value: r ? hm(r.time) : '',
      onSave: v => {
        const [h, m] = v.split(':').map(Number);
        const d = new Date(state.day); d.setHours(h, m, 0, 0);
        captureFlip();
        state.tieOrder[id] = Date.now(); saveOrder();
        setTaskReminder(id, d, { quiet: false });
      },
      onClear: () => { captureFlip(); setTaskReminder(id, null); },
    });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.closest('.sheet, .wizard, .menu')) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'event': openEvent(id); break;
      case 'task': openTask(id); break;
      case 'toggle': {
        const row = b.closest('.task');
        row?.classList.add('just-done');
        b.classList.toggle('on');
        setTimeout(() => toggleTask(id), 380);
        break;
      }
      case 'defer': openDeferMenu(b, id); break;
      case 'add-task': openAdd({ kind: 'task' }); break;
      case 'add-event': openAdd({ kind: 'event' }); break;
      case 'settings': openSettings({ onLogin: handlers.login }); break;
      case 'refresh': refresh(); handlers.weather?.(true); break;
      case 'today': view.slide = state.day < new Date() ? 'in-left' : 'in-right'; markSheet(); setDay(new Date()); setTimeout(() => { view.slide = ''; }, 400); break;
      case 'toggle-done': view.openDone = !view.openDone; render(); break;
      case 'ahead': view.aheadTab = id; render(); break;
      case 'add-menu': openAdd({ kind: 'task' }); break;
      case 'toggle-nodate': view.openNoDate = !view.openNoDate; render(); break;
      case 'login': handlers.login?.(); break;
      case 'wizard': handlers.wizard?.('morning', b); break;
      case 'wizard-evening': handlers.wizard?.('evening', document.querySelector('.fab')); break;
      case 'wizard-mail': handlers.wizard?.('mail', document.querySelector('.fab')); break;
      case 'digest': e.preventDefault(); handlers.digestSeen?.(id); openDigest(b); break;
    }
  });
  // swipe anywhere on the main screen to change day (RTL: the future is to the left, so swipe right → next day)
  let x0 = null, y0 = null, t0 = 0, horiz = null;
  const blocked = el => el.closest('.sheet, .wizard, .menu, .scrim, input, textarea, select, .fabs, .dnd');
  const hintEl = document.createElement('div');
  hintEl.className = 'swipe-hint';
  hintEl.setAttribute('aria-hidden', 'true');
  document.body.append(hintEl);
  const TH = 70;
  const hideHint = () => { hintEl.className = 'swipe-hint'; document.querySelectorAll('.body > *, .day-name, .date-text').forEach(el => el.style.removeProperty('transform')); };
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || blocked(e.target)) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); horiz = null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (x0 == null) return;
    if (dragging) { x0 = null; hideHint(); return; }
    const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (horiz == null && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) horiz = Math.abs(dx) > Math.abs(dy) * 1.4;
    if (!horiz) return;
    const next = dx > 0; // RTL: dragging right brings tomorrow in
    const d = addDays(state.day, next ? 1 : -1);
    const p = Math.min(1, Math.abs(dx) / TH);
    hintEl.className = `swipe-hint show ${next ? 'from-left' : 'from-right'} ${p >= 1 ? 'ready' : ''}`;
    hintEl.style.setProperty('--p', p);
    hintEl.innerHTML = `${icon(next ? 'arrowL' : 'arrowR')}<span>${sameDay(d, new Date()) ? 'היום' : relLabelShort(d)}</span>`;
    const shift = `translateX(${Math.sign(dx) * Math.min(40, Math.abs(dx) * .35)}px)`;
    document.querySelectorAll('.body > *, .day-name, .date-text').forEach(el => el.style.setProperty('transform', shift));
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null; hideHint();
    if (horiz && Math.abs(dx) >= TH && Math.abs(dx) > Math.abs(dy) * 1.4) goDay(dx > 0 ? 1 : -1);
  });
  document.addEventListener('touchcancel', () => { x0 = null; hideHint(); });
  document.addEventListener('keydown', e => {
    if (document.querySelector('.sheet, .wizard, .menu') || e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') goDay(1);
    if (e.key === 'ArrowRight') goDay(-1);
  });
}

export function goDay(n) {
  view.slide = n > 0 ? 'in-left' : 'in-right';
  markSheet();
  setDay(n === 0 ? new Date() : addDays(state.day, n));
  clearTimeout(goDay.t);
  goDay.t = setTimeout(() => { view.slide = ''; }, 400);
}

// the sheet stays put while the day changes; if the new day has a widget (or loses one) it glides to its new height
function markSheet() {
  const b = document.querySelector('.body');
  if (b) view.sheetTop = b.getBoundingClientRect().top + scrollY;
}
function glideSheet() {
  if (view.sheetTop == null) return;
  const b = document.querySelector('.body');
  const from = view.sheetTop; view.sheetTop = null;
  if (!b || reducedMotion()) return;
  const dy = from - (b.getBoundingClientRect().top + scrollY);
  if (Math.abs(dy) < 1) return;
  b.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3, 0, .1, 1)' });
}

export { ymd };
