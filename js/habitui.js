// Habits UI: the day's switches, the dashboard, the editor and the emoji picker.
import { icon } from './icons.js';
import { state } from './data.js';
import {
  H, groupEmoji, setGroupEmoji, PERIODS, DURS, SHOW_TYPES, EVERY, normShow, habitById, members, valueOn, status, statusText, freqText, showText, shownOn, habitsOn, rankedHabits,
  toggleHabit, bump, togglePin, isPinned, saveHabit, deleteHabit, nextEmojiEvent, reconnectForHabits, rankedRows, memberCount, lastDone, setValue, modeOf,
} from './habits.js';
import { suggestEmojis } from './emoji.js';
import { statsSection } from './habitstats.js';
import { BUTTONS } from './notify.js';
import { burst, queueFx } from './fx.js';
import { openSheet, paintSheet, closeSheet, openMenu } from './overlay.js';
import { openTimePicker } from './timepicker.js';
import { openDatePicker } from './datepicker.js';
import { esc, ymd, fromYmd, startOfDay, haptic, shortDate, daysBetween, MONTHS } from './util.js';

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// ---------- the day's switches (main screen, under "היום שלי") ----------
// small progress tag on a switch: "1/3" for n-times goals, "עוד 5 ימים" for once-every-X ones
function chipMeta(h, d) {
  if (!h.times || !h.period) return '';
  const st = status(h, d);
  if (st.mode === 'quota') return `<span class="hc-meta ${LEVEL[st.level] === 'bad' ? 'bad' : st.level === 'done' ? 'good' : ''}">${st.count}/${st.times}</span>`;
  if (st.never || valueOn(h, d) > 0) return ''; // done that day: the countdown to the next time isn't news
  const u = st.until;
  const txt = u < 0 ? `באיחור ${-u === 1 ? 'יום' : `${-u} ימים`}` : u === 0 ? 'היעד היום' : `עוד ${u === 1 ? 'יום' : u === 2 ? 'יומיים' : `${u} ימים`} ליעד`;
  return `<span class="hc-meta ${LEVEL[st.level] || ''}">${txt}</span>`;
}
// a tile in the day's habit row: emoji, name, status and the control, top to bottom
export function chip(h, d) {
  const v = valueOn(h, d), day = ymd(d);
  if (h.kind === 'count') {
    return `<div class="hchip count ${h.sign === 'neg' ? 'neg' : ''} ${v ? 'on' : ''}" role="group" aria-label="${esc(h.name)}: ${v}">
      <span class="hc-emo">${h.emoji}</span><span class="hc-name">${esc(h.name)}</span>
      <span class="hc-lab"><b>${v}${h.times && h.period === 'day' ? `<small>/${h.times}</small>` : ''}</b></span>
      <span class="hc-ctl"><button data-hbump="${h.id}" data-delta="1" data-hday="${day}" aria-label="עוד אחד">${icon('plus')}</button><button data-hbump="${h.id}" data-delta="-1" data-hday="${day}" aria-label="פחות" ${v ? '' : 'disabled'}>${icon('minus')}</button></span>
    </div>`;
  }
  const goal = h.times > 1 && status(h, d).level === 'done';
  return `<button class="hchip ${v ? 'on' : ''} ${goal ? 'goal' : ''}" role="switch" aria-checked="${!!v}" data-htoggle="${h.id}" data-hday="${day}" aria-label="${esc(h.name)}">
    <span class="hc-emo">${h.emoji}</span><span class="hc-name">${esc(h.name)}</span>${chipMeta(h, d) || '<span class="hc-meta empty"></span>'}<span class="hc-knob" aria-hidden="true">${icon('check')}</span></button>`;
}
export function dayHabits(d) {
  const list = habitsOn(d);
  const more = H.list.length > list.length;
  return `<div class="zone-h hz">${icon('sprout')}הרגלים
      <span class="hz-act">${more ? `<button class="hround" data-hmore data-hday="${ymd(d)}" aria-label="הרגל נוסף להיום">${icon('dots')}</button>` : ''}<button class="hround" data-hadd aria-label="הרגל חדש">${icon('plus')}</button></span></div>
    <div class="habit-row ${list.length > 6 ? 'many' : ''}" aria-label="הרגלים"><div class="hr-tiles">${list.map(h => chip(h, d)).join('')}</div></div>`;
}
// the habits that aren't on this day: picking one adds its switch for that day
function openMoreMenu(anchor, d) {
  const shown = new Set(habitsOn(d).map(h => h.id));
  const rest = H.list.filter(h => !shown.has(h.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  openMenu(anchor, rest.map(h => ({ label: `${h.emoji}  ${h.name}`, hint: freqText(h), onClick: () => { togglePin(h.id, d); haptic(8); afterChange?.(); } })));
}
export function habitCounts(d = new Date()) {
  const list = habitsOn(d);
  return { total: list.length, done: list.filter(h => valueOn(h, d) > 0).length };
}

// ---------- status visuals ----------
const LEVEL = { ok: '', done: 'good', soon: 'warn', risk: 'warn', over: 'bad', missed: 'bad' };
function dots(h, st) {
  if (st.mode === 'tally') {
    const vals = []; for (let i = 6; i >= 0; i--) vals.push(valueOn(h, new Date(Date.now() - i * 864e5)));
    const max = Math.max(1, ...vals);
    return `<div class="hbars" aria-hidden="true">${vals.map(v => `<i style="--v:${v / max}"></i>`).join('')}</div>`;
  }
  if (st.mode === 'interval') {
    if (st.never) return '';
    const pct = Math.max(0, Math.min(1, st.since / Math.max(1, st.since + st.until)));
    return `<div class="hbar ${LEVEL[st.level]}" aria-hidden="true"><i style="--p:${pct}"></i></div>`;
  }
  // quota: past periods as dots, the current one as a filling segment
  return `<div class="hdots" aria-hidden="true">${st.history.map(ok => `<i class="${ok ? 'ok' : ''}"></i>`).join('')}<i class="cur" style="--p:${Math.min(1, st.count / st.times)}"></i></div>`;
}
function control(h, d) {
  const v = valueOn(h, d);
  if (h.kind === 'count') return `<div class="hcount"><button data-hbump="${h.id}" data-delta="-1" data-hday="${ymd(d)}" ${v ? '' : 'disabled'} aria-label="פחות">${icon('minus')}</button><b>${v}</b><button data-hbump="${h.id}" data-delta="1" data-hday="${ymd(d)}" aria-label="עוד">${icon('plus')}</button></div>`;
  return `<button class="switch" role="switch" aria-checked="${!!v}" data-htoggle="${h.id}" data-hday="${ymd(d)}" aria-label="בוצע היום: ${esc(h.name)}"></button>`;
}
function extraLine(h, st) {
  if (h.show?.emoji) {
    const n = nextEmojiEvent(h);
    return n ? `${h.emoji} ביומן ${daysBetween(new Date(), n.start) === 0 ? 'היום' : `ב־${shortDate(n.start)}`}` : `אין אירוע עם ${h.emoji} ביומן`;
  }
  return '';
}

// one row in the big list (dashboard + wizard). `wizard` adds the pin-to-today and reminder buttons.
export function habitRow(h, { wizard = false, member = false } = {}) {
  const today = startOfDay(new Date());
  const st = status(h, today);
  const extra = extraLine(h, st);
  if (member) {
    const n = memberCount(h, today), next = h.show?.emoji ? nextEmojiEvent(h) : null;
    const line = [n ? `${n} ${PERIODS[h.period].label.replace('ב', 'ה')}` : '', next ? `${h.emoji} ביומן ${daysBetween(today, next.start) === 0 ? 'היום' : `ב־${shortDate(next.start)}`}` : ''].filter(Boolean).join(' · ');
    return `
    <div class="hrow member" data-hedit="${h.id}">
      <span class="hemo">${h.emoji}</span>
      <div class="hmain"><div class="htitle">${esc(h.name)}</div>${line ? `<div class="hstat">${line}</div>` : ''}</div>
      ${wizard ? `<div class="hside"><button class="hmini ${isPinned(h, today) || shownOn(h, today) ? 'on' : ''}" data-hpin="${h.id}" ${shownOn(h, today) && !isPinned(h, today) ? 'disabled' : ''} aria-label="להציג היום במסך הראשי">${icon('pushpin')}</button></div>` : ''}
      ${control(h, today)}
    </div>`;
  }
  const pinned = isPinned(h, today), shown = shownOn(h, today);
  return `
    <div class="hrow lvl-${LEVEL[st.level] || 'none'}" data-hedit="${h.id}">
      <span class="hemo">${h.emoji}</span>
      <div class="hmain">
        <div class="htitle">${esc(h.name)}<small>${freqText(h)}</small></div>
        <div class="hstat">${statusText(h, today)}${extra ? ` · ${extra}` : ''}</div>
        ${dots(h, st)}
      </div>
      ${wizard ? `<div class="hside">
        <button class="hmini ${pinned || shown ? 'on' : ''}" data-hpin="${h.id}" ${shown && !pinned ? 'disabled' : ''} aria-label="${shown && !pinned ? 'כבר במסך הראשי היום' : pinned ? 'להוריד מהמסך הראשי' : 'להציג היום במסך הראשי'}">${icon('pushpin')}</button>
        <button class="hmini ${h.remind ? 'on' : ''}" data-hremind="${h.id}" aria-label="תזכורת${h.remind ? ` ב־${h.remind}` : ''}">${icon('bell')}${h.remind ? `<small>${h.remind}</small>` : ''}</button>
      </div>` : ''}
      ${control(h, today)}
    </div>`;
}
// groups (habits sharing one goal) render once, as a card with their members
const SECTION = ['להיום', 'מתקרב', 'באיחור', 'שאר ההרגלים'];
export function habitList({ wizard = false } = {}) {
  const seen = new Set(), out = [];
  let lastG = -1;
  for (const { h, g } of rankedRows()) {
    if (h.group && seen.has(h.group)) continue;
    if (g !== lastG) { out.push(`<div class="hsec">${SECTION[g]}</div>`); lastG = g; }
    if (h.group) {
      seen.add(h.group);
      const ms = members(h), st = status(h);
      out.push(`
        <div class="hgroup lvl-${LEVEL[st.level] || 'none'}">
          <div class="hg-head"><button class="hemo hg-emo" data-hgemo="${esc(h.group)}" aria-label="אימוג׳י לקבוצה">${groupEmoji(h.group)}</button>
            <div class="hmain"><div class="htitle">${esc(h.group)}<small>${freqText(h)}, לפחות</small></div><div class="hstat">${statusText(h)}</div>${dots(h, st)}</div></div>
          ${ms.map(m => habitRow(m, { wizard, member: true })).join('')}
        </div>`);
    } else out.push(habitRow(h, { wizard }));
  }
  return out.join('');
}

function syncNote() {
  const s = H.sync;
  if (s === 'needs-consent') return `<div class="banner"><div><b>חיבור לגוגל שיטס</b>ההרגלים נשמרים בגיליון בדרייב שלך. צריך לאשר לאפליקציה גישה לקובץ שהיא יוצרת (רק אליו).</div><button class="btn primary sm" data-hconnect>אישור</button></div>`;
  if (s === 'needs-api') return `<div class="banner err"><div><b>צריך להפעיל שני ממשקים בגוגל קלאוד</b>Google Sheets API ו־Google Drive API, באותו פרויקט של האפליקציה. עד אז ההרגלים נשמרים רק במכשיר.
    <div class="banner-links"><a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener">Sheets API ↗</a><a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Drive API ↗</a></div></div></div>`;
  if (s === 'error') return `<div class="banner err"><div><b>הגיליון לא התעדכן</b>${esc(H.syncError || '')}</div></div>`;
  if (s === 'local' && state.mode !== 'live') return '<p class="small-print">מצב הדגמה: ההרגלים נשמרים רק במכשיר הזה.</p>';
  return '';
}

// ---------- dashboard (replaces the list under the header) ----------
export function habitsDashboard() {
  const today = startOfDay(new Date()), c = habitCounts(today);
  return `
    <section class="sec habits-dash" aria-labelledby="h-habits">
      <div class="sec-h"><h2 id="h-habits">הרגלים</h2><span class="count">${c.done}/${c.total} היום</span>
        <button class="icon-btn" data-hadd aria-label="הרגל חדש">${icon('plus')}</button></div>
      ${syncNote()}
      <div class="hlist">${habitList()}</div>
      ${H.sheet?.webViewLink ? `<a class="hsheet" href="${esc(H.sheet.webViewLink)}" target="_blank" rel="noopener">${icon('external')}הגיליון בגוגל שיטס</a>` : ''}
    </section>
    ${statsSection()}`;
}

// ---------- editor ----------
// ---------- the notification part of the habit editor ----------
const WHEN = [[0, 'בבוקר של היום'], [-1, 'בבוקר יום לפני'], [-7, 'בבוקר שבוע לפני']];
function notifyEditor(f, s) {
  const n = f.notify || (f.notify = { when: [], b1: 'done', b2: 'later' });
  const on = d => (n.when || []).includes(d);
  const opt = (k, cur, list) => list.map(x => `<option value="${x}" ${cur === x ? 'selected' : ''}>${BUTTONS[x].label}</option>`).join('');
  return `
    <div class="nf-when">
      <div class="rem-row"><span class="nf-lab">בשעה קבועה</span>
        <button class="inp time-btn" data-hed-remind ${s.type === 'none' ? 'disabled' : ''}>${f.remind || 'בחירת שעה'}</button>
        ${f.remind ? `<button class="btn sm" data-hed-noremind>${icon('bellOff')}ללא</button>` : ''}</div>
      <div class="chips nf-chips">${WHEN.map(([d, l]) => `<button type="button" class="chip-btn" data-nf-when="${d}" aria-pressed="${on(d)}">${l}</button>`).join('')}
        <button type="button" class="chip-btn" data-nf-place aria-pressed="${!!n.place}">📍 בהגעה למקום</button></div>
      ${n.place || n.placeOpen ? `<input class="inp ltr-inp" data-key="nf-place" value="${esc(n.place || '')}" placeholder="שם המקום באנגלית, למשל gym" aria-label="שם המקום" style="margin-top:8px">
        <p class="small-print" style="margin-top:4px">MacroDroid מזהה שהגעת ושולח את השם הזה. ההוראות: הגדרות ← התראות בטלפון.</p>` : ''}
      <p class="small-print" style="margin-top:6px">${(n.when || []).length ? `״היום״ של ההרגל: ${s.type === 'none' || s.emoji ? 'יום האירוע ביומן עם האימוג׳י' : s.type === 'until' ? 'יום היעד' : s.type === 'since' ? 'היום שבו הוא מופיע' : 'היום שבו הוא מופיע'}. בבוקר = יחד עם אשף הבוקר.` : 'ההתראה לא תגיע אם כבר סימנת.'}</p>
    </div>
    <div class="nf-btns">
      <label><span>כפתור ראשון</span><select class="inp" data-key="nf-b1">${opt('b1', n.b1 || 'done', ['done', 'shop', 'none'])}</select></label>
      <label><span>כפתור שני</span><select class="inp" data-key="nf-b2">${opt('b2', n.b2 || 'none', ['none', 'later', 'music', 'recipes', 'maccabi', 'walk', 'event', 'link', 'macro'])}</select></label>
    </div>
    ${n.b2 === 'link' ? `<div class="nf-extra"><input class="inp" data-key="nf-urlTitle" value="${esc(n.urlTitle || '')}" placeholder="שם הכפתור, למשל 📒 מתכונים"><input class="inp ltr-inp" data-key="nf-url" value="${esc(n.url || '')}" placeholder="https://…"></div>` : ''}
    ${n.b2 === 'macro' ? `<div class="nf-extra"><input class="inp" data-key="nf-macroTitle" value="${esc(n.macroTitle || '')}" placeholder="שם הכפתור, למשל 🎧 מוזיקה"><input class="inp ltr-inp" data-key="nf-macro" value="${esc(n.macro || '')}" placeholder="מזהה ה־Webhook ב־MacroDroid, למשל md-music"></div>` : ''}
    <div class="field-label">רוצה משהו מיוחד?</div>
    <textarea class="inp" data-key="nf-note" rows="2" placeholder="לתאר במילים מתי ההתראה ומה הכפתורים יעשו. Claude יקרא ויגדיר.">${esc(n.note || '')}</textarea>
    ${n.note && !n.noteDone ? '<p class="small-print" style="margin-top:4px">⏳ ממתין ל־Claude. אפשר לכתוב לו ״יש הרגל חדש עם בקשת התראה״.</p>' : ''}`;
}

const blank = () => ({ id: '', name: '', emoji: '✅', kind: 'toggle', times: 1, period: 'week', group: '', show: { type: 'daily' }, remind: '', remindEv: '', emojiManual: false });

export function openHabitEditor(id = null, { onDone } = {}) {
  const orig = id ? habitById(id) : null;
  const f = orig ? JSON.parse(JSON.stringify(orig)) : blank();
  f.show = normShow(f.show);
  f.emojiManual = !!orig;
  const isNew = !orig;
  const today = startOfDay(new Date());
  openSheet(() => {
    const s = f.show || { type: 'daily' };
    const groups = [...new Set(H.list.map(h => h.group).filter(Boolean))];
    const dayPick = `<div class="dow-pick">${DOW.map((l, i) => `<button type="button" data-dow="${i}" aria-pressed="${(s.days || []).includes(i)}">${l}</button>`).join('')}</div>`;
    const durSel = (keys) => `<select class="inp" data-key="show-n">${keys.map(k => `<option value="${k}" ${s.n === k ? 'selected' : ''}>${DURS[k].label}</option>`).join('')}</select>`;
    return `
      <h3>${isNew ? 'הרגל חדש' : 'עריכת הרגל'}</h3>
      <div class="hed-top">
        <button class="hed-emo" data-emopick aria-label="בחירת אימוג׳י">${f.emoji}</button>
        <input class="inp" data-key="name" value="${esc(f.name)}" placeholder="שם ההרגל" enterkeyhint="done" aria-label="שם ההרגל">
      </div>

      <div class="field-label">סוג</div>
      <div class="seg">
        <button type="button" data-kind="toggle" aria-pressed="${f.kind === 'toggle'}">${icon('check')}סימון (בוצע / לא)</button>
        <button type="button" data-kind="count" aria-pressed="${f.kind === 'count'}">${icon('plus')}ספירה (כמה פעמים ביום)</button>
      </div>

      <div class="field-label">יעד: כמה פעמים, בכמה זמן</div>
      ${f.kind === 'count' ? `<div class="seg" style="margin-bottom:8px"><button type="button" data-sign="pos" aria-pressed="${f.sign !== 'neg'}">👍 ספירה לחיוב</button><button type="button" data-sign="neg" aria-pressed="${f.sign === 'neg'}">👎 ספירה לשלילה</button></div>` : ''}
      ${f.kind === 'count' ? `<div class="seg" style="margin-bottom:8px"><button type="button" data-goal="none" aria-pressed="${!f.times}">בלי יעד, רק לספור</button><button type="button" data-goal="set" aria-pressed="${!!f.times}">עם יעד</button></div>` : ''}
      ${f.times ? `<div class="hed-freq">
        <div class="stepper"><button type="button" data-times="-1" aria-label="פחות">${icon('minus')}</button><b>${f.times}</b><button type="button" data-times="1" aria-label="יותר">${icon('plus')}</button></div>
        <select class="inp" data-key="period">${Object.entries(PERIODS).map(([k, p]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>פעמים ${p.label}</option>`).join('')}</select>
      </div>
      <p class="small-print" style="margin-top:6px">${f.times === 1 && f.period !== 'day' ? `פעם ${PERIODS[f.period].label}: נמדד לפי הזמן שעבר מהפעם האחרונה.` : `נספר בתוך כל ${PERIODS[f.period].unit} בלוח השנה.`}</p>` : ''}

      ${!isNew && (modeOf(f) === 'interval' || ['since', 'until'].includes(s.type)) ? `<div class="field-label">${icon('calendar')}פעם אחרונה</div>
        <div class="rem-row"><button class="inp time-btn date-btn" data-hed-last>${lastDone(f) ? `${shortDate(lastDone(f))} · לפני ${daysBetween(lastDone(f), today)} ימים` : 'עוד לא סומן · לבחירת תאריך'}</button></div>
        <p class="small-print" style="margin-top:6px">אם עשית את זה לפני שהתחלת לעקוב, אפשר לסמן כאן מתי.</p>` : ''}

      <div class="field-label">מתי הכפתור מופיע במסך הראשי</div>
      <select class="inp" data-key="show-type">${Object.entries(SHOW_TYPES).filter(([k]) => k !== 'none' || s.emoji || s.type === 'none').concat(s.type === 'monthday' ? [['monthday', `ב־${s.day} לכל חודש`]] : []).map(([k, l]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${s.type === 'fixed' ? `${dayPick}
        <select class="inp" data-key="show-every" style="margin-top:8px" aria-label="תדירות">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${(s.every || 'week') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        ${s.every === '2weeks' ? `<div class="seg" style="margin-top:8px"><button type="button" data-anchor="this" aria-pressed="${!s.anchor || isThisWeek(s.anchor)}">מהשבוע הזה</button><button type="button" data-anchor="next" aria-pressed="${!!s.anchor && !isThisWeek(s.anchor)}">מהשבוע הבא</button></div>` : ''}
        ${EVERY[s.every]?.m ? `${EVERY[s.every].m > 1 ? `<div class="row-lab">החל מ־<select class="inp" data-key="show-anchor">${Array.from({ length: EVERY[s.every].m }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() + i, 1); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return `<option value="${v}" ${s.anchor === v ? 'selected' : ''}>${MONTHS[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}</option>`; }).join('')}</select></div>` : ''}
          <p class="small-print" style="margin-top:6px">ב${(s.days || []).map(d => `יום ${DOW[d]}`).join(' / ')} הראשון של החודש.</p>` : ''}` : ''}
      ${s.type === 'monthday' ? `<input class="inp" type="number" min="1" max="31" inputmode="numeric" data-key="show-day" value="${s.day || 1}" aria-label="יום בחודש" style="margin-top:8px">` : ''}
      ${s.type === 'since' ? `<div class="row-lab">כשעברו ${durSel(['2d', '1w', '2w', '1m', '2m', '3m', '6m', '1y'])} מהפעם האחרונה</div>` : ''}
      ${s.type === 'until' ? `<div class="row-lab">${durSel(['0d', '1d', '2d', '1w', '2w', '1m'])} לפני היעד, ונשאר עד שמסמנים</div>` : ''}
      ${s.type === 'none' ? '<p class="small-print" style="margin-top:6px">רק בימים עם האימוג׳י ביומן, או כשבוחרים אותו באשף (📌).</p>' : ''}
      <div class="set-row" style="margin-top:10px"><div class="grow"><b>גם ביום שיש ביומן אירוע עם ${f.emoji}</b><small>כל אירוע שהכותרת שלו כוללת את האימוג׳י</small></div>
        <button type="button" class="switch" role="switch" aria-checked="${!!s.emoji}" data-hed-emoji aria-label="גם ביום עם האימוג׳י ביומן"></button></div>

      <div class="field-label">קבוצה (לא חובה)</div>
      <input class="inp" data-key="group" value="${esc(f.group)}" list="hgroups" placeholder="למשל: פנאי וחברה" aria-label="קבוצה">
      <datalist id="hgroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <p class="small-print" style="margin-top:6px">הרגלים באותה קבוצה נספרים יחד מול יעד אחד.</p>

      <div class="field-label">${icon('bell')}התראות</div>
      ${notifyEditor(f, s)}

      ${!isNew ? `<div class="set-row" style="margin-top:14px"><div class="grow"><b>להציג היום במסך הראשי</b><small>גם אם היום הוא לא היום שלו</small></div>
        <button class="switch" role="switch" aria-checked="${isPinned(f, today)}" data-hed-pin aria-label="להציג היום"></button></div>` : ''}

      <div class="actions">
        <button class="btn primary grow" data-hed-save ${f.name.trim() ? '' : 'disabled'}>${icon('check')}${isNew ? 'הוספה' : 'שמירה'}</button>
        ${!isNew ? `<button class="btn danger" data-hed-del aria-label="מחיקת ההרגל">${icon('trash')}</button>` : ''}
      </div>`;
  });
  const el = document.querySelector('.sheet');
  el.addEventListener('input', e => {
    const k = e.target.dataset.key;
    if (k === 'name') {
      f.name = e.target.value;
      if (!f.emojiManual) { f.emoji = suggestEmojis(f.name)[0]; el.querySelector('.hed-emo').textContent = f.emoji; }
      el.querySelector('[data-hed-save]').disabled = !f.name.trim();
    }
    if (k === 'group') f.group = e.target.value.trim();
    if (k?.startsWith('nf-')) { const key = k.slice(3); f.notify[key] = e.target.value.trim(); if (key === 'note') f.notify.noteDone = false; }
    if (k === 'show-day') f.show.day = Math.max(1, Math.min(31, Number(e.target.value) || 1));
  });
  // months cycles start this month unless picked; 2-week cycles start this week
  function setAnchor() {
    const m = EVERY[f.show.every]?.m;
    if (m > 1) f.show.anchor = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    else delete f.show.anchor;
  }
  el.addEventListener('change', e => {
    const k = e.target.dataset.key;
    if (k === 'period') { f.period = e.target.value; paintSheet(); }
    if (k === 'nf-b1' || k === 'nf-b2') { f.notify[k.slice(3)] = e.target.value; paintSheet(); }
    if (k === 'show-type') {
      const t = e.target.value;
      f.show = { type: t, ...(f.show.emoji || t === 'none' ? { emoji: true } : {}) };
      if (t === 'fixed') { f.show.days = [today.getDay()]; f.show.every = EVERY[f.period] ? f.period : 'week'; setAnchor(); }
      if (t === 'monthday') f.show.day = today.getDate();
      if (t === 'since') f.show.n = { day: '1w', week: '1w', '2weeks': '2w', month: '1m', '2months': '2m', '3months': '3m', '6months': '6m', year: '1y' }[f.period] || '1w';
      if (t === 'until') f.show.n = '1w';
      paintSheet();
    }
    if (k === 'show-n') f.show.n = e.target.value;
    if (k === 'show-every') { f.show.every = e.target.value; delete f.show.anchor; setAnchor(); paintSheet(); }
    if (k === 'show-anchor') f.show.anchor = e.target.value;
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if ('emopick' in b.dataset) { openEmojiPopup(b, f.name, f.emoji, em => { f.emoji = em; f.emojiManual = true; paintSheet(); }); return; }
    if (b.dataset.kind) { f.kind = b.dataset.kind; if (f.kind === 'count' && !orig) { f.times = null; f.period = null; } if (f.kind === 'toggle' && !f.times) { f.times = 1; f.period = 'week'; } paintSheet(); return; }
    if (b.dataset.sign) { if (b.dataset.sign === 'neg') f.sign = 'neg'; else delete f.sign; paintSheet(); return; }
    if (b.dataset.goal) { if (b.dataset.goal === 'none') { f.times = null; f.period = null; } else { f.times = 1; f.period = 'day'; } paintSheet(); return; }
    if (b.dataset.times) { f.times = Math.max(1, Math.min(99, (f.times || 1) + Number(b.dataset.times))); paintSheet(); return; }
    if (b.dataset.dow != null) {
      const d = Number(b.dataset.dow), days = new Set(f.show.days || []);
      days.has(d) ? days.delete(d) : days.add(d);
      f.show.days = [...days].sort(); if (!f.show.days.length) f.show.days = [d];
      paintSheet(); return;
    }
    if ('hedEmoji' in b.dataset) {
      f.show.emoji = !f.show.emoji;
      if (!f.show.emoji) { delete f.show.emoji; if (f.show.type === 'none') f.show = { type: 'daily' }; }
      paintSheet(); return;
    }
    if (b.dataset.nfWhen != null) {
      const d = Number(b.dataset.nfWhen), w = new Set(f.notify.when || []);
      w.has(d) ? w.delete(d) : w.add(d); f.notify.when = [...w].sort((a, b2) => a - b2); paintSheet(); return;
    }
    if ('nfPlace' in b.dataset) { if (f.notify.place || f.notify.placeOpen) { f.notify.place = ''; f.notify.placeOpen = false; } else f.notify.placeOpen = true; paintSheet(); return; }
    if (b.dataset.anchor) { const w = addDaysLocal(today, -today.getDay()); f.show.anchor = ymd(b.dataset.anchor === 'this' ? w : addDaysLocal(w, 7)); paintSheet(); return; }
    if ('hedRemind' in b.dataset) { openTimePicker({ value: f.remind, title: `תזכורת ל${f.name || 'הרגל'}`, onSave: v => { f.remind = v; paintSheet(); }, onClear: f.remind ? () => { f.remind = ''; paintSheet(); } : null }); return; }
    if ('hedNoremind' in b.dataset) { f.remind = ''; paintSheet(); return; }
    if ('hedLast' in b.dataset) {
      const l = lastDone(f);
      openDatePicker({ value: l ? ymd(l) : '', title: `${f.name}: פעם אחרונה`, onPick: d => { if (fromYmd(d) <= today) setValue(f.id, fromYmd(d), 1); paintSheet(); } });
      return;
    }
    if ('hedPin' in b.dataset) { togglePin(f.id, today); paintSheet(); return; }
    if ('hedDel' in b.dataset) { closeSheet(); deleteHabit(f.id); onDone?.(); return; }
    if ('hedSave' in b.dataset) {
      if (!f.name.trim()) return;
      const { emojiManual, ...h } = f;
      h.name = h.name.trim();
      if (h.notify) { const { placeOpen, ...nf } = h.notify; if (!nf.place) delete nf.place; h.notify = nf; }
      saveHabit(h);
      closeSheet(); onDone?.();
    }
  });
}
const isThisWeek = a => { const t = startOfDay(new Date()); return ymd(addDaysLocal(t, -t.getDay())) === a; };
const addDaysLocal = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ---------- emoji picker: like WhatsApp's reaction bar ----------
export function openEmojiPopup(anchor, name, current, onPick) {
  document.querySelector('.emo-pop')?.remove();
  const opts = [current, ...suggestEmojis(name, 6).filter(e => e !== current)].slice(0, 3);
  const pop = document.createElement('div');
  pop.className = 'emo-pop';
  pop.innerHTML = `${opts.map((e, i) => `<button data-emo="${e}" class="${i === 0 ? 'on' : ''}" aria-label="${e}">${e}</button>`).join('')}
    <button class="emo-more" data-emo-kb aria-label="עוד אימוג׳ים מהמקלדת">${icon('smile')}${icon('plus')}</button>
    <input class="emo-input" aria-label="הקלדת אימוג׳י" enterkeyhint="done" autocomplete="off">`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.max(8, r.top - 66)}px`;
  pop.style.insetInlineStart = `${Math.max(8, innerWidth - r.right - 4)}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
  const close = () => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 200); removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!pop.contains(e.target)) close(); };
  setTimeout(() => addEventListener('pointerdown', outside, true), 0);
  pop.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.emo) { haptic(6); onPick(b.dataset.emo); close(); return; }
    if ('emoKb' in b.dataset) { pop.classList.add('typing'); const i = pop.querySelector('.emo-input'); i.focus(); }
  });
  pop.querySelector('.emo-input').addEventListener('input', e => {
    const seg = [...new Intl.Segmenter('he', { granularity: 'grapheme' }).segment(e.target.value)].map(x => x.segment).filter(x => /\p{Extended_Pictographic}/u.test(x));
    if (seg.length) { onPick(seg[seg.length - 1]); close(); }
  });
}

// ---------- clicks anywhere (main screen, dashboard, wizard) ----------
let afterChange = null;
export const onHabitChange = fn => { afterChange = fn; };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-hgemo],[data-htoggle],[data-hbump],[data-hpin],[data-hremind],[data-hedit],[data-hadd],[data-hconnect],[data-hmore]');
  if (!t || t.closest('.sheet')) return;
  if (t.dataset.hgemo) { const g = t.dataset.hgemo; openEmojiPopup(t, g, groupEmoji(g), em => { setGroupEmoji(g, em); afterChange?.(); }); return; }
  if (t.dataset.htoggle) {
    const id = t.dataset.htoggle, d = t.dataset.hday ? fromYmd(t.dataset.hday) : new Date(), h = habitById(id);
    const turningOn = !valueOn(h, d);
    const before = status(h, d).level;
    toggleHabit(id, d);
    const goalNow = turningOn && h.times > 1 && before !== 'done' && status(h, d).level === 'done';
    const sel = `[data-htoggle="${id}"][data-hday="${ymd(d)}"]`;
    if (turningOn) {
      const r = t.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, { emoji: h.emoji, big: goalNow });
      haptic(goalNow ? [12, 40, 20] : 14);
      queueFx({ type: 'on', sel }); if (goalNow) queueFx({ type: 'goal', sel });
    } else { haptic(6); queueFx({ type: 'off', sel }); }
    afterChange?.(); return;
  }
  if (t.dataset.hbump) {
    const id = t.dataset.hbump, delta = Number(t.dataset.delta), d = t.dataset.hday ? fromYmd(t.dataset.hday) : new Date();
    bump(id, d, delta);
    const neg = habitById(id).sign === 'neg';
    if (delta > 0) { const r = t.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, { emoji: habitById(id).emoji, dark: neg }); haptic(neg ? [30, 60, 30] : 10); }
    queueFx({ type: delta > 0 ? (neg ? 'cursed' : 'on') : 'off', sel: `.hchip.count:has([data-hbump="${id}"])` });
    afterChange?.(); return;
  }
  if (t.dataset.hpin) { togglePin(t.dataset.hpin, startOfDay(new Date())); afterChange?.(); return; }
  if (t.dataset.hremind) {
    const h = habitById(t.dataset.hremind);
    openTimePicker({ value: h.remind, title: `תזכורת ל${h.name}`,
      onSave: v => { saveHabit({ ...h, remind: v }); afterChange?.(); },
      onClear: h.remind ? () => { saveHabit({ ...h, remind: '' }); afterChange?.(); } : null });
    return;
  }
  if ('hmore' in t.dataset) { openMoreMenu(t, t.dataset.hday ? fromYmd(t.dataset.hday) : new Date()); return; }
  if ('hadd' in t.dataset) { openHabitEditor(null, { onDone: afterChange }); return; }
  if ('hconnect' in t.dataset) { reconnectForHabits(); return; }
  if (t.dataset.hedit && !e.target.closest('button')) openHabitEditor(t.dataset.hedit, { onDone: afterChange });
});
