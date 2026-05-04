// ACE Pickleball — Google Apps Script Web App
// Deploy: Extensions → Apps Script → Deploy → New deployment
//   Execute as: Me  |  Who has access: Anyone (even anonymous)
//
// After deploying, copy the Web App URL into js/sheets-write.js → APPS_SCRIPT_URL

const SPREADSHEET = SpreadsheetApp.getActiveSpreadsheet();
const PLAYERS_TAB  = 'players';
const MATCHES_TAB  = 'matches';

// Must match GOOGLE_CLIENT_ID in js/auth.js. Used to verify GIS ID tokens
// so write callers can't spoof another user's email.
const GOOGLE_CLIENT_ID = '433557584068-74a02v1qfktun4mmvcetptnq5tdbc78m.apps.googleusercontent.com';

// Column indices (0-based) in the players sheet
const COL_NAME   = 0;
const COL_GENDER = 1;
const COL_JOINED = 2;
const COL_ACTIVE = 3;
const COL_EMAIL  = 4;  // column E
const COL_ROLE   = 5;  // column F
const COL_QUOTE  = 6;  // column G
const COL_UUID   = 7;  // column H

const VALID_CATEGORIES  = new Set(['MD', 'WD', 'XD', 'MS', 'WS', 'UN']);
// NOTE: entries must not collide with VALID_CATEGORIES values — _normRow relies on disjointness.
const VALID_MATCH_TYPES = new Set(['tournament', 'club', 'recreational', 'unrated']);

// Verifies a Google Identity Services ID token via the public tokeninfo
// endpoint, then returns the lowercased verified email. Returns null on any
// failure (bad signature, wrong audience, expired). Callers MUST treat null
// as "untrusted" and refuse the request — never fall back to body.email.
function _verifyIdToken(idToken) {
  if (!idToken) return null;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const claims = JSON.parse(res.getContentText());
    if (claims.aud !== GOOGLE_CLIENT_ID) return null;
    if (Number(claims.exp) * 1000 < Date.now()) return null;
    if (!claims.email) return null;
    return String(claims.email).toLowerCase().trim();
  } catch (err) {
    return null;
  }
}

// Use this when an idToken is missing or invalid. The `tokenExpired` flag
// tells the client to clear cached auth and prompt re-sign-in.
function _unauthorized() {
  return _json({ ok: false, tokenExpired: true, error: 'Session expired. Sign in again.' });
}

function doGet(e) {
  // GET is no longer used for any action — every endpoint requires a verified
  // ID token, which would be too long to safely fit in a query string and is
  // sent via POST instead.
  return _json({ error: 'Use POST.' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'lookup')      return _lookup(body);
    if (body.action === 'mapEmail')    return _mapEmail(body);
    if (body.action === 'addMatch')    return _addMatch(body);
    if (body.action === 'editMatch')   return _editMatch(body);
    if (body.action === 'deleteMatch') return _deleteMatch(body);
    if (body.action === 'saveQuote')   return _saveQuote(body);
    if (body.action === 'addMember')   return _addMember(body);
    return _json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

function _lookup({ idToken }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ error: `Sheet "${PLAYERS_TAB}" not found.` });
  const rows  = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_EMAIL]?.toString().toLowerCase().trim() === email) {
      const name = rows[i][COL_NAME].toString().trim();
      const role = rows[i][COL_ROLE]?.toString().trim().toLowerCase() || 'member';
      return _json({ found: true, playerId: 'f:' + name.toLowerCase(), playerName: name, role });
    }
  }
  return _json({ found: false });
}

function _isAdmin(email) {
  const norm  = email.toLowerCase().trim();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return false;
  const rows  = sheet.getDataRange().getValues();
  for (const row of rows) {
    if (row[COL_EMAIL]?.toString().toLowerCase().trim() === norm) {
      return row[COL_ROLE]?.toString().trim().toLowerCase() === 'admin';
    }
  }
  return false;
}

// Some older rows were written with col B = matchType and col C = category (swapped).
// _normRow detects this and returns the row with B and C corrected so _matchesRow
// works regardless of which order the row was originally written.
function _normRow(row) {
  const b = String(row[1] ?? '').trim().toUpperCase();
  const c = String(row[2] ?? '').trim();
  const bIsMatchType = VALID_MATCH_TYPES.has(b.toLowerCase()) && VALID_CATEGORIES.has(c.toUpperCase());
  if (bIsMatchType) {
    const fixed = row.slice();
    fixed[1] = row[2]; // category ← old col C
    fixed[2] = row[1]; // matchType ← old col B
    return fixed;
  }
  return row;
}

function _matchesRow(rawRow, match) {
  const row = _normRow(rawRow);
  // Sheets returns Date objects for date-formatted cells; convert to ISO string.
  const rowDate = row[0] instanceof Date
    ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(row[0]).trim();
  return rowDate                                  === String(match.date).trim() &&
    String(row[1]).trim().toUpperCase()            === String(match.category).trim().toUpperCase() &&
    String(row[2]).trim().toLowerCase()            === String(match.matchType).trim().toLowerCase() &&
    String(row[3]).trim().toLowerCase()            === String(match.teamA[0] ?? '').trim().toLowerCase() &&
    String(row[4]).trim().toLowerCase()            === String(match.teamA[1] ?? '').trim().toLowerCase() &&
    String(row[5]).trim().toLowerCase()            === String(match.teamB[0] ?? '').trim().toLowerCase() &&
    String(row[6]).trim().toLowerCase()            === String(match.teamB[1] ?? '').trim().toLowerCase() &&
    Number(row[7])                                 === Number(match.scoreA) &&
    Number(row[8])                                 === Number(match.scoreB);
}

function _editMatch({ idToken, oldMatch, newMatch }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  if (!oldMatch || !newMatch) return _json({ ok: false, error: 'Missing fields.' });
  if (!_isAdmin(email)) return _json({ ok: false, error: 'Unauthorized.' });

  const sA = Number(newMatch.scoreA), sB = Number(newMatch.scoreB);
  if (!Number.isInteger(sA) || !Number.isInteger(sB) || sA < 0 || sB < 0 || sA > 25 || sB > 25 || sA === sB)
    return _json({ ok: false, error: 'Invalid scores.' });
  if (!VALID_CATEGORIES.has(newMatch.category))  return _json({ ok: false, error: 'Invalid category.' });
  if (!VALID_MATCH_TYPES.has(newMatch.matchType)) return _json({ ok: false, error: 'Invalid match type.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  if (!mSheet) return _json({ ok: false, error: `Sheet "${MATCHES_TAB}" not found.` });
  const rows = mSheet.getDataRange().getValues();
  const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");

  for (let i = 0; i < rows.length; i++) {
    const found = oldMatch.uuid
      ? String(rows[i][10]).trim() === String(oldMatch.uuid).trim()
      : _matchesRow(rows[i], oldMatch);
    if (found) {
      const rowUuid = String(rows[i][10]).trim() || Utilities.getUuid();
      mSheet.getRange(i + 1, 1, 1, 11).setValues([[
        newMatch.date,
        newMatch.category,
        newMatch.matchType,
        safe(newMatch.teamA[0] ?? ''),
        safe(newMatch.teamA[1] ?? ''),
        safe(newMatch.teamB[0] ?? ''),
        safe(newMatch.teamB[1] ?? ''),
        sA,
        sB,
        safe(String(newMatch.notes ?? '').slice(0, 500)),
        rowUuid,
      ]]);
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Match not found.' });
}

function _deleteMatch({ idToken, match }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  if (!match) return _json({ ok: false, error: 'Missing fields.' });
  if (!_isAdmin(email)) return _json({ ok: false, error: 'Unauthorized.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  if (!mSheet) return _json({ ok: false, error: `Sheet "${MATCHES_TAB}" not found.` });
  const rows = mSheet.getDataRange().getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    const found = match.uuid
      ? String(rows[i][10]).trim() === String(match.uuid).trim()
      : _matchesRow(rows[i], match);
    if (found) {
      mSheet.deleteRow(i + 1);
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Match not found.' });
}

function _saveQuote({ idToken, playerName, quote }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  if (playerName === undefined) return _json({ ok: false, error: 'Missing fields.' });
  const targetName = String(playerName).trim().toLowerCase();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
  const rows = sheet.getDataRange().getValues();
  const isAdmin = _isAdmin(email);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_NAME]?.toString().trim().toLowerCase() !== targetName) continue;
    const rowEmail = rows[i][COL_EMAIL]?.toString().toLowerCase().trim();
    // Only the row's owner (matching email) or an admin may write the quote.
    // Reject when the row has no email and the caller isn't admin — otherwise
    // anyone could claim quotes on unmapped players.
    if (!isAdmin && (!rowEmail || rowEmail !== email)) {
      return _json({ ok: false, error: 'Unauthorized.' });
    }
    const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
    sheet.getRange(i + 1, COL_QUOTE + 1).setValue(safe(String(quote ?? '').slice(0, 200)));
    return _json({ ok: true });
  }
  return _json({ ok: false, error: 'Player not found.' });
}

function _mapEmail({ idToken, playerName }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  if (!playerName) return _json({ ok: false, error: 'Missing fields.' });
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
  const rows  = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_NAME]?.toString().trim().toLowerCase() === playerName.toLowerCase().trim()) {
      const existing = rows[i][COL_EMAIL]?.toString().trim();
      if (existing && existing.toLowerCase() !== email) {
        return _json({ ok: false, error: 'Player already claimed by another account.' });
      }
      sheet.getRange(i + 1, COL_EMAIL + 1).setValue(email); // Sheets is 1-indexed
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Player not found.' });
}

function _addMember({ idToken, member }) {
  const email = _verifyIdToken(idToken);
  if (!email) return _unauthorized();
  if (!member) return _json({ ok: false, error: 'Missing fields.' });
  if (!_isAdmin(email))  return _json({ ok: false, error: 'Unauthorized.' });

  const name        = String(member.name       ?? '').trim();
  const gender      = String(member.gender     ?? '').trim();
  const joinedDate  = String(member.joinedDate ?? '').trim();
  const memberEmail = String(member.email      ?? '').trim().toLowerCase();

  if (!name)                                    return _json({ ok: false, error: 'Missing name.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedDate)) return _json({ ok: false, error: 'Invalid date format.' });
  if (memberEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail))
    return _json({ ok: false, error: 'Invalid email format.' });

  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });

  const rows      = sheet.getDataRange().getValues();
  const nameLower = name.toLowerCase();
  if (rows.some(r => String(r[COL_NAME] ?? '').trim().toLowerCase() === nameLower))
    return _json({ ok: false, error: 'Player already exists.' });
  if (memberEmail && rows.some(r => String(r[COL_EMAIL] ?? '').trim().toLowerCase() === memberEmail))
    return _json({ ok: false, error: 'Email already in use.' });

  const safe    = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
  const uuid    = Utilities.getUuid();
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, 8).setValues([[
    safe(name), gender, joinedDate, true, memberEmail, '', '', uuid,
  ]]);

  return _json({ ok: true, player: {
    id: 'f:' + name.toLowerCase(), name, gender, joinedDate, email: memberEmail, active: true, uuid,
  }});
}

function _addMatch({ idToken, match }) {
  const email = _verifyIdToken(idToken);
  if (!email) { console.log('addMatch.reject', 'unauthorized'); return _unauthorized(); }
  console.log('addMatch.in', JSON.stringify({ email, match }));
  if (!match) { console.log('addMatch.reject', 'missing fields'); return _json({ ok: false, error: 'Missing fields.' }); }

  // Validate inputs before writing to the sheet
  if (!VALID_CATEGORIES.has(match.category)) {
    console.log('addMatch.reject', 'category', match.category);
    return _json({ ok: false, error: 'Invalid category.' });
  }
  if (!VALID_MATCH_TYPES.has(match.matchType)) {
    console.log('addMatch.reject', 'matchType', match.matchType);
    return _json({ ok: false, error: 'Invalid match type.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date)) {
    console.log('addMatch.reject', 'date', match.date);
    return _json({ ok: false, error: 'Invalid date format.' });
  }
  const sA = Number(match.scoreA), sB = Number(match.scoreB);
  if (!Number.isInteger(sA) || !Number.isInteger(sB) || sA < 0 || sB < 0 || sA > 30 || sB > 30) {
    console.log('addMatch.reject', 'scores', match.scoreA, match.scoreB);
    return _json({ ok: false, error: 'Invalid scores.' });
  }
  if (!Array.isArray(match.teamA) || !Array.isArray(match.teamB)) {
    console.log('addMatch.reject', 'team-shape', JSON.stringify(match.teamA), JSON.stringify(match.teamB));
    return _json({ ok: false, error: 'Invalid team data.' });
  }
  const notes = String(match.notes ?? '').slice(0, 500);

  // Verified caller must be mapped in the players sheet to record a match.
  const pSheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!pSheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
  const pRows  = pSheet.getDataRange().getValues();
  const known  = pRows.some(r => r[COL_EMAIL]?.toString().toLowerCase().trim() === email);
  if (!known) return _json({ ok: false, error: 'Unauthorized.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  if (!mSheet) return _json({ ok: false, error: `Sheet "${MATCHES_TAB}" not found.` });

  // Strip leading formula-injection chars from any string cell
  const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");

  // Idempotency: if the client supplied a UUID and a row with that UUID is
  // already present, treat the request as a duplicate retry and skip the write.
  // Falls back to a server-generated UUID when the client didn't supply one
  // (older clients or non-form callers).
  const clientUuid = String(match.uuid ?? '').trim();
  if (clientUuid) {
    const allRows = mSheet.getDataRange().getValues();
    for (let i = 0; i < allRows.length; i++) {
      if (String(allRows[i][10]).trim() === clientUuid) {
        console.log('addMatch.dedup', 'row', i + 1, 'uuid', clientUuid);
        return _json({ ok: true, uuid: clientUuid, deduplicated: true });
      }
    }
  }

  // appendRow treats formula-filled cells as non-empty and inserts after them.
  // Instead, find the last row with actual data in col A (date column) and write there.
  const colA = mSheet.getRange(1, 1, mSheet.getLastRow() || 1, 1).getValues();
  let lastDataRow = 0;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] !== '') lastDataRow = i + 1;
  }
  const uuid = clientUuid || Utilities.getUuid();
  const targetRow = lastDataRow + 1;
  console.log('addMatch.write', 'row', targetRow, 'uuid', uuid);
  mSheet.getRange(targetRow, 1, 1, 11).setValues([[
    match.date,
    match.category,
    match.matchType,
    safe(match.teamA[0] ?? ''),
    safe(match.teamA[1] ?? ''),
    safe(match.teamB[0] ?? ''),
    safe(match.teamB[1] ?? ''),
    sA,
    sB,
    safe(notes),
    uuid,
  ]]);
  console.log('addMatch.done', 'row', targetRow, 'uuid', uuid);
  return _json({ ok: true, uuid });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
