# HomeOps Comprehensive Product And Runtime Audit

Date: 2026-06-23  
Workspace: `D:\HomeOps_AI_Coding_Agent_Handoff\homeops-ai`  
Runtime audited: frontend `http://localhost:5173`, backend `http://localhost:8787`  
Report intent: product audit, QA report, workflow simulation report, connector/runtime audit, AI provider audit, architecture redesign brief, and implementation backlog.

## 1. Executive Assessment

HomeOps has moved well beyond the earlier demo-adapter state. The current checkout has a real local backend runtime, session cookies, CSRF checks, origin allowlisting, encrypted backend vault storage, server-side approval records, PKCE OAuth start/callback support, real OpenAI provider calls, real Weather execution, webhook intake, a scheduler shell, SSRF blocking for Custom HTTP, and a polished family-OS visual direction.

It is not yet a production-grade family AI operating system. The highest-risk issue is not the old `approved:true` bypass; that is fixed. The current P0 is that the backend approval decision path allows a `Child View` session to approve a high-risk server approval and then reach execution. SMS was unconfigured during the probe, so no external message was sent, but the authorization boundary would not stop a configured write/send tool.

The second major P0 is privacy truthfulness. Child mode hides some navigation, but the dashboard still shows adult approvals, bills, sensitive document titles, family admin quick actions, and household-wide summaries. A family operating system cannot rely on screen-level hiding while rendering sensitive AppData to restricted profiles.

The third P0 is product truthfulness around seeded/local approvals and workflow runs. Existing sample approvals can be approved in the UI and mark messages as `Sent` even when no backend approval/tool is bound. Automation runs can complete instantly as local records. These are useful prototypes, but they must be separated from real execution semantics.

## 2. Capability Inventory Used

Use now:

1. Local filesystem and shell: repo inspection, scripts, server/API probes, build/typecheck/audit.
2. `all-in-one-skill`: capability inventory, delivery workflow, evidence-backed handoff.
3. Browser QA: in-app browser DOM/screenshot interaction and Playwright screenshot capture.
4. API/runtime verification: direct backend health, session, connector, provider, approval, OAuth, job, browser, settings, and audit probes.
5. Web research: primary arXiv references for Memento-Skills and MemRL.
6. Report/handoff artifacts: markdown report, JSON backlog, screenshots, API probe summary.

Use if needed:

1. Context7 current docs for implementation follow-up; not needed for this audit because no code changes were made.
2. GitHub/Vercel/OpenAI setup tools; not needed except live OpenAI provider verification through the app backend.
3. Data/report widget hosting; not needed because the requested deliverable is a local implementation handoff bundle.

Unavailable or intentionally not used:

1. Subagents: the available multi-agent tool requires explicit user authorization for subagents; the pasted brief asks us to assess subagents in HomeOps, not to spawn Codex subagents.
2. Chrome Lighthouse: Chrome DevTools listed only an `about:blank` page and no navigation tool was exposed. Browser/Playwright evidence was used instead.
3. Real external account login: Google OAuth start was verified, but no provider login was completed and no email/text/calendar write was sent.

## 3. Evidence Summary

Browser and UI evidence:

1. Profile gate rendered cleanly with Owner, Adult Admin, Child View, and Guest/Helper profiles.
2. Owner dashboard rendered with no browser console errors/warnings.
3. Main screens inspected: Home, Helper Agents, Automations, Messages & Approvals, Household Spaces, Mini Apps, Files & Knowledge, Playbooks, Activity & Memory, Connections, Settings.
4. Dashboard ask field test: broad natural-language family schedule request opened an empty command palette instead of answering.
5. Weather connector was run from the UI and returned a live Open-Meteo payload.
6. Webhook Receiver test event was sent from the UI and appeared as a recent event.
7. Child View profile was inspected and showed adult household data on the dashboard.
8. Automation run test created an instant local run history item.

API/runtime evidence:

1. `/api/health`: `ok:true`, version `1.2.0`, `authRequired:true`, `externalActionsEnabled:true`.
2. `/api/connectors` without session: `401 authentication_required`.
3. `/api/health` with hostile Origin: `403 origin_not_allowed`.
4. `/api/settings` mutation without CSRF: `403 csrf_failed`.
5. Child settings mutation: `403 insufficient_role`.
6. Client `approved:true` on `sms.send`: `422 approval_not_found`.
7. Approval with changed input after approval: `422 approval_input_changed`.
8. Child View decision of high-risk server approval: `200`, status `approved`, `decidedBy:"child-1"`.
9. Child View execution after child approval: reached tool execution and returned `not_configured` only because SMS is not configured.
10. Custom HTTP configured to `http://127.0.0.1:8787`, then `http.get`: `422 egress_blocked`; test config was revoked.
11. Google OAuth start: returned real Google consent URL with backend callback, state, scopes, and PKCE challenge.
12. OpenAI provider health: reachable; chat returned exact expected text through `gpt-4o-mini`.

Verification commands:

1. `npm run typecheck`: passed.
2. `npm run build`: passed; Vite/Rolldown deprecation warnings present.
3. `npm audit --json`: zero vulnerabilities.

Screenshots:

1. `evidence/screenshots/profile-gate.png`
2. `evidence/screenshots/connections-overview.png`
3. `evidence/screenshots/automation-run-history.png`
4. `evidence/screenshots/child-dashboard-data-leak.png`

## 4. Research Benchmark: Memento-Skills And MemRL

Primary references:

1. [Memento-Skills: Let Agents Design Agents, arXiv:2603.18743](https://arxiv.org/abs/2603.18743)
2. [MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory, arXiv:2601.03192](https://arxiv.org/html/2601.03192v1)

Relevant benchmark concepts:

1. Memento-Skills frames reusable skills as structured, persistent, evolving memory and uses a read/write reflective loop to route to useful skills, create or update skills from experience, and improve task-specific agents without updating model weights.
2. MemRL separates stable LLM reasoning from plastic external memory. It structures memory around intent, experience, and utility; retrieves first by semantic similarity and then by learned utility; and updates utilities from environmental feedback.
3. For HomeOps, a credible family-agent architecture needs both a Skill Evolution Engine and an Agent Evolution Engine. Skills should be versioned, scoped, evaluated, promoted, merged, retired, and shared to eligible agents. Agents should be evaluated on outcomes, connector success, approval safety, delegation quality, and memory/tool choice.

Current HomeOps benchmark result:

1. Skill Evolution Engine: missing.
2. Agent Evolution Engine: missing.
3. Utility-scored memory retrieval: missing.
4. Stateful prompt or persistent execution context per agent: partial in stored instructions/memories, but not runtime-evaluated.
5. Structured execution traces that feed learning: partial local activity/runs exist, but not sufficient for learning/evolution.
6. Experience-driven improvement: not implemented.

## 5. Product Claim Validation

| Claim | Current reality | Assessment |
|---|---|---|
| Premium family command center | Strong visual direction, profile gate, family dashboard, spaces, files, playbooks, mini apps | Partially real; privacy scoping is not production-safe |
| Conversational HomeOps assistant | Dashboard ask field and command palette exist | Incomplete; broad requests do not produce assistant responses |
| Agent builder | Existing agent screen, templates, provider-backed generation path | Partially real; generated agents are configs, not runtime agents |
| Skill builder | Playbooks and memory exist | Missing as skill builder/evolution system |
| Workflow builder | Templates, builder, automations, run history | Partially real; execution is mostly local simulation |
| Connector center | Real backend connector/provider catalog | Partially real and improved |
| Real OAuth login redirects | Google start URL with PKCE verified | Real for Google setup; other providers unconfigured |
| Real provider adapters | OpenAI verified; Anthropic/Gemini not configured; local providers unreachable | Partially real |
| Local AI provider support | Ollama/LM Studio adapters present | Configured-looking but unreachable; readiness semantics need correction |
| Server-side approval enforcement | Server-side records, input hashes, consume-once exist | Partially real; role authorization is P0 broken |
| Approval review | UI exists; server-bound approval path exists | Unsafe until role bug and seed approval truth issue are fixed |
| Real tool execution | Weather and webhook verified; Custom HTTP guard verified | Partially real |
| Document/file intelligence | Seeded file summaries and local upload processing | Scaffolded/local extraction, not full document intelligence |
| Memory persistence | CRUD and IndexedDB persistence | Real persistence, not learning memory |
| Subagent orchestration | Subagent run records from templates | Simulated |
| Browser automation | Honest boundary reports runtime unavailable | Boundary real; runtime not connected |
| Action-oriented execution | Weather/webhook/API paths real; workflows mostly local records | Partially real |

## 6. Confirmed Bugs And Blockers

### P0-1: Child View Can Approve High-Risk Server Approvals

Problem: A child profile can approve a high-risk server approval and then reach execution.

Evidence:

1. Owner created high-risk `sms.send` server approval.
2. Child View fetched the approval by ID.
3. Child View posted `decision:"approve"` and received status `200`.
4. Approval response showed `status:"approved"` and `decidedBy:"child-1"`.
5. Child View then called `/api/tools/sms.send/execute` with the approval ID and reached connector execution; SMS was unconfigured, so no external send occurred.

Likely root cause:

1. `server/index.mjs` approval decide route uses `gate(req,{})`, not `minRole:"Adult Admin"` or an approval-specific policy.
2. `consumeApproval` checks household/tool/input/status but not approver role, requesting actor, or allowed approver list.
3. Approval GET exposes full approval detail to any authenticated session.

End-state fix:

1. Add an approval policy model: allowed roles, allowed members, risk/category rules, space scope, and action owner.
2. Require Adult Admin/Owner for high-risk household/external actions by default.
3. Bind execution to approvals decided by an authorized actor.
4. Add backend tests for child/helper read, decide, and execute denial.

Success criteria:

1. Child and Guest/Helper receive `403` for approval decisions and execution of high-risk approvals.
2. Adult Admin/Owner decisions are accepted only for allowed spaces/categories.
3. Consumed approvals cannot be reused.
4. Changed input, expired, wrong tool, wrong household, wrong role all fail with explicit errors.

### P0-2: Child Dashboard Leaks Adult Household Data

Problem: Child View hides some screens but still renders adult/sensitive dashboard data.

Evidence:

1. Child dashboard displayed approvals, utility bill, subscription/repair/school documents, adult quick actions, and family-wide messages.
2. `screenAllowedForRole` limits `settings`, `connections`, `automations`, and `activity`, but not dashboard data.
3. Dashboard calls `generateBriefing(data)`, pending approvals, overdue tasks, files, threads, and suggestions from full AppData.

Likely root cause: role gating is screen-level, not object/data-level.

End-state fix:

1. Define a role and space permission matrix.
2. Filter AppData by member role, member id, allowed spaces, sensitivity, approval category, and task assignment before it reaches screens.
3. Apply the same policy server-side.
4. Hide quick actions that a role cannot use.

Success criteria:

1. Child View sees child-safe schedule/tasks only.
2. Child View cannot see bills, adult approvals, sensitive medical/financial/legal/identity documents, or external-action drafts.
3. Guest/Helper sees only explicitly shared spaces/tasks.

### P0-3: Seed Approvals Can Look Like Real External Sends

Problem: Seed approvals can be approved and cause UI-local status changes without backend execution.

Evidence:

1. Seed approvals in `src/data/seed.ts` have no `backendApprovalId`.
2. `approveRequest` treats unbound approvals as local decisions, marks related run completed, and sets related message delivery status to `Sent`.

Likely root cause: sample review approvals and executable server approvals share one UI model.

End-state fix:

1. Split approval record types.
2. Require `backendApprovalId`, `toolId`, and input hash for any approval whose approval would execute or send.
3. Label sample approvals as sample/draft review.

Success criteria:

1. No unbound approval can show `Sent`, `Executed`, or connector success.
2. Seed/demo approvals remain educational and clearly non-executing.

## 7. Incomplete Or Scaffolded Features

1. Assistant/chat: no true conversational assistant loop, no persistent response trace, no natural-language execution loop from the dashboard ask field.
2. Workflow execution: UI run history is useful, but runs are local AppData records unless a plan step explicitly calls a backend tool through `runPlan`.
3. Subagents: records are generated from template IDs, not spawned/executed independent workers.
4. Skill system: playbooks are content artifacts, not executable, versioned, utility-scored skills.
5. Agent evolution: no effectiveness evaluation, no role/instruction update loop, no tool-selection learning.
6. Skill evolution: no skill creation from successful workflows, no failure-driven repair, no merge/version/retire path.
7. Browser automation: boundary is honest and unavailable, but seeded workflows imply behavior that has not happened in this runtime.
8. Document intelligence: local seed summaries and upload processing exist; no robust parser/OCR/extraction pipeline was verified.
9. Planner grounding: provider planner can call OpenAI, but currently over-selects missing external connectors and underuses local HomeOps data.

## 8. Connector And Provider Audit

| Connector/provider | Visible status | Actual status | Classification |
|---|---:|---:|---|
| Weather | Connected | UI run returned Open-Meteo payload | Real and usable |
| Webhook Receiver | Connected | UI test event stored and shown | Real in dev; unsigned unless secret configured |
| Local Files | Local-only | Client-only import surface; not deeply tested | Real local surface, partial intelligence |
| RSS / Feed | Setup required | Not configured | Configurable but not connected |
| Custom HTTP | Setup required | Configurable; loopback blocked by egress policy | Real but must remain guarded |
| Browser Automation | Runtime not connected | `/api/browser/session` returned runtime_unavailable | Boundary real, runtime missing |
| Text Messaging/Twilio | Setup required | Not configured | Configurable but not connected |
| Google OAuth provider | Not connected | OAuth start URL real with PKCE; no account login performed | Real but incomplete until account connected |
| Microsoft/Slack/Dropbox/Notion/Todoist/TickTick | Setup by admin | Missing deployment credentials | Not configured by deployment |
| OpenAI | Configured active | Health reachable; chat verified | Real and usable |
| Anthropic Claude | Not configured | Health not_configured | Configurable but missing key |
| Google Gemini | Not configured | Health not_configured | Configurable but missing key |
| OpenAI-compatible | Not configured | Missing base/key | Configurable but missing setup |
| Ollama | UI says Configured | Health unreachable | Misleading readiness |
| LM Studio | UI says Configured | Health unreachable | Misleading readiness |

## 9. Persona Simulation Findings

### Persona 1: Busy Parent Managing School, Daycare, Meals, Chores, And Documents

Expected journey:

1. Ask: "Summarize today's family schedule and tell me what needs attention."
2. Connect Gmail/Calendar.
3. Find school emails and attachments.
4. Draft a daycare email requiring approval.
5. Create a weekly family briefing workflow.

Observed:

1. Dashboard already surfaces a family briefing from local data.
2. Broad ask opens empty command palette, not an answer.
3. Google OAuth start is real, but no account is connected in this run.
4. Existing school approval is sample/local and not backend-bound.
5. Workflow builder/planner exists, but execution is not durable end-to-end.

Assessment: good command-center prototype, not yet a true personal/family assistant.

### Persona 2: Adult Child/Caregiver Coordinating Medical Appointments And Family Updates

Expected journey:

1. Ask for caregiving update for siblings.
2. Pull medical appointments and documents.
3. Draft update message requiring approval.
4. Preserve medical privacy boundaries.

Observed:

1. Caregiving spaces, agent, playbook, and seed update exist.
2. Medical/caregiving data is visible in generalized household surfaces unless role filtering is added.
3. Messaging approvals can be local samples rather than executable connector records.
4. Text Messaging is not configured.

Assessment: strong product intent, insufficient privacy and connector execution.

### Persona 3: Solo Professional/Household Operator Managing Receipts, Invoices, Scheduling, Travel

Expected journey:

1. Process receipt and add to expenses.
2. Research summer camps and create tracker.
3. Use OpenAI/local provider if available.
4. Create reusable skills from repeated workflows.

Observed:

1. Receipts, budget snapshot, mini apps, research workflows, and OpenAI provider exist.
2. OpenAI chat and planning work.
3. Planner can produce workflows but does not create reusable evolving skills.
4. Browser runtime is unavailable, so research/cancellation/portal workflows cannot run.

Assessment: good local organizer and planning prototype; missing evolution engine and browser runtime.

## 10. Workflow Chain Findings

1. Natural language to assistant response: broken/incomplete. Broad ask does not answer.
2. Natural language to generated plan: partially real through `/api/agent/plan`, provider-backed OpenAI call verified.
3. Generated plan to workflow run: partial. Plans can be stored/run locally, but durable backend execution is missing.
4. Connector read tool execution: real for Weather.
5. Connector write/send approval: server-side approval records exist; role authorization bug blocks production readiness.
6. Approval to execution: real for server-bound approvals, but unsafe role policy and sample approval confusion remain.
7. OAuth connection: real start/callback architecture; only start was verified.
8. Browser automation: correctly unavailable in current runtime.
9. Webhook ingestion: real dev/test path verified.
10. Evolution loop: missing.

## 11. Rewritten HomeOps System Architecture

HomeOps should be a family-safe agent operating system with these layers:

1. Household Identity And Policy Layer: members, roles, spaces, permissions, child/guest limits, sensitivity rules, approval authorities.
2. Operator Context Layer: authorized view of tasks, events, files, memories, approvals, connector state, active runs, and recent traces.
3. Assistant Interface: conversational thread that converts user intent into answer, plan, approval, workflow, or blocked state.
4. Agent Registry: versioned agent definitions with roles, allowed tools, memory scope, approval rules, and evaluation state.
5. Skill Registry: versioned reusable skills/playbooks with metadata, scope, evidence, utility, owner, and status.
6. Workflow Engine: durable execution of steps, branching, retries, pauses, approvals, resumptions, and failures.
7. Tool/Connector Runtime: provider tool manifests, account-bound OAuth/API-key credentials, readiness and live health, input schemas, execution results.
8. Approval Engine: server-authoritative records, approver policy, input hash, consume-once execution, audit log, expiry, and revision.
9. Memory And Knowledge Layer: private/personal/household memory with sensitivity, provenance, embedding, utility, and retention rules.
10. Skill Evolution Engine: proposes, versions, tests, promotes, merges, and retires skills from execution evidence.
11. Agent Evolution Engine: evaluates agent effectiveness and proposes bounded instruction/tool/delegation/memory updates.
12. Audit And Evidence Layer: append-only trace of user request, plan, tools, approvals, connector calls, artifacts, feedback, and outcome.

## 12. Suggested Data Models

Core entities:

1. HouseholdSpace: id, name, type, sensitivityDefault, memberAccessRules, retentionPolicy.
2. MemberRole: memberId, role, allowedSpaceIds, approvalAuthority, childModePolicy.
3. Agent: id, currentVersionId, role, ownerScope, allowedTools, memoryScopes, skillIds, approvalPolicy.
4. AgentVersion: id, agentId, instructions, delegationPolicy, toolPolicy, createdFromTraceId, status.
5. Skill: id, name, scope, category, owner, currentVersionId, status.
6. SkillVersion: id, skillId, markdown/spec, toolHints, preconditions, successCriteria, evidenceTraceIds.
7. SkillUtility: skillVersionId, intentCluster, qValue, successCount, failureCount, lastUsedAt.
8. Task/Workflow: id, trigger, steps, requiredConnectors, approvalGates, ownerAgentId, state.
9. ExecutionTrace: id, requestId, actorId, agentIds, skillIds, steps, toolCalls, approvals, artifacts, outcome, rewardSignals.
10. Approval: id, toolId, inputHash, requestedBy, allowedApprovers, decidedBy, decisionRole, status, expiry, consumedAt.
11. ConnectorAccount: id, provider, householdId, actorId, scopes, tokenVaultRef, health, status.
12. ToolExecution: id, toolId, connectorId, accountId, inputHash, outputRef, status, latency, error.
13. Memory: id, scope, sensitivity, intentEmbedding, content, provenance, utility, owner, retention.
14. FeedbackEvent: id, traceId, source, rating, correction, approvalOutcome, failureReason.
15. EvolutionDecision: id, targetType, targetId, proposedChange, evidence, reviewer, status.

## 13. Text Execution Flow Diagrams

Natural language task:

```text
User request
  -> authorization-filtered operator context
  -> intent/risk/connectors/files/approval analysis
  -> agent selection or task-specific agent proposal
  -> skill retrieval: semantic recall + utility ranking
  -> workflow plan with steps and terminal states
  -> durable execution engine
  -> tool calls and approval pauses
  -> artifacts/messages/tasks
  -> execution trace
  -> feedback signals
  -> skill and agent evolution proposals
```

Approval execution:

```text
Agent proposes external action
  -> server creates approval with toolId + canonical input hash + allowed approvers
  -> authorized adult reviews/edits/denies
  -> server records decision and role
  -> execution consumes approval once
  -> connector executes or fails truthfully
  -> audit + user-visible result
```

Dual evolution loop:

```text
Execution trace + outcome + feedback
  -> Skill Evolution Engine evaluates skill usefulness and proposes skill updates
  -> Agent Evolution Engine evaluates planning/delegation/tool/memory behavior
  -> reviewer approves, edits, or rejects proposals
  -> approved updates become scoped versions
  -> next tasks retrieve updated skills/agents by relevance and utility
```

## 14. Prioritized Roadmap

Phase 0: production blockers

1. Fix approval role authorization and execution consumption.
2. Implement object-level data filtering for child/guest roles.
3. Split sample/local approvals from executable server approvals.
4. Add backend tests for role/approval/security invariants.

Phase 1: truth-preserving runtime

1. Make workflow runs server-durable.
2. Add internal HomeOps data tools.
3. Make assistant thread runtime real.
4. Correct provider readiness semantics.
5. Gate browser-dependent workflows on browser runtime readiness.

Phase 2: connector completion

1. Finish Google account connection UX and health loops.
2. Add connected-account-scoped tool execution tests.
3. Harden webhook signing UX and production required-secret flow.
4. Add connector setup diagnostics and role-safe provider catalogs.

Phase 3: agent/skill platform

1. Add versioned Agent and Skill models.
2. Implement execution traces as first-class data.
3. Add Skill Evolution Engine.
4. Add Agent Evolution Engine.
5. Add human review for promoted skills/agent updates.

Phase 4: product polish

1. Improve accessibility of cards/buttons.
2. Resolve Vite build warnings.
3. Refine family-first visual hierarchy and child/guest empty states.
4. Add mobile role-specific QA.

## 15. Market Differentiation Opportunities

1. Family-safe approval engine: a clear household authority model for school, medical, finance, browser, and external messages would differentiate HomeOps from generic assistants.
2. Dual evolution loops: skills and agents improving from household-specific outcomes, while preserving privacy and human review, would be a serious moat.
3. Connector truth dashboard: separate deployment config, user connection, live health, tool availability, approval policy, and last execution evidence in one place.
4. Child/guest-safe operating modes: a product-grade family assistant should have first-class views for kids, caregivers, babysitters, grandparents, and external helpers.
5. Traceable household automation: every automated action should have a readable trail from request to plan to approval to connector result to memory/skill update.

## 16. Final Delivery Checklist

Completed:

1. Read pasted audit brief and all-in-one skill.
2. Ran capability inventory and followed delivery workflow.
3. Re-verified current HomeOps runtime boundary.
4. Inspected UI through browser across all major screens.
5. Ran API/security probes.
6. Verified connector/provider behavior.
7. Reviewed code paths behind approvals, role gating, runtime, planner, memory, and workflows.
8. Reviewed Memento-Skills and MemRL as design references.
9. Ran typecheck, build, audit, and health verification.
10. Restored mutable settings and revoked the temporary Custom HTTP test config.

Verified evidence:

1. Backend health: ok and `externalActionsEnabled:true`.
2. Security controls fixed: auth required, CORS origin rejection, CSRF, input-hash approval binding, Custom HTTP SSRF guard.
3. Critical blocker found: child approval decision/execution path.
4. Connector proof: Weather and Webhook.
5. Provider proof: OpenAI health/chat.
6. OAuth proof: Google PKCE start URL.

Not verified:

1. Full OAuth account login/callback with a real Google account.
2. Real Gmail/Calendar/Drive/Todoist/Slack/Microsoft tool execution.
3. Real Twilio send, because SMS is not configured and no external send was authorized.
4. Real browser automation runtime, because `BROWSER_RUNTIME_URL` is unavailable.
5. Real PDF/OCR extraction accuracy.

Recommended next action:

Start with the P0 approval-role fix and data-scope fix before adding new features. The current app is substantially more real than the old demo build, but the approval and child/privacy gaps are deployment blockers.

