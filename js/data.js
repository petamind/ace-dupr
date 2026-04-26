// Single storage gateway — all localStorage access lives here. No other file
// calls localStorage directly.

const KEYS = {
  players: 'acedupr:players',
  matches: 'acedupr:matches',
  schemaVersion: 'acedupr:schemaVersion',
};

const SCHEMA_VERSION = 1;

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
  a.download = `acedupr-matches-${new Date().toISOString().slice(0, 10)}.csv`;
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
};

export default Data;
