import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { _testHelpers } from '../js/data.js';

const { parseSheetRows, fnorm, frow } = _testHelpers;

// ── _parseSheetRows ────────────────────────────────────────────────────────────

describe('parseSheetRows — single header (matches format)', () => {
  // Simulates Papa.parse output for a CSV with one lowercase header row
  const data = [
    ['date', 'category', 'match_type', 'team_a_p1', 'team_b_p1', 'score_a', 'score_b'],
    ['2026-04-26', 'club', 'XD', 'Alice', 'Carol', '11', '6'],
    ['2026-04-26', 'club', 'MD', 'Eve', 'Grace', '11', '9'],
  ];

  test('uses row 0 as header when all values are lowercase identifiers', () => {
    const rows = parseSheetRows(data);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-04-26');
    assert.equal(rows[0].category, 'club');
    assert.equal(rows[0].match_type, 'XD');
    assert.equal(rows[0].team_a_p1, 'Alice');
  });

  test('data rows are objects with the correct key count', () => {
    const rows = parseSheetRows(data);
    assert.equal(Object.keys(rows[0]).length, 7);
  });
});

describe('parseSheetRows — double header (display + field names)', () => {
  // Row 0: display headers (mixed case) — should be skipped
  // Row 1: lowercase column identifiers — should be used as headers
  const data = [
    ['Date', 'Category', 'Match Type', 'Team A P1', 'Score A', 'Score B'],
    ['date', 'category', 'match_type', 'team_a_p1', 'score_a', 'score_b'],
    ['2026-04-26', 'club', 'XD', 'Alice', '11', '6'],
  ];

  test('skips display header and uses the lowercase identifier row', () => {
    const rows = parseSheetRows(data);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-04-26');
    assert.equal(rows[0].team_a_p1, 'Alice');
  });
});

describe('parseSheetRows — Google Column N headers', () => {
  // Google Sheets auto-generated headers: "Column 1", "Column 2", etc.
  const data = [
    ['Column 1', 'Column 2', 'Column 3', 'Column 4'],
    ['Tùng', 'M', '2026-04-26', 'active'],
    ['Hiền', 'F', '2026-04-26', 'active'],
  ];

  test('falls back to row 0 when no all-lowercase row found', () => {
    const rows = parseSheetRows(data);
    // hIdx stays 0; data starts from row 1
    assert.equal(rows.length, 2);
  });

  test('row values are keyed by the first-row values', () => {
    const rows = parseSheetRows(data);
    assert.equal(rows[0]['Column 1'], 'Tùng');
    assert.equal(rows[0]['Column 2'], 'M');
  });
});

describe('parseSheetRows — edge cases', () => {
  test('returns empty array for empty 2D array', () => {
    assert.deepEqual(parseSheetRows([]), []);
  });

  test('returns empty array when only header row present', () => {
    const rows = parseSheetRows([['date', 'category']]);
    assert.equal(rows.length, 0);
  });

  test('ignores empty header cells', () => {
    const data = [['date', 'category', '', 'score_a'], ['2026-04-26', 'club', 'extra', '11']];
    const rows = parseSheetRows(data);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-04-26');
    assert.equal(rows[0][''], undefined, 'empty-string key should not be set');
  });
});

// ── _fnorm ─────────────────────────────────────────────────────────────────────

describe('fnorm — correct column order (no swap needed)', () => {
  test('MD category + club match_type stays unchanged', () => {
    const row = { category: 'MD', match_type: 'club' };
    const result = fnorm(row);
    assert.equal(result.category, 'MD');
    assert.equal(result.match_type, 'club');
  });

  test('XD category + tournament match_type stays unchanged', () => {
    const row = { category: 'XD', match_type: 'tournament' };
    const result = fnorm(row);
    assert.equal(result.category, 'XD');
    assert.equal(result.match_type, 'tournament');
  });

  test('preserves all other fields on the row', () => {
    const row = { category: 'MD', match_type: 'club', date: '2026-04-26', score_a: '11' };
    const result = fnorm(row);
    assert.equal(result.date, '2026-04-26');
    assert.equal(result.score_a, '11');
  });
});

describe('fnorm — swapped columns (auto-correct)', () => {
  test('club in category + MD in match_type gets swapped', () => {
    const row = { category: 'club', match_type: 'MD' };
    const result = fnorm(row);
    assert.equal(result.category, 'MD',   'category should become the court type');
    assert.equal(result.match_type, 'club', 'match_type should become the event type');
  });

  test('tournament in category + XD in match_type gets swapped', () => {
    const row = { category: 'tournament', match_type: 'XD' };
    const result = fnorm(row);
    assert.equal(result.category, 'XD');
    assert.equal(result.match_type, 'tournament');
  });

  test('recreational in category + WD in match_type gets swapped', () => {
    const row = { category: 'recreational', match_type: 'WD' };
    const result = fnorm(row);
    assert.equal(result.category, 'WD');
    assert.equal(result.match_type, 'recreational');
  });
});

// ── _frow ──────────────────────────────────────────────────────────────────────

describe('frow — valid row produces match object', () => {
  const nameToId = { alice: 'p1', bob: 'p2', carol: 'p3', dave: 'p4' };

  test('doubles match produces correct fields', () => {
    const row = {
      date: '2026-04-26', category: 'MD', match_type: 'club',
      team_a_p1: 'Alice', team_a_p2: 'Bob',
      team_b_p1: 'Carol', team_b_p2: 'Dave',
      score_a: '11', score_b: '6',
    };
    const match = frow(row, nameToId);
    assert.ok(match !== null, 'valid row should produce a match');
    assert.equal(match.category, 'MD');
    assert.equal(match.matchType, 'club');
    assert.deepEqual(match.teamA, ['p1', 'p2']);
    assert.deepEqual(match.teamB, ['p3', 'p4']);
    assert.equal(match.scoreA, 11);
    assert.equal(match.scoreB, 6);
    assert.equal(match.date, '2026-04-26');
  });

  test('singles match produces 1-member team arrays', () => {
    const row = {
      date: '2026-04-26', category: 'MS', match_type: 'club',
      team_a_p1: 'Alice', team_a_p2: '',
      team_b_p1: 'Bob',   team_b_p2: '',
      score_a: '11', score_b: '8',
    };
    const match = frow(row, nameToId);
    assert.ok(match !== null);
    assert.deepEqual(match.teamA, ['p1']);
    assert.deepEqual(match.teamB, ['p2']);
  });

  test('match id is deterministic for identical input', () => {
    const row = {
      date: '2026-04-26', category: 'MD', match_type: 'club',
      team_a_p1: 'Alice', team_a_p2: '',
      team_b_p1: 'Bob',   team_b_p2: '',
      score_a: '11', score_b: '8',
    };
    assert.equal(frow(row, nameToId).id, frow(row, nameToId).id, 'id must be stable');
  });

  test('handles swapped category/match_type via fnorm', () => {
    const row = {
      date: '2026-04-26', category: 'club', match_type: 'MD',
      team_a_p1: 'Alice', team_b_p1: 'Bob', score_a: '11', score_b: '6',
    };
    const match = frow(row, nameToId);
    assert.ok(match !== null, 'should auto-correct swapped columns');
    assert.equal(match.category, 'MD');
    assert.equal(match.matchType, 'club');
  });
});

describe('frow — invalid rows return null', () => {
  const nameToId = { alice: 'p1', bob: 'p2' };

  test('null when team_a_p1 not in nameToId', () => {
    const row = {
      date: '2026-04-26', category: 'MD', match_type: 'club',
      team_a_p1: 'Unknown', team_b_p1: 'Bob', score_a: '11', score_b: '6',
    };
    assert.equal(frow(row, nameToId), null);
  });

  test('null when category is unrecognised', () => {
    const row = {
      date: '2026-04-26', category: 'XX', match_type: 'club',
      team_a_p1: 'Alice', team_b_p1: 'Bob', score_a: '11', score_b: '6',
    };
    assert.equal(frow(row, nameToId), null);
  });

  test('null when date is empty', () => {
    const row = {
      date: '', category: 'MD', match_type: 'club',
      team_a_p1: 'Alice', team_b_p1: 'Bob', score_a: '11', score_b: '6',
    };
    assert.equal(frow(row, nameToId), null);
  });

  test('null when scores are non-numeric', () => {
    const row = {
      date: '2026-04-26', category: 'MD', match_type: 'club',
      team_a_p1: 'Alice', team_b_p1: 'Bob', score_a: 'eleven', score_b: '6',
    };
    assert.equal(frow(row, nameToId), null);
  });
});
