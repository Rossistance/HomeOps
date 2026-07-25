# Architecture and Authority Map

The derived FamiliOS template + tool contract, and the authority boundaries the 22-use-case build must honor. Every material claim carries evidence IDs.

## Modules and boundaries

**Two-layer template model (the load-bearing finding — EV-001,EV-002,EV-003,EV-006,EV-011).**

- **Declarative catalog layer** (`src/data/*.ts`, ships in-product, seeded for discovery):
  - `AgentTemplate` (EV-001, 12 entries) — an ongoing helper a household adopts: purpose, defaultSpaceType, `suggestedTriggers[]` (display strings), `suggestedConnections[]` (display strings), `suggestedPlaybooks[]`, defaultApprovalRules[], defaultInstructions, defaultAutoAllow[]. **No executable tool ids.**
  - `WorkflowTemplate` (EV-002, 20 entries) — a single triggered workflow: `prompt`, `recommendedAgentTemplateId`, `requiredConnections[]`/`optionalConnections[]` (display strings), `triggerType` (a real `TriggerType`, EV-004), approvalRequirements[], fileProcessingNeeds[], browserNeeds, outputFormat[], exampleOutput[], activityLogEvents[], failureStates[], setupChecklist[], optional multiAgent[]. **No `tool_id` steps.**
  - `Playbook` (EV-003, 14 entries) — guidance only: ordered `steps[{order,text}]`, requiredConnections[] (display strings), requiredFileTypes[], outputFormat, approvalRules[].
  - All three share stable ids in `catalogIds.ts` (EV-005). Adding a template = new id + entry.
- **Executable layer** (`server/*.mjs`, runtime store, the runnable/verifiable unit):
  - `Skill` (EV-011) — the runnable step graph: `required_connectors[]`, `required_tools[]`, `required_functions[]`, `steps[]` (each with a `tool_id` that MUST match a real catalog id, EV-010), `approval_policy`, `risk_level`, `input/output_schema`, `test_cases[]`, `status` (draft→available), `system`.
  - `Function` (EV-012) — a durable wrapper around one tool with 11 truthful states; `available` only after real dependency readiness + a passing test.
  - `Agent`, `Trigger/Automation` — the owning/scheduling entities (EV-006, EV-013).

**Consequence:** a use-case "built as a template" that is also *verifiable* needs BOTH — a catalog entry (discoverability/UX) AND a Skill with real `tool_id` steps (execution). A catalog entry alone is not runnable (PI-02, DEC-001). This is why every ACTIVE work package below produces a catalog entry **and** a backing skill.

## Data flow and state ownership

- **Plain-English → plan/build:** `planFromGoal` / `assistantRespond` (kind `build`) give the model the LIVE `toolCatalog(session)` and get back a spec whose `steps[].tool_id` are validated against the catalog (EV-010). Unknown tool ids become `null` reasoning steps. This is exactly the shape the 22 use-cases occupy.
- **Instantiation → live records:** `/api/assistant/build` → `materializeBuild(spec)` creates skill+agent+automation through the registry create paths; Adult-Admin gated; skills land as drafts, automations enabled but gated steps still pause (EV-013).
- **Household graph ownership:** events/tasks/meals/memory/artifacts/approvals are server-owned, household-scoped, visibility-filtered by actor role (EV-009, `buildServerContext` planner.mjs:318-366). The 5 native use-cases mutate only this graph.

## API/event/IPC/persistence relationships (authoritative tool-id inventory — EV-007,EV-008,EV-009)

**ACTIVE (connected on the tenant per EV-017):**
- Google provider: `gmail.search` (Read), `gmail.listLabels` (Read), `gmail.modifyLabels` (Write, approval), `gmail.send` (Send, approval), `calendar.list` (Read), `calendar.create` (Write, approval), `drive.list` (Read), `smarthome.listDevices` (Read, needs SDM project id), `smarthome.setThermostat` (Write, approval, needs SDM project id).
- `weather.current` (Read); `web.search`/`web.read`/`web.recipe` (Read); `sms.send` (Send, approval); `webhook.received` (trigger only); `file.import` (client/local_only).
- Internal `homeops.*` (always connected): `write_memory`, `create_artifact`, `create_approval` (Send, approval), `create_event_draft`, `update_event_checklist`, `assign_driver`, `assign_what_to_bring`, `create_task`, `plan_meal`, `create_list_item`, `attach_note_or_file_reference`, `send_notification_draft`, `notify_contact` (Send).

**INACTIVE (present in code, not connected — EV-017):**
- Microsoft 365: `outlook.search`, `outlook.send`, `mscal.list`, `mscal.create`, `onedrive.list`.
- Slack: `slack.listChannels`, `slack.postMessage`. Dropbox: `dropbox.list`, `dropbox.createFolder`. Notion: `notion.search`, `notion.createPage`. Todoist: `todoist.listTasks`, `todoist.createTask`. TickTick: `ticktick.listProjects`, `ticktick.createTask`. Amazon Alexa: `alexa.listDevices`, `alexa.announce`.
- RSS: `rss.latest` (not_configured — needs feedUrl). Custom HTTP: `http.get`, `http.post` (not_configured). Browser Automation: `browser.open`, `browser.download` (runtime_unavailable).

## Integrations and background work

- Scheduled/unattended delivery must use `homeops.notify_contact` (registry allowlist consent), NOT approval-gated `gmail.send`/`sms.send`, whose approvals expire unattended (EV-021, PI-04). Affects UC-14, UC-21, and any scheduled active item that "sends".
- Smart-home (UC-12) is authorized at the OAuth-scope level but device calls additionally require `HOMEOPS_SDM_PROJECT_ID`; without it the tools fail closed (EV-018) → build the contract, label runtime-device-unverified.

## Auth, tenancy, and permissions

- Roles: Owner, Adult Admin, Child View, Guest/Helper (EV-006). Creating agents/automations is Adult-Admin-gated (EV-013). Child assistants never see adults-only items (planner `canSeeEntity`).
- Local dev tenant holds REAL family data — test records must be `TG-` prefixed and cleaned up; prefer an isolated harness (ART-001 §Authority).

## Deployment, offline, and sync assumptions

- Production is read-only for this run except `/api/health`; scripted prod mutation is classifier-blocked (EV-017) → live-record seeding on prod is UI/user-side (PI-08). Local-stack `materializeBuild` is the verification path.
- Deploy path: commit/push auto-deploys to Render; TestFlight via `eas build -p ios --profile production --auto-submit` with `NODE_EXTRA_CA_CERTS` set (ART-001 §Deploy).
- Runtime: node 25.8.2 mandated; `engines.node` says `<25` (EV-022) — advisory drift, no failure at baseline.
- Native iOS visual verification lane is CLOSED (prior-run DEC-10 lineage) — mobile evidence is limited to typecheck/build, never visual.
