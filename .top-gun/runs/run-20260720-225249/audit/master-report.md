# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

FamiliOS — build-from-spec audit of the 22 source use-cases (ART-002) as FamiliOS agent/automation/skill templates. Run run-20260720-225249. Audit lead, single agent. Read-only on product source and production; local stack executed for baseline only.

## 1. Executive verdict and highest-value decision

**Verdict: the build plan is validated and ready. 9 of the 22 use-cases are build-ready on the live connector set; 13 are honestly blocked on inactive connectors and are delivered as spec + test criteria only. The 9/13 split in the facts handoff (ART-001) is CONFIRMED, with four code-grounded corrections.**

The highest-value decision (DEC-001): a FamiliOS "template" is a **declarative catalog entry** (`AgentTemplate`/`WorkflowTemplate`/`Playbook` in `src/data/*.ts`) whose fields are display strings — it is **not runnable**. The runnable, verifiable unit is a **Skill** whose `steps[].tool_id` match the real tool catalog (`server/planner.mjs` `toolCatalog`). Therefore every ACTIVE use-case must ship as **two** artifacts — a catalog entry *and* a backing skill — or it cannot be verified end-to-end. Building only catalog entries would produce pretty, non-functional cards; this is the single most important thing for the implementation lead to internalize.

Highest-value first build: the 5 FamiliOS-native items (UC-18, 19, 20, 21, 22) — they run entirely on always-connected internal `homeops.*` tools, need no external account, and are the surest wins — plus UC-01 (School Organizer, all-Google) and UC-17 (recipe extractor, web) as the two clean external actives.

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- **Scope:** derive the template contract; classify all 22 against the real catalog; define catalog home + exact tool_ids + acceptance criteria per item; define the criteria-doc format once; produce the work-package queue. **Out of scope:** writing product code, activating connectors, live prod seeding, native iOS visual verification (DEC-10 lineage).
- **Environments:** local stack (node 25.8.2, `scripts/dev.mjs`) executed for baseline; production `/api/health` only, no scripted mutation (classifier-blocked, EV-017). Local tenant holds REAL family data → TG- prefix + cleanup mandated.
- **Authorization:** repo read + local execute. Deploy/TestFlight (WP-012) is S8 and needs explicit user authorization.
- **Evidence limits:** the connector-readiness classification is grounded in code (EV-007/008/009) and the production probe from earlier this session (EV-017, historical). No new template exists, so **verified feature coverage is 0/22** — this run is the plan, not the build. Persona journeys are design-time (DEC-007), labeled synthetic.
- **Parity:** checked-out source = the deployed base (prior run run-20260720-073025 COMPLETE, Ask-Famili + calendar-dedup fixes live). Baseline health green: **352/352 server tests, web tsc clean, mobile tsc clean** (EV-014/015/016).

## 3. Capability inventory and agent topology

- **Used:** full local toolchain (node 25.8.2, `node --test`, both tscs), repo read, baseline execution. Single audit-lead agent (no nested sub-agents were needed — the work was catalog derivation + a bounded 22-item mapping, which one reasoner covers without shared-state risk; disclosed per mandate §243).
- **Available-not-used:** Playwright web lane, Chrome MCP (fragile), Gmail MCP (wrong account), server fakeProvider harness — deferred to the implementation lead's verification.
- **Unavailable:** scripted prod mutation; the 10 inactive connectors; native iOS visual lane.

## 4. Application understanding

- **Product purpose:** an approval-gated family operating system — households adopt helper agents from a catalog and run automations/skills over real connectors and a server-owned household graph, with honest failure and no fabricated success (PI-01, PI-03).
- **Target users:** a multi-role household — Owner, Adult Admin, Child View, Guest/Helper — mixed fluency, real and sometimes sparse data (PI-07; seed roster EV-006).
- **Core jobs:** turn plain-English intent into runnable helpers; keep the household graph (events/tasks/meals/memory/artifacts/approvals) current; deliver on a schedule without a human present (PI-04).
- **Architecture and authority:** two-layer template model (declarative catalog + executable skill/function/agent/trigger); planner validates every step's tool_id against the live catalog; all side effects approval-gated; unattended delivery via the fail-closed contact-method registry. See `architecture-authority-map.md`.
- **Strengths worth preserving:** the honest tool catalog with per-actor connectedness; the fail-closed connectors (weather/smart-home/notify all refuse rather than fake); the `notify_contact` scheduled-delivery design (WP-005 lineage); the skill/function state machine that only calls a capability "available" after a real passing test. **Do not rewrite these — build on them.**
- **Unresolved assumptions:** whether the household wants native variants of the inactive items (HYP-006); device availability for UC-12 (HYP-003).

## 5. Observed product intent, inferred vision, success measures, and contradictions

Intent is catalogued in `product-intent-register.md` (PI-01..PI-10). Success measure for THIS run: all 22 mapped to real tool_ids; 9 active build-ready with observable acceptance; 13 inactive labeled + unblock-named; one criteria format applied to all 22. **Contradiction resolved (PI-02):** "build as templates" vs "verify end-to-end" — reconciled by shipping catalog entry + skill together (DEC-001). **Contradiction preserved (PI-09/PI-10):** the source's connector breadth exceeds live provisioning; native-active variants of UC-04/07/11 exist but the source declared inactive connectors — kept as opportunities (ISS-007), not silently reclassified.

## 6. App Functionality Inventory and coverage

Full inventory + the 22-row UI-to-Backend Trace Matrix in `functionality-inventory.md`. Coverage: **Execution 22/22 (100%)** — all 22 traced against the real catalog; **Verified 0/22 (0%)** — nothing built yet (9 build-ready-active, 13 blocked-inactive); **Persona 22/22 (100%)** — each assigned to ≥1 journey. Blocked/partial/inactive never counted as verified.

### The 22-row mapping table (UC → catalog home → connector status → FamiliOS tool_ids → verify lane)

| UC | Name | Catalog home | Connector status | FamiliOS tool_ids (exact) | Verify lane |
|---|---|---|---|---|---|
| 01 | School Correspondence Organizer | workflowTemplate + skill | **active** | gmail.search, gmail.listLabels, gmail.modifyLabels | local runSkill (test Gmail) |
| 02 | Emergency Work-to-Home Forwarder | workflowTemplate + skill | inactive (MS365) | outlook.search + gmail.send | spec+criteria only |
| 03 | Urgent Slack Escalation | workflowTemplate + skill | inactive (MS365+Slack) | outlook.search + slack.listChannels + slack.postMessage | spec+criteria only |
| 04 | Grandparent Weekly Digest | workflowTemplate + skill | inactive (MS365)* | outlook.send | spec+criteria (native alt: gmail.send/notify_contact) |
| 05 | Cross-Calendar Conflict Sync | workflowTemplate + skill | inactive (MS365) | mscal.list + calendar.list + calendar.create | spec+criteria only |
| 06 | Corporate Hold Generator | workflowTemplate + skill | inactive (MS365) | mscal.create | spec+criteria only |
| 07 | Secure Document Cloud Sync | workflowTemplate + skill | inactive (OneDrive sink)* | drive.list + onedrive.list | spec+criteria (Drive half active) |
| 08 | Secure Archive Builder | workflowTemplate + skill | inactive (Dropbox) | dropbox.list + dropbox.createFolder | spec+criteria only |
| 09 | Database-to-Checklist Pipeline | workflowTemplate + skill | inactive (Notion+Todoist) | notion.search + todoist.createTask | spec+criteria only |
| 10 | Vacation Project Onboarding | workflowTemplate + skill | inactive (Notion+TickTick) | notion.createPage + ticktick.listProjects + ticktick.createTask | spec+criteria only |
| 11 | Overdue Chore Auditor | workflowTemplate + skill | inactive (Todoist)* | todoist.listTasks | spec+criteria (native alt: internal tasks) |
| 12 | Smart Climate Night-Mode | workflowTemplate + skill + automation | **active** (device-unverified) | smarthome.listDevices, smarthome.setThermostat | contract test / mocked device |
| 13 | Smart Speaker Dinner Bell | workflowTemplate + skill | inactive (Alexa) | alexa.listDevices + alexa.announce | spec+criteria only |
| 14 | Morning Status Text | workflowTemplate + skill + automation | **active-partial** | weather.current, [rss.latest stub], homeops.notify_contact | local scheduled-run (weather+text) |
| 15 | Family Dashboard API Bridge | workflowTemplate + skill | inactive (Custom HTTP) | http.get + http.post | spec+criteria only |
| 16 | School Menu Data Harvester | workflowTemplate + skill | inactive (Browser) | file.import + browser.open + browser.download | spec+criteria only |
| 17 | Smart Recipe Extractor | skill | **active** | web.search, web.read, web.recipe | local runSkill |
| 18 | Digital Memory Scrapbooker | skill | **active** | homeops.write_memory, homeops.create_artifact | local runSkill |
| 19 | Event Coordinator & Logistics | skill | **active** | homeops.create_event_draft, update_event_checklist, assign_driver, assign_what_to_bring | local runSkill |
| 20 | Chore Manager & Document Linker | skill | **active** (attach mismatch) | homeops.create_task (+notes), homeops.create_list_item | local runSkill |
| 21 | Multi-Channel Meal Planner & Sign-Off | agentTemplate + skill | **active** | homeops.plan_meal, send_notification_draft, notify_contact, create_approval | local runSkill (TG- method) |
| 22 | Internal System Sync | skill | **active** (compose digest) | homeops.write_memory, [gmail.search/reason], homeops.create_artifact | local runSkill |

\* = an active native/Google variant exists (ISS-007) but the source declared an inactive connector; classified inactive to honor the source. **Active = UC-01,12,14,17,18,19,20,21,22 (9). Inactive = UC-02..11,13,15,16 (13).**

### Criteria-doc format spec (DEC-003) — applied to all 22 under `docs/use-case-criteria/`

One file per UC (`UC-01.md` … `UC-22.md`) + `_TEMPLATE.md` + `README.md`. Connector-decoupled so the user can selectively test later WITHOUT inactive connectors:

```
# UC-NN — <use-case name>
status: active | active-partial | inactive
catalog_home: workflowTemplate | agentTemplate | playbook | skill
trigger: <TriggerType> + <detail>
connectors: [<name>:active|inactive]
tool_ids: [<exact catalog ids>]
---
## Intent (verbatim prompt)
<the source use-case prompt, verbatim>

## Tool / step contract
| # | tool_id | action | approval | connector | active? | input keys |

## Acceptance criteria (observable, testable — no bare "works/fast")
- AC1 …  (each a checkable assertion on a real result shape)

## Test procedure
- Active path (real run): boot local stack, TG- data, runSkill/materializeBuild, inspect the returned record.
- Mock / contract path (inactive or unavailable): assert the step graph + request shape against a stubbed provider api(); NO live connector required.

## Not-verified / blocked
- <exact blocker> — unblock: <exact action (connect connector X / set env Y / provide device Z)>
```

Active items also encode the executable half in the skill's `test_cases[]` (EV-011). Inactive items carry only the mock/contract path + a NOT-IMPLEMENTED banner.

## 7. Five canonical persona cards

> Synthetic-research disclosure: these five personas are research instruments inferred from the real seeded household roster (`seed.ts`, EV-006) and the tool contracts, not interviewed customers. Their reactions/quotes are simulated hypotheses requiring real-user validation.

### Persona 1 — Alex Harper (Owner / builder)
Parent, Owner role, high fluency. Goal: stand up the automations that run the house. Device: desktop + mobile. Data: full household. Exercises UC-01, UC-14, UC-17, UC-22. Concern: that a "built" automation actually runs and delivers, not just looks built (the exact 7 AM-briefing scar). Abandonment trigger: a template that renders but never fires. Evidence: seed `m-alex` Owner; PI-01. Inferred: builder mindset.

### Persona 2 — Morgan Harper (Adult Admin / mobile approver)
Co-parent, Adult Admin, medium fluency, mostly on phone. Goal: approve the gated writes quickly and trust them. Exercises the approval gates of UC-01 (label/move), UC-12 (thermostat setpoint), UC-19 (event), UC-21 (sign-off). Concern: approving something irreversible; wants a clear preview. Abandonment: approval cards that expire before she sees them (why UC-14 must use notify_contact, not sms.send). Evidence: seed `m-morgan` Adult Admin; DEC-005.

### Persona 3 — Elaine Brooks (Grandparent / recipient, low fluency)
Grandparent, Guest/Helper, low technical fluency, prefers text-style updates. Goal: receive the family's plans without operating the app. Exercises the delivery end of UC-21 (meal menu), UC-14 (morning text), and the (inactive) UC-04 grandparent digest. Concern: getting messages she didn't consent to. Trust requirement: only verified, opted-in channels reach her (notify_contact's fail-closed gates protect exactly this). Evidence: seed `m-elaine` "prefers text"; PI-04.

### Persona 4 — Sam Rivera (Babysitter / occasional, unverified contact)
Babysitter, Guest/Helper, unverified contact method (`ct-sam-text` verified:false, optIn:Pending). Goal: get the chore/meal info when covering. Exercises the honest-refusal edge: UC-21/UC-14 `notify_contact` must REFUSE to text Sam until his method is verified + allowlisted (`method_not_registered`), and UC-20's chore sheet. Value: proving the system refuses cleanly rather than leaking. Evidence: seed `m-sam`/`ct-sam-text` unverified; EV-021.

### Persona 5 — Lily Harper (Child View / restricted author)
Child, age 9, Child View role, restricted permissions. Goal: contribute a weekend memory and see her chores. Exercises UC-18 (memory scrapbook as author) and UC-20 (chore assignment), plus the permission-denied edge (cannot create agents/automations — Adult-Admin gated, EV-013; child assistant never sees adults-only items). Concern: being shown sensitive family items. Evidence: seed `m-lily` Child View age 9; planner visibility filtering.

## 8. Five end-to-end journey narratives and step tables

Design-time journeys (DEC-007) — the flows each persona will experience once built; steps map to the real skill/tool chains in the trace matrix.

- **JRN-1 (Alex builds UC-01):** describe "sort school mail every weekday" in chat → planner emits a build spec (skill: gmail.search→listLabels→modifyLabels) → materialize (Adult Admin) → nightly run finds school mail → **approval card for the label/move** → Morgan approves → mail filed. Verify lane: local runSkill on a test Gmail. Status: build-ready. Debrief (synthetic hypothesis): "helped — it actually moved the mail; one improvement first — show me which messages before it files them."
- **JRN-2 (Morgan approves UC-12/UC-19/UC-21):** receives approval cards for a thermostat setpoint, an event draft, and a menu sign-off; each shows a preview and a typed risk. Verify lane: local runs + approval consume-once. Status: build-ready (UC-12 device-unverified). Debrief: "trust it because the preview is honest; wish it never expired before I look."
- **JRN-3 (Elaine receives UC-21/UC-14):** gets a text with next week's menu and the morning weather via her verified, opted-in method. Verify lane: TG- verified method + allowlist. Status: build-ready. Debrief: "indispensable — I get the plan without touching anything."
- **JRN-4 (Sam hits the refusal edge):** a UC-14/UC-21 run tries to text Sam; `notify_contact` returns `method_not_registered` and an honest setup prompt; nothing is sent. Verify lane: local run with unverified method. Status: build-ready (the refusal IS the pass). Debrief: "good that it didn't just fail silently."
- **JRN-5 (Lily authors UC-18, is denied build):** logs a weekend memory + keepsake artifact (UC-18) and sees her chore (UC-20); attempting to create an automation is denied (Adult-Admin gate). Verify lane: local runSkill + negative-authz check. Status: build-ready. Debrief: "fun to add our photos; didn't let me do the grown-up stuff, which is fine."

## 9. Visual and product design audit

Not applicable beyond the catalog surface. The declarative catalog entries (agent/workflow cards) carry the visible copy (purpose, sampleOutputs, setupChecklist) — new entries must match the existing warm, family-first voice and card structure in `agentTemplates.ts`/`workflowTemplates.ts` (EV-001/002). Adding data entries introduces no responsive/accessibility regressions; native visual verification is out of scope (DEC-10 lineage). System states (loading/empty/error) for new skills are covered by the existing run-log + approval-card surfaces.

## 10. Full-stack audit

- **Frontend:** catalog entries are static data consumed by the existing Automations/Agents screens; no new components required for the data layer.
- **Backend:** skills run through `runSkill` → `executeTool`/internal `run()`; every tool_id resolves to a real executor (EV-010/012). No new endpoints needed for the actives (materialize + skills routes exist).
- **State/data:** actives mutate Gmail labels (UC-01), Nest setpoint (UC-12), or the server household graph (UC-18..22); all reversible/low-blast-radius except external writes, which are approval-gated.
- **Integrations/jobs:** scheduled actives (UC-12/14) need an automation with an `anchor` time; unattended delivery via `notify_contact`.
- **Security/privacy:** all Send/Write/Download steps approval- or registry-gated; the household kill switch (`externalActionsEnabled`) still applies; no secrets in templates.
- **Reliability/perf:** connectors fail closed with typed errors; no perf budget concern (bounded tool calls).
- **Maintainability/ops:** new ids centralized in `catalogIds.ts`; skills carry versioning + test-gated `available` state.

## 11. UI-to-Backend Trace Matrix

The complete matrix (one row per use-case action chain, with endpoint/handler, authz, tool_id chain, data mutation, response contract, parity, recovery, status) is in `functionality-inventory.md` §"UI-to-Backend Trace Matrix". It reconciles each use-case's user action to its real backend authority path.

## 12. Convergence and misalignment map

- **Reinforce:** the honest tool catalog + fail-closed connectors mean a "built" active template behaves truthfully — design intent and backend authority converge (UC-17/18/19/22 especially).
- **UI masks backend limits (resolved):** UC-20's "attach to the task card" implies a capability that doesn't exist (`attach_note_or_file_reference` is event-only, EV-019/ISS-001) — reconciled by embedding the reference in `task.notes` and documenting the limit.
- **Product language contradicts tooling (resolved):** UC-22's "recent inbox digest" names a non-existent internal tool (EV-020/ISS-002) — reconciled by composing the digest.
- **Intended workflow lacks technical support (resolved):** UC-14's unattended text via `sms.send` cannot deliver (approval expiry, ISS-003) — reconciled via `notify_contact`.
- **Technical capability lacks product expression (opportunity):** active Google/native paths exist for UC-04/07/11 the source didn't request (ISS-007) — surfaced as an optional menu add-on.
- **Capability granted ≠ device ready:** UC-12's smarthome scope is granted but device access needs an SDM project id + a physical Nest (ISS-004) — build the contract, label device-unverified.

## 13. Canonical master issue register

Eight deduplicated build-readiness issues in `issue-register.md`: ISS-001 (P2 UC-20 attach mismatch), ISS-002 (P2 UC-22 non-existent digest tool), ISS-003 (P2 UC-14 unattended delivery path), ISS-005 (P2 13 inactive-connector items), ISS-004 (P3 UC-12 device-unverified), ISS-006 (P3 live-seed scripted-blocked), ISS-007 (P3 native-variant opportunities), ISS-008 (P3 node engine drift). No P0/P1 — baseline is green and these are plan/design issues, not runtime defects.

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

- **Accessibility/responsive:** unchanged by adding catalog data; native visual verification out of scope. Evidence limit: no rendered-UI a11y run performed (not in scope).
- **Performance:** bounded tool calls; no new hot paths.
- **Security/privacy:** every external effect approval- or registry-gated; kill switch honored; TG- isolation for local tests; no secrets in templates.
- **Resilience:** fail-closed connectors; honest typed errors; UC-14 degrades gracefully without RSS.
- **Content/trust:** honest labeling is the core trust requirement — inactive items must never read as verified; the criteria docs carry explicit NOT-IMPLEMENTED banners.

## 15. Persona debrief (synthetic hypotheses)

Labeled synthetic (not real feedback). Common threads across JRN-1..5: (1) the #1 wished-for property is *proof it runs*, not that it looks built (Alex); (2) approvals must not expire unattended (Morgan, resolved via notify_contact); (3) refusing cleanly beats failing silently (Sam); (4) verified-consent delivery is the trust anchor (Elaine); (5) role gates that hide adult items are welcomed, not resented (Lily). Single first improvement most-cited: a "show me what it will do before it runs" preview on the active automations.

## 16. Comparator and research insights

No external web research was required — the audit is fully grounded in first-party code (`server/*.mjs`, `src/data/*.ts`), the authoritative source for tool ids and connector readiness. Internal comparator: the prior run's WP-005 `notify_contact` design is the reference pattern for any scheduled delivery; the just-shipped 7 AM briefing fix is the cautionary comparator for UC-14 (do not repeat the `gmail.send`/`sms.send` unattended-expiry failure). Citations: EV-021 (planner.mjs:296-300), EV-009 (internal-functions.mjs:436-483).

## 17. Opportunity register and novel-feature portfolio

- **OPP-1 (from ISS-007):** ship active native variants of three inactive items — UC-04 grandparent digest via `gmail.send`/`notify_contact`; UC-07 backup to a native Files space instead of OneDrive; UC-11 overdue-chore auditor over internal tasks. Traces to real data + hidden capability; low effort; delivers value now without waiting on MS365/Dropbox/Todoist. Offered as an optional menu add-on, not forced.
- **OPP-2:** a "preview before run" surface for scheduled actives (persona debrief #5) — deferred, evidence-backed by synthetic feedback only.
- **OPP-3:** widen `engines.node` to include 25.x (ISS-008) — trivial hygiene, fold into WP-012.
No speculative AI/dashboard/gamification features proposed (mandate §283).

## 18. Prioritized remediation plan

1. **Foundation (P-now):** WP-011 criteria scaffold, WP-013 local harness.
2. **Native actives (highest certainty):** WP-003 (UC-18), WP-004 (UC-19), WP-005 (UC-20 w/ mitigation), WP-006 (UC-21), WP-007 (UC-22).
3. **External actives:** WP-002 (UC-17), WP-001 (UC-01), WP-008 (UC-14 partial), WP-009 (UC-12 device-unverified).
4. **Inactive specs:** WP-010 (13 items, NOT implemented).
5. **Ship:** WP-012 (deploy + TestFlight, S8 — requires authorization).
6. **Deferred enhancements:** OPP-1 native variants, OPP-2 preview surface.

## 19. Implementation-ready brownfield PRD

- **Problem & evidence:** 22 use-cases must exist as FamiliOS templates; today none do; catalog entries alone are non-functional (EV-001/002, PI-02).
- **Users/personas:** JRN-1..5 (§7).
- **Current behavior & root cause:** no templates for these use-cases; the runnable layer requires skills with real tool_ids (root architecture truth, DEC-001).
- **Goals / measurable success:** 9 active use-cases build + verify end-to-end on the local stack (each with observable acceptance in its criteria doc); 13 inactive delivered as spec + criteria labeled NOT implemented; one criteria format applied to all 22; code committed/deployed; TestFlight submitted. **Non-goals:** activating connectors, live prod seeding, native visual verification.
- **Scope / out-of-scope:** per §2.
- **Chosen solution & rejected alternatives:** two-artifact-per-active-item (DEC-001; rejected catalog-only and skill-only). Delivery via notify_contact (DEC-005; rejected raw sms.send). Local materialize for the "live seed" contract (DEC-006; rejected scripted prod seeding).
- **Target end-to-end journeys:** §8.
- **UX/content requirements:** new catalog entries match the existing card structure + warm family voice (EV-001/002); criteria docs follow the DEC-003 format.
- **States handled:** loading/empty/success via run-log; invalid/unauthorized via role gates + typed errors; approval/denied via approval cards; integration-unavailable via fail-closed connectors (UC-14 RSS omitted; UC-12 device fail-closed); recovery via honest retry messages.
- **Frontend:** consumes catalog data; no new components required for the data layer.
- **Backend/domain:** skills via `runSkill`→`executeTool`/internal run; materialize via `/api/assistant/build`.
- **Authz/tenancy/privacy/security:** Adult-Admin to create; approval/registry gates on all effects; kill switch honored; TG- isolation; no secrets in templates.
- **Data model / jobs / integrations:** household graph writes (UC-18..22); Gmail labels (UC-01); Nest setpoint (UC-12); scheduled automations with `anchor` (UC-12/14); notify_contact registry.
- **Performance/reliability budgets:** bounded tool calls; connectors fail closed within their existing timeouts.
- **Observability:** run logs + notify/tool audit rows (existing).
- **Acceptance criteria (functional + non-functional):** the per-UC observable ACs in each criteria doc + the WP acceptance criteria in `implementation-queue.md`; every active step cites a real tool_id; no inactive item claims verification.
- **Validation:** local `runSkill`/`materializeBuild` with TG- data; contract/mock tests for UC-12 device + all inactive items; baseline `npm test` + both tscs stay green; regression check that the existing 12/20/14 catalog entries + 352 tests are unaffected.
- **Thin vertical slices in dependency order:** WP-011 → WP-013 → WP-001..009 → WP-010 → WP-012.
- **Rollout/rollback:** additive catalog data + draft skills; disable automation / delete template / Render redeploy previous to roll back.
- **Risks/assumptions/blockers/open questions:** ISS-001..008; HYP-001..006. **Definition of done:** the 9 active items run + verify locally with observable evidence; 22 criteria docs committed; deploy + TestFlight done (with authorization); honest labeling throughout.

## 20. Orchestrator-ready implementation work packages

Thirteen work packages (WP-001..013) with objective, IDs, exact tool_id chains, trigger shapes, acceptance criteria, criteria-doc paths, validation, risk, rollback, and sequence are in `implementation-queue.md`. Summary: WP-011 (criteria scaffold), WP-013 (harness), WP-001..009 (9 active builds), WP-010 (13 inactive specs), WP-012 (deploy + TestFlight, S8).

## 21. Numbered implementation menu and recommended bundle

Each option: value / scope / dependencies / risk / effort / leverage / evidence.

1. **Native-5 core** — build UC-18,19,20,21,22 as skills (+ criteria docs). Value: surest wins, no external account. Scope: WP-003..007 (+WP-011/013). Deps: none. Risk: low. Effort: M. Leverage: high (all internal). Evidence: EV-009.
2. **Clean external actives** — UC-01 + UC-17. Value: high-visibility inbox + recipe wins. Scope: WP-001,002. Deps: Google/Web (active). Risk: med (real Gmail write). Effort: S-M. Evidence: EV-007/008.
3. **Scheduled actives** — UC-14 (partial) + UC-12 (device-unverified). Value: the "runs while you sleep" wins. Scope: WP-008,009. Deps: WP-013, notify_contact, SDM for UC-12 device. Risk: med. Effort: M. Evidence: EV-018/021.
4. **All-22 criteria docs** — the durable, selectively-testable acceptance for every use-case, active + inactive. Scope: WP-011 (+ inactive specs WP-010). Value: the user's explicit ask. Risk: low. Effort: M. Evidence: DEC-003.
5. **Inactive-13 specs** — spec + criteria for UC-02..11,13,15,16, labeled NOT implemented, with unblock connectors. Scope: WP-010. Risk: low. Effort: M. Evidence: ISS-005.
6. **Deploy + TestFlight** — commit/push (Render) + EAS build (S8, needs authorization). Scope: WP-012. Risk: med. Effort: S. Evidence: ART-001 §Deploy.
7. **OPP-1 native variants** — active companion templates for UC-04/07/11. Scope: add-on. Risk: low. Effort: S. Evidence: ISS-007.

**Recommended bundle — "Full mission: all 22 built to plan + shipped" (Options 1+2+3+4+5+6).** The coherent vertical release matching the user's stated goal: build + verify the 9 active use-cases (native-5 + clean-external-2 + scheduled-2), deliver all 22 criteria docs (13 inactive as labeled specs), then commit/push/deploy and submit TestFlight. Sequence: WP-011 → WP-013 → WP-003..007 → WP-002 → WP-001 → WP-008 → WP-009 → WP-010 → WP-012. Excludes OPP-1 (Option 7) as an optional extra to decide separately. Risk is bounded (local TG- verification; approval/registry gates; deploy gated on explicit authorization). Highest architectural leverage with honest labeling of everything that cannot be verified now.

Which numbered improvement, feature, or recommended bundle should I implement now?

## 22. Decision log and rejected alternatives

Seven decisions in `decision-log.md` (DEC-001 two-artifact model; DEC-002 catalog-home rule; DEC-003 criteria format; DEC-004 9/13 split + corrections; DEC-005 notify_contact delivery; DEC-006 local-materialize seeding; DEC-007 design-time personas), each with alternatives + reversal conditions. DEC-10 (native visual lane closed) cited as prior-run lineage.

## 23. Remaining unknowns and next discriminating checks

Six hypotheses in `hypothesis-queue.md` (HYP-001..006), each with an exact local check: UC-01 label/archive on real Gmail; UC-14 unattended delivery via notify_contact; UC-12 SDM command shape; materialize contract on local; UC-20 note-embed acceptability; native-variant preference (HYP-006, a selection-gate question). None require production or a real contact.

## 24. Evidence index

Twenty-two evidence items in `evidence-ledger.md` (EV-001..022): catalog contracts (EV-001..006), authoritative tool ids (EV-007..010), executable layer (EV-011..013), baseline health (EV-014..016), production connector probe (EV-017, historical), the four correction bases (EV-018 UC-12 SDM, EV-019 UC-20 attach, EV-020 UC-22 digest, EV-021 notify_contact), and engine drift (EV-022).

## 25. Screenshot gallery

No screenshots were captured. This is a build-from-spec code/architecture audit executed entirely over first-party source and local baseline execution; no rendered product surface was exercised (pre-selection, product source is read-only and native visual verification is out of scope, DEC-10 lineage). The evidence base is CODE/TEST/DATA, indexed in §24 and `evidence-ledger.md`. No screenshot was fabricated or claimed.
