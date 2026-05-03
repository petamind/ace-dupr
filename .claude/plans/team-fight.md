# Team Fight Mode — integrated into suggest.html as 5th mode

## Context

Club sessions need a format that uses all present players at once, covers all five pickleball disciplines, and builds to a dramatic climax. Team Fight is the 5th mode button in suggest.html — it splits everyone into two balanced sides and races them through all five categories in sequence, with live rally scoring toward 25 points and animated category transitions.

King of Court is the precedent: it completely takes over the right panel and runs a stateful loop. Team Fight does the same, but deeper — it locks the left panel once the fight begins to prevent accidental mode changes.

---

## Constraints

- `js/data.js` is the only file that touches `localStorage`.
- `js/suggest.js` is a pure module — no DOM, no localStorage, no `Date.now()`.
- `css/app.css` owns all `@keyframes` — no inline `<style>` blocks.
- `_escSuggest(str)` at `js/ui.js:2109` is the XSS-safe escape helper.
- `_renderAttendanceGrid(players, arrivedRound, sessionRound)` at `js/ui.js:2113` is reused as-is.
- `computeRatings(matches, players, { asOf, category })` from `js/rating.js` is the rating source.
- `guardCDN(false)` — no Chart.js needed.
- Nav `active` class is hardcoded per page — no new HTML file means no nav changes needed.
- `suggest.html` mode buttons use a `grid grid-cols-2 gap-1.5` container at line 115. The 5th button uses `col-span-2` to span the full width and signal it is a distinct mode.

---

## Game Design

### Teams
All present players → **Team Volt** (blue) vs **Team Blaze** (red). Equal size (±1 for odd counts). Snake-draft by average rating: sort descending, then A, B, B, A, A, B, B, A…

### Match Structure

Five categories in sequence. Every rally = 1 point to the team's running total. Category ends when the leading team hits that category's target. **First to 25 total wins** — or highest after all five categories.

| Order | Category | Target | Players/team | Design rationale |
|-------|----------|--------|-------------|-----------------|
| 1 | Women's Singles | 5 pts | 1F | Fast opener, individual showcase |
| 2 | Men's Singles | 5 pts | 1M | Continues individual combat |
| 3 | Women's Doubles | 7 pts | 2F | Escalates to team play |
| 4 | Men's Doubles | 7 pts | 2M | Main event, stakes rising |
| 5 | Mixed Doubles | 11 pts | 1M + 1F | Grand finale — everyone eligible, biggest comeback possible |

Max sweep: 35 pts. 25-point target typically resolves during XD. A team down 12–4 after four categories can still win by dominating XD.

### Player selection per category
Auto-select best-rated eligible players per team per category. If a team has zero eligible players for a category, skip it with a notice.

### Left panel locking
Once "Let's Fight!" is clicked, the category/mode/courts/attendance controls are disabled (`pointer-events-none opacity-50`). Unlocked when the user clicks "New Teams" (returns to setup) or "Done".

---

## Files to Modify

| File | Change |
|------|--------|
| `js/suggest.js` | Add `splitTeams()` export |
| `css/app.css` | Add 5 Team Fight `@keyframes` + utility classes |
| `suggest.html` | Add 5th mode button + `#tf-section` in right panel |
| `js/ui.js` | Add Team Fight state + handlers inside `initSuggest()` closure; update suggest.js import |

---

## Interface Contracts

### `splitTeams(presentIds, players, ratings)` — new export in `js/suggest.js`
```js
/**
 * @param {string[]} presentIds
 * @param {{ id: string, gender: 'M'|'F' }[]} players
 * @param {{ playerId: string, rating: number }[]} ratings
 * @returns {{ teamA: string[], teamB: string[] }}
 */
export function splitTeams(presentIds, players, ratings)
```
Algorithm: compute per-player average rating across all categories (fallback `CONSTANTS.INITIAL_RATING`), sort descending, snake-draft assign.

### TF_CATEGORIES and TF_WIN_TARGET constants (inside `initSuggest` closure)
```js
const TF_CATEGORIES = [
  { key: 'WS', label: "Women's Singles", pts: 5,  gender: 'F', doubles: false },
  { key: 'MS', label: "Men's Singles",   pts: 5,  gender: 'M', doubles: false },
  { key: 'WD', label: "Women's Doubles", pts: 7,  gender: 'F', doubles: true  },
  { key: 'MD', label: "Men's Doubles",   pts: 7,  gender: 'M', doubles: true  },
  { key: 'XD', label: "Mixed Doubles",   pts: 11, gender: null, doubles: true  },
];
const TF_WIN_TARGET = 25;
```

### `_tf` state object (inside `initSuggest` closure)
```js
const _tf = {
  teamA: [], teamB: [],
  scoreA: 0, scoreB: 0,
  catIndex: 0,
  catScoreA: 0, catScoreB: 0,
  catPlayers: { A: [], B: [] },
  phase: 'idle',   // 'idle' | 'teams' | 'playing' | 'done'
  history: [],     // { key, label, pts, scoreA, scoreB, skipped? }[]
  undoStack: [],   // 'A'|'B'[]
};
```

---

## Work Packages

### WP-1 — `js/suggest.js`: add `splitTeams` export

Append after line 391 (end of file):

```js
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
```

---

### WP-2 — `css/app.css`: add Team Fight keyframes

Append at end of file:

```css
/* ── Team Fight animations ─────────────────────────────────────────────── */
@keyframes tf-slide-up {
  from { opacity: 0; transform: translateY(56px) scale(0.88); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes tf-pop {
  0%   { transform: scale(1); }
  45%  { transform: scale(1.38); }
  100% { transform: scale(1); }
}
@keyframes tf-winner {
  0%   { opacity: 0; transform: scale(0.4) rotate(-8deg); }
  62%  { transform: scale(1.13) rotate(2deg); }
  82%  { transform: scale(0.96) rotate(-1deg); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}
@keyframes tf-category-in {
  0%   { opacity: 0; transform: translateX(-80px) scale(0.85); }
  65%  { transform: translateX(6px) scale(1.02); }
  100% { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes tf-flash {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}
.tf-slide-up    { animation: tf-slide-up    0.45s cubic-bezier(0.34,1.56,0.64,1) both; }
.tf-pop         { animation: tf-pop         0.35s ease-out; }
.tf-winner      { animation: tf-winner      0.7s  cubic-bezier(0.34,1.56,0.64,1) both; }
.tf-category-in { animation: tf-category-in 0.5s  cubic-bezier(0.34,1.56,0.64,1) both; }
.tf-flash       { animation: tf-flash       0.55s ease-in-out 3; }
```

---

### WP-3 — `suggest.html`: 5th mode button + `#tf-section`

**3a. Mode button** — in `#mode-buttons` grid (line 115), append after the King of Court button:

```html
<button type="button" data-mode="team-fight" class="mode-btn col-span-2 text-left">
  <span class="block font-medium text-sm">Team Fight</span>
  <span class="block text-xs text-gray-400 mt-0.5">Split all players into two balanced teams and battle through all 5 categories — WS, MS, WD, MD, XD — in one scored match to 25 points.</span>
</button>
```

**3b. `#tf-section`** — in the right column, after `#kotc-section` (line ~229):

```html
<!-- ── Team Fight ──────────────────────────────────────────────────────── -->
<div id="tf-section" class="hidden space-y-4">

  <!-- Team preview (shown after split, before fight starts) -->
  <div id="tf-teams-view" class="hidden space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p class="text-xs font-bold text-blue-500 uppercase tracking-widest mb-2">Team Volt</p>
        <div id="tf-team-a-list" class="space-y-1"></div>
      </div>
      <div class="bg-red-50 border border-red-200 rounded-xl p-4">
        <p class="text-xs font-bold text-red-500 uppercase tracking-widest mb-2">Team Blaze</p>
        <div id="tf-team-b-list" class="space-y-1"></div>
      </div>
    </div>
    <div class="flex gap-2">
      <button id="tf-btn-resplit" class="btn-secondary flex-1 text-sm">Reshuffle</button>
      <button id="tf-btn-fight" class="btn-primary flex-1 py-3 text-base">Let's Fight!</button>
    </div>
  </div>

  <!-- Live fight -->
  <div id="tf-fight-view" class="hidden space-y-3">

    <!-- Scoreboard -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div class="flex items-center justify-center gap-6">
        <div class="flex-1 text-center">
          <p class="text-xs font-bold text-blue-500 uppercase tracking-widest">Team Volt</p>
          <p id="tf-score-a" class="text-5xl font-black text-blue-700 leading-none mt-1">0</p>
        </div>
        <span class="text-gray-300 text-2xl font-bold">vs</span>
        <div class="flex-1 text-center">
          <p class="text-xs font-bold text-red-500 uppercase tracking-widest">Team Blaze</p>
          <p id="tf-score-b" class="text-5xl font-black text-red-700 leading-none mt-1">0</p>
        </div>
      </div>
      <p class="text-center text-xs text-gray-400 mt-2">First to 25 wins</p>
    </div>

    <!-- Category banner -->
    <div id="tf-cat-banner" class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
      <p id="tf-cat-round" class="text-xs font-bold text-gray-400 uppercase tracking-widest">Round 1 of 5</p>
      <p id="tf-cat-label" class="text-xl font-black text-gray-900 mt-1"></p>
      <p id="tf-cat-target" class="text-sm text-gray-500 mt-0.5"></p>
    </div>

    <!-- Court -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">On Court</p>
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-blue-50 rounded-lg px-3 py-3 text-center">
          <p class="text-xs text-blue-400 font-medium mb-1">Team Volt</p>
          <p id="tf-court-a" class="text-sm font-semibold text-blue-800"></p>
        </div>
        <span class="text-gray-300 font-bold text-xl">vs</span>
        <div class="flex-1 bg-red-50 rounded-lg px-3 py-3 text-center">
          <p class="text-xs text-red-400 font-medium mb-1">Team Blaze</p>
          <p id="tf-court-b" class="text-sm font-semibold text-red-800"></p>
        </div>
      </div>
    </div>

    <!-- Category score + buttons -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p id="tf-cat-score" class="text-center text-3xl font-black text-gray-700 mb-4">0 – 0</p>
      <div class="grid grid-cols-2 gap-3">
        <button id="tf-score-a-btn" class="rounded-xl py-4 text-base font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors">+1 Volt</button>
        <button id="tf-score-b-btn" class="rounded-xl py-4 text-base font-bold text-white bg-red-600   hover:bg-red-700   transition-colors">+1 Blaze</button>
      </div>
      <button id="tf-btn-undo" class="btn-secondary w-full mt-2 text-sm">Undo last point</button>
    </div>

    <!-- Completed rounds -->
    <div id="tf-history" class="space-y-2"></div>

    <!-- Skip notice (no eligible players) -->
    <div id="tf-skip-bar" class="hidden bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
      <span id="tf-skip-msg" class="text-sm text-amber-700"></span>
      <button id="tf-btn-skip" class="btn-secondary text-xs px-3 py-1">Skip</button>
    </div>
  </div>

  <!-- Result -->
  <div id="tf-result-view" class="hidden space-y-3">
    <div id="tf-winner-card" class="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
      <p class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Winner</p>
      <p id="tf-winner-name" class="text-4xl font-black mt-1"></p>
      <p id="tf-final-score" class="text-lg font-semibold text-gray-500 mt-2"></p>
    </div>
    <div id="tf-breakdown" class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2"></div>
    <div class="flex gap-2">
      <button id="tf-btn-rematch" class="btn-secondary flex-1 text-sm">Rematch</button>
      <button id="tf-btn-new-teams" class="btn-primary flex-1 text-sm">New Teams</button>
    </div>
  </div>

</div>

<!-- Category transition overlay -->
<div id="tf-overlay" class="hidden fixed inset-0 bg-gray-900/90 z-50 flex items-center justify-center">
  <div id="tf-overlay-content" class="text-center px-8"></div>
</div>
```

**3c. Suggest button text** — When mode is `team-fight`, the `#btn-suggest` label should read "Split Teams". This is handled in JS (see WP-4).

---

### WP-4 — `js/ui.js`: Team Fight inside `initSuggest`

**4a. Update suggest.js import** — find the existing import line (near top of ui.js):
```js
import { suggestMatches, suggestKotC } from './suggest.js';
```
Change to:
```js
import { suggestMatches, suggestKotC, splitTeams } from './suggest.js';
```

**4b. Inside `initSuggest()`, after the `_session` and `_savedSuggestion` blocks, add the `_tf` state and all Team Fight constants and helpers.** Insert after line 2267 (after the `_savedSuggestion` block ends):

```js
// ── Team Fight state ────────────────────────────────────────────────────
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
  const targets = ['#category-buttons','#mode-buttons','#courts-buttons','#attendance-grid',
    '#sel-all-m','#sel-all-f','#sel-all','#sel-none'];
  targets.forEach(sel => {
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
  const ratings = computeRatings(matches, players, { asOf: Date.now(), category: cat.key });
  const rate = (id, catKey) =>
    ratings.find(r => r.playerId === id && r.category === catKey)?.rating ??
    ratings.find(r => r.playerId === id)?.rating ??
    CONSTANTS.INITIAL_RATING;
  if (cat.key === 'XD') {
    const ms = team.filter(id => players.find(p => p.id === id)?.gender === 'M')
                   .sort((a, b) => rate(b,'MD') - rate(a,'MD'));
    const fs = team.filter(id => players.find(p => p.id === id)?.gender === 'F')
                   .sort((a, b) => rate(b,'WD') - rate(a,'WD'));
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
  if (cs) cs.textContent = `${_tf.catScoreA} – ${_tf.catScoreB}`;
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

  _tf.catIndex = idx;
  _tf.catScoreA = 0;
  _tf.catScoreB = 0;
  _tf.undoStack = [];

  const cat = TF_CATEGORIES[idx];
  const overlay = document.getElementById('tf-overlay');
  const content = document.getElementById('tf-overlay-content');
  if (overlay && content) {
    content.innerHTML = `
      <p class="text-xs font-bold uppercase tracking-widest text-white/50 mb-3">Round ${idx + 1} of ${TF_CATEGORIES.length}</p>
      <p class="text-4xl font-black text-white tf-category-in">${_escSuggest(cat.label)}</p>
      <p class="text-lg text-white/70 mt-3">First to ${cat.pts} points</p>`;
    overlay.classList.remove('hidden');
    setTimeout(() => {
      overlay.classList.add('hidden');
      _tfRenderRound(cat);
    }, 2400);
  } else {
    _tfRenderRound(cat);
  }
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
  document.getElementById('tf-skip-bar')?.classList.add('hidden');
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
  const aWins = _tf.scoreA >= _tf.scoreB;
  const wName = document.getElementById('tf-winner-name');
  const fScore = document.getElementById('tf-final-score');
  const card   = document.getElementById('tf-winner-card');
  const bd     = document.getElementById('tf-breakdown');
  if (wName) {
    wName.textContent  = aWins ? 'Team Volt' : 'Team Blaze';
    wName.className    = `text-4xl font-black mt-1 ${aWins ? 'text-blue-700' : 'text-red-700'}`;
  }
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
```

**4c. In `_doSuggest` (around line 2337)**, add a Team Fight branch as the FIRST check, before the King of Court check:

```js
const _doSuggest = () => {
  const present = _getPresentIds();
  if (!present.length) { _showToast('Select at least one player first.'); return; }

  // ── Team Fight ─────────────────────────────────────────────────────────
  if (_mode === 'team-fight') {
    if (present.length < 2) { _showToast('Need at least 2 players for Team Fight.'); return; }
    const ratings = computeRatings(matches, players, { asOf: Date.now() });
    const { teamA, teamB } = splitTeams(present, players, ratings);
    _tf.teamA = teamA;
    _tf.teamB = teamB;
    _tf.scoreA = _tf.scoreB = 0;
    _tf.catIndex = 0;
    _tf.history = [];
    _tf.undoStack = [];
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
  // ... rest of existing _doSuggest (king, then suggestMatches) unchanged
```

**4d. Update suggest button label** — after mode button click handler (around line 2285), add:

```js
document.getElementById('mode-buttons')?.addEventListener('click', e => {
  // ... existing mode button handler unchanged ...
  // add after existing handler:
  const suggestBtn = document.getElementById('btn-suggest');
  if (suggestBtn) suggestBtn.textContent = _mode === 'team-fight' ? 'Split Teams' : 'Suggest Round';
});
```

**4e. Team Fight event listeners** — add after the King of Court handlers (after line ~2409):

```js
// ── Team Fight listeners ────────────────────────────────────────────────
document.getElementById('tf-btn-resplit')?.addEventListener('click', _doSuggest);

document.getElementById('tf-btn-fight')?.addEventListener('click', () => {
  _tf.phase = 'playing';
  _tf.scoreA = _tf.scoreB = 0;
  _tf.history = [];
  _tfLockControls(true);
  _tfBeginCategory(0);
});

document.getElementById('tf-score-a-btn')?.addEventListener('click', () => _tfScore('A'));
document.getElementById('tf-score-b-btn')?.addEventListener('click', () => _tfScore('B'));
document.getElementById('tf-btn-undo')?.addEventListener('click', _tfUndo);

document.getElementById('tf-btn-rematch')?.addEventListener('click', () => {
  _tf.phase = 'playing';
  _tf.scoreA = _tf.scoreB = 0;
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
```

**4f. In the restore-from-persistence block** (end of `initSuggest`), ensure the Team Fight section is also hidden if the restored mode is not `team-fight` — no change needed; the `tf-section` starts hidden by default.

---

## Execution Order

```
WP-1 (suggest.js)    no deps → run first
WP-2 (app.css)       no deps → run first
(parallel)

WP-3 (suggest.html)  needs WP-2 (references .tf-* CSS classes)
WP-4 (ui.js)         needs WP-1 (splitTeams import)
(parallel after WP-1 + WP-2)
```

---

## Complexity Impact

| WP | New files | Modified files | LOC delta | Worsens audit finding |
|----|-----------|---------------|-----------|----------------------|
| WP-1 | 0 | 1 (suggest.js +12) | +12 | No |
| WP-2 | 0 | 1 (app.css +42) | +42 | No |
| WP-3 | 0 | 1 (suggest.html +105) | +105 | No |
| WP-4 | 0 | 1 (ui.js +180) | +180 | No — new code is isolated in named functions within existing closure |

---

## Verification

1. `grep "splitTeams" js/suggest.js` → finds export
2. `grep "splitTeams" js/ui.js` → finds import + usage (≥2 hits)
3. `grep -c "tf-slide-up\|tf-pop\|tf-winner" css/app.css` → ≥ 6
4. Open `http://localhost:8080/suggest.html` — "Team Fight" button visible in mode grid spanning full width
5. Select 6 players (mix M/F), click "Split Teams" → two team cards appear with 3 players each
6. Click "Let's Fight!" — left panel locks (dimmed), overlay shows "Round 1 of 5 / Women's Singles"
7. Overlay fades, fight screen shows court names and +1 buttons
8. Click "+1 Volt" 5× → WS ends, round 2 overlay appears
9. Play through all 5 categories or reach 25 → winner card appears with animation
10. Click "Rematch" → fight restarts from Round 1, same teams
11. Click "New Teams" → left panel unlocks, returns to empty state with "Split Teams" button
12. Test with all-male group → WS and WD skipped, shown in history as "skipped"
13. Switch to Fair mode → suggest button reverts to "Suggest Round"
