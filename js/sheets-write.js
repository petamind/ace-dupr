// Web App URL for the Apps Script backend (apps-script/Code.gs).
// This URL is tied to a specific deployment version in Apps Script.
// If you create a NEW deployment (not a new version of the existing one),
// update this constant and redeploy to GitHub Pages.
// Deploy settings: Execute as Me | Who has access: Anyone (even anonymous)
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxaQx9hNNiMr1ntUjKgAV4QBJY2bPtESPii8jntlHNwjGolRo-SzAEoSy07OM3bggE/exec';

// Retry once on a true network failure (TypeError from fetch — covers CORS
// blocks on a transient header-less response, DNS blips, etc.). Don't retry
// on !res.ok — those are deterministic server-side errors.
async function _retryOnce(fn) {
  try { return await fn(); }
  catch (err) {
    if (!(err instanceof TypeError)) throw err;
    await new Promise(r => setTimeout(r, 600));
    return fn();
  }
}

// Server signals an expired/invalid GIS ID token by returning
// `tokenExpired: true`. When that happens *and* we currently have a saved
// auth, drop it and force a fresh sign-in. If we have no saved auth (e.g.
// the failure happened during the initial sign-in lookup), don't reload —
// that would loop. Just surface the error to the caller.
function _checkTokenExpiry(json) {
  if (!json || !json.tokenExpired) return;
  let hadAuth = false;
  try { hadAuth = !!localStorage.getItem('acedupr:auth'); } catch (_) { /* noop */ }
  if (hadAuth) {
    try { localStorage.removeItem('acedupr:auth'); } catch (_) { /* noop */ }
    alert('Your sign-in session expired. Please sign in again.');
    location.reload();
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
