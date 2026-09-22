# ADR-003: Declared actions — one definition per capability, not BuilderIO/agent-native

**Status:** Accepted · 2026-09-22
**Scope:** The pattern, and calendar-event creation as its first surface. Other surfaces follow the ladder at the end.
**Related:** [ADR-002](ADR-002-voice-agent-contract.md) (the same stance — own the contract, not the platform) · `server/actions/define-action.mjs` · `server/actions/schemas/event.mjs`

## Context

The question was whether **BuilderIO/agent-native** could fix a front-end/back-end mismatch
that had been accumulating, and whether it was worth the squeeze. The mismatch, as it
actually was on the day this was decided:

- **The server declared a tool's input contract in four places**, joined by string key at
  request time: `INTERNAL_INPUTS` (`server/context.mjs`, keys only), the provider and
  connector inline `inputs`, and `KEY_HINTS` / `EXTRA_INPUT_KEYS`
  (`server/assistant-agent.mjs`) — a *global, by-key-name* table that held the only real
  JSON-Schema types. Which keys a tool had and what those keys meant lived apart.
- **That drift was live.** `INTERNAL_INPUTS` named three helper tools
  (`homeops.list_agents / get_agent / update_agent`) and the prompt told the model to call
  `homeops__get_agent` — none of them existed in `INTERNAL_FUNCTIONS`. Nothing noticed,
  because nothing could.
- **"Create a calendar event" was written twice** — `POST /api/events` in `index.mjs` and
  `homeops.create_event_draft` in `internal-functions.mjs` — each with checks the other
  lacked. The route stored a participant who did not exist and an end before its start
  without a word; the tool never resolved a nest or accepted reminders. Seven `putEvent`
  sites each repeated ~20 fields, because `putEvent` is a blind upsert with no defaults.
- **The server's response shape was declared nowhere.** The web `ServerEvent` lacked
  `appendable`, `myNotes` and `remindOffsets`, which `GET /api/events` had been returning
  all along; the mobile `EventRec` lacked `spaceId` and cast around it; the two disagreed
  on whether `startAt` could be null. **No shared types path existed** — no workspace, two
  lockfiles, non-overlapping `tsconfig` includes, TypeScript 5 on one side and 6 on the
  other. The only "sharing" was a comment saying the shapes mirrored each other.

## Decision

**The pattern is adopted; the package is rejected.**

One `defineAction(...)` per capability is now the *only* place that capability is
described. From it the server derives the `INTERNAL_FUNCTIONS` entry the run engine and
chat loop already consume (unchanged in shape), the `INTERNAL_INPUTS` row the planner
reads, the JSON Schema the AI SDK's `jsonSchema()` receives verbatim, the HTTP handler,
and the TypeScript both clients import. The Vercel AI SDK, the policy ladder and
`executeToolForChat` are untouched; the actions sit underneath them.

| agent-native brings | FamiliOS has, and keeps |
|---|---|
| its own server (nitro/h3) | a framework-free `node:http` server with 100+ routes and a rate-limit-first request chain |
| its own database (drizzle + postgres, pglite, neon, supabase, convex peers) | per-household `node:sqlite` (ADR-001) |
| its own auth (better-auth, SSO, SCIM) | sessions, roles, a household PIN, bearer tokens for mobile |
| `authorize` + `needsApproval` | a policy ladder: BLOCKED / NEEDS_APPROVAL / ALLOWED, autonomy stances, high-stakes rules, role attribution — strictly more expressive |
| a React ≥ 19.2.7 + react-router 8 + assistant-ui shell | a React 18.3.1 web app on zustand, and an Expo app |
| `ai ≥ 6` | `ai@7` — the one clean overlap, and the part already here |

What tipped it, beyond the overlap: at the time of writing the package was **six months
old, at 0.183.0, with 1,566 npm versions** (several nightlies a day) and its own headless
template pinning `"latest"`; **no LICENSE file** at the repo root (root `package.json` said
ISC, `packages/core` said MIT); and its `packages/migrate` codemod targets Next.js. Its one
genuinely good idea is ~300 lines this codebase can own. Notably its `authorize` (holds at
every dispatch site) versus `needsApproval` (agent loop only) is the same distinction
`engine.mjs` arrived at independently — good evidence the direction is right, and good
reason to copy the shape rather than the dependency.

**How the pattern is held to, in code:**

- `SUPPORTED_KEYWORDS` in `define-action.mjs` is **one fence** shared by the definition
  check, the validator and the TypeScript emitter. A schema keyword none of them knows is
  refused at boot. That fence is the whole guarantee; there is no schema library, no `ajv`,
  no `json-schema-to-typescript`.
- Declared routes dispatch **first** in `index.mjs`, after the rate limits. A stale
  hand-written copy of a declared route is dead code, and `action-routes.test.mjs` reads
  `index.mjs` to forbid one.
- The generated file is committed **twice** (`src/generated/`, `apps/mobile/src/generated/`)
  because the apps share no module path; `action-types-generated.test.mjs` renders the
  registry in memory and fails CI if either copy has drifted.
- `event-record-contract.test.mjs` runs every writer — the action, attendees, requests, a
  private note, task → calendar, meal → calendar, an ICS import — and validates every event
  `GET /api/events` returns against `EVENT_RECORD` with unknown keys **rejected**. GET is not
  rewritten as an action yet; its shape is enforced anyway.

**The first surface, and what changed on the wire.** `homeops.create_event_draft` keeps its
id (it is in stored allow-lists, the prompt and run tests) and is one `run` for both doors;
`ctx.via` decides draft (agent) versus confirmed (user). The route gained the tool's checks
and the tool gained the route's — deliberately, so one behaviour exists behind one name:

| Surface | Change |
|---|---|
| HTTP | ghost `participantIds` / `driverId` → 400 `unknown_member`; `endAt` before `startAt` → 400 `end_before_start`; a date-only `startAt` → an all-day event on the household's midnight; a wrong JSON type → 400 `invalid_input` naming the field; blank title → `empty_title` |
| HTTP | undeclared body keys are **stripped, never rejected** — the mobile form sends `localNotes` on create |
| Tool | gains nest resolution, `remindOffsets`, `remindersSent: []`; its result is the whole record (`{ event }`) — one output type for both surfaces |

## Consequences

**Good.** A capability's contract exists once, and a client that disagrees with it fails
to typecheck instead of failing a family. The typecheck did exactly that on the first run:
five item shapes the schema had marked optional (`whatToBring[].memberId`,
`checklist[].done`, `attendees[].respondedAt`, `requests.*[].at`, `provenance.conflict.google`)
were required by every writer and both clients; the schema was tightened, not the clients.
The mobile cast for `spaceId` is gone. Adding the next surface is one declaration and one
test file.

**Bad.** Until the ladder below is climbed there are two ways to write a route and two ways
to describe a tool's inputs, and the hand-written way is still the majority. The tool's
result shape changed (seven assertions and one card label moved with it). The planner rows
derived from an action carry a full sentence as their `label`, where the hand-written rows
carried nothing.

**Accepted risk.** The hand-rolled validator and emitter must grow with the schema subset,
and only `SUPPORTED_KEYWORDS` stops someone widening one without the other. A declared
route dispatching first means a typo in an action's `http.path` shadows nothing but also
announces nothing beyond a failing test. The `strip` mode on HTTP hides client fields that
were being sent for no reason; it warns once per key per process.

## Revisit if

All three hold: agent-native ships **1.0**; a **LICENSE** file lands at its repo root;
FamiliOS web is on **React 19**. Until then the package is not on the table, and this
record is why.

## Follow-up ladder

1. ~~**Phantom helper tools**~~ — **Done, 2026-09-22.** The rows and the prompt line were
   deleted (the real tools are the native `famili.*_helper` set), and
   `tool-registry-consistency.test.mjs` now refuses any tool name in the prompt or the hint
   tables that does not resolve to a registry entry or a native tool.
2. ~~**The other event writers**~~ — **Done, 2026-09-22.** All six writers (the action, the
   ICS/Google sync, task → calendar, meal → calendar, `plan_meal`, a message suggestion)
   go through `newEventRecord(fields, ctx)` in `server/actions/schemas/event.mjs`: a writer
   passes what it knows, the helper fills every structural default, validates against
   `EVENT_RECORD` with unknown keys rejected, and throws. `putEvent` stays a blind upsert;
   `event-record-defaults.test.mjs` reads the server as text and refuses any `putEvent(`
   that does not go through the helper.
3. **Next surfaces**: ~~tasks~~ — **`homeops.create_task` + `POST /api/tasks` done,
   2026-09-22** (`server/actions/tasks.mjs`, `TASK_RECORD`, `TaskRecord` generated for both
   clients; one rule for reminders-before-a-date, the product's). ~~List items~~ — **done,
   2026-09-22:** `homeops.create_list_item` is a declared action on `create_task`'s run
   with type `list`, and every task writer (the grocery writers in `plan_meal` and the meals
   route, a message suggestion) goes through `newTaskRecord(fields, ctx)`, the task-side
   twin of `newEventRecord`, guarded the same way. Still to do: meals, `GET /api/events` and
   `GET /api/tasks` as declared reads.
4. **Native `famili.*` tools bypass the policy ladder** (`assistant-agent.mjs`, the second
   loop in `buildToolSet`) while registry tools go through `executeToolForChat`. Decide
   whether native tools become actions — the next real architectural decision.
5. **`CalendarEvent` / `memberIds`** (`src/types/index.ts`, `useStore.ts` `mapEvent`, seven
   demo seed events) — a web store-local view-model that collapses a null `startAt` to `""`.
   Derive from `EventRecord` or retire it.
6. **Mobile sends `localNotes` on create** and it is dropped, as it always was. Decide
   whether create should write the viewer's note.
7. `KEY_HINTS`, `EXTRA_INPUT_KEYS` and `schemaForInputs` become deletable once every
   internal tool is declared.
