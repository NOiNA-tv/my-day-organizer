// A time picker in the app's own colours: two snap-scrolling wheels (hours · minutes in 5s).
import { icon } from './icons.js';
import { haptic } from './util.js';

const ROW = 44;
const pad = n => String(n).padStart(2, '0');

export function openTimePicker({ value = '', title = 'שעת תזכורת', onSave, onClear } = {}) {
  const now = new Date();
  let [h, m] = value ? value.split(':').map(Number) : [now.getHours() + 1, 0];
  h = ((h % 24) + 24) % 24; m = Math.round(m / 5) * 5 % 60;

  const scrim = document.createElement('div');
  scrim.className = 'tp-scrim';
  const el = document.createElement('div');
  el.className = 'tp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  const wheel = (name, count, step) => `
    <div class="tp-wheel" data-w="${name}" tabindex="0" aria-label="${name === 'h' ? 'שעות' : 'דקות'}">
      <div class="tp-pad"></div>${Array.from({ length: count }, (_, i) => `<div class="tp-item" data-v="${i * step}">${pad(i * step)}</div>`).join('')}<div class="tp-pad"></div>
    </div>`;
  el.innerHTML = `
    <div class="tp-head">${icon('bell')}<b>${title}</b></div>
    <div class="tp-wheels">
      <div class="tp-band" aria-hidden="true"></div>
      ${wheel('h', 24, 1)}<span class="tp-colon">:</span>${wheel('m', 12, 5)}
    </div>
    <div class="tp-actions">
      ${onClear ? `<button class="btn" data-tp="clear">${icon('bellOff')}ללא</button>` : ''}
      <button class="btn" data-tp="cancel">ביטול</button>
      <button class="btn primary grow" data-tp="save">${icon('check')}שמירה</button>
    </div>`;
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });

  const wh = el.querySelector('[data-w="h"]'), wm = el.querySelector('[data-w="m"]');
  wh.scrollTop = h * ROW; wm.scrollTop = (m / 5) * ROW;
  const read = w => Math.max(0, Math.round(w.scrollTop / ROW));
  const mark = w => {
    const i = read(w);
    w.querySelectorAll('.tp-item').forEach((it, k) => it.classList.toggle('on', k === i));
  };
  [wh, wm].forEach(w => {
    let last = -1;
    w.addEventListener('scroll', () => { const i = read(w); if (i !== last) { last = i; mark(w); haptic(4); } }, { passive: true });
    w.addEventListener('click', e => { const it = e.target.closest('.tp-item'); if (it) w.scrollTo({ top: [...w.querySelectorAll('.tp-item')].indexOf(it) * ROW, behavior: 'smooth' }); });
    w.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); w.scrollBy({ top: e.key === 'ArrowDown' ? ROW : -ROW, behavior: 'smooth' }); }
    });
    mark(w);
  });

  const close = () => {
    scrim.classList.remove('show'); el.classList.remove('show');
    setTimeout(() => { scrim.remove(); el.remove(); }, 260);
  };
  scrim.addEventListener('click', close);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-tp]'); if (!b) return;
    const act = b.dataset.tp;
    if (act === 'save') onSave?.(`${pad(read(wh))}:${pad(read(wm) * 5)}`);
    if (act === 'clear') onClear?.();
    close();
  });
}
