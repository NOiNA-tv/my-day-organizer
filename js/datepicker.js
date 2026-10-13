// A date picker in the app's own colours: quick picks + a month grid (Sunday first, right-to-left).
import { icon } from './icons.js';
import { haptic, ymd, fromYmd, addDays, startOfDay } from './util.js';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function openDatePicker({ value = '', title = 'תאריך', onPick, onClear } = {}) {
  const today = startOfDay(new Date());
  let sel = value || '';
  let view = sel ? fromYmd(sel) : new Date(today);
  view = new Date(view.getFullYear(), view.getMonth(), 1);

  const scrim = document.createElement('div');
  scrim.className = 'tp-scrim';
  const el = document.createElement('div');
  el.className = 'tp dp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  const nextSunday = addDays(today, 7 - today.getDay());
  const quick = [['היום', today], ['מחר', addDays(today, 1)], ['מחרתיים', addDays(today, 2)], ['שבוע הבא', nextSunday]];

  const paint = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const cells = [...Array(first).fill(''), ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1))];
    el.innerHTML = `
      <div class="tp-head">${icon('calendar')}<b>${title}</b></div>
      <div class="dp-quick">${quick.map(([l, d]) => `<button data-d="${ymd(d)}" class="${ymd(d) === sel ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="dp-nav">
        <button data-nav="-1" aria-label="חודש קודם">${icon('chevR')}</button>
        <b>${MONTHS[m]} ${y}</b>
        <button data-nav="1" aria-label="חודש הבא">${icon('chevL')}</button>
      </div>
      <div class="dp-grid">
        ${DOW.map(d => `<span class="dp-dow">${d}</span>`).join('')}
        ${cells.map(d => d ? `<button data-d="${ymd(d)}" class="${ymd(d) === sel ? 'on' : ''} ${ymd(d) === ymd(today) ? 'today' : ''} ${d < today ? 'past' : ''}">${d.getDate()}</button>` : '<span></span>').join('')}
      </div>
      <div class="tp-actions">
        ${onClear ? `<button class="btn" data-dp="clear">${icon('x')}ללא תאריך</button>` : ''}
        <button class="btn grow" data-dp="cancel">ביטול</button>
      </div>`;
  };
  paint();
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });

  const close = () => {
    scrim.classList.remove('show'); el.classList.remove('show');
    setTimeout(() => { scrim.remove(); el.remove(); }, 260);
  };
  scrim.addEventListener('click', close);
  el.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1); paint(); return; }
    const d = e.target.closest('[data-d]');
    if (d) {
      sel = d.dataset.d; paint(); haptic(8);
      setTimeout(() => { close(); onPick?.(sel); }, 140); // a beat to see the choice
      return;
    }
    const b = e.target.closest('[data-dp]');
    if (!b) return;
    if (b.dataset.dp === 'clear') onClear?.();
    close();
  });
}
