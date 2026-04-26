# Project Patterns and Gotchas

*Loaded by /engineering-planning when planning tasks that may intersect with these patterns.*

## Event-Sourced Match Log

**Trap:** Editing a stored match record in-place to fix a score or player.
**Why it happens:** Feels natural — just update the record. But ratings are a pure function of the full log; mutating a past record produces inconsistent history and breaks chart replay.
**Correct pattern:** Append a corrective entry (if the system supports corrections) or rebuild the log from exported CSV. Never mutate `acedupr:matches` in place.
**Evidence:** Architecture note: matches are append-only; `computeRatings` replays from index 0.

## Single Storage Gateway (data.js)

**Trap:** Calling `localStorage.setItem('acedupr:matches', ...)` directly from `ui.js`, an HTML `<script>`, or `rating.js`.
**Why it happens:** localStorage is a global — easy to call anywhere. But direct calls scatter the storage schema and make future migrations (e.g., IndexedDB, remote sync) require grep-and-pray.
**Correct pattern:** Always call `Data.saveMatches(...)`, `Data.loadMatches()`, etc. `data.js` is the only file that knows about localStorage keys.
**Evidence:** Architecture layer boundary: `ui.js` calls `data.js`; `rating.js` receives data as arguments.

## Deterministic Rating Replay (asOf timestamp)

**Trap:** Calling `Date.now()` or `new Date()` inside `rating.js` to calculate recency weights.
**Why it happens:** Convenient shortcut. But it makes `computeRatings` non-deterministic: running it twice returns different results, and historical chart points can't be reconstructed.
**Correct pattern:** Pass `asOf` (a timestamp) as an explicit parameter. The caller (usually `ui.js`) provides `Date.now()` for live views and a historical date for chart data points.
**Evidence:** Algorithm shape in architecture.md: `computeRatings(matches, { asOf, category })`.

## K-Factor Decay — Global Match Count (Intentional Decision)

**Trap:** Implementing per-category K-factor decay (K shrinks only within each category's match count).
**Why it's wrong for this club:** Casual players dominate one category and play others rarely. Per-category keeps K high in rarely-played categories → one bad singles day swings rating ±0.15 → feels unfair, discourages trying new categories.
**Correct pattern:** Use **global match count** (all categories combined) for K decay. A player with 40 MD matches gets a moderately stable K in MS too, even if they only have 5 MS matches.
**Revisit when:** The club grows competitive enough that singles and doubles specialists emerge and cross-category stability starts masking real skill differences.
**Evidence:** MY_DUPR.md K-factor design decision note; decision made 2026-04-26.

## localStorage Key Namespacing

**Trap:** Using bare keys like `localStorage.setItem('matches', ...)`.
**Why it happens:** Simpler to type. But GitHub Pages serves all repos under the same `*.github.io` origin — bare keys collide across projects.
**Correct pattern:** Prefix every key with `acedupr:` — e.g., `acedupr:matches`, `acedupr:players`, `acedupr:schemaVersion`.
**Evidence:** Architecture.md data model section.

## Chart.js Instance Lifecycle

**Trap:** Calling `new Chart(ctx, config)` on a canvas that already has a Chart.js instance attached.
**Why it happens:** Navigating back to a page or toggling a category rerenders without cleanup, producing a "Canvas is already in use" error and ghost charts.
**Correct pattern:** Store each Chart instance. Before creating a new one on the same canvas, call `existingChart.destroy()`. In `charts.js`, maintain a module-level map of `canvasId → Chart instance`.
**Evidence:** Chart.js docs; common source of visual bugs in SPAs that reuse canvas elements.

## Recency Weight Application

**Trap:** Computing recency weight as `0.5^(daysBetweenMatches / 180)` — a match-vs-match delta.
**Why it happens:** Misreading the half-life formula as a pairwise decay.
**Correct pattern:** Weight each match relative to the `asOf` query time: `weight = 0.5^((asOf - matchDate) / 180_days)`. This way, last week's match always outweighs last year's match regardless of when other matches occurred.
**Evidence:** MY_DUPR.md algorithm section: "Recency weight = 0.5^(days_since_match / 180)".

## CDN Dependency Availability

**Trap:** Accessing `window.Chart`, `window.Papa`, or Tailwind classes immediately on script execution without guarding.
**Why it happens:** Scripts load fine in normal conditions; the failure only surfaces offline or with CDN throttling.
**Correct pattern:** Check `typeof Chart !== 'undefined'` before using Chart.js. In `ui.js` bootstrap, surface a friendly "App requires internet to load dependencies" banner if CDN scripts failed.
**Evidence:** Architecture: all third-party deps loaded from CDN; no local fallback.

## Floating-Point Rating Precision

**Trap:** Rounding ratings to 3 decimal places inside the rating engine and storing the rounded value.
**Why it happens:** DUPR displays 3 decimals so it seems natural to store that precision.
**Correct pattern:** Keep full IEEE 754 precision in storage and computation; round only at the render boundary (e.g., `rating.toFixed(3)` in `ui.js`). Rounding intermediate values compounds error over many matches.
**Evidence:** MY_DUPR.md: "Ratings run from 2.000 to 8.000, displayed to 3 decimal places."
