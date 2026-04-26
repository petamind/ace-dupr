# Architecture Detail

*Loaded on demand when a task touches architecture, layers, or data model. Not hot context.*

## Stack
Pure static site — vanilla JS + HTML + CSS. No build pipeline, no package manager, no transpiler.
CDN-only third-party scripts: Chart.js (charts), Tailwind CSS (styling), PapaParse (CSV parsing).
Deployment: GitHub Pages. Every committed file is potentially live.

## Planned Pages
| File | Purpose |
|------|---------|
| `index.html` | Dashboard — current ratings, top 3 per category, quick-add button |
| `matches.html` | Match entry (manual form + CSV upload) and match history |
| `leaderboard.html` | Rankings per category (MD/WD/MS/WS) with trend arrows |
| `player.html` | Player profile — all ratings, win/loss record, rating progression chart |
| `settings.html` | Member management, JSON backup/restore, data reset |

## Planned JS Modules
| File | Responsibility |
|------|---------------|
| `js/data.js` | All localStorage reads/writes, JSON import/export, CSV import/export via PapaParse |
| `js/rating.js` | DUPR algorithm: expected score, K-factor, recency weight, per-category rating replay |
| `js/charts.js` | Chart.js wrapper — create, update, and destroy rating progression line charts |
| `js/ui.js` | DOM rendering, event handlers, page routing helpers |
| `css/app.css` | Overrides on top of Tailwind CDN |

## Data Model (localStorage)
All keys namespaced with `acedupr:` prefix.

**`acedupr:players`** — array of:
```
{ id, name, gender, joinedDate, active }
```

**`acedupr:matches`** — append-only array of:
```
{ id, date, category (MD|WD|MS|WS), matchType (tournament|club|recreational),
  teamA: [p1Id, p2Id?], teamB: [p1Id, p2Id?], scoreA, scoreB, notes? }
```

**Derived (never stored):**
- Player ratings per category — computed by `rating.js` replaying match log
- Rating history snapshots — produced during replay for chart rendering
- Provisional/inactive badges — derived from match counts and last-played date

## DUPR Algorithm Shape (js/rating.js)
Named constants block:
```
SPREAD = 0.5          // calibrated: 0.1 rating gap ≈ 1.2 pts in 11-pt game
K_MAX  = 0.40         // max per-match shift (new players)
K_SCALE = 20          // matches to halve K
K_MIN  = 0.05         // floor — never fully rigid
HALF_LIFE_DAYS = 180  // recency decay half-life
INITIAL_RATING = 3.500
RATING_MIN = 2.000
RATING_MAX = 8.000
```

Match type multipliers:
```
tournament   → 1.5
club         → 1.0
recreational → 0.5
```

Replay is a pure function: `computeRatings(matches, { asOf, category })` — no side effects, no DOM, no Date.now().

## Layer Boundaries
- HTML files contain markup and minimal bootstrap only (no business logic).
- `ui.js` calls into `data.js` and `rating.js`; never writes to localStorage directly.
- `rating.js` is pure — takes data, returns results; no imports from `ui.js`, `charts.js`, or DOM.
- `charts.js` only imports from `rating.js` output (data already computed); no storage access.
- `data.js` is the single storage gateway; all other modules receive data as function arguments.
