# FamiliOS Cross-Platform Parity Matrix — Web vs iOS/Mobile

Generated 2026-07-22 from a read-only audit of `src/` (web, React/Vite) and `apps/mobile/src/` (Expo/React Native).
Evidence is cited by file path. **The "Suggested platform(s)" column is intentionally empty — fill it in to pick what goes where.**

## Executive summary (biggest gaps, each direction)

1. **Mobile has NO builder surfaces**: Skills builder, Functions builder, workflow builder, browser workflows, and sandbox/background jobs are all web-only (`src/screens/SkillBuilder.tsx`, `FunctionBuilder.tsx`, `Automations.tsx` tabs, `src/components/BrowserSandbox.tsx`).
2. **Mini Apps and Household Spaces screens are web-only** (`src/screens/MiniApps.tsx`, `HouseholdSpaces.tsx`); mobile only has a groceries screen and a spaces heuristic for filing files.
3. **The new unified Helper Agents IA (WP-005) is web-only**: packaged-template catalog (`src/data/packagedTemplates.ts`), inline trigger composer (`AgentTriggerComposer`, `src/screens/Agents.tsx:775`), and the `useUnifiedNav` flag. Mobile keeps a simpler agent list + AI-drafted new-agent sheet.
4. **FTS5 memory search + retrieval profile (WP-007) is web-only** (`GET /api/memory/search`, `src/screens/ActivityMemory.tsx:226`); mobile only lists/deletes memory.
5. **Realtime sync differs**: web uses SSE `/api/changes` push (`src/store/useStore.ts:1673`); mobile polls `/api/rev` every 12s (`apps/mobile/src/lib/rev-sync.ts`) — functional but slower and battery-costlier.
6. **Mobile does approvals/notifications from server truth already** — it calls `GET /api/approvals` and `GET /api/notifications` (`apps/mobile/src/lib/api.ts:307,407`) and enriches approvals with real run-step input (`app/(home)/inbox.tsx:120`). Parity here is good.
7. **iOS-only strengths web lacks**: Expo push notifications with token registration (`app/_layout.tsx:93-97`), coarse location context for the assistant (`lib/location.ts`), camera/photo capture into uploads (`components/sheets/upload-sheet.tsx`), offline write queue with replay (`lib/offline-queue.ts`), haptics (`theme/index.ts:212`).
8. **iOS has dedicated scoped role screens** (kid/grandparent/sitter full-screen views, `app/(home)/kid.tsx` etc.); web also has them (`src/screens/scoped/*.tsx`) — parity, but different presentation.
9. **New Settings work is only partly on mobile**: household timezone picker and `hideProfilesPreAuth` privacy toggle are web-only (`src/screens/Settings.tsx:44-74,138,167`); mobile settings expose only externalActions/calendarAutoSync/autoApproveImprovements (`apps/mobile/src/lib/api.ts:854-863`).
10. **Chat streaming exists on both** (web `POST /api/assistant/stream`; mobile `lib/assistant-stream.ts` via `expo/fetch`), and mobile chat is server-durable/conversation-synced with web — but web-only chat extras remain: multi-entity results deep-links to miniapps/files (`src/screens/Assistant.tsx:308-317`) and the explicit WP-003 double-run guard (`Assistant.tsx:680`); mobile has a lighter runId-based watcher (`app/(ask)/index.tsx:210`).

---

## Parity matrix

Legend: **Present** / **Partial** / **Absent**. File paths are the primary surface, not exhaustive.

### 1. Features — task execution & family surfaces

| Feature | Description | WEB status | iOS status | Notes (UX differences that matter) | Suggested platform(s) |
|---|---|---|---|---|---|
| Chat / assistant ("Ask") | Conversational planner: answer / plan / build, server-durable threads | Present — `src/screens/Assistant.tsx`, streaming via `/api/assistant/stream` (`src/connectors/api.ts:694`) | Present — `app/(ask)/index.tsx`, streaming via `lib/assistant-stream.ts` (expo/fetch SSE-over-POST) | Same server conversations (cross-device history). Mobile adds doc/image attach via pickers; web adds results deep-links & richer build cards. Mobile falls back to non-streaming on transport failure. | |
| Run history (unified, cause CTAs) | Durable server runs w/ status vocabulary + parked-cause CTAs ("Needs approval → Review", "Needs a connection → Open Connections") | Present — `src/store/useStore.ts:76-128` (runStatus + CTAs), `src/components/runs/RunTimeline.tsx`, Automations "Run History" tab | Partial — `app/(home)/activity.tsx:73-161` lists `api.runs()` (collapsed to 3, expand to 12); no cause-CTA buttons, no timeline detail view | Web renders per-step timeline + deep-link CTAs; mobile is a flat recent-runs list capped at 12. | |
| Approvals inbox (server truth) | Pending/decided approvals, approve/deny, expiry countdown | Present — `src/screens/Messages.tsx` (Approvals tab, `ExpiryCountdown` :216), server read-model `serverApprovals` | Present — `app/(home)/inbox.tsx` "Approvals" segment; calls `GET /api/approvals`, decides via `/approvals/:id/decide`; enriches preview with real run-step input via `api.runs("waiting_for_approval")` (:120) | Both are server-truth. Mobile uses segmented control + approval sheet (`components/sheets/approval-sheet.tsx`); web uses tabs + cards with live expiry countdown (mobile shows expiresAt but no ticking countdown). | |
| Notifications display | In-app delivered notifications, mark-read | Present — merged into Messages Inbox timeline (`src/screens/Messages.tsx:57-66`) | Present — Inbox "Updates" segment, `GET /api/notifications`, mark-read, plus "send test notification" button (`inbox.tsx:172-180`) | Mobile additionally receives OS push (Expo). Web merges notifications with message threads; mobile separates segments. | |
| Tasks / chore board | Household tasks, chores, assignment, done-toggles | Present — Chore Board mini-app (`src/miniapps/index.tsx`, `BOARD_TASK_TYPES`), Dashboard open-tasks | Partial — task CRUD in API (`lib/api.ts:444,490,747`), chore sheet (`components/sheets/chore-sheet.tsx`), Today screen + settings "Tasks & Lists" (`app/(settings)/tasks.tsx`); no board/kanban view | Mobile task writes are offline-queueable (`OFFLINE_QUEUEABLE`, `lib/api.ts:232`). Web board is drag-density; mobile is list/sheet based. | |
| Artifacts / knowledge library | Files + knowledge items + generated artifacts (briefings/reports) | Present — `src/screens/FilesKnowledge.tsx`; artifacts with dynamic kind-filter chips (:354-404) | Partial — `app/(library)/index.tsx`: Files + Knowledge tabs incl. artifacts & memory counts, upload/delete/search, space filing (`lib/spaces.ts`); **no kind-filter chips for artifacts** | Mobile files get heuristic space categorization + camera capture + multi-page upload; web gets artifact kind filters and drawer detail. | |
| Calendar | Canonical events + linked ICS/Google layers, two-way Google sync w/ conflict resolve | Present — `src/screens/Calendar.tsx` | Present — `app/(home)/calendar.tsx`, `event-form.tsx`; full API parity incl. push-to-Google (approval-gated), pull-edits, conflict resolve, sync-all (`lib/api.ts:600-651,813`) | Strong parity. No native (EventKit) calendar integration on mobile — all server-based (no `expo-calendar` dep in `apps/mobile/package.json`). | |
| Meals / groceries | Meal plan, ingredients→grocery list, meal→calendar | Present — `src/screens/Meals.tsx` | Present — `app/(settings)/meals.tsx` + dedicated `app/(home)/groceries.tsx`; full meal CRUD w/ stale-write guard (`lib/api.ts:495-531`) | Mobile buries meal planning under Settings but promotes Groceries to a Today-stack screen — different IA emphasis. | |
| Memory (list/delete) | Household recall the AI accumulated; delete = "forget" | Present — Activity & Memory → Memory tab (`src/screens/ActivityMemory.tsx`) | Present — in Activity (`app/(home)/activity.tsx:99-110`) and Library knowledge tab (`(library)/index.tsx:138-148`), confirmed deletes | Parity for list/delete. | |
| **Memory FTS5 search + profile** | WP-007 retrieval-quality search over whole recall history (`GET /api/memory/search`, sqlite-FTS5) | Present — `src/screens/ActivityMemory.tsx:226-238`, `src/connectors/api.ts:978` | **Absent** — no `/memory/search` call anywhere in `apps/mobile/src` | Web-only. Mobile would need a search field + results list; endpoint is client-agnostic. | |
| Improvements / evolution review | AI-mined improvement proposals; accept/reject (Adult Admin) | Present — Activity & Memory → Improvements tab (`ActivityMemory.tsx:27`) | Present — `app/(home)/activity.tsx:123-140` (`api.reviewEvolution`) | Parity. Both read `/evolution`, both gate accept on role server-side. | |
| Helper agents (list/run/edit) | Agent registry: run now, pause, duplicate, delete, versions | Present — `src/screens/Agents.tsx` | Present — `app/(agents)/index.tsx`, `[id].tsx`; run/pause/duplicate/delete via API (`lib/api.ts:765-789`) | Mobile agent detail shows its triggers + runs + approvals; no version history view (web has `/agents/:id/versions`). | |
| **Unified Helper Agents IA / packaged catalog / trigger composer** | WP-005: `useUnifiedNav` flag folds Automations away; packaged-template catalog; schedule-from-agent composer | Present — `src/screens/Agents.tsx:186-271` (packaged catalog, `data-testid="packaged-catalog"`), `:775` `AgentTriggerComposer`, `src/lib/prefs.ts:119-133` | **Absent** — mobile has its own 3-item template list in `components/sheets/new-agent-sheet.tsx:13` (AI-drafted, no packaged catalog, no unified flag, no trigger composer) | Confirmed web-only. Mobile's new-agent flow is AI-first (describe → draft → buildFromChat) which is arguably a better fit for phone anyway. | |
| Automations / triggers | Schedules, webhooks, watchers; fire-now; enable/disable | Present — `src/screens/Automations.tsx` (tabs: Automations, Triggers*, Live, Workflow Builder, Templates, Browser*, Background Jobs*, Run History; *=Advanced) | Partial — `app/(settings)/automations.tsx`: list, enable/disable, fire, delete (`lib/api.ts:791-810`); no builder, no live monitor, no templates | Mobile shows household-timezone schedule text (`(agents)/index.tsx:21-29`). Creation on mobile only via chat build. | |
| Skills builder | Author/edit skills, versions; Playbooks folded in as "Recipes" | Present — `src/screens/SkillBuilder.tsx` (Advanced Mode nav) | **Absent** — mobile only browses playbooks read-only (`app/(settings)/playbooks.tsx`, `api.playbooks()`) | Skills can be *created* from mobile chat via `buildFromChat`, but not edited/browsed. | |
| Functions builder | Low-level function/tool authoring + tool catalog | Present — `src/screens/FunctionBuilder.tsx` (`/functions`, `/functions/tool-catalog`) | **Absent** — no `/functions` calls in mobile | Deep power-user surface; poor phone fit. | |
| Connections + provisioning setup guides | OAuth providers/accounts, connector health, WP-012 real-credential setup checklists | Present — `src/screens/Connections.tsx`; `SetupGuidePanel` from `src/data/providerSetup.ts` (:233-320) | Partial — `app/(settings)/connections.tsx` + `connection-sheet.tsx`: list, OAuth start (`x-homeops-mobile` header), revoke account, "deployment setup needed" notice (:244); **no step-by-step setup guides** | Mobile correctly punts server-env setup to admin. Guides (console URLs, scopes) are web-only. | |
| Settings — AI providers | Provider config, health probe, activate; LM Studio/Ollama local providers | Present — `src/screens/AIProviders.tsx`; **new optional API-token field for LM Studio/Ollama with keyOptional hint** (:103-119) | Partial — `app/(settings)/ai.tsx` mirrors config/health/activate with apiKey+baseUrl+model fields, but generic "API key" field — **no keyOptional/LM Studio token hint copy** (`AIProviderRec` in `lib/api.ts:180` lacks `keyOptional`) | Functionally the token can be entered on mobile (apiKey field is sent); the guidance UX is web-only. | |
| Settings — household | externalActions kill-switch, calendar auto-sync, auto-approve improvements, rename household, invites, member roles | Present — `src/screens/Settings.tsx`, `HouseholdSpaces.tsx` | Present — `app/(settings)/index.tsx`, `household.tsx`, invite sheet; settings read/toggle (`lib/api.ts:854-863`) | Parity on the three toggles. | |
| Settings — **timezone + hideProfilesPreAuth** | Household timezone anchor for schedules; ISS-015 hide profile names pre-auth | Present — `src/screens/Settings.tsx:44-74,138-144,167` | **Absent** — mobile `AppSettingsRec` (`lib/api.ts:214-218`) omits both fields | Server-enforced; mobile *respects* hideProfiles on its profile picker only if the `/profiles` endpoint filters it (server-side — mobile has no toggle UI). Ambiguous whether mobile picker output is affected; the flag is enforced server-side per web comment. | |
| Family roles / profile picker / child sessions | Pre-auth profile picker, PIN, role-ranked access, child aiEnabled, householdHint | Present — `src/screens/Onboarding.tsx`, Lock, role gates in `useStore.ts:288` | Present — `lib/session.tsx` (`api.profiles()`, PIN login, bearer token), `lib/roles.ts`, `components/Onboarding.tsx` | Mobile stores bearer token in SecureStore; web uses same-origin cookies. Both server-resolve roles. | |
| Lock screen | PIN / re-auth gate | Present — `src/screens/Lock.tsx` | Present — `components/Lock.tsx` | Parity. | |
| Household Spaces | Space management screen (members, spaces, filtering) | Present — `src/screens/HouseholdSpaces.tsx` + global space filter in Topbar (`Shell.tsx:222-229`) | Partial — no spaces screen; `lib/spaces.ts` is only a file-filing heuristic for the Library; member management lives in `(settings)/household.tsx` | No space filter concept in mobile nav. | |
| Mini-apps | Chore Board etc. (`BOARD_TASK_TYPES`) | Present — `src/screens/MiniApps.tsx`, `src/miniapps/index.tsx` | **Absent** as a concept — closest analogue is the groceries screen | Web mini-apps are also the deep-link target of chat task results. | |
| Contact methods | Per-member delivery registry, verify-by-code loop, per-agent allowlist | Present — Messages → Contacts tab (`src/screens/Messages.tsx:462+`) | Present — `app/(settings)/contacts.tsx`; full API incl. send/confirm verification (`lib/api.ts:374-406`) | Parity, different IA home (Messages tab vs Settings row). | |
| Help requests | Ask/offer help between members, task transfer on accept | Present — `src/components/HelpComposer.tsx` (from Dashboard) | Present — `app/(home)/help.tsx`; accept reports task reassignment (`lib/api.ts:819-840`) | Parity. | |
| Scoped views (kid / grandparent / sitter) | Role-tailored simplified home screens | Present — `src/screens/scoped/KidView.tsx`, `GrandparentView.tsx`, `SitterView.tsx` | Present — `app/(home)/kid.tsx`, `grandparent.tsx`, `sitter.tsx` (headerless full-screens) | Parity in existence; content depth not compared line-by-line. | |
| Dashboard / Today | Landing: schedule, overdue, approvals, ask box | Present — `src/screens/Dashboard.tsx` | Present — `app/(home)/index.tsx` ("Today") | See UX section. | |
| Messages / threads | Family message threads (local mirror) | Present — Messages Inbox merges threads + server notifications | Partial — Inbox "Chats" segment lists assistant conversations only, not family threads | Mobile "chats" = AI conversations; web inbox includes seeded family threads. | |

### 2. Recent web-only work — verified against mobile

| Item | WEB | iOS | Verdict |
|---|---|---|---|
| Server-truth approvals/notifications read-models (WP-001) | `useStore` `serverApprovals`/`serverNotifications`, badges in `Shell.tsx:73-81` | Mobile always fetched server truth directly (`api.approvals()`, `api.notifications()`) | **Parity** (mobile was never local-mirror) |
| Unified run history w/ cause CTAs | `useStore.ts:76-128` CTAs to messages/connections/settings | Flat run list, no CTAs (`activity.tsx`) | **Web-only** (CTA layer) |
| Double-run guard (WP-003 s3) | Gate on durable `runId` (`Assistant.tsx:12,680`) | Plan messages carry `runId`; `PlanCard` uses `autoRun={!!m.runId}` and `watchedRuns` set dedupes watchers (`(ask)/index.tsx:49,210-212,698`) | **Approx. parity** — mobile gates auto-run on runId; not verified to be as strict |
| Results deep-links from chat | Multi-link block → miniapps/files (`Assistant.tsx:308-317`) | Run results append artifacts to thread (`(ask)/index.tsx:426`); links go to `/activity`, not per-entity | **Web-only** (per-entity deep-links) |
| Dashboard open-tasks (WP-004) | `Dashboard.tsx:85-104` | Not found on Today screen in this form | **Web-only** |
| Artifacts library kind filters | `FilesKnowledge.tsx:354-404` | Artifacts listed inside Knowledge tab, no kind chips | **Web-only** (filters) |
| Unified Helper Agents nav flag (WP-005) | `prefs.ts:119`, `Shell.tsx:90-96` | Absent | **Web-only** |
| Packaged templates | `src/data/packagedTemplates.ts` | Absent (own 3-template list) | **Web-only** |
| Plain-language activity log | `ActivityMemory.tsx:64-90` humanizes audit events (verb maps) | `activity.tsx` renders raw-ish audit with filter, no plain-language rewriter observed | **Mostly web-only** |
| Approval TTL / expiry notices | `ExpiryCountdown` live ticker (`Messages.tsx:216`) | `expiresAt` in ApprovalRec available; no live countdown UI found | **Web-only** (live countdown) |
| SSE `/api/changes` sync | Web: EventSource push + slow poll fallback (`useStore.ts:1673-1709`) | Mobile: **polls** `/api/rev` every 12s while focused (`lib/rev-sync.ts`), replays offline queue on reconnect | **Web SSE / mobile poll** — deliberate; mobile note says poll is the mechanism |
| Sandbox mode / background jobs / browser workflows | `Automations.tsx` tabs `sandbox` ("Background Jobs"), `browser`; `src/components/BrowserSandbox.tsx`; `/jobs`, `/jobs/:id/run` endpoints | No `/jobs` or sandbox calls in mobile | **Web-only** |
| Email review (per-message label diff) | `/runs/:id/email-review` used on web | API method exists on mobile (`lib/api.ts:357`) but comment says UI lands later — "available for parity" | **Web-only UI**, mobile API-ready |

### 3. iOS-only features (no web counterpart)

| Feature | Where | Description | Suggested platform(s) |
|---|---|---|---|
| Push notifications (Expo) | `app/_layout.tsx:30,93-97`; `api.registerPushToken` (`lib/api.ts:673`) | OS-level push with token registration/unregistration; server routes real deliveries | |
| Location context | `lib/location.ts` (expo-location) | City-level coarse location, 10-min cache, permission-respectful; enriches assistant queries ("pizza near us") | |
| Camera & photo library capture | `components/sheets/upload-sheet.tsx:73-87`, `(ask)/index.tsx:374-389`, `profile.tsx:107` | Camera→upload (incl. multi-page docs like ID front/back), image attach in chat, profile photos | |
| Offline write queue | `lib/offline-queue.ts`, `lib/api.ts:230-248` | Task creates/patches queue while offline and replay on reconnect (surfaced via rev-sync) | |
| Haptics | `theme/index.ts:206-216` (expo-haptics) | Success/warning/error/selection feedback throughout | |
| Native tabs & sheets | `app/_layout.tsx` (`NativeTabs`), `components/ui/sheet.tsx` | SF Symbols, native tab bar, bottom sheets, glass effect (`expo-glass-effect`) | |
| Secure token storage | `lib/api.ts:13-23` (expo-secure-store) | Bearer-token auth (vs web cookies) | |
| Not present despite being plausible | — | No widgets, no native (EventKit) calendar integration, no Siri/App Intents found in `apps/mobile` | |

### 4. UI/UX differences for shared features

| Dimension | WEB | iOS | Notes | Suggested platform(s) |
|---|---|---|---|---|
| Navigation | Grouped sidebar (5 groups, `Shell.tsx:40-66`) + ⌘K command palette + 4-slot mobile-web bottom bar | 5 native tabs: Today / Ask / Agents / Library / Settings (`app/_layout.tsx:52-78`); stacks + sheets inside each | Mobile folds Meals/Automations/Playbooks/Contacts/AI under Settings — much shallower top-level IA. No command palette on mobile. | |
| Approvals entry point | Nav badge + amber "N to approve" pill in Topbar | Inbox screen with segmented control | | |
| Calm Mode | Present — `CalmToggle` in Topbar (`Shell.tsx:11-31`) reduces motion/depth/color | **Absent** — no calm-mode pref in `lib/prefs.tsx` | Mobile relies on OS reduce-motion conventions implicitly; no explicit toggle. | |
| Advanced Mode | Present — hides Skills/Functions/power tabs (`useAdvancedMode`) | Absent — mobile simply doesn't ship those surfaces | | |
| Density | Multi-column, tables, drawers, max-w-7xl | Single-column cards/lists, collapsible sections, "show all" expanders | Mobile deliberately caps lists (e.g. 3→12 runs). | |
| Theming / dark mode | Light-surface app w/ dark sidebar; Tailwind tokens | Full theme system w/ system dark mode (`src/theme/index.ts`) | Ambiguous whether web has a full dark mode; no `prefers-color-scheme` toggle found in Shell. | |
| Degraded/offline signaling | `DegradedBanner` + `StorageBanner` + RuntimePill (`Shell.tsx:130-147,283-309`) | Per-screen "can't reach backend" empty-states naming `npm run dev` + Wi-Fi (`activity.tsx:172`), offline queue toasts | | |
| Space filter | Global space `<select>` in Topbar | None (only Library file-space chips) | | |
| Gestures | Click/keyboard; Esc-close drawers | PressableScale w/ haptic, pull patterns, hitSlop, sheets | | |

---

## Shared-server, client-gap explainer

The backend is one shared API; roles, visibility, and approvals are **server-enforced**. That means:

**Works on iOS today with zero server work (client already wired):** approvals (server truth incl. run-step input), notifications + push, chat (streamed, server-durable, shared conversations with web), runs list/start/cancel, agents run/pause/duplicate/delete, triggers enable/fire/delete, calendar incl. two-way Google sync + conflict resolve, meals/groceries, tasks (with offline queue), files/knowledge/artifacts/memory (list+delete), evolution review, contact methods incl. verification, help requests, AI provider config/health/activate, invites/members/household, risk overrides.

**Needs only mobile UI work (endpoint exists, mobile client lacks the call or the screen):** memory FTS5 search (`/memory/search`), artifact kind filters, email review UI (`emailReview` already in `lib/api.ts:357`), run cause-CTAs, timezone + hideProfilesPreAuth settings fields (extend `AppSettingsRec`), setup-guide content (static data, could be shared), packaged-template catalog (static data in `src/data/packagedTemplates.ts`), SSE `/api/changes` (server already streams it; mobile would swap poll for stream).

**Web-only by design / heavy lift to port:** Skills & Functions builders, workflow builder, browser workflows + sandbox/background jobs (`/jobs`), Mini Apps, Household Spaces management, command palette. These are dense authoring surfaces; porting means real design work, not just API plumbing.

**iOS-only capabilities web cannot get:** OS push, camera capture, location context, haptics, secure-store, offline queue (web could approximate with service workers but nothing exists today).
