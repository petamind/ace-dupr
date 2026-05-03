# Match Suggestion Feature — Implementation Plan

*Revised after professional pickleball scheduler review. Incorporates: fixed Pro mode
(snake-draft), sit-out queue, session history for rematch suppression, late-arrival
sit-out debt, King of the Court mode, Social/Balanced mode, normalized fairness
scores, XD-only history, 2–4 courts as first-class input.*

---

## Constraints This Spec Must Respect

Verified from actual code:

| Constraint | Source |
|---|---|
| `suggest.js` must be pure — no DOM, no `localStorage`, no `Date.now()` | patterns.md: layer boundaries |
| `computeRatings(matches, players, { asOf, category })` returns `{ playerId, category, rating, matchCount, globalMatchCount, lastMatchDate, provisional, inactive }[]` | rating.js:74-143 |
| Player object: `{ id, name, gender ('M'\|'F'), joinedDate, active }` | data.js:301-307 |
| Match object: `{ id, date, category, matchType, teamA: string[], teamB: string[], scoreA, scoreB, notes? }` | data.js:222-232 |
| Categories: `'MD' \| 'WD' \| 'XD' \| 'MS' \| 'WS'` | rating.js:18, ui.js:741 |
| `_genderForCategory('MD'\|'MS') → 'M'`, `('WD'\|'WS') → 'F'`, `('XD') → null` | ui.js:741-745 |
| `_isDoubles('MD'\|'WD'\|'XD') → true`, singles → false | ui.js:747-749 |
| All localStorage access via `Data.*` only | patterns.md: Single Storage Gateway |
| Session state: use `sessionStorage` (already used by DataSheets at data.js:276) or module-level variables — never `localStorage` for ephemeral data | patterns.md |
| Nav link pattern: `<a href="X" class="nav-link [active]">Label</a>` | index.html:51 |
| Mobile nav link pattern: `<a href="X" class="nav-link block px-1 py-2.5">Label</a>` | index.html:65 |
| Page init exported from `ui.js`, imported by `<script type="module">` in HTML | matches.html:194, ui.js:461 |
| `_loadData()` at ui.js:218-225 handles demo/sheets/file/local modes | ui.js:218 |
| `_showToast(msg)` at ui.js:1908 — call for user feedback | ui.js:1908 |
| `guardCDN(requireChart = true)` at ui.js:203 — call at top of every init | ui.js:203 |
| `formatRating(v)` at ui.js:9, `formatDate(iso)` at ui.js:13, `playerName(id, players)` at ui.js:19 — use, don't duplicate | ui.js:9-19 |
| ui.js is already 1923 lines — keep `initSuggest` lean; all engine logic in `suggest.js` | ui.js wc |
| `CONSTANTS.HALF_LIFE_DAYS = 180` available for recency decay reuse | rating.js:11 |
| `acedupr:` prefix required on any new localStorage keys | patterns.md |

---

## Objective

Build a **match suggestion page** (`suggest.html`) that, given a list of players
present on the day, generates fair, competitive, and fresh match pairings for 2–4
courts. The engine tracks sit-out rotation, suppresses within-session rematches,
handles late arrivals with sit-out debt credit, and supports four modes: Fair,
Pro (snake-draft), Social/Balanced, and King of the Court.

---

## Acceptance Criteria

| AC | Description | Verify | Expected | Automated |
|----|-------------|--------|----------|-----------|
| AC-1 | 4 male players + MD + Fair + 1 court → 1 match, 0 sitting out | Browser console: `suggestMatches(['m1','m2','m3','m4'], [], players, {category:'MD', mode:'fair', courts:1, sitOutQueue:[], sessionHistory:[]})` | `{ matches: [{teamA:[_,_], teamB:[_,_]}], sittingOut:[], updatedSitOutQueue:[] }` | No |
| AC-2 | 6 male players + MD + 1 court → 4 sitting out, sit-out queue returned | Same pattern with 6 players | `sittingOut.length === 2`, `updatedSitOutQueue.length === 2` | No |
| AC-3 | Pro mode 4 players rated 4.5, 3.8, 3.2, 2.5 → snake-draft pairing | Browser console: check teamA/teamB composition | Team A avg ≈ Team B avg (both ~3.5); rank1+rank4 on same team | No |
| AC-4 | Pro mode: top-2 rated players are on *opposite* teams | Inspect match output | Player rated 4.5 and 3.8 are in different teamA/teamB | No |
| AC-5 | Pair with 5× history not chosen over 0× pair when alternatives exist | Preload partnerCount matrix; call fair suggest | The fresh pair is always selected | No |
| AC-6 | SessionHistory has A+B vs C+D in round 1 → not duplicated in round 2 | Pass sessionHistory with one match; call again | Output match is different pairing or warning emitted | No |
| AC-7 | Same player not sitting out two consecutive rounds | Call suggestMatches with sitOutQueue=[p1]; 5 present, 1 court | p1 is in this round's matches; a different player is in sittingOut | No |
| AC-8 | Late arrival in round 3 does not jump ahead of someone who has sat out since round 1 | sitOutQueue=[p_waiting_since_r1]; lateArrivals=[p_new] | p_waiting_since_r1 plays before p_new if only 1 open spot | No |
| AC-9 | XD with 2M + 2F → each team has exactly 1M, 1F; history uses XD matches only | Filter matches to XD only in matrix build | teamA[0] gender='M', teamA[1] gender='F' (and same for teamB) | No |
| AC-10 | Not enough players for one match → result has `matches:[]` and `warning` string | < 4 players for doubles | `matches.length === 0`, `warning !== undefined` | No |
| AC-11 | Regenerate produces different result when multiple tie-break options exist | Two calls with same args when ties exist | At least 1 in 5 regenerations differs (ties are randomized) | No |
| AC-12 | 2-court session with 8 players → 2 non-overlapping matches, no player in both | `courts: 2`, 8 players | `matches.length === 2`; union of all IDs has no duplicates | No |
| AC-13 | Rating spread > 1.5 in Pro mode → `warning` field populated | Players with 4.8 and 2.9 in same pool | `result.warning` is a non-empty string | No |
| AC-14 | Social mode: each team has 1 strong + 1 weak player (avg ratings within 0.5) | 4 players rated 4.5, 4.0, 3.5, 2.5 | `|avgRatingTeamA - avgRatingTeamB| <= 0.5` | No |
| AC-15 | King of the Court: winners stay, queue advances correctly | `suggestKotC(waitingQueue, winnersIds, players)` | output challengers === top 2 from queue; queue shrinks by 2 | No |
| AC-16 | suggest.html nav link appears on all 6 existing pages | `grep -r "suggest.html" index.html matches.html leaderboard.html about.html settings.html player.html` | 6 files each contain `suggest.html` twice (desktop + mobile) | Yes |

---

## Technical Design

### Current flow (no suggestion)

```
User selects players manually → fills add-match form → submits
```

### New flow

```
suggest.html loads → _loadData() fetches players + matches
→ user marks attendance (checkboxes) → sets mode + courts
→ "Suggest round" → suggestMatches() called in suggest.js
→ match cards rendered → user plays the matches
→ "Next round" → sessionHistory updated → suggestMatches() called again
→ ...repeat...
```

### Key design decisions

**1. Engine is fully stateless (`suggest.js`)**
Caller (ui.js `initSuggest`) owns all mutable session state
(sitOutQueue, sessionHistory, sessionRound). This keeps suggest.js pure and
testable. State lives in module-level `let` variables in initSuggest closure,
not in localStorage.

**2. Pro mode = snake-draft (fixes the broken plan)**
For N players sorted by rating desc [p1…pN], match i uses:
- Team A: player at position `2i` (0-indexed), player at position `2i+3`
- Team B: player at position `2i+1`, player at position `2i+2`
For 4 players: Team A=[p1,p4] vs Team B=[p2,p3]. Both teams avg ~equal.

**3. Normalized pair scores (fixes prolific-player penalty)**
Raw counts divide by `Math.max(p.globalMatchCount, q.globalMatchCount, 1)`.
Players with 50 games and 0 games together score the same as
players with 5 games and 0 games together (both = 0.0). Prevents
high-frequency players from being perpetually deprioritized.

**4. Sit-out queue as explicit FIFO with debt**
Queue is an ordered array of player IDs. Players who sat out
longest are first. On each round:
- Players NOT in any suggested match are appended to the queue
- Players IN a suggested match are removed from the queue
- Guarantee: if a player is at queue[0], they are assigned to a match this round
- Late arrivals inserted at `max(0, queue.length - roundsMissed)` to give
  partial credit for rounds they missed without jumping the entire queue

**5. Session rematch suppression**
Before committing a pairing `[A,B] vs [C,D]`, check sessionHistory for:
- Exact duplicate: same teamA, same teamB
- Mirror: teamA matches sessionMatch.teamB AND teamB matches sessionMatch.teamA
If duplicate found, try the next-best pairing. If all pairings are duplicates
(small player pool), allow it and set `warning`.

**6. XD pair history is XD-only**
When building the pair matrix for XD category, filter `allMatches` to
`m.category === 'XD'` only. MD/WD history does not bleed into XD pairings.

**7. KotC is a separate function (different paradigm)**
`suggestKotC(waitingQueue, winnersIds, players)` — not a mode in
`suggestMatches`. The UI renders a different section when KotC is active.

**8. Social mode = Fair rotation + balanced teams**
Same as Fair mode but team composition is post-processed with snake-draft
re-assignment when team rating delta > 0.5. This means partner rotation is
still primary, but blowout matches are prevented.

---

## Interface Contracts

### `js/suggest.js` — full exported API

```js
/**
 * @param {string[]} presentPlayerIds
 * @param {Array<{id,date,category,teamA:string[],teamB:string[],scoreA,scoreB}>} allMatches
 * @param {Array<{id,name,gender:'M'|'F',active:boolean}>} players
 * @param {{
 *   category: 'MD'|'WD'|'XD'|'MS'|'WS',
 *   mode: 'fair'|'pro'|'social',
 *   courts: number,            // 1-4
 *   sitOutQueue: string[],     // player IDs ordered longest-waiting first
 *   sessionHistory: Array<{teamA:string[], teamB:string[]}>,
 *   asOf?: number,             // timestamp for computeRatings; defaults to Date.now()
 * }} opts
 * @returns {{
 *   matches: Array<{teamA:string[], teamB:string[]}>,
 *   sittingOut: string[],
 *   updatedSitOutQueue: string[],
 *   warning?: string,
 * }}
 */
export function suggestMatches(presentPlayerIds, allMatches, players, opts) { … }

/**
 * King of the Court: given the waiting queue and the winners from the last
 * match, returns the next challengers and updated queue.
 * @param {string[]} waitingQueue  — ordered list of player IDs waiting to play
 * @param {string[]} winnersIds    — 1 or 2 players who won (stay on court)
 * @param {Array<{id,name}>} players
 * @returns {{
 *   challengers: string[],        — 1 or 2 player IDs from front of queue
 *   updatedQueue: string[],
 *   warning?: string,
 * }}
 */
export function suggestKotC(waitingQueue, winnersIds, players) { … }
```

### Internal helpers in `js/suggest.js`

```js
// Build normalized pair-history matrix for one category (or XD-only)
function _buildPairMatrix(allMatches, category)
  → { partnerCount: Map<string,Map<string,number>>,
      opposedCount: Map<string,Map<string,number>>,
      totalGames:   Map<string,number> }

// Normalized score: how "fresh" pairing (a,b) is (lower = fresher)
function _pairScore(a, b, matrix) → number   // 0.0–1.0

// Greedy: pick best pair from candidates avoiding sessionHistory duplicates
function _greedyPair(candidates, matrix, sessionPairs) → [string, string]

// Snake-draft: sort by rating and interleave for balanced teams
function _snakeDraft(eligibleIds, ratings) → Array<{teamA:string[], teamB:string[]}>

// Manage sit-outs: given eligible players and courts, return who plays and who sits
function _assignCourts(eligible, courts, isDoubles, sitOutQueue)
  → { playing: string[][], sittingOut: string[] }

// Check if a proposed match duplicates sessionHistory
function _isDuplicate(teamA, teamB, sessionHistory) → boolean

// Insert late arrivals into sit-out queue with debt credit
function _insertLateArrivals(queue, lateArrivals, sessionRound) → string[]
```

### Session state shape (owned by `initSuggest` in `ui.js`)

```js
// module-level inside initSuggest closure — never persisted
const _session = {
  sitOutQueue:    [],  // string[]
  sessionHistory: [],  // Array<{teamA, teamB}>
  sessionRound:   0,   // number
  arrivedRound:   {},  // { [playerId]: roundNumber }
};
```

---

## Work Packages

### WP1 — `js/suggest.js` (new file, pure engine)

**File:** `/Users/tung.nguyen/ace_dupr/js/suggest.js` (create new)

**Imports:**
```js
import { computeRatings, CONSTANTS } from './rating.js';
```

**Build instructions:**

1. Export `suggestMatches` and `suggestKotC` as described in Interface Contracts.

2. `_buildPairMatrix(allMatches, category)`:
   - Filter `allMatches` where `m.category === category`
   - For each match, iterate `m.teamA` and `m.teamB`; for each pair on same team, `partnerCount[a][b]++`; for each cross-team pair, `opposedCount[a][b]++`; both symmetric
   - For each player seen, `totalGames[id]++`
   - Use `Map<string, Map<string, number>>` — not plain objects (avoids prototype pollution)

3. `_pairScore(a, b, matrix)`:
   - `raw = (matrix.partnerCount.get(a)?.get(b) ?? 0)`
   - `denom = Math.max(matrix.totalGames.get(a) ?? 0, matrix.totalGames.get(b) ?? 0, 1)`
   - `return raw / denom`
   - Lower = fresher (0.0 = never played together)

4. `_assignCourts(eligible, courts, isDoubles, sitOutQueue)`:
   - `playersNeeded = courts * (isDoubles ? 4 : 2)`
   - If `eligible.length < (isDoubles ? 4 : 2)`: return `{ playing: [], sittingOut: eligible }`
   - Determine who plays: prefer players NOT in sitOutQueue; if still too many, pull from back of queue (most recently played first stays out)
   - Guarantee: if player is at `sitOutQueue[0]`, include them in playing
   - Return `playing` as array of groups (one group per court), `sittingOut` as remainder
   - `updatedSitOutQueue`: remove players who are playing; append players who are sitting out

5. `_snakeDraft(eligibleIds, ratings)` (used by Pro mode):
   - Sort `eligibleIds` by `ratings.find(r => r.playerId === id)?.rating ?? CONSTANTS.INITIAL_RATING` descending
   - For each group of 4 [p0,p1,p2,p3]: `teamA=[p0,p3]`, `teamB=[p1,p2]`
   - For 2 (singles): `teamA=[p0]`, `teamB=[p1]`

6. `_isDuplicate(teamA, teamB, sessionHistory)`:
   - Normalize both arrays (sort each team's IDs)
   - Check if sessionHistory contains a match where sorted teamA matches and sorted teamB matches (in either order)

7. `_insertLateArrivals(queue, lateArrivals, sessionRound, arrivedRound)`:
   - For each late arrival: `roundsMissed = arrivedRound[id] - 1` (rounds where they weren't present)
   - Insert at `Math.max(0, queue.length - roundsMissed)`
   - Never insert before position 0 or beyond `queue.length`

8. `suggestMatches` flow:
   ```
   a. Filter eligible players by gender/category
   b. Handle minimum player check → return early if < 2 (singles) or < 4 (doubles)
   c. _insertLateArrivals into sitOutQueue copy
   d. _assignCourts → playing groups + sittingOut
   e. Build pair matrix (_buildPairMatrix)
   f. For each court's player group (4 for doubles, 2 for singles):
      - mode=fair:   _greedyPair for Team A, _greedyPair from remainder for Team B;
                     post-process: if |avgRatingA - avgRatingB| > 0.5, swap to reduce delta
      - mode=pro:    _snakeDraft for the group; warn if rating spread > 1.5
      - mode=social: _greedyPair first, then _snakeDraft-style rebalance if delta > 0.5
   g. _isDuplicate check; if duplicate, try next-best pairing (max 3 attempts); if all fail, allow + set warning
   h. Return { matches, sittingOut, updatedSitOutQueue, warning? }
   ```

9. `suggestKotC(waitingQueue, winnersIds, players)`:
   - If `waitingQueue.length < winnersIds.length`: return `{ challengers: [], updatedQueue: waitingQueue, warning: 'Not enough players waiting' }`
   - `challengers = waitingQueue.slice(0, winnersIds.length)`
   - `updatedQueue = waitingQueue.slice(winnersIds.length)`
   - Append winners to back of updatedQueue (they rest, then re-enter)
   - Wait — this is wrong: in KotC, winners STAY. Losers go to queue.
   - Correct: winners stay on court (caller tracks this); challengers come from front of queue; losers go to back of queue
   - Function signature: `suggestKotC(waitingQueue, losersIds, players)` → challengers from front of queue; updatedQueue = losers appended to end

---

### WP2 — `suggest.html` (new file)

**File:** `/Users/tung.nguyen/ace_dupr/suggest.html` (create new)

Copy the full nav block verbatim from `index.html:44-75` with these changes:
- Add `<a href="suggest.html" class="nav-link active">Suggest</a>` in both desktop and mobile nav (between Leaderboard and About)
- All other nav links have no `active` class

Page structure (inside `<main id="app" class="max-w-6xl mx-auto px-4 sm:px-6 py-8">`):

```html
<!-- Section 1: Session Settings (set once) -->
<div id="session-settings" class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
  <h2>Session Settings</h2>
  <!-- Category: MD/WD/XD/MS/WS radio or select -->
  <!-- Mode: fair / pro / social / king — radio tabs -->
  <!-- Courts: 1/2/3/4 — radio buttons -->
</div>

<!-- Section 2: Who's Here -->
<div id="attendance-section" class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
  <h2>Who's Here</h2>
  <!-- Quick toggles: Select All Males / All Females / All / Clear -->
  <!-- Checkbox grid: one per active player, grouped M / F -->
  <!-- Each checkbox: data-player-id, data-gender -->
  <!-- Late arrival toggle: small button next to each checked player -->
</div>

<!-- Section 3: Suggested Round -->
<div id="suggestion-section" class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6 hidden">
  <div class="flex items-center justify-between mb-4">
    <h2>Round <span id="round-number">1</span></h2>
    <div class="flex gap-2">
      <button id="btn-regenerate" class="btn-secondary">Regenerate</button>
      <button id="btn-next-round" class="btn-primary">Next Round</button>
    </div>
  </div>
  <!-- Court cards rendered here by JS: id="court-cards" -->
  <!-- Sitting out: id="sitting-out-list" -->
  <!-- Warning: id="suggestion-warning" hidden by default -->
</div>

<!-- Section 4: King of the Court (hidden unless KotC mode) -->
<div id="kotc-section" class="hidden ...">
  <h2>King of the Court</h2>
  <!-- Court display: id="kotc-court" — current 4 players -->
  <!-- Waiting queue: id="kotc-queue" — ordered list -->
  <!-- Losers selector: who lost? (2 buttons: Team A lost / Team B lost) -->
  <!-- "Next Match" button: id="btn-kotc-next" -->
</div>

<button id="btn-suggest" class="btn-primary w-full mt-4">Suggest Round</button>
```

CDN scripts: Tailwind only (no Chart.js needed — `guardCDN(false)`).

Module script at bottom:
```html
<script type="module">
  import { initSuggest } from './js/ui.js';
  initSuggest();
</script>
```

---

### WP3 — `js/ui.js` — add `initSuggest` (append to end)

**File:** `/Users/tung.nguyen/ace_dupr/js/ui.js`
**Location:** Append after last line (currently line 1923)

Add import at top of file (ui.js:1, after existing imports):
```js
// ui.js line 5 — after existing imports
import { suggestMatches, suggestKotC } from './suggest.js';
```

Add `export async function initSuggest()` at bottom of ui.js.

**initSuggest responsibilities** (keep lean — engine logic in suggest.js):

```js
export async function initSuggest() {
  if (!guardCDN(false)) return;           // ui.js:203 — no Chart.js needed

  const { players, matches, mode: dataMode } = await _loadData();  // ui.js:218
  _showModeBanner(dataMode);
  _renderNavAuth(players);

  // Session state — lives here, not in localStorage
  const _session = {
    sitOutQueue: [],
    sessionHistory: [],
    sessionRound: 0,
    arrivedRound: {},   // { playerId: roundNumber } for late arrivals
  };

  // Populate attendance checkboxes
  _renderAttendance(players);

  // Wire: "Suggest Round" button
  document.getElementById('btn-suggest')?.addEventListener('click', () => {
    const present = _getPresentPlayerIds();      // reads checked checkboxes
    const lateArrivals = _getLateArrivals();     // reads late-arrival toggles
    const category = _getCategory();
    const suggestMode = _getSuggestMode();
    const courts = _getCourts();

    if (suggestMode === 'king') {
      // KotC: initialize queue with present players (random or by rating)
      _initKotC(present, players, matches, category);
      return;
    }

    const result = suggestMatches(present, matches, players, {
      category,
      mode: suggestMode,
      courts,
      sitOutQueue: _session.sitOutQueue,
      sessionHistory: _session.sessionHistory,
      arrivedRound: _session.arrivedRound,
      sessionRound: _session.sessionRound,
      asOf: Date.now(),
    });

    _session.sitOutQueue = result.updatedSitOutQueue;
    _renderSuggestion(result, players, _session.sessionRound + 1);
  });

  // Wire: "Regenerate" — same call with different random seed (ties are random)
  // Wire: "Next Round" — append result.matches to sessionHistory, increment round, re-suggest
  // Wire: KotC "Team A/B lost" + "Next Match" buttons
}
```

Helper functions added (private, after `initSuggest`):
- `_renderAttendance(players)` — builds checkbox grid grouped by gender
- `_getPresentPlayerIds()` → `string[]` — reads checked boxes
- `_getLateArrivals()` → `string[]` — reads late-arrival toggles
- `_getCategory()` → `string` — reads category select
- `_getSuggestMode()` → `'fair'|'pro'|'social'|'king'`
- `_getCourts()` → `number`
- `_renderSuggestion(result, players, roundNum)` — renders court cards + sitting-out list + warning
- `_initKotC(present, players, matches, category)` — initializes KotC queue and shows `#kotc-section`
- `_renderKotC(court, queue, players)` — renders court + queue display

---

### WP4 — Nav links in all 6 existing pages

**Files:** `index.html`, `matches.html`, `leaderboard.html`, `about.html`, `settings.html`, `player.html`

For each file, add the Suggest link in **two places**:

**Desktop nav** — after `<a href="leaderboard.html" class="nav-link">Leaderboard</a>`:
```html
<a href="suggest.html" class="nav-link">Suggest</a>
```

**Mobile nav** — after `<a href="leaderboard.html" class="nav-link block px-1 py-2.5">Leaderboard</a>`:
```html
<a href="suggest.html" class="nav-link block px-1 py-2.5">Suggest</a>
```

Note: `settings.html` nav differs slightly (has Settings, no About) — verify its nav structure before editing and maintain the existing order.

---

## Execution Order

```
WP1 (suggest.js engine)
  ↓
WP2 (suggest.html — imports initSuggest from ui.js)
  ↓
WP3 (ui.js — initSuggest wires suggest.html DOM)
  ↓
WP4 (nav links — independent, can run in parallel with WP1-3)
```

WP1 must be first: WP3 imports from it.
WP2 must be before WP3: initSuggest wires DOM elements defined in WP2.
WP4 is fully independent.

---

## Complexity Impact

| WP | New files | Modified files | New concerns | LOC delta | Worsens audit finding |
|----|-----------|---------------|-------------|-----------|----------------------|
| WP1 | 1 (suggest.js ~200 LOC) | 0 | 1 (suggestion engine, pure) | +200 | No |
| WP2 | 1 (suggest.html ~150 LOC) | 0 | 0 (page shell, no logic) | +150 | No |
| WP3 | 0 | 1 (ui.js: +~120 LOC, now ~2043) | 0 (same UI wiring concern) | +120 | Worsens ui.js LOC (already 1923). Mitigated: all engine logic is in suggest.js; ui.js additions are thin wiring only |
| WP4 | 0 | 6 (nav only, ~2 lines each) | 0 | +12 | No |

**ui.js LOC mitigation:** The addition to ui.js is pure DOM wiring with no algorithmic logic. All computation is in suggest.js. If ui.js becomes unmaintainable, a future refactor can extract page-specific init functions into separate files (e.g. `js/pages/suggest.js`). Out of scope for this cycle.

---

## Risk Register

| Risk | Severity | Probability | Mitigation | Detection |
|------|----------|-------------|------------|-----------|
| Sheets mode returns player IDs as `f:name` — suggest.js must handle same ID format | High | High (sheets mode is the live mode) | suggest.js uses player IDs as opaque strings; no ID format assumptions | AC-1 passes in sheets mode with real player IDs |
| Small player pool (4–6 people) exhausts non-duplicate pairings within 3 rounds | Medium | Medium (typical Tuesday night) | After 3 duplicate-avoidance attempts, allow repeat + set `warning` | AC-11 and AC-6 |
| KotC with odd number of players on a singles court | Medium | Low | `suggestKotC` challenges with 1 player when singles; caller must track whether it's singles/doubles | AC-15 |
| Rating spread too wide in Pro mode → perceived unfairness | Medium | Medium | Warn when spread > 1.5 (AC-13); organizer decides whether to switch mode | AC-13 |
| Late arrival `arrivedRound` not tracked — caller forgets to set it | Low | Medium | `initSuggest` sets `arrivedRound[id] = _session.sessionRound + 1` when late-arrival toggle is activated | Manual browser test |
| `computeRatings` called with `Date.now()` in suggest.js — must pass `asOf` explicitly | High | Low (easy to catch) | `asOf` is a required field in opts; default to `Date.now()` in caller, not engine | Code review |

---

## Out of Scope for v1

- Saving attendance or session state to localStorage/sheets
- Pre-filling `matches.html` add-match form from suggestions
- Multi-round pre-generated schedule (full round-robin bracket)
- Court assignment labels / time slots
- Player availability ("leaving after round 2")
- Challenge/ladder mode
