# Implementation Queue — Work Packages

Orchestrator-ready packages for building the 22 use-cases. Per DEC-001 each ACTIVE item ships a declarative catalog entry (agent/workflow/playbook, with a new id in `src/data/catalogIds.ts`) **and** a backing executable Skill whose `steps[].tool_id` are the exact catalog ids below (EV-010). Every ACTIVE item also gets a criteria doc at `docs/use-case-criteria/UC-NN.md` (DEC-003). Sequence: WP-011 (criteria scaffold) → WP-013 (harness) → WP-001..009 (active builds) → WP-010 (inactive specs) → WP-012 (ship). Audit is read-only; no product code is written until the user selects a scope.

---

## WP-011 — Criteria-doc format + folder scaffolding (all 22)

- Objective: Create `docs/use-case-criteria/` with `_TEMPLATE.md`, `README.md`, and 22 stub files (UC-01…UC-22), so criteria are durable, per-item, and selectively testable WITHOUT inactive connectors.
- Issue/Feature IDs: DEC-003; all FEAT-001..022.
- Rationale: The user wants saved success/test criteria for future selective testing; format must be connector-decoupled.
- User/architecture outcomes: A committed, reviewable acceptance spec per use-case; the executable half for active items lives in the skill's `test_cases[]`.
- Affected files: `docs/use-case-criteria/**` (new).
- Implementation steps: (1) Write `_TEMPLATE.md` (format in master-report §"Criteria-doc format"). (2) Write `README.md` (index + how to run active vs mock inactive). (3) Generate 22 stubs from the mapping table.
- Design/content direction: Markdown; YAML-ish front-matter (status, catalog home, trigger, connectors, tool_ids) + sections: intent (verbatim prompt), tool/step contract table, acceptance criteria (observable), test procedure (active real-run path + inactive mock/contract path), not-verified/blocked with exact unblock.
- State/API/data implications: none (docs only).
- A11y/responsive/security/perf: n/a.
- Dependencies: none (do first).
- Acceptance criteria: 25 files exist; `_TEMPLATE.md` renders; each UC file names its exact tool_ids and its connector status.
- Focused validation: file presence + a lint that every active UC lists only real tool_ids.
- Risk: low.
- Rollout/rollback: additive docs; delete folder to roll back.
- Recommended sequence: 1st.

---

## WP-013 — Local verification harness + TG- seed/cleanup + materialize contract

- Objective: Establish the safe local verification path used by all active WPs: boot `scripts/dev.mjs` (node 25.8.2), an Adult-Admin session, TG- prefixed test data, and a `materializeBuild` smoke (HYP-004), with guaranteed cleanup.
- Issue/Feature IDs: ISS-006; HYP-004; PI-08.
- Rationale: The local tenant holds REAL family data; verification must isolate + clean up; prod live-seed is scripted-blocked so local materialize is the contract proof.
- User/architecture outcomes: Every active skill can be run + inspected locally without touching production or real contacts.
- Affected files: test harness scripts under a run-local dir (not product source unless the user wants a committed `scripts/seed-usecases.mjs`).
- Implementation steps: (1) Boot local stack + baseline (already green: EV-014/015/016). (2) Create TG- space/members/contact-method fixtures. (3) POST a minimal UC-18 build spec to `/api/assistant/build`; confirm skill(draft)+agent; delete TG- records. (4) Provide a reusable run+cleanup helper.
- State/API/data implications: creates + deletes TG- records only.
- Dependencies: WP-011.
- Acceptance criteria: local stack boots; materialize smoke returns created ids; all TG- records removed after; no real family record touched.
- Focused validation: pre/post record counts equal for non-TG data.
- Risk: medium (real tenant) — mitigated by TG- prefix + cleanup + isolated harness.
- Rollout/rollback: harness only.
- Recommended sequence: 2nd.

---

## WP-001 — UC-01 School Correspondence Organizer (ACTIVE)

- Objective: Weekday-morning automation that finds school-district mail, reads the label set, and moves it out of the primary inbox.
- Issue/Feature IDs: FEAT-001.
- Rationale: Flagship active item; all-Google, all connected.
- User/architecture outcomes: Adult sees school mail auto-filed; approval gate on the label/move write.
- Affected files: `src/data/workflowTemplates.ts` (+ `catalogIds.ts`) new workflowTemplate; a backing Skill (materialized/seed) ; `docs/use-case-criteria/UC-01.md`. Catalog home: **workflowTemplate + skill** (agent optional via existing School & Daycare Agent).
- Implementation steps (vertical slices): (1) catalog entry (trigger Schedule, requiredConnections ["Gmail"]). (2) Skill steps: `gmail.search` (query e.g. `from:(schools) newer_than:1d`) → `gmail.listLabels` → `gmail.modifyLabels` (addLabels "School", removeLabels "INBOX", requiresApproval). (3) criteria doc.
- Design/content: reuse School Email Triage playbook tone.
- State/API/data: mutates Gmail labels on the account; approval-gated.
- Security/approval: `gmail.modifyLabels` requiresApproval=true (High) — never auto-send.
- Dependencies: WP-011, WP-013; Google gmail.read+modify (active).
- Acceptance criteria: given ≥1 school message, the skill returns `{modified≥1, added:["School"], removed:["INBOX"]}`; non-school mail untouched; approval required before the write; honest typed error if scope missing.
- Focused validation: local `runSkill` against a test Gmail (or mocked provider api()); HYP-001.
- Risk: medium (real Gmail write) — use a test account.
- Rollout/rollback: additive template; disable automation to roll back.
- Recommended sequence: 3rd. Criteria doc: `docs/use-case-criteria/UC-01.md`.

---

## WP-002 — UC-17 Smart Recipe Extractor (ACTIVE, clean)

- Objective: On-demand skill: search the web, read the top result, extract a clean recipe.
- Issue/Feature IDs: FEAT-017.
- Affected files: Skill; catalog entry (skill or workflowTemplate, Manual trigger); `docs/use-case-criteria/UC-17.md`. Catalog home: **skill**.
- Implementation steps: Skill steps `web.search` (query) → `web.read` (best url) → `web.recipe` (url). All Read, no approval.
- Acceptance criteria: returns `{recipe:{ingredients[], instructions[], source}}` with ads stripped; honest error if no structured recipe found (matches recipeFromHtml null path, EV-014).
- Focused validation: local `runSkill` against a known recipe URL; server test already covers extraction.
- Dependencies: WP-011; Web (active). Risk: low. Sequence: 4th.

---

## WP-003 — UC-18 Digital Memory Scrapbooker (ACTIVE, clean)

- Objective: Log weekend highlights/photos to the family journal and compile a keepsake artifact.
- Issue/Feature IDs: FEAT-018.
- Affected files: Skill; catalog entry; `docs/use-case-criteria/UC-18.md`. Catalog home: **skill**.
- Implementation steps: `homeops.write_memory` (text, scope "family") → `homeops.create_artifact` (title, body, kind "keepsake"/"report").
- Acceptance criteria: a memory row + an artifact row are created and returned with ids; empty text is refused (empty_text guard).
- Focused validation: local `runSkill`; inspect memory + artifact. Dependencies: WP-011. Risk: low. Sequence: 5th.

---

## WP-004 — UC-19 Event Coordinator & Logistics Assigner (ACTIVE, clean)

- Objective: Draft a family event, build its checklist, assign a driver and what-to-bring.
- Issue/Feature IDs: FEAT-019.
- Affected files: Skill; catalog entry; `docs/use-case-criteria/UC-19.md`. Catalog home: **skill** (Adult Admin).
- Implementation steps: `homeops.create_event_draft` (title "Family Reunion Picnic", startAt) → **thread returned eventId** → `homeops.update_event_checklist` (items incl. "Pick up ice") → `homeops.assign_driver` (eventId, driverId) → `homeops.assign_what_to_bring` (eventId, items).
- Design/content: driver/participants must be real member ids from the household.
- Acceptance criteria: one event draft with a checklist containing "Pick up ice", a driverId set, and ≥1 what-to-bring item — all on the same eventId; `event_not_found` if the id is not threaded (the key correctness risk).
- Focused validation: local `runSkill`; inspect the event record. Dependencies: WP-011. Risk: low-medium (id threading). Sequence: 6th.

---

## WP-005 — UC-20 Chore Manager & Document Linker (ACTIVE, with attach mitigation)

- Objective: Create a chore task, add a weekend list item, link a document reference.
- Issue/Feature IDs: FEAT-020; ISS-001; HYP-005.
- Affected files: Skill; catalog entry; `docs/use-case-criteria/UC-20.md`. Catalog home: **skill**.
- Implementation steps: `homeops.create_task` (title "Fix Backyard Fence", notes=doc reference/URL) → `homeops.create_list_item` (text "Buy wood screws", listName "Weekend"). **Do NOT call `attach_note_or_file_reference` for the task** — it targets events (EV-019). Put the insurance-policy reference in `create_task` `notes`, OR create a companion event to hold the attachment if a true attachment is required.
- Acceptance criteria: a task exists with the doc reference retrievable (via notes); the list item exists on "Weekend"; NO fabricated task-attachment step; the criteria doc states the limitation.
- Focused validation: local `runSkill`; inspect task.notes + list item. Dependencies: WP-011. Risk: medium (design mismatch — mitigated). Sequence: 7th.

---

## WP-006 — UC-21 Multi-Channel Meal Planner & Sign-Off (ACTIVE, clean)

- Objective: Plan next week's meals+groceries+calendar, draft a menu notification, dispatch it, request household sign-off.
- Issue/Feature IDs: FEAT-021; DEC-005.
- Affected files: Skill (+ **agentTemplate**, this earns ongoing ownership); catalog entry; `docs/use-case-criteria/UC-21.md`. Catalog home: **agentTemplate + skill**.
- Implementation steps: `homeops.plan_meal` (per meal) → `homeops.send_notification_draft` (menu overview) → `homeops.notify_contact` (to/methodId, body — registry delivery, DEC-005) → `homeops.create_approval` (subject "Approve next week's menu" — Send, approval).
- Security/approval: `create_approval` and `notify_contact` are Send; create_approval requiresApproval=true.
- Acceptance criteria: meals land in the planner with groceries + calendar events; a notification draft artifact is created; delivery either succeeds to a verified TG- method or returns an honest `method_not_registered`; a sign-off approval/approved-decision artifact is recorded.
- Focused validation: local `runSkill` with a TG- verified method + allowlist. Dependencies: WP-011, WP-013. Risk: medium (delivery consent). Sequence: 8th.

---

## WP-007 — UC-22 Internal System Sync (ACTIVE, compose digest)

- Objective: Parse a meeting transcript into memory, then produce a "today's alerts" digest.
- Issue/Feature IDs: FEAT-022; ISS-002.
- Affected files: Skill; catalog entry; `docs/use-case-criteria/UC-22.md`. Catalog home: **skill**.
- Implementation steps: `homeops.write_memory` (transcript text, scope "family") → (reasoning step over server activity/notifications OR `gmail.search` `newer_than:1d`) → `homeops.create_artifact` (title "Today's Alerts Digest", body). **There is no built-in "recent inbox digest" tool (EV-020)** — the digest is composed; correct ART-001.
- Acceptance criteria: a memory row from the transcript + a digest artifact built from real inbox/activity data; every step cites a real tool_id; no reference to a non-existent internal tool.
- Focused validation: local `runSkill`; inspect memory + artifact. Dependencies: WP-011. Risk: low. Sequence: 9th.

---

## WP-008 — UC-14 Morning Status Text (ACTIVE-PARTIAL: weather+text; RSS stub)

- Objective: 6:30 AM: fetch weather + (optional RSS) meal-prep items, compile, text it.
- Issue/Feature IDs: FEAT-014; ISS-003; DEC-005; HYP-002.
- Affected files: Skill + automation (Schedule, anchor "06:30"); catalog entry; `docs/use-case-criteria/UC-14.md`. Catalog home: **workflowTemplate + skill + automation**.
- Implementation steps: `weather.current` → **RSS step OPTIONAL/stubbed** (`rss.latest` marked optional; connector not configured — the run degrades gracefully) → compose → `homeops.notify_contact` (delivery per DEC-005, NOT `sms.send` for the unattended path).
- Acceptance criteria: with a verified TG- text method + agent allowlist, a scheduled run delivers a text containing real weather; the RSS section is present only if configured, else omitted with a note; honest refusal if the method is unverified.
- Focused validation: local scheduled-run harness (HYP-002); inspect delivery audit. Dependencies: WP-011, WP-013. Risk: medium. Sequence: 10th. Note the RSS half is the only inactive piece — the item is verifiable on the weather+text path.

---

## WP-009 — UC-12 Smart Climate Night-Mode (ACTIVE build, device-runtime-unverified)

- Objective: 10 PM nightly: check devices online, set the living-room thermostat to 68°F (20°C).
- Issue/Feature IDs: FEAT-012; ISS-004; HYP-003.
- Affected files: Skill + automation (Schedule, anchor "22:00"); catalog entry; `docs/use-case-criteria/UC-12.md`. Catalog home: **workflowTemplate + skill + automation**.
- Implementation steps: `smarthome.listDevices` → `smarthome.setThermostat` (deviceId, celsius 20, requiresApproval).
- Acceptance criteria (contract-level, connector-decoupled): the skill emits the correct SDM command shape (`sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat`, heatCelsius 20) with approval; fails closed with the exact setup message when `HOMEOPS_SDM_PROJECT_ID` is unset. **Runtime-device-unverified** until an SDM project id + a physical Nest exist (unblock condition stated).
- Focused validation: contract-shape assertion via mocked provider api() (HYP-003); label device-unverified. Dependencies: WP-011. Risk: low (no real device to break). Sequence: 11th.

---

## WP-010 — INACTIVE set: specs + criteria docs (UC-02..11, 13, 15, 16) — NOT IMPLEMENTED

- Objective: Deliver each of the 13 inactive use-cases as a documented spec + connector-decoupled criteria doc, clearly labeled NOT implemented, with the exact connector to activate.
- Issue/Feature IDs: FEAT-002..011,013,015,016; ISS-005; ISS-007.
- Rationale: Their required connectors are not connected (EV-017); building them would fabricate verifiability. The user chose spec+criteria-only for these.
- Affected files: `docs/use-case-criteria/UC-02.md … UC-16.md` (the inactive subset); NO skills, NO active catalog entries (optionally a `status: "coming-soon"` catalog stub if the app supports it — otherwise doc-only).
- Implementation steps: For each: (1) verbatim intent; (2) intended tool_id chain (real ids, all marked `connected:false`); (3) the exact connector to activate to unblock; (4) mock/contract-level acceptance criteria testable without the connector; (5) label "NOT IMPLEMENTED — inactive connector".
- Acceptance criteria: 13 criteria docs exist; each names its inactive connector + unblock; none claims verification; ISS-007 native-variant notes included for UC-04/07/11.
- Focused validation: doc review; lint that no inactive UC is wired to a live skill.
- Risk: low (honesty risk if mislabeled — mitigated by explicit NOT-IMPLEMENTED banner).
- Rollout/rollback: docs only. Recommended sequence: 12th.

---

## WP-012 — Commit / push / deploy (Render) + TestFlight build

- Objective: Ship the built templates: commit + push (auto-deploys to Render), then submit a new TestFlight build.
- Issue/Feature IDs: PI-08; ART-001 §Deploy; EV-022.
- Rationale: The mission's remote-state finish; requires explicit user authorization (S8).
- Affected files: repo (commit); no new product code.
- Implementation steps: (1) `npm test` + both tscs green (baseline already green). (2) Commit on a branch, push. (3) Verify Render deploy via bundle-hash/`/api/health`. (4) `eas build -p ios --profile production --auto-submit` with `NODE_EXTRA_CA_CERTS` set.
- Acceptance criteria: CI green; Render serving the new bundle (hash verified); a new TestFlight build submitted. Live prod record-seeding remains UI/user-side (DEC-006).
- Focused validation: `/api/health` + bundle identity; EAS build id.
- Security/authorization: **S8 — requires explicit user authorization for deploy + TestFlight before execution.** Optionally widen `engines.node` (ISS-008) in this commit.
- Risk: medium (release). Rollback: Render redeploy previous; do not resubmit TestFlight. Recommended sequence: last.
