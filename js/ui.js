// Main screen.
import { icon } from './icons.js';
import {
  state, eventsOn, taskGroups, progress, nextUp, isToday, calById, calColor, setDay, refresh, toggleTask, APP_PALETTE, snoozedUntil,
  reminderOf, setTaskReminder, saveOrder, saveSettings,
} from './data.js';
import { esc, hm, dayName, longDate, shortDate, addDays, ymd, fromYmd, daysBetween, daysLeftLabel, countdown, sameDay, startOfDay, relDayLabel } from './util.js';
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
        <h1 class="day-name">${dayName(d)}</h1>
        <div class="date-text">${longDate(d)}${today ? '' : ` · <span class="rel">${relLabel(d)}</span>`}</div>
        <div class="day-side">${today ? ring(progress()) : `<button class="back-today" data-act="today"><svg viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="40" fill="none" stroke-width="8" stroke-dasharray="10.5 6.255"/></svg><span class="bt-in">${icon(d < new Date() ? 'arrowL' : 'arrowR')}<span>חזרה<br>להיום</span></span></button>`}</div>
      </div>
      ${today ? nextWidget() : ''}
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
    <button class="ev ${past ? 'past' : ''} ${live ? 'live' : ''}" style="--c:${c}" data-act="event" data-id="${ev.id}" data-slot="event" data-start="${ev.start.toISOString()}" data-end="${ev.end.toISOString()}">
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
        <span class="mini-icons">${ev.reminder != null && !past ? icon('bell') : ''}${ev.meet ? icon('video') : ''}${ev.attachments?.length ? icon('paperclip') : ''}${guestCount(ev) ? `<span class="guests">${icon('users')}${guestCount(ev)}</span>` : ''}</span>
      </div>
    </button>`;
}

const guestCount = ev => (ev.guests || []).length > 1 ? ev.guests.length : 0;

const nowLine = now => `<div class="now" role="separator" aria-label="השעה עכשיו ${hm(now)}"><b>${hm(now)}</b><i></i></div>`;

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
        ${viewToggle()}
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
      ${dueNow.length ? '<p class="dnd-tip">גוררים משימה בעזרת ⠿ כדי למקם אותה בין האירועים. המיקום קובע את שעת התזכורת.</p>' : ''}
    </section>`;
}

function comboTaskRow(t, time) {
  const n = t.due ? daysBetween(new Date(), fromYmd(t.due)) : null;
  const subsDone = t.subtasks.filter(x => x.status === 'completed').length;
  const meta = [];
  if (time) meta.push(`<span class="rem">${icon('bell')}${hm(time)}</span>`);
  if (n != null && n < 0) meta.push(`<span class="late">${daysLeftLabel(n)}</span>`);
  if (t.subtasks.length) meta.push(`<span>${icon('list')} ${subsDone}/${t.subtasks.length}</span>`);
  if (t.notes) meta.push(`<span>${icon('pencil')} פרטים</span>`);
  if (state.lists.length > 1) meta.push(`<span>${esc(t.listTitle || '')}</span>`);
  const past = time && time < new Date();
  return `
    <div class="task combo ${past ? 'past' : ''}" data-task="${t.id}" data-slot="task" ${time ? `data-time="${time.toISOString()}"` : ''}>
      <div class="ev-time">${time ? hm(time) : ''}</div>
      <button class="check" data-act="toggle" data-id="${t.id}" aria-label="סימון כבוצע: ${esc(t.title)}"><span>${icon('check')}</span></button>
      <button class="task-main" data-act="task" data-id="${t.id}">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </button>
      <button class="icon-btn grip" data-grip="${t.id}" aria-label="גרירה לשינוי מיקום ושעה">${icon('grip')}</button>
    </div>`;
}

// ---------- drag a task within the combined list → its reminder time follows the spot ----------
function startDrag(e, handle) {
  const row = handle.closest('.task.combo');
  const group = row.closest('.group.combo');
  if (!row || !group) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const id = handle.dataset.grip;
  const y0 = e.clientY, rect = row.getBoundingClientRect();
  group.classList.add('dnd');
  row.classList.add('lifting');
  const ind = document.createElement('div');
  ind.className = 'drop-ind';
  group.append(ind);
  let target = null, raf = 0, lastY = y0;
  const slots = () => [...group.querySelectorAll('[data-slot]')].filter(el => el !== row && !el.classList.contains('hidden-slot'));
  const compute = y => {
    const list = slots();
    let i = list.findIndex(el => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (i < 0) i = list.length;
    if (i === 0 && list[0]?.dataset.slot === 'anyhead') i = 1; // can't drop above the first header
    target = { list, i };
    const gr = group.getBoundingClientRect();
    const ref = list[i] ? list[i].getBoundingClientRect().top : list[i - 1].getBoundingClientRect().bottom;
    ind.style.top = (ref - gr.top - 1) + 'px';
  };
  const scroller = () => {
    if (lastY < 90) scrollBy(0, -10); else if (lastY > innerHeight - 90) scrollBy(0, 10);
    raf = requestAnimationFrame(scroller);
  };
  raf = requestAnimationFrame(scroller);
  const move = ev => {
    lastY = ev.clientY;
    row.style.transform = `translateY(${ev.clientY - y0}px)`;
    compute(ev.clientY);
  };
  const up = () => {
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    group.classList.remove('dnd'); row.classList.remove('lifting'); row.style.transform = ''; ind.remove();
    if (target) placeTask(id, target.list, target.i);
  };
  compute(rect.top + rect.height / 2);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

function placeTask(id, list, i) {
  const before = list.slice(0, i), after = list.slice(i);
  const zone = before.some(el => el.dataset.slot === 'tlhead') ? 'time' : 'any';
  if (zone === 'any') {
    const ids = [...before, { dataset: { slot: 'task', me: 1 } }, ...after]
      .filter(el => el.dataset.slot === 'task' && (el.dataset.me || !el.dataset.time))
      .map(el => el.dataset.me ? id : el.closest('[data-task]').dataset.task);
    state.anyOrder = ids; saveOrder();
    setTaskReminder(id, null);
    render();
    return;
  }
  const timeOf = el => el.dataset.slot === 'event' ? null : el.dataset.time ? new Date(el.dataset.time) : null;
  const prev = [...before].reverse().find(el => el.dataset.slot === 'event' || el.dataset.time);
  const next = after.find(el => el.dataset.slot === 'event' || el.dataset.time);
  let at;
  if (prev) at = prev.dataset.slot === 'event' ? new Date(prev.dataset.end) : timeOf(prev);
  else if (next) at = new Date((next.dataset.slot === 'event' ? new Date(next.dataset.start) : timeOf(next)).getTime() - 15 * 60000);
  else { at = isToday() ? new Date() : new Date(state.day); if (!isToday()) at.setHours(9, 0, 0, 0); else at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0); }
  // keep it on the selected day
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

// "עוד השבוע" (events in the next 7 days) and "עוד החודש" (tasks) — one card, two tabs
function aheadSection(upcoming, noDate) {
  const tab = view.aheadTab || 'week';
  const end = tab === 'week' ? addDays(state.day, 7) : addDays(state.day, 30);
  let body = '';
  if (tab === 'week') {
    for (let k = 1; k <= 7; k++) {
      const d = addDays(state.day, k);
      const evs = eventsOn(d);
      if (!evs.length) continue;
      const n = daysBetween(new Date(), d);
      body += `<div class="day-head"><b>${n === 1 ? 'מחר' : n === 2 ? 'מחרתיים' : `יום ${dayName(d)}`}</b><span>${n <= 2 ? `יום ${dayName(d)}, ` : ''}${longDate(d)}</span></div>`;
      body += evs.map(ev => weekRow(ev, d)).join('');
    }
    body ||= '<div class="empty">אין אירועים בשבוע הקרוב.</div>';
  } else {
    body = upcoming.map(t => taskRow(t, { showDue: true })).join('') || '<div class="empty">אין משימות מתוזמנות לחודש הקרוב.</div>';
    if (noDate.length) body += `<button class="disclosure" data-act="toggle-nodate" aria-expanded="${view.openNoDate}">בלי תאריך (${noDate.length})${icon('chevD')}</button>${view.openNoDate ? noDate.map(t => taskRow(t)).join('') : ''}`;
  }
  return `
    <section class="sec" aria-label="מה בהמשך">
      <div class="sec-h ahead-h">
        <div class="tabs" role="tablist">
          <button role="tab" data-act="ahead" data-id="week" aria-selected="${tab === 'week'}">עוד השבוע</button>
          <button role="tab" data-act="ahead" data-id="month" aria-selected="${tab === 'month'}">עוד החודש</button>
        </div>
        <span class="count">עד ${longDate(end)}</span>
      </div>
      <div class="group mk-${state.settings.marker}">${body}</div>
    </section>`;
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
      <span class="tile-ic digest-logo" aria-hidden="true"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3CC4DC"/><path d="M18 18h14a14 14 0 0 1 0 28H18z" fill="#052A31"/><circle cx="46" cy="18" r="5" fill="#FF5A3C"/></svg></span>
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
      ${state.settings.viewMode === 'split' ? eventsSection() + tasksSection() : daySection() + tasksSection({ withToday: false })}
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
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-grip]');
    if (h && !h.closest('.sheet, .wizard')) startDrag(e, h);
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
      case 'today': view.slide = state.day < new Date() ? 'in-left' : 'in-right'; setDay(new Date()); setTimeout(() => { view.slide = ''; }, 400); break;
      case 'toggle-done': view.openDone = !view.openDone; render(); break;
      case 'ahead': view.aheadTab = id; render(); break;
      case 'view-mode': saveSettings({ viewMode: state.settings.viewMode === 'split' ? 'combined' : 'split' }); break;
      case 'add-menu': openAdd({ kind: 'task' }); break;
      case 'toggle-nodate': view.openNoDate = !view.openNoDate; render(); break;
      case 'login': handlers.login?.(); break;
      case 'wizard': handlers.wizard?.('morning', b); break;
      case 'wizard-evening': handlers.wizard?.('evening', document.querySelector('.fab')); break;
      case 'wizard-mail': handlers.wizard?.('mail', document.querySelector('.fab')); break;
      case 'digest': handlers.digestSeen?.(id); break;
    }
  });
  // swipe anywhere on the main screen to change day (RTL: the future is to the left, so swipe right → next day)
  let x0 = null, y0 = null, t0 = 0, horiz = null;
  const blocked = el => el.closest('.sheet, .wizard, .menu, .scrim, input, textarea, select, .fabs, .tabs, .grip, .dnd');
  const hintEl = document.createElement('div');
  hintEl.className = 'swipe-hint';
  hintEl.setAttribute('aria-hidden', 'true');
  document.body.append(hintEl);
  const TH = 70;
  const hideHint = () => { hintEl.className = 'swipe-hint'; document.querySelectorAll('.body, .day-name, .date-text').forEach(el => el.style.removeProperty('transform')); };
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || blocked(e.target)) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); horiz = null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (x0 == null) return;
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
    document.querySelectorAll('.body, .day-name, .date-text').forEach(el => el.style.setProperty('transform', shift));
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
  setDay(n === 0 ? new Date() : addDays(state.day, n));
  clearTimeout(goDay.t);
  goDay.t = setTimeout(() => { view.slide = ''; }, 400);
}

export { ymd };
