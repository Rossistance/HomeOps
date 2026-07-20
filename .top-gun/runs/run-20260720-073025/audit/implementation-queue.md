# Implementation Queue — Work Packages — run-20260720-073025

## WP-001 — Wire the built skill into the chat-built automation (kill the status-pass)

- Objective: a chat-built automation's trigger actually runs the skill the chat built, never a read-only/zero-step status pass.
- Issue/Feature IDs: ISS-001 (P0), ISS-007, ISS-009, ISS-010; FEAT-005/006/007/008.
- Rationale: root cause of the user's report — reproduced (EV-011, EV-015): target loses skillId/goal, fires degrade to `buildReadonlyPlan`.
- User and architecture outcomes: scheduled fires execute the real briefing recipe; an automation that would target nothing runnable is refused honestly at build time.
- Affected files: server/index.mjs (materializeBuild), server/planner.mjs (normalizeBuild — allow the automation to carry target linkage), server/triggers.mjs (fireTriggerInner preference order), server/agents.mjs (status semantics), server/engine.mjs (trigger lastStatus writeback).
- Implementation steps (thin vertical slices):
  1. materializeBuild: when a skill was created, target = `{kind:"agent", agentId, skillId: created.skill.id, goal: spec.agent?.instructions ?? spec.summary}`; skill-only builds target the skill directly.
  2. fireTriggerInner: target with skillId → runSkill as that agent (already supported by runAgent's skillId branch — pass it through).
  3. Refuse (422 with honest chat message) an automation whose resolved target has neither skillId nor goal.
  4. Trigger lastStatus terminal writeback via onRunFinished (ISS-009).
  5. Decide + enforce one Draft/Active lifecycle for chat-built agents; align server notes + both clients' copy (ISS-007).
- Design and content direction: chat build_result copy states what will run and when ("Every day at 07:00 it will run 'Morning Briefing' — the email step will ask for approval unless you allowlist it").
- State/API/data/job/migration implications: existing triggers with empty targets — one-time sweep flags them "needs attention" rather than silently keeping them; no schema migration (JSON docs).
- Accessibility/responsive/security/performance requirements: no new surfaces; policy clamp and engine re-validation unchanged.
- Dependencies: none (first).
- Acceptance criteria: repro-A assertion — created trigger's target.skillId equals the created skill; fired run's steps equal the skill's steps (send step parks for approval); a skill-less+goal-less automation spec returns `unrunnable_automation` and the chat shows it; trigger.lastStatus becomes `completed|failed|waiting_for_approval` after the run settles.
- Focused validation: extend audit/evidence/repro-false-success.mjs into a permanent server test (harness + scripted provider); protects the P0 regression.
- Risk: low-medium — touches the build path used by both clients; contract is additive.
- Rollout and rollback: server-only, backward-compatible (old triggers still fire; new ones carry more); rollback = revert commit.
- Recommended sequence: 1.

## WP-002 — Time-of-day scheduling ("every day at 7 AM" means 07:00)

- Objective: chat-built recurring automations first fire at the stated local time and stay anchored to it.
- Issue/Feature IDs: ISS-003 (P1); FEAT-006.
- Rationale: EV-011 — nextRunAt = creation+24h; the spec cannot express 7 AM.
- User and architecture outcomes: "daily 7 AM" fires at 07:00 household-local; DST drift bounded.
- Affected files: server/planner.mjs (ASSISTANT_SYS build rules + normalizeBuild: accept `runAt` AND a new `anchor` "HH:MM" for recurring), server/triggers.mjs (createTrigger/tick: when anchor present, nextRunAt = next anchor occurrence; recompute per fire), server/index.mjs (settings: household timezone if absent), clients (show "Daily at 07:00").
- Implementation steps: 1) prompt + normalizeBuild accept anchor/runAt for recurring; 2) createTrigger computes first occurrence from anchor + household tz (fallback: server tz, disclosed); 3) tick recomputes from anchor not `now+intervalMs`; 4) Automations UI copy.
- Design and content direction: automation card shows the human schedule ("Daily · 7:00 AM"), not intervalMs.
- State/API/data/job/migration implications: additive trigger field `anchor`; old interval triggers unchanged.
- Accessibility/…: n/a beyond copy.
- Dependencies: WP-001 (same files; land after).
- Acceptance criteria: for the repro-A request created at 09:23, nextRunAt is the next 07:00 local (±1 min); after a fire, the following nextRunAt is again 07:00 (not fire-time+24h); a DST transition keeps 07:00 local (test with tz fixture).
- Focused validation: unit tests on createTrigger/tick anchor math; repro-A extended assertion.
- Risk: low — isolated scheduling math; timezone source needs one product decision (household setting default).
- Rollout and rollback: additive; rollback safe.
- Recommended sequence: 2.

## WP-003 — Truthful runs: no vacuous "sends", no silent clamps, honest summaries

- Objective: a run can never claim an external effect it did not attempt; chat summaries distinguish composed vs delivered.
- Issue/Feature IDs: ISS-002 (P0), ISS-005 (P1); FEAT-003/009/014/020.
- Rationale: EV-012 ("Done — finished (3/3)" + "That worked" for a no-op), EV-014 (silent clamp).
- User and architecture outcomes: chat says exactly what happened ("I composed the briefing but could NOT send it — no email tool was available/permitted"); dropped steps are visible.
- Affected files: server/planner.mjs (normalizePlan: flag null-tool steps whose title/detail matches send/email/text/notify verbs → mark `effectClaimed`), server/engine.mjs (reasoning steps recorded as `succeeded(kind:reasoning)`; effectClaimed+toolless ⇒ step status `skipped_no_tool` with honest detail), server/orchestrator.mjs (clamp → keep steps as `skipped: not permitted (tool)` instead of deletion, or fail start with named tool), server/assistant-runs.mjs (runOutcomeText: report delivered/parked/skipped counts; suppress "That worked/save as helper" when zero effect steps succeeded).
- Implementation steps: 1) plan-normalization flagging; 2) engine step taxonomy + statuses; 3) clamp visibility; 4) summary rewrite + save-offer gating; 5) client badges for `skipped` (both clients render step statuses already).
- Design and content direction: keep the warm voice, add precision: "Done — composed your briefing (2 steps). Not sent: the email step needs Gmail connected."
- State/API/data/job/migration implications: new step statuses ride the existing publicRun shape; clients tolerate unknown statuses (mapStepStatus default) — verify.
- Dependencies: none technically; pairs with WP-001.
- Acceptance criteria: repro-B run_result contains an explicit not-sent disclosure and no save-offer; repro-C run shows the gmail.send step with `skipped: not permitted`; a plan whose steps all execute real tools keeps today's success copy.
- Focused validation: permanent harness test from repro B/C; snapshot of runOutcomeText strings.
- Risk: medium — prompt+engine+summary touch; regression risk on legitimate reasoning-only answers (guard: only effect-claiming steps change).
- Rollout and rollback: server-first (clients tolerate); rollback = revert.
- Recommended sequence: 3.

## WP-004 — Parked-run honesty: waiting, expired, and stalled runs report back

- Objective: no run can disappear silently; waiting/expired states land in the conversation and the clients.
- Issue/Feature IDs: ISS-004 (P1), ISS-008 (P2); FEAT-010/014/019/022.
- Rationale: EV-013 ("On it —" forever), EV-007 (expiry skips hooks), EV-026 (expired never alerts).
- User and architecture outcomes: chat gains "Waiting for your approval (expires in 30 min)" and "That approval expired — nothing was sent" messages; repeat expiries alert the Owner.
- Affected files: server/engine.mjs (emit a hook/message on park + call fireRunFinished on expiry; count expired in the consecutive alert), server/assistant-runs.mjs (park/expire messages), apps/mobile (ask)/index.tsx + run-context.tsx and src/screens/Assistant.tsx (surface waiting state past polling caps; reopen-sync already exists via refreshConversation).
- Implementation steps: 1) onRunParked hook + chat message with deep link; 2) expiry → fireRunFinished + honest message; 3) expired counts toward the keeps-failing alert; 4) client copy.
- Design and content direction: approval deep link ("Review it in your Inbox"); expiry message names the step and consequence.
- State/API/data/job/migration implications: none (messages + hook).
- Dependencies: WP-003 (summary voice), else standalone.
- Acceptance criteria: repro-B2 conversation contains a waiting message ≤5 s after parking; with a shortened TTL fixture the expiry message appears and the run shows `expired`; two consecutive expiries create the Owner in-app alert.
- Focused validation: harness test with injectable TTL; re-run repro B2.
- Risk: low-medium — hook ordering; ensure no duplicate messages on resume.
- Rollout and rollback: additive; rollback safe.
- Recommended sequence: 4.

## WP-005 — Real unattended delivery: an engine tool over the contact-method registry

- Objective: scheduled agents can actually deliver email/text through the fail-closed registry (verified + opted-in + per-agent allowlist) without a per-run 30-minute approval race.
- Issue/Feature IDs: ISS-006 (P1), ISS-008; FEAT-011/012/013.
- Rationale: EV-009/EV-010/EV-013/EV-017 — today no engine-reachable real-send path exists for the scheduler.
- User and architecture outcomes: "email wrhixon@gmail.com every morning" becomes a registry send: add/verify the contact method once, allowlist the agent once (standing consent), then unattended fires deliver — or return the registry's honest needsSetup.
- Affected files: server/internal-functions.mjs (new `homeops.notify_contact` {methodId|to, subject, body} → deliverNotification), server/notify.mjs (actor resolution for scheduler-fired runs: use the agent owner's Google account), server/planner.mjs (catalog + prompts steer email sends to the registry tool; gmail.send stays for ad-hoc personal sends), contact-method UI copy (allowlist = standing send consent).
- Implementation steps: 1) tool wrapping deliverNotification (approval NOT required when the method's allowedAgentIds contains the acting agent — that allowlist IS the standing approval; otherwise requiresApproval true); 2) scheduler actor account resolution (personal-agent owner already flows via fireTriggerInner attribution); 3) planner/build guidance; 4) chat setup nudge when the target address has no verified method ("I'll need you to verify wrhixon@gmail.com as a contact method first — sent you the link").
- Design and content direction: consent-forward copy; never hide that a standing allowlist means unattended sends.
- State/API/data/job/migration implications: none structural; audit rows for every delivery already exist.
- Accessibility/responsive/security/performance: SECURITY-SENSITIVE — per-agent allowlist + verified + opt-in are the gates; kill switch must still halt it (deliverViaChannel path executes under notify, verify externalActionsEnabled coverage for the email branch — add it).
- Dependencies: WP-001 (reachable from builds); product/consent decision (explicitly flagged for the user at selection).
- Acceptance criteria: harness (mocked Gmail fetch): scheduled fire of an allowlisted agent delivers (mock asserts RFC822 to the method's address); un-allowlisted agent → honest agent_not_allowed; kill switch on → no send; unverified method → honest block. Live one-shot delivery test ONLY with explicit user authorization and a user-owned inbox.
- Focused validation: family-safety.test.mjs pattern extension.
- Risk: medium-high — expands unattended external-send authority; mitigated by registry gates + audit.
- Rollout and rollback: feature-flag-able (tool registration); rollback = unregister tool.
- Recommended sequence: 5 (after user consent decision).

## WP-006 — Automations/build surface truth polish

- Objective: the Automations and chat surfaces show the real lifecycle: terminal lastStatus, honest Draft/live copy, human schedules, role-aware build proposals.
- Issue/Feature IDs: ISS-007, ISS-009, ISS-010, ISS-011 (P2/P3); FEAT-004/005/006/016/018.
- Rationale: EV-011/EV-016/EV-022/EV-028.
- User and architecture outcomes: what the family sees matches what the system will do.
- Affected files: apps/mobile (ask)/index.tsx BuildCard, Automations screens (mobile+web), server/planner.mjs (role-aware proposals), server/orchestrator.mjs (status-pass query hygiene).
- Implementation steps: copy fixes; lastStatus rendering (after WP-001 slice 4); guest-role proposal answer; drop self-referential web.search in readonly plans.
- Dependencies: WP-001.
- Acceptance criteria: BuildCard no longer claims "live" for Draft agents; automation rows show terminal status + "Daily · 7:00 AM" form; Guest chat gets guidance not a build card (persona pass re-run).
- Focused validation: persona-passes.mjs re-run; component copy snapshots.
- Risk: low.
- Rollout and rollback: trivial.
- Recommended sequence: 6.
