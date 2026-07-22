# Capability-Task Matching Guide

> STATUS: ACTIVE — run-20260721-054151 · produced by matching-lead 2026-07-21T07:15Z · inventory probed 2026-07-21T06:55–07:00Z (UTC) · inputs: audit/work-packages.md (ART-013), audit/prd.md (ART-012), audit/master-report.md (ART-003), audit/issue-register.md (ART-004), audit/evidence-ledger.md (EV-001…040), facts-and-notes.md (ART-001), top-gun:lean-implementation references/budget-policy.md (canonical tables), top-gun:capability-task-matcher references/{matching-policy,runtime-drivers}.md.

## Spec preamble (structured per product-management:write-spec — skill available and invoked this session)

- **Problem**: 12 validated work packages (WP-001…012) exist with slices and acceptance criteria, but no binding between them and what THIS session can actually execute. Without a current-evidence routing guide, the implementation lead either under-verifies (claims without drivers) or overspends (frontier models on mechanical work) — the exact failure modes of prior "COMPLETE" runs.
- **Users**: the top-gun orchestrator (dispatch briefs), the implementation lead (S6–S7 execution), verification agents, and ultimately the household user whose success sentence ("hey can you do this" → visibly done) the routing must protect.
- **Scope**: route every WP (slice-level where routing differs) to capabilities, model class, reasoning effort, soft token budget, verification runtime driver, external gates, and concurrency groups. **Non-goals**: implementation, re-audit, WP scope changes, capability installation/authorization to fill rows.
- **Acceptance criteria**: [x] every WP-001…012 has a task-matrix row; [x] every row names ≥1 verification driver; [x] LM Studio/OAuth gates carried onto WP-006/007/012; [x] no capability named outside the probed inventory; [x] ≥2 routes considered per task with the rejected route recorded; [x] budgets/models/effort cite budget-policy.md tables; [x] validate_matching.py green.

**Design-side grounding** (per design:design-handoff — skill available and invoked this session): all UI-facing WPs (001, 003, 004, 005, 008a, 010, 011) reuse the existing warm design system — PageHeader/Tabs/Card patterns, Calm Mode, honest empty states (master-report §9). Routing consequence: no visual-design-generation capability is required; the needed design capabilities are handoff discipline (all states specified: default/empty/loading/error/success; tokens not values; a11y focus order and aria-labels) and critique/a11y review at verification. `design:accessibility-review`, `design:ux-copy`, and `frontend-design:frontend-design` are available in-session for those checkpoints. New-surface decisions (WP-004 Tasks surface; WP-005 IA) get a written handoff-spec block in the slice brief before code.

## Capability Map

Classification per matching-policy.md. Side-effect authority: RO=read-only, LW=local-write, XW=external-write. All probes executed this session; timestamps UTC 2026-07-21.

| Capability | Classification | Evidence | Authority | Timestamp |
|---|---|---|---|---|
| Read/Write/Edit/Glob/Grep | use now | system-prompt tool list; used this phase | LW (run dirs only this phase) | 06:55Z |
| Bash (Git Bash) + PowerShell 7 | use now | both in prompt; probes executed | LW | 06:57Z |
| Agent tool — subagent spawn | use now | prompt schema; agent-types list in session | per-brief | 06:55Z |
| Model aliases: `fable`, `opus`, `sonnet`, `haiku` | use now | Agent tool `model` enum observed this session | n/a | 06:55Z |
| Reasoning effort low/med/high/xhigh | use now | set per dispatch brief (budget-policy ladder); orchestrator directive "fable 5 high" for leads | n/a | 06:55Z |
| Agent types: top-gun:implementation-lead, general-purpose, Explore, Plan, feature-dev:{code-architect,code-explorer,code-reviewer}, pr-review-toolkit:* , code-simplifier | use now / use if needed | session agent-types listing | per-brief | 06:55Z |
| Skills: top-gun:{mem,lean-implementation,capability-task-matcher,convergent-360,top-gun}, superpowers:{test-driven-development,systematic-debugging,verification-before-completion}, code-review:code-review, commit-commands:commit | use now | session skill listing; top-gun skills invoked this phase | LW | 06:55Z |
| Skills: product-management:write-spec, design:design-handoff | use now (USED this doc) | invoked this session (context gate satisfied — not unavailable) | RO | 07:00Z |
| Skills: design:{design-critique,design-system,accessibility-review,ux-copy}, frontend-design:frontend-design | use if needed | session skill listing | RO | 06:55Z |
| Playwright MCP (`mcp__plugin_playwright_playwright__browser_*`) | use now | ToolSearch select returned schemas (navigate/snapshot/screenshot/network_requests) | LW (drives disposable browser) | 06:58Z |
| Claude Browser pane (`mcp__Claude_Browser__preview_start/navigate/read_page/computer`) | use if needed | prompt tool list | LW | 06:55Z |
| chrome-devtools MCP (deferred) | use if needed | deferred-tools list; loadable via ToolSearch (not loaded — not yet needed) | LW | 06:55Z |
| claude-in-chrome MCP | irrelevant | would drive the user's real Chrome profile; dev verification belongs in isolated Playwright browsers | XW risk | 06:55Z |
| WebFetch | use now | schema loaded via ToolSearch this session | RO external | 06:58Z |
| WebSearch, context7 query-docs (deferred) | use if needed | deferred-tools list | RO external | 06:55Z |
| scheduled-tasks MCP, visualize, Artifact | irrelevant to WP routing | no WP requires them | — | 06:55Z |
| ~63 claude.ai connectors (expo, sentry, datadog, notion, gmail-MCP, …) | blocked | system message "require authentication"; non-interactive session cannot OAuth | — | 06:55Z |
| node v25.8.2 + npm 11.11.1 | use now | `node --version` probe (engines field says <25 — stale but functional per audit) | LW | 06:57Z |
| node:sqlite (tenant DB read) | use now | `node -e require('node:sqlite')` OK | RO on resident data (policy) | 06:57Z |
| python 3.14.3 | use now | `python --version` probe; mem scripts ran | LW | 06:57Z |
| git 2.53.0.windows.2 | use now | probe; commit/push gated (see Authority) | LW/XW-gated | 06:57Z |
| gh CLI | unavailable | absent per ART-001 facts + environment memory; not re-probed — no route depends on it | — | 06:55Z |
| NODE_EXTRA_CA_CERTS | EMPTY this session | env probe; needed for node-CLI TLS on this host (env memory) — affects `npx supermemory local` fetch in WP-007 | — | 06:57Z |
| npm scripts: dev, server, test (node --test server/test), typecheck, topgun:web/:ios/:all/:pwa, topgun:report | use now | package.json probe | LW (dev server boot at implementation; NOT started this phase) | 06:57Z |
| **Runtime driver `playwright-web` (PRIMARY)** | **use now** | probe PASSED: playwright CLI 1.61.1; tests/topgun/playwright.config.ts present; chromium-1228 + webkit-2311 in ms-playwright cache; projects web-chromium + web-webkit-iphone; manifest tests/topgun/runtime-drivers.json present | LW | 06:59Z |
| Runtime driver `appium-device-cloud` | blocked + out-of-mission | harness present (tests/topgun/appium/run.mjs) but BROWSERSTACK_*/LT_*/APPIUM_REMOTE_URL all unset; native iOS is a non-goal (DEC-010) | — | 06:59Z |
| Runtime driver `appetize-sim` | blocked + out-of-mission | @appetize/playwright 1.6.0 installed; APPETIZE_API_TOKEN/PUBLIC_KEY unset; non-goal (DEC-010) | — | 06:59Z |
| LM Studio (localhost:1234/v1) | blocked | live probe HTTP 401 "An LM Studio API token is required…'Bearer'" — reachable, token-gated; re-confirms EV-035 in THIS session | — | 06:57Z |
| Supermemory sidecar (`npx supermemory local`, :6767) | use if needed | NOT installed/probed (install forbidden this phase); feasibility evidence EV-036 (MIT, Node, local embeddings, LM Studio support) | LW at implementation | 06:55Z |
| OAuth apps: Google (gmail.send), Microsoft/Slack/Dropbox registrations; Twilio credentials | blocked (user-owned) | EV-020 Connections screen; DEC-016; memory: Google reconnect pending | XW | 06:55Z |
| Render deploy (git push → homeops-ai auto-deploy) | blocked by policy until S8 authorization | facts ART-001; shared production state | XW | 06:55Z |
| Repo baseline suites (tests/topgun/web: 5 specs; server node --test) | use now | dir probe; pass-state NOT asserted — implementation lead re-runs as baseline | LW | 06:59Z |
| tests/topgun/usecases/ | does not exist yet | dir probe False — WP-006 builds it | LW | 06:59Z |

## Phase Matrix

| Phase | Capabilities engaged | Explicitly not engaged (why) |
|---|---|---|
| MATCHING (this) | Read/Grep/Glob, PowerShell/Bash probes, ToolSearch, mem scripts, write-spec + design-handoff skills | dev server, Playwright runs, any repo edit (brief: inventory only, read-only outside matching/) |
| SELECTION (menu) | orchestrator + this guide + master-report §21 | all execution capabilities (no work before recorded selection) |
| IMPLEMENTATION (S6) | full LW set: Edit/Write, node/npm, dev server via scripts/dev.mjs, playwright-web, Playwright MCP, node:sqlite (RO on resident data), node --test, typecheck, sub-agents per task matrix, superpowers:{TDD,systematic-debugging}, Supermemory sidecar install (WP-007 only) | commit/push/deploy (user gate), external sends (forbidden), OAuth flows (user-owned), appium/appetize (blocked + non-goal), claude-in-chrome (real-profile risk) |
| VERIFICATION (S7) | playwright-web scripted suites (primary evidence), Playwright MCP interactive UI checks, dev-server logs, node:sqlite server-truth reads, network capture (Playwright; chrome-devtools MCP fallback), design:accessibility-review, code-review:code-review, adversarial verifier sub-agent (reserve budget) | test-suite-only verdicts (mission rule: UI-observed evidence required), production checks (parity unverified) |
| COMPLETE / S8 | git commit/push ONLY on explicit user authorization (triggers Render deploy); render:check-render-status after | any deploy without the recorded authorization |

## Task Matrix

Return contract **STD** for every row (lean-implementation report contract): plain-language outcome; output paths; validation results verbatim; budget consumed vs plan; blockers with exact unblock conditions. Drift signals **std** = budget-policy canonical set (out-of-surface writes, scope creep beyond row IDs, fabricated-evidence tells, repeated identical failures, silence past checkpoint, skipped verification). Budgets are **soft** (host enforces no output-token cap; lead enforces at checkpoints). Driver = verification runtime driver.

| Task | IDs | Primary route | Fallback route | Agent role | Model | Effort | Budget | Conc. group | Checkpoints | Drift signals | Verification (driver) | Return contract |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WP-001 inbox read-models (s1–4) | ISS-001/002/017, FEAT-010/011, JRN-2/5 | sonnet sub-agent, isolated client surface; Edit + npm run topgun:web | inline by implementation-lead (fable) on underpowered signals | implementer (isolation) | sonnet | medium | 60k | A (wave 1) | 2 | std + any server-route edit (none needed) | NEW playwright-web spec park→see→approve→complete + Playwright MCP live check + node:sqlite approval-row read + `data.approvals` grep=0 in render path | STD + spec path + trace/screens |
| WP-002 honest delivery (s1,3,4) | ISS-003/004, FEAT-011/012/036 | sonnet sub-agent, server surface; node --test unit table | opus if summarize semantics contested | implementer (parallel) | sonnet | medium | 60k | B (wave 1) | 2 | std + external send attempt (forbidden) | node --test summarizeOutcome truth table + chat E2E (playwright-web, joint with WP-001) + dev-server log | STD + unit output verbatim |
| WP-002 s2 chat attribution | ISS-004, DEC-012 | same agent, raised effort: runAssistantPlan choke point, clamp semantics preserved | opus arbitration if policy-clamp regression | implementer | sonnet | high | (in 60k) | B | midpoint | std + weakening policy clamp | playwright-web E2E: chat "send me a note" → Inbox row (with WP-001); regression UC-20 still 2/2; dev-server log attribution line | STD |
| WP-003 one run world (s1–5) | ISS-005/009/011/016, FEAT-013/015/016 | opus sub-agent, sole useStore.ts owner, per-slice checkpoints | sonnet-high per slice under lead review if opus overpowered on s1/s5 | implementer (isolation) | opus | high | 120k | C1 (wave 2, after WP-001) | per slice (5) | std + parallel useStore writer | playwright-web multi-source run-listing spec + status-label component assertions + thread-order check | STD + before/after store LoC |
| WP-004 results have homes (s1–3) | ISS-008, FEAT-005/019 | sonnet sub-agent; s2 design decision (To-dos tab vs Chore Board) escalated to lead pre-build with handoff-spec block | inline lead | implementer (parallel) | sonnet | medium | 50k | C2 (wave 2, after WP-001 s3 + WP-002 merge) | 2 (s2 decision gate) | std + inventing new design system | extend UC-20 E2E (playwright-web): ≤2 clicks Home→task; artifact kind=notification-draft visible; deep links resolve | STD + decision record |
| WP-005 s1+s2+s5 IA + catalog + retire nav | ISS-013, FEAT-032/033, PI-009 | opus sub-agent behind feature flag; merged packaged-template catalog in src/data | sonnet for s2 catalog merge only | implementer (isolation) | opus | high | 115k | E (wave 4, after WP-003) | per slice | std + removing old nav without flag | full-nav playwright-web audit spec; flag-off restores old nav (verified) | STD |
| WP-005 s3 agent detail absorbs triggers/capabilities | ISS-013, FEAT-013/015 | sonnet sub-agent on Agents.tsx detail | opus if trigger-edit semantics get cross-layer | implementer | sonnet | high | 60k | E (serialized after s1) | midpoint | std | playwright-web: create→schedule→run→inspect without leaving Helper Agents | STD |
| WP-005 s4 migration 51→≤20 packages | ISS-013 | opus sub-agent; dry-run on COPY of resident data via backup export; printed mapping report | defer to user review on any ambiguous mapping | implementer (data-sensitive) | opus | high | 120k | E (last) | per stage (dry-run gate before apply) | std + ANY in-place resident write + orphaned trigger | dry-run diff report artifact + zero-orphan check + 22-UC skill invocation smoke (playwright-web) | STD + mapping report path |
| WP-006 s1+s2 orchestrate() + catalog pruning | ISS-004, HYP-003/004/005, FEAT-007/016/031 | opus sub-agent; single entry API; grep-enforced no direct startRun from assistant routes | fable (lead inline) arbitration of engine-vs-layer boundary | implementer (isolation) | opus | high | 150k | F (wave 3, after B) | per slice | std + engine.mjs rewrite (DEC-012 forbids) | node --test on orchestrate() sources + grep gate + chat/agent/schedule E2E through one entry (playwright-web + dev logs) | STD |
| WP-006 s3 connector sandbox layer | DEC-016, FEAT-027 | opus sub-agent; mocks behind net.mjs allowlist; HOMEOPS_CONNECTOR_SANDBOX=1 | sonnet-high if mock surface proves mechanical | implementer (new files, parallel-safe) | opus | high | 100k | F | midpoint | std + weakening net.mjs allowlist in real mode | node --test: sandbox on/off behavior; allowlist regression check | STD |
| WP-006 s4–s6 22 UC specs | all UC rows | 2–3 sonnet sub-agents fanned out on disjoint per-UC spec files (s4 runnable-now set first) | single sonnet serial if flake cross-talk | spec authors (parallelism) | sonnet | medium | 180k (60×3) | G (wave 5, after WP-001..004) | per batch | std + marking gated UC green without sandbox twin | the suite itself: `npm run topgun:usecases` (playwright-web); per-UC latency+pass JSON artifact | STD + suite output verbatim |
| WP-006 s7 reliability soak 3× | G3 | sonnet sub-agent runs suite 3× consecutively, triages flakes | escalate persistent flake to opus root-cause | verifier | sonnet | low | 20k | G (last) | return only | std + averaging over a red run | 3 consecutive green runs on Windows host (playwright-web); latency histogram | STD + 3 run reports |
| WP-007 s1 LM Studio token field | ISS-006, FEAT-030 | sonnet sub-agent: Settings UI keyOptional + ai.mjs header; health-check hint | inline lead (small) | implementer (parallel) | sonnet | medium | 20k | A2 (wave 1) | 1 | std | unit on header injection (node --test); acceptance run (Test connection green) DEFERRED until user supplies token — GATE | STD + gate status |
| WP-007 s2–s5 Supermemory + read/write paths | FEAT-018, PI-011, DEC-014, UC-18/22 | sonnet sub-agent(s): sidecar boot (opt-in dev.mjs), dual-write + idempotent migration (dry-run first), planner profile+search with disclosed fallback, Memory tab search | opus on parity-report dispute; DEC-014 FTS5 fallback if sidecar unstable on Windows | implementer (isolation) | sonnet | high | 140k | H (wave 4; s3 after WP-002 releases internal-functions.mjs) | per slice | std + cloud calls in offline test + migration without dry-run | integration tests vs live local sidecar (node --test) + offline-degradation test + zero-cloud network observation (playwright-web capture) + row-parity report | STD + parity report |
| WP-008a improvements diff/revert + default-off | ISS-007, HYP-002, FEAT-014 | sonnet sub-agent; beforeVersionId at apply; revert endpoint on existing version stores | opus if version-store semantics surprise | implementer | sonnet | medium | 50k | I (wave 5; owns engine.mjs before WP-011) | 2 | std + deleting any version history (never) | node --test on revert + diff-render E2E (playwright-web) | STD |
| WP-008b SAFE WIPE (opt-in menu 9) | DEC-015 | opus sub-agent; backup-first (backup.mjs verified openable) → dry-run report → USER approval → selective revert → archive-not-delete → diff summary | abort to backup restore | implementer (data surgery) | opus | high | 40k | I (serialized, user-gated) | per stage; hard stop before mutation | std + any mutation before user approves dry-run report | dry-run report artifact + post-wipe UC smoke (playwright-web) + instructions==last-human-version check (node:sqlite) | STD + backup path |
| WP-009 sync hygiene | ISS-010, HYP-006, FEAT-020 | sonnet sub-agent; rev-gated hydrate + visibility backoff (+optional SSE) | chrome-devtools MCP network tooling if Playwright capture insufficient | implementer | sonnet | medium | 40k | J (wave 6, after WP-003 releases useStore.ts) | 2 | std | before/after network trace in E2E (playwright-web HAR/requests): ≤6 req/60s idle; change visible ≤5s; WP-001 badge freshness regression | STD + trace artifacts |
| WP-010 web roles/profiles | ISS-012/015, FEAT-002/023/026, JRN-3 | opus sub-agent (auth-surface = security-sensitive per policy) | sonnet-high + mandatory lead adversarial review | implementer (isolation) | opus | high | 50k | K (wave 5) | 2 | std + weakening PIN/password gates | 2-member playwright-web E2E: JRN-3 completes; childAiGate refusal; privacy flag hides names | STD |
| WP-011 trust & lifecycle polish | ISS-014/017, FEAT-016/017 | sonnet sub-agent; templated activity lines; connector-parked TTL sweeper | haiku rejected (family-facing copy judgment); inline lead | implementer | sonnet | medium | 30k | J (after WP-008a releases engine.mjs) | 1 | std + auto-executing resident-run sweep (proposal only) | node --test sweeper unit + feed snapshot via playwright-web screenshot assertions | STD |
| WP-012 connector provisioning + sandbox closure | DEC-016, UC-1..10/12/13/14, FEAT-027 | sonnet sub-agent: per-provider checklists in Connections/docs, Twilio config, http-connector re-enable (user-confirmed), sandbox specs green | none for real-credential lane (user-owned) | implementer | sonnet | medium | 40k | L (wave 6, after WP-006 s3) | 1 | std + entering credentials or OAuth flows (forbidden) + real SMS without explicit user go-ahead | sandbox suite per gated UC (playwright-web); real-credential smoke DEFERRED to user-authorized session — GATE | STD + gate checklist |

### Route rationale and rejected alternatives (two-route rule, scoring per matching-policy rubric)

- **WP-001**: sonnet sub-agent (fit 4, correctness 4, evidence 5 via scripted spec) beat inline-fable (cost 1 vs 3 — lead context spent on mechanical wiring) and beat Claude-Browser-pane-manual-verification as primary evidence (rejected: non-repeatable, no trace artifacts; kept as exploratory complement via Playwright MCP). Server contract already proven (EV-038) → medium effort suffices.
- **WP-002**: sonnet beat haiku (rejected: summarize truth-table + user-facing copy carry the mission's central credibility fix — correctness risk too high for small-class) and beat opus (rejected: overpowered for flag-plumbing; kept as s2 fallback because attribution touches policy clamps).
- **WP-003**: opus beat sonnet (rejected primary: retiring a ~2 kLoC second source of truth is an L-class cross-layer refactor with real design decisions — budget-policy assigns frontier). Slice fan-out rejected: all slices write useStore.ts/run render paths — single-writer rule.
- **WP-004**: sonnet beat opus (rejected: reuses existing list components/design system; only the s2 surface decision needs judgment — routed to lead as a decision gate, not a bigger model).
- **WP-005**: XL never dispatched whole (policy). Opus on IA/migration beat sonnet (rejected: IA + 51→≤20 data migration is design-heavy and data-sensitive); s3 sonnet beat opus (contained edit surface). Copy-based dry-run beat in-place migration (safety veto: resident data is read-only until user sign-off).
- **WP-006**: layer rebuild on the engine (chosen in PRD, DEC-012) bounds the routes: opus on s1–s3 beat sonnet (entry unification + sandbox touch security allowlists and the engine boundary); sonnet spec fan-out on s4–s6 beat one serial agent (parallelizable disjoint files; 3× throughput) and beat haiku (rejected: persona-journey assertions need mid-class judgment). Soak at sonnet-low beat haiku (flake triage needs some judgment) and beat opus (mechanical repetition).
- **WP-007**: sonnet-high beat opus (rejected primary: EV-036 shows a documented, single-binary integration — ambiguity is moderate; opus reserved for parity disputes). Supermemory-first beat FTS5-first (DEC-014: FTS5 is the fallback, not the plan). Sidecar install happens only inside selected implementation — never during matching.
- **WP-008**: split routing — 8a sonnet (UI + endpoint on existing version stores) vs 8b opus (data surgery; budget-policy: security/data-sensitive → frontier; verification at raised effort from reserve). Blanket-delete rejected permanently (DEC-015: selective revert, archive-not-delete).
- **WP-009**: Playwright-captured network trace beat chrome-devtools MCP as primary (already in-toolchain, artifacts land in the suite; devtools kept as fallback for deep waterfall analysis).
- **WP-010**: opus beat sonnet (auth/session surface — policy safety veto on under-powering security-sensitive changes).
- **WP-011**: sonnet beat haiku (family-facing copy quality is the point of ISS-014).
- **WP-012**: sonnet code lane; the real-credential lane has NO agent route by design — external gates are user-owned (DEC-016); sandbox twin is the only automatable evidence.
- **Verification driver (all UI rows)**: `playwright-web` is the primary driver per runtime-drivers.md precedence (probe passed; cheapest truthful layer; HTML report/traces/screens as registrable evidence). Playwright MCP = interactive/exploratory complement; Claude Browser pane = secondary interactive; `appium-device-cloud`/`appetize-sim` = blocked AND out-of-mission (native non-goal DEC-010) — never claim native evidence from web runs.

## Model and Effort Rationale

Per budget-policy.md tables (canonical), using only session-exposed aliases (fable/opus/sonnet/haiku):

- **fable (session top tier)** — implementation lead itself per user directive "/top-gun fable 5 high"; also lead-inline arbitration (engine-vs-layer boundary, WP-004 s2 surface decision) and final P0 verification sign-off at xhigh from reserve. Not assigned to bulk sub-agent work (wasteful).
- **opus (frontier class)** — L-class and security/data-sensitive tasks: WP-003 (store retirement), WP-005 s1/s4 (IA + migration), WP-006 s1–s3 (orchestration entry + sandbox/allowlist), WP-008b (wipe), WP-010 (auth surface). Table row: "L slices, security-sensitive changes, root-cause arbitration".
- **sonnet (mid class)** — default implementation: all M/S rows above (WP-001/002/004, WP-005 s3, WP-006 s4–7, WP-007, WP-008a, WP-009, WP-011, WP-012). Table row: "Default implementation: S/M slices, tests, routine refactors, persona journeys".
- **haiku (small/fast)** — no standing assignment; available for mechanical scans/log triage inside any task. Explicitly rejected where copy judgment or persona assertions exist (WP-011, WP-006 specs).
- **Effort**: medium = routine implementation rows; high = cross-layer rows (WP-002 s2, WP-003, WP-005, WP-006 s1–3, WP-007 s2–5, WP-008b, WP-010); low = mechanical soak (WP-006 s7); xhigh = reserved for final P0-scope verification and wipe-mutation review (reserve budget, not a feature row). Effort is paired with explicit evidence requirements in every brief (policy: effort buys depth, not correctness).

## Planned Budget Ledger

All budgets **soft** — the host enforces no output-token cap on sub-agents; enforcement is checkpoint math by the implementation lead (60%/150% thresholds per budget-policy).

| Task | Class | Model | Effort | Budget (output tokens, soft) |
|---|---|---|---|---|
| WP-001 | M | sonnet | medium | 60k |
| WP-002 (incl. s2) | M | sonnet | medium/high | 60k |
| WP-003 | L | opus | high | 120k |
| WP-004 | M | sonnet | medium | 50k |
| WP-005 s1+s2+s5 | L | opus | high | 115k |
| WP-005 s3 | M | sonnet | high | 60k |
| WP-005 s4 | L | opus | high | 120k |
| WP-006 s1+s2 | L | opus | high | 150k |
| WP-006 s3 | L | opus | high | 100k |
| WP-006 s4–s6 | M×3 | sonnet | medium | 180k |
| WP-006 s7 | S | sonnet | low | 20k |
| WP-007 s1 | S | sonnet | medium | 20k |
| WP-007 s2–s5 | L (sliced) | sonnet | high | 140k |
| WP-008a | M | sonnet | medium | 50k |
| WP-008b | M | opus | high | 40k |
| WP-009 | M | sonnet | medium | 40k |
| WP-010 | M | opus | high | 50k |
| WP-011 | S–M | sonnet | medium | 30k |
| WP-012 | M | sonnet | medium | 40k |

- Feature-work planned total (all 12 WPs): **1,445k**
- Reserve (18%, verification + integration only — joint E2E waves, soak re-runs, adversarial P0 review at opus/fable xhigh): **260k**
- Mission total planned (full menu): **1,705k soft**
- **Recommended-bundle subtotal (WP-001..004): 290k + 60k reserve = 350k** — selection will subset this ledger; per-task rows sum cleanly for any menu choice.

## Concurrency and Write-Ownership Plan

One writer per surface; canonical registers (run.md, phase-state, ledgers, registers) are written ONLY by the top-gun orchestrator — sub-agents return deltas under agent-deltas/. Cap concurrent implementation sub-agents at 3 + lead; schedule further waves.

Waves (dependency-honoring; PRD §18 order):

1. **Wave 1 (parallel ×3)**: WP-001 [group A: src/connectors/api.ts, src/screens/Messages.tsx, useStore hydrate/badges, Shell badge, Dashboard "Needs you"] ∥ WP-002 [group B: server/internal-functions.mjs, providers.mjs, assistant-runs.mjs, index.mjs/orchestrator attribution] ∥ WP-007 s1 [group A2: Settings/AIProviders + ai.mjs].
2. **Wave 2**: WP-003 [C1: useStore.ts (sole owner), Automations.tsx, Agents.tsx history, plan card] ∥ WP-004 [C2: FilesKnowledge.tsx, new Tasks surface, Dashboard (after WP-001 s3), assistant-runs links (after WP-002)].
3. **Wave 3**: WP-006 s1+s2 then s3 [F: server/orchestrator.mjs, index.mjs routes, net.mjs sandbox].
4. **Wave 4**: WP-005 s1/s2/s5 → s3 → s4 [E: nav/IA, src/data catalogs, migration scripts] ∥ WP-007 s2–s5 [H: NEW server/memory-provider.mjs, internal-functions write path (after WP-002 releases it), planner context, ActivityMemory Memory tab].
5. **Wave 5**: WP-006 s4–s6 UC spec fan-out [G: disjoint tests/topgun/usecases/*.spec.ts] ∥ WP-008a→8b [I: ActivityMemory Improvements tab, engine.mjs evolution block] ∥ WP-010 [K: Lock.tsx, session plumbing, /api/profiles].
6. **Wave 6**: WP-009 [J: useStore hydrate — after C1] → WP-011 [engine.mjs sweeper — after I] ∥ WP-012 [L: docs/Settings guidance/sandbox closure] → WP-006 s7 soak (last, from reserve cadence).

**Serialized surfaces (never two writers)**: src/store/useStore.ts (WP-001→003→009) · server/assistant-runs.mjs (WP-002→004) · server/index.mjs routes (WP-002 s2→006 s1→010) · server/engine.mjs (WP-008→011) · server/internal-functions.mjs (WP-002→007 s3) · src/screens/Dashboard.tsx (WP-001→004) · resident tenant data (read-only; mutations only in WP-005 s4/WP-008b after explicit user approval, backup-first).

## Authority Constraints

No route may, without new explicit user authorization:

1. Commit, push, or deploy (push triggers Render auto-deploy of homeops-ai — shared production state; S8 gate).
2. Send anything externally (email/SMS/Slack/webhook to real endpoints) — sandbox/dry-run/approval-parked only; UC-14 real SMS additionally requires user-supplied Twilio credentials AND a recorded go-ahead.
3. Run OAuth flows, create accounts, enter credentials/tokens, or provision provider apps — user-owned (DEC-016; permission system is the only consent channel).
4. Mutate resident tenant data — read-only; WP-005 s4 migration and WP-008b wipe execute only after user selection + dry-run-report approval, backup-first, archive-not-delete; version stores are never deleted.
5. Rewrite the durable run engine (DEC-012 keeps it) — WP-006 is the orchestration layer only.
6. Install software beyond the selected scope's declared needs (Supermemory sidecar only within a selected WP-007; nothing during matching/verification to fill capability rows).
7. Write secrets (LM Studio token, any credential) into memory files, journals, or artifacts.
8. Weaken security posture: net.mjs allowlist in real mode, PIN/password gates, CSRF, policy clamps.

## Unavailable Capability Effects

| Capability | State | Effect on plan | Workaround chosen | Unblock condition |
|---|---|---|---|---|
| LM Studio API auth | blocked (401 re-probed 06:57Z this session) | WP-007 s1 acceptance ("Test connection green"), HYP-005 Qwen latency probe, and any real-local-model E2E cannot complete; WP-006 s2 local-model prompt-budget tuning partially blind | Build token field + header injection + health hint now with unit evidence; mark acceptance DEFERRED-ON-GATE, not passed | User supplies an LM Studio API token (LM Studio UI → developer/authentication docs page cited in the 401 body) |
| Google OAuth (gmail.send), Microsoft/Slack/Dropbox app registrations, Twilio | blocked (user-owned, DEC-016) | 13 of 22 UCs cannot run real-credential lanes (WP-006 s6, WP-012); WP-002 external email/SMS delivery unverifiable | HOMEOPS_CONNECTOR_SANDBOX mode (WP-006 s3) + in-app delivery path (WP-002 s3); pass gate = sandbox twin green + named blocker printed | User provisions apps/credentials per WP-012 checklists; real smoke in a user-authorized session |
| Supermemory sidecar | not installed (install forbidden this phase) | WP-007 s2–s5 depend on implementation-time install; Windows stability unproven (risk noted in PRD §20) | Feasibility grounded in EV-036 only; DEC-014 FTS5 fallback pre-agreed; sidecar boot opt-in via scripts/dev.mjs | Selected WP-007 implementation begins (self-serve `npx supermemory local`); set NODE_EXTRA_CA_CERTS first if npx TLS fails (env var EMPTY this session; see environment memory) |
| appium-device-cloud / appetize-sim | blocked (no creds) + out-of-mission | none for WP-001..012 (web-only mission; DEC-010 defers native) — recorded so no route claims native evidence | n/a | User supplies vendor creds + uploaded build (future native mission) |
| Client component-test runner (no vitest/jest in devDeps) | absent in repo | WP-003 "component tests for mapper", WP-011 snapshot wording cannot run as classic component tests | Route pure-function mapper tests through node --test; visual/behavior assertions through playwright-web specs; adding vitest is an implementation-lead decision (record as DEC if taken) | Lead adds a runner within selected scope |
| ~63 claude.ai connectors pending OAuth | blocked | none — no WP routes through them | n/a | User authorizes via connector settings (not needed) |
| gh CLI | unavailable | none — no PR-based flow planned; git push is user-gated anyway | git + user-driven review | n/a |
| Production (Render) parity | unverified this run | all verification claims are local-dev only until S8 | Explicit "local-dev evidence" labeling in reports | User authorizes deploy + post-deploy check (render:check-render-status) |

## Reassessment Triggers

Standard set (matching-policy.md): capability appears/disappears/changes auth state; host model/effort choices change; any task budget >150% at a checkpoint; scope/selection changes; a route fails twice for the same cause; **phase transition into implementation (mandatory revalidation of drift-prone facts)**.

Mission-specific:

- LM Studio token supplied → re-probe :1234, flip WP-007 s1 acceptance lane open, schedule HYP-005 latency probe before WP-006 s2 tuning.
- Any OAuth credential provisioned → open the matching real-credential UC lane (WP-006 s6/WP-012) for that provider only.
- Supermemory sidecar unstable on Windows (crash/latency >300ms p95 per PRD §14) → execute DEC-014 FTS5 fallback and update WP-007 routing.
- Qwen3.6-27B latency breaches chat first-token ≤3s budget → raise WP-006 s2 catalog-pruning priority; re-route planner-model default.
- User selects a subset at the menu → re-cut ledger to the selected rows (rows are independently summable).
- **Implementation-entry revalidation checklist (drift-prone facts the implementation lead MUST re-verify before wave 1)**: dev server boots via scripts/dev.mjs (:8787/:5173 free); baseline suites green before any change (npm run typecheck, npm test, npm run topgun:web) — current pass-state was NOT asserted this phase; LM Studio still 401 (or token arrived); NODE_EXTRA_CA_CERTS set if any node CLI hits TLS interception; playwright chromium/webkit binaries still present; tests/topgun/usecases still absent; host sub-agent concurrency cap; resident tenant untouched (hash/inventory spot-check vs EV-031).

---

## Addendum — 2026-07-21 routing correction (orchestrator, per lead event #44)

After the session-limit interruption, WP-003 and WP-006 s3 respawns were moved from their opus rows to the guide's own sonnet-high fallback rows: their opus predecessors had already completed the design-heavy portions (WP-003 run-mapper design; WP-006 s3 sandbox seam), leaving mechanical wiring + tests as remaining scope. WP-004 stays sonnet. Remaining budgets trimmed to 90k (WP-003) / 60k (WP-004) / 40k (WP-006 s3); mission concurrency capped at 3 subagents to stay under the account's session limit. Original rows preserved above for lineage.
