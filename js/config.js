// Paste the OAuth Client ID from Google Cloud Console here.
// It's public by design for browser apps (no secret lives in this repo).
export const CLIENT_ID = '233383899884-4hpmsqe1r0l6q16iaopnkqu16it7hvpp.apps.googleusercontent.com';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Must match "Authorized redirect URIs" in the Google client, character for character.
export const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, '');

// Web Push public key (VAPID). The private half lives only in a GitHub Actions secret.
export const VAPID_PUBLIC_KEY = 'BO3LhTyykcgc9YcqYjOGkLZvleN10ViGZyqvhYMHM_iOx3o8HKDxdw5T5hjDnLN0wgGLxAM8YLnPFTTcaSoABoA';

export const DIGEST_URL = '/design-digest/';
