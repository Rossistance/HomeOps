# Product Intent Register — run-20260719-232201 (native mobile, apps/mobile)

| ID | Claim | Type | Confidence | Evidence IDs | Notes |
|---|---|---|---|---|---|
| PI-01 | FamiliOS mobile is the family's shared "household operating system": calendar, tasks, meals, files, help requests, and an AI assistant, server-owned and role-filtered per member | goal | confirmed | EV-CODE-02, EV-NET-02, apps/mobile screens | Server is single source of truth; clients mirror |
| PI-02 | Every family role gets a fit-to-role home: owner/adult full Today; child, grandparent, sitter get calm scoped views routed by relationship | user-role | confirmed | EV-CODE-11, EV-SS-09/10 | viewModeFor(); relationship wins over role |
| PI-03 | The cooperative help loop (ask/offer → accept/decline) is a core family job: "the family adds things here for you" | job | confirmed | EV-SS-09/10, EV-CODE-03/10 | Promise currently broken at the reassignment step (ISS-001) |
| PI-04 | Events carry family logistics (driver, what-to-bring) beyond plain calendar data, and sync two-way with Google | workflow | confirmed | EV-SS-04, EV-CODE-04, server/calendar.mjs | whatToBring is a differentiator — yet dropped by the Google push (ISS-003) |
| PI-05 | The assistant degrades honestly: it names missing connectors and does the achievable part instead of refusing or pretending | promise | confirmed | EV-SS-11/12, EV-CODE-08 | Designed-in (planner.mjs:240); mirrors run-1 web honesty principle |
| PI-06 | Uploads are safe household memory: "Files stay in your household library — nothing is shared outside without approval" | promise | confirmed | upload-sheet copy, EV-NET-01 | Persistence proven; the *feeling* of safety is undermined by weak save feedback (ISS-002) |
| PI-07 | Approval gates guard external side effects (Google push, notifications); tool access ≠ permission | promise | confirmed | EV-CODE-01 (push approval flow), server approvals | Trust architecture worth preserving |
| PI-08 | The event editor intends "quick capture over completeness" (single date, optional end time, no notes) | contradiction | strongly-inferred | EV-SS-01/07/08, EV-CODE-01 | Contradicts PI-04's logistics ambition and real tester needs (TF-001/006/007); server model already richer than the editor |
| PI-09 | Offline taps must not be lost (task writes queue offline and replay) | promise | confirmed | api.ts OFFLINE_QUEUEABLE | Scoped to tasks only |
| PI-10 | Children are protected: server-side visibility filtering and role floors, AI gated behind adult enablement | promise | confirmed | EV-NET-02 P5, EV-CODE-11 | Verified live: child 403 on create/upload |
