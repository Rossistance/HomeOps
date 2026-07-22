# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

Run run-20260721-054151 · FamiliOS web (D:\FamiliOS\FamiliOS, commit 568c51f) · Audit lead, 2026-07-21. Companion registers under `audit/` are canonical for detail; this report is sufficient to decide.

## 1. Executive verdict and highest-value decision

**Verdict: the engine works; the family can't see it.** FamiliOS's server-side task runtime — planning, durable runs, approval gates, consume-once execution, self-repair — executed correctly in live testing. What is broken is the last foot of every journey: the web app **never reads back** the four places where the server records what needs you and what was done. Approvals are never fetched (the Inbox says "Nothing to approve" while a run waits and then dies at its 30-minute deadline — EV-004/005/032), server notifications have no consumer at all (EV-030), run artifacts including "review-first" drafts render nowhere (EV-019), and a created task with no due date is invisible on every screen (EV-015). On top of that, the outcome summary counts a draft-writing tool as "delivered" (EV-032 §3), so the chat says "Done — delivered" about work nobody can find. That combination is precisely the reported experience: *things seem to happen, nothing appears in the Inbox, nothing ever finishes.*

The resident household's own data confirms the diagnosis at scale: 6 approvals still pending (invisible), 6 runs expired waiting, 7 runs parked forever on connectors, and 15 AI self-"improvements" silently applied to helper instructions with no review surface (EV-031).

**Highest-value decision: select the recommended bundle (menu items 1–4).** It wires the four missing read-models, fixes the false "delivered" claim, unifies the two run histories, and gives every result a visible home — the smallest coherent vertical after which the user's own success sentence ("hey can you do this" → "done, as you requested" — *and it visibly is*) passes end-to-end.

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- Scope: full convergent-360 audit of the web app (src/ + server/) with live E2E repro, code trace, resident-data enumeration (read-only), LM Studio probe, and Supermemory research. Out of scope: code fixes, native iOS, deployment, external sends. Authorization: read-only on repo and resident data; disposable local dev instance + disposable tenant `hh_849af84da549` for interactive testing.
- Environment: Windows 11, Node v25.8.2 (engines field says `<25` — stale but functional), backend :8787, vite :5173, browser-runtime :9223 (EV-028). AI for repro: deterministic fake Ollama-protocol provider mirroring the repo's own hermetic test pattern (DEC-011, EV-029/040) — pipeline mechanics are model-independent; plan-quality observations are not claimed.
- Evidence limits: OAuth-gated connectors (Google/Microsoft/Slack/Dropbox/SMS/devices) unreachable — named per feature, never counted verified. LM Studio auth-blocked (EV-035). Resident tenant inspected on disk only, never signed into. Prior runs' COMPLETE verdicts treated as historical claims; every current-state statement re-verified this run.
- Parity: the audited dev instance was built from the audited working tree — source/runtime parity holds locally. Production (Render "homeops-ai") parity NOT verified this run; no production claims are made.

## 3. Capability inventory and agent topology

Used: Playwright MCP (screenshot-led crawl + interactions), Bash/PowerShell + node:sqlite (read-only data enumeration), Read/Grep (code trace), WebFetch (Supermemory research), mem scripts (journal/artifacts), curl (LM Studio probe). Single audit lead held all mandate roles in separated passes (product/UX, full-stack, personas, evidence QA, synthesis) — no concurrent-writer risk; limitation disclosed per mandate rule 3. Unused-but-available: chrome-devtools MCP (not needed; console clean), Agent fan-out (context economy favored one lead).

## 4. Application understanding

FamiliOS is a family operating system: approval-gated AI helpers do household admin across inbox triage, calendar, meals, bills, documents, devices, and family messaging. Architecture: React/Vite SPA + Node ESM backend with per-household SQLite tenants; per-actor OAuth; a durable server run engine with human approval gates, idempotency, recovery, self-repair, and an evolution ("improvements") loop; tz-anchored scheduler; six AI-provider adapters. A local-first heritage client store (zustand/IndexedDB) predates the server engine and still owns most of what the UI renders — the load-bearing seam of this audit. Strengths worth preserving: the engine's honesty machinery (server-authoritative approvals bound to input hashes, effect-claim guards, truthful readiness vocabulary, visible policy clamps), the tenancy model (one SQLite file per family; deletion = directory removal), the contact-method registry (verified + opt-in + per-agent allowlist as standing consent), the calm, coherent visual system with Calm Mode, and honest empty states throughout (EV-001…EV-027).

## 5. Observed product intent, inferred vision, success measures, and contradictions

See audit/product-intent-register.md (PI-001…PI-012). Core promise: plain-English ask → really-done task with human sign-off on anything risky (PI-002). Central contradiction (PI-006): the copy and client store still speak local-first ("everything stays on this device", "IndexedDB (primary)") while execution truth moved server-side — ISS-001/002/005 are this contradiction expressed as defects. Secondary contradiction: an engineering culture of "no mock success" (PI-010) undermined by one remaining name-regex heuristic that fakes "delivered" (ISS-003). Success measure implied by the user's own data (three Gmail-cleanup agent attempts, a 7 AM briefing trigger): unattended schedules that actually deliver, and one visible end-to-end task.

## 6. App Functionality Inventory and coverage

36 features inventoried with statuses and trace matrix in audit/functionality-inventory.md. Coverage (honest, per mandate):

```
Execution coverage: 30/36 = 83%   (all safely-reachable surfaces exercised; 6 named gaps)
Verified coverage:  11/36 = 31%   (UI+server evidence both present; partial/blocked never counted)
Persona coverage:   27/36 = 75%
```

Named blockers: external OAuth apps/API keys absent (13 of the 22 benchmark use-cases gated — EV-020), LM Studio token (EV-035), child web session (ISS-012), backups left unexecuted deliberately.

## 7. Five canonical persona cards

> Synthetic-research disclosure: these five personas are research instruments grounded in current-run evidence (resident data, roles, registries), not interviewed customers. Their quotes and wishes are simulated hypotheses requiring real-user validation.

### Persona 1 — Ross, the Owner-Builder
Owner; high technical fluency; built 18 agents, 16 playbooks, 13 skills, 4 functions, 3 triggers on the resident tenant (EV-031). Goal: one verifiable end-to-end task; success = seeing the result where the app said it would be. Urgency high after repeated "COMPLETE" claims that didn't survive contact with the UI. Data: large, real, with duplicates (three near-identical Gmail-cleanup agents). Device: desktop Chrome. Risks: abandons trust in "Done"; suspects his own improvements data. Evidence-grounded; motivations inferred.

### Persona 2 — Maya, the Busy Parent
First-time household owner; low technical fluency; phone + laptop. Goal: one-sentence asks that just happen (tasks, notes, groceries). Success: the thing is where the app points her. Likely failure mode (observed live): told to "review it in your Inbox", finds it empty, waits, the approval expires, concludes the product lies. Fresh-tenant data; journey executed live this run (JRN-2).

### Persona 3 — Noah, the Child (Child View)
Child role; shared device; AI chat gated off by policy; cannot approve. Goal: see his chores, ask for a ride. Currently cannot even enter a web session in a signed-up household — the profile picker only offers the resident household (ISS-012, EV-027). Role gates verified in code; UI journey blocked (that blockage is the finding).

### Persona 4 — Grandma Ellen, the External Recipient
Not a device user; receives digests via email/SMS through the contact-method registry (verify + opt-in + per-agent allowlist). Goal: the Friday digest arrives (UC-4). The registry's fail-closed refusals are excellent (notify.mjs); the path is unreachable end-to-end without email/SMS credentials, and from chat entirely (ISS-004).

### Persona 5 — Sam, the Scheduler
Adult Admin; optimizes unattended automations (07:00 briefing, Sunday syncs). The tz-anchored scheduler is correct (EV-039), but an unattended gated run parks invisibly, push goes only to Expo tokens, and the run expires unseen — the resident tenant's 6 expired runs are Sam's mornings (EV-031).

## 8. Five end-to-end journey narratives and step tables

Full step records in audit/journey-register.md. Narrative summaries:

- JRN-1 (Ross, live): template agent created; 11-tab detail; Run now parks on missing Google; chip mislabels the cause "Waiting for Approval" (EV-009); Automations history shows only this run while two chat runs exist server-side (EV-011); five separate builder entry points counted (EV-026). Partial pass; ISS-005/007/011/013.
- JRN-2 (Maya, live — the mission journey): onboarding → honest no-provider refusal → provider configured through real Settings UI → ask again → plan auto-runs and parks → **Inbox and Approvals empty while chat says "Review it in your Inbox"** (EV-003/004/005) → control-approve via the server's own contract → run completes → chat: "Done — delivered 2 steps" with `/api/notifications` EMPTY and the draft invisible (EV-032 §3) → clean no-approval variant completes 2/2, task + list item written and verified via API, **visible nowhere** (EV-015). Verdict: user journey FAIL; server mechanics PASS. This single journey is the whole complaint, reproduced and explained.
- JRN-3 (Noah, live attempt): child member created and confirmed server-side (EV-037); sign-out; picker offers only resident "Ross" (EV-027) — BLOCKED, ISS-012.
- JRN-4 (Ellen): registry preconditions and refusal honesty verified; external channels unreachable in env — BLOCKED externally, correctly disclosed by the product.
- JRN-5 (Sam): scheduler code + resident trigger data verified (EV-039); unattended delivery chain unproven and currently impossible past a gate (ISS-001/002/004 chain).

## 9. Visual and product design audit

Strong: coherent warm design system, consistent PageHeader/Tabs/Cards, honest empty states everywhere, Calm Mode + reduced-motion respect, readable typography, sensible information grouping, clean console (EV-033). Issues: run-status chips contradict their own subtext (EV-009); the chat plan card renders a "Run (with approvals)" affordance on an already-running plan (EV-003); Activity Log leaks `run.step · gmail.search — not_connected` to families (EV-012); parked status renders above the question that caused it (EV-032 §3); duplicate "Recent" chat entries after a failed first attempt; mobile 375px renders with only minor banner-wrap awkwardness (EV-024); no dedicated tasks surface (EV-015). Nav taxonomy fragments one mental model across six entries (EV-002/026). No overflow/clipping/contrast blockers observed on crawled screens; zoom sweep not performed (disclosed limit).

## 10. Full-stack audit

Frontend: well-typed API client, but the store is a second source of truth (~2 kLoC) with per-second polling of ten collections (EV-030) and a mirror that most run sources never trigger; status-enum mapping loses causes. Backend: high quality — single router with explicit gates (session/CSRF/role/childAiGate/planGate), server-authoritative approvals bound to input hashes, idempotent step execution, bounded retries, soft-fail for read enrichment, stall/expiry sweepers (gap: connector-parked runs never expire — ISS-017), recovery honoring at-most-once, fail-closed registered functions, per-agent send allowlists, kill-switch coverage incl. email path, sanitized provider errors. Data: per-tenant SQLite with WAL, keyed-collection vs kv discipline, quarantine-on-corruption, human-readable export/import; legacy *.tmp files at data root are inert pre-migration artifacts (.migrated present). Security/privacy posture is thoughtful (vault-only secrets, no tokens client-side, loopback allowlist for local providers); exceptions: resident profile-name exposure pre-auth (ISS-015) and the profile picker tenancy bug (ISS-012). AI layer: six adapters with fallback chain and truthful readiness; LM Studio adapter can send bearers but the UI cannot capture one (ISS-006). Scheduler: tz-anchored with DST handling (EV-039). The evolution loop writes real instruction changes with an AI-judge gate but no human review surface (ISS-007).

## 11. UI-to-Backend Trace Matrix

Ten meaningful actions traced end-to-end (control → component/state → request → handler → authz → domain → mutation → response → visible status → recovery) in audit/functionality-inventory.md §Trace Matrix, including both FAIL rows: the approvals surface (renders local store; required GET exists unused) and the notification step (draft artifact + "delivered" claim + empty notifications list).

## 12. Convergence and misalignment map

- Design and architecture reinforce each other: approval-card UX ↔ consume-once approvals; honest empty states ↔ truthful readiness vocabulary; contact registry UI ↔ fail-closed send gates.
- UI masks backend truth: Approvals "Pending (0)" over a pending server approval; "All caught up" over parked runs; Files & Knowledge "0" over real artifacts; Run History omitting chat runs.
- Backend complexity leaks into UI: agents/skills/functions/playbooks/triggers taxonomy as six nav surfaces; raw audit strings in Activity.
- Product language contradicts behavior: "Review it in your Inbox" (no inbox read-model); "delivered" (draft only); "local-first" copy vs server-authoritative execution.
- Intended workflow lacking technical support: chat-initiated external delivery (agent attribution gap); unattended approval flows (no visible surface + 30-min TTL).
- Technical capability lacking product expression: notifications API, artifacts API, GET /api/approvals, run summaries as knowledge, versions stores (no diff/revert UI).

## 13. Canonical master issue register

17 root-cause issues in audit/issue-register.md. Order of attack: ISS-001, ISS-002 (P0 read-models) → ISS-003, ISS-004 (truthful delivery) → ISS-005, ISS-011, ISS-009, ISS-008 (one run world + result homes) → ISS-006, ISS-007 (LM Studio auth; improvements safety) → ISS-010, ISS-012, ISS-017 → ISS-013 (unification umbrella) → ISS-014/015/016 (polish).

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

Accessibility: semantic roles/labels broadly present (usable a11y tree throughout the crawl); switches/tabs keyboard-reachable; NOT claimed: WCAG conformance — no screen-reader pass, no contrast measurement, no zoom sweep (named limits). Responsive: 375px spot-checks clean with minor wraps (EV-024); full viewport matrix not swept (limit). Performance: idle polling storm ~11 req/s/tab (ISS-010); no render jank observed; provider timeouts generous. Security/privacy: strong vault/tenancy/consent architecture; pre-auth profile-name exposure (P3) and picker tenancy bug (P2) are the exceptions; no secrets in client or logs observed; audit evidence sanitized. Resilience: engine recovery/idempotency strong; connector-parked runs lack TTL (ISS-017). Content/trust: warm, honest copy except the three trust-breakers (Inbox pointer, "delivered", status labels) — exactly where the user's trust broke.

## 15. Persona debrief (synthetic hypotheses)

Ross: "One list of everything that ran, one place to approve, and show me a diff before you rewrite my helpers." Maya: "If it says done, show me the thing. If it needs me, put a red dot somewhere obvious." Noah: "I can't even get in on the computer." Ellen: "I just want the Friday email; tell Ross if it stops." Sam: "A schedule that needs my approval at 7 AM must ping my phone and my inbox, and wait longer than 30 minutes." Wished-for features (hypotheses): daily digest of run outcomes; one-tap re-run; per-helper reliability score derived from run history.

## 16. Comparator and research insights

- Supermemory (supermemory.ai/docs/self-hosting/overview; github.com/supermemoryai/supermemory, fetched 2026-07-21 — EV-036): MIT, TypeScript/Node, `npx supermemory local`, single binary, embedded graph engine, port 6767; local embeddings default (Xenova/bge-base-en-v1.5); "run end-to-end on your machine with a local model — Ollama, **LM Studio**, vLLM, llama.cpp"; API add/search/profile with containerTag scoping (clean map to householdId). Feasibility vs current memory (flat memory.json + recency slice into prompts): direct upgrade path; Qwen3.6-27B via LM Studio satisfies its LLM need once ISS-006 (token) is fixed; embeddings need no LM Studio at all (bundled local model). Fallback if the sidecar disappoints on Windows: node:sqlite FTS5 hybrid inside tenant-db (DEC-014).
- LM Studio auth (EV-035): current builds require API tokens (`invalid_api_key`, dummy rejected as malformed) — any local-AI or Supermemory-LLM plan must carry the token; FamiliOS's UI cannot capture one today (ISS-006).
- OpenClaw/Hermes-level bar: operationalized as the 22-use-case executable suite (WP-006) rather than an adjective — pass/fail per UC through the real UI, gated UCs sandbox-verified with named real-credential blockers (DEC-016).

## 17. Opportunity register and novel-feature portfolio

Evidence-backed opportunities (each traces to intent + existing capability): (a) "What ran while you were away" daily digest assembled from run history + notifications — data already exists (FEAT-016/011), fits PI-011; (b) per-helper reliability score + last-outcome chip on agent cards from runs data — fights silent degradation, near-free after WP-003; (c) approval push via the contact-method registry (email/SMS "Approve?" links) — reuses WP-005-era registry and closes Sam's 7 AM gap beyond Expo push; (d) knowledge library auto-filing of run summaries already half-built (engine writes artifacts — FEAT-019) — expose + tag; (e) template dedupe: 12 agent + 23 automation + 20 dashboard templates collapse into one packaged catalog (part of WP-005). Horizons: (b),(d) MVP; (a),(e) near-term; (c) later (external-send consent design).

## 18. Prioritized remediation plan

1. Immediate P0 stabilization: WP-001, WP-002 (read-models + truthful delivery).
2. Cross-layer MVP shaping: WP-003, WP-004 (one run world; results have homes) — the recommended bundle boundary.
3. Architecture correction: WP-006 (orchestration entry + benchmark), WP-007 (memory), WP-005 (unification IA + migration).
4. Visual/interaction refinement: status labels (in WP-003), activity humanization (WP-011).
5. Performance/reliability: WP-009 (sync), WP-011 (lifecycle TTL).
6. Deferred: WP-010 (roles/web), WP-012 (connector provisioning), opportunities (a)–(e).

## 19. Implementation-ready brownfield PRD

audit/prd.md (this run) — problem/evidence, personas, goals G1–G5 with measures, chosen-vs-rejected solutions, target journey contract, UX/state/backend/data requirements, budgets, per-use-case acceptance criteria, validation plan, slice order, rollout/rollback, risks, definition of done.

## 20. Orchestrator-ready implementation work packages

audit/work-packages.md — WP-001…WP-012, each with objective, IDs, slices, acceptance criteria, validation, risk, rollback, sequence, effort. Mirrored to audit/implementation-queue.md.

## 21. Numbered implementation menu and recommended bundle

| # | Item | Value | WPs | Risk | Effort |
|---|---|---|---|---|---|
| 1 | The Inbox tells the truth (approvals + notices visible, decidable) | unblocks every gated task | WP-001 | Low | M |
| 2 | "Done" means done (no false "delivered"; chat can deliver in-app) | kills the false-success class | WP-002 | Med | M |
| 3 | One run history everywhere (+ correct status labels, no double-run) | one mental model of execution | WP-003 | Med | L |
| 4 | Every result has a home (tasks surface, artifacts library, deep links) | "Done" always shows the thing | WP-004 | Low | M |
| 5 | Helper Agents unification (redesign A) | one surface, packaged helpers, 51→≤20 migration | WP-005 | High | XL |
| 6 | Orchestration harness to the 22-use-case bar (redesign B) | executable reliability benchmark | WP-006 | High | XL |
| 7 | Memory brain: Supermemory + LM Studio token fix (redesign C) | local retrieval-grade memory | WP-007 | Med | L |
| 8 | Improvements made reviewable (diff/revert, default off) | self-changes become inspectable | WP-008a | Med | M |
| 9 | OPT-IN improvements safe wipe — backup-first, dry-run report, selective revert of the 15 auto-applied rewrites, archive-not-delete, printed diff, backup rollback | settles "did improvements break it?" | WP-008b | Med, reversible | M |
| 10 | Calm the sync storm (rev-gated hydration) | ~660→≤6 idle req/min | WP-009 | Low | M |
| 11 | Family roles work on web (profile picker fix, child sessions) | JRN-3 unblocked | WP-010 | Med | M |
| 12 | Trust & lifecycle polish (plain-language activity, parked-run TTL) | quiet honesty everywhere | WP-011 | Low | S-M |
| 13 | Connector provisioning for the 13 gated use-cases (+ sandbox) | real Microsoft/Slack/Dropbox/SMS UCs | WP-012 | Low code | M + user setup |

**Recommended bundle: items 1 + 2 + 3 + 4 — "One task, truly done."** Smallest coherent vertical making the mission's success sentence pass end-to-end; closes every P0 and most P1s; foundation for redesigns 5–7 (suggested follow-on order: 6 → 7 → 5).

Which numbered improvement, feature, or recommended bundle should I implement now?

## 22. Decision log and rejected alternatives

audit/decision-log.md — DEC-010 (historical carry) and DEC-011…DEC-017: fake-provider repro choice, read-model root-cause framing over race theory, retiring the shadow console, Supermemory selection with fallback, wipe-as-selective-revert over blanket delete, gated-UC benchmark honesty, crawl-depth budget call.

## 23. Remaining unknowns and next discriminating checks

audit/hypothesis-queue.md — open: HYP-002 (per-record improvement diffs — next: version-store diff script, read-only), HYP-003 (failure-class histogram of the 23 resident failures), HYP-004 (one real-provider run once a key/token is supplied), HYP-005 (Qwen3.6-27B latency profile), HYP-006 (/api/rev semantics), HYP-007 (does the mobile app consume notifications/approvals — determines shared-client placement of WP-001).

## 24. Evidence index

audit/evidence-ledger.md — EV-001…EV-040 (27 inspected screenshots, server/provider logs, network capture, two data-enumeration files, LM Studio probe, Supermemory research, code citations, API-truth captures). Raw files under audit/evidence/.

## 25. Screenshot gallery

Inspected originals, in capture order (annotations not required — each screenshot's caption in the evidence ledger states what it shows; no annotated copies were produced this run):
SS-001-onboarding.png · SS-002-dashboard-fresh.png · SS-003-chat-plan-parked-with-run-button.png · SS-004-inbox-empty-while-run-parked.png · SS-005-approvals-tab-zero-pending-while-server-parked.png · SS-006-chat-fence-task-completed.png · SS-007-helper-agents.png · SS-008-new-agent-flow.png · SS-009-agent-run-status-mismatch.png · SS-010-automations.png · SS-011-automations-run-history.png · SS-012-activity-memory.png · SS-013-improvements-tab.png · SS-014-household-spaces.png · SS-015-dashboard-after-task.png · SS-016-calendar.png · SS-017-meals.png · SS-018-mini-apps.png · SS-019-files-knowledge.png · SS-020-connections.png · SS-021-skill-builder.png · SS-022-function-builder.png · SS-023-contacts-tab.png · SS-024-mobile-messages.png · SS-025-lock-profile-switch.png · SS-026-workflow-builder.png · SS-027-profile-picker-wrong-household.png
