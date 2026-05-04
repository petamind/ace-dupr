# Admin Member Management

## Constraints This Spec Must Respect

- Players sheet columns (0-based): COL_NAME=0, COL_GENDER=1, COL_JOINED=2, COL_ACTIVE=3, COL_EMAIL=4, COL_ROLE=5, COL_QUOTE=6  
  (Source: `apps-script/Code.gs` lines 12–18)
- `_isAdmin(email)` at `Code.gs:63` → checks `row[COL_ROLE].toLowerCase() === 'admin'`
- `_json(obj)` at `Code.gs:290` — only JSON helper in GAS context
- `safe()` formula-injection guard pattern: `v => String(v ?? '').replace(/^[=+\-@]/, "'$&")` (Code.gs:122,246,180)
- Player id convention: `'f:' + name.toLowerCase()` — see `DataSheets.load()` at `data.js:376`
- `DataSheets.load()` parses `active` as: `row[3]?.trim().toLowerCase() !== 'false'` (data.js:380)
- `DataSheets.invalidateCache()` at `data.js:349` clears sessionStorage key `acedupr:sheets-cache`
- Auth role stored in `acedupr:auth` key via `Data.saveAuth()` at `ui.js:202` as `role: result.role ?? 'member'`
- `_effectiveAuth(mode)` at `ui.js:19` — returns `_DEMO_AUTH` (role='admin') when mode='demo'
- `_DEMO_AUTH` at `ui.js:14-17`: `{ email:'demo@admin.local', ..., role:'admin' }`
- `_renderNavAuth(players=null, mode=null)` at `ui.js:111` — renders sign-in UI; calls `_initAuthNav(players)` when no mapped player
- `_wireMembersForm` at `ui.js:2399` — localStorage-only add (not removed; kept for non-Sheets mode)
- `initNavAuth()` at `ui.js:2509` — minimal export; used by about.html; keep unchanged
- `SheetsWrite._post(body)` at `sheets-write.js:29` — POST with `Content-Type: text/plain` to avoid CORS preflight
- No `localStorage.*` except `Data.*` API calls; no new keys in this feature
- No build step — vanilla JS, ES modules, no transpiler

## Objective

Add admin-gated member management to settings.html. An authenticated admin user can add new members directly from the settings page, with immediate sync to the Google Sheet's players tab. Non-admin and signed-out users see a gate message instead of the form.

## Acceptance Criteria

| AC | Description | Verify Command | Expected | Automated |
|----|-------------|----------------|----------|-----------|
| AC1 | Admin sees Add-Member card + Members table | Load settings.html with admin auth; inspect DOM | `#admin-add-member` and `#admin-members-table` visible; `#admin-gate` hidden | Manual |
| AC2 | Non-admin/signed-out sees gate | Load settings.html without admin auth | `#admin-gate` visible; `#admin-add-member` and `#admin-members-table` have class `hidden` | Manual |
| AC3 | Add Member form submits to Sheets within 5s | Fill form + submit → check Sheet players tab | New row appears in players sheet within 5s | Manual |
| AC4 | Members table re-renders without reload | After submit success; inspect DOM | Table shows new member row; no full page reload | Manual |
| AC5 | `addMember` GAS action unauthorized for non-admin | POST `{action:'addMember', email:'noadmin@test.com', member:{name:'X',gender:'M',joinedDate:'2026-01-01'}}` | `{ok:false,error:'Unauthorized.'}` | Manual (GAS exec) |
| AC6 | Duplicate name rejected | Submit member with same name (case-insensitive) | `{ok:false,error:'Player already exists.'}` surfaced inline | Manual |
| AC7 | Formula-injection guard | Submit name `=SUM(1+1)` | Sheet row stored as `'=SUM(1+1)` (leading apostrophe) | Manual |
| AC8 | `?demo` mode shows admin UI (offline-safe) | Open `settings.html?demo` without auth | Admin section visible; form submit shows mock success toast | Manual |

## Technical Design

**Current flow:** `initNavAuth()` → `_renderNavAuth()` (only populates nav). Settings page shows Add Member + Members table to all visitors. Form submit calls `Data.addPlayer()` (localStorage only).

**New flow:** `initSettings()` checks auth role. Admin path: loads players from Sheets, renders table, wires form to `SheetsWrite.addMember()`. Non-admin: shows gate message. GAS `doPost` handles new `addMember` action with admin check + duplicate check.

**Design decisions:**
- `initNavAuth()` kept unchanged (about.html uses it)
- `initSettings()` is a new async export; settings.html calls this instead
- Members table populated from Sheets on load; after successful add, the new player is appended locally AND `DataSheets.invalidateCache()` is called (forces fresh load on next navigation)
- No localStorage write for the new member (AC8: "no member writes touch localStorage")
- Inline error display via `#member-form-error` paragraph

## Interface Contracts

### `Code.gs` — `_addMember({ email, member })`
```js
// Input
{ email: string, member: { name: string, gender: 'M'|'F', joinedDate: 'YYYY-MM-DD' } }

// Outputs
{ ok: false, error: 'Missing fields.' }
{ ok: false, error: 'Unauthorized.' }
{ ok: false, error: 'Missing name.' }
{ ok: false, error: 'Invalid date format.' }
{ ok: false, error: 'Player already exists.' }
{ ok: true, player: { id: string, name: string, gender: string, joinedDate: string, active: true } }
```

### `SheetsWrite.addMember(email, member)`
```js
// email: string, member: { name: string, gender: string, joinedDate: string }
// Returns: same shape as _addMember GAS response
```

### `initSettings()` — exported from `ui.js`
```js
export async function initSettings(): Promise<void>
// Reads ?demo param; calls _renderNavAuth; checks role; shows/hides DOM sections;
// loads Sheets players; wires member form
```

## Work Packages

### WP1 — `apps-script/Code.gs`

**Files:** `apps-script/Code.gs`

| Change | Location | Current | New |
|--------|----------|---------|-----|
| Register addMember action | doPost line 40 | `if (body.action === 'saveQuote')   return _saveQuote(body);` | Add line after: `if (body.action === 'addMember')  return _addMember(body);` |
| New function | After line 204 (end of _mapEmail) | — | Insert `_addMember` function |

`_addMember` function:
```js
function _addMember({ email, member }) {
  if (!email || !member) return _json({ ok: false, error: 'Missing fields.' });
  if (!_isAdmin(email))  return _json({ ok: false, error: 'Unauthorized.' });

  const name       = String(member.name       ?? '').trim();
  const gender     = String(member.gender     ?? '').trim();
  const joinedDate = String(member.joinedDate ?? '').trim();

  if (!name)                                    return _json({ ok: false, error: 'Missing name.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedDate)) return _json({ ok: false, error: 'Invalid date format.' });

  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });

  const rows      = sheet.getDataRange().getValues();
  const nameLower = name.toLowerCase();
  if (rows.some(r => String(r[COL_NAME] ?? '').trim().toLowerCase() === nameLower))
    return _json({ ok: false, error: 'Player already exists.' });

  const safe     = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
  const lastRow  = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, 7).setValues([[
    safe(name), gender, joinedDate, true, '', '', '',
  ]]);

  return _json({ ok: true, player: {
    id: 'f:' + name.toLowerCase(), name, gender, joinedDate, active: true,
  }});
}
```

### WP2 — `js/sheets-write.js`

**Files:** `js/sheets-write.js`

| Change | Location | Current | New |
|--------|----------|---------|-----|
| Add addMember method | After saveQuote (line 63-65) | — | Insert `addMember` method |

```js
async addMember(email, member) {
  return _post({ action: 'addMember', email, member });
},
```

### WP3 — `js/ui.js`

**Files:** `js/ui.js`

| Change | Location | Current | New |
|--------|----------|---------|-----|
| New `_wireMembersFormSheets` | After `_wireMembersForm` (line 2417) | — | Insert function |
| New `initSettings` export | After `initNavAuth` (line 2511) | — | Insert export |

### WP4 — `settings.html`

**Files:** `settings.html`

| Change | Location | Current | New |
|--------|----------|---------|-----|
| Add admin-gate div | Before Add Member card (line 81) | — | Insert gate div |
| Add id to Add Member wrapper | Line 82 | `<div class="bg-white rounded-lg...">` | `<div id="admin-add-member" class="hidden bg-white rounded-lg...">` |
| Add id to Members table wrapper | Line 105 | `<div class="bg-white rounded-lg...">` | `<div id="admin-members-table" class="hidden bg-white rounded-lg...">` |
| Add error paragraph in form | Before close of form | — | `<p id="member-form-error" ...>` |
| Change bootstrap | Lines 176-179 | `initNavAuth()` | `initSettings()` |

## Execution Order

WP1 → WP2 → WP3 → WP4 (linear; each builds on the previous interface)

## Complexity Impact

| WP | New files | Existing files modified | New concerns | LOC delta | Worsens audit finding |
|----|-----------|------------------------|--------------|-----------|----------------------|
| WP1 | 0 | 1 (Code.gs) | 0 (same pattern as _mapEmail) | +28 | No |
| WP2 | 0 | 1 (sheets-write.js) | 0 (same pattern as other methods) | +4 | No |
| WP3 | 0 | 1 (ui.js) | 0 | +55 | No |
| WP4 | 0 | 1 (settings.html) | 0 | +15 | No |

## Risk Register

| Risk | Severity | Probability | Mitigation | Detection |
|------|----------|-------------|------------|-----------|
| GAS `sheet.getLastRow()` returns 0 on empty sheet | Low | Low | Use `Math.max(sheet.getLastRow(), 0) + 1` for target row (same as _addMatch) | Manual test on empty sheet |
| sessionStorage cache not invalidated after add | Medium | Medium | Call `DataSheets.invalidateCache()` immediately after successful add | Check table shows new member |
| Admin gate shown briefly before auth loads (flash) | Low | Low | Elements start hidden; JS only reveals if admin | Visual inspection on slow connection |
| Duplicate check race (two admins add same name simultaneously) | Low | Very Low | Server-side duplicate check is authoritative | Manual concurrent test |
