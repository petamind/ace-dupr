// ACE Pickleball — Google Apps Script Web App
// Deploy: Extensions → Apps Script → Deploy → New deployment
//   Execute as: Me  |  Who has access: Anyone (even anonymous)
//
// After deploying, copy the Web App URL into js/sheets-write.js → APPS_SCRIPT_URL

const SPREADSHEET = SpreadsheetApp.getActiveSpreadsheet();
const PLAYERS_TAB  = 'players';
const MATCHES_TAB  = 'matches';

// Column indices (0-based) in the players sheet
const COL_NAME   = 0;
const COL_GENDER = 1;
const COL_JOINED = 2;
const COL_ACTIVE = 3;
const COL_EMAIL  = 4;  // column E
const COL_ROLE   = 5;  // column F
const COL_QUOTE  = 6;  // column G

const VALID_CATEGORIES  = new Set(['MD', 'WD', 'XD', 'MS', 'WS']);
const VALID_MATCH_TYPES = new Set(['tournament', 'club', 'recreational']);

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
    if (body.action === 'mapEmail')    return _mapEmail(body);
    if (body.action === 'addMatch')    return _addMatch(body);
    if (body.action === 'editMatch')   return _editMatch(body);
    if (body.action === 'deleteMatch') return _deleteMatch(body);
    if (body.action === 'saveQuote')   return _saveQuote(body);
    return _json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

function _lookup(email) {
  if (!email) return _json({ found: false });
  const norm  = email.toLowerCase().trim();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ error: `Sheet "${PLAYERS_TAB}" not found.` });
  const rows  = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_EMAIL]?.toString().toLowerCase().trim() === norm) {
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

function _matchesRow(row, match) {
  return String(row[0]).trim()                    === String(match.date).trim() &&
    String(row[1]).trim().toUpperCase()            === String(match.category).trim().toUpperCase() &&
    String(row[2]).trim().toLowerCase()            === String(match.matchType).trim().toLowerCase() &&
    String(row[3]).trim().toLowerCase()            === String(match.teamA[0] ?? '').trim().toLowerCase() &&
    String(row[4]).trim().toLowerCase()            === String(match.teamA[1] ?? '').trim().toLowerCase() &&
    String(row[5]).trim().toLowerCase()            === String(match.teamB[0] ?? '').trim().toLowerCase() &&
    String(row[6]).trim().toLowerCase()            === String(match.teamB[1] ?? '').trim().toLowerCase() &&
    Number(row[7])                                 === Number(match.scoreA) &&
    Number(row[8])                                 === Number(match.scoreB);
}

function _editMatch({ email, oldMatch, newMatch }) {
  if (!email || !oldMatch || !newMatch) return _json({ ok: false, error: 'Missing fields.' });
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
    if (_matchesRow(rows[i], oldMatch)) {
      mSheet.getRange(i + 1, 1, 1, 10).setValues([[
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
      ]]);
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Match not found.' });
}

function _deleteMatch({ email, match }) {
  if (!email || !match) return _json({ ok: false, error: 'Missing fields.' });
  if (!_isAdmin(email)) return _json({ ok: false, error: 'Unauthorized.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  if (!mSheet) return _json({ ok: false, error: `Sheet "${MATCHES_TAB}" not found.` });
  const rows = mSheet.getDataRange().getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    if (_matchesRow(rows[i], match)) {
      mSheet.deleteRow(i + 1);
      return _json({ ok: true });
    }
  }
  return _json({ ok: false, error: 'Match not found.' });
}

function _saveQuote({ email, playerName, quote }) {
  if (!email || playerName === undefined) return _json({ ok: false, error: 'Missing fields.' });
  const norm = email.toLowerCase().trim();
  const targetName = String(playerName).trim().toLowerCase();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
  const rows = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL_NAME]?.toString().trim().toLowerCase() !== targetName) continue;
    const rowEmail = rows[i][COL_EMAIL]?.toString().toLowerCase().trim();
    if (rowEmail !== norm && !_isAdmin(email)) return _json({ ok: false, error: 'Unauthorized.' });
    const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
    sheet.getRange(i + 1, COL_QUOTE + 1).setValue(safe(String(quote ?? '').slice(0, 200)));
    return _json({ ok: true });
  }
  return _json({ ok: false, error: 'Player not found.' });
}

function _mapEmail({ email, playerName }) {
  if (!email || !playerName) return _json({ ok: false, error: 'Missing fields.' });
  const norm  = email.toLowerCase().trim();
  const sheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!sheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
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

  // Validate inputs before writing to the sheet
  if (!VALID_CATEGORIES.has(match.category))
    return _json({ ok: false, error: 'Invalid category.' });
  if (!VALID_MATCH_TYPES.has(match.matchType))
    return _json({ ok: false, error: 'Invalid match type.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date))
    return _json({ ok: false, error: 'Invalid date format.' });
  const sA = Number(match.scoreA), sB = Number(match.scoreB);
  if (!Number.isInteger(sA) || !Number.isInteger(sB) || sA < 0 || sB < 0 || sA > 30 || sB > 30)
    return _json({ ok: false, error: 'Invalid scores.' });
  if (!Array.isArray(match.teamA) || !Array.isArray(match.teamB))
    return _json({ ok: false, error: 'Invalid team data.' });
  const notes = String(match.notes ?? '').slice(0, 500);

  // Validate caller email is mapped in the sheet
  const norm   = email.toLowerCase().trim();
  const pSheet = SPREADSHEET.getSheetByName(PLAYERS_TAB);
  if (!pSheet) return _json({ ok: false, error: `Sheet "${PLAYERS_TAB}" not found.` });
  const pRows  = pSheet.getDataRange().getValues();
  const known  = pRows.some(r => r[COL_EMAIL]?.toString().toLowerCase().trim() === norm);
  if (!known) return _json({ ok: false, error: 'Unauthorized.' });

  const mSheet = SPREADSHEET.getSheetByName(MATCHES_TAB);
  if (!mSheet) return _json({ ok: false, error: `Sheet "${MATCHES_TAB}" not found.` });

  // Strip leading formula-injection chars from any string cell
  const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");

  mSheet.appendRow([
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
  ]);
  return _json({ ok: true });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
