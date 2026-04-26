import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRatings,
  computeRatingHistory,
  CONSTANTS,
  ALGORITHM_VERSION,
} from '../js/rating.js';

// Fixed reference time: asOf is 1 day after all test match dates so recency ≈ 1.0
const AS_OF = new Date('2026-04-27T12:00:00Z').getTime();

const p = (id, gender = 'M') => ({ id, active: true, gender, joinedDate: '2026-01-01' });
const m = (id, cat, teamA, teamB, scoreA, scoreB, matchType = 'club', date = '2026-04-26') => ({
  id, date, category: cat, matchType, teamA, teamB, scoreA, scoreB,
});

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

describe('CONSTANTS', () => {
  test('INITIAL_RATING is 3.500', () => assert.equal(CONSTANTS.INITIAL_RATING, 3.5));
  test('RATING_MIN is 2.000',     () => assert.equal(CONSTANTS.RATING_MIN, 2.0));
  test('RATING_MAX is 8.000',     () => assert.equal(CONSTANTS.RATING_MAX, 8.0));
  test('K_MAX > K_MIN',           () => assert.ok(CONSTANTS.K_MAX > CONSTANTS.K_MIN));
  test('tournament weight > club', () =>
    assert.ok(CONSTANTS.MATCH_TYPE_WEIGHT.tournament > CONSTANTS.MATCH_TYPE_WEIGHT.club));
  test('club weight > recreational', () =>
    assert.ok(CONSTANTS.MATCH_TYPE_WEIGHT.club > CONSTANTS.MATCH_TYPE_WEIGHT.recreational));
  test('ALGORITHM_VERSION is semver string', () =>
    assert.match(ALGORITHM_VERSION, /^\d+\.\d+\.\d+$/));
});

// ── computeRatings — basic ────────────────────────────────────────────────────

describe('computeRatings — basic', () => {
  test('returns empty array when no matches', () => {
    const result = computeRatings([], [p('p1'), p('p2')], { asOf: AS_OF });
    assert.equal(result.length, 0);
  });

  test('winner gains rating, loser loses', () => {
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11)];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    const r2 = result.find(r => r.playerId === 'p2');
    assert.ok(r1.rating > CONSTANTS.INITIAL_RATING, 'winner rating should increase');
    assert.ok(r2.rating < CONSTANTS.INITIAL_RATING, 'loser rating should decrease');
    // Symmetric: delta should be equal in magnitude for equal-rated players
    const gain = r1.rating - CONSTANTS.INITIAL_RATING;
    const loss = CONSTANTS.INITIAL_RATING - r2.rating;
    assert.ok(Math.abs(gain - loss) < 0.0001, 'gain and loss symmetric for equal-rated players');
  });

  test('blowout gives larger delta than close game', () => {
    const players = [p('p1'), p('p2')];
    const blowout = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 0)], players, { asOf: AS_OF });
    const close = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 20)], players, { asOf: AS_OF });
    const blowoutGain = blowout.find(r => r.playerId === 'p1').rating;
    const closeGain   = close.find(r => r.playerId === 'p1').rating;
    assert.ok(blowoutGain > closeGain, 'blowout winner gains more than close game winner');
  });

  test('rating clamped at RATING_MAX', () => {
    // Give p1 a very high rating by winning many blowouts against the same player
    const players = [p('p1'), p('p2')];
    const matches = Array.from({ length: 100 }, (_, i) =>
      m(`m${i}`, 'MD', ['p1'], ['p2'], 21, 0, 'tournament'));
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(r1.rating <= CONSTANTS.RATING_MAX, 'rating must not exceed RATING_MAX');
  });

  test('rating clamped at RATING_MIN', () => {
    const players = [p('p1'), p('p2')];
    const matches = Array.from({ length: 100 }, (_, i) =>
      m(`m${i}`, 'MD', ['p1'], ['p2'], 0, 21, 'tournament'));
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(r1.rating >= CONSTANTS.RATING_MIN, 'rating must not fall below RATING_MIN');
  });
});

// ── computeRatings — match type multiplier ────────────────────────────────────

describe('computeRatings — match type multiplier', () => {
  test('tournament match changes rating more than club', () => {
    const players = [p('p1'), p('p2')];
    const tournament = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'tournament')], players, { asOf: AS_OF });
    const club = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club')], players, { asOf: AS_OF });
    const tGain = tournament.find(r => r.playerId === 'p1').rating;
    const cGain = club.find(r => r.playerId === 'p1').rating;
    assert.ok(tGain > cGain, 'tournament gain should exceed club gain');
  });

  test('club match changes rating more than recreational', () => {
    const players = [p('p1'), p('p2')];
    const club = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club')], players, { asOf: AS_OF });
    const rec = computeRatings(
      [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'recreational')], players, { asOf: AS_OF });
    const cGain = club.find(r => r.playerId === 'p1').rating;
    const rGain = rec.find(r => r.playerId === 'p1').rating;
    assert.ok(cGain > rGain, 'club gain should exceed recreational gain');
  });
});

// ── computeRatings — provisional / inactive ───────────────────────────────────

describe('computeRatings — status flags', () => {
  test('player with 0 recent matches is provisional', () => {
    // Match played 180 days before asOf — outside 90-day provisional window
    const oldDate = new Date(AS_OF - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', oldDate)];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(r1.provisional, 'should be provisional with 0 matches in last 90 days');
  });

  test('player with 3+ recent matches is not provisional', () => {
    const players = [p('p1'), p('p2')];
    const matches = [
      m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-24'),
      m('m2', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-25'),
      m('m3', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-26'),
    ];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(!r1.provisional, 'should not be provisional with 3+ recent matches');
  });

  test('player inactive when last match > 270 days ago', () => {
    const oldDate = new Date(AS_OF - 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', oldDate)];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(r1.inactive, 'should be inactive when last match > 270 days ago');
  });

  test('player not inactive when last match within 270 days', () => {
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-26')];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.ok(!r1.inactive, 'should not be inactive with recent match');
  });
});

// ── computeRatings — doubles ──────────────────────────────────────────────────

describe('computeRatings — doubles', () => {
  test('both teammates share the rating update', () => {
    const players = [p('p1'), p('p2'), p('p3'), p('p4')];
    const matches = [m('m1', 'MD', ['p1', 'p2'], ['p3', 'p4'], 21, 11)];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    const r2 = result.find(r => r.playerId === 'p2');
    const r3 = result.find(r => r.playerId === 'p3');
    const r4 = result.find(r => r.playerId === 'p4');
    assert.ok(r1.rating > CONSTANTS.INITIAL_RATING, 'p1 (winner) gains');
    assert.ok(r2.rating > CONSTANTS.INITIAL_RATING, 'p2 (winner) gains');
    assert.ok(r3.rating < CONSTANTS.INITIAL_RATING, 'p3 (loser) loses');
    assert.ok(r4.rating < CONSTANTS.INITIAL_RATING, 'p4 (loser) loses');
    // Teammates with same starting rating receive the same delta
    assert.ok(Math.abs(r1.rating - r2.rating) < 0.0001, 'equal-rated teammates share equal delta');
  });

  test('matchCount is incremented per player per match', () => {
    const players = [p('p1'), p('p2')];
    const matches = [
      m('m1', 'MD', ['p1'], ['p2'], 21, 11),
      m('m2', 'MD', ['p1'], ['p2'], 11, 21),
    ];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const r1 = result.find(r => r.playerId === 'p1');
    assert.equal(r1.matchCount, 2, 'matchCount should reflect all played matches');
  });
});

// ── computeRatings — category isolation ──────────────────────────────────────

describe('computeRatings — category isolation', () => {
  test('MD result does not affect WD rating', () => {
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 0)];
    const result = computeRatings(matches, players, { asOf: AS_OF });
    const wdResult = result.find(r => r.playerId === 'p1' && r.category === 'WD');
    assert.equal(wdResult, undefined, 'WD entry should not exist when only MD played');
  });

  test('category filter returns only requested category', () => {
    const players = [p('p1'), p('p2')];
    const matches = [
      m('m1', 'MD', ['p1'], ['p2'], 21, 11),
      m('m2', 'XD', ['p1'], ['p2'], 21, 11),
    ];
    const result = computeRatings(matches, players, { asOf: AS_OF, category: 'MD' });
    const cats = [...new Set(result.map(r => r.category))];
    assert.deepEqual(cats, ['MD'], 'only MD results should be returned');
  });
});

// ── computeRatingHistory ──────────────────────────────────────────────────────

describe('computeRatingHistory', () => {
  test('returns one entry per match the player participated in', () => {
    const players = [p('p1'), p('p2'), p('p3')];
    const matches = [
      m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-24'),
      m('m2', 'MD', ['p1'], ['p3'], 11, 21, 'club', '2026-04-25'),
      m('m3', 'MD', ['p2'], ['p3'], 21, 11, 'club', '2026-04-26'), // p1 not in this
    ];
    const history = computeRatingHistory(matches, players, 'p1', 'MD', AS_OF);
    assert.equal(history.length, 2, 'only matches involving p1 in MD');
  });

  test('history entries are in chronological order', () => {
    const players = [p('p1'), p('p2')];
    const matches = [
      m('m1', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-24'),
      m('m2', 'MD', ['p1'], ['p2'], 11, 21, 'club', '2026-04-26'),
      m('m3', 'MD', ['p1'], ['p2'], 21, 11, 'club', '2026-04-25'),
    ];
    const history = computeRatingHistory(matches, players, 'p1', 'MD', AS_OF);
    assert.equal(history.length, 3);
    assert.ok(history[0].date <= history[1].date, 'first entry before second');
    assert.ok(history[1].date <= history[2].date, 'second entry before third');
  });

  test('returns empty array for player with no category matches', () => {
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11)];
    const history = computeRatingHistory(matches, players, 'p1', 'WD', AS_OF);
    assert.equal(history.length, 0);
  });

  test('each entry has date, rating, and matchId', () => {
    const players = [p('p1'), p('p2')];
    const matches = [m('m1', 'MD', ['p1'], ['p2'], 21, 11)];
    const history = computeRatingHistory(matches, players, 'p1', 'MD', AS_OF);
    assert.equal(history.length, 1);
    assert.ok('date'    in history[0], 'entry should have date');
    assert.ok('rating'  in history[0], 'entry should have rating');
    assert.ok('matchId' in history[0], 'entry should have matchId');
  });
});
