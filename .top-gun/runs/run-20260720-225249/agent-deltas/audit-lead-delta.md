# Agent Delta — Audit Lead (run run-20260720-225249)

Single audit-lead agent. Convergent-360 states S0–S4 complete; S5 selection question posed (master-report §21). Audit-stage validator: PASS. No product code written (read-only per mandate).

## Outcome

Validated BUILD PLAN for the 22 source use-cases. **Confirmed the 9 active / 13 inactive split from ART-001**, grounded in the real FamiliOS tool catalog, with four code-based corrections. Baseline health green (352 server tests, web + mobile tsc clean).

## Key findings (with evidence)

1. **Two-layer template model (DEC-001, the load-bearing finding).** `AgentTemplate`/`WorkflowTemplate`/`Playbook` (src/data/*.ts) are DECLARATIVE — display strings, no executable tool ids (EV-001/002/003). The runnable, verifiable unit is a **Skill** whose `steps[].tool_id` match `planner.mjs` `toolCatalog` (EV-010/011). Every active use-case must ship as catalog entry **+** backing skill.
2. **Authoritative tool-id inventory** captured from providers.mjs (EV-007), connectors.mjs (EV-008), internal-functions.mjs (EV-009). Active tool ids: gmail.search/listLabels/modifyLabels/send, calendar.list/create, drive.list, smarthome.listDevices/setThermostat, weather.current, web.search/read/recipe, sms.send, webhook.received, file.import, 13× homeops.*. Inactive: MS365/Slack/Dropbox/Notion/Todoist/TickTick/Alexa/RSS/Custom HTTP/Browser tool ids.
3. **Four corrections to ART-001 (journaled events #8):**
   - UC-12: smarthome tools are build-ready at the contract level but **device-runtime-unverified** — need `HOMEOPS_SDM_PROJECT_ID` + a physical Nest (EV-018, ISS-004).
   - UC-14: **active-partial** — weather+text verifiable; RSS stubbed; unattended delivery must use `homeops.notify_contact`, NOT `sms.send` (approval expiry), per the shipped WP-005 design (EV-021, ISS-003, DEC-005).
   - UC-20: `attach_note_or_file_reference` targets **EVENTS not tasks** (EV-019, ISS-001) — embed the doc reference in `task.notes` instead; documented limitation.
   - UC-22: **"recent inbox digest" internal function does NOT exist** (EV-020, ISS-002) — ART-001 §Capability overstated the internal catalog. Compose the digest from write_memory + gmail.search/reasoning + create_artifact.
4. **Delivery constraints:** live-record seeding on production is scripted-mutation-blocked (EV-017, ISS-006) → local `materializeBuild` for verification; prod seeding is UI/user-side (DEC-006). Engine drift node 25.8.2 vs engines `<25` is advisory only (EV-022, ISS-008).
5. **Opportunities preserved (ISS-007):** UC-04/07/11 have trivially-active native/Google variants; offered as optional add-on (menu Option 7), source items kept honestly inactive.

## Artifacts produced (all under audit/)

- master-report.md (25 sections, 22-row mapping, criteria-doc format spec, 5 personas + journeys, PRD, numbered menu + recommended bundle)
- functionality-inventory.md (22 FEAT rows + trace matrix + coverage: exec 22/22, verified 0/22, persona 22/22)
- implementation-queue.md (13 WPs: 9 active builds, 1 inactive-set spec WP, criteria-scaffold, harness, deploy/TestFlight)
- issue-register.md (8), decision-log.md (7), hypothesis-queue.md (6), evidence-ledger.md (22), product-intent-register.md (10), architecture-authority-map.md

## Criteria-doc format decision (DEC-003)

`docs/use-case-criteria/` — one file per UC (UC-01..22) + `_TEMPLATE.md` + `README.md`; front-matter (status/home/trigger/connectors/tool_ids) + intent (verbatim) + tool/step contract table + observable acceptance criteria + connector-decoupled test procedure (active real-run path + inactive mock/contract path) + not-verified/blocked with exact unblock. Lets the user selectively test later WITHOUT inactive connectors.

## Recommended bundle

"Full mission" (menu Options 1+2+3+4+5+6): build+verify the 9 active use-cases, deliver all 22 criteria docs (13 inactive as labeled specs), commit/push/deploy + TestFlight. Sequence WP-011 → WP-013 → WP-003..007 → WP-002 → WP-001 → WP-008 → WP-009 → WP-010 → WP-012.

## Blockers / unblocks

- UC-12 live device verification — unblock: set `HOMEOPS_SDM_PROJECT_ID` + connect a Nest. (Contract-level verification available now.)
- UC-14/UC-21 live delivery test — unblock: create a verified TG- contact method + agent allowlist on the local stack.
- Live prod seeding — unblock: user runs the UI/seed path (scripted prod mutation blocked).
- WP-012 deploy + TestFlight — unblock: explicit user authorization (S8).

## Validators

- validate_audit --stage audit: **OK (0 warnings)**.
- validate_memory: see event journal / return.
