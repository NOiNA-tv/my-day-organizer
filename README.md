# מה איתי היום? · my-day-organizer

A phone-first daily command center in Hebrew: Google Calendar + Google Tasks + Gmail in one screen, plus a swipeable "sort out the day" wizard.

**Live:** https://noina-tv.github.io/my-day-organizer/

## What's inside
- `index.html`, `css/app.css`, `js/*` — a no-build PWA (plain ES modules), installable to the home screen
- `js/auth.js` — Google OAuth (browser redirect flow, no server, no secret)
- `js/google.js` — Calendar / Tasks / Gmail REST calls; `js/demo.js` — the same interface with sample data
- `js/wizard.js` — morning / evening / mail card decks
- `sw.js` — offline shell + push notifications
- `.github/workflows/daily-push.yml` + `push/send.mjs` — sends the 07:30 and 20:30 nudges

## Settings that live outside the code
- Google Cloud project `my-day-organizer`: Calendar, Tasks and Gmail APIs on; OAuth client (Web) with
  origin `https://noina-tv.github.io` and redirect `https://noina-tv.github.io/my-day-organizer/`; app in *Testing* with the owner as test user.
- GitHub secret `VAPID_PRIVATE_KEY` (Settings → Secrets and variables → Actions) for push.
- Device subscriptions for push: `push/subscriptions.json`.

## Deep links
`./?wizard=morning` · `./?wizard=evening` · `./?wizard=mail`
