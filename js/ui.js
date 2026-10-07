// Main screen.
import { icon } from './icons.js';
import {
  state, eventsOn, taskGroups, progress, nextUp, isToday, calById, calColor, setDay, refresh, toggleTask, APP_PALETTE,
} from './data.js';
import { esc, hm, dayName, longDate, shortDate, addDays, ymd, fromYmd, daysBetween, daysLeftLabel, countdown, sameDay, startOfDay } from './util.js';
import { openEvent, openTask, openAdd, openSettings, openDeferMenu, eventTimeText } from './sheets.js';
import { wmo, weatherLink } from './extras.js';
import { auth } from './auth.js';

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

function hero() {
  const d = state.day, today = isToday(), w = view.weather;
  const wx = w ? wmo(w.code, w.isDay) : null;
  return `
    <header class="hero" id="hero">
      <div class="topbar">
        ${w ? `<a class="chip-btn wx" href="${weatherLink()}" target="_blank" rel="noopener" aria-label="${wx.label}, ${w.now} מעלות${w.city ? ' ב' + esc(w.city) : ''}">
          <span class="wx-emoji">${wx.icon}</span><span>${w.now}°${w.city ? ` <span class="wx-city">${esc(w.city)}</span>` : ''}</span><span class="wx-range ltr">${w.min}°–${w.max}°</span></a>` : '<span class="chip-btn wx" aria-hidden="true" style="opacity:.4">…</span>'}
        <span class="topbar-gap"></span>
        <button class="icon-btn" data-act="refresh" aria-label="רענון">${icon('refresh', state.loading ? 'spin' : '')}</button>
        <button class="icon-btn" data-act="settings" aria-label="הגדרות">${icon('settings')}</button>
      </div>
      <div class="day-row ${view.slide || ''}">
        <span class="app-name">מה איתי היום?</span>
        <h1 class="day-name">${dayName(d)}</h1>
        <div class="date-text">${longDate(d)}${today ? '' : ` · <span class="rel">${relLabel(d)}</span>`}</div>
        <div class="day-side">${today ? ring(progress()) : `<button class="back-today" data-act="today">${icon(d < new Date() ? 'arrowL' : 'arrowR')}<span>חזרה<br>להיום</span></button>`}</div>
      </div>
      ${today ? nextWidget() : ''}
    </header>`;
}

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
    <button class="ev ${past ? 'past' : ''} ${live ? 'live' : ''}" style="--c:${c}" data-act="event" data-id="${ev.id}">
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
        ${live ? `<span class="soon-pill later">עכשיו</span>` : soon ? `<span class="soon-pill">${countdown(ms)}</span>` : ''}
        <span class="mini-icons">${ev.reminder != null && !past ? icon('bell') : ''}${ev.meet ? icon('video') : ''}</span>
      </div>
    </button>`;
}

const nowLine = now => `<div class="now" role="separator" aria-label="השעה עכשיו ${hm(now)}"><b>עכשיו ${hm(now)}</b><i></i></div>`;

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
      <div class="sec-h"><h2 id="h-ev">ביומן</h2>${evs.length ? `<span class="count">${evs.length}</span>` : ''}
        <button class="icon-btn" data-act="add-event" aria-label="אירוע חדש">${icon('plus')}</button></div>
      <div class="group mk-${state.settings.marker}">
        ${allDay.length ? `<div class="allday">${allDay.map(e => `<button class="ad-chip" data-act="event" data-id="${e.id}">${e.birthday ? '<span class="cake">🎂</span>' : `<i style="background:${calColor(calById(e.calId))}"></i>`}${esc(e.title)}</button>`).join('')}</div>` : ''}
        ${rows || (allDay.length ? '' : `<div class="empty"><b>אין אירועים ${isToday() ? 'היום' : 'ביום הזה'}</b>מקום פנוי ביומן.</div>`)}
      </div>
    </section>`;
}

// ---------- tasks ----------
function taskRow(t, { showDue = false } = {}) {
  const done = t.status === 'completed';
  const n = t.due ? daysBetween(new Date(), fromYmd(t.due)) : null;
  const subsDone = t.subtasks.filter(s => s.status === 'completed').length;
  const meta = [];
  if (!done && n != null && n < 0) meta.push(`<span class="late">${daysLeftLabel(n)}</span>`);
  if (t.subtasks.length) meta.push(`<span>${icon('list')} ${subsDone}/${t.subtasks.length}</span>`);
  if (t.notes) meta.push(`<span>${icon('pencil')} הערות</span>`);
  if (state.lists.length > 1) meta.push(`<span>${esc(t.listTitle || '')}</span>`);
  const pill = showDue && n != null ? `<span class="due-pill ${n <= 2 ? 'hot' : n <= 5 ? 'warm' : ''}" title="${shortDate(fromYmd(t.due))}">${daysLeftLabel(n)}</span>` : '';
  return `
    <div class="task ${done ? 'done' : ''}" data-task="${t.id}">
      <button class="check ${done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-label="${done ? 'החזרה לפתוחה' : 'סימון כבוצע'}: ${esc(t.title)}"><span>${icon('check')}</span></button>
      <button class="task-main" data-act="task" data-id="${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length || pill ? `<div class="task-meta">${pill}${meta.join('')}</div>` : ''}
      </button>
      ${done ? '' : `<button class="icon-btn" data-act="defer" data-id="${t.id}" aria-label="לדחות">${icon('snooze')}</button>`}
    </div>`;
}

function tasksSection() {
  const { dueNow, doneToday, upcoming, noDate } = taskGroups();
  const today = isToday();
  return `
    <section class="sec" aria-labelledby="h-t">
      <div class="sec-h"><h2 id="h-t">משימות ${today ? 'להיום' : `ליום ${dayName(state.day)}`}</h2>${dueNow.length ? `<span class="count">${dueNow.length}</span>` : ''}
        <button class="icon-btn" data-act="add-task" aria-label="משימה חדשה">${icon('plus')}</button></div>
      <div class="group">
        ${dueNow.map(t => taskRow(t)).join('') || (doneToday.length ? '' : `<div class="empty"><b>אין משימות ${today ? 'להיום' : 'ליום הזה'}</b>אפשר להוסיף עם ה־+ או בהכתבה.</div>`)}
        ${doneToday.length ? `
          <button class="disclosure" data-act="toggle-done" aria-expanded="${view.openDone}">${icon('check')} בוצעו היום (${doneToday.length})${icon('chevD')}</button>
          ${view.openDone ? doneToday.map(t => taskRow(t)).join('') : ''}` : ''}
      </div>
    </section>
    ${upcoming.length || noDate.length ? `
    <section class="sec" aria-labelledby="h-up">
      <div class="sec-h"><h2 id="h-up">עוד החודש</h2><span class="count">עד ${longDate(addDays(state.day, 30))}</span></div>
      <div class="group">
        ${upcoming.map(t => taskRow(t, { showDue: true })).join('') || '<div class="empty">אין משימות מתוזמנות לחודש הקרוב.</div>'}
        ${noDate.length ? `
          <button class="disclosure" data-act="toggle-nodate" aria-expanded="${view.openNoDate}">בלי תאריך (${noDate.length})${icon('chevD')}</button>
          ${view.openNoDate ? noDate.map(t => taskRow(t)).join('') : ''}` : ''}
      </div>
    </section>` : ''}`;
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
      <span class="tile-ic">🌙</span>
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
  const dg = view.digest;
  if (state.settings.digestEnabled && dg) {
    out.push(`<a class="tile digest" href="${dg.url}" data-act="digest" data-id="${dg.id}">
      ${dg.seen ? '' : '<i class="new-dot" aria-label="חדש"></i>'}
      <span class="tile-ic">${icon('newspaper')}</span>
      <span class="tile-body"><span class="tile-t">${dg.seen ? 'דיג׳סט העיצוב' : 'גיליון חדש בדיג׳סט'}</span>
        <span class="tile-s" style="display:block">${esc(dg.label)} · ${dg.stats?.kept || ''} פריטים</span></span>
      <span class="digest-thumbs">${dg.top.slice(0, 2).map(t => t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '').join('')}</span>
    </a>`);
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
      ${eventsSection()}
      ${tasksSection()}
      ${tiles()}
    </main>
    <div class="minibar ${minibarShown ? 'show' : ''}" aria-hidden="true">
      <b>${dayName(state.day)}</b><span>${longDate(state.day)}</span>
      ${isToday() ? (p => `<span class="mini-progress">${p.done}/${p.total}</span>`)(progress()) : ''}
    </div>`;
  scrollTo(0, y);
  observeHero();
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
      case 'today': view.slide = state.day < new Date() ? 'in-left' : 'in-right'; setDay(new Date()); setTimeout(() => { view.slide = ''; }, 400); break;
      case 'toggle-done': view.openDone = !view.openDone; render(); break;
      case 'toggle-nodate': view.openNoDate = !view.openNoDate; render(); break;
      case 'login': handlers.login?.(); break;
      case 'wizard': handlers.wizard?.('morning', b); break;
      case 'wizard-evening': handlers.wizard?.('evening', document.querySelector('.fab')); break;
      case 'wizard-mail': handlers.wizard?.('mail', document.querySelector('.fab')); break;
      case 'digest': handlers.digestSeen?.(id); break;
    }
  });
  // swipe anywhere on the main screen to change day (RTL: the future is to the left, so swipe right → next day)
  let x0 = null, y0 = null, t0 = 0;
  const blocked = el => el.closest('.sheet, .wizard, .menu, .scrim, input, textarea, select, .fabs');
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || blocked(e.target)) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Date.now() - t0 < 700 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) goDay(dx > 0 ? 1 : -1);
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('.sheet, .wizard, .menu') || e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') goDay(1);
    if (e.key === 'ArrowRight') goDay(-1);
  });
}

export function goDay(n) {
  view.slide = n > 0 ? 'in-left' : 'in-right';
  setDay(n === 0 ? new Date() : addDays(state.day, n));
  clearTimeout(goDay.t);
  goDay.t = setTimeout(() => { view.slide = ''; }, 400);
}

export { ymd };
