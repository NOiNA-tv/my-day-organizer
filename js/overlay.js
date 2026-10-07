// Modal bottom sheets (drag-to-dismiss, Android back closes), popover menus, snackbar.
import { icon } from './icons.js';
import { toasts, undoToast } from './data.js';
import { esc } from './util.js';

let current = null; // { el, scrim, render, onClose }

export function openSheet(render, { onClose } = {}) {
  const replacing = !!current;
  if (current) closeSheet(true, true); // keep the history entry for the next sheet
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="grab" aria-hidden="true"><i></i></div><div class="sheet-scroll"></div>`;
  document.body.append(scrim, el);
  current = { el, scrim, render, onClose };
  paintSheet();
  requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });
  scrim.addEventListener('click', () => closeSheet());
  dragToDismiss(el);
  if (!replacing) history.pushState({ sheet: true }, '');
  document.querySelector('.snack')?.classList.add('over-sheet');
  return el;
}

// Re-render sheet content, keeping focus + caret on the active field.
export function paintSheet() {
  if (!current) return;
  const box = current.el.querySelector('.sheet-scroll');
  const a = document.activeElement;
  const key = a && box.contains(a) ? a.dataset.key : null;
  const sel = key && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = box.scrollTop;
  box.innerHTML = current.render();
  box.scrollTop = scroll;
  if (key) {
    const n = box.querySelector(`[data-key="${key}"]`);
    if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(...sel); } catch { /* not a text field */ } }
  }
}

export function closeSheet(instant = false, fromPop = false) {
  if (!current) return;
  const { el, scrim, onClose } = current;
  current = null;
  document.activeElement?.blur?.();
  onClose?.();
  document.querySelector('.snack')?.classList.remove('over-sheet');
  if (!fromPop && history.state?.sheet) history.back();
  if (instant) { el.remove(); scrim.remove(); return; }
  el.classList.remove('show'); scrim.classList.remove('show');
  setTimeout(() => { el.remove(); scrim.remove(); }, 340);
}
export const sheetOpen = () => !!current;
export const sheetEl = () => current?.el;

addEventListener('popstate', () => {
  if (closeMenu()) return;
  if (current) closeSheet(false, true);
});

function dragToDismiss(el) {
  const grab = el.querySelector('.grab');
  const scroller = el.querySelector('.sheet-scroll');
  let y0 = null, dy = 0, t0 = 0;
  const start = (y, fromContent) => {
    if (fromContent && scroller.scrollTop > 0) return;
    y0 = y; dy = 0; t0 = performance.now();
  };
  const move = (y, e) => {
    if (y0 == null) return;
    dy = Math.max(0, y - y0);
    if (dy > 4) { el.classList.add('dragging'); el.style.transform = `translateY(${dy}px)`; if (e.cancelable) e.preventDefault(); }
  };
  const end = () => {
    if (y0 == null) return;
    el.classList.remove('dragging');
    const v = dy / (performance.now() - t0);
    if (dy > 120 || v > .6) closeSheet(); else el.style.transform = '';
    y0 = null;
  };
  grab.addEventListener('pointerdown', e => { grab.setPointerCapture(e.pointerId); start(e.clientY); });
  grab.addEventListener('pointermove', e => move(e.clientY, e));
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  scroller.addEventListener('touchstart', e => { if (!e.target.closest('input,textarea,select')) start(e.touches[0].clientY, true); }, { passive: true });
  scroller.addEventListener('touchmove', e => move(e.touches[0].clientY, e), { passive: false });
  scroller.addEventListener('touchend', end);
}

// ---------- menus ----------
let menuEl = null;
export function openMenu(anchor, items) {
  closeMenu();
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) =>
    `<button role="menuitem" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('');
  document.body.append(scrim, m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h > innerHeight - 8) { top = r.top - h - 6; m.style.transformOrigin = 'bottom left'; }
  m.style.left = left + 'px'; m.style.top = Math.max(8, top) + 'px';
  menuEl = { m, scrim };
  scrim.addEventListener('click', closeMenu);
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const it = items[+b.dataset.i];
    closeMenu();
    it.onClick?.();
  });
  m.querySelector('button')?.focus();
}
export function closeMenu() {
  if (!menuEl) return false;
  menuEl.m.remove(); menuEl.scrim.remove(); menuEl = null;
  return true;
}

// ---------- snackbar ----------
export function mountSnackbar() {
  const s = document.createElement('div');
  s.className = 'snack';
  s.setAttribute('role', 'status');
  s.setAttribute('aria-live', 'polite');
  document.body.append(s);
  toasts.listeners.add(t => {
    if (!t) { s.classList.remove('show'); return; }
    s.innerHTML = `<span>${esc(t.text)}</span>${t.undo ? `<button type="button">${icon('undo')}ביטול</button>` : ''}`;
    s.querySelector('button')?.addEventListener('click', undoToast);
    s.classList.add('show');
  });
}
