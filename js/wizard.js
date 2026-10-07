// The wizard: a full-screen, swipeable card deck that walks through the day.
// morning → upcoming events, today's tasks, emails, digest
// evening → leftover tasks, then tomorrow's events
// mail    → emails only
import { icon } from './icons.js';
import {
  state, eventsOn, taskGroups, calById, calColor, toggleTask, deferTask, updateTask, archiveEmail, unarchiveEmail,
  emailToTask, dropTask, allTaskRoots, isToday,
} from './data.js';
import { esc, hm, countdown, greeting, dayName, longDate, addDays, ymd, fromYmd, daysBetween, daysLeftLabel, startOfDay, haptic, reducedMotion, relDayLabel } from './util.js';
import { wmo } from './extras.js';
import { openEvent, openDeferSheet, navLinks, linkify } from './sheets.js';

let W = null; // live wizard instance

const ACTIONS = {
  event: { left: ['details', 'פרטים', 'pencil'], right: ['next', 'הבא', 'arrowR'] },
  preview: { right: ['next', 'הבא', 'arrowR'] },
  task: { left: ['defer', 'לדחות', 'snooze'], up: ['done', 'בוצע', 'check'], right: ['keep', 'נשאר להיום', 'arrowR'] },
  email: { left: ['archive', 'ארכיון', 'archive'], up: ['totask', 'למשימה', 'list'], right: ['keep', 'להשאיר', 'arrowR'] },
  digest: { up: ['open', 'לקרוא', 'newspaper'], right: ['next', 'אחר כך', 'arrowR'] },
};
const STAMP = {
  next: ['הבא', 'var(--brand)'], keep: ['נשאר', 'var(--brand)'], details: ['פרטים', '#7a6ff0'], defer: ['לדחות', '#f0a020'],
  done: ['בוצע ✓', '#23b07a'], archive: ['ארכיון', '#8a9aa0'], totask: ['למשימה', '#23b07a'], open: ['לקרוא', '#9a5cf0'],
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

// ---------- open / close with a circular reveal from the button ----------
export function openWizard(mode, origin, extras = {}) {
  if (W) return;
  const r = origin?.getBoundingClientRect();
  const cx = r ? r.left + r.width / 2 : innerWidth / 2, cy = r ? r.top + r.height / 2 : innerHeight - 60;
  const el = document.createElement('div');
  el.className = 'wizard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', mode === 'evening' ? 'סיכום ערב' : 'אשף היום');
  el.style.setProperty('--cx', cx + 'px');
  el.style.setProperty('--cy', cy + 'px');
  document.body.append(el);
  W = { el, mode, extras, deck: buildDeck(mode, extras), i: 0, phase: mode === 'mail' ? 'cards' : 'welcome', history: [], stats: { done: 0, deferred: 0, archived: 0, tasks: 0, kept: 0 } };
  document.documentElement.classList.add('wiz-open');
  paint();
  el.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  history.pushState({ wizard: true }, '');
  addEventListener('popstate', onPop);
  if (reducedMotion()) { el.classList.add('open', 'settled'); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  setTimeout(() => el.classList.add('settled'), 520);
}

function onPop() { if (W && !document.querySelector('.sheet')) closeWizard(true); }

export function closeWizard(fromPop = false) {
  if (!W) return;
  const { el } = W;
  W = null;
  removeEventListener('keydown', onKey);
  removeEventListener('popstate', onPop);
  if (!fromPop && history.state?.wizard) history.back();
  el.classList.remove('settled');
  el.classList.add('closing');
  el.classList.remove('open');
  const done = () => { el.remove(); document.documentElement.classList.remove('wiz-open'); };
  if (reducedMotion()) return done();
  setTimeout(done, 480); // backup in case transitionend never fires
}

// ---------- painting ----------
function paint() {
  const { el, phase } = W;
  if (phase === 'welcome') el.innerHTML = welcome();
  else if (phase === 'cards') { el.innerHTML = cardsShell(); paintDeck(); }
  else el.innerHTML = finish();
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
  const nEv = W.deck.filter(d => d.type === 'event').length;
  const nTask = W.deck.filter(d => d.type === 'task').length;
  const nMail = W.deck.filter(d => d.type === 'email').length;
  const nPrev = W.deck.filter(d => d.type === 'preview').length;
  const lines = evening
    ? [[`🗂️`, nTask ? `${nTask} משימות שנשארו פתוחות` : 'כל המשימות של היום סגורות'], ['📅', nPrev ? `${nPrev} אירועים מחכים מחר` : 'מחר היומן פנוי']]
    : [['📅', nEv ? `${nEv} אירועים עוד לפניך` : 'אין עוד אירועים היום'], ['✅', nTask ? `${nTask} משימות להיום` : 'אין משימות להיום'], ...(nMail ? [['✉️', `${nMail} מיילים לטיפול`]] : []),
      ...(W.deck.some(d => d.type === 'digest') ? [['📰', 'גיליון חדש בדיג׳סט']] : [])];
  return `
    ${topbar()}
    <div class="wz-welcome">
      <p class="wz-kicker wz-in" style="--d:0">${evening ? `יום ${dayName(now)} כמעט נגמר` : `יום ${dayName(now)}, ${longDate(now)}`}</p>
      <h2 class="wz-hello wz-in" style="--d:1">${greeting(now)}</h2>
      ${w ? `<div class="wz-weather wz-in" style="--d:2">
        <span class="wz-wx-ic">${evening ? wmo(w.tomorrow.code, 1).icon : wx.icon}</span>
        <span class="wz-wx-now">${evening ? `<span class="ltr">${w.tomorrow.min}°–${w.tomorrow.max}°</span>` : `${w.now}°`}</span>
        <span class="wz-wx-meta"><b>${evening ? 'מחר' : wx.label}${w.city && !evening ? ` ב${esc(w.city)}` : ''}</b>${evening ? wmo(w.tomorrow.code, 1).label : `<span class="ltr">${w.min}°–${w.max}°</span>`}${(evening ? w.tomorrow.rain : w.rain) >= 30 ? ` · ☔ ${evening ? w.tomorrow.rain : w.rain}%` : ''}</span>
      </div>` : ''}
      <ul class="wz-lines">${lines.map(([e, t], i) => `<li class="wz-in" style="--d:${3 + i}"><span>${e}</span>${t}</li>`).join('')}</ul>
      <button class="wz-cta wz-in" style="--d:${4 + lines.length}" data-w="start" ${W.deck.length ? '' : 'data-empty'}>${W.deck.length ? (evening ? 'בוא נסגור את היום' : 'בוא נתחיל') : 'אין מה לסדר, סגירה'}</button>
    </div>`;
}

function cardsShell() {
  return `
    ${topbar(`<div class="wz-progress" aria-hidden="true">${W.deck.map((_, k) => `<i class="${k < W.i ? 'past' : k === W.i ? 'cur' : ''}"></i>`).join('')}</div>
      <button class="wz-ic" data-w="undo" aria-label="חזרה לכרטיס הקודם" ${W.history.length ? '' : 'disabled'}>${icon('undo')}</button>`)}
    <div class="wz-count" aria-live="polite">${Math.min(W.i + 1, W.deck.length)} מתוך ${W.deck.length}</div>
    <div class="deck"></div>
    <div class="wz-actions"></div>`;
}

function paintDeck() {
  const deckEl = W.el.querySelector('.deck');
  const item = W.deck[W.i];
  const next = W.deck[W.i + 1];
  deckEl.innerHTML = (next ? `<article class="card behind" aria-hidden="true">${cardBody(next)}</article>` : '') +
    (item ? `<article class="card top enter" data-type="${item.type}">${cardBody(item)}${hint(item)}<div class="stamp"></div></article>` : '');
  const acts = item ? ACTIONS[item.type] : {};
  W.el.querySelector('.wz-actions').innerHTML = [
    acts.left ? actBtn('left', acts.left) : '<span></span>',
    acts.up ? actBtn('up', acts.up, true) : '<span></span>',
    acts.right ? actBtn('right', acts.right) : '<span></span>',
  ].join('');
  W.el.querySelector('.wz-count').textContent = `${Math.min(W.i + 1, W.deck.length)} מתוך ${W.deck.length}`;
  W.el.querySelectorAll('.wz-progress i').forEach((b, k) => b.className = k < W.i ? 'past' : k === W.i ? 'cur' : '');
  const u = W.el.querySelector('[data-w="undo"]'); if (u) u.disabled = !W.history.length;
  const top = deckEl.querySelector('.card.top');
  if (top) attachDrag(top, item);
}

// gesture legend at the bottom of each card (physical directions, laid out LTR to match the buttons)
const hint = item => {
  const a = ACTIONS[item.type];
  const parts = [a.left && `← ${a.left[1]}`, a.up && `↑ ${a.up[1]}`, a.right && `${a.right[1]} →`].filter(Boolean);
  return `<div class="c-hint">${parts.map(p => `<span>${p}</span>`).join('')}</div>`;
};

const actBtn = (dir, [act, label, ic], main = false) =>
  `<button class="wz-act ${main ? 'main' : ''}" data-dir="${dir}" data-a="${act}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`;

function cardBody(item) {
  const now = new Date();
  if (item.type === 'event' || item.type === 'preview') {
    const ev = state.events.find(e => e.id === item.id);
    if (!ev) return '<p>האירוע הוסר</p>';
    const cal = calById(ev.calId);
    const ms = ev.start - now;
    const live = ev.start <= now;
    const nav = ev.location ? navLinks(ev.location) : null;
    return `
      <div class="c-kind"><i style="background:${calColor(cal)}"></i>${esc(cal?.name || 'יומן')}${item.type === 'preview' ? ' · מחר' : ''}</div>
      <div class="c-time">${hm(ev.start)}<small>עד ${hm(ev.end)}</small></div>
      ${item.type === 'event' ? `<div class="c-when ${!live && ms < 7200e3 ? 'hot' : ''}">${live ? 'קורה עכשיו' : countdown(ms)}</div>` : ''}
      <h3 class="c-title">${esc(ev.title)}</h3>
      ${ev.location ? `<div class="c-line">${icon('pin')}<span>${esc(ev.location)}</span></div>` : ''}
      ${ev.description ? `<div class="c-desc">${linkify(ev.description)}</div>` : ''}
      <div class="c-links">
        ${ev.meet ? `<a href="${esc(ev.meet)}" target="_blank" rel="noopener">${icon('video')}וידאו</a>` : ''}
        ${nav ? `<a href="${nav.walk}" target="_blank" rel="noopener">${icon('walk')}ברגל</a><a href="${nav.transit}" target="_blank" rel="noopener">${icon('bus')}תח״צ</a><a href="${nav.car}" target="_blank" rel="noopener">${icon('car')}Waze</a>` : ''}
      </div>`;
  }
  if (item.type === 'task') {
    const t = allTaskRoots().find(x => x.id === item.id);
    if (!t) return '<p>המשימה הוסרה</p>';
    const n = t.due ? daysBetween(now, fromYmd(t.due)) : null;
    return `
      <div class="c-kind"><i style="background:var(--brand)"></i>משימה · ${esc(t.listTitle || '')}</div>
      ${n != null && n < 0 ? `<div class="c-when hot">${daysLeftLabel(n)}</div>` : '<div class="c-when">להיום</div>'}
      <h3 class="c-title big">${esc(t.title)}</h3>
      ${t.subtasks.length ? `<div class="c-subs">${t.subtasks.map(s => `
        <button class="c-sub ${s.status === 'completed' ? 'on' : ''}" data-sub="${s.id}"><span class="box">${icon('check')}</span>${esc(s.title)}</button>`).join('')}</div>` : ''}
      ${t.notes ? `<div class="c-desc">${linkify(t.notes)}</div>` : ''}`;
  }
  if (item.type === 'email') {
    const e = state.emails.find(x => x.id === item.id);
    if (!e) return '<p>המייל טופל</p>';
    return `
      <div class="c-kind"><i style="background:#ea4335"></i>Gmail · ${relDayLabel(e.date)} ${hm(e.date)}</div>
      <div class="c-from"><span class="c-av">${esc(e.from.trim()[0] || '?')}</span><b>${esc(e.from)}</b></div>
      <h3 class="c-title">${esc(e.subject)}</h3>
      <div class="c-desc">${esc(e.snippet)}</div>
      <div class="c-links"><a href="${esc(e.link)}" target="_blank" rel="noopener">${icon('external')}פתיחה ב־Gmail</a></div>`;
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
    s.tasks && `📝 ${s.tasks} מיילים הפכו למשימות`,
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
    </div>`;
}

// ---------- actions ----------
function onClick(e) {
  const b = e.target.closest('button, a');
  if (!b || !W) return;
  if (b.dataset.w === 'close') return closeWizard();
  if (b.dataset.w === 'start') {
    if ('empty' in b.dataset) return closeWizard();
    W.phase = W.deck.length ? 'cards' : 'finish'; paint(); return;
  }
  if (b.dataset.w === 'undo') return undo();
  if (b.dataset.sub) { toggleTask(b.dataset.sub, { silent: true }); b.classList.toggle('on'); haptic(); return; }
  if (b.dataset.dir) fling(b.dataset.dir);
}

function onKey(e) {
  if (!W || W.phase !== 'cards' || document.querySelector('.sheet')) { if (e.key === 'Escape' && W && !document.querySelector('.sheet')) closeWizard(); return; }
  const map = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', Escape: 'close' };
  const d = map[e.key]; if (!d) return;
  e.preventDefault();
  if (d === 'close') closeWizard(); else fling(d);
}

// Animate the top card off-screen in a direction, then run its action.
function fling(dir) {
  const item = W.deck[W.i];
  const act = ACTIONS[item?.type]?.[dir];
  if (!act) return;
  const card = W.el.querySelector('.card.top');
  if (!card || card.classList.contains('gone')) return;
  // "details" and "defer" keep the card; they open a sheet on top
  if (act[0] === 'details') { snapBack(card); openEvent(item.id); return; }
  if (act[0] === 'defer') { snapBack(card); return deferPicker(item); }
  haptic(12);
  card.classList.add('gone');
  const dx = dir === 'right' ? innerWidth * 1.2 : dir === 'left' ? -innerWidth * 1.2 : 0;
  const dy = dir === 'up' ? -innerHeight : 40;
  card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dir === 'up' ? 0 : dir === 'right' ? 18 : -18}deg)`;
  card.style.opacity = '0';
  showStamp(card, act[0], 1);
  setTimeout(() => apply(act[0], item), reducedMotion() ? 0 : 260);
}

function snapBack(card) { card.style.transform = ''; showStamp(card, null, 0); }

function deferPicker(item) {
  const card = W.el.querySelector('.card.top');
  if (card.querySelector('.c-defer')) return;
  const box = document.createElement('div');
  box.className = 'c-defer';
  const t = startOfDay(new Date());
  box.innerHTML = `<b>לדחות ל…</b>
    <button data-def="${ymd(addDays(t, 1))}" data-l="מחר">מחר <small>${dayName(addDays(t, 1))}</small></button>
    <button data-def="${ymd(addDays(t, 7))}" data-l="שבוע">בעוד שבוע <small>${addDays(t, 7).getDate()}/${addDays(t, 7).getMonth() + 1}</small></button>
    <button data-def="other">מועד אחר…</button>
    <button data-def="cancel" class="ghost">ביטול</button>`;
  card.append(box);
  box.addEventListener('click', ev => {
    const b = ev.target.closest('[data-def]'); if (!b) return;
    ev.stopPropagation();
    if (b.dataset.def === 'cancel') return box.remove();
    if (b.dataset.def === 'other') {
      box.remove();
      const prevDue = state.tasks.find(x => x.id === item.id)?.due ?? null;
      openDeferSheet(item.id, { onDone: () => record(item, () => updateTask(item.id, { due: prevDue }), 'deferred') });
      return;
    }
    const prev = deferTask(item.id, b.dataset.def, b.dataset.l, { silent: true });
    card.classList.add('gone');
    card.style.transform = `translate(${-innerWidth * 1.2}px, 40px) rotate(-18deg)`; card.style.opacity = '0';
    showStamp(card, 'defer', 1);
    setTimeout(() => record(item, () => updateTask(item.id, { due: prev }), 'deferred'), 260);
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
    case 'totask': {
      const e = state.emails.find(x => x.id === item.id);
      const p = emailToTask(item.id, ymd(new Date()), { silent: true });
      record(item, async () => { const t = await p; if (t) dropTask(t.id); if (e) unarchiveEmail(e); }, 'tasks'); break;
    }
    case 'open': {
      W.extras.onDigest?.(W.extras.digest.id);
      window.open(W.extras.digest.url, '_blank');
      record(item, () => {}, 'kept'); break;
    }
    default: record(item, () => {}, 'kept');
  }
}

function record(item, undoFn, stat, _d) {
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
  if (W.phase !== 'cards') { W.phase = 'cards'; paint(); } else paintDeck();
  W.el.querySelector('.card.top')?.classList.add('from-back');
}

function showStamp(card, act, strength) {
  const s = card.querySelector('.stamp'); if (!s) return;
  if (!act) { s.style.opacity = 0; return; }
  const [label, color] = STAMP[act];
  s.textContent = label;
  s.style.setProperty('--sc', color);
  s.style.opacity = Math.min(1, strength);
  card.style.setProperty('--glow', color);
}

// ---------- drag physics ----------
function attachDrag(card, item) {
  const acts = ACTIONS[item.type];
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, dragging = false, pid = null;
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('a, .c-sub, .c-defer')) return;
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
    const strength = up ? -dy / 110 : Math.abs(dx) / 110;
    showStamp(card, act && strength > .15 ? act[0] : null, strength);
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
