# Evidence Ledger — run-20260723-143314

Subtypes: SS screenshot/video · DOM · NET network · CON console · LOG · CODE source · TEST · DATA · DEC decision · RES research

| EV-ID | Subtype | Location | What it proves | What it does NOT prove | Captured (UTC) |
|---|---|---|---|---|---|
| EV-101 | SS | jam.dev/c/7b44f45c-982c-4b50-8172-619c6b951934 (16:06, iOS 27, iPhone 13 Pro Max) | iOS calendar journey: anniversary spans 2 days; created event absent from list; deleted event resurrects after sync; keyboard occludes inputs; long titles never wrap | Not the web app; no console/network traces (Jam CDN 404) | 2026-07-23T03:49Z |
| EV-102 | SS | jam.dev/c/7631fa90-c888-43d3-a9d1-c81167c41f45 (20:01) | Web builder/control plane: contradictory capability counts ("six permitted… five permitted"), approval sprawl, per-skill approval toggles, web≠iOS event detail (missing end date) | Intent extraction returned only 0:00–1:46 of 20:01 across two attempts — recording is under-covered by the tool | 2026-07-23T13:21Z |
| EV-103 | SS | jam.dev/c/34ef54ca-7bf9-4baf-b9ae-894b5c522410 (18:19) | Web runtime: `no_acting_agent`, `no_recipient`, `fetch_failed`, `provider_error`; duplicate Morning Briefing helpers; template agents absent; grocery mismatch; memory duplicates | Same Jam CDN 404 for console/network artifacts | 2026-07-23T13:18Z |
| EV-104 | DATA | analyzeVideo output for EV-103, 3,261 lines, read in full across 3 chunks | 13 structured segments with selectors, timestamps, and per-finding impact ratings | Structured events are the tool's inference layer, not raw DOM/network logs | 2026-07-23T14:05Z |
| EV-105 | CODE | server/orchestrator.mjs:126 | `runSkill` resolves `agentId ?? skill.defaultAgentId ?? null` — a skill with no default agent starts a run with a NULL acting agent | Does not enumerate which resident skills lack `defaultAgentId` | 2026-07-23T14:20Z |
| EV-106 | CODE | server/internal-functions.mjs:487 | The `no_acting_agent` refusal is emitted when `ctx.agentId` is null, because recipient allowlists are granted per-helper | — | 2026-07-23T14:20Z |
| EV-107 | CODE | src/store/useStore.ts:2234-2259 | `createAutomationFromTemplate` never reads `tmpl.multiAgent`; resolves exactly ONE agentId via a 5-step fallback ending in "first active agent" | — | 2026-07-23T14:20Z |
| EV-108 | CODE | src/data/workflowTemplates.ts:149,882 | Only 2 of 23 templates carry `multiAgent`; it is display-only data (name/role/icon) | — | 2026-07-23T14:20Z |
| EV-109 | CODE | grep `useTemplate\|createFromTemplate\|instantiateTemplate` over server/ → 0 matches | Template instantiation is entirely client-side; no server-side compile/validation gate exists anywhere | — | 2026-07-23T14:20Z |
| EV-110 | CODE | server/calendar.mjs:24 | `endAt: e.end?.dateTime ?? e.end?.date ?? null` stores Google's EXCLUSIVE all-day end date verbatim | — | 2026-07-23T12:15Z |
| EV-111 | CODE | apps/mobile/src/lib/event-days.ts:16 | `coversDay` returns `d0 >= s0 && d0 <= max(s0,e0)` — treats the end day INCLUSIVELY | — | 2026-07-23T12:15Z |
| EV-112 | CODE | src/miniapps/index.tsx:33-41 | `BOARD_TASK_TYPES = {chore,task,reminder,errand}`; `type:"list"` (grocery/packing) and bills are deliberately excluded from the Chore Board | Does not identify which surface produced the conflicting grocery count | 2026-07-23T14:35Z |
| EV-113 | CODE | src/store/useStore.ts:2178-2189 | `toggleAutomation` is a pure metadata write (enabled/status/updatedAt + toast) — it does NOT start a run | — | 2026-07-23T14:35Z |
| EV-114 | CODE | src/store/useStore.ts:2121-2150 | `createAutomation` creates + toasts only — no auto-run on creation | — | 2026-07-23T14:35Z |
| EV-115 | TEST | `npm test` @ HEAD 711f56c | 549 tests, 548 pass, 0 fail, 1 honest skip (Windows sidecar, DEC-014) | A green server suite does NOT prove web/iOS UI correctness — the central lesson of this audit | 2026-07-23T14:33Z |
| EV-116 | TEST | `npm run typecheck` @ 711f56c | Exit 0, clean | — | 2026-07-23T14:33Z |
| EV-117 | RES | docs/chatgpt-reports/HomeOps_Split_Jam_Investigation_and_Engineering_Bug_Tickets.md (46,989 B, read in full) | Independent LLM analysis converging on RC-1..RC-10 and HO-001..HO-012 | Self-labels its architectural causes as unverified hypotheses; that session had no repo access | 2026-07-23T09:53Z |
| EV-118 | RES | docs/chatgpt-reports/HomeOps_Jam_Calendar_Investigation_and_Bug_Ticket.md (22,340 B, read in full) | Independent calendar analysis; CAL-001..CAL-015 test plan; all-day exclusive-end hypothesis | Same session had no repo/Render/TestFlight access | 2026-07-23T09:53Z |
| EV-119 | DEC | docs/jam-triage-2026-07-23.md | Base triage: 29 tickets, 11 clusters, FIN-001 production-vs-local finding | — | 2026-07-23T12:25Z |
| EV-120 | DEC | docs/jam-triage-2026-07-23-addendum-web.md | 9 new tickets BUG-030..038; 2 code-confirmed root causes | — | 2026-07-23T14:15Z |
| EV-121 | CODE | render.yaml (`HOMEOPS_DATA_DIR=/data`, `disk: homeops-data`) vs migration report "Resident tenant: `local`" | Production data lives on a Render disk; every 2026-07-21/22 data operation targeted the local dev tenant → production data was never migrated | — | 2026-07-23T12:15Z |
| EV-122 | NET | `GET https://homeops-ai.onrender.com/api/health` | Production runs the shipped code: `memoryProvider.backend:"sqlite-fts5"`, `browserRuntime:false`, env production, node v24.18.0 | Confirms code deployed; says nothing about production DATA state | 2026-07-23T12:15Z |
