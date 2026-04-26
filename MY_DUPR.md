# MY_DUPR — Pickleball Club Rating Tracker

## Overview

A static website hosted on GitHub Pages that tracks pickleball club member performance using a DUPR-equivalent rating algorithm. No backend required — all data lives in the browser (localStorage) and can be exported/imported as JSON or CSV.

---

## Rating System — DUPR Approximation

DUPR uses a **modified Elo algorithm** with these core properties. Our implementation mirrors these as closely as possible.

Sources used:
- DUPR official blog & Zendesk FAQ
- ML reverse-engineering study (R²=0.86) of 6,844 player-match records by Jessica Wang
- 11pickles.com analysis of the July 2025 algorithm update

### Scale
- Ratings run from **2.000 to 8.000**, displayed to 3 decimal places.
- New/unrated players start at **3.500** (recreational beginner-intermediate).

### Four driving factors

#### 1. Expected Score (Elo-style)
For a match between Team A (average rating `rA`) and Team B (average rating `rB`):

```
E_A = 1 / (1 + 10^((rB - rA) / spread))
```

- `spread` ≈ **0.5** — calibrated so that a **0.1 rating gap ≈ 1.2 points** advantage in an 11-point game. (Standard chess Elo uses 400; DUPR's 2–8 scale compresses this dramatically. The ML reverse-engineering study confirmed a denominator ≈ 4× smaller than standard Elo relative to the scale range.)
- For singles, player ratings are used directly. For doubles, the average of the two partners is used.

#### 2. Score Differential (Actual vs Expected)
Instead of binary win/loss, performance is measured as the **actual score ratio** vs **expected score ratio**:

```
actual_ratio_A  = score_A / (score_A + score_B)
performance_gap = actual_ratio_A - E_A
```

Winning but below expected → smaller gain (or even slight loss). Losing but above expected → smaller loss (or even slight gain). This mirrors the post-July-2025 DUPR point-by-point model.

**Key asymmetry confirmed by ML study:**
- Underdog wins: rating goes up significantly (high surprise value).
- Favorite wins: rating barely moves, or even dips if the margin was narrower than expected.
- Higher-rated players (4.5+) face more aggressive deflation — wins are worth less than losses are expensive. The formula naturally produces this via the compressed expected-score curve; no extra rule needed.

#### 3. K-Factor (Reliability / Stability)
The K-factor scales how much a single match moves your rating. It shrinks as you accumulate results, making established ratings more stable:

```
K = K_max / (1 + n / K_scale)
```

| Variable   | Value | Meaning                                  |
|------------|-------|------------------------------------------|
| `K_max`    | 0.40  | Max shift per match (new players)        |
| `K_scale`  | 20    | Matches needed to halve K                |
| `n`        | —     | Number of rated matches played           |

Minimum K floor: **0.05** (never fully rigid).

#### 4. Recency Weight (Exponential Decay)
Recent matches count more. We use a half-life of **180 days**:

```
recency_weight = 0.5^(days_since_match / 180)
```

Matches older than ~1 year retain ≈ 12.5% of their original influence.

### Match Type Weight
| Match type       | Weight multiplier |
|------------------|-------------------|
| Tournament       | 1.5               |
| Club (weekly)    | 1.0               |
| Recreational     | 0.5               |

Our weekly sessions count as **Club** matches.

### Rating Update Formula (per player per match)
```
delta = K * performance_gap * recency_weight * match_type_weight
new_rating = old_rating + delta
```

For doubles, each partner gets the same `delta` (based on team average vs opponent team average).

### Reliability / Activity Requirement
Borrowed from DUPR's activity thresholds:
- A player's rating is **provisional** until they have 3+ results in the last 90 days.
- Provisional ratings are displayed with a `~` prefix.
- Players with no results in 270 days are marked **inactive**.

### Separate Rating Pools
Ratings are tracked **independently** per category:
- Men's Doubles (MD)
- Women's Doubles (WD)
- Men's Singles (MS)
- Women's Singles (WS)

A player can have up to 4 separate ratings.

---

## Data Model

### Members table
```
id, name, gender, email (optional), joined_date, active
```

### Matches table
```
id, date, category (MD|WD|MS|WS), match_type (tournament|club|recreational),
team_a_player1, team_a_player2 (null for singles),
team_b_player1, team_b_player2 (null for singles),
score_a, score_b,
notes (optional)
```

### Ratings table (computed, not stored — recalculated on demand)
```
player_id, category, rating, provisional, last_match_date, match_count
```

### Rating history (computed)
```
player_id, category, date, rating_after_match
```
This is what drives the rating progression graph.

---

## CSV Import Format

One file per session (or multiple matches can be in one file). Date column is mandatory.

```csv
date,category,match_type,team_a_p1,team_a_p2,team_b_p1,team_b_p2,score_a,score_b
2026-04-20,MD,club,Alice,Bob,Charlie,Dave,11,7
2026-04-20,WS,club,Alice,,Charlie,,11,9
```

- For singles: `team_a_p2` and `team_b_p2` are left blank.
- `date`: ISO format `YYYY-MM-DD`.
- `category`: `MD`, `WD`, `MS`, `WS`.
- `match_type`: `tournament`, `club`, `recreational`.

---

## Pages / Views

### 1. Dashboard (home)
- Current ratings table for all members, sortable by category.
- Highlight top 3 per category.
- "Reliability" badge: Full / Provisional / Inactive.
- Quick-add match button.

### 2. Match Entry
- Two tabs: **Manual Entry** and **CSV Upload**.
- Manual form: date picker, category selector, player dropdowns (filtered by gender for WD/WS), score inputs.
- CSV upload: drag-and-drop or file picker, preview table before confirming.
- Validation: duplicate match detection, score sanity check.

### 3. Player Profile
- Name, all 4 category ratings, reliability badge.
- Win/loss record per category.
- Rating progression chart (line chart, Chart.js) per category, date on x-axis.
- Match history table (last 20 matches).

### 4. Leaderboard
- Tabs per category: MD / WD / MS / WS.
- Ranked table with rating, trend arrow (↑ / ↓ / —), match count.
- Optional: head-to-head win rate matrix.

### 5. Match History
- Full list of all recorded matches, filterable by date range, category, player.
- Edit / delete individual matches (with rating recalculation on save).
- Export to CSV button.

### 6. Settings / Members
- Add / edit / deactivate members.
- Export all data as JSON (for backup).
- Import data from JSON backup.
- Reset all ratings button (protected by confirmation).

---

## Technical Stack

| Concern            | Choice                     | Reason                                        |
|--------------------|----------------------------|-----------------------------------------------|
| Hosting            | GitHub Pages               | Free, zero backend, static                    |
| Framework          | Vanilla JS + HTML/CSS      | No build step, no dependencies to maintain    |
| Charts             | Chart.js (CDN)             | Lightweight, good line charts                 |
| Styling            | Tailwind CSS (CDN)         | Fast to write, responsive out of the box      |
| Data persistence   | localStorage + JSON export | No backend; exportable for backup             |
| CSV parsing        | PapaParse (CDN)            | Handles edge cases cleanly                    |

Everything loads from CDN — no `npm install`, no build pipeline. Works offline after first load.

---

## File Structure

```
ace_dupr/
├── index.html          # Dashboard
├── matches.html        # Match entry + history
├── leaderboard.html    # Rankings per category
├── player.html         # Player profile (query param: ?id=xxx)
├── settings.html       # Members + data management
├── js/
│   ├── data.js         # LocalStorage CRUD, import/export
│   ├── rating.js       # DUPR algorithm implementation
│   ├── charts.js       # Chart.js wrappers
│   └── ui.js           # Shared UI helpers
├── css/
│   └── app.css         # Any overrides on top of Tailwind
└── README.md
```

---

## Rating Calculation — Step-by-Step Example

> Alice (3.800) + Bob (3.600) vs Charlie (3.500) + Dave (3.400) in a Club MD match, score 11–7.

1. **Team averages**: rA = 3.700, rB = 3.450
2. **Expected ratio for A**: E_A = 1 / (1 + 10^((3.450 - 3.700)/0.5)) = 1 / (1 + 10^(-0.5)) ≈ 0.760
3. **Actual ratio for A**: S_A = 11/18 ≈ 0.611
4. **Performance gap**: 0.611 − 0.760 = **−0.149** (A underperformed vs expectation — they were heavy favorites and only won 11–7)
5. **K-factor** (say Alice has 15 matches): K = 0.40 / (1 + 15/20) = 0.40 / 1.75 ≈ **0.229**
6. **Recency weight** (match today): 1.000
7. **Match type**: Club → 1.0
8. **Delta**: 0.229 × (−0.149) × 1.0 × 1.0 ≈ **−0.034**
9. Alice: 3.800 − 0.034 → **3.766**. Charlie (underdog who held it close): 3.500 + 0.034 → **3.534**.

This reflects the "aggressive deflation for favorites" behavior the ML study identified — the heavy favorite (Team A) loses rating even in victory because the margin was narrower than the algorithm expected.

---

## Key Design Decisions & Open Questions

| # | Question | Proposed default | Notes |
|---|----------|-----------------|-------|
| 1 | Starting rating for new members? | 3.500 | Can be manually overridden on first entry |
| 2 | Should doubles and singles ratings be linked? | No — fully independent | Matches DUPR behavior |
| 3 | Include games-to-15 and tiebreaker sets? | Not initially — assume 11-point games only | Can extend later |
| 4 | Who can edit/delete matches? | Anyone (no auth) | Club is small, trust-based |
| 5 | Recalculate all ratings on every edit? | Yes — full replay from history | Ensures consistency; fine for ≤20 players |
| 6 | Show rating history chart by default or on demand? | On demand (click player name) | Keeps dashboard clean |
| 7 | How to handle a player appearing in both gender categories? | Allow it — just check gender field | Edge case for mixed-gender clubs |

---

## Out of Scope (v1)

- User authentication / access control
- Mobile app
- Real-time multiplayer / sync
- Email notifications
- Tournament bracket management
- Mixed doubles category
