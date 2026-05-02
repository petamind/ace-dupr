// Pure rating engine — no DOM, no localStorage, no Date.now().
// All functions take explicit asOf (JS timestamp) for deterministic replay.

export const ALGORITHM_VERSION = '1.0.0';

export const CONSTANTS = {
  SPREAD: 0.5,
  K_MAX: 0.40,
  K_SCALE: 20,
  K_MIN: 0.05,
  HALF_LIFE_DAYS: 180,
  INITIAL_RATING: 3.500,
  RATING_MIN: 2.000,
  RATING_MAX: 8.000,
  MATCH_TYPE_WEIGHT: { tournament: 1.5, club: 1.0, recreational: 0.5 },
  PROVISIONAL_DAYS: 90,
  PROVISIONAL_MIN_MATCHES: 3,
  INACTIVE_DAYS: 270,
};

const HALF_LIFE_MS = CONSTANTS.HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _dateMs(isoDate) {
  // Parse YYYY-MM-DD as local midnight to avoid timezone shifts
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(y, mo - 1, d).getTime();
}

function _expected(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / CONSTANTS.SPREAD));
}

function _kFactor(globalMatchCount) {
  return Math.max(CONSTANTS.K_MIN, CONSTANTS.K_MAX / (1 + globalMatchCount / CONSTANTS.K_SCALE));
}

function _recencyWeight(matchDateMs, asOf) {
  const msAgo = asOf - matchDateMs;
  return Math.pow(0.5, msAgo / HALF_LIFE_MS);
}

// Build initial state for all players across all categories.
function _buildState(players) {
  const state = {};
  for (const p of players) {
    state[p.id] = {
      globalMatchCount: 0, // K-factor decay uses global count across all categories
      categories: {},       // category → { rating, matchCount, lastMatchDate }
    };
  }
  return state;
}

function _ensureCategory(state, playerId, category) {
  if (!state[playerId]) {
    state[playerId] = { globalMatchCount: 0, categories: {} };
  }
  if (!state[playerId].categories[category]) {
    state[playerId].categories[category] = {
      rating: CONSTANTS.INITIAL_RATING,
      matchCount: 0,
      lastMatchDate: null,
    };
  }
}

// Replay all matches and return RatingResult[] for every player × category seen.
// opts.category — if provided, only return results for that category (still replays all).
// opts.asOf     — JS timestamp used for recency weight and provisional/inactive checks.
export function computeRatings(matches, players, { asOf, category } = {}) {
  const state = _buildState(players);

  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));

  for (const m of sorted) {
    const allIds = [...m.teamA, ...m.teamB];
    for (const id of allIds) _ensureCategory(state, id, m.category);

    const avgRating = (ids) =>
      ids.reduce((sum, id) => sum + state[id].categories[m.category].rating, 0) / ids.length;

    const rA = avgRating(m.teamA);
    const rB = avgRating(m.teamB);
    const E_A = _expected(rA, rB);
    const actual_A = m.scoreA / (m.scoreA + m.scoreB);
    const perfGap = actual_A - E_A;

    const matchDateMs = _dateMs(m.date);
    const recency = _recencyWeight(matchDateMs, asOf);
    const typeWeight = CONSTANTS.MATCH_TYPE_WEIGHT[m.matchType] ?? 1.0;

    const applyDelta = (ids, sign) => {
      for (const id of ids) {
        const cat = state[id].categories[m.category];
        const K = _kFactor(cat.matchCount);
        const delta = K * perfGap * sign * recency * typeWeight;
        cat.rating = _clamp(cat.rating + delta, CONSTANTS.RATING_MIN, CONSTANTS.RATING_MAX);
        cat.matchCount++;
        cat.lastMatchDate = m.date;
        state[id].globalMatchCount++;
      }
    };

    applyDelta(m.teamA, 1);
    applyDelta(m.teamB, -1);
  }

  const cutoffProvisional = asOf - CONSTANTS.PROVISIONAL_DAYS * 24 * 60 * 60 * 1000;
  const cutoffInactive = asOf - CONSTANTS.INACTIVE_DAYS * 24 * 60 * 60 * 1000;

  // Count matches in last PROVISIONAL_DAYS per player per category
  const recentCounts = {};
  for (const m of sorted) {
    const matchMs = _dateMs(m.date);
    if (matchMs < cutoffProvisional) continue;
    for (const id of [...m.teamA, ...m.teamB]) {
      const key = `${id}:${m.category}`;
      recentCounts[key] = (recentCounts[key] ?? 0) + 1;
    }
  }

  const results = [];

  // Emit results for all players in all categories they've played
  for (const [playerId, pState] of Object.entries(state)) {
    for (const [cat, catState] of Object.entries(pState.categories)) {
      if (category && cat !== category) continue;
      const recentCount = recentCounts[`${playerId}:${cat}`] ?? 0;
      const lastMs = catState.lastMatchDate ? _dateMs(catState.lastMatchDate) : null;
      results.push({
        playerId,
        category: cat,
        rating: catState.rating,
        matchCount: catState.matchCount,
        globalMatchCount: pState.globalMatchCount,
        lastMatchDate: catState.lastMatchDate,
        provisional: recentCount < CONSTANTS.PROVISIONAL_MIN_MATCHES,
        inactive: lastMs === null || lastMs < cutoffInactive,
      });
    }
  }

  // Also include active players with 0 matches in the requested category (showing initial rating)
  if (category) {
    for (const p of players) {
      if (!p.active) continue;
      const already = results.find(r => r.playerId === p.id && r.category === category);
      if (!already) {
        results.push({
          playerId: p.id,
          category,
          rating: CONSTANTS.INITIAL_RATING,
          matchCount: 0,
          globalMatchCount: state[p.id]?.globalMatchCount ?? 0,
          lastMatchDate: null,
          provisional: true,
          inactive: false,
        });
      }
    }
  }

  return results;
}

// Return rating progression for one player in one category, for chart rendering.
export function computeRatingHistory(matches, players, playerId, category, asOf) {
  const state = _buildState(players);
  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));
  const history = [];

  for (const m of sorted) {
    const allIds = [...m.teamA, ...m.teamB];
    for (const id of allIds) _ensureCategory(state, id, m.category);

    const avgRating = (ids) =>
      ids.reduce((sum, id) => sum + state[id].categories[m.category].rating, 0) / ids.length;

    const rA = avgRating(m.teamA);
    const rB = avgRating(m.teamB);
    const E_A = _expected(rA, rB);
    const actual_A = m.scoreA / (m.scoreA + m.scoreB);
    const perfGap = actual_A - E_A;

    const matchDateMs = _dateMs(m.date);
    const recency = _recencyWeight(matchDateMs, asOf);
    const typeWeight = CONSTANTS.MATCH_TYPE_WEIGHT[m.matchType] ?? 1.0;

    const applyDelta = (ids, sign) => {
      for (const id of ids) {
        const cat = state[id].categories[m.category];
        const K = _kFactor(cat.matchCount);
        const delta = K * perfGap * sign * recency * typeWeight;
        cat.rating = _clamp(cat.rating + delta, CONSTANTS.RATING_MIN, CONSTANTS.RATING_MAX);
        cat.matchCount++;
        cat.lastMatchDate = m.date;
        state[id].globalMatchCount++;
      }
    };

    applyDelta(m.teamA, 1);
    applyDelta(m.teamB, -1);

    const involvedInCategory =
      m.category === category && [...m.teamA, ...m.teamB].includes(playerId);
    if (involvedInCategory) {
      history.push({
        date: m.date,
        rating: state[playerId].categories[category].rating,
        matchId: m.id,
      });
    }
  }

  return history;
}
