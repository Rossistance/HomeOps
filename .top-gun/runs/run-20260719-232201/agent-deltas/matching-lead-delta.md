# Matching Lead Delta — run-20260719-232201

- Agent: matching-lead · Date: 2026-07-20 (UTC)
- Output: `matching/capability-task-matching.md` (ART-012, snapshot sha256:6ccc9568ffb1) — validator PASS, 0 warnings.

## What was produced

- Context gate PASSED with real skills: `product-management:write-spec` and `design:design-critique` both invoked and loaded in this session (no two-field fallback needed); their framings are recorded in the guide header and applied to task decomposition and the event-editor/upload-UX/one-save design directions.
- Capability map: 25 evidence-backed rows probed this session — local stack :8787/:5173/:9223 all listening (netstat), playwright-web reconfirmed use-now (v1.61.1 + config + runtime-drivers.json manifest), Playwright MCP tools proven loadable via ToolSearch, model aliases haiku/sonnet/opus/fable observed, appium/appetize re-affirmed BLOCKED (facts-and-notes probes, user-side unblocks), Google Calendar MCP + build/store MCPs classified policy-forbidden.
- Task matrix: WP-001..004 decomposed into 13 implementation/verification tasks + T-501 (TG- residue hygiene, XS) + T-601 (final integration verification, reserve). Server vs apps/mobile write surfaces strictly separated (ISS-005's cross-layer slice split into T-303 server / T-304 mobile). Two routes compared per task with rejected-route reasons; live-Google route safety-VETOED (DEC-08).
- WP-008/ISS-013 testIDs: phase-matrix note, NOT a task row — no bundle verification lane consumes native locators while drivers are blocked.
- Budgets: 343k soft total (WP-001 102k, WP-002 38k, WP-003 119k, WP-004 48k, hygiene 6k, final verify 30k); reserve 54k = 15.7% (verification-only); recommended phase ceiling ≤360k. All soft — host enforces no hard limit.
- Models/effort per canonical tables: mostly sonnet/medium; sonnet/high for T-101/302/303/401; fable/xhigh for T-601 final verification; haiku-class for T-501.
- Concurrency: G-SRV serialized, G-MOB-A (event-form chain) serialized, G-MOB-B parallelizable (code-only), G-VER lead-serialized (run-1 one-browser lesson), chunked-write discipline restated.

## Notable facts for the orchestrator / implementation lead

- Node drift: session PATH resolves node v20.20.2 (facts handoff said v25.8.2); :8787 server (PID 65696) predates this session — confirm it survives any restart under the current PATH.
- Mobile typecheck has no packaged script: use `npx tsc --noEmit` in `apps/mobile` (confirm on first use).
- 291/291 server baseline is run-1 historical — mandatory re-run at implementation start.
- Google-push routes: contract/mock only, NEVER live (one contained 401 incident already, DEC-08).

## Budget consumed (this matching phase)

Approx. 30-35k output tokens vs 100k soft — well under plan; checkpoint after inventory recorded (journal #22).
