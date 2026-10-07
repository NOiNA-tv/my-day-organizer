// Detail / edit / add / settings sheets.
import { icon } from './icons.js';
import { openSheet, paintSheet, closeSheet, openMenu } from './overlay.js';
import {
  state, calById, calColor, setReminder, deleteEvent, toggleTask, updateTask, deferTask, deleteTask, addTask, addEvent,
  saveSettings, refresh, APP_PALETTE, allTaskRoots, emit,
} from './data.js';
import { esc, hm, longDate, dayName, ymd, fromYmd, addDays, addMonths, startOfDay, countdown, relDayLabel, daysBetween, daysLeftLabel } from './util.js';
import { voiceSupported, listen, parseHebrew } from './voice.js';
import { auth } from './auth.js';
import { pushPanel } from './push.js';

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

// Reminder times you can pick from (Settings decides which ones show up as chips)
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 45, 60, 120, 180, 1440, 2880, 10080];
export const remShort = m => m == null ? 'ללא' : m === 0 ? 'בזמן האירוע' : m < 60 ? `${m} דק׳` : m === 60 ? 'שעה' : m === 120 ? 'שעתיים' : m < 1440 ? `${m / 60} שעות` : m === 1440 ? 'יום' : m === 2880 ? 'יומיים' : m === 10080 ? 'שבוע' : `${Math.round(m / 1440)} ימים`;
export const reminderLabel = m => m == null ? 'ללא תזכורת' : m === 0 ? 'בזמן האירוע' : `${remShort(m)} לפני`;

// The chips shown for one event: none · calendar default · your chosen times (+ the event's current value if it's something else)
export function reminderChips(ev) {
  const cal = calById(ev.calId);
  const def = cal?.defaultReminders?.find(r => r.method === 'popup')?.minutes ?? null;
  const opts = [{ v: 'null', label: 'ללא', on: !ev.reminderIsDefault && ev.reminder == null, icon: 'bellOff' },
    { v: 'default', label: `ברירת מחדל${def != null ? ` (${remShort(def)})` : ''}`, on: ev.reminderIsDefault }];
  const mins = [...state.settings.reminderOptions];
  if (!ev.reminderIsDefault && ev.reminder != null && !mins.includes(ev.reminder)) mins.push(ev.reminder);
  mins.sort((a, b) => a - b).forEach(m => opts.push({ v: String(m), label: remShort(m), on: !ev.reminderIsDefault && ev.reminder === m }));
  return `<div class="seg">${opts.map(o => `<button type="button" data-rem="${o.v}" aria-pressed="${o.on}">${o.icon ? icon(o.icon) : ''}${o.label}</button>`).join('')}</div>`;
}
const parseRem = v => v === 'null' ? null : v === 'default' ? 'default' : Number(v);

// ---------- event sheet ----------
export function openEvent(id) {
  openSheet(() => {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return '<p class="empty">האירוע לא נמצא.</p>';
    const cal = calById(ev.calId);
    const now = new Date();
    const status = ev.allDay ? '' : ev.end <= now ? 'הסתיים' : ev.start <= now ? `עכשיו · עד ${hm(ev.end)}` : countdown(ev.start - now);
    const nav = ev.location ? navLinks(ev.location) : null;
    return `
      <div class="sub"><span><i class="cal-dot" style="background:${calColor(cal)}"></i>${esc(cal?.name || '')}</span><span>${relDayLabel(ev.start)} · ${eventTimeText(ev)}</span></div>
      <h3>${esc(ev.title)}</h3>
      ${status ? `<div class="sub"><b style="color:var(--brand-deep)">${esc(status)}</b></div>` : ''}
      ${ev.meet ? `<div class="actions" style="margin-top:14px"><a class="btn primary grow" href="${esc(ev.meet)}" target="_blank" rel="noopener">${icon('video')}הצטרפות לשיחת וידאו</a></div>` : ''}
      ${nav ? `
        <div class="field-label">${icon('pin')}${esc(ev.location)}</div>
        <div class="nav-grid">
          <a href="${nav.walk}" target="_blank" rel="noopener">${icon('walk')}ברגל</a>
          <a href="${nav.transit}" target="_blank" rel="noopener">${icon('bus')}תחבורה ציבורית</a>
          <a href="${nav.car}" target="_blank" rel="noopener">${icon('car')}Waze</a>
        </div>` : ''}
      ${ev.description ? `<div class="field-label">תיאור</div><div class="desc">${linkify(ev.description)}</div>` : ''}
      ${!ev.allDay && ev.canEdit ? `
        <div class="field-label">${icon('bell')}תזכורת לפני האירוע</div>
        ${reminderChips(ev)}` : ''}
      <div class="actions">
        <a class="btn grow" href="${esc(ev.htmlLink)}" target="_blank" rel="noopener">${icon('pencil')}עריכה ביומן גוגל</a>
        ${ev.canEdit ? `<button class="btn danger" data-del aria-label="מחיקת האירוע">${icon('trash')}</button>` : ''}
      </div>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('click', e => {
    const r = e.target.closest('[data-rem]');
    if (r) { setReminder(id, parseRem(r.dataset.rem)); paintSheet(); return; }
    if (e.target.closest('[data-del]')) { closeSheet(); deleteEvent(id); }
  });
}

// ---------- defer ----------
export function deferOptions(day = new Date()) {
  const t = startOfDay(day);
  return [
    { key: 'tomorrow', icon: 'arrowL', label: 'מחר', hint: dayName(addDays(t, 1)), date: ymd(addDays(t, 1)) },
    { key: 'week', icon: 'calendar', label: 'בעוד שבוע', hint: `${addDays(t, 7).getDate()}/${addDays(t, 7).getMonth() + 1}`, date: ymd(addDays(t, 7)) },
    { key: 'other', icon: 'snooze', label: 'מועד אחר…' },
  ];
}

export function openDeferMenu(anchor, taskId) {
  const items = deferOptions().map(o => ({
    icon: o.icon, label: o.label, hint: o.hint,
    onClick: () => o.date ? deferTask(taskId, o.date, o.label) : openDeferSheet(taskId),
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
      <div class="actions"><button class="btn primary grow" data-go>${icon('check')}לדחות</button></div>
      <p class="small-print">גוגל משימות שומרות תאריך בלבד, בלי שעה. לכן הדחייה היא לפי ימים.</p>`;
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

// ---------- task sheet ----------
export function openTask(id) {
  const root = () => allTaskRoots().find(t => t.id === id);
  openSheet(() => {
    const t = root();
    if (!t) return '<p class="empty">המשימה לא נמצאה.</p>';
    const today = ymd(new Date()), tomorrow = ymd(addDays(new Date(), 1)), week = ymd(addDays(new Date(), 7));
    const doneSubs = t.subtasks.filter(s => s.status === 'completed').length;
    return `
      <div class="sub"><span>${icon('list')} ${esc(t.listTitle || '')}</span>${t.due ? `<span>${daysLeftLabel(daysBetween(new Date(), fromYmd(t.due)))}</span>` : ''}</div>
      <div style="display:flex;align-items:center;gap:4px;margin-top:6px">
        <button class="check ${t.status === 'completed' ? 'on' : ''}" data-toggle="${t.id}" aria-label="סימון כבוצע"><span>${icon('check')}</span></button>
        <input class="inp title-inp" data-key="title" value="${esc(t.title)}" aria-label="שם המשימה" enterkeyhint="done">
      </div>
      <div class="field-label">${icon('calendar')}תאריך יעד</div>
      <div class="seg">
        <button type="button" data-due="${today}" aria-pressed="${t.due === today}">היום</button>
        <button type="button" data-due="${tomorrow}" aria-pressed="${t.due === tomorrow}">מחר</button>
        <button type="button" data-due="${week}" aria-pressed="${t.due === week}">בעוד שבוע</button>
        <button type="button" data-due="" aria-pressed="${!t.due}">ללא</button>
        <input class="inp" type="date" data-key="due" value="${t.due || ''}" style="width:auto;height:38px;padding:0 10px;border-radius:12px" aria-label="תאריך">
      </div>
      <div class="field-label">${icon('list')}תתי־משימות ${t.subtasks.length ? `<span style="font-weight:500">${doneSubs}/${t.subtasks.length}</span>` : ''}</div>
      <div class="subs">
        ${t.subtasks.map(s => `
          <div class="sub-row ${s.status === 'completed' ? 'done' : ''}">
            <button class="check ${s.status === 'completed' ? 'on' : ''}" data-toggle="${s.id}" aria-label="סימון תת־משימה"><span>${icon('check')}</span></button>
            <input data-key="sub-${s.id}" data-sub="${s.id}" value="${esc(s.title)}" aria-label="תת־משימה" enterkeyhint="done">
            <button class="icon-btn" data-delsub="${s.id}" aria-label="מחיקת תת־משימה">${icon('x')}</button>
          </div>`).join('')}
        <div class="sub-row sub-add">
          <span class="check" aria-hidden="true">${icon('plus')}</span>
          <input data-key="newsub" placeholder="הוספת תת־משימה" enterkeyhint="enter" aria-label="תת־משימה חדשה">
        </div>
      </div>
      <div class="field-label">פרטים</div>
      <textarea class="inp" data-key="notes" placeholder="הערות, קישורים…">${esc(t.notes)}</textarea>
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
    const du = e.target.closest('[data-due]');
    if (du) { updateTask(id, { due: du.dataset.due || null }); paintSheet(); return; }
    const ds = e.target.closest('[data-delsub]');
    if (ds) { deleteTask(ds.dataset.delsub); paintSheet(); return; }
    if (e.target.closest('[data-defer]')) { openDeferMenu(e.target.closest('[data-defer]'), id); return; }
    if (e.target.closest('[data-del]')) { closeSheet(); deleteTask(id); }
  });
  el.addEventListener('change', e => {
    const k = e.target.dataset.key;
    const t = state.tasks.find(x => x.id === id);
    if (k === 'title' && e.target.value.trim() && e.target.value !== t.title) updateTask(id, { title: e.target.value.trim() });
    if (k === 'notes' && e.target.value !== t.notes) updateTask(id, { notes: e.target.value });
    if (k === 'due') { updateTask(id, { due: e.target.value || null }); paintSheet(); }
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
    kind, title: '', notes: '', due: ymd(d0), list: state.settings.defaultList || state.lists[0]?.id,
    date: ymd(d0), start: nextSlot(), dur: 60, allDay: false, cal: state.settings.defaultCal || state.cals.find(c => c.primary)?.id,
    location: '', reminder: 'default', heard: '', listening: false,
  };
  let stop = null;
  const writable = () => state.cals.filter(c => ['owner', 'writer'].includes(c.accessRole));
  openSheet(() => `
    <div class="kind-tabs" role="group" aria-label="סוג">
      <button type="button" data-kind="task" aria-pressed="${f.kind === 'task'}">${icon('check')}משימה</button>
      <button type="button" data-kind="event" aria-pressed="${f.kind === 'event'}">${icon('calendar')}אירוע</button>
    </div>
    ${voiceSupported ? `
      <button type="button" class="mic-big ${f.listening ? 'on' : ''}" data-mic>
        <span class="orb">${icon('mic')}</span>
        <span><b>${f.listening ? 'מקשיב…' : 'הכתבה'}</b><small>למשל: ״מחר בעשר פגישה עם רוני״ או ״לקנות חלב מחר״</small></span>
      </button>
      <div class="heard">${esc(f.heard)}</div>` : ''}
    <div class="field-label">${f.kind === 'task' ? 'מה צריך לעשות?' : 'שם האירוע'}</div>
    <input class="inp" data-key="title" value="${esc(f.title)}" placeholder="${f.kind === 'task' ? 'לשלוח את הקבצים לרוני' : 'פגישה עם…'}" enterkeyhint="done">
    ${f.kind === 'task' ? `
      <div class="field-label">${icon('calendar')}תאריך יעד</div>
      <div class="seg">
        ${[[ymd(new Date()), 'היום'], [ymd(addDays(new Date(), 1)), 'מחר'], ['', 'ללא']].map(([v, l]) => `<button type="button" data-due="${v}" aria-pressed="${(f.due || '') === v}">${l}</button>`).join('')}
        <input class="inp" type="date" data-key="due" value="${f.due || ''}" style="width:auto;height:38px;padding:0 10px;border-radius:12px" aria-label="תאריך">
      </div>
      ${state.lists.length > 1 ? `<div class="field-label">${icon('list')}רשימה</div>
        <select class="inp" data-key="list">${state.lists.map(l => `<option value="${l.id}" ${l.id === f.list ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : ''}
      <div class="field-label">פרטים</div>
      <textarea class="inp" data-key="notes" placeholder="לא חובה">${esc(f.notes)}</textarea>
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
      <div class="field-label">${icon('bell')}תזכורת</div>
      <div class="seg">${[['default', 'ברירת מחדל'], ['null', 'ללא'], ...state.settings.reminderOptions.map(m => [String(m), remShort(m)])].map(([m, l]) => `<button type="button" data-rem="${m}" aria-pressed="${String(f.reminder) === String(m)}">${l}</button>`).join('')}</div>
    `}
    <div class="actions"><button class="btn primary grow" data-save ${f.title.trim() ? '' : 'disabled'}>${icon('check')}${f.kind === 'task' ? 'הוספת משימה' : 'הוספה ליומן'}</button></div>`,
  { onClose: () => stop?.() });

  const el = document.querySelector('.sheet');
  const save = async () => {
    if (!f.title.trim()) return;
    closeSheet();
    if (f.kind === 'task') await addTask({ title: f.title.trim(), notes: f.notes, due: f.due || null, listId: f.list });
    else {
      const start = fromYmd(f.date);
      let end;
      if (f.allDay) end = addDays(start, 1);
      else { const [h, m] = f.start.split(':').map(Number); start.setHours(h, m); end = new Date(start.getTime() + f.dur * 60000); }
      await addEvent({ calId: f.cal, title: f.title.trim(), start, end, allDay: f.allDay, location: f.location, description: '', reminder: f.reminder === 'default' ? 'default' : f.reminder === 'null' ? null : Number(f.reminder) });
    }
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kind) { f.kind = b.dataset.kind; paintSheet(); }
    else if ('due' in b.dataset) { f.due = b.dataset.due; paintSheet(); }
    else if (b.dataset.dur) { f.dur = Number(b.dataset.dur); f.allDay = false; paintSheet(); }
    else if ('allday' in b.dataset) { f.allDay = !f.allDay; paintSheet(); }
    else if (b.dataset.rem) { f.reminder = b.dataset.rem; paintSheet(); }
    else if ('save' in b.dataset) save();
    else if ('mic' in b.dataset) toggleMic();
  });
  el.addEventListener('input', e => {
    const k = e.target.dataset.key; if (!k) return;
    f[k] = e.target.value;
    if (k === 'title') el.querySelector('[data-save]').disabled = !f.title.trim();
  });
  el.addEventListener('change', e => { if (['due', 'date'].includes(e.target.dataset.key)) paintSheet(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.key === 'title') { e.preventDefault(); save(); } });

  function toggleMic() {
    if (f.listening) { stop?.(); return; }
    f.listening = true; f.heard = ''; paintSheet();
    stop = listen({
      onPartial: txt => { f.heard = txt; const h = el.querySelector('.heard'); if (h) h.textContent = txt; },
      onFinal: txt => {
        const p = parseHebrew(txt);
        f.kind = p.kind; f.title = p.title;
        if (p.kind === 'task') f.due = p.date || '';
        else { f.date = p.date || ymd(new Date()); f.start = p.time || f.start; f.allDay = false; }
        f.heard = `״${txt}״`;
      },
      onError: err => { f.heard = err === 'not-allowed' ? 'צריך לאשר גישה למיקרופון.' : 'לא הצלחתי לשמוע. נסה שוב.'; },
      onEnd: () => { f.listening = false; paintSheet(); },
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

      <div class="field-label">${icon('bell')}זמני תזכורת לבחירה</div>
      <p class="sub" style="margin:-2px 0 10px">אלה הזמנים שיופיעו ככפתורים באירועים. ״ברירת מחדל״ היא מה שהוגדר ליומן עצמו בגוגל.</p>
      <div class="seg">${REMINDER_PRESETS.map(m => `<button type="button" data-remopt="${m}" aria-pressed="${s.reminderOptions.includes(m)}">${remShort(m)}</button>`).join('')}</div>

      <div class="field-label">${icon('mail')}מיילים לטיפול</div>
      <div class="set-row"><div class="grow"><b>להציג מיילים ב״מה איתי היום״</b><small>הכרטיסים מאפשרים לארכב או להפוך מייל למשימה</small></div>
        <button class="switch" role="switch" aria-checked="${s.gmailEnabled}" data-toggle-set="gmailEnabled" aria-label="מיילים"></button></div>
      ${s.gmailEnabled ? `<div class="set-row"><div class="grow"><small>אילו מיילים (חיפוש Gmail)</small>
        <input class="inp" data-key="gmailQuery" value="${esc(s.gmailQuery)}" dir="ltr" style="margin-top:6px;font-size:14px"></div></div>
        <div class="set-row"><div class="grow"><b>לכלול מיילים באשף הבוקר</b></div>
        <button class="switch" role="switch" aria-checked="${s.wizardEmails}" data-toggle-set="wizardEmails" aria-label="מיילים באשף"></button></div>` : ''}

      <div class="field-label">${icon('newspaper')}דיג׳סט עיצוב</div>
      <div class="set-row"><div class="grow"><b>להציג גיליון חדש של הדיג׳סט</b><small>כרטיס במסך הראשי ובאשף, בכל פעם שיוצא גיליון</small></div>
        <button class="switch" role="switch" aria-checked="${s.digestEnabled}" data-toggle-set="digestEnabled" aria-label="דיג׳סט"></button></div>

      ${state.lists.length > 1 ? `<div class="field-label">${icon('list')}רשימת ברירת מחדל למשימות חדשות</div>
        <select class="inp" data-key="defaultList">${state.lists.map(l => `<option value="${l.id}" ${l.id === (s.defaultList || state.lists[0].id) ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : ''}

      <div class="field-label">${icon('bellRing')}התראות בוקר וערב</div>
      ${pushPanel()}

      <p class="small-print">גוגל משימות שומרות תאריך בלי שעה, ולכן אין דחייה ״להמשך היום״. דבר שצריך לקרות בשעה מסוימת עדיף להוסיף כאירוע ביומן, עם תזכורת.<br>${state.lastSync ? `סונכרן לאחרונה ב־${hm(state.lastSync)}.` : ''}</p>`;
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
    else if (b.dataset.remopt) {
      const m = Number(b.dataset.remopt);
      const list = s.reminderOptions.includes(m) ? s.reminderOptions.filter(x => x !== m) : [...s.reminderOptions, m].sort((a, c) => a - c);
      saveSettings({ reminderOptions: list });
    }
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

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d4b57' : '#3cc4dc');
}
