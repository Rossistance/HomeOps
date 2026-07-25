# Facts and Notes — Mission Handoff — run-20260723-143314

- Run: run-20260723-143314
- Goal: Convergent-360 audit + brownfield PRD synthesizing three Jam recordings (7b44f45c iOS calendar,
  7631fa90 web control plane, 34ef54ca web runtime) with the 29 base triage tickets, the 9 addendum
  tickets (BUG-030..038), ChatGPT's independent RC-1..10 / HO-001..012 analysis, and the prior mission's
  ISS-001..018 registers.

## Mission and boundaries

- **Scope:** synthesis audit (DEC-101) + brownfield PRD. Read-only on product source, production data,
  and remote systems.
- **Success criteria:** all registers populated and validated; PRD traceable to evidence; numbered menu
  with one recommended bundle; selection question asked.
- **Non-goals:** implementation (requires S5 selection), production writes, deploys, external sends,
  visual redesign.
- **Authority boundary:** no product-source changes were made. Only
  `.top-gun/runs/run-20260723-143314/` and `docs/` were written.

## Observed facts (this run)

- Baseline @ HEAD `711f56c`: `npm test` 549 tests / 548 pass / 0 fail / 1 honest skip; `npm run
  typecheck` exit 0 (EV-115, EV-116).
- Production serves the shipped code (`sqlite-fts5` memory backend, `browserRuntime:false`) — EV-122.
- **10 source confirmations** recorded as EV-105…EV-114 and EV-121. The three load-bearing ones:
  `orchestrator.mjs:126` (null acting agent), `useStore.ts:2234` + `workflowTemplates.ts:149,882`
  (decorative multi-agent claims), `render.yaml` vs the migration report (production data never migrated).
- Two triage claims **corrected** by inspection: `toggleAutomation` is a pure write and
  `createAutomation` does not auto-run (EV-113/114) → BUG-033 superseded by ISS-116.

## Supported inferences

- The prior mission's ISS-018 fix was scoped to chat + "Run now", leaving skill/template/automation paths
  unprotected — same bug class, wider blast radius (basis: EV-105 vs that mission's WP-002/003 scope).
- Migrating production before idempotency exists will re-fill the catalog (HYP-108) — basis for DEC-104.

## Unknowns and open questions

HYP-101…HYP-108 in `audit/hypothesis-queue.md`. Sharpest first: HYP-101 (one API call splits three
possible causes of the invisible-created-event bug) and HYP-105 (Part 1's recording is only ~9% covered
by structured extraction — may be hiding defects).

## Authority and safety limits

- Hot-WAL rule in force: never open a live tenant DB from a second process.
- Production data operations (WP-102) require the production tenant ID **and** explicit S8 authorization.
- CodeRabbit CLI unavailable (`command not found`) — static-analysis pass not performed.

## Capability inventory summary

**Used:** Jam MCP, Read/Grep, Bash, computer-use (read the owner's ChatGPT window), zip extraction, mem +
convergent-360 scripts. **Unavailable:** CodeRabbit CLI. **Not needed this run:** Playwright, subagent
fan-out (DEC-101).

## Artifact links

Registered this run: facts handoff, evidence ledger, issue register, product-intent register, decision
log, hypothesis queue, architecture/authority map, functionality inventory, implementation queue, master
report.

## Next discriminating checks

1. HYP-101 — create an event in-app, then `GET /api/events` (splits ISS-105's three causes).
2. HYP-102 — read the delete handler for a `provenance.googleEventId` branch (proves ISS-106 statically).
3. HYP-104 — count production skills lacking `defaultAgentId` (sizes ISS-102's blast radius).
4. HYP-105 — re-split Jam Part 1 into <10-minute segments and re-run intent extraction.
