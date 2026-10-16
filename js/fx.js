// Celebration effects: confetti bursts, a button pop, and the progress ring filling (or draining) live.
// The list re-renders on every change, so effects for re-rendered elements are queued and played after render.
import { reducedMotion, haptic } from './util.js';

const COLORS = ['#3cc4dc', '#22c08a', '#ffd84d', '#ff7aa2', '#8f6ee8', '#ffffff', '#f28b38'];
const queue = [];
let layer = null;
const getLayer = () => {
  if (!layer || !layer.isConnected) { layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer); }
  return layer;
};
const rnd = (a, b) => a + Math.random() * (b - a);

// confetti + a few emojis flying out of (x, y), then drifting down slowly like fairy dust
export function burst(x, y, { emoji = '', big = false } = {}) {
  if (reducedMotion()) return;
  const L = getLayer(), n = big ? 44 : 24;
  const done = el => () => el.remove();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const isEmoji = emoji && i < (big ? 7 : 3);
    p.className = isEmoji ? 'fx-emo' : `fx-bit ${['sq', 'rd', 'ln'][i % 3]}`;
    if (isEmoji) p.textContent = emoji; else p.style.background = COLORS[i % COLORS.length];
    p.style.left = x + 'px'; p.style.top = y + 'px';
    L.append(p);
    const ang = rnd(0, Math.PI * 2), dist = rnd(big ? 80 : 45, big ? 210 : 120) * (isEmoji ? 0.75 : 1);
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - rnd(40, 100);
    const fall = rnd(140, big ? 380 : 260), sway = rnd(18, 40) * (Math.random() < .5 ? -1 : 1);
    const rot = rnd(-360, 360), dur = rnd(2600, big ? 4600 : 3800);
    const T = (tx, ty, sc, r) => `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${sc}) rotate(${r}deg)`;
    p.animate([
      { transform: T(0, 0, .2, 0), opacity: 1 },
      { transform: T(dx * .85, dy * .85, isEmoji ? 1.5 : 1, rot * .25), opacity: 1, offset: .12 },
      { transform: T(dx + sway, dy + fall * .35, isEmoji ? 1.3 : .95, rot * .5), opacity: 1, offset: .38 },
      { transform: T(dx - sway, dy + fall * .7, isEmoji ? 1.15 : .85, rot * .8), opacity: .55, offset: .7 },
      { transform: T(dx + sway * .5, dy + fall, isEmoji ? 1 : .7, rot), opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'forwards' }).finished.then(done(p), done(p));
  }
  // fairy dust: tiny glowing sparks that twinkle and float away slowly
  for (let i = 0; i < (big ? 34 : 18); i++) {
    const s = document.createElement('i');
    s.className = 'fx-spark';
    s.style.left = x + rnd(-24, 24) + 'px'; s.style.top = y + rnd(-14, 14) + 'px';
    s.style.setProperty('--c', ['#fff7c2', '#ffffff', '#bff4ff', '#ffd6e6'][i % 4]);
    L.append(s);
    const ang = rnd(0, Math.PI * 2), dist = rnd(30, big ? 190 : 120);
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * .7 - rnd(10, 60), drift = rnd(40, 120);
    const dur = rnd(2400, big ? 5200 : 4200), delay = rnd(0, 500);
    s.animate([
      { transform: 'translate(-50%,-50%) scale(0)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .6}px), calc(-50% + ${dy * .6}px)) scale(1.4)`, opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.6)`, opacity: .35, offset: .35 },
      { transform: `translate(calc(-50% + ${dx * 1.05}px), calc(-50% + ${dy + drift * .5}px)) scale(1.1)`, opacity: .95, offset: .55 },
      { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + drift * .8}px)) scale(.5)`, opacity: .3, offset: .78 },
      { transform: `translate(calc(-50% + ${dx * 1.12}px), calc(-50% + ${dy + drift}px)) scale(0)`, opacity: 0 },
    ], { duration: dur, delay, easing: 'ease-out', fill: 'both' }).finished.then(done(s), done(s));
  }
  // a soft shockwave ring
  const w = document.createElement('i');
  w.className = 'fx-wave'; w.style.left = x + 'px'; w.style.top = y + 'px';
  L.append(w);
  w.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .9 }, { transform: `translate(-50%,-50%) scale(${big ? 5 : 3})`, opacity: 0 }], { duration: big ? 1300 : 950, easing: 'cubic-bezier(.2,.7,.3,1)' }).finished.then(done(w), done(w));
}

// big moment (everything done today): confetti rains from the top
export function shower() {
  if (reducedMotion()) return;
  haptic(30);
  for (let k = 0; k < 6; k++) setTimeout(() => burst(rnd(40, innerWidth - 40), rnd(60, innerHeight * .35), { big: true, emoji: ['🎉', '✨', '🥳'][k % 3] }), k * 260);
}

// for elements that are about to be re-rendered: play after the next render
export const queueFx = f => queue.push(f);
export function flushFx() {
  while (queue.length) {
    const f = queue.shift();
    const el = f.sel && document.querySelector(f.sel);
    if (!el || reducedMotion()) continue;
    if (f.type === 'on') el.animate([
      { transform: 'scale(.86)' }, { transform: 'scale(1.16) rotate(-2deg)', offset: .35 }, { transform: 'scale(.96) rotate(1deg)', offset: .65 }, { transform: 'none' },
    ], { duration: 800, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    if (f.type === 'off') el.animate([
      { transform: 'scale(1.05)' }, { transform: 'scale(.9) translateX(3px)', offset: .3 }, { transform: 'translateX(-3px)', offset: .55 }, { transform: 'none' },
    ], { duration: 600, easing: 'ease-out' });
    if (f.type === 'goal') el.animate([
      { boxShadow: '0 0 0 0 rgba(34,192,138,.8)' }, { boxShadow: '0 0 0 14px rgba(34,192,138,0)' },
    ], { duration: 1300, iterations: 2 });
    const knob = el.querySelector('.hc-knob, .hcount b, .hc-lab b');
    if (knob && f.type === 'on') knob.animate([{ transform: 'scale(.3) rotate(-90deg)' }, { transform: 'scale(1.35) rotate(10deg)', offset: .6 }, { transform: 'none' }], { duration: 750, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }
}

// the ring: fill or drain from where it was, and pop when it grows
let lastPct = null;
export function ringFx(pct) {
  const ring = document.querySelector('.ring'), val = ring?.querySelector('.val');
  const prev = lastPct; lastPct = pct;
  if (!val || prev == null || prev === pct || reducedMotion()) return;
  const C = 2 * Math.PI * 40;
  val.setAttribute('opacity', '1');
  val.animate([{ strokeDashoffset: C * (1 - prev) }, { strokeDashoffset: C * (1 - pct) }], { duration: 1400, easing: 'cubic-bezier(.25,1.2,.4,1)' })
    .finished.then(() => { if (!pct) val.setAttribute('opacity', '0'); }, () => {});
  if (pct > prev) {
    ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .3 }, { transform: 'scale(.97)', offset: .6 }, { transform: 'scale(1)' }], { duration: 1000, easing: 'ease-out' });
    ring.querySelector('.ring-ic')?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-18deg) scale(1.2)', offset: .3 }, { transform: 'rotate(12deg)', offset: .6 }, { transform: 'none' }], { duration: 1000 });
    if (pct >= 1 && prev < 1) { const r = ring.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, { big: true, emoji: '🌱' }); setTimeout(shower, 400); }
  } else {
    ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)', offset: .4 }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
  }
}
