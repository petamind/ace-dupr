# Plan: Google Auth + Player Mapping + Match Entry via Google Sheets

**Status:** Draft — awaiting user review before implementation.

---

## Constraints This Spec Must Respect

1. Players Tab 1 columns currently: `[col0]=name [col1]=gender [col2]=joined_date [col3]=active` (data.js:279-290). Email will become col5 (1-indexed) = array index 4.
2. Player ID format: `'f:' + name.toLowerCase()` (data.js:285) — must stay stable; do not derive IDs from email.
3. All localStorage writes must go through `data.js` — no direct `localStorage.*` calls elsewhere (CLAUDE.md Hard Rule + patterns.md).
4. No existing write path to Google Sheets — Google Apps Script will be the write gateway.
5. Match form JS already exists in ui.js:558-662 but `#match-form` HTML element is **absent** from matches.html — form is currently dormant.
6. `initMatches()` at ui.js:529 does NOT call `_populateMatchForm()` or `_wireMatchForm()` — both functions are dead code until this feature activates them.
7. Modals are created dynamically (pattern: `_showEditModal`, ui.js:747-851) — mapping modal must follow this same pattern.
8. Nav bar is copy-pasted across all HTML files (index.html:41-49, matches.html:40-48, leaderboard.html, player.html, about.html, settings.html) — all must be updated.
9. Current `_wireMatchForm` submits via `Data.addMatch()` (localStorage, data.js:51) — must be replaced with Apps Script call when in Sheets mode.
10. `DataSheets.invalidateCache()` at data.js:258 clears the 30-min sessionStorage cache — must call after successful match submission so next load shows the new match.
11. The sheet ID is `1YMOIn2DFTMET8dpVmr7FC82sqm2UywsL7zEWgjhS3E4` (data.js:250). Matches tab GID is `387653111` (data.js:251).

---

## Objective

Enable Google OAuth login for club members on this static site. On first login, users map their Google account to an existing player name in the Google Sheet Tab 1. Their email is written back to the sheet. On subsequent logins, the email lookup skips mapping. Once authenticated and mapped, users can submit match results from the Matches page, which are appended to the Google Sheet's matches tab via a Google Apps Script web app.

---

## Acceptance Criteria

| AC | Description | Verify | Expected | Automated |
|----|-------------|--------|----------|-----------|
| AC1 | Login button visible in nav when not authenticated | Open matches.html, inspect nav | "Sign in with Google" button present | No |
| AC2 | After login, user name shown in nav | Login → check nav | Player name + logout link displayed | No |
| AC3 | First-time login triggers mapping modal | Login with unmapped email | Modal appears with player dropdown and confirm button | No |
| AC4 | Mapping writes email to sheet | Complete mapping → check Google Sheet Tab 1 | Email appears in col E of matched player row | No |
| AC5 | Known email skips mapping | Login with previously mapped email | No mapping modal — match form shown directly | No |
| AC6 | Match form present in matches.html | `grep -c 'id="match-form"' matches.html` | `1` | Yes |
| AC7 | Match form only visible when logged in and mapped | Check matches.html when logged out | Form section hidden; login prompt shown instead | No |
| AC8 | Match submission appends row to Google Sheet | Submit match → check Sheet matches tab | New row with correct date/category/players/scores | No |
| AC9 | Cache invalidated after match submission | Submit match → `sessionStorage.getItem('acedupr:sheets-cache')` in console | `null` | No |
| AC10 | Auth state persists across page reload | Login → reload → check nav | User still shown as logged in | No |
| AC11 | Logout clears auth state | Click logout → `localStorage.getItem('acedupr:auth')` in console | `null` | No |
| AC12 | No direct localStorage calls outside data.js | `grep -rn "localStorage\." js/ \| grep -v "data.js"` | Zero matches | Yes |

---

## Technical Design

### Current Flow
- **Read**: Sheets CSV export (public) → PapaParse → sessionStorage (30-min cache) → rendered
- **Write**: `Data.addMatch()` → localStorage only
- **Auth**: None — site is fully public read-only

### New Flow
```
Visit site
  → auth.js checks localStorage acedupr:auth
  → if auth exists: show user in nav, show match form on matches.html
  → if no auth: show "Sign in with Google" button in nav

Sign in clicked
  → Google Identity Services (GIS) popup
  → returns credential JWT
  → auth.js decodes JWT (client-side) → extracts { email, name, picture }
  → SheetsWrite.lookup(email) → GET to Apps Script
    → if found: save auth state (with mappedPlayerId) → show match form
    → if not found: show mapping modal

Mapping modal
  → dropdown of all current players (from already-loaded players array)
  → user selects their name → confirm
  → SheetsWrite.mapEmail(email, playerName) → POST to Apps Script
  → Apps Script writes email into player row col5
  → save auth state locally → hide modal → show match form

Match submission (matches.html only)
  → user fills match form
  → SheetsWrite.addMatch(email, match) → POST to Apps Script
  → Apps Script validates email is in sheet → appendRow to matches tab
  → DataSheets.invalidateCache()
  → _showToast('Match added.')
  → re-render match history
```

### Key Design Decisions

1. **JWT decoded client-side**: GIS returns a credential JWT. We decode the payload (base64 split on `.`) to extract email/name/picture. No server-side verification needed — this is a club internal tool, not a financial system.

2. **CORS for Apps Script writes**: Use `Content-Type: text/plain` (not `application/json`) on POST requests. This makes it a "simple request" per the CORS spec, avoiding a preflight OPTIONS request that Apps Script cannot handle. Apps Script reads the body via `e.postData.contents` regardless of content type.

3. **Mapping modal pattern**: Follow `_showEditModal` (ui.js:747) — create DOM dynamically, append to `document.body`, remove on cancel/confirm. No HTML changes needed for the modal itself.

4. **Match form activation**: `initMatches()` (ui.js:529) currently never calls `_populateMatchForm()` or `_wireMatchForm()`. This plan adds a login-gated call: if auth state exists, call both; if not, render a "Sign in to enter results" card above the history table.

5. **Sheets mode vs. local mode**: `_wireMatchForm()` gains awareness of mode. When mode is `'sheets'` (which is always the case in production), submit goes to Apps Script. When mode is `'local'` (dev/demo), fall back to `Data.addMatch()`. Check mode from a module-level variable set during `initMatches()`.

6. **Apps Script URL**: Stored as a named constant in `js/sheets-write.js`. User must deploy their own Apps Script and paste the URL. This URL is NOT secret (it's a public endpoint that validates the email), so committing it is acceptable.

7. **Player name → match row**: Apps Script writes player names (not IDs) to the matches sheet, consistent with the existing matches tab column schema that `_frow()` (data.js:175) already parses.

---

## Interface Contracts

### Auth State Object
Stored at `acedupr:auth` via `data.js`.
```javascript
{
  email: string,             // 'user@gmail.com'
  name: string,              // 'John Smith' (from Google)
  picture: string,           // 'https://...' (Google avatar URL)
  mappedPlayerId: string,    // 'f:john smith'
  mappedPlayerName: string,  // 'John Smith' (as in the sheet)
}
```

### Apps Script Endpoints

**GET** `?action=lookup&email=x@y.com`
```javascript
// success — email found in sheet
{ found: true, playerId: 'f:john smith', playerName: 'John Smith' }
// email not in sheet
{ found: false }
```

**POST** body: `text/plain`, contents: JSON string
```javascript
// Map email to player
{ action: 'mapEmail', email: 'x@y.com', playerName: 'John Smith' }
→ { ok: true }
→ { ok: false, error: 'Player already claimed.' }
→ { ok: false, error: 'Player not found.' }

// Add match
{ action: 'addMatch', email: 'x@y.com', match: {
    date: 'YYYY-MM-DD',
    category: 'MD'|'WD'|'XD'|'MS'|'WS',
    matchType: 'tournament'|'club'|'recreational',
    teamA: ['PlayerName1', 'PlayerName2?'],  // names as in sheet
    teamB: ['PlayerName1', 'PlayerName2?'],
    scoreA: number,
    scoreB: number,
    notes: string,  // may be ''
  }
}
→ { ok: true }
→ { ok: false, error: 'Unauthorized.' }
```

### New Functions in data.js
```javascript
// Added to KEYS (data.js:4-8):
auth: 'acedupr:auth',

// New exported functions:
export function loadAuth()        // returns object | null
export function saveAuth(auth)    // void
export function clearAuth()       // void
```

### New Module: js/auth.js
```javascript
// Decodes Google GIS credential JWT (no validation, club-trust model)
export function decodeJwt(credential)
  // → { email: string, name: string, picture: string }

// Initialises GIS one-tap / button render on element with id='g-signin-btn'
export function initGoogleAuth(clientId, onCredential)
  // onCredential(decodedJwt) called after successful sign-in

// Reads Data.loadAuth()
export function getAuthState()
  // → AuthState | null

// Calls Data.clearAuth(), dispatches 'authchange' event
export function signOut()
```

### New Module: js/sheets-write.js
```javascript
// Apps Script web app URL — user must fill in after deploying
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

export const SheetsWrite = {
  async lookup(email),
    // GET request → { found, playerId?, playerName? }

  async mapEmail(email, playerName),
    // POST → { ok, error? }

  async addMatch(email, match),
    // POST → { ok, error? }
}
```

---

## Work Packages

### WP1 — Google Sheet Schema Update *(manual step — user action required)*

**What to do:**
1. Open the Google Sheet
2. In Tab 1 (players), add column header `email` in cell E1 (col 5)
3. Existing player rows should have cells E2, E3... left blank (no emails yet)
4. In the matches tab, confirm the existing columns match: `date, category, match_type, player_a1, player_a2, player_b1, player_b2, score_a, score_b, notes` — Apps Script will `appendRow` in this order

**Why before everything else:** WP2 Apps Script logic assumes col index 4 = email. WP8 testing requires the sheet to have this column.

---

### WP2 — Apps Script (new file: `apps-script/Code.gs`)

Create this file in the repo as the source-of-truth for the script. User copies it into the Google Sheet's Apps Script editor (Extensions → Apps Script), then deploys as Web App (Execute as: Me, Access: Anyone even anonymous).

```javascript
const SPREADSHEET    = SpreadsheetApp.getActiveSpreadsheet();
const PLAYERS_TAB    = 'Sheet1';   // ← user updates to actual tab name
const MATCHES_TAB    = 'matches';  // ← user updates to actual tab name

// Column indices (0-based) for the players sheet
const COL_NAME   = 0;
const COL_GENDER = 1;
const COL_JOINED = 2;
const COL_ACTIVE = 3;
const COL_EMAIL  = 4;  // new column added in WP1

function doGet(e) {
  try {
    if (e.parameter.action === 'lookup') return _lookup(e.parameter.email);
    return _json({ error: 'Unknown action' });
  } catch (err) {
    return _json({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'mapEmail')  return _mapEmail(body);
    if (body.action === 'addMatch')  return _addMatch(body);
    return _json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

function _lookup(email) {
  if (!email) return _json({ found: false });
  const norm = email.toLowerCase().trim();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_EMAIL]?.toString().toLowerCase().trim() === norm) {
      const name = rows[i][COL_NAME].toString().trim();
      return _json({ found: true, playerId: 'f:' + name.toLowerCase(), playerName: name });
    }
  }
  return _json({ found: false });
}

function _mapEmail({ email, playerName }) {
  if (!email || !playerName) return _json({ ok: false, error: 'Missing fields.' });
  const norm = email.toLowerCase().trim();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_NAME]?.toString().trim().toLowerCase() === playerName.toLowerCase().trim()) {
      const existing = rows[i][COL_EMAIL]?.toString().trim();
      if (existing && existing.toLowerCase() !== norm) {
        return _json({ ok: false, error: 'Player already claimed by another account.' });
      }
      sheet.getRange(i + 1, COL_EMAIL + 1).setValue(email.trim()); // Sheets is 1-indexed
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Player not found.' });
}

function _addMatch({ email, match }) {
  if (!email || !match) return _json({ ok: false, error: 'Missing fields.' });
  // Validate caller email is in sheet
  const norm   = email.toLowerCase().trim();
  const pSheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  const pRows  = pSheet.getDataRange().getValues();
  const known  = pRows.some(r => r[COL_EMAIL]?.toString().toLowerCase().trim() === norm);
  if (!known) return _json({ ok: false, error: 'Unauthorized.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  mSheet.appendRow([
    match.date,
    match.category,
    match.matchType,
    match.teamA[0] ?? '',
    match.teamA[1] ?? '',
    match.teamB[0] ?? '',
    match.teamB[1] ?? '',
    match.scoreA,
    match.scoreB,
    match.notes ?? '',
  ]);
  return _json({ ok: true });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

### WP3 — data.js: Add Auth Storage Functions

**File:** `js/data.js`

| Location | Current | New |
|----------|---------|-----|
| data.js:4-8 | `const KEYS = { players, matches, schemaVersion }` | Add `auth: 'acedupr:auth'` to KEYS |
| After `clearAll()` (data.js:147) | (end of localStorage section) | Add `loadAuth()`, `saveAuth(auth)`, `clearAuth()` |
| Default export `Data` object (data.js:154-160) | `{ ..., clearAll }` | Add `loadAuth, saveAuth, clearAuth` |

**New functions to add after line 151:**
```javascript
function loadAuth() {
  const raw = localStorage.getItem(KEYS.auth);
  return raw ? JSON.parse(raw) : null;
}

function saveAuth(auth) {
  localStorage.setItem(KEYS.auth, JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem(KEYS.auth);
}
```

**Add to default export object:**
```javascript
loadAuth, saveAuth, clearAuth,
```

---

### WP4 — New File: `js/auth.js`

```javascript
import Data from './data.js';

export function decodeJwt(credential) {
  const payload = credential.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const { email, name, picture } = JSON.parse(json);
  return { email, name, picture };
}

export function getAuthState() {
  return Data.loadAuth();
}

export function signOut() {
  Data.clearAuth();
  window.dispatchEvent(new Event('authchange'));
}

// clientId: Google OAuth client ID string
// onCredential: called with { email, name, picture } after successful sign-in
export function initGoogleAuth(clientId, onCredential) {
  if (typeof google === 'undefined') return;
  google.accounts.id.initialize({
    client_id: clientId,
    callback: ({ credential }) => {
      const decoded = decodeJwt(credential);
      onCredential(decoded);
    },
  });
  const btn = document.getElementById('g-signin-btn');
  if (btn) {
    google.accounts.id.renderButton(btn, { theme: 'outline', size: 'medium', text: 'signin_with' });
  }
}
```

---

### WP5 — New File: `js/sheets-write.js`

```javascript
// Paste your deployed Apps Script URL here after completing WP2 deployment.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec';

async function _get(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`);
  return res.json();
}

async function _post(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight
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
```

---

### WP6 — matches.html: Add Match Entry Form

Add the match form section **above** the Match History card (after `id="data-mode-banner"`, before the history card). The section is hidden by default; `initMatches()` will show it when the user is logged in.

```html
<!-- Login prompt (shown when not authenticated) -->
<div id="match-login-prompt" class="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-8 text-center hidden">
  <p class="text-gray-500 mb-4">Sign in to enter match results.</p>
  <div id="g-signin-btn"></div>
</div>

<!-- Match entry form (shown when authenticated + mapped) -->
<div id="match-entry-section" class="bg-white rounded-lg shadow-sm border border-gray-200 hidden">
  <div class="px-4 py-3 border-b border-gray-200">
    <h2 class="font-semibold text-gray-800">Enter Result</h2>
  </div>
  <form id="match-form" class="px-4 py-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div>
      <label class="label" for="match-date">Date</label>
      <input type="date" id="match-date" class="input" required>
    </div>
    <div>
      <label class="label" for="match-category">Category</label>
      <select id="match-category" class="input">
        <option value="MD">MD — Men's Doubles</option>
        <option value="WD">WD — Women's Doubles</option>
        <option value="XD">XD — Mixed Doubles</option>
        <option value="MS">MS — Men's Singles</option>
        <option value="WS">WS — Women's Singles</option>
      </select>
    </div>

    <div class="sm:col-span-2 grid grid-cols-2 gap-4">
      <div>
        <div class="mb-1">
          <label class="label" id="label-a1">Player 1</label>
          <select id="player-a1" class="input"></select>
        </div>
        <div class="partner-field">
          <label class="label" id="label-a2">Player 2</label>
          <select id="player-a2" class="input"></select>
        </div>
      </div>
      <div>
        <div class="mb-1">
          <label class="label" id="label-b1">Player 1</label>
          <select id="player-b1" class="input"></select>
        </div>
        <div class="partner-field">
          <label class="label" id="label-b2">Player 2</label>
          <select id="player-b2" class="input"></select>
        </div>
      </div>
    </div>

    <div>
      <label class="label" for="score-a">Score A</label>
      <input type="number" id="score-a" class="input" min="0" max="30" required>
    </div>
    <div>
      <label class="label" for="score-b">Score B</label>
      <input type="number" id="score-b" class="input" min="0" max="30" required>
    </div>
    <div>
      <label class="label" for="match-type">Match Type</label>
      <select id="match-type" class="input">
        <option value="club">Club</option>
        <option value="recreational">Recreational</option>
        <option value="tournament">Tournament</option>
      </select>
    </div>
    <div>
      <label class="label" for="match-notes">Notes (optional)</label>
      <input type="text" id="match-notes" class="input" placeholder="Optional notes">
    </div>
    <div class="sm:col-span-2 flex justify-end">
      <button type="submit" class="btn-primary">Add Match</button>
    </div>
  </form>
</div>
```

---

### WP7 — All HTML Nav Bars: Add Login/User Indicator

In every HTML file's nav (index.html:41-49, matches.html:40-48, leaderboard.html, player.html, about.html, settings.html), add a login container **before** the theme toggle button:

```html
<!-- Add this before the theme toggle button in every nav -->
<div id="nav-auth" class="ml-auto flex items-center gap-2 text-sm"></div>
<button id="theme-toggle" ...>  <!-- remove the existing ml-auto from this -->
```

The `#nav-auth` div is populated by `_renderNavAuth()` in ui.js (WP8). When logged out, it contains the GIS signin button. When logged in, it shows the player name + a logout link.

Also add the Google Identity Services CDN script to every HTML `<head>`:
```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

**Note:** The Google OAuth Client ID must be set in all pages. It will live as a constant in `js/auth.js`.

---

### WP8 — ui.js: Wire Auth + Match Submission

**8a. Add imports at top of ui.js (ui.js:1-3):**
```javascript
import { initGoogleAuth, getAuthState, signOut, decodeJwt } from './auth.js';
import { SheetsWrite } from './sheets-write.js';
```

**8b. Add `_renderNavAuth(authState, players)` function:**
Renders the `#nav-auth` div based on auth state. Call from every `init*()` function.
```javascript
function _renderNavAuth(authState) {
  const el = document.getElementById('nav-auth');
  if (!el) return;
  if (authState?.mappedPlayerName) {
    el.innerHTML = `<span class="text-gray-600">${authState.mappedPlayerName}</span>
      <button onclick="window._aceSignOut()" class="text-xs text-blue-600 hover:underline">Sign out</button>`;
  } else if (authState?.email) {
    // logged in but not yet mapped — shouldn't persist, but show email
    el.innerHTML = `<span class="text-gray-400 text-xs">${authState.email}</span>
      <button onclick="window._aceSignOut()" class="text-xs text-blue-600 hover:underline">Sign out</button>`;
  } else {
    el.innerHTML = '<div id="g-signin-btn"></div>';
    _initAuth(null); // renders GIS button into #g-signin-btn
  }
}

window._aceSignOut = function() {
  signOut();
  location.reload();
};
```

**8c. Add `_initAuth(players)` function:**
Initialises GIS and handles the full login → lookup → mapping flow.
```javascript
async function _initAuth(players) {
  const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'; // from auth.js constant
  initGoogleAuth(CLIENT_ID, async (decoded) => {
    // Check if email is in sheet
    const result = await SheetsWrite.lookup(decoded.email);
    if (result.found) {
      Data.saveAuth({ ...decoded, mappedPlayerId: result.playerId, mappedPlayerName: result.playerName });
      location.reload(); // simplest way to refresh all auth-gated UI
    } else {
      // Show mapping modal
      _showMappingModal(decoded, players ?? []);
    }
  });
}
```

**8d. Add `_showMappingModal(decoded, players)` function:**
Follow `_showEditModal` pattern (ui.js:747). Create DOM, append to body, remove on cancel/confirm.

**8e. Modify `initMatches()` (ui.js:529):**
```javascript
export async function initMatches() {
  if (!guardCDN(false)) return;
  const { players, matches, mode } = await _loadData();
  _showModeBanner(mode);
  _renderNavAuth(getAuthState());

  const authState = getAuthState();
  if (authState?.mappedPlayerId) {
    document.getElementById('match-entry-section')?.classList.remove('hidden');
    _populateMatchForm(players);
    _wireMatchForm(players, mode, authState.email); // pass mode + email
  } else {
    document.getElementById('match-login-prompt')?.classList.remove('hidden');
    _initAuth(players); // renders GIS button into #g-signin-btn inside prompt
  }

  const latestDate = matches.reduce((max, m) => m.date > max ? m.date : max, '');
  const dateInput = document.getElementById('filter-date');
  if (dateInput && latestDate) dateInput.value = latestDate;
  _renderMatchHistory(players, '', '', matches, latestDate);
  _wireMatchHistory(players, matches);
}
```

**8f. Modify `_wireMatchForm(players)` → `_wireMatchForm(players, mode, email)` (ui.js:609):**

Change the submit handler to call Apps Script when mode is `'sheets'`:
```javascript
// Replace Data.addMatch(match) call at ui.js:655 with:
if (mode === 'sheets') {
  const teamANames = teamA.map(id => players.find(p => p.id === id)?.name ?? id);
  const teamBNames = teamB.map(id => players.find(p => p.id === id)?.name ?? id);
  const result = await SheetsWrite.addMatch(email, {
    date, category: cat, matchType, scoreA, scoreB, notes: notes || '',
    teamA: teamANames, teamB: teamBNames,
  });
  if (!result.ok) { alert('Failed to save: ' + (result.error ?? 'unknown error')); return; }
  DataSheets.invalidateCache();
} else {
  Data.addMatch(match);
}
```

---

## Execution Order

```
WP1 (manual: user adds email col to sheet)     ← prerequisite for testing WP2
  ↓
WP2 (apps-script/Code.gs + deploy)             ← prerequisite for testing WP5
  ↓
WP3 (data.js auth functions)                   ← prerequisite for WP4, WP8
WP4 (js/auth.js)                               ← can run parallel with WP3
WP5 (js/sheets-write.js) + paste SCRIPT_URL   ← depends on WP2 URL
WP6 (matches.html form HTML)                   ← can run parallel
WP7 (all nav HTML + GIS script tag)            ← can run parallel
  ↓ (all above complete)
WP8 (ui.js wiring)                             ← depends on WP3-7
  ↓
Manual test: login → mapping → match entry
```

---

## Complexity Impact

| WP | New Files | Modified Files | New Concerns | LOC Delta | Worsens Audit Finding |
|----|-----------|---------------|--------------|-----------|----------------------|
| WP2 | 1 (Code.gs) | 0 | 0 (separate Apps Script layer) | +90 | No |
| WP3 | 0 | 1 (data.js) | 0 (same concern: auth is storage) | +15 | No |
| WP4 | 1 (auth.js) | 0 | 1 (auth) | +35 | No |
| WP5 | 1 (sheets-write.js) | 0 | 1 (write API) | +30 | No |
| WP6 | 0 | 1 (matches.html) | 0 | +55 | No |
| WP7 | 0 | 6 (all HTML nav bars) | 0 | +12 | No |
| WP8 | 0 | 1 (ui.js) | 0 (auth already in auth.js) | +60 | No |

---

## Risk Register

| Risk | Severity | Probability | Mitigation | Detection |
|------|----------|-------------|------------|-----------|
| Apps Script CORS blocks POST | High | Medium | Use `Content-Type: text/plain` (simple request, no preflight) | Browser DevTools → Network → CORS error on POST |
| OAuth Client ID not configured | High | Medium | Document setup steps; replace placeholder constant before deploying | GIS shows "invalid_client" error in popup |
| Player name mismatch (case/whitespace) | Medium | Medium | Normalize both sides to lowercase + trim before comparison in Apps Script and client | Mapping returns "Player not found" for valid name |
| Sheet tab name mismatch | High | Low | Apps Script uses configurable constants `PLAYERS_TAB`/`MATCHES_TAB`; user updates before deploy | `_mapEmail` throws null reference on `getSheetByName` |
| GIS `google` global not loaded (CDN fail) | Medium | Low | `initGoogleAuth` guards with `typeof google === 'undefined'` check | Login button doesn't render; nav shows blank |
| Cache not invalidated before re-render | Low | Low | `invalidateCache()` called before `_renderMatchHistory()` in submit handler | New match doesn't appear until 30-min cache expires |
| Apps Script daily quota exceeded (20k req/day) | Low | Very Low | Club-scale traffic is well within limits; no mitigation needed | Apps Script dashboard shows quota warnings |

---

## Pre-Implementation User Action Required

Before any code is written, the user must:

1. **Add email column to Google Sheet**: Open Tab 1 (players sheet), add `email` header in the first empty column (currently col E / index 4). Leave all existing player rows blank in this column.

2. **Obtain Google OAuth Client ID**:
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create or select a project
   - APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Web application**
   - Authorized JavaScript origins: add your GitHub Pages URL (e.g. `https://yourusername.github.io`) and `http://localhost:8080` for local dev
   - Copy the Client ID (format: `xxxxxxx.apps.googleusercontent.com`)

3. **Deploy the Apps Script** (after WP2 code is written):
   - Open the Google Sheet → Extensions → Apps Script
   - Paste the Code.gs content
   - Click Deploy → New deployment → Web app
   - Execute as: **Me**, Access: **Anyone (even anonymous)**
   - Copy the deployment URL
   - Paste it into `js/sheets-write.js` as `APPS_SCRIPT_URL`

4. **Confirm matches tab column order** matches what the Apps Script `appendRow` expects: `date, category, match_type, player_a1, player_a2, player_b1, player_b2, score_a, score_b, notes`
