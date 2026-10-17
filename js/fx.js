// Celebration effects: confetti bursts, a button pop, and the progress ring filling (or draining) live.
// The list re-renders on every change, so effects for re-rendered elements are queued and played after render.
import { reducedMotion, haptic } from './util.js';

const COLORS = ['#3cc4dc', '#22c08a', '#ffd84d', '#ff7aa2', '#8f6ee8', '#ffffff', '#f28b38'];
const DARK = ['#2a0f1f', '#4b1030', '#1c2b16', '#3b1a5a', '#14101c', '#5a0f14', '#2d3a12'];
const ANGRY = ['😠', '😡', '👿', '💀', '😤', '👎', '🖤', '☠️'];
const queue = [];
let layer = null;
const getLayer = () => {
  if (!layer || !layer.isConnected) { layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer); }
  return layer;
};
const rnd = (a, b) => a + Math.random() * (b - a);

// confetti + a few emojis flying out of (x, y), then drifting down slowly like fairy dust
export function burst(x, y, { emoji = '', big = false, dark = false } = {}) {
  if (reducedMotion()) return;
  if (dark) return cursed(x, y, emoji);
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

// the opposite: a counted slip. Dark bits sink heavily, angry faces rise and wobble,
// and the fairy dust is still there but turned bad: violet, toxic green and blood red, flickering, with smoke
function cursed(x, y, emoji) {
  const L = getLayer(), done = el => () => el.remove();
  const T = (tx, ty, sc, r) => `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${sc}) rotate(${r}deg)`;
  // smoke
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('i'); s.className = 'fx-smoke';
    s.style.left = x + rnd(-16, 16) + 'px'; s.style.top = y + rnd(-8, 8) + 'px'; L.append(s);
    const dx = rnd(-50, 50), dy = rnd(-90, -30);
    s.animate([{ transform: T(0, 0, .3, 0), opacity: 0 }, { transform: T(dx * .4, dy * .4, 1.4, 20), opacity: .75, offset: .25 }, { transform: T(dx, dy, 2.6, 60), opacity: 0 }],
      { duration: rnd(1800, 2800), delay: rnd(0, 250), easing: 'ease-out', fill: 'both' }).finished.then(done(s), done(s));
  }
  // heavy dark shards that drop
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i'); p.className = `fx-bit ${['sq', 'rd', 'ln'][i % 3]}`;
    p.style.background = DARK[i % DARK.length]; p.style.boxShadow = '0 0 4px rgba(120,20,60,.6)';
    p.style.left = x + 'px'; p.style.top = y + 'px'; L.append(p);
    const ang = rnd(Math.PI * .1, Math.PI * .9) * (Math.random() < .25 ? -1 : 1), dist = rnd(30, 90);
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * .5, fall = rnd(160, 320), rot = rnd(-200, 200);
    p.animate([{ transform: T(0, 0, .3, 0), opacity: 1 }, { transform: T(dx, dy, 1, rot * .3), opacity: 1, offset: .15 },
      { transform: T(dx * 1.1, dy + fall * .6, .9, rot * .7), opacity: .8, offset: .6 }, { transform: T(dx * 1.15, dy + fall, .7, rot), opacity: 0 }],
      { duration: rnd(2200, 3400), easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' }).finished.then(done(p), done(p));
  }
  // angry faces (and the habit's own emoji) rising slowly, shaking
  const faces = [emoji, ...ANGRY.sort(() => Math.random() - .5).slice(0, 3)].filter(Boolean);
  faces.forEach((f, i) => {
    const e = document.createElement('i'); e.className = 'fx-emo fx-bad'; e.textContent = f;
    e.style.left = x + 'px'; e.style.top = y + 'px'; L.append(e);
    const dx = rnd(-70, 70), up = rnd(70, 130), w = rnd(6, 12);
    e.animate([{ transform: T(0, 0, .2, 0), opacity: 0 }, { transform: T(dx * .5, -up * .4, 1.4, -w), opacity: 1, offset: .18 },
      { transform: T(dx * .6 + w, -up * .55, 1.25, w), offset: .3 }, { transform: T(dx * .7 - w, -up * .7, 1.2, -w), offset: .42 },
      { transform: T(dx * .8 + w, -up * .82, 1.15, w), opacity: .9, offset: .55 }, { transform: T(dx, -up, 1, 0), opacity: 0 }],
      { duration: rnd(2600, 3600), delay: i * 120, easing: 'ease-out', fill: 'both' }).finished.then(done(e), done(e));
  });
  // cursed dust: flickers on and off, drifts down and sideways like ash
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('i'); s.className = 'fx-spark';
    s.style.left = x + rnd(-26, 26) + 'px'; s.style.top = y + rnd(-14, 14) + 'px';
    s.style.setProperty('--c', ['#9b3cff', '#7dff4a', '#ff2a4d', '#5b2a86'][i % 4]);
    L.append(s);
    const ang = rnd(0, Math.PI * 2), dist = rnd(30, 130), dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * .6, sink = rnd(40, 140);
    s.animate([{ transform: 'translate(-50%,-50%) scale(0)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .5}px), calc(-50% + ${dy * .5}px)) scale(1.3)`, opacity: 1, offset: .12 },
      { transform: `translate(calc(-50% + ${dx * .7}px), calc(-50% + ${dy * .7}px)) scale(.4)`, opacity: .1, offset: .22 },
      { transform: `translate(calc(-50% + ${dx * .85}px), calc(-50% + ${dy + sink * .3}px)) scale(1.2)`, opacity: 1, offset: .34 },
      { transform: `translate(calc(-50% + ${dx * .9}px), calc(-50% + ${dy + sink * .45}px)) scale(.5)`, opacity: .15, offset: .46 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + sink * .7}px)) scale(1)`, opacity: .85, offset: .62 },
      { transform: `translate(calc(-50% + ${dx * 1.05}px), calc(-50% + ${dy + sink}px)) scale(0)`, opacity: 0 }],
      { duration: rnd(2800, 4600), delay: rnd(0, 400), easing: 'ease-in-out', fill: 'both' }).finished.then(done(s), done(s));
  }
  // a dark pulse instead of the bright shockwave
  const w = document.createElement('i'); w.className = 'fx-wave fx-wave-bad'; w.style.left = x + 'px'; w.style.top = y + 'px'; L.append(w);
  w.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .95 }, { transform: 'translate(-50%,-50%) scale(3.4)', opacity: 0 }], { duration: 1400, easing: 'cubic-bezier(.2,.7,.3,1)' }).finished.then(done(w), done(w));
  // a brief dim of the whole screen
  const v = document.createElement('i'); v.className = 'fx-vignette'; L.append(v);
  v.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 0 }], { duration: 1600, easing: 'ease-out' }).finished.then(done(v), done(v));
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
    if (f.type === 'cursed') {
      el.animate([{ transform: 'scale(.92)' }, { transform: 'translateX(-5px) rotate(-1.5deg)', offset: .15 }, { transform: 'translateX(5px) rotate(1.5deg)', offset: .3 },
        { transform: 'translateX(-4px)', offset: .45 }, { transform: 'translateX(3px)', offset: .6 }, { transform: 'none' }], { duration: 700, easing: 'ease-out' });
      el.animate([{ boxShadow: '0 0 0 0 rgba(120,20,90,.9)', filter: 'saturate(.3) brightness(.7)' }, { boxShadow: '0 0 18px 6px rgba(80,0,60,0)', filter: 'none' }], { duration: 1500, easing: 'ease-out' });
    }
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
