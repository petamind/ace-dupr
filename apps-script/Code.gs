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
    if (body.action === 'mapEmail') return _mapEmail(body);
    if (body.action === 'addMatch') return _addMatch(body);
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
      return _json({ found: true, playerId: 'f:' + name.toLowerCase(), playerName: name });
    }
  }
  return _json({ found: false });
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
