import Data from './data.js';

// Web App URL for the Apps Script backend (apps-script/Code.gs).
// This URL is tied to a specific deployment version in Apps Script.
// If you create a NEW deployment (not a new version of the existing one),
// update this constant and redeploy to GitHub Pages.
// Deploy settings: Execute as Me | Who has access: Anyone (even anonymous)
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxaQx9hNNiMr1ntUjKgAV4QBJY2bPtESPii8jntlHNwjGolRo-SzAEoSy07OM3bggE/exec';

// Retry on a true network failure (TypeError from fetch — CORS blocks on a
// transient header-less response, DNS blips, etc.) and on server-side
// 5xx / 429 responses (Apps Script cold starts and tokeninfo upstreams both
// surface as 5xx). One retry only — anything still failing surfaces.
async function _retryOnce(fn) {
  try { return await fn(); }
  catch (err) {
    const isNetwork = err instanceof TypeError;
    const isRetriableStatus = err.message && /^Server error (5\d\d|429)$/.test(err.message);
    if (!isNetwork && !isRetriableStatus) throw err;
    console.warn('SheetsWrite: retrying after', err.message);
    await new Promise(r => setTimeout(r, 700));
    return fn();
  }
}

// Fires at most once per page lifetime so concurrent in-flight writes don't
// stack alerts/banners on top of each other when the token expires.
let _authExpiredHandled = false;

// Server signals an expired/invalid GIS ID token by returning
// `tokenExpired: true`. Clear the cache and dispatch an event so ui.js can
// render a non-destructive "session expired — reload to sign in" banner.
// Intentionally does NOT auto-reload — that would blow away unsaved form
// state. The user reloads on their own terms via the banner.
function _checkTokenExpiry(json) {
  if (!json || !json.tokenExpired) return;
  if (_authExpiredHandled) throw new Error('Session expired');
  _authExpiredHandled = true;
  if (Data.loadAuth()) Data.clearAuth();
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('acedupr:auth-expired'));
  }
  throw new Error('Session expired');
}

async function _post(body) {
  return _retryOnce(async () => {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight OPTIONS;
      // Apps Script reads body as e.postData.contents (string) — see Code.gs doPost()
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const json = await res.json();
    _checkTokenExpiry(json);
    return json;
  });
}

export const SheetsWrite = {
  async lookup(idToken) {
    return _post({ action: 'lookup', idToken });
  },

  async mapEmail(idToken, playerName) {
    return _post({ action: 'mapEmail', idToken, playerName });
  },

  async addMatch(idToken, match) {
    return _post({ action: 'addMatch', idToken, match });
  },

  async editMatch(idToken, oldMatch, newMatch) {
    return _post({ action: 'editMatch', idToken, oldMatch, newMatch });
  },

  async deleteMatch(idToken, match) {
    return _post({ action: 'deleteMatch', idToken, match });
  },

  async saveQuote(idToken, playerName, quote) {
    return _post({ action: 'saveQuote', idToken, playerName, quote });
  },

  async addMember(idToken, member) {
    return _post({ action: 'addMember', idToken, member });
  },
};
