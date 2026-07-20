# Continuing-session prompt for Claude Code

Paste this into the **same** Claude Code session that already ran the FamiliOS Top Gun audit
(run `run-20260719-073933`, currently at the selection gate).

---

Continue this Top Gun session on FamiliOS. Do two things, in order.

**1 — Implement the Full slate on the existing run.**
Resume run `run-20260719-073933` (state: SELECTION_PENDING). My answer to the selection gate is
**option 6 — Full slate (WP-001→005)**. Implement the sequenced slate WP-001 → WP-002 → WP-003 →
WP-004 → WP-005 under the lean-implementation policy and verify each against its own acceptance
criteria. Treat the slate as my final selection — don't pause for another pick.

**2 — Then run a NEW Top Gun mission on the mobile TestFlight feedback.**
Once the Full slate is integrated and verified, start a **new** `/top-gun:top-gun` run seeded by the
package at `testflight-feedback-handoff/HANDOFF.md`. Goal: *"Audit and implement real-user TestFlight
feedback on the FamiliOS native mobile app (`apps/mobile`, ai.familios.app) — the surface the first run
left out of scope."* Treat HANDOFF.md as pre-discovered field evidence (a facts-and-notes seed):
register it with `top-gun:mem`, and as the audit lead's first action download the 13 original
screenshots from the URLs in §3 into the run's `audit/evidence/` (they expire ~2026-07-24). Confirm
every candidate issue in code before acting — especially **TF-008** (cross-user task reassignment / duplicate
help cards) and **TF-012** (medical-ID upload persistence), which need two-account / two-attempt repro.
Carry it through audit → capability-matching → and implement its recommended bundle.

**Guardrails (both runs):** honor the Top Gun mandate — read-only until each selection gate, no
fabricated or partial-as-verified passes, and keep external writes (Google Calendar push, deploy,
publish) gated on explicit per-action approval.

---

### One optional toggle
If you'd rather review the mobile fixes before they're built, change the last line of step 2 to:
*"Carry it through audit → capability-matching and **stop at the numbered selection gate so I can choose.**"*
