# Agent Delta — audit-lead — run-20260721-054151

- Agent: audit-lead (fable/claude-fable-5, high effort)
- Phase: AUDIT_RUNNING → audit complete, S5 selection pending (menu presented)
- Completed: 2026-07-21T06:5xZ (UTC)

## What I produced

All under `.top-gun/runs/run-20260721-054151/`:

- audit/master-report.md (ART-003) — 25-section unified report; root cause: web read-model gap over a sound server engine.
- audit/issue-register.md (ART-004) — ISS-001..017, every row evidence-linked.
- audit/evidence-ledger.md (ART-005) — EV-001..040; 27 inspected screenshots + logs/net/data/probe/research files under audit/evidence/.
- audit/functionality-inventory.md (ART-006) — 36-feature denominator, 10-row trace matrix, coverage 83% execution / 31% verified / 75% persona.
- audit/journey-register.md (ART-007) — 5 personas, live journeys (JRN-2 = mission journey, FAIL as user journey / PASS mechanics), 22-use-case benchmark mapping (4 runnable-now, 5 internal-broken, 13 externally gated).
- audit/product-intent-register.md (ART-008), audit/architecture-authority-map.md (ART-009), audit/decision-log.md (ART-010, DEC-011..017), audit/hypothesis-queue.md (ART-011, HYP-001 resolved-no race).
- audit/prd.md (ART-012) — three redesigns: (A) Helper Agents unification, (B) orchestration harness rebuild to the 22-UC executable bar, (C) Supermemory self-host + LM Studio memory redesign.
- audit/work-packages.md (ART-013) + mirror audit/implementation-queue.md — WP-001..012.
- audit/numbered-menu.md (ART-014) — 13 items, recommended bundle = items 1+2+3+4, improvements-wipe = opt-in item 9 (backup-first, selective revert, archive-not-delete).
- audit/evidence/DATA-032-api-truth-vs-ui.md (ART-015) — verbatim same-session API-vs-UI smoking-gun captures.
- Journal events #5 (S1 checkpoint), #6 (S3 checkpoint), plus dispatch-return events after this delta.

## Root cause (one paragraph)

The server engine plans, runs, parks, approves, and completes tasks correctly (proven live: park → API-approve → complete, EV-038). The web app simply never reads back the four server stores that prove it: approvals (no list fetch anywhere; Approvals tab renders the local zustand store; the only mirror path is skipped for chat/scheduled runs), notifications (client function exists, zero callers), run artifacts (drafts/decisions/summaries — no consumer), and undated tasks (no surface). Plus the outcome summary calls draft-writing tools "delivered" (name-regex), and chat runs carry no agent identity so the one real delivery tool refuses them. Net effect: runs park invisibly and expire at 30 minutes, or "complete" with results nobody can find — exactly the reported experience. Resident-tenant data (6 pending approvals, 6 expired runs, 7 forever-parked, 15 silently auto-applied "improvements") matches the signature.

## Validation output (verbatim)

```
$ python .../convergent-360/scripts/validate_audit.py --project "D:/FamiliOS/FamiliOS" --stage audit
OK (audit): validation passed (0 warning(s)).
```

Self-check: all brief-required files exist and are non-template (markers removed); every ISS row carries ≥1 EV link; journey register covers all 22 use-cases + the core one-task-E2E journey (JRN-2); menu ends with the exact selection question.

## Budget consumed vs plan

Plan: 400k output tokens (soft). Actual (estimate, host does not meter): ~230k total context consumed by end of run; output tokens ~110-130k — well under plan (~30%). Heaviest spends: live E2E repro + full-surface crawl (screenshot inspection), register/report writing. Crawl kept mechanical per brief; no nested agents spawned (single-lead context economy — disclosed in report §3).

## Deviations / disagreements preserved

- DEC-011: repro used a deterministic fake Ollama-protocol provider (repo's own hermetic pattern) because LM Studio is token-locked (EV-035) and using the resident OpenAI key would spend user funds + touch their tenant. Plan-quality observations are therefore not claimed for gpt-5.5 (HYP-004 open).
- User's "conflict between agents and automations" hypothesis: preserved and answered — the dual worlds exist (ISS-005) and shadow each other's history, but the E2E killer is the read-model gap (DEC-012); both are in the register.
- "52 agents": actual resident counts are 18 agents + 16 playbooks + 13 skills + 4 functions (+3 triggers) = 51 fragments; the perception is the fragmentation itself (ISS-013).
- Improvements wipe: proposed as selective revert + archive, NOT blanket delete (DEC-015) — blanket delete would keep the mutations and destroy the audit trail.

## Blockers with exact unblock conditions

1. LM Studio local AI + Supermemory-LLM path: blocked until the user pastes an LM Studio API token (LM Studio → Developer → API tokens) AND ISS-006 (key field for local providers) is implemented (WP-007 slice 1).
2. 13 of 22 use-cases: blocked on external provisioning — Google OAuth app with gmail.send (user reconnect), Microsoft/Slack/Dropbox/Notion/Todoist/TickTick app registrations, Twilio credentials, Alexa/Google Home device APIs. Unblock: user provisions each, or accepts sandbox-verified status (WP-012/DEC-016).
3. Child-role web journey: blocked by ISS-012 (profile picker hard-bound to resident tenant). Unblock: WP-010.
4. Real-provider plan-quality check (HYP-004): blocked until a usable key/token exists on a disposable tenant.

## State for the next phase

S5 gate: menu at audit/numbered-menu.md ends with the exact selection question; no product source or data was modified (repo read-only; only the disposable tenant hh_849af84da549 was created via the app itself). Matching-lead can proceed on audit artifacts; implementation must wait for user selection.
