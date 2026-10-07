// Hebrew dictation: speech → text (browser engine) → {kind, title, date, time}.
import { startOfDay, addDays, ymd } from './util.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

export function listen({ onPartial, onFinal, onError, onEnd }) {
  const r = new SR();
  r.lang = 'he-IL';
  r.interimResults = true;
  r.continuous = false;
  let final = '';
  r.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    onPartial?.(final + interim);
  };
  r.onerror = e => onError?.(e.error);
  r.onend = () => { if (final) onFinal?.(final.trim()); onEnd?.(); };
  r.start();
  return () => r.stop();
}

const DAY_WORDS = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
const NUM_WORDS = {
  'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שלוש': 3, 'ארבע': 4, 'חמש': 5, 'שש': 6, 'שבע': 7,
  'שמונה': 8, 'תשע': 9, 'עשר': 10, 'אחת עשרה': 11, 'אחד עשר': 11, 'שתים עשרה': 12, 'שתיים עשרה': 12,
};
const NUM_RE = Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|');

// Returns { kind: 'task'|'event', title, date: 'YYYY-MM-DD'|null, time: 'HH:MM'|null }
export function parseHebrew(text, now = new Date()) {
  let s = ' ' + text.replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let date = null, time = null;
  const today = startOfDay(now);
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };

  // leading intent phrases
  cut(/^\s*(תזכיר לי|תזכורת:?|תוסיף משימה:?|תוסיף משימה|משימה חדשה|תוסיף ליומן|תקבע לי|קבע לי|תקבע|קבע)\s*/);

  // date
  let m;
  if ((m = cut(/\s(ב?היום)\s/))) date = today;
  else if ((m = cut(/\s(מחרתיים)\s/))) date = addDays(today, 2);
  else if ((m = cut(/\s(ב?מחר)\s/))) date = addDays(today, 1);
  else if ((m = cut(/\s(?:ב?יום\s)?(ה?)(ראשון|שני|שלישי|רביעי|חמישי|שישי)(?:\sהבא)?\s/))) {
    const target = DAY_WORDS[m[2]]; let diff = (target - today.getDay() + 7) % 7 || 7; date = addDays(today, diff);
  } else if ((m = cut(/\s(?:ב|ביום\s)?שבת(?:\sהקרובה|\sהבאה)?\s/))) {
    let diff = (6 - today.getDay() + 7) % 7 || 7; date = addDays(today, diff);
  } else if ((m = cut(/\sבעוד\s(\d+|שבוע|שבועיים|חודש)\s?(ימים|יום)?\s/))) {
    const n = m[1] === 'שבוע' ? 7 : m[1] === 'שבועיים' ? 14 : m[1] === 'חודש' ? 30 : Number(m[1]);
    date = addDays(today, n);
  } else if ((m = cut(/\s(?:בשבוע הבא|שבוע הבא)\s/))) date = addDays(today, 7);
  else if ((m = cut(/\sב[-־]?(\d{1,2})[./](\d{1,2})\s/))) {
    date = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[1]));
    if (date < today) date.setFullYear(date.getFullYear() + 1);
  }

  // time
  if ((m = cut(/\s(?:ב|בשעה\s?|ב[-־])\s?(\d{1,2})(?::(\d{2}))?\s?(בבוקר|בערב|בלילה|בצהריים|אחר הצהריים|אחה״צ|אחה"צ)?\s/))) {
    time = toTime(Number(m[1]), Number(m[2] || 0), m[3]);
  } else if ((m = cut(new RegExp(`\\s(?:ב|בשעה\\s)(${NUM_RE})(?:\\sו(חצי|רבע))?\\s?(בבוקר|בערב|בלילה|בצהריים|אחר הצהריים)?\\s`)))) {
    time = toTime(NUM_WORDS[m[1]], m[2] === 'חצי' ? 30 : m[2] === 'רבע' ? 15 : 0, m[3]);
  }

  const title = s.replace(/\s+/g, ' ').trim();
  return { kind: time ? 'event' : 'task', title: title || text.trim(), date: date ? ymd(date) : (time ? ymd(today) : null), time };
}

function toTime(h, min, part) {
  if (part && /ערב|לילה|צהריים|אחה/.test(part) && h < 12) h += 12;
  else if (!part && h >= 1 && h <= 7) h += 12; // "ב-5" most likely means 17:00
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
