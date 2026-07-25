# Facts and Notes — Mission Handoff

- Run: run-20260720-225249
- Goal: Build the 22 use-case agents/automations from `source-use-cases.txt` as FamiliOS templates — fully implement + verify the ACTIVE-connector items (as code templates AND live seed records), stub the INACTIVE-connector items as documented specs, save per-item success/test criteria to the project folder, then commit/push/deploy + start a new TestFlight build.

## Mission and boundaries

- User directive (this session), in order: (1) fix the 7 AM briefing schedule via the gmail.send path + clean up duplicate CONTACTS and TRIGGERS only (leave agents/skills) — **live-account UI work, handled outside this run's code scope**; (2) THIS run — build all 22 use-cases; (3) per-item success/test criteria saved for future selective testing without requiring inactive connectors.
- Build target = **BOTH** (user choice): ship as code templates in the repo catalog AND seed the active-connector ones as live records on the account.
- Verification = **only active-connector items now** (user choice): fully build + verify the active ones; the inactive ones become documented specs + test criteria, NOT full implementations, until their connectors exist.
- Success = active-connector use-cases implemented as catalog templates and verified end-to-end on the local stack; every use-case (active + inactive) has a saved success/test-criteria doc under a project folder; code committed/pushed/deployed; new TestFlight build submitted. Honest labeling throughout — inactive items are never claimed as verified.
- Non-goals: activating new connectors (MS365/Slack/Dropbox/Notion/Todoist/TickTick/Alexa/RSS/Custom HTTP/Browser Automation) — user wires those later; native iOS visual verification (DEC-10 lineage, closed); live sends to real family contacts beyond the already-consented wrhixon@gmail.com; the #1 live rewire/cleanup (UI, out of this code run).

## Observed facts (this session, production + repo)

- **Existing template architecture (ships in-product):** `src/data/agentTemplates.ts` (12 templates today), `src/data/workflowTemplates.ts`, `src/data/playbooksCatalog.ts`, `src/data/catalogIds.ts`, `src/data/seed.ts`; server skill/tool catalogs `server/skills.mjs`, `server/internal-functions.mjs`, `server/functions.mjs`. New use-cases extend these.
- **Live connector inventory (production /api, this session):** connected = Google (scopes: gmail.read/send/modify, calendar, drive, smarthome), Weather, Webhook Receiver, Local Files (local-only), Web Search & Reading, Text Messaging. From the agent Connections panel: Microsoft 365 = "Setup by admin" (INACTIVE), Slack/Dropbox/Notion/Todoist/TickTick/Amazon Alexa = "Setup by admin" (INACTIVE), RSS/Feed = "not configured", Custom HTTP = "not configured", Browser Automation = "runtime unavailable".
- **FamiliOS-native tools available (server):** homeops.write_memory, create_artifact, create_event_draft, update_event_checklist, assign_driver, assign_what_to_bring, create_task, create_list_item, attach_note_or_file_reference, plan_meal, notify_contact, send_notification_draft, create_approval; internal functions (note-to-memory, recent inbox digest).
- **Google sub-tools observed on the agent tool picker:** Search inbox, List Gmail labels, Label/move messages, Send email, List events, Create event, List recent files, List Google Home devices, Set thermostat.
- **Prod is on the deployed fix** (bundle index-ZUIIUwK0.js = HEAD dc29b26→ee7bb93 lineage); the Ask Famili false-success fix and the calendar-duplication fix are LIVE (prior run run-20260720-073025, COMPLETE).
- **Live-account mutation is guardrail-blocked for scripted changes** (classifier denied javascript_tool POST/PATCH/DELETE against production). Live-record seeding + the #1 rewire must go through the app UI, not scripts.

## Supported inferences — connector classification of the 22 (audit lead must verify)

ACTIVE (fully build + verify now):
- #1 School Correspondence Organizer (Google inbox+labels)
- #12 Smart Climate Night-Mode (Google Home; device-verify limited — no real thermostat in loop)
- #14 Morning Status Text — PARTIAL: Weather+Text active, RSS inactive → build with the RSS step optional/stubbed, verify weather+text path
- #17 Smart Recipe Extractor (Web Search & Reading)
- #18 Digital Memory Scrapbooker (FamiliOS write_memory+artifact)
- #19 Event Coordinator & Logistics Assigner (FamiliOS event/checklist/driver/what-to-bring)
- #20 Chore Manager & Document Linker (FamiliOS task/list/attach)
- #21 Multi-Channel Meal Planner & Sign-Off (FamiliOS plan_meal/notify/sign-off)
- #22 Internal System Sync (internal functions)

INACTIVE (spec + test criteria only, no full impl): #2 (MS365), #3 (MS365+Slack), #4 (MS365), #5 (MS365+Google), #6 (MS365), #7 (Google Drive+OneDrive), #8 (Dropbox), #9 (Notion+Todoist), #10 (Notion+TickTick), #11 (Todoist), #13 (Alexa), #15 (Custom HTTP), #16 (Local Files+Browser Automation).

Basis: live connector readiness probed this session; per-use-case tool lists from the source doc. The audit lead must reconfirm each mapping against the actual FamiliOS skill/tool catalog and flag any active item whose specific sub-tool is missing.

## Unknowns and open questions

- Exact template SHAPE the catalog expects (agentTemplates entry schema, workflowTemplates schema, how a template declares required tools/skills/trigger) → audit lead reads the 12 existing templates and derives the contract.
- Whether "automation" vs "agent" vs "skill" is the right catalog home for each use-case → depends on trigger/tool shape; audit lead decides per item.
- Where to save the success/test-criteria docs → propose `docs/use-case-criteria/` (durable + committed, "in the project folder for future use").
- Whether the "live seed records" half of BOTH can be done given the scripted-mutation block (may require UI or a seed script the user runs) → flag as a delivery constraint.
- Google Home / thermostat verification without a physical device → verify tool-call contract + mocked device, label runtime-device-unverified.

## Authority and safety limits

- Repo: full read/write/execute within mission scope.
- Local dev stack: boot via scripts/dev.mjs (node 25.8.2 at C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2) for verification; the local tenant holds REAL family data — TG- prefix any test records, clean up, prefer isolated harness servers.
- Production: /api/health + build-identity only; NO scripted live mutations (guardrail); live-record seeding is UI/user-side.
- No new-connector activation; no live external sends except already-consented wrhixon@gmail.com; native iOS visual lane closed (DEC-10 lineage).
- Deploy: commit/push auto-deploys to Render (verified working this session). TestFlight: `eas build -p ios --profile production --auto-submit` with NODE_EXTRA_CA_CERTS set (see memory windows-tls-and-cli-environment).

## Capability inventory summary

- use now: full local toolchain (node 25.8.2, npm test suite, tsc both apps), local stack, Playwright web lane (green this session), git push + auto-deploy (verified), EAS build (build 21 shipped this session), read-only production API via authenticated browser tab.
- use if needed: server fakeProvider harness for engine/skill verification; Chrome MCP for UI (fragile — renderer freezes observed); Gmail MCP (budgetbeacon.ai@gmail.com — cannot observe wrhixon inbox).
- unavailable/blocked: scripted live-account mutation (classifier); MS365/Slack/Dropbox/Notion/Todoist/TickTick/Alexa/RSS/Custom-HTTP/Browser-Automation connectors; native iOS visual verification.

## Artifact links

- source-use-cases.txt (this run) — the 22 use-cases, verbatim.
- Prior-run lineage (historical): run-20260720-073025 (Ask Famili fix, COMPLETE) — the deployed base this builds on.

## Next discriminating checks (for the audit lead)

1. Read the 12 existing `agentTemplates.ts` entries + `workflowTemplates.ts` + `playbooksCatalog.ts` to derive the exact template contract (fields, tool/skill declaration, trigger shape).
2. Cross-check each ACTIVE use-case's required sub-tools against `server/skills.mjs`/`internal-functions.mjs`/connectors — confirm each tool id actually exists; downgrade any item whose tool is missing.
3. Produce the build queue: per use-case → catalog home (agent/automation/skill), FamiliOS skill/tool mapping, active|partial|inactive, acceptance criteria, and the success/test-criteria doc stub.
4. Define the criteria-doc format + folder once, applied to all 22.
5. Boot the local stack; baseline `npm test` + both tsc before any build.
