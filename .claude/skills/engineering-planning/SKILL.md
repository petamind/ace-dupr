---
name: engineering-planning
description: >
  Planning-first for any non-trivial task. Produces a spec with falsifiable ACs and
  file:line work packages. Trigger: /engineering-planning, "plan", "implement",
  "build", "add", "refactor", "spec", "design", "I need to", "create"
---

# engineering-planning

## Complexity Gate — Run This First

Before starting the full planning process, score the task against these signals.
Two or more signals tripped = full planning process required.

| # | Signal | Threshold | Why it matters |
|---|--------|-----------|----------------|
| 1 | Files touched | > 2 | Cross-file changes need coordination |
| 2 | Files created | ≥ 1 | New abstractions affect the concept count of the system |
| 3 | New feature or endpoint | any | New capability — existing patterns may not fit |
| 4 | Schema / data model change | any | Irreversible; downstream consumers must be traced |
| 5 | Public API / interface change | any | Liskov and Open/Closed exposure |
| 6 | Cross-module refactor | any | Hickey: risks complecting if done ad-hoc |
| 7 | Touches a file > 200 LOC | any | Metz violation likely already present — don't deepen it |
| 8 | Touches orchestrator or entry point | any | Fan-out impact on the whole system |

**Decision:**
- **0–1 signals tripped** → Fast path. Create a short plan (title + 3–5 checkboxes),
  confirm with user, proceed. Do not run the wave investigation for a typo or config tweak.
- **2+ signals tripped** → Full planning process below.
- **3+ signals tripped, or touching a complected area** → Recommend running
  `/complexity-audit` on the affected subsystem before planning. Findings shape the plan.

---

You are a **technical planner**. Your job is to investigate the codebase, synthesize
findings, and produce a spec that a builder can execute without re-exploring the code.

**Output:** A plan file saved to `.claude/plans/[feature].md`.
**Constraint:** Every claim in the spec must be grounded in code you actually read.
No assumptions. No "probably". No "should work".

---

## Core Principles

**Constraint-forward, not design-forward.**
Inventory constraints before designing: read actual models, enums, schemas, configs.
Design within what exists — do not assume you can change things freely.

**Grounded in code.**
Every file path, function name, column, and type in the spec must exist right now.
Paste-ready signatures only — no pseudocode.

**Falsifiable acceptance criteria.**
If you cannot write a command that checks it, it is not an AC.
Every AC needs: verify command, expected output, tolerance, automated flag.

**No deferral.**
Fix it or escalate. "Known issue" is not a category. Every finding is resolved this cycle.

**Always plan first — but proportionally.**
Every task gets a plan file before edits begin. The Complexity Gate above decides
whether that plan is a short checklist (simple task) or the full wave investigation
(non-trivial task). Never edit source without a plan file of some kind.

**Delete, don't deprecate.**
When replacing code, delete the old code entirely. No wrappers, no fallback paths,
no `# deprecated` comments. Verification should confirm absence of the deleted code.

**Builder independence.**
Each work package contains exact files, file:line current code, new code to write,
and AC specific to that WP. A builder should execute, not explore.

---

## Planning Process

### Step 0: Pull Project Context

Before investigation, read these on-demand context files if they exist:

```bash
[ -f ".claude/context/patterns.md" ] && cat .claude/context/patterns.md
[ -f ".claude/context/architecture.md" ] && cat .claude/context/architecture.md
```

### Step 1: Check for an Existing Plan and the Latest Audit

```bash
ls -lt .claude/plans/ 2>/dev/null | head -10
ls -lt .claude/audits/ 2>/dev/null | head -3
```

**If a plan exists for this task:** read it and use it — do not rewrite. Go to review.

**Always read the latest audit file if one exists.** P0 and P1 findings covering files
you will touch become entries in the plan's `Constraints This Spec Must Respect` section.

### Step 2: Wave 1 — Reconnaissance

Dispatch 3–5 scouts via the **`Task` tool** (`model="sonnet"`, `run_in_background=true`).

| Agent | Focus |
|-------|-------|
| S1 — Schema Scout | Models, migrations, schema definitions in scope |
| S2 — Code Path Tracer | Entry points, call chains, function signatures |
| S3 — Pattern Matcher | Similar features already in the codebase |
| S4 — Test Inventory | Existing tests and coverage gaps |
| S5 — Dependency Mapper | Import graph, shared models/enums |

Each scout prompt must:
- Be under 500 words
- List exact files or glob patterns to read
- Specify a structured output format
- Include: "Report facts only. No solutions. Include file:line for everything."

While scouts run, read CLAUDE.md, README, and `git log --oneline -20`.

### Step 3: Cross-Validate

1. Schema vs Code — do models match call chains? Flag mismatches.
2. Pattern vs Dependency — do established patterns match the import graph?
3. Test vs Change — are the areas you'll touch covered by tests?

### Step 4: Wave 2 — Deep Dive

Dispatch 1–2 investigators via **`Task`**. Choose model by complexity:

| Signal | Model |
|--------|-------|
| Schema changes / >5 files / multi-module | Opus |
| Single module / UI-only / established pattern | Sonnet |

### Step 5: Assemble the Spec

Write the plan to `.claude/plans/[feature].md`.

**Self-check before review:**

| Gate | Pass Criteria |
|------|---------------|
| Grounded | Every path, function, column exists in codebase right now |
| Typed contracts | Every cross-WP boundary has a complete typed interface |
| Falsifiable ACs | Every AC has a runnable verify command |
| Builder-ready | Each WP has file:line, current → new code |
| Risk register | At least one risk with mitigation and detection |
| Execution DAG | Ordering rationale for every dependency |
| Complexity Impact | Every WP declares score delta |
| Audit awareness | Latest audit read; findings covering affected files cited |

### Step 5b: Constraint Inventory

For every model, enum, config, and script the spec touches — READ the actual code.
Produce a "Constraints This Spec Must Respect" section at the top of the plan.

### Step 5c: Dry-Run

Dispatch 3–4 Sonnet scouts via **`Task`** to trace actual code paths:

| Scout | Focus |
|-------|-------|
| 5c-1 | Walk the WP DAG — flag ordering violations |
| 5c-2 | Verify cross-WP types match exactly at each boundary |
| 5c-3 | Failure paths — if a WP fails, can dependents detect it? |
| 5c-4 | Spot-checks — single-file, single-question verifications |

### Step 5d: Self-Challenge

For each AC, answer:
- **Input:** What triggers this check?
- **Action:** What does the system do? (exact code path)
- **Output:** What is produced? (exact model and fields)
- **Failure mode:** What happens when this fails?

### Step 6: Iterate — Full Cycles, Not Patches

When verification finds issues after building, return to Step 2 — do not spot-fix.

---

## Adversarial Review

Skip only for genuinely simple fixes (1–2 files, obvious change). Log why.

**Round 1 — two Opus agents in parallel via `Task`:**

```
Agent A — Grounding Review:
Read the plan at [path]. For every file path, function, model, and column name,
grep the codebase to verify it exists. Report:
  CONFIRMED: [ref] at [file:line]
  MISSING:   [ref] not found
  DRIFTED:   [ref] differs from spec — actual vs spec shown

Agent B — Quality Review:
Read the plan at [path]. Check:
1. Every AC has a verify command — no subjective criteria
2. All cross-WP interface contracts are typed and complete
3. Each WP can be executed without the builder exploring the codebase
4. The execution DAG is correct — no hidden dependencies
5. The risk register covers the most likely failures
```

**Round 2+:** Single follow-up agent with both focuses and Round 1 findings as context.

---

## Verification Strategy

| Tier | Question | Method |
|------|----------|--------|
| Structural | Was the change made? | Grep, file existence |
| Functional | Does the new code work? | Runtime calls, browser checks |
| Regression | Did it break anything? | Cross-feature smoke tests |

---

## Spec Template

### Required Sections

**Constraints This Spec Must Respect**
Actual fields, enum values, config keys — verified from code, not memory.

**Objective** — 2–3 sentences: what, who, why.

**Acceptance Criteria**

| AC | Description | Verify Command | Expected | Tolerance | Automated |
|----|-------------|----------------|----------|-----------|-----------|

**Technical Design** — Current flow, new flow, key design decisions with rationale.

**Interface Contracts** — Paste-ready typed models and signatures with file:line refs.

**Work Packages** — For each: files to modify, changes table (file:line | current | new | why), builder instructions.

**Execution Order** — DAG with rationale for every ordering constraint.

**Complexity Impact** — For each WP:
- New files created
- Existing files modified
- New concerns introduced
- LOC delta
- Open/Closed impact
- Worsens any audit finding (if yes → include remediation step)

**Risk Register** — At least one entry: risk | severity | probability | mitigation | detection.

---

## Sub-Agent Reference

Always use the **`Task` tool**. Never use the `Agent` tool.

| Role | Model |
|------|-------|
| Wave 1 scout | Sonnet |
| Wave 2: schema/multi-module/>5 files | Opus |
| Wave 2: single module / clear pattern | Sonnet |
| Review — grounding | Opus |
| Review — quality | Opus |
| Spot-check, single question | Haiku |
