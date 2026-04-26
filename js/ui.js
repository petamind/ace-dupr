import Data from './data.js';
import { computeRatings, computeRatingHistory, CONSTANTS } from './rating.js';
import Charts from './charts.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

export function formatRating(v) {
  return v.toFixed(3);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString();
}

export function playerName(id, players) {
  return players.find(p => p.id === id)?.name ?? id;
}

export function reliabilityBadge(r) {
  if (r.inactive) {
    return '<span class="badge badge-inactive">Inactive</span>';
  }
  if (r.provisional) {
    return '<span class="badge badge-provisional">Provisional</span>';
  }
  return '<span class="badge badge-full">Full</span>';
}

export function trendArrow(delta) {
  if (delta > 0.001) return '<span class="text-green-600">↑</span>';
  if (delta < -0.001) return '<span class="text-red-500">↓</span>';
  return '<span class="text-gray-400">—</span>';
}

function guardCDN() {
  if (typeof Chart === 'undefined' || typeof Papa === 'undefined') {
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML =
        '<p class="text-red-600 p-8 text-center">This app requires an internet connection to load Chart.js and PapaParse. Please reload with a connection.</p>';
    }
    return false;
  }
  return true;
}

// ── Dashboard (index.html) ────────────────────────────────────────────────────

export function initDashboard() {
  if (!guardCDN()) return;

  const players = Data.loadPlayers();
  const matches = Data.loadMatches();
  const asOf = Date.now();
  const asOf30 = asOf - 30 * 24 * 60 * 60 * 1000;

  const ratings = computeRatings(matches, players, { asOf });
  const ratings30 = computeRatings(matches, players, { asOf: asOf30 });

  _renderDashboard(players, ratings, ratings30);
  _wireDashboard();
}

const CATEGORIES = ['MD', 'WD', 'MS', 'WS'];

function _ratingMap(ratings) {
  const map = {};
  for (const r of ratings) {
    map[`${r.playerId}:${r.category}`] = r;
  }
  return map;
}

function _renderDashboard(players, ratings, ratings30) {
  const tbody = document.getElementById('ratings-tbody');
  if (!tbody) return;

  const rMap = _ratingMap(ratings);
  const rMap30 = _ratingMap(ratings30);

  // Top 3 per category by rating (exclude inactive for highlight)
  const top3 = {};
  for (const cat of CATEGORIES) {
    const catRatings = ratings
      .filter(r => r.category === cat && !r.inactive && r.matchCount > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
    top3[cat] = catRatings.map(r => r.playerId);
  }

  const activePlayers = players.filter(p => p.active);

  tbody.innerHTML = activePlayers.map(p => {
    const cells = CATEGORIES.map(cat => {
      const r = rMap[`${p.id}:${cat}`];
      if (!r) return '<td class="px-3 py-2 text-gray-300">—</td>';
      const r30 = rMap30[`${p.id}:${cat}`];
      const delta = r30 ? r.rating - r30.rating : 0;
      const prefix = r.provisional ? '<span class="text-amber-500">~</span>' : '';
      return `<td class="px-3 py-2 font-mono text-sm">${prefix}${formatRating(r.rating)} ${trendArrow(delta)}</td>`;
    });

    const bestRank = CATEGORIES.map((cat, i) => {
      const rank = top3[cat].indexOf(p.id);
      return rank >= 0 ? rank : 99;
    });
    const minRank = Math.min(...bestRank);
    const rankClass = minRank === 0 ? 'bg-yellow-50' : minRank === 1 ? 'bg-gray-50' : minRank === 2 ? 'bg-orange-50' : '';

    return `<tr class="${rankClass} hover:bg-blue-50 cursor-pointer" onclick="window.location='player.html?id=${p.id}'">
      <td class="px-3 py-2 font-medium">
        <a href="player.html?id=${p.id}" class="text-blue-600 hover:underline">${p.name}</a>
      </td>
      ${cells.join('')}
    </tr>`;
  }).join('');

  // Update stats
  const statEl = document.getElementById('stat-players');
  if (statEl) statEl.textContent = activePlayers.length;
  const statMatches = document.getElementById('stat-matches');
  if (statMatches) statMatches.textContent = Data.loadMatches().length;
}

function _wireDashboard() {
  const sortHeaders = document.querySelectorAll('[data-sort]');
  let sortState = { col: null, asc: true };
  sortHeaders.forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      sortState.asc = sortState.col === col ? !sortState.asc : true;
      sortState.col = col;
      _sortTable(col, sortState.asc);
    });
  });
}

function _sortTable(col, asc) {
  const tbody = document.getElementById('ratings-tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const aVal = a.querySelector(`[data-col="${col}"]`)?.textContent ?? '';
    const bVal = b.querySelector(`[data-col="${col}"]`)?.textContent ?? '';
    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);
    if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
    return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ── Match Entry + History (matches.html) ─────────────────────────────────────

export function initMatches() {
  if (!guardCDN()) return;

  const players = Data.loadPlayers();
  _populateMatchForm(players);
  _renderMatchHistory(players);
  _wireMatchForm(players);
  _wireCSVUpload(players);
  _wireMatchHistory(players);
}

function _genderForCategory(cat) {
  if (cat === 'MD' || cat === 'MS') return 'M';
  if (cat === 'WD' || cat === 'WS') return 'F';
  return null;
}

function _isDoubles(cat) {
  return cat === 'MD' || cat === 'WD';
}

function _populateMatchForm(players) {
  const dateInput = document.getElementById('match-date');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  const catSelect = document.getElementById('match-category');
  if (catSelect) {
    catSelect.addEventListener('change', () => _updatePlayerDropdowns(players));
  }
  _updatePlayerDropdowns(players);
}

function _playerOptions(players, gender, exclude = []) {
  const filtered = players.filter(p => p.active && p.gender === gender && !exclude.includes(p.id));
  const opts = filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  return `<option value="">— select —</option>${opts}`;
}

function _updatePlayerDropdowns(players) {
  const cat = document.getElementById('match-category')?.value ?? 'MD';
  const gender = _genderForCategory(cat);
  const doubles = _isDoubles(cat);

  const p2Fields = document.querySelectorAll('.partner-field');
  p2Fields.forEach(el => el.classList.toggle('hidden', !doubles));

  const selects = ['a1', 'a2', 'b1', 'b2'];
  selects.forEach(key => {
    const sel = document.getElementById(`player-${key}`);
    if (sel) sel.innerHTML = _playerOptions(players, gender);
  });
}

function _wireMatchForm(players) {
  const form = document.getElementById('match-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const cat = document.getElementById('match-category').value;
    const doubles = _isDoubles(cat);
    const a1 = document.getElementById('player-a1').value;
    const a2 = doubles ? document.getElementById('player-a2').value : null;
    const b1 = document.getElementById('player-b1').value;
    const b2 = doubles ? document.getElementById('player-b2').value : null;
    const scoreA = parseInt(document.getElementById('score-a').value, 10);
    const scoreB = parseInt(document.getElementById('score-b').value, 10);
    const date = document.getElementById('match-date').value;
    const matchType = document.getElementById('match-type').value;
    const notes = document.getElementById('match-notes').value.trim();

    if (!a1 || !b1 || (doubles && (!a2 || !b2))) {
      alert('Please select all players.');
      return;
    }
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      alert('Invalid scores.');
      return;
    }

    const teamA = doubles ? [a1, a2] : [a1];
    const teamB = doubles ? [b1, b2] : [b1];
    const playerIds = [...teamA, ...teamB];
    if (new Set(playerIds).size !== playerIds.length) {
      alert('A player cannot appear twice in the same match.');
      return;
    }

    const match = {
      id: crypto.randomUUID(),
      date,
      category: cat,
      matchType,
      teamA,
      teamB,
      scoreA,
      scoreB,
      notes: notes || undefined,
    };

    Data.addMatch(match);
    form.reset();
    document.getElementById('match-date').value = new Date().toISOString().slice(0, 10);
    _updatePlayerDropdowns(players);
    _renderMatchHistory(players);
    _showToast('Match added.');
  });
}

function _renderMatchHistory(players, filterCat = '', filterPlayerId = '') {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  let matches = Data.loadMatches();
  if (filterCat) matches = matches.filter(m => m.category === filterCat);
  if (filterPlayerId) matches = matches.filter(m =>
    [...m.teamA, ...m.teamB].includes(filterPlayerId));

  matches = [...matches].sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = matches.map(m => {
    const teamA = m.teamA.map(id => playerName(id, players)).join(' & ');
    const teamB = m.teamB.map(id => playerName(id, players)).join(' & ');
    return `<tr data-id="${m.id}">
      <td class="px-3 py-2 text-sm">${formatDate(m.date)}</td>
      <td class="px-3 py-2 text-sm font-medium">${m.category}</td>
      <td class="px-3 py-2 text-sm">${teamA}</td>
      <td class="px-3 py-2 text-sm">${m.scoreA}–${m.scoreB}</td>
      <td class="px-3 py-2 text-sm">${teamB}</td>
      <td class="px-3 py-2 text-sm capitalize">${m.matchType}</td>
      <td class="px-3 py-2 text-sm text-gray-400">${m.notes ?? ''}</td>
      <td class="px-3 py-2">
        <button class="btn-edit text-blue-600 hover:underline text-xs mr-2" data-id="${m.id}">Edit</button>
        <button class="btn-delete text-red-500 hover:underline text-xs" data-id="${m.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function _wireMatchHistory(players) {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  tbody.addEventListener('click', e => {
    const id = e.target.dataset.id;
    if (!id) return;

    if (e.target.classList.contains('btn-delete')) {
      if (!confirm('Delete this match? Ratings will be recalculated.')) return;
      Data.deleteMatch(id);
      _renderMatchHistory(players);
      _showToast('Match deleted.');
      return;
    }

    if (e.target.classList.contains('btn-edit')) {
      _showEditModal(id, players);
    }
  });

  const filterCat = document.getElementById('filter-category');
  const filterPlayer = document.getElementById('filter-player');

  if (filterPlayer) {
    filterPlayer.innerHTML = `<option value="">All players</option>` +
      players.filter(p => p.active).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  [filterCat, filterPlayer].forEach(sel => {
    if (sel) sel.addEventListener('change', () =>
      _renderMatchHistory(players, filterCat?.value ?? '', filterPlayer?.value ?? ''));
  });

  const exportBtn = document.getElementById('btn-export-csv');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const matches = Data.loadMatches();
      Data.exportMatchesCSV(matches, players);
    });
  }
}

function _showEditModal(matchId, players) {
  const match = Data.loadMatches().find(m => m.id === matchId);
  if (!match) return;

  const existing = document.getElementById('edit-modal');
  if (existing) existing.remove();

  const doubles = _isDoubles(match.category);
  const gender = _genderForCategory(match.category);

  function opts(selected) {
    return players.filter(p => p.active && p.gender === gender)
      .map(p => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${p.name}</option>`)
      .join('');
  }

  const modal = document.createElement('div');
  modal.id = 'edit-modal';
  modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
      <h2 class="text-lg font-semibold mb-4">Edit Match</h2>
      <form id="edit-form" class="space-y-3">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="label">Date</label>
            <input type="date" id="edit-date" value="${match.date}" class="input" required>
          </div>
          <div class="flex-1">
            <label class="label">Type</label>
            <select id="edit-type" class="input">
              ${['tournament','club','recreational'].map(t =>
                `<option value="${t}"${t === match.matchType ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Team A P1</label>
            <select id="edit-a1" class="input"><option value="">— select —</option>${opts(match.teamA[0])}</select>
          </div>
          ${doubles ? `<div><label class="label">Team A P2</label>
            <select id="edit-a2" class="input"><option value="">— select —</option>${opts(match.teamA[1])}</select></div>` : ''}
          <div>
            <label class="label">Team B P1</label>
            <select id="edit-b1" class="input"><option value="">— select —</option>${opts(match.teamB[0])}</select>
          </div>
          ${doubles ? `<div><label class="label">Team B P2</label>
            <select id="edit-b2" class="input"><option value="">— select —</option>${opts(match.teamB[1])}</select></div>` : ''}
        </div>
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="label">Score A</label>
            <input type="number" id="edit-sa" value="${match.scoreA}" class="input" min="0">
          </div>
          <div class="flex-1">
            <label class="label">Score B</label>
            <input type="number" id="edit-sb" value="${match.scoreB}" class="input" min="0">
          </div>
        </div>
        <div>
          <label class="label">Notes</label>
          <input type="text" id="edit-notes" value="${match.notes ?? ''}" class="input">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="edit-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(modal);
  document.getElementById('edit-cancel').addEventListener('click', () => modal.remove());

  document.getElementById('edit-form').addEventListener('submit', e => {
    e.preventDefault();
    const updated = {
      ...match,
      date: document.getElementById('edit-date').value,
      matchType: document.getElementById('edit-type').value,
      teamA: doubles
        ? [document.getElementById('edit-a1').value, document.getElementById('edit-a2').value]
        : [document.getElementById('edit-a1').value],
      teamB: doubles
        ? [document.getElementById('edit-b1').value, document.getElementById('edit-b2').value]
        : [document.getElementById('edit-b1').value],
      scoreA: parseInt(document.getElementById('edit-sa').value, 10),
      scoreB: parseInt(document.getElementById('edit-sb').value, 10),
      notes: document.getElementById('edit-notes').value.trim() || undefined,
    };
    Data.updateMatch(updated);
    modal.remove();
    _renderMatchHistory(players);
    _showToast('Match updated.');
  });
}

function _wireCSVUpload(players) {
  const dropzone = document.getElementById('csv-dropzone');
  const fileInput = document.getElementById('csv-file');
  const preview = document.getElementById('csv-preview');
  const resolutionContainer = document.getElementById('new-members-resolution');
  const confirmBtn = document.getElementById('csv-confirm');
  const sampleBtn = document.getElementById('btn-download-sample');

  if (!dropzone || !fileInput) return;

  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => _downloadSampleCSV());
  }

  let pendingRows = [];
  // nameMap: lowercase name → player id (built after resolution step)
  let resolvedNameMap = {};

  const reset = () => {
    pendingRows = [];
    resolvedNameMap = {};
    if (preview) preview.innerHTML = '';
    if (resolutionContainer) { resolutionContainer.innerHTML = ''; resolutionContainer.classList.add('hidden'); }
    if (confirmBtn) confirmBtn.classList.add('hidden');
  };

  const handleFile = async (file) => {
    reset();
    try {
      const rows = await Data.importCSV(file);
      pendingRows = rows;
      const currentPlayers = Data.loadPlayers();
      const unknowns = _detectUnknownNames(rows, currentPlayers);
      _renderCSVPreview(rows, currentPlayers, preview, unknowns);

      if (unknowns.length > 0) {
        resolutionContainer.classList.remove('hidden');
        _renderNewMemberResolution(unknowns, currentPlayers, resolutionContainer, (nameMap) => {
          resolvedNameMap = nameMap;
          resolutionContainer.classList.add('hidden');
          if (confirmBtn) confirmBtn.classList.remove('hidden');
        });
      } else {
        if (confirmBtn) confirmBtn.classList.remove('hidden');
      }
    } catch (err) {
      alert('CSV parse error: ' + err.message);
    }
  };

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const currentPlayers = Data.loadPlayers();
      const count = _importCSVRows(pendingRows, currentPlayers, resolvedNameMap);
      reset();
      // Refresh the local players reference used by other parts of the page
      const freshPlayers = Data.loadPlayers();
      players.length = 0;
      freshPlayers.forEach(p => players.push(p));
      _renderMatchHistory(players);
      const filterPlayer = document.getElementById('filter-player');
      if (filterPlayer) {
        filterPlayer.innerHTML = `<option value="">All players</option>` +
          players.filter(p => p.active).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      }
      _showToast(`${count} match${count !== 1 ? 'es' : ''} imported.`);
    });
  }
}

// Return array of names (as they appear in the CSV) that don't match any existing player.
function _detectUnknownNames(rows, players) {
  const seen = new Set();
  const unknown = [];
  for (const row of rows) {
    const names = [row.team_a_p1, row.team_a_p2, row.team_b_p1, row.team_b_p2]
      .map(n => n?.trim())
      .filter(Boolean);
    for (const name of names) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const exists = players.some(p => p.name.toLowerCase() === name.toLowerCase());
      if (!exists) unknown.push(name);
    }
  }
  return unknown;
}

// Render a resolution UI for unknown names. Calls onResolved(nameMap) when confirmed.
// nameMap: lowercase-name → player id
function _renderNewMemberResolution(unknownNames, players, container, onResolved) {
  const existingOpts = players
    .filter(p => p.active)
    .map(p => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  container.innerHTML = `
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-4">
      <h3 class="text-sm font-semibold text-amber-800 mb-1">Unknown members in CSV</h3>
      <p class="text-xs text-amber-700 mb-3">
        The following names were not found in your member list. For each one, choose to add them as a new member or map them to an existing member.
      </p>
      <div class="space-y-3" id="resolution-rows">
        ${unknownNames.map((name, i) => `
          <div class="flex flex-wrap items-center gap-2 bg-white border border-amber-200 rounded p-2" data-name="${name}">
            <span class="font-medium text-sm text-amber-900 w-36 shrink-0">"${name}"</span>
            <label class="flex items-center gap-1 text-xs cursor-pointer">
              <input type="radio" name="res-${i}" value="new" checked class="res-radio"> Add as new member
            </label>
            <select class="input text-xs py-0.5 w-24 res-gender">
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
            <label class="flex items-center gap-1 text-xs cursor-pointer">
              <input type="radio" name="res-${i}" value="map" class="res-radio"> Map to existing
            </label>
            <select class="input text-xs py-0.5 w-36 res-existing" disabled>
              <option value="">— select —</option>${existingOpts}
            </select>
          </div>`).join('')}
      </div>
      <div class="mt-3 flex justify-end">
        <button id="btn-confirm-members" class="btn-primary text-sm">Confirm Members →</button>
      </div>
    </div>`;

  // Toggle disabled state based on radio selection
  container.querySelectorAll('[data-name]').forEach(row => {
    const radios = row.querySelectorAll('.res-radio');
    const genderSel = row.querySelector('.res-gender');
    const existingSel = row.querySelector('.res-existing');
    radios.forEach(r => r.addEventListener('change', () => {
      const isNew = row.querySelector('input[value="new"]').checked;
      genderSel.disabled = !isNew;
      existingSel.disabled = isNew;
    }));
  });

  container.querySelector('#btn-confirm-members').addEventListener('click', () => {
    const nameMap = {};
    let valid = true;
    container.querySelectorAll('[data-name]').forEach(row => {
      const csvName = row.dataset.name;
      const isNew = row.querySelector('input[value="new"]').checked;
      if (isNew) {
        const gender = row.querySelector('.res-gender').value;
        const newPlayer = {
          id: crypto.randomUUID(),
          name: csvName,
          gender,
          joinedDate: new Date().toISOString().slice(0, 10),
          active: true,
        };
        Data.addPlayer(newPlayer);
        nameMap[csvName.toLowerCase()] = newPlayer.id;
      } else {
        const mappedId = row.querySelector('.res-existing').value;
        if (!mappedId) {
          alert(`Please select an existing member to map "${csvName}" to.`);
          valid = false;
          return;
        }
        nameMap[csvName.toLowerCase()] = mappedId;
      }
    });
    if (valid) onResolved(nameMap);
  });
}

// resolvedNameMap: lowercase name → player id (for names resolved in the UI)
// Falls back to exact case-insensitive match against players for known names.
function _csvRowToMatch(row, players, resolvedNameMap) {
  const cat = row.category?.trim().toUpperCase();

  const resolveId = (name) => {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    // Check pre-resolved unknowns first
    if (resolvedNameMap[trimmed.toLowerCase()]) return resolvedNameMap[trimmed.toLowerCase()];
    // Fall back to existing player lookup
    const p = players.find(pl => pl.name.toLowerCase() === trimmed.toLowerCase());
    return p?.id ?? null;
  };

  const a1Id = resolveId(row.team_a_p1);
  const a2Id = resolveId(row.team_a_p2);
  const b1Id = resolveId(row.team_b_p1);
  const b2Id = resolveId(row.team_b_p2);

  if (!a1Id || !b1Id) return null;

  const teamA = a2Id ? [a1Id, a2Id] : [a1Id];
  const teamB = b2Id ? [b1Id, b2Id] : [b1Id];

  return {
    id: crypto.randomUUID(),
    date: row.date?.trim(),
    category: cat,
    matchType: row.match_type?.trim() ?? 'club',
    teamA,
    teamB,
    scoreA: parseInt(row.score_a, 10),
    scoreB: parseInt(row.score_b, 10),
    notes: row.notes?.trim() || undefined,
  };
}

function _importCSVRows(rows, players, resolvedNameMap = {}) {
  let count = 0;
  for (const row of rows) {
    try {
      const match = _csvRowToMatch(row, players, resolvedNameMap);
      if (!match || !match.date || isNaN(match.scoreA) || isNaN(match.scoreB)) continue;
      Data.addMatch(match);
      count++;
    } catch {
      // skip malformed rows
    }
  }
  return count;
}

// unknownNames: Set of lowercase names that are not in the member list
function _renderCSVPreview(rows, players, container, unknownNames = []) {
  if (!container) return;
  const unknownSet = new Set(unknownNames.map(n => n.toLowerCase()));

  const nameCell = (name) => {
    if (!name?.trim()) return '<span class="text-gray-300">—</span>';
    const isUnknown = unknownSet.has(name.trim().toLowerCase());
    return isUnknown
      ? `<span class="text-amber-600 font-semibold" title="New member">${name} ⚠</span>`
      : name;
  };

  container.innerHTML = `
    <table class="w-full text-xs border-collapse">
      <thead><tr class="bg-gray-100">
        <th class="px-2 py-1 text-left">Date</th>
        <th class="px-2 py-1 text-left">Cat</th>
        <th class="px-2 py-1 text-left">Team A</th>
        <th class="px-2 py-1 text-left">Score</th>
        <th class="px-2 py-1 text-left">Team B</th>
        <th class="px-2 py-1 text-left">Type</th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr class="border-t hover:bg-gray-50">
        <td class="px-2 py-1">${r.date ?? ''}</td>
        <td class="px-2 py-1 font-medium">${r.category ?? ''}</td>
        <td class="px-2 py-1">${[nameCell(r.team_a_p1), r.team_a_p2?.trim() ? nameCell(r.team_a_p2) : null].filter(Boolean).join(' &amp; ')}</td>
        <td class="px-2 py-1 font-mono">${r.score_a}–${r.score_b}</td>
        <td class="px-2 py-1">${[nameCell(r.team_b_p1), r.team_b_p2?.trim() ? nameCell(r.team_b_p2) : null].filter(Boolean).join(' &amp; ')}</td>
        <td class="px-2 py-1 capitalize">${r.match_type ?? 'club'}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${unknownNames.length > 0 ? `<p class="text-xs text-amber-600 px-2 py-1"><span class="font-bold">⚠</span> = name not found in member list — resolve above before importing.</p>` : ''}`;
}

function _downloadSampleCSV() {
  const sample = [
    'date,category,match_type,team_a_p1,team_a_p2,team_b_p1,team_b_p2,score_a,score_b',
    '2026-04-20,MD,club,Alice,Bob,Charlie,Dave,11,7',
    '2026-04-20,WD,club,Carol,Eve,Diana,Fiona,11,9',
    '2026-04-20,MS,club,Bob,,Charlie,,11,8',
    '2026-04-20,WS,tournament,Alice,,Diana,,11,6',
  ].join('\n');
  const blob = new Blob([sample], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'acedupr-sample.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Leaderboard (leaderboard.html) ───────────────────────────────────────────

export function initLeaderboard() {
  if (!guardCDN()) return;

  const players = Data.loadPlayers();
  const matches = Data.loadMatches();
  const asOf = Date.now();
  const asOf30 = asOf - 30 * 24 * 60 * 60 * 1000;

  const ratings = computeRatings(matches, players, { asOf });
  const ratings30 = computeRatings(matches, players, { asOf: asOf30 });

  let activeCategory = 'MD';
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeCategory = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === activeCategory));
      _renderLeaderboard(activeCategory, players, ratings, ratings30);
    });
  });

  _renderLeaderboard(activeCategory, players, ratings, ratings30);
}

function _renderLeaderboard(cat, players, ratings, ratings30) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  const rMap30 = _ratingMap(ratings30);
  const catRatings = ratings
    .filter(r => r.category === cat && r.matchCount > 0)
    .sort((a, b) => {
      if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
      return b.rating - a.rating;
    });

  tbody.innerHTML = catRatings.map((r, i) => {
    const p = players.find(pl => pl.id === r.playerId);
    if (!p) return '';
    const r30 = rMap30[`${r.playerId}:${cat}`];
    const delta = r30 ? r.rating - r30.rating : 0;
    const rankDisplay = r.inactive ? '—' : String(i + 1 - catRatings.slice(0, i).filter(x => x.inactive).length);
    return `<tr class="${r.inactive ? 'opacity-50' : 'hover:bg-blue-50'}">
      <td class="px-4 py-2 font-mono text-sm">${rankDisplay}</td>
      <td class="px-4 py-2">
        <a href="player.html?id=${r.playerId}" class="text-blue-600 hover:underline">${p.name}</a>
      </td>
      <td class="px-4 py-2 font-mono">${formatRating(r.rating)}</td>
      <td class="px-4 py-2">${trendArrow(delta)}</td>
      <td class="px-4 py-2 text-sm text-gray-500">${r.matchCount}</td>
      <td class="px-4 py-2">${reliabilityBadge(r)}</td>
    </tr>`;
  }).join('');
}

// ── Player Profile (player.html) ─────────────────────────────────────────────

export function initPlayer(playerId) {
  if (!guardCDN()) return;

  const players = Data.loadPlayers();
  const matches = Data.loadMatches();
  const asOf = Date.now();

  const player = players.find(p => p.id === playerId);
  if (!player) {
    document.getElementById('app').innerHTML = '<p class="p-8 text-red-600">Player not found.</p>';
    return;
  }

  const ratings = computeRatings(matches, players, { asOf });
  _renderPlayerHeader(player);
  _renderPlayerCards(player, ratings, matches);
  _wirePlayerCharts(matches, players, player, asOf);
  _renderPlayerMatchHistory(player, matches, players);
}

function _renderPlayerHeader(player) {
  const el = document.getElementById('player-name');
  if (el) el.textContent = player.name;
  const sub = document.getElementById('player-meta');
  if (sub) sub.textContent = `${player.gender === 'M' ? 'Male' : 'Female'} · Joined ${formatDate(player.joinedDate)}${player.active ? '' : ' · Inactive'}`;
}

function _renderPlayerCards(player, ratings, matches) {
  const container = document.getElementById('rating-cards');
  if (!container) return;

  container.innerHTML = CATEGORIES.map(cat => {
    const r = ratings.find(x => x.playerId === player.id && x.category === cat);
    const catMatches = matches.filter(m =>
      m.category === cat && [...m.teamA, ...m.teamB].includes(player.id));
    const wins = catMatches.filter(m => {
      const onA = m.teamA.includes(player.id);
      return onA ? m.scoreA > m.scoreB : m.scoreB > m.scoreA;
    }).length;
    const losses = catMatches.length - wins;

    if (!r) {
      return `<div class="card text-center">
        <div class="text-lg font-bold text-gray-300">${cat}</div>
        <div class="text-gray-400 text-sm mt-1">No matches</div>
      </div>`;
    }
    return `<div class="card text-center cursor-pointer hover:ring-2 hover:ring-blue-400 transition" onclick="selectCategory('${cat}')">
      <div class="text-lg font-bold text-blue-700">${cat}</div>
      <div class="text-2xl font-mono font-semibold mt-1">${r.provisional ? '<span class="text-amber-500">~</span>' : ''}${formatRating(r.rating)}</div>
      <div class="mt-1">${reliabilityBadge(r)}</div>
      <div class="text-sm text-gray-500 mt-1">${wins}W ${losses}L</div>
    </div>`;
  }).join('');
}

function _wirePlayerCharts(matches, players, player, asOf) {
  let activeCategory = null;

  window.selectCategory = (cat) => {
    if (activeCategory === cat) return;
    activeCategory = cat;
    const history = computeRatingHistory(matches, players, player.id, cat, asOf);
    const chartArea = document.getElementById('chart-area');
    if (chartArea) chartArea.classList.remove('hidden');
    Charts.renderProgressionChart('progression-chart', history, cat);
    document.querySelectorAll('.card').forEach(c => c.classList.remove('ring-2', 'ring-blue-400'));
  };
}

function _renderPlayerMatchHistory(player, matches, players) {
  const tbody = document.getElementById('player-history-tbody');
  if (!tbody) return;

  const playerMatches = matches
    .filter(m => [...m.teamA, ...m.teamB].includes(player.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);

  tbody.innerHTML = playerMatches.map(m => {
    const onA = m.teamA.includes(player.id);
    const won = onA ? m.scoreA > m.scoreB : m.scoreB > m.scoreA;
    const partners = (onA ? m.teamA : m.teamB).filter(id => id !== player.id).map(id => playerName(id, players));
    const opponents = (onA ? m.teamB : m.teamA).map(id => playerName(id, players));
    return `<tr class="border-t hover:bg-gray-50">
      <td class="px-3 py-2 text-sm">${formatDate(m.date)}</td>
      <td class="px-3 py-2 text-sm font-medium">${m.category}</td>
      <td class="px-3 py-2 text-sm">${partners.join(' & ') || '—'}</td>
      <td class="px-3 py-2 text-sm">${opponents.join(' & ')}</td>
      <td class="px-3 py-2 text-sm font-mono">${onA ? `${m.scoreA}–${m.scoreB}` : `${m.scoreB}–${m.scoreA}`}</td>
      <td class="px-3 py-2 text-sm font-semibold ${won ? 'text-green-600' : 'text-red-500'}">${won ? 'W' : 'L'}</td>
    </tr>`;
  }).join('');
}

// ── Settings (settings.html) ─────────────────────────────────────────────────

export function initSettings() {
  if (!guardCDN()) return;

  const players = Data.loadPlayers();
  _renderMembersTable(players);
  _wireMembersForm(players);
  _wireDataManagement();
}

function _renderMembersTable(players) {
  const tbody = document.getElementById('members-tbody');
  if (!tbody) return;
  tbody.innerHTML = players.map(p => `<tr class="${p.active ? '' : 'opacity-50'}" data-id="${p.id}">
    <td class="px-3 py-2">${p.name}</td>
    <td class="px-3 py-2">${p.gender === 'M' ? 'Male' : 'Female'}</td>
    <td class="px-3 py-2 text-sm text-gray-500">${formatDate(p.joinedDate)}</td>
    <td class="px-3 py-2">${p.active ? '<span class="text-green-600">Active</span>' : '<span class="text-gray-400">Inactive</span>'}</td>
    <td class="px-3 py-2">
      <button class="btn-toggle-active text-xs ${p.active ? 'text-amber-600' : 'text-green-600'} hover:underline" data-id="${p.id}">
        ${p.active ? 'Deactivate' : 'Activate'}
      </button>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', e => {
    if (!e.target.classList.contains('btn-toggle-active')) return;
    const id = e.target.dataset.id;
    const players = Data.loadPlayers();
    const p = players.find(x => x.id === id);
    if (!p) return;
    Data.updatePlayer({ ...p, active: !p.active });
    _renderMembersTable(Data.loadPlayers());
  });
}

function _wireMembersForm(players) {
  const form = document.getElementById('member-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('member-name').value.trim();
    const gender = document.getElementById('member-gender').value;
    const joined = document.getElementById('member-joined').value || new Date().toISOString().slice(0, 10);
    if (!name) return;
    Data.addPlayer({ id: crypto.randomUUID(), name, gender, joinedDate: joined, active: true });
    form.reset();
    document.getElementById('member-joined').value = new Date().toISOString().slice(0, 10);
    _renderMembersTable(Data.loadPlayers());
    _showToast('Member added.');
  });

  const joinedInput = document.getElementById('member-joined');
  if (joinedInput) joinedInput.value = new Date().toISOString().slice(0, 10);
}

function _wireDataManagement() {
  const exportBtn = document.getElementById('btn-export-json');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const json = Data.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `acedupr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  const importInput = document.getElementById('import-json-file');
  const importBtn = document.getElementById('btn-import-json');
  if (importInput && importBtn) {
    importBtn.addEventListener('click', () => {
      const file = importInput.files[0];
      if (!file) { alert('Select a backup file first.'); return; }
      if (!confirm('This will REPLACE all current players and matches. Continue?')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = Data.importJSON(reader.result);
        if (result.ok) {
          _renderMembersTable(Data.loadPlayers());
          _showToast('Data imported successfully.');
        } else {
          alert('Import failed: ' + result.error);
        }
      };
      reader.readAsText(file);
    });
  }

  const resetBtn = document.getElementById('btn-reset');
  const resetConfirm = document.getElementById('reset-confirm-input');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const val = resetConfirm?.value?.trim();
      if (val !== 'RESET') {
        alert('Type RESET in the confirmation box to proceed.');
        return;
      }
      if (!confirm('This will permanently delete ALL data. Are you sure?')) return;
      Data.clearAll();
      if (resetConfirm) resetConfirm.value = '';
      _renderMembersTable(Data.loadPlayers());
      _showToast('All data cleared.');
    });
  }
}

// ── Shared toast ─────────────────────────────────────────────────────────────

function _showToast(msg) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'fixed bottom-6 right-6 bg-gray-800 text-white px-4 py-2 rounded shadow-lg text-sm z-50 transition-opacity';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 2500);
}
