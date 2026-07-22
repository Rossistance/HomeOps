# Numbered Implementation Menu — run-20260721-054151

Every item maps to work packages in audit/work-packages.md (evidence and acceptance criteria there). Effort: S/M/L/XL.

| # | Item | What you get (user value) | Scope (WPs) | Depends on | Risk | Effort | Leverage | Key evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | The Inbox tells the truth | Approvals and agent notices actually appear in Messages & Approvals, with badges; parked runs are decidable and stop dying silently | WP-001 | — | Low | M | Very high — unblocks every gated task | EV-004,EV-005,EV-032 |
| 2 | "Done" means done | Summaries never claim delivery for drafts; plain chat asks can deliver at least in-app with zero setup | WP-002 | 1 | Med | M | Very high — kills the false-success class | EV-032§3 |
| 3 | One run history everywhere | Chat, agent, and scheduled runs share one history and correct status labels; no double-run buttons; clean thread order | WP-003 | 1 | Med | L | High | EV-011,EV-009,EV-003 |
| 4 | Every result has a home | A tasks surface + run artifacts in Files & Knowledge + "View task/draft" links from chat results | WP-004 | 3 | Low | M | High | EV-015,EV-019 |
| 5 | Helper Agents unification (redesign A) | ONE surface for helpers packaged with their skills/automations/tools; builders demoted to Advanced; 51 fragments migrated to packages | WP-005 | 1,3 | High | XL | Very high (product clarity) | EV-007..026,EV-031 |
| 6 | Orchestration harness to the 22-use-case bar (redesign B) | Single orchestration entry with agent attribution + the 22 use-cases as an executable UI benchmark suite (sandbox for OAuth-gated ones) | WP-006 | 1-4 | High | XL | Very high (reliability proof) | journey-register UC table |
| 7 | Memory brain: Supermemory + LM Studio (redesign C) | Local retrieval-grade memory (search + profiles) wired into planning; LM Studio token fix so Qwen3.6-27B works at all | WP-007 (incl. ISS-006 fix) | 6(s2) recommended | Med | L | High | EV-035,EV-036 |
| 8 | Improvements made reviewable | Diff + one-click revert for every AI self-change; auto-apply off by default | WP-008 (UI/safety part) | — | Med | M | Medium | EV-031,EV-013 |
| 9 | OPT-IN: Improvements safe wipe (backup-first) | Full tenant backup → dry-run report of all 21 evolution records → selective revert of the 15 auto/accepted instruction rewrites to their pre-apply versions → archive (never delete) the records → printed diff; rollback = restore backup | WP-008 (wipe part) | 8 recommended | Med (data surgery, fully reversible) | M | Medium — removes the "did improvements break it?" uncertainty | EV-031, DEC-015 |
| 10 | Calm the sync storm | ~660 req/min idle → ≤6; visibility-aware backoff; changes still land ≤5 s | WP-009 | 1 | Low | M | Medium | EV-030 |
| 11 | Family roles work on web | Profile switch scoped to YOUR household; child sessions usable; resident-name privacy flag | WP-010 | — | Med | M | Medium | EV-027,EV-025 |
| 12 | Trust & lifecycle polish | Plain-language activity feed; connector-parked runs expire honestly with an Inbox notice; resident stuck-runs cleanup proposal | WP-011 | 1 | Low | S-M | Medium | EV-012,EV-031 |
| 13 | Connector provisioning for the 13 gated use-cases | Setup checklists per provider + sandbox test mode; real Microsoft/Slack/Dropbox/Twilio/device UCs become configurable | WP-012 | 6(s3) | Low code / external deps | M + user provisioning | Medium | EV-020 |

## Recommended bundle — "One task, truly done" (items 1 + 2 + 3 + 4)

The smallest coherent vertical that makes the user's own success criterion pass: ask → run → approval visible and decidable in the Inbox → honest completion → visible, linked result. It directly closes ISS-001/002/003/004/005/008/009/011 (every P0 and most P1s), is flag-gated and reversible, and creates the foundation the three redesigns (items 5, 6, 7) build on. Suggested follow-on order after the bundle: 6 → 7 → 5, with 8+9 whenever you want the improvements question settled, and 13 when you're ready to provision real OAuth apps.

Which numbered improvement, feature, or recommended bundle should I implement now?
