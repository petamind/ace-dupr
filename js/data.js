// Single storage gateway — all localStorage access lives here. No other file
// calls localStorage directly.

const KEYS = {
  players: 'acedupr:players',
  matches: 'acedupr:matches',
  schemaVersion: 'acedupr:schemaVersion',
  auth: 'acedupr:auth',
  suggestion: 'acedupr:suggestion',
};

const SCHEMA_VERSION = 1;
const SUGGESTION_TTL_MS = 20 * 60 * 1000;

// Local-timezone YYYY-MM-DD; avoids the off-by-one that `toISOString()` causes
// for any user not in UTC.
function _todayIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _init() {
  if (!localStorage.getItem(KEYS.schemaVersion)) {
    localStorage.setItem(KEYS.schemaVersion, String(SCHEMA_VERSION));
    localStorage.setItem(KEYS.players, JSON.stringify([]));
    localStorage.setItem(KEYS.matches, JSON.stringify([]));
  }
}

function loadPlayers() {
  _init();
  return JSON.parse(localStorage.getItem(KEYS.players) || '[]');
}

function savePlayers(players) {
  localStorage.setItem(KEYS.players, JSON.stringify(players));
}

function addPlayer(player) {
  const players = loadPlayers();
  players.push(player);
  savePlayers(players);
}

function updatePlayer(updated) {
  const players = loadPlayers();
  const idx = players.findIndex(p => p.id === updated.id);
  if (idx !== -1) players[idx] = updated;
  savePlayers(players);
}

function loadMatches() {
  _init();
  return JSON.parse(localStorage.getItem(KEYS.matches) || '[]');
}

function _saveMatches(matches) {
  localStorage.setItem(KEYS.matches, JSON.stringify(matches));
}

function addMatch(match) {
  try {
    const matches = loadMatches();
    matches.push(match);
    _saveMatches(matches);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('Storage full. Please export a JSON backup from Settings and clear old data.');
    } else {
      throw e;
    }
  }
}

function updateMatch(updated) {
  const matches = loadMatches();
  const idx = matches.findIndex(m => m.id === updated.id);
  if (idx !== -1) matches[idx] = updated;
  _saveMatches(matches);
}

function deleteMatch(id) {
  const matches = loadMatches().filter(m => m.id !== id);
  _saveMatches(matches);
}

function exportJSON() {
  const data = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    players: loadPlayers(),
    matches: loadMatches(),
  };
  return JSON.stringify(data, null, 2);
}

function importJSON(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
  if (!parsed.players || !parsed.matches) {
    return { ok: false, error: 'Missing players or matches array.' };
  }
  if (parsed.schemaVersion && parsed.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: `Backup is schema v${parsed.schemaVersion}; app supports v${SCHEMA_VERSION}.` };
  }
  savePlayers(parsed.players);
  _saveMatches(parsed.matches);
  localStorage.setItem(KEYS.schemaVersion, String(SCHEMA_VERSION));
  return { ok: true };
}

function exportMatchesCSV(matches, players) {
  const playerMap = Object.fromEntries(players.map(p => [p.id, p.name]));
  const rows = [
    'date,category,match_type,team_a_p1,team_a_p2,team_b_p1,team_b_p2,score_a,score_b,notes',
    ...matches.map(m => [
      m.date,
      m.category,
      m.matchType,
      playerMap[m.teamA[0]] ?? m.teamA[0],
      playerMap[m.teamA[1]] ?? '',
      playerMap[m.teamB[0]] ?? m.teamB[0],
      playerMap[m.teamB[1]] ?? '',
      m.scoreA,
      m.scoreB,
      m.notes ?? '',
    ].join(',')),
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `acedupr-matches-${_todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Returns Promise<Match[]> — caller must handle name-to-id mapping.
// Resolves with raw CSV row objects if Papa is available; rejects otherwise.
function importCSV(file) {
  if (typeof Papa === 'undefined') {
    return Promise.reject(new Error('PapaParse not loaded. Check internet connection.'));
  }
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: result => resolve(result.data),
      error: err => reject(new Error(err.message)),
    });
  });
}

function clearAll() {
  localStorage.removeItem(KEYS.players);
  localStorage.removeItem(KEYS.matches);
  localStorage.removeItem(KEYS.schemaVersion);
  localStorage.removeItem(KEYS.suggestion);
}

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

function saveSuggestion(payload) {
  localStorage.setItem(KEYS.suggestion, JSON.stringify({ ts: Date.now(), payload }));
}

function loadSuggestion() {
  const raw = localStorage.getItem(KEYS.suggestion);
  if (!raw) return null;
  const { ts, payload } = JSON.parse(raw);
  if (Date.now() - ts > SUGGESTION_TTL_MS) {
    localStorage.removeItem(KEYS.suggestion);
    return null;
  }
  return payload;
}

function clearSuggestion() {
  localStorage.removeItem(KEYS.suggestion);
}

const Data = {
  SCHEMA_VERSION,
  loadPlayers,
  savePlayers,
  addPlayer,
  updatePlayer,
  loadMatches,
  addMatch,
  updateMatch,
  deleteMatch,
  exportJSON,
  importJSON,
  exportMatchesCSV,
  importCSV,
  clearAll,
  loadAuth,
  saveAuth,
  clearAuth,
  saveSuggestion,
  loadSuggestion,
  clearSuggestion,
};

export default Data;

// ── File-based data loading (GitHub Pages / data-directory mode) ──────────────
// Reads data/index.json, data/players.csv, and weekly match CSVs via fetch().
// Returns { players, matches } or null when data/index.json is not found.

const _FC = new Set(['MD', 'WD', 'XD', 'MS', 'WS']);
const _FT = new Set(['club', 'tournament', 'recreational', 'unrated']);

function _fnorm(row) {
  const cat = row.category?.trim().toUpperCase() ?? '';
  const mt  = row.match_type?.trim().toLowerCase() ?? '';
  if (!_FC.has(cat) && _FT.has(cat.toLowerCase()) && _FC.has(mt.toUpperCase())) {
    return { ...row, category: row.match_type, match_type: row.category };
  }
  return row;
}

function _frow(rawRow, nameToId) {
  const row = _fnorm(rawRow);
  const category = row.category?.trim().toUpperCase();
  if (!_FC.has(category)) return null;

  const res = n => { const t = n?.trim(); return t ? (nameToId[t.toLowerCase()] ?? null) : null; };
  const a1 = res(row.team_a_p1), b1 = res(row.team_b_p1);
  if (!a1 || !b1) return null;

  const a2 = res(row.team_a_p2), b2 = res(row.team_b_p2);
  const scoreA = parseInt(row.score_a, 10), scoreB = parseInt(row.score_b, 10);
  const date = row.date?.trim();
  if (!date || isNaN(scoreA) || isNaN(scoreB)) return null;
  // Sanity range: pickleball scores are non-negative ints; >30 indicates a typo.
  if (scoreA < 0 || scoreB < 0 || scoreA > 30 || scoreB > 30) return null;
  if (scoreA + scoreB === 0) return null;

  const rawType = row.match_type?.trim().toLowerCase() ?? 'club';
  const matchType = _FT.has(rawType) ? rawType : 'unrated';

  const uuid = row.uuid?.trim() || undefined;
  const id = uuid || 'f:' + [date, category, a1, a2 ?? '', b1, b2 ?? '', scoreA, scoreB].join('|');

  return {
    id,
    uuid,
    date,
    category,
    matchType,
    teamA: a2 ? [a1, a2] : [a1],
    teamB: b2 ? [b1, b2] : [b1],
    scoreA,
    scoreB,
    notes: row.notes?.trim() || undefined,
  };
}

async function _ftxt(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.text();
}

// Pure header-detection + row-mapping logic. Accepts a 2D array (output of
// Papa.parse or test data). No Papa dependency — safe to call in Node tests.
// Handles Google Sheets "display header + column name" double-header pattern.
function _parseSheetRows(data) {
  if (!data.length) return [];
  let hIdx = 0;
  for (let i = 0; i < Math.min(data.length, 3); i++) {
    const vals = data[i].filter(v => v?.trim());
    if (vals.length && vals.every(v => /^[a-z][a-z0-9_]*$/.test(v.trim()))) {
      hIdx = i; break;
    }
  }
  const headers = data[hIdx].map(h => h?.trim() ?? '');
  return data.slice(hIdx + 1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i]?.trim() ?? ''; });
    return obj;
  });
}

function _parseSheet(text) {
  const { data } = Papa.parse(text, { header: false, skipEmptyLines: true });
  return _parseSheetRows(data);
}

// ── Google Sheets loading ─────────────────────────────────────────────────────
const _GS_ID   = '1YMOIn2DFTMET8dpVmr7FC82sqm2UywsL7zEWgjhS3E4';
const _GS_GIDS = { players: '0', matches: '387653111' };
const _GS_BASE = `https://docs.google.com/spreadsheets/d/${_GS_ID}/export?format=csv`;

const _GS_CACHE_KEY = 'acedupr:sheets-cache';
const _GS_CACHE_TTL = 30 * 60 * 1000;

export const DataSheets = {
  invalidateCache() {
    sessionStorage.removeItem(_GS_CACHE_KEY);
  },

  async load() {
    try {
      const raw = sessionStorage.getItem(_GS_CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < _GS_CACHE_TTL) return data;
      }

      const [playersText, matchesText] = await Promise.all([
        _ftxt(`${_GS_BASE}&gid=${_GS_GIDS.players}`),
        _ftxt(`${_GS_BASE}&gid=${_GS_GIDS.matches}`),
      ]);

      // Players: fixed column order (name, gender, joined_date, active).
      // Parse without headers and skip any row where the first cell is not a
      // real player name (e.g. Google's "Column N" header row or a field-name row).
      const playerRows = Papa.parse(playersText, { header: false, skipEmptyLines: true }).data;
      const players = playerRows
        .filter(row => {
          const v = row[0]?.trim();
          return v && !/^(name|column\s*\d+)$/i.test(v);
        })
        .map(row => ({
          id: 'f:' + row[0].trim().toLowerCase(),
          name: row[0].trim(),
          gender: row[1]?.trim().toUpperCase() === 'F' ? 'F' : 'M',
          joinedDate: row[2]?.trim() || _todayIso(),
          active: row[3]?.trim().toLowerCase() !== 'false',
          quote: row[6]?.trim() || '',
        }));

      if (!players.length) return null;

      const nameToId = Object.fromEntries(players.map(p => [p.name.toLowerCase(), p.id]));

      const matches = _parseSheet(matchesText)
        .map(row => _frow(row, nameToId))
        .filter(Boolean);

      const result = { players, matches };
      sessionStorage.setItem(_GS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: result }));
      return result;
    } catch (err) {
      console.error('DataSheets.load failed — falling back to file/local mode', err);
      return null;
    }
  },
};

// Exported for unit testing only — not part of the runtime public API.
export const _testHelpers = { parseSheetRows: _parseSheetRows, fnorm: _fnorm, frow: _frow };

export const DataFile = {
  async load() {
    let manifest;
    try {
      manifest = JSON.parse(await _ftxt('data/index.json'));
    } catch {
      return null; // no data directory — fall back to localStorage
    }

    let players = [];
    if (manifest.players) {
      try {
        const text = await _ftxt(manifest.players);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        players = rows
          .filter(r => r.name?.trim())
          .map(r => ({
            id: 'f:' + r.name.trim().toLowerCase(),
            name: r.name.trim(),
            gender: r.gender?.trim().toUpperCase() === 'F' ? 'F' : 'M',
            joinedDate: r.joined_date?.trim() || _todayIso(),
            active: r.active?.trim().toLowerCase() !== 'false',
          }));
      } catch { /* players.csv missing — continue with empty list */ }
    }

    const nameToId = Object.fromEntries(players.map(p => [p.name.toLowerCase(), p.id]));

    const matches = [];
    for (const csvPath of (manifest.matches ?? [])) {
      try {
        const text = await _ftxt(csvPath);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        for (const row of rows) {
          const m = _frow(row, nameToId);
          if (m) matches.push(m);
        }
      } catch { /* skip missing/invalid CSV */ }
    }

    return { players, matches };
  },
};
