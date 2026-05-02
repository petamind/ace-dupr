// Pure match suggestion engine — no DOM, no localStorage, no Date.now().
// All functions receive explicit arguments; caller owns session state.
import { computeRatings, CONSTANTS } from './rating.js';

const SUGGEST_CONSTANTS = {
  FAIR_BALANCE_WEIGHT: 0.15,
  PRO_H2H_WINDOW_MS:  90 * 24 * 60 * 60 * 1000,
  PRO_H2H_WEIGHT:     0.25,
};

// ── Pair-history matrix ────────────────────────────────────────────────────

function _mapInc(map, a, b) {
  if (!map.has(a)) map.set(a, new Map());
  if (!map.has(b)) map.set(b, new Map());
  map.get(a).set(b, (map.get(a).get(b) ?? 0) + 1);
  map.get(b).set(a, (map.get(b).get(a) ?? 0) + 1);
}

function _dateMs(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).getTime();
}

function _buildPairMatrix(allMatches, category, asOfMs) {
  const partnerCount  = new Map();
  const opponentCount = new Map();
  const totalGames    = new Map();
  for (const m of allMatches) {
    if (m.category !== category) continue;
    for (const id of [...m.teamA, ...m.teamB])
      totalGames.set(id, (totalGames.get(id) ?? 0) + 1);
    for (const team of [m.teamA, m.teamB])
      for (let i = 0; i < team.length; i++)
        for (let j = i + 1; j < team.length; j++)
          _mapInc(partnerCount, team[i], team[j]);
    if (asOfMs - _dateMs(m.date) <= SUGGEST_CONSTANTS.PRO_H2H_WINDOW_MS)
      for (const a of m.teamA)
        for (const b of m.teamB)
          _mapInc(opponentCount, a, b);
  }
  return { partnerCount, opponentCount, totalGames };
}

// Normalized partner score: 0 = never paired, approaches 1 as pair frequency rises.
function _pairScore(a, b, matrix) {
  const raw   = matrix.partnerCount.get(a)?.get(b) ?? 0;
  const denom = Math.max(matrix.totalGames.get(a) ?? 0, matrix.totalGames.get(b) ?? 0, 1);
  return raw / denom;
}

function _opponentScore(a, b, matrix) {
  const raw   = matrix.opponentCount.get(a)?.get(b) ?? 0;
  const denom = Math.max(matrix.totalGames.get(a) ?? 0, matrix.totalGames.get(b) ?? 0, 1);
  return raw / denom;
}

// ── Rating helpers ─────────────────────────────────────────────────────────

function _getRating(id, ratings) {
  return ratings.find(r => r.playerId === id)?.rating ?? CONSTANTS.INITIAL_RATING;
}

function _teamAvg(team, ratings) {
  return team.reduce((s, id) => s + _getRating(id, ratings), 0) / team.length;
}

// ── Duplicate detection ────────────────────────────────────────────────────

function _isDuplicate(teamA, teamB, sessionHistory) {
  const sA = [...teamA].sort().join('|');
  const sB = [...teamB].sort().join('|');
  return sessionHistory.some(m => {
    const mA = [...m.teamA].sort().join('|');
    const mB = [...m.teamB].sort().join('|');
    return (mA === sA && mB === sB) || (mA === sB && mB === sA);
  });
}

// ── Late-arrival queue insertion ───────────────────────────────────────────

function _insertLateArrivals(queue, arrivedRound, sessionRound) {
  const inQueue = new Set(queue);
  const updated = [...queue];
  for (const [id, arrRound] of Object.entries(arrivedRound)) {
    if (inQueue.has(id)) continue;
    const roundsMissed = Math.max(0, arrRound - 1);
    // Give partial credit: insert behind anyone who has been waiting longer
    const insertPos = Math.max(0, updated.length - roundsMissed);
    updated.splice(insertPos, 0, id);
    inQueue.add(id);
  }
  return updated;
}

// ── Player selection and sit-out management ────────────────────────────────

function _selectAndGroup(eligible, courts, playersPerMatch, sitOutQueue, mode, ratings) {
  const maxPlayers = courts * playersPerMatch;

  // Players in the sit-out queue play first (they've waited longest).
  const queueSet = new Set(sitOutQueue);
  const priority = eligible
    .filter(id => queueSet.has(id))
    .sort((a, b) => sitOutQueue.indexOf(a) - sitOutQueue.indexOf(b));
  const normal   = eligible.filter(id => !queueSet.has(id));
  const ordered  = [...priority, ...normal];

  // Trim to nearest full match worth of players
  const canPlay  = Math.floor(Math.min(ordered.length, maxPlayers) / playersPerMatch) * playersPerMatch;
  const playing  = ordered.slice(0, canPlay);
  const sitting  = ordered.slice(canPlay);

  // Split playing players into per-court groups.
  // Pro mode: sort all by rating desc first so rank-based snake-draft is applied per group.
  const sorted = (mode === 'pro' && ratings.length > 0)
    ? [...playing].sort((a, b) => _getRating(b, ratings) - _getRating(a, ratings))
    : playing;

  const groups = [];
  for (let i = 0; i < sorted.length; i += playersPerMatch)
    groups.push(sorted.slice(i, i + playersPerMatch));

  // Update queue: remove players who are now playing; append new sit-outs.
  const playingSet = new Set(playing);
  const updatedQueue = sitOutQueue.filter(id => eligible.includes(id) && !playingSet.has(id));
  for (const id of sitting)
    if (!updatedQueue.includes(id)) updatedQueue.push(id);

  return { groups, sittingOut: sitting, updatedQueue };
}

// ── Within-group pairing ───────────────────────────────────────────────────

function _pairGroup(group, matrix, ratings, sessionHistory, mode) {
  // Singles
  if (group.length === 2) {
    return {
      teamA: [group[0]],
      teamB: [group[1]],
      isDup: _isDuplicate([group[0]], [group[1]], sessionHistory),
    };
  }

  // Doubles: enumerate all 3 unique pairings of 4 players.
  const [a, b, c, d] = group;
  const options = [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ].map(opt => ({
    ...opt,
    fairScore:   _pairScore(opt.teamA[0], opt.teamA[1], matrix)
               + _pairScore(opt.teamB[0], opt.teamB[1], matrix),
    ratingDelta: Math.abs(_teamAvg(opt.teamA, ratings) - _teamAvg(opt.teamB, ratings)),
    h2hScore:    opt.teamA.reduce((s, pa) =>
                   s + opt.teamB.reduce((ss, pb) => ss + _opponentScore(pa, pb, matrix), 0), 0),
    isDup:       _isDuplicate(opt.teamA, opt.teamB, sessionHistory),
  }));

  const pool = options.filter(o => !o.isDup);
  const candidates = pool.length > 0 ? pool : options; // allow repeat if no alternative

  if (mode === 'pro') {
    const score = o => o.ratingDelta + SUGGEST_CONSTANTS.PRO_H2H_WEIGHT * o.h2hScore;
    const preferred = candidates.find(o =>
      (o.teamA.includes(group[0]) && o.teamA.includes(group[3])) ||
      (o.teamB.includes(group[0]) && o.teamB.includes(group[3]))
    );
    const best = [...candidates].sort((a, b) => score(a) - score(b))[0];
    if (!preferred) return best;
    return score(preferred) <= score(best) * 1.10 ? preferred : best;
  }

  if (mode === 'social') {
    // Balance teams first; use pair freshness as tiebreaker.
    return [...candidates].sort((a, b) => {
      if (Math.abs(a.ratingDelta - b.ratingDelta) < 0.1) return a.fairScore - b.fairScore;
      return a.ratingDelta - b.ratingDelta;
    })[0];
  }

  // fair: minimize partner repeats; use rating balance as soft tiebreaker.
  return [...candidates].sort((a, b) => {
    const ca = a.fairScore + SUGGEST_CONSTANTS.FAIR_BALANCE_WEIGHT * a.ratingDelta;
    const cb = b.fairScore + SUGGEST_CONSTANTS.FAIR_BALANCE_WEIGHT * b.ratingDelta;
    if (Math.abs(ca - cb) < 0.001) return Math.random() - 0.5;
    return ca - cb;
  })[0];
}

// ── XD pairing ─────────────────────────────────────────────────────────────

function _pairXD(males, females, matrix, ratings, sessionHistory, mode) {
  // males/females are each [player0, player1] for one court.
  const [m0, m1] = males;
  const [f0, f1] = females;

  // Two possible team compositions:
  //   Normal:  [m0, f0] vs [m1, f1]
  //   Swapped: [m0, f1] vs [m1, f0]
  const opts = [
    { teamA: [m0, f0], teamB: [m1, f1] },
    { teamA: [m0, f1], teamB: [m1, f0] },
  ].map(o => ({
    ...o,
    fairScore:   _pairScore(o.teamA[0], o.teamA[1], matrix) + _pairScore(o.teamB[0], o.teamB[1], matrix),
    ratingDelta: Math.abs(_teamAvg(o.teamA, ratings) - _teamAvg(o.teamB, ratings)),
    isDup:       _isDuplicate(o.teamA, o.teamB, sessionHistory),
  }));

  const pool = opts.filter(o => !o.isDup);
  const candidates = pool.length > 0 ? pool : opts;

  if (mode === 'pro') {
    // Cross-pair for balance: top-rated male partners lower-rated female (and vice versa).
    // males and females are already sorted rating-desc by caller.
    const preferred = candidates.find(o => o.teamA[0] === m0 && o.teamA[1] === f1);
    return preferred ?? candidates[0];
  }

  return [...candidates].sort((a, b) => {
    const ca = a.fairScore + SUGGEST_CONSTANTS.FAIR_BALANCE_WEIGHT * a.ratingDelta;
    const cb = b.fairScore + SUGGEST_CONSTANTS.FAIR_BALANCE_WEIGHT * b.ratingDelta;
    if (Math.abs(ca - cb) < 0.001) return Math.random() - 0.5;
    return ca - cb;
  })[0];
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Generate match suggestions for one round.
 *
 * @param {string[]} presentPlayerIds
 * @param {object[]} allMatches  — full match log (used for pair-history matrix)
 * @param {object[]} players     — full player list
 * @param {{
 *   category: string,
 *   mode: 'fair'|'pro'|'social',
 *   courts: number,
 *   sitOutQueue: string[],
 *   sessionHistory: {teamA:string[],teamB:string[]}[],
 *   arrivedRound: {[playerId:string]: number},
 *   sessionRound: number,
 *   asOf: number,
 * }} opts
 * @returns {{ matches, sittingOut, updatedSitOutQueue, warning? }}
 */
export function suggestMatches(presentPlayerIds, allMatches, players, opts = {}) {
  const {
    category     = 'MD',
    mode         = 'fair',
    courts       = 2,
    sitOutQueue  = [],
    sessionHistory = [],
    arrivedRound = {},
    sessionRound = 0,
    asOf         = Date.now(),
  } = opts;

  const isDoubles      = ['MD', 'WD', 'XD'].includes(category);
  const isXD           = category === 'XD';
  const playersPerMatch = isDoubles ? 4 : 2;
  const genderFilter   = ({ MD: 'M', MS: 'M', WD: 'F', WS: 'F' })[category] ?? null;

  const eligible = genderFilter
    ? presentPlayerIds.filter(id => players.find(p => p.id === id)?.gender === genderFilter)
    : presentPlayerIds;

  const ratings = computeRatings(allMatches, players, { asOf, category });

  const matrix        = _buildPairMatrix(allMatches, category, asOf);
  const queueWithLate = _insertLateArrivals(sitOutQueue, arrivedRound, sessionRound);

  let groups, sittingOut, updatedSitOutQueue, warning;

  // ── XD: manage male/female pools separately ──────────────────────────────
  if (isXD) {
    const males   = eligible.filter(id => players.find(p => p.id === id)?.gender === 'M');
    const females = eligible.filter(id => players.find(p => p.id === id)?.gender === 'F');

    if (males.length < 2 || females.length < 2) {
      return {
        matches: [],
        sittingOut: eligible,
        updatedSitOutQueue: queueWithLate,
        warning: `Need 2+ males and 2+ females for XD — have ${males.length}M and ${females.length}F.`,
      };
    }

    const mCourts = Math.min(courts, Math.floor(males.length / 2), Math.floor(females.length / 2));

    const sortByMode = arr => {
      if (mode === 'pro' || mode === 'social')
        return [...arr].sort((a, b) => _getRating(b, ratings) - _getRating(a, ratings));
      // Queue priority first for fair mode
      return [...arr].sort((a, b) => {
        const ai = queueWithLate.indexOf(a), bi = queueWithLate.indexOf(b);
        if (ai !== -1 && bi === -1) return -1;
        if (ai === -1 && bi !== -1) return  1;
        if (ai !== -1 && bi !== -1) return ai - bi;
        return 0;
      });
    };

    const sM = sortByMode(males);
    const sF = sortByMode(females);
    const playingM = sM.slice(0, mCourts * 2);
    const playingF = sF.slice(0, mCourts * 2);
    sittingOut = [...sM.slice(mCourts * 2), ...sF.slice(mCourts * 2)];

    groups = Array.from({ length: mCourts }, (_, i) => ({
      males:   [playingM[i * 2], playingM[i * 2 + 1]],
      females: [playingF[i * 2], playingF[i * 2 + 1]],
      isXD:    true,
    }));

    const playingSet = new Set([...playingM, ...playingF]);
    updatedSitOutQueue = queueWithLate.filter(id => presentPlayerIds.includes(id) && !playingSet.has(id));
    for (const id of sittingOut)
      if (!updatedSitOutQueue.includes(id)) updatedSitOutQueue.push(id);

  } else {
    // ── Standard gender-filtered categories ──────────────────────────────
    if (eligible.length < playersPerMatch) {
      return {
        matches: [],
        sittingOut: eligible,
        updatedSitOutQueue: queueWithLate,
        warning: `Need at least ${playersPerMatch} eligible players for ${category} — have ${eligible.length}.`,
      };
    }

    const sel = _selectAndGroup(eligible, courts, playersPerMatch, queueWithLate, mode, ratings);
    groups             = sel.groups.map(g => ({ players: g, isXD: false }));
    sittingOut         = sel.sittingOut;
    updatedSitOutQueue = sel.updatedQueue;
  }

  // Pro mode: warn if rating spread is very wide
  if (mode === 'pro' && ratings.length > 0) {
    const present = eligible.map(id => _getRating(id, ratings));
    if (present.length >= 2) {
      const spread = Math.max(...present) - Math.min(...present);
      if (spread > 1.5)
        warning = `Rating spread of ${spread.toFixed(1)} pts is wide — matches may be uneven. Consider Fair or Social mode.`;
    }
  }

  // Generate one match per court group
  const matches = [];
  let workingHistory = [...sessionHistory];

  for (const group of groups) {
    const result = group.isXD
      ? _pairXD(group.males, group.females, matrix, ratings, workingHistory, mode)
      : _pairGroup(group.players, matrix, ratings, workingHistory, mode);

    if (result.isDup)
      warning = (warning ? warning + ' ' : '') + 'Some pairings repeat from this session.';

    matches.push({ teamA: result.teamA, teamB: result.teamB });
    workingHistory = [...workingHistory, { teamA: result.teamA, teamB: result.teamB }];
  }

  return { matches, sittingOut, updatedSitOutQueue, warning };
}

/**
 * King of the Court: losers leave court, challengers enter from front of queue.
 * Losers go to the back of the waiting queue.
 *
 * @param {string[]} waitingQueue — ordered list of players waiting to play
 * @param {string[]} losersIds    — players who just lost (leave the court)
 * @param {object[]} _players     — player list (reserved for future use)
 * @returns {{ challengers: string[], updatedQueue: string[], warning?: string }}
 */
export function suggestKotC(waitingQueue, losersIds, _players) {
  if (waitingQueue.length < losersIds.length) {
    return {
      challengers: [],
      updatedQueue: [...waitingQueue, ...losersIds],
      warning: `Not enough players in queue (need ${losersIds.length}, have ${waitingQueue.length}).`,
    };
  }
  return {
    challengers:  waitingQueue.slice(0, losersIds.length),
    updatedQueue: [...waitingQueue.slice(losersIds.length), ...losersIds],
  };
}

export function splitTeams(presentIds, players, ratings) {
  const avg = id => {
    const rs = ratings.filter(r => r.playerId === id);
    return rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : CONSTANTS.INITIAL_RATING;
  };
  const sorted = [...presentIds].sort((a, b) => avg(b) - avg(a));
  const teamA = [], teamB = [];
  sorted.forEach((id, i) => {
    const goA = (Math.floor(i / 2) % 2 === 0) === (i % 2 === 0);
    (goA ? teamA : teamB).push(id);
  });
  return { teamA, teamB };
}
