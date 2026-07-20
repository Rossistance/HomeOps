# Architecture and Authority Map — apps/mobile + shared server (run-20260719-232201)

## Modules and boundaries
- `apps/mobile/` — Expo SDK 56 / Expo Router app, bundle ai.familios.app. Route groups: `(home)` Today+calendar+event-form+help+scoped homes (kid/grandparent/sitter)+meals/groceries/profile/inbox/activity, `(ask)` assistant chat, `(agents)`, `(library)`, `(settings)` (household, tasks, meals, connections, contacts, AI, automations, playbooks). [EV-CODE-02, file tree]
- Shared backend `server/*.mjs` (node-http, :8787 local / Render prod): index.mjs routes + store.mjs JSON keyed collections + calendar.mjs (ICS/Google two-way) + planner/orchestrator/engine (assistant runs) + auth.mjs role gate. [EV-CODE-03/04/07]
- Web app `src/` is a sibling client of the same server (run-1's surface; comparison-only here).
- `mobile-version/` out of scope (legacy).

## Data flow and state ownership
- Server owns ALL family data; mobile screens fetch on focus (`useFocusEffect` + `useRevSync` polling `/api/rev`) and keep only ephemeral UI state. [EV-CODE-02, (home)/index.tsx:98-113]
- Auth: bearer token from POST /api/session with `x-homeops-bearer` header, stored in expo-secure-store; role/visibility filtering is server-side (child devices never receive adults-only rows). [EV-CODE-02, EV-NET-02 P5]
- Offline: only task POST/PATCH are queued and replayed (lib/offline-queue). [api.ts:229-231]

## API/event/IPC/persistence relationships (surfaces this audit traces)
- Events: GET/POST `/api/events`, PATCH/DELETE `/api/events/:id`; record has notes, whatToBring, checklist, participantIds, driverId, layer(canonical|linked|public), provenance. PATCH patches provided keys only. [EV-CODE-07, EV-NET-02]
- Help: `/api/help-requests` (+`/respond`, `/cancel`); respond = status change + notification ONLY — no task mutation. [EV-CODE-03, EV-NET-01]
- Tasks: `/api/tasks` CRUD; PATCH supports assignedMemberId (the reassignment primitive exists, unused by help flow). [EV-CODE-03]
- Files: POST `/api/files` (base64, ~5 MB/page cap, multi-page), GET `/files/:id/content`, DELETE. Durable across sessions (proven). [EV-NET-01]
- Google push: POST `/api/calendar/push/:id` → approval-first → `pushEventToGoogle` sends {summary, description:=notes, start/end dateTime, location}. Pull: `/calendar/pull-google-edits`; linked-Google events edit two-way (Google first, then mirror). [EV-CODE-04]

## Integrations and background work
- Google Calendar (OAuth accounts + subscriptions; auto-sync sweep `autoSyncGoogle`), ICS feeds, push tokens (`/push-tokens` targeted per member), AI providers registry, notifications registry (contact methods with verify loop). [EV-CODE-02, calendar.mjs]
- Assistant: server planner catalogs real tools/connectors; honest-degradation is policy (planner.mjs:240). [EV-CODE-08]

## Auth/tenancy/permissions
- Roles (server/auth.mjs mirrored in lib/roles.ts): Owner > Adult Admin > Adult Member > Limited Member > Child View > Guest/Helper. Event/task/file writes need Limited Member+; push needs adult; help asks are open to everyone by design. View-mode (child/grandparent/sitter homes) derives from relationship. [EV-CODE-11, EV-NET-02 P5]
- Households: householdId scoping on every record; local dev backend is a claimed household ("local") with resident data — treated as live-adjacent, disposable test entities only.

## Deployment, offline, and sync assumptions
- Compile-time backend URL `EXPO_PUBLIC_API_URL` (localhost:8787 fallback); TestFlight builds bake the production Render URL — cloud-device tests can't reach a LAN backend (top-gun-ios preflight consideration). Builds tested by the field testers: 1.0.0(13)/(19); repo HEAD ffcfa33 already post-dates them and contains a 6-bug TestFlight fix wave — every candidate was re-confirmed against HEAD. [facts handoff, git log]
- Drift note: production Render backend not probed (forbidden — live family data). Local server code at HEAD is the truth surface for server claims; production behavior labeled inferred-parity.
