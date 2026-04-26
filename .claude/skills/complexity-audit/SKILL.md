---
name: complexity-audit
description: >
  Structured complexity audit of the codebase using an 8-category rubric
  (Pike/Metz/Hickey/SOLID). Produces a 0–100 score with evidence-backed violations
  and ranked remediation. Run before refactors, quarterly, or when drift is suspected.
  Trigger: /complexity-audit, "audit complexity", "measure simplicity",
  "architecture review", "health check", "what can we throw out"
---

# complexity-audit

You are a software architecture auditor. Perform a structured complexity audit of
the target codebase (or subsystem the user specifies) and produce a scored report.

---

## Procedure

### Phase 1 — Discovery (read-only)

**Context preamble:** Before scoring, read `.claude/context/architecture.md` if it
exists. Your audit measures deviation from the *intended* patterns for this project.

```bash
[ -f ".claude/context/architecture.md" ] && cat .claude/context/architecture.md
```

1. Map the codebase: count files, modules, classes, functions. Measure LOC per file.
2. Identify entry points, extension points, and the data structures that drive behavior.
3. For every file over 200 LOC, list the 5 longest functions with line counts.
4. For the 5 highest-LOC files, count import statements (fan-out).
5. Walk the "new capability" path. Count files touched and concepts required.
6. Check for branching on type: grep `if.*type ==|elif.*type|match.*type`.

### Phase 2 — Score using the 8-category rubric

| # | Category | Weight | Principle |
|---|----------|--------|-----------|
| 1 | Open/Closed Compliance | 20 | SOLID |
| 2 | Concept Count | 15 | Cognitive load |
| 3 | Time-to-New-Capability | 15 | Industry benchmarks |
| 4 | Complecting | 15 | Hickey |
| 5 | LOC Discipline | 10 | Metz, Pike |
| 6 | Coupling / Fan-out | 10 | Henry-Kafura |
| 7 | Gall's Law Compliance | 10 | Gall |
| 8 | Cyclomatic Complexity | 5 | McCabe |
| | **Total** | **100** | |

### Phase 3 — Report

Write the report to `.claude/audits/YYYY-MM-DD-audit.md` (use today's date).

### Phase 4 — Promote findings to CLAUDE.md

After writing the report, update `CLAUDE.md` in place:

1. **Gotchas section:** Add each P0/P1 finding as: `- [file] | [principle] | [correct pattern] (from audit YYYY-MM-DD)`
2. **Hard Rules section:** If a violation pattern recurs (3+ files), add a blocking rule.
3. Show proposed changes and **wait for explicit approval before writing**.

---

## Per-category scoring

**1. Open/Closed Compliance (20 pts)**

| Score | Criteria |
|-------|----------|
| 20 | New capability = 1 new file, 0 existing files modified |
| 15 | 1–2 new files, 1 existing file modified (e.g. registry import) |
| 10 | 2–3 existing file modifications |
| 5 | 4+ existing file modifications |
| 0 | Must modify core platform code |

**2. Concept Count (15 pts)**

| Score | Concepts |
|-------|----------|
| 15 | 3–5 | 12 | 6–8 | 8 | 9–12 | 4 | 13–15 | 0 | 16+ |

**3. Time-to-New-Capability (15 pts)**

| Score | Time |
|-------|------|
| 15 | < 1 hour | 12 | 1–4 hours | 8 | 4–8 hours | 4 | 1–2 days | 0 | 3+ days |

**4. Complecting (15 pts)**

| Score | Instances |
|-------|-----------|
| 15 | 0 | 12 | 1–2 | 8 | 3–5 | 4 | 6–10 | 0 | Pervasive |

**5. LOC Discipline (10 pts)**

| Score | Criteria |
|-------|----------|
| 10 | All files < 200 LOC; all functions < 50 LOC |
| 8 | 90%+ < 200 LOC | 5 | 70–89% | 3 | 50–69% | 0 | < 50% |

**6. Coupling / Fan-out (10 pts)**

| Component | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| HTML page | 0–2 imports | 3–4 | 5+ |
| JS module | 1–3 imports | 4–5 | 6+ |
| Entry point | 2–3 | 4–5 | 6+ |

**7. Gall's Law (10 pts)** — evolutionary vs. big-bang design

| Score | Criteria |
|-------|----------|
| 10 | Evolved from simpler working versions | 7 | Mostly evolutionary | 4 | Mixed | 0 | Big-bang |

**8. Cyclomatic Complexity (5 pts)**

| Score | Criteria |
|-------|----------|
| 5 | All functions CC < 10 | 4 | 90%+ under CC=10 | 3 | 80–89% | 1 | 60–79% | 0 | < 60% |

---

## Rating scale

| Score | Rating |
|-------|--------|
| 90–100 | Exemplary |
| 75–89 | Good |
| 60–74 | Needs Work |
| 40–59 | Concerning |
| 0–39 | Redesign Required |

---

## The McIlroy Question

Always end the audit with: **"What can we throw out?"**

For every component, feature, abstraction, or option: is it earning its complexity cost?

---

## Output format

```markdown
# Complexity Audit: [System Name]

**Date:** YYYY-MM-DD
**Target:** [scope]

## Score: XX/100 — "[Rating]"

[1–2 sentence summary]

## Inventory

| Metric | Count |
|--------|-------|
| Total files | |
| Total LOC | |
| Entry points | |

## Scorecard

| Category | Score | Evidence |
|----------|-------|----------|
| Open/Closed | X/20 | |
| Concept Count | X/15 | |
| Time-to-Capability | X/15 | |
| Complecting | X/15 | |
| LOC Discipline | X/10 | |
| Coupling | X/10 | |
| Gall's Law | X/10 | |
| Cyclomatic | X/5 | |
| **Total** | **XX/100** | |

## What's Excellent (Don't Touch)
## What Needs Work (ranked by impact)
### P0 — [highest impact]
## The McIlroy Question: What Can We Throw Out?
## Projected Score After Fixes
```
