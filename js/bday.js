// Birthdays → a WhatsApp chat with the right person.
// Phone comes from (1) a number you set or fixed here, (2) the Google contact the birthday belongs to,
// (3) a contact search by the name in the title. Unknown or wrong → pick from the phone's contacts or type a number.
import { icon } from './icons.js';
import { state, api } from './data.js';
import { H, setContact } from './habits.js';
import { openSheet, paintSheet, closeSheet } from './overlay.js';
import { esc, haptic } from './util.js';
import { auth } from './auth.js';

// "יום ההולדת של נועה" / "Noa's birthday" / "🎂 יום הולדת לנועה" → "נועה"
export function nameFromTitle(t = '') {
  let s = String(t).replace(/[🎂🎉🥳🎈]/gu, '').trim();
  s = s.replace(/^(יום[\s־-]*(ה)?הולדת|יומולדת|יום הולדת שמח)\s*(של|ל|ל־|ל-)?\s*/u, '');
  s = s.replace(/^ל(?=[֐-׿])/u, m => m); // keep names that start with ל
  s = s.replace(/[’']s birthday$/i, '').replace(/\s*birthday$/i, '').replace(/^happy birthday,?\s*/i, '');
  s = s.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*-\s*\d+$/, '').trim();
  return s || String(t).trim();
}
const keyOf = ev => ev.contactRef || `name:${nameFromTitle(ev.title)}`;

// Israeli-friendly normalisation to wa.me digits
export function waDigits(phone) {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  return d.length >= 9 ? d : '';
}
const pretty = phone => { const d = waDigits(phone); return d.startsWith('972') ? '0' + d.slice(3).replace(/(\d{2})(\d{3})(\d+)/, '$1-$2-$3') : '+' + d; };
export const waLink = (phone, name) => `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(`מלאאאן מזל טוב${name ? `, ${name.split(' ')[0]}` : ''}!\n✨🎉🥳🎂🎊🎈`)}`;

const cache = new Map(); // key → { name, phones } | null
async function lookup(ev) {
  const key = keyOf(ev);
  if (H.contacts[key]?.phone) return { name: H.contacts[key].name, phones: [H.contacts[key].phone], manual: true };
  if (cache.has(key)) return cache.get(key);
  let found = null, needsAccess = false;
  try {
    if (ev.contactRef) { const p = await api().person(ev.contactRef); if (p.phones.length) found = p; }
    if (!found) { const r = await api().searchContacts(nameFromTitle(ev.title)); found = r.find(x => x.phones.length) || null; }
  } catch (e) {
    if (/insufficient|scope|403|has not been used|disabled/i.test(e.message)) needsAccess = /has not been used|disabled/i.test(e.message) ? 'api' : 'scope';
    console.warn('contacts', e.message);
  }
  const res = found ? { ...found } : needsAccess ? { needsAccess } : null;
  if (!needsAccess) cache.set(key, res);
  return res;
}

// tap on a birthday: straight into WhatsApp when we know the number; otherwise ask
export async function openBirthday(ev) {
  haptic(8);
  const r = await lookup(ev);
  if (r?.phones?.length && !r.needsAccess) { location.href = waLink(r.phones[0], r.name || nameFromTitle(ev.title)); return; }
  editBirthday(ev, r);
}

// set / fix who this birthday belongs to (long-press, or when nothing was found)
export async function editBirthday(ev, pre) {
  const key = keyOf(ev), name = nameFromTitle(ev.title);
  const f = { phone: H.contacts[key]?.phone || '', label: H.contacts[key]?.name || '' };
  let r = pre === undefined ? null : pre, loading = pre === undefined;
  const canPick = 'contacts' in navigator && 'select' in (navigator.contacts || {});
  openSheet(() => `
    <h3>🎂 יום הולדת ל${esc(name)}</h3>
    ${loading ? '<p class="sub">מחפש באנשי הקשר…</p>' : r?.needsAccess === 'scope' ? `<div class="banner"><div><b>גישה לאנשי הקשר</b>כדי למצוא את המספר לבד צריך לאשר לאפליקציה לקרוא את אנשי הקשר בגוגל.</div><button class="btn primary sm" data-bd-connect>אישור</button></div>`
      : r?.needsAccess === 'api' ? `<div class="banner err"><div><b>צריך להפעיל את People API</b>בגוגל קלאוד, באותו פרויקט. <a href="https://console.cloud.google.com/apis/library/people.googleapis.com" target="_blank" rel="noopener">להפעלה ↗</a></div></div>`
      : r?.phones?.length ? `<p class="sub">נמצא: <b>${esc(r.name || name)}</b> · <span class="ltr">${esc(pretty(r.phones[0]))}</span>${r.manual ? ' (נקבע כאן)' : ''}</p>` : `<p class="sub">לא מצאתי מספר ל${esc(name)} באנשי הקשר.</p>`}
    ${r?.phones?.length ? `<a class="btn primary wa-btn" href="${esc(waLink(r.phones[0], r.name || name))}">${icon('send')}לשלוח ברכה בוואטסאפ</a>` : ''}
    <div class="field-label">${r?.phones?.length ? 'לא נכון? מספר אחר' : 'מספר הטלפון'}</div>
    ${canPick ? `<button class="btn grow" data-bd-pick>${icon('users')}בחירה מאנשי הקשר בטלפון</button>` : ''}
    <input class="inp ltr-inp" type="tel" inputmode="tel" data-key="phone" value="${esc(f.phone)}" placeholder="050-0000000" aria-label="מספר טלפון" style="margin-top:8px">
    <div class="actions">
      <button class="btn primary grow" data-bd-save ${waDigits(f.phone) ? '' : 'disabled'}>${icon('check')}שמירה ופתיחת וואטסאפ</button>
      ${H.contacts[key] ? `<button class="btn" data-bd-clear>${icon('x')}לשכוח</button>` : ''}
    </div>
    <p class="small-print">המספר נשמר לאירוע הזה (ולשנים הבאות) בגיליון ההרגלים, בלשונית ״אנשי קשר״. לחיצה ארוכה על יום ההולדת פותחת את המסך הזה שוב.</p>`);
  if (loading) { r = await lookup(ev); loading = false; paintSheet(); }
  const el = document.querySelector('.sheet');
  el.addEventListener('input', e => { if (e.target.dataset.key === 'phone') { f.phone = e.target.value; el.querySelector('[data-bd-save]').disabled = !waDigits(f.phone); } });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if ('bdConnect' in b.dataset) { auth.login({ silent: false }); return; }
    if ('bdPick' in b.dataset) {
      try {
        const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (c?.tel?.length) { f.phone = c.tel[0]; f.label = c.name?.[0] || name; setContact(key, { name: f.label, phone: f.phone }); closeSheet(); location.href = waLink(f.phone, f.label); }
      } catch { /* cancelled */ }
      return;
    }
    if ('bdSave' in b.dataset && waDigits(f.phone)) { setContact(key, { name: f.label || name, phone: f.phone }); closeSheet(); location.href = waLink(f.phone, name); return; }
    if ('bdClear' in b.dataset) { setContact(key, null); cache.delete(key); closeSheet(); }
  });
}

// for the notification: who and which number, without asking anything
export async function birthdayContact(ev) {
  const r = await lookup(ev).catch(() => null);
  const name = (r?.name || nameFromTitle(ev.title)).split(' ')[0];
  return r?.phones?.length && !r.needsAccess ? { name, phone: r.phones[0], wa: waLink(r.phones[0], name) } : { name };
}
export const birthdayById = id => state.events.find(e => e.id === id);
