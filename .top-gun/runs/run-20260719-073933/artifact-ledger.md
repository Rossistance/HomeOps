# Artifact Ledger

Rows added only by mem's record_artifact.py. Snapshot mode stores a frozen copy
under snapshots/; reference mode tracks a live file by path + hash.

| ID | Timestamp (UTC) | Mode | Path | SHA-256 (12) | Producer | Kind | Purpose | Supersedes |
|---|---|---|---|---|---|---|---|---|
| ART-001 | 2026-07-19T07:51:54Z | snapshot | .top-gun/runs/run-20260719-073933/facts-and-notes.md | 57e2f833a425 | top-gun | handoff | BOOTSTRAP facts handoff for audit dispatch | - |
| ART-002 | 2026-07-19T07:51:55Z | snapshot | .top-gun/runs/run-20260719-073933/handoffs/audit-lead-brief.md | b42605f92fdf | top-gun | brief | Audit lead dispatch brief | - |
| ART-003 | 2026-07-19T07:51:55Z | snapshot | .top-gun/runs/run-20260719-073933/audit/evidence/SS-000-bootstrap-mobile-onboarding.jpeg | 4975977ff008 | top-gun | evidence | Inspected bootstrap screenshot: mobile onboarding renders at 375x812 | - |
| ART-004 | 2026-07-19T08:56:48Z | snapshot | .top-gun/runs/run-20260719-073933/audit/master-report.md | 33a5c37ca146 | audit-lead | report | Convergent 360 master report: 25 sections, 5 personas, 5 journeys, numbered menu + Recommended bundle (WP-001+002+003), 11 issues (1 P0, 3 P1) | - |
| ART-005 | 2026-07-19T08:56:48Z | snapshot | .top-gun/runs/run-20260719-073933/audit/issue-register.md | 915600692427 | audit-lead | register | Master issue register: ISS-001..010 (+003b), deduplicated root causes with evidence and acceptance criteria | - |
| ART-006 | 2026-07-19T08:56:48Z | snapshot | .top-gun/runs/run-20260719-073933/audit/functionality-inventory.md | 9c9a00ade2b7 | audit-lead | register | 82-feature denominator + 12-row UI-to-backend trace matrix + coverage (exec 49%, verified 29%, persona 49%) | - |
| ART-007 | 2026-07-19T08:56:48Z | snapshot | .top-gun/runs/run-20260719-073933/audit/implementation-queue.md | a6ba09c89206 | audit-lead | register | 5 work packages WP-001..005 with thin slices, acceptance criteria, rollback | - |
| ART-008 | 2026-07-19T08:56:48Z | snapshot | .top-gun/runs/run-20260719-073933/agent-deltas/audit-lead-delta.md | 8a993c7b3664 | audit-lead | delta | Audit-lead phase delta: conclusions, unverified items, coverage, budget ~180k/500k, blockers | - |
| ART-009 | 2026-07-19T08:57:05Z | snapshot | .top-gun/runs/run-20260719-073933/audit/evidence-ledger.md | 03fd65533743 | audit-lead | register | Evidence ledger EV-100..143 (screenshots inspected, DOM/console/network/code/test/data) | - |
| ART-010 | 2026-07-19T08:57:05Z | snapshot | .top-gun/runs/run-20260719-073933/audit/product-intent-register.md | 2aefd0035e3a | audit-lead | register | Product intent PI-001..015 incl 5 contradictions | - |
| ART-011 | 2026-07-19T08:57:05Z | reference | .top-gun/runs/run-20260719-073933/audit/architecture-authority-map.md | 0bd249d4c565 | audit-lead | register | Architecture + authority map (modules, data flow, APIs, auth/tenancy, deployment) | - |
| ART-012 | 2026-07-19T08:57:05Z | reference | .top-gun/runs/run-20260719-073933/audit/decision-log.md | 807cbf938bec | audit-lead | register | Decision log DEC-001..006 | - |
| ART-013 | 2026-07-19T08:57:05Z | reference | .top-gun/runs/run-20260719-073933/audit/hypothesis-queue.md | 079bfe62a934 | audit-lead | register | Hypothesis queue HYP-001..006 with next discriminating checks | - |
| ART-014 | 2026-07-19T09:00:24Z | snapshot | .top-gun/runs/run-20260719-073933/handoffs/matching-lead-brief.md | 5eb2d3041a89 | top-gun | brief | Matching lead dispatch brief | - |
| ART-015 | 2026-07-19T09:15:34Z | snapshot | .top-gun/runs/run-20260719-073933/matching/capability-task-matching.md | 501f1ac727ec | matching-lead | matching-guide | Capability-task matching guide: 13 tasks (WP-001..005 + 4 blocked journeys + ISS-008 CI guard + verification), 24-row capability map with live evidence, 500k-soft mission plan with 16pct reserve and per-option scenario math; validate_matching OK 0 warnings | - |
| ART-016 | 2026-07-19T09:15:34Z | snapshot | .top-gun/runs/run-20260719-073933/agent-deltas/matching-lead-delta.md | 62da34636de1 | matching-lead | delta | Matching-lead phase delta: conclusions, context-gate compliance incl design-token correction, open risks for implementation lead, budget ~35k/120k | - |
| ART-017 | 2026-07-19T21:44:55Z | snapshot | .top-gun/runs/run-20260719-073933/handoffs/implementation-lead-brief.md | 1fb1215045c2 | top-gun | brief | Implementation lead dispatch brief - full slate WP-001..005 per DEC-007 | - |
| ART-018 | 2026-07-19T23:15:41Z | snapshot | .top-gun/runs/run-20260719-073933/implementation/slice-log.md | 3ee80004392a | implementation-lead | report | Slice log, 8 slices with five-point verdicts (full slate) | - |
| ART-019 | 2026-07-19T23:15:41Z | snapshot | .top-gun/runs/run-20260719-073933/implementation/verification-matrix.md | e66298de76b0 | implementation-lead | report | Implementation verification matrix (28 rows, honest statuses) | - |
| ART-020 | 2026-07-19T23:15:42Z | snapshot | .top-gun/runs/run-20260719-073933/implementation/budget-ledger.md | f353a14697f2 | implementation-lead | report | Budget ledger planned vs actual with variance causes | - |
| ART-021 | 2026-07-19T23:15:42Z | snapshot | .top-gun/runs/run-20260719-073933/agent-deltas/implementation-lead-delta.md | dbc106ffe1bc | implementation-lead | handoff | Implementation-lead phase delta incl. hypothesis resolutions and new findings | - |
| ART-022 | 2026-07-19T23:15:55Z | reference | server/store.mjs | 5d0a4d52344c | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-023 | 2026-07-19T23:15:55Z | reference | server/test/harness.mjs | cd7f0db43e14 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-024 | 2026-07-19T23:15:55Z | reference | server/test/engine-hardening.test.mjs | 2af89147de3d | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-025 | 2026-07-19T23:15:55Z | reference | server/test/web-tools.test.mjs | a0d7b9ee2cf7 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-026 | 2026-07-19T23:15:56Z | reference | server/test/weather-honesty.test.mjs | c850221e70dd | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-027 | 2026-07-19T23:15:56Z | reference | server/connectors.mjs | 500487fe9b44 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-028 | 2026-07-19T23:15:56Z | reference | server/index.mjs | c708f1a04f80 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-029 | 2026-07-19T23:15:56Z | reference | .github/workflows/ci.yml | e2f13d89139d | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-030 | 2026-07-19T23:15:57Z | reference | render.yaml | e51fa198acc6 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-031 | 2026-07-19T23:15:57Z | reference | README.md | 66999dc4841d | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-032 | 2026-07-19T23:15:57Z | reference | package.json | 1903543e6d50 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-033 | 2026-07-19T23:15:57Z | reference | src/store/useStore.ts | a99c3d1338b8 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-034 | 2026-07-19T23:15:58Z | reference | src/components/Shell.tsx | fa05046a2350 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-035 | 2026-07-19T23:15:58Z | reference | src/screens/Onboarding.tsx | 75f27d13eb5b | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-036 | 2026-07-19T23:15:58Z | reference | src/screens/Lock.tsx | 93feebf9f8de | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-037 | 2026-07-19T23:15:58Z | reference | src/screens/Dashboard.tsx | 262870d56a25 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-038 | 2026-07-19T23:15:59Z | reference | src/screens/Assistant.tsx | e3d436c72b1a | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-039 | 2026-07-19T23:15:59Z | reference | src/lib/ai.ts | 3186b6f20996 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-040 | 2026-07-19T23:15:59Z | reference | src/screens/Automations.tsx | 152c63ce7f93 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-041 | 2026-07-19T23:15:59Z | reference | src/connectors/api.ts | f58562e24eb4 | implementation-lead | source | Full-slate implementation change (WP-001..005) | - |
| ART-042 | 2026-07-19T23:18:26Z | snapshot | .top-gun/runs/run-20260719-073933/implementation/slice-log.md | 9eb9cef74feb | implementation-lead | report | Slice log (verdict lines normalized to validator format) | ART-018 |
| ART-043 | 2026-07-19T23:18:41Z | reference | .top-gun/runs/run-20260719-073933/audit/decision-log.md | 143debccc62b | implementation-lead | register | Re-registration of decision-log current hash (drift was DEC-007 selection entry added by orchestrator after ART-012; content untouched by implementation lead) | ART-012 |
| ART-044 | 2026-07-19T23:22:01Z | snapshot | .top-gun/runs/run-20260719-073933/audit/decision-log.md | 06b3313ae2bd | top-gun | register | Decision log final incl DEC-008 closure | ART-043 |
