# HomeOps Split Jam Investigation and Engineering Bug Tickets

**Status:** Engineering-ready investigation and remediation plan  
**Scope:** Two-part HomeOps/FamiliarOS QA recording  
**Supersedes:** The earlier report based on a single Jam recording  
**Recording order:** Preserved in the order supplied by the user

## Source Recordings

| Segment | Jam | Duration | Recorded environment |
|---|---|---:|---|
| Part 1 — Builder and control plane | https://jam.dev/c/7631fa90-c888-43d3-a9d1-c81167c41f45 | 20:01 | iPhone 13 Pro Max, iOS 27.0, 428×926 |
| Part 2 — Runtime and data surfaces | https://jam.dev/c/34ef54ca-7bf9-4baf-b9ae-894b5c522410 | 18:19 | iPhone 13 Pro Max, iOS 27.0, 428×926 |
| **Combined** | Two recordings | **38:20** | Same physical-device class and viewport |

---

# Executive Conclusion

The recordings do not show a collection of unrelated visual defects. They show one systemic failure pattern:

> HomeOps allows declarative objects—agents, skills, functions, templates, workflows, automations, and mini apps—to look created, active, or completed before the system has proven that their referenced identities, handlers, tools, permissions, recipes, integrations, recipients, data sources, and runtime dependencies form an executable contract.

The builder/control plane and the execution/runtime plane are not enforcing the same source of truth.

This creates a repeating lifecycle:

```text
User creates or activates an object
→ UI reports success or active state
→ runtime resolves missing or contradictory dependencies
→ execution fails or partially fails
→ top-level status is misleading
→ run history, helper state, mini-app data, and clients disagree
→ user cannot determine what is real, authoritative, or recoverable
```

The most important defects are therefore architectural rather than cosmetic:

1. **No mandatory compile/preflight gate before activation.**
2. **No durable acting-agent identity in every execution context.**
3. **Fragmented permissions and approvals across agents, skills, functions, and sends.**
4. **Top-level run status does not reliably aggregate child-step failures.**
5. **Templates and builders can reference missing agents, recipes, functions, recipients, or integrations.**
6. **Entity creation is not sufficiently idempotent, producing duplicate helpers, agents, skills, and memories.**
7. **Web, iOS, dashboards, mini apps, memory, and activity views do not consistently read the same canonical state.**
8. **Mobile-web layout, navigation, and information architecture obscure the underlying state.**

---

# Severity and Issue Clusters

| Cluster | Severity | Summary |
|---|---:|---|
| Automation compilation and dependency validation | P0/P1 | Templates and generated plans can activate while referencing missing or unconfigured runtime dependencies. |
| Acting identity, recipient context, and policy resolution | P0/P1 | Runs fail with `no_acting_agent`, `no_recipient`, or helper-specific allowlist requirements. |
| Run-state truthfulness and observability | P1 | Runs can appear completed while provider, patch, tool, or child-step execution failed. |
| Entity duplication and catalog integrity | P1 | Multiple Morning Briefing helpers/agents/skills appear without a clear canonical object. |
| Skill/function builder reliability | P1 | Capability inference and real-function testing fail without a guided path to a valid handler. |
| Cross-client and cross-surface consistency | P1 | Web and iOS disagree; dashboard and mini apps disagree; new runs do not reliably appear where expected. |
| Mini-app data contracts | P1 | A grocery summary indicates pending items while the Shared Grocery List displays none. |
| Memory quality and classification | P1/P2 | Duplicate anniversary memories and incorrect fact/preference/location classification reduce trust. |
| Navigation and activity-log semantics | P2 | Generic activity entries, unstable return navigation, hidden content, and unclear deep links disorient the user. |
| Responsive mobile-web UI | P2 | Text overlap, missing wrapping, off-screen controls, and weak hierarchy make configuration difficult. |

---

# Evidence Boundary

The Jam video/transcript analysis provided detailed visual observations, voice commentary, interactions, and timestamps for both recordings.

The Jam metadata reported processed network, console, and interaction artifacts for some segments, but the connector endpoints returned HTTP 404 when those lower-level artifacts were requested. The connected HomeOps GitHub repository, Render runtime logs, and Expo/TestFlight build records were also not available in the active session.

Accordingly:

- The behavioral failures below are confirmed by the recordings.
- Explicit UI error strings are treated as confirmed evidence.
- Architectural root causes are ranked hypotheses until verified in code and runtime logs.
- No exact source filename, function, commit, request payload, or line of code is claimed.

---

# Part 1 Timeline — Builder and Control Plane

## 00:00–01:55 — Agent permissions, capabilities, files, memory, and run history

The user moves through integrations, Helper Agents, Automations, Skills, Functions, and agent details.

### Confirmed findings

- A **Skip approval** control is visually obscured by the mobile layout.
- Capability and permission counts appear contradictory or difficult to interpret, including states described as executed, permitted, and available.
- Approval appears to require configuration in several separate places.
- The user cannot determine whether the current detail belongs to a helper, an agent, a skill, or another entity.
- Run History contains failed and completed entries without enough context.
- Files and Memory show no records for agents expected to have performed work.
- The user repeatedly states that the model “doesn’t make any sense.”

### Expected behavior

One detail page should clearly identify the entity type, canonical ID, active version, assigned skills, effective permissions, recent executions, generated files, and memory writes. Effective permissions should be derived from one policy model rather than requiring the user to reconcile several contradictory surfaces.

---

## 04:03–11:41 — Create “Daycare agent” skill and infer capabilities

### Recorded steps

1. Open **Skills**.
2. Select **+ New**.
3. Enter the name **Daycare agent**.
4. Enter the description **Research daycares around me**.
5. Set Domain to **Caregiving**.
6. Select **Planner-assisted**, later considering **Hybrid**.
7. Select **Infer capabilities**.
8. Enter expanded guidance similar to **Research daycares around me and find the highest ranked 5 in my area**.
9. Attempt **Run real test**.

### Actual result

- Capability inference does not produce a complete, ready-to-run implementation.
- Multiple test failures appear.
- The user sees **Finish configuring the handler before testing**.
- The builder requires manual knowledge of lower-level functions and handlers that the high-level inference action appeared intended to generate.
- The workflow does not guide the user from inferred intent to a valid executable configuration.

### Expected result

**Infer capabilities** should either:

- produce a complete validated draft with all required functions and integrations; or
- produce a guided checklist of unresolved dependencies and prevent testing until they are resolved.

It should never imply that an executable capability was inferred while leaving an incomplete handler behind.

---

## 11:41 onward — Create and test `get_browser_approximate_location`

### Recorded behavior

The user attempts to create a new location function named `get_browser_approximate_location` and run a real test.

### Actual result

- Testing fails.
- The function handler is not fully configured.
- The builder does not provide a clear implementation path, working example, or automatic completion from the skill’s inferred requirement.

### Expected result

The builder should generate or select a supported implementation, explain required browser/location permissions, expose a deterministic test fixture, and disable real testing until the handler contract is complete.

---

## 13:46–20:01 — Agents, reminders, workflows, automations, and run visibility

### Confirmed findings

- Creating or inspecting an agent exposes additional per-skill approval requirements.
- Google is disconnected, but dependent plans or capabilities can still appear activatable.
- Agent Files and Memory do not consistently reflect expected execution output.
- A reminder routes the user to Tasks/Family Board without clearly explaining the destination model.
- Native back/swipe behavior is missing or inconsistent.
- Browser back can return too far instead of returning to the immediate parent subpage.
- An automation cannot always be opened from the surface where it is displayed.
- A failed run reports **no recipient**.
- A suggested improvement does not resolve the execution contract.
- Workflow Builder generates and activates another **Morning Family Briefing** associated with a different agent, increasing duplication.
- A newly initiated run does not reliably appear in the expected Live or Run History surface.
- Text does not consistently wrap, causing content to become unreadable.
- Web details do not match the iOS representation; the user specifically notes missing date-range/end-date information.

---

# Part 2 Timeline — Runtime, Templates, Mini Apps, and Memory

## 00:00–00:10 — Session restoration/sign-in expectation

The user expects the application to present the authenticated state automatically, but proceeds to sign in manually.

### Root-cause confidence

Low to medium. This may indicate failed session restoration, a deliberate authentication boundary, or confusion caused by the current loading/sign-in presentation. It requires auth-session logs before classification as a confirmed defect.

---

## 00:10–02:00 — Automations, Live runs, Helper Agents, and failure history

### Confirmed findings

- Automations show a mixture of completed and failed states that do not communicate actual outcome clearly.
- Multi-agent templates reference agents the user cannot find in the agent catalog.
- Runs show errors including:
  - `provider_error`
  - `patch_failed`
  - `fetch_failed`
  - `no_recipient`
  - `no_acting_agent`
  - `no_recipe_found`
- A run can appear completed even when a provider or child step failed.
- Multiple Morning Briefing helpers and agents exist with nearly identical names.
- Web helper/agent state does not appear synchronized with the iOS session.
- Approval controls are distributed across multiple helpers/agents, creating manual setup for every generated participant.

### Strongest explicit runtime evidence

A notification step reports that it must run as a specific helper because the recipient allowlist is granted per helper. The run also reports:

```text
no_acting_agent
sourceRef.agentId is null
```

This is direct evidence that the runtime execution context can reach an external-action step without a valid acting identity.

---

## 02:00–06:42 — Create School Correspondence Organizer from a template

### Recorded steps

1. Open **Automations**.
2. Open **Templates**.
3. Select **School Correspondence Organizer**.
4. Select **Use this template**.
5. Observe **Automation created**.
6. Open **Edit automation**.
7. Review:
   - Trigger Type: Schedule
   - Cadence: every morning at 7:00 a.m.
   - Assigned Agent: Household Assistant
   - Category: Communication and Coordination
   - Status: Active
   - Approval requirement
   - Workflow plan
   - tools/actions
   - notifications
   - error handling
   - activity logging

### Actual result

The descriptive plan appears reasonable, but it does not prove that the automation is executable. Similar runs elsewhere fail because actor identity, recipes, recipients, providers, and function bindings are unresolved.

The user cannot determine how the displayed prose maps to executable steps or whether the new automation is truly ready.

### Expected result

Template instantiation should compile and validate every dependency before the automation can become Active. The editor should show a machine-verifiable readiness report, not only descriptive workflow copy.

---

## 06:42–13:51 — Repeated runtime review and agent duplication

### Confirmed findings

- The user returns to Live and Run History but cannot establish a reliable success/failure story.
- “Completed” and “Failed” statuses coexist with lower-level error codes.
- Helper Agents contains several Morning Briefing variations marked Active.
- Generated agents referenced by a template are missing or not recognizable in the catalog.
- The runtime appears to look for recipe agents or recipes that were never created or attached.
- Error messages identify implementation problems but do not provide an actionable repair path inside the product.

---

## 13:51–16:42 — Mini Apps and data inconsistency

### Recorded steps

1. Open **Mini Apps**.
2. Select the **Family Chore Board** starter template.
3. Select **Add to my mini apps**.
4. Observe **Mini app created** and **Mini app added**.
5. Open Family Chore Board.
6. Attempt to understand or change task state.
7. Return to Mini Apps.
8. Open **Trip Planner**.
9. Open **Shared Grocery List**.

### Confirmed findings

- Family Chore Board creation succeeds, but task-status interaction is unclear.
- Shared Grocery List displays **Nothing here yet** in the To Buy section.
- Another HomeOps surface indicates that at least one grocery item remains.
- The dashboard and mini app therefore do not present the same grocery state.
- Activity history later suggests mini apps may have been created when the user believed they were only being inspected, making open-versus-create semantics unclear.

### Expected result

All grocery surfaces should resolve the same household list, list version, filters, and item states. Opening a starter template should not create a persistent mini app unless the user explicitly confirms creation.

---

## 16:42–18:19 — Activity, knowledge, files, and memory

### Confirmed findings

- Photos initially appear missing; visible images appear to be profile pictures rather than expected content.
- Library/knowledge content does not match the iOS app.
- Memory contains repeated anniversary facts.
- Location information is classified as a preference/fact rather than modeled as location context.
- Activity entries use generic copy such as:
  - **A helper did something technical**
  - **A background job ran**
- The log does not explain why the job ran, what entity caused it, or what changed.
- Opening an activity or image detail can return the user to the wrong surface.
- The user experiences unexpected navigation changes and cannot maintain orientation.

---

# Consolidated Root-Cause Assessment

## RC-1 — Missing compile/preflight boundary

**Confidence: High**

Creation and activation are being treated as persistence operations rather than compilation operations. A template or generated plan can be stored and marked Active without proving that all referenced runtime components exist and are usable.

### Required validation graph

Before an object can become Active, validate:

```text
Template/version
→ workflow graph
→ assigned agent
→ acting-agent identity
→ skills
→ recipes
→ functions/handlers
→ provider configuration
→ integrations
→ recipient
→ recipient allowlist
→ approval policy
→ input data sources
→ output channel
→ error path
→ activity-log contract
```

Any unresolved node must keep the object in Draft or Blocked state.

---

## RC-2 — Execution context permits null acting identity

**Confidence: High**

The explicit `no_acting_agent` error and null `sourceRef.agentId` show that an execution reaches a notification boundary without a valid actor.

Every run and child step needs an immutable execution context such as:

```text
runId
correlationId
householdId
initiatingUserId
actingAgentId
sourceType
sourceId
sourceVersion
policySnapshotId
integrationConnectionIds
recipientContext
approvalContext
```

External tools must reject context construction before execution begins, not after several steps have already run.

---

## RC-3 — Permission and approval policy is fragmented

**Confidence: High**

The recordings show approval settings repeated across agents, skills, functions, and external sends. The runtime also applies recipient allowlists per helper.

The product lacks one comprehensible effective-policy calculation.

### Required model

Use policy inheritance with explicit precedence:

```text
Household policy
→ user policy
→ agent policy
→ automation policy
→ skill/function risk policy
→ run-specific approval
```

The UI should display the effective result and the rule that produced it. It should not require the user to manually synchronize equivalent toggles on every generated object.

---

## RC-4 — Run status is aggregated incorrectly

**Confidence: High**

A wrapper or orchestration process can complete while required child steps fail, allowing a top-level status of Completed to coexist with provider, patch, notification, recipe, or identity errors.

### Required terminal states

```text
queued
validating
blocked_configuration
blocked_approval
running
succeeded
partially_failed
failed
cancelled
```

**Succeeded** must require every required child step to reach a successful terminal state. Optional child failures may produce **partially_failed**, but never **succeeded** without a visible warning.

---

## RC-5 — Template and generated-object creation is not idempotent

**Confidence: Medium-high**

Repeated Morning Briefing agents, helpers, skills, and plans strongly indicate that template instantiation or generation creates new records without stable canonical keys, version checks, or duplicate detection.

### Required controls

- Stable template IDs and versions
- Deterministic instance keys
- Unique constraints scoped by household and canonical role
- Idempotency keys for create/generate requests
- Existing-instance detection before creation
- Merge, replace, or create-new choice when a related object already exists
- Migration to consolidate existing duplicates

---

## RC-6 — Builder state machine allows invalid testing

**Confidence: High**

The user can attempt a real test before the inferred function handler is ready, producing **Finish configuring the handler before testing**.

Testing must be disabled until a machine-readable readiness check passes. The builder should identify exactly which required fields, handler bindings, permissions, or integrations remain unresolved.

---

## RC-7 — Server-authoritative state is not consistently reconciled across clients and surfaces

**Confidence: Medium-high**

The user observes mismatches between web and iOS, dashboard and mini app, run initiation and run history, and memory/library surfaces.

Likely contributing causes include:

- independent client caches;
- missing query invalidation;
- inconsistent household or account scope;
- schema/version drift;
- different endpoints or filters per surface;
- eventual synchronization without visible state;
- stale local projections; or
- duplicate canonical entities.

---

## RC-8 — Memory ingestion lacks semantic upsert and classification controls

**Confidence: Medium-high**

The same anniversary appears repeatedly, and location context is classified as a preference or generic fact.

Memory writes need:

- normalized subject/predicate/object keys;
- semantic duplicate detection;
- source provenance;
- confidence;
- temporal validity;
- type constraints;
- update-versus-create rules; and
- user-visible merge/edit/delete actions.

---

## RC-9 — Activity events are technically emitted but not productized

**Confidence: High**

Generic entries such as **A helper did something technical** prove that low-level events reach the UI without entity-specific rendering metadata.

An activity event should include:

```text
eventType
actorType
actorId
subjectType
subjectId
operation
reason
sourceRunId
status
humanSummary
changedFields
originRoute
returnRoute
occurredAt
```

The UI can then render meaningful copy and deterministic deep links.

---

## RC-10 — Responsive/mobile navigation was not treated as a primary execution surface

**Confidence: High for UI defects**

The session shows text overlap, missing wrapping, content placed below the visible discovery area, off-screen controls, and broken return navigation while using an iPhone-sized viewport.

This requires responsive layout and navigation-state corrections, not only visual styling.

---

# Engineering-Ready Epic

## Epic Title

**Make HomeOps-generated agents, skills, functions, workflows, automations, mini apps, and memories canonical, executable, observable, and consistent across web and iOS**

## Priority

**P0/P1 reliability and data-integrity remediation**

## Problem Statement

HomeOps permits users to create and activate declarative configurations that are not guaranteed to be executable. Runtime resolution then fails because required agents, handlers, recipes, integrations, recipient context, acting identity, or approval state is missing. Status surfaces can hide or misclassify those failures. Repeated generation creates duplicate entities, and different clients or product surfaces display inconsistent projections of household data.

## Desired Product Contract

A user-visible object may be labeled **Active** only when:

1. It has a canonical identity and version.
2. All referenced entities exist.
3. All required handlers are configured.
4. Required integrations are connected.
5. An acting agent is resolved.
6. Recipient and allowlist context is valid.
7. Effective approval policy is calculated.
8. A dry-run validation succeeds.
9. The runtime and UI use the same compiled manifest.
10. Web and iOS can retrieve the same canonical object and status.

---

# Linked Engineering Tickets

## HO-001 — Add automation/template compilation and activation preflight

**Priority:** P0  
**Components:** Template service, workflow builder, automation service, activation UI

### Acceptance criteria

- Activation is blocked when an assigned agent, skill, recipe, function, handler, integration, provider, recipient, or approval policy is unresolved.
- The validation response returns field-level and graph-node errors.
- The editor links each validation error to the exact repair surface.
- Active objects store the compiled manifest version used by runtime.
- Runtime refuses to execute a draft or stale/uncompiled manifest.
- Existing invalid active objects are migrated to Blocked Configuration.

---

## HO-002 — Require immutable acting-agent context for every run

**Priority:** P0  
**Components:** Orchestrator, scheduler, automation runner, tool gateway, notification service

### Acceptance criteria

- `actingAgentId` is non-null before any child step begins.
- Scheduled, manual, template, multi-agent, and retry runs construct the same execution-context schema.
- External tools never receive a run without actor and policy context.
- `no_acting_agent` becomes a compile/preflight error rather than a late runtime failure.
- Logs correlate the source automation, acting agent, child agent, and tool call.

---

## HO-003 — Centralize approvals, permissions, and recipient allowlists

**Priority:** P0/P1  
**Components:** Policy service, agent settings, skill/function settings, notification tools, approval UI

### Acceptance criteria

- One effective-policy view explains whether an action is allowed, blocked, or needs approval.
- Generated agents inherit policy unless explicitly overridden.
- Recipient allowlist checks resolve against the effective acting identity.
- Duplicate approval toggles are removed or converted to read-only inherited-state indicators.
- Policy changes are versioned and audited.
- Low-risk internal actions do not create unnecessary approval gates.

---

## HO-004 — Correct run-state aggregation and error presentation

**Priority:** P1  
**Components:** Orchestrator, run repository, Live view, Run History, activity log

### Acceptance criteria

- Required child-step failure prevents top-level Succeeded status.
- Provider, patch, fetch, recipe, recipient, actor, and approval failures map to normalized error classes.
- Live and Run History show the same terminal state.
- Each failure shows failed step, cause, retryability, and recommended repair.
- A new run appears immediately in Live and Run History after server acceptance.
- Filters cannot silently hide the just-created run.

---

## HO-005 — Make template and generated-object creation idempotent

**Priority:** P1  
**Components:** Template catalog, agent generator, skill generator, workflow builder, migrations

### Acceptance criteria

- Repeating the same create/generate action with the same idempotency key cannot create duplicates.
- Existing canonical Morning Briefing objects are detected.
- The user is offered Update existing, Create separate, or Cancel when a semantic match exists.
- Duplicate agents, helpers, skills, recipes, and automations are identified and safely merged or archived.
- References are re-pointed to the retained canonical IDs.

---

## HO-006 — Repair skill capability inference and guided function binding

**Priority:** P1  
**Components:** Skill builder, inference service, function registry, test harness

### Acceptance criteria

- The Daycare agent flow produces a structured capability plan.
- Missing functions are generated, selected, or clearly listed.
- Real Test is disabled until readiness validation passes.
- The builder provides a supported implementation path for approximate browser location.
- Test fixtures can simulate location permission granted, denied, unavailable, and approximate-only states.
- A failed inference preserves all entered configuration and provides retry.

---

## HO-007 — Reconcile web and iOS state from a server-authoritative model

**Priority:** P1  
**Components:** API, web client, Expo client, cache/query layer, synchronization service

### Acceptance criteria

- The same household, entity ID, version, and status are returned to web and iOS.
- Mutations return canonical objects and version numbers.
- Clients upsert mutation responses and invalidate dependent projections.
- Date-range fields, including end date, use one shared schema.
- Cross-client changes become visible within a defined synchronization SLA.
- A visible stale/offline indicator appears when a client is not current.

---

## HO-008 — Define canonical mini-app data-source contracts

**Priority:** P1  
**Components:** Mini-app runtime, Grocery service, Task service, dashboard selectors

### Acceptance criteria

- Dashboard grocery counts and Shared Grocery List use the same list ID, household scope, filters, and item-state definitions.
- Opening a template does not create an instance.
- Instance creation requires an explicit action and returns the created ID.
- Chore status changes persist and are reflected in Tasks/Family Board.
- Mini-app cards display their bound data source and last synchronization time.

---

## HO-009 — Add semantic memory deduplication and typed classification

**Priority:** P1/P2  
**Components:** Memory ingestion, extraction pipeline, memory repository, Memory UI

### Acceptance criteria

- Repeated extraction of the same anniversary updates or confirms one canonical memory.
- Location context is stored as location context, not a generic preference.
- Every memory displays source, confidence, type, and last-confirmed time.
- Users can merge, correct, or delete duplicates.
- Ingestion is idempotent for the same source artifact and fact key.

---

## HO-010 — Replace generic activity events with actionable records

**Priority:** P2  
**Components:** Activity event schema, activity feed, deep links, navigation

### Acceptance criteria

- Generic entries such as “did something technical” are eliminated.
- Every item identifies actor, action, subject, result, reason, and source run.
- Background jobs state why they ran and what changed.
- Activity details deep-link to the correct entity.
- Back returns to the originating activity list and restores scroll position.

---

## HO-011 — Repair mobile-web responsive layout and nested navigation

**Priority:** P2  
**Components:** Responsive shell, agent/skill/function editors, tabs, navigation stack

### Acceptance criteria

- Text wraps without covering labels or controls at 428×926 and smaller supported widths.
- Important content is not hidden below unrelated sections.
- Tabs identify entity type and active section clearly.
- Nested pages provide a local back action.
- Browser/native back returns to the immediate parent rather than an unrelated top-level page.
- Buttons and interactive elements meet mobile touch-target and accessibility requirements.

---

## HO-012 — Validate integrations before generated plans become runnable

**Priority:** P1  
**Components:** Integration registry, template compiler, workflow builder, activation UI

### Acceptance criteria

- A Google-dependent capability cannot become Ready while Google is disconnected.
- The validation screen identifies the required connection and account scope.
- Users may save as Draft without being told the workflow is runnable.
- Connecting the integration automatically re-runs readiness validation.

---

# Clean Reproduction Suites

## REP-01 — Create an invalid inferred skill

1. Sign in to FamiliarOS/HomeOps web on an iPhone-sized viewport.
2. Open **Skills**.
3. Select **+ New**.
4. Name the skill **Daycare agent**.
5. Enter **Research daycares around me**.
6. Select **Caregiving**.
7. Select **Planner-assisted** or **Hybrid**.
8. Select **Infer capabilities**.
9. Enter **Research daycares around me and find the highest ranked 5 in my area**.
10. Attempt **Run real test**.

### Current result

Inference leaves unresolved handler/function configuration and the test fails.

### Required result

The builder either generates a complete validated draft or blocks testing with an exact, guided dependency checklist.

---

## REP-02 — Test an incomplete location function

1. Open **Functions**.
2. Select **+ New**.
3. Create `get_browser_approximate_location`.
4. Attempt a real test without manually completing undocumented handler details.

### Current result

The test fails and the user cannot determine the required implementation.

### Required result

Testing remains disabled until the handler contract is complete; a supported browser-location implementation and deterministic fixtures are available.

---

## REP-03 — Instantiate a template that is not executable

1. Open **Automations**.
2. Open **Templates**.
3. Select **School Correspondence Organizer**.
4. Select **Use this template**.
5. Open **Edit automation**.
6. Confirm it is marked Active and assigned to Household Assistant.
7. Run it or inspect its next scheduled execution.
8. Open **Live** and **Run History**.

### Current result

The object looks valid at creation time, while related runs can later fail because of missing actor, recipe, recipient, provider, or permissions.

### Required result

The template cannot become Active until its complete compiled dependency graph passes validation.

---

## REP-04 — Trigger an external notification without an acting agent

1. Run a Morning Briefing or another automation that sends email/notification.
2. Open the failed run.
3. Inspect the notification step.

### Current result

The step can fail with `no_acting_agent`, null `sourceRef.agentId`, or a helper-specific recipient allowlist error.

### Required result

The run is blocked before execution until a valid acting identity and recipient policy are resolved.

---

## REP-05 — Observe misleading Completed status

1. Run an automation with a provider, patch, recipe, actor, or notification failure.
2. Return to Live.
3. Open Run History.
4. Compare the parent state with child-step outcomes.

### Current result

A parent can appear Completed while required child work failed.

### Required result

The parent is Failed or Partially Failed, with the failed child and repair action visible.

---

## REP-06 — Generate duplicate Morning Briefing objects

1. Locate existing Morning Briefing agents/helpers/skills.
2. Open Workflow Builder or use another Morning Briefing template.
3. Generate and activate a plan.
4. Return to Helper Agents, Skills, and Automations.

### Current result

Another similarly named Morning Briefing object may be created with different dependencies and policy state.

### Required result

The system detects the canonical existing object and requires an explicit update-or-create-separate decision.

---

## REP-07 — Grocery state mismatch

1. Open a dashboard/home surface showing pending groceries.
2. Confirm the displayed pending count is greater than zero.
3. Open **Mini Apps**.
4. Open **Shared Grocery List**.
5. Inspect **To Buy**.

### Current result

The mini app can show **Nothing here yet** while another surface reports pending groceries.

### Required result

Both surfaces show the same items and count from the same canonical list projection.

---

## REP-08 — Duplicate and misclassified memory

1. Open **Activity & Memory**.
2. Open **Memory**.
3. Search for anniversary information.
4. Inspect the type and source of each matching memory.
5. Inspect current-location information.

### Current result

The anniversary appears repeatedly, and location context may be stored as a preference or generic fact.

### Required result

One canonical anniversary memory exists, and location is represented using the correct typed context.

---

## REP-09 — Activity deep-link loses navigation context

1. Open **Activity & Memory**.
2. Open **Activity Log**.
3. Select a processed image, background job, helper action, or created mini app.
4. Navigate back.

### Current result

The detail can open an unexpected surface, and back does not reliably return to the originating list and position.

### Required result

The detail identifies its source entity and back restores the exact activity-list context.

---

# Automated Test Plan

## Template and compiler tests

| ID | Test |
|---|---|
| AUTO-001 | Activation rejects a workflow referencing a missing agent. |
| AUTO-002 | Activation rejects a workflow referencing a missing recipe. |
| AUTO-003 | Activation rejects a function without a configured handler. |
| AUTO-004 | Activation rejects a required disconnected integration. |
| AUTO-005 | Activation rejects an external send without recipient context. |
| AUTO-006 | Activation rejects a run contract without `actingAgentId`. |
| AUTO-007 | A valid compiled manifest can be activated and executed. |
| AUTO-008 | Runtime executes the exact compiled manifest version stored at activation. |
| AUTO-009 | Stale manifests are blocked after a referenced dependency changes incompatibly. |

## Runtime and status tests

| ID | Test |
|---|---|
| RUN-001 | Required child failure produces parent Failed. |
| RUN-002 | Optional child failure produces Partially Failed with warning. |
| RUN-003 | Provider error is normalized and displayed at parent and child levels. |
| RUN-004 | Patch failure cannot produce Completed. |
| RUN-005 | `no_acting_agent` is prevented at preflight. |
| RUN-006 | `no_recipient` is prevented before external-send execution. |
| RUN-007 | New run appears immediately in Live and Run History. |
| RUN-008 | Retry preserves source run and correlation IDs. |
| RUN-009 | Scheduled and manual runs construct identical execution-context schemas. |

## Policy tests

| ID | Test |
|---|---|
| POL-001 | Generated child agent inherits household and parent-agent policy. |
| POL-002 | Explicit override is visible and auditable. |
| POL-003 | Effective approval result is identical in UI and runtime. |
| POL-004 | Recipient allowlist evaluates against resolved acting identity. |
| POL-005 | Skip-approval selection cannot be obscured or contradicted by another hidden control. |

## Builder and function tests

| ID | Test |
|---|---|
| BUILD-001 | Daycare-agent inference returns a structured capability graph. |
| BUILD-002 | Inference preserves entered content after provider failure. |
| BUILD-003 | Real Test is disabled while readiness errors exist. |
| BUILD-004 | Location function handles permission granted. |
| BUILD-005 | Location function handles permission denied. |
| BUILD-006 | Location function handles unsupported browser/device. |
| BUILD-007 | Location function returns approximate coordinates without exposing unnecessary precision. |

## Idempotency and catalog tests

| ID | Test |
|---|---|
| CAT-001 | Repeating template creation with the same idempotency key creates one instance. |
| CAT-002 | Existing semantic match prompts update/create-separate choice. |
| CAT-003 | Duplicate Morning Briefing records are detected. |
| CAT-004 | Merge migration preserves all inbound references. |
| CAT-005 | Catalog lists canonical entity type and version. |

## Cross-client synchronization tests

| ID | Test |
|---|---|
| SYNC-001 | Web-created agent is visible in iOS with the same ID and status. |
| SYNC-002 | iOS-created/edited object is visible on web after reconciliation. |
| SYNC-003 | End-date/date-range fields round-trip identically. |
| SYNC-004 | Mutation response is upserted into all dependent client projections. |
| SYNC-005 | Stale client displays an offline/stale indicator. |
| SYNC-006 | Run-history state is identical across clients. |

## Mini-app tests

| ID | Test |
|---|---|
| MINI-001 | Dashboard grocery count equals Shared Grocery List pending-item count. |
| MINI-002 | Opening a template does not create an instance. |
| MINI-003 | Explicit Add creates exactly one instance. |
| MINI-004 | Chore status mutation appears in Chore Board and Tasks/Family Board. |
| MINI-005 | Mini-app instance displays bound source ID and last-sync state. |

## Memory tests

| ID | Test |
|---|---|
| MEM-001 | Re-ingesting the same anniversary creates no duplicate. |
| MEM-002 | Conflicting anniversary values produce a review state, not silent duplication. |
| MEM-003 | Location context is classified as location. |
| MEM-004 | User merge preserves source provenance. |
| MEM-005 | Memory delete propagates to all client projections. |

## Activity and navigation tests

| ID | Test |
|---|---|
| ACT-001 | Every activity event renders actor, action, subject, result, and reason. |
| ACT-002 | Background jobs explain trigger and changed data. |
| ACT-003 | Activity deep link resolves the correct entity. |
| ACT-004 | Back restores originating route and scroll position. |
| ACT-005 | No production event renders generic “did something technical” copy. |

## Responsive and accessibility tests

| ID | Test |
|---|---|
| UI-001 | Approval controls remain visible at 428×926. |
| UI-002 | Long labels, errors, names, and descriptions wrap without overlap. |
| UI-003 | Tabs expose selected state and entity context to screen readers. |
| UI-004 | Touch targets meet supported mobile sizing requirements. |
| UI-005 | Nested screens expose local back navigation. |
| UI-006 | Important content is discoverable without unexplained placement below the fold. |

---

# Code-Change Plan

## Phase 1 — Establish truth and observability

1. Add correlation IDs across builder, activation, run, child steps, provider calls, tool calls, policy checks, and activity events.
2. Normalize error classes.
3. Record complete execution context without logging private content or secrets.
4. Make Live and Run History read the same run-state projection.
5. Add diagnostics for duplicate canonical roles and missing references.

## Phase 2 — Introduce the compiler/preflight service

1. Define the compiled manifest schema.
2. Validate the full dependency graph.
3. Add Draft, Validating, Blocked Configuration, Ready, and Active lifecycle states.
4. Move existing invalid Active objects to Blocked Configuration.
5. Require runtime to use a stored compiled version.

## Phase 3 — Repair identity and policy

1. Require acting-agent context at run creation.
2. Centralize effective-policy calculation.
3. Inherit policy for generated child agents.
4. Consolidate recipient allowlist behavior.
5. Replace duplicated approval controls with one effective-policy view.

## Phase 4 — Correct status and retries

1. Implement parent/child terminal-state aggregation.
2. Add Partially Failed.
3. Expose failed step and repair path.
4. Preserve correlation and source references during retries.
5. Ensure new runs become visible immediately.

## Phase 5 — Canonicalize generated objects

1. Add template versions and deterministic instance keys.
2. Add create idempotency keys.
3. Detect semantic matches.
4. Migrate duplicate Morning Briefing entities.
5. Re-point references and archive superseded objects.

## Phase 6 — Repair builders

1. Convert capability inference output into a typed capability graph.
2. Generate or bind functions explicitly.
3. Add readiness checklist and disabled testing state.
4. Add supported browser-location implementation and fixtures.
5. Preserve drafts across inference/provider errors.

## Phase 7 — Unify client and mini-app projections

1. Confirm server-authoritative entity schemas.
2. Add canonical version fields to mutation responses.
3. Invalidate/upsert all affected web and Expo queries.
4. Align date-range fields across clients.
5. Bind mini apps to explicit data-source IDs.
6. Reconcile grocery and task selectors.

## Phase 8 — Repair memory and activity

1. Add semantic memory keys and duplicate detection.
2. Add typed classification and provenance.
3. Migrate duplicate memories.
4. Define a product-level activity event schema.
5. Add deterministic deep links and return routes.

## Phase 9 — Responsive UX and navigation

1. Audit all builder and detail screens at 428×926 and smaller widths.
2. Remove fixed-width/overflow assumptions.
3. Add wrapping and mobile hierarchy.
4. Add nested navigation/back behavior.
5. Add accessibility and touch-target tests.

---

# Render, Expo, and TestFlight Verification Plan

## Render backend

After implementing backend changes:

1. Restart the Node backend; do not assume frontend hot reload updates server code.
2. Confirm the expected process owns the backend port.
3. Confirm Vite/web and backend are running the intended build and environment.
4. Correlate test runs using the new correlation ID.
5. Verify no unresolved-reference, null-actor, recipe, recipient, provider, or status-aggregation errors remain.
6. Confirm migrations consolidate duplicates without broken references.

## Expo/iOS

1. Verify the mobile client uses the intended Render API URL and environment.
2. Test cross-client entity IDs and versions.
3. Test date-range parity.
4. Test run-history parity.
5. Test stale/offline handling.
6. Test mobile web and native navigation separately.

## TestFlight

1. Record the exact EAS build profile, build number, runtime version, and backend deployment version.
2. Distribute the corrected build to TestFlight.
3. Repeat both Jam flows from a clean account and from the existing migrated household.
4. Confirm no duplicate objects are generated.
5. Confirm every acceptance criterion with screenshots, logs, and run IDs.

---

# Customer Experience and Business Impact

The user is not merely encountering error messages. They are unable to form a reliable mental model of the product.

The current experience forces the user to ask:

- Which Morning Briefing object is the real one?
- Is this an agent, helper, skill, function, recipe, plan, or automation?
- Why is it Active if its dependencies do not exist?
- Why does a run say Completed when a provider or child step failed?
- Which approval control is authoritative?
- Why does a send require a helper identity that the automation did not assign?
- Why does web disagree with iOS?
- Why does the dashboard say groceries exist while the list is empty?
- Why is the same anniversary remembered several times?
- Why did a background job run?
- Where will Back take me?

This produces four major business risks:

1. **Trust loss:** Users stop believing success, active, completed, memory, and synchronization indicators.
2. **Automation abandonment:** Users cannot create reliable workflows without understanding internal implementation details.
3. **Data integrity risk:** Duplicate, missing, stale, or misclassified household information can drive incorrect actions.
4. **Support and maintenance cost:** Every generated invalid object creates follow-on failures across agents, run history, approvals, activity, and clients.

---

# Definition of Done

The remediation is complete only when:

- No object can become Active without a successful compile/preflight result.
- Every execution has a non-null acting identity and policy snapshot.
- Required child failure cannot produce Completed/Succeeded.
- Templates cannot reference missing agents, recipes, handlers, recipients, or integrations.
- Capability inference produces a complete draft or an exact guided dependency list.
- Real Test cannot run against an incomplete handler.
- Repeating template/generator actions does not create accidental duplicates.
- Web and iOS display the same canonical entity IDs, versions, and status.
- Dashboard and mini-app data agree.
- Duplicate memories are consolidated and future duplicate ingestion is prevented.
- Activity items explain who did what, why, to which entity, and with what result.
- Back navigation preserves user context.
- All supported mobile widths render without overlapping or unreadable text.
- The original two Jam workflows pass on the verified Render deployment and TestFlight build.
- Backend, integration, migration, web, Expo, responsive, and end-to-end tests are green.

---

# Final Assessment

Part 1 exposes the control-plane defect: builders and settings allow users to create configurations that are not demonstrably executable.

Part 2 exposes the runtime consequence: missing actors, missing recipes, missing recipients, provider failures, duplicate agents, contradictory statuses, stale projections, empty mini apps, duplicate memories, and non-actionable activity records.

The primary repair is not to patch each visible error independently. It is to establish one canonical contract from creation through execution:

```text
Canonical entity
→ validated dependencies
→ compiled manifest
→ effective policy
→ immutable execution context
→ truthful run state
→ server-authoritative projection
→ meaningful activity and memory
```

Once that contract exists, the visible UI defects become smaller, testable, and far less likely to recur.
