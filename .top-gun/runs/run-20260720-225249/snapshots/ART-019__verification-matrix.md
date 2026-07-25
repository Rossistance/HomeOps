# Verification Matrix — Implementation Phase (run-20260720-225249)

Verification in proportion to risk. **blocked / partial / inactive are NEVER reported as pass.** Honest lane per item.

Lanes: LIVE = executed end-to-end in hermetic harness (temp data dir, real server, internal tools run); CONTRACT = step-graph + tool definition + approval-gating asserted (external connector or web egress cannot run in hermetic CI); UNIT = relies on existing executor unit tests.

All active rows verified as of 2026-07-20. Automated evidence: `node --test server/test/usecase-skills.test.mjs` → **10/10 pass**; full suite **362 pass / 0 fail**; both `tsc --noEmit` exit 0.

| UC | Status | Verify lane | What is PROVEN | What is honestly NOT verified | Test file / evidence |
|---|---|---|---|---|---|
| UC-18 Memory Scrapbooker | active | LIVE | write_memory→create_artifact run; real memory row + keepsake artifact row | empty_text guard proven by internal-tools tests, not re-run here | usecase-skills.test.mjs "UC-18" ✓ |
| UC-19 Event Coordinator | active | LIVE | create_event_draft→checklist→driver→what_to_bring; eventId threaded (engine slice); one event, "Pick up ice", driverId m-morgan, ≥1 what-to-bring; all 4 steps succeeded | — | usecase-skills.test.mjs "UC-19" ✓ |
| UC-20 Chore + Doc Linker | active | LIVE | create_task(notes=docref)→create_list_item; task.notes holds policy ref; list item on Weekend; NO attach_note step present | attach_note targets events (documented limitation, not a bug) | usecase-skills.test.mjs "UC-20" ✓ |
| UC-21 Meal Planner + Sign-Off | active | LIVE (core+gate) | plan_meal→draft→create_approval(gate)→notify_contact; meals+groceries+event+draft; parks at sign-off; approved-decision recorded on approval; dispatch passes all registry gates + honest transport truth | real family-contact delivery (no mail/SMS transport connected; honest transport outcome only) | usecase-skills.test.mjs "UC-21" ✓ + notify-contact-delivery.test.mjs |
| UC-22 Internal System Sync | active | LIVE (core) + CONTRACT (gmail step) | write_memory→create_artifact digest composed from real data; every step a real homeops tool_id; NO fake inbox-digest tool | gmail.search enrichment not executed (no connected Google) | usecase-skills.test.mjs "UC-22" ✓ |
| UC-17 Recipe Extractor | active | CONTRACT + UNIT | skill graph web.search→web.read→web.recipe; all Read, no approval; tool_ids resolve in catalog; honest-null covered by web-tools tests | live web egress (CI has none) — end-to-end fetch runtime-unverified | usecase-skills.test.mjs "UC-17" ✓ + web-tools.test.mjs |
| UC-01 School Correspondence | active | CONTRACT | skill graph gmail.search→listLabels→modifyLabels; modifyLabels resolves requiresApproval:true, risk High; step approval_required:true | live Gmail mutation (needs connected account w/ gmail.modify) | usecase-skills.test.mjs "UC-01" ✓ |
| UC-14 Morning Status Text | active-partial | CONTRACT (chain+weather) + LIVE-by-ref (notify) + STUB (rss) | executed chain weather.current→notify_contact; NO sms.send; tool_ids resolve; delivery gates pinned by notify-contact-delivery.test.mjs | live weather fetch (egress); real text delivery; RSS (connector not configured) | usecase-skills.test.mjs "UC-14" ✓ + notify-contact-delivery.test.mjs |
| UC-12 Smart Climate Night-Mode | active (device-unverified) | CONTRACT | skill graph smarthome.listDevices→setThermostat; setThermostat requiresApproval:true; SDM SetHeat/heatCelsius 20 + fail-closed covered by smart-home-providers tests | **runtime-device-unverified** — no physical Nest + HOMEOPS_SDM_PROJECT_ID unset (fail-closed) | usecase-skills.test.mjs "UC-12" ✓ + smart-home-providers.test.mjs |
| UC-02..11,13,15,16 (13 inactive) | inactive | NONE (spec only) | criteria doc exists w/ real tool_id chain (connected:false) + NOT-IMPLEMENTED banner | everything runtime — connector not activated | docs/use-case-criteria/UC-*.md |
