# Artifact Ledger

Rows added only by mem's record_artifact.py. Snapshot mode stores a frozen copy
under snapshots/; reference mode tracks a live file by path + hash.

| ID | Timestamp (UTC) | Mode | Path | SHA-256 (12) | Producer | Kind | Purpose | Supersedes |
|---|---|---|---|---|---|---|---|---|
| ART-001 | 2026-07-19T23:22:18Z | snapshot | testflight-feedback-handoff/HANDOFF.md | 517efd064ed4 | top-gun | evidence | TestFlight feedback seed package: 12 submissions, 13 screenshots, 11 candidate issues (TF-ISS-01..11), candidate WPs A-F; OBSERVED vs INFERRED labeled; audit must confirm in code | - |
| ART-002 | 2026-07-19T23:25:46Z | snapshot | .top-gun/runs/run-20260719-232201/facts-and-notes.md | 15d2367024d0 | top-gun | handoff | Run-2 BOOTSTRAP facts handoff incl runtime-driver probe results | - |
| ART-003 | 2026-07-19T23:25:46Z | snapshot | .top-gun/runs/run-20260719-232201/handoffs/audit-lead-brief.md | f9e48351fa77 | top-gun | brief | Run-2 audit lead dispatch brief (TestFlight mobile) | - |
| ART-004 | 2026-07-20T00:05:17Z | snapshot | .top-gun/runs/run-20260719-232201/audit/master-report.md | 5bc6a19fd2e3 | audit-lead | report | Convergent 360 master report + brownfield PRD + menu (TestFlight mobile mission) | - |
| ART-005 | 2026-07-20T00:05:17Z | snapshot | .top-gun/runs/run-20260719-232201/audit/issue-register.md | a526f8b50fdc | audit-lead | register | Master issue register (13 issues, TF-candidates resolved) | - |
| ART-006 | 2026-07-20T00:05:17Z | snapshot | .top-gun/runs/run-20260719-232201/audit/functionality-inventory.md | 901c25807819 | audit-lead | register | Functionality denominator + trace matrix + coverage | - |
| ART-007 | 2026-07-20T00:05:18Z | snapshot | .top-gun/runs/run-20260719-232201/audit/evidence-ledger.md | a88b42f709cf | audit-lead | register | Evidence ledger (13 SS + code/net evidence) | - |
| ART-008 | 2026-07-20T00:05:18Z | snapshot | .top-gun/runs/run-20260719-232201/audit/implementation-queue.md | df69ec1701db | audit-lead | register | Work packages WP-001..008 | - |
| ART-009 | 2026-07-20T00:05:39Z | reference | .top-gun/runs/run-20260719-232201/audit/decision-log.md | 3c9e8b9a01f3 | audit-lead | register | Decision log DEC-01..09 | - |
| ART-010 | 2026-07-20T00:05:39Z | snapshot | .top-gun/runs/run-20260719-232201/agent-deltas/audit-lead-delta.md | f86c714258f3 | audit-lead | handoff | Audit lead phase delta incl. cleanup notes | - |
| ART-011 | 2026-07-20T00:07:39Z | snapshot | .top-gun/runs/run-20260719-232201/handoffs/matching-lead-brief.md | 53b656b9c1c0 | top-gun | brief | Run-2 matching lead dispatch brief (bundle-scoped) | - |
| ART-012 | 2026-07-20T00:18:37Z | snapshot | .top-gun/runs/run-20260719-232201/matching/capability-task-matching.md | 6ccc9568ffb1 | matching-lead | matching-guide | Validated capability-task matching guide for the star bundle WP-001..004: 15 bounded tasks, routes, models, efforts, budgets (343k soft, 54k reserve), concurrency plan, authority constraints | - |
| ART-013 | 2026-07-20T00:19:15Z | reference | .top-gun/runs/run-20260719-232201/agent-deltas/matching-lead-delta.md | 260c4d0335c2 | matching-lead | delta | Matching lead phase delta: outputs, notable facts, budget consumed | - |
| ART-014 | 2026-07-20T00:21:17Z | snapshot | .top-gun/runs/run-20260719-232201/handoffs/implementation-lead-brief.md | c27e14a5a1fc | top-gun | brief | Run-2 implementation lead dispatch brief (bundle WP-001..004) | - |
| ART-015 | 2026-07-20T05:19:12Z | snapshot | .top-gun/runs/run-20260719-232201/implementation/slice-log.md | 447351c13eda | implementation-lead | report | Slice log: 13 slices, five-point verdicts, all ship | - |
| ART-016 | 2026-07-20T05:19:12Z | snapshot | .top-gun/runs/run-20260719-232201/implementation/verification-matrix.md | fef4f5f29f5d | implementation-lead | report | Verification matrix incl. honest partial/blocked/pre-existing-fail rows | - |
| ART-017 | 2026-07-20T05:19:12Z | snapshot | .top-gun/runs/run-20260719-232201/implementation/budget-ledger.md | 54361199861f | implementation-lead | report | Budget plan vs actual with variance causes | - |
| ART-018 | 2026-07-20T05:19:25Z | snapshot | .top-gun/runs/run-20260719-232201/agent-deltas/implementation-lead-delta.md | 8d2f7ad982d1 | implementation-lead | report | Implementation-lead phase delta (scope notes, decisions, parity risks) | - |
| ART-019 | 2026-07-20T05:19:25Z | reference | server/index.mjs | 5874fb3a2e2a | implementation-lead | source | Bundle server change (server/index.mjs) | - |
| ART-020 | 2026-07-20T05:19:26Z | reference | server/calendar.mjs | 09193f3a8ebe | implementation-lead | source | Bundle server change (server/calendar.mjs) | - |
| ART-021 | 2026-07-20T05:19:26Z | reference | server/test/help-reassign.test.mjs | 2b0391a93dfa | implementation-lead | source | Bundle server change (server/test/help-reassign.test.mjs) | - |
| ART-022 | 2026-07-20T05:19:26Z | reference | server/test/allday-events.test.mjs | 1a5b17c78e8a | implementation-lead | source | Bundle server change (server/test/allday-events.test.mjs) | - |
| ART-023 | 2026-07-20T05:19:26Z | reference | server/test/google-description.test.mjs | b2697c86432c | implementation-lead | source | Bundle server change (server/test/google-description.test.mjs) | - |
| ART-024 | 2026-07-20T05:19:40Z | reference | apps/mobile/src/app/(home)/event-form.tsx | cd50fa609b54 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/event-form.tsx) | - |
| ART-025 | 2026-07-20T05:19:41Z | reference | apps/mobile/src/app/(home)/calendar.tsx | 22ddaa2781fc | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/calendar.tsx) | - |
| ART-026 | 2026-07-20T05:19:41Z | reference | apps/mobile/src/app/(home)/grandparent.tsx | ec1962a19cfd | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/grandparent.tsx) | - |
| ART-027 | 2026-07-20T05:19:41Z | reference | apps/mobile/src/app/(home)/index.tsx | 66276d0cc939 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/index.tsx) | - |
| ART-028 | 2026-07-20T05:19:42Z | reference | apps/mobile/src/app/(home)/sitter.tsx | 799f66ff53e4 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/sitter.tsx) | - |
| ART-029 | 2026-07-20T05:19:42Z | reference | apps/mobile/src/app/(home)/kid.tsx | f44f98e5ff75 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/kid.tsx) | - |
| ART-030 | 2026-07-20T05:19:42Z | reference | apps/mobile/src/app/(home)/help.tsx | f42979ddbd16 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(home)/help.tsx) | - |
| ART-031 | 2026-07-20T05:19:42Z | reference | apps/mobile/src/app/(library)/index.tsx | d31612d146b4 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(library)/index.tsx) | - |
| ART-032 | 2026-07-20T05:19:43Z | reference | apps/mobile/src/app/(settings)/tasks.tsx | 730152e1be60 | implementation-lead | source | Bundle mobile change (apps/mobile/src/app/(settings)/tasks.tsx) | - |
| ART-033 | 2026-07-20T05:19:43Z | reference | apps/mobile/src/components/sheets/upload-sheet.tsx | 44692a38f99a | implementation-lead | source | Bundle mobile change (apps/mobile/src/components/sheets/upload-sheet.tsx) | - |
| ART-034 | 2026-07-20T05:19:43Z | reference | apps/mobile/src/lib/api.ts | 51e0ad0dd168 | implementation-lead | source | Bundle mobile change (apps/mobile/src/lib/api.ts) | - |
| ART-035 | 2026-07-20T05:19:44Z | reference | apps/mobile/src/lib/spaces.ts | ebd5f1df9034 | implementation-lead | source | Bundle mobile change (apps/mobile/src/lib/spaces.ts) | - |
| ART-036 | 2026-07-20T05:19:44Z | reference | apps/mobile/src/lib/spaces.test.mjs | f53dfe47524a | implementation-lead | source | Bundle mobile change (apps/mobile/src/lib/spaces.test.mjs) | - |
| ART-037 | 2026-07-20T05:19:44Z | reference | apps/mobile/src/lib/event-days.ts | b3590bc779cd | implementation-lead | source | Bundle mobile change (apps/mobile/src/lib/event-days.ts) | - |
| ART-038 | 2026-07-20T05:20:02Z | reference | .top-gun/runs/run-20260719-232201/audit/evidence/t105-wp001-regression-transcript.txt | 865e04933d88 | implementation-lead | evidence | Live LOCAL-API verification transcript | - |
| ART-039 | 2026-07-20T05:20:02Z | reference | .top-gun/runs/run-20260719-232201/audit/evidence/t202-upload-probe-transcript.txt | 48d7a1f1a4ea | implementation-lead | evidence | Live LOCAL-API verification transcript | - |
| ART-040 | 2026-07-20T05:20:02Z | reference | .top-gun/runs/run-20260719-232201/audit/evidence/t305-wp003-probe-transcript.txt | 95a6800f4c75 | implementation-lead | evidence | Live LOCAL-API verification transcript | - |
| ART-041 | 2026-07-20T05:20:02Z | reference | .top-gun/runs/run-20260719-232201/audit/evidence/t501-hygiene-transcript.txt | c98792245312 | implementation-lead | evidence | Live LOCAL-API verification transcript | - |
