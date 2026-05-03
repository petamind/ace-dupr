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

async function _get(params) {
  const qs = new URLSearchParams(params).toString();
  return _retryOnce(async () => {
    const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    return res.json();
  });
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
    return res.json();
  });
}

export const SheetsWrite = {
  async lookup(email) {
    return _get({ action: 'lookup', email });
  },

  async mapEmail(email, playerName) {
    return _post({ action: 'mapEmail', email, playerName });
  },

  async addMatch(email, match) {
    return _post({ action: 'addMatch', email, match });
  },

  async editMatch(email, oldMatch, newMatch) {
    return _post({ action: 'editMatch', email, oldMatch, newMatch });
  },

  async deleteMatch(email, match) {
    return _post({ action: 'deleteMatch', email, match });
  },

  async saveQuote(email, playerName, quote) {
    return _post({ action: 'saveQuote', email, playerName, quote });
  },
};
