---
name: "gnd-chart"
description: "Structured plan format for manual planning and navigator-led execution. Use when charting multi-step plans intended for @gnd-navigator to dispatch as legs via runSubagent in any project."
user-invocable: true
disable-model-invocation: true
contracts:
  - navigator-gates-unconfirmed
---
# Chart

Plan multi-step work as structured legs for `@gnd-navigator` to dispatch to `gnd-diver`.

## Workflow Role

Break the user's goal into bounded, reviewable legs. Project constraints come from project guidance sources, not hidden assumptions.

## Project Context Resolution

Identify authoritative guidance in priority order:

1. User request and attachments
2. Workspace instructions
3. `README.md` and area docs
4. Skills, file instructions, or agent files referenced by those docs
5. Build, test, packaging, deployment, or CI config

Read only what matters. Record useful sources in the plan's `## Project Context`.

---

## Workflow

```text
Discovery → Alignment → Draft → Workshop → Refinement
```

### Phase 1 — Discovery

Explore the codebase: read relevant files, run searches, identify affected modules. Skim archived plans or critiques for prior corrections if they exist. Do not write legs yet.

### Phase 2 — Alignment

One round after Discovery. Summarize findings, then ask scope/approach questions. At minimum: (a) in-scope vs out-of-scope, (b) non-obvious tradeoffs, (c) genuine ambiguities. Skip only when the task maps to a single unambiguous leg.

### Phase 3 — Draft

Present a **plan outline** — not full legs:

- Plan title
- Leg list: ID, label, one-line intent
- Proposed dispatch order

### Phase 4 — Workshop

After the draft, automatically workshop each leg:

1. Present legs one at a time (group tightly coupled ones at your discretion).
2. For each leg, show in chat:
   - Title, ID
   - **Goal link** — one sentence connecting this leg to the user's overall goal
   - 2–3 bullets of key intent
   - Owned files
   - One alternative or tradeoff if applicable; otherwise state "mechanical"
3. Ask the user. Options: **Approve as-is** (recommended), concrete alternatives from the summary, **Remove**. Freeform always available.
4. Apply feedback immediately. Move to next leg.
5. Mark confirmed legs `Confirmed: yes`.

Do not advance until all legs are confirmed or removed.

### Phase 5 — Refinement

**User Intent confirmation.** Present a 2–4 sentence summary of the user's goal distilled from the conversation. Ask: "Does this capture your goal?" Options: **Looks right** (recommended), **Needs revision**. Update and re-confirm if revised.

Then write the full plan with all fields. Output only:
1. Changes made during workshop
2. Any unconfirmed legs
3. Final dispatch order

The plan file is the source of truth — do not paste the full plan into chat.

---

## Re-entry Triggers

**"review"** or **"walk me through it"**: re-enter workshop for unconfirmed legs, or ask which confirmed leg to revisit. Confirmed legs are not re-presented unless a subsequent change significantly alters their scope.

---

## Plan File Location

Plans live in `.planning/` as `active-plan-YYYY-MM-DD-HHmm-<slug>.md`.

- View existing plans first; leave them in place.
- Each plan gets its own timestamped file. Multiple live plans may coexist.
- Only one plan should be actively dispatched at a time.
- After implementation, leave the plan for critique. `gnd-critique` appends findings then archives.

---

## Plan Structure

```markdown
# Plan: [Short Title]

## Project Context
- Sources:
  - `path/to/doc.md` - why it matters
- Constraints:
  - [Derived rules]
- Full validation:
  - `command` or checklist
- Delivery verification:
  - deployed URL, package check, artifact check, local-only, or `none`

## User Intent
[2-4 sentences confirmed by user during Refinement. Navigator and critique
reference this to evaluate alignment.]

## Legs

### LEG-1: [Area] - [Short description]
- Status: pending
- Confirmed: yes | no
- Goal link: [How this leg serves the User Intent]
- Depends on: none | LEG-N
- Owned files:
  - `path/to/file.ts`
- Read-only:
  - `path/to/reference.ts` - reason
- Deferred shared edits:
  - `shared/file.ts` - what to change
- Verification: `command`
- Intent: [Detailed implementation description]

## Dispatch Order
Sequential via runSubagent (navigator reviews between each):
1. LEG-1 (label) - no dependencies
2. LEG-2 (label) - depends on LEG-1
After all complete: deferred edits → full validation → delivery verification → commit → push.
```

---

## Field Definitions

| Field | Notes |
|-------|-------|
| **Status** | `pending`, `in-progress`, `done`, `failed`. Only navigator updates during dispatch. |
| **Confirmed** | `yes`/`no`. Set to `yes` on user approval in workshop. Navigator won't dispatch `no`. |
| **Depends on** | `none` or a leg ID. Dispatch Order makes the sequence explicit. |
| **Dispatch agent** | Always `gnd-diver`. If a leg seems too vague, tighten the intent or split it — don't assign a different agent. |
| **Owned files** | Exhaustive list the sub-agent may modify. No globs. One leg per file — never split. Grep during Draft/Workshop to confirm targets exist. |
| **Read-only** | Reference files the sub-agent reads but must not modify. Include a reason. |
| **Deferred shared edits** | Changes to shared files (`package.json`, routers, etc.) the navigator applies after all legs complete. Be precise. |
| **Verification** | Single shell command covering only this leg's files. Not the project's full gate. For test legs: list explicit per-file expected assertions. |
| **Intent** | The critical field. Must be **specific** (name functions, interfaces, selectors), **self-contained** (embed needed constraints), **outcome-oriented** (what code does when done), and **bounded** (number sub-tasks). |

---

## Scoping Guidelines

- **One module or feature per leg** when files are tightly coupled. Don't split types and state that always change together.
- **Split by independence** when modules don't share types.
- **Maximize parallelism** — minimize serial dependency chains.
- **≤15 owned files per leg.** Larger → find a seam to split on.
- **Shared files** (`package.json`, `build.ts`, routers, shared styles) never appear in owned sets. Use deferred shared edits.

---

## Embedding Project Constraints

Leg intents must embed relevant project constraints so sub-agents don't rediscover them. Common categories: performance/bundle budgets, layout checkpoints, accessibility, content/copy rules, state/persistence, styling/design-system, build/test/release, motion/audio/media. Include only what affects each leg.

---

## Dispatch Order Section

List legs in dispatch order. Note dependencies and parallelism. End with:

```markdown
After all complete: deferred edits → `## Project Context` full-validation → delivery verification → commit → push.
```

Project-specific sync, packaging, or publish steps belong in `## Project Context`.
