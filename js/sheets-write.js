// Paste your Apps Script Web App URL here after deploying apps-script/Code.gs.
// Deploy settings: Execute as Me | Who has access: Anyone (even anonymous)
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxaQx9hNNiMr1ntUjKgAV4QBJY2bPtESPii8jntlHNwjGolRo-SzAEoSy07OM3bggE/exec';

async function _get(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`);
  return res.json();
}

async function _post(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight OPTIONS
    body: JSON.stringify(body),
  });
  return res.json();
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
};
