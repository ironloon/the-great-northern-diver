---
name: "gnd-critique"
description: "Evaluate completed work against intent and delivered behavior. Two modes: plan critique (evaluates an implemented live plan after @gnd-navigator execution) and field review (--field-review / --fr, triages runtime or workflow observations, implements fixes, and archives findings)."
user-invocable: true
disable-model-invocation: true
---
# Critique

Evaluate delivered work against the plan. Validation and delivery checks come from the plan's `## Project Context`, workspace instructions, READMEs, and skills.

Two modes — detect from invocation:

| Flag | Mode | When |
|------|------|------|
| *(default)* | Plan critique | After a navigator-led plan is implemented and validated. Requires an implemented live plan. |
| `--field-review` / `--fr` | Field review | Runtime, delivery, or workflow observations that don't map to a critique target. No target required. |

---

## Mode: Field Review

User tests the delivered system and reports observations.

### FR Phase 1 — Gather Context

For process-only reviews (memory-path conflicts, workflow bugs), skip inapplicable delivery checks — read workflow files and `.planning/` state instead.

1. **Determine evaluation surface.** Use the user's report plus `## Project Context`, workspace instructions, READMEs, and skills to decide: deployed web, local runtime, package/artifact, or pure workflow.
2. **Verify delivery** when the evaluation surface (step 1) is deployed, published, or has a preview — check the live surface. If the surface is local-only, workflow-only, or has no delivery verification defined, mark not applicable.
3. **Inspect real surface** when applicable via `fetch_webpage` or similar.
4. **Read relevant code/process files** based on user observations. Enough to form hypotheses, not the whole codebase.
5. **Check archived plans.** Skim `.planning/archive/` for recent plans touching affected areas.

### FR Phase 2 — Triage

Classify each observation:

| Category | Meaning | Output |
|----------|---------|--------|
| **Bug** | Broken — visible defect, wrong behavior | Root cause hypothesis with file + line refs |
| **UX issue** | Works but wrong feel — confusing, inconsistent | Description + what "right" looks like, with code evidence |
| **Design question** | Not clearly a bug — questioning a decision | Restate original intent, note concern, flag for planning |
| **Recurring** | Previously flagged in a prior critique/cycle | Link to prior finding, escalate priority |

Per observation: what the user reported, category, evidence (code refs, surface observations, prior findings), hypothesis, severity (blocker/high/medium/low).

### FR Phase 3 — Findings & Plan

Present triaged findings, then propose an implementation plan:

```text
## Field Review: [Area]
Date: [date]
Delivery: [verified / mismatch / not applicable]

### Findings
#### 1. [Title]
- Reported: [user's words]
- Category: Bug / UX issue / Design question / Recurring
- Severity: blocker / high / medium / low
- Evidence: [refs]
- Hypothesis: [root cause + fix location]

### Implementation Plan
Ordered fixes with files and approach. Design questions flagged for user decision.

### Process Observations
Process-level corrections if findings reveal a gap. Otherwise omit.
```

### FR Phase 4 — Implement

Fix bugs and UX issues in severity order (blockers first). Design questions → present to user first. Run tests after each fix.

### FR Phase 5 — Deploy & Verify

1. Run full validation from `## Project Context` / workspace instructions / READMEs / skills.
2. Commit and push (when in scope) with a descriptive message.
3. Verify delivery yourself — don't ask the user to check first.
4. Tell user any needed refresh/update step only if the surface requires it.
5. User re-verifies. Persistent findings → another Phase 4 round.
6. **Archive.** Create `.planning/archive/<YYYY-MM-DD>-field-review-<slug>.md` with findings + implementation + verification.
7. Update process files if findings reveal a gap.

---

## Mode: Plan Critique

After `@gnd-navigator` implements and validates a plan.

```text
Gather Context → Interactive Review → Analysis → Findings → Apply
```

### PC Phase 1 — Gather Context

1. **Resolve critique target.** List `.planning/` (exclude `archive/`). Supports `active-plan-*.md`.
   - Prefer a plan with `## Implementation` and no `## Critique`.
   - User-selected plan takes priority.
   - One candidate → select it. Multiple → ask.

2. **Read implementation.** Use the commit SHA from `## Implementation` to review the change. Check the commit's file summary and targeted diffs.

3. **Resolve validation context.** From `## Project Context`, or derive from workspace instructions, READMEs, skills, and CI config.

4. **Verify delivery** if the project defines a delivery surface. Failed validation/delivery is a blocker.

5. **Inspect real surface** when applicable.

6. **Read process files.** Targeted reads of:
   - `.agents/skills/gnd-chart/SKILL.md`
   - `.agents/skills/gnd-critique/SKILL.md`
   - `.agents/agents/gnd-navigator.agent.md`
   - `.agents/agents/gnd-diver.agent.md`


### PC Phase 2 — Interactive Review

Three beats to surface gaps before automated analysis.

**Beat 1 — Intent Check.** Show `## User Intent` from the plan. Ask: *"Does this still capture what you wanted?"* Options: **Yes** (recommended), **Needs adjustment**.
- If confirmed → Beat 2.
- If "yeah, but also X" → **chart gap** (workshop failed to capture this). Flag immediately as `gnd-chart` correction.
- If substantial revision → update User Intent, re-evaluate legs.

**Beat 2 — Leg Walkthrough.** One at a time (or grouped by area). Show what *actually shipped* from the diff, not the plan's intent. Ask: *"How did this land?"* Options: **Landed well**, **Has issues**, **Didn't notice it**.

Anchor to plan scope. Off-topic observations → triage (below).

**Beat 3 — Open Impressions.** *"Anything else you noticed?"* Triage all responses.

**Off-topic triage:**

| Signal | Class | Action |
|--------|-------|--------|
| Relates to User Intent but no leg covers it | Chart gap | Flag as `gnd-chart` correction |
| Unrelated area plan didn't touch | Out of scope | Add to Field Review Holding List |
| Ambiguous | Clarify | Ask user, then classify |

### PC Phase 3 — Analysis

Cross-reference plan, code, user observations, and triage to identify:

1. **Intent-vs-implementation gaps** — scope creep, incomplete implementation, drift.
2. **Delivered-behavior issues** — match bugs/UX gaps to specific legs. Root cause: bad plan, bad execution, or unforeseen interaction?
3. **Chart gaps** — for each, identify which charting phase failed (Discovery/Alignment/Workshop) and why.
4. **User effectiveness patterns** — vague prompt context, unstated scope. Collaborative observations to help tighten future chart-time input.
5. **Process patterns** — recurring problems across legs, leg shapes that worked well or poorly, navigator review gaps.

### PC Phase 4 — Findings

Present structured findings before applying:

```text
## Critique Findings: [Plan Title]

### What Worked
- [Evidence-backed positives]

### What Didn't
- [Problems tied to specific legs or steps]

### Chart Gaps
- [Missing intent facets + which chart phase failed and why]

### User Effectiveness
- [Collaborative prompting observations]

### Blockers
- [Validation/delivery failures]

### Corrections for Next Cycle
- [Concrete, actionable changes — not vague aspirations]

### Field Review Holding List
- [Out-of-scope observations from Phase 2]

### Process File Updates
- [Each file + what changes]
```

Get user approval before applying.

### PC Phase 5 — Apply

1. **Append** `## Critique` section to the plan file.
2. **Update process files** with approved changes. All files are eligible (`gnd-chart`, `gnd-critique`, `gnd-navigator`, `gnd-diver`, project-local files). Only where findings warrant it.
3. **Archive** the plan → `.planning/archive/<YYYY-MM-DD>-<slug>.md`.
4. **Report** what was updated and the archive path.
5. **Field review handoff** if the holding list is non-empty.

---

## Key Rules

- **Archive, don't delete.** Move the plan to archive after critique. Other live plans remain.
- **Evidence over opinion.** Every finding references a specific leg, diff, or observation.
- **Actionable corrections only.** "Be more specific" is not actionable. "Include viewport checkpoints for CSS layout legs" is.
- **Don't over-correct.** If most legs executed cleanly, the process works. Focus on the gaps.
- **Respect scope.** Plan critique evaluates what shipped. It doesn't redesign the product or start a new plan.
