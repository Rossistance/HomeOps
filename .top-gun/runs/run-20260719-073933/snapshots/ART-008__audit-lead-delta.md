# Agent Delta — Audit Lead

- Run: run-20260719-073933 · Agent: audit-lead · Phase: AUDIT (S0–S4 + S5-prep) · Date: 2026-07-19 (UTC)

## What I concluded

FamiliOS is a strong, design-led, honesty-first local-first family OS whose core trust promise is mostly kept (honest connector readiness, real approval gates, deterministic local engine) but is broken at its highest-stakes moments. I found and registered 11 issues:

- **P0 ISS-001** — `npm test` corrupts the live `server/.data` and wedges a running backend into `disk I/O error` 500s. Found, root-caused (in-process store import bypasses harness isolation), and RECOVERED during the run (surgical backend restart; DB intact).
- **P1 ISS-002 / ISS-003 / ISS-003b** — first-run onboarding silently swallows total backend failure; locally-created and sample households are orphaned/dead-ended at a stranger's lock on any claimed server.
- **P1 ISS-004** — headline "Ask FamiliOS" chat dead-ends without an AI provider though a working no-provider engine exists in the Workflow Builder.
- **P2 ISS-005/006/007/008/009** and **P3 ISS-010** — rules-engine trigger detection; flagship Weather tool hollow-success; incoherent Node version + no render.yaml Node pin; CI blind to the P0; unauthenticated roster PII exposure; unused react-router-dom.

Deliverables complete: all 9 audit registers populated (marker lines removed), master report (25 sections, 5 personas, 5 journeys, numbered menu + Recommended bundle + exact selection question in §21), 5 work packages, decision log (6), hypothesis queue (6), evidence ledger (EV-100..143), 8 inspected screenshots in evidence.

## What I could not verify (honest)

- Only **1 of 5** personas (Maya) executed a live end-to-end journey. Personas 2–5 (populated-data power use; child/grandparent/sitter role-gating; admin invite mgmt) were **blocked at runtime** by the claimed-resident-tenant state (the ISS-003 family), which prevents minting non-owner/other-tenant sessions against the running server. Role-gating is code-verified (EV-139), not runtime-rendered. Unblock: an UNCLAIMED server (fresh `server/.data`) or a seeded multi-role roster.
- Production/source parity unresolved — no deployed Render URL probed (HYP-006).
- Exact Open-Meteo upstream trigger for the weather hollow-success (HYP-003); the code-gap root cause is confirmed regardless.
- No full WCAG pass, no performance profiling, no zoom/short-height responsive; ~42/82 features pending on budget (all reachable, named in the coverage block).

## Coverage (honest)

```
Execution coverage: 40/82 = 49%
Verified coverage:  24/82 = 29%
Persona coverage:   40/82 = 49%
```

## Disagreements / preserved contrary evidence

- Weather "hollow success" could be read as the README's documented sandbox no-egress case; I rejected that (host egress works, EV-135; sibling executors map provider_error, EV-136) and kept it as a code defect. Preserved both readings in DEC-005/HYP-003.
- The ISS-003 family may be entirely claimed-server-specific (would work on a fresh server); I preserved that as HYP-001 rather than asserting the issues affect every deployment — but the symptoms are real on any claimed server, which is every real deployment.

## Environment actions taken (disclosed)

- Restarted ONLY the wedged backend (PID 32104, identical cmdline) in background after ISS-001; Vite untouched (DEC-001). Backend healthy post-restart (EV-122).
- Created local app state through normal product use (a household, an agent, an automation, a weather read) — permitted by the authority boundary. Reset sample data once (permitted). No product source, git, secrets, or `.claude/launch.json` touched.

## Budget consumed vs plan

~180k / 500k output-token soft budget (~36%). Well within plan. No nested agents spawned (Agent tool available but separated-pass mode used per mandate; disclosed). Reserve intact.

## Blockers with exact unblock conditions

- None hard. The role-gating runtime journeys (personas 2–5 distinct paths) are blocked by the claimed-server state; unblock = point `HOMEOPS_DATA_DIR` at a fresh dir (or seed a multi-role roster) and rerun. This is a follow-up depth item, not a gate on the audit deliverable.
