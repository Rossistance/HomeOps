# Capability Inventory — iOS Redesign Build (2026-07-05)

Phase 0 record for the all-in-one orchestrated build (mobile redesign + feature parity + OAuth fix).

## Used

| Capability | How it was used |
|---|---|
| `expo:building-native-ui` skill | Drove every core design decision: NativeTabs, large-title stacks, form sheets, SF Symbols via expo-image `sf:`, Reanimated entrances with `ReduceMotion.System`, `borderCurve: continuous`, `boxShadow`, `contentInsetAdjustmentBehavior` |
| Explore subagents (3, parallel) | Mobile inventory + quality audit, web feature inventory (gap matrix), OAuth flow trace |
| general-purpose subagents (6, parallel) | One per screen group, all building on the shared theme/UI kit written first in the main thread |
| Persistent memory | Repo layout, corporate-TLS workaround (`NODE_EXTRA_CA_CERTS`), `expo install` failure mode + `bundledNativeModules.json` pinning, screenshot limitations |
| EAS CLI (authenticated) | Build history forensics (confirmed TestFlight build #9 = HEAD → ruled out stale-binary theory), production build + submit |
| Backend test suite (`npm test`) | 203/203 green after server changes |
| `npx tsc --noEmit` + `npx expo export -p ios` | Windows-host verification (no Mac/simulator available) |
| Live probes (Invoke-WebRequest) | Confirmed deployed Render server version + callback behavior before diagnosing |

## Skipped (and why)

| Capability | Reason |
|---|---|
| `expo:eas-simulator` | Would give real-device QA from Windows, but burns EAS build credits + long cycle; deferred to the TestFlight build itself |
| Playwright/Chrome browser QA | No mobile web target changed; PWA untouched |
| Figma / design MCPs | Design system derived from the existing web Tactile Hearth tokens, not a Figma source |
| `skill-creator` (skill-gap loop) | No reusable cross-project gap found; the one candidate ("Expo redesign checklist") is already covered by `expo:building-native-ui` |
| Workflow tool | Subagent fan-out via Agent tool sufficed; no deterministic loop/verify pipeline needed |

## Honesty ledger (blast radius)

- **Touched:** `apps/mobile/src/**` (rebuilt), `server/index.mjs` (OAuth callback/start + tasks `listName` — 3 scoped edits), `docs/*`.
- **Not touched:** web client, PWA, all other server routes, data model, stores.
- **Deferred features (honest non-goals, see MOBILE_REDESIGN.md):** Mini Apps renderer, Skills/Functions builders, month-grid calendar, on-device PIN. Screens link out to web rather than stubbing.
- **Known risks:** NativeTabs is expo-router's `unstable-native-tabs` API; `@expo/ui` DateTimePicker compiles but hasn't run on a physical device from this Windows host; assistant stream fallback can double-persist a turn if the stream dies after server-side persistence (server-side idempotency would fix).

## Retrospective

- **Worked well:** foundation-first (theme + primitives + nav shell in the main thread) then 6-way parallel screen fan-out — zero merge conflicts because api.ts was pre-extended and shared files were frozen.
- **Friction:** the legacy `src/components/ui.tsx` shadowed the new `ui/` directory for bare imports; every agent independently discovered it. Lesson: when replacing a module with a directory, delete/rename the old file *before* fan-out.
- **Friction:** Glob/Grep tools need cwd-relative patterns on this Windows host; absolute-drive `path` args silently return nothing.
- **Skill note (for all-in-one-skill):** "brownfield fit" phase worked as documented; capability inventory legitimately changed the plan (EAS forensics replaced guesswork about the deployed binary).
