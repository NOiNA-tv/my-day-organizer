// Live backend: Google Calendar, Tasks and Gmail REST APIs, called straight from the browser.
import { auth } from './auth.js';
import { ymd, fromYmd, startOfDay } from './util.js';

export class AuthError extends Error {}

async function g(url, opts = {}) {
  const token = auth.token;
  if (!token) throw new AuthError('no token');
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (res.status === 401) throw new AuthError('expired');
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* not json */ }
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

function normEvent(e, cal) {
  const allDay = !!e.start?.date;
  const start = allDay ? fromYmd(e.start.date) : new Date(e.start.dateTime);
  const end = allDay ? fromYmd(e.end.date) : new Date(e.end?.dateTime || e.start.dateTime);
  let reminder = null, reminderIsDefault = false;
  if (e.reminders?.useDefault) {
    reminderIsDefault = true;
    reminder = cal.defaultReminders?.find(r => r.method === 'popup')?.minutes ?? null;
  } else {
    reminder = e.reminders?.overrides?.find(r => r.method === 'popup')?.minutes ?? null;
  }
  return {
    id: e.id, calId: cal.id, title: e.summary || '(ללא כותרת)', start, end, allDay,
    location: e.location || '', description: e.description || '', htmlLink: e.htmlLink,
    reminder, reminderIsDefault, canEdit: ['owner', 'writer'].includes(cal.accessRole),
    birthday: e.eventType === 'birthday' || /#contacts@|#birthdays/.test(cal.id) || /יום הולדת|יום־הולדת|birthday|🎂/i.test(e.summary || ''),
    meet: e.hangoutLink || e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri || '',
  };
}

function normTask(t, list) {
  return {
    id: t.id, listId: list.id, listTitle: list.title, title: t.title || '', notes: t.notes || '',
    due: t.due ? t.due.slice(0, 10) : null, status: t.status, completed: t.completed || null,
    parent: t.parent || null, position: t.position, webLink: t.webViewLink || 'https://tasks.google.com/',
    links: (t.links || []).map(l => ({ type: l.type, description: l.description || '', link: l.link })), updated: t.updated,
    subtasks: [],
  };
}

export const google = {
  live: true,

  async profile() {
    const p = await g('https://openidconnect.googleapis.com/v1/userinfo');
    return { email: p.email, name: p.given_name || p.name || '' };
  },

  async calendars() {
    const r = await g(`${CAL}/users/me/calendarList?${qs({ minAccessRole: 'reader', maxResults: 250 })}`);
    return (r.items || []).filter(c => !c.deleted).map(c => ({
      id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary,
      accessRole: c.accessRole, defaultReminders: c.defaultReminders || [], hidden: !!c.hidden,
    }));
  },

  async events(cals, from, to) {
    const lists = await Promise.all(cals.map(async cal => {
      try {
        const r = await g(`${CAL}/calendars/${encodeURIComponent(cal.id)}/events?${qs({
          timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: 250,
        })}`);
        return (r.items || []).filter(e => e.status !== 'cancelled').map(e => normEvent(e, cal));
      } catch (err) { if (err instanceof AuthError) throw err; console.warn('calendar failed', cal.name, err); return []; }
    }));
    return lists.flat();
  },

  async setReminder(ev, minutes) {
    const body = { reminders: minutes === 'default' ? { useDefault: true } : { useDefault: false, overrides: minutes == null ? [] : [{ method: 'popup', minutes }] } };
    await g(`${CAL}/calendars/${encodeURIComponent(ev.calId)}/events/${ev.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteEvent(ev) {
    await g(`${CAL}/calendars/${encodeURIComponent(ev.calId)}/events/${ev.id}`, { method: 'DELETE' });
  },

  async createEvent({ calId, title, start, end, allDay, location, description, reminder }) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const body = {
      summary: title, location, description,
      start: allDay ? { date: ymd(start) } : { dateTime: start.toISOString(), timeZone: tz },
      end: allDay ? { date: ymd(end) } : { dateTime: end.toISOString(), timeZone: tz },
    };
    if (reminder !== 'default') body.reminders = { useDefault: false, overrides: reminder == null ? [] : [{ method: 'popup', minutes: reminder }] };
    return g(`${CAL}/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify(body) });
  },

  async taskLists() {
    const r = await g(`${TASKS}/users/@me/lists?maxResults=100`);
    return (r.items || []).map(l => ({ id: l.id, title: l.title }));
  },

  async tasks(lists) {
    const todayIso = startOfDay(new Date()).toISOString();
    const all = await Promise.all(lists.map(async list => {
      const out = [];
      let pageToken = '';
      do {
        const r = await g(`${TASKS}/lists/${list.id}/tasks?${qs({ showCompleted: 'false', maxResults: 100, pageToken })}`);
        out.push(...(r.items || []));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      const done = await g(`${TASKS}/lists/${list.id}/tasks?${qs({ showCompleted: 'true', showHidden: 'true', completedMin: todayIso, maxResults: 100 })}`);
      out.push(...(done.items || []).filter(t => t.status === 'completed'));
      return out.map(t => normTask(t, list));
    }));
    return all.flat();
  },

  async createTask({ listId, title, notes, due, parent }) {
    const body = { title, notes: notes || undefined, due: due ? `${due}T00:00:00.000Z` : undefined };
    const t = await g(`${TASKS}/lists/${listId}/tasks?${qs({ parent })}`, { method: 'POST', body: JSON.stringify(body) });
    return t.id;
  },

  async patchTask(task, fields) {
    const body = {};
    if ('title' in fields) body.title = fields.title;
    if ('notes' in fields) body.notes = fields.notes;
    if ('due' in fields) body.due = fields.due ? `${fields.due}T00:00:00.000Z` : null;
    if ('status' in fields) { body.status = fields.status; if (fields.status === 'needsAction') body.completed = null; }
    await g(`${TASKS}/lists/${task.listId}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteTask(task) {
    await g(`${TASKS}/lists/${task.listId}/tasks/${task.id}`, { method: 'DELETE' });
  },

  async emails(q, max = 15) {
    const r = await g(`${GMAIL}/messages?${qs({ q, maxResults: max })}`);
    const ids = (r.messages || []).map(m => m.id);
    const msgs = await Promise.all(ids.map(id =>
      g(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
    return msgs.map(m => {
      const h = n => m.payload?.headers?.find(x => x.name.toLowerCase() === n)?.value || '';
      const from = h('from');
      return {
        id: m.id, threadId: m.threadId, subject: h('subject') || '(ללא נושא)',
        from: from.replace(/<.*>/, '').replace(/"/g, '').trim() || from, fromEmail: (from.match(/<(.+)>/) || [, from])[1],
        snippet: decodeEntities(m.snippet || ''), date: new Date(Number(m.internalDate)),
        unread: m.labelIds?.includes('UNREAD'), starred: m.labelIds?.includes('STARRED'), labelIds: m.labelIds || [],
        link: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
      };
    });
  },

  async labels() {
    const r = await g(`${GMAIL}/labels`);
    return (r.labels || []).filter(l => l.type === 'user').map(l => ({ id: l.id, name: l.name, color: l.color?.backgroundColor || null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  },

  async trashEmail(e) { await g(`${GMAIL}/messages/${e.id}/trash`, { method: 'POST' }); },
  async untrashEmail(e) { await g(`${GMAIL}/messages/${e.id}/untrash`, { method: 'POST' }); },

  async modifyEmail(e, { add = [], remove = [] }) {
    await g(`${GMAIL}/messages/${e.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
  },
};

function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}
