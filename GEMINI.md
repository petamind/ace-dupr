# ACE Pickleball (ace-dupr)

A greenfield, build-free static website for tracking a pickleball club's member performance using a DUPR-style rating system. Deployed to GitHub Pages with data persisted in browser `localStorage` or synchronized via Google Sheets.

## Project Overview

*   **Architecture:** Event-sourced / layered. Matches are an immutable append-only log. Per-category ratings (MD, WD, XD, MS, WS) are recomputed on demand by replaying the match log through a modified Elo algorithm.
*   **Tech Stack:** Vanilla JS (ES Modules), HTML5, CSS3.
*   **Styling:** Tailwind CSS (loaded via CDN).
*   **Charts:** Chart.js (loaded via CDN).
*   **Data Parsing:** PapaParse (loaded via CDN).
*   **Persistence:** `localStorage` (all writes via `js/data.js`).
*   **External Data:** Google Sheets integration for shared club data.

## Building and Running

This project has **no build step**. It runs directly in evergreen browsers.

*   **Development Server:** Run `python3 -m http.server 8080` and open `http://localhost:8080`.
*   **Update Data Manifest:** When adding new CSV files to `data/`, run:
    ```bash
    python3 update-manifest.py
    ```
*   **Testing:** Uses the native Node.js test runner.
    ```bash
    npm test
    ```
    (Runs `node --test tests/rating.test.js tests/data.test.js`)

## Development Conventions

### Data & Persistence
*   **Single Source of Truth:** `js/data.js` is the only file allowed to access `localStorage`. All other modules must use the `Data` API.
*   **Namespace:** All `localStorage` keys are prefixed with `acedupr:` (e.g., `acedupr:matches`).
*   **Immutable Log:** To correct a match, append a corrective entry or rebuild the log. Never mutate historical match records directly in storage.

### Rating Algorithm (`js/rating.js`)
*   **Pure Logic:** Rating calculations must be pure functions. No DOM access, no `localStorage`, and no `Date.now()`.
*   **Deterministic Replay:** Always pass an explicit `asOf` timestamp (JS milliseconds) to rating functions to ensure deterministic results.
*   **DUPR Constants:** All algorithm constants (Spread, K-factor, Half-life, Multipliers) are defined in a single named block. Do not use magic numbers in the logic.
*   **Algorithm Versioning:** The version is exported as `ALGORITHM_VERSION`.

### UI & Architecture
*   **Layered Design:** `ui.js` handles DOM and events; `data.js` handles storage; `rating.js` handles math; `charts.js` handles visualization.
*   **Chart Management:** Always call `chart.destroy()` before recreating a Chart.js instance to prevent memory leaks and rendering issues.
*   **CDN Scripts:** Third-party libraries are declared in HTML `<script>` tags only. Do not add local copies or use `npm install` for runtime dependencies.

## Key Files

*   `index.html`: Main dashboard with current ratings and top players.
*   `matches.html`: Match history and entry.
*   `leaderboard.html`: Rankings per category.
*   `player.html`: Individual player profiles and rating progression.
*   `settings.html`: Data management (Import/Export/Reset).
*   `js/data.js`: Persistence layer and CSV/JSON handlers.
*   `js/rating.js`: Core DUPR-style algorithm.
*   `js/ui.js`: DOM orchestration.
*   `js/charts.js`: Chart.js integration.
*   `apps-script/Code.gs`: Backend integration for Google Sheets.
