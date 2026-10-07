// Detail / edit / add / settings sheets.
import { icon } from './icons.js';
import { openSheet, paintSheet, closeSheet, openMenu } from './overlay.js';
import {
  state, calById, calColor, deleteEvent, toggleTask, updateTask, deferTask, deleteTask, addTask, addEvent,
  saveSettings, refresh, APP_PALETTE, allTaskRoots, emit, api, reminderOf, setTaskReminder, moveTaskToList,
} from './data.js';
import { esc, hm, longDate, dayName, ymd, fromYmd, addDays, addMonths, startOfDay, countdown, relDayLabel, daysBetween, daysLeftLabel } from './util.js';
import { voiceSupported, listen, parseHebrew } from './voice.js';
import { auth } from './auth.js';
import { pushPanel, loadPushInfo } from './push.js';

// ---------- shared bits ----------
export function linkify(raw = '') {
  const text = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$1').replace(/<[^>]+>/g, '');
  const tmp = document.createElement('textarea'); tmp.innerHTML = text;
  return esc(tmp.value.trim()).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

export const navLinks = loc => {
  const q = encodeURIComponent(loc);
  return {
    walk: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`,
    transit: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=transit`,
    car: `https://waze.com/ul?q=${q}&navigate=yes`,
  };
};

export function eventTimeText(ev) {
  if (ev.allDay) return 'כל היום';
  return `${hm(ev.start)}–${hm(ev.end)}`;
}

// Reminders, written out as text (editing happens in Google Calendar)
export const remShort = m => m == null ? 'ללא' : m === 0 ? 'בזמן האירוע' : m < 60 ? `${m} דק׳` : m === 60 ? 'שעה' : m === 120 ? 'שעתיים' : m < 1440 ? `${m / 60} שעות` : m === 1440 ? 'יום' : m === 2880 ? 'יומיים' : m === 10080 ? 'שבוע' : `${Math.round(m / 1440)} ימים`;
export const reminderLabel = m => m == null ? 'ללא תזכורת' : m === 0 ? 'בזמן האירוע' : `${remShort(m)} לפני`;
export function reminderText(ev) {
  const list = [...(ev.reminders || [])].sort((a, b) => b - a);
  if (!list.length) return ev.reminderIsDefault ? 'ברירת המחדל של היומן (ללא תזכורות)' : 'ללא תזכורות';
  return list.map(reminderLabel).join(' · ') + (ev.reminderIsDefault ? ' (ברירת המחדל של היומן)' : '');
}
export const guestsText = ev => {
  const g = ev.guests || [];
  if (g.length < 2) return '';
  const others = g.filter(x => !x.self).map(x => x.name.split(/[ @]/)[0]);
  return `${g.length} משתתפים${others.length ? ` · ${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}` : ''}`;
};

// ---------- event sheet ----------
export function openEvent(id) {
  openSheet(() => {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return '<p class="empty">האירוע לא נמצא.</p>';
    const cal = calById(ev.calId);
    const now = new Date();
    const status = ev.allDay ? '' : ev.end <= now ? 'הסתיים' : ev.start <= now ? `עכשיו · עד ${hm(ev.end)}` : countdown(ev.start - now);
    const nav = ev.location ? navLinks(ev.location) : null;
    const gt = guestsText(ev);
    return `
      <div class="sub"><span>${ev.birthday ? '🎂 ' : `<i class="cal-dot" style="background:${calColor(cal)}"></i>`}${esc(cal?.name || '')}</span><span>${relDayLabel(ev.start)} · ${eventTimeText(ev)}</span></div>
      <h3>${esc(ev.title)}</h3>
      ${status ? `<div class="sub"><b style="color:var(--brand-deep)">${esc(status)}</b></div>` : ''}
      ${ev.meet ? `<div class="actions" style="margin-top:14px"><a class="btn primary grow" href="${esc(ev.meet)}" target="_blank" rel="noopener">${icon('video')}הצטרפות לשיחת וידאו</a></div>` : ''}
      ${nav ? `
        <div class="field-label">${icon('pin')}${esc(ev.location)}</div>
        <div class="nav-grid">
          <a href="${nav.walk}" target="_blank" rel="noopener">${icon('walk', 'rtl-flip')}ברגל</a>
          <a href="${nav.transit}" target="_blank" rel="noopener">${icon('bus', 'rtl-flip')}תחבורה ציבורית</a>
          <a href="${nav.car}" target="_blank" rel="noopener">${icon('car', 'rtl-flip')}Waze</a>
        </div>` : ''}
      ${gt ? `<a class="info-row" href="${esc(ev.htmlLink)}" target="_blank" rel="noopener">${icon('users')}<span>${esc(gt)}</span>${icon('chevL')}</a>` : ''}
      ${ev.attachments?.length ? `<div class="field-label">${icon('paperclip')}קבצים מצורפים</div>
        ${ev.attachments.map(a => `<a class="info-row" href="${esc(a.url)}" target="_blank" rel="noopener">${a.icon ? `<img src="${esc(a.icon)}" alt="" width="18" height="18">` : icon('file')}<span>${esc(a.title)}</span>${icon('external')}</a>`).join('')}` : ''}
      ${ev.description ? `<div class="field-label">תיאור</div><div class="desc">${linkify(ev.description)}</div>` : ''}
      ${!ev.allDay ? `<div class="field-label">${icon('bell')}תזכורות</div><p class="rem-text">${esc(reminderText(ev))}</p>` : ''}
      <div class="actions">
        <a class="btn grow" href="${esc(ev.htmlLink)}" target="_blank" rel="noopener">${icon('pencil')}עריכה ביומן גוגל</a>
        ${ev.canEdit ? `<button class="btn danger" data-del aria-label="מחיקת האירוע">${icon('trash')}</button>` : ''}
      </div>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('click', e => {
    if (e.target.closest('[data-del]')) { closeSheet(); deleteEvent(id); }
  });
}

// ---------- defer ----------
// Defer choices: tomorrow · day after · next week (Sunday) · another date
export function deferOptions() {
  const t = startOfDay(new Date());
  const sunday = addDays(t, 7 - t.getDay());
  const dm = d => `${d.getDate()}/${d.getMonth() + 1}`;
  return [
    { key: 'tomorrow', icon: 'calendar', label: 'מחר', hint: `יום ${dayName(addDays(t, 1))}`, date: ymd(addDays(t, 1)) },
    { key: 'after', icon: 'calendar', label: 'מחרתיים', hint: `יום ${dayName(addDays(t, 2))}`, date: ymd(addDays(t, 2)) },
    { key: 'week', icon: 'calendar', label: 'שבוע הבא', hint: `א׳ ${dm(sunday)}`, date: ymd(sunday) },
    { key: 'other', icon: 'pencil', label: 'תאריך אחר…' },
  ];
}
export function applyDefer(taskId, o, { silent = false } = {}) {
  if (o.date) return deferTask(taskId, o.date, o.label, { silent });
}

export function openDeferMenu(anchor, taskId) {
  const items = deferOptions().map(o => ({
    icon: o.icon, label: o.label, hint: o.hint,
    onClick: () => (o.key === 'other' ? openDeferSheet(taskId) : applyDefer(taskId, o)),
  }));
  openMenu(anchor, items);
}

export function openDeferSheet(taskId, { onDone } = {}) {
  let n = 3, unit = 'd';
  const target = () => ymd(unit === 'd' ? addDays(new Date(), n) : unit === 'w' ? addDays(new Date(), n * 7) : addMonths(new Date(), n));
  openSheet(() => {
    const t = state.tasks.find(x => x.id === taskId);
    const d = fromYmd(target());
    return `
      <h3>לדחות את ${esc(t?.title || 'המשימה')}</h3>
      <div class="field-label">בעוד…</div>
      <div class="row2" style="grid-template-columns:96px 1fr">
        <input class="inp" type="number" inputmode="numeric" min="1" max="365" value="${n}" data-key="n" aria-label="מספר">
        <div class="seg">${[['d', 'ימים'], ['w', 'שבועות'], ['m', 'חודשים']].map(([k, l]) => `<button type="button" data-unit="${k}" aria-pressed="${unit === k}">${l}</button>`).join('')}</div>
      </div>
      <p class="sub" style="margin-top:12px">${icon('calendar')} יום ${dayName(d)}, ${longDate(d)}</p>
      <div class="field-label">או תאריך מדויק</div>
      <input class="inp" type="date" data-key="date" min="${ymd(addDays(new Date(), 1))}" value="${target()}">
      <div class="actions"><button class="btn primary grow" data-go>${icon('check')}לדחות</button></div>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('input', e => {
    if (e.target.dataset.key === 'n') { n = Math.max(1, Math.min(365, Number(e.target.value) || 1)); paintSheet(); }
    if (e.target.dataset.key === 'date' && e.target.value) {
      const days = daysBetween(new Date(), fromYmd(e.target.value));
      if (days > 0) { n = days; unit = 'd'; paintSheet(); }
    }
  });
  el.addEventListener('click', e => {
    const u = e.target.closest('[data-unit]');
    if (u) { unit = u.dataset.unit; paintSheet(); return; }
    if (e.target.closest('[data-go]')) {
      const d = target();
      deferTask(taskId, d, daysLeftLabel(daysBetween(new Date(), fromYmd(d))).replace('בעוד ', ''));
      closeSheet(); onDone?.(d);
    }
  });
}

// ---------- shared: list picker + subtask editor ----------
const listSelect = (key, value) => state.lists.length > 1
  ? `<div class="field-label">${icon('list')}רשימה</div><select class="inp" data-key="${key}">${state.lists.map(l => `<option value="${l.id}" ${l.id === value ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>`
  : '';
const timeValue = d => d ? hm(d) : '';
const reminderBase = t => { const d = t?.due && t.due >= ymd(new Date()) ? fromYmd(t.due) : startOfDay(state.day < startOfDay(new Date()) ? new Date() : state.day); return d; };

// ---------- task sheet ----------
export function openTask(id) {
  const root = () => allTaskRoots().find(t => t.id === id);
  openSheet(() => {
    const t = root();
    if (!t) return '<p class="empty">המשימה לא נמצאה.</p>';
    const n = t.due ? daysBetween(new Date(), fromYmd(t.due)) : null;
    const r = reminderOf(t.id);
    const doneSubs = t.subtasks.filter(s => s.status === 'completed').length;
    return `
      ${n != null && n < 0 ? `<div class="sub"><b style="color:var(--danger)">${daysLeftLabel(n)}</b></div>` : ''}
      <div style="display:flex;align-items:center;gap:4px;margin-top:6px">
        <button class="check ${t.status === 'completed' ? 'on' : ''}" data-toggle="${t.id}" aria-label="סימון כבוצע"><span>${icon('check')}</span></button>
        <input class="inp title-inp" data-key="title" value="${esc(t.title)}" aria-label="שם המשימה" enterkeyhint="done">
      </div>
      <div class="subs" style="margin-top:8px">
        ${t.subtasks.map(s => `
          <div class="sub-row ${s.status === 'completed' ? 'done' : ''}">
            <button class="check ${s.status === 'completed' ? 'on' : ''}" data-toggle="${s.id}" aria-label="סימון תת־משימה"><span>${icon('check')}</span></button>
            <input data-key="sub-${s.id}" data-sub="${s.id}" value="${esc(s.title)}" aria-label="תת־משימה" enterkeyhint="done">
            <button class="icon-btn" data-delsub="${s.id}" aria-label="מחיקת תת־משימה">${icon('x')}</button>
          </div>`).join('')}
        <div class="sub-row sub-add">
          <span class="check" aria-hidden="true">${icon('plus')}</span>
          <input data-key="newsub" placeholder="${t.subtasks.length ? `תת־משימה נוספת (${doneSubs}/${t.subtasks.length})` : 'הוספת תת־משימה'}" enterkeyhint="enter" aria-label="תת־משימה חדשה">
        </div>
      </div>
      <div class="field-label">פרטים</div>
      <textarea class="inp" data-key="notes" placeholder="הערות, קישורים…">${esc(t.notes)}</textarea>
      <div class="field-label">${icon('bell')}תזכורת</div>
      <div class="rem-row">
        <input class="inp" type="time" data-key="rtime" value="${timeValue(r?.time)}" aria-label="שעת תזכורת">
        ${r ? `<button class="btn sm" data-clear-rem>${icon('bellOff')}ללא</button>` : ''}
      </div>
      <p class="small-print" style="margin-top:6px">${r ? `התראה תגיע ב־${hm(r.time)}, ${relDayLabel(r.time)}. ` : ''}אפשר גם לגרור את המשימה ברשימה של היום, והשעה תתעדכן לפי המקום.</p>
      ${listSelect('list', t.listId)}
      <div class="actions">
        ${t.status !== 'completed' ? `<button class="btn" data-defer>${icon('snooze')}לדחות</button>` : ''}
        <a class="btn grow" href="${esc(t.webLink)}" target="_blank" rel="noopener">${icon('external')}בגוגל משימות</a>
        <button class="btn danger" data-del aria-label="מחיקת המשימה">${icon('trash')}</button>
      </div>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('click', e => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) { toggleTask(tg.dataset.toggle, { silent: tg.dataset.toggle !== id }); paintSheet(); return; }
    const ds = e.target.closest('[data-delsub]');
    if (ds) { deleteTask(ds.dataset.delsub); paintSheet(); return; }
    if (e.target.closest('[data-clear-rem]')) { setTaskReminder(id, null); setTimeout(paintSheet, 50); return; }
    if (e.target.closest('[data-defer]')) { openDeferMenu(e.target.closest('[data-defer]'), id); return; }
    if (e.target.closest('[data-del]')) { closeSheet(); deleteTask(id); }
  });
  el.addEventListener('change', e => {
    const k = e.target.dataset.key;
    const t = state.tasks.find(x => x.id === id);
    if (k === 'title' && e.target.value.trim() && e.target.value !== t.title) updateTask(id, { title: e.target.value.trim() });
    if (k === 'notes' && e.target.value !== t.notes) updateTask(id, { notes: e.target.value });
    if (k === 'list') { moveTaskToList(id, e.target.value); paintSheet(); }
    if (k === 'rtime') {
      if (!e.target.value) { setTaskReminder(id, null); }
      else {
        const [h, m] = e.target.value.split(':').map(Number);
        const d = reminderBase(t); d.setHours(h, m, 0, 0);
        setTaskReminder(id, d, { quiet: false });
      }
      setTimeout(paintSheet, 50);
    }
    if (e.target.dataset.sub) {
      const s = state.tasks.find(x => x.id === e.target.dataset.sub);
      const v = e.target.value.trim();
      if (s && v && v !== s.title) updateTask(s.id, { title: v });
    }
  });
  el.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    if (e.target.dataset.key === 'newsub') {
      e.preventDefault();
      const v = e.target.value.trim(); if (!v) return;
      const t = state.tasks.find(x => x.id === id);
      e.target.value = '';
      await addTask({ title: v, parent: id, listId: t.listId });
      paintSheet();
      el.querySelector('[data-key="newsub"]')?.focus();
    } else { e.target.blur(); }
  });
}

// ---------- add sheet (with voice) ----------
export function openAdd({ kind = 'task', voice = false, date = null } = {}) {
  const d0 = date || state.day;
  const f = {
    kind, title: '', notes: '', list: state.settings.defaultList || state.lists[0]?.id, subs: [], rtime: '',
    date: ymd(d0), start: nextSlot(), dur: 60, allDay: false, cal: state.settings.defaultCal || state.cals.find(c => c.primary)?.id,
    location: '', heard: '', listening: false,
  };
  let stop = null;
  const writable = () => state.cals.filter(c => ['owner', 'writer'].includes(c.accessRole));
  const mic = () => voiceSupported ? `<button type="button" class="in-mic ${f.listening ? 'on' : ''}" data-mic aria-label="${f.listening ? 'עצירת ההכתבה' : 'הכתבה'}">${icon('mic')}</button>` : '';
  openSheet(() => `
    <div class="kind-tabs" role="group" aria-label="סוג">
      <button type="button" data-kind="task" aria-pressed="${f.kind === 'task'}">${icon('check')}משימה</button>
      <button type="button" data-kind="event" aria-pressed="${f.kind === 'event'}">${icon('calendar')}אירוע</button>
    </div>
    <div class="field-label">${f.kind === 'task' ? 'מה צריך לעשות?' : 'שם האירוע'}</div>
    <div class="inp-wrap">
      <input class="inp" data-key="title" value="${esc(f.title)}" placeholder="${f.listening ? 'מקשיב…' : f.kind === 'task' ? 'לשלוח את הקבצים לרוני' : 'פגישה עם…'}" enterkeyhint="done">
      ${mic()}
    </div>
    <div class="heard">${esc(f.heard)}</div>
    ${f.kind === 'task' ? `
      <div class="subs">
        ${f.subs.map((v, k) => `<div class="sub-row"><span class="check" aria-hidden="true"><span></span></span><input data-subi="${k}" data-key="s${k}" value="${esc(v)}" aria-label="תת־משימה"><button class="icon-btn" data-rmsub="${k}" aria-label="הסרה">${icon('x')}</button></div>`).join('')}
        <div class="sub-row sub-add"><span class="check" aria-hidden="true">${icon('plus')}</span><input data-key="newsub" placeholder="הוספת תת־משימה" enterkeyhint="enter" aria-label="תת־משימה חדשה"></div>
      </div>
      <div class="field-label">פרטים</div>
      <textarea class="inp" data-key="notes" placeholder="לא חובה">${esc(f.notes)}</textarea>
      <div class="field-label">${icon('bell')}תזכורת</div>
      <input class="inp" type="time" data-key="rtime" value="${f.rtime}" aria-label="שעת תזכורת" style="width:auto">
      ${listSelect('list', f.list)}
    ` : `
      <div class="field-label">${icon('calendar')}מתי</div>
      <div class="row2">
        <input class="inp" type="date" data-key="date" value="${f.date}" aria-label="תאריך">
        ${f.allDay ? '<div></div>' : `<input class="inp" type="time" data-key="start" value="${f.start}" aria-label="שעת התחלה">`}
      </div>
      <div class="seg" style="margin-top:10px">
        ${[[30, 'חצי שעה'], [60, 'שעה'], [90, 'שעה וחצי'], [120, 'שעתיים']].map(([m, l]) => `<button type="button" data-dur="${m}" aria-pressed="${!f.allDay && f.dur === m}">${l}</button>`).join('')}
        <button type="button" data-allday aria-pressed="${f.allDay}">כל היום</button>
      </div>
      <div class="field-label">${icon('pin')}מיקום</div>
      <input class="inp" data-key="location" value="${esc(f.location)}" placeholder="לא חובה">
      <div class="field-label">יומן</div>
      <select class="inp" data-key="cal">${writable().map(c => `<option value="${esc(c.id)}" ${c.id === f.cal ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <p class="small-print">התזכורות של האירוע יהיו ברירת המחדל של היומן. משנים אותן בגוגל קלנדר.</p>
    `}
    <div class="actions"><button class="btn primary grow" data-save ${f.title.trim() ? '' : 'disabled'}>${icon('check')}${f.kind === 'task' ? 'הוספת משימה' : 'הוספה ליומן'}</button></div>`,
  { onClose: () => stop?.() });

  const el = document.querySelector('.sheet');
  const save = async () => {
    if (!f.title.trim()) return;
    closeSheet();
    if (f.kind === 'task') {
      const due = ymd(d0 < startOfDay(new Date()) ? new Date() : d0);
      const t = await addTask({ title: f.title.trim(), notes: f.notes, due, listId: f.list });
      for (const sub of f.subs.filter(x => x.trim())) await addTask({ title: sub.trim(), parent: t.id, listId: f.list });
      if (f.rtime) { const [h, m] = f.rtime.split(':').map(Number); const d = fromYmd(due); d.setHours(h, m, 0, 0); setTaskReminder(t.id, d, { quiet: false }); }
    } else {
      const start = fromYmd(f.date);
      let end;
      if (f.allDay) end = addDays(start, 1);
      else { const [h, m] = f.start.split(':').map(Number); start.setHours(h, m); end = new Date(start.getTime() + f.dur * 60000); }
      await addEvent({ calId: f.cal, title: f.title.trim(), start, end, allDay: f.allDay, location: f.location, description: '', reminder: 'default' });
    }
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kind) { f.kind = b.dataset.kind; paintSheet(); }
    else if (b.dataset.dur) { f.dur = Number(b.dataset.dur); f.allDay = false; paintSheet(); }
    else if ('allday' in b.dataset) { f.allDay = !f.allDay; paintSheet(); }
    else if (b.dataset.rmsub) { f.subs.splice(Number(b.dataset.rmsub), 1); paintSheet(); }
    else if ('save' in b.dataset) save();
    else if ('mic' in b.dataset) toggleMic();
  });
  el.addEventListener('input', e => {
    const k = e.target.dataset.key; if (!k) return;
    if (e.target.dataset.subi) { f.subs[Number(e.target.dataset.subi)] = e.target.value; return; }
    if (k === 'newsub') return;
    f[k] = e.target.value;
    if (k === 'title') el.querySelector('[data-save]').disabled = !f.title.trim();
  });
  el.addEventListener('change', e => { if (e.target.dataset.key === 'date') paintSheet(); });
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.dataset.key === 'title') { e.preventDefault(); save(); }
    if (e.target.dataset.key === 'newsub') {
      e.preventDefault();
      const v = e.target.value.trim(); if (!v) return;
      f.subs.push(v); paintSheet();
      el.querySelector('[data-key="newsub"]')?.focus();
    }
  });

  function toggleMic() {
    if (f.listening) { stop?.(); return; }
    f.listening = true; f.heard = ''; paintSheet();
    stop = listen({
      onPartial: txt => { f.heard = txt; const h = el.querySelector('.heard'); if (h) h.textContent = txt; },
      onFinal: txt => {
        const p = parseHebrew(txt);
        f.title = p.title;
        if (p.kind === 'event' && f.kind === 'event') { f.date = p.date || ymd(new Date()); f.start = p.time || f.start; f.allDay = false; }
        else if (p.time) { f.rtime = p.time; } // a time on a task becomes its reminder
        f.heard = `״${txt}״`;
      },
      onError: err => { f.heard = err === 'not-allowed' ? 'צריך לאשר גישה למיקרופון.' : 'לא הצלחתי לשמוע. נסה שוב.'; },
      onEnd: () => { f.listening = false; paintSheet(); el.querySelector('[data-save]').disabled = !f.title.trim(); },
    });
  }
  if (voice && voiceSupported) setTimeout(toggleMic, 350);
  else setTimeout(() => el.querySelector('[data-key="title"]')?.focus(), 380);
}

function nextSlot() {
  const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return hm(d);
}

// ---------- settings ----------
export function openSettings({ onLogin } = {}) {
  loadPushInfo().then(() => paintSheet());
  let colorOpen = null;
  openSheet(() => {
    const s = state.settings;
    const sample = state.cals.filter(c => !s.hiddenCals.includes(c.id)).slice(0, 3);
    return `
      <h3>הגדרות</h3>
      <div class="field-label">חשבון גוגל</div>
      ${state.mode === 'live' ? `
        <div class="acct">${icon('google')}<div class="grow"><b>${esc(state.profile?.email || 'מחובר')}</b><small style="display:block;color:var(--ink-2)">יומן, משימות ו־Gmail</small></div>
        <button class="btn sm" data-logout>${icon('logout')}ניתוק</button></div>`
      : `<div class="acct">${icon('google')}<div class="grow"><b>מצב הדגמה</b><small style="display:block;color:var(--ink-2)">${auth.configured ? 'התחבר כדי לראות את הנתונים שלך' : 'חסר Client ID בהגדרות האפליקציה'}</small></div>
        ${auth.configured ? `<button class="btn sm primary" data-login>התחברות</button>` : ''}</div>`}

      <div class="field-label">מראה</div>
      <div class="seg">${[['system', 'לפי המכשיר'], ['light', 'בהיר'], ['dark', 'כהה']].map(([v, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${s.theme === v}">${v === 'light' ? icon('sun') : v === 'dark' ? icon('moon') : ''}${l}</button>`).join('')}</div>

      <div class="field-label">${icon('calendar')}יומנים</div>
      ${state.cals.map(c => `
        <div class="set-row">
          <button class="swatch-btn" style="background:${calColor(c)}" data-color="${esc(c.id)}" aria-label="צבע ל${esc(c.name)}"></button>
          <div class="grow"><b>${esc(c.name)}</b>${c.primary ? '<small>היומן הראשי</small>' : c.accessRole === 'reader' ? '<small>צפייה בלבד</small>' : ''}</div>
          <button class="switch" role="switch" aria-checked="${!s.hiddenCals.includes(c.id)}" data-cal="${esc(c.id)}" aria-label="הצגת ${esc(c.name)}"></button>
        </div>
        ${colorOpen === c.id ? `<div class="palette">${APP_PALETTE.concat([c.color]).filter((x, i, a) => a.indexOf(x) === i).map(col => `<button style="background:${col}" data-pick="${col}" aria-label="${col}">${calColor(c) === col ? icon('check') : ''}</button>`).join('')}<button class="reset" data-pick="">איפוס</button></div>` : ''}`).join('')}

      <div class="field-label">צבעים</div>
      <div class="seg">${[['google', 'הצבעים מגוגל'], ['app', 'פלטה של האפליקציה']].map(([v, l]) => `<button type="button" data-colorsrc="${v}" aria-pressed="${s.colorSource === v}">${l}</button>`).join('')}</div>
      <div class="field-label">סימון יומן באירוע</div>
      <div class="seg">${[['bar', 'פס צבע'], ['dot', 'נקודה'], ['tint', 'רקע צבעוני']].map(([v, l]) => `<button type="button" data-marker="${v}" aria-pressed="${s.marker === v}">${l}</button>`).join('')}</div>
      <div class="preview mk-${s.marker}">
        ${sample.map((c, i) => `
          <div class="ev" style="--c:${calColor(c)}">
            <div class="ev-time">${['09:00', '12:30', '18:00'][i]}<small>${['10:00', '13:30', '19:00'][i]}</small></div>
            <div class="ev-main"><i class="ev-bar" style="background:${calColor(c)}"></i>
              <div class="ev-text"><div class="ev-title">${['פגישת צוות', 'שיעור מושן', 'ארוחת ערב'][i]}</div>
              <div class="ev-meta"><span><i class="cal-dot" style="background:${calColor(c)}"></i>${esc(c.name)}</span></div></div></div><div></div>
          </div>`).join('')}
      </div>

      <div class="field-label">${icon('bell')}תזכורות</div>
      <div class="set-row"><div class="grow"><b>תזכורת לדוגמה</b><small>יוצר אירוע קצר ביומן הראשי בעוד 2 דקות, עם תזכורת דקה לפני. כך תשמע ותראה בדיוק איך תזכורת מגיעה לטלפון.</small></div>
        <button class="btn sm" data-test-reminder>${icon('bellRing')}שליחה</button></div>

      <div class="field-label">${icon('mail')}מיילים לטיפול</div>
      <div class="set-row"><div class="grow"><b>להציג מיילים ב״מה איתי היום״</b><small>הכרטיסים מאפשרים לארכב או להפוך מייל למשימה</small></div>
        <button class="switch" role="switch" aria-checked="${s.gmailEnabled}" data-toggle-set="gmailEnabled" aria-label="מיילים"></button></div>
      ${s.gmailEnabled ? `<div class="set-row"><div class="grow"><small>אילו מיילים (חיפוש Gmail)</small>
        <input class="inp" data-key="gmailQuery" value="${esc(s.gmailQuery)}" dir="ltr" style="margin-top:6px;font-size:14px"></div></div>
        <div class="set-row"><div class="grow"><b>לכלול מיילים באשף הבוקר</b></div>
        <button class="switch" role="switch" aria-checked="${s.wizardEmails}" data-toggle-set="wizardEmails" aria-label="מיילים באשף"></button></div>
        ${state.labels.length ? `<div class="field-label">תוויות שיוצעו בארכוב מייל בלי תווית</div>
          <div class="seg">${state.labels.map(l => `<button type="button" data-label-toggle="${esc(l.name)}" aria-pressed="${!(s.hiddenLabels || []).includes(l.name)}">${esc(l.name)}</button>`).join('')}</div>` : ''}` : ''}

      <div class="field-label"><span class="pilcrow">¶</span>התלקיט</div>
      <div class="set-row"><div class="grow"><b>להציג את התלקיט בימי ראשון</b><small>כרטיס בראש המסך ובאשף, כשהגיליון השבועי מוכן</small></div>
        <button class="switch" role="switch" aria-checked="${s.digestEnabled}" data-toggle-set="digestEnabled" aria-label="התלקיט"></button></div>

      ${state.lists.length > 1 ? `<div class="field-label">${icon('list')}רשימת ברירת מחדל למשימות חדשות</div>
        <select class="inp" data-key="defaultList">${state.lists.map(l => `<option value="${l.id}" ${l.id === (s.defaultList || state.lists[0].id) ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : ''}

      <div class="field-label">${icon('bellRing')}התראות בוקר וערב</div>
      ${pushPanel()}

      <p class="small-print">גוגל משימות שומרות תאריך בלי שעה. תזכורת למשימה נשמרת כאירוע קטן (⏰) ביומן הראשי שמצלצל בשעה שנבחרה. באפליקציה הוא מוסתר, ובגוגל קלנדר הוא נראה כאירוע של 5 דקות.<br>${state.lastSync ? `סונכרן לאחרונה ב־${hm(state.lastSync)}.` : ''}</p>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = state.settings;
    if (b.dataset.themeSet) { saveSettings({ theme: b.dataset.themeSet }); applyTheme(); }
    else if (b.dataset.cal) {
      const id = b.dataset.cal;
      const hidden = s.hiddenCals.includes(id) ? s.hiddenCals.filter(x => x !== id) : [...s.hiddenCals, id];
      saveSettings({ hiddenCals: hidden }); refresh();
    } else if (b.dataset.color) { colorOpen = colorOpen === b.dataset.color ? null : b.dataset.color; }
    else if ('pick' in b.dataset) {
      const cc = { ...s.calColors };
      if (b.dataset.pick) cc[colorOpen] = b.dataset.pick; else delete cc[colorOpen];
      saveSettings({ calColors: cc });
    } else if (b.dataset.colorsrc) saveSettings({ colorSource: b.dataset.colorsrc, calColors: {} });
    else if (b.dataset.marker) saveSettings({ marker: b.dataset.marker });
    else if (b.dataset.labelToggle) {
      const n = b.dataset.labelToggle, h = s.hiddenLabels || [];
      saveSettings({ hiddenLabels: h.includes(n) ? h.filter(x => x !== n) : [...h, n] });
    }
    else if ('testReminder' in b.dataset) { sendTestReminder(b); return; }
    else if (b.dataset.viewmode) saveSettings({ viewMode: b.dataset.viewmode });
    else if (b.dataset.toggleSet) { saveSettings({ [b.dataset.toggleSet]: !s[b.dataset.toggleSet] }); if (b.dataset.toggleSet === 'gmailEnabled') refresh(); }
    else if ('login' in b.dataset) { closeSheet(true, true); onLogin?.(); return; }
    else if ('logout' in b.dataset) { auth.logout(); location.reload(); return; }
    else return;
    paintSheet();
  });
  el.addEventListener('change', e => {
    const k = e.target.dataset.key;
    if (k === 'gmailQuery') { saveSettings({ gmailQuery: e.target.value.trim() }); refresh(); }
    if (k === 'defaultList') saveSettings({ defaultList: e.target.value });
  });
}

async function sendTestReminder(btn) {
  const calId = state.cals.find(c => c.primary)?.id;
  const start = new Date(Date.now() + 2 * 60000); start.setSeconds(0, 0);
  btn.disabled = true; btn.textContent = 'שולח…';
  try {
    await api().createEvent({ calId, title: '🔔 תזכורת לדוגמה', start, end: new Date(start.getTime() + 5 * 60000), allDay: false, location: '', description: 'נוצר מ״מה איתי היום?״ כדי לשמוע איך נשמעת תזכורת. האירוע יימחק לבד.', reminder: [1], snoozeFor: 'test' });
    btn.textContent = `תגיע ב־${hm(new Date(start.getTime() - 60000))} ✓`;
  } catch (e) { btn.textContent = 'לא הצליח'; console.error(e); }
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d4b57' : '#3cc4dc');
}
