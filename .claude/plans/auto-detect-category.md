# Plan: Auto-Detect Category in Enter Result Form (T-00A27133)

## Constraints This Spec Must Respect

- `_autoCategory(teamAIds, teamBIds, players)` exists at `js/ui.js:868` — returns `'MD'|'WD'|'XD'|'MS'|'WS'|'UN'`. Do not touch its logic.
- `_updateAutoCategoryPill(players)` exists at `js/ui.js:944` — already updates `#auto-category-value` span; currently guards on `#auto-category-wrap.hidden`.
- `_genderForCategory(cat)` at `js/ui.js:856` — still referenced by `_showEditModal` at line 1302; do NOT delete it.
- Match record schema: `{ category: 'MD'|'WD'|'XD'|'MS'|'WS'|'UN', matchType: 'club'|'recreational'|'tournament'|'unrated', ... }` — `category` must never be `'UN'` in stored records.
- `localStorage` writes only via `Data.*` in `js/data.js` — no direct calls from `ui.js`.
- No build step — edits must be valid ES module JS.

---

## Objective

Replace the manual Category `<select>` in the Enter Result form with an always-visible auto-detect pill. Move Match Type to field position 2. All match types (club, recreational, tournament, unrated) use the same auto-detect logic. Submission is blocked when gender composition is ambiguous (`'UN'`).

---

## Acceptance Criteria

| AC | Description | Verify | Expected |
|----|-------------|--------|----------|
| AC1 | Match Type is field 2 | Inspect DOM: `#match-type` appears before player selects | Position confirmed |
| AC2 | No manual category select | `document.getElementById('match-category')` | `null` |
| AC3 | Auto-category pill always visible | `#auto-category-wrap.classList.contains('hidden')` on page load | `false` |
| AC4 | Selecting 2M+2M shows MD | Select 4 male players → check `#auto-category-value.textContent` | `'MD'` |
| AC5 | Selecting 2F+2F shows WD | Select 4 female players | `'WD'` |
| AC6 | Selecting M+F per team shows XD | Select M,F vs F,M | `'XD'` |
| AC7 | Singles M vs M shows MS | Select 1 male per team, leave A2/B2 blank | `'MS'` |
| AC8 | Singles F vs F shows WS | Select 1 female per team | `'WS'` |
| AC9 | UN blocks submission | Mixed singles: alert shown, match NOT saved | Alert fired, no new match in localStorage |
| AC10 | Category stored in match record | After submit → `Data.loadMatches().slice(-1)[0].category` | One of `MD|WD|XD|MS|WS` |

---

## Technical Design

### Current flow
1. `_updatePlayerDropdowns` branches on `isUnrated`:
   - `isUnrated=true`: show `#auto-category-wrap`, hide `#manual-category-wrap`, no gender filter
   - `isUnrated=false`: hide `#auto-category-wrap`, show `#manual-category-wrap`, filter players by category gender
2. `_updateAutoCategoryPill` no-ops when `#auto-category-wrap` has class `hidden`
3. On submit: unrated → `_autoCategory()`; rated → read `#match-category.value`

### New flow
1. `#manual-category-wrap` removed from HTML entirely; `#match-type` moved to position 2 (after Date)
2. `#auto-category-wrap` is always visible (no `hidden` class, no JS toggle)
3. `_updatePlayerDropdowns` simplified: always show all 4 player slots, no gender filter, always call `_updateAutoCategoryPill`
4. `_updateAutoCategoryPill` guard simplified: remove `hidden`-class check
5. On submit: always use `_autoCategory()` for `cat`; if `cat === 'UN'` → alert + early return

---

## Work Packages

### WP1 — matches.html: restructure form fields

**File:** `/Users/tung.nguyen/ace_dupr/matches.html`

**Change A:** Replace Date + Manual Category + Auto Category block with Date + Match Type + Auto Category (no hidden).

Old (lines 94–114):
```html
        <div>
          <label class="label font-bold" for="match-date">Date</label>
          <input type="date" id="match-date" class="input" required>
        </div>
        <div id="manual-category-wrap">
          <label class="label font-bold" for="match-category">Category</label>
          <select id="match-category" class="input">
            <option value="MD">MD — Men's Doubles</option>
            <option value="WD">WD — Women's Doubles</option>
            <option value="XD">XD — Mixed Doubles</option>
            <option value="MS">MS — Men's Singles</option>
            <option value="WS">WS — Women's Singles</option>
          </select>
        </div>
        <div id="auto-category-wrap" class="hidden">
          <label class="label font-bold">Category</label>
          <div class="input bg-gray-50 text-gray-600 flex items-center gap-2">
            <span class="text-xs uppercase tracking-wide text-gray-400">Auto</span>
            <span id="auto-category-value" class="font-mono">—</span>
          </div>
        </div>
```

New:
```html
        <div>
          <label class="label font-bold" for="match-date">Date</label>
          <input type="date" id="match-date" class="input" required>
        </div>
        <div>
          <label class="label font-bold" for="match-type">Match Type</label>
          <select id="match-type" class="input">
            <option value="club">Club</option>
            <option value="recreational">Recreational</option>
            <option value="tournament">Tournament</option>
            <option value="unrated">Unrated</option>
          </select>
        </div>
        <div id="auto-category-wrap">
          <label class="label font-bold">Category</label>
          <div class="input bg-gray-50 text-gray-600 flex items-center gap-2">
            <span class="text-xs uppercase tracking-wide text-gray-400">Auto</span>
            <span id="auto-category-value" class="font-mono">—</span>
          </div>
        </div>
```

**Change B:** Remove old match-type div (lines 149–157 in original numbering).

Old:
```html
        <div>
          <label class="label font-bold" for="match-type">Match Type</label>
          <select id="match-type" class="input">
            <option value="club">Club</option>
            <option value="recreational">Recreational</option>
            <option value="tournament">Tournament</option>
            <option value="unrated">Unrated</option>
          </select>
        </div>
```

New: *(deleted entirely)*

---

### WP2 — js/ui.js: remove catSelect listener from `_populateMatchForm`

**File:** `/Users/tung.nguyen/ace_dupr/js/ui.js`, lines 912–918

Old:
```javascript
  const catSelect = document.getElementById('match-category');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      _updatePlayerDropdowns(players);
      _validatePlayerSelects();
    });
  }
  const typeSelect = document.getElementById('match-type');
```

New:
```javascript
  const typeSelect = document.getElementById('match-type');
```

---

### WP3 — js/ui.js: remove hidden-guard from `_updateAutoCategoryPill`

**File:** `/Users/tung.nguyen/ace_dupr/js/ui.js`, line 947

Old:
```javascript
  if (!wrap || !valEl || wrap.classList.contains('hidden')) return;
```

New:
```javascript
  if (!wrap || !valEl) return;
```

---

### WP4 — js/ui.js: simplify `_updatePlayerDropdowns`

**File:** `/Users/tung.nguyen/ace_dupr/js/ui.js`, lines 967–1032

Old (lines 967–1032):
```javascript
  const matchType = document.getElementById('match-type')?.value ?? 'club';
  const isUnrated = matchType === 'unrated';

  const manualWrap = document.getElementById('manual-category-wrap');
  const autoWrap   = document.getElementById('auto-category-wrap');
  if (manualWrap) manualWrap.classList.toggle('hidden', isUnrated);
  if (autoWrap)   autoWrap.classList.toggle('hidden', !isUnrated);

  if (isUnrated) {
    // Both partner slots always visible — singles is expressed by leaving them blank.
    document.querySelectorAll('.partner-field').forEach(el => el.classList.remove('hidden'));
    ['a', 'b'].forEach(team => {
      const l1 = document.getElementById(`label-${team}1`);
      const l2 = document.getElementById(`label-${team}2`);
      if (l1) l1.textContent = 'Player 1';
      if (l2) l2.textContent = 'Player 2 (optional)';
    });
    slotIds.forEach(key => {
      const sel = document.getElementById(`player-${key}`);
      if (sel) sel.innerHTML = _playerOptions(players, null);
    });
  } else {
    const cat = document.getElementById('match-category')?.value ?? 'MD';
    const doubles = _isDoubles(cat);
    const isXD = cat === 'XD';

    document.querySelectorAll('.partner-field').forEach(el =>
      el.classList.toggle('hidden', !doubles));

    // For XD: P1 slot = male, P2 slot = female — enforced by construction
    ['a', 'b'].forEach(team => {
      const l1 = document.getElementById(`label-${team}1`);
      const l2 = document.getElementById(`label-${team}2`);
      if (l1) l1.textContent = isXD ? 'Male player' : 'Player 1';
      if (l2) l2.textContent = isXD ? 'Female player' : 'Player 2';
    });

    if (isXD) {
      ['a1', 'b1'].forEach(key => {
        const sel = document.getElementById(`player-${key}`);
        if (sel) sel.innerHTML = _playerOptions(players, 'M');
      });
      ['a2', 'b2'].forEach(key => {
        const sel = document.getElementById(`player-${key}`);
        if (sel) sel.innerHTML = _playerOptions(players, 'F');
      });
    } else {
      const gender = _genderForCategory(cat);
      slotIds.forEach(key => {
        const sel = document.getElementById(`player-${key}`);
        if (sel) sel.innerHTML = _playerOptions(players, gender);
      });
    }
  }

  // Restore previous selections where the player is still a valid option
  // under the new filter; otherwise leave the slot empty.
  for (const k of slotIds) {
    const sel = document.getElementById(`player-${k}`);
    if (!sel || !previous[k]) continue;
    if ([...sel.options].some(o => o.value === previous[k])) {
      sel.value = previous[k];
    }
  }

  if (isUnrated) _updateAutoCategoryPill(players);
```

New:
```javascript
  // All partner slots always visible — singles expressed by leaving A2/B2 blank.
  document.querySelectorAll('.partner-field').forEach(el => el.classList.remove('hidden'));
  ['a', 'b'].forEach(team => {
    const l1 = document.getElementById(`label-${team}1`);
    const l2 = document.getElementById(`label-${team}2`);
    if (l1) l1.textContent = 'Player 1';
    if (l2) l2.textContent = 'Player 2 (optional)';
  });
  slotIds.forEach(key => {
    const sel = document.getElementById(`player-${key}`);
    if (sel) sel.innerHTML = _playerOptions(players, null);
  });

  // Restore previous selections.
  for (const k of slotIds) {
    const sel = document.getElementById(`player-${k}`);
    if (!sel || !previous[k]) continue;
    if ([...sel.options].some(o => o.value === previous[k])) {
      sel.value = previous[k];
    }
  }

  _updateAutoCategoryPill(players);
```

---

### WP5 — js/ui.js: unify submit category logic in `_wireMatchForm`

**File:** `/Users/tung.nguyen/ace_dupr/js/ui.js`, lines 1044–1078

Old:
```javascript
    const matchType = document.getElementById('match-type').value;
    const isUnrated = matchType === 'unrated';
    const a1 = document.getElementById('player-a1').value;
    const b1 = document.getElementById('player-b1').value;
    const scoreA = parseInt(document.getElementById('score-a').value, 10);
    const scoreB = parseInt(document.getElementById('score-b').value, 10);
    const date = document.getElementById('match-date').value;
    const notes = document.getElementById('match-notes').value.trim();

    let teamAIds, teamBIds, cat;
    if (isUnrated) {
      const a2 = document.getElementById('player-a2').value || null;
      const b2 = document.getElementById('player-b2').value || null;
      if (!a1 || !b1) { alert('Please select at least one player per team.'); submitBtn.disabled = false; return; }
      teamAIds = a2 ? [a1, a2] : [a1];
      teamBIds = b2 ? [b1, b2] : [b1];
      if (teamAIds.length !== teamBIds.length) {
        alert('Both teams must have the same number of players.');
        submitBtn.disabled = false;
        return;
      }
      cat = _autoCategory(teamAIds, teamBIds, players);
    } else {
      cat = document.getElementById('match-category').value;
      const doubles = _isDoubles(cat);
      const a2 = doubles ? document.getElementById('player-a2').value : null;
      const b2 = doubles ? document.getElementById('player-b2').value : null;
      if (!a1 || !b1 || (doubles && (!a2 || !b2))) {
        alert('Please select all players.');
        submitBtn.disabled = false;
        return;
      }
      teamAIds = doubles ? [a1, a2] : [a1];
      teamBIds = doubles ? [b1, b2] : [b1];
    }
```

New:
```javascript
    const matchType = document.getElementById('match-type').value;
    const a1 = document.getElementById('player-a1').value;
    const a2 = document.getElementById('player-a2').value || null;
    const b1 = document.getElementById('player-b1').value;
    const b2 = document.getElementById('player-b2').value || null;
    const scoreA = parseInt(document.getElementById('score-a').value, 10);
    const scoreB = parseInt(document.getElementById('score-b').value, 10);
    const date = document.getElementById('match-date').value;
    const notes = document.getElementById('match-notes').value.trim();

    if (!a1 || !b1) { alert('Please select at least one player per team.'); submitBtn.disabled = false; return; }
    const teamAIds = a2 ? [a1, a2] : [a1];
    const teamBIds = b2 ? [b1, b2] : [b1];
    if (teamAIds.length !== teamBIds.length) {
      alert('Both teams must have the same number of players.');
      submitBtn.disabled = false;
      return;
    }
    const cat = _autoCategory(teamAIds, teamBIds, players);
    if (cat === 'UN') {
      alert('Cannot determine category: ensure both teams have matching gender combinations (MD, WD, XD, MS, or WS).');
      submitBtn.disabled = false;
      return;
    }
```

---

## Execution Order

1. WP1 (matches.html) — HTML restructure; no JS dependency
2. WP2–WP5 (js/ui.js) — JS changes; WP4 depends on WP2 (catSelect listener removed before dropdown logic); WP5 is independent

WP2, WP3, WP4, WP5 can be applied sequentially in a single file pass.

---

## Complexity Impact

| Field | Value |
|-------|-------|
| New files created | 0 |
| Existing files modified | 2 (matches.html, js/ui.js) |
| New concerns introduced | 0 |
| LOC delta | matches.html: -10 / js/ui.js: -45 (net reduction) |
| Open/Closed impact | Passing — no `if type ==` branches added; existing branch removed |
| Worsens any audit finding | No |

---

## Risk Register

| Risk | Severity | Probability | Mitigation | Detection |
|------|----------|-------------|------------|-----------|
| `_genderForCategory` still referenced in edit modal at ui.js:1302 — must NOT be deleted | High | Low (we know it's used) | Only modify `_updatePlayerDropdowns`; leave `_genderForCategory` intact | Grep for `_genderForCategory` after changes |
| Partner slots always visible: user could accidentally select A2 but not B2, triggering team-size mismatch | Medium | Medium | Alert message "Both teams must have the same number of players" already handles this | Manual test |
| `#auto-category-value` shows `—` on page load until players selected | Low | Certain | By design — acceptable UX, same as existing unrated behavior | Visual check |
