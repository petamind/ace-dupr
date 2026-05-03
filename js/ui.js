import Data, { DataFile, DataSheets } from './data.js';
import { computeRatings, computeRatingHistory, CONSTANTS } from './rating.js';
import Charts from './charts.js';
import { initGoogleAuth, getAuthState, signOut } from './auth.js';
import { SheetsWrite } from './sheets-write.js';
import { suggestMatches, suggestKotC, splitTeams } from './suggest.js';

// ── Match history pagination state ───────────────────────────────────────────
let _histPage = 0;

// ── Demo auth ─────────────────────────────────────────────────────────────────
// Used only when ?demo is active so admin-only UI sections are visible locally.
const _DEMO_AUTH = {
  email: 'demo@admin.local', name: 'Demo Admin', picture: null,
  mappedPlayerId: 'p1', mappedPlayerName: 'Demo Admin', role: 'admin',
};

function _effectiveAuth(mode) {
  return mode === 'demo' ? _DEMO_AUTH : getAuthState();
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function formatRating(v) {
  return v.toFixed(3);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString();
}

// Local-timezone YYYY-MM-DD. Use this for any user-facing date default —
// `toISOString().slice(0,10)` returns UTC and is a day off in many timezones.
function _todayIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// Adjusted win rate using Laplace smoothing (+2W +2L prior).
// Below WIN_RATE_THRESHOLD matches the result is prefixed with ~ to signal low reliability.
const _WIN_RATE_THRESHOLD = 20;
function _winRateDisplay(wins, losses) {
  const total = wins + losses;
  if (total === 0) return { text: '—', colorClass: 'text-gray-300', rate: null };
  const rate = (wins + 2) / (total + 4);
  const pct = Math.round(rate * 100);
  const text = total < _WIN_RATE_THRESHOLD ? `~${pct}%` : `${pct}%`;
  const colorClass = rate >= 0.6 ? 'text-green-600' : rate >= 0.4 ? 'text-amber-500' : 'text-red-500';
  return { text, colorClass, rate };
}

const _isRated = m => m.matchType !== 'unrated';

// ── Auth helpers ──────────────────────────────────────────────────────────────

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// players: pre-loaded array passed from pages that already have it in memory.
// Pass null to lazy-load players from DataSheets if mapping is needed.
function _renderNavAuth(players = null, mode = null) {
  const el = document.getElementById('nav-auth');
  if (!el) return;
  el.innerHTML = '';
  const isDemo = mode === 'demo';
  const auth = _effectiveAuth(mode);
  if (auth?.mappedPlayerName) {
    const wrap = document.createElement('div');
    wrap.className = 'relative';

    const avatar = document.createElement('button');
    avatar.title = auth.mappedPlayerName;
    avatar.setAttribute('aria-label', 'Account menu');

    if (auth.picture) {
      avatar.className = 'w-8 h-8 rounded-full overflow-hidden border-2 border-transparent hover:border-blue-400 transition-colors focus:outline-none';
      const img = document.createElement('img');
      img.src = auth.picture;
      img.alt = auth.mappedPlayerName;
      img.className = 'w-full h-full object-cover';
      img.referrerPolicy = 'no-referrer';
      avatar.appendChild(img);
    } else {
      const bg = isDemo ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700';
      avatar.className = `w-8 h-8 rounded-full ${bg} text-white text-sm font-semibold flex items-center justify-center transition-colors focus:outline-none`;
      avatar.textContent = auth.mappedPlayerName.charAt(0).toUpperCase();
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'hidden absolute right-0 top-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50';
    dropdown.style.minWidth = '10rem';

    const nameRow = document.createElement('div');
    nameRow.className = 'px-3 py-2 text-xs text-gray-500 border-b border-gray-100';
    if (isDemo) {
      nameRow.innerHTML = 'Demo Admin <span class="ml-1 text-purple-600 font-medium">Admin</span>';
    } else {
      nameRow.textContent = auth.mappedPlayerName;
    }

    dropdown.append(nameRow);

    if (!isDemo) {
      const signOutBtn = document.createElement('button');
      signOutBtn.className = 'w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50';
      signOutBtn.textContent = 'Sign out';
      signOutBtn.addEventListener('click', () => { signOut(); location.reload(); });
      dropdown.append(signOutBtn);
    }

    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => dropdown.classList.add('hidden'));

    wrap.append(avatar, dropdown);
    el.appendChild(wrap);
  } else {
    const btnDiv = document.createElement('div');
    btnDiv.id = 'g-signin-btn';
    el.appendChild(btnDiv);
    _initAuthNav(players);
  }
}

// Initialises GIS sign-in flow. Pass loadedPlayers (array) when already in
// memory (e.g. matches.html) to skip a second DataSheets.load() call; pass
// null on other pages and they will be fetched lazily if mapping is needed.
function _initAuthNav(loadedPlayers) {
  initGoogleAuth(async (decoded) => {
    let result;
    try {
      result = await SheetsWrite.lookup(decoded.email);
    } catch (err) {
      _showToast('Could not reach server. Try again.');
      console.error('SheetsWrite.lookup failed', err);
      return;
    }
    if (!result || typeof result.found !== 'boolean') {
      _showToast('Unexpected server response. Please try again.');
      console.error('lookup returned unexpected shape', result);
      return;
    }
    if (result.found) {
      if (!result.playerId || !result.playerName) {
        _showToast('Sign-in error: incomplete server response.');
        console.error('lookup found=true but missing fields', result);
        return;
      }
      Data.saveAuth({ ...decoded, mappedPlayerId: result.playerId, mappedPlayerName: result.playerName, role: result.role ?? 'member' });
      location.reload();
    } else {
      const players = loadedPlayers ?? (await DataSheets.load())?.players ?? [];
      if (!players.length) {
        _showToast('Could not load player list. Please reload and try again.');
        return;
      }
      // Auto-map silently if the Google display name exactly matches a player name
      const autoMatch = players.find(p => p.name.toLowerCase() === decoded.name.toLowerCase());
      if (autoMatch) {
        const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
        try {
          const res = await Promise.race([SheetsWrite.mapEmail(decoded.email, autoMatch.name), deadline]);
          if (res.ok) {
            Data.saveAuth({ ...decoded, mappedPlayerId: autoMatch.id, mappedPlayerName: autoMatch.name, role: 'member' });
            location.reload();
            return;
          }
        } catch (_) { /* fall through to manual modal */ }
      }
      _showMappingModal(decoded, players, autoMatch);
    }
  });
}

function _showMappingModal(decoded, players, suggested = null) {
  const modal = document.createElement('div');
  modal.id = 'mapping-modal';
  modal.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
      <h2 class="font-semibold text-gray-800 text-lg">Welcome, ${_escapeHtml(decoded.name)}!</h2>
      <p class="text-sm text-gray-500">Your Google account wasn't automatically recognised. Please select your player name below to link it.</p>
      <select id="mapping-select" class="input w-full">
        <option value="">— select your name —</option>
        ${players.filter(p => p.active).map(p => `<option value="${_escapeHtml(p.name)}"${suggested && p.id === suggested.id ? ' selected' : ''}>${_escapeHtml(p.name)}</option>`).join('')}
      </select>
      <p id="mapping-error" class="text-xs text-red-500 hidden"></p>
      <div class="flex justify-end gap-2 pt-1">
        <button id="mapping-cancel" class="btn-secondary text-sm">Cancel</button>
        <button id="mapping-confirm" class="btn-primary text-sm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('#mapping-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#mapping-confirm').addEventListener('click', async () => {
    const playerName = modal.querySelector('#mapping-select').value;
    const errEl = modal.querySelector('#mapping-error');
    if (!playerName) { errEl.textContent = 'Please select a name.'; errEl.classList.remove('hidden'); return; }

    const confirmBtn = modal.querySelector('#mapping-confirm');
    confirmBtn.textContent = 'Saving…';
    confirmBtn.disabled = true;

    let res;
    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
    try {
      res = await Promise.race([SheetsWrite.mapEmail(decoded.email, playerName), deadline]);
    } catch (err) {
      if (!document.body.contains(modal)) return;
      errEl.textContent = err.message === 'timeout' ? 'Request timed out. Try again.' : 'Network error. Try again.';
      errEl.classList.remove('hidden');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.disabled = false;
      return;
    }
    if (!document.body.contains(modal)) return;

    if (!res.ok) {
      errEl.textContent = res.error ?? 'Could not link account.';
      errEl.classList.remove('hidden');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.disabled = false;
      return;
    }

    const player = players.find(p => p.name === playerName);
    Data.saveAuth({ ...decoded, mappedPlayerId: player?.id ?? 'f:' + playerName.toLowerCase(), mappedPlayerName: playerName });
    modal.remove();
    location.reload();
  });
}

function guardCDN(requireChart = true) {
  const missing = (requireChart && typeof Chart === 'undefined') || typeof Papa === 'undefined';
  if (missing) {
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML =
        '<p class="text-red-600 p-8 text-center">This app requires an internet connection to load its libraries. Please reload with a connection.</p>';
    }
    return false;
  }
  return true;
}

// Try Google Sheets first, then repo CSV files, then localStorage.
// ?demo skips all network calls and returns hardcoded fake data for local review.
async function _loadData() {
  if (new URLSearchParams(location.search).has('demo')) return _demoData();
  const sheetsData = await DataSheets.load();
  if (sheetsData) return { ...sheetsData, mode: 'sheets' };
  const fileData = await DataFile.load();
  if (fileData) return { ...fileData, mode: 'file' };
  return { players: Data.loadPlayers(), matches: Data.loadMatches(), mode: 'local' };
}

function _demoData() {
  const pl = (id, name, gender, quote = '') => ({ id, name, gender, joinedDate: '2026-01-01', active: true, quote });
  const players = [
    pl('p1',  'Alice',   'F', 'Every point is a new opportunity!'),
    pl('p2',  'Bob',     'M', 'Dink responsibly.'),
    pl('p3',  'Carol',   'F'),
    pl('p4',  'Dave',    'M', 'The kitchen is my happy place.'),
    pl('p5',  'Eve',     'F'), pl('p6',  'Frank',  'M'),
    pl('p7',  'Grace',   'F'), pl('p8',  'Henry',  'M'),
    pl('p9',  'Ivy',     'F'), pl('p10', 'Jake',   'M'),
  ];
  const mk = (id, date, cat, type, tA, tB, sA, sB) =>
    ({ id, date, category: cat, matchType: type, teamA: tA, teamB: tB, scoreA: sA, scoreB: sB });

  const matches = [
    // ── Week 1 of April (Apr 6-12) ──
    mk('w1m01','2026-04-06','MD','club',   ['p2','p4'],  ['p6','p8'],  11, 7),
    mk('w1m02','2026-04-06','WD','club',   ['p1','p3'],  ['p5','p7'],  11, 8),
    mk('w1m03','2026-04-06','XD','club',   ['p2','p1'],  ['p4','p3'],  11, 9),
    mk('w1m04','2026-04-07','MS','club',   ['p2'],       ['p4'],       11, 6),
    mk('w1m05','2026-04-07','WS','club',   ['p1'],       ['p3'],       11, 8),
    mk('w1m06','2026-04-08','MD','club',   ['p6','p8'],  ['p2','p4'],  11, 9),
    mk('w1m07','2026-04-09','WD','club',   ['p5','p7'],  ['p1','p3'],  11, 7),
    mk('w1m08','2026-04-10','XD','club',   ['p4','p5'],  ['p2','p9'],  11, 8),
    mk('w1m09','2026-04-11','MS','club',   ['p6'],       ['p8'],       11, 9),
    mk('w1m10','2026-04-12','WS','club',   ['p5'],       ['p7'],       11, 6),

    // ── Week 2 of April (Apr 13-19) ──
    mk('w2m01','2026-04-13','MD','club',   ['p2','p10'], ['p6','p4'],  11, 5),
    mk('w2m02','2026-04-13','WD','club',   ['p1','p9'],  ['p5','p7'],  11, 6),
    mk('w2m03','2026-04-14','XD','tournament',['p4','p5'],['p6','p7'], 21,15),
    mk('w2m04','2026-04-14','MS','club',   ['p4'],       ['p2'],       11, 8),
    mk('w2m05','2026-04-15','WS','tournament',['p3'],    ['p1'],       21,17),
    mk('w2m06','2026-04-16','MD','club',   ['p4','p6'],  ['p8','p10'], 11, 7),
    mk('w2m07','2026-04-17','WD','club',   ['p3','p5'],  ['p1','p9'],  11, 8),
    mk('w2m08','2026-04-18','XD','club',   ['p8','p3'],  ['p10','p9'], 11, 7),
    mk('w2m09','2026-04-18','MS','club',   ['p2'],       ['p10'],      11, 4),
    mk('w2m10','2026-04-19','WS','club',   ['p1'],       ['p9'],       11, 7),

    // ── Week 3 of April (Apr 20-26) — "this week" ──
    mk('w3m01','2026-04-20','MD','tournament',['p2','p4'],['p6','p8'], 21,11),
    mk('w3m02','2026-04-20','WD','club',   ['p1','p3'],  ['p5','p9'],  11, 7),
    mk('w3m03','2026-04-21','XD','club',   ['p2','p1'],  ['p10','p9'], 11, 6),
    mk('w3m04','2026-04-21','MS','club',   ['p2'],       ['p6'],       11, 4),
    mk('w3m05','2026-04-22','WS','club',   ['p1'],       ['p5'],       11, 6),
    mk('w3m06','2026-04-23','MD','club',   ['p4','p10'], ['p2','p8'],  11, 9),
    mk('w3m07','2026-04-24','WD','tournament',['p3','p7'],['p1','p5'], 21,14),
    mk('w3m08','2026-04-25','XD','club',   ['p8','p3'],  ['p2','p7'],  11, 8),
    mk('w3m09','2026-04-26','MS','club',   ['p4'],       ['p8'],       11, 5),
    mk('w3m10','2026-04-26','WS','club',   ['p3'],       ['p9'],       11, 7),

    // ── Unrated practice sessions (admin-visible only) ──
    mk('pr01','2026-04-27','MD','unrated', ['p2','p4'],  ['p6','p8'],  11, 7),
    mk('pr02','2026-04-27','WD','unrated', ['p1','p3'],  ['p5','p7'],  11, 6),
    mk('pr03','2026-04-28','MS','unrated', ['p2'],       ['p4'],       11, 8),
    mk('pr04','2026-04-28','WS','unrated', ['p1'],       ['p3'],       11, 5),
    mk('pr05','2026-04-29','XD','unrated', ['p4','p5'],  ['p2','p1'],  11, 9),
  ];

  return { players, matches, mode: 'demo' };
}

function _showModeBanner(mode) {
  const el = document.getElementById('data-mode-banner');
  if (!el) return;
  if (mode === 'demo') {
    el.innerHTML = '<span class="text-purple-600">🧪 Demo data — add ?demo to any page URL</span>';
  } else if (mode === 'sheets') {
    el.innerHTML = '<span class="text-green-600">🟢 Live from Google Sheets</span>';
  } else if (mode === 'file') {
    el.innerHTML = '<span class="text-blue-600">📂 Data from repository files</span>';
  } else {
    el.innerHTML = '<span class="text-gray-400">💾 Local browser storage</span>';
  }
}

// ── Player of the Week / Month ────────────────────────────────────────────────

function _shiftDate(isoDate, days) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function _hasMoreThan2Weeks(matches) {
  if (matches.length < 2) return false;
  const dates = matches.map(m => m.date).sort();
  const [y0, mo0, d0] = dates[0].split('-').map(Number);
  const [y1, mo1, d1] = dates[dates.length - 1].split('-').map(Number);
  const diffMs = new Date(y1, mo1 - 1, d1) - new Date(y0, mo0 - 1, d0);
  return diffMs > 14 * 24 * 60 * 60 * 1000;
}

function _isoWeek(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const day = dt.getDay() || 7;
  dt.setDate(dt.getDate() + 4 - day); // Thursday of ISO week
  const yearStart = new Date(dt.getFullYear(), 0, 1);
  return `${dt.getFullYear()}-W${Math.ceil(((dt - yearStart) / 86400000 + 1) / 7)}`;
}

function _hasAtLeast3WeeksInLatestMonth(matches) {
  if (!matches.length) return false;
  const latestDate = [...matches].sort((a, b) => b.date.localeCompare(a.date))[0].date;
  const monthPrefix = latestDate.slice(0, 7);
  const weeks = new Set(
    matches.filter(m => m.date.startsWith(monthPrefix)).map(m => _isoWeek(m.date))
  );
  return weeks.size >= 3;
}

// For each category: find the player with the highest positive rating delta
// since fromDateStr among those who played at least one match in the period.
function _periodBest(matches, players, currentRatings, fromDateStr) {
  const matchesBefore = matches.filter(m => m.date < fromDateStr);
  const [y, mo, d] = fromDateStr.split('-').map(Number);
  const baselineRatings = computeRatings(matchesBefore, players, { asOf: new Date(y, mo - 1, d).getTime() });
  const baseMap = {};
  baselineRatings.forEach(r => { baseMap[`${r.playerId}:${r.category}`] = r.rating; });

  const periodMatches = matches.filter(m => m.date >= fromDateStr);
  const best = {};

  for (const cat of CATEGORIES) {
    const activePids = new Set(
      periodMatches.filter(m => m.category === cat).flatMap(m => [...m.teamA, ...m.teamB])
    );
    for (const pid of activePids) {
      const curr = currentRatings.find(r => r.playerId === pid && r.category === cat);
      if (!curr) continue;
      const baseRating = baseMap[`${pid}:${cat}`] ?? CONSTANTS.INITIAL_RATING;
      const delta = curr.rating - baseRating;
      if (delta > 0 && (!best[cat] || delta > best[cat].delta)) {
        const player = players.find(p => p.id === pid);
        if (player) best[cat] = { playerId: pid, player, delta, rating: curr.rating };
      }
    }
  }
  return best;
}

function _renderPeriodSection(id, label, icon, best, excludeMap = {}) {
  const el = document.getElementById(id);
  if (!el) return;

  const entries = CATEGORIES
    .filter(cat => best[cat] && excludeMap[cat]?.playerId !== best[cat].playerId)
    .map(cat => ({ cat, ...best[cat] }));

  if (!entries.length) { el.innerHTML = ''; return; }

  const storageKey = `acedupr:collapsed:${id}`;
  el.innerHTML = `
    <div id="toggle-${id}" class="mb-2 flex items-center gap-3 cursor-pointer select-none group">
      <h2 class="text-lg font-semibold text-gray-900">${icon} ${label}</h2>
      <span class="text-xs text-gray-400">Best rating gain per category</span>
      <span class="chev ml-auto text-gray-400 text-xs transition-transform duration-200">▼</span>
    </div>
    <div id="body-${id}">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        ${entries.map(x => `
          <a href="player.html?id=${x.player.id}"
             class="block rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
            <div class="px-4 py-3 text-center">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">${x.cat}</div>
              <div class="font-semibold text-gray-900 text-sm group-hover:text-blue-600 transition-colors truncate">${x.player.name}</div>
              <div class="text-xl font-bold text-green-600 mt-1 tabular-nums">+${x.delta.toFixed(3)}</div>
              <div class="text-xs text-gray-400 mt-0.5">rated ${formatRating(x.rating)}</div>
            </div>
          </a>`).join('')}
      </div>
    </div>`;

  _wireCollapsible(`toggle-${id}`, `body-${id}`, storageKey, true);
}

// ── Best Doubles Pairs ────────────────────────────────────────────────────────

function _bestPairForCategory(cat, matches, players) {
  const stats = {};
  for (const m of matches) {
    if (m.category !== cat) continue;
    for (const [i, team] of [[0, m.teamA], [1, m.teamB]]) {
      if (team.length < 2) continue;
      const key = [...team].sort().join('|');
      if (!stats[key]) stats[key] = { wins: 0, losses: 0, ids: [...team].sort() };
      const won = i === 0 ? m.scoreA > m.scoreB : m.scoreB > m.scoreA;
      won ? stats[key].wins++ : stats[key].losses++;
    }
  }
  return Object.values(stats)
    .map(s => {
      const total = s.wins + s.losses;
      const p1 = players.find(p => p.id === s.ids[0]);
      const p2 = players.find(p => p.id === s.ids[1]);
      return p1 && p2 ? { p1, p2, wins: s.wins, losses: s.losses, total, rate: s.wins / total } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.rate - a.rate || b.wins - a.wins)[0] ?? null;
}

function _renderBestPairs(matches, players) {
  const el = document.getElementById('best-pairs-section');
  if (!el) return;

  const cats = ['MD', 'WD', 'XD'];
  const pairs = cats.map(cat => ({ cat, pair: _bestPairForCategory(cat, matches, players) }))
                    .filter(x => x.pair);

  if (!pairs.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div id="toggle-best-pairs" class="mb-2 flex items-center gap-3 cursor-pointer select-none group">
      <h2 class="text-lg font-semibold text-gray-900">🎯 Best Pairs</h2>
      <span class="text-xs text-gray-400">Top win-rate duo per doubles category</span>
      <span class="chev ml-auto text-gray-400 text-xs transition-transform duration-200">▼</span>
    </div>
    <div id="body-best-pairs">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${pairs.map(({ cat, pair: x }) => {
          const rateClass = x.rate >= 0.6 ? 'text-green-600' : x.rate >= 0.4 ? 'text-amber-500' : 'text-red-500';
          return `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">${cat}</div>
              <div class="flex flex-col gap-1">
                <a href="player.html?id=${x.p1.id}" class="text-sm font-medium text-blue-600 hover:underline truncate">${x.p1.name}</a>
                <a href="player.html?id=${x.p2.id}" class="text-sm font-medium text-blue-600 hover:underline truncate">${x.p2.name}</a>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <span class="text-xs text-gray-400">${x.wins}W ${x.losses}L</span>
                <span class="text-sm font-semibold tabular-nums ${rateClass}">${Math.round(x.rate * 100)}%</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  _wireCollapsible('toggle-best-pairs', 'body-best-pairs', 'acedupr:collapsed:best-pairs', true);
}

// ── Dashboard (index.html) ────────────────────────────────────────────────────

export async function initDashboard() {
  if (!guardCDN()) return;

  const { players, matches, mode } = await _loadData();
  const asOf = Date.now();
  const asOf30 = asOf - 30 * 24 * 60 * 60 * 1000;
  const ratedMatches = matches.filter(_isRated);

  const ratings = computeRatings(ratedMatches, players, { asOf });
  const ratings30 = computeRatings(ratedMatches, players, { asOf: asOf30 });

  _renderDashboard(players, ratedMatches, ratings, ratings30);
  _showModeBanner(mode);
  _renderNavAuth(null, mode);
  _wireDashboard();

  const showWeek  = _hasMoreThan2Weeks(ratedMatches);
  const showMonth = _hasAtLeast3WeeksInLatestMonth(ratedMatches);

  if (showWeek) _renderBestPairs(ratedMatches, players);

  if (showWeek || showMonth) {
    const sorted = [...ratedMatches].map(m => m.date).sort();
    const latestDate = sorted[sorted.length - 1];
    let weekBest = {};

    if (showWeek) {
      const weekStartStr = _shiftDate(latestDate, -7);
      weekBest = _periodBest(ratedMatches, players, ratings, weekStartStr);
      _renderPeriodSection('week-section', 'Player of the Week', '🏅', weekBest);
    }

    if (showMonth) {
      const monthStartStr = latestDate.slice(0, 7) + '-01';
      const monthBest = _periodBest(ratedMatches, players, ratings, monthStartStr);
      _renderPeriodSection('month-section', 'Player of the Month', '🏆', monthBest, weekBest);
    }
  }
}

const CATEGORIES = ['MD', 'WD', 'XD', 'MS', 'WS'];

// ── Collapsible section helper ────────────────────────────────────────────────

function _wireCollapsible(toggleId, bodyId, storageKey, defaultCollapsed = false) {
  const toggle = document.getElementById(toggleId);
  const body   = document.getElementById(bodyId);
  if (!toggle || !body) return;
  const chevron = toggle.querySelector('.chev');

  const setCollapsed = (collapsed) => {
    body.classList.toggle('hidden', collapsed);
    if (chevron) chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    localStorage.setItem(storageKey, collapsed ? '1' : '0');
  };

  const stored = localStorage.getItem(storageKey);
  setCollapsed(stored !== null ? stored === '1' : defaultCollapsed);

  toggle.addEventListener('click', () => setCollapsed(!body.classList.contains('hidden')));
}

// ── Most-improved helpers ─────────────────────────────────────────────────────

const _CONGRATS = [
  'Absolutely on fire! 🔥',
  'Climbing fast — unstoppable! 🚀',
  'Huge growth — keep it up! ⚡',
];
const _MEDAL_GRADIENTS = [
  'from-yellow-400 to-amber-500',
  'from-slate-300 to-slate-400',
  'from-orange-400 to-orange-500',
];
const _MEDAL_BG = ['bg-yellow-50', 'bg-slate-50', 'bg-orange-50'];
const _MEDAL_EMOJIS = ['🥇', '🥈', '🥉'];

function _topImproved(players, ratings) {
  return players
    .filter(p => p.active)
    .map(p => {
      let best = { improvement: -Infinity, category: null, rating: 0 };
      for (const cat of CATEGORIES) {
        const r = ratings.find(x => x.playerId === p.id && x.category === cat);
        if (!r || r.matchCount === 0) continue;
        const imp = r.rating - CONSTANTS.INITIAL_RATING;
        if (imp > best.improvement) best = { improvement: imp, category: cat, rating: r.rating };
      }
      return { player: p, ...best };
    })
    .filter(x => x.improvement > 0 && x.category)
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 3);
}

function _renderImprovement(top) {
  const el = document.getElementById('improvement-section');
  if (!el) return;
  if (top.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div id="toggle-improvement" class="mb-2 flex items-center gap-3 cursor-pointer select-none group">
      <h2 class="text-lg font-semibold text-gray-900">🎉 Most Improved</h2>
      <span class="text-xs text-gray-400">Rating gained since first match</span>
      <span class="chev ml-auto text-gray-400 text-xs transition-transform duration-200">▼</span>
    </div>
    <div id="body-improvement">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${top.map((x, i) => `
          <a href="player.html?id=${x.player.id}"
             class="block rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
            <div class="h-1 bg-gradient-to-r ${_MEDAL_GRADIENTS[i]}"></div>
            <div class="p-5 text-center ${_MEDAL_BG[i]}">
              <div class="text-3xl mb-2">${_MEDAL_EMOJIS[i]}</div>
              <div class="font-semibold text-gray-900 text-sm group-hover:text-blue-600 transition-colors">${x.player.name}</div>
              <div class="text-2xl font-bold text-green-600 mt-1 tabular-nums">+${x.improvement.toFixed(3)}</div>
              <div class="text-xs text-gray-500 mt-0.5">${x.category} · now ${formatRating(x.rating)}</div>
              <p class="text-xs text-gray-400 mt-2 italic">${_CONGRATS[i]}</p>
            </div>
          </a>`).join('')}
      </div>
    </div>`;

  _wireCollapsible('toggle-improvement', 'body-improvement', 'acedupr:collapsed:improvement');
}

function _ratingMap(ratings) {
  const map = {};
  for (const r of ratings) {
    map[`${r.playerId}:${r.category}`] = r;
  }
  return map;
}

function _renderDashboard(players, matches, ratings, ratings30) {
  const tbody = document.getElementById('ratings-tbody');
  if (!tbody) return;

  const rMap = _ratingMap(ratings);
  const rMap30 = _ratingMap(ratings30);

  _renderImprovement(_topImproved(players, ratings));

  // Top 3 per category by rating (exclude inactive for highlight)
  const top3 = {};
  for (const cat of CATEGORIES) {
    const catRatings = ratings
      .filter(r => r.category === cat && !r.inactive && r.matchCount > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
    top3[cat] = catRatings.map(r => r.playerId);
  }

  // Default order: best rating across any category, descending
  const activePlayers = players
    .filter(p => p.active)
    .sort((a, b) => {
      const bestA = Math.max(...CATEGORIES.map(cat => rMap[`${a.id}:${cat}`]?.rating ?? -1));
      const bestB = Math.max(...CATEGORIES.map(cat => rMap[`${b.id}:${cat}`]?.rating ?? -1));
      return bestB - bestA;
    });

  tbody.innerHTML = activePlayers.map(p => {
    const cells = CATEGORIES.map(cat => {
      const r = rMap[`${p.id}:${cat}`];
      if (!r) return '<td class="px-3 py-2 text-gray-300" data-val="-1">—</td>';
      const r30 = rMap30[`${p.id}:${cat}`];
      const delta = r30 ? r.rating - r30.rating : 0;
      const prefix = r.provisional ? '<span class="text-amber-500">~</span>' : '';
      return `<td class="px-3 py-2 font-mono text-sm" data-val="${r.rating}">${prefix}${formatRating(r.rating)} ${trendArrow(delta)}</td>`;
    });

    const bestRank = CATEGORIES.map(cat => {
      const rank = top3[cat].indexOf(p.id);
      return rank >= 0 ? rank : 99;
    });
    const minRank = Math.min(...bestRank);
    const rankClass = minRank === 0 ? 'bg-yellow-50' : minRank === 1 ? 'bg-gray-50' : minRank === 2 ? 'bg-orange-50' : '';

    return `<tr class="${rankClass} hover:bg-blue-50 cursor-pointer" onclick="window.location='player.html?id=${p.id}'">
      <td class="px-3 py-2 font-medium" data-val="${p.name}">
        <a href="player.html?id=${p.id}" class="text-blue-600 hover:underline">${p.name}</a>
      </td>
      ${cells.join('')}
    </tr>`;
  }).join('');

  // Update stats
  const statEl = document.getElementById('stat-players');
  if (statEl) statEl.textContent = activePlayers.length;
  const statMatches = document.getElementById('stat-matches');
  if (statMatches) statMatches.textContent = matches.length;
}

const _COL_ORDER = ['name', ...CATEGORIES.map(c => c.toLowerCase())];

function _wireDashboard() {
  const sortHeaders = document.querySelectorAll('[data-sort]');
  let sortState = { col: null, asc: true };
  sortHeaders.forEach(th => {
    th.style.cursor = 'pointer';
    th.title = 'Click to sort';
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      const isRating = col !== 'name';
      sortState.asc = sortState.col === col ? !sortState.asc : !isRating;
      sortState.col = col;
      _sortTable(col, sortState.asc);
      sortHeaders.forEach(h => {
        const orig = h.dataset.label ?? h.textContent.replace(/[↑↓]/, '').trim();
        h.dataset.label = orig;
        h.textContent = h.dataset.sort === col ? `${orig} ${sortState.asc ? '↑' : '↓'}` : orig;
      });
    });
  });
}

function _sortTable(col, asc) {
  const tbody = document.getElementById('ratings-tbody');
  if (!tbody) return;
  const colIdx = _COL_ORDER.indexOf(col);
  if (colIdx === -1) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const aVal = a.querySelectorAll('td')[colIdx]?.dataset.val ?? '';
    const bVal = b.querySelectorAll('td')[colIdx]?.dataset.val ?? '';
    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);
    if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
    return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ── Match Entry + History (matches.html) ─────────────────────────────────────

function _wireMatchFormCollapse() {
  const toggle  = document.getElementById('match-form-toggle');
  const form    = document.getElementById('match-form');
  const chevron = document.getElementById('match-form-chevron');
  if (!toggle || !form) return;
  if (chevron) chevron.style.transform = 'rotate(-90deg)';
  toggle.addEventListener('click', () => {
    const collapsed = !form.classList.contains('hidden');
    form.classList.toggle('hidden', collapsed);
    if (chevron) chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
  });
}

export async function initMatches() {
  if (!guardCDN(false)) return;

  const { players, matches, mode } = await _loadData();
  _showModeBanner(mode);
  _renderNavAuth(players, mode);

  const auth = _effectiveAuth(mode);
  const isAdmin = auth?.role === 'admin';
  if (isAdmin) document.getElementById('th-actions')?.classList.remove('hidden');
  if (auth?.mappedPlayerId) {
    document.getElementById('match-entry-section')?.classList.remove('hidden');
    _wireMatchFormCollapse();
    _populateMatchForm(players);
    _wireMatchForm(players, mode, auth.email);
  } else {
    document.getElementById('match-login-prompt')?.classList.remove('hidden');
  }

  const latestDate = matches.reduce((max, m) => m.date > max ? m.date : max, '');
  const dateInput = document.getElementById('filter-date');
  if (dateInput && latestDate) dateInput.value = latestDate;

  _renderMatchHistory(players, '', '', matches, latestDate, isAdmin);
  _wireMatchHistory(players, matches, isAdmin, mode, auth?.email);
}

function _showFileModeBanner() {
  const el = document.getElementById('file-mode-note');
  if (el) el.classList.remove('hidden');
}

function _genderForCategory(cat) {
  if (cat === 'MD' || cat === 'MS') return 'M';
  if (cat === 'WD' || cat === 'WS') return 'F';
  return null;
}

function _isDoubles(cat) {
  return cat === 'MD' || cat === 'WD' || cat === 'XD';
}

function _validatePlayerSelects() {
  const allIds = ['player-a1', 'player-a2', 'player-b1', 'player-b2'];
  const visible = allIds
    .map(id => document.getElementById(id))
    .filter(el => el && !el.closest('.partner-field')?.classList.contains('hidden'));

  const counts = {};
  visible.forEach(s => { if (s.value) counts[s.value] = (counts[s.value] || 0) + 1; });
  const dupes = new Set(Object.keys(counts).filter(v => counts[v] > 1));

  visible.forEach(s => {
    const isDupe = !!(s.value && dupes.has(s.value));
    s.style.borderColor = isDupe ? '#ef4444' : '';
    s.style.boxShadow   = isDupe ? '0 0 0 2px rgba(239,68,68,0.25)' : '';
  });

  return dupes.size === 0;
}

function _populateMatchForm(players) {
  const dateInput = document.getElementById('match-date');
  if (dateInput) dateInput.value = _todayIso();

  const catSelect = document.getElementById('match-category');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      _updatePlayerDropdowns(players);
      _validatePlayerSelects();
    });
  }
  ['player-a1', 'player-a2', 'player-b1', 'player-b2'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _validatePlayerSelects);
  });
  _updatePlayerDropdowns(players);
}

function _playerOptions(players, gender, exclude = []) {
  const filtered = players.filter(p => p.active && p.gender === gender && !exclude.includes(p.id));
  const opts = filtered.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  return `<option value="">— select —</option>${opts}`;
}

function _updatePlayerDropdowns(players) {
  const cat = document.getElementById('match-category')?.value ?? 'MD';
  const doubles = _isDoubles(cat);
  const isXD = cat === 'XD';

  document.querySelectorAll('.partner-field').forEach(el =>
    el.classList.toggle('hidden', !doubles));

  // For XD: P1 slot = male, P2 slot = female — enforced by construction
  ['a', 'b'].forEach(team => {
    const l1 = document.getElementById(`label-${team}1`);
    const l2 = document.getElementById(`label-${team}2`);
    if (l1) l1.textContent = isXD ? 'Male player' : 'Player 1';
    if (l2) l2.textContent = isXD ? 'Female player' : 'Player 2';
  });

  if (isXD) {
    ['a1', 'b1'].forEach(key => {
      const sel = document.getElementById(`player-${key}`);
      if (sel) sel.innerHTML = _playerOptions(players, 'M');
    });
    ['a2', 'b2'].forEach(key => {
      const sel = document.getElementById(`player-${key}`);
      if (sel) sel.innerHTML = _playerOptions(players, 'F');
    });
  } else {
    const gender = _genderForCategory(cat);
    ['a1', 'a2', 'b1', 'b2'].forEach(key => {
      const sel = document.getElementById(`player-${key}`);
      if (sel) sel.innerHTML = _playerOptions(players, gender);
    });
  }
}

function _wireMatchForm(players, mode, email) {
  const form = document.getElementById('match-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
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
    if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 25 || scoreB > 25) {
      alert('Scores must be between 0 and 25.');
      return;
    }
    if (scoreA === scoreB) {
      alert('Scores cannot be tied — one team must win.');
      return;
    }

    const teamAIds = doubles ? [a1, a2] : [a1];
    const teamBIds = doubles ? [b1, b2] : [b1];
    if (!_validatePlayerSelects()) return;

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const toName = id => players.find(p => p.id === id)?.name ?? id;

    if (mode === 'sheets') {
      let res;
      const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      try {
        res = await Promise.race([
          SheetsWrite.addMatch(email, {
            date, category: cat, matchType, scoreA, scoreB,
            teamA: teamAIds.map(toName),
            teamB: teamBIds.map(toName),
            notes: notes || '',
          }),
          deadline,
        ]);
      } catch (err) {
        alert(err.message === 'timeout' ? 'Request timed out. Please try again.' : 'Network error. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Match';
        return;
      }
      if (!res.ok) {
        alert('Failed to save: ' + (res.error ?? 'unknown error'));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Match';
        return;
      }
      DataSheets.invalidateCache();
      _showToast('Match added — reloading…');
      setTimeout(() => location.reload(), 1200);
    } else {
      Data.addMatch({
        id: crypto.randomUUID(),
        date, category: cat, matchType,
        teamA: teamAIds, teamB: teamBIds,
        scoreA, scoreB,
        notes: notes || undefined,
      });
      form.reset();
      document.getElementById('match-date').value = _todayIso();
      _updatePlayerDropdowns(players);
      _renderMatchHistory(players);
      _showToast('Match added.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Match';
    }
  });
}

// allMatches: pre-loaded array (file+local merge); omit to read from localStorage only.
const _HIST_PAGE_SIZE = 30;

function _renderMatchHistory(players, filterCat = '', filterPlayerId = '', allMatches = null, filterDate = '', isAdmin = false, filterType = '') {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  let matches = allMatches ?? Data.loadMatches();
  if (filterCat)    matches = matches.filter(m => m.category === filterCat);
  if (filterPlayerId) matches = matches.filter(m => [...m.teamA, ...m.teamB].includes(filterPlayerId));
  if (filterDate)   matches = matches.filter(m => m.date === filterDate);
  if (filterType)   matches = matches.filter(m => m.matchType === filterType);

  matches = [...matches].sort((a, b) => b.date.localeCompare(a.date));

  const totalPages = Math.max(1, Math.ceil(matches.length / _HIST_PAGE_SIZE));
  _histPage = Math.min(_histPage, totalPages - 1);
  const page = matches.slice(_histPage * _HIST_PAGE_SIZE, (_histPage + 1) * _HIST_PAGE_SIZE);

  tbody.innerHTML = page.map(m => {
    const teamA = m.teamA.map(id => playerName(id, players)).join(' & ');
    const teamB = m.teamB.map(id => playerName(id, players)).join(' & ');
    const actions = isAdmin
      ? `<td class="px-3 py-2 text-sm whitespace-nowrap">
          <button class="btn-edit text-xs text-blue-600 hover:underline mr-2" data-id="${m.id}">Edit</button>
          <button class="btn-delete text-xs text-red-500 hover:underline" data-id="${m.id}">Delete</button>
        </td>`
      : '';
    return `<tr>
      <td class="px-3 py-2 text-sm">${formatDate(m.date)}</td>
      <td class="px-3 py-2 text-sm font-medium">${m.category}</td>
      <td class="px-3 py-2 text-sm">${teamA}</td>
      <td class="px-3 py-2 text-sm font-mono">${m.scoreA}–${m.scoreB}</td>
      <td class="px-3 py-2 text-sm">${teamB}</td>
      <td class="px-3 py-2 text-sm">${m.matchType === 'unrated' ? '<span class="badge badge-unrated">Unrated</span>' : `<span class="capitalize">${m.matchType}</span>`}</td>
      <td class="px-3 py-2 text-sm text-gray-400">${m.notes ?? ''}</td>
      ${actions}
    </tr>`;
  }).join('');

  const pag = document.getElementById('history-pagination');
  if (!pag) return;
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  const prevDis = _histPage === 0 ? 'disabled' : '';
  const nextDis = _histPage >= totalPages - 1 ? 'disabled' : '';
  pag.innerHTML = `
    <div class="flex items-center justify-between px-1 py-3 text-sm">
      <button id="hist-prev" class="btn-secondary px-3 py-1.5" ${prevDis}>← Prev</button>
      <span class="text-gray-500">Page <strong class="text-gray-800">${_histPage + 1}</strong> of ${totalPages} <span class="text-gray-400">· ${matches.length} matches</span></span>
      <button id="hist-next" class="btn-secondary px-3 py-1.5" ${nextDis}>Next →</button>
    </div>`;
}

function _wireMatchHistory(players, allMatches, isAdmin = false, mode = 'local', email = '') {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  const toName = id => players.find(p => p.id === id)?.name ?? id;

  tbody.addEventListener('click', async e => {
    const id = e.target.dataset.id;
    if (!id) return;

    const match = (allMatches ?? Data.loadMatches()).find(m => m.id === id);
    if (!match) return;

    if (e.target.classList.contains('btn-delete')) {
      if (!confirm('Delete this match? Ratings will be recalculated.')) return;
      if (mode === 'sheets') {
        const matchWithNames = {
          ...match,
          teamA: match.teamA.map(toName),
          teamB: match.teamB.map(toName),
        };
        const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
        try {
          const res = await Promise.race([SheetsWrite.deleteMatch(email, matchWithNames), deadline]);
          if (!res.ok) { alert('Delete failed: ' + (res.error ?? 'unknown error')); return; }
          DataSheets.invalidateCache();
        } catch (err) {
          alert(err.message === 'timeout' ? 'Request timed out. Please try again.' : 'Network error. Please try again.');
          return;
        }
      } else {
        Data.deleteMatch(id);
      }
      allMatches = (allMatches ?? []).filter(m => m.id !== id);
      _renderMatchHistory(players, '', '', allMatches, '', isAdmin);
      _showToast('Match deleted.');
      return;
    }

    if (e.target.classList.contains('btn-edit')) {
      _showEditModal(match, players, mode, email, allMatches, isAdmin);
    }
  });

  const filterCat    = document.getElementById('filter-category');
  const filterType   = document.getElementById('filter-type');
  const filterPlayer = document.getElementById('filter-player');
  const filterDate   = document.getElementById('filter-date');

  if (filterPlayer) {
    filterPlayer.innerHTML = `<option value="">All players</option>` +
      players.filter(p => p.active).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  const rerender = (resetPage = false) => {
    if (resetPage) _histPage = 0;
    _renderMatchHistory(
      players,
      filterCat?.value    ?? '',
      filterPlayer?.value ?? '',
      allMatches,
      filterDate?.value   ?? '',
      isAdmin,
      filterType?.value   ?? '',
    );
  };

  [filterCat, filterType, filterPlayer].forEach(el => {
    if (el) el.addEventListener('change', () => rerender(true));
  });
  if (filterDate) {
    filterDate.addEventListener('change', () => rerender(true));
    filterDate.addEventListener('input',  () => rerender(true));
  }

  document.getElementById('history-pagination')?.addEventListener('click', e => {
    if (e.target.id === 'hist-prev' && _histPage > 0) { _histPage--; rerender(); }
    if (e.target.id === 'hist-next')                  { _histPage++; rerender(); }
  });

  const exportBtn = document.getElementById('btn-export-csv');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const matches = Data.loadMatches();
      Data.exportMatchesCSV(matches, players);
    });
  }
}

function _showEditModal(match, players, mode = 'local', email = '', allMatches = null, isAdmin = false) {
  if (!match) return;

  const existing = document.getElementById('edit-modal');
  if (existing) existing.remove();

  const doubles = _isDoubles(match.category);
  const isXD = match.category === 'XD';
  const gender = _genderForCategory(match.category);

  // For XD, p1 slots show male players and p2 slots show female players.
  function opts(selected, genderOverride) {
    const g = genderOverride ?? gender;
    return players
      .filter(p => p.active && p.gender === g)
      .map(p => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${p.name}</option>`)
      .join('');
  }

  const labelP1 = isXD ? 'Male player'   : 'Player 1';
  const labelP2 = isXD ? 'Female player' : 'Player 2';

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
              ${['tournament','club','recreational','unrated'].map(t =>
                `<option value="${t}"${t === match.matchType ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <p class="text-sm font-bold text-blue-700">Team A</p>
            <div>
              <label class="label">${labelP1}</label>
              <select id="edit-a1" class="input"><option value="">— select —</option>${opts(match.teamA[0], isXD ? 'M' : undefined)}</select>
            </div>
            ${doubles ? `<div>
              <label class="label">${labelP2}</label>
              <select id="edit-a2" class="input"><option value="">— select —</option>${opts(match.teamA[1], isXD ? 'F' : undefined)}</select>
            </div>` : ''}
          </div>
          <div class="space-y-2">
            <p class="text-sm font-bold text-blue-700">Team B</p>
            <div>
              <label class="label">${labelP1}</label>
              <select id="edit-b1" class="input"><option value="">— select —</option>${opts(match.teamB[0], isXD ? 'M' : undefined)}</select>
            </div>
            ${doubles ? `<div>
              <label class="label">${labelP2}</label>
              <select id="edit-b2" class="input"><option value="">— select —</option>${opts(match.teamB[1], isXD ? 'F' : undefined)}</select>
            </div>` : ''}
          </div>
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

  document.getElementById('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const editScoreA = parseInt(document.getElementById('edit-sa').value, 10);
    const editScoreB = parseInt(document.getElementById('edit-sb').value, 10);
    if (isNaN(editScoreA) || isNaN(editScoreB) || editScoreA < 0 || editScoreB < 0 || editScoreA > 25 || editScoreB > 25) {
      alert('Scores must be between 0 and 25.');
      return;
    }
    if (editScoreA === editScoreB) {
      alert('Scores cannot be tied — one team must win.');
      return;
    }
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
      scoreA: editScoreA,
      scoreB: editScoreB,
      notes: document.getElementById('edit-notes').value.trim() || undefined,
    };

    const saveBtn = modal.querySelector('[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const toName = id => players.find(p => p.id === id)?.name ?? id;

    if (mode === 'sheets') {
      const oldMatchWithNames = { ...match, teamA: match.teamA.map(toName), teamB: match.teamB.map(toName) };
      const newMatchWithNames = { ...updated, teamA: updated.teamA.map(toName), teamB: updated.teamB.map(toName) };
      const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      let res;
      try {
        res = await Promise.race([SheetsWrite.editMatch(email, oldMatchWithNames, newMatchWithNames), deadline]);
      } catch (err) {
        alert(err.message === 'timeout' ? 'Request timed out. Please try again.' : 'Network error. Please try again.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        return;
      }
      if (!res.ok) {
        alert('Save failed: ' + (res.error ?? 'unknown error'));
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        return;
      }
      DataSheets.invalidateCache();
      if (allMatches) {
        const idx = allMatches.findIndex(m => m.id === match.id);
        if (idx !== -1) allMatches[idx] = updated;
      }
    } else {
      Data.updateMatch(updated);
      if (allMatches) {
        const idx = allMatches.findIndex(m => m.id === match.id);
        if (idx !== -1) allMatches[idx] = updated;
      }
    }

    modal.remove();
    _renderMatchHistory(players, '', '', allMatches, '', isAdmin);
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
      _showImportSuccess(count);
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
          joinedDate: _todayIso(),
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

const _VALID_CATEGORIES  = new Set(['MD', 'WD', 'XD', 'MS', 'WS']);
const _VALID_MATCH_TYPES = new Set(['club', 'tournament', 'recreational']);

// Detect and fix the common mistake where category and match_type values are swapped.
// Returns { row, swapped } — swapped=true when a correction was applied.
function _normalizeRow(row) {
  const cat = row.category?.trim().toUpperCase() ?? '';
  const mt  = row.match_type?.trim().toLowerCase() ?? '';
  if (!_VALID_CATEGORIES.has(cat) && _VALID_MATCH_TYPES.has(cat.toLowerCase()) &&
      _VALID_CATEGORIES.has(mt.toUpperCase())) {
    return {
      row: { ...row, category: row.match_type, match_type: row.category },
      swapped: true,
    };
  }
  return { row, swapped: false };
}

// resolvedNameMap: lowercase name → player id (for names resolved in the UI)
// Falls back to exact case-insensitive match against players for known names.
function _csvRowToMatch(row, players, resolvedNameMap) {
  const { row: r } = _normalizeRow(row);
  const cat = r.category?.trim().toUpperCase();

  const resolveId = (name) => {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    if (resolvedNameMap[trimmed.toLowerCase()]) return resolvedNameMap[trimmed.toLowerCase()];
    const p = players.find(pl => pl.name.toLowerCase() === trimmed.toLowerCase());
    return p?.id ?? null;
  };

  const a1Id = resolveId(r.team_a_p1);
  const a2Id = resolveId(r.team_a_p2);
  const b1Id = resolveId(r.team_b_p1);
  const b2Id = resolveId(r.team_b_p2);

  if (!a1Id || !b1Id) return null;
  if (!_VALID_CATEGORIES.has(cat)) return null;

  const teamA = a2Id ? [a1Id, a2Id] : [a1Id];
  const teamB = b2Id ? [b1Id, b2Id] : [b1Id];

  return {
    id: crypto.randomUUID(),
    date: r.date?.trim(),
    category: cat,
    matchType: r.match_type?.trim().toLowerCase() ?? 'club',
    teamA,
    teamB,
    scoreA: parseInt(r.score_a, 10),
    scoreB: parseInt(r.score_b, 10),
    notes: r.notes?.trim() || undefined,
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

// unknownNames: array of names not found in the member list
function _renderCSVPreview(rows, players, container, unknownNames = []) {
  if (!container) return;
  const unknownSet = new Set(unknownNames.map(n => n.toLowerCase()));

  // Detect if ANY row has the category/match_type swap so we can show a banner
  const anySwapped = rows.some(r => _normalizeRow(r).swapped);

  const nameCell = (name) => {
    if (!name?.trim()) return '<span class="text-gray-300">—</span>';
    const isUnknown = unknownSet.has(name.trim().toLowerCase());
    return isUnknown
      ? `<span class="text-amber-600 font-semibold" title="New member">${name} ⚠</span>`
      : name;
  };

  const swapBanner = anySwapped
    ? `<div class="bg-blue-50 border border-blue-300 rounded px-3 py-2 text-xs text-blue-800 mb-2">
        <strong>Auto-corrected:</strong> your CSV had <code>category</code> and <code>match_type</code> columns swapped
        (e.g. <code>club</code> in the category column and <code>MD</code> in match_type).
        The values below have been fixed automatically — no action needed.
       </div>`
    : '';

  container.innerHTML = swapBanner + `
    <table class="w-full text-xs border-collapse">
      <thead><tr class="bg-gray-100">
        <th class="px-2 py-1 text-left">Date</th>
        <th class="px-2 py-1 text-left">Cat</th>
        <th class="px-2 py-1 text-left">Team A</th>
        <th class="px-2 py-1 text-left">Score</th>
        <th class="px-2 py-1 text-left">Team B</th>
        <th class="px-2 py-1 text-left">Type</th>
      </tr></thead>
      <tbody>${rows.map(raw => {
        const { row: r } = _normalizeRow(raw);
        return `<tr class="border-t hover:bg-gray-50">
          <td class="px-2 py-1">${r.date ?? ''}</td>
          <td class="px-2 py-1 font-medium">${r.category?.trim().toUpperCase() ?? ''}</td>
          <td class="px-2 py-1">${[nameCell(r.team_a_p1), r.team_a_p2?.trim() ? nameCell(r.team_a_p2) : null].filter(Boolean).join(' &amp; ')}</td>
          <td class="px-2 py-1 font-mono">${r.score_a}–${r.score_b}</td>
          <td class="px-2 py-1">${[nameCell(r.team_b_p1), r.team_b_p2?.trim() ? nameCell(r.team_b_p2) : null].filter(Boolean).join(' &amp; ')}</td>
          <td class="px-2 py-1 capitalize">${r.match_type?.trim().toLowerCase() ?? 'club'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    ${unknownNames.length > 0 ? `<p class="text-xs text-amber-600 px-2 py-1 mt-1"><strong>⚠</strong> = name not found in member list — resolve above before importing.</p>` : ''}`;
}

function _downloadSampleCSV() {
  const sample = [
    'date,category,match_type,team_a_p1,team_a_p2,team_b_p1,team_b_p2,score_a,score_b',
    '2026-04-20,MD,club,Bob,Dave,Charlie,Ed,11,7',
    '2026-04-20,WD,club,Alice,Carol,Diana,Fiona,11,9',
    '2026-04-20,XD,club,Bob,Alice,Charlie,Diana,11,8',
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

export async function initLeaderboard() {
  if (!guardCDN()) return;

  const { players, matches, mode } = await _loadData();
  _showModeBanner(mode);
  _renderNavAuth(null, mode);
  const asOf = Date.now();
  const asOf30 = asOf - 30 * 24 * 60 * 60 * 1000;
  const ratedMatches = matches.filter(_isRated);

  const ratings = computeRatings(ratedMatches, players, { asOf });
  const ratings30 = computeRatings(ratedMatches, players, { asOf: asOf30 });

  let activeCategory = 'MD';
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeCategory = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === activeCategory));
      _renderLeaderboard(activeCategory, players, ratedMatches, ratings, ratings30);
    });
  });

  _renderLeaderboard(activeCategory, players, ratedMatches, ratings, ratings30);
}

const _MEDALS = ['🥇', '🥈', '🥉'];

function _renderLeaderboard(cat, players, matches, ratings, ratings30) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  const rMap30 = _ratingMap(ratings30);
  const catRatings = ratings
    .filter(r => r.category === cat && r.matchCount > 0)
    .sort((a, b) => {
      if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
      return b.rating - a.rating;
    });

  // Compute W/L per player for this category
  const wl = {};
  for (const m of matches.filter(m => m.category === cat)) {
    const winners = m.scoreA > m.scoreB ? m.teamA : m.teamB;
    const losers  = m.scoreA > m.scoreB ? m.teamB : m.teamA;
    for (const id of winners) { if (!wl[id]) wl[id] = { w: 0, l: 0 }; wl[id].w++; }
    for (const id of losers)  { if (!wl[id]) wl[id] = { w: 0, l: 0 }; wl[id].l++; }
  }

  let activeRank = 0;
  tbody.innerHTML = catRatings.map(r => {
    const p = players.find(pl => pl.id === r.playerId);
    if (!p) return '';
    const r30 = rMap30[`${r.playerId}:${cat}`];
    const delta = r30 ? r.rating - r30.rating : 0;
    const record = wl[r.playerId] ?? { w: 0, l: 0 };
    const wr = _winRateDisplay(record.w, record.l);

    let rankDisplay;
    if (r.inactive) {
      rankDisplay = '<span class="text-gray-300">—</span>';
    } else {
      activeRank++;
      rankDisplay = activeRank <= 3
        ? `<span title="#${activeRank}">${_MEDALS[activeRank - 1]}</span>`
        : `<span class="font-mono text-sm text-gray-600">${activeRank}</span>`;
    }

    const deltaStr = delta > 0.001 ? `<span class="text-green-600 text-xs">+${delta.toFixed(3)}</span>`
                   : delta < -0.001 ? `<span class="text-red-500 text-xs">${delta.toFixed(3)}</span>`
                   : '<span class="text-gray-300 text-xs">—</span>';

    return `<tr class="${r.inactive ? 'opacity-40 bg-gray-50' : 'hover:bg-blue-50'}">
      <td class="px-4 py-2.5 text-center w-12">${rankDisplay}</td>
      <td class="px-4 py-2.5">
        <a href="player.html?id=${r.playerId}" class="text-blue-600 hover:underline font-medium">${p.name}</a>
      </td>
      <td class="px-4 py-2.5 font-mono font-semibold">${formatRating(r.rating)}</td>
      <td class="px-4 py-2.5">${deltaStr}</td>
      <td class="px-4 py-2.5 text-sm">
        <span class="text-green-600 font-medium">${record.w}W</span>
        <span class="text-gray-300 mx-0.5">/</span>
        <span class="text-red-500 font-medium">${record.l}L</span>
      </td>
      <td class="px-4 py-2.5 text-sm font-medium ${wr.colorClass}">${wr.text}</td>
      <td class="px-4 py-2.5 text-sm text-gray-500">${r.matchCount}</td>
      <td class="px-4 py-2.5">${reliabilityBadge(r)}</td>
    </tr>`;
  }).join('');
}

// ── Top Partners ─────────────────────────────────────────────────────────────

// Returns [{partner, wins, losses, total, rate}] sorted by win rate then wins, top 3.
function _topPartnersForCategory(playerId, cat, matches, players) {
  const stats = {};
  for (const m of matches) {
    if (m.category !== cat) continue;
    const onA = m.teamA.includes(playerId);
    const onB = m.teamB.includes(playerId);
    if (!onA && !onB) continue;
    const team = onA ? m.teamA : m.teamB;
    const partnerId = team.find(id => id !== playerId);
    if (!partnerId) continue;
    const won = onA ? m.scoreA > m.scoreB : m.scoreB > m.scoreA;
    if (!stats[partnerId]) stats[partnerId] = { wins: 0, losses: 0 };
    won ? stats[partnerId].wins++ : stats[partnerId].losses++;
  }
  return Object.entries(stats)
    .map(([id, s]) => {
      const total = s.wins + s.losses;
      const partner = players.find(p => p.id === id);
      return partner ? { partner, wins: s.wins, losses: s.losses, total, rate: s.wins / total } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.rate - a.rate || b.wins - a.wins)
    .slice(0, 3);
}

function _renderTopPartners(player, matches, players) {
  const el = document.getElementById('top-partners-section');
  if (!el) return;

  const cats = player.gender === 'M' ? ['MD', 'XD'] : ['WD', 'XD'];

  const catBlocks = cats.map(cat => {
    const top = _topPartnersForCategory(player.id, cat, matches, players);
    if (!top.length) return '';
    return `
      <div>
        <h3 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">${cat}</h3>
        <ol class="space-y-2">
          ${top.map((x, i) => {
            const rateClass = x.rate >= 0.6 ? 'text-green-600' : x.rate >= 0.4 ? 'text-amber-500' : 'text-red-500';
            return `<li class="flex items-center gap-3">
              <span class="text-xs text-gray-300 w-3 shrink-0">${i + 1}</span>
              <a href="player.html?id=${x.partner.id}" class="text-sm font-medium text-blue-600 hover:underline flex-1 truncate">${x.partner.name}</a>
              <span class="text-xs text-gray-400">${x.wins}W ${x.losses}L</span>
              <span class="text-sm font-semibold tabular-nums ${rateClass} w-10 text-right">${Math.round(x.rate * 100)}%</span>
            </li>`;
          }).join('')}
        </ol>
      </div>`;
  }).filter(Boolean).join('');

  if (!catBlocks) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <h2 class="font-semibold text-gray-800 mb-4">🤝 Top Partners</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">${catBlocks}</div>
    </div>`;
}

// ── Player Profile (player.html) ─────────────────────────────────────────────

export async function initPlayer(playerId) {
  if (!guardCDN()) return;

  const { players, matches, mode } = await _loadData();
  _showModeBanner(mode);
  _renderNavAuth(null, mode);
  const asOf = Date.now();
  const ratedMatches = matches.filter(_isRated);

  const player = players.find(p => p.id === playerId);
  if (!player) {
    document.getElementById('app').innerHTML = '<p class="p-8 text-red-600">Player not found.</p>';
    return;
  }

  const ratings = computeRatings(ratedMatches, players, { asOf });
  const auth = _effectiveAuth(mode);
  _renderPlayerHeader(player);
  if (auth && (auth.mappedPlayerId === playerId || auth.role === 'admin')) {
    _wireQuoteEdit(player, auth, mode);
  }
  _renderPlayerCards(player, ratings, ratedMatches);
  _wirePlayerCharts(ratedMatches, matches, players, player, asOf);
  _renderTopPartners(player, ratedMatches, players);
  _renderPlayerMatchHistory(player, matches, players);
  _renderPracticeRatings(player, matches, ratedMatches, players, asOf);
}

function _updateQuoteBubble(quoteEl, quote) {
  if (!quoteEl) return;
  if (quote) {
    quoteEl.innerHTML =
      '<span style=”position:absolute;left:-8px;top:50%;transform:translateY(-50%);border:4px solid transparent;border-right-color:#bfdbfe;”></span>' +
      '<span style=”position:absolute;left:-6px;top:50%;transform:translateY(-50%);border:4px solid transparent;border-right-color:#eff6ff;”></span>' +
      '”' + quote + '”';
    quoteEl.style.cssText = 'position:relative;display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;border-radius:1rem;padding:0.35rem 0.875rem;font-size:0.875rem;color:#374151;font-style:italic;max-width:480px;';
    quoteEl.classList.remove('hidden');
  } else {
    quoteEl.classList.add('hidden');
    quoteEl.style.cssText = '';
    quoteEl.innerHTML = '';
  }
}

function _renderPlayerHeader(player) {
  const el = document.getElementById('player-name');
  if (el) el.textContent = player.name;
  const sub = document.getElementById('player-meta');
  if (sub) sub.textContent = `${player.gender === 'M' ? 'Male' : 'Female'} · Joined ${formatDate(player.joinedDate)}${player.active ? '' : ' · Inactive'}`;
  const quoteEl = document.getElementById('player-quote');
  _updateQuoteBubble(quoteEl, player.quote);
  if (quoteEl && player.quote) {
    const wiggle = () => {
      quoteEl.classList.remove('quote-wiggle');
      void quoteEl.offsetWidth;
      quoteEl.classList.add('quote-wiggle');
    };
    wiggle();
    setInterval(wiggle, 4000);
  }
}

function _wireQuoteEdit(player, auth, mode) {
  const quoteEl = document.getElementById('player-quote');
  if (!quoteEl) return;
  const container = quoteEl.parentElement;

  // “Add your quote” button shown when there's no quote yet
  const addBtn = document.createElement('button');
  addBtn.className = 'text-blue-500 hover:text-blue-700 text-sm font-medium flex-shrink-0 transition-colors';
  addBtn.textContent = '+ Add your quote';
  if (player.quote) addBtn.classList.add('hidden');
  container.appendChild(addBtn);

  // Small “Edit” pill shown beside the bubble when a quote exists
  const editBtn = document.createElement('button');
  editBtn.title = 'Edit quote';
  editBtn.className = 'text-xs text-gray-400 hover:text-blue-500 border border-gray-200 hover:border-blue-300 rounded-full px-2 py-0.5 flex-shrink-0 transition-colors';
  editBtn.textContent = 'Edit';
  if (!player.quote) editBtn.classList.add('hidden');
  container.appendChild(editBtn);

  const openEditor = () => {
    quoteEl.classList.add('hidden');
    addBtn.classList.add('hidden');
    editBtn.classList.add('hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-2 w-full flex-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = player.quote || '';
    input.placeholder = 'Your quote…';
    input.className = 'input text-sm flex-1';
    input.style.minWidth = '200px';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary text-sm px-4 py-1.5';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary text-sm px-4 py-1.5';
    cancelBtn.textContent = 'Cancel';

    wrapper.append(input, saveBtn, cancelBtn);
    container.insertBefore(wrapper, addBtn);
    input.focus();
    input.select();

    const restoreView = () => {
      wrapper.remove();
      _updateQuoteBubble(quoteEl, player.quote);
      addBtn.classList.toggle('hidden', !!player.quote);
      editBtn.classList.toggle('hidden', !player.quote);
    };

    cancelBtn.addEventListener('click', restoreView);

    saveBtn.addEventListener('click', async () => {
      const newQuote = input.value.trim();
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;

      if (mode === 'sheets') {
        try {
          const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
          const res = await Promise.race([SheetsWrite.saveQuote(auth.email, player.name, newQuote), deadline]);
          if (!res.ok) {
            alert('Save failed: ' + (res.error ?? 'unknown error'));
            saveBtn.textContent = 'Save'; saveBtn.disabled = false;
            return;
          }
        } catch (err) {
          alert(err.message === 'timeout' ? 'Request timed out.' : 'Network error. Please try again.');
          saveBtn.textContent = 'Save'; saveBtn.disabled = false;
          return;
        }
      }

      player.quote = newQuote;
      wrapper.remove();
      _updateQuoteBubble(quoteEl, newQuote);
      addBtn.classList.toggle('hidden', !!newQuote);
      editBtn.classList.toggle('hidden', !newQuote);
      _showToast('Quote saved!');
    });
  };

  addBtn.addEventListener('click', openEditor);
  editBtn.addEventListener('click', openEditor);
}

// Categories expected per gender. XD is valid for both.
const _GENDER_CATS = { M: new Set(['MD', 'XD', 'MS']), F: new Set(['WD', 'XD', 'WS']) };

function _renderPlayerCards(player, ratings, matches) {
  const container = document.getElementById('rating-cards');
  if (!container) return;

  const relevant = _GENDER_CATS[player.gender] ?? new Set(CATEGORIES);
  const genderLabel = player.gender === 'M' ? 'male' : 'female';

  container.innerHTML = CATEGORIES.map(cat => {
    const r = ratings.find(x => x.playerId === player.id && x.category === cat);
    const isRelevant = relevant.has(cat);

    // Irrelevant category with no data — hide entirely
    if (!isRelevant && !r) return '';

    const catMatches = matches.filter(m =>
      m.category === cat && [...m.teamA, ...m.teamB].includes(player.id));
    const wins = catMatches.filter(m => {
      const onA = m.teamA.includes(player.id);
      return onA ? m.scoreA > m.scoreB : m.scoreB > m.scoreA;
    }).length;
    const losses = catMatches.length - wins;

    const warnHtml = !isRelevant
      ? `<span class="relative inline-block group/warn cursor-help animate-pulse text-amber-500"> ⚠<span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-52 rounded bg-gray-800 px-2 py-1.5 text-xs text-white opacity-0 group-hover/warn:opacity-100 transition-opacity z-10 text-left normal-case font-normal leading-snug">${cat} is not expected for a ${genderLabel} player — please verify this match data.</span></span>`
      : '';

    if (!r) {
      return `<div class="card text-center opacity-40" data-cat="${cat}">
        <div class="text-lg font-bold text-gray-400">${cat}</div>
        <div class="text-gray-400 text-sm mt-1">No matches</div>
      </div>`;
    }
    const wr = _winRateDisplay(wins, losses);
    return `<div class="card text-center cursor-pointer hover:ring-2 hover:ring-blue-400 transition" data-cat="${cat}" onclick="selectCategory('${cat}')">
      <div class="text-lg font-bold text-blue-700">${cat}${warnHtml}</div>
      <div class="text-2xl font-mono font-semibold mt-1">${r.provisional ? '<span class="text-amber-500">~</span>' : ''}${formatRating(r.rating)}</div>
      <div class="mt-1">${reliabilityBadge(r)}</div>
      <div class="text-sm text-gray-500 mt-1">${wins}W ${losses}L</div>
      <div class="text-sm font-semibold mt-0.5 ${wr.colorClass}">${wr.text}</div>
    </div>`;
  }).filter(Boolean).join('');
}

function _wirePlayerCharts(ratedMatches, matches, players, player, asOf) {
  let activeCategory = null;

  window.selectCategory = (cat) => {
    if (activeCategory === cat) return;
    activeCategory = cat;
    const history = computeRatingHistory(ratedMatches, players, player.id, cat, asOf);
    const chartArea = document.getElementById('chart-area');
    if (chartArea) chartArea.classList.remove('hidden');
    Charts.renderProgressionChart('progression-chart', history, cat);
    document.querySelectorAll('#rating-cards .card').forEach(c => {
      const isActive = c.dataset.cat === cat;
      c.classList.toggle('ring-2', isActive);
      c.classList.toggle('ring-blue-500', isActive);
      c.classList.toggle('shadow-md', isActive);
    });
  };

  // Auto-select the category with the most rated matches for this player
  const best = CATEGORIES
    .map(cat => ({
      cat,
      count: ratedMatches.filter(m => m.category === cat && [...m.teamA, ...m.teamB].includes(player.id)).length,
    }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)[0];

  if (best) selectCategory(best.cat);
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
      <td class="px-3 py-2 text-sm">${m.matchType === 'unrated' ? '<span class="badge badge-unrated">Unrated</span>' : `<span class="capitalize text-gray-400">${m.matchType}</span>`}</td>
    </tr>`;
  }).join('');
}

// ── Practice Ratings (player.html) ───────────────────────────────────────────
// Shows what the player's rating would look like if practice (unrated) matches
// counted. Public — visible to everyone, but only renders when the player has
// at least one unrated match in some category.

function _renderPracticeRatings(player, allMatches, ratedMatches, players, asOf) {
  const relevant = _GENDER_CATS[player.gender] ?? new Set(CATEGORIES);

  const practiceRatings = computeRatings(allMatches, players, { asOf });
  const publicRatings   = computeRatings(ratedMatches, players, { asOf });

  const rows = CATEGORIES.filter(cat => relevant.has(cat)).map(cat => {
    const unratedCount = allMatches.filter(m =>
      m.matchType === 'unrated' && m.category === cat &&
      [...m.teamA, ...m.teamB].includes(player.id)
    ).length;
    if (unratedCount === 0) return '';
    const pub  = publicRatings.find(r => r.playerId === player.id && r.category === cat);
    const prac = practiceRatings.find(r => r.playerId === player.id && r.category === cat);
    const diff = pub && prac ? prac.rating - pub.rating : null;
    const diffStr = diff === null ? '—'
      : diff > 0.001  ? `<span class="text-green-600">+${diff.toFixed(3)}</span>`
      : diff < -0.001 ? `<span class="text-red-500">${diff.toFixed(3)}</span>`
      : '<span class="text-gray-400">±0</span>';
    return `<tr class="border-t">
      <td class="px-3 py-2 text-sm font-medium">${cat}</td>
      <td class="px-3 py-2 text-sm font-mono">${pub  ? formatRating(pub.rating)  : '—'}</td>
      <td class="px-3 py-2 text-sm font-mono">${prac ? formatRating(prac.rating) : '—'}</td>
      <td class="px-3 py-2 text-sm">${diffStr}</td>
      <td class="px-3 py-2 text-sm text-gray-400">${unratedCount}</td>
    </tr>`;
  }).filter(Boolean).join('');

  if (!rows) return;

  const section = document.createElement('div');
  section.className = 'bg-white rounded-lg shadow-sm border border-gray-200';
  section.innerHTML = `
    <div id="toggle-practice-ratings" class="px-4 py-3 border-b border-gray-200 flex items-center gap-3 cursor-pointer select-none">
      <h2 class="font-semibold text-gray-800">Practice Ratings</h2>
      <span class="text-xs text-gray-400">Includes unrated matches</span>
      <span class="ml-auto text-gray-400 text-xs chev transition-transform duration-200">▼</span>
    </div>
    <div id="body-practice-ratings" class="overflow-x-auto">
      <table class="data-table w-full text-sm">
        <thead>
          <tr>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">Cat</th>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">Public Rating</th>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">With Practice</th>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">Diff</th>
            <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-200">Unrated Matches</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('app').appendChild(section);
  _wireCollapsible('toggle-practice-ratings', 'body-practice-ratings', 'acedupr:collapsed:practice-ratings', true);
}

// ── Settings (settings.html) ─────────────────────────────────────────────────

// Settings page removed (site is read-only). about.html has no JS entry point.

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
    const joined = document.getElementById('member-joined').value || _todayIso();
    if (!name) return;
    Data.addPlayer({ id: crypto.randomUUID(), name, gender, joinedDate: joined, active: true });
    form.reset();
    document.getElementById('member-joined').value = _todayIso();
    _renderMembersTable(Data.loadPlayers());
    _showToast('Member added.');
  });

  const joinedInput = document.getElementById('member-joined');
  if (joinedInput) joinedInput.value = _todayIso();
}

function _wireDataManagement() {
  const exportBtn = document.getElementById('btn-export-json');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const json = Data.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `acedupr-backup-${_todayIso()}.json`;
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

// ── Shared toast + import success banner ─────────────────────────────────────

function _showImportSuccess(count) {
  const existing = document.getElementById('import-success-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'import-success-banner';
  banner.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-green-300 rounded-lg shadow-xl px-6 py-4 z-50 flex items-center gap-4 text-sm';
  banner.innerHTML = `
    <span class="text-green-600 text-xl">✓</span>
    <div>
      <p class="font-semibold text-gray-800">${count} match${count !== 1 ? 'es' : ''} imported successfully.</p>
      <p class="text-gray-500 text-xs mt-0.5">Ratings are recomputed on the Dashboard and Leaderboard pages.</p>
    </div>
    <div class="flex gap-2 ml-2">
      <a href="index.html" class="btn-primary text-xs py-1 px-3">View Dashboard</a>
      <a href="leaderboard.html" class="btn-secondary text-xs py-1 px-3">Leaderboard</a>
    </div>
    <button onclick="this.closest('#import-success-banner').remove()" class="text-gray-400 hover:text-gray-600 ml-2 text-lg leading-none">×</button>`;
  document.body.appendChild(banner);
  // Auto-dismiss after 12 seconds (long enough to read and act on)
  setTimeout(() => { banner.style.opacity = '0'; banner.style.transition = 'opacity 0.4s'; setTimeout(() => banner.remove(), 400); }, 12000);
}

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

// Minimal init for pages with no data (about.html, settings.html) — just
// populates the nav login state.
export function initNavAuth() {
  _renderNavAuth();
}

// ── Suggest page ──────────────────────────────────────────────────────────

const _CAT_HINTS = {
  MD: "Men's Doubles", WD: "Women's Doubles", XD: 'Mixed Doubles',
  MS: "Men's Singles", WS: "Women's Singles",
};

function _escSuggest(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _renderAttendanceGrid(players, arrivedRound, sessionRound) {
  const grid = document.getElementById('attendance-grid');
  if (!grid) return;
  const active = players.filter(p => p.active);
  const males   = active.filter(p => p.gender === 'M');
  const females = active.filter(p => p.gender === 'F');

  const makeRow = p => {
    const isLate = arrivedRound[p.id] != null;
    return `<div class="flex items-center justify-between gap-2 py-0.5">
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="player-check rounded" data-id="${p.id}" data-gender="${p.gender}">
        <span>${_escSuggest(p.name)}</span>
      </label>
      <button type="button" class="late-btn text-xs px-1.5 py-0.5 rounded border transition-colors ${isLate ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-gray-200 text-gray-400 hover:border-amber-300'}"
        data-id="${p.id}" title="Mark as late arrival">${isLate ? `Late R${arrivedRound[p.id]}` : 'Late'}</button>
    </div>`;
  };

  grid.innerHTML = `
    ${males.length ? `<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 mt-2">Males</p>` + males.map(makeRow).join('') : ''}
    ${females.length ? `<p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 mt-3">Females</p>` + females.map(makeRow).join('') : ''}
    ${!active.length ? '<p class="text-sm text-gray-400">No active players found.</p>' : ''}
  `;
}

function _updatePresentCount() {
  const n = document.querySelectorAll('.player-check:checked').length;
  const el = document.getElementById('present-count');
  if (el) el.textContent = `${n} selected`;
}

function _getPresentIds() {
  return [...document.querySelectorAll('.player-check:checked')].map(el => el.dataset.id);
}

function _renderCourtCard(match, courtNum, players) {
  const name = id => players.find(p => p.id === id)?.name ?? id;
  const teamA = match.teamA.map(name).join(' & ');
  const teamB = match.teamB.map(name).join(' & ');
  return `<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Court ${courtNum}</p>
    <div class="flex items-center gap-3">
      <div class="flex-1 bg-blue-50 rounded-lg px-3 py-2.5 text-center">
        <p class="text-xs text-blue-400 font-medium mb-0.5">Team A</p>
        <p class="text-sm font-semibold text-blue-800">${_escSuggest(teamA)}</p>
      </div>
      <span class="text-gray-300 font-bold text-lg">vs</span>
      <div class="flex-1 bg-green-50 rounded-lg px-3 py-2.5 text-center">
        <p class="text-xs text-green-400 font-medium mb-0.5">Team B</p>
        <p class="text-sm font-semibold text-green-800">${_escSuggest(teamB)}</p>
      </div>
    </div>
  </div>`;
}

function _renderSuggestionResult(result, players, roundNum) {
  document.getElementById('empty-state')?.classList.add('hidden');
  document.getElementById('kotc-section')?.classList.add('hidden');
  const section = document.getElementById('suggestion-section');
  section?.classList.remove('hidden');

  document.getElementById('round-number').textContent = roundNum;

  const warningEl = document.getElementById('suggestion-warning');
  if (result.warning) {
    warningEl.textContent = result.warning;
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }

  const cards = document.getElementById('court-cards');
  if (result.matches.length === 0) {
    cards.innerHTML = `<div class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">${_escSuggest(result.warning ?? 'Not enough players for a match.')}</div>`;
  } else {
    cards.innerHTML = result.matches.map((m, i) => _renderCourtCard(m, i + 1, players)).join('');
  }

  const sitSection = document.getElementById('sitting-out-section');
  const sitList    = document.getElementById('sitting-out-list');
  if (result.sittingOut.length > 0) {
    sitList.innerHTML = result.sittingOut
      .map(id => `<span class="text-xs bg-gray-100 rounded px-2 py-1">${_escSuggest(players.find(p => p.id === id)?.name ?? id)}</span>`)
      .join('');
    sitSection?.classList.remove('hidden');
  } else {
    sitSection?.classList.add('hidden');
  }
}

function _renderKotC(courtMatch, queue, players) {
  document.getElementById('empty-state')?.classList.add('hidden');
  document.getElementById('suggestion-section')?.classList.add('hidden');
  const section = document.getElementById('kotc-section');
  section?.classList.remove('hidden');

  const name = id => _escSuggest(players.find(p => p.id === id)?.name ?? id);
  const court = document.getElementById('kotc-court');
  if (courtMatch) {
    const tA = courtMatch.teamA.map(name).join(' &amp; ');
    const tB = courtMatch.teamB.map(name).join(' &amp; ');
    court.innerHTML = `<div class="flex items-center gap-3">
      <div class="flex-1 bg-blue-50 rounded-lg px-3 py-2 text-center">
        <p class="text-xs text-blue-400 font-medium mb-0.5">Team A</p>
        <p class="text-sm font-semibold text-blue-800">${tA}</p>
      </div>
      <span class="text-gray-300 font-bold">vs</span>
      <div class="flex-1 bg-green-50 rounded-lg px-3 py-2 text-center">
        <p class="text-xs text-green-400 font-medium mb-0.5">Team B</p>
        <p class="text-sm font-semibold text-green-800">${tB}</p>
      </div>
    </div>`;
  }

  const queueEl = document.getElementById('kotc-queue');
  queueEl.innerHTML = queue.length
    ? queue.map((id, i) => `<li class="flex items-center gap-2"><span class="text-xs text-gray-400 w-4">${i + 1}.</span><span>${name(id)}</span></li>`).join('')
    : '<li class="text-gray-400">Queue is empty</li>';
}

export async function initSuggest() {
  if (!guardCDN(false)) return;

  const { players, matches, mode: dataMode } = await _loadData();
  _showModeBanner(dataMode);
  _renderNavAuth(players, dataMode);
  const ratedMatches = matches.filter(_isRated);

  // Session state — never persisted to localStorage
  const _session = {
    sitOutQueue:    [],
    sessionHistory: [],
    sessionRound:   0,
    arrivedRound:   {},
    kotcMatch:      null,
    kotcQueue:      [],
  };

  let _category = 'MD';
  let _mode     = 'fair';
  let _courts   = 2;

  const _savedSuggestion = Data.loadSuggestion();
  if (_savedSuggestion) {
    _category = _savedSuggestion.category;
    _mode     = _savedSuggestion.mode;
    _courts   = _savedSuggestion.courts;
    Object.assign(_session, {
      sessionRound:   _savedSuggestion.sessionRound,
      sessionHistory: _savedSuggestion.sessionHistory,
      arrivedRound:   _savedSuggestion.arrivedRound,
      sitOutQueue:    _savedSuggestion.result.updatedSitOutQueue,
      _lastResult:    _savedSuggestion.result,
    });
  }

  // ── Team Fight state & helpers ────────────────────────────────────────────
  const TF_CATEGORIES = [
    { key: 'WS', label: "Women's Singles", pts: 5,  gender: 'F', doubles: false },
    { key: 'MS', label: "Men's Singles",   pts: 5,  gender: 'M', doubles: false },
    { key: 'WD', label: "Women's Doubles", pts: 7,  gender: 'F', doubles: true  },
    { key: 'MD', label: "Men's Doubles",   pts: 7,  gender: 'M', doubles: true  },
    { key: 'XD', label: "Mixed Doubles",   pts: 11, gender: null, doubles: true  },
  ];
  const TF_WIN_TARGET = 25;
  const _tf = {
    teamA: [], teamB: [],
    scoreA: 0, scoreB: 0,
    catIndex: 0, catScoreA: 0, catScoreB: 0,
    catPlayers: { A: [], B: [] },
    phase: 'idle',
    history: [], undoStack: [],
  };

  const _tfName = id => _escSuggest(players.find(p => p.id === id)?.name ?? id);

  function _tfLockControls(lock) {
    ['#category-buttons','#mode-buttons','#courts-buttons','#attendance-grid',
     '#sel-all-m','#sel-all-f','#sel-all','#sel-none'].forEach(sel => {
      document.querySelector(sel)?.classList.toggle('pointer-events-none', lock);
      document.querySelector(sel)?.classList.toggle('opacity-50', lock);
    });
  }

  function _tfShowView(view) {
    ['tf-teams-view','tf-fight-view','tf-result-view'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden'));
    if (view) document.getElementById(view)?.classList.remove('hidden');
  }

  function _tfSelectPlayers(team, cat) {
    const ratings = computeRatings(ratedMatches, players, { asOf: Date.now(), category: cat.key });
    const rate = (id, catKey) =>
      ratings.find(r => r.playerId === id && r.category === catKey)?.rating ??
      ratings.find(r => r.playerId === id)?.rating ??
      CONSTANTS.INITIAL_RATING;
    if (cat.key === 'XD') {
      const ms = team.filter(id => players.find(p => p.id === id)?.gender === 'M')
                     .sort((a, b) => rate(b, 'MD') - rate(a, 'MD'));
      const fs = team.filter(id => players.find(p => p.id === id)?.gender === 'F')
                     .sort((a, b) => rate(b, 'WD') - rate(a, 'WD'));
      return [ms[0], fs[0]].filter(Boolean);
    }
    return team
      .filter(id => players.find(p => p.id === id)?.gender === cat.gender)
      .sort((a, b) => rate(b, cat.key) - rate(a, cat.key))
      .slice(0, cat.doubles ? 2 : 1);
  }

  function _tfPopScore(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.remove('tf-pop');
    void el.offsetWidth;
    el.classList.add('tf-pop');
  }

  function _tfUpdateBoard() {
    const a = document.getElementById('tf-score-a');
    const b = document.getElementById('tf-score-b');
    if (a) { a.textContent = _tf.scoreA; _tfPopScore('tf-score-a'); }
    if (b) { b.textContent = _tf.scoreB; _tfPopScore('tf-score-b'); }
    const cs = document.getElementById('tf-cat-score');
    const cat = TF_CATEGORIES[_tf.catIndex];
    if (cs) cs.innerHTML = `${_tf.catScoreA} – ${_tf.catScoreB}<br><span class="text-sm font-normal text-gray-400">first to ${cat?.pts ?? ''}</span>`;
  }

  function _tfRenderHistory() {
    const el = document.getElementById('tf-history');
    if (!el) return;
    el.innerHTML = _tf.history.map(h => `
      <div class="bg-white rounded-xl border border-gray-100 px-4 py-2 flex items-center justify-between text-sm">
        <span class="text-gray-600">${_escSuggest(h.label)}</span>
        ${h.skipped
          ? '<span class="text-gray-400 text-xs">skipped</span>'
          : `<span class="font-bold ${h.scoreA > h.scoreB ? 'text-blue-600' : h.scoreB > h.scoreA ? 'text-red-600' : 'text-gray-500'}">${h.scoreA} – ${h.scoreB}</span>`
        }
      </div>`).join('');
  }

  function _tfRenderRound(cat) {
    _tfShowView('tf-fight-view');
    const round  = document.getElementById('tf-cat-round');
    const label  = document.getElementById('tf-cat-label');
    const target = document.getElementById('tf-cat-target');
    const banner = document.getElementById('tf-cat-banner');
    if (round)  round.textContent  = `Round ${_tf.catIndex + 1} of ${TF_CATEGORIES.length}`;
    if (label)  label.textContent  = cat.label;
    if (target) target.textContent = `First to ${cat.pts} points`;
    if (banner) { banner.classList.remove('tf-slide-up'); void banner.offsetWidth; banner.classList.add('tf-slide-up'); }
    const ca = document.getElementById('tf-court-a');
    const cb = document.getElementById('tf-court-b');
    if (ca) ca.textContent = _tf.catPlayers.A.map(_tfName).join(' & ');
    if (cb) cb.textContent = _tf.catPlayers.B.map(_tfName).join(' & ');
    _tfUpdateBoard();
    _tfRenderHistory();
  }

  function _tfBeginCategory(idx) {
    while (idx < TF_CATEGORIES.length) {
      const cat = TF_CATEGORIES[idx];
      const pA = _tfSelectPlayers(_tf.teamA, cat);
      const pB = _tfSelectPlayers(_tf.teamB, cat);
      if (pA.length > 0 && pB.length > 0) {
        _tf.catPlayers = { A: pA, B: pB };
        break;
      }
      _tf.history.push({ key: cat.key, label: cat.label, pts: cat.pts, scoreA: 0, scoreB: 0, skipped: true });
      _tfRenderHistory();
      idx++;
    }
    if (idx >= TF_CATEGORIES.length) { _tfMatchDone(); return; }

    _tf.catIndex  = idx;
    _tf.catScoreA = 0;
    _tf.catScoreB = 0;
    _tf.undoStack = [];

    const cat     = TF_CATEGORIES[idx];
    const overlay = document.getElementById('tf-overlay');
    const content = document.getElementById('tf-overlay-content');
    if (overlay && content) {
      content.innerHTML = `
        <p class="text-xs font-bold uppercase tracking-widest text-white/50 mb-3">Round ${idx + 1} of ${TF_CATEGORIES.length}</p>
        <p class="text-4xl font-black text-white tf-category-in">${_escSuggest(cat.label)}</p>
        <p class="text-lg text-white/70 mt-3">First to ${cat.pts} points</p>`;
      overlay.classList.remove('hidden');
      setTimeout(() => { overlay.classList.add('hidden'); _tfRenderRound(cat); }, 2400);
    } else {
      _tfRenderRound(cat);
    }
  }

  function _tfScore(team) {
    if (_tf.phase !== 'playing') return;
    _tf.undoStack.push(team);
    if (team === 'A') { _tf.catScoreA++; _tf.scoreA++; }
    else              { _tf.catScoreB++; _tf.scoreB++; }
    _tfUpdateBoard();
    const cat = TF_CATEGORIES[_tf.catIndex];
    if (_tf.catScoreA >= cat.pts || _tf.catScoreB >= cat.pts) {
      _tf.history.push({ key: cat.key, label: cat.label, pts: cat.pts, scoreA: _tf.catScoreA, scoreB: _tf.catScoreB });
      if (_tf.scoreA >= TF_WIN_TARGET || _tf.scoreB >= TF_WIN_TARGET || _tf.catIndex >= TF_CATEGORIES.length - 1) {
        _tfMatchDone();
      } else {
        _tfBeginCategory(_tf.catIndex + 1);
      }
    }
  }

  function _tfUndo() {
    if (!_tf.undoStack.length) return;
    const last = _tf.undoStack.pop();
    if (last === 'A') { _tf.catScoreA--; _tf.scoreA--; }
    else              { _tf.catScoreB--; _tf.scoreB--; }
    _tfUpdateBoard();
  }

  function _tfMatchDone() {
    _tf.phase = 'done';
    _tfLockControls(false);
    _tfShowView('tf-result-view');
    const aWins  = _tf.scoreA >= _tf.scoreB;
    const wName  = document.getElementById('tf-winner-name');
    const fScore = document.getElementById('tf-final-score');
    const card   = document.getElementById('tf-winner-card');
    const bd     = document.getElementById('tf-breakdown');
    if (wName)  { wName.textContent = aWins ? 'Team Volt' : 'Team Blaze'; wName.className = `text-4xl font-black mt-1 ${aWins ? 'text-blue-700' : 'text-red-700'}`; }
    if (fScore) fScore.textContent = `${_tf.scoreA} – ${_tf.scoreB}`;
    if (card)   { card.classList.remove('tf-winner'); void card.offsetWidth; card.classList.add('tf-winner'); }
    if (bd) {
      bd.innerHTML = _tf.history.map(h => `
        <div class="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
          <span class="text-gray-600">${_escSuggest(h.label)}</span>
          ${h.skipped
            ? '<span class="text-gray-400 text-xs">skipped</span>'
            : `<span class="font-semibold ${h.scoreA > h.scoreB ? 'text-blue-600' : h.scoreB > h.scoreA ? 'text-red-600' : 'text-gray-500'}">${h.scoreA} – ${h.scoreB}</span>`
          }
        </div>`).join('');
    }
  }

  // ── Render attendance grid ────────────────────────────────────────────────
  _renderAttendanceGrid(players, _session.arrivedRound, _session.sessionRound);

  // ── Category buttons ──────────────────────────────────────────────────────
  document.getElementById('category-buttons')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    _category = btn.dataset.cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
    const hint = document.getElementById('cat-hint');
    if (hint) hint.textContent = _CAT_HINTS[_category] ?? '';
  });

  // ── Mode buttons ──────────────────────────────────────────────────────────
  document.getElementById('mode-buttons')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    _mode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
    const suggestBtn = document.getElementById('btn-suggest');
    if (suggestBtn) suggestBtn.textContent = _mode === 'team-fight' ? 'Split Teams' : 'Suggest Round';
  });

  // ── Courts buttons ────────────────────────────────────────────────────────
  document.getElementById('courts-buttons')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-courts]');
    if (!btn) return;
    _courts = parseInt(btn.dataset.courts, 10);
    document.querySelectorAll('.court-btn').forEach(b => b.classList.toggle('active', b === btn));
  });

  // ── Attendance checkboxes ─────────────────────────────────────────────────
  document.getElementById('attendance-grid')?.addEventListener('change', e => {
    if (e.target.classList.contains('player-check')) _updatePresentCount();
  });

  document.getElementById('sel-all-m')?.addEventListener('click', () => {
    document.querySelectorAll('.player-check[data-gender="M"]').forEach(el => { el.checked = true; });
    _updatePresentCount();
  });
  document.getElementById('sel-all-f')?.addEventListener('click', () => {
    document.querySelectorAll('.player-check[data-gender="F"]').forEach(el => { el.checked = true; });
    _updatePresentCount();
  });
  document.getElementById('sel-all')?.addEventListener('click', () => {
    document.querySelectorAll('.player-check').forEach(el => { el.checked = true; });
    _updatePresentCount();
  });
  document.getElementById('sel-none')?.addEventListener('click', () => {
    document.querySelectorAll('.player-check').forEach(el => { el.checked = false; });
    _updatePresentCount();
  });

  // ── Late arrival toggles ──────────────────────────────────────────────────
  document.getElementById('attendance-grid')?.addEventListener('click', e => {
    const btn = e.target.closest('.late-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    if (_session.arrivedRound[id] != null) {
      delete _session.arrivedRound[id];
    } else {
      _session.arrivedRound[id] = _session.sessionRound + 1;
      // Also ensure player is checked
      const check = document.querySelector(`.player-check[data-id="${id}"]`);
      if (check) { check.checked = true; _updatePresentCount(); }
    }
    _renderAttendanceGrid(players, _session.arrivedRound, _session.sessionRound);
  });

  // ── Suggest / Regenerate ──────────────────────────────────────────────────
  const _doSuggest = () => {
    const present = _getPresentIds();
    if (!present.length) { _showToast('Select at least one player first.'); return; }

    if (_mode === 'team-fight') {
      if (present.length < 2) { _showToast('Need at least 2 players for Team Fight.'); return; }
      const ratings = computeRatings(ratedMatches, players, { asOf: Date.now() });
      const { teamA, teamB } = splitTeams(present, players, ratings);
      _tf.teamA = teamA; _tf.teamB = teamB;
      _tf.scoreA = _tf.scoreB = 0;
      _tf.catIndex = 0; _tf.history = []; _tf.undoStack = [];
      _tf.phase = 'teams';
      document.getElementById('empty-state')?.classList.add('hidden');
      document.getElementById('suggestion-section')?.classList.add('hidden');
      document.getElementById('kotc-section')?.classList.add('hidden');
      document.getElementById('tf-section')?.classList.remove('hidden');
      const listA = document.getElementById('tf-team-a-list');
      const listB = document.getElementById('tf-team-b-list');
      if (listA) listA.innerHTML = teamA.map(id => `<p class="text-sm font-medium text-blue-900">${_tfName(id)}</p>`).join('');
      if (listB) listB.innerHTML = teamB.map(id => `<p class="text-sm font-medium text-red-900">${_tfName(id)}</p>`).join('');
      _tfShowView('tf-teams-view');
      return;
    }

    if (_mode === 'king') {
      // Initialise KotC: first 4 on court, rest in queue
      const isDoubles = ['MD', 'WD', 'XD'].includes(_category);
      const perMatch  = isDoubles ? 4 : 2;
      if (present.length < perMatch) {
        _showToast(`Need at least ${perMatch} players for King of the Court.`);
        return;
      }
      _session.kotcMatch  = { teamA: present.slice(0, perMatch / 2), teamB: present.slice(perMatch / 2, perMatch) };
      _session.kotcQueue  = present.slice(perMatch);
      _renderKotC(_session.kotcMatch, _session.kotcQueue, players);
      return;
    }

    const result = suggestMatches(present, matches, players, {
      category:       _category,
      mode:           _mode,
      courts:         _courts,
      sitOutQueue:    _session.sitOutQueue,
      sessionHistory: _session.sessionHistory,
      arrivedRound:   _session.arrivedRound,
      sessionRound:   _session.sessionRound,
      asOf:           Date.now(),
    });

    _session.sitOutQueue = result.updatedSitOutQueue;
    _renderSuggestionResult(result, players, _session.sessionRound + 1);
    // Store last result for "Next Round"
    _session._lastResult = result;
    Data.saveSuggestion({
      category:        _category,
      mode:            _mode,
      courts:          _courts,
      result,
      sessionRound:    _session.sessionRound,
      sessionHistory:  _session.sessionHistory,
      arrivedRound:    _session.arrivedRound,
      presentPlayerIds: _getPresentIds(),
    });
  };

  document.getElementById('btn-suggest')?.addEventListener('click', _doSuggest);
  document.getElementById('btn-regenerate')?.addEventListener('click', _doSuggest);

  // ── Next Round ────────────────────────────────────────────────────────────
  document.getElementById('btn-next-round')?.addEventListener('click', () => {
    const last = _session._lastResult;
    if (!last) return;
    _session.sessionHistory = [..._session.sessionHistory, ...last.matches];
    _session.sessionRound++;
    _doSuggest();
  });

  // ── King of the Court buttons ─────────────────────────────────────────────
  const _kotcAdvance = loserTeam => {
    if (!_session.kotcMatch) return;
    const losers = loserTeam === 'A' ? _session.kotcMatch.teamA : _session.kotcMatch.teamB;
    const { challengers, updatedQueue, warning } = suggestKotC(_session.kotcQueue, losers, players);
    if (warning) { _showToast(warning); }
    if (challengers.length === 0) return;

    const winners = loserTeam === 'A' ? _session.kotcMatch.teamB : _session.kotcMatch.teamA;
    _session.kotcMatch = { teamA: winners, teamB: challengers };
    _session.kotcQueue = updatedQueue;
    _renderKotC(_session.kotcMatch, _session.kotcQueue, players);
  };

  document.getElementById('kotc-team-a-won')?.addEventListener('click', () => _kotcAdvance('B'));
  document.getElementById('kotc-team-b-won')?.addEventListener('click', () => _kotcAdvance('A'));

  // ── Team Fight listeners ──────────────────────────────────────────────────
  document.getElementById('tf-btn-resplit')?.addEventListener('click', _doSuggest);

  document.getElementById('tf-btn-fight')?.addEventListener('click', () => {
    _tf.phase   = 'playing';
    _tf.scoreA  = _tf.scoreB = 0;
    _tf.history = [];
    _tfLockControls(true);
    _tfBeginCategory(0);
  });

  document.getElementById('tf-score-a-btn')?.addEventListener('click', () => _tfScore('A'));
  document.getElementById('tf-score-b-btn')?.addEventListener('click', () => _tfScore('B'));
  document.getElementById('tf-btn-undo')?.addEventListener('click', _tfUndo);

  document.getElementById('tf-btn-rematch')?.addEventListener('click', () => {
    _tf.phase   = 'playing';
    _tf.scoreA  = _tf.scoreB = 0;
    _tf.history = [];
    _tfLockControls(true);
    _tfBeginCategory(0);
  });

  document.getElementById('tf-btn-new-teams')?.addEventListener('click', () => {
    _tf.phase = 'idle';
    _tfLockControls(false);
    document.getElementById('tf-section')?.classList.add('hidden');
    document.getElementById('empty-state')?.classList.remove('hidden');
    const suggestBtn = document.getElementById('btn-suggest');
    if (suggestBtn) suggestBtn.textContent = 'Split Teams';
  });

  if (_savedSuggestion) {
    document.querySelectorAll('.cat-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.cat === _category));
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === _mode));
    document.querySelectorAll('.court-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.courts === _courts));
    const hint = document.getElementById('cat-hint');
    if (hint) hint.textContent = _CAT_HINTS[_category] ?? '';
    _savedSuggestion.presentPlayerIds.forEach(id => {
      const el = document.querySelector(`.player-check[data-id="${id}"]`);
      if (el) el.checked = true;
    });
    _updatePresentCount();
    _renderSuggestionResult(_savedSuggestion.result, players, _savedSuggestion.sessionRound + 1);
  }
}
