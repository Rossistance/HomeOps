# Capability-Task Matching Guide

- Run: run-20260720-225249
- Phase: MATCHING_RUNNING → routes the implementation phase (S6–S7) + ship (S8)
- Inventory timestamp: 2026-07-20T23:45:00Z (all rows probed THIS session)
- Scope: route WP-001..013 (13 work packages, 22 use-cases) for the full pre-selected mission — build all active items, spec all inactive items, commit/push/deploy, TestFlight.
- Model aliases exposed this session (Agent tool enum): `haiku`, `sonnet`, `opus`, `fable`. Reasoning effort: low/medium/high/xhigh. Mission inherits `opus`.
- Spec/design gate (matcher §Required context gate): `product-management:write-spec` and `design:design-handoff`/`design-critique`/`design-system` are ALL exposed this session and were invoked — framing applied below. No Figma/project-tracker/knowledge-base connectors are attached, so both operate offline (recorded, not a blocker).

### Spec framing (from product-management:write-spec)
- **Problem**: 22 use-cases exist only as prose in `source-use-cases.txt`. The runnable/verifiable FamiliOS unit is a Skill whose `steps[].tool_id` match the real catalog (DEC-001); prose alone ships nothing.
- **Users**: the 5 canonical personas (Alex/owner, Morgan, plus household members) who need automations that actually fire, not templates that merely render (the 7 AM-briefing scar).
- **Scope (P0)**: 9 active use-cases as catalog entry + backing skill + criteria doc, verified on the local stack; 13 inactive as spec+criteria only; ship. **Non-goals (P2)**: connector activation, live prod seeding via script, native iOS visual verification.
- **Acceptance**: every active skill runs end-to-end locally with real tool_ids; every UC has a criteria doc; CI green; Render serving new bundle; TestFlight submitted; honest labeling throughout.

### Design-side framing (from design:design-handoff)
- The design surface here is NOT visual mockups (native iOS visual lane is closed, DEC-10). It is (a) the **approval-gate UX contract** — every Send/High-risk step (`gmail.modifyLabels`, `smarthome.setThermostat`, `create_approval`, `notify_contact`) must surface an approval and fail closed, never auto-send; and (b) the **criteria-doc format** (DEC-003) as the reviewable handoff artifact. States to specify per skill: happy-path result shape, empty/guard state (e.g. `empty_text`), and honest typed-error state (e.g. `method_not_registered`, `event_not_found`, fail-closed SDM setup message). These states are the "handoff spec" the implementation lead builds against.

---

## Capability Map

| Capability | Classification | Evidence (this session) | Side-effect authority | Timestamp |
|---|---|---|---|---|
| Read / Glob / Grep / Edit / Write | use now | prompt tool list | local-write | 23:45 |
| Bash (git-bash) + PowerShell | use now | prompt tool list; probes ran | local-write / exec | 23:45 |
| Node 25.8.2 | use now | `node --version` → v25.8.2 (default + mandated path identical) | local-exec | 23:45 |
| npm test (`node --test server/test/*.test.mjs`) | use now | package.json §scripts; baseline 352 tests green (EV-014/15/16) | local-exec | 23:45 |
| tsc typecheck (both apps) | use now | package.json `typecheck`/`build`; baseline both exit 0 | local-exec | 23:45 |
| Local stack `scripts/dev.mjs` (backend :8787 + Vite :5173) | use now (REAL family data — TG- prefix + cleanup) | package.json `dev`; runtime-drivers.json notes | local-exec / local-mutate | 23:45 |
| git (branch `main`) → push auto-deploys Render | use now — **push/deploy is S8-gated** | `git rev-parse` → main; memory familios-render-deploy-state | external-write | 23:45 |
| playwright-web driver | use now | runtime-drivers.json id `playwright-web`; playwright ^1.61 + config `tests/topgun/playwright.config.ts` present | local-exec | 23:45 |
| appium-device-cloud driver | **blocked** | runtime-drivers.json; env probe: no BROWSERSTACK/LT/APPIUM creds; no uploaded app id | n/a (native lane closed) | 23:45 |
| appetize-sim driver | **blocked** | runtime-drivers.json; env probe: no APPETIZE_API_TOKEN/PUBLIC_KEY | n/a | 23:45 |
| EAS CLI `eas build -p ios --profile production --auto-submit` (TestFlight) | use now — **S8-gated; requires NODE_EXTRA_CA_CERTS (currently UNSET)** | eas.json + app.json present; build 21 shipped this session; env probe NODE_EXTRA_CA_CERTS=unset | external-write | 23:45 |
| EAS MCP (`933a786f…build_run/build_submit/testflight_*`) | use if needed (fallback to CLI) | ToolSearch loaded build_run/build_submit/workflow_run schemas; auth state unverified; requires GitHub repo connected | external-write | 23:45 |
| Agent tool (implementation-lead, general-purpose, Explore, Plan, feature-dev:*, code-reviewer, code-simplifier) | use now | Agent types list | delegation | 23:45 |
| top-gun:mem / capability-task-matcher / lean-implementation | use now | invoked this session | n/a | 23:45 |
| product-management:write-spec | use now (applied) | invoked; no tracker/KB connector attached → offline | read | 23:45 |
| design:design-handoff / design-critique / design-system | use now (applied) | design-handoff invoked; no Figma connector → offline | read | 23:45 |
| Gmail MCP (`24a83aa6…`) | use if needed | deferred schemas listed; budgetbeacon.ai acct only — cannot observe wrhixon inbox; NOT the build path | external-write | 23:45 |
| Calendar / Notion / Drive MCP (06c82849 / 2a894a3d / 7a0c132b) | irrelevant | deferred; build uses repo skill catalog, not these connectors | — | 23:45 |
| Scripted live production mutation | **blocked** | classifier denies POST/PATCH/DELETE to prod (EV-013/017) | — | 23:45 |
| MS365 / Slack / Dropbox / Notion / Todoist / TickTick / Alexa / RSS / Custom-HTTP / Browser-Automation connectors | **blocked / unavailable** | production /api connector inventory (ART-001); "Setup by admin"/"not configured"/"runtime unavailable" | — | 23:45 |
| Artifact / mcp__visualize / Claude Browser pane | use if needed / irrelevant | prompt tools; UI renderer fragile (ART-001); not needed for server-side skill verification | local-write / read | 23:45 |

### Capability deltas vs ART-001 (facts handoff)
1. **"recent inbox digest (internal)" tool does NOT exist** — ART-001 §Capability listed it; the internal registry has only the 13 `homeops.*` tools (ISS-002/EV-020). UC-22 must **compose** the digest. Routed accordingly.
2. **Runtime-driver manifest present** at `tests/topgun/runtime-drivers.json` (ART-001 didn't mention it). Native drivers appium/appetize are **BLOCKED** (no cloud creds); `playwright-web` is `use now`. Native lane closed anyway (DEC-10) — no effect on this mission.
3. **NODE_EXTRA_CA_CERTS is UNSET** this session (memory windows-tls-and-cli-environment says EAS needs it). Must be exported at WP-012 execution or the EAS build fails.
4. **engines.node `>=22.13 <25` vs runtime 25.8.2** confirmed (ISS-008) — advisory; optionally widen in the WP-012 commit.
5. **product-management:write-spec + design:\* skills AVAILABLE** — the matcher gate is satisfied (not a gap); ART-001 did not assess these.
6. **EAS MCP tools are loadable** as a fallback to the proven CLI path for WP-012 (auth state unverified — do not trigger auth).

---

## Phase Matrix

| Phase | Capabilities engaged | Explicitly NOT engaged (why) |
|---|---|---|
| Foundation (WP-011, WP-013) | Write (docs), local stack `scripts/dev.mjs`, npm test/tsc baseline, TG- fixtures + `/api/assistant/build` materialize smoke | playwright-web (verification is server-side skill runs, not UI journeys); prod mutation (blocked) |
| Active builds (WP-001..009) | Edit/Write (skill files + catalog arrays + criteria docs), local `runSkill`/scheduled-run/contract harness, tsc/npm test per slice | live connectors (only Gmail/Weather/Web/smarthome/homeops-native are active — used); prod seeding (UI/user-side, DEC-006); native drivers (blocked) |
| Inactive specs (WP-010) | Write (docs only) | ALL skills/live catalog entries — building would fabricate verifiability (ISS-005) |
| Ship (WP-012) | git commit/push → Render auto-deploy, `/api/health` + bundle-hash verify, EAS CLI TestFlight (NODE_EXTRA_CA_CERTS set) | EAS MCP (CLI is proven; MCP only if CLI fails); scripted prod record-seeding (blocked — UI/user-side) |

---

## Task Matrix

Model class per budget-policy: `sonnet` = mid/default implementation; `opus` = frontier for high-risk/release/correction-heavy synthesis. Effort tuned to ambiguity, not habit. All budgets are **soft** output-token guidance (host does not enforce). "Agent role" names the recommended executor; `inline (lead)` means the implementation lead does it to protect a shared write surface.

| Task | IDs | Primary route | Fallback route | Agent role | Model | Effort | Budget | Concurrency group | Checkpoints | Drift signals | Verification | Return contract |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WP-011 Criteria scaffold (25 files) | DEC-003; FEAT-001..022 | Write `docs/use-case-criteria/**` from master-report §Criteria-doc format + 22-row mapping | inline (lead) if agent drifts | sonnet subagent | sonnet | medium | 30k | CG-FOUNDATION | midpoint (after `_TEMPLATE`+README) | inventing tool_ids not in mapping; missing files | 25 files exist; lint: every active UC lists only real tool_ids | file list + lint output |
| WP-013 Local harness + materialize smoke | ISS-006; HYP-004; PI-08 | Boot `scripts/dev.mjs`; TG- fixtures; POST UC-18 spec to `/api/assistant/build`; verify created ids; delete TG-; reusable run+cleanup helper | inline (lead) — real-tenant risk | inline (lead) | opus | high | 45k | CG-FOUNDATION | per step (boot / smoke / cleanup) | any non-TG record touched; cleanup skipped; smoke claimed w/o ids | pre/post non-TG counts equal; smoke returns ids; baseline green | boot log + returned ids + count diff |
| WP-002 UC-17 Recipe Extractor | FEAT-017 | Skill `web.search→web.read→web.recipe` (Manual, Read, no approval) + catalog(skill) + UC-17.md | inline | sonnet subagent | sonnet | medium | 18k | CG-ACTIVE-A | midpoint | approval added where none needed | local `runSkill` on known URL; returns `{recipe{ingredients,instructions,source}}`; null path honest | runSkill output + criteria doc path |
| WP-003 UC-18 Memory Scrapbooker | FEAT-018 | Skill `homeops.write_memory→create_artifact` + catalog(skill) + UC-18.md | inline | sonnet subagent | sonnet | medium | 18k | CG-ACTIVE-A | midpoint | empty_text guard dropped | local `runSkill`; memory row + artifact row w/ ids; empty text refused | runSkill output + ids |
| WP-004 UC-19 Event Coordinator | FEAT-019 | Skill `create_event_draft→[thread eventId]→update_event_checklist→assign_driver→assign_what_to_bring` + catalog(skill) + UC-19.md | inline | sonnet subagent | sonnet | high | 25k | CG-ACTIVE-A | midpoint | eventId not threaded → `event_not_found` | local `runSkill`; one event, checklist has "Pick up ice", driverId set, ≥1 what-to-bring, all same eventId | event record dump |
| WP-001 UC-01 School Correspondence | FEAT-001 | Skill `gmail.search→gmail.listLabels→gmail.modifyLabels`(approval) + workflowTemplate + UC-01.md | inline | sonnet subagent | sonnet | high | 30k | CG-ACTIVE-B | midpoint | modifyLabels auto-runs w/o approval; real inbox mutated | local `runSkill` on **test Gmail**/mocked api(); `{modified≥1,added:[School],removed:[INBOX]}`; approval required | runSkill output + approval trace |
| WP-005 UC-20 Chore + Doc Linker | FEAT-020; ISS-001; HYP-005 | Skill `create_task(notes=ref)→create_list_item`; **NO `attach_note_or_file_reference`** (targets events) + catalog(skill) + UC-20.md | companion-event variant if true attach required | sonnet subagent | sonnet | high | 28k | CG-ACTIVE-B | midpoint | fabricated task-attachment step | local `runSkill`; task.notes holds ref, list item on "Weekend"; doc states limitation | task+list dump + criteria note |
| WP-007 UC-22 Internal System Sync | FEAT-022; ISS-002 | Skill `write_memory→(gmail.search newer_than:1d / reason over activity)→create_artifact`; **compose digest** (no inbox-digest tool) + catalog(skill) + UC-22.md | inline | sonnet subagent | sonnet | high | 25k | CG-ACTIVE-B | midpoint | cites non-existent internal tool | local `runSkill`; memory row + digest artifact from real data; every step a real tool_id | runSkill output + artifact |
| WP-008 UC-14 Morning Status Text | FEAT-014; ISS-003; DEC-005; HYP-002 | Skill+automation(Schedule 06:30) `weather.current→[rss.latest OPTIONAL/stub]→compose→homeops.notify_contact`; **NOT `sms.send`** + workflowTemplate + UC-14.md | inline | sonnet subagent | sonnet | high | 30k | CG-ACTIVE-B | midpoint | uses sms.send on unattended path; RSS treated as required | local scheduled-run harness w/ TG- verified method; text has real weather; RSS omitted-with-note if unconfigured; honest refusal if method unverified | scheduled-run delivery audit |
| WP-006 UC-21 Meal Planner + Sign-Off | FEAT-021; DEC-005 | agentTemplate + Skill `plan_meal→send_notification_draft→notify_contact→create_approval`(approval) + UC-21.md | inline | sonnet subagent | sonnet | high | 35k | CG-ACTIVE-B | 2 (mid + pre-return) | create_approval not requiresApproval; delivery w/o verified method | local `runSkill` w/ TG- method+allowlist; meals+groceries+events; notif draft; delivery ok or honest `method_not_registered`; sign-off recorded | runSkill output + approval artifact |
| WP-009 UC-12 Smart Climate Night-Mode | FEAT-012; ISS-004; HYP-003 | Skill+automation(Schedule 22:00) `smarthome.listDevices→smarthome.setThermostat`(approval) + workflowTemplate + UC-12.md | inline | sonnet subagent | sonnet | medium | 20k | CG-ACTIVE-A | midpoint | claims device verification from mock | contract-shape assert via mocked api(): `sdm…SetHeat` heatCelsius 20 + approval; fail-closed if `HOMEOPS_SDM_PROJECT_ID` unset; **label runtime-device-unverified** | contract-test output + unblock note |
| WP-010 Inactive specs (13 docs) | FEAT-002..011,013,015,016; ISS-005/007 | Write `UC-{02..11,13,15,16}.md`: verbatim intent, real tool_id chain (connected:false), exact connector to activate, mock/contract criteria, NOT-IMPLEMENTED banner; ISS-007 native-alt notes for UC-04/07/11 | inline | sonnet subagent | sonnet | medium | 40k | CG-INACTIVE (parallel w/ active) | midpoint (after 6 docs) | any inactive UC wired to a live skill; missing banner | doc review + lint: no inactive UC → live skill | 13 doc paths + lint |
| WP-012 Commit/push/deploy + TestFlight | PI-08; EV-022; ISS-008 | `npm test`+both tsc → branch+commit+push (Render auto-deploy) → verify `/api/health`+bundle-hash → `eas build -p ios --profile production --auto-submit` (NODE_EXTRA_CA_CERTS set) | EAS MCP `build_run`/`build_submit` if CLI TLS fails | inline (lead) | opus | high | 30k | CG-SHIP (last, serialized) | pre-push (CI green) + post-deploy (hash) + post-submit (build id) | **push/build without S8 authorization**; skipping CI; resubmitting on rollback | CI green; Render new bundle hash; EAS build id | command logs + hash + build id |

---

## Model and Effort Rationale

Per `top-gun:lean-implementation` `references/budget-policy.md`:

- **sonnet / medium** — default for the clean, low-ambiguity slices (WP-002/003, WP-009, WP-011, WP-010). These are single-surface skill+doc builds with a fixed tool-chain and a deterministic result shape; the mid class is purpose-fit and frontier would be wasteful (budget-policy "Do not assign frontier to mechanical bulk work").
- **sonnet / high** — the correction-heavy and id-threaded active builds (WP-001 real-Gmail approval, WP-004 eventId threading, WP-005 attach-mismatch, WP-006 delivery+approval, WP-007 compose-digest, WP-008 scheduled notify_contact). These carry a specific known failure mode where a literal build would fabricate a step or auto-send; high effort buys the depth to honor the correction, paired with explicit evidence requirements (a real runSkill artifact) so effort does not substitute for proof.
- **opus / high, inline (lead)** — WP-013 harness (real-tenant blast radius; cleanup correctness is a safety property) and WP-012 ship (release, S8-gated, security-sensitive). budget-policy assigns frontier to "L slices, security-sensitive changes, release." Kept inline because both touch shared/authoritative surfaces (the real tenant; git/deploy) that must have a single writer.
- **Model correction trigger**: if sonnet subagents on the active builds show underpowered signals (repeated wrong fixes, cite a non-existent tool_id, or self-contradict on the id-threading), upgrade effort or respawn on opus at the next checkpoint and update this rationale (reassessment trigger below).

---

## Planned Budget Ledger

_Implementation phase — soft output-token budgets._

| Task | Class | Model | Effort | Budget | Soft/Hard | Rationale |
|---|---|---|---|---|---|---|
| WP-011 | M | sonnet | medium | 30k | soft | 25 templated files, mechanical bulk from mapping |
| WP-013 | L | opus | high | 45k | soft | real tenant; boot + smoke + cleanup correctness |
| WP-002 | S | sonnet | medium | 18k | soft | clean 3-step read skill |
| WP-003 | S | sonnet | medium | 18k | soft | clean 2-step native skill |
| WP-004 | M | sonnet | high | 25k | soft | eventId threading risk |
| WP-001 | M | sonnet | high | 30k | soft | real-Gmail approval-gated write |
| WP-005 | M | sonnet | high | 28k | soft | attach-mismatch correction |
| WP-007 | M | sonnet | high | 25k | soft | compose digest, no inbox tool |
| WP-008 | M | sonnet | high | 30k | soft | scheduled delivery correction |
| WP-006 | M | sonnet | high | 35k | soft | agent+skill+delivery+approval |
| WP-009 | S | sonnet | medium | 20k | soft | contract/mock, device-unverified |
| WP-010 | M | sonnet | medium | 40k | soft | 13 spec docs, bulk |
| WP-012 | M | opus | high | 30k | soft | release orchestration + S8 gate |

- Mission total planned: 374k output tokens (implementation phase, sum of the per-task budgets above).
- Reserve: 74k (≈17% of the 448k planned+reserve envelope) — held for the lead's per-slice tsc/npm test re-runs, catalog integration, and final ship verification; never spent on feature work.
- Grand planned envelope: ~448k. All budgets soft (host does not enforce).
- Matching-lead (this task) budget: 120k soft — tracked separately; consumed figure in the return.

---

## Concurrency and Write-Ownership Plan

**Shared single-writer surfaces (implementation lead owns; NEVER two agents at once):**
- `src/data/catalogIds.ts`, `src/data/agentTemplates.ts`, `src/data/workflowTemplates.ts`, `src/data/playbooksCatalog.ts` — every active build appends a new id/entry here. Subagents author their **isolated** skill file + criteria doc and return a **catalog patch spec**; the lead applies catalog registrations serially. This is the key collision control — do not delegate concurrent edits to these four files.
- `package.json` (engines widen, ISS-008), git/commit, deploy — lead only.
- `.top-gun/**` canonical registers (event-journal, artifact-ledger, phase-state) — mem/top-gun only; no subagent writes.

**Isolated per-WP surfaces (safe to parallelize):**
- Each backing skill file (distinct path) and each `docs/use-case-criteria/UC-NN.md` (distinct path per UC).

**Waves (cap = host concurrency; schedule beyond the cap):**
- **Wave 0 — CG-FOUNDATION (parallel, disjoint surfaces):** WP-011 (docs/) ∥ WP-013 (harness). Both gate all active builds. WP-013 is inline-lead (real tenant).
- **Wave 1 — CG-ACTIVE-A ∥ CG-INACTIVE:** clean builds WP-002/003/004/009 (sonnet subagents, isolated skill+doc) run parallel with WP-010 (docs-only, disjoint UC files). Lead integrates each catalog patch serially as returns arrive.
- **Wave 2 — CG-ACTIVE-B:** correction-heavy WP-001/005/006/007/008 (sonnet/high). WP-006 and WP-008 depend on WP-013 (TG- method); sequence after harness. Lead integrates catalog patches serially.
- **Wave 3 — CG-SHIP (serialized, after all + S8 authorization):** WP-012.

Delegation value test (matcher §Delegation): active builds pass (b) parallelism + (a) isolation for the per-skill/per-doc surface → delegate. WP-013 and WP-012 fail the isolation test (shared authoritative surface) → inline. WP-010 passes (b) → delegate as one agent.

---

## Authority Constraints (no route may do these without new authorization)

- **No scripted production mutation** — POST/PATCH/DELETE to prod is classifier-blocked (EV-013/017). Prod is `/api/health` + bundle-identity read-only. Live record-seeding is UI/user-side (DEC-006).
- **WP-012 push/deploy/TestFlight requires explicit S8 user authorization** before execution. Deploy is external-write; do not push or build without it.
- **No new-connector activation** and **no live external sends** except already-consented `wrhixon@gmail.com`. Scheduled delivery uses `homeops.notify_contact` to a verified TG- method only (DEC-005).
- **Local stack holds REAL family data** — all test records TG- prefixed, guaranteed cleanup; prefer isolated harness (WP-013).
- **Never fabricate a tool_id** — every step cites a real catalog id (the UC-20 attach and UC-22 digest corrections exist precisely to stop this).
- Canonical registers are single-writer (mem/top-gun).

---

## Unavailable Capability Effects

| Capability | State | Effect on plan | Workaround chosen | Unblock condition |
|---|---|---|---|---|
| Scripted live prod mutation | blocked | "live seed" half of BOTH cannot be scripted on prod | Ship code templates + verify materialize on LOCAL stack (WP-013, TG- data); provide UI/seed path | Authorize a safe server-side seed endpoint (DEC-006) |
| MS365/Slack/Dropbox/Notion/Todoist/TickTick/Alexa/RSS/HTTP/Browser connectors | blocked/unavailable | 13 use-cases cannot be built+verified (ISS-005) | WP-010: spec + connector-decoupled criteria doc, labeled NOT-IMPLEMENTED | User activates the named connector per UC |
| RSS/Feed (UC-14 sub-step) | blocked | RSS section of Morning Text can't run | RSS step marked OPTIONAL/stubbed; skill degrades gracefully; weather+text path verified | Configure RSS/Feed connector |
| Physical Nest + `HOMEOPS_SDM_PROJECT_ID` (UC-12) | blocked | UC-12 cannot be device-verified | WP-009 contract-shape assert via mocked api(); label runtime-device-unverified | Set SDM project id + connect a Nest (ISS-004) |
| appium-device-cloud / appetize-sim drivers | blocked | no native-iOS runtime evidence | none needed — native visual lane closed (DEC-10); web/server verification only | User supplies BROWSERSTACK/LT/APPETIZE creds + uploaded build (out of scope) |
| NODE_EXTRA_CA_CERTS unset | blocked (env) | EAS TestFlight build will fail TLS | Export NODE_EXTRA_CA_CERTS before WP-012 EAS call (memory windows-tls-and-cli-environment) | Set the env var at ship time |
| Gmail MCP (wrhixon inbox) | unavailable | cannot observe the real wrhixon inbox for UC-01/22 | Use a test Gmail / mocked provider api() for local runSkill | User grants access to the target inbox (not required for the build) |
| Figma / project-tracker / knowledge-base connectors | unavailable | write-spec/design-handoff run offline | Applied their framing manually (spec + design sections above) | Connect the tools (not required) |

---

## Reassessment Triggers

Standard set (matcher §Reassessment) plus mission-specific:
- A blocked connector activates, or a new internal tool appears → reclassify the affected UC from inactive to active (DEC-004 reversal).
- A sonnet subagent shows underpowered signals on a correction-heavy WP (cites a fake tool_id, mis-threads eventId, uses sms.send on the unattended path) → upgrade effort/respawn on opus and update the Model Rationale.
- A task overruns 150% at a checkpoint → intervene (steer/rescope/respawn) per budget-policy; >150% twice → mandatory rescope + DEC entry.
- The user grants S8 authorization (or withholds it) → WP-012 unblocks/holds; if withheld, the mission stops at "built + locally verified, not shipped."
- NODE_EXTRA_CA_CERTS still unset at WP-012, or Render/EAS auth changes → ship route reassessed.
- Phase transitions into implementation → mandatory revalidation of drift-prone facts: re-run `npm test` + both tsc (baseline 352/green), re-probe local-stack boot, re-confirm no prod mutation slipped in.
- Any route fails twice for the same cause → switch route (e.g. EAS CLI TLS fails twice → EAS MCP fallback).
