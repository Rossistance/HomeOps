# TestFlight Feedback Handoff — FamiliOS (ai.familios.app)

**Package type:** Seed evidence for a **new Top Gun (`/top-gun:top-gun`) audit→implementation run.**
**Target surface:** the **native mobile app** (`apps/mobile`, Expo / `ai.familios.app`).
**Compiled:** 2026-07-19 · **Source:** App Store Connect → TestFlight → Screenshot Feedback (App 6789297381).
**Author of this package:** Cowork assistant (evidence capture only — no code was read for conclusions and no code was changed).

---

## 0. How to use this file

This is a **facts-and-evidence seed**, not a verified plan. It is written to drop into the Top Gun pipeline as pre-discovered field evidence for a *new* run. Everything here is labelled **[OBSERVED]** (captured directly from the TestFlight API + the rendered screenshots) or **[INFERRED / CANDIDATE]** (a hypothesis for the audit lead to confirm in code). The new run's `convergent-360` audit owns the real code-path tracing, final issue IDs, work-package numbering, and the numbered menu. Do not treat the candidate work packages below as approved scope.

**First action for the implementing agent (do while the signed URLs are still live — they expire ~2026-07-24):** download the 13 original screenshots from §3 into the new run's `audit/evidence/` folder so the visual evidence is preserved locally.

---

## 1. Environment facts [OBSERVED]

| Field | Value |
|---|---|
| Product | FamiliOS |
| App Store Connect app ID | 6789297381 |
| iOS bundle ID | `ai.familios.app` |
| Expo slug | `homeops-claude` · owner `brainbeaconai` · EAS project `b21178d0-3adf-4861-98bd-8557f7758719` |
| App dir (mounted repo) | `apps/mobile/` (Expo Router; screens under `apps/mobile/src/app/`) |
| Builds referenced by testers | `1.0.0 (19)` (most reports) and `1.0.0 (13)` (three oldest) |
| Devices | iPhone 14 (`iPhone14,7`) and iPhone 15 (`iPhone15,4`) |
| iOS versions | 26.5 and 26.5.2 |
| Testers | Melissa Mi Amor `dmelissareyesm@gmail.com` (in-app "Melissa"); Jeannie Hixon `greenbeanjeanne@gmail.com` (in-app "Beannie"/"Beanie") |
| Feedback count | **12 submissions, 13 screenshots** (report TF-003 has 2) — reconciles with the 12 tiles in App Store Connect |

**Project-boundary note [OBSERVED + FLAG]:** the existing Top Gun run records its project root as `D:\HomeOps\homeops-ai`, yet the mission state and this mobile app both live under `D:\FamiliOS\FamiliOS` (`.top-gun/` and `apps/mobile/`). The new run must resolve the real repository boundary from current source/runtime evidence per the Top Gun mandate, and scope work to `apps/mobile`.

---

## 2. Relationship to the existing run `run-20260719-073933` [OBSERVED]

That run audited the **web app + Node server (`homeops-ai`: `src/…tsx`, `server/*.mjs`)** as a 375px browser-emulator simulation. Its master report explicitly lists **"mobile app changes" as out-of-scope** (§20). Its selected slate:

- **WP-001** test-suite data-corruption containment (server/test, `store.mjs`, CI) — P0
- **WP-002** honest degraded-mode + claimed-server onboarding/sample (`src/store`, Onboarding/Lock/Shell/Dashboard) — P1
- **WP-003** local "Ask FamiliOS" fallback + rules-engine trigger fix (`src/screens/Assistant.tsx`, `src/lib/ai.ts`, `Automations.tsx`) — P1
- **WP-004** Weather connector fails honestly (`server/connectors.mjs`) — P2
- **WP-005** deploy Node pin + roster PII + drop dead dep (`render.yaml`, `package.json`, `/api/profiles`) — P2/P3

**Conclusion [INFERRED]:** this TestFlight feedback is **complementary, not redundant** — it targets the native mobile surface WP-001→005 deliberately did not touch. Two themes are *adjacent* (not duplicate): the mobile "Ask Famili" screen (TF-010/011) echoes WP-003's assistant work but is a different codebase; honest "connector unavailable" messaging echoes the WP-002/WP-004 honesty principle. The audit should reuse those principles, not those diffs.

---

## 3. Evidence ledger — screenshots [OBSERVED]

Full-resolution originals (Apple CDN, signed, **expire ~2026-07-24T00:00Z** — `Expires=1784851200`). Portrait, native device resolution.

| Screenshot | Report | Res | Original URL |
|---|---|---|---|
| TF-SS-01 | TF-001 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/JbI/CCU/A0Q/Duc/EVk/LHJW2rR51fc/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=68zniKq%2Fm4PBppGF6NqgGrQZXxQ%3D&p_sig=BT5anqOIwlztpAhRqxUXRTBWVpc |
| TF-SS-02 | TF-002 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/Awg/GMQ/DwA/DZA/ELc/yGSrpTSLcg4/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=kaQVieMoLwlHJ00QWxsczQ%2FciE4%3D&p_sig=cE2u7UhTLxuPw4d2YxwRPfVLgWE |
| TF-SS-03 | TF-003 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/DHM/CGY/CH8/Bgs/AQA/3vIuc5fE6Bc/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=OWlisvLCIHv0byeqOQfHVvsmROE%3D&p_sig=Vl7GcNhGyEor75ykjkPNPUhCQfw |
| TF-SS-04 | TF-003 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/FzE/CiY/E7M/GlE/Fc4/OUtqtPInGgU/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=Uvb4PvwyQobImiZVMvm67FaFKV4%3D&p_sig=VIy1-9QAE55dzWn6r1cwa2kCphs |
| TF-SS-05 | TF-004 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/Aro/C90/BGc/HJE/Jlc/cPQl_Wh0kLA/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=incXLL4gZIGo0FCwrY1br2DthxI%3D&p_sig=3cEjSowdaJq7Ekc0qdae2vzg5oE |
| TF-SS-06 | TF-005 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/Eio/JnY/AxA/CGA/Ju4/qNO0h5-1roA/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=0wPsBBQiPJEup4cRrJLCp%2B7%2FF4k%3D&p_sig=PHHgVAr9Uz0k-b2YVQ0mc0oTftI |
| TF-SS-07 | TF-006 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/Hqk/C_A/C-c/DCM/IrQ/GL6odmOClDc/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=SM3F%2FmmMuoOMRpzgkqkzbOXcz1c%3D&p_sig=57MlKf76YFQJoi_eOTJkWW3Uz-s |
| TF-SS-08 | TF-007 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/Bak/Jv4/Dro/AQE/Fk4/QjBd8sZxr_E/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=KyGkzS923Mo9SYv%2Bf%2FK5R3K7lYI%3D&p_sig=l7GYUqmpL0g1fx-sQugfzgZWFY8 |
| TF-SS-09 | TF-008 | 1179×2556 | https://tf-feedback.itunes.apple.com/eimg/D5g/DNo/Abo/IaE/D20/qTJTgJqZHD4/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=%2Fq771RJv8%2FE2jAo6gRIK2xH2RbQ%3D&p_sig=GfJTM05N3JxYZ3eGjV-jKY8OMbE |
| TF-SS-10 | TF-009 | 1179×2556 | https://tf-feedback.itunes.apple.com/eimg/FcI/H1o/H_k/Izs/DTI/5UGJIhhJRsw/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=lJz9u9Iou0RQfxD2Kn3%2FEoVFF44%3D&p_sig=-ndjpTKoLTufjsp7GGdapH-_GtE |
| TF-SS-11 | TF-010 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/CTE/JJA/A_Q/A3U/IKs/jyIS1CxhWn4/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=Wbn1IrQqeeSnljNgKttbpsPXbnw%3D&p_sig=lvYaHwNErCxMcARuiov3N6Neye4 |
| TF-SS-12 | TF-011 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/EBM/G9g/D6I/ETk/HO8/PbN3r3prPEg/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=Cjc%2FODCK5hBtBBbdU406KMepRAc%3D&p_sig=Gxq4SvcVihm351uzBQuCEYD0wPk |
| TF-SS-13 | TF-012 | 1170×2532 | https://tf-feedback.itunes.apple.com/eimg/AyQ/JuM/Ets/BV0/JTA/mZf5sewLHP8/original.jpg?i_for=6789297381&AWSAccessKeyId=MKIA9C0TVRX1ZL0VZ1YK&Expires=1784851200&Signature=8Zwr3QDUS9ZXNkqRv9AEMxBc66M%3D&p_sig=0kt3pGf3nuaH-7bbbHq-cFY_CI8 |

Apple feedback IDs: TF-001 `ANw_71eVbS9hz91oJUmL1yQ` · TF-002 `AGnnVr6bwK7lJEO6SoBqmS4` · TF-003 `ACgIRsjl_hN6ny4xryUFllI` · TF-004 `AETuJvwQzkKEJQbFgl-hlnM` · TF-005 `AADLoVQOH4CJrY_6ijwatLw` · TF-006 `AJb9MWIb5C631EV5-TimpZQ` · TF-007 `AB5-Wj_yQQgrVxMgeECI9oQ` · TF-008 `AA4fbl5CRPua0CviokbWTss` · TF-009 `ALBWYNcex3o4UcJUKf1ZYos` · TF-010 `AGRRuDrO2b_llTwMdXMueK0` · TF-011 `AEWZHRneWKH1jXRkJSTQwfI` · TF-012 `ACrzRX-j-Fvq9USydpGrOYw`

---

## 4. Feedback reports (verbatim notes + screenshot transcription)

Notes are quoted **exactly** as submitted (typos preserved). "On screen" = transcribed from the full-res screenshot. Candidate fields are hypotheses for the audit.

### TF-001 — Multi-day events need an end **date**, not just an end time
- **Meta [OBSERVED]:** Melissa · 2026-07-16 · build 1.0.0(19) · iPhone 14 · iOS 26.5.2 · TF-SS-01
- **Note [OBSERVED]:** "date should give the option to choose a end time in a different date and time on that different date for multiday events"
- **On screen [OBSERVED]:** New event — Scheduled ON; Date `Jul 25, 2026`; Starts `9:00 PM`; Ends `10:00 PM`; a single Date field governs both start and end; Location/Driver below; keyboard open.
- **Candidate [INFERRED]:** event model/editor assumes start and end share one calendar date → no multi-day span. Add an end-date picker (or start/end datetime pair).
- **Candidate files:** `apps/mobile/src/app/(home)/event-form.tsx`, `calendar.tsx`. **Severity:** P2 (feature gap).

### TF-002 — Saved tasks aren't editable
- **Meta [OBSERVED]:** Melissa · 2026-07-14 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-02
- **Note [OBSERVED]:** "need to be able to clic on already saved tasks and edit them"
- **On screen [OBSERVED]:** "Tasks & Lists" — scrollable task list (e.g. "drop donations to Vanessa", "laminate printables for classroom", "pick up/ request Eleanor's shot record", "Spanish playlist for commute"), each with an "M" owner avatar; bottom nav Today / Ask / Agents / Library / Settings.
- **Candidate [INFERRED]:** task rows are display-only (no tap-to-edit / detail route). **Candidate files:** task list screen under `apps/mobile/src/app/(home)/` (`index.tsx` / a tasks route) + task components. **Severity:** P2.

### TF-003 — Push-to-Google drops "What to bring" and notes
- **Meta [OBSERVED]:** Melissa · 2026-07-13 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-03 + TF-SS-04 (2 shots)
- **Note [OBSERVED]:** "when you push the event to google the google event does not show the area on the familios event that is under what to bring or notes"
- **On screen [OBSERVED]:** TF-SS-03 = the **Google Calendar** event "Water day at Prek", Fri Jul 17 8:25 AM–5:25 PM, location "st. jude catholic school", "30 minutes before", calendar `dmelissareyesm@gmail.com` — **no "what to bring"/notes content shown.** TF-SS-04 = the same event's FamiliOS **Edit** screen showing **What to bring: `swimsuit`, `towel`** plus Driver=Melissa and "Update in Google".
- **Candidate [INFERRED]:** the Google push payload omits the "what to bring" list (and any notes) — should map them into the Google event `description`. **Candidate files:** mobile Google push path in `apps/mobile/src/lib/api.ts` + server event→Google mapping. **Severity:** P2 (sync fidelity).

### TF-004 — "Save changes" and "Update in Google" feel like duplicate buttons
- **Meta [OBSERVED]:** Melissa · 2026-07-13 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-05
- **Note [OBSERVED]:** "save changes and push to google seem like a duplicate actionable button it should be the same"
- **On screen [OBSERVED]:** Edit event — Starts `5:00 PM`, "Add end time"; Location "st. jude catholic school"; Driver=Melissa; **three stacked buttons: `Save changes` (filled), `Update in Google` (outline), `Delete event` (red).**
- **Candidate [INFERRED]:** unify into one save that also syncs (or make "Update in Google" a toggle/secondary within save), so users don't have to press two buttons to persist + sync. **Candidate files:** `event-form.tsx`. **Severity:** P3 (UX clarity). Coordinates with TF-003.

### TF-005 — Location should autocomplete to a real address + offer directions
- **Meta [OBSERVED]:** Melissa · 2026-07-13 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-06
- **Note [OBSERVED]:** "location needs to actually give a drop down menu of possible locations with the actual address and a way to get directions through any map app"
- **On screen [OBSERVED]:** New event — Date Jul 17, Starts 8:25 AM, Ends 5:25 PM; Location free-text "st. jude catholic school"; keyboard mid-type ("school"). No suggestion dropdown.
- **Candidate [INFERRED]:** location is a plain text field. Add place autocomplete (geocoded address) + a "Directions" affordance that opens the platform map app. Note: `app.json` already declares `expo-location` permission — capability is partly provisioned. **Candidate files:** `event-form.tsx`, a places/geocode lib, `apps/mobile/app.json`. **Severity:** P2 (feature).

### TF-006 — Need an "All day" option (no forced time)
- **Meta [OBSERVED]:** Melissa · 2026-07-13 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-07
- **Note [OBSERVED]:** "timing for event needs to include something to choose and all day event without choosing a time"
- **On screen [OBSERVED]:** New event — Scheduled ON; Date Jul 17; Starts `4:00 PM` with a time-picker wheel open; "Add end time". No "All day" toggle.
- **Candidate [INFERRED]:** add an all-day toggle that suppresses the time picker and stores an all-day/date-only event. **Candidate files:** `event-form.tsx`, `calendar.tsx`, event model. **Severity:** P2 (feature). Pairs naturally with TF-001.

### TF-007 — Add a general Notes field (separate from "What to bring")
- **Meta [OBSERVED]:** Melissa · 2026-07-13 · 1.0.0(19) · iPhone 14 · iOS 26.5 · TF-SS-08
- **Note [OBSERVED]:** "calendar there needs to be an additional area other than what to bring for writing notes"
- **On screen [OBSERVED]:** New event — Date Jul 16, Starts 5:00 PM, "Add end time"; Location "st. jude catholic school"; Driver "No driver"; "What to bring" (empty); "Add event". Only "What to bring" exists for free text.
- **Candidate [INFERRED]:** add a Notes field to the event model + editor; include it in the Google push description (see TF-003). **Candidate files:** `event-form.tsx`, event model, Google mapping. **Severity:** P2 (feature).

### TF-008 — Accepted/offered task doesn't reassign; duplicate "helping" cards ⚠️ likely bug
- **Meta [OBSERVED]:** Jeannie/"Beannie" · 2026-07-12 · 1.0.0(19) · iPhone 15 · iOS 26.5 · TF-SS-09
- **Note [OBSERVED]:** "I offered and accepted the task, but it is not showing a task list for me with the new task created by Ross reassigned to me and when Ross looks on his screen and asked to offer help, the task is still under his name and not moved under beanie name"
- **On screen [OBSERVED]:** Beannie's home ("BEANNIE'S FAMILIOS", "Good evening, Beannie", "A quiet day … nothing on the calendar"). **"CAN YOU HELP?" shows two identical cards: "You're helping Ross — Can you take care of 'Clean up guest room'?"** (both already-accepted state). "TODAY — Nothing on the calendar today."
- **Candidate [INFERRED]:** cross-user task **reassignment/state-sync defect** — after accept, ownership doesn't transfer (stays with Ross), the task never lands in the helper's task list, and the help card renders duplicated. Likely a mutation/refetch or optimistic-state issue in the offer→accept→reassign flow, possibly compounded by the multi-user server not propagating the owner change. **Candidate files:** `apps/mobile/src/app/(home)/help.tsx`, `(home)/index.tsx`, `kid.tsx`, `grandparent.tsx`, plus the help/assignment calls in `apps/mobile/src/lib/api.ts` and the server task-assignment endpoint. **Severity:** P1 (functional, multi-user core loop). **Needs repro across two accounts.**

### TF-009 — Want to set time parameters/availability when offering help
- **Meta [OBSERVED]:** Jeannie/"Beannie" · 2026-07-12 · 1.0.0(19) · iPhone 15 · iOS 26.5 · TF-SS-10
- **Note [OBSERVED]:** "W I would like to put some parameters on my time that day" (leading "W" appears to be a stray character)
- **On screen [OBSERVED]:** Beannie's home — "CAN YOU HELP? — Ross asked for your help — Can you take care of 'Clean up guest room'?" with buttons **`I can help` / `Can't this time`**; "THIS WEEK — Mon 11:00 AM Bill due Amazon Mu…".
- **Candidate [INFERRED]:** when accepting a help request, let the helper attach time constraints/availability windows ("I can help, but only after 3pm"). Feature request on the help-accept flow. **Candidate files:** `(home)/help.tsx`, help-accept components. **Severity:** P3 (feature; same flow as TF-008 — fix the bug first).

### TF-010 — (no note) "Ask Famili": can't place a call, sets a reminder instead
- **Meta [OBSERVED]:** Melissa · 2026-07-10 · 1.0.0(13) · iPhone 14 · iOS 26.5 · TF-SS-11 · **no text comment**
- **On screen [OBSERVED]:** "Ask Famili" chat. User: "can you call me then tomorrow two hours before to remind me". Assistant: "On it — I can't place phone calls from the connected tools, so I'm setting a 7:50 AM household reminder for Eleanor's 9:50 swim lesson tomorrow; an Alexa/phone-calling connector would unlock an actual call or Echo announcement." Task card "Two-hour swim lesson reminder — Low risk — 2 steps · Manual" (Confirm reminder time → Create 7:50 AM reminder), tagged `FamiliOS`.
- **Candidate [INFERRED]:** **no defect asserted.** Captures a capability boundary; the assistant already degrades honestly (states the limit, offers a real fallback) — consistent with the product's honesty principle. Value here is confirming that behavior is correct and considering an actual phone/Echo connector as a roadmap item. **Severity:** P4 / informational.

### TF-011 — (no note) "Ask Famili": Alexa/Echo voice reminder unavailable, backup reminder created
- **Meta [OBSERVED]:** Melissa · 2026-07-10 · 1.0.0(13) · iPhone 14 · iOS 26.5 · TF-SS-12 · **no text comment**
- **On screen [OBSERVED]:** "Ask Famili" — task "Eleanor's swim lesson — 2 steps" (Add backup swim lesson reminder → "Alexa/Echo voice reminder unavailable — No Alexa/Echo connector is currently available…"). Result: "Done — 'Backup reminder for Eleanor's swim lesson' finished (2/2 steps). Alexa/Echo voice reminder is unavailable because no Alexa/Echo connector is connected. A backup household task reminder was already created."
- **Candidate [INFERRED]:** **no defect asserted** — again an honest "connector unavailable" + real fallback (mirrors the WP-002/WP-004 honesty principle on the mobile side). Confirm it's intended; roadmap: Alexa/Echo connector. **Severity:** P4 / informational.

### TF-012 — Uploaded medical ID reported "not saved" ⚠️ verify persistence
- **Meta [OBSERVED]:** Melissa · 2026-07-10 · 1.0.0(13) · iPhone 14 · iOS 26.5 · TF-SS-13
- **Note [OBSERVED]:** "uploaded a new medical if and it was not saved" (reads as "medical **id**")
- **On screen [OBSERVED]:** Library — tabs "Files (1) / Knowledge (31)"; category cards School (0), **Medical & IDs (1 file, selected)**, Bills & Receipts (0), Home (0); under MEDICAL & IDS: **`IMG_5555.jpg` — Medical & IDs · 3.4 MB · 7/10/2026**.
- **Candidate [INFERRED + DISCREPANCY]:** the note says "not saved," but the screenshot shows exactly **one** file present in Medical & IDs — so either (a) a *later/second* upload failed to persist, (b) the file didn't appear until refresh (no success confirmation → perceived failure), or (c) it didn't survive a session/sync round-trip. Treat as a **candidate persistence/confirmation bug** requiring reproduction. **Candidate files:** `apps/mobile/src/app/(library)/index.tsx`, `apps/mobile/src/components/sheets/upload-sheet.tsx`, upload path in `apps/mobile/src/lib/api.ts`, server file-store endpoint. **Severity:** P1 candidate if data loss confirmed; P2 if it's only a missing success state. **Needs repro.**

---

## 5. Normalized candidate issues [INFERRED — audit to confirm]

| ID | Title | Type | Reports | Sev (cand.) |
|---|---|---|---|---|
| TF-ISS-01 | Cross-user task reassignment doesn't transfer; duplicate "helping" cards | Bug | TF-008 | P1 |
| TF-ISS-02 | Library upload persistence / missing success confirmation (medical ID) | Bug | TF-012 | P1? |
| TF-ISS-03 | Push-to-Google drops "What to bring" + notes | Bug/sync | TF-003 | P2 |
| TF-ISS-04 | Event model has no multi-day span (end date) | Feature | TF-001 | P2 |
| TF-ISS-05 | No "All day" event option | Feature | TF-006 | P2 |
| TF-ISS-06 | No general Notes field on events | Feature | TF-007 | P2 |
| TF-ISS-07 | Location field lacks address autocomplete + directions | Feature | TF-005 | P2 |
| TF-ISS-08 | Saved tasks not editable (no tap-to-edit) | Feature | TF-002 | P2 |
| TF-ISS-09 | "Save changes" vs "Update in Google" redundancy | UX | TF-004 | P3 |
| TF-ISS-10 | No availability/time parameters when accepting help | Feature | TF-009 | P3 |
| TF-ISS-11 | Ask Famili phone-call / Alexa-Echo boundary (honest fallback) | Info/roadmap | TF-010, TF-011 | P4 |

---

## 6. Candidate work-package groupings [INFERRED — the new audit/matching owns final WPs & the menu]

Offered only to save the audit time; renumber/reshape freely.

- **TF-WP-A — Multi-user task/help loop integrity (P1).** TF-ISS-01 (+ revisit TF-ISS-10 after). The core cooperative loop (offer → accept → reassign → appears in helper's list) must actually transfer ownership and de-duplicate cards. *Highest trust leverage on mobile.*
- **TF-WP-B — File/library persistence honesty (P1?).** TF-ISS-02. Prove upload durability across sessions/accounts; add an explicit save success/failure state (no silent "did it save?").
- **TF-WP-C — Event editor completeness (P2).** TF-ISS-04 (end date/multi-day) + TF-ISS-05 (all-day) + TF-ISS-06 (notes) — one coherent event-model + `event-form.tsx` pass.
- **TF-WP-D — Google sync fidelity + save UX (P2/P3).** TF-ISS-03 (map what-to-bring/notes into Google description) + TF-ISS-09 (unify save/update). Depends on TF-WP-C's notes field.
- **TF-WP-E — Location intelligence (P2).** TF-ISS-07 place autocomplete + directions (leverages existing `expo-location`).
- **TF-WP-F — Task editing (P2).** TF-ISS-08 tap-to-edit saved tasks.
- **Roadmap / non-WP:** TF-ISS-11 (phone/Alexa-Echo connector) — confirm honest-fallback behavior is intended; treat a real connector as a future feature, not a fix.

**Candidate sequence [INFERRED]:** TF-WP-A → TF-WP-B (bugs first) → TF-WP-C → TF-WP-D → TF-WP-E → TF-WP-F.

---

## 7. Open questions / unknowns [OBSERVED gaps]

- TF-012: single vs. multiple uploads — did the *shown* file save and a second fail, or is it a missing confirmation? Needs two-attempt repro.
- TF-008: does ownership fail to change server-side, or only fail to reflect on each client? Needs 2-account repro (Ross + Beannie).
- Whether an "all-day"/date-only representation already exists in the event model but is unexposed in the mobile editor.
- Whether builds 13 vs 19 differ on any of these paths (three oldest reports are on 13; the rest on 19 — audit should confirm the issue still reproduces on the latest build).
- Exact server endpoints behind mobile `lib/api.ts` for help-assignment, file upload, and Google push.

## 8. Authority & safety [OBSERVED]

- This package is **read-only evidence.** No code was changed producing it.
- The new run's audit/synthesis stays read-only for product source until its own selection gate; the gate authorizes local changes only within the selected scope.
- Google-push / any external write remains gated on explicit per-action authorization — tool access ≠ permission.
- Screenshot URLs contain short-lived Apple signatures; do not commit them to a public repo. Download the images locally (they expire ~2026-07-24) and keep them in the run's `audit/evidence/`.

## 9. Next discriminating checks for the audit [INFERRED]
1. 2-account repro of TF-008 (offer→accept→reassign) with server + both clients observed.
2. 2-attempt repro of TF-012 upload persistence across a session restart.
3. Trace `event-form.tsx` event model for date/time/all-day/notes fields actually persisted + pushed to Google.
4. Trace the mobile Google-push payload builder for the missing "what to bring"/notes mapping.
5. Confirm TF-010/011 honest-fallback is intended (compare against the WP-003 assistant honesty principle).
