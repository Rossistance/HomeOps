# Capability-Task Matching Guide

Run run-20260720-073025 · FamiliOS (Ask Famili false-success fix) · HEAD c0c4596 · Produced by matching-lead 2026-07-20T12:2xZ · Inventory probed fresh this session (never inherited).

Scope: routes every menu item (master-report §21, WP-001..WP-006; recommended bundle = 1+2+3+4 per ratified DEC-A04) to capabilities, agent roles, models, efforts, budgets, and verification surfaces so the implementation lead can be dispatched the moment the user's selection is recorded.

## Capability Map

All probes executed 2026-07-20 ~12:16–12:24Z in THIS session unless noted. Authority column: RO = read-only, LW = local write, EW = external write.

| Capability | Classification | Evidence | Side-effect authority | Timestamp (UTC) |
|---|---|---|---|---|
| Core file/exec tools (Read, Edit, Write, Glob, Grep, Bash, PowerShell) | use now | Prompt-visible tool list this session | LW (repo) | 12:16 |
| ToolSearch deferred-tool loading | use now | Probe: `select:WebFetch` loaded schema successfully | RO | 12:23 |
| python 3.14.3 (mem/matcher validators) | use now | `python --version` probe | LW (.top-gun) | 12:23 |
| node v20.20.2 (default PATH) | use now | `node --version` probe | LW | 12:22 |
| node v25.8.2 (nvm, required for `node:sqlite` server) | use now | `/c/Users/rhixon/AppData/Roaming/nvm/v25.8.2/node.exe --version` → v25.8.2 | LW | 12:22 |
| Repo at HEAD c0c4596, git working (gh CLI ABSENT; GitHub API via credential token) | use now | `git rev-parse` probe; `command -v gh` → absent | LW / EW (push) | 12:22 |
| npm server test harness (`npm test` → `node --test server/test/*.test.mjs`); fakeProvider pattern in `server/test/assistant-persistence.test.mjs`; family-safety.test.mjs (mocked-Gmail pattern) | use now | package.json scripts read; both test files exist (probe). 308/308 baseline is HISTORICAL (this morning) — revalidate at implementation start | LW (temp data dirs) | 12:22 |
| Local dev stack `scripts/dev.mjs` (server :8787 + Vite :5173) | use now (currently DOWN — boot on demand) | File exists; netstat: no listeners on 8787/5173; `curl localhost:8787/api/health` → no response. Audit lead stopped it "as found" — boot with node 25.8.2 PATH prepended when a probe/test needs it | LW | 12:22 |
| Runtime driver `playwright-web` (PRIMARY; @playwright/test 1.61.1; `tests/topgun/playwright.config.ts`, projects web-chromium / web-webkit-iphone) | use now | Manifest `tests/topgun/runtime-drivers.json` read; probe `npx playwright --version` → 1.61.1; lane GREEN this run (journal #10: smoke 5-pass/1-skip via seedReturningUserState); files verified this session (`tests/topgun/web/helpers.ts` contains seedReturningUserState ×2; smoke.spec.ts present; both carry uncommitted harness-only edits) — suite NOT re-run because the stack is down (per brief) | LW (test artifacts) | 12:22 |
| Runtime driver `appium-device-cloud` (native iOS truth) | blocked AND out of scope | Probe: BROWSERSTACK_*/LT_*/APPIUM_REMOTE_URL all absent from env; native lane CLOSED by user decision (prior-run DEC-10, reaffirmed in brief) | EW (cloud) | 12:23 |
| Runtime driver `appetize-sim` (iOS simulator) | blocked AND out of scope | Probe: APPETIZE_API_TOKEN / APPETIZE_PUBLIC_KEY absent; same DEC-10 closure | EW (cloud) | 12:23 |
| Production homeops-ai.onrender.com | blocked beyond /api/health | Authorized probe: `/api/health` → ok v1.2.0, node 24.18.0, env production. Runtime is STALE (ffcfa33 lineage — EV-018/ART-002); Render autodeploy broken (user-side); RENDER_API_KEY absent | RO (health only) | 12:22 |
| Skills: top-gun:mem / capability-task-matcher / lean-implementation / convergent-360 / top-gun | use now | Session skill listing; mem + matcher + lean invoked this session | LW (.top-gun) | 12:16 |
| Skill `product-management:write-spec` | use now (context gate satisfied) | Listed and INVOKED this session; spec structure applied in the Supplemental Spec section below | none | 12:25 |
| Design skills (`design:design-critique` invoked; design-handoff/design-system/accessibility-review listed) | use now (context gate satisfied) | Listed and design-critique INVOKED this session; grounding applied in Design-Side Grounding section below | none | 12:26 |
| Skills: superpowers (TDD, verification-before-completion, systematic-debugging), verify, code-review, feature-dev | use if needed | Session skill listing | LW | 12:16 |
| Agent types: top-gun:implementation-lead (dispatch target), Explore, Plan, general-purpose, code reviewers | use now / use if needed | Agent tool's available-types list this session | per brief | 12:16 |
| Model aliases: `haiku`, `sonnet`, `opus`, `fable` (session top tier); effort ladder low→xhigh per lean-implementation | use now | Agent tool schema enum observed this session; parent session runs Fable | n/a | 12:16 |
| Claude Browser pane (preview_start, navigate, read_page, screenshots) | use if needed | Prompt-visible mcp__Claude_Browser__* tools | RO (localhost) | 12:16 |
| Playwright MCP / chrome-devtools MCP / claude-in-chrome (agentic browser complements) | use if needed | Deferred tool listing; loadable via ToolSearch (loading mechanism verified) | LW (browser) | 12:23 |
| Gmail MCP bound to budgetbeacon.ai@gmail.com (read/search/draft tools, deferred) | use if needed — observation inbox ONLY under an explicitly user-authorized live-send test | Deferred tool listing (mcp__24a83aa6*); user-email context. Live sends remain policy-gated regardless | RO/EW (drafts) | 12:23 |
| Google Calendar / Drive / Notion / Figma / other connected-but-deferred MCPs | irrelevant | Deferred listing; no mission task touches them (Figma noted: no design file exists for this mission — see Design-Side Grounding) | — | 12:23 |
| ~63 MCP servers pending OAuth (Slack, Datadog, Sentry, Vercel, expo, etc.) | blocked | System listing "require authentication"; session non-interactive — never trigger auth to fill a row | — | 12:16 |
| scheduled-tasks MCP / loop / schedule skills | irrelevant (and a confusion hazard: the mission's scheduler is the PRODUCT's trigger engine, not host cron) | Prompt-visible; deliberately not engaged | EW | 12:16 |
| Render deploy tooling (render:* skills, Render API) | blocked | RENDER_API_KEY absent; deploy repair is user-side | EW | 12:23 |

**Capability deltas vs ART-002 inventory:** (1) Playwright web lane was "reconfirm on boot" → now `use now`/GREEN (journal #10; files verified this session). (2) Local stack was down at bootstrap, up during audit, DOWN again now (restored as-found) — boot on demand. (3) Prod /api/health re-verified live this session (was probed at audit time). (4) Everything else re-probed and confirmed unchanged: node/nvm, harness, gh absent, cloud-driver creds absent, OAuth servers blocked. No capability appeared or disappeared.

## Phase Matrix

| Phase | Capabilities engaged | Explicitly not engaged (why) |
|---|---|---|
| SELECTION (now → user picks from §21 menu) | This guide; orchestrator presents menu; mem journal | Any product write (no selection recorded yet — hard gate); implementation-lead dispatch (awaits selection) |
| IMPLEMENTATION_RUNNING (S6) | node 25.8.2 toolchain; direct Edit/Write on server/* and client files per selected WPs; fakeProvider harness for slice-level tests; scripts/dev.mjs when live-API probes needed; mem deltas/journal; Explore agent for scoped scans; sonnet-class subagent for the parallel client-surface group | appium/appetize (closed DEC-10); prod (health only); live Google sends (policy; WP-005 harness uses mocked fetch); OAuth-pending MCPs; scheduled-tasks MCP (product scheduler ≠ host cron) |
| VERIFICATION (S7, per-slice + final) | `npm test` full suite (revalidate 308-green baseline first); permanent regression tests grown from audit/evidence/*.mjs; playwright-web smoke + targeted specs (client-visible states); persona-passes.mjs re-run (WP-006); Browser pane spot-checks; fresh-eyes verification agent at xhigh for P0 claims | Production behavioral verification (BLOCKED: Render autodeploy broken — unblock: user repairs/manually deploys, then verify bundle hash before any prod claim); live email delivery (only with explicit user authorization to a user-owned inbox) |
| COMPLETE / report | mem validate --strict; snapshots; budget ledger closeout | — |

## Task Matrix

Tasks decompose the six menu items into bounded, routable units. "inline" = implementation lead does it directly (delegation adds no value per the lean spawn test); model `inherit` = the lead's session model (Fable, frontier-class). All budgets SOFT (host does not enforce). Ordering within G-SERVER is strict: T-101 → T-201 → T-301 → T-401 (→ T-501 if selected); G-CLIENT runs parallel after its upstream contract lands.

| Task | IDs | Primary route | Fallback route | Agent role | Model | Effort | Budget | Concurrency group | Checkpoints | Drift signals | Verification | Return contract |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-101 WP-001 build-seam slices 1–4: materializeBuild target carries skillId+goal; fireTriggerInner prefers runSkill; 422 refuse unrunnable automation; trigger lastStatus terminal writeback | WP-001; ISS-001 P0, ISS-009, ISS-010 | Direct edit of server/index.mjs, planner.mjs, triggers.mjs, engine.mjs + fakeProvider harness test per slice (assistant-persistence.test.mjs pattern). Rejected alt: feature-dev:feature-dev skill — ceremony over a fully-specified WP; rejected alt: delegate to sonnet subagent — P0 root cause on the serialized server surface, lead must hold it | superpowers:test-driven-development flow if slice tests flap; Explore agent for any cross-ref scan | inline (lead) | inherit (frontier) | high | 50k | G-SERVER (serialized) | after slice 2 and slice 4 | writes outside the 5 named files; touching notify gates; re-auditing | Extended repro-A assertions: target.skillId == created skill; fired run steps == skill steps; unrunnable spec → 422 + honest chat msg; lastStatus terminal. Full `npm test` after | diff summary + test output verbatim + delta |
| T-102 WP-001 permanent regression test: promote audit/evidence/repro-false-success.mjs into server/test | WP-001 acceptance; EV-011/015 | Port harness script to `node --test` suite (scripted provider), keep repros A/B/B2/C as named cases. Rejected alt: leave as ad-hoc evidence script — loses CI protection, audit explicitly requires promotion | Playwright e2e equivalent — rejected primary: seams are server-side; slower, stack-dependent | inline (lead) | inherit | medium | 20k | G-SERVER (after T-101) | return only | test passing by weakening assertions | New test green at HEAD+fix; RED when T-101 slices reverted (prove it bites) | test file path + red/green proof |
| T-103 WP-001 slice 5: one Draft/Active lifecycle decision + server notes + both clients' copy | WP-001; ISS-007 | Decide lifecycle inline (product decision recorded as DEC entry), enforce in agents.mjs/triggers.mjs, align BuildCard + web copy. Rejected alt: defer to WP-006 — audit binds it to WP-001 (same seam, same files) | copy-only change if orchestrator ratifies "chat-builds land Active-with-gates" | inline server; copy edits may fold into T-601's client pass | inherit | medium | 15k | G-SERVER; copy part G-CLIENT | return only | inventing new lifecycle states beyond the decision | Unit test: Draft target does not fire (or builds land Active); copy matches behavior in both clients | DEC entry + test + copy diff |
| T-201 WP-002 anchor scheduling: `anchor` "HH:MM" + household tz; createTrigger/tick recompute; ASSISTANT_SYS + normalizeBuild accept runAt/anchor | WP-002; ISS-003 P1 | Direct edit planner.mjs/triggers.mjs/index.mjs + unit tests on anchor math incl. DST fixture. Rejected alt: cron-expression library — over-general, new dependency, audit chose anchor field | intervalMs-with-computed-first-runAt only (no per-fire recompute) if tz decision stalls — degraded, disclose drift | inline (lead) | inherit | medium | 25k | G-SERVER (after T-101; same files) | 1 (after createTrigger math) | schema migration attempts (must stay additive); tz guessing without disclosing fallback | Unit: creation 09:23 → nextRunAt next local 07:00 ±1min; post-fire recompute → 07:00 again; DST fixture holds 07:00; repro-A extended assertion | test output + tz-source decision recorded |
| T-301 WP-003 truth taxonomy: normalizePlan flags effect-claiming null-tool steps; engine `skipped_no_tool`/reasoning statuses; orchestrator clamp → visible skipped | WP-003; ISS-002 P0, ISS-005 P1 | Direct edit planner.mjs/engine.mjs/orchestrator.mjs + harness repros B/C as tests. Rejected alt: prompt-only fix (forbid null-tool sends in ASSISTANT_SYS alone) — model-dependent, engine must enforce structurally | fail-run-start-with-named-tool instead of visible-skip if step-status plumbing fights back (audit's considered alt) | inline (lead) | inherit | high | 50k | G-SERVER (after T-201) | 2 (after normalizePlan; after engine statuses) | legitimate reasoning-only answers regressing (guard: only effect-claiming steps change); silent-drop reintroduced | Repro-B: explicit not-sent disclosure, no save-offer; repro-C: gmail.send visible `skipped: not permitted`; all-real-tool plan keeps success copy; publicRun status tolerance verified in both clients' mapStepStatus | test output + runOutcomeText snapshots |
| T-302 WP-003 summary rewrite: runOutcomeText delivered/parked/skipped counts; save-offer gated on real effect | WP-003; ISS-002; FEAT-014 | Direct edit assistant-runs.mjs + snapshot tests of summary strings. Rejected alt: client-side rewording — server owns conversation truth; both clients are thin observers | — (small enough that fallback = redo) | inline (lead) | inherit | medium | 20k | G-SERVER (after T-301) | return only | celebratory copy surviving zero-effect runs | Snapshot test on runOutcomeText; repro-B text assertion | snapshots + diff |
| T-401 WP-004 park/expiry honesty: onRunParked hook + chat msg + deep link; expiry → fireRunFinished + honest msg; expired counts toward keeps-failing alert | WP-004; ISS-004 P1, ISS-008 P2 | Direct edit engine.mjs/assistant-runs.mjs + injectable-TTL harness fixture. Rejected alt: client polling extension — treats the symptom; server must emit terminal truth | — | inline (lead) | inherit | high | 40k | G-SERVER (after T-301; same files) | 1 (after park hook) | duplicate messages on resume (hook ordering); polling changes creeping in | TTL fixture: waiting msg ≤5s after park; expiry msg + run `expired`; two consecutive expiries → Owner alert; repro-B2 re-run | test output + message transcript |
| T-402 WP-004 client waiting-state surface: mobile (ask)/index.tsx + run-context.tsx + src/screens/Assistant.tsx copy past polling caps | WP-004; FEAT-019/022 | Delegated client pass (isolated write surface, parallel to G-SERVER tail) driven by the server contract from T-401; verify via playwright-web + Browser pane. Rejected alt: inline with lead — forfeits parallelism; client files are disjoint from server surface | inline with lead after T-401 if subagent unavailable | subagent: general-purpose (client-surface scope) | sonnet | medium | 20k | G-CLIENT (after T-401 contract) | 1 (midpoint) | touching server files (out of surface); redesigning components (reuse existing badges) | playwright-web targeted spec + web smoke stays 5-pass/1-skip; Browser pane screenshot of waiting/expired states at mobile width | screenshots + spec output + delta |
| T-501 WP-005 registry delivery tool `homeops.notify_contact` (CONSENT-GATED — dispatch only after the user's explicit selection of item 5 per DEC-A04) | WP-005; ISS-006 P1, ISS-008 | Direct edit internal-functions.mjs/notify.mjs/planner.mjs; harness with mocked Gmail fetch (family-safety.test.mjs pattern); verify kill-switch coverage of the email branch. Rejected alt: relax gmail.send approval TTL — breaks the consent model the audit says to preserve | draft-then-notify hybrid (send_notification_draft + registry) if allowlist semantics dispute arises — escalate to orchestrator, do not decide unilaterally | inline (lead) — security-sensitive, no delegation | inherit (frontier) | high | 55k | G-SERVER (after T-101; gate: user consent) | 2 + mandatory pre-merge adversarial review at xhigh | ANY live send; allowlist bypass; kill-switch gap left open | Mocked-Gmail harness: allowlisted agent delivers (RFC822 asserted); un-allowlisted → agent_not_allowed; kill switch → no send; unverified → honest block. LIVE one-shot ONLY with explicit user authorization to a user-owned inbox (budgetbeacon.ai@gmail.com Gmail MCP = observation surface) | test output + security-review note + delta |
| T-601 WP-006 surface polish: BuildCard/Automations truth copy, human schedule display, role-aware proposals, status-pass query hygiene | WP-006; ISS-007/009/010/011 P2-P3 | Delegated client+copy pass after T-101/T-201 land; persona-passes.mjs re-run + component copy snapshots. Rejected alt: bundle into each server WP — audit sequenced it last; batching copy gives one coherent voice pass | inline with lead in the verification window | subagent: general-purpose (client scope) | sonnet | medium | 25k | G-CLIENT (after T-101, T-201) | 1 (midpoint) | server-file writes; new layout primitives (forbidden by PRD) | persona re-run: Guest gets guidance not build card; BuildCard honest for Draft; automation rows show terminal status + "Daily · 7:00 AM"; playwright-web smoke green | persona output + snapshots + delta |
| T-701 Final verification wave (funded from reserve): full `npm test`; regression tests red→green proof; playwright web smoke + targeted; persona re-run; five-point check per slice log | all selected WPs; G1–G4(+G5) | Fresh-eyes verification agent (independent-judgment criterion) re-running every acceptance surface from artifacts, not claims. Rejected alt: lead self-verification only — P0 scope warrants adversarial pass per lean policy | lead-run verification with code-review skill if subagent budget exhausted | subagent: fresh-eyes verifier | opus or inherit | xhigh | 45k (reserve) | G-VERIFY (after all selected) | per surface | accepting claims without runnable output; skipping web lane because "server tests pass" | Everything in the per-task Verification column, re-executed; suite baseline vs 308 recorded | verbatim outputs + verdict ship/another-round |

**Highest-leverage matches:** (1) fakeProvider harness ↔ T-101/T-301 — the exact instrument that proved the P0s becomes their regression net, zero new infrastructure; (2) audit evidence scripts ↔ T-102 — repro code is already written, promotion is cheap and permanently guards the user's core complaint; (3) newly-green playwright-web lane ↔ T-402/T-601 — the only truthful client-visible-state verifier available (native lane closed), arriving exactly when client honesty states need rendering proof; (4) family-safety mocked-Gmail pattern ↔ T-501 — real delivery verification with zero live-send risk.

## Model and Effort Rationale

Per `top-gun:lean-implementation` `references/budget-policy.md` (canonical), aliases restricted to those observed this session (haiku/sonnet/opus/fable):

- **Frontier (`inherit` = Fable) + high effort** — T-101, T-301, T-401, T-501: P0/P1 cross-layer slices with real design decisions (target linkage contract, step-status taxonomy, hook ordering, send-authority expansion). Policy: frontier for L-adjacent/security-sensitive/P0 work; high effort for cross-layer slices. T-501 additionally gets an xhigh adversarial review (policy: xhigh for security review of P0 scope).
- **Frontier + medium effort** — T-102, T-103, T-201, T-302: well-specified M/S slices done inline by the lead (spawning a mid-class agent fails all four spawn criteria for serialized single-surface work; `inherit` costs nothing extra in dispatch). Medium per "routine implementation, standard tests."
- **Sonnet + medium** — T-402, T-601: S-class client/copy slices on an isolated write surface, genuinely parallelizable → spawn criteria (a)+(b) hold; mid class is the policy default for S/M implementation. Do NOT assign haiku: copy carries product-voice judgment and cross-file consistency.
- **Opus-or-inherit + xhigh** — T-701: "final verification of P0 scope" is the effort ladder's named xhigh case; independent judgment (criterion c) justifies the spawn.
- Haiku-class: no assignment — no mechanical bulk task in this scope survives decomposition as XS-mechanical (closest was T-102, which still requires assertion design).

Runtime correction contract: if T-402/T-601 show underpowered signals (wrong fixes, missed cross-file copy), respawn at inherit per the respawn protocol and update this section.

## Planned Budget Ledger

All budgets SOFT — the host does not enforce output-token limits; enforcement is checkpoint math by the implementation lead/orchestrator (>150% ⇒ intervene).

| Task | Class | Budget (output tokens) | Soft/Hard | Rationale |
|---|---|---|---|---|
| T-101 | M | 50k | soft | 4 slices, 5 files, P0; under M-cap 60k |
| T-102 | S | 20k | soft | port + red/green proof |
| T-103 | S | 15k | soft | decision + enforcement + copy |
| T-201 | S | 25k | soft | isolated math + DST fixtures; S-cap |
| T-301 | M | 50k | soft | 3 files + regression guard on reasoning-only paths |
| T-302 | S | 20k | soft | summary + snapshots |
| T-401 | M | 40k | soft | hooks + TTL fixture |
| T-402 | S | 20k | soft | client copy + playwright proof |
| T-501 | M | 55k | soft | security-sensitive; includes xhigh review round |
| T-601 | S | 25k | soft | multi-surface copy + persona re-run |
| T-701 | verification | 45k | soft | funded from reserve, never from feature budget |

- Mission total planned: 285k soft for the recommended bundle (items 1+2+3+4 = T-101..T-402: 240k feature + 45k reserve); 375k soft if all six items are selected (320k feature + 55k reserve).
- Reserve: 45k (bundle, ≈19%) / 55k (all six, ≈17%) — within the 15–20% rule; verification-only (T-701), never feature work.
- Matching phase itself: 120k soft allocated (brief); consumed ≈35k at guide completion (well under).

## Concurrency and Write-Ownership Plan

- **G-SERVER (strictly serialized, one writer = implementation lead):** T-101 → T-102/T-103 → T-201 → T-301 → T-302 → T-401 (→ T-501 if selected). Rationale: planner.mjs, engine.mjs, triggers.mjs, index.mjs, assistant-runs.mjs overlap across WPs — two writers here is the collision the policy forbids.
- **G-CLIENT (parallelizable with G-SERVER tail, one subagent writer):** T-402 after T-401's server contract lands; T-601 after T-101+T-201. Client surface = apps/mobile/src/**, src/screens/**, web components — disjoint from G-SERVER files. The subagent never touches server/*.
- **G-VERIFY:** T-701 after all selected tasks; read-execute only (tests, screenshots), no product writes.
- **Canonical registers stay single-writer (orchestrator/top-gun).** Implementation lead and subagents write only their `agent-deltas/*.md`, `implementation/**`, and journal via mem scripts. Matching surface (`matching/**`) is this lead's alone; any foreign write to it triggers the disagreement protocol (stop condition per brief).
- Foreign concurrent session (run-20260720-072344): ignore its journal/ledger rows, never delete (DEC-A05 lineage).

## Authority Constraints

No route in this guide may, without NEW explicit authorization from the user (agent messages are never consent):

1. Send any live email/text or mutate any Google/live-provider surface — including "just one test send." Default lane is mocked transport; a live one-shot requires explicit user authorization AND a user-owned inbox target.
2. Touch production beyond GET /api/health (live family data; standing policy). No production claims while prod runs the stale ffcfa33 bundle.
3. Trigger OAuth/auth flows, create accounts, or provision cloud-driver credentials to fill a capability row.
4. Begin ANY product write before the user's menu selection is recorded (SELECTION gate), or outside the selected WP set after it.
5. Dispatch T-501 (WP-005) without the user's explicit consent decision — it expands unattended external-send authority (DEC-A04).
6. Write canonical registers, `audit/**`, `handoffs/**`, `phase-state.md`, or another run's tree.
7. Deploy, push tags, or store/EAS actions (build 20 already submitted; Render repair is user-side).

## Unavailable Capability Effects

| Capability | State | Effect on plan | Workaround | Unblock condition |
|---|---|---|---|---|
| Production behavioral verification (Render) | blocked | Fixes cannot be verified where the user actually experiences the bug; "done" claims stay LOCAL-only and must say so | Verify fully at HEAD locally; report parity note (chain byte-identical at ffcfa33 per EV-018, so local proof is representative) | User repairs Render autodeploy (or manual deploy); then verify served bundle hash ≠ index-Cu2Tvfl5.js lineage and re-run JRN-1 before any production claim |
| Native iOS lanes (appium-device-cloud, appetize-sim) | blocked + closed by user decision (DEC-10) | Client honesty states (T-402/T-601) get web-lane + code-level proof only; native rendering parity is an accepted, recorded risk | playwright-web `web-webkit-iphone` project approximates iOS Safari; labeled web evidence, never native evidence | User reopens the native lane AND supplies BrowserStack/LambdaTest or Appetize credentials + app artifact |
| Live Google mutations / real email delivery | blocked (policy) | WP-005 acceptance runs against mocked Gmail fetch; end-to-end "the email actually arrived" is not provable in-mission by default | family-safety.test.mjs mocked-transport pattern asserts the RFC822 payload; Gmail MCP inbox (budgetbeacon.ai@gmail.com) stands ready as observation surface | Explicit user authorization for a one-shot live send to a user-owned inbox |
| ~63 OAuth-pending MCP servers (Slack, Sentry, Datadog, Vercel, expo, …) | blocked | None material — no selected task routes through them | n/a | User authorizes via claude.ai connector settings or /mcp in an interactive session (only if ever needed) |
| gh CLI | unavailable | Negligible — git + GitHub API token cover repo ops | git CLI + credential-fill token | Install gh (not warranted) |
| Render API/CLI | blocked (no key) | Cannot even inspect deploy state programmatically | GitHub deployments API (read) for deploy-event evidence | User supplies RENDER_API_KEY (their action; not required for the bundle) |
| Live cloud-model transcript (HYP-005) | open gap (not a session capability gap: a real provider key/local model choice is the user's) | Build-JSON variance from a real model unverified; T-101's structural fix is model-independent, so risk is bounded | fakeProvider scripted builds; HYP-005 stays an open follow-up | User authorizes one live-provider chat turn locally |

## Supplemental Spec (structure per product-management:write-spec — invoked this session)

- **Problem:** Chat-created tasks and agents report success while delivering nothing, for every task type (user report; reproduced as ISS-001..006, EV-011..EV-017). The seams — build-target loss, vacuous null-tool steps, unanchored schedules, silent parked/expired runs — convert non-delivery into celebration.
- **Users:** Alex (Owner-operator, builds the 7 AM briefing), Morgan (co-admin, plain-English helpers), Elaine (recipient who only exists if delivery happens), plus household trust overall; Sam/Lily gate honesty preserved.
- **Scope (this matching guide):** route WP-001..006 to session-verified capabilities with models/efforts/budgets/verification so implementation dispatch is immediate on selection. **Non-goals:** implementation itself; re-auditing; native visual lanes; production deploy/verification; new connectors.
- **Acceptance criteria (guide-level):** every §21 menu item has ≥1 task row with a considered-and-rejected alternative route; every P0/P1 task names a runnable verification surface that exists in this session's inventory; validate_matching passes; consent gate (WP-005) and prod block are explicit; budgets conform to lean-implementation tables with 15–20% reserve.
- **Success metrics (implementation-phase, inherited from PRD G1–G5):** G1 trigger targets the built skill at local 07:00; G2 no delivery claim without a delivering step; G3 parked/expired runs message the thread; G4 no silent step removal; G5 (if item 5 selected) allowlisted scheduled send delivers via registry under mock.

## Design-Side Grounding (per design:design-critique — invoked this session)

- The audit's design verdict (§9) stands: the existing inline run cards, approval badges, and honest error bubbles ARE the design system — routes must feed them truthful states, never introduce new layout primitives (PRD constraint).
- Critique dimensions map to verification checks for T-302/T-402/T-601: **hierarchy** — the not-sent/waiting/expired disclosure must be as prominent as today's success copy (no burying the caveat); **consistency** — new states reuse existing badge/copy patterns across mobile and web; **usability** — every new state renders on narrow mobile widths (playwright web-webkit-iphone project is the check); **content** — copy names the step, the consequence, and the next action ("expired — nothing was sent · Review in Inbox"); **accessibility** — new badges/copy inherit the codebase's accessibilityRole/Label pattern (code-level check; full a11y audit remains a disclosed gap from the audit).
- No Figma source exists for this mission (Figma MCP present but irrelevant — nothing to pull); design truth lives in the existing components. `design:accessibility-review` is available if the implementation lead wants a structured pass on the new states.

## Reassessment Triggers

Standard set (matching-policy.md): a capability appears/disappears/changes auth state; host model/effort choices change; any task exceeds 150% budget at a checkpoint; scope/selection changes; a route fails twice for the same cause; phase transition into implementation (MANDATORY revalidation of drift-prone facts — see below).

Mission-specific:

1. **At implementation dispatch, revalidate:** local stack boots clean at HEAD (dev.mjs, node 25.8.2, /api/health); `npm test` baseline is green BEFORE first edit (308/308 is historical); playwright smoke still 5-pass/1-skip (harness edits are uncommitted working-tree files — if lost/stashed, re-apply before relying on the lane); working tree state vs c0c4596.
2. User's selection differs from the recommended bundle (menu items map 1:1 to task groups — re-derive G-SERVER ordering for partial selections).
3. User decides WP-005 consent either way (adds/removes T-501 and its xhigh review).
4. Render deploy repaired → production verification unblocks: verify bundle hash, then re-run JRN-1 against prod before any production claim.
5. A live-provider transcript (HYP-005) shows build JSON that evades the T-101 target contract → reopen WP-001 routing.
6. Any foreign-session write lands under this run's `matching/**` or `implementation/**` → stop, journal disagreement.
7. Web smoke goes red on the untouched baseline → the client verification lane for T-402/T-601 is void until repaired (harness-only fixes permitted).
