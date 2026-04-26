# Plan: ace-dupr Initial Build

**Created:** 2026-04-26  
**Status:** Ready to execute  
**Scope:** Greenfield — 10 files created, no existing source to modify

---

## Constraints This Spec Must Respect

Sourced from `MY_DUPR.md`, `patterns.md`, `architecture.md` — all read 2026-04-26.

| # | Constraint | Source |
|---|-----------|--------|
| C1 | All localStorage access through `Data.*` only — no bare `localStorage.*` anywhere else | patterns.md |
| C2 | All rating math in `js/rating.js` — no Elo logic in HTML or ui.js | CLAUDE.md |
| C3 | Ratings never stored — always computed via full replay of match log | CLAUDE.md |
| C4 | `computeRatings` must accept explicit `asOf` timestamp — no `Date.now()` inside | patterns.md |
| C5 | K-factor uses **global** match count across all categories, not per-category | patterns.md |
| C6 | localStorage keys must be prefixed `acedupr:` — keys: `acedupr:players`, `acedupr:matches`, `acedupr:schemaVersion` | patterns.md |
| C7 | Chart.js: store instance per canvas, call `chart.destroy()` before recreating | patterns.md |
| C8 | Recency weight: `0.5^((asOf - matchDate) / HALF_LIFE_MS)` relative to asOf, not match-vs-match | patterns.md |
| C9 | Full IEEE 754 precision in storage/computation; round only at render boundary with `.toFixed(3)` | patterns.md |
| C10 | CDN guard: check `typeof Chart !== 'undefined'` before using; surface friendly banner if missing | patterns.md |
| C11 | No build step, no npm — files run directly from `index.html` | CLAUDE.md |
| C12 | `<script type="module">` acceptable; CDN scripts declared as `<script src="...">` in HTML | CLAUDE.md |
| C13 | DUPR constants in one named block in `rating.js` — no magic numbers | CLAUDE.md |
| C14 | Provisional: < 3 results in last 90 days. Inactive: no results in 270 days | MY_DUPR.md |
| C15 | Separate rating pools: MD / WD / MS / WS. Starting rating 3.500 | MY_DUPR.md |
| C16 | Match type weights: tournament 1.5, club 1.0, recreational 0.5 | MY_DUPR.md |

---

## Objective

Build a complete, static pickleball club rating tracker (ace-dupr) that runs in the browser without a backend. Players, matches, and settings are persisted in localStorage. Ratings are computed on-demand via a DUPR-approximation Elo algorithm. The site is hosted on GitHub Pages and requires no build step.

---

## Acceptance Criteria

| AC | Description | Verify | Expected | Automated |
|----|-------------|--------|----------|-----------|
| AC1 | All 10 files exist | `ls index.html matches.html leaderboard.html player.html settings.html js/data.js js/rating.js js/charts.js js/ui.js css/app.css` | Exit 0, all listed | No |
| AC2 | No bare localStorage calls outside data.js | `grep -rn "localStorage\." js/ui.js js/rating.js js/charts.js index.html matches.html leaderboard.html player.html settings.html` | 0 matches | No |
| AC3 | No Elo/rating math outside rating.js | `grep -n "performance_gap\|K_MAX\|SPREAD\|HALF_LIFE\|10\s*\*\*\|Math.pow" js/ui.js js/charts.js` | 0 matches | No |
| AC4 | DUPR constants block in rating.js | `grep -n "SPREAD\|K_MAX\|K_SCALE\|K_MIN\|HALF_LIFE_DAYS\|INITIAL_RATING" js/rating.js` | All 6 constants found | No |
| AC5 | computeRatings accepts asOf param | `grep -n "asOf" js/rating.js` | ≥ 3 occurrences | No |
| AC6 | No Date.now() inside rating.js | `grep -n "Date\.now\(\)" js/rating.js` | 0 matches | No |
| AC7 | K-factor uses global match count | `grep -n "globalMatchCount\|global" js/rating.js` | ≥ 1 match | No |
| AC8 | All localStorage keys prefixed acedupr: | `grep -n "acedupr:" js/data.js` | ≥ 3 matches (players, matches, schemaVersion) | No |
| AC9 | Charts module stores instances + destroys | `grep -n "destroy\(\)" js/charts.js` | ≥ 1 match | No |
| AC10 | toFixed(3) only in ui.js render layer | `grep -rn "toFixed" js/rating.js js/data.js js/charts.js` | 0 matches | No |
| AC11 | Dashboard shows ratings table | Open index.html; add player + match; confirm rating row appears | Rating in 2.000–8.000 range | No |
| AC12 | Rating recalculates after match edit/delete | Delete a match from history; ratings change | Deterministic replay | No |
| AC13 | CSV import round-trips | Import sample CSV; verify match count in history | Match count = CSV row count | No |
| AC14 | JSON export/import round-trips | Export JSON; clear data; import JSON; verify players + matches restored | Counts match | No |
| AC15 | Provisional badge appears for < 3 matches in 90d | Add player with 2 matches; check dashboard | ~ prefix or Provisional badge | No |
| AC16 | site loads with python3 -m http.server | `python3 -m http.server 8080 &` then curl localhost:8080 | HTTP 200 | No |

---

## Technical Design

### Current flow
Empty repo — no existing source.

### New flow
```
Browser load
  → HTML page loads CDN scripts (Tailwind, Chart.js, PapaParse)
  → <script type="module"> bootstraps the page
  → ui.js initXxx() calls Data.load*() to get players + matches
  → ui.js calls Rating.computeRatings(matches, players, { asOf: Date.now() })
  → ui.js renders results to DOM
  → User actions (add match, delete, edit) call Data.* then recompute ratings
```

### Key design decisions

**Event-sourced matches:** `acedupr:matches` is append-only. Edits replace the match (same id) at the data layer only; the rating engine replays the full log. Deletions remove the entry. Ratings are never cached in storage.

**Module pattern:** Each JS file exports a single plain object (e.g., `const Data = { ... }; export default Data;`) using ES module syntax. HTML pages import with `<script type="module">`.

**No shared global state:** Pages are separate HTML files. Each page bootstraps its own state from localStorage on load. No shared in-memory state between pages (consistent with static site model).

**Gender filtering:** WD/WS category dropdowns filter player list to `gender === 'F'`; MD/MS to `gender === 'M'`. Players can appear in any category that matches their gender.

---

## Interface Contracts

### Types (used across all modules)

```javascript
// js/data.js
/** @typedef {{ id: string, name: string, gender: 'M'|'F', joinedDate: string, active: boolean }} Player */
/** @typedef {{ id: string, date: string, category: 'MD'|'WD'|'MS'|'WS',
 *              matchType: 'tournament'|'club'|'recreational',
 *              teamA: string[], teamB: string[],
 *              scoreA: number, scoreB: number, notes?: string }} Match */

// js/rating.js
/** @typedef {{ playerId: string, category: string, rating: number,
 *              matchCount: number, globalMatchCount: number,
 *              lastMatchDate: string|null, provisional: boolean, inactive: boolean }} RatingResult */
/** @typedef {{ date: string, rating: number, matchId: string }} HistoryPoint */
```

### data.js public API

```javascript
export default {
  loadPlayers(): Player[],
  savePlayers(players: Player[]): void,
  addPlayer(p: Player): void,
  updatePlayer(p: Player): void,
  loadMatches(): Match[],
  addMatch(m: Match): void,
  updateMatch(m: Match): void,           // replaces by id
  deleteMatch(id: string): void,
  exportJSON(): string,                  // full backup
  importJSON(json: string): { ok: boolean, error?: string },
  exportMatchesCSV(matches: Match[], players: Player[]): void,  // triggers download
  importCSV(file: File): Promise<Match[]>,                      // via PapaParse
  clearAll(): void,
  SCHEMA_VERSION: 1
}
```

### rating.js public API

```javascript
export const CONSTANTS = {
  SPREAD: 0.5, K_MAX: 0.40, K_SCALE: 20, K_MIN: 0.05,
  HALF_LIFE_DAYS: 180, INITIAL_RATING: 3.500,
  RATING_MIN: 2.000, RATING_MAX: 8.000,
  MATCH_TYPE_WEIGHT: { tournament: 1.5, club: 1.0, recreational: 0.5 },
  PROVISIONAL_DAYS: 90, PROVISIONAL_MIN_MATCHES: 3, INACTIVE_DAYS: 270
}

// Compute current rating for all players across all (or one) category.
// asOf is a JS timestamp (Date.now()). Pure — no side effects, no Date.now() internally.
export function computeRatings(
  matches: Match[],
  players: Player[],
  opts: { asOf: number, category?: string }
): RatingResult[]

// Compute rating progression for chart rendering.
// Returns one point per match involving the player in the given category.
export function computeRatingHistory(
  matches: Match[],
  players: Player[],
  playerId: string,
  category: string,
  asOf: number
): HistoryPoint[]
```

### charts.js public API

```javascript
export default {
  // Creates or replaces chart on canvasId. Calls destroy() on existing instance.
  renderProgressionChart(canvasId: string, history: HistoryPoint[], category: string): void,
  destroyChart(canvasId: string): void,
  destroyAll(): void
}
```

### ui.js public API

```javascript
export default {
  // Page bootstraps — called from each HTML <script type="module">
  initDashboard(): void,
  initMatches(): void,
  initLeaderboard(): void,
  initPlayer(playerId: string): void,
  initSettings(): void,

  // Render helpers
  formatRating(v: number): string,     // v.toFixed(3)
  formatDate(iso: string): string,     // locale string
  reliabilityBadge(r: RatingResult): string,  // HTML string
  trendArrow(delta: number): string,   // '↑' | '↓' | '—'
}
```

---

## Work Packages

### WP1 — js/data.js (Storage Gateway)

**Files:** `js/data.js` (create)

**Responsibilities:**
- Load/save players and matches from/to localStorage under `acedupr:` namespace
- Schema version check — if `acedupr:schemaVersion` absent, initialise to `1`
- JSON export: `JSON.stringify({ schemaVersion, players, matches })`
- JSON import: validate shape, version check, write players + matches
- CSV export: build CSV string from matches + player name lookup, trigger download via `<a>` click
- CSV import: return `PapaParse.parse(file, { header: true })` result mapped to Match objects

**Key implementation notes:**
- Use `crypto.randomUUID()` for new IDs (available in all evergreen browsers)
- `addMatch` appends to existing array (event-sourced — never replaces full array unless importing)
- `updateMatch` finds by `m.id` and replaces that element
- `deleteMatch` filters out by id
- Guard against missing `window.Papa` (CDN failure) in `importCSV`

---

### WP2 — js/rating.js (DUPR Algorithm)

**Files:** `js/rating.js` (create)

**Implementation — computeRatings algorithm:**

```
1. Build player state map: playerId → { globalMatchCount: 0, categoryRating: Map<cat, number> }
   Initialise all players at INITIAL_RATING per category.

2. Sort matches by date ascending (ISO date string sort is lexicographic — correct).

3. For each match:
   a. Resolve teamA ratings, teamB ratings (average for doubles, direct for singles)
   b. E_A = 1 / (1 + 10^((rB - rA) / SPREAD))
   c. actual_ratio_A = scoreA / (scoreA + scoreB)
   d. performance_gap = actual_ratio_A - E_A
   e. recency_weight = 0.5^((asOf - matchDate_ms) / HALF_LIFE_MS)
   f. match_type_weight = MATCH_TYPE_WEIGHT[matchType]
   g. For each player on teamA:
        K = max(K_MIN, K_MAX / (1 + globalMatchCount / K_SCALE))
        delta = K * performance_gap * recency_weight * match_type_weight
        new_rating = clamp(old_rating + delta, RATING_MIN, RATING_MAX)
        globalMatchCount++
   h. For each player on teamB: same with -performance_gap

4. After replay, for each player × category:
   - Count matches in last PROVISIONAL_DAYS days → provisional flag
   - Check lastMatchDate vs INACTIVE_DAYS → inactive flag

5. Return RatingResult[] for all player × category combinations with ≥ 1 match,
   plus all active players with 0 matches (showing INITIAL_RATING, provisional).
```

**Implementation — computeRatingHistory:**
```
1. Filter matches by category involving playerId
2. Replay same algorithm as above, but for each match involving the player:
   record { date: match.date, rating: ratingAfterMatch, matchId: match.id }
3. Return array of HistoryPoint sorted by date
```

---

### WP3 — js/ui.js (Shared Helpers + Page Bootstraps)

**Files:** `js/ui.js` (create)

**Page bootstrap pattern (same structure for all 5 pages):**
```javascript
async function initDashboard() {
  if (!guardCDN()) return;
  const players = Data.loadPlayers();
  const matches = Data.loadMatches();
  const asOf = Date.now();
  const ratings = computeRatings(matches, players, { asOf });
  renderDashboard(players, ratings);
  wireEventListeners();
}
```

**CDN guard:**
```javascript
function guardCDN() {
  if (typeof Chart === 'undefined' || typeof Papa === 'undefined') {
    document.getElementById('app').innerHTML =
      '<p class="text-red-600 p-8">App requires internet to load dependencies (Chart.js, PapaParse). Please reload with a connection.</p>';
    return false;
  }
  return true;
}
```

**Shared render helpers:**
- `formatRating(v)` → `v.toFixed(3)` — only place toFixed is called
- `formatDate(iso)` → `new Date(iso + 'T00:00:00').toLocaleDateString()`
- `reliabilityBadge(r)` → `'Full' | 'Provisional' | 'Inactive'` with colour class
- `trendArrow(delta)` → `delta > 0.001 ? '↑' : delta < -0.001 ? '↓' : '—'`
- `playerName(id, players)` → lookup helper used everywhere

---

### WP4 — js/charts.js (Chart.js Wrapper)

**Files:** `js/charts.js` (create)

```javascript
const _instances = {};  // canvasId → Chart instance

function renderProgressionChart(canvasId, history, category) {
  if (_instances[canvasId]) { _instances[canvasId].destroy(); }
  const ctx = document.getElementById(canvasId).getContext('2d');
  _instances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{ label: category + ' Rating', data: history.map(h => h.rating),
                   tension: 0.3, pointRadius: 4 }]
    },
    options: {
      scales: { y: { min: 2.0, max: 8.0, ticks: { callback: v => v.toFixed(3) } } },
      plugins: { tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(3) } } }
    }
  });
}
```

---

### WP5 — index.html (Dashboard)

**Files:** `index.html` (create)

**Content:**
- CDN `<script>` tags: Tailwind CSS play CDN, Chart.js, PapaParse
- Nav bar: Ace DUPR | Dashboard | Matches | Leaderboard | Settings
- Ratings table: Name | MD | WD | MS | WS | Reliability — sortable by clicking header
- Top-3 highlight: gold/silver/bronze row styles per category (hidden cols for non-matching categories)
- Quick-add match button → links to `matches.html`
- `<script type="module">` that imports from `js/ui.js` and calls `UI.initDashboard()`

---

### WP6 — matches.html (Match Entry + History)

**Files:** `matches.html` (create)

**Content:**
- Two tabs: Manual Entry | CSV Upload
- Manual form: date (default today), category (MD/WD/MS/WS), matchType, team A player dropdowns × 2, team B dropdowns × 2 (p2 hidden for singles categories MS/WS), score inputs, notes, Submit button
- CSV Upload: drag-and-drop zone + file picker, preview table, Confirm Import button
- Match history table: sortable by date, filterable by category/player, Edit + Delete buttons per row
- Export CSV button (all matches or filtered)
- Deletion triggers full rating recompute (no explicit recompute button needed — ratings computed on every page load)
- Edit: inline form replaces row; on save calls `Data.updateMatch()` and re-renders

---

### WP7 — leaderboard.html (Rankings)

**Files:** `leaderboard.html` (create)

**Content:**
- Category tabs: MD | WD | MS | WS
- Ranked table: Rank | Name | Rating | Trend | Match Count | Reliability
- Trend arrow: compare current rating vs rating from 30 days ago (run computeRatings with `asOf = now` and `asOf = now - 30d`, diff)
- Inactive players shown at bottom with greyed style
- Optional head-to-head matrix: show win/loss record between each pair of players in the selected category (O(n²) table — hide if > 10 players per category to avoid visual overload)

---

### WP8 — player.html (Player Profile)

**Files:** `player.html` (create)

**Content:**
- URL param: `?id=<playerId>`
- Header: player name, gender, joined date, active status
- Four rating cards: MD / WD / MS / WS — rating, reliability badge, W-L record
- Chart area: category selector (dropdown), canvas for rating progression (Chart.js line chart)
- Match history table: last 20 matches involving this player (date, category, opponent(s), score, result, delta)

---

### WP9 — settings.html (Members + Data)

**Files:** `settings.html` (create)

**Content:**
- Members table: Name | Gender | Joined | Active | Edit | Deactivate
- Add member form: name, gender (M/F), joined date (default today)
- Data Management section:
  - Export JSON button → `Data.exportJSON()` → download `acedupr-backup-YYYY-MM-DD.json`
  - Import JSON: file picker + Confirm button with warning "This will replace all data"
  - Reset all data: double-confirmation (type "RESET" to confirm) → `Data.clearAll()`

---

### WP10 — css/app.css (Tailwind Overrides)

**Files:** `css/app.css` (create)

**Content:**
- Gold/silver/bronze table row colour classes (not in Tailwind by default)
- Provisional rating `~` colour (amber)
- Inactive player row opacity
- Active nav link underline style
- Drag-and-drop zone hover/active state

---

## Execution Order

```
WP1 (data.js)
  └─→ WP2 (rating.js)          [depends on Match/Player types]
        └─→ WP3 (ui.js)        [depends on Data + computeRatings APIs]
              └─→ WP4 (charts.js) [depends on ui.js helper types]
                    ├─→ WP5 (index.html)
                    ├─→ WP6 (matches.html)
                    ├─→ WP7 (leaderboard.html)
                    ├─→ WP8 (player.html)
                    └─→ WP9 (settings.html)
WP10 (app.css) — independent, can be built any time
```

WP5–WP9 can be written in parallel; they only read from the JS modules, not each other.

---

## Complexity Impact

| WP | Files Created | Files Modified | New Concerns | LOC delta | O/C | Worsens Audit? |
|----|---------------|----------------|--------------|-----------|-----|----------------|
| WP1 | 1 (data.js) | 0 | 1 (storage) | +~120 | Pass | N/A (greenfield) |
| WP2 | 1 (rating.js) | 0 | 1 (algorithm) | +~100 | Pass | N/A |
| WP3 | 1 (ui.js) | 0 | 1 (presentation) | +~200 | Pass | N/A |
| WP4 | 1 (charts.js) | 0 | 1 (viz) | +~40 | Pass | N/A |
| WP5–9 | 5 (HTML) | 0 | 0 (markup only) | +~150 each | Pass | N/A |
| WP10 | 1 (app.css) | 0 | 0 | +~30 | Pass | N/A |

---

## Risk Register

| Risk | Severity | Prob | Mitigation | Detection |
|------|----------|------|------------|-----------|
| CDN unavailable offline | Medium | Low | Guard + banner per C10 | guardCDN() returns false → banner shown |
| localStorage full (5MB limit) | Low | Very low | exportJSON nudge in settings; ~10KB per 100 matches | Data.addMatch catches QuotaExceededError |
| Date.now() drift in replay | High | Medium | Explicit asOf param in all rating calls (C4) | AC6 grep check |
| K-factor implemented per-category | High | Medium | Patterns.md note + code comment; global count in state | AC7 grep check |
| Chart "already in use" error | Medium | High | charts.js destroys before recreating (C7) | AC9 grep; visual test |
| CSV name→id mapping failure on import | Medium | Medium | importCSV creates new players if name not found; warn user | Preview step shows unrecognised names in amber |
| Gender filter missing on player dropdowns | Low | Medium | initMatches filters player list by category gender | Manual test: select WD, only female players shown |

---

## Sample Data (for manual testing)

After first load, Settings > Add members: Alice (F), Bob (M), Carol (F), Dave (M).  
Then Matches > Add:  
- 2026-04-20, MD, club, Bob + Dave vs ??? (need 4 M players — add Ed, Frank)  
- 2026-04-20, WD, club, Alice + Carol vs ???  
Verify ratings shift from 3.500 per the step-by-step example in MY_DUPR.md.
