# Matching Lead — Delta

- Run: run-20260720-225249
- Agent: matching-lead
- Phase: MATCHING_RUNNING
- Outcome: **COMPLETE** — capability-task matching guide produced and validated; all 13 WPs routed for the full pre-selected mission. Both validators PASS.

## Outputs
- `matching/capability-task-matching.md` (ART-012, snapshot sha256:b65cc6fb4439) — the routing guide.
- This delta.
- Journal events #22 (inventory checkpoint) and the return event.

## Validation (verbatim)
```
=== validate_matching ===
OK: matching guide valid (0 warning(s)).
EXIT=0
=== validate_memory ===
OK: memory valid (0 warning(s)).
EXIT=0
```

## Capability deltas vs ART-001
1. "recent inbox digest (internal)" tool does NOT exist (ISS-002/EV-020) — UC-22 composes the digest; routed as such.
2. `tests/topgun/runtime-drivers.json` present; native drivers appium/appetize BLOCKED (no cloud creds); playwright-web `use now`. Native lane closed (DEC-10) — no mission effect.
3. NODE_EXTRA_CA_CERTS is UNSET this session — must be exported before the WP-012 EAS build or it fails TLS.
4. engines.node `>=22.13 <25` vs runtime 25.8.2 confirmed (ISS-008) — advisory; optional widen in WP-012.
5. product-management:write-spec + design:* skills AVAILABLE — matcher context gate satisfied (offline; no Figma/tracker connectors).
6. EAS MCP (933a786f build_run/build_submit) loadable as a WP-012 fallback to the proven CLI (auth state unverified — no auth triggered).

## Highest-leverage routing decisions
- **Shared-catalog single-writer control**: `catalogIds.ts`, `agentTemplates.ts`, `workflowTemplates.ts`, `playbooksCatalog.ts` are appended by every active build → the implementation lead owns them; subagents author only their isolated skill file + criteria doc and return a catalog-patch spec the lead applies serially. This is the collision control that lets the 9 active builds parallelize safely.
- **Wave plan**: Wave 0 foundation (WP-011 ∥ WP-013, disjoint surfaces) gates all; Wave 1 clean active builds (WP-002/003/004/009) ∥ WP-010 inactive docs; Wave 2 correction-heavy (WP-001/005/006/007/008, WP-006/008 after WP-013 for TG- method); Wave 3 ship (WP-012, serialized, S8-gated).
- **Model/effort**: sonnet/medium for clean single-surface builds + inactive docs; sonnet/high for the correction-heavy builds (paired with a real runSkill artifact as the evidence gate); opus/high inline (lead) for WP-013 harness (real-tenant blast radius) and WP-012 ship (release + S8).
- **Verification lane**: all active items verify server-side via the WP-013 local harness (runSkill / scheduled-run / mocked-provider contract), NOT UI/Playwright — the mission's truth is skill execution, not rendering.

## Blockers (with exact unblocks) — for the implementation lead to honor
- **WP-012 requires explicit S8 user authorization** (push/deploy/TestFlight) before execution. If withheld, the mission stops at "built + locally verified, not shipped."
- **NODE_EXTRA_CA_CERTS unset** → export it before the EAS CLI call.
- **Scripted prod mutation blocked** → live seeding is UI/user-side (DEC-006); local materialize is the contract proof.
- **10 connectors + RSS blocked**, **physical Nest + HOMEOPS_SDM_PROJECT_ID absent** → WP-010 spec-only; UC-14 RSS stubbed; UC-12 device-unverified. Unblocks named per-row in the guide's Unavailable Capability Effects table.

## Assignments the implementation lead MUST revalidate at execution time (drift-prone)
1. Re-run `npm test` (baseline 352/green) + both tsc (exit 0) after booting the stack — the guide asserts baseline from a prior probe.
2. Re-probe local-stack boot (`scripts/dev.mjs`, node 25.8.2) before the first active build.
3. Confirm each active UC's exact tool_ids still exist in `server/skills.mjs`/`internal-functions.mjs` before wiring (esp. the UC-20 attach and UC-22 digest corrections).
4. Re-confirm NODE_EXTRA_CA_CERTS + Render/EAS auth at WP-012.
5. If sonnet subagents show underpowered signals on the correction-heavy WPs (fake tool_id, mis-threaded eventId, sms.send on unattended path) → upgrade effort/respawn on opus and update the guide's Model Rationale.

## Budget consumed (matching-lead task)
- Planned: 120k soft. Consumed: ~48k output tokens (inventory probes + one gate-skill pass + guide authoring + 2 validation cycles). Well under budget; no reserve drawn.
