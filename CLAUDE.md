# ace-dupr

## Project
`ace-dupr` is a greenfield, build-free static website for tracking a pickleball club's member performance using a DUPR-style rating system, deployed to GitHub Pages with all data persisted in browser localStorage. The architecture is event-sourced: matches are an immutable append-only log, and per-category ratings (MD/WD/MS/WS) are recomputed on demand via a modified Elo algorithm. The codebase is vanilla JS + HTML + CSS only, with Chart.js, Tailwind, and PapaParse loaded from CDNs — no package manager, bundler, linter, or test runner.

## Stack
- Platform: static-html (vanilla JS + HTML/CSS, no build step)
- Language: ES modules, evergreen browsers
- Frameworks: Chart.js (charts), Tailwind CSS (styling), PapaParse (CSV) — all CDN
- Build: none — open `index.html` directly in browser

## Architecture
- Pattern: event-sourced / layered (matches log → derived ratings)
- DI: none
- Data: localStorage + JSON export/import (all writes via `js/data.js`)
- Network: none — static GitHub Pages site
- State: vanilla JS (match log is single source of truth)
- Layers: `js/data.js` (storage), `js/rating.js` (algorithm), `js/charts.js` (viz), `js/ui.js` (DOM)

*Details and planned file structure: `.claude/context/architecture.md`*

## Hard Rules
- Run /engineering-planning before any non-trivial task (>2 files, new feature, or cross-module change).
- Run /complexity-audit before major refactors and quarterly.
- All rating math lives in `js/rating.js` — no Elo logic in UI files, charts, or HTML.
- Persistence only through `js/data.js` — no `localStorage.*` calls anywhere else.
- Ratings are never persisted — always recomputed via full replay of the immutable match log.
- No network calls — static site; CDN scripts declared in HTML `<script>` tags only.
- No build step — files must run directly from `index.html` in a browser.
- DUPR constants (spread, K-factor schedule, half-life, multipliers) in one named block in `js/rating.js` — never magic numbers.
- Use vanilla JS only — no frameworks, no bundler; `<script type="module">` ES modules acceptable.
- CSV import/export via PapaParse only — no hand-rolled CSV parsers.

## Gotchas
- Mutating a stored match record → append a corrective match or rebuild the log (event-sourced invariant).
- `localStorage.*` outside `data.js` → route through `Data.*` API.
- `Date.now()` inside rating function → pass explicit `asOf` timestamp for deterministic replay.
- K-factor decay keyed off global match count → use per-category match count per player.
- localStorage keys without namespace → prefix all keys with `acedupr:` (e.g. `acedupr:matches`).
- Re-rendering Chart.js without cleanup → call `chart.destroy()` before recreating any chart instance.
- Recency weight applied match-vs-match → apply 180-day half-life relative to `asOf` query time.

*Full explanations: `.claude/context/patterns.md`*
*Latest audit findings: `.claude/audits/` (most recent file)*

## Quick Reference
- Build: N/A — open `index.html` directly
- Test:  N/A — no test framework (manual browser testing)
- Lint:  N/A — no linter configured
- Dev:   `python3 -m http.server 8080` then open `http://localhost:8080`
