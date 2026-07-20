# Product Intent Register — run-20260720-073025

| ID | Claim | Type | Confidence | Evidence IDs | Notes |
|---|---|---|---|---|---|
| PI-01 | FamiliOS is a family operating system whose "one front door" is Ask Famili chat: it answers, executes one-off plans immediately, and builds durable helpers (skill+agent+automation) from conversation | goal | confirmed | EV-023, EV-025, EV-022 | ASSISTANT_SYS four-mode contract (answer/lookup/plan/build); mobile screen header comment |
| PI-02 | Core promise: "no simulation" — every step maps to a real executor; honest typed failures over graceful fiction | promise | confirmed | EV-005..EV-010 | Claimed in headers of engine/planner/functions/connectors; largely true at the TOOL layer, broken at four SEAMS (see contradictions) |
| PI-03 | Target users: a household — Owner + Adult Admin parents, Child View kids (AI-gated), Guest/Helper caregivers | user-role | confirmed | EV-016, EV-027 | Role registry is server-authoritative |
| PI-04 | Primary job (this mission): "tell chat to create a scheduled agent (e.g. daily 7 AM briefing email) and have it actually run and deliver — or honestly say why not" | job | confirmed | ART-002 user report; EV-011 | The user's verbatim goal |
| PI-05 | Runs are durable, server-owned, approval-gated, restart-recoverable; the browser only observes | workflow | confirmed | EV-006, EV-021 | Genuine strength — preserve |
| PI-06 | External sends are family-safe by design: approval gates, verified+opt-in contact registry, per-agent allowlists, kill switch | promise | confirmed | EV-010, EV-017 | The delivery layer itself never fakes success |
| PI-07 | CONTRADICTION: chat says "Done — I set up …" / "Done — finished (n/n steps)" / "That worked" for scheduled agents and plans that did not and cannot deliver anything | contradiction | confirmed | EV-011, EV-012, EV-015, EV-008 | The mission's false-success — reproduced 4 ways |
| PI-08 | CONTRADICTION: "daily at 7 AM" is accepted in chat but the trigger model can only express "every 24h from creation time" for chat-built automations | contradiction | confirmed | EV-002, EV-003, EV-011 | No time-of-day/timezone anchor in the build spec |
| PI-09 | CONTRADICTION: the built skill (the actual briefing recipe) is never wired to the automation — scheduled fires ignore it entirely | contradiction | confirmed | EV-001, EV-003, EV-011, EV-015 | Root of the build seam |
| PI-10 | CONTRADICTION: "helper is live" (client) vs "helper is a draft — activate it" (server notes) vs "triggers fire Draft agents anyway" (engine) | contradiction | confirmed | EV-022, EV-028 | Status semantics incoherent across layers |
| PI-11 | Team already suspected the loop was not real end-to-end ("real-provider end-to-end loop", "migrate mobile plan dispatch to durable server engine" 30-day goals) | goal | strongly-inferred | ART-002 (historical) | The mobile migration IS done at HEAD (EV-021); the end-to-end loop is not |
