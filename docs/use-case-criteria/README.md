# Use-Case Criteria — Index

This folder holds one criteria doc per FamiliOS use-case (`UC-01.md` … `UC-22.md`), covering all
22 use-cases in the Top Gun catalog. Each doc is **connector-decoupled**: it states the intent, the
exact tool/step contract, and observable acceptance criteria independently of whether the backing
connector is active. The point of splitting them out this way is that any single use-case can be
selectively tested later — against a live connector or against a stubbed contract — without having
to activate connectors that some *other* use-case needs and this one doesn't.

The canonical doc format is `_TEMPLATE.md` in this same folder. Every UC-NN.md follows that
structure: a front-matter block (status / catalog_home / trigger / connectors / tool_ids), an
Intent section with the source Plain English Prompt copied verbatim, a Tool/step contract table,
3-6 observable Acceptance criteria, a two-path Test procedure, and a Not-verified/blocked section.

## Status vocabulary

- **active** — built and locally verified; the backing skill ships and runs through the local
  run engine today. No NOT-IMPLEMENTED banner.
- **active-partial** — built; one sub-step is stubbed pending a connector (the rest of the chain
  is real and verified). No NOT-IMPLEMENTED banner, but the doc calls out which sub-step is stubbed
  and why.
- **inactive** — a documented spec only. Carries the exact `> **NOT IMPLEMENTED — connector
  inactive.**` banner from `_TEMPLATE.md`. No backing skill and no catalog entry ship for it. Never
  claims verification — only a mock/contract path is available until the named connector(s) are
  activated.

## All 22 use-cases

| UC | Name | Status | catalog_home | Primary connector(s) |
|----|------|--------|--------------|----------------------|
| UC-01 | School Correspondence Organizer | active | workflowTemplate | Google |
| UC-02 | Emergency Work-to-Home Forwarder | inactive | workflowTemplate | MS365, Gmail |
| UC-03 | Urgent Slack Escalation | inactive | workflowTemplate | MS365, Slack |
| UC-04 | Grandparent Weekly Digest | inactive | workflowTemplate | MS365 |
| UC-05 | Cross-Calendar Conflict Sync | inactive | workflowTemplate | MS365 |
| UC-06 | Corporate Hold Generator | inactive | workflowTemplate | MS365 |
| UC-07 | Secure Document Cloud Sync | inactive | workflowTemplate | Google, MS365 |
| UC-08 | Secure Archive Builder | inactive | workflowTemplate | Dropbox |
| UC-09 | Database-to-Checklist Pipeline | inactive | workflowTemplate | Notion, Todoist |
| UC-10 | Vacation Project Onboarding | inactive | workflowTemplate | Notion, TickTick |
| UC-11 | Overdue Chore Auditor | inactive | workflowTemplate | Todoist |
| UC-12 | Smart Climate Night-Mode | active (device-runtime-unverified) | workflowTemplate | Google (Google Home) |
| UC-13 | Smart Speaker Dinner Bell | inactive | workflowTemplate | Alexa |
| UC-14 | Morning Status Text | active-partial | workflowTemplate | Weather, RSS/Feed, Text Messaging |
| UC-15 | Family Dashboard API Bridge | inactive | workflowTemplate | Custom HTTP |
| UC-16 | School Menu Data Harvester | inactive | workflowTemplate | Local Files, Browser Automation |
| UC-17 | Smart Recipe Extractor | active | workflowTemplate | Web Search & Reading |
| UC-18 | Digital Memory Scrapbooker | active | skill | FamiliOS (native) |
| UC-19 | Event Coordinator & Logistics Assigner | active | skill | FamiliOS (native) |
| UC-20 | Chore Manager & Document Linker | active | skill | FamiliOS (native) |
| UC-21 | Multi-Channel Meal Planner & Sign-Off Workflow | active | skill | FamiliOS (native) |
| UC-22 | Internal System Sync (Functions) | active | skill | FamiliOS (native/internal) |

Notes on the table:
- Status, connectors, and `tool_ids` for UC-02 through UC-16 (the inactive set) were taken directly
  from each doc's own front matter in this folder.
- `catalog_home` for the active rows (UC-01, 12, 14, 17-22) follows the same categorization
  convention used across the inactive set — `workflowTemplate` for connector-orchestrated
  automations, `skill` for native FamiliOS internal capabilities — and was not independently
  re-verified against each active doc's own front matter as part of this pass.
- UC-12 is marked "device-runtime-unverified": built and locally verified, but not yet confirmed
  against a real physical device runtime.
- UC-14 is "active-partial": the workflow is built and one sub-step is stubbed pending a connector,
  per the status vocabulary above.

## How to run / test a use-case

- **Active / active-partial UCs**: run via the local stack — the backing skill executes through the
  run engine, the same way any other locally verified skill does. For active-partial UCs, the
  stubbed sub-step is called out in that UC's own doc.
- **Inactive UCs**: there is no backing skill or catalog entry to run. Each inactive doc instead
  describes two test paths:
  - an **Active path** — what to do once the named connector is activated (boot the local stack,
    seed TG-prefixed test data, run the skill, inspect the resulting record shape);
  - a **Mock/contract path**, usable today with no live connector — assert the step graph and
    request shape against a stubbed provider `api()`, using the fixture shapes described in that
    doc.

This README does not add new commands beyond what each doc already describes — the two test paths
above are described generically here because the exact stub/fixture shape and unblock action differ
per use-case and are recorded in that use-case's own doc.
