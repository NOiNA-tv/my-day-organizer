// The wizard: a full-screen, swipeable card deck that walks through the day.
// morning → upcoming events, today's tasks, emails, digest
// evening → leftover tasks, then tomorrow's events
// mail    → emails only
import { icon } from './icons.js';
import {
  state, eventsOn, taskGroups, calById, calColor, toggleTask, deferTask, updateTask, archiveEmail, unarchiveEmail,
  emailToTask, dropTask, allTaskRoots, setReminder, deleteEvent, trashEmail, userLabels,
} from './data.js';
import { esc, hm, countdown, greeting, dayName, longDate, addDays, ymd, fromYmd, daysBetween, daysLeftLabel, startOfDay, haptic, reducedMotion, relDayLabel } from './util.js';
import { wmo } from './extras.js';
import { openDeferSheet, openTask, navLinks, linkify, reminderChips } from './sheets.js';
import { openSheet, closeSheet, paintSheet } from './overlay.js';

let W = null; // live wizard instance

// What each swipe direction does, per card type. `buttons` overrides the bottom button row.
const NEXT = ['next', 'הבא', 'arrowR'];
const ACTIONS = {
  event: { left: ['next', 'הבא', 'arrowL'], right: NEXT, up: ['next', 'הבא', 'arrowUp'], buttons: { up: NEXT } },
  preview: { left: ['next', 'הבא', 'arrowL'], right: NEXT, up: ['next', 'הבא', 'arrowUp'], buttons: { up: NEXT } },
  task: { left: ['defer', 'לדחות', 'snooze'], up: ['done', 'בוצע', 'check'], right: ['keep', 'נשאר להיום', 'arrowR'] },
  email: { left: ['archive', 'ארכיון', 'archive'], up: ['totask', 'למשימה', 'list'], right: ['next', 'דלג', 'arrowR'] },
  digest: { left: ['next', 'אחר כך', 'arrowL'], up: ['open', 'לקרוא', 'newspaper'], right: ['next', 'אחר כך', 'arrowR'] },
};
// Full-card colour + label shown while dragging
const TINT = {
  next: ['#1fb5cf', 'הבא', 'arrowR'], keep: ['#1fb5cf', 'נשאר להיום', 'arrowR'], done: ['#22a774', 'בוצע', 'check'],
  defer: ['#f0960f', 'לדחות', 'snooze'], archive: ['#6f838c', 'ארכיון', 'archive'], totask: ['#8b6cf0', 'משימה חדשה', 'list'],
  open: ['#9a5cf0', 'לקרוא', 'newspaper'], delete: ['#e5484d', 'נמחק', 'trash'],
};

function buildDeck(mode, extras) {
  const now = new Date();
  const deck = [];
  if (mode === 'morning') {
    eventsOn(now).filter(e => !e.allDay && e.end > now).sort((a, b) => a.start - b.start).forEach(e => deck.push({ type: 'event', id: e.id }));
    taskGroups(startOfDay(now)).dueNow.forEach(t => deck.push({ type: 'task', id: t.id }));
    if (state.settings.gmailEnabled && state.settings.wizardEmails) state.emails.forEach(e => deck.push({ type: 'email', id: e.id }));
    if (state.settings.digestEnabled && extras.digest && !extras.digest.seen) deck.push({ type: 'digest', id: extras.digest.id });
  } else if (mode === 'evening') {
    taskGroups(startOfDay(now)).dueNow.forEach(t => deck.push({ type: 'task', id: t.id }));
    eventsOn(addDays(now, 1)).filter(e => !e.allDay).forEach(e => deck.push({ type: 'preview', id: e.id }));
  } else if (mode === 'mail') {
    state.emails.forEach(e => deck.push({ type: 'email', id: e.id }));
  }
  return deck;
}

// ---------- open / close: the button grows into the screen ----------
function revealGeometry(origin) {
  const r = origin?.getBoundingClientRect();
  const cx = r ? r.left + r.width / 2 : innerWidth / 2;
  const cy = r ? r.top + r.height / 2 : innerHeight - 60;
  const r0 = r ? Math.min(r.width, r.height) / 2 : 28;
  const R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 8;
  const from = origin ? getComputedStyle(origin).backgroundColor : null;
  return { cx, cy, r0, R, from };
}

export function openWizard(mode, origin, extras = {}) {
  if (W) return;
  const el = document.createElement('div');
  el.className = 'wizard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', mode === 'evening' ? 'סיכום ערב' : 'אשף היום');
  document.body.append(el);
  W = { el, mode, extras, origin, deck: buildDeck(mode, extras), i: 0, phase: mode === 'mail' ? 'cards' : 'welcome', history: [], stats: {} };
  document.documentElement.classList.add('wiz-open');
  paint();
  el.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  history.pushState({ wizard: true }, '');
  addEventListener('popstate', onPop);
  if (reducedMotion()) { el.classList.add('settled'); return; }
  const g = revealGeometry(origin);
  const to = getComputedStyle(el).backgroundColor;
  origin?.classList.add('launching');
  const a = el.animate([
    { clipPath: `circle(${g.r0}px at ${g.cx}px ${g.cy}px)`, backgroundColor: g.from || to },
    { clipPath: `circle(${g.r0 * 3}px at ${g.cx}px ${g.cy}px)`, backgroundColor: g.from || to, offset: .18 },
    { clipPath: `circle(${g.R}px at ${g.cx}px ${g.cy}px)`, backgroundColor: to },
  ], { duration: 720, easing: 'cubic-bezier(.45, 0, .15, 1)' });
  a.finished.then(() => { el.classList.add('settled'); origin?.classList.remove('launching'); }).catch(() => {});
}

function onPop() { if (W && !document.querySelector('.sheet')) closeWizard(true); }

export function closeWizard(fromPop = false) {
  if (!W) return;
  const { el, origin } = W;
  W = null;
  removeEventListener('keydown', onKey);
  removeEventListener('popstate', onPop);
  if (!fromPop && history.state?.wizard) history.back();
  const done = () => { el.remove(); document.documentElement.classList.remove('wiz-open'); };
  if (reducedMotion()) return done();
  el.classList.remove('settled');
  const g = revealGeometry(origin && origin.isConnected ? origin : document.querySelector('.fab'));
  const from = getComputedStyle(el).backgroundColor;
  const a = el.animate([
    { clipPath: `circle(${g.R}px at ${g.cx}px ${g.cy}px)`, backgroundColor: from },
    { clipPath: `circle(${g.r0}px at ${g.cx}px ${g.cy}px)`, backgroundColor: g.from || from },
  ], { duration: 480, easing: 'cubic-bezier(.55, 0, .7, .2)', fill: 'forwards' });
  a.finished.then(done).catch(done);
  setTimeout(done, 700); // safety net
}

// ---------- painting ----------
function paint() {
  const { el, phase } = W;
  if (phase === 'welcome') el.innerHTML = welcome();
  else if (phase === 'cards') { el.innerHTML = cardsShell(); paintDeck(); }
  else el.innerHTML = finish();
  if (phase !== 'welcome') el.classList.add('settled');
  if (phase === 'finish' && !reducedMotion()) confetti(el.querySelector('canvas'));
}

function topbar(extra = '') {
  return `<div class="wz-top">
    <button class="wz-ic" data-w="close" aria-label="סגירה">${icon('x')}</button>
    ${extra}
  </div>`;
}

function welcome() {
  const now = new Date();
  const w = W.extras.weather;
  const wx = w ? wmo(w.code, w.isDay) : null;
  const evening = W.mode === 'evening';
  const count = t => W.deck.filter(d => d.type === t).length;
  const nEv = count('event'), nTask = count('task'), nMail = count('email'), nPrev = count('preview');
  const lines = evening
    ? [['🗂️', nTask ? `${nTask} משימות שנשארו פתוחות` : 'כל המשימות של היום סגורות'], ['📅', nPrev ? `${nPrev} אירועים מחכים מחר` : 'מחר היומן פנוי']]
    : [['📅', nEv ? `${nEv} אירועים עוד לפניך` : 'אין עוד אירועים היום'], ['✅', nTask ? `${nTask} משימות להיום` : 'אין משימות להיום'], ...(nMail ? [['✉️', `${nMail} מיילים לטיפול`]] : []),
      ...(W.deck.some(d => d.type === 'digest') ? [['📰', 'גיליון חדש בדיג׳סט']] : [])];
  const tw = evening && w ? w.tomorrow : null;
  return `
    ${topbar()}
    <div class="wz-welcome">
      <p class="wz-kicker wz-in" style="--d:0">${evening ? `יום ${dayName(now)} כמעט נגמר` : `יום ${dayName(now)}, ${longDate(now)}`}</p>
      <h2 class="wz-hello wz-in" style="--d:1">${greeting(now)}</h2>
      ${w ? `<div class="wz-weather wz-in" style="--d:2">
        <span class="wz-wx-ic">${tw ? wmo(tw.code, 1).icon : wx.icon}</span>
        <span class="wz-wx-now">${tw ? `<span class="ltr">${tw.min}°–${tw.max}°</span>` : `${w.now}°`}</span>
        <span class="wz-wx-meta"><b>${tw ? 'מחר' : wx.label}${w.city ? ` · ${esc(w.city)}` : ''}</b>${tw ? wmo(tw.code, 1).label : `<span class="ltr">${w.min}°–${w.max}°</span>`}${(tw ? tw.rain : w.rain) >= 30 ? ` · ☔ ${tw ? tw.rain : w.rain}%` : ''}</span>
      </div>` : ''}
      <ul class="wz-lines">${lines.map(([e, t], i) => `<li class="wz-in" style="--d:${3 + i}"><span>${e}</span>${t}</li>`).join('')}</ul>
      <button class="wz-cta wz-in" style="--d:${4 + lines.length}" data-w="start" ${W.deck.length ? '' : 'data-empty'}>${W.deck.length ? (evening ? 'בוא נסגור את היום' : 'בוא נתחיל') : 'אין מה לסדר, סגירה'}</button>
    </div>`;
}

function cardsShell() {
  return `
    ${topbar(`<div class="wz-progress" role="tablist" aria-label="מעבר בין הפריטים">${W.deck.map((d, k) => `<button role="tab" data-jump="${k}" aria-label="פריט ${k + 1}"><i></i></button>`).join('')}</div>
      <button class="wz-ic" data-w="undo" aria-label="ביטול הפעולה האחרונה" disabled>${icon('undo')}</button>`)}
    <div class="wz-count" aria-live="polite"></div>
    <div class="deck"></div>
    <div class="wz-actions"></div>`;
}

function paintDeck({ animate = true } = {}) {
  const deckEl = W.el.querySelector('.deck');
  const item = W.deck[W.i];
  const next = W.deck[W.i + 1];
  deckEl.innerHTML = (next ? `<article class="card behind" aria-hidden="true"><div class="card-in">${cardBody(next)}</div></article>` : '') +
    (item ? `<article class="card top ${animate ? 'enter' : ''}" data-type="${item.type}"><div class="card-in">${cardBody(item)}${hint(item)}</div><div class="tint" aria-hidden="true"></div></article>` : '');
  const acts = item ? ACTIONS[item.type] : {};
  const b = acts.buttons || acts;
  W.el.querySelector('.wz-actions').innerHTML = [
    b.left ? actBtn('left', b.left) : '<span></span>',
    b.up ? actBtn(acts.buttons ? 'right' : 'up', b.up, true) : '<span></span>',
    b.right ? actBtn('right', b.right) : '<span></span>',
  ].join('');
  W.el.querySelector('.wz-count').textContent = `${Math.min(W.i + 1, W.deck.length)} מתוך ${W.deck.length}`;
  W.el.querySelectorAll('.wz-progress button').forEach((bt, k) => { bt.className = k < W.i ? 'past' : k === W.i ? 'cur' : ''; bt.setAttribute('aria-selected', k === W.i); });
  const u = W.el.querySelector('[data-w="undo"]'); if (u) u.disabled = !W.history.length;
  const top = deckEl.querySelector('.card.top');
  if (top) attachDrag(top, item);
}

// refresh only the top card's content (no entrance animation) — e.g. after changing a reminder
function repaintTop() {
  const item = W?.deck[W.i];
  const box = W?.el.querySelector('.card.top .card-in');
  if (item && box) box.innerHTML = cardBody(item) + hint(item);
}

const actBtn = (dir, [act, label, ic], main = false) =>
  `<button class="wz-act ${main ? 'main' : ''}" data-dir="${dir}" data-a="${act}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`;

// gesture legend (only where directions mean different things)
const hint = item => {
  if (item.type === 'event' || item.type === 'preview') return '';
  const a = ACTIONS[item.type];
  const parts = [a.left && `← ${a.left[1]}`, a.up && `↑ ${a.up[1]}`, a.right && `${a.right[1]} →`].filter(Boolean);
  return `<div class="c-hint">${parts.map(p => `<span>${p}</span>`).join('')}</div>`;
};

function cardBody(item) {
  const now = new Date();
  if (item.type === 'event' || item.type === 'preview') {
    const ev = state.events.find(e => e.id === item.id);
    if (!ev) return '<p class="c-desc">האירוע הוסר</p>';
    const cal = calById(ev.calId);
    const ms = ev.start - now;
    const live = ev.start <= now;
    const nav = ev.location ? navLinks(ev.location) : null;
    return `
      <div class="c-kind">${ev.birthday ? '<span class="cake">🎂</span>' : `<i style="background:${calColor(cal)}"></i>`}${esc(cal?.name || 'יומן')}${item.type === 'preview' ? ` · ${relDayLabel(ev.start)}` : ''}</div>
      <div class="c-time"><span>${hm(ev.start)}</span><small>עד ${hm(ev.end)}</small></div>
      ${item.type === 'event' ? `<div class="c-when ${!live && ms < 7200e3 ? 'hot' : ''}">${live ? 'קורה עכשיו' : countdown(ms)}</div>` : ''}
      <h3 class="c-title">${esc(ev.title)}</h3>
      ${ev.location ? `<div class="c-line">${icon('pin')}<span>${esc(ev.location)}</span></div>
        <div class="c-links">
          <a href="${nav.walk}" target="_blank" rel="noopener">${icon('walk')}ברגל</a>
          <a href="${nav.transit}" target="_blank" rel="noopener">${icon('bus')}תחב״צ</a>
          <a href="${nav.car}" target="_blank" rel="noopener">${icon('car')}Waze</a>
        </div>` : ''}
      ${ev.meet ? `<div class="c-links"><a href="${esc(ev.meet)}" target="_blank" rel="noopener">${icon('video')}הצטרפות לשיחת וידאו</a></div>` : ''}
      ${ev.canEdit ? `<div class="c-sec"><div class="c-label">${icon('bell')}תזכורת</div>${reminderChips(ev)}</div>` : ''}
      ${ev.description ? `<div class="c-sec"><div class="c-label">תיאור</div><div class="c-desc">${linkify(ev.description)}</div></div>` : ''}
      <div class="c-foot">
        <a class="c-btn" href="${esc(ev.htmlLink)}" target="_blank" rel="noopener">${icon('pencil')}עריכה ביומן גוגל</a>
        ${ev.canEdit ? `<button class="c-btn danger" data-cdel aria-label="מחיקת האירוע">${icon('trash')}</button>` : ''}
      </div>`;
  }
  if (item.type === 'task') {
    const t = allTaskRoots().find(x => x.id === item.id);
    if (!t) return '<p class="c-desc">המשימה הוסרה</p>';
    const n = t.due ? daysBetween(now, fromYmd(t.due)) : null;
    const due = t.due ? fromYmd(t.due) : null;
    const LINK_LABEL = { email: 'מייל מקושר', generic: 'קישור', chat_message: 'הודעה בצ׳אט', keep_note: 'פתק ב־Keep' };
    return `
      <div class="c-kind"><i style="background:var(--brand)"></i>משימה · ${esc(t.listTitle || '')}</div>
      <h3 class="c-title big">${esc(t.title)}</h3>
      <div class="c-facts">
        <span class="${n != null && n < 0 ? 'hot' : ''}">${icon('calendar')}${due ? `יום ${dayName(due)}, ${longDate(due)} · ${daysLeftLabel(n)}` : 'בלי תאריך יעד'}</span>
        ${t.subtasks.length ? `<span>${icon('list')}${t.subtasks.filter(s => s.status === 'completed').length}/${t.subtasks.length} תתי־משימות</span>` : ''}
      </div>
      ${t.subtasks.length ? `<div class="c-subs">${t.subtasks.map(s => `
        <button class="c-sub ${s.status === 'completed' ? 'on' : ''}" data-sub="${s.id}"><span class="box">${icon('check')}</span>${esc(s.title)}</button>`).join('')}</div>` : ''}
      ${t.notes ? `<div class="c-sec"><div class="c-label">פרטים</div><div class="c-desc">${linkify(t.notes)}</div></div>` : ''}
      ${t.links?.length ? `<div class="c-links">${t.links.map(l => `<a href="${esc(l.link)}" target="_blank" rel="noopener">${icon(l.type === 'email' ? 'mail' : 'external')}${esc(l.description || LINK_LABEL[l.type] || 'קישור')}</a>`).join('')}</div>` : ''}
      <div class="c-foot">
        <button class="c-btn" data-edit-task="${t.id}">${icon('pencil')}עריכה</button>
        <a class="c-btn" href="${esc(t.webLink)}" target="_blank" rel="noopener">${icon('external')}בגוגל משימות</a>
      </div>`;
  }
  if (item.type === 'email') {
    const e = state.emails.find(x => x.id === item.id);
    if (!e) return '<p class="c-desc">המייל טופל</p>';
    const labels = userLabels(e);
    return `
      <div class="c-kind"><i style="background:#ea4335"></i>Gmail · ${relDayLabel(e.date)} ${hm(e.date)}</div>
      <div class="c-from"><span class="c-av">${esc(e.from.trim()[0] || '?')}</span><span><b>${esc(e.from)}</b>${e.fromEmail && e.fromEmail !== e.from ? `<small dir="ltr">${esc(e.fromEmail)}</small>` : ''}</span></div>
      ${labels.length ? `<div class="c-labels">${labels.map(l => `<span style="--lc:${l.color || 'var(--ink-3)'}">${esc(l.name)}</span>`).join('')}</div>` : ''}
      <h3 class="c-title">${esc(e.subject)}</h3>
      <div class="c-desc">${esc(e.snippet)}</div>
      <div class="c-foot">
        <a class="c-btn" href="${esc(e.link)}" target="_blank" rel="noopener">${icon('external')}פתיחה ב־Gmail</a>
        <button class="c-btn danger" data-cdel aria-label="מחיקת המייל">${icon('trash')}</button>
      </div>`;
  }
  if (item.type === 'digest') {
    const d = W.extras.digest;
    return `
      <div class="c-kind"><i style="background:#9a5cf0"></i>דיג׳סט עיצוב · ${esc(d.label)}</div>
      ${d.top[0]?.image ? `<img class="c-img" src="${esc(d.top[0].image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <h3 class="c-title">גיליון חדש מחכה לך</h3>
      <div class="c-desc">${esc(d.intro)}</div>
      <ul class="c-bul">${d.top.map(x => `<li>${esc(x.title)}</li>`).join('')}</ul>`;
  }
  return '';
}

function finish() {
  const s = W.stats;
  const bits = [
    s.done && `✅ ${s.done} בוצעו`, s.deferred && `⏭️ ${s.deferred} נדחו`, s.archived && `🗄️ ${s.archived} מיילים בארכיון`,
    s.tasks && `📝 ${s.tasks} מיילים הפכו למשימות`, s.deleted && `🗑️ ${s.deleted} נמחקו`,
  ].filter(Boolean);
  const evening = W.mode === 'evening';
  return `
    ${topbar()}
    <canvas class="confetti" aria-hidden="true"></canvas>
    <div class="wz-welcome wz-finish">
      <div class="wz-badge wz-in" style="--d:0">${evening ? '🌙' : '🎉'}</div>
      <h2 class="wz-hello wz-in" style="--d:1">${evening ? 'לילה טוב' : 'היום מסודר'}</h2>
      <p class="wz-kicker wz-in" style="--d:2">${evening ? 'סגרת את היום. מחר מתחיל מסודר.' : 'עברת על כל מה שמחכה לך היום.'}</p>
      ${bits.length ? `<ul class="wz-lines">${bits.map((b, i) => `<li class="wz-in" style="--d:${3 + i}">${b}</li>`).join('')}</ul>` : ''}
      <button class="wz-cta wz-in" style="--d:${4 + bits.length}" data-w="close">חזרה למסך הראשי</button>
      ${W.deck.length ? `<button class="wz-link wz-in" style="--d:${5 + bits.length}" data-jump="0">לעבור שוב על הכרטיסים</button>` : ''}
    </div>`;
}

// ---------- clicks ----------
function onClick(e) {
  const b = e.target.closest('button, a');
  if (!b || !W) return;
  if (b.dataset.w === 'close') return closeWizard();
  if (b.dataset.w === 'start') {
    if ('empty' in b.dataset) return closeWizard();
    W.phase = W.deck.length ? 'cards' : 'finish'; paint(); return;
  }
  if (b.dataset.w === 'undo') return undo();
  if (b.dataset.jump != null) { jump(Number(b.dataset.jump)); return; }
  if (b.dataset.sub) { toggleTask(b.dataset.sub, { silent: true }); b.classList.toggle('on'); haptic(); return; }
  if (b.dataset.rem) { setReminder(W.deck[W.i].id, b.dataset.rem === 'null' ? null : b.dataset.rem === 'default' ? 'default' : Number(b.dataset.rem)); repaintTop(); haptic(); return; }
  if (b.dataset.editTask) { openTask(b.dataset.editTask); watchSheetThenRepaint(); return; }
  if ('cdel' in b.dataset) return removeCurrent();
  if (b.dataset.dir) fling(b.dataset.dir);
}

function watchSheetThenRepaint() {
  const t = setInterval(() => { if (!document.querySelector('.sheet')) { clearInterval(t); repaintTop(); } }, 300);
}

function jump(k) {
  if (k < 0 || k >= W.deck.length) return;
  W.i = k;
  if (W.phase !== 'cards') { W.phase = 'cards'; paint(); } else paintDeck();
}

function onKey(e) {
  if (!W || document.querySelector('.sheet')) return;
  if (e.key === 'Escape') { e.preventDefault(); return closeWizard(); }
  if (W.phase !== 'cards') return;
  const map = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up' };
  const d = map[e.key]; if (!d) return;
  e.preventDefault();
  fling(d);
}

// ---------- actions ----------
// Animate the top card off-screen in a direction, then run its action.
function fling(dir) {
  const item = W.deck[W.i];
  const act = ACTIONS[item?.type]?.[dir];
  if (!act) return;
  const card = W.el.querySelector('.card.top');
  if (!card || card.classList.contains('gone')) return;
  if (act[0] === 'defer') { snapBack(card); return deferPicker(item); }
  if (act[0] === 'archive') {
    const e = state.emails.find(x => x.id === item.id);
    if (e && !userLabels(e).length && state.labels.length) { snapBack(card); return labelPicker(item); }
  }
  if (act[0] === 'totask') { snapBack(card); return emailTaskDrawer(item); }
  throwCard(card, dir, act[0]);
  setTimeout(() => apply(act[0], item), reducedMotion() ? 0 : 260);
}

function throwCard(card, dir, act) {
  haptic(12);
  tint(card, act, 1);
  card.classList.add('gone');
  const dx = dir === 'right' ? innerWidth * 1.2 : dir === 'left' ? -innerWidth * 1.2 : 0;
  const dy = dir === 'up' ? -innerHeight : dir === 'down' ? innerHeight * .6 : 40;
  card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dir === 'right' ? 18 : dir === 'left' ? -18 : 0}deg)`;
  card.style.opacity = '0';
}

function snapBack(card) { card.style.transform = ''; tint(card, null, 0); }

function removeCurrent() {
  const item = W.deck[W.i];
  const card = W.el.querySelector('.card.top');
  throwCard(card, 'down', 'delete');
  setTimeout(() => {
    const restore = item.type === 'email' ? trashEmail(item.id, { silent: true }) : deleteEvent(item.id, { silent: true });
    record(item, restore, 'deleted');
  }, 260);
}

// small sheet inside the card
function cardPanel(card, html, onPick) {
  if (card.querySelector('.c-defer')) return;
  const box = document.createElement('div');
  box.className = 'c-defer';
  box.innerHTML = html + `<button data-pick="cancel" class="ghost">ביטול</button>`;
  card.append(box);
  box.addEventListener('click', ev => {
    const b = ev.target.closest('[data-pick]'); if (!b) return;
    ev.stopPropagation();
    box.remove();
    if (b.dataset.pick !== 'cancel') onPick(b);
  });
}

function deferPicker(item) {
  const card = W.el.querySelector('.card.top');
  const t = startOfDay(new Date());
  cardPanel(card, `<b>לדחות ל…</b>
    <button data-pick="${ymd(addDays(t, 1))}" data-l="מחר">מחר <small>${dayName(addDays(t, 1))}</small></button>
    <button data-pick="${ymd(addDays(t, 7))}" data-l="שבוע">בעוד שבוע <small>${addDays(t, 7).getDate()}/${addDays(t, 7).getMonth() + 1}</small></button>
    <button data-pick="other">מועד אחר…</button>`, b => {
    if (b.dataset.pick === 'other') {
      const prevDue = state.tasks.find(x => x.id === item.id)?.due ?? null;
      openDeferSheet(item.id, { onDone: () => { throwCard(card, 'left', 'defer'); setTimeout(() => record(item, () => updateTask(item.id, { due: prevDue }), 'deferred'), 260); } });
      return;
    }
    const prev = deferTask(item.id, b.dataset.pick, b.dataset.l, { silent: true });
    throwCard(card, 'left', 'defer');
    setTimeout(() => record(item, () => updateTask(item.id, { due: prev }), 'deferred'), 260);
  });
}

function labelPicker(item) {
  const card = W.el.querySelector('.card.top');
  cardPanel(card, `<b>למייל אין תווית. לשייך לפני הארכיון?</b>
    <div class="c-pick-labels">${state.labels.map(l => `<button data-pick="${esc(l.id)}" style="--lc:${l.color || 'var(--ink-3)'}">${esc(l.name)}</button>`).join('')}</div>
    <button data-pick="none">ארכיון בלי תווית</button>`, b => {
    const label = b.dataset.pick === 'none' ? null : b.dataset.pick;
    const e = state.emails.find(x => x.id === item.id);
    throwCard(card, 'left', 'archive');
    setTimeout(() => {
      archiveEmail(item.id, { silent: true, label });
      record(item, () => e && unarchiveEmail(e), 'archived');
    }, 260);
  });
}

// Drawer to shape the task before creating it from an email
function emailTaskDrawer(item) {
  const e = state.emails.find(x => x.id === item.id);
  if (!e) return;
  const t0 = startOfDay(new Date());
  const f = { title: e.subject, due: ymd(t0), list: state.settings.defaultList || state.lists[0]?.id, notes: `${e.from}\n${e.link}`, archive: true };
  openSheet(() => `
    <h3>משימה מהמייל</h3>
    <p class="sub">${icon('mail')} ${esc(e.from)}</p>
    <div class="field-label">שם המשימה</div>
    <input class="inp" data-key="title" value="${esc(f.title)}" enterkeyhint="done">
    <div class="field-label">${icon('calendar')}תאריך יעד</div>
    <div class="seg">
      ${[[ymd(t0), 'היום'], [ymd(addDays(t0, 1)), 'מחר'], [ymd(addDays(t0, 7)), 'בעוד שבוע'], ['', 'ללא']].map(([v, l]) => `<button type="button" data-due="${v}" aria-pressed="${(f.due || '') === v}">${l}</button>`).join('')}
      <input class="inp" type="date" data-key="due" value="${f.due || ''}" style="width:auto;height:38px;padding:0 10px;border-radius:12px" aria-label="תאריך">
    </div>
    ${state.lists.length > 1 ? `<div class="field-label">${icon('list')}רשימה</div>
      <select class="inp" data-key="list">${state.lists.map(l => `<option value="${l.id}" ${l.id === f.list ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : ''}
    <div class="field-label">פרטים</div>
    <textarea class="inp" data-key="notes">${esc(f.notes)}</textarea>
    <div class="set-row"><div class="grow"><b>להעביר את המייל לארכיון</b><small>המשימה תכלול קישור למייל</small></div>
      <button class="switch" role="switch" aria-checked="${f.archive}" data-arch aria-label="ארכיון"></button></div>
    <div class="actions"><button class="btn primary grow" data-create>${icon('check')}יצירת משימה</button></div>`);
  const el = document.querySelector('.sheet');
  el.addEventListener('input', ev => { const k = ev.target.dataset.key; if (k) f[k] = ev.target.value; });
  el.addEventListener('change', ev => { if (ev.target.dataset.key === 'due') paintSheet(); });
  el.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if ('due' in b.dataset) { f.due = b.dataset.due; paintSheet(); }
    else if ('arch' in b.dataset) { f.archive = !f.archive; paintSheet(); }
    else if ('create' in b.dataset) {
      closeSheet();
      const card = W.el.querySelector('.card.top');
      throwCard(card, 'up', 'totask');
      const p = emailToTask(item.id, f.due || null, { silent: true, title: f.title.trim() || e.subject, notes: f.notes, listId: f.list, archive: f.archive });
      setTimeout(() => record(item, async () => { const t = await p; if (t) dropTask(t.id); if (f.archive) unarchiveEmail(e); }, 'tasks'), 260);
    }
  });
}

function apply(act, item) {
  if (!W) return;
  switch (act) {
    case 'done': toggleTask(item.id, { silent: true }); record(item, () => toggleTask(item.id, { silent: true }), 'done'); break;
    case 'archive': {
      const e = state.emails.find(x => x.id === item.id);
      archiveEmail(item.id, { silent: true });
      record(item, () => e && unarchiveEmail(e), 'archived'); break;
    }
    case 'open': {
      W.extras.onDigest?.(W.extras.digest.id);
      window.open(W.extras.digest.url, '_blank');
      record(item, () => {}, 'kept'); break;
    }
    default: record(item, () => {}, 'kept');
  }
}

function record(item, undoFn, stat) {
  if (!W) return;
  W.history.push({ i: W.i, undo: undoFn, stat });
  W.stats[stat] = (W.stats[stat] || 0) + 1;
  advance();
}

function advance() {
  W.i++;
  if (W.i >= W.deck.length) { W.phase = 'finish'; paint(); return; }
  paintDeck();
}

function undo() {
  const h = W.history.pop(); if (!h) return;
  h.undo?.();
  W.stats[h.stat]--;
  W.i = h.i;
  if (W.phase !== 'cards') { W.phase = 'cards'; paint(); } else paintDeck({ animate: false });
  W.el.querySelector('.card.top')?.classList.add('from-back');
}

function tint(card, act, strength) {
  const t = card.querySelector('.tint'); if (!t) return;
  if (!act) { t.style.opacity = 0; return; }
  const [color, label, ic] = TINT[act];
  if (t.dataset.act !== act) { t.dataset.act = act; t.innerHTML = `<span>${icon(ic)}${label}</span>`; t.style.background = color; }
  t.style.opacity = Math.min(1, strength * 1.6);
}

// ---------- drag physics ----------
function attachDrag(card, item) {
  const acts = ACTIONS[item.type];
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, dragging = false, pid = null;
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('a, button, input, .c-defer')) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); dragging = true;
    card.setPointerCapture(pid);
    card.classList.add('dragging');
  });
  card.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pid) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    const up = dy < 0 && Math.abs(dy) > Math.abs(dx) && acts.up;
    const ty = up ? dy : dy * .25;
    card.style.transform = `translate(${dx}px, ${ty}px) rotate(${dx / 18}deg)`;
    const dir = up ? 'up' : dx > 0 ? 'right' : 'left';
    const act = acts[dir];
    const strength = up ? -dy / 120 : Math.abs(dx) / 120;
    tint(card, act && strength > .08 ? act[0] : null, strength);
  });
  const end = e => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    card.classList.remove('dragging');
    const dt = performance.now() - t0;
    const vx = dx / dt, vy = dy / dt;
    const up = dy < 0 && Math.abs(dy) > Math.abs(dx);
    let dir = null;
    if (up && (dy < -110 || vy < -.6)) dir = 'up';
    else if (!up && (Math.abs(dx) > 110 || Math.abs(vx) > .6)) dir = dx > 0 ? 'right' : 'left';
    if (dir && acts[dir]) fling(dir); else snapBack(card);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// ---------- confetti ----------
function confetti(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#ffffff', '#ffd84d', '#ff7aa2', '#7cf0c5', '#8fb2ff', '#06343e'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .42,
    vx: (Math.random() - .5) * 13, vy: -Math.random() * 15 - 5, r: Math.random() * 6 + 4,
    c: colors[Math.random() * colors.length | 0], a: Math.random() * 6, va: (Math.random() - .5) * .4, shape: Math.random() > .5,
  }));
  const t0 = performance.now();
  (function frame(t) {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const life = (t - t0) / 2600;
    for (const p of parts) {
      p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = Math.max(0, 1 - life);
      ctx.fillStyle = p.c;
      if (p.shape) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2.4, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (life < 1) requestAnimationFrame(frame);
  })(t0);
}

export const wizardOpen = () => !!W;
