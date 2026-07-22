# Journey Register — run-20260721-054151

Five canonical personas (synthetic research instruments — their reactions are simulated hypotheses, not customer feedback), their executed journeys, and the 22-use-case benchmark mapping. Live journeys were executed on the disposable tenant `hh_849af84da549` against commit 568c51f.

## Personas (exactly five)

### Persona 1 — Ross, the Owner-Builder
Role: household Owner, technically fluent, has built 18 agents / 16 playbooks / 13 skills / 4 functions on the resident tenant (EV-031). Goal: "hey can you do this" → "done, as you requested" — verifiably. Urgency: high (repeated prior failures). Data state: large, real, includes 3 near-duplicate Gmail-cleanup agents and a 7 AM briefing trigger. Device: desktop Chrome. Permissions: Owner. Frustrations: false "done" claims, empty Inbox, 52-item fragmentation. Trust requirement: seeing the result where the app said it would be. Evidence: EV-031, ART-001. Inferred: workflow preferences beyond the data.

### Persona 2 — Maya, the Busy Parent (first-time user)
Role: primary organizer, low technical fluency. Goal: one-sentence asks that just happen (tasks, notes, reminders). Data: fresh household. Device: desktop + phone. Permissions: Owner of her own household. Likely mistakes: never finds Approvals; assumes chat "Done" means visible results. Abandonment trigger: told to "review it in your Inbox" and finding it empty. Evidence: live journey below. Inferred: family composition.

### Persona 3 — Noah, the Child (Child View)
Role: child member; AI gated off; can view allowed spaces, request help. Goal: see chores, ask for a ride. Device: shared tablet. Permissions: Child View; cannot approve. Evidence: roster + role gates (EV-037, canApprove). Journey status: BLOCKED on web — after sign-out the profile picker cannot reach his profile (ISS-012, EV-027). That blockage IS the journey finding.

### Persona 4 — Grandma Ellen, the External Recipient
Role: not a member device user; receives digests/notices via email/SMS through the contact-method registry (verify + opt-in + per-agent allowlist). Goal: the Friday digest actually arrives (UC-4). Evidence: registry UI EV-023, notify.mjs gates. Journey status: UNREACHABLE end-to-end in audit env (no Google/SMS credentials) — delivery preconditions and refusal messages verified instead (notify.mjs:105-141).

### Persona 5 — Sam, the Scheduler (solo-professional variant)
Role: Adult Admin optimizing unattended automations (morning briefing at 07:00, Sunday syncs). Goal: schedules that fire at wall-clock time and deliver without babysitting. Evidence: resident trigger trg_bd15dd (07:00 anchor, tzSource server→household tz), triggers.mjs anchors (EV-039). Journey status: partial — scheduler correctness verified in code+data; unattended delivery blocked by ISS-001/002/004 chain (a parked 7 AM run is invisible and expires; historical EV-026-class failures in resident evolution records).

## Executed journeys

### JRN-1 — Ross power path (live, disposable tenant)
Agent from template → detail panel (11 tabs) → Run now → parked waiting_for_connector mislabeled "Waiting for Approval" (EV-009) → Automations Run History shows only this console run, chat runs absent (EV-011) → Improvements tab empty state (EV-013) → Skills/Functions via Advanced Mode (EV-021/022) → Workflow Builder third plain-English entry (EV-026). Debrief (synthetic): "Which of these five builders is the real one? Why does Run History disagree with chat?" Status: partial pass with ISS-005/011/013/007.

### JRN-2 — Maya first-run core task (live; THE mission journey)
Onboarding → create household (EV-001/002) → ask chat to create task+list item → no-provider honest refusal (FEAT-009) → configure provider (EV-029) → ask again → plan auto-runs parked on sign-off (scenario A): chat says "Review it in your Inbox"; Inbox empty; Approvals "Pending (0)" (EV-003/004/005) → [control: approve via server contract] → run completes; chat claims "delivered 2 steps"; notifications empty; draft artifact invisible (EV-032§3, EV-019) → scenario B (no-approval plan): completes 2/2, task+list item written server-side (EV-032§4) but visible NOWHERE (EV-015) → 30-min TTL means an unassisted Maya's scenario-A run expires. Debrief (synthetic): "It says done. Where? I checked the inbox like it told me." Status: FAIL as a user journey; server pipeline mechanics pass.

### JRN-3 — Noah child access (live attempt)
Owner adds Kid Tester (Child View) — server roster confirms (EV-037) → sign out → picker offers only resident "Ross"; no path into Kid Tester on web (EV-027). Status: BLOCKED (ISS-012); role-gate code paths (childAiGate, canApprove) verified in source only.

### JRN-4 — Ellen recipient path (preconditions pass)
Contacts tab shows registry with verified+opt-in rule (EV-023); no methods on fresh household; notify_contact fail-closed messages traced (internal-functions.mjs:449-467). Status: BLOCKED externally (no email/SMS channel in env); refusal honesty verified.

### JRN-5 — Sam scheduling path (code+data verification)
Automation tab set + templates (EV-010/026); resident 07:00 trigger has correct tz-anchored nextRunAt and fireCount 0 pre-fire (EV-039); connector-parked runs never expire (ISS-017). Status: partial; unattended delivery chain unproven end-to-end (blocked by ISS-001/002/004).

## The 22 use-case benchmark mapping ("automations and agents.txt")

Status legend: RUNNABLE-NOW (all tools live in default env), GATED (needs OAuth app/API key/device), INTERNAL-BROKEN (blocked by an ISS on internal path). "Skill" = matching seeded skill exists in resident tenant (EV-031).

| UC | Name | Needs | Skill exists | Journey | Current status | Blocking issue(s) |
|---|---|---|---|---|---|---|
| 1 | School Correspondence Organizer | Gmail RW | yes (skl_uc01) | JRN-5 | GATED (Google OAuth) + unattended chain ISS-001 | ISS-001, OAuth |
| 2 | Emergency Work-to-Home Forwarder | MS365 read + Gmail send | no | JRN-5 | GATED (MS365 not configured) | OAuth |
| 3 | Urgent Slack Escalation | MS365 + Slack | no | JRN-5 | GATED | OAuth |
| 4 | Grandparent Weekly Digest | MS365 send (or notify_contact email) | no | JRN-4 | GATED + delivery chain ISS-004 | ISS-004, OAuth |
| 5 | Cross-Calendar Conflict Sync | MS365 + Google Calendar | no | JRN-5 | GATED | OAuth |
| 6 | Corporate Hold Generator | MS365 write | no | JRN-5 | GATED | OAuth |
| 7 | Secure Document Cloud Sync | Drive + OneDrive | no | JRN-5 | GATED | OAuth |
| 8 | Secure Archive Builder | Dropbox RW | no | JRN-5 | GATED | OAuth |
| 9 | Database-to-Checklist Pipeline | Notion + Todoist | no | JRN-5 | GATED | connectors absent |
| 10 | Vacation Project Onboarding | Notion + TickTick | no | JRN-5 | GATED | connectors absent |
| 11 | Overdue Chore Auditor | Todoist read (or internal tasks) | no | JRN-2 | GATED external; internal variant blocked by ISS-008 (no task surface) | ISS-008 |
| 12 | Smart Climate Night-Mode | Google Home | yes (skl_uc12) | JRN-5 | GATED (device API) | connector absent |
| 13 | Smart Speaker Dinner Bell | Alexa | no | JRN-5 | GATED | connector absent |
| 14 | Morning Status Text | Weather + RSS + SMS | yes (skl_uc14) | JRN-5 | GATED on SMS (Twilio not configured); weather+RSS live | sms config; ISS-001 for unattended approval variants |
| 15 | Family Dashboard API Bridge | Custom HTTP GET/POST | no | JRN-5 | RUNNABLE-NOW (http connector revoked in resident tenant; re-enable) + POST approval chain ISS-001 | ISS-001 |
| 16 | School Menu Data Harvester | Local Files + Browser Automation | no | JRN-1 | RUNNABLE-NOW (browser-runtime healthy) — not exercised live this run | — |
| 17 | Smart Recipe Extractor | Web Search & Reading | yes (skl_uc17) | JRN-2 | RUNNABLE-NOW — not exercised live this run | — |
| 18 | Digital Memory Scrapbooker | homeops.write_memory + create_artifact | yes (skl_uc18) | JRN-2 | INTERNAL-BROKEN surface: artifacts invisible (FEAT-019) | ISS-002-adjacent (artifact surface) |
| 19 | Event Coordinator & Logistics Assigner | homeops event tools | yes (skl_uc19) | JRN-2 | RUNNABLE-NOW (engine threads eventId deterministically) — not exercised live | — |
| 20 | Chore Manager & Document Linker | homeops task/list/attach | yes (skl_uc20) | JRN-2 | INTERNAL-BROKEN result surface: EXECUTED LIVE, writes verified, result invisible | ISS-008 |
| 21 | Multi-Channel Meal Planner & Sign-Off | plan_meal + notify + sign-off approval | yes (skl_uc21) | JRN-2 | INTERNAL-BROKEN: sign-off approval invisible on web (EXECUTED LIVE variant) | ISS-001, ISS-003, ISS-004 |
| 22 | Internal System Sync (functions) | fn_note_to_memory + recent digest | yes (skl_uc22, fn_note_to_memory available; fn_gmail_recent draft) | JRN-1 | partial: memory fn available; digest fn draft + notifications surface missing | ISS-002 |

Benchmark summary: 4/22 runnable-now in the default environment (16, 17, 19, and 15 after re-enabling http), 5/22 executed-or-blocked on internal defects this audit exposed (11, 18, 20, 21, 22), 13/22 gated on external connector configuration that no code change alone can satisfy (OAuth apps, device APIs, Twilio). The PRD's acceptance criteria make every UC testable through the UI, with gated ones tested against a connector sandbox/mock layer.
