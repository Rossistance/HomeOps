# FamiliOS iOS Element Map

Source-derived locator inventory for Appium (XCUITest) and Appetize runs. React Native
rule: `testID` → accessibility id (strongest); with no `testID` (this codebase has **zero**),
`accessibilityLabel` populates the accessible name/label — reachable via `~label` and
`-ios predicate string`. Confirm rows live with Appium Inspector (docs/INSPECTOR-GUIDE.md)
and flip `Confirmed` to yes+date.

**Work package (recommended):** add `testID`s to the high-traffic elements below —
labels double as user-facing VoiceOver text and can drift with copy edits.

## Auth / lock — `apps/mobile/src/components/Lock.tsx`

| Logical name | Locator | Value | Source | Confirmed |
|---|---|---|---|---|
| Profile card (any) | predicate | `label BEGINSWITH "Sign in as"` | Lock.tsx:137 (template: `Sign in as ${displayName}, ${role}…`) | no |
| Profile card (specific) | predicate | `label BEGINSWITH "Sign in as Alex Harper"` | Lock.tsx:137 | no |
| Household PIN field | accessibility id | `~Household PIN` | Lock.tsx:171 | no |

Seeded profiles (server/seed.mjs): Alex Harper (Owner, PIN in prod), Morgan Harper (Adult Admin, PIN in prod), Lily Harper + Noah Harper (Child View, never PIN), Elaine Brooks + Sam Rivera (Guest/Helper, never PIN).

## Root tabs — `apps/mobile/src/app/_layout.tsx` (NativeTabs, role-scoped)

| Logical name | Locator | Value | Confirmed |
|---|---|---|---|
| Today tab | predicate | `label == "Today" AND type == "XCUIElementTypeButton"` | no |
| Ask tab | predicate | `label == "Ask" AND type == "XCUIElementTypeButton"` | no |
| Agents tab | predicate | `label == "Agents" AND type == "XCUIElementTypeButton"` | no |
| Library tab | predicate | `label == "Library" AND type == "XCUIElementTypeButton"` | no |
| Settings tab | predicate | `label == "Settings" AND type == "XCUIElementTypeButton"` | no |

## Ask (chat) — `apps/mobile/src/app/(ask)/index.tsx`

| Logical name | Locator | Value | Source | Confirmed |
|---|---|---|---|---|
| Composer input | accessibility id | `~Message` | (ask)/index.tsx:787 | no |
| Send button | accessibility id | `~Send` | (ask)/index.tsx:800 | no |
| Attach file | accessibility id | `~Attach a file` | (ask)/index.tsx:770 | no |
| New chat | accessibility id | `~New chat` | (ask)/index.tsx:493 | no |

## Agents — `apps/mobile/src/app/(agents)/index.tsx`

| Logical name | Locator | Value | Source | Confirmed |
|---|---|---|---|---|
| New agent | accessibility id | `~New agent` | (agents)/index.tsx:139 | no |

## Settings surfaces — `apps/mobile/src/app/(settings)/`

| Logical name | Locator | Value | Source | Confirmed |
|---|---|---|---|---|
| Verification code field | accessibility id | `~Verification code` | contacts.tsx:76 | no |
| Calendar feed URL field | accessibility id | `~Calendar feed URL` | connections.tsx:292 | no |
| Auto-approve toggle | accessibility id | `~Auto-approve low-risk improvements` | ai.tsx:458 | no |

Screen titles usable as markers (Stack titles): "Groceries", "Calendar", "Inbox".
~137 `accessibilityLabel`s exist across 29 files — grep `accessibilityLabel` under
`apps/mobile/src/` to extend this map per screen before writing new cases.

## Web lane companions (Playwright, for parity checks)

No `data-testid` exists; use aria labels/roles/text: heading `/who's using/i` (Lock),
`aria-label="Open command palette and search"`, `"Sign out / switch profile"`,
`"Ask FamiliOS…"`/`"Message FamiliOS"` (Assistant), `role=tablist "Calendar view"`,
`"Previous month"`/`"Next month"`, `role=dialog "Command palette"`, nav buttons by
visible label with `aria-current="page"` when active (src/components/Shell.tsx).
