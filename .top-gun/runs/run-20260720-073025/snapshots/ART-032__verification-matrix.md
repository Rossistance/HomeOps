# Verification Matrix — run-20260720-073025

Levels: `unit` · `integration` (real server, isolated temp data dir) · `e2e-web`
(Playwright, real browser) · `static` (typecheck) · `manual-probe` (inspected runtime
output). **Blocked / partial / pre-existing-fail rows are recorded as such and are never
reported as pass.**

Test data hygiene: every record created by these suites is prefixed `TG-` and lives in
a per-run `mkdtemp` data dir (`server/test/harness.mjs`), never the real family tenant.
The one exception is the Playwright web lane, which drives the real local stack — its
smoke specs are read-only (boot, sign in, sign out).

## Baseline (revalidated at dispatch, not inherited)

| Check | Method | Result | Evidence |
|---|---|---|---|
| Working tree = c0c4596 + protected harness edits | `git status --porcelain` | **pass** — only `tests/topgun/web/{helpers,smoke.spec}.ts` modified, preserved throughout | journal #44 |
| Server suite baseline | `npm test` (node 25.8.2) | **pass** 308/308 (the historical figure re-proven) | journal #44 |
| Root typecheck | `npx tsc --noEmit` | **pass** 0 errors | journal #44 |
| Mobile typecheck | `npx tsc --noEmit` in `apps/mobile` | **pass** 0 errors | journal #44 |
| Google account state (WP-005 feasibility) | read-only SQLite probe of `server/.data/tenants/local` kv `accounts.json` | **BLOCKER CONFIRMED** — one google account, `status: needs_reconnect` | journal #44 |

## WP-001 — the automation runs the skill that was built

| Check | Level | Result | Evidence |
|---|---|---|---|
| Trigger target carries `skillId` of the created skill | integration | **pass** | `false-success-regression.test.mjs` repro A |
| Fired run executes the skill's real steps, not a status pass | integration | **pass** — 3 real steps, no "status pass" title | repro A |
| The send step parks for approval, never reports success | integration | **pass** | repro A |
| Trigger `lastStatus` settles terminal (ISS-009) | integration | **pass** — no longer the fire-time placeholder | repro A |
| Build confirmation names the skill, the schedule, and the approval gate | integration | **pass** | repro A |
| Unrunnable automation → 422 `unrunnable_automation` + chat message | integration | **pass** | repro A |
| **Red/green proof — the test bites** | integration | **pass** — reverting only the target-linkage expression turns **7 tests RED** across repro A and A2; restoring returns 16/16 green | executed and captured this session |

## WP-002 — "every day at 7 AM" means 07:00

| Check | Level | Result | Evidence |
|---|---|---|---|
| `nextRunAt` is the next 07:00 local, not creation+24h | integration | **pass** | repro A2 |
| Post-fire recompute returns 07:00, not fire-time+24h | unit | **pass** (probe from an off-anchor 09:23 fire) | repro A2 |
| DST transition holds 07:00 wall-clock | unit (tz fixture) | **pass** — America/New_York across 2026-03-08 **and** the 2026-11-01 fall-back | repro A2 + edge probe |
| Timezone fallback is disclosed, never silent | unit | **pass** — unknown tz → `tzSource: "server"` | edge probe |
| Anchor validation rejects malformed input | unit | **pass** — `"24:00"` and `"7am"` → null | edge probe |
| `now == anchor` rolls to the next day (no fire loop) | unit | **pass** | edge probe |
| Human schedule copy reaches clients | integration | **pass** — `"Daily · 7:00 AM"` | repro A2, persona suite |

## WP-003 — no vacuous sends, no silent clamps

| Check | Level | Result | Evidence |
|---|---|---|---|
| Toolless "send" step → `skipped_no_tool`, not `succeeded` | integration | **pass** | repro B |
| Genuine reasoning step still succeeds (no over-correction) | integration | **pass** | repro B |
| Chat states plainly that nothing was sent | integration | **pass** | repro B |
| Save-as-helper offer suppressed after a zero-delivery run | integration | **pass** | repro B |
| **CONTROL: an all-real-tool run keeps "Done —"** | integration | **pass** | repro B |
| Policy-clamped step survives as visible `skipped` with a reason | integration | **pass** — at HEAD the step was deleted from the plan entirely | repro C |

## WP-004 — parked/expired runs report back

| Check | Level | Result | Evidence |
|---|---|---|---|
| Parked run posts a waiting message naming step + expiry window | integration | **pass** | repro B2 |
| Expiry reaches run-finished observers (was silent) | code + integration | **pass** — `expireStaleRuns` now calls `fireRunFinished` | engine.mjs; full suite |
| Expiry counts toward the keeps-failing Owner alert | code | **pass** — `notifyRepeatedNonDelivery` counts `failed` **and** `expired` | engine.mjs |
| No duplicate park messages on resume | code | **pass** — announce-once guard keyed `runId:stepIndex` | engine.mjs |
| Client waiting/expired rendering | e2e-web | see Browser Pass below | — |

## WP-005 — real unattended delivery (SECURITY-SENSITIVE)

Mocked/harness lane only. **No live email was sent at any point in this session.**

| Check | Level | Result | Evidence |
|---|---|---|---|
| Tool registered in the live catalog | integration | **pass** | `notify-contact-delivery.test.mjs` |
| No acting agent → refuse | integration | **pass** | gate 1 |
| Unregistered recipient → refuse, never invent a method | integration | **pass** | gate 1 |
| Unverified method → refuse | integration | **pass** | gate 2 |
| Not opted in → refuse | integration | **pass** | gate 3 |
| Agent not on allowlist → `agent_not_allowed` | integration | **pass** | gate 4 |
| Household kill switch → refuse, nothing sent | integration | **pass** | gate 5 |
| Empty body → refuse | integration | **pass** | gate 6 |
| All gates pass → proceeds to transport, reports the REAL outcome | integration | **pass** — honestly reports "connect Google" rather than claiming delivery | gate 7 |
| Delivery step never silently dropped from the trace | integration | **pass** | — |
| **Kill-switch coverage of the email branch (pre-existing gap)** | code + integration | **pass** — `deliverViaChannel` now checks `externalActionsEnabled` for all external channels incl. the verification-code path | notify.mjs |
| Stale Google account reported honestly, not as a provider error | code | **pass** | notify.mjs |
| **LIVE send to wrhixon@gmail.com** | — | **BLOCKED — not attempted** | see Blockers |

### Adversarial review findings (mandatory xhigh pass) — all verified, fixed, and pinned

| ID | Finding | Result | Evidence |
|---|---|---|---|
| C1 | `POST /api/runs/start` forwarded client `sourceRef` verbatim → any Limited Member could name any agent and inherit its standing send consent | **fixed + pinned** | test "C1 — a client cannot supply sourceRef.agentId…" |
| C2 | Changing a method's address reset verification but kept the agent allowlist → a Child could repoint an adult-granted consent to an address they control | **fixed + pinned** | test "C2 — changing a contact method's address clears its agent allowlist" |
| C3 | `allowedAgentIds` was the only field on contact methods not adult-gated (create **and** patch) | **fixed + pinned** | tests C3, C3b |
| H1 | Deleting an agent left live grants; an unresolvable `agentId` **skipped policy entirely** | **fixed + pinned** | tests H1, H1b |
| H2 | `/api/notify` had no role floor and made the allowlist optional | **fixed + pinned** (narrowed so self-notification stays open) | test H2 |
| M1 | No household can re-tighten `notify_contact` to require approval (overrides only relax) | **accepted, not fixed** — out of selected scope; recorded as a residual risk | review report |
| M2 | Message body is LLM-threaded, so externally-sourced text can ship under the family's identity | **accepted, not fixed** — pre-existing engine behaviour, wider than WP-005 | review report |
| M3 | Auto-repair runs carry no `agentId`, so they run with no agent policy applied (cannot send — fails closed) | **accepted, not fixed** — policy concern, not a send-authority hole | review report |
| L1/L2/L4 | `sms.send` called without `householdId`; ambiguous method match; `getAgent` unscoped | **partially addressed** — L4's household scoping fixed as part of H1; L1/L2 recorded | review report |

## WP-006 — surface truth

| Check | Level | Result | Evidence |
|---|---|---|---|
| Agent lands Active when scheduled; Draft when not (ISS-007) | integration | **pass** | `persona-honesty.test.mjs` |
| Automation shows human schedule, never raw intervalMs | integration | **pass** | persona suite |
| Agent inherits the capabilities its skill needs | integration | **pass** | persona suite |
| Child View AI gate holds on chat and build | integration | **pass** | persona suite |
| Guest cannot create durable agents | integration | **pass** | persona suite |
| **Guest gets guidance, not a dead build card (ISS-011)** | integration | **pass** — this was found as a LIVE bug by the promoted suite and fixed server-side | persona suite |
| Registry gate fail-closed without a mail account | integration | **pass** | persona suite |
| Client rendering of the above | e2e-web | see Browser Pass below | — |

## Suite totals

| Run | Result |
|---|---|
| Baseline before any edit | 308/308 pass |
| After all server slices + 3 promoted/new suites | 350/350 pass |
| Final, incl. the two tests pinning the browser-pass finding | **352/352 pass, 0 fail** |

Typechecks (final): root `npx tsc --noEmit` **0 errors**; `apps/mobile` **0 errors**.

New permanent suites (promoted from throwaway audit evidence, as the brief required):
- `server/test/false-success-regression.test.mjs` — 16 tests (repros A, A2, B, B2, C)
- `server/test/persona-honesty.test.mjs` — 10 tests (five canonical personas)
- `server/test/notify-contact-delivery.test.mjs` — 16 tests (WP-005 gates + review findings)

## Browser pass (MANDATORY — DEC-A03 reversal condition)

Real Chromium and WebKit-iPhone, real local stack, real backend. Not code-tracing.

| Check | Project | Result | Evidence |
|---|---|---|---|
| App boots to lock screen with the server roster | chromium + webkit-iphone | **pass** | `web/smoke.spec.ts` |
| Member signs in, shell renders, backend online | chromium + webkit-iphone | **pass** | smoke |
| Sign out returns to lock screen | chromium | **pass** (skipped on mobile by design) | smoke |
| **Web smoke lane total** | both | **5 passed / 1 skipped** — the expected baseline, preserved with all client changes in | — |
| Server reaches `skipped_no_tool` for a toolless send | chromium | **pass** | `web/run-honesty.spec.ts` (new) |
| **The browser actually PAINTS the non-delivery copy** | chromium | **pass** — "not sent / no delivery tool" visible in the ExecutionMonitor run timeline | `web/run-honesty.spec.ts` |
| No horizontal overflow at phone width | webkit-iphone | **pass** | `web/run-honesty.spec.ts` |
| No uncaught page errors in any of the above | both | **pass** | `watchPageErrors` |

### What the browser pass caught that 350 green server tests did not

`normalizePlan` is not on every path into a run. A deterministic **skill's** steps come
through `buildPlanFromSkill`, and `POST /api/runs/start` accepts a raw plan — both
skipped normalization, so `effectClaimed` was never set and a toolless "Send email" step
**still reported `succeeded`**. The user's chat-built briefing runs *as a skill*, so the
headline scenario was still broken behind a fully green suite. The verdict is now
settled in `startRun` — the one choke point every run passes — and pinned by two new
tests (raw-plan path, skill path). This is precisely the failure mode DEC-A03's
reversal condition exists to catch.

### Pre-existing failures — recorded as failures, NOT as pass

| Spec | Result | Attribution |
|---|---|---|
| `core-flows.spec.ts` › calendar renders view tabs and month controls | **fail** (chromium + webkit-iphone) | **Pre-existing.** `src/screens/Calendar.tsx` and the calendar components are byte-identical to HEAD c0c4596 (`git diff --stat` empty); the `aria-label="Previous month"` control exists in source at `Calendar.tsx:218` but does not render in the default view. Untouched by this session and unrelated to the selected scope. |
| `core-flows.spec.ts` › mobile: bottom nav + drawer navigation | **fail** (webkit-iphone) | **Pre-existing.** Navigation and shell files are untouched by this session. |

These were not fixed (out of the selected scope) and are not counted as passes anywhere
in this report. The audit's recorded lane baseline (journal #10) covered `smoke.spec.ts`
only, so `core-flows` had no established green baseline to regress from.

### Web lane totals

`npx playwright test web/` → **13 passed, 3 failed (all pre-existing, above), 12 skipped**.

## Blockers

| Blocker | Impact | Exact unblock |
|---|---|---|
| Household Google account is `needs_reconnect` | WP-005 live acceptance cannot be attempted. The mocked lane is complete and carries the structural verdict per DEC-007. | The user reconnects Google in Connections **with the Send email (gmail.send) scope**, then a single `homeops.notify_contact` run to a verified, opted-in, agent-allowlisted method for wrhixon@gmail.com. |
| Production runs c0c4596 (pre-fix) | No fix in this session is verifiable in production. All claims here are LOCAL only. | Orchestrator/user deploys, then verify served bundle identity before any production claim (DEC-008). |
| Native iOS lanes CLOSED (DEC-10) | Client honesty states have web-lane + code proof only; native rendering parity is an accepted, recorded risk. | User reopens the lane and supplies device-cloud credentials + an app artifact. |

## Test-data hygiene disclosure

The browser pass drives the REAL local stack, so it created **9 run records titled
`TG-Web honesty check`** in the local dev tenant (`server/.data/tenants/local`). They are
inert, completed, clearly labelled, and touched no real family records — a read-only
audit of the tenant confirms **0** TG- agents, skills, triggers, or contact methods.

They were **not deleted**: runs are immutable audit history and the API exposes no run
delete route, so removing them would mean hand-editing a live SQLite audit store. That
is a worse action than leaving nine labelled test rows. Flagged here for the
orchestrator/user to remove if they want a pristine tenant.

The dev stack was left **down**, as found.
