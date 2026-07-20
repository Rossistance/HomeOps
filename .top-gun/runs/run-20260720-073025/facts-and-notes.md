# Facts and Notes — Mission Handoff

- Run: run-20260720-073025
- Goal: Discover and fix why Ask Famili agent-chat tasks (e.g. creating a scheduled daily-briefing email agent) report successful runs but never actually execute or deliver (no email sent, applies to every task type in chat)

## Mission and boundaries

- User report (verbatim intent): telling Ask Famili "create an agent that sends a daily morning briefing to wrhixon@gmail.com, every day at 7 AM" (weather 7-day, calendar/tasks 7-day, top-5 global + local news with links, family updates) "results in what it says is a successful run, but never actually runs or sends the email" — and "this happens for every single type of task inside of my chat." User wants the CAUSE discovered and FIXED.
- Success = root cause identified with evidence, fix implemented and verified end-to-end on the authoritative local path (a chat-created scheduled agent actually fires and actually attempts real delivery, or honestly reports why it can't — no false success anywhere in the chain).
- Non-goals: native iOS visual confirmation (postponed by DEC-10 of run-20260719-232201 — user decision 2026-07-20); Render production probing beyond /api/health (live family data, standing policy); live sends to real family contacts without explicit approval.

## Observed facts

- **Surface map (HEAD 2c53541/c0c4596, all read this session):**
  - Chat client: `apps/mobile/src/app/(ask)/index.tsx` — sends via `streamAssistant` → fallback `POST /api/assistant`; result kinds: answer | plan | build. Builds go through `api.buildFromChat(build, conversationId)`; plans run via server-durable runs (`watchServerRun` polls `api.getRun`) or the mobile-local `useRun().startRun(plan)` path (line ~397 `runPlan`). BOTH run paths exist in the client.
  - Server: `server/triggers.mjs` (230 lines, read fully) — real persisted trigger engine: types schedule/recurring/webhook/connector_event/manual; `tick()` fires due triggers exactly-once, caps 10/tick, 3/household/tick; fires through `orchestrator.runAgent/runSkill` as durable runs.
  - Tick IS wired: `server/index.mjs:3244` `setInterval(() => { void forEachTenant(() => tick()); }, 10_000)`.
  - Email delivery: `server/notify.mjs` `deliverViaChannel` — email channel is REAL Gmail API send (`gmail/v1/users/me/messages/send`) but hard-gated: requires a connected Google account for the actor with a `gmail.send` scope, plus (registry path) a verified + opted-in contact method with per-agent allowlist. Fails closed with `needsSetup` messages — never fakes success at THIS layer.
  - "No simulation" doctrine claimed in headers of `engine.mjs`, `functions.mjs`, `internal-functions.mjs`, `ai.mjs`, `planner.mjs`, `connectors.mjs` (grep evidence this session).
- **Scheduling model:** `recurring` triggers use `intervalMs` from creation/last-fire (`nextRunAt = now + intervalMs`) — there is NO cron/time-of-day/timezone anchor field in `triggers.mjs`. "Every day at 7 AM" must be mapped by the build layer to runAt+intervalMs; anchor drift or wrong initial runAt would fire at the wrong time or never visibly at 7 AM.
- **Local stack DOWN right now:** netstat shows nothing on :8787/:5173/:9223; `curl localhost:8787/api/health` empty (this session).
- **Production runtime is STALE:** Render autoDeploy broke — pushes 2c53541/c0c4596 (2026-07-20) created no deploy; prod serves pre-mission-2 bundle `index-Cu2Tvfl5.js` / commit ffcfa33 lineage (verified this session via GitHub deployments API + live bundle hash). The user's TestFlight app (build 19; build 20 uploaded ~07:00Z today) points at `https://homeops-ai.onrender.com` (eas.json env EXPO_PUBLIC_API_URL).
- **Household Google account is stale/broken in prod-adjacent data:** run-20260719-232201 DEC-08 recorded a live Google push attempt rejected 401 (stale connected account). gmail.send delivery depends on exactly this class of account.
- **Prior known-related 30-day goals** (historical, from FamiliOS discovery memory + archived run-20260720-072344 goal): "demonstrate the real-provider end-to-end loop" and "migrate mobile plan dispatch to the durable server run engine" — i.e., the team already believed the chat→execution loop was not fully real end-to-end. HISTORICAL — must be revalidated in this run.
- **Node/test baseline:** default node v20.20.2; missions use nvm v25.8.2; server suite was 308/308 green at HEAD this morning (release-ops session).
- **Concurrent-session risk:** a second session bootstrapped run-20260720-072344 at 07:23Z (goal: 30-day priorities) and was actively writing snapshots (ART-001/ART-002 discovery) while this run was created at 07:30Z; its current-run pointer was archived to `.top-gun/archived-run-run-20260720-072344.md` per bootstrap-script instruction. Registers of THIS run are authoritative for THIS mission only.

## Supported inferences

- The false-success is most plausibly in one or more of: (a) the chat/build layer mapping "daily 7 AM email agent" into entities WITHOUT a correctly-anchored enabled trigger; (b) the run layer reporting a run "completed" while a notify/email step returned `ok:false, needsSetup` non-fatally (silent failure surfaced as success in chat); (c) the mobile-local `startRun` plan path completing client-side with no real server tools at all ("migrate mobile plan dispatch to durable server engine" being an open goal supports this); (d) the user's runtime being STALE prod code where fixes/features at HEAD don't exist. Basis: notify.mjs is honest fail-closed, triggers.mjs is real, but the seams BETWEEN chat→build→trigger→run→step-result→chat-summary are unverified.
- Because "every single type of task" fails to have real effect, a seam common to all tasks (run execution/reporting or the runtime version being stale) is likelier than a per-tool config gap alone. Basis: single-cause parsimony over the user's breadth claim.

## Unknowns and open questions

- Which runtime does the user chat against (prod TestFlight app vs local)? → Discriminates stale-prod-code from at-HEAD bug. Check: repro at HEAD locally FIRST; if unreproducible at HEAD, the stale prod deploy becomes a primary cause candidate.
- What exactly does `buildFromChat` create for "daily 7 AM email agent" (agent + trigger? automation? contact method?) → read `server/index.mjs` build route + `agents.mjs` + repro locally, inspect trigger record (nextRunAt, intervalMs, enabled, target).
- Does a fired agent run actually invoke email tooling, and what does the run summary say when a step fails with needsSetup? → fire a trigger locally, read run steps + conversation messages.
- Is the mobile "Run this plan" path (`useRun().startRun`) local-simulated or server-durable at HEAD? → read `apps/mobile/src/lib/run-context` + api.ts.
- Does the assistant/planner even represent "send email to X" as an executable step with a real tool id, or as prose? → planner.mjs + a live local repro transcript.
- Contact-method gate: would wrhixon@gmail.com be a verified/opted-in contact method in the user's household? (registry fail-closed = honest block, but chat may mask it).

## Authority and safety limits

- Local repo + local dev stack: full read/write/execute within mission scope.
- Production (homeops-ai.onrender.com): `/api/health` only; NO behavioral probes, NO data reads/writes (live family data; standing policy from prior runs).
- Google/live provider calls: contract/mock-level only unless the user explicitly authorizes a sandboxed account (DEC-08 lineage). NO live sends to real family contact methods; a test send may target a mission-owned inbox only with explicit user approval, or be verified below the transport (mocked fetch), which is the default lane.
- TestFlight/EAS/store actions: out of scope this mission (build 20 already submitted this morning).
- Render deploy: broken user-side (manual deploy needed) — treat as external gate; never claim production verification while it's stale.

## Capability inventory summary

- **use now**: full local toolchain (node 25.8.2 via nvm at `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2`, npm test suite 308/308 baseline, tsc both apps); local server+web stack via `scripts/dev.mjs` (currently down — boot required); Playwright web driver (v1.61.1, config + `tests/topgun/runtime-drivers.json` present — reconfirm on boot); Playwright/Chrome MCP tools loadable via ToolSearch; Gmail MCP bound to budgetbeacon.ai@gmail.com (observable test inbox IF live-send lane is ever authorized); GitHub API via git-credential-fill token (gh CLI absent); git push OK.
- **use if needed**: Browser pane (localhost preview); Chrome MCP (logged-in sessions); server test harness fakeProvider pattern (`server/test/assistant-persistence.test.mjs` — fake Ollama-compatible endpoint, the established way to drive the real engine without external AI).
- **unavailable / blocked**: Render API/CLI (no key — prod deploy is user-side); appium/appetize native lane (CLOSED as requirement by DEC-10 run-20260719-232201, user decision); live Google mutations (policy); production behavioral probes (policy); interactive OAuth MCP servers (session is non-interactive).

## Artifact links

- ART-001: this file (snapshot registered at handoff).
- Prior-run register lineage (historical context, not current proof): run-20260719-232201 DEC-08 (stale Google account), DEC-10 (native lane closed), issue/feature registers; run-20260719-073933 data-isolation lineage.

## Next discriminating checks

1. Boot the local stack (`scripts/dev.mjs`, node 25.8.2); confirm /api/health and suite baseline intact.
2. Repro at HEAD with the fakeProvider harness pattern or a real configured provider: send the user's exact briefing prompt through `POST /api/assistant` as an Owner; capture the result kind (plan/build), then `buildFromChat`; dump the created agent/automation/trigger records verbatim.
3. Inspect the created trigger: enabled? nextRunAt sane for "7 AM daily"? target correct? If no trigger exists at all → cause candidate #1 confirmed at the build seam.
4. Force-fire the trigger (or set nextRunAt=now) and trace the run: step list, tool ids invoked, notify/email step result, run status, and what lands in the conversation thread — the exact seam where `ok:false` becomes user-visible "success" is the bug locus.
5. Read `server/index.mjs` assistant/build routes + `planner.mjs` + `orchestrator.mjs` + `engine.mjs` step execution for the email tool path; read mobile `run-context` for the local-run path's reality.
6. Diff the user-visible prod lineage (ffcfa33) vs HEAD on the implicated seams to state precisely what the user's current app does vs what HEAD does.
